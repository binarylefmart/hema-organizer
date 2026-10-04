# Déploiement — HEMA Organizer

Ce document décrit la mise en ligne et l'exploitation courante de l'application : une **stack Docker
gérée à la main dans Portainer**, sur un serveur distant, **derrière Nginx Proxy Manager** (NPM).

Il est écrit pour être relu de zéro, sans rien avoir en tête : on déploie une version par mois, et
entre deux fois on a le droit d'avoir oublié comment ça marche. Le premier chapitre présente donc ce
qui tourne et pourquoi, avant la moindre manipulation. Les chapitres suivants sont des gestes, en
étapes numérotées, à suivre dans l'ordre.

Les exemples de ce document sont **fictifs** : partout où vous lisez `organizer.mon-club.fr`,
`contact@mon-club.fr` ou `mon-compte-github`, remplacez par vos valeurs réelles — elles ne sont
écrites nulle part ici.

Sommaire :

1. [La stack : ce qui tourne, où, et pourquoi](#1-la-stack--ce-qui-tourne-où-et-pourquoi)
2. [Les variables d'environnement](#2-les-variables-denvironnement)
3. [Publier une version (tag → image)](#3-publier-une-version-tag--image)
4. [Première installation](#4-première-installation)
5. [Le proxy host dans Nginx Proxy Manager](#5-le-proxy-host-dans-nginx-proxy-manager)
6. [Première connexion](#6-première-connexion)
7. [Avant une mise à jour : les quatre points à vérifier](#7-avant-une-mise-à-jour--les-quatre-points-à-vérifier)
8. [Mettre à jour une version](#8-mettre-à-jour-une-version)
9. [Revenir en arrière](#9-revenir-en-arrière)
10. [Sauvegarde et restauration](#10-sauvegarde-et-restauration)
11. [Lire les journaux](#11-lire-les-journaux)
12. [Nettoyer les données (outil de réparation)](#12-nettoyer-les-données-outil-de-réparation)
13. [En cas de problème](#13-en-cas-de-problème)
14. [Le site public (prochains cours)](#14-le-site-public-prochains-cours)
15. [Notifications sur téléphone](#15-notifications-sur-téléphone)

---

## 1. La stack : ce qui tourne, où, et pourquoi

### 1.1 Le chemin d'une requête

```
      Le navigateur d'un membre (téléphone, tablette, PC)
                    │
                    │  HTTPS, port 443
                    ▼
   ┌───────────────────────────────────────────────────────┐
   │  Nginx Proxy Manager                                  │
   │  un autre conteneur, déjà en place sur le serveur     │
   │  • termine le TLS (certificat Let's Encrypt)          │
   │  • pose X-Forwarded-For / X-Forwarded-Proto           │
   └───────────────────────────────────────────────────────┘
                    │
                    │  HTTP en clair, à l'intérieur du serveur,
                    │  sur le réseau Docker « npm »
                    │  vers  hema-organizer:3000
                    ▼
   ┌───────────────────────────────────────────────────────┐
   │  Conteneur  hema-organizer   (la seule pièce à nous)   │
   │  • Next.js 15, sortie standalone, écoute 0.0.0.0:3000 │
   │  • les tâches planifiées (node-cron) dans le même     │
   │    processus : sauvegarde 03:30, entretien 07:00,     │
   │    envois du soir à l'heure réglée                    │
   │  • utilisateur non-root « node » (uid 1000)           │
   │  • sonde GET /api/health toutes les 30 secondes       │
   └───────────────────────────────────────────────────────┘
            │                              │
            │  /data                       │  /backups
            ▼                              ▼
   <DATA_DIR>/data                 <DATA_DIR>/backups
   • hema.db — la base SQLite       • hema-AAAA-MM-JJ.db,
   • affiches/ — les images des      une copie par nuit,
     annonces d'événements           conservée 30 jours

   Ces deux dossiers vivent **sur le disque du serveur**, pas dans un volume
   Docker : on les sauvegarde et on les restaure avec un simple `cp`.
```

### 1.2 Ce que fait chaque pièce

**L'image applicative et son entrypoint.** L'image est construite par GitHub Actions et publiée sur
le registre que le dépôt a configuré — **Docker Hub** s'il porte les secrets `DOCKERHUB_USERNAME` et
`DOCKERHUB_TOKEN`, **`ghcr.io`** sinon (§ 3). Elle contient l'application
compilée, le client Prisma, les migrations, et deux petits outils en ligne de commande (`seed.cjs`,
`reparer.cjs`). À chaque démarrage du conteneur, le script `docker/entrypoint.sh` fait trois choses,
**dans cet ordre, et s'arrête à la première qui échoue** :

1. il vérifie la configuration minimale — `DATABASE_URL` présent, `SESSION_SECRET` présent et d'au
   moins 32 caractères, dossier de la base existant et accessible en écriture. Un manque à ce stade
   arrête le conteneur avec un message en clair, plutôt que de servir une application cassée ;
2. il applique les migrations de la base (`prisma migrate deploy`). C'est là, et nulle part
   ailleurs, que le schéma se met à jour : vous n'avez jamais de commande de migration à lancer
   vous-même ;
3. il crée le compte d'administration s'il n'existe pas (`ADMIN_EMAIL` / `ADMIN_PASSWORD`). Cette
   étape est **idempotente**, au sens strict : dès qu'un compte existe à cette adresse, **rien n'est
   écrit** — ni mot de passe, ni rôle, ni activation —, et le journal du conteneur dit lequel des
   deux cas s'est présenté. Un redémarrage ne réécrit donc rien, et l'adresse d'`ADMIN_EMAIL` qui
   serait aussi celle d'une personne de l'annuaire ne la transforme pas en administrateur au passage.
   Nommer un administrateur est un geste de bureau, qui a son
   écran (*Espace admin → Comptes admin*), ses gardes et sa ligne de journal d'audit.

Puis il lance le serveur. Tant que ces trois étapes n'ont pas réussi, aucune requête n'est servie.

**La base SQLite, dans son dossier.** Un seul fichier, `hema.db`, dans `<DATA_DIR>/data` (vu comme
`/data` par le conteneur). À côté, le sous-dossier `affiches/` reçoit les images déposées dans les
annonces d'événements. Tout ce que le club produit est donc **dans ce seul dossier** : perdez-le, et
vous avez perdu l'application ; gardez-le, et le conteneur est remplaçable à volonté.

**Le dossier des sauvegardes.** `<DATA_DIR>/backups` (vu comme `/backups`). Chaque nuit à 03:30,
l'application y écrit une copie cohérente de la base sous le nom `hema-AAAA-MM-JJ.db`, et efface les
copies de plus de 30 jours. La copie est faite par SQLite lui-même (`VACUUM INTO`, l'équivalent de
`sqlite3 .backup`) : l'application n'a pas besoin d'être arrêtée, et le fichier obtenu est une base
complète, utilisable telle quelle. **Attention :** ce dossier ne contient que la base, jamais les
affiches (§ 10).

**Le réseau du proxy.** La stack rejoint le réseau Docker de NPM, déclaré `external` — elle ne le
crée pas, elle s'y branche (`NPM_NETWORK`, souvent `npm_default`). C'est ce qui permet à NPM
d'appeler l'application **par son nom de conteneur**, `hema-organizer:3000`, sans que rien ne soit
exposé. L'application ne fait aucun TLS : elle fait confiance aux en-têtes `X-Forwarded-*` posés par
le proxy, et c'est de là qu'elle tire l'adresse du visiteur pour tous les quotas et pour le journal
d'audit.

**Aucun port n'est publié sur le serveur.** Les deux lignes `ports:` du fichier de stack sont
commentées, et c'est le seul montage que ce document décrit. Pourquoi : qui atteint l'application
**sans passer par le proxy** pose lui-même son en-tête `X-Forwarded-For`, devient donc le dernier
maillon de la chaîne, et **choisit l'adresse que l'application retiendra**. Deux conséquences, et la
seconde est la pire : plus aucun quota par IP ne tient (connexion, liens inconnus, API publique,
pages de partage), et **l'adresse inscrite au journal d'audit devient une valeur choisie par le
visiteur** — les alertes envoyées aux administrateurs racontent alors une histoire fausse. Ce port
n'est pas nécessaire : NPM passe par le réseau Docker. S'il faut le rouvrir pour un dépannage, le lier à **une seule** adresse (`127.0.0.1:3080:3000`, ou la passerelle Docker
`172.17.0.1:3080:3000`) et vérifier que **seuls les ports 80 et 443 sont redirigés depuis Internet
vers le serveur** — sans quoi l'intégrité du journal d'audit repose sur la configuration de la box.

**Le healthcheck.** Toutes les 30 secondes, Docker exécute `wget -qO- http://127.0.0.1:3000/api/health`
dans le conteneur. La route répond `{"ok":true}` si l'application tourne **et** que la base répond ;
sinon elle répond 503. Trois échecs de suite font passer le conteneur en `unhealthy` — c'est ce que
vous lisez dans la colonne d'état de Portainer, et c'est le premier endroit à regarder quand quelque
chose ne va pas. Un délai de grâce de 30 secondes couvre le temps des migrations au démarrage.

**L'utilisateur non-root, `cap_drop: ALL` et `no-new-privileges`.** Le conteneur tourne sous
l'utilisateur `node` (uid 1000) fourni par l'image officielle, pas sous `root` :
- `cap_drop: ALL` retire **toutes** les capacités du noyau. L'application n'en a besoin d'aucune —
  elle ouvre un port au-dessus de 1024 et écrit dans trois dossiers, rien de plus ;
- `no-new-privileges:true` interdit à un processus du conteneur de gagner des droits en cours de
  route (par un binaire *setuid*, par exemple). Autrement dit : même en cas de faille dans
  l'application, il n'y a pas d'escalier vers `root` à monter ;
- `/tmp` est un `tmpfs`, c'est-à-dire en mémoire, et disparaît à chaque redémarrage. L'application
  n'écrit ailleurs que dans `/data`, `/backups` et le cache de Next (`/app/.next/cache`) ;
- **le code applicatif ne lui appartient pas.** `server.js`, `.next/`, `node_modules`,
  le client Prisma et l'entrypoint sont en `root:root`, lisibles et exécutables mais **non
  modifiables** par l'utilisateur qui les exécute : une faille d'écriture de fichier ne peut pas
  réécrire le programme que `restart: always` relancerait — ce que `cap_drop: ALL`, seul,
  n'empêcherait pas.

C'est aussi pourquoi les deux dossiers de l'hôte doivent appartenir à l'uid **1000** : le conteneur
ne peut pas se donner le droit d'écrire, il faut le lui avoir donné.

Le fichier de référence de tout cela est [`docs/portainer-stack.yml`](portainer-stack.yml) — c'est
lui qu'on recopie dans Portainer, et lui qui fait foi.

### 1.3 Pourquoi SQLite, et pourquoi un seul conteneur

Parce que l'échelle du besoin est celle d'un club : quelques dizaines de personnes, quelques dizaines
de séances par trimestre, une pointe d'activité le soir où l'on répond « présent » — et **aucune
croissance à prévoir**. Un club ne double pas d'effectif ; il gagne trois membres et en perd deux.

Dans ces conditions, SQLite n'est pas un compromis, c'est le bon outil : la base est un fichier, donc
la sauvegarde est une copie de fichier et la restauration aussi ; il n'y a pas de second conteneur à
tenir à jour, pas de mot de passe de base de données à gérer, pas de réseau interne à surveiller. Un
serveur PostgreSQL à côté, ce serait une deuxième pièce à administrer pour un gain de performance que
personne ne verrait jamais.

Même raisonnement pour le conteneur unique : les tâches planifiées (sauvegarde, envois du soir,
entretien) vivent **dans** le processus de l'application, ce qui évite un ordonnanceur séparé.

**Ce que ça implique, et qu'il faut accepter :**

- **une seule instance, jamais deux.** On ne fait pas tourner deux conteneurs sur la même base : deux
  processus écriraient dans le même fichier et se battraient pour les tâches planifiées (deux récaps
  du soir, deux sauvegardes). Il n'y a donc pas de mise à l'échelle horizontale, et ce n'est pas un
  oubli ;
- **une mise à jour est une petite coupure.** Remplacer l'image arrête le conteneur et en démarre un
  autre : quelques secondes d'indisponibilité. Sans deuxième instance, il n'y a pas de bascule sans
  coupure — et pour ce besoin, c'est sans conséquence, à condition de choisir son heure (§ 7) ;
- **les sauvegardes sont le filet, et c'est le seul.** Il n'y a pas de réplication, pas de secours
  chaud. Ce qui protège les données, c'est la copie de la nuit et le fait de la **recopier hors du
  serveur** (§ 10). Une sauvegarde qu'on n'a jamais vérifiée n'est pas une sauvegarde.

---

## 2. Les variables d'environnement

Elles se saisissent dans Portainer, dans la section **Environment variables** de la stack (bouton
*Add an environment variable*, ou *Advanced mode* pour coller la liste d'un coup). Les variables
purement techniques — `NODE_ENV`, `DATABASE_URL`, `BACKUP_DIR` — sont déjà figées dans le fichier de
stack : il n'y a **que celles du tableau** à renseigner.

Les exemples ci-dessous sont **inventés**. Ne les recopiez pas tels quels.

| Variable | Oblig. | À quoi elle sert | Si elle manque | Exemple |
|---|:--:|---|---|---|
| `IMAGE` | — | L'adresse de l'image, **sans le numéro de version** (celui-ci est `APP_TAG`). **Le fichier de stack en porte un défaut** : à ne renseigner que si vous fabriquez votre propre image ou la rangez ailleurs | Le défaut du fichier de stack est pris. S'il ne désigne aucune image accessible, le téléchargement échoue (`pull access denied`) et la stack ne démarre pas | `docker.io/mon-compte/hema-organizer` |
| `APP_TAG` | — | La version d'image à faire tourner, **sans le `v`**. À ne saisir que pour **épingler** une version — en particulier pour revenir en arrière (§ 9) | `latest` est pris par défaut, et l'image est retéléchargée à chaque déploiement (`pull_policy: always`). C'est le mode courant : on met à jour en redéployant, sans toucher à une variable | `0.53.0` |
| `NPM_NETWORK` | — | Le nom réel du réseau Docker de Nginx Proxy Manager | `npm_default` est pris par défaut. Si ce n'est pas le bon nom, la stack refuse de démarrer (`network not found`) | `npm_default` |
| `APP_PORT` | — | **Sans effet** : elle ne sert qu'aux deux lignes `ports:` du fichier de stack, qui sont commentées — la stack ne publie aucun port (§ 1.2) | — | — |
| `DATA_DIR` | — | Le dossier du serveur qui porte `data/` et `backups/` | La valeur par défaut inscrite dans le fichier de stack est prise. **Sur une installation existante, ne la changez pas** : pointer ailleurs, c'est repartir d'une base vide en croyant avoir mis à jour | `/srv/organizer` |
| `TZ` | — | Le fuseau de toutes les tâches planifiées et de toutes les dates affichées | `Europe/Paris` est pris par défaut | `Europe/Paris` |
| `DOMAIN` | ✅ | Le domaine public, **sans** `https://`. Sert à construire les liens des emails et à la protection CSRF | Les liens envoyés par email pointent sur `localhost` : personne ne peut ouvrir son lien personnel | `organizer.mon-club.fr` |
| `SESSION_SECRET` | ✅ | Signature des cookies de session, des liens signés (désinscription, annulation) et chiffrement des secrets de double authentification | Absente ou plus courte que 32 caractères, **le conteneur s'arrête au démarrage** en le disant. **À conserver précieusement** : la changer déconnecte tout le monde et rend illisibles les secrets 2FA déjà enregistrés | résultat de `openssl rand -base64 48` |
| `SMTP_HOST` | ✅ | Le serveur d'envoi des emails | Aucun email ne part — donc **aucun lien personnel**, aucun rappel, aucune réinitialisation de mot de passe. L'application démarre quand même : la panne est silencieuse, c'est pourquoi il faut faire l'envoi de test du § 4 | `mail.exemple.net` |
| `SMTP_PORT` | — | Le port du serveur d'envoi | `587` est pris par défaut (STARTTLS) | `587` |
| `SMTP_USER` | ✅ | L'identifiant de la boîte d'envoi | Le serveur refuse l'authentification : chaque envoi échoue et est journalisé | `contact@mon-club.fr` |
| `SMTP_PASS` | ✅ | Le mot de passe de cette boîte | Idem | mot de passe de la boîte |
| `SMTP_FROM` | ✅ | L'expéditeur affiché dans les emails. **Sans guillemets** : dans Portainer, les guillemets font partie de la valeur, et le serveur répond alors `501 5.1.7 Bad sender address syntax` — plus un seul email ne part. L'application les retire à l'usage et le signale, mais autant que la variable soit juste | L'envoi part avec une adresse d'expéditeur vide, souvent refusée par le serveur | `Mon club <contact@mon-club.fr>` |
| `DISCORD_WEBHOOK_URL` | — | Le salon Discord où publier le récapitulatif de la veille. **Vérifiée au démarrage**, avec la même règle que le champ de l'application : une valeur qui n'a pas la forme `https://discord.com/api/webhooks/<id>/<jeton>` est **ignorée** (canal muet, avertissement dans le journal du conteneur, sans jamais recopier la valeur — elle contient un jeton). Les guillemets que Portainer garde sont retirés, comme pour `SMTP_FROM` | Le canal Discord reste muet, sans rien casser. Se règle aussi dans **Espace admin → Notifications → Discord**, et la valeur enregistrée là gagne sur celle-ci | `https://discord.com/api/webhooks/000000000/xxxxxxxx` |
| `PUBLIC_API_ORIGIN` | — | La **seule** origine autorisée à lire l'API publique depuis un navigateur (CORS) : l'adresse du site du club | Vide par défaut : aucun navigateur tiers n'est autorisé. Le plugin WordPress, lui, appelle depuis son serveur et n'a pas besoin de cette variable | `https://mon-club.fr` |
| `ADMIN_EMAIL` | ✅ | L'adresse du premier compte d'administration, créé au démarrage. **Choisir une adresse qui n'est celle de personne d'autre** (l'adresse de contact du club) : si un compte existe déjà à cette adresse, le seed **ne le modifie pas** et aucun administrateur n'est créé — il le dit dans le journal du conteneur | Aucun compte n'est créé : l'application tourne et **personne ne peut entrer**. Le journal du conteneur le dit explicitement | `contact@mon-club.fr` |
| `ADMIN_PASSWORD` | ✅ | Le mot de passe **provisoire** de ce compte, 10 caractères minimum | Même effet : pas de compte. Changer cette valeur après coup n'a aucun effet — le compte existe déjà (utiliser « Mot de passe oublié ») | `provisoire-a-changer-42` |

Quatre choses dont on croit souvent, à tort, qu'elles demandent une variable :

> **L'identité du club** — nom, sigle, thème, couleur, logos — **se règle dans l'application**
> (*Espace admin → Club*), pas ici. Les variables `CLUB_NOM` et `CLUB_SIGLE` existent, mais elles ne
> servent qu'à nommer une instance neuve avant que quiconque ait ouvert cet écran ; un réglage fait
> dans l'application les emporte définitivement.

> **Telegram** se règle dans **Espace admin → Notifications → Telegram**, où le jeton du bot et
> l'identifiant du salon sont rangés **chiffrés en base**. `TELEGRAM_BOT_TOKEN` et
> `TELEGRAM_CHAT_ID` existent comme solution de repli, mais il n'y a aucune raison de les mettre
> dans la stack.

> **Les notifications sur téléphone** ne demandent **rien** : ne cherchez pas de variable `VAPID_*`,
> il n'y en a pas. Les clés d'envoi sont engendrées automatiquement au premier besoin et rangées
> chiffrées en base (§ 15).

> **Les affiches des événements** ne demandent ni variable ni montage supplémentaire : elles sont
> écrites dans `/data/affiches`, à côté de la base, dans le dossier qui existe déjà. `UPLOAD_DIR`
> permettrait de les ranger ailleurs, mais elle est facultative et inutile ici.

Et quatre variables à **ne jamais définir en production** : `RATE_LIMIT_DISABLED`, `CRON_DISABLED`,
`EMAIL_MODE_FICHIER`, `LIEN_MAX_APPAREILS`. Ce sont des béquilles de développement (voir
`.env.example`). **Toutes les quatre** sont neutralisées quand `NODE_ENV=production` (elles passent
par `bequilleDev`, `src/lib/env.ts`), mais autant ne pas les saisir du tout : une variable qu'on croit active est une variable qu'on croira aussi active
le jour où l'on démarrera sans `NODE_ENV=production`.

---

## 3. Publier une version (tag → image)

**Une image est publiée pour chaque version du dépôt** : cette section décrit comment elle se
fabrique — et comment en fabriquer une à soi après une modification du code, ou pour la ranger dans
son propre registre.

L'image est construite par GitHub Actions (`.github/workflows/release.yml`). **Où elle part dépend
des secrets du dépôt** : s'il porte `DOCKERHUB_USERNAME` et `DOCKERHUB_TOKEN`, elle va sur Docker
Hub, dans l'espace de ce compte ; sinon elle va sur `ghcr.io`, dans l'espace du propriétaire du
dépôt, avec le jeton que GitHub fournit tout seul — rien à créer. Sur le poste de développement, une
fois la branche fusionnée dans `main` :

```bash
git checkout main && git pull
npm run lint && npm run typecheck && npm test   # les mêmes contrôles qu'en CI
git tag v0.53.0
git push origin v0.53.0
```

Le workflow enchaîne, dans cet ordre :

1. `npm ci`, `prisma generate`, `npm run lint`, `npm run typecheck`, `npm test` ;
2. la construction de l'image `linux/amd64` à partir du `Dockerfile` ;
3. l'envoi sur `<registre>/<espace>/hema-organizer:0.53.0` **et** sur `:latest` — les deux
   étiquettes à chaque fois, c'est ce qui fait suivre `latest`.

Sur `ghcr.io`, l'authentification se fait avec le `GITHUB_TOKEN` fourni par Actions : aucun secret à
créer. Permissions : `contents: read` au niveau du workflow, `packages: write` sur le seul job de
publication.

On peut aussi lancer la publication à la main : onglet **Actions → Release → Run workflow**, en
saisissant la version (`v0.53.0`).

Avant de passer à la suite, vérifier dans le registre (GitHub → **Packages**, ou la page du dépôt sur
Docker Hub) que la version apparaît, avec la visibilité voulue.

---

## 4. Première installation

À faire une seule fois. Pour une mise à jour, aller directement au § 8.

1. **Préparer les deux dossiers sur le serveur.** Le conteneur tourne en non-root (uid 1000) : il ne
   peut pas se donner le droit d'écrire, il faut le lui donner. Depuis un shell sur le serveur, en
   remplaçant le chemin par celui que vous retiendrez comme `DATA_DIR` :

   ```bash
   sudo mkdir -p /srv/organizer/data /srv/organizer/backups
   sudo chown -R 1000:1000 /srv/organizer
   sudo chmod -R 750 /srv/organizer
   ```

   **Le `chmod` n'est pas facultatif.** Sans lui, l'umask usuel laisse ces
   dossiers en `0755`, c'est-à-dire **lisibles par tout le monde sur le serveur** — et comme ils sont
   montés en *bind mount*, le `chmod 0750` du `Dockerfile` est sans effet : c'est le mode de l'hôte
   qui gagne. Or `backups/` reçoit chaque nuit une copie complète de la base : noms, adresses,
   empreintes de mots de passe, secret de double authentification chiffré, jetons hachés, webhook
   Discord et jeton Telegram chiffrés. Tout compte local du serveur, tout autre conteneur montant ce
   chemin et toute synchronisation vers le NAS la liraient.

2. **Déclarer le registre dans Portainer — seulement si votre image est privée.** Une image
   **publique** se télécharge sans identifiants : passez directement à l'étape 3. Pour le savoir,
   regardez sa visibilité là où elle est publiée (GitHub → *Packages*, ou la page du dépôt sur
   Docker Hub).
   **Sur Docker Hub** : Portainer → **Registries → Add registry → DockerHub**, votre compte et un
   jeton d'accès (*Account settings → Personal access tokens*).
   **Sur `ghcr.io`** : créer d'abord un **jeton d'accès personnel GitHub** (classic) avec la seule
   portée **`read:packages`** : GitHub → *Settings → Developer settings → Personal access tokens →
   Tokens (classic) → Generate new token (classic)*. Le noter, il ne sera plus affiché.
   Puis, dans Portainer : **Registries → Add registry → Custom registry**, avec *Name* `ghcr.io`,
   *Registry URL* `ghcr.io`, *Authentication* activé, *Username* votre identifiant GitHub,
   *Password* le jeton. **Add registry**.

3. **Repérer le nom exact du réseau de NPM** : **Networks** dans Portainer, ou `docker network ls`
   sur le serveur. C'est souvent `npm_default` ; s'il diffère, ce sera la valeur de `NPM_NETWORK`.

4. **Créer la stack** : **Stacks → Add stack**, nom `hema-organizer`, méthode **Web editor**, puis
   coller **exactement** le contenu de [`docs/portainer-stack.yml`](portainer-stack.yml). Ne rien
   modifier dans ce texte : tout ce qui doit varier passe par les variables.

5. **Renseigner les variables** du § 2 dans **Environment variables**, en n'oubliant pas `DATA_DIR`
   si votre chemin diffère de celui inscrit par défaut dans le fichier.

6. **Deploy the stack**, puis ouvrir **Containers** : `hema-organizer` doit passer *running* puis
   *healthy* en une quarantaine de secondes au plus.

7. **Lire les journaux du conteneur** (§ 11). On doit y trouver, dans cet ordre :

   ```
   [hema] HEMA Organizer — démarrage (fuseau Europe/Paris).
   [hema] Application des migrations de la base…
   [hema] Base à jour.
   [hema] Vérification du compte d'administration…
   [seed] compte d'administration contact@… créé (mot de passe provisoire : à changer à la première connexion).
   [hema] Lancement du serveur sur 0.0.0.0:3000.
   ✓ Ready in …
   [taches] planification démarrée (sauvegarde à 03:30, entretien quotidien à 07:00, envois du soir à l'heure réglée — Europe/Paris)
   ```

8. **Créer le proxy host dans NPM** (§ 5), puis ouvrir l'application dans un navigateur.

9. **Faire l'envoi de test SMTP** : **Espace admin → Notifications → Email**, bouton
   **« M'envoyer un email de test »**. C'est la seule façon de savoir que les liens personnels
   partiront : une configuration SMTP fausse ne se voit nulle part ailleurs. Le verdict et le
   message exact du serveur s'affichent dans la carte « Derniers emails envoyés » du même écran.

---

## 5. Le proxy host dans Nginx Proxy Manager

**Hosts → Proxy Hosts → Add Proxy Host.**

Onglet **Details** :

- *Domain Names* : `organizer.mon-club.fr`
- *Scheme* : `http` — l'application ne fait pas de TLS, c'est NPM qui s'en charge
- *Forward Hostname / IP* : `hema-organizer` — le nom du conteneur, les deux partageant le réseau
- *Forward Port* : `3000`
- *Block Common Exploits* : activé
- *Websockets Support* : activé

Onglet **SSL** :

- *SSL Certificate* : **Request a new SSL Certificate** (Let's Encrypt)
- *Force SSL*, *HTTP/2 Support*, *HSTS Enabled* : activés
- accepter les conditions et renseigner une adresse email

Le DNS de `organizer.mon-club.fr` doit déjà pointer sur le serveur **avant** de demander le
certificat, sinon la validation échoue.

### Éteindre le journal d'accès sur `/invitation/` — à ne pas oublier

> **Avant de coller quoi que ce soit ici, sachez comment ressortir.** L'interface de NPM écrit le
> fichier **puis** recharge nginx, et une directive invalide
> fait échouer le chargement de la configuration **entière** : tous les sites du proxy tombent, son
> interface comprise, puisqu'elle est servie par le même nginx. Donc, à chaque *Save* :
>
> ```bash
> docker exec <npm> nginx -t      # avant de refermer la fenêtre
> docker logs <npm> --tail 30     # la ligne d'erreur, si le test échoue
> ```
>
> Et la sortie de secours : vider le champ *Custom Nginx Configuration*, sauvegarder ; si l'interface
> ne répond plus, `docker restart <npm>`, puis retirer le bloc à la main dans
> `/data/nginx/proxy_host/<id>.conf` du volume de NPM.

Onglet **Advanced**, à coller tel quel :

```nginx
# Le chemin d'un lien personnel ne s'écrit nulle part. « /invitation/<jeton> » porte le jeton
# en clair dans l'URL, et ce jeton VAUT un mot de passe : quatre mois de validité, connexion
# directe, aucun second facteur. Le journal d'accès par défaut de NPM l'écrirait à chaque
# ouverture, en clair, sur un disque sauvegardé et lisible par qui administre le proxy —
# exactement ce que l'application s'interdit partout ailleurs (elle ne recopie jamais un jeton
# dans une erreur ni dans son journal).
location ~ ^/(invitation|reinitialiser|annuler|desinscription)/ {
  access_log off;
  resolver 127.0.0.11 valid=10s;
  set $hema hema-organizer;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $remote_addr;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_pass http://$hema:3000$request_uri;
}
```

**Les lignes `resolver`, `set $hema` et `proxy_pass` vont ensemble : elles résolvent le nom du
conteneur à chaque requête.** Le conteneur change d'adresse à chaque mise à jour ; un nom résolu une
seule fois, au chargement de la configuration, viserait l'ancienne adresse (502 sur ces seuls
chemins), et ferait refuser à nginx sa configuration entière si le conteneur est momentanément absent
(`[emerg] host not found in upstream` : tous les sites du proxy tombent). `resolver 127.0.0.11` est
le DNS interne de Docker, la **variable** `$hema` force la résolution à l'exécution, et `$request_uri`
est obligatoire — dès qu'un `proxy_pass` contient une variable, nginx ne transmet plus le chemin tout
seul, et l'oublier enverrait toutes ces URL sur `/`. Un conteneur absent donne un 502 le temps qu'il
revienne, ce qui est le comportement voulu. C'est la même mécanique que le `location /` qu'engendre
NPM.

**Les quatre `proxy_set_header` ne sont pas décoratifs, et ils ne s'empruntent pas.** Le contenu de cet
onglet entre dans le `server {}` **à côté** de la `location /` qu'engendre NPM : il n'hérite d'aucun de
ses réglages. Les omettre fait perdre `X-Forwarded-For`
sur ces quatre chemins : `clientIp()` ne voit plus que l'adresse du proxy, donc **un seul seau de
limitation pour tout Internet** sur l'ouverture des liens personnels, et un journal d'audit qui note la
même adresse pour tout le monde. Et ne les remplacez pas par un `include conf.d/include/proxy.conf;`
— le fichier que NPM utilise pour ses propres `location` : son chemin ne vaut pas dans toutes les
versions, et un `include` introuvable est exactement la directive invalide qui couche le serveur.

**Les quatre familles, et pas seulement l'invitation** : `/reinitialiser/<jeton>` est une reprise de
compte entière, `/annuler/<jeton>` annule un cours et écrit à tout le club,
`/desinscription/<jeton>` vaut un an. Elles portent toutes un jeton dans leur URL.

Le **référent**, lui, ne se règle pas ici : l'application envoie `Referrer-Policy: no-referrer` sur
toute réponse, si bien que les sous-ressources d'une page `/invitation/<jeton>` ne transmettent pas
le jeton à `location /`, qui journalise le référent.

Le `proxy_pass` est à répéter ici : déclarer une `location` remplace le comportement par défaut de
NPM pour ce chemin, il faut donc lui redire où envoyer la requête — **et la cible se recopie de
l'onglet *Details*, telle quelle**. `http://hema-organizer:3000` ne vaut que si le conteneur NPM est sur
le même réseau Docker que l'application ; une installation qui vise une adresse IP et un port publié se
recopie à l'identique, sans quoi ces quatre chemins — et eux seuls — répondent 502 pendant que le reste
du site marche. (Et si c'est le cas, lire le § 1.2 : un port publié a un coût plus grave que ce 502.)

Si vous préférez garder une trace de ces ouvertures plutôt que de couper le journal, n'utilisez que
le **format masqué** décrit dans [`docs/SECURITE.md`](SECURITE.md), qui écrit l'adresse, la date, la
méthode et le statut, mais **pas le chemin**. Ne journalisez jamais `$request` ni `$uri` sur cette
`location` : les deux contiennent le jeton.

Le reste du durcissement — limitation de débit `limit_req` sur `/invitation/` et `/connexion`,
fail2ban sur les 429, et **rotation quotidienne avec sept jours de rétention** sur les journaux du
proxy — est décrit dans `docs/SECURITE.md`. Cette rétention courte compte : un jeton vaut quatre
mois, donc un journal d'accès gardé un an conserverait des mots de passe encore valides.

---

## 6. Première connexion

1. Ouvrir `https://organizer.mon-club.fr/connexion`.
2. Saisir `ADMIN_EMAIL` et le mot de passe **provisoire** `ADMIN_PASSWORD`.
3. L'application impose alors le parcours complet : un vrai mot de passe, la configuration de la
   double authentification (QR code à scanner dans une application d'authentification), puis la
   notation des **codes de secours**. Ces codes sont montrés une seule fois : les écrire.
4. Une fois ce parcours terminé, `ADMIN_PASSWORD` n'a plus aucun effet. On peut laisser la variable
   en place, elle ne sert plus à rien.

Rappel utile : c'est le **seul** compte pour lequel un mot de passe est obligatoire. Membres et
instructeurs entrent par leur **lien personnel**, envoyé par email ; ils peuvent se donner un mot de
passe s'ils le veulent, mais rien ne les y oblige.

---

## 7. Avant une mise à jour : les quatre points à vérifier

Quatre points valent pour **toute** mise à jour. Les notes de version du dépôt disent, pour chacune,
ce qu'elle apporte ; cette section dit ce qu'il faut regarder avant de lancer.

**1. Les migrations s'appliquent au démarrage, et ne s'annulent pas.** Le nouveau conteneur lance
`prisma migrate deploy` avant de servir la première requête : il n'y a aucune commande à taper. Mais
une migration qui **réécrit des lignes existantes** — un libellé renuméroté, un rang recalculé — ne
se défait pas en remettant l'ancienne image (§ 9). **Faites la sauvegarde du § 8, étape 1**, à chaque
fois : c'est le seul retour possible.

**2. Choisissez l'heure.** Les envois du soir — récapitulatif de la veille, rappels — partent à
l'heure réglée dans *Espace admin → Notifications* (18:00 par défaut), puis **repassent toutes les
15 minutes pendant 90 minutes** pour rattraper une panne passagère. Déployer dans cette fenêtre d'une
heure et demie fait redémarrer le minuteur sur un état partiel, avec le risque de renvoyer à tout le
club un récapitulatif déjà parti — email, téléphone, Discord, Telegram, et sans moyen de le
rattraper. **Déployez en dehors de cette fenêtre.**

**3. Le fichier de stack peut avoir changé.** Il vit dans le dépôt
([`docs/portainer-stack.yml`](portainer-stack.yml)) et suit les versions. Avant une mise à jour,
comparez-le à ce que porte le *Web editor* de Portainer ; s'il diffère, recollez-le **tel quel** et
redéployez. Tout ce qui doit varier d'une installation à l'autre passe par les variables du § 2, donc
un recollage n'écrase jamais vos réglages.

**4. Vérifiez les données une fois la version en ligne.** L'outil de réparation (§ 12) relève les
incohérences de la base et les corrige, **et il ne touche à rien tant qu'on ne lui donne pas
`--reparer`** :

```bash
docker exec hema-organizer node reparer.cjs      # vérification seule, aucune écriture
```

Lisez ce qu'il signale, puis relancez avec `--reparer` seulement s'il signale quelque chose — il
prend alors une sauvegarde avant d'écrire.

---

## 8. Mettre à jour une version

1. **Sauvegarder.** La copie de la nuit est là (`<DATA_DIR>/backups`), mais une mise à jour qui
   contient des migrations mérite une copie fraîche : c'est le seul retour possible si le schéma a
   changé (§ 9). Le plus simple, sur le serveur :

   ```bash
   sudo cp <DATA_DIR>/backups/hema-2026-09-30.db /ailleurs/avant-0.53.0.db
   ```

   ou, pour une copie à l'instant même plutôt que celle de 03:30, passer par le § 12 dont l'étape de
   réparation sauvegarde d'office.

2. **Publier la version** (§ 3) et attendre la fin du workflow GitHub Actions.
3. **Relire le § 7** si la version apporte des migrations ou change un comportement, et choisir
   l'heure en conséquence.
4. Dans Portainer : **Stacks → hema-organizer → Editor**.
5. **Ne toucher à aucune variable.** L'image est suivie en `latest` et retéléchargée à chaque
   déploiement : c'est le déploiement lui-même qui prend la nouvelle version. (Si `APP_TAG` est
   épinglé après un retour en arrière, § 9, c'est ici qu'on le retire pour repartir vers l'avant.)
6. Cocher **Re-pull image**, puis **Update the stack**. Sans cette case, Portainer peut réutiliser
   une image déjà en cache et vous croirez avoir mis à jour sans l'avoir fait.
7. **Surveiller les journaux** (§ 11) : les migrations s'appliquent au démarrage et se racontent
   ligne à ligne. Attendre `✓ Ready in …` et l'état *healthy*.
8. **Rien à recharger côté proxy** : le bloc du § 5 (`resolver` + variable `$hema`) résout le nom du
   conteneur à chaque requête et suit sa nouvelle adresse. Symptôme d'un bloc qui ne le fait pas : le
   site marche, et **seuls `/invitation/`, `/reinitialiser/`, `/annuler/` et `/desinscription/`
   répondent 502** — exactement les chemins qu'on ne teste pas en ouvrant l'application.
9. Ouvrir l'application et vérifier un écran ou deux — la liste des séances, le planning. **Et ouvrir
   un lien personnel**, qui passe par le bloc du § 5.

L'interruption dure quelques secondes. Les données ne sont pas touchées par le remplacement de
l'image : elles vivent dans les dossiers de l'hôte, que le nouveau conteneur remonte tels quels.

---

## 9. Revenir en arrière

1. Portainer → **Stacks → hema-organizer → Editor**.
2. **Saisir `APP_TAG`** avec la version précédente (par exemple `0.52.0`) — c'est son seul usage :
   épingler. Tant qu'elle est là, les déploiements suivants restent sur cette version.
3. Cocher **Re-pull image**, puis **Update the stack**.

**Ce qu'il faut savoir avant de le faire :** une migration déjà appliquée **n'est pas annulée** par
le retour à l'image précédente. Si la version qu'on abandonne a modifié le schéma de la base,
l'application précédente se retrouve devant une base qu'elle ne comprend pas
tout à fait, et le retour en arrière doit s'accompagner d'une **restauration de la sauvegarde prise
juste avant la mise à jour** (§ 10). Les réponses et les modifications saisies entre-temps sont alors
perdues.

C'est toute la raison de l'étape 1 du § 8 : sans cette copie, le retour en arrière n'existe pas.

---

## 10. Sauvegarde et restauration

### Ce qui se fait tout seul

Chaque nuit à **03:30** (fuseau `TZ`), l'application écrit une copie cohérente de la base dans
`<DATA_DIR>/backups` sous le nom `hema-AAAA-MM-JJ.db`, et supprime les copies de plus de **30 jours**.
La copie est faite par SQLite (`VACUUM INTO`) : l'application continue de tourner pendant ce temps, et
le fichier obtenu est une base complète — les fichiers annexes `-wal` et `-shm` n'ont pas à être
copiés.

Pour vérifier, sans rien installer : **Espace admin → À propos** affiche le dossier des sauvegardes,
le nombre de fichiers, leur poids total et la date de la dernière. C'est la réponse à « est-ce que les
sauvegardes tournent ? », et elle ne demande pas d'ouvrir un shell.

> **Ce qui n'est pas dans ces copies : les affiches des événements.** Elles vivent dans
> `<DATA_DIR>/data/affiches`, et la copie de la nuit ne porte que la base. Restaurer la base ne les
> touche donc pas — elles sont toujours là, et les annonces retrouvent leur image. En revanche, si
> le dossier `data/` est perdu (serveur réinstallé, dossier effacé), la base revient des
> sauvegardes mais les affiches ne reviennent de nulle part : les annonces s'affichent alors avec le
> logo du club. Notez aussi qu'un ménage quotidien efface les affiches qu'aucune annonce n'utilise
> depuis plus de 24 h : après la restauration d'une base **ancienne**, une image téléversée depuis
> cette sauvegarde peut avoir disparu — il suffit de la redéposer dans le formulaire.

### Emporter une copie hors du serveur

C'est **le** geste qui protège vraiment : les fichiers de sauvegarde sont sur le même disque que la
base, et disparaîtraient avec lui. Depuis votre poste :

```bash
scp <serveur>:<DATA_DIR>/backups/hema-2026-09-30.db .
scp -r <serveur>:<DATA_DIR>/data/affiches ./affiches
```

À faire régulièrement — une fois par mois, au moment du déploiement, est un rythme raisonnable.

### Restaurer

1. Portainer → **Stacks → hema-organizer → Stop**. Ne pas supprimer la stack : on veut juste que plus
   rien n'écrive dans la base.
2. Depuis un shell sur le serveur, mettre la base actuelle de côté et installer la sauvegarde à sa
   place :

   ```bash
   sudo mv <DATA_DIR>/data/hema.db <DATA_DIR>/data/hema.db.avant-restauration
   sudo rm -f <DATA_DIR>/data/hema.db-wal <DATA_DIR>/data/hema.db-shm
   sudo cp <DATA_DIR>/backups/hema-2026-09-30.db <DATA_DIR>/data/hema.db
   sudo chown 1000:1000 <DATA_DIR>/data/hema.db
   ```

   Les deux fichiers `-wal` et `-shm` sont le journal de travail de SQLite : laissés là, ils
   contrediraient la base qu'on vient d'installer. Le `chown 1000:1000` rend le fichier au
   propriétaire attendu par le conteneur, qui tourne en non-root.

3. Si les affiches sont perdues, les remettre à ce moment-là, **avant** de redémarrer, depuis la
   copie prise plus haut :

   ```bash
   sudo mkdir -p <DATA_DIR>/data/affiches
   sudo cp -rn ./affiches/. <DATA_DIR>/data/affiches/
   sudo chown -R 1000:1000 <DATA_DIR>/data/affiches
   ```

   (Rien à faire si le dossier `data/` est intact : les affiches n'ont pas bougé.)

4. Portainer → **Start**. Les migrations qui manqueraient à cette base plus ancienne se
   réappliqueront au démarrage, toutes seules.
5. Vérifier : `https://organizer.mon-club.fr/api/health` doit répondre `{"ok":true}`, puis ouvrir
   l'application et regarder que le contenu est bien celui attendu.
6. Lancer la vérification du § 12 (sans réparer) : c'est le bon moment pour savoir si cette base
   porte des incohérences.

---

## 11. Lire les journaux

**Le journal du conteneur** — c'est celui qui répond à « pourquoi ça ne démarre pas ».

1. Portainer → **Containers → hema-organizer → Logs**.
2. Cocher *Auto-refresh*, et régler *Lines* sur 500 pour voir tout un démarrage.
3. Les lignes de l'application sont préfixées : `[hema]` pour l'entrypoint, `[seed]` pour le compte
   d'administration, `[taches]` pour les tâches planifiées, `[health]` pour la sonde.

Depuis un shell sur le serveur, l'équivalent :

```bash
docker logs --tail 200 -f hema-organizer          # suivre en direct
docker logs --since 30m hema-organizer            # la dernière demi-heure
docker logs hema-organizer 2>&1 | grep -i erreur  # ne garder que les erreurs
```

Ces journaux tournent d'eux-mêmes : trois fichiers de 10 Mo au plus (`json-file`, réglé dans la
stack). Ils ne remplissent donc jamais le disque, mais ils **ne gardent pas l'histoire longue** : ce
qui doit survivre est ailleurs.

**Le journal d'audit de l'application**, lui, garde durablement qui a fait quoi : connexions,
modifications du planning avec l'avant et l'après, envois et révocations de liens, gestes de
double authentification. Il se lit dans **Espace admin → Journal d'audit**, et sa durée de
conservation se règle dans **Espace admin → À propos**. C'est là qu'on va pour « qui a supprimé cette
séance ? », jamais dans les journaux du conteneur.

**Les journaux du proxy** (NPM) sont un cas à part : ils peuvent contenir des jetons d'invitation si
on les laisse journaliser `/invitation/`. Voir le § 5 — le réglage est à faire une fois, et à
revérifier après toute reconstruction du proxy host.

---

## 12. Nettoyer les données (outil de réparation)

L'outil `reparer.cjs`, embarqué dans l'image, relève et corrige les incohérences de données :
réponses de personnes qui ne sont plus invitées sur la période, ateliers rattachés à une séance
disparue, doublons, rangs troués… (la liste complète est au tableau ci-dessous). Il **voyage avec
l'application** parce que les données à soigner sont celles du club, sur le serveur, et qu'on ne
sort pas la seule copie vivante d'une base pour la soigner ailleurs.

Il ne s'exécute **jamais** tout seul : l'entrypoint ne l'appelle pas, et sans `--reparer` il n'écrit
rien du tout.

### Ce qu'il faut regarder avant de le lancer

1. **Que le conteneur soit sain.** État *healthy* dans Portainer. Un outil qui ouvre la base d'une
   application en train de redémarrer n'apprend rien d'utile.
2. **Qu'une sauvegarde récente existe.** **Espace admin → À propos**, carte *Sauvegardes* : la date
   de la dernière doit être celle de la nuit passée. Avec `--reparer`, l'outil fait de toute façon sa
   propre copie avant la moindre écriture, mais une sauvegarde de la veille reste le vrai filet.
3. **Qu'on ne soit pas dans la fenêtre des envois du soir** (§ 7). L'outil ne déclenche aucun envoi,
   mais il touche aux clés qui les retiennent : autant ne pas travailler dessus pendant qu'elles
   servent.
4. **Le nom du conteneur**, qui est `hema-organizer` — c'est ce que vous écrirez après `docker exec`.

### Le geste, en cinq étapes

1. **Vérifier, sans rien écrire.** C'est le comportement par défaut, et on peut le lancer les yeux
   fermés :

   ```bash
   docker exec hema-organizer node reparer.cjs
   ```

2. **Lire le rapport.** Il compte neuf sections, dans cet ordre :

   | Section | Ce qu'elle cherche | Ce que la réparation ferait |
   |---|---|---|
   | `fantomes` | une réponse de présence laissée par quelqu'un qui n'est plus invité sur la période | la ligne est supprimée (c'est la cause des taux du genre « 12 présents sur 11 ») |
   | `ateliers` | une proposition marquée « au planning » rattachée à une séance disparue | elle repasse « en attente » et se détache ; elle n'est jamais supprimée, c'est l'écrit d'un membre |
   | `notifications` | une même notification journalisée deux fois le même jour | la ligne en trop est supprimée |
   | `liens` | plusieurs liens personnels vivants pour la même personne sur la même période | les plus anciens sont révoqués |
   | `parties` | une case de planning réservée à un atelier qui n'y est plus | la case est détachée et redevient modifiable |
   | `rangs` | un rang troué, ou un nom de partie qui ne dit plus son rang (« deux Cours 2, aucun Cours 1 ») | le rang et le nom sont remis d'accord. C'est ce rang qui décide de l'ordre du programme partout, et ce nom qui part tel quel dans les emails et sur le site du club |
   | `creneaux` | une clé d'envoi qui ne porte pas l'empreinte du créneau de sa séance | la clé est **renommée**, jamais supprimée : l'effacer ferait repartir l'envoi qu'elle retenait |
   | `vides` | une partie **vide en trop** : au-delà des deux cours qu'une séance porte toujours | la partie est supprimée et les suivantes sont rangées derrière elle. Les **deux premiers cours sont protégés même vides**, et une partie qui porte quoi que ce soit — un instructeur, un thème, une description, un niveau, un atelier retenu — n'est jamais touchée |
   | (9) parents disparus | les lignes dont la référence pointe dans le vide | **jamais réparé** : simple relevé. Une base saine n'en a aucune ; s'il en sort, gardez la sauvegarde et demandez de l'aide avant de toucher à quoi que ce soit |

   Le rapport nomme au plus un prénom, jamais une adresse, et abrège les listes au-delà de quinze
   lignes. Le bilan final dit combien de lignes sont à corriger — ou que la base est saine.

3. **Réparer**, si et seulement si le rapport annonce des lignes à corriger :

   ```bash
   docker exec hema-organizer node reparer.cjs --reparer
   ```

   Ce qui se passe alors, dans l'ordre : une sauvegarde de la base part **avant** la moindre
   écriture (elle s'ajoute à celle du jour sous le nom `avant-reparation-<horodatage>.db`, dans le
   dossier des sauvegardes) ; puis les corrections s'appliquent **en une seule transaction** ; puis
   chaque ligne touchée est affichée et une entrée est écrite au journal d'audit. Rien n'est supprimé
   en silence.

4. **Relancer la vérification** pour confirmer qu'il ne reste rien :

   ```bash
   docker exec hema-organizer node reparer.cjs
   ```

   L'outil est rejouable : sur une base saine, il ne fait rien et le dit.

5. **Ranger.** Les fichiers `avant-reparation-*.db` ne sont pas concernés par la purge des 30 jours —
   c'est voulu, on ne veut pas qu'un filet disparaisse tout seul — mais ils s'accumulent. Les
   emporter hors du serveur et les effacer quand la version est jugée stable.

### Les trois options utiles

```bash
docker exec hema-organizer node reparer.cjs --aide                 # la liste des options
docker exec hema-organizer node reparer.cjs --seulement=creneaux   # n'examiner qu'un contrôle
docker exec hema-organizer node reparer.cjs --tout                 # ne pas abréger les listes de détail
```

`--seulement=` accepte plusieurs noms séparés par des virgules, et se combine avec `--reparer`.
Écrire `--verifier` est accepté : c'est le
comportement par défaut, mais l'intention peut s'écrire.

---

## 13. En cas de problème

| Symptôme | Piste |
|---|---|
| Le conteneur redémarre en boucle | Lire les journaux (§ 11). `SESSION_SECRET` absent ou de moins de 32 caractères, ou `DATABASE_URL` mal formé, arrêtent volontairement le démarrage en le disant |
| `denied` / `unauthorized` au téléchargement de l'image | L'image est privée et le registre est mal déclaré dans Portainer, ou son jeton est expiré (sur `ghcr.io`, il lui faut la portée `read:packages`). Une image **publique** ne demande aucun identifiant : vérifiez d'abord sa visibilité |
| `toomanyrequests` au téléchargement de l'image | Quota de téléchargements anonymes de Docker Hub, par adresse IP et par heure. Attendre, ou déclarer un compte Docker Hub gratuit dans Portainer (**Registries → Add registry → DockerHub**) |
| `permission denied` sur `/data` au démarrage | Les dossiers de l'hôte n'appartiennent pas à l'uid 1000 : `sudo chown -R 1000:1000 <DATA_DIR>` |
| Le conteneur reste *unhealthy* | Depuis la console du conteneur, `wget -qO- http://127.0.0.1:3000/api/health`. Une réponse `{"ok":false,"erreur":"base"}` pointe les droits ou le montage du dossier `data/` ; `{"ok":false,"erreur":"configuration"}` dit qu'une **variable de la stack** est refusée — le détail, lui, n'est que dans les journaux du conteneur (`docker logs`), la sonde ne nomme jamais une variable ni une valeur. Les deux suspects habituels : `DOMAIN` (un domaine local est refusé en production) et `SESSION_SECRET` (trop court) |
| NPM répond 502 | Le conteneur n'est pas sur le réseau de NPM : vérifier `NPM_NETWORK` et que le *Forward Hostname* est bien `hema-organizer` |
| Aucun email ne part | Vérifier `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, puis **Espace admin → Notifications → Email**, bouton **« M'envoyer un email de test »**. Le message exact du serveur s'affiche dans « Derniers emails envoyés » : c'est là qu'on tranche un « il n'a rien reçu » |
| Le serveur SMTP répond `501 5.1.7 Bad sender address syntax` | `SMTP_FROM` a été saisi **avec** des guillemets dans Portainer : les retirer |
| Les liens des emails pointent sur `localhost` | `DOMAIN` mal renseigné (sans `https://`, sans barre oblique finale) |
| Personne ne peut plus se connecter après une mise à jour | `SESSION_SECRET` a changé : remettre l'ancienne valeur |
| Le dossier des sauvegardes reste vide | Le montage n'est pas le bon, ou `CRON_DISABLED` a été défini par erreur. **Espace admin → À propos** affiche le dossier réellement utilisé |
| Des taux de présence au-dessus de 100 % | Des réponses fantômes : lancer la vérification du § 12 |
| La page « prochains cours » du site est vide | L'API publique est fermée : c'est l'état par défaut (§ 14) |

### Tester l'image en local avant de publier

Le `docker-compose.yml` de la racine reproduit les contraintes de la production — utilisateur
non-root, `cap_drop: ALL`, `no-new-privileges`, `/tmp` en tmpfs, deux montages `/data` et
`/backups` — pour vérifier une image avant de la publier :

```bash
docker compose up --build                            # http://organizer.localhost:3000
curl -s http://organizer.localhost:3000/api/health   # {"ok":true}
docker compose down -v                               # arrêt + suppression des volumes de test
```

Deux variables, et il faut les bouger **ensemble** : `HEMA_PORT` change le port publié, `HEMA_DOMAIN`
l'adresse que l'application se connaît (elle sert à composer les liens des emails et à décider si le
cookie de session est `Secure`). Un port déplacé sans son domaine donne une application qui répond
mais dont tous les liens pointent ailleurs :

```bash
HEMA_PORT=3100 HEMA_DOMAIN=http://organizer.localhost:3100 docker compose up --build
```

Le domaine par défaut n'est pas `localhost` : l'application **refuse** de démarrer en production sur
un domaine local nu, exprès (un domaine local en production est presque toujours une erreur de
déploiement). `organizer.localhost` résout vers la boucle locale et passe cette garde. Si `*.localhost`
ne résout pas sur ton poste, mets l'adresse de la machine : `HEMA_DOMAIN=http://192.168.1.20:3000`.

---

## 14. Le site public (prochains cours)

Le site du club peut afficher les prochains cours grâce au plugin
`wordpress-plugin/hema-prochains-cours`, qui interroge l'API publique de l'application.

**Cette API est fermée par défaut**, et il faut l'ouvrir explicitement — c'est le seul réglage de
cette section. Ce qu'elle publie, une fois ouverte : les
dates, les horaires, **le lieu avec l'adresse de la salle**, les thèmes, les motifs d'annulation et
les taux de participation, en lecture seule et sans aucun nom de personne. Rien de nominatif n'en
sort, mais l'adresse d'un gymnase et les horaires d'un club sont déjà des informations qu'on ne donne
pas sans le vouloir. **N'ouvrez cette porte que si le site affiche réellement les cours.**

1. **Côté application** : cocher « API publique activée » dans **Espace admin → Notifications**, et
   renseigner la variable `PUBLIC_API_ORIGIN` de la stack avec l'adresse du site du club — c'est la
   seule origine qu'un navigateur sera autorisé à utiliser pour lire l'API. L'adresse exacte à
   reporter dans le plugin est affichée dans **Espace admin → À propos**.
2. **Vérifier la réponse**, depuis n'importe quel poste :

   ```bash
   curl "https://organizer.mon-club.fr/api/public/prochaines-seances?limit=3"
   ```

   - `503` avec `{"erreur":"API publique désactivée"}` → la case n'est pas cochée ;
   - `429` → limiteur de débit (60 appels par minute et par adresse) : attendre une minute.
3. **Côté site** : installer le plugin (zip du dossier → *Extensions → Téléverser*), puis renseigner
   **Réglages → Prochains cours** : adresse de l'API, adresse de l'application, nombre de cours
   affichés. Le shortcode `[hema_prochains_cours]` se place dans une page, un article ou un widget
   « Shortcode » d'Elementor.

La réponse est mise en cache 5 minutes côté application et 15 minutes côté site : un changement de
planning met au plus un quart d'heure à paraître.

---

## 15. Notifications sur téléphone

En plus de l'email, de Discord et de Telegram, l'application peut prévenir les membres
**directement sur leur téléphone** (Web Push) : rappel de cours, annulation, réponse à une
proposition d'atelier — même l'application fermée.

### Rien à installer, rien à saisir

**Il n'y a aucune variable à ajouter dans la stack.** Ne cherchez pas de `VAPID_*` : les clés d'envoi
sont **engendrées automatiquement au premier besoin** et rangées **chiffrées dans la base**, comme le
webhook Discord. Trois conséquences utiles :

- rien à générer ni à coller à la main ;
- la paire **survit aux mises à jour de l'image**, puisqu'elle vit dans le dossier des données ;
- il ne faut surtout pas la remplacer : changer ces clés **invaliderait tous les abonnements
  existants**, et chaque membre devrait réactiver ses appareils un par un.

C'est aussi pourquoi **Espace admin → Notifications → Téléphone** ne demande aucun réglage : elle se
contente d'afficher l'état du canal et le nombre d'appareils qui recevraient un envoi.

### HTTPS est indispensable

Les navigateurs **refusent purement et simplement** d'abonner un appareil sur une page qui n'est pas
servie en HTTPS. Ce n'est pas un réglage de l'application : c'est une règle du navigateur, et elle ne
se contourne pas.

- En production, **Nginx Proxy Manager s'en charge** (§ 5 : certificat Let's Encrypt, *Force SSL*).
  Rien de plus à faire dès lors que l'application s'ouvre bien en `https://`.
- **Le push ne fonctionne pas si l'application est ouverte en clair sur une adresse locale.** Le
  bouton d'activation n'apparaît même pas. Si l'on teste depuis le réseau du club, il faut passer par
  le domaine et le proxy, pas par l'adresse du conteneur.
- Seule exception, pour le développement : `http://localhost:3000`, que les navigateurs traitent
  comme une origine sûre.

### Sur iPhone, installer l'application d'abord

Sur iPhone et iPad, les notifications n'existent **que si l'application a été ajoutée à l'écran
d'accueil** (iOS 16.4 et plus) : *Partager* en bas de Safari → *« Sur l'écran d'accueil »*, puis
rouvrir depuis l'icône ajoutée. Tant que ce n'est pas fait, le navigateur ne propose rien du tout —
l'écran « Mon profil » détecte le cas et affiche la marche à suivre plutôt qu'un bouton qui
échouerait en silence.

### Vérifier après un déploiement

1. Ouvrir `https://organizer.mon-club.fr/profil`, carte **« Notifications sur cet appareil »** →
   **Activer sur cet appareil**, puis **Envoyer un essai**.
2. Si l'essai arrive, toute la chaîne fonctionne : les clés, le service worker, le service de push.
3. Le compte des appareils abonnés se lit dans **Espace admin → Notifications → Téléphone**.

| Symptôme | Piste |
|---|---|
| Aucun bouton d'activation, sur iPhone | L'application n'a pas été ajoutée à l'écran d'accueil |
| Aucun bouton d'activation, ailleurs | Page ouverte en `http://` : passer par le domaine en HTTPS |
| « Les notifications sont bloquées » | Autorisation refusée au navigateur : la rouvrir dans les réglages du site (cadenas à côté de l'adresse) |
| Un appareil disparaît de la liste | Normal : un abonnement refusé définitivement par le service de push est effacé au premier envoi. Il suffit de le réactiver |
| Rien ne part alors que des appareils sont abonnés | Vérifier la matrice **Espace admin → Notifications** (colonne Téléphone) et les cases de « Mon profil » |
