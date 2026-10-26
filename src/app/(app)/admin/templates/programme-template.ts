import { NIVEAU_DEFAUT, nomElement, nomPartie, partiesNommees, rangDefautNature, type NatureElement } from "@/lib/constants";
import { ELEMENTS_TEMPLATE_MAX, normaliserElements, type ElementTemplate, type NatureTemplate } from "@/lib/templates";
import { placesDansPartie } from "@/components/planning/rangement";

/**
 * **La mécanique de l'écran d'un template, sans React ni base** — de quoi la vérifier sans navigateur
 * (`tests/unit/templates-ecrans.test.ts` : les tests du dépôt n'importent pas de `.tsx`).
 *
 * Deux usages :
 *  - le **résumé** d'un programme sur la liste des templates (« Partie 1 · Échauffement — Footwork ·
 *    Cours — Messer »), écrit avec les mêmes mots que le reste de l'application (`nomPartie`,
 *    `nomElement`, `partiesNommees`) ;
 *  - l'**éditeur** du programme : à la différence du planning, rien ne part au serveur à chaque geste.
 *    Le programme se compose ici, dans le navigateur, et part **d'un bloc** par « Enregistrer le
 *    programme » (`enregistrerElementsTemplate`). Un template n'a pas d'inscrits, pas de notification
 *    à déclencher, et personne ne le lit pendant qu'on l'écrit : un brouillon local suffit, et il
 *    évite trente allers-retours pour poser une séance type.
 *
 * Chaque ligne porte une **clé locale** (`cle`) : un élément de template n'a pas d'identifiant qui
 * survive à l'enregistrement (le serveur remplace la liste entière), et l'ordre ne peut pas servir de
 * clé — un ↑ ferait remonter le mauvais champ sous le doigt (« une donnée affichée n'est jamais une
 * clé », CLAUDE.md, et une position non plus).
 */

/** Une ligne de l'éditeur : un élément de template, plus sa clé locale. */
export type LigneProgramme = ElementTemplate & { cle: string };

/** Ce qu'il faut d'un élément pour le nommer (résumé, étiquettes). */
type ElementNomme = { bloc: number; nature: NatureElement; theme: string };

/**
 * **Le résumé d'un programme, une ligne par partie.**
 *
 * « Partie 1 · Échauffement — Footwork · Cours — Messer » quand le template a plusieurs parties ;
 * « Échauffement — Footwork · Cours — Messer » quand il n'en a qu'une — la règle de `partiesNommees`,
 * la même que celle du planning, de l'accueil et des récaps. Un élément sans thème se lit par sa seule
 * nature (« Cours ») : c'est une place réservée, pas un vide à cacher, et le bureau doit la voir.
 * Les éléments doivent arriver **dans l'ordre de lecture** (bloc, puis ordre), comme la base les rend.
 */
export function resumeProgramme(elements: readonly ElementNomme[]): string[] {
  const places = placesDansPartie(elements);
  const blocs = [...new Set(elements.map((e) => e.bloc))].sort((a, b) => a - b);
  const nommees = partiesNommees(blocs.length);
  return blocs.map((bloc) => {
    const morceaux = elements
      .map((e, i) => ({ e, place: places[i] }))
      .filter(({ e }) => e.bloc === bloc)
      .map(({ e, place }) => {
        const nom = nomElement(e.nature, place.rang, place.nombre);
        const theme = e.theme.trim();
        return theme ? `${nom} — ${theme}` : nom;
      });
    return [...(nommees ? [nomPartie(bloc)] : []), ...morceaux].join(" · ");
  });
}

/** Les lignes de l'éditeur, depuis le programme enregistré (déjà dans l'ordre de lecture). */
export function lignesDepuis(elements: readonly ElementTemplate[]): LigneProgramme[] {
  return elements.map((e, i) => ({ ...e, cle: `l${i}` }));
}

/**
 * **Ce qui part au serveur** : les éléments sans leur clé locale, dans l'ordre de l'écran, avec les
 * deux règles de `modifierLigne` appliquées une dernière fois. Un thème libre en cours de frappe,
 * vidé puis jamais quitté, garderait sinon une description que l'écran ne montre plus : on
 * n'enregistre pas ce qu'on ne voit pas.
 */
export function versElements(lignes: readonly LigneProgramme[]): ElementTemplate[] {
  return lignes.map((e) => {
    const theme = e.theme.trim();
    const instructeurId = e.instructeurId || null;
    // Champ par champ, sans `...e` : la clé locale ne doit pas partir au serveur.
    return {
      bloc: e.bloc,
      nature: e.nature,
      theme,
      niveau: theme ? e.niveau : NIVEAU_DEFAUT,
      description: theme ? e.description : "",
      instructeurId,
      instructeurSecondId: instructeurId && e.instructeurSecondId && e.instructeurSecondId !== instructeurId ? e.instructeurSecondId : null,
    };
  });
}

/**
 * **Y a-t-il quelque chose à enregistrer ?** On compare ce que le serveur **écrirait** des deux côtés
 * (`normaliserElements` : parties contiguës, second identique au premier effacé), espaces de bord
 * retirés comme le fera le schéma. Sans cela, ajouter puis retirer un élément laisserait l'écran
 * annoncer une modification qui n'existe pas — et l'avertissement de fermeture deviendrait ce bruit
 * qu'on apprend à ignorer.
 */
export function memeProgramme(a: readonly ElementTemplate[], b: readonly ElementTemplate[]): boolean {
  const forme = (l: readonly ElementTemplate[]) =>
    JSON.stringify(
      normaliserElements(l).map((e) => [e.bloc, e.nature, e.theme.trim(), e.niveau, e.description.trim(), e.instructeurId ?? null, e.instructeurSecondId ?? null]),
    );
  return forme(a) === forme(b);
}

/** Les parties renumérotées 1, 2, 3… sans trou, l'ordre des lignes gardé à l'intérieur de chacune. */
export function renumeroter(lignes: readonly LigneProgramme[]): LigneProgramme[] {
  const blocs = [...new Set(lignes.map((l) => l.bloc))].sort((a, b) => a - b);
  const rang = new Map(blocs.map((b, i) => [b, i + 1]));
  return lignes
    .map((l, i) => ({ l, i }))
    .sort((x, y) => x.l.bloc - y.l.bloc || x.i - y.i)
    .map(({ l }) => ({ ...l, bloc: rang.get(l.bloc) ?? l.bloc }));
}

/** Le nombre de parties du programme en cours d'écriture. */
export function nombreParties(lignes: readonly { bloc: number }[]): number {
  return new Set(lignes.map((l) => l.bloc)).size;
}

/** Plus de place : le serveur refuserait au-delà de `ELEMENTS_TEMPLATE_MAX`, l'écran ne le propose pas. */
export function programmePlein(lignes: readonly unknown[]): boolean {
  return lignes.length >= ELEMENTS_TEMPLATE_MAX;
}

/**
 * **Ajouter un élément vide dans la partie `bloc`**, à sa place par défaut — la règle du planning
 * (`ordreDInsertion`) : juste après le dernier élément de la partie dont la nature vient avant la
 * sienne ou avec elle (échauffement, cours, option), sinon en tête. Un échauffement ajouté se pose
 * donc en haut, une option en bas, un second cours après le premier. Une partie qui n'existe pas
 * encore (`bloc` = nombre de parties + 1) naît en fin de programme.
 */
export function ajouterElement(lignes: readonly LigneProgramme[], bloc: number, nature: NatureTemplate, cle: string): LigneProgramme[] {
  if (programmePlein(lignes)) return [...lignes];
  const nouvelle: LigneProgramme = { cle, bloc, nature, theme: "", niveau: NIVEAU_DEFAUT, description: "", instructeurId: null, instructeurSecondId: null };
  const indices = lignes.map((l, i) => ({ l, i })).filter(({ l }) => l.bloc === bloc);
  let position: number;
  if (indices.length === 0) {
    position = lignes.length;
  } else {
    const precedents = indices.filter(({ l }) => rangDefautNature(l.nature) <= rangDefautNature(nature));
    position = precedents.length > 0 ? precedents[precedents.length - 1].i + 1 : indices[0].i;
  }
  return renumeroter([...lignes.slice(0, position), nouvelle, ...lignes.slice(position)]);
}

/**
 * **Déplacer une ligne d'un pas** — le pas que calcule `pasVoisins` pour le planning
 * (`src/components/planning/parties-carte.ts`) : `versBloc` est la partie d'arrivée, `avantId` la
 * clé de la ligne devant laquelle se poser, `null` pour la fin de la partie. Même geste, mêmes mots
 * (« Passer à la fin de la partie 1 ») que sur une séance. Une partie vidée par le départ de son
 * dernier élément disparaît, et les suivantes se renumérotent.
 */
export function deplacerLigne(lignes: readonly LigneProgramme[], cle: string, pas: { versBloc: number; avantId: string | null }): LigneProgramme[] {
  const ligne = lignes.find((l) => l.cle === cle);
  if (!ligne) return [...lignes];
  const reste = lignes.filter((l) => l.cle !== cle);
  const deplacee = { ...ligne, bloc: pas.versBloc };
  let position: number;
  if (pas.avantId !== null) {
    const i = reste.findIndex((l) => l.cle === pas.avantId);
    position = i === -1 ? reste.length : i;
  } else {
    // Fin de la partie d'arrivée ; une partie neuve (après la dernière) se pose en fin de programme.
    let dernier = -1;
    reste.forEach((l, i) => {
      if (l.bloc === pas.versBloc) dernier = i;
    });
    position = dernier === -1 ? reste.length : dernier + 1;
  }
  return renumeroter([...reste.slice(0, position), deplacee, ...reste.slice(position)]);
}

/** Retirer une ligne. Le dernier élément ne se retire pas : un template porte au moins un élément. */
export function retirerLigne(lignes: readonly LigneProgramme[], cle: string): LigneProgramme[] {
  if (lignes.length <= 1) return [...lignes];
  return renumeroter(lignes.filter((l) => l.cle !== cle));
}

/**
 * **Changer le contenu d'une ligne**, avec les deux règles de la case du planning :
 *  - le premier instructeur qui s'efface emporte le second (il n'assiste plus personne), et le
 *    premier qui devient le second libère la place ;
 *  - le thème qui s'efface emporte le niveau et la description : ils précisent ce qu'on travaille,
 *    et sans thème ils ne précisent rien (le planning fait de même, serveur compris).
 */
export function modifierLigne(
  lignes: readonly LigneProgramme[],
  cle: string,
  changement: Partial<Omit<ElementTemplate, "bloc" | "nature">>,
  /**
   * `false` pendant la frappe d'un thème libre : un champ vidé le temps de réécrire le mot ne doit
   * pas effacer la description (le planning n'applique la règle qu'en quittant le champ, idem ici).
   */
  effacerDetails = true,
): LigneProgramme[] {
  return lignes.map((l) => {
    if (l.cle !== cle) return l;
    const suivante = { ...l, ...changement };
    if (!suivante.instructeurId || suivante.instructeurSecondId === suivante.instructeurId) suivante.instructeurSecondId = null;
    if (effacerDetails && "theme" in changement && !suivante.theme.trim()) {
      suivante.niveau = NIVEAU_DEFAUT;
      suivante.description = "";
    }
    return suivante;
  });
}
