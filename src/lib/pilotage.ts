import { isoWeekday } from "./dates";
import { sousLeSeuil, type Compteurs } from "./presences";

/**
 * Indicateurs de **pilotage du trimestre** (fonctions pures, testées unitairement).
 *
 * Les compteurs de `presences.ts` répondent à « où en est *ce* cours ? ». Ceux d'ici répondent à
 * « où en va *le trimestre* ? » : la fréquentation monte-t-elle ou descend-elle, quel créneau
 * remplit le mieux, qui tient la salle, qui est en train de disparaître, et quels cours à venir
 * vont manquer de monde.
 *
 * **Elles sont toutes appelées par l'accueil** (`src/lib/accueil.ts`, bloc `admin`), et c'est une
 * condition de leur existence, pas un hasard : trois d'entre elles — la plus longue série, les
 * décrochages et les cours en danger — ont vécu un temps ici sans appelant, pendant que l'accueil
 * les réécrivait en ligne. Les deux versions avaient **déjà divergé** (celle d'ici parcourait tout
 * identifiant présent en table, compte de service compris) et les vingt-six assertions qui les
 * éprouvaient donnaient une confiance qui ne portait sur rien. Un calcul de pilotage vit ici, et
 * **un seul exemplaire est livré** ; si une forme ne convient pas à l'écran, c'est la fonction
 * d'ici qui change de forme.
 *
 * Aucune de ces fonctions ne touche la base : elles reçoivent des séances déjà filtrées (passées,
 * non annulées, dans l'ordre chronologique) et des tables déjà chargées. C'est ce qui les rend
 * testables au cas limite près — et les cas limites sont ici la règle plutôt que l'exception : un
 * trimestre commence avec zéro cours passé, un club peut n'avoir qu'un créneau, et personne ne doit
 * jamais lire un « NaN % » sur son tableau de bord.
 */

/** Une séance déjà passée et non annulée, dans l'ordre chronologique. */
export type SeancePassee = { id: string; date: string; presents: number };

/**
 * Assidu = présent à au moins deux cours sur trois.
 *
 * Deux tiers arrondis à l'entier : c'est le rythme de quelqu'un qui « vient au club », par
 * opposition à quelqu'un qui passe. Le seuil vit ici plutôt que dans un composant pour que le
 * chiffre affiché et la phrase qui l'explique ne puissent pas diverger.
 */
export const SEUIL_NOYAU = 67;

/** Nombre de derniers cours qui servent à repérer un décrochage. */
export const FENETRE_DECROCHAGE = 3;

/**
 * En dessous de deux cours d'affilée, ce n'est pas une série : c'est être venu. L'annoncer comme un
 * exploit serait vexant pour tout le monde.
 *
 * **Un nom, une valeur, un endroit** : le seuil vit ici, avec le calcul des séries, et l'accueil le
 * réexporte pour la vue Personnel (`src/lib/accueil.ts`), qui applique exactement le même nombre pour
 * la raison inverse — en dessous de deux, la ligne de série **disparaît** de son écran. Écrire « ta
 * plus longue série : 1 cours » reviendrait à dire « tu n'as jamais enchaîné deux cours ».
 */
export const SERIE_MINIMALE = 2;

/**
 * Noms français des jours, indexés par jour ISO (1 = lundi … 7 = dimanche).
 *
 * Écrits en clair plutôt que tirés d'`Intl` : le reste du module ne construit **aucune** `Date` à
 * partir d'une chaîne ISO nue (`new Date("2026-09-24")` est interprété en UTC et bascule d'un jour
 * selon le fuseau du serveur), et `isoWeekday` est déjà le seul endroit du dépôt qui sait passer
 * d'une date de séance à un jour de semaine sans se tromper.
 */
const NOMS_JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"] as const;

/** Moyenne de présents sur une tranche de séances (jamais appelée sur une tranche vide). */
function moyennePresents(seances: readonly SeancePassee[]): number {
  return seances.reduce((total, s) => total + s.presents, 0) / seances.length;
}

/**
 * **Le trimestre monte-t-il ou descend-il ?** — moyenne de présents de la première moitié comparée
 * à celle de la seconde.
 *
 * ## Pourquoi deux moitiés, et pas les deux derniers cours
 *
 * Un cours creux (vacances, météo, tournoi le même week-end) ne dit rien d'une tendance. Comparer
 * des moyennes de moitiés noie ces accidents ; c'est aussi le découpage le plus simple à expliquer
 * à quelqu'un qui découvre le tableau de bord — « le début du trimestre contre la fin ».
 *
 * ## Le cours du milieu compte dans les deux moitiés
 *
 * Chaque moitié fait `Math.ceil(n / 2)` cours, donc sur un nombre impair le cours médian est compté
 * des deux côtés. **Pourquoi :** l'écarter reviendrait à jeter un septième de ce qu'on sait d'un
 * trimestre de 7 cours, pour un club qui en compte rarement plus d'une vingtaine. Le chevauchement
 * atténue légèrement la variation, ce qui est le bon sens du compromis : mieux vaut annoncer une
 * baisse un peu trop prudente qu'une alarme tirée d'un seul cours.
 *
 * ## Quand on ne dit rien
 *
 * - **Moins de 4 cours passés** : une « moitié » d'un ou deux cours n'est pas une tendance, c'est
 *   une anecdote. Le tableau de bord n'affiche alors rien du tout, plutôt qu'un chiffre spectaculaire.
 * - **Moyenne de début nulle** : il n'y a pas de pourcentage d'augmentation à partir de zéro, et
 *   surtout pas de division par zéro.
 *
 * `debut` et `fin` sortent **non arrondies** : l'arrondi appartient à l'affichage (une décimale),
 * qui seul sait la place dont il dispose.
 */
export function tendance(passees: readonly SeancePassee[]): { variation: number; debut: number; fin: number } | null {
  const n = passees.length;
  if (n < 4) return null;

  const taille = Math.ceil(n / 2);
  const debut = moyennePresents(passees.slice(0, taille));
  const fin = moyennePresents(passees.slice(n - taille));
  if (debut === 0) return null;

  return { variation: Math.round(((fin - debut) / debut) * 100), debut, fin };
}

/**
 * **Quel créneau remplit le mieux ?** — moyenne de présents par jour de la semaine.
 *
 * Un club qui donne le mardi et le vendredi finit toujours par se demander lequel des deux porte le
 * trimestre : c'est la question qui décide où poser un cours supplémentaire, ou lequel sacrifier.
 *
 * Trois garde-fous, tous là pour ne pas faire dire à la comparaison plus qu'elle ne sait :
 * - un jour n'entre dans le classement qu'à partir de **2 cours** — sur un seul cours, la
 *   « moyenne » est ce cours-là, et un rattrapage exceptionnel un samedi passerait en tête ;
 * - **moins de 2 jours qualifiés → tableau vide** : un club qui n'a qu'un créneau n'a rien à
 *   comparer, et afficher « le mardi est le meilleur jour » quand c'est le seul est ridicule ;
 * - **au plus 2 jours** renvoyés, triés par nombre de cours puis par moyenne : l'écran oppose deux
 *   créneaux, il ne dresse pas un palmarès de la semaine.
 *
 * Les moyennes sortent non arrondies, comme celles de {@link tendance}, pour la même raison.
 */
export function moyennesParJour(passees: readonly SeancePassee[]): Array<{ jour: string; moyenne: number; cours: number }> {
  const parJour = new Map<number, { total: number; cours: number }>();
  for (const seance of passees) {
    const jour = isoWeekday(seance.date);
    const cumul = parJour.get(jour) ?? { total: 0, cours: 0 };
    cumul.total += seance.presents;
    cumul.cours += 1;
    parJour.set(jour, cumul);
  }

  const qualifies = [...parJour.entries()]
    .filter(([, cumul]) => cumul.cours >= 2)
    .map(([jour, cumul]) => ({ jour: NOMS_JOURS[jour - 1], moyenne: cumul.total / cumul.cours, cours: cumul.cours }));
  if (qualifies.length < 2) return [];

  qualifies.sort((a, b) => b.cours - a.cours || b.moyenne - a.moyenne);
  return qualifies.slice(0, 2);
}

/**
 * **Comment le club vient**, à partir des taux personnels du trimestre.
 *
 * - `mediane` — le taux de la personne « du milieu », pas la moyenne : quelques inscrits jamais
 *   venus tirent une moyenne vers le bas et donnent une image fausse d'un club qui va bien. La
 *   médiane dit ce que fait la moitié des gens.
 * - `noyau` — combien tiennent le rythme de {@link SEUIL_NOYAU}. C'est le chiffre qui compte pour
 *   monter un cycle technique sur plusieurs séances : il faut savoir sur combien de personnes on
 *   peut bâtir.
 *
 * Liste vide → `{ mediane: 0, noyau: 0 }` : au premier jour d'un trimestre, il n'y a rien à dire,
 * et surtout rien à diviser.
 */
export function assiduite(pourcentages: readonly number[]): { mediane: number; noyau: number } {
  if (pourcentages.length === 0) return { mediane: 0, noyau: 0 };

  const tries = [...pourcentages].sort((a, b) => a - b);
  const milieu = Math.floor(tries.length / 2);
  // Compte pair : les deux valeurs centrales sont aussi légitimes l'une que l'autre, on les moyenne.
  const brute = tries.length % 2 === 0 ? (tries[milieu - 1] + tries[milieu]) / 2 : tries[milieu];

  return {
    mediane: Math.round(brute),
    noyau: pourcentages.filter((p) => p >= SEUIL_NOYAU).length,
  };
}

/**
 * **Les plus longues séries de présences consécutives** du trimestre, la plus longue d'abord.
 *
 * C'est le seul indicateur du pilotage qui parle de quelqu'un plutôt que d'un chiffre, et c'est
 * volontaire : un tableau de bord entièrement fait de taux ne donne à personne l'envie de venir au
 * cours suivant. « Camille, 6 cours d'affilée » se dit à voix haute dans un vestiaire.
 *
 * « Consécutives » se lit **sur les séances passées prises dans l'ordre** : manquer un cours remet
 * le compteur à zéro, y compris si l'absence est parfaitement excusée — c'est une série, pas une
 * note de conduite. Un cours annulé n'est pas dans la liste reçue : il n'a manqué à personne, il ne
 * casse donc aucune série.
 *
 * Les séries en dessous de {@link SERIE_MINIMALE} n'y sont pas : venir une fois n'est pas une série.
 *
 * **Une seule fonction pour la tuile et pour sa bulle.** Le tableau entier sert le podium
 * (`meilleuresSeries` de l'accueil) et son premier élément sert la tuile ({@link serieDeTete}) :
 * calculés séparément, ils pourraient afficher un nom dans la tuile et un autre en tête de la bulle
 * qui s'ouvre au-dessus. Le tri est **stable** et `noms` arrive dans l'ordre de l'annuaire : à
 * égalité de longueur, c'est l'ordre affiché qui départage, jamais celui, imprévisible, d'une requête.
 *
 * Qui n'est pas dans `noms` n'y est pas non plus : la table des présences peut porter le compte de
 * service du portail, qui n'est pas un membre du club et n'a pas à tenir la plus longue série.
 */
export function meilleuresSeries(
  passees: readonly SeancePassee[],
  presences: ReadonlyMap<string, ReadonlySet<string>>,
  noms: ReadonlyMap<string, string>,
): Array<{ qui: string; longueur: number }> {
  const series: Array<{ qui: string; longueur: number }> = [];
  for (const [membreId, nom] of noms) {
    const vues = presences.get(membreId);
    let courante = 0;
    let longueur = 0;
    for (const seance of passees) {
      courante = vues?.has(seance.id) ? courante + 1 : 0;
      if (courante > longueur) longueur = courante;
    }
    if (longueur >= SERIE_MINIMALE) series.push({ qui: nom, longueur });
  }
  return series.sort((a, b) => b.longueur - a.longueur);
}

/**
 * **La série de tête**, telle que l'affiche la tuile : sa longueur, un nom, et combien de personnes
 * l'atteignent.
 *
 * `combien` compte les ex æquo, pour que l'affichage puisse écrire « et 2 autres » au lieu de
 * désigner arbitrairement quelqu'un ; `qui` est le premier nom du classement, donc celui de
 * l'annuaire à égalité de longueur.
 *
 * `null` sur un classement vide : personne n'a enchaîné {@link SERIE_MINIMALE} cours, et il n'y a
 * rien à féliciter. Prend le classement en argument plutôt que de le recalculer — c'est ce qui
 * interdit à la tuile et à sa bulle de citer deux noms différents.
 */
export function serieDeTete(series: readonly { qui: string; longueur: number }[]): { longueur: number; qui: string; combien: number } | null {
  const tete = series[0];
  if (!tete) return null;
  return { longueur: tete.longueur, qui: tete.qui, combien: series.filter((s) => s.longueur === tete.longueur).length };
}

/**
 * **Qui est en train de décrocher** : venu au moins une fois dans le trimestre, puis absent des
 * {@link FENETRE_DECROCHAGE} derniers cours. Les noms, dans l'ordre de `noms` (celui de l'annuaire).
 *
 * Ce sont les seules absences sur lesquelles un message change encore quelque chose : quelqu'un qui
 * est venu sait où est la salle et connaît le groupe, il s'est juste arrêté. Trois cours, c'est
 * environ une quinzaine de jours : assez pour ne pas confondre avec des vacances, assez peu pour
 * qu'un message arrive avant que la personne ait cessé de se considérer du club.
 *
 * **Volontairement disjoint de « jamais venus »** : cette tuile-là compte ceux qui ne sont jamais
 * venus du tout, et les deux vivent côte à côte sur le même écran. Une même personne ne doit jamais
 * être comptée dans les deux, sans quoi les deux chiffres deviennent illisibles — d'où la condition
 * « au moins une présence sur les séances passées » avant tout le reste. **Et la disjonction n'est
 * tenue qu'à une condition** : que `presences` et le « jamais venu » d'en face soient bornés de la
 * même façon. C'est le défaut — la tuile lisait un compteur borné à la date d'arrivée de chacun
 * pendant qu'ici les présences arrivaient sans borne, et une personne venue **avant** son
 * inscription se retrouvait nommée dans les deux bulles, avec deux scripts d'appel contradictoires.
 * L'appelant borne donc `presences` comme il borne l'autre tuile (voir `src/lib/accueil.ts`).
 *
 * Les noms, et non leur nombre : le compteur de la tuile en est la longueur, sa bulle en est la
 * liste, et il n'existe donc aucun chemin par lequel les deux pourraient différer. Qui n'est pas
 * dans `noms` n'est pas de l'annuaire et ne décroche donc de rien (compte de service).
 *
 * Moins de {@link FENETRE_DECROCHAGE} cours passés → personne : en début de trimestre, tout le monde
 * « manque les trois derniers cours », ce qui ne veut rien dire.
 */
export function decrochages(
  passees: readonly SeancePassee[],
  presences: ReadonlyMap<string, ReadonlySet<string>>,
  noms: ReadonlyMap<string, string>,
): string[] {
  if (passees.length < FENETRE_DECROCHAGE) return [];

  const derniers = passees.slice(-FENETRE_DECROCHAGE);
  const partis: string[] = [];
  for (const [membreId, nom] of noms) {
    const vues = presences.get(membreId);
    if (!vues) continue;
    // On ne se fie pas au contenu brut de l'ensemble : seules les séances passées reçues comptent,
    // pour que le « au moins une fois » porte bien sur ce trimestre-ci.
    if (!passees.some((s) => vues.has(s.id))) continue;
    if (!derniers.some((s) => vues.has(s.id))) partis.push(nom);
  }
  return partis;
}

/**
 * **Les cours à venir qui vont manquer de monde** : leurs dates ISO, la plus proche d'abord.
 *
 * Le palier n'est pas recalculé ici : il vient de {@link palierEffectif}, comme partout ailleurs.
 * Une règle de seuil recopiée dans ce module finirait par colorer une carte de séance autrement que
 * la tuile qui la compte, et le tableau de bord démentirait l'écran d'à côté.
 *
 * **Les dates, et non un compte** : le compteur de la tuile est la longueur de cette liste, la date
 * qu'elle annonce en est la première, et sa bulle est la liste entière. Une relance se cale sur un
 * jour — « le 6 octobre » se traite ce soir, « quelque part en octobre » attend indéfiniment — et
 * trois cours creux d'affilée en novembre ne se relancent pas comme un mardi isolé.
 *
 * Les séances reçues sont supposées déjà filtrées (ni passées, ni annulées) : décider qu'un cours
 * annulé « manque de monde » n'aurait aucun sens, et ce tri-là appartient à l'appelant, qui a la base.
 *
 * `partEffectifMin` est la part minimale d'effectif réglée par le club : elle traverse ce module
 * sans y être lue, comme partout ailleurs (voir `palierEffectif`).
 */
export function coursEnDanger(aVenir: readonly { date: string; compteurs: Compteurs }[], partEffectifMin: number): string[] {
  return aVenir
    // `sousLeSeuil` et non `palierEffectif` : c'est une décision (« ces cours vont manquer de
    // monde »), pas une étiquette. Voir la leçon écrite dans `presences.ts`.
    .filter((s) => sousLeSeuil(s.compteurs, partEffectifMin))
    .map((s) => s.date)
    // Les dates ISO se trient comme des chaînes : aucune `Date` n'est construite ici, elle
    // basculerait d'un jour selon le fuseau du serveur.
    .sort();
}
