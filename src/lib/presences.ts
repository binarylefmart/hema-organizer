import type { AttendanceStatut } from "./constants";

/**
 * Calculs de présence (fonctions pures, testées unitairement).
 * Taux = présents / membres invités sur la période × 100, arrondi à l'entier.
 */
export type Compteurs = {
  invites: number;
  presents: number;
  absents: number;
  peutEtre: number;
  /** Invités n'ayant pas encore répondu */
  enAttente: number;
  /** Pourcentage arrondi (0 si aucun invité) */
  pourcentage: number;
};

/** Totaux par statut, tels que les renvoie un `groupBy` SQL (statuts inconnus ignorés). */
export type TotauxStatuts = { PRESENT?: number; ABSENT?: number; PEUT_ETRE?: number };

/**
 * Mêmes compteurs que `compterPresences`, à partir de totaux déjà agrégés en base :
 * les écrans qui portent sur une période entière comptent en SQL (`groupBy`) au lieu de
 * charger une ligne de présence par membre et par séance.
 */
export function compteursDepuisTotaux(totaux: TotauxStatuts, invites: number): Compteurs {
  const presents = totaux.PRESENT ?? 0;
  const absents = totaux.ABSENT ?? 0;
  const peutEtre = totaux.PEUT_ETRE ?? 0;
  const repondu = presents + absents + peutEtre;
  return {
    invites,
    presents,
    absents,
    peutEtre,
    enAttente: Math.max(0, invites - repondu),
    pourcentage: calculerTaux(presents, invites),
  };
}

export function compterPresences(statuts: Iterable<string>, invites: number): Compteurs {
  const totaux: TotauxStatuts = {};
  for (const s of statuts) {
    if (s === "PRESENT") totaux.PRESENT = (totaux.PRESENT ?? 0) + 1;
    else if (s === "ABSENT") totaux.ABSENT = (totaux.ABSENT ?? 0) + 1;
    else if (s === "PEUT_ETRE") totaux.PEUT_ETRE = (totaux.PEUT_ETRE ?? 0) + 1;
  }
  return compteursDepuisTotaux(totaux, invites);
}

/** Ajoute un total agrégé (`groupBy` par clé et par statut) dans la table des totaux d'une clé. */
export function cumulerTotaux(table: Map<string, TotauxStatuts>, cle: string, statut: string, nombre: number): void {
  if (statut !== "PRESENT" && statut !== "ABSENT" && statut !== "PEUT_ETRE") return;
  const t = table.get(cle) ?? {};
  t[statut] = (t[statut] ?? 0) + nombre;
  table.set(cle, t);
}

/**
 * **Combien de monde on attend vraiment** : les « Présent » confirmés, plus la moitié des
 * « Peut-être », arrondie au plus proche.
 *
 * C'est une estimation, pas une prédiction, et elle est assumée comme telle (l'interface écrit
 * « ~7 attendus », jamais « 7 »). La règle est volontairement grossière parce qu'on ne peut pas
 * faire mieux honnêtement : l'application ne garde pas trace de ce que deviennent les
 * « Peut-être » — quand le bureau corrige le registre après le cours, il écrase la réponse initiale
 * plutôt que d'en conserver l'historique. Une moitié est donc le seul chiffre défendable, et il
 * suffit à ce à quoi il sert : savoir s'il faut préparer trois binômes ou cinq.
 */
export function effectifAttendu(c: { presents: number; peutEtre: number }): number {
  return c.presents + Math.round(c.peutEtre / 2);
}

/**
 * **Les paliers de remplissage d'un cours** — « ce cours se remplit-il ? », en trois mots.
 *
 * ## Pourquoi une échelle, et une seule
 *
 * Le nombre de présents ne dit rien tout seul : 5 personnes, est-ce beaucoup ? L'équipe se pose la
 * question à chaque cours, et y répondait jusqu'ici de tête. L'échelle est donc posée **ici, une
 * fois**, et tous les écrans la lisent — aucun seuil n'est recopié dans un composant, sans quoi
 * l'accueil et la carte d'une séance finiraient par ne plus dire la même chose du même cours.
 *
 * ## Les bornes, et pourquoi celles-là
 *
 * Elles portent sur l'**effectif attendu** (`effectifAttendu` : les confirmés plus la moitié des
 * « Peut-être »), pas sur les seuls « Présent ». C'est le chiffre sur lequel le club prépare
 * vraiment le matériel et les binômes ; juger un cours sur les seuls confirmés ferait passer au
 * rouge une séance de 3 confirmés et 6 indécis, qui n'est évidemment pas en danger.
 *
 * - **« en danger »** — moins de {@link seuilEnPersonnes} attendus. Ce n'est pas un seuil inventé
 *   ici : c'est **exactement** celui de l'alerte « peu de monde » envoyée aux instructeurs et celui
 *   du trait tracé sur la jauge et sur la frise. Sous ce nombre-là, le cours ne vaut guère la peine
 *   d'ouvrir la salle — et la couleur doit dire la même chose que l'email reçu la veille.
 * - **« juste »** — du seuil à la marge de confort exclue. Le cours tient, mais il n'y a pas un
 *   binôme de marge. C'est le palier où il est encore utile de relancer ceux qui n'ont pas répondu.
 * - **« bien »** — {@link seuilConfort} attendus ou plus. Même avec quelques désistements de
 *   dernière minute, le cours reste au-dessus, et il y a de quoi faire tourner les binômes. Rien à
 *   faire, on peut regarder ailleurs.
 *
 * ## La part arrive en argument, elle ne se lit pas ici
 *
 * C'est un **réglage du club** (`Identite.partEffectifMin`) depuis qu'un second club peut installer
 * l'outil. Elle est donc passée à chaque appel, comme le nom du club l'est aux gabarits d'email — ce
 * module reste pur, testable sans base, et lisible depuis un composant client (qui reçoit la part en
 * propriété).
 *
 * ## Quand l'échelle ne veut rien dire
 *
 * Si la période compte **au plus `seuil` invités** (autrement dit, pas plus de monde que le
 * plancher), la noter « en danger » revient à reprocher à un cours d'être donné à un petit groupe :
 * aucun effectif n'y atteindra jamais le seuil. Le palier vaut alors `indetermine` et les écrans
 * n'affichent aucune couleur — c'est la même règle que le trait du seuil, qui ne se dessine que s'il
 * tombe dans la jauge.
 *
 * ## Attention : deux usages des mêmes trois couleurs
 *
 * Dans cette application, le vert, l'ocre et le rouge disent d'abord un **statut de réponse** —
 * vert « Présent », ocre « Peut-être », rouge « Absent » (invariant de la charte, `globals.css`).
 * Les paliers introduisent un **second usage** : sur un **effectif**, la couleur ne dit plus
 * *lequel* des trois statuts, elle dit *si le cours se remplit*. Les deux ne doivent jamais se
 * lire l'un pour l'autre, d'où la règle tenue par les composants :
 * - une couleur de **statut** ne se montre jamais seule — elle accompagne toujours l'icône ou le
 *   mot du statut (`RepartitionPresences`, `ListeParticipants`) ;
 * - une couleur de **palier** ne colore qu'un nombre dont le libellé dit « présents sur N », et
 *   elle est toujours doublée du **mot** du palier ({@link PALIER_LABELS}) — « 2 » en rouge suivi
 *   de « Peu de monde » ne peut pas se lire « 2 absents ».
 */
export const PALIERS = ["indetermine", "danger", "juste", "bien"] as const;
export type Palier = (typeof PALIERS)[number];

/**
 * **Le plancher du seuil, en personnes : quatre.** Une constante livrée, et non un second réglage à
 * remplir : en dessous de quatre, il n'y a pas de cours — pas deux binômes, rien à faire tourner —,
 * et cela ne dépend pas de la taille du club.
 *
 * C'est aussi lui qui rend la **reprise de l'existant** honnête. Le réglage d'hier s'exprimait en
 * personnes et valait 4 ; il ne savait pas à quel effectif il s'appliquait, donc il n'y avait rien à
 * convertir. Avec 20 % et ce plancher, un club de douze invités retombe exactement sur 4 : le club
 * pour lequel l'outil a été écrit ne voit **rien changer**, et les autres cessent de se voir imposer
 * son chiffre.
 */
export const SEUIL_PLANCHER = 4;

/**
 * Trois personnes : la marge minimale qui sépare « le cours tient » de « le cours est tranquille ».
 * Deux désistements de dernière minute laissent encore le cours au-dessus du seuil.
 */
export const MARGE_CONFORT = 3;

/**
 * **La marge de confort est une moitié de seuil**, et non trois personnes fixes.
 *
 * Trois personnes, c'était une marge honnête sur un seuil de 4 et une broutille sur un seuil de 16 :
 * dans un club de quatre-vingts, « Bien rempli » commençait à 19 présents — 24 % de l'effectif —, ce
 * qui donnait le badge dont le pourcentage affiché juste à côté disait le contraire. Une marge
 * proportionnelle garde le mot et le chiffre d'accord : « Bien rempli » commence à 30 % des invités
 * quand la part est réglée à 20 %.
 */
export const FACTEUR_CONFORT = 1.5;

/**
 * **Le seuil en personnes, pour un effectif invité donné** : la part réglée par le club, jamais
 * moins de {@link SEUIL_PLANCHER}.
 *
 * **Arrondi au supérieur**, et c'est ce qui donne son sens exact à « en danger » : 20 % de 82
 * invités font 16,4, et un cours à 16 présents ne pèse que 19,5 % de l'effectif — donc **moins** que
 * la part réglée. Arrondi à l'inférieur ou au plus proche, il passerait pour suffisant. Avec
 * l'arrondi au supérieur, « en danger » veut dire, à la personne près, « strictement moins que la
 * part réglée ».
 */
export function seuilEnPersonnes(partEffectifMin: number, invites: number): number {
  const part = Number.isFinite(partEffectifMin) ? Math.max(0, partEffectifMin) : 0;
  const invitesUtiles = Number.isFinite(invites) ? Math.max(0, invites) : 0;
  return Math.max(SEUIL_PLANCHER, Math.ceil((invitesUtiles * part) / 100));
}

/**
 * Le haut de l'échelle, pour un seuil donné en personnes : la plus grande des deux marges —
 * {@link MARGE_CONFORT} personnes, ou la moitié du seuil ({@link FACTEUR_CONFORT}). Écrit en
 * fonction du seuil plutôt qu'en dur, pour que toute l'échelle suive l'effectif du club.
 */
export function seuilConfort(seuil: number): number {
  return Math.max(seuil + MARGE_CONFORT, Math.ceil(seuil * FACTEUR_CONFORT));
}

/**
 * Ce que la couleur dit, en toutes lettres : c'est ce mot qui empêche de confondre un effectif avec
 * un statut. « Peu de monde » reprend exactement le nom de l'alerte envoyée aux instructeurs — même
 * seuil, même vocabulaire. `indetermine` n'a rien à annoncer : aucune étiquette ne s'affiche.
 */
export const PALIER_LABELS: Record<Palier, string | null> = {
  indetermine: null,
  danger: "Peu de monde",
  juste: "Effectif juste",
  bien: "Bien rempli",
};

/**
 * Palier de remplissage d'une séance (voir {@link PALIERS} pour les bornes et leur justification).
 *
 * `partEffectifMin` est la part minimale de l'effectif **réglée par le club**
 * (`Identite.partEffectifMin`, en pourcentage) : elle arrive en argument et ne se lit nulle part
 * ici, pour que le même cours ne puisse pas être « juste » sur un écran et « en danger » sur le
 * suivant. Le seuil en personnes s'en déduit avec l'effectif invité du cours lui-même
 * ({@link seuilEnPersonnes}) : c'est ce qui fait qu'aucun écran n'a de nombre à recopier.
 */
/**
 * **Le cours manque-t-il de monde ?** — la *décision*, pas le mot.
 *
 * Séparée de `palierEffectif`, et c'est une leçon payée le même jour. La borne dégénérée ajoutée à
 * `palierEffectif` (un groupe trop petit pour que « bien » soit atteignable n'est plus noté) était
 * juste **pour l'étiquette** — mais deux lecteurs ne demandaient pas une étiquette, ils demandaient
 * une décision, en testant `=== "danger"` :
 *
 * - l'alerte « peu de monde » aux instructeurs (`notifications/seances.ts`), avec son lien d'annulation ;
 * - la tuile « cours qui vont manquer de monde » du tableau de bord (`coursEnDanger`, `pilotage.ts`).
 *
 * Pour un club de cinq ou six invités, les deux se sont donc **éteints définitivement** : un cours à un
 * seul présent sur six ne déclenchait plus rien, jamais, quel que soit le remplissage. C'est le
 * contraire de ce que la borne cherchait — elle visait un mot qui contredisait un pourcentage, pas
 * l'alerte qui sert à décider d'annuler. Et aucun test ne l'a vu : les fixtures de l'alerte utilisent
 * 80, 12 et 4 invités, jamais 5 ni 6.
 *
 * La règle est donc dite deux fois, exprès, parce que ce sont deux questions :
 * **« faut-il s'inquiéter ? »** se juge sur le seuil, toujours, quelle que soit la taille du groupe ;
 * **« quel mot afficher ? »** se tait quand l'échelle n'a pas de sens.
 */
export function sousLeSeuil(c: { presents: number; peutEtre: number; invites: number }, partEffectifMin: number): boolean {
  const seuil = seuilEnPersonnes(partEffectifMin, c.invites);
  // Un groupe qui ne dépasse pas le seuil n'est pas « en danger » : il est trop petit pour être jugé,
  // et le reprocher à la séance serait reprocher la taille de la période. C'est la borne d'origine,
  // celle qui était déjà là avant la seconde.
  if (c.invites <= seuil) return false;
  return effectifAttendu(c) < seuil;
}

export function palierEffectif(c: { presents: number; peutEtre: number; invites: number }, partEffectifMin: number): Palier {
  const seuil = seuilEnPersonnes(partEffectifMin, c.invites);
  /*
   * **Deux bornes dégénérées, pas une**.
   *
   * La première est là depuis l'origine : un groupe invité qui ne dépasse pas le seuil ne peut pas être
   * jugé, l'échelle n'a pas de sens pour lui. La seconde manquait — un groupe **trop petit pour
   * atteindre le confort**. Avec les valeurs livrées (part 20 %, plancher 4, confort = seuil + 3), le
   * confort vaut 7 : un club de 5 ou 6 invités ne pouvait donc **jamais** lire « Bien rempli », même
   * avec tout le monde présent. La carte affichait « 6 présents / 6 — 100 % » et, juste à côté,
   * l'étiquette « Effectif juste » — exactement ce que le dossier interdit : « le mot affiché finit par
   * contredire le pourcentage affiché à côté ».
   *
   * Et ce n'est pas rattrapable par le réglage : le plancher de quatre personnes fixe le confort à sept
   * quelle que soit la part choisie (5 à 50 %). C'est donc bien le cas dégénéré d'un petit effectif, la
   * famille que `indetermine` existe pour couvrir — il manquait la seconde moitié. Un club qui démarre à
   * six lit maintenant son taux sans jugement à côté, jusqu'à ce qu'il grandisse.
   */
  if (c.invites <= seuil || c.invites < seuilConfort(seuil)) return "indetermine";
  const attendus = effectifAttendu(c);
  if (attendus < seuil) return "danger";
  if (attendus < seuilConfort(seuil)) return "juste";
  return "bien";
}

/**
 * Taux de présence, en pourcentage entier — **borné à 100 %**.
 *
 * Le dénominateur (les invités de la période) et le numérateur (les lignes de présence) viennent de
 * deux comptages différents, et il a suffi une fois qu'ils se désaccordent — des réponses laissées
 * derrière par quelqu'un retiré de la période — pour que les écrans annoncent « 106 % ». La cause
 * se corrige là où l'on compte (les agrégats sont filtrés sur les membres de la période, voir
 * `tableau-de-bord.ts` et `partage.ts`) ; la borne, elle, est la ceinture de sécurité : un
 * pourcentage au-dessus de 100 n'apprend rien à personne et fait douter de tout le reste. Les
 * chiffres bruts affichés à côté (« 19/18 ») ne sont pas maquillés pour autant : l'anomalie reste
 * visible à qui doit la comprendre.
 */
export function calculerTaux(presents: number, invites: number): number {
  if (invites <= 0) return 0;
  return Math.min(100, Math.round((presents / invites) * 100));
}

/** "72 % — 13/18" */
export function formatTaux(c: Pick<Compteurs, "pourcentage" | "presents" | "invites">): string {
  return `${c.pourcentage} % — ${c.presents}/${c.invites}`;
}

export const STATUT_LABELS: Record<AttendanceStatut, string> = {
  PRESENT: "Présent",
  ABSENT: "Absent",
  PEUT_ETRE: "Peut-être",
};

/**
 * Taux personnel d'un membre sur une liste de séances passées (non annulées) :
 * présences / séances × 100.
 */
export function tauxPersonnel(statutsParSeance: Array<string | null | undefined>): { presences: number; seances: number; pourcentage: number } {
  const seances = statutsParSeance.length;
  const presences = statutsParSeance.filter((s) => s === "PRESENT").length;
  return { presences, seances, pourcentage: calculerTaux(presences, seances) };
}
