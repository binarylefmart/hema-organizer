import { baseUrl } from "@/lib/env";
import type { EmailContenu } from "./layout";

export type MotifEnvoiLien = "invitation" | "renouvellement" | "securite" | "appareils" | "reinitialisation";

/**
 * Email du lien d'accès personnel : invitation (activation d'une période, ajout d'un membre, régénération),
 * renouvellement automatique (lien de 4 mois arrivé à terme) ou remplacement de sécurité (lien jugé suspect).
 */
export function emailInvitation(args: { prenom: string; periodeNom: string; url: string; nomApp: string; motif?: MotifEnvoiLien }): {
  sujet: string;
  contenu: EmailContenu;
} {
  const motif = args.motif ?? "invitation";
  const intro = {
    invitation: `Les cours de la période « ${args.periodeNom} » arrivent. Pour dire si tu viens à chaque séance, voir le planning et proposer un atelier, utilise l'application ${args.nomApp}.`,
    renouvellement: `Ton lien d'accès à l'application ${args.nomApp} (période « ${args.periodeNom} ») arrive au bout de ses 4 mois : en voici un nouveau. L'ancien cessera de fonctionner, rien d'autre ne change.`,
    securite: `Par sécurité, ton ancien lien d'accès à ${args.nomApp} (période « ${args.periodeNom} ») a été désactivé : il a été ouvert un nombre anormal de fois. Il ne fonctionne plus, et tous tes appareils ont été déconnectés — même celui que tu es en train d'utiliser. Pour revenir, ouvre le nouveau lien ci-dessous (ou connecte-toi avec ton mot de passe, si tu t'en es défini un).`,
    appareils: `Ton lien d'accès à ${args.nomApp} (période « ${args.periodeNom} ») était déjà ouvert sur 3 appareils en même temps : par sécurité, il est remplacé par celui-ci. L'ancien ne fonctionne plus, et tous tes appareils ont été déconnectés — même celui que tu es en train d'utiliser. Pour revenir, ouvre le nouveau lien ci-dessous (ou connecte-toi avec ton mot de passe, si tu t'en es défini un).`,
    // Remise à zéro décidée par l'équipe : tout reprend de zéro, y compris le parcours d'entrée.
    reinitialisation: `L'équipe a remis ton accès à ${args.nomApp} à zéro (période « ${args.periodeNom} ») : ton mot de passe et ta double authentification ont été effacés, tes anciens liens ne fonctionnent plus et tous tes appareils ont été déconnectés. Voici ton nouveau lien : il te réinstalle l'application si tu le souhaites, puis te propose de redéfinir ton mot de passe. Il n'y a rien d'autre à faire.`,
  }[motif];
  return {
    sujet:
      motif === "invitation"
        ? `🗡️ Ton lien pour les cours — ${args.periodeNom}`
        : motif === "securite"
          ? `🗡️ Nouveau lien d'accès (sécurité) — ${args.periodeNom}`
          : motif === "reinitialisation"
            ? `🗡️ Ton accès a été remis à zéro — ${args.periodeNom}`
            : `🗡️ Ton nouveau lien pour les cours — ${args.periodeNom}`,
    contenu: {
      titre: `Bonjour ${args.prenom} !`,
      paragraphes: [
        intro,
        "Pas de mot de passe à retenir : ce lien est ta clé, il t'ouvre directement ton espace. Il est valable 4 mois et sera renouvelé automatiquement par email.",
        "Garde cet email : le lien te reconnecte sur n'importe quel appareil. Si tu le perds, demande à l'administrateur de te le renvoyer.",
        ...(motif === "securite" || motif === "appareils" ? ["Si tu n'es pas à l'origine de ces ouvertures, préviens l'administrateur : personne d'autre que toi ne doit utiliser ce lien."] : []),
      ],
      boutons: [{ label: "Ouvrir l'application", url: args.url }],
      piedDePage: [...installationEtLien(args.url), "Ce lien est personnel : ne le transmets pas."],
    },
  };
}

/**
 * Ce qui suit le bouton : où trouver les gestes d'installation, puis le lien en toutes lettres.
 *
 * **Les étapes de chaque appareil ne sont plus ici.** Elles y tenaient sept paragraphes — les deux
 * systèmes l'un sous l'autre, plus leurs mises en garde — que personne ne lit dans un email, et
 * dont cinq sur sept ne concernent pas l'appareil qu'on tient. Elles vivent maintenant dans
 * l'application (`GuideInstallation`), repliées derrière le nom du système : on déroule le sien,
 * on ignore l'autre. Le lien du bouton y mène en un appui, et l'application sait, elle, sur quel
 * appareil elle s'affiche.
 *
 * Ce qui reste ici est ce que l'application ne peut pas dire, parce que ça se passe **avant**
 * elle, ou **en dehors** d'elle :
 *  - le lien en toutes lettres, à copier par appui long — dans un email, copier veut dire appui
 *    long, un client mail n'exécutant aucun JavaScript (pas de bouton « Copier » ici, il ne ferait
 *    rien). Il occupe sa propre ligne : c'est ce qui rend l'appui facile à viser ;
 *  - le piège de l'iPhone : l'application installée a son propre stockage, séparé de Safari, et un
 *    lien touché dans Mail n'ouvrira jamais l'icône. Le seul passage est d'y coller ce lien-là.
 */
export function installationEtLien(url: string): string[] {
  return [
    "Installer l'application sur ton téléphone : ouvre le lien ci-dessus. L'application te montre alors les gestes de ton appareil — iPhone ou Android —, à dérouler d'un appui.",
    "Ton lien personnel, à garder : appuie longuement dessus pour le copier. Il sert aussi à le coller dans ton navigateur si le bouton ne fonctionne pas.",
    url,
    "Sur iPhone, l'application installée ne reçoit pas les liens ouverts depuis Mail : colle alors ce lien dans le champ prévu sur la page de connexion de l'application.",
  ];
}

/** Email « mot de passe oublié ». */
export function emailReset(args: { prenom: string; url: string; nomApp: string }): { sujet: string; contenu: EmailContenu } {
  return {
    sujet: "🗡️ Réinitialiser ton mot de passe",
    contenu: {
      titre: `Bonjour ${args.prenom},`,
      paragraphes: [
        `Tu as demandé à changer ton mot de passe sur ${args.nomApp}.`,
        "Clique sur le bouton ci-dessous : le lien est valable 30 minutes et ne sert qu'une fois.",
        "Si tu n'es pas à l'origine de cette demande, ignore simplement cet email : ton mot de passe reste inchangé.",
      ],
      boutons: [{ label: "Choisir un nouveau mot de passe", url: args.url }],
      piedDePage: ["Si le bouton ne fonctionne pas, copie ce lien dans ton navigateur :", args.url, `Application : ${baseUrl()}`],
    },
  };
}

/** Résumé lisible d'un user-agent (navigateur / système), sans bibliothèque. */
export function decrireAppareil(userAgent: string): string {
  const ua = userAgent || "";
  const systeme = /iPhone|iPad/.test(ua) ? "iPhone/iPad" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "appareil inconnu";
  const navigateur = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "navigateur inconnu";
  return `${navigateur} sur ${systeme}`;
}

/** Email court « nouvel appareil » : le lien personnel vient d'ouvrir une session sur un autre appareil. */
export function emailNouvelAppareil(args: { prenom: string; appareil: string; ip: string; quand: string; nomApp: string }): { sujet: string; contenu: EmailContenu } {
  return {
    sujet: `🗡️ Nouvel appareil connecté à ${args.nomApp}`,
    contenu: {
      titre: `Bonjour ${args.prenom},`,
      paragraphes: [
        `Ton lien personnel vient d'ouvrir l'application sur un nouvel appareil : ${args.appareil}, le ${args.quand} (adresse ${args.ip}).`,
        "Si c'est toi (nouveau téléphone, ordinateur…), tout va bien : tu peux ignorer cet email.",
        "Si ce n'est pas toi, préviens vite l'administrateur : il désactivera ce lien et t'en enverra un nouveau.",
      ],
      boutons: [{ label: "Ouvrir l'application", url: baseUrl() }],
      piedDePage: ["Message automatique de sécurité : un lien personnel ne doit être utilisé que par toi."],
    },
  };
}
