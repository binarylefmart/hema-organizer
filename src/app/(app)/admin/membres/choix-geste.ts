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
 * La mécanique et le vocabulaire communs (« Choisir une action… », noms tronqués, retour au choix
 * vide…) vivent dans `src/components/ui/choix-geste.ts`, partagé avec les autres écrans ; ce module
 * n'écrit que les mots et les décomptes de l'annuaire.
 *
 * Ce module ne dépend de rien qui touche aux réglages : il est lu par des composants clients (voir le
 * piège du build dans `CLAUDE.md`).
 */

import {
  AUCUN_EMAIL,
  CHOIX_VIDE,
  entreesGestes,
  gesteRetenu,
  messageApresGeste,
  nomsCourts,
  phraseEmails as emails,
  pluriel,
  QUESTION_GESTE,
  varianteGeste,
  type Explication,
  type GesteOffert,
} from "@/components/ui/choix-geste";
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

/**
 * **Le bouton du volet, au téléphone** : celui de l'ordinateur, et — pour les trois gestes qui
 * écrivent aux gens — **le nombre d'emails qui partent** à sa suite : « Renvoyer 3 liens (3 emails) ».
 * Sur l'ordinateur, l'explication posée juste au-dessus du bouton le dit déjà ; dans le volet, elle
 * peut être hors de vue au moment d'appuyer, et c'est le chiffre qu'on ne rattrape pas.
 *
 * Tant qu'aucun rôle n'est choisi, le geste du rôle dit « Appliquer le rôle », inerte.
 */
export function libelleBoutonVolet(geste: GesteSelection, nombre: number, lignes: readonly LigneChoix[], role?: { libelle: string; changent: number }): string {
  if (geste === "role" && !role) return "Appliquer le rôle";
  const base = libelleBouton(geste, nombre, role);
  const emails = geste === "renvoyer" ? resumeLiens(lignes).emails : geste === "inviter" ? resumeInvitations(lignes).emails : geste === "reinitialiser" ? resumeReinitialisation(lignes).emails : null;
  return emails === null ? base : `${base} (${pluriel(emails, "email")})`;
}

/** **En rouge, ce qui enlève quelque chose** : révoquer un lien, réinitialiser des accès, supprimer des comptes (`gesteRouge`). */
const GESTES_ROUGES: ReadonlySet<GesteSelection | ""> = new Set(["revoquer", "reinitialiser", "desactiver", "supprimer"]);

export function varianteBouton(geste: GesteSelection | ""): "primaire" | "danger" {
  return varianteGeste(GESTES_ROUGES.has(geste));
}

/**
 * « Rien ne change pour Anne et Paul (compte désactivé). » — la raison est un nom, jamais un adjectif
 * à accorder : l'écran ne connaît pas le genre des gens qu'il nomme.
 */
function laisses(liste: readonly string[], raison: string): string {
  return `Rien ne change pour ${nomsCourts(liste)} (${raison}).`;
}

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

export type GesteTousApplicable = { geste: GesteTous; nombre: number; libelle: string; bouton: string; explication: Explication; definitif: boolean };

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
      definitif: GESTES_ROUGES.has(geste),
    }));
}

/**
 * **Ce que l'écran dit après coup.** Les actions du volet ne répondent pas toutes de la même façon :
 * `{ succes }` / `{ erreur }` pour les gestes de l'annuaire, une phrase pour `definirActifTous`, rien du
 * tout pour `renvoyerTousLesLiens`. Le message ne doit jamais être vide : un geste qui part sans un mot
 * se refait.
 */
export function messageApres(geste: GesteTous, res: unknown): { type: "ok" | "erreur"; texte: string } {
  return messageApresGeste(res, FAIT[geste]);
}

/**
 * **Les gestes « Pour tout le monde », prêts à proposer** : ceux qui toucheraient quelqu'un et dont
 * l'action est permise (et liée par la page), avec la confirmation que l'écran posait déjà. Une seule
 * composition pour les deux présentations — le volet de l'ordinateur (`ChoixToutLeMonde`) et le volet
 * « + Ajouter » du téléphone, qui reçoit la liste toute faite du serveur.
 */
export function gestesTousProposes<A>(
  chiffres: ChiffresTous,
  actions: Partial<Record<GesteTous, A>>,
  confirmations: Partial<Record<GesteTous, string>>,
): Array<GesteOffert & { action: A }> {
  return gestesTousApplicables(chiffres).flatMap((g) => {
    const action = actions[g.geste];
    if (!action) return [];
    return [
      {
        geste: g.geste,
        libelle: g.libelle,
        bouton: g.bouton,
        explication: g.explication,
        confirmation: confirmations[g.geste],
        definitif: g.definitif,
        // Le message d'après coup de ce volet (`messageApres`) : jamais vide, même quand l'action ne répond rien.
        fait: messageApres(g.geste, undefined).texte,
        action,
      },
    ];
  });
}

const FAIT: Record<GesteTous, string> = {
  inviter: "Les invitations sont parties.",
  renvoyer: "Les liens sont partis.",
  revoquer: "Les liens sont révoqués.",
  reinitialiser: "Les accès sont réinitialisés.",
  desactiver: "Les comptes sont désactivés.",
  reactiver: "Les comptes sont réactivés.",
};

export { CHOIX_VIDE, entreesGestes, gesteRetenu, nomsCourts, QUESTION_GESTE, type Explication };
