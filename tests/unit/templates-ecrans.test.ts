import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { pasVoisins } from "@/components/planning/parties-carte";
import { ELEMENTS_TEMPLATE_MAX, type ElementTemplate } from "@/lib/templates";
import {
  ajouterElement,
  deplacerLigne,
  lignesDepuis,
  memeProgramme,
  modifierLigne,
  resumeProgramme,
  retirerLigne,
  versElements,
  type LigneProgramme,
} from "@/app/(app)/admin/templates/programme-template";

/**
 * **Les écrans des templates de cours** (`/admin/templates`, `/admin/templates/[id]`) : le résumé de la
 * liste, la mécanique de l'éditeur de programme, et deux garde-fous de source — le composant client
 * n'entraîne pas la base dans le paquet du navigateur, et aucune liste native n'y revient.
 */

const el = (bloc: number, nature: ElementTemplate["nature"], theme = "", extra: Partial<ElementTemplate> = {}): ElementTemplate => ({
  bloc,
  nature,
  theme,
  niveau: "INDIFFERENT",
  description: "",
  instructeurId: null,
  instructeurSecondId: null,
  ...extra,
});

/** Ce qui compte pour lire un programme : partie, nature, thème — dans l'ordre. */
const forme = (l: readonly LigneProgramme[]) => l.map((x) => `${x.bloc}:${x.nature}:${x.theme}`);

describe("résumé d'un template sur la liste", () => {
  it("une seule partie : pas d'intitulé « Partie 1 », comme le reste de l'application", () => {
    expect(resumeProgramme([el(1, "ECHAUFFEMENT", "Footwork"), el(1, "COURS", "Messer")])).toEqual(["Échauffement — Footwork · Cours — Messer"]);
  });

  it("plusieurs parties : une ligne par partie, chacune nommée", () => {
    expect(resumeProgramme([el(1, "ECHAUFFEMENT", "Footwork"), el(1, "COURS", "Messer"), el(2, "COURS", "Épée longue"), el(2, "OPTION")])).toEqual([
      "Partie 1 · Échauffement — Footwork · Cours — Messer",
      "Partie 2 · Cours — Épée longue · Option",
    ]);
  });

  it("numérote deux éléments de même nature dans une partie, et pas un seul", () => {
    expect(resumeProgramme([el(1, "COURS", "Messer"), el(1, "COURS", "Dague")])).toEqual(["Cours 1 — Messer · Cours 2 — Dague"]);
  });

  it("un programme vide ne résume rien", () => {
    expect(resumeProgramme([])).toEqual([]);
  });
});

describe("éditeur du programme", () => {
  const depart = () => lignesDepuis([el(1, "COURS", "Messer")]);

  it("un échauffement ajouté se pose en tête de sa partie, une option en fin", () => {
    let l = ajouterElement(depart(), 1, "OPTION", "a");
    l = ajouterElement(l, 1, "ECHAUFFEMENT", "b");
    expect(forme(l)).toEqual(["1:ECHAUFFEMENT:", "1:COURS:Messer", "1:OPTION:"]);
  });

  it("une partie nouvelle naît en fin de programme", () => {
    const l = ajouterElement(depart(), 2, "COURS", "a");
    expect(forme(l)).toEqual(["1:COURS:Messer", "2:COURS:"]);
  });

  it("ne dépasse pas le plafond du serveur", () => {
    let l = depart();
    for (let i = 0; i < ELEMENTS_TEMPLATE_MAX + 5; i++) l = ajouterElement(l, 1, "COURS", `n${i}`);
    expect(l).toHaveLength(ELEMENTS_TEMPLATE_MAX);
  });

  it("↑ ↓ suivent les pas du planning, et une partie vidée disparaît", () => {
    const l = lignesDepuis([el(1, "COURS", "A"), el(2, "COURS", "B"), el(2, "OPTION", "C")]);
    const reperes = l.map((x) => ({ id: x.cle, bloc: x.bloc }));
    // « B », en tête de la partie 2, passe à la fin de la partie 1.
    const haut = pasVoisins({ id: l[1].cle, bloc: 2 }, reperes).haut!;
    expect(forme(deplacerLigne(l, l[1].cle, haut))).toEqual(["1:COURS:A", "1:COURS:B", "2:OPTION:C"]);
    // « A », seul dans la partie 1, descend au début de la partie 2 : la partie 1 disparaît.
    const bas = pasVoisins({ id: l[0].cle, bloc: 1 }, reperes).bas!;
    expect(forme(deplacerLigne(l, l[0].cle, bas))).toEqual(["1:COURS:A", "1:COURS:B", "1:OPTION:C"]);
    // « C », dernier de la dernière partie qui n'est pas seul, part dans une partie nouvelle.
    const nouvelle = pasVoisins({ id: l[2].cle, bloc: 2 }, reperes).bas!;
    expect(forme(deplacerLigne(l, l[2].cle, nouvelle))).toEqual(["1:COURS:A", "2:COURS:B", "3:OPTION:C"]);
  });

  it("le dernier élément ne se retire pas, et les parties se renumérotent", () => {
    expect(retirerLigne(depart(), "l0")).toHaveLength(1);
    const l = lignesDepuis([el(1, "COURS", "A"), el(2, "COURS", "B"), el(3, "COURS", "C")]);
    expect(forme(retirerLigne(l, "l1"))).toEqual(["1:COURS:A", "2:COURS:C"]);
  });

  it("le premier instructeur qui s'efface emporte le second", () => {
    let l = modifierLigne(depart(), "l0", { instructeurId: "u1" });
    l = modifierLigne(l, "l0", { instructeurSecondId: "u2" });
    expect(l[0].instructeurSecondId).toBe("u2");
    expect(modifierLigne(l, "l0", { instructeurId: null })[0].instructeurSecondId).toBeNull();
    // Le premier qui devient le second libère la place : on ne s'assiste pas soi-même.
    expect(modifierLigne(l, "l0", { instructeurId: "u2" })[0].instructeurSecondId).toBeNull();
  });

  it("le thème effacé emporte niveau et description, sauf pendant la frappe d'un thème libre", () => {
    const l = modifierLigne(depart(), "l0", { niveau: "AVANCE", description: "Coupes hautes" });
    expect(modifierLigne(l, "l0", { theme: "" }, false)[0]).toMatchObject({ niveau: "AVANCE", description: "Coupes hautes" });
    expect(modifierLigne(l, "l0", { theme: "" })[0]).toMatchObject({ niveau: "INDIFFERENT", description: "" });
    // Et ce qui ne se voit plus ne part pas au serveur.
    expect(versElements(modifierLigne(l, "l0", { theme: "  " }, false))[0]).toMatchObject({ theme: "", niveau: "INDIFFERENT", description: "" });
    // La clé locale reste dans le navigateur.
    expect(Object.keys(versElements(l)[0])).not.toContain("cle");
  });

  it("n'annonce une modification que si le serveur écrirait autre chose", () => {
    const serveur = [el(1, "COURS", "Messer")];
    const l = lignesDepuis(serveur);
    expect(memeProgramme(versElements(l), serveur)).toBe(true);
    const ajoute = ajouterElement(l, 1, "OPTION", "a");
    expect(memeProgramme(versElements(ajoute), serveur)).toBe(false);
    // Ajouter puis retirer : rien à enregistrer.
    expect(memeProgramme(versElements(retirerLigne(ajoute, "a")), serveur)).toBe(true);
    // Un espace de bord n'est pas une modification : le schéma le retirera.
    expect(memeProgramme(versElements(modifierLigne(l, "l0", { theme: "Messer " }, false)), serveur)).toBe(true);
  });
});

describe("garde-fous de source", () => {
  const RACINE = path.join(process.cwd(), "src/app/(app)/admin/templates");
  const fichiers = (dossier: string): string[] =>
    fs.readdirSync(dossier, { withFileTypes: true }).flatMap((e) => {
      const complet = path.join(dossier, e.name);
      // `appliquer/` appartient à un autre écran : il a ses propres tests.
      if (e.isDirectory()) return e.name === "appliquer" ? [] : fichiers(complet);
      return /\.tsx?$/.test(e.name) ? [complet] : [];
    });
  const tous = fichiers(RACINE);
  const lire = (f: string) => fs.readFileSync(f, "utf8");

  it("trouve bien les écrans", () => {
    expect(tous.map((f) => path.relative(RACINE, f)).sort()).toEqual(
      expect.arrayContaining(["page.tsx", "FormulaireTemplate.tsx", "[id]/page.tsx", "[id]/EditeurProgramme.tsx", "programme-template.ts"]),
    );
  });

  it("aucun composant client n'importe la base ni les réglages (paquet du navigateur)", () => {
    const clients = tous.filter((f) => lire(f).startsWith('"use client"'));
    expect(clients.length).toBeGreaterThan(0);
    for (const f of clients) {
      const code = lire(f);
      expect(code, f).not.toMatch(/from "@\/lib\/(planning|db|settings)"/);
    }
    // Le module pur que l'éditeur importe ne doit pas non plus les entraîner.
    expect(lire(path.join(RACINE, "programme-template.ts"))).not.toMatch(/from "@\/lib\/(planning|db|settings)"/);
  });

  it("pas de liste native : tout passe par ListeDeroulante / ChampListe", () => {
    for (const f of tous) expect(lire(f), f).not.toMatch(/<select\b/);
  });
});
