import { libelleDuree, libellePrix } from "@/components/evenements/libelles";
import { filtrerAccesActif } from "@/lib/acces-actif";
import { db } from "@/lib/db";
import { formatDateLongue, formatHeure, formatHoraire } from "@/lib/dates";
import { baseUrl } from "@/lib/env";
import { enqueueEmail } from "@/lib/email/mailer";
import { enqueueEmailListe, messageCollectif } from "@/lib/email/liste";
import type { EmailContenu } from "@/lib/email/templates/layout";
import { evenementTermine } from "@/lib/evenements";
import { identite } from "@/lib/identite";
import { aUnEmail } from "@/lib/membres";
import { personnesDuClub } from "@/lib/permissions";
import { envoiPossible } from "./canaux";
import { TITRE_EVENEMENT } from "./contenu";
import { COULEUR_BLEU, COULEUR_ROUGE, editerMessageDiscord, posterEtRetenirId, type DiscordEmbed } from "./discord";
import { clesDejaEnvoyees, journaliser, marquerEchec, notifierParPush, pushPossible } from "./journal";
import { adresseListePour, destinataireRetenu, envoiCollectifDans, getPreferencesNotifications, type PreferencesNotifications } from "./preferences";
import type { ChargePush } from "./push";
import { publierSurTelegram } from "./salon";
import { salonPour } from "./webhooks";

/**
 * **Annonce d'un nouvel événement** (stage, tournoi, démonstration).
 *
 * Elle part quand une annonce est **publiée** — à la création si elle naît publiée, ou au moment où un
 * brouillon passe en publié — aux membres des **périodes actives**, par email, sur les appareils et
 * sur les salons Discord et Telegram.
 *
 * **Publier n'est pas enregistrer.** `notifierNouvelEvenement` ne doit être appelée qu'au moment où
 * l'annonce *devient* publique (voir `src/actions/evenements.ts`, qui compare l'état d'avant à celui
 * d'après) ; toute autre écriture passe par `synchroniserAnnonceDiscord`. La déduplication par
 * identifiant d'événement ne suffisait pas à tenir cette règle : elle ne protège qu'un canal qui
 * existait déjà au moment de la publication. Telegram, arrivé en v0.51, n'avait aucune clé
 * `evenement_telegram_<id>` pour les annonces d'avant — la première correction de faute de frappe les
 * annonçait comme neuves au groupe. Même piège sur Discord quand `discordMessageId` est nul.
 *
 * Trois garde-fous, dans cet ordre :
 *
 * 1. `envoiPossible("evenement_nouveau", canal)` — le réglage du club (matrice de
 *    `/admin/notifications`) et l'état réel du canal ;
 * 2. `destinataireRetenu(...)` — le choix de chacun : qui a refusé « Nouvel événement » dans son
 *    profil n'en reçoit pas (voir `preferences.ts`, règle de composition) ;
 * 3. `NotificationLog.dedupKey` — **jamais deux fois pour le même événement** : les clés ne portent
 *    que l'identifiant de l'événement (`evenement_email_<id>_<userId>`, `evenement_discord_<id>`),
 *    sans horodatage. Dépublier puis republier une annonce ne la réannonce donc pas.
 *
 * Le contenu (nom, date en toutes lettres, horaire, lieu, organisateur, lien vers l'app) est écrit
 * **une fois** dans `lignesEvenement`, et rendu par les deux gabarits existants : `EmailContenu`
 * (mise en page commune des emails) et l'embed Discord posté par `posterDiscord`.
 *
 * Cette fonction ne lève jamais : une annonce ratée ne doit pas faire échouer la création de
 * l'événement (voir `notifierNouvelEvenement`).
 */

/** Type écrit dans `NotificationLog.type`. */
export const TYPE_EVENEMENT = "EVENEMENT";

/*
 * Le titre de l'annonce vit dans `contenu.ts` avec les trois autres (« Cours de demain »,
 * « Cours annulé », « Peu de monde annoncé ») : il sert désormais aussi au **site du club**
 * (`GET /api/public/annonces`), qui ne doit pas charger ce module-ci pour l'obtenir.
 */

/**
 * Ce qu'il faut d'un événement pour l'annoncer.
 *
 * Les champs facultatifs sont ceux que le salon Discord **tient à jour** : ils n'existaient pas
 * quand l'annonce ne partait qu'une fois, et un appelant qui ne les fournit pas (un test, une
 * vieille lecture) obtient simplement une annonce plus courte, jamais une erreur.
 */
export type EvenementAnnonce = {
  id: string;
  nom: string;
  /** "AAAA-MM-JJ" */
  dateDebut: string;
  /** "HH:MM" ou null (journée entière) */
  heureDebut: string | null;
  dateFin: string | null;
  heureFin: string | null;
  lieu: string;
  /** Qui organise ; "" = non précisé */
  organisateur: string;
  description?: string | null;
  /** Texte libre ; vide = gratuit, et c'est `libellePrix` qui l'écrit */
  prix?: string | null;
  prixAdherent?: string | null;
  dureeNombre?: number | null;
  dureeUnite?: string | null;
  lienInscription?: string | null;
  /** Affiche : chemin interne (`/api/affiche/…`) ou URL complète */
  imageUrl?: string | null;
};

/** L'annonce **plus** son état sur le salon : de quoi décider entre poster, éditer et retirer. */
export type EvenementSalon = EvenementAnnonce & {
  publie: boolean;
  /** Identifiant du message déjà posté ; null = rien sur le salon */
  discordMessageId: string | null;
};

/** Colonnes lues pour annoncer et pour tenir l'annonce à jour (une seule liste, jamais deux). */
const COLONNES_ANNONCE = {
  id: true,
  nom: true,
  description: true,
  dateDebut: true,
  heureDebut: true,
  dateFin: true,
  heureFin: true,
  lieu: true,
  organisateur: true,
  prix: true,
  prixAdherent: true,
  dureeNombre: true,
  dureeUnite: true,
  lienInscription: true,
  imageUrl: true,
  publie: true,
  discordMessageId: true,
} as const;

export function cleEvenementEmail(evenementId: string, userId: string): string {
  return `evenement_email_${evenementId}_${userId}`;
}

export function cleEvenementDiscord(evenementId: string): string {
  return `evenement_discord_${evenementId}`;
}

/**
 * Clé de l'annonce envoyée **à la liste** : pas d'identifiant de personne, une ligne de journal pour
 * toute l'annonce. Espace de clés distinct de `evenement_email_…` (voir `journal.ts`).
 */
export function cleEvenementListe(evenementId: string): string {
  return `evenement_liste_${evenementId}`;
}

/** Clé de l'annonce sur le téléphone : le canal fait partie de la clé, l'email et le push sont indépendants. */
export function cleEvenementPush(evenementId: string, userId: string): string {
  return `evenement_push_${evenementId}_${userId}`;
}

/** La page de l'événement dans l'application. */
export function urlEvenement(evenementId: string): string {
  return `${baseUrl()}/evenements/${evenementId}`;
}

/** "Samedi 10 octobre 2026" → "samedi 10 octobre 2026" (au milieu d'une phrase). */
function enMinuscule(texte: string): string {
  return texte.replace(/^./, (c) => c.toLowerCase());
}

/**
 * Le « quand », en toutes lettres : un seul jour avec son horaire, ou « du … au … » pour un
 * événement qui dure. Un événement sans horaire occupe sa journée entière.
 */
export function quandEvenement(e: EvenementAnnonce): string {
  const finAutreJour = e.dateFin !== null && e.dateFin !== e.dateDebut;
  if (finAutreJour) {
    const debut = `${enMinuscule(formatDateLongue(e.dateDebut))}${e.heureDebut ? ` à ${formatHeure(e.heureDebut)}` : ""}`;
    const fin = `${enMinuscule(formatDateLongue(e.dateFin as string))}${e.heureFin ? ` à ${formatHeure(e.heureFin)}` : ""}`;
    return `Du ${debut} au ${fin}`;
  }
  const jour = formatDateLongue(e.dateDebut);
  if (e.heureDebut && e.heureFin) return `${jour} — ${formatHoraire(e.heureDebut, e.heureFin)}`;
  if (e.heureDebut) return `${jour} — à partir de ${formatHeure(e.heureDebut)}`;
  return `${jour} — toute la journée`;
}

/**
 * Le contenu commun de l'annonce, sans le titre : quand, combien de temps, où, qui organise, à quel
 * prix. Une seule mise en forme, partagée par l'email et par l'embed Discord.
 *
 * La durée ne s'écrit que si elle est renseignée (« non précisée » n'apprend rien), le tarif
 * **toujours** : un prix vide veut dire gratuit, et c'est justement ce qu'on vient vérifier avant de
 * s'inscrire. Mêmes règles que les pages de partage (`libellePrix` / `libelleDuree`, une seule
 * formulation dans toute l'application).
 */
export function lignesEvenement(e: EvenementAnnonce): string[] {
  const duree = libelleDuree(e.dureeNombre, e.dureeUnite);
  return [
    `📅 ${quandEvenement(e)}`,
    ...(duree ? [`⏳ Durée : ${duree}`] : []),
    ...(e.lieu.trim() ? [`📍 ${e.lieu.trim()}`] : []),
    ...(e.organisateur.trim() ? [`🛡️ Organisé par ${e.organisateur.trim()}`] : []),
    `🏷️ ${libellePrix(e.prix, e.prixAdherent)}`,
  ];
}

/** Longueur de l'extrait de description repris dans l'embed (une annonce, pas un dossier). */
export const EXTRAIT_DESCRIPTION_MAX = 400;

/**
 * L'affiche, en adresse **absolue** : Discord va la chercher depuis ses propres serveurs, un chemin
 * interne (`/api/affiche/…`) n'y voudrait rien dire. Une adresse qui n'est ni interne ni http(s)
 * est écartée plutôt que postée telle quelle.
 */
function urlAffiche(imageUrl?: string | null): string | undefined {
  const src = imageUrl?.trim();
  if (!src) return undefined;
  if (src.startsWith("/")) return `${baseUrl()}${src}`;
  return /^https?:\/\//i.test(src) ? src : undefined;
}

/**
 * L'annonce sur le salon Discord (embed aux couleurs de la charte, comme le récap et l'annulation).
 *
 * C'est **le même embed à la publication et à chaque correction** : l'édition d'un message Discord
 * remplace son contenu, donc tout ce qui doit rester juste (date, lieu, prix, description, affiche)
 * se construit ici, et nulle part ailleurs.
 */
export function embedNouvelEvenement(e: EvenementAnnonce, nomClub: string): DiscordEmbed {
  const extrait = (e.description ?? "").replace(/\s+/g, " ").trim().slice(0, EXTRAIT_DESCRIPTION_MAX);
  const affiche = urlAffiche(e.imageUrl);
  const inscription = e.lienInscription?.trim();
  return {
    title: `${TITRE_EVENEMENT} — ${e.nom}`,
    url: urlEvenement(e.id),
    description: [
      ...lignesEvenement(e),
      ...(extrait ? ["", extrait] : []),
      ...(inscription ? ["", `📝 Inscription : ${inscription}`] : []),
      "",
      `👉 Les détails dans l'app : ${urlEvenement(e.id)}`,
    ].join("\n"),
    color: COULEUR_BLEU,
    ...(affiche ? { image: { url: affiche } } : {}),
    footer: { text: nomClub },
  };
}

/**
 * Le même message, **corrigé** quand l'annonce disparaît de l'application (dépubliée ou supprimée).
 *
 * Choix assumé : on **édite** le message plutôt que de l'effacer. Un message déjà lu ne se dé-lit
 * pas — l'effacer laisserait tous ceux qui l'ont vu passer croire que le stage tient toujours, et
 * ferait disparaître le fil de discussion qui s'est accroché dessous. Édité, il corrige
 * l'information **à l'endroit exact** où elle a été lue.
 *
 * Les lignes de l'annonce sont gardées, barrées : on veut pouvoir reconnaître de quoi il s'agissait.
 * L'affiche, elle, part — une image en grand continue d'annoncer, quoi que dise le texte.
 */
export function embedEvenementRetire(e: EvenementAnnonce, nomClub: string): DiscordEmbed {
  return {
    title: `❌ Annulé — ${e.nom}`,
    description: ["Cette annonce a été retirée : l'événement ne figure plus au programme du club.", "", ...lignesEvenement(e).map((l) => `~~${l}~~`)].join("\n"),
    color: COULEUR_ROUGE,
    footer: { text: nomClub },
  };
}

/** L'annonce par email, dans le gabarit commun (`renderEmailHtml`). Court : l'essentiel et le lien. */
export function emailNouvelEvenement(args: { prenom: string; evenement: EvenementAnnonce; nomApp: string }): { sujet: string; contenu: EmailContenu } {
  const e = args.evenement;
  return {
    sujet: `${TITRE_EVENEMENT} : ${e.nom}`,
    contenu: {
      titre: `Bonjour ${args.prenom},`,
      paragraphes: [`Le club annonce un nouvel événement : « ${e.nom} ».`, lignesEvenement(e).join("\n")],
      boutons: [{ label: "Voir l'événement", url: urlEvenement(e.id) }],
      piedDePage: [
        `Message automatique de ${args.nomApp}.`,
        `Tu choisis les messages que tu reçois dans « Mon profil » : ${baseUrl()}/profil`,
      ],
    },
  };
}

/**
 * La même annonce, **en un seul message** pour la liste du club : ni prénom, ni renvoi vers « Mon
 * profil » (le profil ne règle que ce qui part nominativement — sur la liste, c'est le serveur mail
 * du club qui gère les départs).
 */
export function emailNouvelEvenementListe(args: { evenement: EvenementAnnonce; nomApp: string }): { sujet: string; contenu: EmailContenu } {
  const e = args.evenement;
  return {
    sujet: `${TITRE_EVENEMENT} : ${e.nom}`,
    contenu: {
      titre: e.nom,
      paragraphes: [`Le club annonce un nouvel événement : « ${e.nom} ».`, lignesEvenement(e).join("\n")],
      boutons: [{ label: "Voir l'événement", url: urlEvenement(e.id) }],
      piedDePage: [
        `Message automatique envoyé à la liste du club par ${args.nomApp}.`,
        "Pour ne plus recevoir les messages de la liste, demande au bureau de t'en retirer.",
      ],
    },
  };
}

/**
 * L'annonce sur le téléphone : un titre neutre et sans emoji, le nom et la date dans le corps, et
 * l'appui ouvre la page de l'événement (chemin de l'application, le service worker l'ouvre tel quel).
 */
export function chargeEvenementPush(e: EvenementAnnonce): ChargePush {
  return {
    titre: "Nouvel événement",
    corps: `${e.nom} — ${quandEvenement(e)}`,
    url: `/evenements/${e.id}`,
    tag: `evenement-${e.id}`,
  };
}

/* ─────────────────── Le salon Discord reste à jour (et pas seulement prévenu) ───────────────────
 *
 * Une annonce de club vit : la date bouge, le prix se précise, l'affiche arrive trois jours après,
 * et parfois le stage est annulé. Poster un message de plus à chaque correction transformerait le
 * salon en fil de rectificatifs, où le dernier message à jour est noyé sous les précédents.
 *
 * D'où la **synchronisation** : un événement publié possède **un** message sur le salon, dont
 * l'identifiant est rangé dans `Evenement.discordMessageId` (le webhook est appelé avec
 * `?wait=true`, ce qui fait répondre Discord par le message créé).
 *
 * | Ce qui arrive à l'annonce | Ce qui arrive au message |
 * |---|---|
 * | publiée (création, ou brouillon publié) | posté, son identifiant est rangé |
 * | corrigée (date, lieu, prix, description, affiche…) | **édité** sur place |
 * | dépubliée, ou supprimée | **édité** en « ❌ Annulé » (on n'efface pas, voir `embedEvenementRetire`) |
 * | message effacé à la main sur le salon (404) | identifiant oublié, annonce **reposée** proprement |
 * | passée | laissée telle quelle : le passé ne se corrige plus |
 *
 * Deux règles de garde, volontairement différentes :
 * - **poster** exige l'accord du club (`envoiPossible`, la matrice de `/admin/notifications`) ;
 * - **éditer ou retirer** ne l'exige pas. Un message déjà posté doit rester vrai, même si le club a
 *   entre-temps décoché « Nouvel événement » : décocher une case arrête les annonces à venir, ça
 *   n'autorise pas à laisser le salon mentir sur celles qui sont parties.
 *
 * Et comme partout ailleurs ici, **rien ne lève** : Discord en panne, salon supprimé, webhook
 * révoqué — l'événement s'enregistre quand même, l'échec part au journal et sera rejoué.
 */

/** Ce que la synchronisation a réellement fait, pour les journaux et les tests. */
export type IssueSalon = "poste" | "edite" | "repose" | "retire" | "rien";

/**
 * **Point d'entrée de la synchronisation** — à appeler après toute écriture sur un événement qui
 * n'est *pas* une publication (correction d'une annonce déjà publique, dépublication, suppression).
 * Relit l'annonce et met le salon en accord avec elle.
 *
 * Elle **ne pose jamais une première annonce** : corriger une faute de frappe n'est pas publier. Voir
 * `appliquerSurSalon` — c'est cette distinction qui a fait annoncer comme neufs, sur Telegram et sur
 * Discord, des événements publiés bien avant que le canal existe.
 */
export async function synchroniserAnnonceDiscord(evenementId: string, now = new Date()): Promise<IssueSalon> {
  try {
    const e = await db.evenement.findUnique({ where: { id: evenementId }, select: COLONNES_ANNONCE });
    if (!e) return "rien";
    return await appliquerSurSalon(e, now, false);
  } catch (erreur) {
    console.error("[notifications] synchronisation du salon : échec non bloquant", erreur);
    return "rien";
  }
}

/**
 * **Suppression d'un événement** : la ligne n'existe plus, on travaille donc sur ce que
 * `db.evenement.delete` vient de rendre. Même geste que la dépublication — le message est barré.
 */
export async function retirerAnnonceDiscord(e: EvenementSalon, now = new Date()): Promise<IssueSalon> {
  try {
    // Rien à corriger : jamais annoncé, ou déjà passé (le ménage des vieilles annonces efface des
    // événements terminés depuis six mois — les marquer « annulés » serait un contresens).
    if (!e.discordMessageId || evenementTermine(e, now)) return "rien";
    const { url } = await salonPour("evenement_nouveau");
    if (!url) return "rien";
    return await retirerDuSalon(url, e, now, false);
  } catch (erreur) {
    console.error("[notifications] retrait de l'annonce du salon : échec non bloquant", erreur);
    return "rien";
  }
}

/**
 * Le cœur de la décision, sur un événement déjà lu (voir le tableau ci-dessus).
 *
 * `premiereAnnonce` dit si l'on arrive par une **publication** (l'annonce vient de devenir publique)
 * ou par une simple écriture. Une écriture ne peut qu'**éditer** ou **barrer** un message existant :
 * elle ne pose jamais le premier. Sans cette distinction, un événement publié avant que le salon soit
 * branché — il n'a donc aucun message et aucune clé de journal — se faisait annoncer comme neuf à la
 * première correction de faute de frappe, des semaines plus tard.
 */
async function appliquerSurSalon(e: EvenementSalon, now: Date, premiereAnnonce: boolean): Promise<IssueSalon> {
  const { url } = await salonPour("evenement_nouveau");
  if (!url) return "rien";
  // Un événement passé se laisse tranquille : personne ne relit une annonce d'hier, et la corriger
  // ne ferait que remonter le message. On ne le retire pas non plus — il a eu lieu.
  if (evenementTermine(e, now)) return "rien";
  if (!e.publie) return e.discordMessageId ? retirerDuSalon(url, e, now, true) : "rien";
  if (e.discordMessageId) return mettreAJourSurSalon(url, e, now);
  // Rien sur le salon et ce n'est pas une publication : on ne rattrape pas, on se tait.
  if (!premiereAnnonce) return "rien";
  // Première annonce : c'est le seul cas où le réglage du club a son mot à dire.
  if (!(await envoiPossible("evenement_nouveau", "discord"))) return "rien";
  return posterSurSalon(url, e, now);
}

/**
 * Premier message. La clé de journal est posée **avant** l'envoi, comme pour l'email : deux
 * enregistrements simultanés ne peuvent pas poster deux annonces. Un échec la libère (clé d'échec
 * horodatée), donc le prochain enregistrement réessaiera.
 */
async function posterSurSalon(url: string, e: EvenementSalon, now: Date): Promise<IssueSalon> {
  const cle = cleEvenementDiscord(e.id);
  if (!(await journaliser({ type: TYPE_EVENEMENT, canal: "DISCORD", dedupKey: cle, statut: "ENVOYE" }))) return "rien";
  try {
    const club = await identite();
    const messageId = await posterEtRetenirId(url, embedNouvelEvenement(e, club.nomClub));
    await db.evenement.update({ where: { id: e.id }, data: { discordMessageId: messageId } });
    return "poste";
  } catch (erreur) {
    await marquerEchec(cle, erreur instanceof Error ? erreur.message : String(erreur), now);
    return "rien";
  }
}

/** Correction d'une annonce déjà postée, avec reprise si le message a disparu du salon. */
async function mettreAJourSurSalon(url: string, e: EvenementSalon, now: Date): Promise<IssueSalon> {
  let issue;
  try {
    const club = await identite();
    issue = await editerMessageDiscord(url, e.discordMessageId as string, embedNouvelEvenement(e, club.nomClub));
  } catch (erreur) {
    // Discord en panne : le salon garde la version précédente, qui reste une annonce valable.
    // Le prochain enregistrement réessaiera — on ne repose surtout pas un second message ici.
    console.error("[notifications] édition de l'annonce sur le salon : échec non bloquant", erreur);
    return "rien";
  }
  if (issue === "edite") return "edite";
  // 404 : quelqu'un a effacé le message à la main. Ce n'est pas une panne — on oublie l'identifiant
  // et on repose une annonce propre, plutôt que de laisser le salon muet pour toujours.
  await oublierAnnonce(e.id, "message introuvable sur le salon (404)", now, true);
  return (await posterSurSalon(url, { ...e, discordMessageId: null }, now)) === "poste" ? "repose" : "rien";
}

/** Barre le message (« ❌ Annulé ») et oublie son identifiant. */
async function retirerDuSalon(url: string, e: EvenementSalon, now: Date, ligneEnBase: boolean): Promise<IssueSalon> {
  try {
    // Un 404 n'est pas un échec : le message a été effacé à la main, le salon n'annonce déjà plus rien.
    const club = await identite();
    await editerMessageDiscord(url, e.discordMessageId as string, embedEvenementRetire(e, club.nomClub));
  } catch (erreur) {
    console.error("[notifications] retrait de l'annonce du salon : échec non bloquant", erreur);
    return "rien";
  }
  await oublierAnnonce(e.id, "annonce retirée du salon", now, ligneEnBase);
  return "retire";
}

/**
 * On ne sait plus rien du message : colonne vidée **et** clé de journal libérée.
 *
 * Les deux vont ensemble. Sans la colonne, une correction éditerait un message effacé ; sans la
 * clé, la dédup interdirait à jamais une nouvelle annonce pour cet événement. Et c'est bien un
 * **nouveau** message qu'on veut le jour où l'annonce revient : réécrire l'ancien, enfoui dans
 * l'historique du salon, ne préviendrait personne.
 */
async function oublierAnnonce(evenementId: string, raison: string, now: Date, ligneEnBase: boolean): Promise<void> {
  if (ligneEnBase) {
    try {
      await db.evenement.update({ where: { id: evenementId }, data: { discordMessageId: null } });
    } catch (erreur) {
      console.error("[notifications] identifiant de message non effacé", erreur);
    }
  }
  try {
    const cle = cleEvenementDiscord(evenementId);
    await db.notificationLog.update({
      where: { dedupKey: cle },
      data: { dedupKey: `${cle}_retire_${now.getTime()}`, statut: "IGNORE", erreur: raison.slice(0, 500) },
    });
  } catch {
    // Aucune ligne à libérer (annonce jamais journalisée, ou déjà libérée) : il n'y a rien à faire.
  }
}

/**
 * **L'annonce d'un événement sur Telegram : une fois, et c'est tout.**
 *
 * Le salon Discord est *synchronisé* — le message posté est ensuite corrigé quand l'annonce change,
 * grâce à `Evenement.discordMessageId`. Telegram, ici, ne fait qu'**annoncer** : une clé de
 * déduplication par événement (`evenement_telegram_<id>`), et rien de plus.
 *
 * La clé ne suffit pas à elle seule : elle n'existe que pour les événements publiés **depuis** que ce
 * canal existe. C'est l'appelant qui tient la règle — une annonce ne part qu'à la publication.
 *
 * **Pourquoi ne pas faire pareil que Discord.** Suivre les corrections demanderait une colonne de
 * plus en base (l'identifiant du message Telegram) et un second chemin d'édition à tenir. Or ce que
 * fait un groupe Telegram d'une annonce, c'est la lire le jour où elle tombe : une date corrigée
 * trois jours plus tard se dit dans le groupe, par quelqu'un, mieux qu'un message réécrit en silence.
 * Le jour où ça manquera vraiment, la colonne s'ajoutera — le contenu, lui, est déjà partagé.
 */
async function annoncerSurTelegram(e: EvenementAnnonce, now: Date): Promise<boolean> {
  if (!(await envoiPossible("evenement_nouveau", "telegram"))) return false;
  const club = await identite();
  return publierSurTelegram({
    type: "EVENEMENT",
    notification: "evenement_nouveau",
    dedupKey: `evenement_telegram_${e.id}`,
    embed: embedNouvelEvenement(e, club.nomClub),
    now,
  });
}

export type BilanEvenement = { emails: number; discord: boolean; telegram: boolean };

/**
 * **Point d'entrée de l'annonce** — à appeler **au moment où l'événement devient public**, et à ce
 * moment-là seulement : création d'une annonce déjà publiée, ou brouillon qui passe en publié. Pas à
 * chaque enregistrement (c'est `synchroniserAnnonceDiscord` qui suit les corrections), sans quoi un
 * canal branché après coup reçoit une « nouveauté » qui ne l'est pas.
 *
 * Ne lève jamais et ne bloque rien : elle retourne ce qui est réellement parti.
 *
 * Elle relit l'événement en base plutôt que de le recevoir en argument : l'appelant n'a qu'un
 * identifiant à fournir, et un brouillon (ou un événement déjà passé) est écarté ici, une fois pour
 * toutes.
 */
export async function notifierNouvelEvenement(evenementId: string, now = new Date()): Promise<BilanEvenement> {
  const bilan: BilanEvenement = { emails: 0, discord: false, telegram: false };
  try {
    const [parEmail, parPush] = await Promise.all([envoiPossible("evenement_nouveau", "email"), pushPossible("evenement_nouveau")]);
    const e = await db.evenement.findUnique({ where: { id: evenementId }, select: COLONNES_ANNONCE });
    // Un brouillon ne s'annonce pas, et on ne réveille personne pour un événement déjà passé.
    if (!e || !e.publie || evenementTermine(e, now)) return bilan;
    if (parEmail || parPush) {
      // Une seule lecture des membres et des réglages pour les deux canaux personnels.
      const prefs = await getPreferencesNotifications();
      const membres = await membresDesPeriodesActives(now);
      // « La liste » : un message au lieu de N. Le compte rendu (`emails`) compte les **messages**.
      if (parEmail) bilan.emails = envoiCollectifDans(prefs, "evenement_nouveau") ? await annoncerSurListe(e, prefs) : await annoncerParEmail(e, prefs, membres);
      if (parPush) await annoncerParPush(e, prefs, membres);
    }
    // Le salon n'est pas un envoi de plus, c'est une **synchronisation** : le message est posté s'il
    // n'existe pas encore, et mis à jour s'il existe déjà. `discord` ne dit donc que ce qui est
    // parti de neuf sur le salon — une correction n'est pas une nouvelle annonce.
    const issue = await appliquerSurSalon(e, now, true);
    bilan.discord = issue === "poste" || issue === "repose";
    bilan.telegram = await annoncerSurTelegram(e, now);
    return bilan;
  } catch (erreur) {
    // Base indisponible, réglages illisibles… : l'événement est créé, l'annonce attendra.
    console.error("[notifications] annonce d'événement : échec non bloquant", erreur);
    return bilan;
  }
}

/** Ce qu'il faut de chaque personne pour décider si l'annonce lui part, sur l'un ou l'autre canal. */
type MembreAnnonce = {
  id: string;
  prenom: string;
  email: string | null;
  actif: boolean;
  rappelEmail: boolean;
  preferencesNotifications: string | null;
  service: boolean;
};

/**
 * Les membres invités sur au moins une période **active** — le compte de service du portail n'est
 * pas une personne du club (`personnesDuClub` en ceinture et bretelles) — et qui ont un **accès
 * actif** (src/lib/acces-actif.ts) : on n'annonce rien à qui ne peut pas entrer. Chargés **une fois**
 * pour l'email et pour le push.
 */
async function membresDesPeriodesActives(now: Date): Promise<MembreAnnonce[]> {
  const membres = await db.user.findMany({
    where: { actif: true, service: false, periodes: { some: { period: { statut: "ACTIVE" } } } },
    select: { id: true, prenom: true, email: true, actif: true, rappelEmail: true, preferencesNotifications: true, service: true },
    orderBy: { prenom: "asc" },
  });
  return filtrerAccesActif(personnesDuClub(membres), now);
}

/**
 * Un email par membre d'une période **active** qui l'accepte encore, jamais deux fois le même
 * (événement × personne). Les personnes sans adresse sont écartées en silence.
 */
async function annoncerParEmail(e: EvenementAnnonce, prefs: PreferencesNotifications, membres: readonly MembreAnnonce[]): Promise<number> {
  const destinataires = membres.filter((u): u is MembreAnnonce & { email: string } => aUnEmail(u) && destinataireRetenu(prefs, "evenement_nouveau", "email", u));
  if (destinataires.length === 0) return 0;
  const deja = await clesDejaEnvoyees(destinataires.map((u) => cleEvenementEmail(e.id, u.id)));
  // Lu une fois pour tout l'envoi : le pied de page nomme l'application, pas le club.
  const club = await identite();
  let envoyes = 0;
  for (const u of destinataires) {
    const cle = cleEvenementEmail(e.id, u.id);
    if (deja.has(cle)) continue;
    // La clé est posée AVANT l'envoi : deux publications simultanées ne peuvent pas doubler l'email.
    if (!(await journaliser({ type: TYPE_EVENEMENT, canal: "EMAIL", userId: u.id, dedupKey: cle, statut: "ENVOYE" }))) continue;
    const { sujet, contenu } = emailNouvelEvenement({ prenom: u.prenom, evenement: e, nomApp: club.nomCourt });
    enqueueEmail({ to: u.email, sujet, contenu, ref: cle }, (err) => {
      if (err) void marquerEchec(cle, err.message);
    });
    envoyes++;
  }
  return envoyes;
}

/**
 * L'annonce **en un seul message**, sur l'adresse de liste du club. Les refus personnels ne
 * s'appliquent plus (l'application ne sait pas qui lit la liste) : c'est le prix assumé du réglage,
 * dit à l'écran — et le canal téléphone, lui, reste personnel et respecte toujours les choix.
 */
async function annoncerSurListe(e: EvenementAnnonce, prefs: PreferencesNotifications): Promise<number> {
  const adresse = adresseListePour(prefs, "evenement_nouveau");
  if (adresse === null) return 0;
  const cle = cleEvenementListe(e.id);
  const club = await identite();
  // Le message d'abord, la clé ensuite : `messageCollectif` lève, et une clé posée avant la levée
  // éteindrait l'annonce pour toujours (voir `envoyerRecapListe`, qui l'explique en détail).
  const message = messageCollectif(emailNouvelEvenementListe({ evenement: e, nomApp: club.nomCourt }));
  if (!(await journaliser({ type: TYPE_EVENEMENT, canal: "EMAIL", userId: null, dedupKey: cle, statut: "ENVOYE" }))) return 0;
  enqueueEmailListe(adresse, message, cle, (err) => {
    if (err) void marquerEchec(cle, err.message);
  });
  return 1;
}

/**
 * La même annonce sur les appareils, aux mêmes membres — jugés cette fois sur le canal `push`, et
 * sans condition d'adresse email : quelqu'un qui n'a donné qu'un téléphone est prévenu par là.
 */
async function annoncerParPush(e: EvenementAnnonce, prefs: PreferencesNotifications, membres: readonly MembreAnnonce[]): Promise<number> {
  return notifierParPush({
    type: TYPE_EVENEMENT,
    destinataires: membres.filter((u) => destinataireRetenu(prefs, "evenement_nouveau", "push", u)),
    cle: (u) => cleEvenementPush(e.id, u.id),
    charge: () => chargeEvenementPush(e),
  });
}
