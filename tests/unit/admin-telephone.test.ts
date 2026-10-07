import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GROUPES_ADMIN, groupesVisibles, rubriquesVisibles } from "@/app/(app)/admin/menu-admin";

/**
 * **L'espace admin sur un téléphone** : un menu en liste à la place des dix onglets, une ligne fine
 * à la place du bandeau, et trois boutons par personne à la place de la liste déroulante des
 * présences. Au-dessus de 768 px, rien ne change.
 *
 * Deux natures de garde ici : la **règle** du menu (qui voit quoi) se pose directement au module
 * pur ; la **bascule** est une affaire de classes et de crochets, donc lue dans les sources, comme le
 * reste du dépôt le fait pour ce qui ne se vérifie pas sans navigateur.
 */

const RACINE = process.cwd();
const lire = (relatif: string) => fs.readFileSync(path.join(RACINE, relatif), "utf8");

const ADMIN_OUVERT = { role: "MEMBRE", estAdmin: true, sessionForte: true };

describe("le menu de l'espace admin", () => {
  it("range les dix rubriques en trois groupes, dans l'ordre des onglets", () => {
    const groupes = groupesVisibles(ADMIN_OUVERT);
    expect(groupes.map((g) => g.titre)).toEqual(["Le club au quotidien", "Réglages", "Sécurité"]);
    expect(groupes.map((g) => g.rubriques.map((r) => r.label))).toEqual([
      ["Périodes", "Membres", "Présences", "Thèmes et lieux"],
      ["Club", "Notifications", "Comptes admin"],
      ["Sessions", "Journal d'audit", "À propos"],
    ]);
    // Les onglets de l'ordinateur sont la même liste à plat : ni rubrique en plus, ni en moins.
    expect(rubriquesVisibles(ADMIN_OUVERT).map((r) => r.href)).toEqual(groupes.flatMap((g) => g.rubriques.map((r) => r.href)));
  });

  it("ne montre rien sans élévation, ni à qui n'est pas du bureau", () => {
    expect(groupesVisibles({ ...ADMIN_OUVERT, sessionForte: false })).toEqual([]);
    expect(groupesVisibles({ role: "INSTRUCTEUR", estAdmin: false, sessionForte: true })).toEqual([]);
    expect(groupesVisibles({ ...ADMIN_OUVERT, actif: false })).toEqual([]);
  });

  it("chaque rubrique déclare la permission que sa page exige", () => {
    for (const r of GROUPES_ADMIN.flatMap((g) => g.rubriques)) {
      const page = lire(`src/app/(app)${r.href}/page.tsx`);
      expect(page, r.href).toContain(`requirePermission("${r.permission}"`);
    }
  });
});

describe("la navigation de l'espace admin bascule à 768 px", () => {
  const LAYOUT = lire("src/app/(app)/admin/layout.tsx");
  const PAGE = lire("src/app/(app)/admin/page.tsx");
  const RETOUR = lire("src/app/(app)/admin/RetourMenuAdmin.tsx");

  it("les onglets se cachent sur le téléphone, « ‹ Admin » sur l'ordinateur", () => {
    expect(LAYOUT).toMatch(/<div className="tel:hidden">\s*<SousNav/);
    expect(LAYOUT).toContain("<RetourMenuAdmin />");
    expect(RETOUR).toContain('href="/admin"');
    expect(RETOUR).toContain("ordi:hidden");
    // Pas de retour vers le menu… sur le menu.
    expect(RETOUR).toContain('if (chemin === "/admin") return null;');
  });

  it("le bandeau garde un seul formulaire pour quitter, avec ses mots longs et courts", () => {
    expect(LAYOUT.match(/action=\{quitterEspaceAdmin\}/g) ?? []).toHaveLength(1);
    expect(LAYOUT).toContain("Admin ouvert");
    expect(LAYOUT).toContain("se referme seul");
    expect(LAYOUT).toContain("Connecté(e) en tant qu&apos;administrateur");
  });

  it("l'accueil `/admin` montre le menu au téléphone et renvoie l'ordinateur vers les périodes", () => {
    expect(PAGE).toContain('<div className="flex flex-col gap-5 ordi:hidden">');
    expect(PAGE).toContain("groupesVisibles(user)");
    expect(lire("src/app/(app)/admin/VersRubriqueSurOrdinateur.tsx")).toContain("router.replace(vers)");
  });
});

describe("corriger une présence au téléphone : trois boutons par personne", () => {
  const CODE = lire("src/components/gestion/PresencesEquipe.tsx");

  it("bascule par le crochet partagé, et garde la liste déroulante au-dessus", () => {
    expect(CODE).toContain('import { useEcranTelephone } from "@/components/ui/useEcranTelephone";');
    expect(CODE).toMatch(/\{telephone \? \(/);
    expect(CODE).toContain("<ListeDeroulante");
  });

  it("trois boutons Présent / Peut-être / Absent, nommés et pressés", () => {
    for (const icone of ['icone: "check"', 'icone: "question"', 'icone: "croix"']) expect(CODE).toContain(icone);
    expect(CODE).toContain("aria-pressed={plein}");
    expect(CODE).toContain("aria-label={`${STATUT_LABELS[b.statut]} — ${p.prenom} ${p.nom}`}");
    // 44 px : la cible minimale, et quatre pixels de chaque bouton rendus au nom, qui ne se coupe jamais.
    expect(CODE).toContain("grid size-11 place-items-center");
  });

  it("le même geste que la liste, et l'appui sur le bouton plein efface la réponse", () => {
    // `changer` est la seule écriture unitaire : mêmes verrous, même optimisme, même retour d'erreur.
    expect(CODE).toContain('onClick={() => changer(p, plein ? "" : b.statut)}');
    expect(CODE).toContain("onChoisir={(v) => changer(p, v)}");
  });
});
