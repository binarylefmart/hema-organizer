/**
 * **Les gestes de la liste du planning sur téléphone** — la partie sans React, donc testable (les
 * tests ne peuvent pas importer de `.tsx`).
 *
 * Sur un téléphone, en modification, chaque élément d'une partie est une ligne compacte, et trois
 * gestes remplacent les boutons ↑ ↓ Retirer de l'ordinateur (`ListePartiesTelephone`) :
 *
 * 1. **toucher la ligne** déplie ses réglages ;
 * 2. **glisser la ligne vers la gauche** révèle « Retirer » — qu'il faut encore toucher : un glissé
 *    seul n'efface rien ;
 * 3. **tenir la poignée ⋮⋮ puis glisser** déplace l'élément, dans sa partie ou dans une autre.
 *
 * Ce module tranche ce qui se décide sur des nombres : de quel côté part un doigt, jusqu'où la ligne
 * glisse, où tombe un élément lâché, à quelle vitesse l'écran défile, combien de fois la
 * démonstration a déjà été montrée. L'écran ne fait que mesurer et peindre.
 */

/* ------------------------------------------------------------------ */
/* Glisser une ligne vers la gauche                                    */
/* ------------------------------------------------------------------ */

/**
 * En dessous de ce déplacement, le doigt n'a encore rien dit : on ne décide ni « glisser » ni
 * « défiler ». Assez pour qu'un toucher un peu tremblé reste un toucher.
 */
export const SEUIL_DIRECTION_PX = 10;

/** La largeur du bouton « Retirer » révélé, en pixels : la course complète de la ligne. */
export const LARGEUR_RETIRER_PX = 104;

/**
 * **De quel côté part le doigt** — `null` tant qu'il n'est pas allé assez loin. Un geste un peu
 * oblique compte pour un défilement : c'est le geste le plus fréquent sur une liste, et le confondre
 * avec un glissé révélerait « Retirer » à chaque descente de page.
 */
export function directionGeste(dx: number, dy: number): "horizontal" | "vertical" | null {
  if (Math.hypot(dx, dy) < SEUIL_DIRECTION_PX) return null;
  return Math.abs(dx) > Math.abs(dy) * 1.2 ? "horizontal" : "vertical";
}

/**
 * **Où est la ligne pendant le glissé**, en pixels (0 = en place, négatif = vers la gauche). Elle
 * part de sa position (révélée ou non) et ne dépasse ni sa place ni la largeur du bouton.
 */
export function decalageGlisse(dx: number, revelee: boolean): number {
  const depart = revelee ? -LARGEUR_RETIRER_PX : 0;
  return Math.min(0, Math.max(-LARGEUR_RETIRER_PX, depart + dx));
}

/** **Au lâcher** : la ligne reste ouverte si elle a fait plus de la moitié du chemin. */
export function resteRevelee(decalage: number): boolean {
  return decalage <= -LARGEUR_RETIRER_PX / 2;
}

/**
 * Le délai, après la fin d'un glissé, pendant lequel un « clic » est celui que le navigateur émet
 * pour ce même glissé. Au-delà, c'est un nouveau toucher.
 */
export const DELAI_CLIC_APRES_GLISSE_MS = 300;

/**
 * **Ce clic est-il l'écho du glissé qui vient de finir ?** Le navigateur peut émettre un `click` au
 * lever du doigt d'un glissé, et il ne doit pas déplier la ligne. L'écran retenait un simple drapeau,
 * remis à faux par le clic suivant — mais un glissé n'en émet pas toujours, et c'était alors le
 * toucher **d'après**, le vrai, qui était avalé. On ne garde donc que l'instant de la fin du glissé.
 */
export function clicApresGlisse(finGlisse: number | null, maintenant: number): boolean {
  return finGlisse !== null && maintenant - finGlisse >= 0 && maintenant - finGlisse < DELAI_CLIC_APRES_GLISSE_MS;
}

/* ------------------------------------------------------------------ */
/* Déplacer avec la poignée                                            */
/* ------------------------------------------------------------------ */

/** Une ligne mesurée à l'écran : son élément, sa partie, ses bords haut et bas. */
export type LigneMesuree = { id: string; bloc: number; haut: number; bas: number };

/** La zone « Nouvelle partie » du bas de la carte, telle qu'elle est mesurée. */
export type ZoneMesuree = { bloc: number; haut: number; bas: number };

/**
 * **Où tombera l'élément** : la partie d'arrivée, et l'élément devant lequel il se pose (`null` =
 * à la fin de la partie). C'est exactement ce que reçoit `deplacerElement`. `y` est la hauteur où
 * dessiner l'indicateur de dépôt.
 */
export type CibleDepot = { bloc: number; avantId: string | null; y: number; nouvelle: boolean };

/**
 * **La cible de dépôt sous le doigt.**
 *
 * Chaque partie offre une place **devant** chacune de ses lignes et une **à la fin** ; on prend la
 * plus proche du doigt. La ligne qu'on déplace est retirée du calcul : sa place d'origine et celle
 * de sa voisine du dessous n'en font qu'une, sinon l'indicateur sauterait d'un cran sans rien
 * changer. La fin d'une partie et le début de la suivante sont séparés par l'intitulé « Partie N »,
 * ce qui suffit à les distinguer sous le doigt.
 *
 * La zone « Nouvelle partie » gagne dès que le doigt est dedans. Rien à proposer (une seule ligne,
 * qu'on tient) : `null`.
 */
export function cibleDepot(y: number, lignes: readonly LigneMesuree[], deplacee: string, zone: ZoneMesuree | null = null): CibleDepot | null {
  if (zone && y >= zone.haut && y <= zone.bas) return { bloc: zone.bloc, avantId: null, y: (zone.haut + zone.bas) / 2, nouvelle: true };
  const autres = lignes.filter((l) => l.id !== deplacee);
  const places: CibleDepot[] = [];
  autres.forEach((l, i) => {
    const precedente = autres[i - 1];
    // Entre deux lignes de la même partie, l'indicateur se pose au milieu de l'écart.
    const y = precedente && precedente.bloc === l.bloc ? (precedente.bas + l.haut) / 2 : l.haut - 4;
    places.push({ bloc: l.bloc, avantId: l.id, y, nouvelle: false });
    const suivante = autres[i + 1];
    if (!suivante || suivante.bloc !== l.bloc) places.push({ bloc: l.bloc, avantId: null, y: l.bas + 4, nouvelle: false });
  });
  let meilleure: CibleDepot | null = null;
  for (const p of places) if (!meilleure || Math.abs(p.y - y) < Math.abs(meilleure.y - y)) meilleure = p;
  return meilleure;
}

/**
 * **Lâcher ici ne changerait rien** : l'élément retomberait à sa propre place — devant sa voisine
 * du dessous dans sa partie, ou en fin de partie s'il en est déjà le dernier. Seul dans la dernière
 * partie, l'envoyer dans une « nouvelle » partie ne changerait rien non plus : la sienne
 * disparaîtrait au moment même où l'autre naît, sous le même numéro (même règle que `blocsVoisins`).
 * Aucun appel ne part pour un geste nul.
 */
export function depotSansEffet(cible: Pick<CibleDepot, "bloc" | "avantId">, element: { id: string; bloc: number }, ordre: readonly { id: string; bloc: number }[]): boolean {
  const memePartie = ordre.filter((p) => p.bloc === element.bloc);
  const i = memePartie.findIndex((p) => p.id === element.id);
  const suivante = memePartie[i + 1]?.id ?? null;
  if (cible.bloc === element.bloc) return cible.avantId === suivante || cible.avantId === element.id;
  const derniere = ordre.reduce((max, p) => Math.max(max, p.bloc), 0);
  return memePartie.length === 1 && element.bloc === derniere && cible.bloc === derniere + 1;
}

/** La bande, en haut et en bas de l'écran, où le doigt fait défiler la page pendant un déplacement. */
export const BANDE_DEFILEMENT_PX = 96;

/** La vitesse maximale du défilement automatique, en pixels par image. */
export const VITESSE_DEFILEMENT_MAX = 18;

/**
 * **Le défilement automatique pendant un déplacement**, en pixels par image : négatif vers le haut,
 * positif vers le bas, 0 au milieu. Plus le doigt s'approche du bord, plus ça va vite. `basUtile`
 * est le bas de ce que le doigt peut viser — la barre d'édition et les onglets collés au bas du
 * téléphone en couvrent une partie, et c'est au-dessus d'eux que le défilement doit commencer.
 */
export function vitesseDefilement(y: number, hautUtile: number, basUtile: number): number {
  const bande = Math.min(BANDE_DEFILEMENT_PX, Math.max(0, (basUtile - hautUtile) / 4));
  if (bande <= 0) return 0;
  if (y < hautUtile + bande) return -Math.round(VITESSE_DEFILEMENT_MAX * Math.min(1, (hautUtile + bande - y) / bande));
  if (y > basUtile - bande) return Math.round(VITESSE_DEFILEMENT_MAX * Math.min(1, (y - (basUtile - bande)) / bande));
  return 0;
}

/**
 * **Le bas de ce que le doigt peut viser**, pour le défilement automatique : le plus haut de la barre
 * d'onglets du téléphone et des barres collées au bas de l'écran (barre d'édition, barre de
 * sélection). Ne compter que les onglets faisait commencer le défilement **sous** la barre d'édition :
 * l'élément tenu disparaissait derrière elle avant que la page ne bouge. Une barre mesurée hors de
 * l'écran (repliée, pas encore collée) ne compte pas.
 */
export function basUtileEcran(hauteurFenetre: number, onglets: number, hautsBarres: readonly number[]): number {
  let bas = hauteurFenetre - onglets;
  for (const haut of hautsBarres) if (haut > 0 && haut < bas) bas = haut;
  return bas;
}

/* ------------------------------------------------------------------ */
/* Ce que dit une ligne repliée                                        */
/* ------------------------------------------------------------------ */

/**
 * **Le résumé d'une ligne repliée** : « Instructeur · Thème », ce qui est rempli seulement. Rien de
 * rempli : `null`, et l'écran écrit « À régler », discrètement.
 */
export function resumeLigne(instructeur: string | null | undefined, theme: string | null | undefined): string | null {
  const morceaux = [instructeur, theme].map((v) => (v ?? "").trim()).filter(Boolean);
  return morceaux.length ? morceaux.join(" · ") : null;
}

/* ------------------------------------------------------------------ */
/* La démonstration des gestes                                         */
/* ------------------------------------------------------------------ */

/** La clé du compteur, dans le stockage du navigateur. */
export const CLE_DEMO_GESTES = "hema.planning.demo-gestes";

/** La démonstration se montre d'elle-même les trois premières entrées en modification. */
export const DEMO_GESTES_FOIS = 3;

/** Le compteur lu du stockage : un nombre entier positif, 0 pour tout le reste (absent, abîmé). */
export function lireCompteurDemo(brut: string | null | undefined): number {
  const n = Number.parseInt(brut ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Faut-il montrer la démonstration à cette entrée, vu le nombre de fois où elle l'a déjà été ? */
export function demoAMontrer(dejaVue: number): boolean {
  return dejaVue < DEMO_GESTES_FOIS;
}

/* ------------------------------------------------------------------ */
/* Une seule liste parle pour toutes                                   */
/* ------------------------------------------------------------------ */

/**
 * **Le planning montre plusieurs cartes, et une seule porte la démonstration.** Chaque liste en
 * modification s'inscrit à son montage ; la première inscrite (la carte du haut, puisque les effets
 * se lancent dans l'ordre de la page) mène : c'est elle qui compte l'entrée, montre la bulle et le
 * lien « Revoir les gestes ». Si elle disparaît, la suivante reprend.
 */
const inscrites: string[] = [];
const abonnes = new Set<() => void>();
/**
 * **L'entrée en cours a-t-elle déjà été comptée ?** Au niveau du module, et non de la carte : si la
 * carte meneuse se démonte, la suivante reprend la parole, et un drapeau propre à chaque carte
 * comptait une seconde fois la même entrée. Remis à zéro quand plus aucune liste n'est inscrite —
 * c'est-à-dire quand on sort du mode modification.
 */
let entreeComptee = false;

function prevenir() {
  for (const f of abonnes) f();
}

export function inscrireListe(id: string): () => void {
  if (!inscrites.includes(id)) inscrites.push(id);
  prevenir();
  return () => {
    const i = inscrites.indexOf(id);
    if (i >= 0) inscrites.splice(i, 1);
    if (inscrites.length === 0) entreeComptee = false;
    prevenir();
  };
}

export function listeMeneuse(): string | null {
  return inscrites[0] ?? null;
}

export function abonnerMeneuse(f: () => void): () => void {
  abonnes.add(f);
  return () => {
    abonnes.delete(f);
  };
}

/**
 * **Compter l'entrée en modification, une fois** : `true` la première fois qu'une liste meneuse le
 * demande pour cette entrée, `false` ensuite — même si la meneuse a changé entre-temps.
 */
export function prendreEntreeDemo(): boolean {
  if (entreeComptee) return false;
  entreeComptee = true;
  return true;
}
