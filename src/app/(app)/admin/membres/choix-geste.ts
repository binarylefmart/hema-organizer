/**
 * **« Que veux-tu faire ? » : un seul choix, une explication, un bouton** — la partie qui ne touche ni
 * à React ni à la base, donc la seule qui se teste.
 *
 * La barre de sélection alignait tous les gestes de masse, quelle que soit la sélection : « Réactiver »
 * en vert devant trois comptes actifs, « Envoyer l'invitation » devant des gens déjà entrés, et trois
 * boutons rouges dont un seul effaçait vraiment quelque chose. Il fallait deviner, bouton par bouton,
 * ce qui s'appliquait à qui.
 *
 * Désormais :
 *
 * - la liste ne propose **que les gestes qui feraient quelque chose**, chacun avec le nombre de
 *   personnes qu'il toucherait — un geste à zéro n'apparaît pas ;
 * - le geste choisi est **expliqué avant d'agir** : ce qu'il fait, à qui (nommés), qui est laissé de
 *   côté et pourquoi, s'il part des emails, s'il s'efface quelque chose ;
 * - **un seul bouton** dit le verbe et le nombre (« Envoyer 2 invitations »). Il est plein ; seule la
 *   suppression est en rouge.
 *
 * Le même motif sert au volet « Pour tout le monde » (`gestesTousApplicables`), sans suppression.
 *
 * **Les nombres viennent des décomptes existants** (`resume*` de `selection-liens.ts`,
 * `selection-gestes.ts`, `selection-roles.ts`), qui reprennent les filtres du serveur : le chiffre de
 * la liste, celui du bouton et celui du résultat doivent être le même.
 *
 * Ce module ne dépend de rien qui touche aux réglages : il est lu par des composants clients (voir le
 * piège du build dans `CLAUDE.md`).
 */

import { resumeGeste, type LigneGeste } from "./selection-gestes";
import {
  resumeInvitations,
  resumeLiens,
  resumeReinitialisation,
  resumeRevocation,
  type LigneAcces,
  type LigneLien,
  type LigneRevocation,
} from "./selection-liens";
import { resumeRoles, type LigneRole } from "./selection-roles";

/** Les gestes de la barre, dans l'ordre où la liste les propose : la suppression toujours en dernier. */
export const GESTES_SELECTION = ["inviter", "renvoyer", "revoquer", "reinitialiser", "desactiver", "reactiver", "role", "supprimer"] as const;

export type GesteSelection = (typeof GESTES_SELECTION)[number];

/** Une ligne cochée, vue par tous les gestes de la barre. */
export type LigneChoix = LigneRole & LigneGeste & LigneLien & LigneRevocation & LigneAcces;

/**
 * Ce que l'acteur a le droit de faire : un geste que le serveur refuserait n'est pas proposé — un
 * choix qui ne peut qu'échouer est pire qu'un choix absent.
 */
export type DroitsSelection = {
  /** `invitations.manage` **et** une période vers laquelle envoyer : invitation, renvoi, révocation. */
  liens: boolean;
  /** `members.activate` : désactiver, réactiver. */
  activer: boolean;
  /** `members.delete` : supprimer. */
  supprimer: boolean;
};

/** Un geste que la sélection rend possible, et combien de personnes il toucherait. */
export type GesteApplicable = { geste: GesteSelection; nombre: number; libelle: string };

/** La valeur vide de la liste : aucun geste choisi, le bouton reste inerte. */
export const CHOIX_VIDE = { valeur: "", libelle: "Choisir une action…" } as const;

/** L'intitulé du champ, au-dessus de la liste. */
export const QUESTION_GESTE = "Que veux-tu faire ?";

/** Le nom du geste dans la liste, sans le nombre. */
const NOMS_GESTES: Record<GesteSelection, string> = {
  inviter: "Envoyer l'invitation",
  renvoyer: "Renvoyer le lien",
  revoquer: "Révoquer le lien",
  reinitialiser: "Réinitialiser les accès",
  desactiver: "Désactiver le compte",
  reactiver: "Réactiver le compte",
  role: "Changer le rôle…",
  supprimer: "Supprimer les comptes",
};

const pluriel = (n: number, mot: string, motPluriel = `${mot}s`) => `${n} ${n > 1 ? motPluriel : mot}`;

/** « Renvoyer le lien (3 personnes) » : le nom du geste et le nombre de ceux qu'il toucherait. */
export function libelleOption(geste: GesteSelection, nombre: number): string {
  return `${NOMS_GESTES[geste]} (${pluriel(nombre, "personne")})`;
}

/**
 * **Combien de personnes chaque geste toucherait vraiment**, avec les décomptes du serveur :
 *
 * - l'invitation part aux jamais entrés, actifs, avec une adresse (`resumeInvitations`) ;
 * - le renvoi part aux comptes actifs avec une adresse (`resumeLiens`) ;
 * - la révocation ne touche que les liens vivants (`resumeRevocation`) ;
 * - la réinitialisation, les déjà entrés (`resumeReinitialisation`) ;
 * - désactiver et réactiver, ceux qui changent d'état (`resumeGeste`) ;
 * - le rôle et la suppression, toute la sélection.
 */
export function compterGeste(geste: GesteSelection, lignes: readonly LigneChoix[]): number {
  switch (geste) {
    case "inviter":
      return resumeInvitations(lignes).emails;
    case "renvoyer":
      return resumeLiens(lignes).emails;
    case "revoquer":
      return resumeRevocation(lignes).liens;
    case "reinitialiser":
      return resumeReinitialisation(lignes).total;
    case "desactiver":
    case "reactiver":
      return resumeGeste(lignes, geste).changent;
    case "role":
    case "supprimer":
      return lignes.length;
  }
}

function autorise(geste: GesteSelection, droits: DroitsSelection): boolean {
  if (geste === "inviter" || geste === "renvoyer" || geste === "revoquer") return droits.liens;
  if (geste === "desactiver" || geste === "reactiver") return droits.activer;
  if (geste === "supprimer") return droits.supprimer;
  // Le rôle et la réinitialisation relèvent de `members.manage`, la permission de la barre entière.
  return true;
}

/**
 * **Les gestes que la liste propose** : permis, et qui toucheraient au moins une personne. Un geste à
 * zéro n'apparaît pas — c'était tout le défaut de l'ancienne barre.
 */
export function gestesApplicables(lignes: readonly LigneChoix[], droits: DroitsSelection): GesteApplicable[] {
  if (lignes.length === 0) return [];
  return GESTES_SELECTION.filter((g) => autorise(g, droits))
    .map((geste) => ({ geste, nombre: compterGeste(geste, lignes) }))
    .filter((g) => g.nombre > 0)
    .map((g) => ({ ...g, libelle: libelleOption(g.geste, g.nombre) }));
}

/** Les entrées de la liste déroulante : « Choisir une action… » en tête, puis les gestes applicables. */
export function entreesGestes(applicables: readonly { geste: string; libelle: string }[]): { valeur: string; libelle: string }[] {
  return [{ ...CHOIX_VIDE }, ...applicables.map((g) => ({ valeur: g.geste, libelle: g.libelle }))];
}

/**
 * **Le geste choisi tient-il encore ?** La sélection change sous lui (une case décochée, une page
 * revenue du serveur) : un geste qui ne toucherait plus personne n'est plus proposé, et le choix revient
 * à « Choisir une action… » plutôt que de garder une valeur que la liste ne montre plus.
 */
export function gesteRetenu<G extends string>(choisi: G | "", applicables: readonly { geste: G }[]): G | "" {
  return choisi !== "" && applicables.some((g) => g.geste === choisi) ? choisi : "";
}

/**
 * **Le libellé de l'unique bouton : un verbe et un nombre.** « Envoyer 2 invitations », « Révoquer 3
 * liens », « Supprimer 3 comptes » — on sait ce qui part et combien avant d'appuyer.
 *
 * Pour le rôle, le nombre est celui des comptes qui changent vraiment (`resumeRoles`) ; tant qu'aucun
 * rôle n'est choisi, le bouton dit seulement « Changer le rôle ».
 */
export function libelleBouton(geste: GesteSelection, nombre: number, role?: { libelle: string; changent: number }): string {
  switch (geste) {
    case "inviter":
      return `Envoyer ${pluriel(nombre, "invitation")}`;
    case "renvoyer":
      return `Renvoyer ${pluriel(nombre, "lien")}`;
    case "revoquer":
      return `Révoquer ${pluriel(nombre, "lien")}`;
    case "reinitialiser":
      return `Réinitialiser ${nombre} accès`;
    case "desactiver":
      return `Désactiver ${pluriel(nombre, "compte")}`;
    case "reactiver":
      return `Réactiver ${pluriel(nombre, "compte")}`;
    case "role":
      return role ? `Passer ${pluriel(role.changent, "compte")} en ${role.libelle}` : "Changer le rôle";
    case "supprimer":
      return `Supprimer ${pluriel(nombre, "compte")}`;
  }
}

/** **Seule la suppression est en rouge** : c'est le seul geste qui efface sans retour. */
export function varianteBouton(geste: GesteSelection | ""): "primaire" | "danger" {
  return geste === "supprimer" ? "danger" : "primaire";
}

/** Au-delà, le reste est compté : l'explication doit se lire d'un coup d'œil, pas se parcourir. */
const NOMS_MAX = 3;

/** « Anne », « Anne et Paul », « Anne, Paul et Zoé », « Anne, Paul, Zoé et 4 autres ». */
export function nomsCourts(liste: readonly string[], max = NOMS_MAX): string {
  if (liste.length === 0) return "";
  if (liste.length === 1) return liste[0];
  if (liste.length <= max) return `${liste.slice(0, -1).join(", ")} et ${liste[liste.length - 1]}`;
  return `${liste.slice(0, max).join(", ")} et ${pluriel(liste.length - max, "autre")}`;
}

/**
 * « Rien ne change pour Anne et Paul (compte désactivé). » — la raison est un nom, jamais un adjectif
 * à accorder : l'écran ne connaît pas le genre des gens qu'il nomme.
 */
function laisses(liste: readonly string[], raison: string): string {
  return `Rien ne change pour ${nomsCourts(liste)} (${raison}).`;
}

/** L'explication d'un geste : une phrase titre et les précisions, dans l'ordre où on les lit. */
export type Explication = { titre: string; phrases: string[] };

const emails = (n: number) => (n === 1 ? "1 email partira." : `${n} emails partiront.`);

const AUCUN_EMAIL = "Aucun email ne part.";

/**
 * **Ce que fait le geste choisi, avant de le faire** : à qui (nommés), ce qui arrive, qui est laissé de
 * côté et pourquoi, s'il part des emails, s'il s'efface quelque chose. Les mots sont ceux des
 * confirmations (`texteConfirmation*`) — la promesse est la même, dite plus tôt.
 */
export function expliquerGeste(geste: GesteSelection, lignes: readonly LigneChoix[], role?: { valeur: string; libelle: string }): Explication {
  const nomsDe = (filtre: (l: LigneChoix) => boolean) => lignes.filter(filtre).map((l) => l.nom);
  switch (geste) {
    case "inviter": {
      const r = resumeInvitations(lignes);
      const partants = nomsDe((l) => !l.dejaEntre && l.actif && l.aUnEmail);
      return {
        titre: `Envoyer l'invitation à ${nomsCourts(partants)}`,
        phrases: [
          `${partants.length > 1 ? "Aucune de ces personnes n'est jamais entrée dans l'application : chacune reçoit" : "Cette personne n'est jamais entrée dans l'application : elle reçoit"} un lien personnel neuf et le parcours d'entrée complet, comme à la création du compte. Rien n'est effacé.`,
          emails(r.emails),
          ...(r.dejaEntres.length > 0 ? [laisses(r.dejaEntres, "accès déjà installé : c'est « Réinitialiser les accès » qu'il faut")] : []),
          ...(r.inactifs.length > 0 ? [laisses(r.inactifs, "compte désactivé")] : []),
          ...(r.sansEmail.length > 0 ? [laisses(r.sansEmail, "pas d'adresse email")] : []),
        ],
      };
    }
    case "renvoyer": {
      const r = resumeLiens(lignes);
      const partants = nomsDe((l) => l.actif && l.aUnEmail);
      return {
        titre: `Renvoyer le lien à ${nomsCourts(partants)}`,
        phrases: [
          `${partants.length > 1 ? "Chacune reçoit" : "Cette personne reçoit"} un nouveau lien personnel : l'ancien cesse de fonctionner, et les appareils déjà connectés sont déconnectés. Rien d'autre n'est effacé.`,
          emails(r.emails),
          ...(r.inactifs.length > 0 ? [laisses(r.inactifs, "compte désactivé : son lien ne s'ouvrirait pas")] : []),
          ...(r.sansEmail.length > 0 ? [laisses(r.sansEmail, "pas d'adresse email")] : []),
        ],
      };
    }
    case "revoquer": {
      const r = resumeRevocation(lignes);
      const touches = nomsDe((l) => l.lienEnCours);
      return {
        titre: `Révoquer le lien de ${nomsCourts(touches)}`,
        phrases: [
          `${touches.length > 1 ? "Ces personnes ne pourront plus entrer par leur lien" : "Cette personne ne pourra plus entrer par son lien"} tant qu'un nouveau n'est pas envoyé. Les appareils déjà connectés le restent, rien n'est effacé.`,
          AUCUN_EMAIL,
          ...(r.sansLien.length > 0 ? [laisses(r.sansLien, "aucun lien en cours")] : []),
        ],
      };
    }
    case "reinitialiser": {
      const r = resumeReinitialisation(lignes);
      const touches = nomsDe((l) => l.dejaEntre);
      return {
        titre: `Réinitialiser les accès de ${nomsCourts(touches)}`,
        phrases: [
          `${touches.length > 1 ? "Pour chacune de ces personnes, cela efface" : "Cela efface"} le mot de passe et la double authentification, révoque les liens, déconnecte tous les appareils, puis renvoie une invitation : tout le parcours d'entrée est à refaire. Les historiques ne sont pas touchés.`,
          emails(r.emails),
          ...(r.muets.length > 0 ? [`Rien ne partira pour ${nomsCourts(r.muets)} (pas d'adresse, compte désactivé ou pas inscrit à une période active) : l'accès sera seulement remis à zéro.`] : []),
          ...(r.jamaisEntres.length > 0 ? [laisses(r.jamaisEntres, "accès jamais installé : c'est « Envoyer l'invitation » qu'il faut")] : []),
        ],
      };
    }
    case "desactiver": {
      const r = resumeGeste(lignes, geste);
      const touches = nomsDe((l) => l.actif);
      return {
        titre: `Désactiver le compte de ${nomsCourts(touches)}`,
        phrases: [
          `${touches.length > 1 ? "Ces personnes perdent" : "Cette personne perd"} l'accès immédiatement : appareils déconnectés, lien personnel hors service, plus aucun email. Rien n'est effacé, et « Réactiver le compte » rend l'accès.`,
          ...(r.bureau.length > 0 ? [`Du bureau : ${nomsCourts(r.bureau)}. L'administration du club se referme aussi.`] : []),
          ...(r.inchanges > 0 ? [laisses(nomsDe((l) => !l.actif), "compte déjà désactivé")] : []),
        ],
      };
    }
    case "reactiver": {
      const r = resumeGeste(lignes, geste);
      const touches = nomsDe((l) => !l.actif);
      return {
        titre: `Réactiver le compte de ${nomsCourts(touches)}`,
        phrases: [
          `${touches.length > 1 ? "Ces personnes retrouvent" : "Cette personne retrouve"} l'accès, et le lien personnel fonctionne de nouveau. Rien n'est effacé.`,
          AUCUN_EMAIL,
          ...(r.inchanges > 0 ? [laisses(nomsDe((l) => l.actif), "compte déjà actif")] : []),
        ],
      };
    }
    case "role": {
      const tous = lignes.map((l) => l.nom);
      if (!role || role.valeur === "") {
        return {
          titre: `Changer le rôle de ${nomsCourts(tous)}`,
          phrases: ["Choisis le nouveau rôle ci-dessous. Aucun email ne part, rien n'est effacé, et le bureau n'est pas touché."],
        };
      }
      const r = resumeRoles(lignes, role.valeur);
      if (r.changent === 0) return { titre: `Tous sont déjà « ${role.libelle} »`, phrases: ["Rien ne changera : choisis un autre rôle."] };
      return {
        titre: `Passer ${nomsCourts(nomsDe((l) => l.role !== role.valeur))} en « ${role.libelle} »`,
        phrases: [
          "Aucun email ne part, rien n'est effacé, et le bureau n'est pas touché.",
          ...(r.inchanges > 0 ? [laisses(nomsDe((l) => l.role === role.valeur), `déjà « ${role.libelle} »`)] : []),
        ],
      };
    }
    case "supprimer": {
      const r = resumeGeste(lignes, "supprimer");
      return {
        titre: `Supprimer définitivement ${nomsCourts(lignes.map((l) => l.nom))}`,
        phrases: [
          "C'est irréversible : le compte, ses réponses de présence, ses propositions d'atelier et son historique partent avec.",
          r.reponsesPerdues === 0
            ? "Aucune réponse de présence ne sera perdue."
            : `${pluriel(r.reponsesPerdues, "réponse")} de présence ${r.reponsesPerdues > 1 ? "seront perdues" : "sera perdue"}.`,
          ...(r.bureau.length > 0 ? [`Du bureau : ${nomsCourts(r.bureau)}. Les droits d'administrateur partent avec le compte.`] : []),
          AUCUN_EMAIL,
        ],
      };
    }
  }
}

/* ------------------------------------------------------------------ */
/* « Pour tout le monde » : le même motif, avec les chiffres du serveur */
/* ------------------------------------------------------------------ */

/** Les gestes du volet « Pour tout le monde » — **jamais de suppression** : elle se fait en désignant. */
export const GESTES_TOUS = ["inviter", "renvoyer", "revoquer", "reinitialiser", "desactiver", "reactiver"] as const;

export type GesteTous = (typeof GESTES_TOUS)[number];

/**
 * Les chiffres que la page compte avec les filtres du serveur (`tout-le-monde.ts`) ; un geste non
 * permis arrive à zéro et n'est donc pas proposé.
 */
export type ChiffresTous = {
  inviter: number;
  /** Les déjà entrés, que l'invitation saute. */
  dejaEntres: number;
  renvoyer: number;
  revoquer: number;
  reinitialiser: number;
  /** Parmi les réinitialisés, ceux qui recevront l'invitation renvoyée. */
  reinitialiserEmails: number;
  /** Les jamais entrés, que la réinitialisation saute. */
  jamaisEntres: number;
  desactiver: number;
  reactiver: number;
  /** Le nom de la période dont partent les liens, s'il y en a une. */
  periode: string | null;
};

export type GesteTousApplicable = { geste: GesteTous; nombre: number; libelle: string; bouton: string; explication: Explication };

const qui = (n: number) => pluriel(n, "personne");

function expliquerTous(geste: GesteTous, c: ChiffresTous): Explication {
  const periode = c.periode ? ` à « ${c.periode} »` : "";
  switch (geste) {
    case "inviter":
      return {
        titre: `Envoyer l'invitation ${c.inviter > 1 ? `aux ${qui(c.inviter)} jamais entrées` : "à la seule personne jamais entrée"}`,
        phrases: [
          "Chacune reçoit un lien personnel neuf et le parcours d'entrée complet, comme à la création du compte. Rien n'est effacé.",
          emails(c.inviter),
          ...(c.dejaEntres > 0 ? [`Rien ne change pour ${qui(c.dejaEntres)} à l'accès déjà installé : pour elles, c'est « Réinitialiser les accès ».`] : []),
        ],
      };
    case "renvoyer":
      return {
        titre: `Renvoyer son lien à ${c.renvoyer > 1 ? `chacune des ${qui(c.renvoyer)} inscrites` : "la seule personne inscrite"}${periode}`,
        phrases: ["Chaque lien est régénéré : les anciens cessent de fonctionner. Rien d'autre n'est effacé.", emails(c.renvoyer)],
      };
    case "revoquer":
      return {
        titre: `Révoquer ${c.revoquer > 1 ? `les ${c.revoquer} liens` : "le seul lien"} en cours`,
        phrases: [
          "Ces personnes ne pourront plus entrer par leur lien tant qu'un nouveau n'est pas envoyé. Les appareils déjà connectés le restent, et ton propre lien n'est pas touché.",
          AUCUN_EMAIL,
        ],
      };
    case "reinitialiser": {
      const muets = c.reinitialiser - c.reinitialiserEmails;
      return {
        titre: `Réinitialiser les accès ${c.reinitialiser > 1 ? `des ${qui(c.reinitialiser)} déjà entrées` : "de la seule personne déjà entrée"}`,
        phrases: [
          "Pour chacune, cela efface le mot de passe et la double authentification, révoque les liens, déconnecte tous les appareils, puis renvoie une invitation : tout le parcours d'entrée est à refaire. Les historiques ne sont pas touchés.",
          emails(c.reinitialiserEmails),
          ...(muets > 0 ? [`Rien ne partira pour ${qui(muets)} (pas d'adresse, compte désactivé ou pas inscrite à une période active) : l'accès sera seulement remis à zéro.`] : []),
          ...(c.jamaisEntres > 0 ? [`Rien ne change pour ${qui(c.jamaisEntres)} à l'accès jamais installé : pour elles, c'est « Envoyer l'invitation ».`] : []),
        ],
      };
    }
    case "desactiver":
      return {
        titre: `Désactiver ${pluriel(c.desactiver, "compte")}, administrateurs compris`,
        phrases: [
          "Chacun perd l'accès immédiatement et son lien personnel cesse de fonctionner. Ton compte et celui du portail restent actifs. Rien n'est effacé, et « Réactiver » rend l'accès.",
          AUCUN_EMAIL,
        ],
      };
    case "reactiver":
      return {
        titre: `Réactiver ${pluriel(c.reactiver, "compte")}`,
        phrases: ["Chacun retrouve l'accès et son lien personnel fonctionne de nouveau. Rien n'est effacé.", AUCUN_EMAIL],
      };
  }
}

/** Les gestes du volet « Pour tout le monde » qui toucheraient au moins une personne, dans l'ordre de la barre. */
export function gestesTousApplicables(c: ChiffresTous): GesteTousApplicable[] {
  return GESTES_TOUS.map((geste) => ({ geste, nombre: c[geste] }))
    .filter((g) => g.nombre > 0)
    .map(({ geste, nombre }) => ({
      geste,
      nombre,
      libelle: libelleOption(geste, nombre),
      bouton: libelleBouton(geste, nombre),
      explication: expliquerTous(geste, c),
    }));
}

/**
 * **Ce que l'écran dit après coup.** Les actions du volet ne répondent pas toutes de la même façon :
 * `{ succes }` / `{ erreur }` pour les gestes de l'annuaire, une phrase pour `definirActifTous`, rien du
 * tout pour `renvoyerTousLesLiens`. Le message ne doit jamais être vide : un geste qui part sans un mot
 * se refait.
 */
export function messageApres(geste: GesteTous, res: unknown): { type: "ok" | "erreur"; texte: string } {
  if (res && typeof res === "object") {
    const r = res as { erreur?: string; succes?: string };
    if (r.erreur) return { type: "erreur", texte: r.erreur };
    if (r.succes) return { type: "ok", texte: r.succes };
  }
  if (typeof res === "string" && res.trim() !== "") return { type: "ok", texte: res.charAt(0).toUpperCase() + res.slice(1) };
  return { type: "ok", texte: FAIT[geste] };
}

const FAIT: Record<GesteTous, string> = {
  inviter: "Les invitations sont parties.",
  renvoyer: "Les liens sont partis.",
  revoquer: "Les liens sont révoqués.",
  reinitialiser: "Les accès sont réinitialisés.",
  desactiver: "Les comptes sont désactivés.",
  reactiver: "Les comptes sont réactivés.",
};
