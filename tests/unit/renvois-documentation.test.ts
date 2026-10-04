import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * **Un renvoi vers un document doit mener quelque part.**
 *
 * Le garde-fou du jeu de démonstration disait « faites une sauvegarde avant — voir
 * `docs/INSTALLATION.md` », un fichier qui n'a jamais existé : la marche à suivre est au § 10 de
 * `docs/DEPLOIEMENT.md`. Le message est juste au moment où il compte le plus — quelqu'un s'apprête
 * à effacer une base —, et il envoie dans le vide.
 *
 * Personne ne relit ces chaînes : elles ne s'affichent que dans le cas qu'on espère ne jamais voir.
 * D'où ce balayage, qui relit **tout** le code à la recherche d'un chemin `docs/…` et vérifie qu'il
 * existe. Il ne juge pas le contenu du renvoi — seulement qu'il mène à un fichier.
 */
const RACINE = process.cwd();
const DOSSIERS = ["src", "prisma", "scripts", "docker"];
/**
 * **Les deux scripts de la fabrique parlent de l'ARBRE D'EN FACE.** `docs/FONCTIONNALITES.md`
 * n'existe que dans le miroir — c'est un de ses fichiers propres, et c'est précisément ce que ces
 * scripts déclarent. Les balayer reviendrait à exiger ici un fichier qui n'a aucune raison d'y être.
 */
const HORS_CHAMP = [/^scripts\/fabriquer-public\.ts$/, /^scripts\/verifier-public\.ts$/];
const RENVOI = /\bdocs\/[A-Za-z0-9_./-]+\.(?:md|yml|html)\b/g;

function fichiers(dossier: string): string[] {
  const complet = path.join(RACINE, dossier);
  if (!fs.existsSync(complet)) return [];
  return fs.readdirSync(complet, { withFileTypes: true }).flatMap((e) => {
    if (e.name === "migrations" || e.name === "node_modules") return [];
    const relatif = path.join(dossier, e.name);
    if (e.isDirectory()) return fichiers(relatif);
    return /\.(ts|tsx|sh|mjs|cjs)$/.test(e.name) ? [relatif] : [];
  });
}

describe("les renvois vers la documentation mènent quelque part", () => {
  it("chaque chemin `docs/…` cité dans le code existe", () => {
    const morts: string[] = [];
    for (const relatif of DOSSIERS.flatMap(fichiers).filter((r) => !HORS_CHAMP.some((h) => h.test(r)))) {
      const texte = fs.readFileSync(path.join(RACINE, relatif), "utf8");
      for (const m of texte.matchAll(RENVOI)) {
        if (!fs.existsSync(path.join(RACINE, m[0]))) morts.push(`${relatif} → ${m[0]}`);
      }
    }
    expect(morts, `renvois vers un document inexistant :\n  ${morts.join("\n  ")}`).toEqual([]);
  });

  it("le balayage voit vraiment quelque chose", () => {
    // Contre-épreuve : un balayage qui ne trouverait plus aucun renvoi passerait au vert sans rien
    // vérifier. On exige qu'il en trouve, sinon c'est l'expression qui est cassée.
    const trouves = DOSSIERS.flatMap(fichiers).flatMap((r) => [...fs.readFileSync(path.join(RACINE, r), "utf8").matchAll(RENVOI)]);
    expect(trouves.length).toBeGreaterThan(5);
  });
});
