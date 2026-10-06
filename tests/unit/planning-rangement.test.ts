import { describe, expect, it } from "vitest";
import { type NatureElement } from "@/lib/constants";
import { placesDansPartie, rangementsParties, sequenceRangee, type PartieARanger } from "@/components/planning/rangement";

/**
 * **La règle de rangement d'une séance, seule** (`src/components/planning/rangement.ts`) — le module
 * sans Prisma que l'application (`rangerParties`), le script de réparation et le test de la
 * migration « Parties et éléments » partagent. Trois invariants : parties contiguës à partir de 1,
 * rangs contigus à partir de 0 dans l'ordre de lecture (partie, nature, ordre, id), libellés
 * « Partie n · Nature [rang] » — ou « Nature [rang] » seul quand la séance n'a qu'une partie
 * (avenant du 06/10 : « affiche partie 1, 2, 3 que s'il y en a plusieurs »).
 */

const LE = new Date("2026-09-12T18:30:00.000Z");
const el = (id: string, bloc: number, nature: NatureElement, ordre: number, libelle = ""): PartieARanger => ({ id, bloc, nature, ordre, libelle, updatedAt: LE });

/** La séance une fois les rangements appliqués : « id@bloc:ordre libellé », dans l'ordre de lecture. */
function appliquer(parties: PartieARanger[]): string[] {
  const apres = new Map(parties.map((p) => [p.id, { ...p }]));
  for (const r of rangementsParties(parties)) Object.assign(apres.get(r.id)!, r.data);
  return [...apres.values()].sort((a, b) => a.ordre - b.ordre).map((p) => `${p.id}@${p.bloc}:${p.ordre} ${p.libelle}`);
}

describe("rangementsParties", () => {
  it("referme les parties après un retrait : la partie 3 devient la 2", () => {
    // La partie 2 a perdu son seul élément.
    expect(appliquer([el("a", 1, "COURS", 0, "Partie 1 · Cours"), el("c", 3, "COURS", 2, "Partie 3 · Cours"), el("d", 3, "OPTION", 3, "Partie 3 · Option")])).toEqual([
      "a@1:0 Partie 1 · Cours",
      "c@2:1 Partie 2 · Cours",
      "d@2:2 Partie 2 · Option",
    ]);
  });

  it("renumérote à partir de 1 même quand la partie 1 a disparu", () => {
    expect(appliquer([el("b", 2, "COURS", 0), el("c", 3, "COURS", 1)])).toEqual(["b@1:0 Partie 1 · Cours", "c@2:1 Partie 2 · Cours"]);
  });

  it("lit une partie dans l'ordre des natures — échauffement, cours, options, ateliers — quel que soit l'ordre d'ajout", () => {
    expect(
      appliquer([el("at", 1, "ATELIER", 0), el("op", 1, "OPTION", 1), el("co", 1, "COURS", 2), el("ec", 1, "ECHAUFFEMENT", 3)]),
    ).toEqual(["ec@1:0 Échauffement", "co@1:1 Cours", "op@1:2 Option", "at@1:3 Atelier"]);
  });

  it("numérote une nature seulement quand la partie en porte plusieurs — « Partie 2 · Cours 2 »", () => {
    expect(appliquer([el("a", 1, "COURS", 0), el("b", 2, "COURS", 1), el("c", 2, "COURS", 2), el("d", 2, "OPTION", 3)])).toEqual([
      "a@1:0 Partie 1 · Cours",
      "b@2:1 Partie 2 · Cours 1",
      "c@2:2 Partie 2 · Cours 2",
      "d@2:3 Partie 2 · Option",
    ]);
  });

  it("à nature égale, garde l'ordre d'avant, puis l'identifiant", () => {
    expect(sequenceRangee([el("z", 1, "COURS", 0), el("b", 1, "COURS", 5), el("a", 1, "COURS", 5)])).toEqual(["z", "a", "b"]);
  });

  it("ne rend rien pour une séance déjà rangée, et ne touche jamais `updatedAt`", () => {
    const saine = [el("a", 1, "COURS", 0, "Partie 1 · Cours"), el("b", 2, "COURS", 1, "Partie 2 · Cours")];
    expect(rangementsParties(saine)).toEqual([]);
    const [r] = rangementsParties([el("a", 2, "COURS", 3, "faux")]);
    expect(r.data).toEqual({ ordre: 0, bloc: 1, libelle: "Cours", updatedAt: LE });
  });

  it("nomme « Cours » l'élément d'une séance d'une seule partie, sans « Partie 1 · »", () => {
    expect(appliquer([el("a", 1, "COURS", 0, "Cours"), el("b", 1, "OPTION", 1, "Option 1"), el("c", 1, "OPTION", 2, "Option 2")])).toEqual([
      "a@1:0 Cours",
      "b@1:1 Option 1",
      "c@1:2 Option 2",
    ]);
    expect(rangementsParties([el("a", 1, "COURS", 0, "Cours")])).toEqual([]);
  });

  it("renomme toutes les lignes quand la séance passe d'une à deux parties", () => {
    // « Ajouter une partie » sur une séance d'une partie : le nouvel élément arrive en partie 2.
    expect(appliquer([el("a", 1, "COURS", 0, "Cours"), el("b", 1, "OPTION", 1, "Option"), el("n", 2, "COURS", 2)])).toEqual([
      "a@1:0 Partie 1 · Cours",
      "b@1:1 Partie 1 · Option",
      "n@2:2 Partie 2 · Cours",
    ]);
  });

  it("retire le préfixe quand la séance revient à une seule partie", () => {
    // La partie 1 a perdu son seul élément : la partie 2 devient la seule, et s'appelle comme avant.
    expect(appliquer([el("b", 2, "COURS", 1, "Partie 2 · Cours"), el("c", 2, "OPTION", 2, "Partie 2 · Option")])).toEqual([
      "b@1:0 Cours",
      "c@1:1 Option",
    ]);
  });

  it("n'écrit que les champs qui changent", () => {
    const [r] = rangementsParties([el("a", 1, "COURS", 0, "Partie 1 · Cours"), el("b", 2, "COURS", 1, "Partie 2 · Cours 7")]);
    expect(r).toEqual({ id: "b", data: { libelle: "Partie 2 · Cours", updatedAt: LE } });
  });
});

describe("placesDansPartie", () => {
  it("compte le rang dans la partie et la nature, et le nombre de cette nature dans la partie", () => {
    expect(
      placesDansPartie([
        { bloc: 1, nature: "COURS" },
        { bloc: 1, nature: "OPTION" },
        { bloc: 1, nature: "OPTION" },
        { bloc: 2, nature: "OPTION" },
      ]),
    ).toEqual([
      { rang: 1, nombre: 1 },
      { rang: 1, nombre: 2 },
      { rang: 2, nombre: 2 },
      { rang: 1, nombre: 1 },
    ]);
  });
});
