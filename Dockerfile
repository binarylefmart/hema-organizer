# syntax=docker/dockerfile:1
#
# HEMA Organizer — image de production (Next.js 15 standalone + Prisma/SQLite).
#
# Contraintes de la stack Portainer (voir CLAUDE.md et docs/portainer-stack.yml) :
#   - utilisateur non-root, `cap_drop: ALL`, `no-new-privileges:true`, `/tmp` en tmpfs
#   - écriture uniquement dans /data (base SQLite), /backups (sauvegardes), /tmp — et /app/.next/cache,
#     le cache de Next, seul dossier de l'application qui appartienne à l'utilisateur d'exécution
#   - le code, lui, est en root:root : `node` l'exécute, il ne peut pas le réécrire
#   - écoute sur 0.0.0.0:3000, `wget` présent pour le healthcheck
#
# Quatre étapes :
#   deps      → dépendances complètes (devDependencies comprises) pour compiler
#   builder   → `prisma generate`, `next build` (sortie standalone), compilation du seed
#   prismacli → la CLI Prisma seule, installée proprement (elle sert à `migrate deploy` au démarrage)
#   runner    → image finale, sans devDependencies

ARG NODE_IMAGE=node:22-alpine

##############################################################################
# Base commune
##############################################################################
FROM ${NODE_IMAGE} AS base
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

##############################################################################
# 1. Dépendances de compilation
##############################################################################
FROM base AS deps
COPY package.json package-lock.json ./
# `npm ci` reproduit exactement package-lock.json. argon2 fournit un binaire musl
# précompilé (prebuilds/linux-x64/argon2.musl.node) : aucune chaîne de compilation C++ nécessaire.
RUN npm ci --no-audit --no-fund

##############################################################################
# 2. Build de l'application
##############################################################################
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NODE_ENV=production

RUN npx prisma generate
# Valeurs factices passées uniquement à la commande de build (`next build` charge la configuration
# et pré-rend quelques pages) : elles ne sont écrites nulle part dans l'image finale.
RUN SESSION_SECRET=compilation-uniquement-0123456789-0123456789 \
    DATABASE_URL="file:/tmp/build.db" \
    DOMAIN=localhost:3000 \
    npx next build

# Le seed du compte d'administration est écrit en TypeScript (prisma/seed.ts) et exécuté par `tsx`
# en développement. `tsx` est une devDependency : on ne peut pas l'embarquer dans l'image finale.
# On compile donc le seed **ici** en un unique fichier CommonJS, avec esbuild (déjà présent via tsx).
# @prisma/client et argon2 restent externes : ce sont des modules natifs, résolus à l'exécution
# depuis le node_modules de la sortie standalone. Un seul code source, aucune duplication de logique.
RUN node_modules/.bin/esbuild prisma/seed.ts \
      --bundle --platform=node --format=cjs --target=node22 \
      --external:@prisma/client --external:argon2 \
      --outfile=seed.cjs \
 && node --check seed.cjs

# **L'outil de réparation voyage avec l'image**, compilé de la même façon et pour la même raison :
# les incohérences qu'il répare (réponses laissées par un membre retiré, ateliers orphelins, liens
# concurrents) sont dans la base du club, pas sur le poste de qui développe. Sans lui ici, il
# faudrait sortir la base du serveur pour la soigner ailleurs, puis la remettre — un aller-retour
# qu'on ne fait pas volontiers sur la seule copie vivante des données.
# Il ne s'exécute jamais tout seul : l'entrypoint ne l'appelle pas, c'est `docker exec` qui le lance,
# et il ne touche à rien sans `--reparer`.
RUN node_modules/.bin/esbuild scripts/reparer-donnees.ts \
      --bundle --platform=node --format=cjs --target=node22 \
      --external:@prisma/client --external:argon2 \
      --outfile=reparer.cjs \
 && node --check reparer.cjs

##############################################################################
# 3. CLI Prisma seule (pour `prisma migrate deploy` au démarrage)
##############################################################################
FROM base AS prismacli
WORKDIR /pcli
COPY package.json ./source-package.json
# On réinstalle la CLI à la version exacte déclarée dans les devDependencies du projet,
# sans traîner les ~800 Mo de devDependencies complètes.
RUN VERSION="$(node -p "require('./source-package.json').devDependencies.prisma")" \
 && rm source-package.json \
 && npm init -y > /dev/null \
 && npm install --no-audit --no-fund --omit=dev "prisma@${VERSION}" \
 && rm -rf /root/.npm

##############################################################################
# 4. Image finale
##############################################################################
FROM base AS runner

# wget : sonde de santé du compose. tzdata : fuseau Europe/Paris pour node-cron.
RUN apk add --no-cache wget tzdata

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    TZ=Europe/Paris \
    DATABASE_URL="file:/data/hema.db" \
    BACKUP_DIR=/backups

# ┌──────────────────────────────────────────────────────────────────────────────────────────────┐
# │ **Le code applicatif n'appartient PAS à l'utilisateur qui l'exécute.**                        │
# └──────────────────────────────────────────────────────────────────────────────────────────────┘
#
# Chaque `COPY` posait `--chown=node:node`, entrypoint compris : `node` possédait `server.js`,
# `.next/`, `node_modules`, le client Prisma **et le script qui le lance**. CLAUDE.md exige
# « écriture uniquement dans /data, /backups, /tmp » — or une simple primitive d'écriture de fichier
# devenait, là, une modification **persistante du code applicatif**, que `restart: always`
# relance au démarrage suivant. `cap_drop: ALL` et `no-new-privileges` n'y changent rien : il n'y a
# aucune élévation à obtenir quand on peut déjà réécrire le programme.
#
# Le code est donc en `root:root`, **lisible** par tout le monde (les droits par défaut d'un `COPY`,
# 0644 pour les fichiers et 0755 pour les dossiers, suffisent : `node` lit, il n'écrit pas). Ce que
# `node` possède se réduit à ce qu'il doit écrire : `/data`, `/backups`, et le seul cache dont Next
# a besoin (voir plus bas).
#
# Application (sortie standalone : server.js + le node_modules strictement nécessaire)
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Client Prisma généré + moteur de requêtes (la trace de Next.js ne les embarque pas toujours)
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client

# Schéma et migrations (nécessaires à `prisma migrate deploy`)
COPY --from=builder /app/prisma/schema.prisma ./prisma/schema.prisma
COPY --from=builder /app/prisma/migrations ./prisma/migrations

# Seed compilé et CLI Prisma
COPY --from=builder /app/seed.cjs ./seed.cjs
# Outil de réparation des données (voir plus haut) : `docker exec <conteneur> node reparer.cjs`
COPY --from=builder /app/reparer.cjs ./reparer.cjs
COPY --from=prismacli /pcli/node_modules ./prisma-cli/node_modules

# Entrypoint : `root:root 0755` — exécutable par tous, modifiable par personne. C'est le premier
# fichier qu'un attaquant réécrirait, puisque c'est lui qui tourne avant tout le reste.
COPY docker/entrypoint.sh /usr/local/bin/hema-entrypoint
RUN chmod 0755 /usr/local/bin/hema-entrypoint

# **Le seul dossier d'écriture dans /app**, et il est vide : le cache incrémental de Next.
# La sortie standalone y écrit selon les cas (cache de `fetch`, cache de rendu) et se plaint —
# parfois bruyamment — s'il n'est pas accessible. L'optimiseur d'images, lui, n'écrit rien ici
# (`images: { unoptimized: true }` dans next.config.ts). On donne donc ce dossier-là, et pas un de
# plus : un cache réécrit ne fait pas tourner de code, un `server.js` réécrit si.
RUN mkdir -p /app/.next/cache && chown -R node:node /app/.next/cache && chmod 0750 /app/.next/cache

# Points de montage : créés dans l'image avec le bon propriétaire pour que Docker
# recopie ces droits lors de l'initialisation des volumes nommés (hema_data, hema_backups).
# **Ce `chmod` ne vaut que pour un volume nommé** : sur un *bind mount* — le montage retenu pour ce
# club, voir docs/portainer-stack.yml — c'est le mode du dossier de l'hôte qui gagne, et c'est donc
# la procédure d'installation qui doit poser `chmod 750` (docs/DEPLOIEMENT.md § 4).
RUN mkdir -p /data /backups && chown node:node /data /backups && chmod 0750 /data /backups

# Utilisateur non-root fourni par l'image officielle (uid 1000).
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

ENTRYPOINT ["/usr/local/bin/hema-entrypoint"]
CMD ["node", "server.js"]
