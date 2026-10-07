import { describe, expect, it } from "vitest";
import { type NatureElement } from "@/lib/constants";
import { elementsRanges } from "@/lib/notifications/contenu";
import { ordreAvant, ordreDInsertion, ordreEntier, placesDansPartie, rangementsParties, sequenceRangee, type PartieARanger } from "@/components/planning/rangement";

/**
 * **La règle de rangement d'une séance, seule** (`src/components/planning/rangement.ts`) — le module
 * sans Prisma que l'application (`rangerParties`), le script de réparation et le test de la
 * migration « Parties et éléments » partagent. Trois invariants : parties contiguës à partir de 1,
 * rangs contigus à partir de 0 dans l'ordre de lecture (partie, ordre, id — l'ordre d'une partie est
 * libre, la nature n'y entre pas), libellés
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

  it("garde l'ordre d'une partie tel qu'il est stocké, sans retrier par nature", () => {
    // L'équipe a mis l'atelier en tête et l'échauffement en dernier : c'est son choix, il tient.
    expect(
      appliquer([el("at", 1, "ATELIER", 0), el("op", 1, "OPTION", 1), el("co", 1, "COURS", 2), el("ec", 1, "ECHAUFFEMENT", 3)]),
    ).toEqual(["at@1:0 Atelier", "op@1:1 Option", "co@1:2 Cours", "ec@1:3 Échauffement"]);
    expect(rangementsParties([el("at", 1, "ATELIER", 0, "Atelier"), el("ec", 1, "ECHAUFFEMENT", 1, "Échauffement")])).toEqual([]);
  });

  it("numérote une nature dans l'ordre de lecture : le premier cours lu est « Cours 1 »", () => {
    expect(appliquer([el("b", 1, "COURS", 0), el("o", 1, "OPTION", 1), el("a", 1, "COURS", 2)])).toEqual([
      "b@1:0 Cours 1",
      "o@1:1 Option",
      "a@1:2 Cours 2",
    ]);
  });

  it("renumérote un rang intercalaire : un élément posé à 0,5 se glisse entre les deux premiers", () => {
    expect(appliquer([el("a", 1, "COURS", 0, "Cours 1"), el("b", 1, "COURS", 1, "Cours 2"), el("n", 1, "OPTION", 0.5)])).toEqual([
      "a@1:0 Cours 1",
      "n@1:1 Option",
      "b@1:2 Cours 2",
    ]);
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

describe("ordreDInsertion — la place par défaut d'un élément qui arrive", () => {
  /** La séance une fois l'élément `n` posé à sa place par défaut, puis rangée. */
  function poserParDefaut(parties: PartieARanger[], bloc: number, nature: NatureElement): string[] {
    return appliquer([...parties, el("n", bloc, nature, ordreDInsertion(parties, bloc, nature))]).map((l) => l.split(" ")[0]);
  }
  const partie = [el("ec", 1, "ECHAUFFEMENT", 0), el("co", 1, "COURS", 1), el("at", 1, "ATELIER", 2), el("op", 1, "OPTION", 3)];

  it("suit l'ordre par défaut des natures : échauffement, cours, atelier, option", () => {
    expect(poserParDefaut(partie, 1, "ECHAUFFEMENT")).toEqual(["ec@1:0", "n@1:1", "co@1:2", "at@1:3", "op@1:4"]);
    expect(poserParDefaut(partie, 1, "COURS")).toEqual(["ec@1:0", "co@1:1", "n@1:2", "at@1:3", "op@1:4"]);
    expect(poserParDefaut(partie, 1, "OPTION")).toEqual(["ec@1:0", "co@1:1", "at@1:2", "op@1:3", "n@1:4"]);
  });

  it("pose l'atelier **avant** les options", () => {
    const sansAtelier = [el("co", 1, "COURS", 0), el("o1", 1, "OPTION", 1), el("o2", 1, "OPTION", 2)];
    expect(poserParDefaut(sansAtelier, 1, "ATELIER")).toEqual(["co@1:0", "n@1:1", "o1@1:2", "o2@1:3"]);
  });

  it("pose en tête de la partie quand rien ne le précède par défaut", () => {
    const sansEchauffement = [el("a", 1, "COURS", 0), el("co", 2, "COURS", 1), el("op", 2, "OPTION", 2)];
    expect(poserParDefaut(sansEchauffement, 2, "ECHAUFFEMENT")).toEqual(["a@1:0", "n@2:1", "co@2:2", "op@2:3"]);
  });

  it("se pose après le **dernier** élément qui le précède, même dans une partie réordonnée à la main", () => {
    // L'option a été remontée au-dessus du cours : un second cours se pose après le cours, en fin.
    const reordonnee = [el("op", 1, "OPTION", 0), el("co", 1, "COURS", 1)];
    expect(poserParDefaut(reordonnee, 1, "COURS")).toEqual(["op@1:0", "co@1:1", "n@1:2"]);
    // Une option aussi : le dernier élément dont la nature vient avant la sienne est le cours.
    expect(poserParDefaut(reordonnee, 1, "OPTION")).toEqual(["op@1:0", "co@1:1", "n@1:2"]);
  });

  it("ouvre une partie nouvelle à la fin, sans toucher aux autres", () => {
    expect(poserParDefaut(partie, 2, "OPTION")).toEqual(["ec@1:0", "co@1:1", "at@1:2", "op@1:3", "n@2:4"]);
    expect(ordreDInsertion([], 1, "COURS")).toBe(0);
  });
});

describe("ordreAvant — la place choisie à la main", () => {
  const seance = [el("a", 1, "COURS", 0), el("b", 1, "OPTION", 1), el("c", 1, "ATELIER", 2), el("d", 2, "COURS", 3)];

  it("se glisse juste avant l'élément visé, ou en tête", () => {
    expect(appliquer([...seance, el("n", 1, "COURS", ordreAvant(seance, 1, "c")!)]).map((l) => l.split(" ")[0])).toEqual(["a@1:0", "b@1:1", "n@1:2", "c@1:3", "d@2:4"]);
    expect(appliquer([...seance, el("n", 1, "COURS", ordreAvant(seance, 1, "a")!)]).map((l) => l.split(" ")[0])).toEqual(["n@1:0", "a@1:1", "b@1:2", "c@1:3", "d@2:4"]);
  });

  it("va en fin de partie quand rien n'est visé", () => {
    expect(appliquer([...seance, el("n", 1, "COURS", ordreAvant(seance, 1, null)!)]).map((l) => l.split(" ")[0])).toEqual(["a@1:0", "b@1:1", "c@1:2", "n@1:3", "d@2:4"]);
    expect(appliquer([...seance, el("n", 3, "COURS", ordreAvant(seance, 3, null)!)]).map((l) => l.split(" ")[0])).toEqual(["a@1:0", "b@1:1", "c@1:2", "d@2:3", "n@3:4"]);
  });

  it("rend `null` pour un voisin qui n'est pas dans la partie visée", () => {
    expect(ordreAvant(seance, 2, "a")).toBeNull();
    expect(ordreAvant(seance, 1, "inconnu")).toBeNull();
  });
});

describe("ordreEntier", () => {
  it("garde un rang entier tel quel et ramène un rang intercalaire à sa partie entière", () => {
    expect(ordreEntier(3)).toBe(3);
    expect(ordreEntier(2.5)).toBe(2);
    expect(ordreEntier(-1)).toBe(-1);
  });
});

describe("elementsRanges — ce que lisent les messages, les pages de partage et l'API", () => {
  it("suit la partie puis l'ordre stocké, jamais la nature", () => {
    const lus = elementsRanges([
      { ordre: 2, bloc: 1, nature: "ECHAUFFEMENT" },
      { ordre: 0, bloc: 1, nature: "OPTION" },
      { ordre: 3, bloc: 2, nature: "COURS" },
      { ordre: 1, bloc: 1, nature: "COURS" },
    ]);
    expect(lus.map((p) => `${p.bloc}:${p.nom}`)).toEqual(["1:Option", "1:Cours", "1:Échauffement", "2:Cours"]);
  });
});
