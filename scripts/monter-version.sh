#!/usr/bin/env bash
#
# **Monter la version : un seul geste pour tout ce qui porte le numéro.**
#
#     npm run version:monter -- 0.65.0
#
# `package.json` et son verrou, les trois guides (leur couverture et leur pied de page portent le
# numéro, un test les relie), leurs PDF, et la section du `CHANGELOG.md` rédigée depuis les commits
# depuis le dernier tag. Puis un commit. La publication reste un geste à part : `npm run publier`.
#
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

refus() { printf '\n\033[31mArrêt : %s\033[0m\n' "$*" >&2; exit 1; }

NOUVELLE="${1:-}"
[[ "$NOUVELLE" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || refus "donnez la version visée, par exemple : npm run version:monter -- 0.65.0"
[ -z "$(git status --porcelain)" ] || refus "le dépôt a des modifications non commitées : commitez d'abord."
ANCIENNE="$(node -p "require('./package.json').version")"
[ "$ANCIENNE" != "$NOUVELLE" ] || refus "le dépôt est déjà en ${NOUVELLE}."

sed -i "s/${ANCIENNE//./\\.}/${NOUVELLE}/g" docs/guides/guide-admin.html docs/guides/guide-instructeur.html docs/guides/guide-membre.html
npm version "$NOUVELLE" --no-git-tag-version >/dev/null
npx tsx scripts/notes-de-version.ts "$NOUVELLE"
npm run guides:pdf
git add -A
git commit -q -m "chore(version): ${NOUVELLE}"
printf '\n\033[1m— %s → %s, commité.\033[0m Relisez CHANGELOG.md, puis : npm run publier\n' "$ANCIENNE" "$NOUVELLE"
