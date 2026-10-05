import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { gesteRouge } from "@/components/ui/choix-geste";
import { de, gestesFiche, type DroitsFiche, type PersonneFiche } from "@/app/(app)/admin/membres/gestes-fiche";

/**
 * **La fiche d'un membre pose « Que veux-tu faire ? »** : seulement les gestes qui s'appliquent à
 * cette personne, chacun expliqué, un bouton qui la nomme, rouge pour ce qui révoque, réinitialise ou
 * supprime, et les confirmations d'avant.
 */

const source = (f: string) => readFileSync(path.join(process.cwd(), f), "utf8");

const TOUS: DroitsFiche = { inviter: true, reinitialiser: true, activer: true, supprimer: true };

const personne = (autre: Partial<PersonneFiche> = {}): PersonneFiche => ({
  prenom: "Ondine",
  nom: "Vasseur",
  actif: true,
  aUnEmail: true,
  dejaEntre: false,
  recoitInvitation: true,
  estAdmin: false,
  reponses: 0,
  aEffacer: [],
  periodeLien: { nom: "T4 2026" },
  ...autre,
});

const noms = (p: PersonneFiche, d = TOUS) => gestesFiche(p, d).map((g) => g.geste);

describe("les gestes proposés sur la fiche", () => {
  it("à qui n'est jamais entré : l'invitation, pas la remise à zéro", () => {
    expect(noms(personne())).toEqual(["inviter", "desactiver", "supprimer"]);
  });

  it("à qui est déjà installé : la remise à zéro, pas l'invitation", () => {
    expect(noms(personne({ dejaEntre: true }))).toEqual(["reinitialiser", "desactiver", "supprimer"]);
  });

  it("désactiver ou réactiver, selon l'état du compte — jamais les deux", () => {
    expect(noms(personne({ actif: false }))).toEqual(["reactiver", "supprimer"]);
  });

  it("pas d'invitation sans adresse, sans période active, ni à un compte désactivé", () => {
    expect(noms(personne({ aUnEmail: false }))).not.toContain("inviter");
    expect(noms(personne({ periodeLien: null }))).not.toContain("inviter");
    expect(noms(personne({ actif: false }))).not.toContain("inviter");
  });

  it("taisent ce que l'acteur ne peut pas faire sur ce compte", () => {
    expect(noms(personne(), { inviter: false, reinitialiser: false, activer: false, supprimer: false })).toEqual([]);
    expect(noms(personne({ dejaEntre: true }), { ...TOUS, reinitialiser: false })).toEqual(["desactiver", "supprimer"]);
  });
});

describe("dans le volet « Gérer » de l'annuaire", () => {
  const VOLET: DroitsFiche = { ...TOUS, renvoyer: true, revoquer: true };

  it("ajoute le lien de la période active : envoyer ou renvoyer, et révoquer s'il vit", () => {
    expect(noms(personne({ dejaEntre: true, lienEnCours: true }), VOLET)).toEqual(["renvoyer", "revoquer", "reinitialiser", "desactiver", "supprimer"]);
    const [renvoyer] = gestesFiche(personne({ lienEnCours: true }), VOLET);
    expect(renvoyer.bouton).toBe("Renvoyer le lien à Ondine");
    const [envoyer] = gestesFiche(personne({ lienEnCours: false }), VOLET);
    expect(envoyer.bouton).toBe("Envoyer le lien à Ondine");
    expect(envoyer.confirmation).toBeUndefined();
  });

  it("pas de lien sans période active, ni à un compte désactivé", () => {
    expect(noms(personne({ periodeLien: null, lienEnCours: true }), VOLET)).not.toContain("renvoyer");
    expect(noms(personne({ periodeLien: null, lienEnCours: true }), VOLET)).not.toContain("revoquer");
    expect(noms(personne({ actif: false }), VOLET)).not.toContain("renvoyer");
  });

  it("garde les questions que le volet posait déjà", () => {
    const supprimer = gestesFiche(personne(), VOLET, { supprimer: "Ancienne question ?" }).at(-1)!;
    expect(supprimer.confirmation).toBe("Ancienne question ?");
  });

  it("la page de l'annuaire s'en sert", () => {
    const code = source("src/app/(app)/admin/membres/page.tsx");
    expect(code).toContain("<GestesProposes id={`geste-ligne-${m.id}`}");
    expect(code).toContain("texteConfirmationReinitialisationUnitaire(nomComplet");
  });
});

describe("leurs mots", () => {
  it("le bouton nomme la personne ; révoquer, réinitialiser, désactiver et supprimer sont rouges", () => {
    const gestes = gestesFiche(personne({ dejaEntre: true }), TOUS);
    expect(gestes.map((g) => g.bouton)).toEqual(["Réinitialiser l'accès d'Ondine", "Désactiver le compte d'Ondine", "Supprimer Ondine Vasseur"]);
    expect(gestes.filter((g) => g.definitif).map((g) => g.geste)).toEqual(["reinitialiser", "desactiver", "supprimer"]);
    const avecLien = gestesFiche(personne({ lienEnCours: true }), { ...TOUS, renvoyer: true, revoquer: true });
    expect(avecLien.filter((g) => g.definitif).map((g) => g.geste)).toContain("revoquer");
    // La règle commune : rouge si et seulement si le libellé commence par un verbe du rouge.
    for (const g of [...gestes, ...avecLien, ...gestesFiche(personne({ actif: false }), TOUS)]) {
      expect(Boolean(g.definitif), g.geste).toBe(gesteRouge(g.bouton));
    }
  });

  it("gardent les confirmations de la fiche", () => {
    const [reinit, desactiver, supprimer] = gestesFiche(personne({ dejaEntre: true }), TOUS);
    expect(reinit.confirmation).toMatch(/^Remettre à zéro l'accès de Ondine Vasseur \?/);
    expect(desactiver.confirmation).toBe("Désactiver le compte de Ondine ? Il ne pourra plus se connecter.");
    expect(supprimer.confirmation).toBe("Supprimer définitivement Ondine Vasseur et tout son historique ?");
    const [reactiver] = gestesFiche(personne({ actif: false }), TOUS);
    expect(reactiver.confirmation).toBeUndefined();
  });

  it("la remise à zéro n'énumère que ce qui existe, et dit si un email part", () => {
    const [avec] = gestesFiche(personne({ dejaEntre: true, aEffacer: ["le mot de passe", "les liens en cours"] }), TOUS);
    expect(avec.explication.phrases[0]).toMatch(/^Cela efface le mot de passe et les liens en cours, et déconnecte/);
    expect(avec.explication.phrases[1]).toContain("1 email partira.");
    const [sans] = gestesFiche(personne({ dejaEntre: true, recoitInvitation: false }), TOUS);
    expect(sans.explication.phrases[0]).toMatch(/^Cela déconnecte/);
    expect(sans.explication.phrases[1]).toMatch(/^Rien ne partira/);
  });

  it("la suppression chiffre les réponses perdues et nomme le bureau", () => {
    const supprimer = gestesFiche(personne({ reponses: 7, estAdmin: true }), TOUS).at(-1)!;
    expect(supprimer.explication.phrases).toContain("7 réponses de présence seront perdues.");
    expect(supprimer.explication.phrases.join(" ")).toContain("Du bureau");
  });

  it("élide devant une voyelle", () => {
    expect(de("Ondine")).toBe("d'Ondine");
    expect(de("Paul")).toBe("de Paul");
    // Prénoms fictifs, absents du jeu du club : le miroir public remplace les vrais, et l'élision
    // d'un prénom remplacé ne se vérifierait plus.
  });
});

describe("la page", () => {
  it("passe par la forme commune ; le seul rouge écrit est « Révoquer » le lien d'une période", () => {
    const code = source("src/app/(app)/admin/membres/[id]/page.tsx");
    expect(code).toContain("<GestesProposes");
    expect(code.match(/variante="danger"/g)).toHaveLength(1);
    expect(code).not.toContain('variante="succes"');
  });
});
