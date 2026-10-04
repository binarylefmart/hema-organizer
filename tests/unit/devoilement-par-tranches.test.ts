import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { COURS_HISTORIQUE_VISIBLES, devoilement, libelleAfficher, libelleCompteur, LIGNES_VISIBLES } from "@/components/seances/listes";

/**
 * **Vingt de plus, pas tout le reste.**
 *
 * Le repli des longues listes dépliait d'un seul appui **tout** ce qui était caché : dans un club de
 * quatre-vingts, « Afficher les 60 autres » remplaçait un écran trop court par soixante lignes d'un
 * coup, et on ne savait plus où l'on en était. Le dévoilement se fait désormais **par tranches de
 * vingt**, avec un compteur qui dit où l'on en est (« 20 sur 80 »).
 *
 * Cinq décisions sont vérifiées ici, parce que toutes les cinq se défont sans qu'on s'en aperçoive :
 *
 * 1. **Une tranche par appui**, jamais le reste entier.
 * 2. **Le bouton ne promet jamais plus qu'il ne montre** : « Afficher les 7 suivantes » sur la
 *    dernière tranche, et non « les 20 suivantes » suivies de sept lignes.
 * 3. **Le compteur suit les appuis** et parle du **résultat de la recherche en cours**, pas de la
 *    liste entière : « 4 sur 4 » quand on cherche « mar » dans quatre-vingts noms.
 * 4. **« Replier » revient à vingt**, pas à la tranche précédente : c'est le geste « je me suis
 *    perdu, remets-moi au début ».
 * 5. **Un club de douze ne voit rien** : ni bouton, ni compteur, ni différence d'aucune sorte.
 */

const source = (f: string) => readFileSync(path.join(process.cwd(), f), "utf8");

const LISTE_REPLIEE = "src/components/seances/ListeRepliee.tsx";
const LISTE_PARTICIPANTS = "src/components/seances/ListeParticipants.tsx";
const HISTORIQUE = "src/components/presences/Historique.tsx";
const FRISE_DETAIL = "src/components/accueil/FriseDetail.tsx";
const TABLEAU_MEMBRES = "src/app/(app)/gestion/tableau-de-bord/TableauMembres.tsx";
const ADMIN_MEMBRES = "src/app/(app)/admin/membres/page.tsx";

/**
 * **Le parcours complet d'un dévoilement**, appui par appui, tel que le composant le joue : on part
 * de la première tranche et on appuie tant qu'il reste quelque chose. Chaque étape retient ce que le
 * bouton **annonçait** et ce qu'il a **réellement ajouté** — les deux doivent coïncider.
 */
function parcours(total: number, tranche = LIGNES_VISIBLES) {
  const etapes: Array<{ annonce: number; ajoutees: number; affichees: number }> = [];
  let etat = devoilement({ total, demandees: tranche, tranche });
  while (etat.restantes > 0) {
    const avant = etat.affichees;
    const annonce = etat.prochaine;
    etat = devoilement({ total, demandees: etat.affichees + tranche, tranche });
    etapes.push({ annonce, ajoutees: etat.affichees - avant, affichees: etat.affichees });
    if (etapes.length > 50) throw new Error("le dévoilement ne s'arrête pas");
  }
  return etapes;
}

describe("le dévoilement se fait par tranches de vingt", () => {
  it("montre vingt lignes et en garde soixante, dans un club de quatre-vingts", () => {
    const etat = devoilement({ total: 80, demandees: LIGNES_VISIBLES });
    expect(etat.affichees).toBe(20);
    expect(etat.restantes).toBe(60);
    expect(etat.prochaine).toBe(20);
  });

  it("ajoute vingt lignes par appui, et non tout le reste", () => {
    expect(parcours(80).map((e) => e.affichees)).toEqual([40, 60, 80]);
    expect(parcours(80).map((e) => e.ajoutees)).toEqual([20, 20, 20]);
  });

  it("n'annonce jamais plus de lignes qu'il n'en montre", () => {
    for (let total = 0; total <= 100; total++) {
      for (const etape of parcours(total)) {
        expect(etape.annonce, `total ${total}`).toBe(etape.ajoutees);
      }
    }
  });

  it("dit « Afficher les 7 suivantes » sur la dernière tranche d'une liste de vingt-sept", () => {
    const etat = devoilement({ total: 27, demandees: LIGNES_VISIBLES });
    expect(etat.prochaine).toBe(7);
    expect(libelleAfficher(etat.prochaine)).toBe("Afficher les 7 suivantes");
    // … et l'appui montre bien sept lignes, pas vingt.
    expect(parcours(27)).toEqual([{ annonce: 7, ajoutees: 7, affichees: 27 }]);
  });

  it("n'a plus rien à proposer une fois tout dévoilé", () => {
    const etat = devoilement({ total: 80, demandees: 80 });
    expect(etat.restantes).toBe(0);
    expect(etat.prochaine).toBe(0);
    // Tout est déplié : « Replier » est le seul geste qui reste.
    expect(etat.auDebut).toBe(false);
  });

  it("emprunte sa tranche à la liste qu'il découpe : l'historique compte des cours, pas des noms", () => {
    const saison = devoilement({ total: 60, demandees: COURS_HISTORIQUE_VISIBLES, tranche: COURS_HISTORIQUE_VISIBLES });
    expect(saison.affichees).toBe(40);
    expect(saison.prochaine).toBe(20);
    expect(libelleAfficher(saison.prochaine, "cours précédents")).toBe("Afficher les 20 cours précédents");
  });
});

describe("le compteur dit où l'on en est", () => {
  it("s'écrit « 20 sur 80 », et suit les appuis", () => {
    expect(libelleCompteur(20, 80)).toBe("20 sur 80");
    expect(parcours(80).map((e) => libelleCompteur(e.affichees, 80))).toEqual(["40 sur 80", "60 sur 80", "80 sur 80"]);
  });

  it("accepte une unité quand l'écran mêle plusieurs sortes de listes", () => {
    expect(libelleCompteur(40, 60, "cours")).toBe("40 sur 60 cours");
  });

  it("est lu par un lecteur d'écran au moment de l'appui, et non à la fin du chargement", () => {
    // Sans `aria-live`, quelqu'un qui appuie sans voir l'écran n'apprend jamais où il en est.
    expect(source(LISTE_REPLIEE)).toMatch(/aria-live="polite"/);
    expect(source(LISTE_REPLIEE)).toContain("libelleCompteur");
  });

  /**
   * **Le compteur parle de la recherche en cours.** Sur le tableau de bord et la correction des
   * présences, le filtre s'applique **avant** la coupe : chercher « mar » dans quatre-vingts noms
   * doit donner « 4 sur 4 » — et aucun bouton —, pas « 20 sur 80 ».
   */
  it("parle du résultat de la recherche, pas de la liste entière", () => {
    // Quatre-vingts noms dont soixante déjà dévoilés, puis une recherche qui n'en garde que quatre.
    const etat = devoilement({ total: 4, demandees: 60 });
    expect(libelleCompteur(etat.affichees, 4)).toBe("4 sur 4");
    expect(etat.restantes).toBe(0);
    expect(etat.prochaine).toBe(0);
  });
});

describe("« Replier » revient à vingt", () => {
  it("ramène à la première tranche, pas à la précédente", () => {
    // Trois appuis plus tard, on est à quatre-vingts ; « Replier » remet la liste à vingt.
    const deplie = devoilement({ total: 80, demandees: 80 });
    expect(deplie.affichees).toBe(80);
    const replie = devoilement({ total: 80, demandees: LIGNES_VISIBLES });
    expect(replie.affichees).toBe(20);
    expect(replie.auDebut).toBe(true);
  });

  it("n'existe pas tant qu'on n'a rien dévoilé : rien à replier", () => {
    expect(devoilement({ total: 80, demandees: LIGNES_VISIBLES }).auDebut).toBe(true);
    expect(devoilement({ total: 80, demandees: 40 }).auDebut).toBe(false);
  });

  it("le composant remet le compteur au début, il ne le décrémente pas", () => {
    const code = source(LISTE_REPLIEE);
    // Le retour est une remise à `debut` ; un `- tranche` serait le retour à la tranche précédente.
    expect(code).toMatch(/setDemandees\(debut\)/);
    expect(code).not.toMatch(/- tranche/);
  });
});

describe("un club de douze ne voit rien de tout cela", () => {
  it("n'a ni tranche suivante, ni « Replier », quelle que soit la liste", () => {
    for (const total of [0, 1, 6, 12, 19, 20]) {
      const etat = devoilement({ total, demandees: LIGNES_VISIBLES });
      expect(etat.affichees, `${total}`).toBe(total);
      expect(etat.restantes, `${total}`).toBe(0);
      expect(etat.prochaine, `${total}`).toBe(0);
      expect(etat.auDebut, `${total}`).toBe(true);
      expect(parcours(total), `${total}`).toEqual([]);
    }
  });

  it("ne rend RIEN quand rien n'est caché : pas même un compteur", () => {
    // C'est l'invariant qui garantit l'absence de différence pour le club qui a commandé l'outil.
    expect(source(LISTE_REPLIEE)).toMatch(/cachees\.length === 0\) return null/);
  });

  it("garde le seuil partagé sur les écrans qui filtrent avant de replier", () => {
    expect(source(TABLEAU_MEMBRES)).toMatch(/length > LIGNES_VISIBLES/);
  });
});

describe("un seul patron, chez tous ses appelants", () => {
  it("la mécanique vit dans `ListeRepliee`, et nulle part ailleurs", () => {
    for (const fichier of [LISTE_PARTICIPANTS, HISTORIQUE, FRISE_DETAIL]) {
      expect(source(fichier), fichier).toContain("ListeRepliee");
      // Aucun état de dépliage local : ni bascule « tout ou rien », ni compteur réécrit sur place
      expect(source(fichier), fichier).not.toMatch(/useState\(false\)[^]{0,80}tout/i);
      expect(source(fichier), fichier).not.toMatch(/libelleAfficher\(/);
    }
  });

  it("le tableau de bord partage le même calcul, faute de pouvoir partager le `<li>`", () => {
    const code = source(TABLEAU_MEMBRES);
    // Ses lignes sont des `<tr>` : il ne peut pas monter `ListeRepliee`, mais il en reprend le crochet.
    expect(code).toContain("useDevoilement");
    expect(code).toMatch(/from "@\/components\/seances\/ListeRepliee"/);
    expect(code).toContain("libelleCompteur");
    expect(code).not.toMatch(/Afficher les \$\{/);
  });

  it("les mots viennent du module partagé, jamais réécrits à la main", () => {
    for (const fichier of [LISTE_REPLIEE, TABLEAU_MEMBRES, ADMIN_MEMBRES]) {
      // Ni le libellé du bouton ni celui du compteur ne s'écrivent sur place : deux écrans qui
      // divergeraient sur « 20 sur 80 » feraient deux grammaires à apprendre.
      expect(source(fichier), fichier).toContain("libelleCompteur");
      expect(source(fichier), fichier).toContain("libelleAfficher");
      expect(source(fichier), fichier).not.toMatch(/Afficher les \$\{/);
      expect(source(fichier), fichier).not.toMatch(/\} sur \$\{[^`]*`;?\s*$/m);
    }
  });

  /**
   * **L'annuaire reste une pagination en base**, et ce n'est pas un oubli : « Afficher les 30 autres
   * comptes » y est une **requête** (`?tout=1`), pas un dévoilement local. Il n'adopte donc pas la
   * tranche — il n'y a rien à dévoiler, les lignes ne sont pas dans la page — mais il adopte la
   * **grammaire du compteur**, pour qu'« où j'en suis » se lise pareil partout.
   */
  it("l'annuaire garde sa requête et emprunte seulement le compteur", () => {
    const code = source(ADMIN_MEMBRES);
    expect(code).toContain("libelleCompteur");
    expect(code).toMatch(/take: PAR_PAGE/);
    expect(code).toMatch(/p\.set\("tout", "1"\)/);
    // Pas de dévoilement local : l'écran reste un composant serveur
    expect(code).not.toContain('"use client"');
    expect(code).not.toContain("useDevoilement");
  });
});

describe("les cibles tactiles du dévoilement", () => {
  it("laissent au moins 48 px sous le doigt", () => {
    // `taille="petite"` s'arrête à 44 px : le bouton du dévoilement est celui qu'on appuie
    // plusieurs fois de suite, il porte donc 48 px.
    expect(source(LISTE_REPLIEE)).toMatch(/min-h-12/);
    expect(source(TABLEAU_MEMBRES)).toMatch(/min-h-12/);
  });
});
