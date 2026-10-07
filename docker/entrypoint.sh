#!/bin/sh
# Démarrage du conteneur Organizer :
#   1. vérification de la configuration minimale
#   2. `prisma migrate deploy` (création / mise à jour du schéma SQLite)
#   3. seed du compte d'administration (ADMIN_EMAIL / ADMIN_PASSWORD) — créé s'il n'existe pas,
#      jamais modifié s'il existe
#   4. lancement du serveur Next.js (sortie standalone)
# Tout échec sur la base est fatal : le conteneur s'arrête avec un message explicite.
set -eu

APP_DIR=/app
PRISMA="${APP_DIR}/prisma-cli/node_modules/prisma/build/index.js"
SCHEMA="${APP_DIR}/prisma/schema.prisma"

log()    { echo "[hema] $*"; }
erreur() { echo "[hema] ERREUR : $*" >&2; }

# Le nom du club est une **donnée** depuis la v0.51 : l'entrypoint, lui, tourne avant toute
# lecture de la base et ne peut pas la connaître. Il dit donc le nom de l'outil, pas celui du club.
log "Organizer — démarrage (fuseau ${TZ:-non défini})."

# ---------------------------------------------------------------------------
# 1. Configuration minimale
# ---------------------------------------------------------------------------
if [ -z "${DATABASE_URL:-}" ]; then
  erreur "DATABASE_URL n'est pas défini (attendu : file:/data/hema.db)."
  exit 1
fi

if [ -z "${SESSION_SECRET:-}" ] || [ "${#SESSION_SECRET}" -lt 32 ]; then
  erreur "SESSION_SECRET est absent ou fait moins de 32 caractères."
  erreur "Générer un secret : openssl rand -base64 48"
  exit 1
fi

# Dossier de la base : doit exister et être accessible en écriture (volume /data).
DB_FILE=""
case "${DATABASE_URL}" in
  file:*)
    DB_FILE="${DATABASE_URL#file:}"
    DB_DIR="$(dirname "${DB_FILE}")"
    if [ ! -d "${DB_DIR}" ]; then
      erreur "le dossier de la base ${DB_DIR} n'existe pas (volume non monté ?)."
      exit 1
    fi
    if [ ! -w "${DB_DIR}" ]; then
      erreur "le dossier de la base ${DB_DIR} n'est pas accessible en écriture par l'utilisateur $(id -un) (uid $(id -u))."
      erreur "Supprimer le volume et le laisser se recréer, ou corriger son propriétaire."
      exit 1
    fi
    ;;
esac

# Dossier des sauvegardes : avertissement seulement, l'application sait s'en passer.
BACKUP_DIR="${BACKUP_DIR:-/backups}"
if [ ! -w "${BACKUP_DIR}" ]; then
  echo "[hema] Attention : ${BACKUP_DIR} n'est pas accessible en écriture, les sauvegardes quotidiennes échoueront." >&2
fi

# ---------------------------------------------------------------------------
# 2. Migrations
# ---------------------------------------------------------------------------
# ── Sauvegarde avant migration ────────────────────────────────────────────────────────────────
# Depuis que la stack se redéploie toute seule après chaque publication (job « Déploiement » du flux
# Release), plus personne ne sauvegarde /data à la main avant de basculer — et une migration peut
# réécrire ou supprimer une colonne qu'un retour à l'image précédente ne remettrait pas. Le conteneur
# le fait donc lui-même, **seulement s'il y a des migrations en attente** (`migrate status` rend 1) :
# une copie cohérente par `VACUUM INTO`, comme les sauvegardes quotidiennes, nommée comme celle qui
# précède une réparation (`avant-reparation-…`). Si elle échoue, on **refuse de migrer** : mieux vaut
# un conteneur arrêté — on revient à l'image d'avant par `APP_TAG`, sur une base intacte — qu'une
# migration sans filet. Base absente (première installation) : rien à sauvegarder.
if [ -n "${DB_FILE}" ] && [ -s "${DB_FILE}" ]; then
  if ! node "${PRISMA}" migrate status --schema "${SCHEMA}" >/dev/null 2>&1; then
    CIBLE="${BACKUP_DIR}/avant-migration-$(date +%Y-%m-%d-%H%M%S).db"
    log "Des migrations sont en attente : sauvegarde de la base avant de les appliquer (${CIBLE})…"
    if ! echo "VACUUM INTO '${CIBLE}';" | node "${PRISMA}" db execute --stdin --schema "${SCHEMA}" >/dev/null; then
      erreur "la sauvegarde d'avant migration a échoué : les migrations ne sont PAS appliquées."
      erreur "Vérifier que ${BACKUP_DIR} est monté et accessible en écriture, puis relancer le conteneur."
      exit 1
    fi
    chmod 0600 "${CIBLE}" 2>/dev/null || true
    log "Sauvegarde écrite."
  fi
fi

log "Application des migrations de la base…"
if ! node "${PRISMA}" migrate deploy --schema "${SCHEMA}"; then
  erreur "impossible d'appliquer les migrations : base inaccessible ou incohérente."
  erreur "Vérifier le volume /data et la variable DATABASE_URL, puis relancer le conteneur."
  exit 1
fi
log "Base à jour."

# ---------------------------------------------------------------------------
# 3. Compte d'administration — **idempotent au sens strict** : si un compte existe déjà à l'adresse
#    d'ADMIN_EMAIL, rien n'est écrit (ni rôle, ni activation, ni mot de passe) et le seed le dit.
#    Ce script tourne à CHAQUE démarrage : Update the stack, Re-pull image, reboot du serveur.
# ---------------------------------------------------------------------------
if [ -n "${ADMIN_EMAIL:-}" ] && [ -n "${ADMIN_PASSWORD:-}" ]; then
  log "Vérification du compte d'administration…"
  if ! node "${APP_DIR}/seed.cjs"; then
    erreur "la création du compte d'administration a échoué."
    exit 1
  fi
else
  log "ADMIN_EMAIL / ADMIN_PASSWORD non fournis : aucun compte d'administration créé."
fi

# ---------------------------------------------------------------------------
# 4. Serveur
# ---------------------------------------------------------------------------
log "Lancement du serveur sur ${HOSTNAME:-0.0.0.0}:${PORT:-3000}."
cd "${APP_DIR}"
exec "$@"
