import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  couper,
  groupeDuStatut,
  LIBELLE_REPLIER,
  libelleAfficher,
  LIGNES_VISIBLES,
  COURS_HISTORIQUE_VISIBLES,
  ORDRE_GROUPES,
  ORDRE_GROUPES_PASSEE,
  ordreDesGroupes,
  SEANCES_VISIBLES,
  selonOrdreFige,
  trierParActionnabilite,
} from "@/components/seances/listes";
import { lireTri, trierMembres } from "@/app/(app)/gestion/tableau-de-bord/tri";

/**
 * **L'outil a été écrit pour douze personnes ; il doit tenir pour quatre-vingts.**
 *
 * Trois règles sont vérifiées ici, parce qu'elles sont faciles à défaire sans s'en apercevoir :
 *
 * 1. **Pas de bouton tant que tout tient.** C'est ce qui garantit qu'un petit club ne paie rien
 *    pour un problème qu'il n'a pas : tant qu'une liste tient sous le plafond, elle s'affiche
 *    exactement comme avant, sans repli, sans recherche, sans tri.
 * 2. **Un seul ordre pour les listes nominatives.** Deux écrans qui nommeraient les mêmes gens dans
 *    deux ordres différents seraient le début des ennuis : on ne saurait plus si « untel n'est pas
 *    dans la liste » veut dire absent ou simplement plus bas.
 * 3. **Le plafond ne s'indexe sur rien.** En particulier pas sur le seuil d'effectif, qui est un
 *    quorum d'annulation de cours (« en dessous de 6, on annule ») et non un effectif de club :
 *    l'indexer donnerait des listes de quatre noms dans un club de quatre-vingts, et changerait la
 *    hauteur de tous les écrans le jour où le bureau retouche son seuil d'annulation.
 */

const source = (f: string) => readFileSync(path.join(process.cwd(), f), "utf8");

const LISTES = "src/components/seances/listes.ts";
const LISTE_PARTICIPANTS = "src/components/seances/ListeParticipants.tsx";
const LISTE_REPLIEE = "src/components/seances/ListeRepliee.tsx";
const PRESENCES_EQUIPE = "src/components/gestion/PresencesEquipe.tsx";
const HISTORIQUE = "src/components/presences/Historique.tsx";
const GRILLE_PLANNING = "src/components/planning/GrillePlanning.tsx";
const FRISE_DETAIL = "src/components/accueil/FriseDetail.tsx";
const ADMIN_PRESENCES = "src/app/(app)/admin/presences/page.tsx";
const SEANCE_FICHE = "src/app/(app)/seances/[id]/page.tsx";
const CARTE_SEANCE = "src/components/seances/CarteSeance.tsx";
const ACTION_PRESENCES = "src/actions/presences.ts";
const ADMIN_MEMBRES = "src/app/(app)/admin/membres/page.tsx";
const TABLEAU_DE_BORD = "src/app/(app)/gestion/tableau-de-bord/page.tsx";

const personne = (id: string, statut: "PRESENT" | "ABSENT" | "PEUT_ETRE" | null) => ({ id, statut });

describe("le plafond des listes empilées", () => {
  it("vaut vingt lignes — en dessous, une liste se parcourt encore des yeux", () => {
    expect(LIGNES_VISIBLES).toBe(20);
  });

  it("ne dépend de rien : ni de la part d'effectif du club, ni d'un autre réglage", () => {
    const code = source(LISTES);
    expect(code).not.toMatch(/partEffectifMin|PART_EFFECTIF|seuilEffectif|SEUIL_EFFECTIF|settings|db\./);
    // Le module est lu par des composants client : il ne doit tirer aucune valeur, seulement des types
    expect(code).not.toMatch(/^import (?!type )/m);
  });
});

describe("pas de bouton tant que tout tient (le club de douze)", () => {
  it("ne cache rien d'une liste qui tient sous le plafond", () => {
    for (const taille of [0, 1, 6, 9, 10]) {
      const liste = Array.from({ length: taille }, (_, i) => i);
      const { montrees, cachees } = couper(liste);
      expect(cachees).toEqual([]);
      expect(montrees).toEqual(liste);
    }
  });

  it("coupe dès la vingt-et-unième ligne, et le bouton annonce exactement la tranche qu'il montre", () => {
    const club = Array.from({ length: 80 }, (_, i) => i);
    const { montrees, cachees } = couper(club);
    expect(montrees).toHaveLength(LIGNES_VISIBLES);
    expect(cachees).toHaveLength(80 - LIGNES_VISIBLES);
    // Les soixante restantes se dévoilent **vingt par vingt** : le bouton annonce la prochaine
    // tranche, pas le reste entier (voir `devoilement-par-tranches.test.ts`).
    expect(libelleAfficher(LIGNES_VISIBLES)).toBe(`Afficher les ${LIGNES_VISIBLES} suivantes`);
  });

  it("dit « Replier » une fois déplié, comme la liste des séances", () => {
    expect(LIBELLE_REPLIER).toBe("Replier");
  });

  it("un club de douze ne replie aucune de ses quatre colonnes nominatives", () => {
    // Douze invités répartis sur les quatre réponses : aucune colonne n'atteint le plafond
    const club = { sansReponse: 4, peutEtre: 2, presents: 5, absents: 1 };
    for (const cle of ORDRE_GROUPES) {
      const colonne = Array.from({ length: club[cle] }, (_, i) => i);
      expect(couper(colonne).cachees).toEqual([]);
    }
  });
});

describe("un seul ordre pour les listes nominatives", () => {
  it("place d'abord ce qui appelle un geste, ensuite ce qui se lit", () => {
    expect([...ORDRE_GROUPES]).toEqual(["sansReponse", "peutEtre", "presents", "absents"]);
  });

  it("range chaque réponse dans son groupe, l'absence de réponse comprise", () => {
    expect(groupeDuStatut("PRESENT")).toBe("presents");
    expect(groupeDuStatut("PEUT_ETRE")).toBe("peutEtre");
    expect(groupeDuStatut("ABSENT")).toBe("absents");
    expect(groupeDuStatut(null)).toBe("sansReponse");
  });

  it("est repris tel quel par les deux écrans qui nomment tout le club", () => {
    // `ordreDesGroupes` pour la liste nominative (qui connaît le temps), `ORDRE_GROUPES` pour la
    // frise, qui ne montre que des cours à venir. Dans les deux cas, rien n'est réécrit sur place.
    expect(source(LISTE_PARTICIPANTS)).toMatch(/ordreDesGroupes\(/);
    expect(source(FRISE_DETAIL)).toContain("ORDRE_GROUPES");
    for (const fichier of [LISTE_PARTICIPANTS, FRISE_DETAIL]) {
      // Plus aucune liste de groupes écrite à la main : elles finiraient par diverger
      expect(source(fichier)).not.toMatch(/\{ cle: "presents"/);
    }
  });
});

/**
 * **Le même écran, avant et après le cours, ne répond pas à la même question.**
 *
 * « Sans réponse d'abord » est l'ordre de ce qu'on peut encore changer : on relance les silencieux
 * pour remplir un cours **à venir**. Sur un cours déjà donné, cet ordre ouvre la liste sur
 * quarante-six noms de gens qui n'ont jamais répondu — l'information la moins utile qui soit, et
 * elle occupe tout l'écran. Ce qu'on vient y chercher, c'est **qui était là**.
 *
 * L'ordre dépend donc du temps ; la décision est prise à un seul endroit (`ordreDesGroupes`), et les
 * écrans ne font que dire si la séance a commencé.
 */
describe("l'ordre des colonnes dépend du fait que le cours a eu lieu", () => {
  it("ouvre sur ce qui appelle un geste tant que le cours est à venir", () => {
    expect([...ordreDesGroupes(false)]).toEqual(["sansReponse", "peutEtre", "presents", "absents"]);
    expect([...ordreDesGroupes(false)]).toEqual([...ORDRE_GROUPES]);
  });

  it("ouvre sur ceux qui étaient là une fois le cours passé", () => {
    expect([...ordreDesGroupes(true)]).toEqual(["presents", "absents", "peutEtre", "sansReponse"]);
    expect([...ordreDesGroupes(true)]).toEqual([...ORDRE_GROUPES_PASSEE]);
  });

  it("garde exactement les quatre mêmes colonnes dans les deux sens : c'est un ordre, pas un filtre", () => {
    expect([...ordreDesGroupes(true)].sort()).toEqual([...ordreDesGroupes(false)].sort());
  });

  it("un seul endroit décide ; les écrans disent seulement si le cours a commencé", () => {
    // L'historique ne montre que des cours déjà donnés : la liste nominative y est toujours « passée ».
    expect(source(HISTORIQUE)).toMatch(/<ListeParticipants[^>]*passee/);
    // La fiche d'une séance change de bord avec elle, comme son titre le fait déjà.
    expect(source(SEANCE_FICHE)).toMatch(/passee=\{commencee\}/);
  });

  it("la carte de la liste des séances bascule aussi, et pas seulement la fiche", () => {
    /*
     * Scénario : sur `/seances`, onglet « Passé », la carte d'un cours déjà donné ouvrait « Qui
     * vient ? » sur la colonne des sans-réponse. Elle était l'appel oublié du passage à « présents
     * d'abord » — la fiche et l'historique avaient été traités, la carte non, alors qu'elle connaît
     * `s.commencee` et s'en sert **deux lignes plus haut** pour verrouiller les boutons de réponse.
     * Trois écrans montrent la même liste ; le seul qui ne demandait rien affichait l'inverse des
     * deux autres sur le même cours.
     */
    const carte = source(CARTE_SEANCE);
    expect(carte).toMatch(/<ListeParticipants[^>]*passee=\{s\.commencee\}/);
    // Et le titre suit : « Qui vient ? » sur un cours donné se lit comme une carte pas à jour.
    expect(carte).toMatch(/<ListeParticipants[^>]*titre=\{s\.commencee \?/);
  });
});

describe("tri par actionnabilité (registre d'un soir de cours)", () => {
  it("remonte les sans-réponse, puis les peut-être", () => {
    const liste = [personne("a", "PRESENT"), personne("b", null), personne("c", "ABSENT"), personne("d", "PEUT_ETRE")];
    expect(trierParActionnabilite(liste).map((p) => p.id)).toEqual(["b", "d", "a", "c"]);
  });

  it("garde l'ordre alphabétique reçu à l'intérieur d'un groupe (tri stable)", () => {
    const liste = [personne("Alix", null), personne("Charlie", null), personne("Chloé", null)];
    expect(trierParActionnabilite(liste).map((p) => p.id)).toEqual(["Alix", "Charlie", "Chloé"]);
  });

  it("ne modifie pas la liste reçue", () => {
    const liste = [personne("a", "PRESENT"), personne("b", null)];
    trierParActionnabilite(liste);
    expect(liste.map((p) => p.id)).toEqual(["a", "b"]);
  });
});

describe("/admin/presences — corriger une réponse dans un club de quatre-vingts", () => {
  it("trie par actionnabilité au rendu serveur", () => {
    expect(source(ADMIN_PRESENCES)).toMatch(/trierParActionnabilite\(/);
  });

  it("ne retrie JAMAIS depuis l'état local : les lignes sauteraient sous le doigt", () => {
    const code = source(PRESENCES_EQUIPE);
    // Le nom peut être cité en commentaire — c'est l'**appel** qui est proscrit, comme tout tri local.
    expect(code).not.toMatch(/trierParActionnabilite\(/);
    expect(code).not.toMatch(/\.sort\(/);
    // Le piège est écrit noir sur blanc dans le fichier, pas seulement dans un test
    expect(code).toMatch(/modifierPresenceMembre[^]{0,400}revalide/);
  });

  it("offre une recherche et un repli — mais seulement quand la liste déborde", () => {
    const code = source(PRESENCES_EQUIPE);
    expect(code).toContain('type="search"');
    expect(code).toContain("LIGNES_VISIBLES");
    expect(code).toMatch(/length > LIGNES_VISIBLES/);
  });
});

/**
 * **Le tri par actionnabilité posé sur un écran que le serveur revalide.**
 *
 * **Les deux écrans sont revalidés** : `rafraichirApresCorrection` liste `/admin/presences` avec
 * les autres, sans quoi l'écran d'où part la correction restait sur les réponses d'avant (voir
 * `oublierCorrectionsArrivees`). Le figeage de l'ordre est donc désormais ce qui tient **les
 * deux**, et non la seule fiche de séance (`revalidatePath("/seances/<id>")`). Un admin déplie «
 * Modifier les réponses », les sans-réponse sont en haut, il passe Alix (1re ligne) à « Présent » :
 * l'arbre revient retrié par le serveur, Alix descend chez les présents, la personne suivante
 * remonte sous le doigt — et l'appui suivant corrige quelqu'un d'autre.
 *
 * Le composant ne retrie pas ; ce n'est pas suffisant, puisque le serveur le fait pour lui. Ce qui
 * est vérifié ici, c'est que l'ordre reçu à la **première** ouverture est celui qui reste.
 */
describe("l'ordre des lignes ne bouge pas sous le doigt (fiche de séance revalidée)", () => {
  it("garde chaque personne à sa place quand le serveur renvoie la liste retriée", () => {
    const ouverture = [personne("alix", null), personne("charlie", null), personne("chloe", "PRESENT")];
    const ordre = ouverture.map((p) => p.id);
    // Ce que le serveur renvoie après « Alix → Présent » : Alix est descendue, Charlie a remonté.
    const retrie = trierParActionnabilite([personne("alix", "PRESENT"), personne("charlie", null), personne("chloe", "PRESENT")]);
    expect(retrie.map((p) => p.id)).toEqual(["charlie", "alix", "chloe"]);
    // Ce que l'écran affiche : exactement l'ordre de l'ouverture. Charlie n'a pas bougé.
    expect(selonOrdreFige(ordre, retrie).map((p) => p.id)).toEqual(["alix", "charlie", "chloe"]);
  });

  it("met à la fin qui est arrivé après l'ouverture, et laisse tomber qui n'est plus là", () => {
    const ordre = ["alix", "charlie", "chloe"];
    const apres = [personne("dan", null), personne("chloe", "PRESENT"), personne("alix", null)];
    expect(selonOrdreFige(ordre, apres).map((p) => p.id)).toEqual(["alix", "chloe", "dan"]);
  });

  it("ne modifie pas la liste reçue", () => {
    const liste = [personne("b", null), personne("a", "PRESENT")];
    selonOrdreFige(["a", "b"], liste);
    expect(liste.map((p) => p.id)).toEqual(["b", "a"]);
  });

  it("la fiche de séance trie au serveur ET l'action la revalide : le figeage est obligatoire", () => {
    // Le fait qui rend le figeage nécessaire, écrit dans le test plutôt que supposé.
    expect(source(ACTION_PRESENCES)).toMatch(/revalidatePath\(`\/seances\/\$\{sessionId\}`\)/);
    expect(source(SEANCE_FICHE)).toMatch(/trierParActionnabilite\(/);
    expect(source(SEANCE_FICHE)).toContain("PresencesEquipe");
    // … et le composant fige, sinon les deux faits ci-dessus font sauter les lignes.
    expect(source(PRESENCES_EQUIPE)).toContain("selonOrdreFige");
  });
});

describe("/mes-presences — le plus gros DOM de l'application", () => {
  it("replie d'abord les séances, avant même les noms", () => {
    const code = source(HISTORIQUE);
    expect(code).toContain("ListeRepliee");
    expect(code).toMatch(/couper\(seances, COURS_HISTORIQUE_VISIBLES\)/);
  });

  /**
   * **La coupe de l'historique compte des cours, pas des personnes.** Elle empruntait le plafond
   * des listes de noms (20) : un trimestre ordinaire — deux cours par semaine sur treize semaines —
   * en compte 26, et le lien « Afficher tous les cours précédents » apparaissait donc chez un club
   * de douze. C'est exactement ce que le dossier promettait de ne pas faire.
   */
  it("laisse entier un trimestre ordinaire : deux cours par semaine sur treize semaines", () => {
    const trimestre = Array.from({ length: 26 }, (_, i) => i);
    expect(couper(trimestre, COURS_HISTORIQUE_VISIBLES).cachees).toEqual([]);
  });

  it("ne mord que sur une saison complète d'historique", () => {
    expect(COURS_HISTORIQUE_VISIBLES).toBe(40);
    const saison = Array.from({ length: 60 }, (_, i) => i);
    expect(couper(saison, COURS_HISTORIQUE_VISIBLES).montrees).toHaveLength(40);
    expect(couper(saison, COURS_HISTORIQUE_VISIBLES).cachees).toHaveLength(20);
  });

  /**
   * **Trois plafonds, trois natures, trois noms** — et c'est le test qui les empêche de se
   * reconfondre. Il y avait deux constantes appelées `SEANCES_VISIBLES`, à deux valeurs : celle de
   * `listes.ts` (40, l'historique) et une seconde exportée par `GrillePlanning` (5, le repli du
   * planning). Un auto-import du mauvais compilait sans broncher et multipliait par huit le repli
   * d'un écran. `LIGNES_VISIBLES` compte des **personnes**, `SEANCES_VISIBLES` des **cartes de
   * cours à venir**, `COURS_HISTORIQUE_VISIBLES` des **cours déjà donnés**.
   */
  it("a sa propre constante : un plafond de noms n'est pas un nombre de cours", () => {
    expect(new Set([LIGNES_VISIBLES, SEANCES_VISIBLES, COURS_HISTORIQUE_VISIBLES]).size).toBe(3);
    // Et le nom en double a bien disparu : la grille du planning lit celui de `listes.ts`.
    expect(source(GRILLE_PLANNING)).not.toMatch(/export const SEANCES_VISIBLES/);
    const code = source(HISTORIQUE);
    // Côté serveur (ce qu'on rapatrie) comme à l'affichage (ce qu'on replie), la même constante.
    expect(code).toMatch(/historiquePresences\([^)]*COURS_HISTORIQUE_VISIBLES/);
    // Le plafond des noms peut être cité en commentaire, mais l'écran ne l'importe plus.
    expect(code).not.toMatch(/^import[^;]*LIGNES_VISIBLES/m);
    // La porte de sortie est dite : `?tout=1` recharge tout l'historique, toutes périodes confondues.
    expect(code).toMatch(/tout=1[^]{0,600}toutes les périodes|toutes les périodes[^]{0,600}tout=1/);
  });

  it("le repli réutilise le patron des séances, pas un troisième", () => {
    const code = source(LISTE_REPLIEE);
    expect(code).toContain('"use client"');
    // L'état n'est plus une bascule « tout ou rien » mais un nombre de lignes demandées : le
    // dévoilement se fait par tranches (voir `devoilement-par-tranches.test.ts`).
    expect(code).toMatch(/useState\(debut\)/);
    expect(code).toMatch(/cachees\.length === 0/);
  });
});

describe("/admin/membres — la coupe se fait côté serveur", () => {
  it("ne charge plus tous les comptes du club", () => {
    const code = source(ADMIN_MEMBRES);
    expect(code).toMatch(/take: PAR_PAGE/);
    expect(code).toMatch(/db\.user\.count\(/);
  });

  /**
   * **La seule liste qui ne se coupe pas à dix**, et c'est voulu : ici « voir la suite » est une
   * requête, pas un dépliage. On reprend donc la taille de page des autres longues listes de
   * l'espace admin (journal d'audit, sessions), qui laisse un club ordinaire entièrement visible.
   */
  it("reprend la taille de page des autres listes d'administration, pour ne rien changer à un club ordinaire", () => {
    const tailleDePage = (f: string) => Number(/const PAR_PAGE = (\d+);/.exec(source(f))?.[1]);
    expect(tailleDePage(ADMIN_MEMBRES)).toBe(tailleDePage("src/app/(app)/admin/audit/page.tsx"));
    expect(tailleDePage(ADMIN_MEMBRES)).toBeGreaterThan(12);
  });

  it("annonce le reste et sait tout afficher", () => {
    const code = source(ADMIN_MEMBRES);
    expect(code).toContain("libelleAfficher");
    // La liste entière se demande par l'URL (`?tout=1`), pas par un état du navigateur
    expect(code).toMatch(/p\.set\("tout", "1"\)/);
    expect(code).toContain("LIBELLE_REPLIER");
  });
});

describe("tableau de bord — on l'ouvre pour trouver les décrocheurs", () => {
  // Le tableau affiche « Prénom Nom » : le prénom est donc ce qui classe (voir `tri.ts`).
  const membres = [
    { prenom: "Alix", nom: "Aubry", pourcentage: 80, sansReponse: 0 },
    { prenom: "Charlie", nom: "Bernard", pourcentage: 20, sansReponse: 7 },
    { prenom: "Chloé", nom: "Arnaud", pourcentage: 50, sansReponse: 3 },
  ];

  it("classe par « Prénom Nom » par défaut, comme la ligne s'écrit", () => {
    expect(trierMembres(membres, "nom").map((m) => m.prenom)).toEqual(["Alix", "Charlie", "Chloé"]);
  });

  it("trie le taux en croissant : les décrocheurs en haut", () => {
    expect(trierMembres(membres, "taux").map((m) => m.prenom)).toEqual(["Charlie", "Chloé", "Alix"]);
  });

  it("trie les sans-réponse en décroissant : les silencieux en haut", () => {
    expect(trierMembres(membres, "sansReponse").map((m) => m.prenom)).toEqual(["Charlie", "Chloé", "Alix"]);
  });

  it("ne modifie pas la liste reçue", () => {
    trierMembres(membres, "taux");
    expect(membres.map((m) => m.prenom)).toEqual(["Alix", "Charlie", "Chloé"]);
  });

  it("retombe sur l'ordre alphabétique devant un paramètre inconnu ou absent", () => {
    expect(lireTri(undefined)).toBe("nom");
    expect(lireTri("n'importe quoi")).toBe("nom");
    expect(lireTri("taux")).toBe("taux");
    expect(lireTri("sansReponse")).toBe("sansReponse");
  });

  it("le tri voyage dans l'URL : l'écran reste un composant serveur", () => {
    const code = source(TABLEAU_DE_BORD);
    expect(code).toMatch(/searchParams: Promise<\{[^}]*tri\?: string/);
    expect(code).toContain("lireTri");
    expect(code).toContain("trierMembres");
    expect(code).not.toContain('"use client"');
  });
});
