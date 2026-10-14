import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { ecritureFermee, estNatureElement, libelleNiveau, NIVEAU_DEFAUT, type NatureElement } from "@/lib/constants";
import { formatDateFrise, formatDateLongue, formatDateSansAnnee, formatHeure, formatHoraire, minuscule, parisDateTime } from "@/lib/dates";
import { enqueueEmail } from "@/lib/email/mailer";
import { emailPlanningModifie } from "@/lib/email/templates/planning";
import { aUnEmail } from "@/lib/membres";
import { filtrerAccesActif } from "@/lib/acces-actif";
import { personnesDuClub } from "@/lib/permissions";
import { envoiPossible } from "./canaux";
import { clesDejaEnvoyees, journaliser, marquerEchec, notifierParPush, pushPossible } from "./journal";
import { empreinteCreneau } from "./planification";
import { destinataireRetenu, getPreferencesNotifications } from "./preferences";
import type { ChargePush } from "./push";
import { CHAMPS_DESTINATAIRE, equipeJoignable, type InstructeurAlerte, type SeanceEffectif } from "./seances";

/**
 * **Planning modifié** (`planning_modifie`) : un échauffement, un cours ou une option est ajouté ou
 * modifié dans le planning, et les instructeurs du club l'apprennent — la date du cours, ce qui a été
 * ajouté ou changé, et qui l'a fait.
 *
 * ## Ce qui déclenche
 *
 * - **« Appliquer les modifications »** (`enregistrerCases`) : un message pour **tout** le geste,
 *   toutes séances et tous éléments confondus — jamais un par case ;
 * - **l'enregistrement immédiat d'une case** sur la fiche de séance (`enregistrerCase`) : chaque
 *   réglage y part seul (instructeur, puis thème, puis niveau…), si bien qu'un message par appel en
 *   ferait quatre pour une case. Ces appels sont **regroupés par auteur** et partent après
 *   {@link DELAI_REGROUPEMENT_MS} sans nouveau réglage ({@link differerModificationsPlanning}) ;
 * - un élément **ajouté** s'annonce quand il reçoit son contenu, pas à sa création : « Ajouter dans
 *   la partie… » (unitaire ou en masse) pose un élément **vide**, qui n'apprend rien à personne, puis
 *   l'équipe le remplit et applique. L'élément qui passe de vide à rempli se lit « Ajouté », avec son
 *   thème et ses instructeurs. Un élément créé et jamais rempli n'est pas annoncé ;
 * - un élément rempli **retiré** s'annonce « Supprimé », avec son thème et son instructeur, **seulement**
 *   avec le prochain « Appliquer les modifications » de son auteur — « Annuler » ne l'annonce pas ;
 * - seuls le **thème** et l'**instructeur principal** déclenchent une modification ; second
 *   instructeur, niveau et description ne s'annoncent qu'avec eux ;
 * - **les ateliers ne déclenchent rien** (la demande nomme échauffement, cours, option), ni le
 *   changement de place (↑ ↓) ;
 * - rien pour une séance annulée, d'une période close, ou déjà commencée.
 *
 * ## Qui reçoit, et par où
 *
 * **Tous les instructeurs du club** (rôle de base INSTRUCTEUR, compte actif, hors compte de service),
 * plus l'équipe de chaque séance touchée, réduits à qui a un accès actif — la même règle que
 * `desistement_tardif` —, **sauf l'auteur du changement**. Puis chacun selon ses préférences
 * (`destinataireRetenu`, désactivable dans « Mon profil »). **Email et téléphone seulement** : le
 * message nomme des personnes.
 *
 * ## Idempotence
 *
 * Une clé par destinataire et par canal ({@link clePlanningModifie}), posée **avant** l'envoi et
 * libérée sur échec. Elle porte l'**empreinte du geste** : les éléments touchés, l'horodatage de leur
 * écriture, leur nouvel état et le créneau de leur séance.
 *
 * ## Jamais bloquant
 *
 * {@link signalerModificationsPlanning} ne lève jamais : le planning est déjà écrit quand il est
 * appelé.
 */

/** Type écrit dans `NotificationLog`. */
export const TYPE_JOURNAL_PLANNING = "PLANNING";

/** Silence après le dernier réglage d'une case (fiche de séance) avant que le message parte. */
export const DELAI_REGROUPEMENT_MS = 2 * 60_000;

/** Au-delà, la séance est résumée (« … et N autres cours ») : un message, pas un registre. */
const SEANCES_DETAILLEES_MAX = 10;
const LIGNES_PAR_SEANCE_MAX = 15;

/** Les natures qui déclenchent : pas l'atelier. */
const NATURES_ANNONCEES: readonly NatureElement[] = ["ECHAUFFEMENT", "COURS", "OPTION"];

/** Ce qu'un élément annonce : son contenu, avec des **noms** (pas des identifiants). */
export type EtatElement = {
  theme: string;
  instructeur: string | null;
  instructeurSecond: string | null;
  niveau: string;
  description: string;
};

export type SeanceAnnoncee = { id: string; date: string; heureDebut: string; heureFin: string; lieu: string; periodId: string };

/** Un élément écrit : son état avant et après, et de quoi le placer dans le message. */
export type ChangementElement = {
  partieId: string;
  sessionId: string;
  nature: NatureElement;
  /** Nom calculé de l'élément après l'écriture (« Cours », « Partie 2 · Option 1 ») */
  libelle: string;
  bloc: number;
  ordre: number;
  avant: EtatElement;
  apres: EtatElement;
  /** Horodatage de l'écriture (`updatedAt`) : il distingue deux gestes identiques à la suite */
  horodatage: number;
  /** L'élément a été **retiré** : `avant` dit ce qu'il portait, `apres` est vide */
  retire?: boolean;
};

/** Un élément vide : rien d'écrit dedans. C'est l'état d'un élément qui vient d'être ajouté. */
export function estVide(e: EtatElement): boolean {
  return !e.theme.trim() && !e.instructeur && !e.instructeurSecond && !e.description.trim();
}

function noms(e: EtatElement): string | null {
  const n = [e.instructeur, e.instructeurSecond].filter(Boolean);
  return n.length ? n.join(" et ") : null;
}

const ouAucun = (v: string | null, vide: string) => (v && v.trim() ? v.trim() : vide);
/** Un thème entre guillemets : il contient souvent lui-même un tiret (« Messer — coups de taille »). */
const cite = (v: string | null, vide: string) => (v && v.trim() ? `« ${v.trim()} »` : vide);

/**
 * Les champs changés d'un élément déjà rempli : leur nom court, et **leur nouvelle valeur seulement**
 * (décision de Delta : « ne mets pas l'ancien historique ») — le message dit où en est le planning,
 * pas d'où il vient. **Seuls le thème et l'instructeur principal déclenchent** : le second
 * instructeur, le niveau et la description, seuls, n'annoncent rien (une retouche ne change pas le
 * cours) ; ils accompagnent un changement qui, lui, en est un.
 */
function champsModifies(avant: EtatElement, apres: EtatElement): Array<{ champ: string; texte: string }> {
  const themeChange = avant.theme.trim() !== apres.theme.trim();
  const instructeurChange = avant.instructeur !== apres.instructeur;
  if (!themeChange && !instructeurChange) return [];
  const champs: Array<{ champ: string; texte: string }> = [];
  if (themeChange) champs.push({ champ: "thème", texte: `thème : ${cite(apres.theme, "aucun")}` });
  if (instructeurChange) champs.push({ champ: "instructeur", texte: `instructeur : ${ouAucun(apres.instructeur, "personne")}` });
  if (avant.instructeurSecond !== apres.instructeurSecond)
    champs.push({ champ: "second", texte: `second instructeur : ${ouAucun(apres.instructeurSecond, "personne")}` });
  if ((avant.niveau || NIVEAU_DEFAUT) !== (apres.niveau || NIVEAU_DEFAUT)) champs.push({ champ: "niveau", texte: `niveau : ${minuscule(libelleNiveau(apres.niveau))}` });
  if (avant.description.trim() !== apres.description.trim())
    champs.push({
      champ: "description",
      texte: !apres.description.trim() ? "description retirée" : `description : ${cite(apres.description, "")}`,
    });
  return champs;
}

/**
 * **Ce qui a changé dans un élément, en français** (fonction pure). `null` quand rien de ce qui se
 * lit n'a changé — c'est ce qui évite un message pour un enregistrement qui ne change rien.
 */
export function phraseChangement(c: Pick<ChangementElement, "libelle" | "avant" | "apres" | "retire">): string | null {
  const { avant, apres } = c;
  if (c.retire) {
    // Un élément retiré vide n'avait rien annoncé : son retrait n'a rien à dire non plus
    if (estVide(avant)) return null;
    const theme = avant.theme.trim() ? ` ${cite(avant.theme, "")}` : "";
    const par = avant.instructeur ? `, par ${avant.instructeur}` : "";
    return `Supprimé : ${c.libelle}${theme}${par}`;
  }
  if (estVide(apres) && estVide(avant)) return null;
  if (estVide(avant)) {
    const theme = apres.theme.trim() ? ` ${cite(apres.theme, "")}` : "";
    const par = noms(apres) ? `, par ${noms(apres)}` : "";
    const niveau = (apres.niveau || NIVEAU_DEFAUT) !== NIVEAU_DEFAUT ? ` (niveau ${minuscule(libelleNiveau(apres.niveau))})` : "";
    return `Ajouté : ${c.libelle}${theme}${par}${niveau}`;
  }
  const champs = champsModifies(avant, apres);
  if (champs.length === 0) return null;
  return `Modifié : ${c.libelle} — ${champs.map((d) => d.texte).join(" ; ")}`;
}

/**
 * Version compacte pour le téléphone : « + Cours (Épée longue) », « ✎ Option 1 (thème, instructeur) »,
 * « − Cours 2 ». Un signe en tête plutôt qu'un mot : l'écran verrouillé n'affiche que deux lignes.
 */
function resumeCourt(c: ChangementElement): string | null {
  if (!phraseChangement(c)) return null;
  if (c.retire) return `− ${c.libelle}`;
  if (estVide(c.avant)) return `+ ${c.libelle}${c.apres.theme.trim() ? ` (${c.apres.theme.trim()})` : ""}`;
  return `✎ ${c.libelle} (${champsModifies(c.avant, c.apres).map((d) => d.champ).join(", ")})`;
}

/** Longueur au-delà de laquelle le corps d'une notification de téléphone est coupé. */
const CORPS_PUSH_MAX = 120;

/** **Une notification de téléphone par journée modifiée** (demande de Delta) : titre daté, corps compact. */
export type PushJour = { sessionId: string; titre: string; corps: string; chemin: string };

export type BlocSeance = { seance: SeanceAnnoncee; entete: string; lignes: string[]; chemin: string };

export type ContenuPlanningModifie = {
  titre: string;
  /** « Delta Lefèvre a modifié le planning : » */
  intro: string;
  blocs: BlocSeance[];
  /** « … et 3 autres cours » quand le message en détaille moins qu'il n'en touche */
  reste: string | null;
  sujet: string;
  /** Une notification de téléphone par cours touché, dans l'ordre du calendrier */
  pushParJour: PushJour[];
  /** La première séance touchée : là où mènent le bouton principal et la notification */
  chemin: string;
};

/** L'ordre de lecture de la séance : partie, puis rang dans la partie. */
const trier = (elements: readonly ChangementElement[]) => [...elements].sort((a, b) => a.bloc - b.bloc || a.ordre - b.ordre);

/** Le planning, ouvert sur la séance (même lien que le bouton « Programme de la séance »). */
export function cheminPlanning(s: Pick<SeanceAnnoncee, "id" | "periodId">): string {
  return `/planning?periode=${encodeURIComponent(s.periodId)}#seance-${s.id}`;
}

/**
 * **Le contenu du message**, une fois pour l'email et le téléphone (fonction pure). Rend `null` quand
 * aucun élément n'a de changement lisible.
 */
export function contenuPlanningModifie(args: { auteur: string; seances: readonly SeanceAnnoncee[]; changements: readonly ChangementElement[] }): ContenuPlanningModifie | null {
  const parSeance = new Map<string, ChangementElement[]>();
  for (const c of args.changements) {
    if (!phraseChangement(c)) continue;
    parSeance.set(c.sessionId, [...(parSeance.get(c.sessionId) ?? []), c]);
  }
  const seances = args.seances
    .filter((s) => parSeance.has(s.id))
    .sort((a, b) => a.date.localeCompare(b.date) || a.heureDebut.localeCompare(b.heureDebut));
  if (seances.length === 0) return null;

  const blocs: BlocSeance[] = seances.slice(0, SEANCES_DETAILLEES_MAX).map((s) => {
    const elements = trier(parSeance.get(s.id)!);
    const phrases = elements.map((c) => phraseChangement(c)!);
    const lignes = phrases.length > LIGNES_PAR_SEANCE_MAX ? [...phrases.slice(0, LIGNES_PAR_SEANCE_MAX), `… et ${phrases.length - LIGNES_PAR_SEANCE_MAX} autres changements`] : phrases;
    return { seance: s, entete: `${formatDateLongue(s.date)} — ${formatHoraire(s.heureDebut, s.heureFin)} (${s.lieu})`, lignes, chemin: cheminPlanning(s) };
  });
  const autres = seances.length - blocs.length;
  const reste = autres > 0 ? `… et ${autres} autre${autres > 1 ? "s" : ""} cours : tout est dans le planning.` : null;

  const premier = seances[0];
  const dernier = seances[seances.length - 1];
  const jour = (s: SeanceAnnoncee) => minuscule(formatDateSansAnnee(s.date));
  const quels = seances.length === 1 ? `cours du ${jour(premier)}` : `${seances.length} cours, du ${jour(premier)} au ${jour(dernier)}`;

  const pushParJour: PushJour[] = seances.slice(0, SEANCES_DETAILLEES_MAX).map((s) => {
    let corps = `${args.auteur} : ${trier(parSeance.get(s.id)!).map(resumeCourt).filter(Boolean).join(" · ")}`;
    if (corps.length > CORPS_PUSH_MAX) corps = `${corps.slice(0, CORPS_PUSH_MAX - 1).trimEnd()}…`;
    return { sessionId: s.id, titre: `Planning modifié · ${formatDateFrise(s.date)} ${formatHeure(s.heureDebut)}`, corps, chemin: cheminPlanning(s) };
  });

  return {
    titre: "📝 Planning modifié",
    intro: `${args.auteur} a modifié le planning${seances.length > 1 ? ` de ${seances.length} cours` : ""} :`,
    blocs,
    reste,
    sujet: `📝 Planning modifié — ${quels}`,
    pushParJour,
    chemin: premier ? cheminPlanning(premier) : "/planning",
  };
}

/**
 * La clé de déduplication : type + canal + destinataire + **empreinte du geste** (éléments, horodatage
 * de leur écriture, nouvel état, créneau de leur séance).
 */
export function clePlanningModifie(args: { canal: "email" | "push"; destinataireId: string; empreinte: string; seanceId?: string }): string {
  // Le téléphone reçoit une notification par cours : la séance entre dans sa clé
  return `planning_${args.canal}_${args.empreinte}${args.seanceId ? `_${args.seanceId}` : ""}_${args.destinataireId}`;
}

/** L'empreinte d'un geste (fonction pure) : deux appels pour la même écriture donnent la même. */
export function empreinteGeste(seances: readonly SeanceAnnoncee[], changements: readonly ChangementElement[]): string {
  const creneaux = new Map(seances.map((s) => [s.id, empreinteCreneau(s)]));
  const lignes = changements
    .map((c) => JSON.stringify([c.partieId, c.horodatage, creneaux.get(c.sessionId) ?? "", c.apres, c.retire ? 1 : 0]))
    .sort();
  return createHash("sha256").update(lignes.join("\n")).digest("hex").slice(0, 24);
}

export type SignalementPlanning = {
  /** Qui a écrit : nommé dans le message, et seul instructeur à ne pas le recevoir */
  auteur: { id: string; prenom: string; nom: string };
  changements: readonly ChangementElement[];
  now?: Date;
};

/**
 * Prévient les instructeurs d'un ajout ou d'une modification du planning. Rend le nombre d'envois
 * tentés (emails et téléphones confondus) — **ne lève jamais**.
 */
export async function signalerModificationsPlanning(signalement: SignalementPlanning): Promise<number> {
  try {
    return await signaler(signalement);
  } catch (e) {
    console.error("[notifications] planning modifié : échec non bloquant", e);
    return 0;
  }
}

async function signaler({ auteur, changements, now = new Date() }: SignalementPlanning): Promise<number> {
  // Le tri d'abord, sans base : une case atelier ou un enregistrement sans effet ne coûte rien.
  const utiles = changements.filter((c) => NATURES_ANNONCEES.includes(c.nature) && phraseChangement(c) !== null);
  if (utiles.length === 0) return 0;
  const [parEmail, parPush] = await Promise.all([envoiPossible("planning_modifie", "email"), pushPossible("planning_modifie")]);
  if (!parEmail && !parPush) return 0;

  const lues = await db.session.findMany({
    where: { id: { in: [...new Set(utiles.map((c) => c.sessionId))] } },
    include: {
      instructeurs: { include: { user: { select: CHAMPS_DESTINATAIRE } } },
      period: { select: { id: true, statut: true, instructeurs: { include: { user: { select: CHAMPS_DESTINATAIRE } } } } },
    },
  });
  // Ni séance annulée, ni période close, ni cours commencé : il n'y a plus rien à préparer.
  const vivantes = lues.filter((s) => !s.annulee && !ecritureFermee(s.period.statut) && parisDateTime(s.date, s.heureDebut).getTime() > now.getTime());
  if (vivantes.length === 0) return 0;
  const seances: SeanceAnnoncee[] = vivantes.map((s) => ({ id: s.id, date: s.date, heureDebut: s.heureDebut, heureFin: s.heureFin, lieu: s.lieu, periodId: s.period.id }));
  const retenus = utiles.filter((c) => seances.some((s) => s.id === c.sessionId));
  const nomAuteur = `${auteur.prenom} ${auteur.nom}`.trim();
  const contenu = contenuPlanningModifie({ auteur: nomAuteur, seances, changements: retenus });
  if (!contenu) return 0;
  // Au-delà du plafond, l'écriture reste faite et journalisée : seule l'annonce est sautée.
  const { checkRateLimit } = await import("@/lib/auth/rate-limit");
  if (!(await checkRateLimit("planning_annonce_user", auteur.id, now.getTime()))) {
    console.warn("[notifications] planning modifié : plafond d'annonces atteint pour", auteur.id);
    return 0;
  }

  const equipe = (await destinataires(vivantes, now)).filter((u) => u.id !== auteur.id);
  if (equipe.length === 0) return 0;
  const prefs = await getPreferencesNotifications();
  const empreinte = empreinteGeste(seances, retenus);
  const sessionId = contenu.blocs[0]?.seance.id ?? null;
  let tentes = 0;

  if (parEmail) {
    const pourEmail = equipe.filter((u): u is InstructeurAlerte & { email: string } => aUnEmail(u) && destinataireRetenu(prefs, "planning_modifie", "email", u));
    const cle = (u: InstructeurAlerte) => clePlanningModifie({ canal: "email", destinataireId: u.id, empreinte });
    const deja = await clesDejaEnvoyees(pourEmail.map(cle));
    for (const u of pourEmail) {
      const dedupKey = cle(u);
      if (deja.has(dedupKey)) continue;
      // Le message d'abord : une mise en forme qui lève ne laisse pas de clé derrière elle.
      const { sujet, contenu: email } = emailPlanningModifie({ prenom: u.prenom, contenu });
      // La clé **avant** l'envoi : c'est la contrainte d'unicité qui tranche entre deux passages.
      if (!(await journaliser({ type: TYPE_JOURNAL_PLANNING, canal: "EMAIL", sessionId, userId: u.id, dedupKey, statut: "ENVOYE" }))) continue;
      try {
        enqueueEmail({ to: u.email, sujet, contenu: email, ref: dedupKey }, (err) => {
          if (err) void marquerEchec(dedupKey, err.message);
        });
        tentes += 1;
      } catch (e) {
        await marquerEchec(dedupKey, e instanceof Error ? e.message : String(e));
      }
    }
  }

  if (parPush) {
    const pourPush = equipe.filter((u) => destinataireRetenu(prefs, "planning_modifie", "push", u));
    for (const jour of contenu.pushParJour) {
      tentes += await notifierParPush({
        type: TYPE_JOURNAL_PLANNING,
        sessionId: jour.sessionId,
        destinataires: pourPush,
        cle: (u) => clePlanningModifie({ canal: "push", destinataireId: u.id, empreinte, seanceId: jour.sessionId }),
        charge: () => chargePlanningPush(jour),
      });
    }
  }
  return tentes;
}

/** Le même message sur le téléphone : titre, résumé court, et le planning ouvert sur la séance. */
export function chargePlanningPush(jour: PushJour): ChargePush {
  // Un tag par cours : la notification suivante sur le même jour remplace la précédente à l'écran
  return { titre: jour.titre, corps: jour.corps, url: jour.chemin, tag: `planning-${jour.sessionId}` };
}

type SeanceLue = {
  instructeurs: Array<{ user: InstructeurAlerte }>;
  period: { instructeurs: Array<{ user: InstructeurAlerte }> };
} & Pick<SeanceEffectif, "id" | "date" | "heureDebut" | "heureFin" | "lieu">;

/** Les instructeurs du club, plus l'équipe de chaque séance touchée : sans doublon, accès actif. */
async function destinataires(seances: readonly SeanceLue[], now: Date): Promise<InstructeurAlerte[]> {
  const instructeurs = await db.user.findMany({ where: { role: "INSTRUCTEUR", actif: true, service: false }, select: CHAMPS_DESTINATAIRE });
  const parId = new Map<string, InstructeurAlerte>();
  for (const u of await filtrerAccesActif(personnesDuClub(instructeurs), now)) parId.set(u.id, u);
  for (const s of seances) {
    const equipe = await equipeJoignable({ ...s, attendances: [], period: { ...s.period, membres: [] } }, now);
    for (const u of equipe) if (!parId.has(u.id)) parId.set(u.id, u);
  }
  return [...parId.values()];
}

/* ──────────────────── Depuis les écritures du planning (`src/actions/planning.ts`) ──────────────────── */

type Personne = { prenom: string; nom: string } | null;
type ElementLu = {
  theme: string;
  description: string;
  niveau: string;
  instructeur: Personne;
  instructeurSecond: Personne;
};

/** Ce que les actions du planning ont sous la main : la case relue avant, la ligne rendue après. */
export type EcriturePlanning = {
  avant: ElementLu & { id: string; sessionId: string; nature: string; bloc: number; ordre: number };
  apres: ElementLu & { libelle: string; nature?: string; bloc?: number; ordre?: number; updatedAt: Date };
};

const nom = (p: Personne) => (p ? `${p.prenom} ${p.nom}`.trim() : null);
const etat = (e: ElementLu): EtatElement => ({
  theme: e.theme ?? "",
  instructeur: nom(e.instructeur),
  instructeurSecond: nom(e.instructeurSecond),
  niveau: e.niveau || NIVEAU_DEFAUT,
  description: e.description ?? "",
});

/** Une écriture du planning, mise à la forme du message (fonction pure). */
export function changementDepuis({ avant, apres }: EcriturePlanning): ChangementElement {
  const nature = apres.nature ?? avant.nature;
  return {
    partieId: avant.id,
    sessionId: avant.sessionId,
    nature: estNatureElement(nature) ? nature : "COURS",
    libelle: apres.libelle,
    bloc: apres.bloc ?? avant.bloc,
    ordre: apres.ordre ?? avant.ordre,
    avant: etat(avant),
    apres: etat(apres),
    horodatage: apres.updatedAt.getTime(),
  };
}

/**
 * **« Appliquer les modifications » : un message pour tout le geste.** Appelé après le commit ; ne
 * lève jamais.
 */
export async function signalerEcrituresPlanning(auteur: SignalementPlanning["auteur"], ecritures: readonly EcriturePlanning[]): Promise<number> {
  try {
    // Ce qui attendait pour cet auteur (retraits, réglages de fiche) part **dans le même message** :
    // retirer un cours puis appliquer ne fait qu'une annonce.
    const changements = new Map<string, ChangementElement>();
    for (const c of [...reprendreAttente(auteur.id), ...reprendreRetraits(auteur.id), ...ecritures.map(changementDepuis)]) {
      const precedent = changements.get(c.partieId);
      changements.set(c.partieId, precedent ? fusionner(precedent, c) : c);
    }
    return await signalerModificationsPlanning({ auteur, changements: [...changements.values()] });
  } catch (e) {
    console.error("[notifications] planning modifié : échec non bloquant", e);
    return 0;
  }
}

/* ─────────── Les réglages case par case (fiche de séance) : regroupés avant de partir ─────────── */

type Attente = { auteur: SignalementPlanning["auteur"]; changements: Map<string, ChangementElement>; minuteur: ReturnType<typeof setTimeout> };
const enAttente = new Map<string, Attente>();

/**
 * Fusionne deux écritures successives du même élément : l'état **d'avant la première**, l'état
 * **d'après la dernière**. Un aller-retour (A → B → A) ne laisse alors aucun changement.
 */
function fusionner(premier: ChangementElement, suivant: ChangementElement): ChangementElement {
  return { ...suivant, avant: premier.avant };
}

/**
 * **Un réglage de case enregistré tout seul** (`enregistrerCase`) : mis de côté pour son auteur, et
 * envoyé avec les suivants une fois {@link DELAI_REGROUPEMENT_MS} écoulé sans nouveau réglage. Le
 * prix assumé : un redémarrage du serveur dans cet intervalle perd le message (jamais l'écriture).
 */
export function differerModificationsPlanning(auteur: SignalementPlanning["auteur"], ecritures: readonly EcriturePlanning[]): void {
  try {
    mettreEnAttente(auteur, ecritures.map(changementDepuis));
  } catch (e) {
    console.error("[notifications] planning modifié : regroupement impossible", e);
  }
}

/**
 * **Les suppressions attendent « Appliquer les modifications »** (décision de Delta : « ne pas faire
 * partir si les modifications ne sont pas appliquées »). La ligne est supprimée tout de suite en base,
 * mais son annonce reste de côté, **sans minuteur** : elle part avec le prochain « Appliquer » de son
 * auteur (`signalerEcrituresPlanning`, ou `annoncerModificationsAppliquees` quand rien d'autre n'est à
 * écrire), et « Annuler » la jette (`oublierModificationsNonAppliquees`). Quitter la page sans l'un ni
 * l'autre la laisse se périmer : passé {@link DUREE_RETRAITS_MS}, elle n'est plus annoncée.
 */
export const DUREE_RETRAITS_MS = 2 * 60 * 60_000;
const retraitsEnAttente = new Map<string, Map<string, ChangementElement>>();

/** Chaque suppression se périme d'après **sa** date, jamais d'après la plus ancienne de l'auteur. */
const encoreAnnoncable = (c: ChangementElement, now: number) => now - c.horodatage <= DUREE_RETRAITS_MS;

/** Les suppressions encore annonçables de tous les auteurs : purge appelée à chaque mise en attente. */
function purgerRetraits(now: number): void {
  for (const [auteurId, retraits] of retraitsEnAttente) {
    for (const [id, c] of retraits) if (!encoreAnnoncable(c, now)) retraits.delete(id);
    if (retraits.size === 0) retraitsEnAttente.delete(auteurId);
  }
}

export function differerRetraitPlanning(
  auteur: SignalementPlanning["auteur"],
  partie: ElementLu & { id: string; sessionId: string; nature: string; bloc: number; ordre: number; libelle: string },
): void {
  try {
    const nature = estNatureElement(partie.nature) ? partie.nature : "COURS";
    if (!NATURES_ANNONCEES.includes(nature)) return;
    const vide: EtatElement = { theme: "", instructeur: null, instructeurSecond: null, niveau: NIVEAU_DEFAUT, description: "" };
    const retrait: ChangementElement = { partieId: partie.id, sessionId: partie.sessionId, nature, libelle: partie.libelle, bloc: partie.bloc, ordre: partie.ordre, avant: etat(partie), apres: vide, horodatage: Date.now(), retire: true };
    // Supprimé après un réglage resté en attente (fiche) : l'annonce part de l'état d'avant ce réglage
    const precedent = enAttente.get(auteur.id)?.changements.get(partie.id);
    if (precedent) enAttente.get(auteur.id)!.changements.delete(partie.id);
    purgerRetraits(retrait.horodatage);
    const retraits = retraitsEnAttente.get(auteur.id) ?? new Map<string, ChangementElement>();
    retraits.set(partie.id, precedent ? fusionner(precedent, retrait) : retrait);
    retraitsEnAttente.set(auteur.id, retraits);
  } catch (e) {
    console.error("[notifications] planning modifié : regroupement impossible", e);
  }
}

/** Les suppressions de cet auteur encore annonçables (et les retire de l'attente). */
function reprendreRetraits(auteurId: string, now = Date.now()): ChangementElement[] {
  const retraits = retraitsEnAttente.get(auteurId);
  retraitsEnAttente.delete(auteurId);
  return retraits ? [...retraits.values()].filter((c) => encoreAnnoncable(c, now)) : [];
}

/** « Annuler » : les suppressions de cet auteur ne seront pas annoncées. */
export function oublierRetraitsPlanning(auteurId: string): void {
  retraitsEnAttente.delete(auteurId);
}

/**
 * « Appliquer les modifications » **sans case à écrire** (que des suppressions) : ce qui attendait
 * pour cet auteur part maintenant, en un message. Ne lève jamais.
 */
export async function annoncerAttentePlanning(auteur: SignalementPlanning["auteur"]): Promise<number> {
  return signalerEcrituresPlanning(auteur, []);
}

function mettreEnAttente(auteur: SignalementPlanning["auteur"], changements: readonly ChangementElement[]): void {
  const nouveaux = changements.filter((c) => NATURES_ANNONCEES.includes(c.nature));
  if (nouveaux.length === 0) return;
  const attente = enAttente.get(auteur.id);
  if (attente) clearTimeout(attente.minuteur);
  const enCours = attente?.changements ?? new Map<string, ChangementElement>();
  for (const c of nouveaux) {
    const precedent = enCours.get(c.partieId);
    enCours.set(c.partieId, precedent ? fusionner(precedent, c) : c);
  }
  const minuteur = setTimeout(() => void envoyerAttente(auteur.id), DELAI_REGROUPEMENT_MS);
  minuteur.unref?.();
  enAttente.set(auteur.id, { auteur, changements: enCours, minuteur });
}

/** Retire et rend ce qui attend pour cet auteur, sans l'envoyer (le geste qui suit l'emporte). */
function reprendreAttente(auteurId: string): ChangementElement[] {
  const attente = enAttente.get(auteurId);
  if (!attente) return [];
  clearTimeout(attente.minuteur);
  enAttente.delete(auteurId);
  return [...attente.changements.values()];
}

/** Envoie ce qui attend pour cet auteur (ou pour tous) — appelé par le minuteur, et par les tests. */
export async function envoyerAttente(auteurId?: string): Promise<number> {
  const ids = auteurId ? [auteurId] : [...enAttente.keys()];
  let tentes = 0;
  for (const id of ids) {
    const attente = enAttente.get(id);
    if (!attente) continue;
    clearTimeout(attente.minuteur);
    enAttente.delete(id);
    tentes += await signalerModificationsPlanning({ auteur: attente.auteur, changements: [...attente.changements.values()] });
  }
  return tentes;
}
