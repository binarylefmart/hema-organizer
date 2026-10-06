import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  blocsVoisins,
  confirmationRetrait,
  entreesAjout,
  grouperParPartie,
  lireAjout,
  nombreDeParties,
} from "@/components/planning/parties-carte";

/**
 * **La carte d'une séance, partie par partie** — ce que `ListeParties` fait de la liste rangée : la
 * découper, dire où mènent ↑ et ↓, et ce que propose le menu « Ajouter dans la partie N… ».
 */

const el = (id: string, bloc: number) => ({ id, bloc });

describe("le découpage en parties", () => {
  it("garde l'ordre reçu et ne retrie rien", () => {
    const g = grouperParPartie([el("a", 1), el("b", 1), el("c", 2), el("d", 3)]);
    expect(g.map((x) => [x.bloc, x.elements.map((e) => e.id)])).toEqual([
      [1, ["a", "b"]],
      [2, ["c"]],
      [3, ["d"]],
    ]);
    expect(nombreDeParties([el("a", 1), el("d", 3)])).toBe(3);
    expect(nombreDeParties([])).toBe(0);
  });
});

describe("↑ et ↓", () => {
  const seance = [el("a", 1), el("b", 1), el("c", 2)];

  it("↑ passe dans la partie précédente, et n'existe pas sur la première", () => {
    expect(blocsVoisins(seance[0], seance).haut).toBeNull();
    expect(blocsVoisins(seance[2], seance).haut).toBe(1);
  });

  it("↓ passe dans la suivante, ou ouvre une nouvelle partie après la dernière", () => {
    expect(blocsVoisins(seance[0], seance)).toMatchObject({ bas: 2, nouvelle: false });
    const avecVoisin = [...seance, el("d", 2)];
    expect(blocsVoisins(avecVoisin[2], avecVoisin)).toMatchObject({ bas: 3, nouvelle: true });
  });

  it("↓ ne s'offre pas à l'élément seul dans la dernière partie : rien ne changerait", () => {
    expect(blocsVoisins(seance[2], seance)).toMatchObject({ bas: null, nouvelle: false });
  });
});

describe("le menu d'ajout", () => {
  const ateliers = [
    { id: "at1", titre: "Lutte au sol", proposePar: "Chloé D.", sessionId: "s1" },
    { id: "at2", titre: "Rapière", proposePar: "Noé P.", sessionId: null },
  ];

  it("propose échauffement, cours, option, puis chaque atelier en attente avec son proposeur", () => {
    expect(entreesAjout(2, ateliers, "s1").map((e) => e.libelle)).toEqual([
      "Ajouter dans la partie 2…",
      "Échauffement",
      "Cours",
      "Option",
      "Atelier — Lutte au sol (Chloé D.) · souhaité ici",
      "Atelier — Rapière (Noé P.)",
    ]);
    expect(entreesAjout(1, [], "s1").map((e) => e.valeur)).toEqual(["", "ECHAUFFEMENT", "COURS", "OPTION"]);
  });

  it("traduit le choix en demande au serveur, et l'entrée de tête en rien", () => {
    expect(lireAjout("")).toBeNull();
    expect(lireAjout("OPTION")).toEqual({ nature: "OPTION" });
    expect(lireAjout("ATELIER")).toBeNull();
    expect(lireAjout("atelier:at2")).toEqual({ nature: "ATELIER", atelierId: "at2" });
    expect(lireAjout("atelier:")).toBeNull();
  });
});

describe("le retrait", () => {
  it("dit qu'un atelier repart dans les propositions en attente", () => {
    expect(confirmationRetrait("Partie 2 · Atelier", { titre: "Rapière" })).toMatch(/« Rapière ».*repart dans les propositions en attente/);
    expect(confirmationRetrait("Partie 1 · Cours", null)).toMatch(/seront perdus/);
  });
});

describe("l'écran", () => {
  const code = readFileSync(path.join(process.cwd(), "src/components/planning/ListeParties.tsx"), "utf8");

  it("n'a aucune liste native : le menu et la nature passent par ListeDeroulante", () => {
    expect(code).not.toMatch(/<select/);
    expect(code).toContain("<ListeDeroulante");
  });

  it("appelle les gestes du contrat : ajout par partie, changement de partie, retrait — jamais de changement de nature", () => {
    expect(code).toContain("ajouterPartie({ sessionId, bloc, ...ajout })");
    expect(code).toContain('ajouterPartie({ sessionId, bloc, nature: "COURS" })');
    expect(code).not.toContain("changerNaturePartie");
    expect(code).toContain("deplacerPartie({ partieId: partie.id, versBloc:");
    expect(code).toContain("retirerPartie({ partieId: partie.id })");
  });

  it("en lecture, saute l'élément sans rien à lire, et la partie qui n'en a plus", () => {
    expect(code).toContain("if (!modifiable && !partie.atelier && champsLus(partie).length === 0) return false;");
    expect(code).toContain(".filter((groupe) => groupe.elements.length > 0)");
  });

  it("ne dit « Partie N » que s'il y en a plusieurs : réelles en modification, affichées en lecture", () => {
    expect(code).toContain("partiesNommees(modifiable ? nbParties : groupes.length)");
    expect(code).toMatch(/\{intitules && \(\s*<h3/);
  });

  it("range la structure derrière « Modifier » / « Terminer », fermée par défaut", () => {
    expect(code).toContain("const [structure, setStructure] = useState(false);");
    expect(code).toContain("aria-pressed={ouvert}");
    expect(code).toContain('{ouvert ? "Terminer" : "Modifier"}');
    // Fermée : ni menu d'ajout par partie, ni ↑ ↓ Retirer ; « Ajouter une partie » reste.
    expect(code).toContain("{gestes && <AjouterDansPartie");
    expect(code).toContain("{gestes && <BoutonsElement");
    expect(code).toMatch(/\{modifiable && <PiedCarte /);
  });
});
