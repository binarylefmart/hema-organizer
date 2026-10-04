import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  detailDesReponses,
  hauteurDuSeuil,
  MINI_SEGMENT_MOT,
  MOT_BANDE,
  MOT_SEGMENT,
  nombresDeLaColonne,
  partDesInvites,
  segmentsDeBande,
} from "@/lib/frise";
import { PART_EFFECTIF_LIVREE } from "@/lib/constants";
import { palierEffectif, SEUIL_PLANCHER, seuilEnPersonnes } from "@/lib/presences";

/**
 * **La frise de fréquentation, dessin « capacité »**, son **dépliage** (choisi le même jour parmi
 * quatre maquettes) et le **retrait des absents** du dessin (demande du même jour : « je ne veux
 * pas voir apparaître les absents — le schéma de couleurs était juste pour l'info »).
 *
 * Deux choses se vérifient ici, et elles ne se vérifient pas de la même façon :
 *
 * 1. **Les calculs** (`partDesInvites`, `segmentsDeBande`, `nombresDeLaColonne`,
 *    `detailDesReponses`) sont des fonctions pures, donc éprouvées en les exécutant. Ce sont les
 *    seuls endroits où une erreur ne se verrait pas à l'œil : une colonne qui déborderait de son
 *    cadre, un seuil placé de travers ou une bande dont les segments ne totalisent pas la largeur
 *    restent des dessins plausibles.
 * 2. **Les partis pris du dessin** — les deux pixels entre le vert et l'ocre, le cadre à la
 *    hauteur des invités, la date écrite en entier, les deux nombres à la couleur de leur statut,
 *    l'absence de toute rouille, la colonne gardée pour une séance annulée, le dépliage au clavier
 *    et l'ouverture du prochain cours dès le premier rendu — se vérifient sur la **source** des
 *    composants. Le dépôt garde `jsx: "preserve"`, donc Vitest ne sait pas importer un `.tsx`
 *    rendu ; c'est le procédé déjà employé par `tests/unit/squelettes.test.ts`.
 */
const SOURCE = readFileSync(path.join(process.cwd(), "src/components/accueil/Frise.tsx"), "utf8");
const SOURCE_DETAIL = readFileSync(path.join(process.cwd(), "src/components/accueil/FriseDetail.tsx"), "utf8");

/** Un jeu de compteurs complet, du même moule que `compteursDepuisTotaux`. */
function compteurs(presents: number, peutEtre: number, absents: number, invites: number) {
  const repondu = presents + peutEtre + absents;
  return { invites, presents, peutEtre, absents, enAttente: Math.max(0, invites - repondu), repondu, pourcentage: 0 };
}

describe("la hauteur d'une colonne", () => {
  it("rend le pourcentage de l'effectif invité", () => {
    expect(partDesInvites(6, 12)).toBe(50);
    expect(partDesInvites(3, 12)).toBe(25);
    expect(partDesInvites(12, 12)).toBe(100);
  });

  it("ne dépasse jamais le cadre, même si les réponses dépassent le nombre d'invités", () => {
    // Un compte de service oublié ou un invité retiré en cours de trimestre : la colonne doit
    // rester dans son cadre plutôt que de le crever.
    expect(partDesInvites(14, 12)).toBe(100);
  });

  it("vaut zéro plutôt que de diviser par zéro sur une période sans invité", () => {
    expect(partDesInvites(3, 0)).toBe(0);
    expect(partDesInvites(0, 12)).toBe(0);
  });

  it("ne rend jamais de hauteur négative", () => {
    expect(partDesInvites(-2, 12)).toBe(0);
  });

  it("place le seuil au même endroit quelle que soit la colonne", () => {
    // L'échelle est absolue — l'effectif invité —, donc le trait est à la même hauteur partout :
    // c'est ce qui rend la comparaison entre cours honnête.
    expect(partDesInvites(4, 12)).toBeCloseTo((4 / 12) * 100, 6);
  });

  /**
   * **Le trait du seuil suit la part réglée par le club, plancher compris.** Le poser à la part
   * elle-même (20 % de hauteur, toujours) serait faux dans un petit club, où c'est le plancher de
   * quatre personnes qui commande : la frise annoncerait un seuil que l'alerte « peu de monde » ne
   * suivrait pas.
   */
  it("pose le trait du seuil là où il commande vraiment", () => {
    // Grand club : la part l'emporte, le trait est pile à la part réglée.
    expect(hauteurDuSeuil(PART_EFFECTIF_LIVREE, 80)).toBeCloseTo(20, 6);
    // Petit club : le plancher l'emporte, le trait monte au-dessus de la part.
    expect(hauteurDuSeuil(PART_EFFECTIF_LIVREE, 12)).toBeCloseTo((4 / 12) * 100, 6);
    expect(hauteurDuSeuil(PART_EFFECTIF_LIVREE, 0)).toBe(0);
  });
});

describe("les deux nombres au-dessus d'une colonne", () => {
  it("les rend dans l'ordre présents, peut-être — et rien d'autre", () => {
    expect(nombresDeLaColonne(compteurs(5, 2, 3, 18), false)).toEqual([
      { cle: "presents", nombre: 5 },
      { cle: "peutEtre", nombre: 2 },
    ]);
  });

  it("n'écrit jamais le nombre d'absents, si grand soit-il", () => {
    // Le cœur de la demande : la frise dit qui vient, elle ne montre pas du doigt ceux qui ne
    // viennent pas. Douze absents ne font pas apparaître un troisième nombre.
    const nombres = nombresDeLaColonne(compteurs(2, 1, 12, 18), false);
    expect(nombres.map((n) => n.cle)).toEqual(["presents", "peutEtre"]);
    expect(nombres.map((n) => n.nombre)).toEqual([2, 1]);
  });

  it("n'écrit pas un zéro : des zéros alignés seraient du bruit", () => {
    expect(nombresDeLaColonne(compteurs(5, 0, 3, 18), false)).toEqual([{ cle: "presents", nombre: 5 }]);
    // Personne n'a encore répondu : la colonne n'écrit rien du tout, et c'est la bonne réponse.
    expect(nombresDeLaColonne(compteurs(0, 0, 0, 18), false)).toEqual([]);
  });

  it("n'écrit aucun nombre sur une séance annulée", () => {
    // Elle n'a ni effectif ni liste qui vaille : la colonne porte un tiret, pas des chiffres.
    expect(nombresDeLaColonne(compteurs(5, 2, 3, 18), true)).toEqual([]);
  });
});

describe("la bande du panneau déplié", () => {
  it("reflète exactement la colonne : vert, ocre, puis tout le reste du club en un bloc", () => {
    const segments = segmentsDeBande(compteurs(5, 2, 3, 20));
    expect(segments.map((s) => s.cle)).toEqual(["presents", "peutEtre", "reste"]);
    // 3 absents + 10 sans réponse fondus dans un seul segment neutre : ni segment rouille, ni
    // décompte d'absents.
    expect(segments.map((s) => s.nombre)).toEqual([5, 2, 13]);
    expect(segments.map((s) => s.part)).toEqual([25, 10, 65]);
  });

  it("ne dessine aucun segment d'absents, même quand tout le monde a répondu", () => {
    const segments = segmentsDeBande(compteurs(4, 0, 6, 10));
    expect(segments.map((s) => s.cle)).toEqual(["presents", "reste"]);
    expect(segments.find((s) => s.cle === "reste")?.nombre).toBe(6);
  });

  it("remplit toute la largeur, même si les réponses ne collent plus au nombre d'invités", () => {
    // Un invité retiré du trimestre après avoir répondu : mieux vaut une bande pleine et juste
    // entre ses segments qu'une bande qui s'arrête avant le bord sans qu'on sache pourquoi.
    const segments = segmentsDeBande({ presents: 6, peutEtre: 0, absents: 2, enAttente: 0 });
    expect(segments.reduce((n, s) => n + s.part, 0)).toBeCloseTo(100, 6);
  });

  it("ne dessine pas un groupe vide, qui se lirait comme un groupe de plus", () => {
    expect(segmentsDeBande(compteurs(4, 0, 0, 4)).map((s) => s.cle)).toEqual(["presents"]);
  });

  it("n'écrit le mot d'un segment qu'à partir de deux personnes", () => {
    // En dessous, le segment est trop étroit : le mot s'y ferait couper au milieu, et un mot
    // tronqué ne dit rien. Le nombre, lui, tient toujours.
    const segments = segmentsDeBande(compteurs(1, 2, 0, 3));
    expect(segments.find((s) => s.cle === "presents")?.avecMot).toBe(false);
    expect(segments.find((s) => s.cle === "peutEtre")?.avecMot).toBe(true);
    expect(MINI_SEGMENT_MOT).toBe(2);
  });

  it("ne rend aucun segment quand il n'y a personne à répartir", () => {
    expect(segmentsDeBande({ presents: 0, peutEtre: 0, absents: 0, enAttente: 0 })).toEqual([]);
  });

  it("nomme ses trois segments sans jamais accuser personne", () => {
    expect(MOT_BANDE).toEqual({ presents: "présents", peutEtre: "peut-être", reste: "reste du club" });
  });
});

describe("le compte complet, réservé à qui le demande", () => {
  it("dit les quatre groupes, absents compris", () => {
    // Infobulle et lecteur d'écran : du détail à la demande, pas un affichage. C'est le seul
    // endroit de la frise où le mot « absents » sort encore.
    expect(detailDesReponses(compteurs(5, 2, 3, 20))).toBe("5 présents, 2 peut-être, 3 absents, 10 sans réponse");
  });

  it("accorde le singulier, et tait les groupes vides", () => {
    expect(detailDesReponses(compteurs(1, 0, 1, 2))).toBe("1 présent, 1 absent");
  });

  it("le dit en toutes lettres quand personne n'a répondu", () => {
    expect(detailDesReponses({ presents: 0, peutEtre: 0, absents: 0, enAttente: 0 })).toBe("aucune réponse");
  });

  it("nomme les quatre groupes en français", () => {
    expect(MOT_SEGMENT).toEqual({ presents: "présents", peutEtre: "peut-être", absents: "absents", sansReponse: "sans réponse" });
  });
});

describe("le dessin de la frise", () => {
  it("donne à chaque colonne la hauteur de l'effectif invité", () => {
    // Le cadre porte le fond doux et la bordure : c'est lui qui matérialise le club entier.
    expect(SOURCE).toMatch(/border-bordure bg-surface-douce/);
    expect(SOURCE).toMatch(/\{invites\} invités du trimestre/);
  });

  it("sépare le segment ocre du vert par deux pixels de fond", () => {
    expect(SOURCE).toMatch(/mb-\[2px\] block w-full bg-ocre/);
  });

  it("écrit les deux nombres à la couleur de leur statut, le plus gros pour les présents", () => {
    expect(SOURCE).toMatch(/nombresDeLaColonne\(c\.compteurs, c\.annulee\)/);
    expect(SOURCE).toMatch(/TEXTE_SEGMENT\[cle\]/);
    expect(SOURCE).toMatch(/dense \? "text-lg" : "text-2xl"/);
    expect(SOURCE).toMatch(/cle === "presents" \? "font-bold"/);
    expect(SOURCE_DETAIL).toMatch(/presents: "text-vert"/);
    expect(SOURCE_DETAIL).toMatch(/peutEtre: "text-ocre"/);
  });

  it("n'a plus une seule trace de rouille, ni dans les nombres ni ailleurs", () => {
    // Demande : les absents disparaissent du dessin. Plus aucune classe rouge dans la frise ni dans
    // son panneau — le mot reste dans les commentaires qui expliquent pourquoi.
    expect(SOURCE).not.toMatch(/bg-rouge|text-rouge|rouge-doux/);
    expect(SOURCE_DETAIL).not.toMatch(/bg-rouge|text-rouge|rouge-doux/);
    // La table des couleurs de texte n'a plus que les deux nombres écrits sur la frise.
    expect(SOURCE_DETAIL).toMatch(/TEXTE_SEGMENT: Record<CleNombre, string>/);
  });

  it("n'habille plus le nombre de présents de la couleur du palier", () => {
    // Conséquence assumée : sur un **statut**, la couleur dit *lequel*. Le palier, lui, reste
    // lisible sur le dessin — une colonne dont le vert n'atteint pas le trait du seuil est un cours
    // en danger — et son mot reste dans l'infobulle.
    expect(SOURCE).not.toMatch(/TEXTE_PALIER\[/);
    expect(SOURCE).not.toMatch(/import .*TEXTE_PALIER/);
    expect(SOURCE).toMatch(/PALIER_LABELS\[palier\]/);
  });

  it("ne préfixe plus les peut-être d'un plus", () => {
    expect(SOURCE).not.toMatch(/\+\{peutEtre\}/);
  });

  it("écrit des dates, et jamais un numéro de jour nu", () => {
    expect(SOURCE).toMatch(/formatDateFrise/);
    expect(SOURCE).toMatch(/dateEnDeuxLignes/);
    expect(SOURCE).not.toMatch(/function jourSeul/);
  });

  it("trace la ligne du seuil dans chaque colonne, à la part reçue du club", () => {
    // Le trait passe par le calcul partagé, jamais par un ratio recomposé dans le JSX : le seuil
    // est une **part** de l'effectif invité, plancher de quatre compris, et `hauteurDuSeuil` est le
    // seul endroit où cette hauteur se calcule. Le poser à la part elle-même le placerait à 20 % de
    // la colonne dans un club où c'est le plancher qui commande. L'effectif est celui **de la
    // colonne** (voir plus bas, « deux trimestres sur la même frise »).
    expect(SOURCE).toMatch(/hauteurDuSeuil\(partEffectifMin, invitesColonne\)/);
    expect(SOURCE).not.toMatch(/partDesInvites\(partEffectifMin, invites\)/);
    // La part arrive en propriété : la frise est un composant client, et importer `identite.ts`
    // d'ici entraînerait `node:crypto` dans le bundle du navigateur.
    expect(SOURCE).not.toMatch(/from "@\/lib\/identite"/);
  });

  it("ne nomme dans sa légende que les présents, les peut-être et le cadre des invités", () => {
    for (const pastille of ["bg-vert", "bg-ocre"]) expect(SOURCE).toContain(`rounded-sm ${pastille}`);
    // Aucune pastille d'absents : elle annoncerait une couleur qui n'existe plus sur la frise.
    expect(SOURCE).not.toContain("rounded-sm bg-rouge");
    // La légende chiffre l'effectif quand toutes les colonnes le partagent, et le nomme sans le
    // chiffrer quand la frise mêle deux trimestres : un nombre unique y serait faux pour l'un des deux.
    expect(SOURCE).toMatch(/\{invites === null \? "invités" : `\$\{invites\} invités`\}/);
    // La note de pied suit la légende : deux couleurs, le seuil, le haut de la colonne.
    expect(SOURCE).toMatch(/Au-dessus de chaque colonne : les présents en vert, les peut-être en ocre\./);
  });

  it("donne le détail complet au survol et au lecteur d'écran, absents compris", () => {
    expect(SOURCE).toMatch(/title=\{detail\}/);
    expect(SOURCE).toMatch(/aria-label=\{detail\}/);
    expect(SOURCE).toMatch(/detailDesReponses\(c\.compteurs\)/);
    expect(SOURCE).toMatch(/attendus sur \$\{invitesColonne\} invités/);
    expect(SOURCE_DETAIL).toMatch(/aria-label=\{`Sur \$\{compteurs\.invites\} invités : \$\{resume\}`\}/);
  });

  it("garde la colonne d'une séance annulée, vide et marquée", () => {
    // La sauter décalerait les autres et ferait croire à un cours de moins.
    expect(SOURCE).toMatch(/c\.annulee \? \(/);
    expect(SOURCE).toMatch(/line-through/);
  });

  it("laisse la frise dense défiler plutôt que d'écraser ses dates", () => {
    expect(SOURCE).toMatch(/overflow-x-auto/);
    expect(SOURCE).toMatch(/min-w-\[2\.75rem\]/);
  });
});

describe("le dépliage d'une colonne", () => {
  /**
   * **L'invariant « composant serveur sans état » est tombé, en connaissance de cause.** Quelle
   * colonne est ouverte est un état purement local et éphémère : le tenir côté serveur demanderait
   * un aller-retour par page, donc un rechargement complet pour ouvrir un panneau. Et aucune donnée
   * de plus ne part au navigateur — les listes nominatives sont déjà envoyées à la frise, ouvertes
   * à tout le club depuis l'étape 3.
   */
  it("assume d'être un composant client, et l'explique", () => {
    expect(SOURCE).toContain('"use client"');
    expect(SOURCE).toMatch(/useState/);
    // La phrase est cherchée **à travers les retours à la ligne** : ce qui est exigé, c'est que la
    // raison soit écrite, pas qu'elle tienne sur une ligne — un commentaire se replie.
    expect(SOURCE.replace(/\s*\n\s*\*\s*/g, " ")).toMatch(/aucune donnée de plus ne part au navigateur/);
  });

  it("ne rend cliquables que les colonnes qui portent des détails, et jamais une séance annulée", () => {
    expect(SOURCE).toMatch(/c\.details !== undefined && !c\.annulee/);
    // Sans `details`, la colonne reste un simple bloc : la frise du mois de la vue Admin se
    // comporte exactement comme avant le dépliage.
    expect(SOURCE).toMatch(/if \(!depliable\(c\)\) \{/);
    expect(SOURCE).toMatch(/details\?: DetailsCours/);
  });

  it("fait de chaque colonne dépliable un vrai bouton, annoncé au clavier", () => {
    // Un `<button>` apporte d'un coup le focus, Entrée **et** Espace, le rôle et le contour de
    // focus de la charte — ce qu'un `div` cliquable aurait fallu réécrire à la main.
    expect(SOURCE).toMatch(/<button/);
    expect(SOURCE).toMatch(/type="button"/);
    expect(SOURCE).toMatch(/aria-expanded=\{estOuvert\}/);
    expect(SOURCE).toMatch(/aria-controls=\{`\$\{idBase\}-\$\{c\.id\}`\}/);
  });

  it("ouvre d'emblée la première colonne dépliable : le prochain cours qui aura lieu", () => {
    // Demande : c'est justement le cours dont on veut le détail en arrivant.
    expect(SOURCE).toMatch(/useState<string \| null>\(\(\) => cours\.find\(depliable\)\?\.id \?\? null\)/);
  });

  it("n'ouvre rien quand aucune colonne n'est dépliable", () => {
    // Frise du mois de la vue Admin, trimestre sans détail : `find` ne rend rien, l'état part à
    // `null`, et le panneau n'est pas même rendu (`coursOuvert?.details &&`).
    expect(SOURCE).toMatch(/\?\? null\)/);
    expect(SOURCE).toMatch(/coursOuvert\?\.details && \(/);
    expect(SOURCE).toMatch(/aucune n'est dépliable/);
  });

  it("n'anime pas l'ouverture du premier rendu, mais anime celles qu'on déclenche", () => {
    // Le panneau est déjà là au chargement : il ne doit pas se déplier sous les yeux, le premier
    // écran doit être lisible tout de suite. L'état de départ est alors « ouvert », donc le
    // navigateur ne voit aucun état fermé et n'a rien à animer.
    expect(SOURCE).toMatch(/const \[appuye, setAppuye\] = useState\(false\)/);
    expect(SOURCE).toMatch(/setAppuye\(true\)/);
    expect(SOURCE).toMatch(/anime=\{appuye\}/);
    expect(SOURCE_DETAIL).toMatch(/useState\(!anime\)/);
  });

  it("n'ouvre qu'une colonne à la fois, et referme celle qui l'était déjà", () => {
    expect(SOURCE).toMatch(/setOuvert\(estOuvert \? null : c\.id\)/);
    // Les autres colonnes passent en retrait, l'ouverte prend un cadre marqué.
    expect(SOURCE).toMatch(/opacity-60/);
  });

  it("porte la date, l'horaire et le lieu — les seules choses que la frise ne montre pas", () => {
    expect(SOURCE_DETAIL).toMatch(/formatDateCourte\(date\)/);
    expect(SOURCE_DETAIL).toMatch(/formatHoraire\(details\.heureDebut, details\.heureFin\)/);
    expect(SOURCE_DETAIL).toMatch(/\{details\.lieu\}/);
  });

  it("fait du lieu un lien vers la carte, comme la carte de séance", () => {
    // Deux façons d'écrire un lieu sur le même écran se liraient comme deux natures de choses :
    // le panneau reprend `lienCarte`, l'ouverture dans un onglet et le soulignement de la charte.
    expect(SOURCE_DETAIL).toMatch(/href=\{lienCarte\(details\.lieu, details\.adresse\)\}/);
    expect(SOURCE_DETAIL).toMatch(/rel="noopener noreferrer"/);
    expect(SOURCE_DETAIL).toMatch(/underline decoration-bordure hover:text-lien hover:decoration-lien/);
    // La ligne reste une cible confortable au doigt (44 px).
    expect(SOURCE_DETAIL).toMatch(/min-h-11/);
  });

  it("couche la colonne en bande, aux mêmes couleurs et avec les mêmes deux pixels de fond", () => {
    expect(SOURCE_DETAIL).toMatch(/segmentsDeBande\(compteurs\)/);
    expect(SOURCE_DETAIL).toMatch(/gap-\[2px\]/);
    expect(SOURCE_DETAIL).toMatch(/presents: "bg-vert text-primaire-texte"/);
    // Le reste du club : un seul segment neutre, en cadre pointillé, sans couleur d'accusation.
    expect(SOURCE_DETAIL).toMatch(/reste: "border border-dashed border-bordure bg-surface-douce text-texte-secondaire"/);
    expect(SOURCE_DETAIL).toMatch(/MOT_BANDE\[s\.cle\]/);
    expect(SOURCE_DETAIL).toMatch(/s\.avecMot && /);
  });

  it("montre les noms, sans rouge, et garde le pointillé pour les seuls sans-réponse", () => {
    expect(SOURCE_DETAIL).toMatch(/PUCE_SEGMENT\[p\.cle\]/);
    expect(SOURCE_DETAIL).toMatch(/presents: "bg-vert-doux text-vert"/);
    expect(SOURCE_DETAIL).toMatch(/peutEtre: "bg-ocre-doux text-ocre"/);
    // Les absents ont répondu : puce neutre, sans marque particulière.
    expect(SOURCE_DETAIL).toMatch(/absents: "bg-surface-douce text-texte-secondaire"/);
    // Les sans-réponse gardent le pointillé : c'est la seule distinction qui appelle un geste.
    expect(SOURCE_DETAIL).toMatch(/sansReponse: "border border-dashed border-bordure text-texte-secondaire"/);
    /*
     * **Les quatre groupes sont toujours là** — « qui a répondu » est l'intérêt du panneau —, mais
     * ils ne sont plus écrits à la main ici : l'ordre vient de `ORDRE_GROUPES`, partagé avec
     * `ListeParticipants`, pour que les deux listes nominatives de l'application ne puissent pas
     * diverger. Et depuis que le club peut compter quatre-vingts personnes, les puces sont coupées
     * (`couper`) : ce qui appelle un geste passe devant, le reste derrière un bouton qui n'existe
     * que s'il y a quelque chose à cacher (voir `tests/unit/listes-longues.test.ts`).
     */
    expect(SOURCE_DETAIL).toMatch(/ORDRE_GROUPES\.map\(\(cle\) => \(\{ cle, liste: cle \}\)\)/);
    expect(SOURCE_DETAIL).toMatch(/couper\(noms\)/);
    expect(SOURCE_DETAIL).toMatch(/\{p\.prenom\} \{p\.nom\}/);
  });

  it("relie le panneau à sa colonne par une pointe", () => {
    expect(SOURCE_DETAIL).toMatch(/rotate-45/);
    expect(SOURCE_DETAIL).toMatch(/left: `\$\{pointe\}%`/);
  });

  it("ouvre avec une transition courte, coupée pour qui a demandé moins de mouvement", () => {
    expect(SOURCE_DETAIL).toMatch(/transition-all duration-200/);
    expect(SOURCE_DETAIL).toMatch(/grid-rows-\[0fr\]/);
    expect(SOURCE_DETAIL).toMatch(/motion-reduce:transition-none/);
  });
});

/**
 * **Un club de douze ne doit rien voir changer**.
 *
 * Le seuil d'hier était un **nombre de personnes** et valait 4 ; il est devenu une **part de
 * l'effectif invité** (20 %) avec un plancher de quatre. Sur les douze invités du club pour lequel
 * l'outil a été écrit, 20 % font 2,4 : c'est le plancher qui gagne, et le seuil retombe exactement
 * sur 4. Rien de ce qui s'affiche ne doit donc bouger d'un pixel ni d'un mot — c'est la condition
 * pour que le passage à un réglage en pourcentage ne soit pas une régression déguisée pour eux.
 *
 * Ce qui se vérifie ici en l'exécutant : le seuil, la hauteur du trait, et le palier pour **toutes**
 * les répartitions de réponses possibles à douze. Ce qui se vérifie sur la source : la légende écrit
 * bien un seuil **en personnes**, et non la part brute — c'est là que le mensonge se serait logé.
 */
describe("un club de douze ne voit rien changer", () => {
  /** L'échelle d'hier, recopiée exprès : un seuil de 4 personnes et un confort à 4 + 3. */
  function palierDHier(c: { presents: number; peutEtre: number; invites: number }): string {
    const seuil = 4;
    if (c.invites <= seuil) return "indetermine";
    const attendus = c.presents + Math.round(c.peutEtre / 2);
    if (attendus < seuil) return "danger";
    if (attendus < seuil + 3) return "juste";
    return "bien";
  }

  it("retombe exactement sur le seuil de quatre personnes", () => {
    expect(seuilEnPersonnes(PART_EFFECTIF_LIVREE, 12)).toBe(SEUIL_PLANCHER);
    expect(seuilEnPersonnes(PART_EFFECTIF_LIVREE, 12)).toBe(4);
  });

  it("place le trait du seuil exactement là où il était", () => {
    expect(hauteurDuSeuil(PART_EFFECTIF_LIVREE, 12)).toBeCloseTo(partDesInvites(4, 12), 6);
  });

  it("donne les mêmes paliers qu'hier, répartition par répartition", () => {
    for (let presents = 0; presents <= 12; presents += 1) {
      for (let peutEtre = 0; peutEtre <= 12 - presents; peutEtre += 1) {
        const c = compteurs(presents, peutEtre, 12 - presents - peutEtre, 12);
        expect(palierEffectif(c, PART_EFFECTIF_LIVREE)).toBe(palierDHier(c));
      }
    }
  });

  it("annonce dans la légende un seuil en personnes, jamais la part brute", () => {
    expect(SOURCE).toMatch(/seuilEnPersonnes\(partEffectifMin, invites\)/);
    expect(SOURCE).toMatch(/marque le seuil de \$\{seuil\} personnes \(\$\{partEffectifMin\} % des invités\)/);
    expect(SOURCE).not.toMatch(/seuil de \$?\{partEffectifMin\} personnes/);
  });

  it("laisse en revanche un club de quatre-vingts passer à seize", () => {
    // L'autre moitié de la promesse : ce qui ne change pas pour douze doit changer pour les autres,
    // sans quoi le réglage n'aurait servi à rien.
    expect(seuilEnPersonnes(PART_EFFECTIF_LIVREE, 80)).toBe(16);
    expect(hauteurDuSeuil(PART_EFFECTIF_LIVREE, 80)).toBeCloseTo(20, 6);
  });
});

/**
 * **Deux trimestres sur la même frise**.
 *
 * L'effectif invité était pris **une fois pour toutes**, au maximum des colonnes : vrai tant que la
 * frise ne montrait qu'une période, faux dès qu'elle en montre deux. Et elle en montre deux — les
 * prochains cours de l'accueil viennent de **toutes** les périodes ACTIVE où la personne est invitée
 * (`prochainesSeances`), et un club qui tient un trimestre « Adultes » (60 invités) et un trimestre
 * « Enfants » (10) en a bien deux ouverts en même temps.
 *
 * Conséquence, sur la même ligne : une colonne « Enfants » à 8 présents sur 10 se dessinait à 8/60 —
 * 13 % de hauteur, **sous le trait du seuil** — avec l'étiquette « Bien rempli » et l'infobulle
 * « 8 présents sur **60** invités ». Le palier, lui, était déjà calculé par colonne : le dessin
 * contredisait le mot écrit juste à côté.
 *
 * Les hauteurs se vérifient en exécutant les calculs (ce sont eux qui portent l'erreur invisible à
 * l'œil) ; le fait que la colonne prenne **son** effectif se vérifie sur la source, faute de pouvoir
 * rendre un `.tsx` sous Vitest.
 */
describe("deux trimestres ouverts en même temps", () => {
  const PART = PART_EFFECTIF_LIVREE;

  it("dessine chaque colonne à l'échelle de son propre trimestre", () => {
    // Le club « Enfants » : 8 présents sur 10 invités, c'est-à-dire une colonne aux quatre cinquièmes.
    expect(partDesInvites(8, 10)).toBe(80);
    // À l'échelle du trimestre voisin (60 invités), la même colonne tombait à 13 % : une jauge vide.
    expect(Math.round(partDesInvites(8, 60))).toBe(13);
  });

  it("place le trait du seuil au seuil du trimestre de la colonne", () => {
    // 20 % de 10 invités, plancher de quatre compris : le trait est à 40 % de la colonne « Enfants »…
    expect(hauteurDuSeuil(PART, 10)).toBeCloseTo(40, 6);
    // …et à 20 % de celle du trimestre « Adultes ». Pris sur le voisin, il aurait annoncé un seuil de
    // douze personnes à un groupe de dix.
    expect(hauteurDuSeuil(PART, 60)).toBeCloseTo(20, 6);
    expect(seuilEnPersonnes(PART, 10)).toBe(SEUIL_PLANCHER);
    expect(seuilEnPersonnes(PART, 60)).toBe(12);
  });

  it("ne laisse pas le dessin contredire le palier, qui est calculé par colonne", () => {
    // Huit présents sur dix : « bien rempli », et la colonne doit être au-dessus du trait du seuil.
    const enfants = compteurs(8, 0, 0, 10);
    expect(palierEffectif(enfants, PART)).toBe("bien");
    expect(partDesInvites(enfants.presents, enfants.invites)).toBeGreaterThan(hauteurDuSeuil(PART, enfants.invites));
  });

  it("prend l'effectif de la colonne pour sa hauteur, son seuil et son infobulle", () => {
    // L'échelle vient de la colonne elle-même, et non d'un maximum pris sur toute la frise : c'est
    // **cette ligne-là** qui portait le défaut, les usages plus bas n'ayant jamais changé de nom.
    expect(SOURCE).toMatch(/const invitesDe = \(c: CoursFrise\) => Math\.max\(1, c\.compteurs\.invites\);/);
    expect(SOURCE).not.toMatch(/Math\.max\(1, \.\.\.cours\.map/);
    expect(SOURCE).toMatch(/const invitesColonne = invitesDe\(c\);/);
    expect(SOURCE).toMatch(/partDesInvites\(peutEtre, invitesColonne\)/);
    expect(SOURCE).toMatch(/partDesInvites\(presents, invitesColonne\)/);
    expect(SOURCE).toMatch(/hauteurDuSeuil\(partEffectifMin, invitesColonne\)/);
    expect(SOURCE).toMatch(/attendus sur \$\{invitesColonne\} invités/);
    // Et plus une seule hauteur ni un seul seuil calculés sur l'effectif commun à toute la frise.
    expect(SOURCE).not.toMatch(/partDesInvites\([a-zA-Z]+, invites\)/);
    expect(SOURCE).not.toMatch(/hauteurDuSeuil\(partEffectifMin, invites\)/);
  });

  /**
   * **Le second défaut de la même ligne** : le trait se traçait sans la garde qu'a `BarreTaux`
   * (`invites > seuil`). Sur un trimestre de trois invités, le seuil vaut le plancher — quatre —,
   * donc le trait se posait à 100 % de la colonne pendant qu'aucune colonne ne pouvait l'atteindre et
   * qu'aucune ne recevait de couleur de palier (`palierEffectif` rend « indéterminé »). Un seuil
   * dessiné auquel personne ne peut répondre est un reproche adressé à un petit groupe.
   */
  it("ne trace aucun trait sur un trimestre trop petit pour que le seuil ait un sens", () => {
    expect(seuilEnPersonnes(PART, 3)).toBe(SEUIL_PLANCHER);
    expect(palierEffectif(compteurs(3, 0, 0, 3), PART)).toBe("indetermine");
    /*
     * **La garde se LIT, elle ne se recopie plus**. Ce test exigeait la condition `invitesColonne >
     * seuilColonne`, recopiée de `palierEffectif` du temps où c'était sa seule borne dégénérée. Le
     * jour où `palierEffectif` en a gagné une seconde — un groupe trop petit pour que « bien » soit
     * atteignable —, la copie a cessé de dire la même chose que l'original, et le commentaire de la
     * frise (« c'est aussi la garde de `palierEffectif` ») est devenu faux sans que rien n'échoue.
     * Un test qui épingle une condition recopiée verrouille la copie, pas la règle.
     */
    expect(SOURCE).toMatch(/\{palier !== "indetermine" && \(/);
    // Et la colonne lit bien la fonction, une fois, pour le mot comme pour le trait.
    expect(SOURCE).toMatch(/const palier = palierEffectif\(c\.compteurs, partEffectifMin\);/);
    // Et le trait est bien à 100 % dans ce cas-là : c'est pourquoi il ne faut pas le dessiner.
    expect(hauteurDuSeuil(PART, 3)).toBe(100);
  });

  it("chiffre le seuil et l'effectif dans la note de pied, sauf si les colonnes n'ont pas le même", () => {
    // Un seul trimestre : la note dit le seuil en personnes et l'effectif, comme avant.
    expect(SOURCE).toMatch(/le trait en pointillé marque le seuil de \$\{seuil\} personnes/);
    // Deux trimestres : elle dit la règle sans l'appliquer à un effectif, plutôt que d'en démentir un.
    expect(SOURCE).toMatch(/les cours affichés ne sont pas tous du même trimestre/);
    expect(SOURCE).toMatch(/const invites = effectifs\.size === 1 \? \[\.\.\.effectifs\]\[0\] : null;/);
  });
});
