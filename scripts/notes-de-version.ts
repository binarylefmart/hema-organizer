/**
 * **Les notes de version, rédigées depuis l'historique.**
 *
 *     npx tsx scripts/notes-de-version.ts 0.65.0
 *
 * Ajoute en tête de `CHANGELOG.md` la section de la version donnée : les sujets des commits depuis le
 * dernier tag, rangés en « Nouveautés » (`feat`), « Corrections » (`fix`) et « Autres changements ».
 * Les commits de montée de version n'y figurent pas. Le fichier part dans le dépôt public comme le
 * reste, donc **après** le garde-fou : un sujet de commit qui nommerait le club arrête la publication.
 *
 * Le workflow de publication reprend ensuite cette section telle quelle pour la release GitHub du tag
 * (`.github/workflows/release.yml`) : c'est la page vers laquelle pointe l'encart « Mise à jour
 * disponible » du profil.
 *
 * Relancé pour une version déjà présente, il remplace sa section au lieu de la dupliquer.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const FICHIER = "CHANGELOG.md";
const ENTETE = "# Notes de version\n\nCe que chaque version change, rédigé depuis l'historique du dépôt à chaque publication.\n";

const GROUPES = [
  { titre: "Nouveautés", types: ["feat"] },
  { titre: "Corrections", types: ["fix"] },
] as const;

export function sectionDeVersion(version: string, sujets: readonly string[]): string {
  const lignes = sujets
    .map((s) => s.trim())
    .filter((s) => s && !/^chore\(version\)/.test(s) && !/^Merge /.test(s))
    .map((s) => {
      const m = /^(\w+)(?:\(([^)]+)\))?!?:\s*(.+)$/.exec(s);
      return m ? { type: m[1], portee: m[2] ?? "", texte: m[3] } : { type: "", portee: "", texte: s };
    });
  const puce = (l: { portee: string; texte: string }) => `- ${l.portee ? `**${l.portee}** : ` : ""}${l.texte}`;
  const blocs: string[] = [];
  for (const g of GROUPES) {
    const du = lignes.filter((l) => (g.types as readonly string[]).includes(l.type));
    if (du.length) blocs.push(`### ${g.titre}\n\n${du.map(puce).join("\n")}`);
  }
  const autres = lignes.filter((l) => !GROUPES.some((g) => (g.types as readonly string[]).includes(l.type)));
  if (autres.length) blocs.push(`### Autres changements\n\n${autres.map(puce).join("\n")}`);
  return `## ${version}\n\n${blocs.length ? blocs.join("\n\n") : "Aucun changement notable."}\n`;
}

/** Insère (ou remplace) la section d'une version, juste sous l'en-tête. */
export function insererSection(contenu: string, version: string, section: string): string {
  const base = contenu.trim() ? contenu : ENTETE;
  const sansAncienne = base.replace(new RegExp(`\\n## ${version.replace(/\./g, "\\.")}\\n[\\s\\S]*?(?=\\n## |$)`), "\n");
  const i = sansAncienne.search(/\n## /);
  const tete = i === -1 ? sansAncienne.trimEnd() + "\n" : sansAncienne.slice(0, i).trimEnd() + "\n";
  const reste = i === -1 ? "" : sansAncienne.slice(i + 1);
  return `${tete}\n${section}${reste ? `\n${reste}` : ""}`.replace(/\n{3,}/g, "\n\n");
}

function principal(): void {
  const version = process.argv[2];
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
    console.error("Usage : npx tsx scripts/notes-de-version.ts <version>  (ex. 0.65.0)");
    process.exit(2);
  }
  const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();
  let depuis = "";
  try {
    depuis = git("describe", "--tags", "--abbrev=0", "--match", "v*");
  } catch {
    depuis = "";
  }
  const sujets = git("log", "--format=%s", ...(depuis ? [`${depuis}..HEAD`] : [])).split("\n");
  const avant = existsSync(FICHIER) ? readFileSync(FICHIER, "utf8") : "";
  writeFileSync(FICHIER, insererSection(avant, version, sectionDeVersion(version, sujets)));
  console.info(`  ${FICHIER} : section ${version} rédigée depuis ${depuis || "le début de l'historique"}.`);
}

if (process.argv[1]?.endsWith("notes-de-version.ts")) principal();
