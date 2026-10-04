import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compterHorsAffichage, memoriserLignes, texteHorsAffichage } from "@/components/ui/selection";
import {
  MOTS_PERSONNES,
  oublierCorrectionsArrivees,
  reponseAffichee,
  resumeEcrasement,
  texteConfirmation,
} from "@/components/gestion/selection-presences";

/**
 * **Une correction affichée ne doit jamais survivre à la réponse du serveur**.
 *
 * `PresencesEquipe` garde les corrections en cours dans un dictionnaire (`modifs`) indexé **par
 * personne**, et les fait primer sur ce que le serveur envoie. Trois faits, pris ensemble, en
 * faisaient un registre faux :
 *
 * 1. `/admin/presences` change de séance par `router.push` sur **la même route** : sans `key`,
 *    l'instance cliente survit au changement, et les corrections de la séance de mardi
 *    s'affichaient sur celle de jeudi ;
 * 2. le dictionnaire n'était **jamais purgé** — l'effet de remise en cohérence ne nettoyait que la
 *    sélection —, si bien qu'une réponse donnée par la personne elle-même depuis son téléphone
 *    restait masquée par la correction d'avant-hier ;
 * 3. et le pire : la **confirmation d'écrasement** du lot se calcule sur ce qui est *affiché*. Elle
 *    annonçait donc « 1 y est déjà » — le chiffre censé faire hésiter — au moment même où le lot
 *    allait effacer une réponse réelle.
 *
 * S'y ajoute la divergence entre les deux chemins d'écriture : sur une ligne périmée, le geste
 * unitaire s'abstenait (`nouveau === precedent`) là où le lot écrasait. `CLAUDE.md` exige que les
 * verrous du lot soient **exactement** ceux du geste unitaire.
 */

const source = (f: string) => readFileSync(path.join(process.cwd(), f), "utf8");

const PAGE = "src/app/(app)/admin/presences/page.tsx";
const SELECTEUR = "src/app/(app)/admin/presences/SelecteurSeance.tsx";
const EQUIPE = "src/components/gestion/PresencesEquipe.tsx";
const ACTIONS = "src/actions/presences.ts";
const ROLES = "src/app/(app)/admin/membres/SelectionRoles.tsx";

/* ------------------------------------------------------------------ */
/* 1. Changer de séance remonte le composant, et purge ce qui traîne   */
/* ------------------------------------------------------------------ */

describe("changer de séance ne garde rien de la précédente", () => {
  it("change de séance par la même route : c'est le fait qui rend la clé obligatoire", () => {
    // `router.push("/admin/presences?seance=<id>")` — même route, même position dans l'arbre React :
    // sans `key`, React réutilise l'instance et tout son état local.
    expect(source(SELECTEUR)).toMatch(/router\.push\(`\/admin\/presences\?seance=/);
  });

  it("remonte `PresencesEquipe` à chaque séance (`key`)", () => {
    expect(source(PAGE)).toMatch(/<PresencesEquipe\s+key=\{choisie\.id\}/);
  });

  it("purge en plus le dictionnaire des corrections : la clé ne couvre pas la même séance", () => {
    // Scénario sans changement de séance : correction mardi, réponse du membre mercredi, même
    // onglet jeudi. Aucun remontage ne se produit — seule la purge remet l'écran d'accord.
    const code = source(EQUIPE);
    expect(code).toContain("oublierCorrectionsArrivees");
    // Et la purge vit dans l'effet déclenché par l'arrivée de données serveur.
    expect(code).toMatch(/oublierCorrectionsArrivees[\s\S]{0,300}\}, \[participants\]\)/);
  });

  it("revalide l'écran d'où part la correction, sinon la purge afficherait les anciennes réponses", () => {
    const code = source(ACTIONS);
    const debut = code.indexOf("function rafraichirApresCorrection");
    expect(debut).toBeGreaterThan(0);
    // La fin de la fonction : la première accolade seule en début de ligne (un `${sessionId}` en
    // contient une au milieu d'un gabarit, qu'une recherche naïve prendrait pour la fin du corps).
    const corps = code.slice(debut, code.indexOf("\n}", debut));
    expect(corps).toContain('revalidatePath("/admin/presences")');
  });
});

describe("oublier les corrections que le serveur a reprises", () => {
  it("ne garde que ce qui est encore en vol", () => {
    const modifs = { alix: "PRESENT", charlie: "ABSENT" };
    expect(oublierCorrectionsArrivees(modifs, new Set(["charlie"]))).toEqual({ charlie: "ABSENT" });
    expect(oublierCorrectionsArrivees(modifs, new Set())).toEqual({});
  });

  it("ne modifie pas le dictionnaire reçu", () => {
    const modifs = { alix: "PRESENT" };
    oublierCorrectionsArrivees(modifs, new Set());
    expect(modifs).toEqual({ alix: "PRESENT" });
  });

  it("rend le même objet quand il n'y a rien à retirer : pas un rendu de plus pour rien", () => {
    const modifs = { alix: "PRESENT" };
    expect(oublierCorrectionsArrivees(modifs, new Set(["alix"]))).toBe(modifs);
    const vide = {};
    expect(oublierCorrectionsArrivees(vide, new Set())).toBe(vide);
  });
});

describe("la réponse affichée d'une ligne", () => {
  it("prend la correction en cours, sinon la valeur du serveur", () => {
    expect(reponseAffichee({ alix: "ABSENT" }, { id: "alix", statut: "PRESENT" })).toBe("ABSENT");
    expect(reponseAffichee({}, { id: "alix", statut: "PRESENT" })).toBe("PRESENT");
    expect(reponseAffichee({ alix: null }, { id: "alix", statut: "PRESENT" })).toBeNull();
    // Une valeur qui n'est pas un statut connu ne s'affiche pas comme un statut.
    expect(reponseAffichee({ alix: "PARTI" }, { id: "alix", statut: "PRESENT" })).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* 2. La confirmation d'écrasement dit la vérité du serveur            */
/* ------------------------------------------------------------------ */

describe("la confirmation d'un lot ne se fie pas à une correction périmée", () => {
  /**
   * Mardi : le bureau passe Chloé à « Absent ». Mercredi, Chloé répond « Présent » depuis son
   * téléphone. Jeudi, sur le même onglet, sa case porte encore la correction de mardi et part dans
   * un lot passé à « Absent ». La confirmation annonçait « 1 y est déjà » ; le serveur, lui, voit
   * PRESENT et écrit ABSENT — la parole du membre est effacée, et la phrase censée faire hésiter
   * disait le contraire.
   */
  const serveur = [{ id: "chloe", statut: "PRESENT" as const }];
  const perime = { chloe: "ABSENT" };

  it("compte la réponse réelle comme écrasée, et non comme déjà à jour", () => {
    // Plus rien n'est en vol : le serveur a la main.
    const propres = oublierCorrectionsArrivees(perime, new Set());
    const resume = resumeEcrasement(
      serveur.map((p) => ({ id: p.id, statut: reponseAffichee(propres, p) })),
      "ABSENT",
    );
    expect(resume.ecrasees).toBe(1);
    expect(resume.inchangees).toBe(0);
    expect(resume.detail).toEqual([{ statut: "PRESENT", nombre: 1 }]);
  });

  it("le dit dans la phrase, au lieu d'annoncer « 1 y est déjà »", () => {
    const propres = oublierCorrectionsArrivees(perime, new Set());
    const resume = resumeEcrasement(
      serveur.map((p) => ({ id: p.id, statut: reponseAffichee(propres, p) })),
      "ABSENT",
    );
    const texte = texteConfirmation(resume, "ABSENT");
    expect(texte).toMatch(/1 avait déjà répondu elle-même \(Présent\)/);
    expect(texte).not.toMatch(/y est déjà/);
  });

  it("le geste unitaire et le lot lisent la même valeur : aucun des deux ne s'abstient à tort", () => {
    const propres = oublierCorrectionsArrivees(perime, new Set());
    // Le verrou du geste unitaire (`nouveau === precedent`) ne doit plus déclarer « rien à faire ».
    expect(reponseAffichee(propres, serveur[0])).toBe("PRESENT");
    expect(reponseAffichee(propres, serveur[0])).not.toBe("ABSENT");
  });
});

/* ------------------------------------------------------------------ */
/* 3. Ce qui reste dehors est compté et dit — sur les deux écrans       */
/* ------------------------------------------------------------------ */

describe("ce qui est sélectionné hors de l'affichage est compté et dit", () => {
  it("compte les lignes cochées que l'écran ne montre pas", () => {
    const montres = [{ id: "a" }, { id: "b" }];
    expect(compterHorsAffichage(new Set(["a", "b"]), montres)).toBe(0);
    expect(compterHorsAffichage(new Set(["a", "z"]), montres)).toBe(1);
    // Le cas du défaut : la recherche ne trouve plus rien, la sélection est intacte.
    expect(compterHorsAffichage(new Set(["a", "b", "z"]), [])).toBe(3);
    expect(compterHorsAffichage(new Set(), montres)).toBe(0);
  });

  it("accorde sa phrase avec ce qu'elle compte", () => {
    expect(texteHorsAffichage(0, MOTS_PERSONNES)).toBeNull();
    expect(texteHorsAffichage(1, MOTS_PERSONNES)).toBe("1 personne sélectionnée n'est pas affichée : elle fait partie du lot.");
    expect(texteHorsAffichage(3, MOTS_PERSONNES)).toBe("3 personnes sélectionnées ne sont pas affichées : elles font partie du lot.");
    const comptes = { singulier: "compte", pluriel: "comptes", accord: "m" } as const;
    expect(texteHorsAffichage(1, comptes)).toBe("1 compte sélectionné n'est pas affiché : il fait partie du lot.");
    expect(texteHorsAffichage(3, comptes)).toBe("3 comptes sélectionnés ne sont pas affichés : ils font partie du lot.");
  });

  it("la phrase des présences vit dans la barre d'action, visible même quand rien ne correspond", () => {
    const code = source(EQUIPE);
    expect(code).toContain("texteHorsAffichage");
    // La barre d'action ne dépend pas des lignes affichées : elle survit à « Aucun nom ne
    // correspond » — et, elle est là même sans sélection (voir `cibles-et-annonces.test.ts`).
    const barre = code.indexOf('aria-label="Modifier la réponse de plusieurs personnes à la fois"');
    expect(barre).toBeGreaterThan(0);
    // Donc la phrase est rendue là, et non dans le bloc de la case maîtresse (`montres.length > 0`).
    expect(code.indexOf("{horsAffichage}")).toBeGreaterThan(barre);
  });
});

describe("les deux écrans de masse font le même geste", () => {
  it("l'annuaire ne rabote plus la sélection sur la page affichée", () => {
    // `restreindre(s, selectionnables)` effaçait des cases sans un mot dès qu'une recherche ou un
    // « Replier » changeait la page — le pire des deux comportements.
    expect(source(ROLES)).not.toMatch(/restreindre\(/);
  });

  it("se souvient des pages déjà vues, pour que le lot porte sur toute la sélection", () => {
    const code = source(ROLES);
    expect(code).toContain("memoriserLignes");
    // Et surtout : le lot ne se compose plus de la seule page affichée.
    expect(code).not.toMatch(/lignesSelectionnees\(selectionnables,/);
  });

  it("compte et dit ce qui reste hors de l'affichage, avec les mots de l'annuaire", () => {
    const code = source(ROLES);
    expect(code).toContain("compterHorsAffichage");
    expect(code).toContain("texteHorsAffichage");
  });

  it("garde les lignes déjà vues, la plus récente gagnant sur la précédente", () => {
    const vide = new Map<string, { id: string; role: string }>();
    const page1 = memoriserLignes(vide, [
      { id: "a", role: "MEMBRE" },
      { id: "b", role: "MEMBRE" },
    ]);
    expect([...page1.keys()]).toEqual(["a", "b"]);
    // Page suivante : on ajoute, on n'oublie pas.
    const page2 = memoriserLignes(page1, [{ id: "c", role: "INSTRUCTEUR" }]);
    expect([...page2.keys()]).toEqual(["a", "b", "c"]);
    // Le serveur renvoie « a » avec son nouveau rôle : c'est la valeur fraîche qui reste.
    const apres = memoriserLignes(page2, [{ id: "a", role: "INSTRUCTEUR" }]);
    expect(apres.get("a")).toEqual({ id: "a", role: "INSTRUCTEUR" });
    // Et la mémoire reçue n'est jamais modifiée sur place.
    expect(page1.size).toBe(2);
    expect(page2.get("a")).toEqual({ id: "a", role: "MEMBRE" });
  });
});
