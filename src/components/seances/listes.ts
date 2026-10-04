import type { AttendanceStatut } from "@/lib/constants";

/**
 * **Les règles communes des listes nominatives**, le jour où le club passe de douze personnes à
 * quatre-vingts.
 *
 * À douze, une liste de noms est un trombinoscope : on la lit en entier, d'un coup d'œil. À
 * quatre-vingts, c'est un index : on y cherche **une** ligne. Les deux ne demandent pas la même
 * chose à l'écran, et ce module tient le peu de règles qui doivent être partagées pour que tous
 * les écrans les traitent pareil.
 *
 * **Il ne dépend de rien** (seulement d'un type, effacé à la compilation) : il est lu par des
 * composants client, et tout module qui touche aux réglages entraînerait `node:crypto` dans le
 * paquet du navigateur — un échec de `npm run build` que ni `tsc` ni les tests ne voient.
 */

/**
 * **Combien de lignes une liste empilée montre avant de replier le reste**, et combien un appui en
 * dévoile ensuite : la tranche est du même pas que la coupe, pour que le geste ait toujours la même
 * amplitude — vingt de plus, puis vingt de plus.
 *
 * Une ligne de personne coûte 44 à 56 px sur un téléphone : dix lignes font à peu près un écran
 * utile, c'est-à-dire de quoi voir qu'on est au bon endroit sans avoir à faire défiler pour
 * atteindre le bouton suivant.
 *
 * **Ce nombre ne s'indexe sur aucun réglage du club**, et surtout pas sur le seuil d'effectif des
 * séances : celui-ci est un *quorum d'annulation* (« sous la part réglée, on annule le cours »), pas
 * un effectif. L'y accrocher donnerait des listes de quatre noms dans un club de quatre-vingts, et
 * ferait changer la hauteur de tous les écrans le jour où le bureau retouche son seuil
 * d'annulation — deux choses sans le moindre rapport.
 *
 * **Pourquoi vingt et non dix.** Dix lignes valent un écran utile de téléphone, et c'était la
 * valeur d'étude. Mais le repli n'a de sens que là où la liste cesse d'être lisible : sous vingt
 * noms, on parcourt encore des yeux, et un bouton « Afficher les 2 autres » ne replie rien — il
 * ajoute un geste à une liste qui tenait. Vingt, choisi par Delta, laisse intacts le club de douze
 * qui a commandé l'outil et tous ceux qui grandissent jusqu'à ce seuil, sans rien changer à ce que
 * voit un club de quatre-vingts.
 */
export const LIGNES_VISIBLES = 20;

/**
 * **Combien de cours une liste de séances montre avant de replier le reste** : la liste des séances
 * (`ListeSeances`, onglet Séances) et la grille du planning (`GrillePlanning`), qui se comportent
 * de la même façon.
 *
 * **Cinq**, choisi par Delta sur la liste des séances : un trimestre, c'est une trentaine de cours,
 * et les dérouler tous obligeait à remonter la page pour retrouver les filtres. Les deux écrans
 * montrent la même chose ; il n'y a aucune raison qu'ils se comportent autrement, et c'est pourquoi
 * ils lisent **ce** nombre au lieu d'en écrire chacun le sien.
 *
 * **Il y avait deux constantes de ce nom, à deux valeurs** : celle-ci, à 40, qui comptait les cours
 * de l'historique personnel, et une seconde exportée par `GrillePlanning`, à 5, pour le repli du
 * planning. Un auto-import du mauvais compilait sans broncher et multipliait par huit le repli d'un
 * écran. Un nom, une valeur, un endroit : le plafond de l'historique s'appelle désormais {@link
 * COURS_HISTORIQUE_VISIBLES}, et il dit ce qu'il compte.
 */
export const SEANCES_VISIBLES = 5;

/**
 * **Combien de cours l'historique personnel charge et montre avant de replier le reste.**
 *
 * Ce nombre-ci ne compte ni des personnes ni des cartes de séance à venir : ce sont les cours
 * **déjà donnés** d'un historique, et c'est pourquoi il n'emprunte ni {@link LIGNES_VISIBLES} ni
 * {@link SEANCES_VISIBLES}. Un plafond de noms s'indexe sur l'effectif du club, le repli d'une liste
 * de cartes sur la hauteur d'un écran, celui-ci sur le **rythme du calendrier** — et il commande en
 * plus ce que le serveur rapatrie, chaque séance chargée emportant les réponses de tout le club.
 *
 * À vingt, un trimestre ordinaire — deux cours par semaine sur treize semaines, soit vingt-six —
 * dépassait déjà : « Afficher tous les cours précédents » apparaissait **chez un club de douze**,
 * c'est-à-dire exactement là où le dossier promettait qu'on ne verrait aucune différence.
 *
 * **Quarante**, donc : un trimestre entier reste entier, un semestre aussi, et la coupe ne mord que
 * sur une saison complète d'historique — le moment où elle sert vraiment.
 */
export const COURS_HISTORIQUE_VISIBLES = 40;

/** Les quatre réponses possibles à un cours, vues comme les quatre colonnes d'une liste nominative. */
export type CleGroupe = "sansReponse" | "peutEtre" | "presents" | "absents";

/**
 * **L'ordre des groupes pour un cours à venir, défini une seule fois pour toute l'application.**
 *
 * D'abord ce qui appelle un geste — les sans-réponse qu'on relance, les peut-être qu'on
 * confirme —, ensuite ce qui se lit — les présents et les absents, qui ont déjà répondu. Sur un
 * écran où l'on ne voit que le haut de chaque colonne, l'ordre *est* la hiérarchie.
 *
 * Il est partagé parce que deux listes nominatives qui divergeraient seraient le début des
 * ennuis : on ne saurait plus si « untel n'y est pas » veut dire qu'il manque ou qu'il est plus bas.
 */
export const ORDRE_GROUPES = ["sansReponse", "peutEtre", "presents", "absents"] as const satisfies readonly CleGroupe[];

/**
 * **Et l'ordre pour un cours qui a déjà eu lieu**, où la question n'est plus la même.
 *
 * « Sans réponse d'abord » est l'ordre de ce qu'on peut encore changer : on relance les silencieux
 * pour remplir une salle. Un cours passé ne se remplit plus. Sur l'historique d'un club de
 * quatre-vingts, cet ordre ouvrait « Qui était là ? » sur quarante-six noms de gens qui n'ont jamais
 * répondu à un cours déjà donné — l'information la moins utile qui soit, et elle prenait tout
 * l'écran, chaque colonne étant coupée à {@link LIGNES_VISIBLES} noms.
 *
 * Ce qu'on vient chercher dans un registre, ce sont **les présents**, puis ceux qui ont dit non ; le
 * silence de quelqu'un sur un cours de février n'apprend rien à personne.
 */
export const ORDRE_GROUPES_PASSEE = ["presents", "absents", "peutEtre", "sansReponse"] as const satisfies readonly CleGroupe[];

/**
 * **Le seul endroit qui tranche entre les deux.** Les écrans ne choisissent pas un ordre : ils
 * disent si la séance a commencé, et lisent la réponse ici. Un écran qui écrirait sa propre liste
 * finirait par diverger des autres, et « untel n'est pas dans la liste » cesserait de vouloir dire
 * quelque chose.
 */
export function ordreDesGroupes(passee = false): readonly CleGroupe[] {
  return passee ? ORDRE_GROUPES_PASSEE : ORDRE_GROUPES;
}

/** La colonne où tombe une réponse — `null` (personne n'a rien dit) comprise. */
export function groupeDuStatut(statut: AttendanceStatut | null | undefined): CleGroupe {
  if (statut === "PRESENT") return "presents";
  if (statut === "PEUT_ETRE") return "peutEtre";
  if (statut === "ABSENT") return "absents";
  return "sansReponse";
}

/**
 * Tri d'une liste **à plat** (une ligne par personne, sa réponse à côté) par ce qui appelle un
 * geste. Le tri est **stable** : à l'intérieur d'un groupe, l'ordre reçu — alphabétique — est
 * conservé, sans quoi on ne retrouverait plus personne.
 *
 * La liste reçue n'est jamais modifiée : elle vient du serveur et peut être relue ailleurs.
 */
export function trierParActionnabilite<T extends { statut: AttendanceStatut | null }>(liste: readonly T[]): T[] {
  const rang = (p: T) => ORDRE_GROUPES.indexOf(groupeDuStatut(p.statut));
  return [...liste].sort((a, b) => rang(a) - rang(b));
}

/**
 * **Remet une liste dans un ordre figé une fois pour toutes**, en rangeant à la fin ce qui n'y
 * figurait pas.
 *
 * Le tri par actionnabilité est juste à l'ouverture d'un écran et **faux ensuite** : sur la fiche
 * d'une séance, `modifierPresenceMembre` revalide `/seances/<id>`, le serveur renvoie l'arbre
 * retrié, et la personne qu'on vient de passer « Présent » descend chez les présents — en faisant
 * remonter la suivante **sous le doigt**. L'appui d'après corrige alors quelqu'un d'autre.
 *
 * L'écran retient donc l'ordre reçu à la première ouverture et s'y tient : le serveur peut retrier
 * autant qu'il veut, les lignes ne bougent plus. Qui arrive après coup (un membre ajouté à la
 * période entre deux rendus) est mis à la fin plutôt que glissé au milieu, pour la même raison ; qui
 * n'est plus dans la liste disparaît simplement.
 *
 * La liste reçue n'est jamais modifiée.
 */
export function selonOrdreFige<T extends { id: string }>(ordre: readonly string[], liste: readonly T[]): T[] {
  const parId = new Map(liste.map((element) => [element.id, element]));
  const connus = new Set(ordre);
  const figes = ordre.map((id) => parId.get(id)).filter((element): element is T => element !== undefined);
  return [...figes, ...liste.filter((element) => !connus.has(element.id))];
}

/**
 * **La coupe.** Ce qui reste visible, et ce qui passe derrière le bouton.
 *
 * Tant que la liste tient sous le plafond, `cachees` est vide — et c'est ce vide qui garantit
 * qu'un petit club ne voit **aucun bouton**, donc aucune différence. Un « Afficher les 0 suivantes »
 * serait un mensonge, et un repli sur une liste de six noms, une gêne pure.
 *
 * `cachees` n'est **pas** ce qu'un appui dévoile : le surplus se découvre par tranches du même pas
 * que la coupe (voir {@link devoilement}), et non d'un seul bloc.
 */
export function couper<T>(liste: readonly T[], visibles: number = LIGNES_VISIBLES): { montrees: T[]; cachees: T[] } {
  if (liste.length <= visibles) return { montrees: [...liste], cachees: [] };
  return { montrees: liste.slice(0, visibles), cachees: liste.slice(visibles) };
}

/**
 * **Où en est un dévoilement par tranches**, calculé sans React pour être vérifiable seul.
 *
 * Le repli dépliait d'un seul appui **tout** ce qu'il cachait : dans un club de quatre-vingts,
 * « Afficher les 60 autres » échangeait un écran trop court contre soixante lignes d'un coup, et
 * l'on ne savait plus où l'on en était. On dévoile donc **une tranche à la fois** (`tranche`,
 * vingt par défaut), en partant de la première (`debut`).
 *
 * `demandees` est le seul état retenu par l'écran : **combien de lignes on a demandé à voir**. Tout
 * le reste s'en déduit, et deux précautions le rendent sûr :
 *
 * - **Il est borné par le total.** L'écran peut en demander plus qu'il n'y en a — c'est ce qui
 *   arrive quand une recherche vient rétrécir la liste sous ce qu'on avait déjà dévoilé. Le
 *   compteur doit alors parler du **résultat de la recherche** (« 4 sur 4 »), pas de la liste
 *   d'avant, et aucun bouton ne doit rester à appuyer.
 * - **`prochaine` ne dépasse jamais `restantes`.** Le bouton annonce ce qu'il va montrer, donc
 *   « Afficher les 7 suivantes » sur la dernière tranche — promettre vingt pour en montrer sept est
 *   la seule façon de perdre la confiance de quelqu'un qui compte sur le nombre pour décider.
 *
 * `auDebut` dit qu'il n'y a rien à replier : personne n'a encore appuyé, ou la liste tient entière.
 */
export function devoilement({
  total,
  demandees,
  tranche = LIGNES_VISIBLES,
  debut = tranche,
}: {
  /** La taille de la liste **telle qu'elle est affichée** — après la recherche, donc. */
  total: number;
  /** Combien de lignes l'écran a demandé à voir jusqu'ici. */
  demandees: number;
  /** Ce qu'un appui ajoute. */
  tranche?: number;
  /** Ce qu'on voit sans rien avoir déplié, et où « Replier » ramène. */
  debut?: number;
}): { affichees: number; restantes: number; prochaine: number; auDebut: boolean } {
  const affichees = Math.max(0, Math.min(demandees, total));
  const restantes = Math.max(0, total - affichees);
  return { affichees, restantes, prochaine: Math.min(tranche, restantes), auDebut: affichees <= debut };
}

/**
 * Les mots du bouton, écrits une fois : le bouton **annonce la tranche qu'il va montrer**
 * (« Afficher les 20 suivantes », « Afficher les 7 suivantes » sur la dernière) plutôt que de
 * promettre vaguement « voir plus » — savoir combien de lignes arrivent, c'est savoir s'il vaut la
 * peine d'appuyer, et c'est aussi la promesse que le bouton doit tenir.
 *
 * `quoi` laisse chaque écran nommer ce qu'il compte quand le contexte ne le dit pas : la colonne
 * « Sans réponse » n'a rien à préciser, l'historique parle de « cours précédents ».
 */
export function libelleAfficher(restantes: number, quoi = "suivantes"): string {
  return `Afficher les ${restantes} ${quoi}`;
}

/**
 * **Le compteur, à côté du bouton : « 20 sur 80 ».**
 *
 * Dévoiler par tranches sans dire où l'on en est remplace un écran trop court par un défilement
 * sans repère : trois appuis plus loin, on ne sait plus s'il en reste dix ou soixante. Le compteur
 * est la contrepartie de la tranche, et il est lu à voix haute à chaque appui (`aria-live`), pour
 * que quelqu'un qui n'a pas l'écran sous les yeux sache lui aussi où il en est.
 *
 * `unite` sert aux écrans qui mêlent deux sortes de listes — l'historique replie des **cours** et
 * nomme des personnes dessous, un « 40 sur 60 » nu y serait ambigu.
 */
export function libelleCompteur(affichees: number, total: number, unite?: string): string {
  return `${affichees} sur ${total}${unite ? ` ${unite}` : ""}`;
}

/**
 * Et « Replier » une fois déplié, comme la liste des séances. Il **ramène à la première tranche**,
 * pas à la précédente : ce n'est pas une annulation du dernier appui (on sait ce qu'on vient de
 * faire), c'est le geste « je me suis perdu, remets-moi au début ».
 */
export const LIBELLE_REPLIER = "Replier";
