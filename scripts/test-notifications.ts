/**
 * Envoie un exemplaire de **chaque notification** à une adresse, pour vérifier le rendu réel
 * (et la configuration SMTP). Sans SMTP, les messages sont écrits dans previews/emails/.
 *
 * Usage : npm run notif:test -- admin@exemple.fr [--fichier]
 * (`--fichier` écrit les messages dans previews/emails/ au lieu de les envoyer)
 *
 * **Une adresse autre que `ADMIN_EMAIL` demande `--vraiment-envoyer`**. Ce script accepte n'importe
 * quelle adresse et lui envoie onze messages par le serveur SMTP du club, dont un qui **imite une
 * alerte de sécurité du bureau** — et il désactive exprès le mode fichier pour envoyer pour de
 * vrai. Il faut déjà un shell et le `.env` pour s'en servir, donc ce n'est pas une porte ; mais une
 * adresse mal recopiée, ou l'idée de « montrer à quoi ça ressemble » à quelqu'un, envoie au nom du
 * club un message qui a l'air officiel. Le garde-fou n'empêche rien à qui sait ce qu'il fait : il
 * empêche de le faire sans y penser.
 */
import { baseUrl } from "../src/lib/env";
import { sendEmailNow } from "../src/lib/email/mailer";
import { emailInvitation, emailNouvelAppareil, emailReset } from "../src/lib/email/templates/auth";
import { emailAtelierStatut } from "../src/lib/email/templates/ateliers";
import { emailEffectifFaible, emailSeanceAnnulee } from "../src/lib/email/templates/seances";
import type { EmailContenu } from "../src/lib/email/templates/layout";
import { resoudreIdentite } from "../src/lib/identite";

// Cette commande sert justement à vérifier l'envoi réel : on ignore EMAIL_MODE_FICHIER
if (process.env.EMAIL_MODE_FICHIER === "1" && process.argv.includes("--fichier") === false) delete process.env.EMAIL_MODE_FICHIER;

const destinataireBrut = process.argv.slice(2).find((a) => !a.startsWith("--"));
if (!destinataireBrut?.includes("@")) {
  console.error("Usage : npm run notif:test -- <email> [--fichier] [--vraiment-envoyer]");
  process.exit(1);
}
const destinataire: string = destinataireBrut;
const adresseDuBureau = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
const versSoiMeme = destinataire.toLowerCase() === adresseDuBureau;
const enFichier = process.argv.includes("--fichier");
if (!versSoiMeme && !enFichier && !process.argv.includes("--vraiment-envoyer")) {
  console.error(`REFUS : ${destinataire} n'est pas l'adresse du bureau (ADMIN_EMAIL).`);
  console.error("        Ces messages partent par le serveur SMTP du club et portent son nom — dont une");
  console.error("        imitation d'alerte de sécurité. Relance avec --fichier pour seulement les écrire");
  console.error("        dans previews/emails/, ou avec --vraiment-envoyer si c'est bien ce que tu veux.");
  process.exit(1);
}

const PERIODE = "Rentrée 2026";
/**
 * Le nom de l'application pour ces messages d'essai.
 *
 * Lu dans l'**environnement** (`CLUB_NOM` / `CLUB_SIGLE`) et non en base : ce fichier construit ses
 * messages au chargement du module, avant toute connexion à la base. Pour un envoi d'essai, savoir
 * si l'en-tête dit « HEMA Organizer » ou « HEMA Organizer » n'est pas l'objet du test — ce qu'on
 * vérifie ici, c'est que le serveur SMTP accepte et délivre.
 */
const NOM_APP = resoudreIdentite(null, { club: process.env.CLUB_NOM, sigle: process.env.CLUB_SIGLE }).nomCourt;
const SEANCE = { date: "2026-09-25", heureDebut: "19:00", heureFin: "21:00", lieu: "Gymnase municipal, Villebourg" };
const LIEN = `${baseUrl()}/invitation/exemple-de-lien-personnel-0123456789abcdefghij`;

const MESSAGES: Array<{ ref: string; sujet: string; contenu: EmailContenu }> = [
  { ref: "test_lien_acces", ...emailInvitation({ prenom: "Delta", periodeNom: PERIODE, url: LIEN, nomApp: NOM_APP }) },
  { ref: "test_lien_renouvele", ...emailInvitation({ prenom: "Delta", periodeNom: PERIODE, url: LIEN, motif: "renouvellement", nomApp: NOM_APP }) },
  { ref: "test_lien_securite", ...emailInvitation({ prenom: "Delta", periodeNom: PERIODE, url: LIEN, motif: "securite", nomApp: NOM_APP }) },
  { ref: "test_lien_appareils", ...emailInvitation({ prenom: "Delta", periodeNom: PERIODE, url: LIEN, motif: "appareils", nomApp: NOM_APP }) },
  { ref: "test_nouvel_appareil", ...emailNouvelAppareil({ prenom: "Delta", appareil: "Chrome sur Android", ip: "203.0.113.42", quand: "22/09/2026 à 20:14", nomApp: NOM_APP }) },
  { ref: "test_mot_de_passe", ...emailReset({ prenom: "Delta", url: `${baseUrl()}/reinitialiser/exemple-de-jeton-de-reinitialisation`, nomApp: NOM_APP }) },
  { ref: "test_atelier_planifie", ...emailAtelierStatut({ prenom: "Delta", titre: "Échauffement à la corde", statut: "PLANIFIE", commentaire: "Parfait pour démarrer la séance.", seance: SEANCE }) },
  { ref: "test_atelier_refuse", ...emailAtelierStatut({ prenom: "Delta", titre: "Initiation au sabre laser", statut: "REFUSE", commentaire: "Hors du cadre AMHE, mais pourquoi pas pour la soirée de fin d'année !", seance: null }) },
  { ref: "test_effectif_faible", ...emailEffectifFaible({ prenom: "Delta", seance: SEANCE, presents: 2, invites: 12, sansReponse: 5, urlAnnulation: `${baseUrl()}/annuler/exemple-de-jeton-signe` }) },
  { ref: "test_seance_annulee", ...emailSeanceAnnulee({ prenom: "Delta", seance: SEANCE, motif: "Trop peu de participants", nomApp: NOM_APP }) },
  {
    ref: "test_alerte_securite",
    sujet: "⚠️ Lien personnel de chloe@exemple.fr révoqué (suspect)",
    contenu: {
      titre: "Alerte de sécurité",
      paragraphes: [
        "Le lien personnel de chloe@exemple.fr a été ouvert un nombre anormal de fois en une heure (robot ou lien diffusé). Il a été révoqué et un nouveau lien a été envoyé à la personne.",
        "Dernière ouverture depuis l'adresse 203.0.113.7.",
        `Journal d'audit : ${baseUrl()}/admin/audit`,
      ],
      boutons: [{ label: "Ouvrir le journal d'audit", url: `${baseUrl()}/admin/audit` }],
      piedDePage: ["Message automatique de HEMA Organizer. Les alertes se règlent dans Administration → Paramètres."],
    },
  },
];

async function main() {
  console.info(`Envoi de ${MESSAGES.length} notifications de test à ${destinataire}…`);
  for (const m of MESSAGES) {
    const res = await sendEmailNow({ to: destinataire, sujet: `[TEST] ${m.sujet}`, contenu: m.contenu, ref: m.ref });
    console.info(`  ${res.mode === "smtp" ? "envoyé" : "écrit"} — ${m.sujet}`);
  }
  console.info("Terminé.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
