import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { gestesTousApplicables, gestesTousProposes, type ChiffresTous } from "@/app/(app)/admin/membres/choix-geste";

/**
 * **L'annuaire, la fiche d'une personne et « Mon historique » au téléphone** (sous 768 px ; au-delà,
 * rien ne change). La règle des gestes « Pour tout le monde » se pose au module pur ; la bascule est
 * une affaire de classes et de crochets, donc lue dans les sources, comme le reste du dépôt le fait
 * pour ce qui ne se vérifie pas sans navigateur.
 */

const RACINE = process.cwd();
const lire = (relatif: string) => fs.readFileSync(path.join(RACINE, relatif), "utf8");
const LISTE = lire("src/app/(app)/admin/membres/page.tsx");
const FICHE = lire("src/app/(app)/admin/membres/[id]/page.tsx");
const HISTORIQUE = lire("src/components/presences/Historique.tsx");

const CHIFFRES: ChiffresTous = {
  inviter: 2,
  dejaEntres: 3,
  renvoyer: 5,
  revoquer: 4,
  reinitialiser: 3,
  reinitialiserEmails: 1,
  jamaisEntres: 2,
  desactiver: 6,
  reactiver: 0,
  periode: "Rentrée",
};

describe("les gestes sur tout le club, composés une fois pour deux volets", () => {
  it("ne propose que les gestes dont l'action est liée, avec la confirmation de l'écran", () => {
    const action = async () => undefined;
    const prets = gestesTousProposes(CHIFFRES, { renvoyer: action, desactiver: action }, { renvoyer: "Renvoyer ?", desactiver: "Désactiver ?" });
    expect(prets.map((g) => g.geste)).toEqual(["renvoyer", "desactiver"]);
    expect(prets.map((g) => g.confirmation)).toEqual(["Renvoyer ?", "Désactiver ?"]);
    // Les mots sont ceux du volet de l'ordinateur, à l'identique.
    const mots = gestesTousApplicables(CHIFFRES);
    for (const g of prets) expect(g.libelle).toBe(mots.find((m) => m.geste === g.geste)!.libelle);
    // Jamais de message vide après coup.
    expect(prets.every((g) => g.fait.length > 0)).toBe(true);
  });

  it("le volet de l'ordinateur et celui du téléphone partagent chiffres, actions et confirmations", () => {
    expect(LISTE).toContain("<ChoixToutLeMonde chiffres={chiffresTous} actions={actionsTous} confirmations={confirmationsTous} />");
    expect(LISTE).toContain("gestesTousProposes(chiffresTous, actionsTous, confirmationsTous)");
  });
});

describe("l'annuaire au téléphone", () => {
  it("une ligne par personne : l'adresse part dans la fiche, « Gérer » se cache, la ligne entière mène à la fiche", () => {
    expect(LISTE).toMatch(/row-start-2 text-sm text-texte-secondaire tel:hidden/);
    expect(LISTE).toContain('<div className="flex lg:justify-end tel:hidden">');
    expect(LISTE).toContain("tel:after:absolute tel:after:inset-0");
    // Sauf quand la ligne porte sa case : la sélection multiple garde la main (`ZoneCochable`).
    expect(LISTE).toContain("tel:group-has-[[data-case-selection]]/ligne:after:hidden");
  });

  it("« + Ajouter » range les deux formulaires d'ajout, écrits une seule fois", () => {
    expect(LISTE).toContain('{ cle: "personne", libelle: "Une personne"');
    expect(LISTE).toContain('{ cle: "csv", libelle: "Un fichier CSV"');
    // Un seul formulaire `creerMembre` dans la source : l'ordinateur et le volet rendent le même.
    expect(LISTE.match(/action=\{creerMembre\}/g) ?? []).toHaveLength(1);
    expect(LISTE).toMatch(/<HorsTelephone>\s*<div className="grid gap-5 lg:grid-cols-2">/);
  });
});

describe("la fiche d'une personne au téléphone", () => {
  it("le rôle de base en curseur à deux positions, même action que l'annuaire", () => {
    expect(FICHE).toMatch(/<SelecteurRole[^>]*presentation="curseur"/);
    const selecteur = lire("src/app/(app)/admin/membres/SelecteurRole.tsx");
    expect(selecteur.match(/definirRoleMembre\(/g) ?? []).toHaveLength(1);
    // Le miroir du serveur vaut pour les deux présentations.
    expect(selecteur).toContain("if (vuDuServeur !== role)");
    // Le curseur se lit comme un choix à deux, posé sur le rôle actuel, et relit la fiche.
    expect(selecteur).toContain('role="radiogroup"');
    expect(selecteur).toContain("aria-checked={choisi}");
    expect(selecteur).toContain('presentation === "curseur" || rafraichir');
  });

  it("la saison d'arrivée est visible au téléphone, enregistrée au choix sous les verrous de la fiche", () => {
    expect(FICHE).toMatch(/<SelecteurSaison[\s\S]*?entrees=\{entreesSaison\}/);
    const action = lire("src/actions/membres.ts");
    const corps = action.slice(action.indexOf("export async function definirSaisonMembre"));
    expect(corps).toMatch(/assertPermission\("members\.manage"\)/);
    expect(corps).toMatch(/canEditUser\(acteur, cible\)/);
    expect(corps).toMatch(/ERREUR_PORTAIL_IDENTITE/);
  });

  it("« Renvoyer le lien » reprend l'action et la confirmation de la ligne de la période", () => {
    expect(FICHE.match(/L'ancien lien cessera de fonctionner\./g) ?? []).toHaveLength(2);
    expect(FICHE.match(/envoyerLienMembre\.bind\(null, m\.id, (p|periodeLien)\.id, `\/admin\/membres\/\$\{m\.id\}`\)/g) ?? []).toHaveLength(2);
  });

  it("les gestes rares derrière « ⋯ », et les cartes en liste groupée", () => {
    expect(FICHE).toContain('libelleAccessible="Autres gestes"');
    expect(FICHE).toContain("gestes={gestes}");
    expect(FICHE.match(/action=\{modifierMembre\.bind/g) ?? []).toHaveLength(1);
    expect(FICHE).toContain('<LigneDepliable ancre="notifications"');
    expect(FICHE).toContain('<LigneDepliable ancre="liens"');
  });
});

describe("« Mon historique » au téléphone", () => {
  it("« Ma présence ce trimestre » en tête, sur le chiffre de l'en-tête de la période", () => {
    expect(HISTORIQUE).toContain('libelle="Ma présence ce trimestre"');
    expect(HISTORIQUE).toContain("valeur={`${enCours.pourcentage} %`}");
    // Le même chiffre que l'en-tête de la période plus bas : rien n'est recompté.
    expect(HISTORIQUE).toContain("{p.pourcentage}&nbsp;%");
    expect(HISTORIQUE).toContain('<ul className="ordi:hidden">');
  });
});
