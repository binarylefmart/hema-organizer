import { formatDateLongue, formatHoraire, joursAvant, todayIso } from "@/lib/dates";
import { baseUrl } from "@/lib/env";
import { lignesSeance, TITRE_ANNULATION, TITRE_RECAP, type SeanceResume } from "@/lib/notifications/contenu";
import { lienPartageWhatsApp } from "@/lib/notifications/whatsapp";

/**
 * **Ce qui part quand on partage** — le message, le lien, et l'adresse `wa.me` toute faite.
 *
 * Tout est construit **côté serveur** : le composant client (`BoutonPartager`) ne recalcule rien,
 * il se contente de tendre ce texte à l'appareil (`navigator.share`), à WhatsApp ou au presse-papiers.
 * Deux raisons : le navigateur n'a pas les chiffres à jour ni le domaine public, et surtout il ne
 * doit jamais pouvoir faire sortir plus que ce que la page publique montre déjà.
 *
 * Le message n'est pas réécrit ici non plus : ce sont les lignes du **contenu commun** des
 * notifications (`src/lib/notifications/contenu.ts`), celles de l'email de récap et de l'embed
 * Discord — pictogrammes compris, puisque c'est un texte destiné à WhatsApp, pas à l'interface.
 * Aucun nom de personne n'y figure, exactement comme sur `/partage/seance/<id>`.
 */

export type Partage = {
  /** Titre court (`navigator.share`) : la première ligne du message. */
  titre: string;
  /** Le message, sans l'URL — `navigator.share` ajoute le lien de son côté. */
  texte: string;
  /** Lien public, ouvrable sans connexion. */
  url: string;
  /** `https://wa.me/?text=…` : le message **et** le lien, encodés. */
  whatsapp: string;
};

/** Titre générique d'une séance qui n'est ni aujourd'hui ni demain (la date exacte est dans le message). */
export const TITRE_COURS = "🗡️ Cours du club";
export const TITRE_AUJOURDHUI = "🗡️ Cours d'aujourd'hui";
export const TITRE_PLANNING = "🗡️ Prochains cours";

/** Séance réduite à ce qui se partage : le contenu commun, plus de quoi bâtir le lien public. */
export type SeanceAPartager = SeanceResume & {
  id: string;
  annulee: boolean;
  motifAnnulation?: string | null;
  compteurs: { presents: number; invites: number };
};

/** Assemble les trois formes du même message (le `wa.me` porte le texte **et** le lien). */
function partage(titre: string, lignes: string[], url: string): Partage {
  const texte = [titre, ...lignes].join("\n");
  return { titre, texte, url, whatsapp: lienPartageWhatsApp(`${texte}\n${url}`) };
}

/** « 🗡️ Cours de demain » la veille, « … d'aujourd'hui » le jour même, sinon un titre neutre. */
export function titrePartageSeance(s: Pick<SeanceAPartager, "date" | "annulee">, aujourdHui = todayIso()): string {
  if (s.annulee) return TITRE_ANNULATION;
  const dans = joursAvant(aujourdHui, s.date);
  if (dans === 0) return TITRE_AUJOURDHUI;
  if (dans === 1) return TITRE_RECAP;
  return TITRE_COURS;
}

/**
 * Message de partage d'une séance et lien vers `/partage/seance/<id>`.
 *
 * Une séance annulée remplace les chiffres — qui ne veulent plus rien dire — par son motif, comme
 * le fait la page publique (`descriptionSeance` dans `src/lib/partage.ts`).
 */
export function partageSeance(s: SeanceAPartager, aujourdHui = todayIso()): Partage {
  const url = `${baseUrl()}/partage/seance/${s.id}`;
  const lignes = lignesSeance(s, s.compteurs);
  if (!s.annulee) return partage(titrePartageSeance(s, aujourdHui), lignes, url);
  // Les chiffres (ligne « ✅ … ») tombent : reste le quand, le où, le thème, puis le motif
  const sansChiffres = lignes.filter((l) => !l.startsWith("✅"));
  return partage(TITRE_ANNULATION, [...sansChiffres, `💬 ${s.motifAnnulation?.trim() || "motif non précisé"}`], url);
}

/** La période à partager : son nom, ce qui reste à venir, et la prochaine séance s'il y en a une. */
export type PlanningAPartager = {
  periodeId: string;
  periodeNom: string;
  /** Nombre de séances aujourd'hui ou à venir dans la période */
  aVenir: number;
  prochaine?: Pick<SeanceResume, "date" | "heureDebut" | "heureFin" | "lieu"> | null;
};

/** Message de partage d'une période et lien vers `/partage/planning/<periodId>`. */
export function partagePlanning(p: PlanningAPartager): Partage {
  const url = `${baseUrl()}/partage/planning/${p.periodeId}`;
  const compte = p.aVenir === 0 ? "aucune séance à venir" : `${p.aVenir} séance${p.aVenir > 1 ? "s" : ""} à venir`;
  const lignes = [`📅 Période « ${p.periodeNom} » — ${compte}`];
  if (p.prochaine) {
    lignes.push(`👉 Prochaine : ${formatDateLongue(p.prochaine.date)} — ${formatHoraire(p.prochaine.heureDebut, p.prochaine.heureFin)}`);
    lignes.push(`📍 ${p.prochaine.lieu}`);
  }
  return partage(TITRE_PLANNING, lignes, url);
}
