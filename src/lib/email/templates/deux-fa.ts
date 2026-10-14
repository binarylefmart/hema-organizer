import { baseUrl } from "@/lib/env";
import type { EmailContenu } from "./layout";

/**
 * **« Peux-tu réinitialiser ma double authentification ? »** — l'email reçu par le bureau quand
 * quelqu'un appuie sur « Demander la réinitialisation de ma double authentification » dans
 * « Mon profil » (téléphone perdu, plus d'accès à l'espace admin).
 *
 * Il nomme la personne (c'est un email, pas un écran verrouillé : la notification du téléphone, elle,
 * ne nomme personne — `src/lib/notifications/securite.ts`) et mène à **Comptes admin**, où sa ligne
 * porte la demande en attente et le bouton « Réinitialiser ».
 *
 * **Il demande de vérifier avant d'agir** : la demande part d'une session ouverte, et une session se
 * vole (lien personnel laissé sur un appareil prêté). Réinitialiser le second facteur de quelqu'un sur
 * la seule foi d'un clic, c'est laisser son compte à un seul facteur — le bureau confirme d'abord avec
 * la personne, de vive voix.
 *
 * **Le compte du portail a sa variante** : personne d'autre que lui ne réinitialise sa double
 * authentification depuis l'application. L'email le dit, et donne la sortie de secours — la commande
 * à lancer sur le serveur.
 */
export function emailDemandeReinitialisationDeuxFa(args: {
  prenomDestinataire: string;
  demandeur: { prenom: string; nom: string; email: string | null };
  /** La personne qui demande est le compte du portail : la réinitialisation ne se fait pas depuis l'écran. */
  portail: boolean;
  /**
   * La personne n'est pas du bureau : sa double authentification date d'avant et n'a plus d'effet.
   * Elle se **retire** depuis la carte « Double authentification hors du bureau » de Comptes admin.
   */
  horsBureau?: boolean;
  /**
   * Son mot de passe a été réinitialisé (« mot de passe oublié ») peu avant la demande : c'est ce
   * que ferait quelqu'un qui tient sa boîte email. Le bureau doit le savoir avant de vérifier.
   */
  motDePasseReinitialiseLe?: string | null;
  nomApp: string;
}): { sujet: string; contenu: EmailContenu } {
  const qui = `${args.demandeur.prenom} ${args.demandeur.nom}`.trim();
  const adresse = args.demandeur.email ? ` (${args.demandeur.email})` : "";
  const url = `${baseUrl()}/admin/comptes`;
  const paragraphes = args.portail
    ? [
        `Le compte du portail${adresse} demande la réinitialisation de sa double authentification sur ${args.nomApp} : il n'a plus accès à son application de codes.`,
        "Aucun autre administrateur ne peut la réinitialiser depuis l'application : c'est le compte qui ouvre l'administration, lui seul la remet à zéro.",
        `S'il ne peut plus entrer du tout (ni code, ni code de secours), la sortie est sur le serveur : npm run admin:reset-2fa -- ${args.demandeur.email ?? "<adresse du compte>"} --confirmer`,
        "Vérifie d'abord, de vive voix, que la demande vient bien de qui tient ce compte. Après la réinitialisation, un nouveau QR code lui sera demandé à sa prochaine connexion.",
      ]
    : args.horsBureau
      ? [
          `${qui}${adresse} demande le retrait de sa double authentification sur ${args.nomApp}. Elle date d'avant et n'a plus aucun effet sur sa connexion.`,
          "Dans l'espace admin, ouvre « Comptes admin » : la carte « Double authentification hors du bureau » porte son nom, la demande et le bouton « Retirer ». Sa connexion ne change pas.",
        ]
      : [
          `${qui}${adresse} demande la réinitialisation de sa double authentification sur ${args.nomApp} : son application de codes n'est plus accessible (téléphone perdu ou changé).`,
          `Avant d'agir, vérifie avec ${args.demandeur.prenom}, de vive voix, que la demande vient bien de lui ou d'elle : réinitialiser laisse son compte à un seul facteur jusqu'à ce qu'il soit réglé de nouveau.`,
          "Ensuite, dans l'espace admin, ouvre « Comptes admin » et appuie sur « Réinitialiser » sur sa ligne (la demande y est signalée). Ses sessions seront fermées et un nouveau QR code lui sera demandé à sa prochaine connexion.",
        ];
  // Le signal qui compte pour la vérification, en tête : une boîte email piratée suffit à réinitialiser
  // un mot de passe, puis à demander ceci. Rien à dire pour une 2FA d'avant, sans effet.
  if (args.motDePasseReinitialiseLe && !args.horsBureau)
    paragraphes.unshift(
      `⚠️ Attention : le mot de passe de ce compte a été réinitialisé par « mot de passe oublié » le ${args.motDePasseReinitialiseLe}. C'est ce que ferait quelqu'un qui a pris le contrôle de sa boîte email. Ne réinitialise qu'après avoir parlé à la personne elle-même.`,
    );
  return {
    sujet: args.portail ? "Demande de réinitialisation de la double authentification du compte du portail" : `${qui} demande la réinitialisation de sa double authentification`,
    contenu: {
      titre: `Bonjour ${args.prenomDestinataire},`,
      paragraphes,
      boutons: [{ label: "Ouvrir Comptes admin", url }],
      piedDePage: [
        "Message automatique : il part aux membres du bureau, jamais à la personne qui a fait la demande.",
        "Si le bouton ne fonctionne pas, copie ce lien dans ton navigateur :",
        url,
      ],
    },
  };
}

/** Ce qui arrive à la double authentification de quelqu'un, dit **à la personne elle-même**. */
export type EvenementDeuxFaTitulaire = "demande" | "reinitialisee" | "retiree";

/**
 * **L'email au titulaire** : chaque demande et chaque réinitialisation de sa double authentification
 * le prévient, à sa propre adresse. Si ce n'est pas lui, c'est la seule personne qui peut le savoir —
 * une demande faite depuis une session volée part sinon au bureau sans qu'il en sache rien.
 */
export function emailDeuxFaTitulaire(args: { prenom: string; evenement: EvenementDeuxFaTitulaire; par?: string | null; nomApp: string }): { sujet: string; contenu: EmailContenu } {
  const sujets: Record<EvenementDeuxFaTitulaire, string> = {
    demande: "Une demande de réinitialisation de ta double authentification est partie au bureau",
    reinitialisee: "Ta double authentification a été réinitialisée",
    retiree: "Ta double authentification a été retirée",
  };
  const faits: Record<EvenementDeuxFaTitulaire, string> = {
    demande: `Une demande de réinitialisation de ta double authentification vient d'être envoyée au bureau depuis ton compte ${args.nomApp}.`,
    reinitialisee: `Ta double authentification sur ${args.nomApp} vient d'être réinitialisée${args.par ? ` par ${args.par}` : ""}. Tes sessions ont été fermées : à ta prochaine connexion, tu scanneras un nouveau QR code.`,
    retiree: `Ta double authentification sur ${args.nomApp} vient d'être retirée${args.par ? ` par ${args.par}` : ""}. Elle n'avait plus d'effet sur ta connexion, qui ne change pas.`,
  };
  return {
    sujet: sujets[args.evenement],
    contenu: {
      titre: `Bonjour ${args.prenom},`,
      paragraphes: [
        faits[args.evenement],
        "Si c'est bien toi, tu n'as rien à faire.",
        "Si ce n'est pas toi, préviens tout de suite un membre du bureau et change ton mot de passe : quelqu'un d'autre a peut-être accès à ton compte ou à ta boîte email.",
      ],
      piedDePage: ["Message de sécurité automatique : il part toujours, il ne se désactive pas."],
    },
  };
}
