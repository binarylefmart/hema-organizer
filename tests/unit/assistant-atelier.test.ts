import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { atelierSchema } from "@/lib/validation/gestion";
import { SEUIL_RECHERCHE } from "@/components/ui/liste-deroulante";
import {
  enPuces,
  erreursAffichees,
  erreursEtape,
  ETAPES_ATELIER,
  etapeDuChamp,
  libelleProgression,
  NB_ETAPES_ATELIER,
  PLAFONDS_ATELIER,
  premiereEtapeFautive,
  premiereEtapeIncomplete,
  nouvelleProposition,
  type SaisieAtelier,
} from "@/components/ateliers/assistant-atelier";

/**
 * **L'assistant « Proposer un atelier » du téléphone** : quatre étapes, chacune ne laisse passer que
 * ce que le serveur accepterait, et un refus du serveur ramène à l'étape du champ fautif. Le serveur
 * ne doit voir aucune différence avec le formulaire d'ordinateur : mêmes champs, même action.
 */

const vide: SaisieAtelier = { titre: "", description: "", animateurId: "moi", animateurSecondId: "", materiel: "", sessionId: "" };
const saisie = (extra: Partial<SaisieAtelier>): SaisieAtelier => ({ ...vide, ...extra });
const lire = (fichier: string) => readFileSync(path.join(process.cwd(), fichier), "utf8");

describe("les étapes", () => {
  it("sont quatre, et portent à elles toutes exactement les champs que lit l'action", () => {
    expect(NB_ETAPES_ATELIER).toBe(4);
    const champs = ETAPES_ATELIER.flatMap((e) => [...e.champs]).sort();
    // Les champs que `lireAtelier` passe au schéma : ni plus, ni moins.
    expect(champs).toEqual(Object.keys(atelierSchema.shape).sort());
    expect(libelleProgression(2)).toBe("Étape 2 sur 4");
  });

  it("un refus du serveur ramène à la première étape fautive", () => {
    expect(etapeDuChamp("titre")).toBe(1);
    expect(etapeDuChamp("animateurSecondId")).toBe(2);
    expect(etapeDuChamp("materiel")).toBe(3);
    expect(etapeDuChamp("sessionId")).toBe(4);
    expect(premiereEtapeFautive({ materiel: "Trop long.", animateurId: "Choisis un membre actif du club." })).toBe(2);
    expect(premiereEtapeFautive({})).toBeNull();
    expect(premiereEtapeFautive(undefined)).toBeNull();
    // Un champ inconnu ne perd pas l'erreur : l'assistant reste sur la dernière étape, où est le bouton.
    expect(premiereEtapeFautive({ _: "Erreur" })).toBe(4);
  });
});

describe("chaque étape suit la validation du serveur", () => {
  it("l'idée : un titre ou une phrase, comme `atelierSchema`", () => {
    expect(erreursEtape(1, vide).titre).toBe("Écris au moins un titre ou une phrase.");
    expect(erreursEtape(1, saisie({ titre: "   " })).titre).toBeDefined();
    expect(erreursEtape(1, saisie({ titre: "Jeu du roi de la colline" }))).toEqual({});
    expect(erreursEtape(1, saisie({ description: "Un défenseur au centre." }))).toEqual({});
  });

  it("qui anime : quelqu'un de choisi, et un second qui est une autre personne", () => {
    expect(erreursEtape(2, saisie({ animateurId: "" })).animateurId).toBeDefined();
    expect(erreursEtape(2, saisie({ animateurSecondId: "moi" })).animateurSecondId).toBe("Le second animateur doit être une autre personne.");
    expect(erreursEtape(2, saisie({ animateurSecondId: "autre" }))).toEqual({});
  });

  it("les plafonds sont ceux du schéma, au caractère près", () => {
    const juste = { titre: "a".repeat(PLAFONDS_ATELIER.titre), description: "b".repeat(PLAFONDS_ATELIER.description), materiel: "c".repeat(PLAFONDS_ATELIER.materiel) };
    expect(atelierSchema.safeParse({ ...juste, sessionId: "", animateurId: "", animateurSecondId: "" }).success).toBe(true);
    expect(premiereEtapeIncomplete(saisie(juste))).toBeNull();
    for (const [champ, max] of Object.entries(PLAFONDS_ATELIER)) {
      const trop = { ...juste, [champ]: "x".repeat(max + 1) };
      expect(atelierSchema.safeParse({ ...trop, sessionId: "", animateurId: "", animateurSecondId: "" }).success, champ).toBe(false);
      expect(premiereEtapeIncomplete(saisie(trop)), champ).toBe(etapeDuChamp(champ));
    }
  });

  it("ce que l'assistant laisse partir, le serveur l'accepte", () => {
    const cas: Partial<SaisieAtelier>[] = [
      { titre: "Lecture du Fior di Battaglia" },
      { description: "Une planche lue ensemble", materiel: "masques" },
      { titre: "Corde", animateurId: "autre", animateurSecondId: "moi", sessionId: "s1" },
    ];
    for (const c of cas) {
      const s = saisie(c);
      expect(premiereEtapeIncomplete(s)).toBeNull();
      expect(atelierSchema.safeParse(s).success, JSON.stringify(c)).toBe(true);
    }
  });

  it("la séance est facultative : la dernière étape n'arrête jamais", () => {
    expect(erreursEtape(4, vide)).toEqual({});
    expect(erreursEtape(3, vide)).toEqual({});
  });
});

describe("des puces, puis la liste du dépôt", () => {
  it("au même seuil que la recherche des listes déroulantes", () => {
    const entrees = (n: number) => Array.from({ length: n }, (_, i) => ({ valeur: String(i), libelle: `P${i}` }));
    expect(enPuces(entrees(SEUIL_RECHERCHE))).toBe(true);
    expect(enPuces(entrees(SEUIL_RECHERCHE + 1))).toBe(false);
  });
});

describe("un seul formulaire, la même action", () => {
  it("l'assistant poste un seul <form> par onSubmit, sans <select>", () => {
    const code = lire("src/components/ateliers/AssistantAtelier.tsx");
    expect(code.match(/<form\s/g)).toHaveLength(1);
    expect(code).not.toMatch(/<select\b/);
    // Les étapes cachent leurs fieldsets sans les retirer : les valeurs restent dans le DOM.
    expect(code).toMatch(/<fieldset hidden=\{!active\}/);
    for (const champ of ["titre", "description", "animateurId", "animateurSecondId", "materiel", "sessionId"]) {
      expect(code, champ).toContain(`name="${champ}"`);
    }
  });

  it("la page membre donne la même action aux deux formes, et garde ses deux colonnes sur ordinateur", () => {
    const page = lire("src/app/(app)/ateliers/page.tsx");
    expect(page).toMatch(/<FormulaireAtelier\s+action=\{proposerAtelier\}/);
    expect(page).toMatch(/action=\{proposerAtelier\}\s+seances=\{seances\}/);
    expect(page).toMatch(/ordinateur=\{<DeuxColonnes/);
  });

  it("la file de l'équipe : deux boutons sur téléphone, le même `lancer` que la liste", () => {
    const code = lire("src/app/(app)/gestion/ateliers/DecisionAtelier.tsx");
    expect(code).toContain("useEcranTelephone");
    expect(code).toContain("Programmer");
    expect(code).toContain("Refuser…");
    expect(code).toContain('lancer("effacer")');
    expect(code).toContain("onClick={() => lancer(ouvert.geste)}");
  });
});

describe("erreur du serveur sous un champ corrigé", () => {
  it("le refus du serveur reste tant qu'on n'a pas touché au champ", () => {
    expect(erreursAffichees({ titre: "Trop long." }, {}, new Set())).toEqual({ titre: "Trop long." });
  });
  it("un champ retouché depuis le dernier retour ne montre plus le refus du serveur", () => {
    const erreurs = erreursAffichees({ titre: "Trop long.", materiel: "Trop long." }, {}, new Set(["titre"]));
    expect(erreurs.titre).toBeUndefined();
    expect(erreurs.materiel).toBe("Trop long.");
  });
  it("les erreurs de l'assistant passent devant celles du serveur", () => {
    expect(erreursAffichees({ titre: "A" }, { titre: "B" }, new Set(["titre"]))).toEqual({ titre: "B" });
  });
  it("l'assistant branche bien ce tri, et non une fusion brute", () => {
    const source = readFileSync(path.join(process.cwd(), "src/components/ateliers/AssistantAtelier.tsx"), "utf8");
    expect(source).toContain("erreursAffichees(etat.erreurs, erreursLocales, corriges)");
    expect(source).not.toContain("...(etat.erreurs ?? {})");
  });
});

describe("le brouillon de l'assistant survit au retrait d'une proposition", () => {
  it("une proposition neuve dit qu'un envoi a réussi", () => {
    expect(nouvelleProposition(["b", "a"], ["c", "b", "a"])).toBe(true);
  });
  it("retirer une ancienne proposition, ou la plus récente, n'en est pas une", () => {
    expect(nouvelleProposition(["c", "b", "a"], ["c", "a"])).toBe(false);
    expect(nouvelleProposition(["c", "b", "a"], ["b", "a"])).toBe(false);
  });
  it("la page ne remonte plus l'assistant sur le nombre de propositions", () => {
    const page = readFileSync(path.join(process.cwd(), "src/app/(app)/ateliers/page.tsx"), "utf8");
    expect(page).not.toContain("key={ateliers.length}");
    const bascule = readFileSync(path.join(process.cwd(), "src/app/(app)/ateliers/BasculeAteliers.tsx"), "utf8");
    expect(bascule).toContain("nouvelleProposition(vus, idsPropositions)");
  });
});
