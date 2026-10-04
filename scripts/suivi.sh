#!/usr/bin/env bash
#
# Tableau de suivi du projet — une fenêtre à garder ouverte pendant tout travail long.
#
# Trois partis pris, chacun payé par une leçon :
#
# 1. **Il ne clignote pas.** La première version faisait `clear` puis réécrivait tout : à chaque
#    rafraîchissement l'écran passait par du vide, et le regard perdait la ligne qu'il suivait. Ici
#    la trame est d'abord construite **en mémoire**, puis envoyée en **une seule écriture** au même
#    endroit (curseur ramené en haut, chaque ligne effacée jusqu'à son bord avec `\e[K`). L'écran
#    n'est jamais vide, et rien ne saute. On travaille en plus dans l'écran **secondaire** du
#    terminal (`\e[?1049h`), si bien qu'en quittant on retrouve son shell intact.
#
# 2. **Il ne vole pas les cœurs du travail qu'il regarde.** Les trois portes (lint, typecheck, tests)
#    coûtent une minute à elles seules ; les relancer toutes les dix secondes pendant que quatre
#    agents lancent les leurs a fait monter la charge à 13 sur 8 cœurs, et tout le monde attendait
#    tout le monde. Elles ne sont donc mesurées que quand **plus rien n'écrit** depuis quelques
#    minutes, et jamais plus souvent que `PORTES_MIN_S`. Entre deux mesures, le verdict précédent
#    reste affiché **avec son heure** — un chiffre daté est honnête, un chiffre inventé ne l'est pas.
#
# 3. **Il ne déduit rien.** Chaque barre vient d'un fait qu'on peut aller vérifier : des fichiers sur
#    le disque, la sortie d'une campagne, `git status`. Tant qu'une campagne n'a pas tourné, sa ligne
#    dit « pas de campagne » au lieu d'afficher 0 % (qui se lirait comme un échec) ou 100 % (qui
#    mentirait). Un tableau de bord qui embellit est pire que pas de tableau de bord.
#
# Usage :
#   scripts/suivi.sh [--phase=FICHIER] [--logs=DOSSIER] [--intervalle=5]
#
#   --phase   décrit le travail en cours (voir le format plus bas). Sans lui, le tableau montre les
#             portes, les captures, le dépôt et la machine — ce qui vaut pour n'importe quel moment
#             du projet.
#   --logs    où chercher `e2e.log` et `captures.log` (défaut : le dossier de travail de session le
#             plus récent sous /tmp/claude-*, parce que c'est là que les campagnes écrivent).
#
# Format du fichier de phase — une ligne par entrée, `#` pour un commentaire :
#   chantier|Libellé affiché|chemin1 chemin2 …      ← « au travail » si un de ces chemins a bougé
#   etape|fait|Libellé                              ← la file d'attente du moment (fait/encours/attente)
#
set -o pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1
RACINE=$PWD

PHASE=""; LOGS=""; INTERVALLE=5
for a in "$@"; do
  case "$a" in
    --phase=*) PHASE=${a#*=} ;;
    --logs=*) LOGS=${a#*=} ;;
    --intervalle=*) INTERVALLE=${a#*=} ;;
    *) printf 'option inconnue : %s\n' "$a" >&2; exit 2 ;;
  esac
done
# Les campagnes écrivent dans le dossier de travail de la session qui les lance ; on prend le plus
# récent plutôt que d'en coder un, qui serait périmé à la session suivante.
[ -z "$LOGS" ] && LOGS=$(ls -dt /tmp/claude-*/*/*/scratchpad 2>/dev/null | head -1)

RECENT_MIN=4        # « au travail » = a écrit dans les N dernières minutes
PORTES_MIN_S=180    # jamais deux mesures des portes à moins de N secondes

V=$'\e[32m'; R=$'\e[31m'; J=$'\e[33m'; B=$'\e[36m'; GRIS=$'\e[90m'; G=$'\e[1m'; Z=$'\e[0m'

# `find` est **bfs** sur cette machine : il refuse `-newermt '-4 minutes'` (« Invalid timestamp ») et
# veut une date ISO. Une fenêtre qui utilisait la forme relative comptait toujours zéro fichier
# récent — elle se croyait au calme et se refermait en annonçant que tout allait bien.
recents() { # $@ = chemins ; rend le nombre de fichiers modifiés depuis RECENT_MIN minutes
  local depuis; depuis=$(date -d "-$RECENT_MIN minutes" +%Y-%m-%dT%H:%M:%S)
  find "$@" -type f -newermt "$depuis" 2>/dev/null | wc -l
}

barre() { # $1 fait  $2 total  $3 largeur  $4 couleur ; rend une barre ET son compte
  local fait=${1:-0} total=${2:-0} large=${3:-22} coul=${4:-$B} pleins=0 i
  [ "$total" -gt 0 ] && pleins=$(( fait * large / total ))
  [ "$pleins" -gt "$large" ] && pleins=$large
  local b=""
  for ((i=0;i<pleins;i++)); do b+="█"; done
  for ((i=pleins;i<large;i++)); do b+="░"; done
  local pct=0; [ "$total" -gt 0 ] && pct=$(( fait * 100 / total ))
  printf '%s%s%s %3d%%  %s/%s' "$coul" "$b" "$Z" "$pct" "$fait" "$total"
}

pastille() { case "$1" in
  vert) printf '%s●%s' "$V" "$Z" ;; rouge) printf '%s●%s' "$R" "$Z" ;;
  jaune) printf '%s●%s' "$J" "$Z" ;; *) printf '%s○%s' "$GRIS" "$Z" ;; esac; }

# ── Lecture des campagnes ──────────────────────────────────────────────────────────────────────
# Les deux campagnes écrivent leur journal au fil de l'eau : on y lit une progression **vécue**,
# pas une estimation. Tant qu'aucun journal n'existe, on le dit.
e2e_etat() {
  local f="$LOGS/e2e.log" fini=0 total=0 echecs=0
  [ -r "$f" ] || { echo "absent"; return; }
  # La barre compte les tests **qui passent**, pas les tests finis : « 48/48 » avec un échec en
  # rouge à côté se lit comme une réussite, et c'est exactement ce qu'un tableau de bord ne doit
  # pas laisser croire.
  total=$(grep -oE 'Running ([0-9]+) tests' "$f" 2>/dev/null | tail -1 | grep -oE '[0-9]+')
  echecs=$(grep -cE '^ *✘ ' "$f" 2>/dev/null)
  local passes; passes=$(grep -cE '^ *✓ ' "$f" 2>/dev/null)
  printf '%s %s %s %s' "${total:-0}" "$passes" "$echecs" "$(grep -c 'EXIT=' "$f" 2>/dev/null)"
}
captures_etat() { # scènes complètes (4 images) / dossiers de scène présents
  local completes=0 vides=0 partielles=0 total=0 d n
  for d in "$RACINE"/previews/*/; do
    [ -d "$d" ] || continue
    # `previews/emails` n'est pas une scène : c'est la boîte aux lettres du développement, où
    # l'application dépose les emails qu'elle aurait envoyés (le test « mot de passe oublié » y va
    # chercher son lien). Comptée comme une scène vide, elle plafonnait le tableau à « 99 % — 100/101,
    # 1 vide » pour toujours — un chiffre rouge permanent finit par ne plus se lire.
    [ "$(basename "$d")" = "emails" ] && continue
    total=$((total+1))
    n=$(ls "$d" 2>/dev/null | grep -c '\.jpg$')
    if [ "$n" -ge 4 ]; then completes=$((completes+1))
    elif [ "$n" -eq 0 ]; then vides=$((vides+1))
    else partielles=$((partielles+1)); fi
  done
  printf '%s %s %s %s' "$completes" "$total" "$vides" "$partielles"
}
# **Le total ne se devine pas dans la source du script de captures.** Une première version comptait
# les `nom:` du fichier et annonçait « 156 % — 102/65 » : le script en déclare une partie en ligne,
# et `nom:` sert aussi aux personnes des jeux d'essai. On compte donc ce qui existe sur le disque, et
# on va chercher **le verdict de la campagne elle-même** quand elle a tourné — c'est elle qui sait
# combien de scènes elle porte, et elle le dit en clair.
campagne_verdict() {
  local f
  for f in "$LOGS/captures.log" "$LOGS/campagne.log" "$LOGS/apercus.log"; do
    [ -r "$f" ] || continue
    grep -oE '[0-9]+ scènes? complètes? et du jour sur [0-9]+' "$f" 2>/dev/null | tail -1 && return
  done
}

# ── Les portes, mesurées seulement au calme ────────────────────────────────────────────────────
P_LINT="—"; P_TC="—"; P_TESTS="—"; P_OK=0; P_TOT=0; P_QUAND=""; P_DERNIERE=0
mesurer_portes() {
  local n; n=$(npm run lint 2>&1 | grep -cE '[0-9]+:[0-9]+ +error')
  [ "$n" -gt 0 ] && P_LINT="${R}${n} erreur(s)${Z}" || P_LINT="${V}vert${Z}"
  if npm run typecheck >/dev/null 2>&1; then P_TC="${V}vert${Z}"; else P_TC="${R}erreurs${Z}"; fi
  local ligne; ligne=$(npx vitest run --silent 2>&1 | grep -E '^ *Tests ' | tail -1)
  P_OK=$(printf '%s' "$ligne" | grep -oE '[0-9]+ passed' | grep -oE '[0-9]+')
  local ko; ko=$(printf '%s' "$ligne" | grep -oE '[0-9]+ failed' | grep -oE '[0-9]+')
  P_OK=${P_OK:-0}; ko=${ko:-0}; P_TOT=$(( P_OK + ko ))
  [ "$ko" -gt 0 ] && P_TESTS="${R}${ko} en échec${Z}" || P_TESTS="${V}tout passe${Z}"
  P_QUAND=$(date +%H:%M:%S); P_DERNIERE=$(date +%s)
}

# ── L'écran ────────────────────────────────────────────────────────────────────────────────────
COLS=$(tput cols 2>/dev/null || echo 100)
trap 'COLS=$(tput cols 2>/dev/null || echo 100)' WINCH
quitter() { printf '\e[?25h\e[?1049l'; exit 0; }
trap quitter INT TERM
printf '\e[?1049h\e[?25l'

TRAME=""
ligne() { TRAME+="$1"$'\n'; }
titre() { ligne "${G}$1${Z}"; }

DEBUT=$(date +%s)
while :; do
  TRAME=""
  branche=$(git -C "$RACINE" branch --show-current 2>/dev/null)
  version=$(grep -m1 '"version"' "$RACINE/package.json" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')
  ecoule=$(( ($(date +%s) - DEBUT) / 60 ))

  ligne "${G}${B}  HEMA Organizer${Z}${G}  v${version}${Z}   ${GRIS}branche${Z} ${branche}   ${GRIS}$(date +%H:%M:%S) · ${ecoule} min d'ouverture${Z}"
  ligne ""

  # ── Chantiers (fichier de phase) ──
  if [ -n "$PHASE" ] && [ -r "$PHASE" ]; then
    titre "  CHANTIERS"
    actifs=0
    while IFS='|' read -r genre a b; do
      [ "$genre" = "chantier" ] || continue
      # shellcheck disable=SC2086
      n=$(cd "$RACINE" && recents $b)
      if [ "$n" -gt 0 ]; then actifs=$((actifs+1))
        ligne "   $(pastille jaune) $(printf '%-26s' "$a") ${J}écrit${Z}  ${GRIS}${n} fichier(s) < ${RECENT_MIN} min${Z}"
      else
        ligne "   $(pastille gris) $(printf '%-26s' "$a") ${GRIS}calme${Z}"
      fi
    done < "$PHASE"
    ligne ""
  else
    actifs=$(cd "$RACINE" && recents src tests docs scripts prisma)
  fi

  # ── Portes ──
  titre "  PORTES"
  maintenant=$(date +%s)
  if [ "$actifs" -eq 0 ] && [ $(( maintenant - P_DERNIERE )) -ge "$PORTES_MIN_S" ]; then
    ligne "   ${J}mesure en cours…${Z}"
    printf '\e[H%s' "$TRAME"   # on montre l'attente avant de bloquer une minute
    mesurer_portes
    TRAME=${TRAME%"   ${J}mesure en cours…${Z}"$'\n'}
  fi
  ligne "   $(pastille "$([ "$P_LINT" = "${V}vert${Z}" ] && echo vert || echo gris)") lint        ${P_LINT}"
  ligne "   $(pastille "$([ "$P_TC" = "${V}vert${Z}" ] && echo vert || echo gris)") typecheck   ${P_TC}"
  if [ "$P_TOT" -gt 0 ]; then
    ligne "   $(pastille "$([ "$P_TESTS" = "${V}tout passe${Z}" ] && echo vert || echo rouge)") unitaires   $(barre "$P_OK" "$P_TOT" 22 "$V")  ${P_TESTS}"
  else
    ligne "   $(pastille gris) unitaires   ${GRIS}pas encore mesurés${Z}"
  fi
  ligne "   ${GRIS}mesurées à ${P_QUAND:-—}$([ "$actifs" -gt 0 ] && printf ' · en pause : %s chantier(s) écrivent' "$actifs")${Z}"
  ligne ""

  # ── Campagnes ──
  titre "  CAMPAGNES"
  read -r c_ok c_tot c_vides c_part <<<"$(captures_etat)"
  ligne "   $(pastille "$([ "${c_vides:-0}" -eq 0 ] && [ "${c_part:-0}" -eq 0 ] && [ "${c_ok:-0}" -gt 0 ] && echo vert || echo jaune)") captures    $(barre "$c_ok" "$c_tot" 22 "$B")  ${GRIS}scènes complètes$([ "${c_vides:-0}" -gt 0 ] && printf ' · %s vide(s)' "$c_vides")$([ "${c_part:-0}" -gt 0 ] && printf ' · %s partielle(s)' "$c_part")${Z}"
  verdict=$(campagne_verdict)
  [ -n "$verdict" ] && ligne "     ${GRIS}dernière campagne : ${verdict}${Z}"
  etat=$(e2e_etat)
  if [ "$etat" = "absent" ]; then
    ligne "   $(pastille gris) bout en bout ${GRIS}pas de campagne dans ce dossier de travail${Z}"
  else
    read -r e_tot e_ok e_ko e_fin <<<"$etat"
    coul=$V; [ "${e_ko:-0}" -gt 0 ] && coul=$R
    suffixe="${GRIS}en cours${Z}"; [ "${e_fin:-0}" -gt 0 ] && suffixe="${GRIS}terminée${Z}"
    [ "${e_ko:-0}" -gt 0 ] && suffixe="${R}${e_ko} en échec${Z} · $suffixe"
    ligne "   $(pastille "$([ "${e_ko:-0}" -gt 0 ] && echo rouge || { [ "${e_fin:-0}" -gt 0 ] && echo vert || echo jaune; })") bout en bout $(barre "$e_ok" "$e_tot" 22 "$coul")  ${suffixe}"
  fi
  if pgrep -f 'node_modules/playwright|tsx scripts/preview' >/dev/null 2>&1; then
    ligne "   ${GRIS}Playwright tourne · chromium $(pgrep -c chrome-headless 2>/dev/null || echo 0) processus${Z}"
  else
    ligne "   ${GRIS}Playwright à l'arrêt${Z}"
  fi
  ligne ""

  # ── File d'attente (fichier de phase) ──
  if [ -n "$PHASE" ] && [ -r "$PHASE" ]; then
    titre "  FILE D'ATTENTE"
    faites=0; total=0
    while IFS='|' read -r genre etat lib; do
      [ "$genre" = "etape" ] || continue
      total=$((total+1))
      case "$etat" in
        fait) faites=$((faites+1)); ligne "   ${V}✓${Z} ${GRIS}${lib}${Z}" ;;
        encours) ligne "   ${J}▸${Z} ${lib}" ;;
        *) ligne "   ${GRIS}·${Z} ${lib}" ;;
      esac
    done < "$PHASE"
    ligne ""
    ligne "   $(barre "$faites" "$total" 30 "$V")  ${GRIS}étapes de la phase${Z}"
    ligne ""
  fi

  # ── Dépôt et machine ──
  titre "  DÉPÔT ET MACHINE"
  modifs=$(git -C "$RACINE" status --porcelain | grep -vc '^??')
  nouveaux=$(git -C "$RACINE" status --porcelain | grep -c '^??')
  dernier=$(git -C "$RACINE" log -1 --format='%h %ad' --date=format:'%d/%m %H:%M' 2>/dev/null)
  tag=$(git -C "$RACINE" describe --tags --abbrev=0 2>/dev/null)
  aCommiter=$(( modifs + nouveaux ))
  ligne "   $(pastille "$([ "$aCommiter" -gt 0 ] && echo jaune || echo vert)") dépôt       ${modifs} modifié(s), ${nouveaux} nouveau(x)$([ "$aCommiter" -gt 0 ] && printf ' %s— commit à faire%s' "$J" "$Z")"
  ligne "     ${GRIS}dernier commit ${dernier} · dernier tag ${tag:-aucun}${Z}"
  sante=$(curl -fsS -o /dev/null -m 2 http://127.0.0.1:3000/api/health 2>/dev/null && echo "${V}sain${Z}" || echo "${GRIS}éteint${Z}")
  ligne "   $(pastille gris) machine     ${GRIS}charge${Z} $(cut -d' ' -f1-3 /proc/loadavg) ${GRIS}· vitest${Z} $(pgrep -fc vitest 2>/dev/null | head -1) ${GRIS}· dev:3000${Z} ${sante}"
  ligne ""
  ligne "   ${GRIS}q pour fermer · rafraîchi toutes les ${INTERVALLE} s${Z}"

  # Une seule écriture, au même endroit, chaque ligne effacée jusqu'à son bord : rien ne clignote.
  sortie=$'\e[H'
  while IFS= read -r l; do sortie+="${l}"$'\e[K\n'; done <<<"$TRAME"
  sortie+=$'\e[J'
  printf '%s' "$sortie"

  # `read -t` sert de pause **et** de clavier : on peut fermer la fenêtre sans attendre le tour. Hors
  # terminal (redirigé dans un fichier, par exemple pour vérifier la trame), `read` rendrait la main
  # aussitôt et la boucle tournerait à vide : on retombe alors sur un `sleep` franc.
  if [ -t 0 ]; then
    if read -rs -t "$INTERVALLE" -n 1 touche 2>/dev/null; then
      [ "$touche" = "q" ] && quitter
    fi
  else
    sleep "$INTERVALLE"
  fi
done
