import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CHOIX_VIDE,
  entreesGestes,
  expliquerGeste,
  gesteRetenu,
  gestesApplicables,
  gestesTousApplicables,
  libelleBouton,
  libelleOption,
  messageApres,
  nomsCourts,
  varianteBouton,
  type ChiffresTous,
  type DroitsSelection,
  type LigneChoix,
} from "@/app/(app)/admin/membres/choix-geste";

/**
 * **« Que veux-tu faire ? » : la barre de sélection de l'annuaire ne propose que ce qui s'applique.**
 *
 * Elle alignait tous ses boutons, quelle que soit la sélection — « Réactiver » en vert devant des
 * comptes actifs, « Envoyer l'invitation » devant des gens déjà entrés. Ce fichier garde les trois
 * promesses du nouveau motif : la liste ne montre que les gestes qui toucheraient quelqu'un (avec le
 * bon nombre, celui des filtres du serveur), le bouton dit le verbe et le nombre, et l'explication dit
 * à qui, qui reste de côté, et s'il part des emails.
 */

const source = (f: string) => readFileSync(path.join(process.cwd(), f), "utf8");

const ligne = (nom: string, autre: Partial<LigneChoix> = {}): LigneChoix => ({
  id: nom.toLowerCase().replace(/\s+/g, "-"),
  nom,
  role: "MEMBRE",
  actif: true,
  reponses: 0,
  estAdmin: false,
  aUnEmail: true,
  lienEnCours: true,
  dejaEntre: false,
  recoitInvitation: true,
  ...autre,
});

const TOUS_DROITS: DroitsSelection = { liens: true, activer: true, supprimer: true };

/** Le cas de la maquette : deux personnes jamais entrées, une déjà installée, personne de désactivé. */
const CAS = [ligne("Bravo 02"), ligne("Alpha 01"), ligne("Charlie 03", { dejaEntre: true })];

describe("les gestes proposés", () => {
  it("ne montrent que ce qui toucherait quelqu'un, avec le nombre de personnes", () => {
    const g = gestesApplicables(CAS, TOUS_DROITS);
    expect(g.map((x) => [x.geste, x.nombre])).toEqual([
      ["inviter", 2],
      ["renvoyer", 3],
      ["revoquer", 3],
      ["reinitialiser", 1],
      ["desactiver", 3],
      // Personne n'est désactivé : « Réactiver » disparaît.
      ["role", 3],
      ["supprimer", 3],
    ]);
    expect(g[0].libelle).toBe("Envoyer l'invitation (2 personnes)");
    expect(g.find((x) => x.geste === "reinitialiser")?.libelle).toBe("Réinitialiser les accès (1 personne)");
  });

  it("gardent la suppression en dernier", () => {
    const g = gestesApplicables([ligne("A", { actif: false })], TOUS_DROITS);
    expect(g.at(-1)?.geste).toBe("supprimer");
    expect(g.map((x) => x.geste)).toContain("reactiver");
    expect(g.map((x) => x.geste)).not.toContain("desactiver");
  });

  it("comptent comme le serveur : invitation aux seuls jamais entrés, actifs, avec une adresse", () => {
    const lot = [
      ligne("Jamais", {}),
      ligne("Entré", { dejaEntre: true }),
      ligne("Coupé", { actif: false }),
      ligne("Sans adresse", { aUnEmail: false }),
    ];
    const g = Object.fromEntries(gestesApplicables(lot, TOUS_DROITS).map((x) => [x.geste, x.nombre]));
    expect(g.inviter).toBe(1);
    // Le renvoi part aux actifs avec une adresse, déjà entrés compris.
    expect(g.renvoyer).toBe(2);
    expect(g.reinitialiser).toBe(1);
    expect(g.desactiver).toBe(3);
    expect(g.reactiver).toBe(1);
  });

  it("ne proposent la révocation qu'à qui a un lien vivant", () => {
    const g = gestesApplicables([ligne("A", { lienEnCours: false }), ligne("B", { lienEnCours: false })], TOUS_DROITS);
    expect(g.map((x) => x.geste)).not.toContain("revoquer");
  });

  it("taisent ce que l'acteur n'a pas le droit de faire", () => {
    const g = gestesApplicables(CAS, { liens: false, activer: false, supprimer: false }).map((x) => x.geste);
    expect(g).toEqual(["reinitialiser", "role"]);
  });

  it("n'existent pas sans sélection", () => {
    expect(gestesApplicables([], TOUS_DROITS)).toEqual([]);
  });

  it("ouvrent la liste sur « Choisir une action… »", () => {
    const entrees = entreesGestes(gestesApplicables(CAS, TOUS_DROITS));
    expect(entrees[0]).toEqual({ valeur: "", libelle: "Choisir une action…" });
    expect(entrees[1]).toEqual({ valeur: "inviter", libelle: "Envoyer l'invitation (2 personnes)" });
  });

  it("reviennent à « Choisir une action… » quand le geste choisi ne s'applique plus", () => {
    const avant = gestesApplicables(CAS, TOUS_DROITS);
    expect(gesteRetenu("inviter", avant)).toBe("inviter");
    // On décoche les deux jamais entrés : plus personne à inviter.
    const apres = gestesApplicables([CAS[2]], TOUS_DROITS);
    expect(gesteRetenu("inviter", apres)).toBe(CHOIX_VIDE.valeur);
    expect(gesteRetenu("", apres)).toBe("");
  });
});

describe("le bouton", () => {
  it("dit le verbe et le nombre", () => {
    expect(libelleBouton("inviter", 2)).toBe("Envoyer 2 invitations");
    expect(libelleBouton("inviter", 1)).toBe("Envoyer 1 invitation");
    expect(libelleBouton("renvoyer", 3)).toBe("Renvoyer 3 liens");
    expect(libelleBouton("revoquer", 3)).toBe("Révoquer 3 liens");
    expect(libelleBouton("reinitialiser", 1)).toBe("Réinitialiser 1 accès");
    expect(libelleBouton("desactiver", 3)).toBe("Désactiver 3 comptes");
    expect(libelleBouton("reactiver", 1)).toBe("Réactiver 1 compte");
    expect(libelleBouton("supprimer", 3)).toBe("Supprimer 3 comptes");
  });

  it("compte, pour le rôle, ceux qui changent vraiment", () => {
    expect(libelleBouton("role", 3)).toBe("Changer le rôle");
    expect(libelleBouton("role", 3, { libelle: "Instructeur", changent: 2 })).toBe("Passer 2 comptes en Instructeur");
  });

  it("est rouge pour révoquer, réinitialiser, désactiver et supprimer, et pour rien d'autre", () => {
    for (const g of ["revoquer", "reinitialiser", "desactiver", "supprimer"] as const) expect(varianteBouton(g), g).toBe("danger");
    for (const g of ["", "inviter", "renvoyer", "reactiver", "role"] as const) {
      expect(varianteBouton(g), g).toBe("primaire");
    }
  });

  it("n'a plus de vert ni de rouge permanents dans la barre", () => {
    const code = source("src/app/(app)/admin/membres/SelectionRoles.tsx");
    expect(code).not.toMatch(/variante="(succes|danger)"/);
    expect(code).toContain("varianteBouton(geste)");
    // La confirmation de chaque geste reste : l'explication la précède, elle ne la remplace pas.
    expect(code).toContain("texteConfirmationGeste(");
    expect(code).toContain("texteConfirmationReinitialisation(");
  });
});

describe("l'explication", () => {
  it("nomme les gens, tronque au-delà de trois", () => {
    expect(nomsCourts(["Anne"])).toBe("Anne");
    expect(nomsCourts(["Anne", "Paul"])).toBe("Anne et Paul");
    expect(nomsCourts(["Anne", "Paul", "Zoé"])).toBe("Anne, Paul et Zoé");
    expect(nomsCourts(["Anne", "Paul", "Zoé", "Luc", "Léa"])).toBe("Anne, Paul, Zoé et 2 autres");
    expect(nomsCourts(["Anne", "Paul", "Zoé", "Luc"])).toBe("Anne, Paul, Zoé et 1 autre");
  });

  it("dit à qui part l'invitation, qui reste de côté et pourquoi", () => {
    const e = expliquerGeste("inviter", CAS);
    expect(e.titre).toBe("Envoyer l'invitation à Bravo 02 et Alpha 01");
    const texte = e.phrases.join(" ");
    expect(texte).toContain("Rien n'est effacé.");
    expect(texte).toContain("2 emails partiront.");
    expect(texte).toMatch(/Rien ne change pour Charlie 03 \(accès déjà installé/);
  });

  it("annonce les emails du renvoi et les comptes écartés", () => {
    const e = expliquerGeste("renvoyer", [ligne("A"), ligne("B", { actif: false }), ligne("C", { aUnEmail: false })]);
    expect(e.titre).toBe("Renvoyer le lien à A");
    expect(e.phrases).toContain("1 email partira.");
    expect(e.phrases.join(" ")).toContain("B (compte désactivé");
    expect(e.phrases.join(" ")).toContain("C (pas d'adresse email)");
  });

  it("dit qu'une révocation n'envoie rien", () => {
    const e = expliquerGeste("revoquer", [ligne("A"), ligne("B", { lienEnCours: false })]);
    expect(e.titre).toBe("Révoquer le lien de A");
    expect(e.phrases).toContain("Aucun email ne part.");
    expect(e.phrases.join(" ")).toContain("B (aucun lien en cours)");
  });

  it("dit ce que la réinitialisation efface, et qui ne recevra rien", () => {
    const e = expliquerGeste("reinitialiser", [ligne("A", { dejaEntre: true }), ligne("B", { dejaEntre: true, recoitInvitation: false }), ligne("C")]);
    const texte = e.phrases.join(" ");
    expect(e.titre).toBe("Réinitialiser les accès de A et B");
    expect(texte).toContain("efface le mot de passe et la double authentification");
    expect(texte).toContain("1 email partira.");
    expect(texte).toContain("Rien ne partira pour B");
    expect(texte).toContain("C (accès jamais installé");
  });

  it("nomme le bureau quand on désactive un administrateur", () => {
    const e = expliquerGeste("desactiver", [ligne("A", { estAdmin: true }), ligne("B", { actif: false })]);
    expect(e.titre).toBe("Désactiver le compte de A");
    expect(e.phrases.join(" ")).toContain("Du bureau : A.");
    expect(e.phrases.join(" ")).toContain("B (compte déjà désactivé)");
  });

  it("chiffre ce qu'une suppression détruit", () => {
    const e = expliquerGeste("supprimer", [ligne("A", { reponses: 4 }), ligne("B", { reponses: 1 })]);
    expect(e.titre).toBe("Supprimer définitivement A et B");
    expect(e.phrases.join(" ")).toContain("irréversible");
    expect(e.phrases).toContain("5 réponses de présence seront perdues.");
  });

  it("attend le rôle avant de dire qui change", () => {
    const lot = [ligne("A"), ligne("B", { role: "INSTRUCTEUR" })];
    expect(expliquerGeste("role", lot).phrases[0]).toMatch(/Choisis le nouveau rôle/);
    const e = expliquerGeste("role", lot, { valeur: "INSTRUCTEUR", libelle: "Instructeur" });
    expect(e.titre).toBe("Passer A en « Instructeur »");
    expect(e.phrases.join(" ")).toContain("B (déjà « Instructeur »)");
    expect(expliquerGeste("role", [lot[1]], { valeur: "INSTRUCTEUR", libelle: "Instructeur" }).phrases).toEqual(["Rien ne changera : choisis un autre rôle."]);
  });
});

describe("« Pour tout le monde »", () => {
  const chiffres: ChiffresTous = {
    inviter: 2,
    dejaEntres: 5,
    renvoyer: 7,
    revoquer: 0,
    reinitialiser: 5,
    reinitialiserEmails: 4,
    jamaisEntres: 2,
    desactiver: 7,
    reactiver: 0,
    periode: "T4 2026",
  };

  it("ne propose que les gestes à au moins une personne, jamais la suppression", () => {
    const g = gestesTousApplicables(chiffres);
    expect(g.map((x) => x.geste)).toEqual(["inviter", "renvoyer", "reinitialiser", "desactiver"]);
    expect(g.map((x) => x.bouton)).toEqual(["Envoyer 2 invitations", "Renvoyer 7 liens", "Réinitialiser 5 accès", "Désactiver 7 comptes"]);
    expect(libelleOption("renvoyer", 7)).toBe("Renvoyer le lien (7 personnes)");
  });

  it("explique avec les chiffres de toute la population", () => {
    const [inviter, renvoyer, reinit, desactiver] = gestesTousApplicables(chiffres);
    expect(inviter.explication.titre).toBe("Envoyer l'invitation aux 2 personnes jamais entrées");
    expect(inviter.explication.phrases.join(" ")).toContain("5 personnes à l'accès déjà installé");
    expect(renvoyer.explication.titre).toContain("« T4 2026 »");
    expect(reinit.explication.phrases).toContain("4 emails partiront.");
    expect(reinit.explication.phrases.join(" ")).toContain("Rien ne partira pour 1 personne");
    expect(desactiver.explication.titre).toBe("Désactiver 7 comptes, administrateurs compris");
  });

  it("dit toujours quelque chose après le geste", () => {
    expect(messageApres("renvoyer", undefined)).toEqual({ type: "ok", texte: "Les liens sont partis." });
    expect(messageApres("desactiver", "3 comptes désactivés.")).toEqual({ type: "ok", texte: "3 comptes désactivés." });
    expect(messageApres("desactiver", "aucun compte à désactiver")).toEqual({ type: "ok", texte: "Aucun compte à désactiver" });
    expect(messageApres("inviter", { succes: "2 invitations envoyées." })).toEqual({ type: "ok", texte: "2 invitations envoyées." });
    expect(messageApres("inviter", { erreur: "Période close." })).toEqual({ type: "erreur", texte: "Période close." });
  });
});
