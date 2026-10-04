import type { EtatLienPersonnel } from "@/lib/invitations";
import { formatDateHeure } from "@/lib/dates";

/**
 * **L'état d'un compte, calculé une seule fois pour les deux endroits qui le disent**.
 *
 * Ce module est **pur** — ni React, ni Prisma, ni `node:crypto` — pour trois raisons, et la troisième
 * est la vraie :
 *
 * 1. il se lit du serveur comme du navigateur, et s'éprouve sans monter de base
 *    (`tests/unit/profil-deux-piles.test.ts`) ;
 * 2. il ne fait **aucune requête** : tout ce qu'il met en forme est déjà calculé par la page pour ses
 *    cartes de réglages (`etatLienPersonnel`, `passwordHash`, la 2FA, les codes de secours, les
 *    appareils abonnés au push). Une carte d'état qui irait rechercher ses chiffres les ferait
 *    diverger de ceux affichés dix centimètres plus bas, un jour où l'une des deux requêtes change ;
 * 3. **la carte d'état et la carte de réglage disent la même chose, avec les mêmes mots.** « État de
 *    mon compte » (dans la colonne du sommaire) et « Mon lien d'accès » / « Sécuriser mon compte »
 *    (dans les piles) sont visibles **en même temps** sur un écran large : deux libellés différents
 *    pour un même fait — « lien actif » ici, « valide » là — se liraient comme deux informations
 *    contradictoires. Les deux lisent donc les mêmes fonctions.
 *
 * **La règle du dépôt sur les champs vides s'applique telle quelle** (`champsLus`, le même esprit) :
 * une ligne sans valeur ne s'affiche **pas du tout**, ni son intitulé — le compte du portail n'a pas
 * de lien personnel, et qui n'a pas de double authentification n'a pas de codes de secours. Et
 * **chaque valeur porte son intitulé** : trois pastilles empilées nues ne se distinguent pas.
 *
 * **Ce qui n'est pas un champ vide, c'est un zéro.** « Aucun appareil » est un état mesuré, et c'est
 * même celui qu'on vient vérifier quand on ne reçoit rien sur son téléphone : la ligne reste, avec sa
 * pastille neutre. Même raison que « mot de passe : non défini », qui s'affiche depuis toujours.
 */
export type TonPastille = "neutre" | "vert" | "rouge" | "ocre" | "primaire";

/**
 * **Le titre de la carte des appareils, écrit une fois.** La carte de réglage (`ActiverPush`) et la
 * ligne d'état le lisent ici : c'est la troisième raison d'être de ce module, appliquée au seul
 * libellé qui lui échappait encore.
 */
export const TITRE_APPAREILS_NOTIFIES = "Appareils qui reçoivent les notifications";

/** Une ligne lue : son intitulé, sa pastille, et la précision qui l'accompagne quand il y en a une. */
export type LigneEtat = {
  intitule: string;
  ton: TonPastille;
  valeur: string;
  /** Texte secondaire (une échéance, une date) — vide quand il n'y a rien à préciser. */
  precision?: string;
};

/**
 * **Les sept états d'un lien personnel, et le mot que chacun porte.** C'était une table locale à la
 * carte « Mon lien d'accès » ; elle est ici parce que l'état du compte doit en dire **exactement** la
 * même chose (voir l'en-tête de ce fichier).
 */
export const PASTILLE_LIEN: Record<EtatLienPersonnel["etat"], { ton: TonPastille; texte: string }> = {
  actif: { ton: "vert", texte: "Lien actif" },
  expire: { ton: "ocre", texte: "Lien expiré" },
  revoque: { ton: "rouge", texte: "Lien annulé" },
  aucun: { ton: "neutre", texte: "Aucun lien généré" },
  "aucune-periode": { ton: "neutre", texte: "Aucun lien : aucune période en cours" },
  "sans-email": { ton: "neutre", texte: "Aucun lien : pas d'adresse email" },
  "compte-de-service": { ton: "neutre", texte: "Pas de lien personnel" },
};

/**
 * Ce qu'on ajoute au mot : l'échéance pour un lien valable, la date de péremption pour un lien
 * périmé, la raison pour un lien annulé. Les trois autres états n'ont rien à préciser — leur mot dit
 * déjà tout —, et c'est une chaîne vide, donc rien à l'écran.
 */
export function precisionLien(lien: EtatLienPersonnel): string {
  if (lien.etat === "actif") return `valable jusqu'au ${formatDateHeure(lien.expiresAt)}${lien.ouvert ? "" : ", jamais ouvert"}`;
  if (lien.etat === "expire") return `depuis le ${formatDateHeure(lien.expiresAt)}`;
  if (lien.etat === "revoque") return "il a été remplacé ou révoqué";
  return "";
}

/**
 * Mot de passe : défini, ou non. **Jamais « obligatoire » pour un membre** — il ne l'est pas : le
 * lien personnel reste la porte principale, et une pastille d'alerte reprocherait un réglage
 * facultatif.
 *
 * **Pour un administrateur, si** — et l'oubli s'est vu : la 2FA manquante s'affichait en ocre et le
 * mot de passe manquant en neutre, **sous la phrase qui dit que les deux sont obligatoires pour ce
 * rôle**. Deux moitiés d'une même obligation peintes différemment dans la même carte, c'est
 * exactement la divergence que ce module existe pour éviter.
 */
export function etatMotDePasse(aDejaUnMotDePasse: boolean, admin = false): LigneEtat {
  return {
    intitule: "Mot de passe",
    ton: aDejaUnMotDePasse ? "vert" : admin ? "ocre" : "neutre",
    valeur: aDejaUnMotDePasse ? "défini" : admin ? "à définir" : "non défini",
  };
}

/**
 * Double authentification. **Le mot change avec le rôle, et la couleur avec lui** : pour un
 * administrateur elle est obligatoire (sans elle, pas de session forte, donc pas d'administration
 * technique), donc « à activer » en ocre tant qu'elle manque ; pour tous les autres c'est un
 * supplément qu'on choisit, donc « non activée » en neutre — une pastille d'alerte reprocherait un
 * réglage facultatif.
 */
export function etatDeuxFa({ deuxFa, admin, totpActiveAt }: { deuxFa: boolean; admin: boolean; totpActiveAt?: Date | null }): LigneEtat {
  return {
    intitule: "Double authentification",
    ton: deuxFa ? "vert" : admin ? "ocre" : "neutre",
    valeur: deuxFa ? "active" : admin ? "à activer" : "non activée",
    precision: deuxFa && totpActiveAt ? `depuis le ${formatDateHeure(totpActiveAt)}` : "",
  };
}

/**
 * **Les appareils qui reçoivent les notifications — et l'intitulé est celui de sa carte, mot pour
 * mot** (`ActiverPush`). Deux raisons, et la seconde a été mesurée :
 *
 * 1. c'était la **seule** des cinq lignes à ne pas partager son libellé avec la carte qu'elle
 *    résume, dans un module dont tout l'objet est que les deux disent la même chose ;
 * 2. surtout, « appareil » veut dire **autre chose** à deux lignes d'ici : l'application compte
 *    aussi les appareils d'un **lien personnel** (plafond de trois, et l'alerte « ton lien a servi
 *    sur plus de 3 appareils »). Posé juste sous « Lien d'accès », « Appareils branchés — aucun » se
 *    lisait comme un démenti de cette alerte, alors qu'il parle des notifications. Le nom entier
 *    lève l'ambiguïté : ce qui est compté ici, ce sont les abonnements au push.
 */
export function etatAppareilsNotifies(appareils: number): LigneEtat {
  return {
    intitule: TITRE_APPAREILS_NOTIFIES,
    ton: appareils > 0 ? "vert" : "neutre",
    valeur: appareils === 0 ? "aucun" : appareils === 1 ? "1 appareil" : `${appareils} appareils`,
  };
}

/** Codes de secours : rouge à zéro, parce qu'il ne reste alors **aucune** porte de repli au code TOTP. */
export function etatCodesSecours(codesRestants: number, total: number): LigneEtat {
  return {
    intitule: "Codes de secours",
    ton: codesRestants > 0 ? "neutre" : "rouge",
    valeur: `${codesRestants} sur ${total} restants`,
  };
}

/**
 * **Les lignes de la carte « État de mon compte »**, dans l'ordre où elles se lisent : d'abord ce qui
 * ouvre la porte principale (le lien), puis les deux filets (mot de passe, 2FA) et ce qui les
 * dépanne (les codes), enfin ce qui reçoit (les appareils).
 *
 * Toutes les valeurs arrivent **déjà calculées** : cette fonction ne fait que choisir les lignes qui
 * ont quelque chose à dire. Les deux absences possibles :
 * - le **compte du portail** n'a pas de lien personnel (`compte-de-service`) : afficher « Pas de lien
 *   personnel » dans un état de compte serait une ligne qui ne décrit rien ;
 * - **sans double authentification, il n'y a pas de codes de secours** : la ligne « 0 sur 8 restants »
 *   se lirait comme un incident, alors qu'il n'y a simplement rien à secourir.
 */
export function lignesEtatCompte(e: {
  lien: EtatLienPersonnel;
  aDejaUnMotDePasse: boolean;
  deuxFa: boolean;
  admin: boolean;
  totpActiveAt?: Date | null;
  codesRestants: number;
  codesTotal: number;
  appareils: number;
}): LigneEtat[] {
  const lignes: LigneEtat[] = [];
  if (e.lien.etat !== "compte-de-service") {
    lignes.push({ intitule: "Lien d'accès", ton: PASTILLE_LIEN[e.lien.etat].ton, valeur: PASTILLE_LIEN[e.lien.etat].texte, precision: precisionLien(e.lien) });
  }
  lignes.push(etatMotDePasse(e.aDejaUnMotDePasse, e.admin));
  lignes.push(etatDeuxFa({ deuxFa: e.deuxFa, admin: e.admin, totpActiveAt: e.totpActiveAt }));
  if (e.deuxFa) lignes.push(etatCodesSecours(e.codesRestants, e.codesTotal));
  lignes.push(etatAppareilsNotifies(e.appareils));
  return lignes;
}
