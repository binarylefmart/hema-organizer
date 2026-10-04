import { seuilEnPersonnes } from "./presences";

/**
 * **La hauteur d'une colonne de la frise, en pourcentage de l'effectif invité.**
 *
 * Vit ici, et non dans le composant, pour une raison très concrète : le dépôt garde
 * `jsx: "preserve"`, donc Vitest ne sait pas importer un `.tsx`. Un calcul qu'on veut éprouver en
 * l'exécutant — plutôt qu'en relisant la source du composant — doit être dans un module `.ts`.
 *
 * C'est le seul calcul du dessin « capacité » (voir `src/components/accueil/Frise.tsx`), et le
 * seul endroit où une erreur ne se verrait pas à l'œil : une colonne qui déborde de son cadre ou
 * un seuil placé de travers restent des dessins plausibles.
 */
export function partDesInvites(nombre: number, invites: number): number {
  if (invites <= 0 || nombre <= 0) return 0;
  // Plafonné à 100, mais **plus pour rattraper un calcul** : retirer quelqu'un d'une période
  // emporte désormais ses réponses (`retirerMembrePeriode`), donc un trimestre tenu par cette
  // version-ci ne peut plus compter plus de réponses que d'invités. Le plafond reste comme
  // garde-fou de dessin, pour les trimestres remplis avant ce correctif et pour un compte de
  // service oublié : une colonne qui crève son cadre reste un dessin plausible, donc invisible.
  return Math.min(100, (nombre / invites) * 100);
}

/**
 * **La hauteur du trait en pointillé du seuil, dans une colonne.**
 *
 * Le seuil est une **part de l'effectif invité** (`Identite.partEffectifMin`) : sa hauteur serait
 * donc la part elle-même… si le plancher de quatre personnes n'existait pas. Dans un petit club
 * c'est le plancher qui commande, et le trait doit se placer là où il commande vraiment — sans quoi
 * la frise annoncerait un seuil que l'alerte « peu de monde » ne suit pas.
 *
 * On passe donc toujours par `seuilEnPersonnes`, le même calcul que les paliers et que l'alerte :
 * c'est le seul moyen que le dessin et l'email de la veille disent la même chose.
 */
export function hauteurDuSeuil(partEffectifMin: number, invites: number): number {
  return partDesInvites(seuilEnPersonnes(partEffectifMin, invites), invites);
}

/**
 * Les quatre réponses possibles à un cours, dans l'ordre où elles se lisent partout ailleurs.
 *
 * Elles servent encore à **nommer les gens** (les puces du panneau) et à **dire le compte complet**
 * à qui le demande (infobulle, lecteur d'écran). Elles ne servent plus à **dessiner** : la frise
 * n'a plus que deux nombres et la bande que trois segments (voir plus bas).
 */
export type CleSegment = "presents" | "peutEtre" | "absents" | "sansReponse";

/** Le mot de chaque segment, au pluriel de l'usage : « 5 présents », « 2 peut-être ». */
export const MOT_SEGMENT: Record<CleSegment, string> = {
  presents: "présents",
  peutEtre: "peut-être",
  absents: "absents",
  sansReponse: "sans réponse",
};

/** Le même mot à une seule personne : « 1 présent ». « Peut-être » et « sans réponse » ne varient pas. */
export const MOT_SEGMENT_UN: Record<CleSegment, string> = {
  presents: "présent",
  peutEtre: "peut-être",
  absents: "absent",
  sansReponse: "sans réponse",
};

/**
 * **Le compte complet d'un cours, absents compris — en une phrase, à la demande seulement.**
 *
 * C'est le seul endroit de la frise où le mot « absents » peut encore sortir, et c'est voulu :
 * l'infobulle et le lecteur d'écran sont du **détail demandé**, pas un affichage. Rien de tout ça
 * n'est dessiné à l'écran ; qui veut le compte exact va le chercher, il ne lui est pas montré.
 *
 * Les groupes vides sont tus : « 0 absents » n'apprend rien et alourdit la phrase.
 */
export function detailDesReponses(c: { presents: number; peutEtre: number; absents: number; enAttente: number }): string {
  const groupes: Array<[CleSegment, number]> = [
    ["presents", c.presents],
    ["peutEtre", c.peutEtre],
    ["absents", c.absents],
    ["sansReponse", c.enAttente],
  ];
  const dits = groupes
    .filter(([, nombre]) => nombre > 0)
    .map(([cle, nombre]) => `${nombre} ${nombre === 1 ? MOT_SEGMENT_UN[cle] : MOT_SEGMENT[cle]}`);
  return dits.length > 0 ? dits.join(", ") : "aucune réponse";
}

/**
 * **Les trois segments de la bande du panneau déplié** : les présents, les peut-être, et **tout le
 * reste du club en un seul bloc neutre**.
 *
 * **Pourquoi trois et non quatre** : la frise raconte le **remplissage d'un cours**, pas le
 * manquement de qui que ce soit. Un segment rouille nommé « absents », posé à côté du vert,
 * transformait une jauge en tableau d'honneur inversé — et le club n'a pas besoin qu'on lui montre
 * du doigt les gens qui ont autre chose à faire un jeudi soir. Ce qui reste à convaincre se lit
 * tout aussi bien d'un seul bloc neutre, qui est exactement ce que la colonne montre déjà au-dessus
 * du vert et de l'ocre.
 *
 * Ce n'est donc pas une simplification technique : les absents sont toujours comptés, toujours
 * nommés dans les puces, toujours dits dans l'infobulle. Ils ne sont simplement plus **dessinés à
 * part**. Le corollaire est que la bande **reflète enfin exactement la colonne** — vert, ocre,
 * puis le reste —, ce que quatre segments ne faisaient pas.
 */
export type CleBande = "presents" | "peutEtre" | "reste";

/** Le mot de chaque segment de la bande. « Reste du club » : ni un reproche, ni un décompte. */
export const MOT_BANDE: Record<CleBande, string> = {
  presents: "présents",
  peutEtre: "peut-être",
  reste: "reste du club",
};

/**
 * En dessous de deux personnes, un segment de la bande est trop étroit pour porter son mot : le
 * nombre y tient seul, le mot s'y ferait couper au milieu — et un mot tronqué ne dit rien.
 */
export const MINI_SEGMENT_MOT = 2;

export type SegmentBande = {
  cle: CleBande;
  nombre: number;
  /** Part de la bande, en pourcentage — employée comme `flex-grow`, donc les 2 px d'écart ne la faussent pas. */
  part: number;
  /** Le segment est assez large pour porter son mot en plus de son nombre. */
  avecMot: boolean;
};

/**
 * **La bande horizontale du panneau déplié** : la colonne verticale couchée, avec la place
 * d'écrire dedans.
 *
 * Le dénominateur est la **somme des groupes**, et non l'effectif invité : la bande doit occuper
 * toute la largeur du panneau. Les deux coïncident désormais toujours sur un trimestre tenu par
 * cette version — les groupes partitionnent les invités, et un retrait de période emporte les
 * réponses de la personne retirée (`retirerMembrePeriode`). Sur les données d'avant ce correctif,
 * mieux vaut encore une bande pleine et juste entre ses segments qu'une bande qui s'arrête avant
 * le bord sans qu'on sache pourquoi.
 *
 * Absents et sans-réponse sont fondus dans un seul segment neutre, « reste du club » (voir
 * `CleBande`). Un groupe vide n'est pas dessiné du tout : il laisserait un écart sans segment, qui
 * se lirait comme un groupe de plus.
 */
export function segmentsDeBande(c: { presents: number; peutEtre: number; absents: number; enAttente: number }): SegmentBande[] {
  const groupes: Array<[CleBande, number]> = [
    ["presents", c.presents],
    ["peutEtre", c.peutEtre],
    ["reste", Math.max(0, c.absents) + Math.max(0, c.enAttente)],
  ];
  const total = groupes.reduce((n, [, nombre]) => n + Math.max(0, nombre), 0);
  if (total <= 0) return [];
  return groupes
    .filter(([, nombre]) => nombre > 0)
    .map(([cle, nombre]) => ({ cle, nombre, part: (nombre / total) * 100, avecMot: nombre >= MINI_SEGMENT_MOT }));
}

/** Un des deux nombres écrits au-dessus d'une colonne. */
export type CleNombre = Extract<CleSegment, "presents" | "peutEtre">;
export type NombreColonne = { cle: CleNombre; nombre: number };

/**
 * **Les deux nombres écrits au-dessus d'une colonne** : les présents, puis les peut-être.
 *
 * **Il y en avait trois** — le troisième disait les absents, en rouille. Il est parti le jour où
 * Delta a précisé sa demande : « je ne veux pas voir apparaître les absents, le schéma de couleurs
 * était juste pour l'info ». En nommant « présents en vert, peut-être en jaune, absents en rouge »,
 * il fixait une **convention de couleurs** commune à l'application, il ne demandait pas un
 * affichage de plus. **Pourquoi c'est la bonne lecture, et pourquoi on n'y reviendra pas :** la
 * frise répond à une seule question — *qui vient ?* —, et le nombre d'absents n'aide pas à y
 * répondre (il se déduit, et ce qui compte pour préparer un cours est déjà là : le vert, l'ocre, et
 * le vide au-dessus). Écrit en gros sous une colonne, il ne faisait qu'une chose : pointer des
 * gens. Ce n'est le rôle ni d'une frise, ni d'un club.
 *
 * Les deux règles d'écriture restent celles du premier jour, et tiennent ici plutôt que dans le
 * composant pour être éprouvées en les exécutant :
 * - **un zéro ne s'écrit pas** : des zéros alignés sous une colonne vide seraient du bruit, et
 *   l'absence d'un nombre se lit déjà sur la colonne ;
 * - **une séance annulée n'a aucun nombre** : elle n'a ni effectif ni liste qui vaille.
 */
export function nombresDeLaColonne(c: { presents: number; peutEtre: number }, annulee: boolean): NombreColonne[] {
  if (annulee) return [];
  const ordre: NombreColonne[] = [
    { cle: "presents", nombre: c.presents },
    { cle: "peutEtre", nombre: c.peutEtre },
  ];
  return ordre.filter((n) => n.nombre > 0);
}
