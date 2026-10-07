#!/usr/bin/env bash
#
# **Redéployer la stack dans Portainer et attendre qu'elle soit saine** — appelé par le job
# « Déploiement sur Portainer » du flux Release, et par le flux « Test du déploiement ».
#
#     scripts/deployer-portainer.sh [version attendue, ex. 0.72.3]
#
# L'équivalent de « Update the stack » + « Re-pull image » : le fichier et les variables de la stack
# sont relus tels que Portainer les garde, puis renvoyés à l'identique avec `pullImage`. On attend
# ensuite que le conteneur ait **redémarré après l'appel**, qu'il soit *healthy* et, si une version est
# donnée, qu'il la porte (étiquette `org.opencontainers.image.version` de l'image).
#
# **Une image inchangée ne redémarre rien** : Docker garde le conteneur quand l'image retéléchargée est
# identique (même empreinte) — c'est le cas du « Test du déploiement » entre deux versions. On compare
# donc l'image du conteneur avant et après l'appel : identique, un conteneur sain suffit ; différente,
# on attend qu'il ait redémarré après l'appel.
#
# **La stack se retrouve par son nom** (STACK_NAME) quand il est donné : supprimer la stack puis la
# recréer depuis le modèle personnalisé lui donne un nouveau numéro, et un numéro figé dans GitHub
# viserait alors une stack disparue. STACK_ID ne sert plus que de repli.
#
# Réglages (variables d'environnement) : PORTAINER_URL, PORTAINER_TOKEN, STACK_NAME (ou STACK_ID), ENDPOINT_ID,
# CONTENEUR (défaut hema-organizer), TLS_INSECURE (true pour un certificat auto-signé).
# Procédure : docs/DEPLOIEMENT.md, § 8 bis.
set -euo pipefail

VERSION="${1:-}"; VERSION="${VERSION#v}"
CONTENEUR="${CONTENEUR:-hema-organizer}"
for v in PORTAINER_URL PORTAINER_TOKEN ENDPOINT_ID; do
  [ -n "${!v:-}" ] || { echo "Réglage manquant : ${v} (voir docs/DEPLOIEMENT.md, § 8 bis)." >&2; exit 1; }
done
[ -n "${STACK_NAME:-}${STACK_ID:-}" ] || { echo "Réglage manquant : STACK_NAME (ou STACK_ID)." >&2; exit 1; }
command -v jq >/dev/null || { echo "jq manque sur le serveur du runner : sudo apt install -y jq" >&2; exit 1; }

K=(); [ "${TLS_INSECURE:-false}" = "true" ] && K=(-k)
API="${PORTAINER_URL%/}/api"
appel() { curl -fsS "${K[@]}" -H "X-API-Key: ${PORTAINER_TOKEN}" "$@"; }
resume() { [ -n "${GITHUB_STEP_SUMMARY:-}" ] && echo "$1" >> "$GITHUB_STEP_SUMMARY" || true; }

TRAVAIL="$(mktemp -d)"; trap 'rm -rf "$TRAVAIL"' EXIT

# 1. La stack telle que Portainer la garde — retrouvée par son nom dans l'environnement, si on l'a.
if [ -n "${STACK_NAME:-}" ]; then
  STACK_ID=$(appel "$API/stacks" | jq -r --arg n "$STACK_NAME" --argjson e "$ENDPOINT_ID" '[.[] | select(.Name == $n and .EndpointId == $e)][0].Id // empty')
  [ -n "$STACK_ID" ] || { echo "Aucune stack « ${STACK_NAME} » dans l'environnement ${ENDPOINT_ID} : supprimée sans être recréée ?" >&2; exit 1; }
fi
appel "$API/stacks/$STACK_ID" > "$TRAVAIL/stack.json"
appel "$API/stacks/$STACK_ID/file" > "$TRAVAIL/fichier.json"
echo "Stack : $(jq -r '.Name' "$TRAVAIL/stack.json") (n° ${STACK_ID}, environnement ${ENDPOINT_ID})"

# 2. Redéploiement à l'identique, image retéléchargée — en notant l'image du conteneur avant l'appel.
IMAGE_AVANT=$(appel "$API/endpoints/$ENDPOINT_ID/docker/containers/$CONTENEUR/json" 2>/dev/null | jq -r '.Image // ""' || true)
jq -n --slurpfile s "$TRAVAIL/stack.json" --slurpfile f "$TRAVAIL/fichier.json" \
  '{stackFileContent: $f[0].StackFileContent, env: ($s[0].Env // []), prune: false, pullImage: true}' > "$TRAVAIL/corps.json"
AVANT=$(date -u +%s)
appel -X PUT -H "Content-Type: application/json" --data @"$TRAVAIL/corps.json" "$API/stacks/$STACK_ID?endpointId=$ENDPOINT_ID" > /dev/null
echo "Redéploiement demandé (re-pull de l'image)."

# 3. Attente : sain, sur la bonne version si elle est donnée, et redémarré après l'appel si l'image a changé. Jusqu'à 6 min
#    (sauvegarde d'avant migration, migrations, puis healthcheck : start_period 30 s, intervalle 30 s).
for i in $(seq 1 36); do
  if appel "$API/endpoints/$ENDPOINT_ID/docker/containers/$CONTENEUR/json" > "$TRAVAIL/conteneur.json" 2>/dev/null; then
    ver=$(jq -r '.Config.Labels["org.opencontainers.image.version"] // "?"' "$TRAVAIL/conteneur.json")
    etat=$(jq -r '.State.Health.Status // .State.Status // "?"' "$TRAVAIL/conteneur.json")
    debut=$(jq -r '.State.StartedAt // ""' "$TRAVAIL/conteneur.json")
    depuis=$(date -u -d "$debut" +%s 2>/dev/null || echo 0)
    echo "essai ${i} : version ${ver}, état ${etat}, démarré ${debut}"
    image=$(jq -r '.Image // ""' "$TRAVAIL/conteneur.json")
    if [ "$etat" = "healthy" ] && { [ -z "$VERSION" ] || [ "$ver" = "$VERSION" ]; }; then
      if [ -n "$IMAGE_AVANT" ] && [ "$image" = "$IMAGE_AVANT" ]; then
        echo "Image inchangée : conteneur conservé, version ${ver}, sain."
        resume "### Rien à redéployer : image inchangée, version ${ver}, conteneur \`${CONTENEUR}\` sain"
        exit 0
      fi
      if [ "$depuis" -ge "$AVANT" ]; then
        echo "Déployée : version ${ver}, conteneur ${CONTENEUR} redémarré et sain."
        resume "### Déployée : version ${ver}, conteneur \`${CONTENEUR}\` sain"
        exit 0
      fi
    fi
  else
    echo "essai ${i} : conteneur ${CONTENEUR} introuvable pour l'instant (recréation en cours ?)"
  fi
  sleep 10
done
echo "Pas de conteneur ${CONTENEUR} sain${VERSION:+ en version ${VERSION}} après 6 minutes. Journaux du conteneur dans Portainer ; retour en arrière : APP_TAG (docs/DEPLOIEMENT.md, § 9)." >&2
exit 1
