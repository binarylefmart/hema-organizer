import { z } from "zod";
import { isHHMM, isIsoDate } from "./dates";
import { libelleElement, NIVEAUX, NIVEAU_DEFAUT, PARTIE_DESCRIPTION_MAX, THEME_MAX, type NatureElement } from "./constants";
import { placesDansPartie } from "@/components/planning/rangement";
import { teintesProgramme } from "@/components/seances/teintes";

/**
 * **Les templates de cours** (demande de Delta : « créer des templates de planification de
 * cours qu'on pourra appliquer à des dates précises »).
 *
 * Un template porte ce que porte une séance — horaire, lieu — **et son programme**. L'appliquer à une
 * date **crée la séance** si la période n'en a pas ce jour-là, ou **remplit le programme** de celle qui
 * existe **s'il est vide**. Rien n'est jamais écrasé : un programme déjà commencé par l'équipe, une
 * séance annulée ou déjà commencée sont écartés, et chaque écart est nommé (`planApplication`).
 *
 * Ce module est **pur** (ni base ni React) : l'écran d'application calcule le même plan que le serveur
 * pour l'annoncer avant l'appui, et le serveur le recalcule pour le tenir. Deux calculs du même plan
 * qui divergeraient, c'est un écran qui promet ce que le serveur ne fait pas.
 */

/** Les natures qu'un template porte : un atelier est la proposition d'un membre, il ne se répète pas. */
export const NATURES_TEMPLATE = ["ECHAUFFEMENT", "COURS", "OPTION"] as const satisfies readonly NatureElement[];
export type NatureTemplate = (typeof NATURES_TEMPLATE)[number];

/** Au plus trente éléments par template : une séance de club n'en porte jamais autant. */
export const ELEMENTS_TEMPLATE_MAX = 30;
/** Au plus 120 dates par application : un an de cours hebdomadaires, deux fois. */
export const DATES_APPLICATION_MAX = 120;
export const NOM_TEMPLATE_MAX = 80;

export type ElementTemplate = {
  bloc: number;
  nature: NatureTemplate;
  theme: string;
  niveau: string;
  description: string;
  instructeurId: string | null;
  instructeurSecondId: string | null;
};

const idFacultatif = z
  .string()
  .trim()
  .max(64)
  .nullish()
  .transform((v) => (v ? v : null));

export const elementTemplateSchema = z.object({
  bloc: z.number().int().min(1).max(ELEMENTS_TEMPLATE_MAX),
  nature: z.enum(NATURES_TEMPLATE),
  theme: z.string().trim().max(THEME_MAX, "Thème trop long."),
  niveau: z.enum(NIVEAUX).default(NIVEAU_DEFAUT),
  description: z.string().trim().max(PARTIE_DESCRIPTION_MAX, "Description trop longue.").default(""),
  instructeurId: idFacultatif,
  instructeurSecondId: idFacultatif,
});

export const elementsTemplateSchema = z
  .array(elementTemplateSchema)
  .min(1, "Un template porte au moins un élément.")
  .max(ELEMENTS_TEMPLATE_MAX, `Pas plus de ${ELEMENTS_TEMPLATE_MAX} éléments.`);

export const templateSchema = z
  .object({
    nom: z.string().trim().min(1, "Donne un nom au template.").max(NOM_TEMPLATE_MAX, "Nom trop long."),
    heureDebut: z.string().refine(isHHMM, "Heure invalide (HH:MM attendu)."),
    heureFin: z.string().refine(isHHMM, "Heure invalide (HH:MM attendu)."),
    lieu: z.string().trim().min(1, "Indique le lieu.").max(120, "Trop long."),
    adresse: z.string().trim().max(200, "Trop long.").default(""),
  })
  .refine((s) => s.heureFin > s.heureDebut, { path: ["heureFin"], message: "L'heure de fin doit suivre l'heure de début." });

export const applicationSchema = z.object({
  templateId: z.string().min(1),
  periodId: z.string().min(1),
  dates: z.array(z.string().refine(isIsoDate, "Date invalide.")).min(1, "Choisis au moins une date.").max(DATES_APPLICATION_MAX, `Pas plus de ${DATES_APPLICATION_MAX} dates à la fois.`),
});

/**
 * **Remet un programme d'accord** : parties contiguës à partir de 1 (une partie n'existe que par ses
 * éléments), dans l'ordre reçu à l'intérieur d'une partie — l'ordre d'une partie est libre, comme au
 * planning. Un second identique au premier est effacé : on ne s'assiste pas soi-même.
 */
export function normaliserElements(elements: readonly ElementTemplate[]): ElementTemplate[] {
  const blocs = [...new Set(elements.map((e) => e.bloc))].sort((a, b) => a - b);
  const rang = new Map(blocs.map((b, i) => [b, i + 1]));
  return elements
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.bloc - b.e.bloc || a.i - b.i)
    .map(({ e }) => ({
      ...e,
      bloc: rang.get(e.bloc)!,
      instructeurSecondId: e.instructeurSecondId && e.instructeurSecondId !== e.instructeurId ? e.instructeurSecondId : null,
    }));
}

/**
 * **Les lignes `SessionPartie` qu'un template fait naître**, avec ce que `rangerParties` écrirait :
 * rang contigu, libellé calculé (« Partie 1 · Cours », ou « Cours » seul s'il n'y a qu'une partie) et
 * teinte attribuée comme au planning (celle du thème si elle est libre dans la séance, sinon la suivante).
 */
export function partiesDepuisTemplate(elements: readonly ElementTemplate[], themesClub: readonly string[]) {
  const ranges = normaliserElements(elements);
  const places = placesDansPartie(ranges);
  const nbParties = new Set(ranges.map((e) => e.bloc)).size;
  const teintes = teintesProgramme(
    ranges.map((e, i) => ({ id: String(i).padStart(4, "0"), bloc: e.bloc, nature: e.nature, theme: e.theme })),
    themesClub,
  ).elements;
  return ranges.map((e, ordre) => ({
    libelle: libelleElement(e.bloc, e.nature, places[ordre].rang, places[ordre].nombre, nbParties),
    ordre,
    bloc: e.bloc,
    nature: e.nature,
    teinte: teintes[ordre],
    theme: e.theme,
    niveau: e.niveau,
    description: e.description,
    instructeurId: e.instructeurId,
    instructeurSecondId: e.instructeurSecondId,
  }));
}

/** Ce que l'application d'un template sait d'une séance déjà en place. */
export type SeanceExistante = {
  id: string;
  date: string;
  heureDebut: string;
  annulee: boolean;
  /** L'heure de début est atteinte (`seanceCommencee`) : la séance est figée. */
  commencee: boolean;
  /** Aucun élément réglé, aucun atelier : le programme peut se remplir sans rien effacer. */
  programmeVide: boolean;
};

export type EtapeApplication =
  | { date: string; action: "creer" }
  | { date: string; action: "remplir"; sessionId: string }
  | { date: string; action: "ignorer"; raison: string };

/**
 * **Le plan d'une application**, date par date, dans l'ordre du calendrier et sans doublon.
 *
 * - hors de la période, ou déjà passée → écartée ;
 * - aucune séance ce jour-là → **créée** ;
 * - une séance ce jour-là (celle qui commence à l'heure du template quand il y en a plusieurs) →
 *   **remplie** si son programme est vide, écartée sinon — annulée, commencée ou programme déjà réglé ;
 * - plusieurs séances, aucune à l'heure du template → écartée : on ne choisit pas à la place du bureau.
 */
export function planApplication(entree: {
  dates: readonly string[];
  aujourdHui: string;
  periode: { dateDebut: string; dateFin: string };
  heureDebut: string;
  seances: readonly SeanceExistante[];
}): EtapeApplication[] {
  const dates = [...new Set(entree.dates)].sort();
  return dates.map((date): EtapeApplication => {
    if (date < entree.periode.dateDebut || date > entree.periode.dateFin) return { date, action: "ignorer", raison: "hors de la période" };
    if (date < entree.aujourdHui) return { date, action: "ignorer", raison: "date passée" };
    const duJour = entree.seances.filter((s) => s.date === date);
    if (duJour.length === 0) return { date, action: "creer" };
    const aLHeure = duJour.filter((s) => s.heureDebut === entree.heureDebut);
    const cible = aLHeure.length === 1 ? aLHeure[0] : duJour.length === 1 ? duJour[0] : null;
    if (!cible) return { date, action: "ignorer", raison: "plusieurs séances ce jour-là" };
    if (cible.annulee) return { date, action: "ignorer", raison: "séance annulée" };
    if (cible.commencee) return { date, action: "ignorer", raison: "séance déjà commencée" };
    if (!cible.programmeVide) return { date, action: "ignorer", raison: "programme déjà rempli" };
    return { date, action: "remplir", sessionId: cible.id };
  });
}

/** « 3 séances créées · 2 programmes remplis · 1 date écartée » : le bilan, dans les mots de l'écran. */
export function bilanApplication(plan: readonly EtapeApplication[]): string {
  const n = (action: EtapeApplication["action"]) => plan.filter((e) => e.action === action).length;
  const morceaux: string[] = [];
  const creer = n("creer");
  const remplir = n("remplir");
  const ignorer = n("ignorer");
  if (creer) morceaux.push(`${creer} séance${creer > 1 ? "s" : ""} créée${creer > 1 ? "s" : ""}`);
  if (remplir) morceaux.push(`${remplir} programme${remplir > 1 ? "s" : ""} rempli${remplir > 1 ? "s" : ""}`);
  if (ignorer) morceaux.push(`${ignorer} date${ignorer > 1 ? "s" : ""} écartée${ignorer > 1 ? "s" : ""}`);
  return morceaux.length ? morceaux.join(" · ") : "Rien à faire.";
}
