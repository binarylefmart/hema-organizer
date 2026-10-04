/**
 * **Renvoyer le lien personnel à plusieurs personnes d'un coup** — la partie qui ne touche ni à
 * React ni à la base, donc la seule qui se teste.
 *
 * Demande de. L'annuaire savait cocher des lignes pour nommer sept instructeurs, couper un accès ou
 * effacer des comptes ; il sait maintenant renvoyer leur clé d'entrée à un groupe — la rentrée d'un
 * trimestre, une liste d'adresses corrigée, cinq personnes qui « n'ont jamais reçu le lien ».
 *
 * **C'est le seul des cinq gestes de masse de cet écran qui part vers les gens**, et c'est tout
 * l'objet de ce module. `CLAUDE.md` : « un geste de masse n'envoie pas la notification du geste
 * unitaire multipliée ; cinquante-cinq emails partis d'un clic sont un incident. » Ici l'envoi **est**
 * le geste — ce n'est pas une notification qui accompagne une écriture —, mais la règle en garde une
 * conséquence : la confirmation doit annoncer **combien d'emails vont partir**, avant qu'ils partent.
 * Un nombre, pas une promesse vague : c'est le seul chiffre qu'on ne peut pas rattraper.
 *
 * Deux règles de fond, et elles viennent du geste unitaire (`envoyerLienMembre`, `src/actions/membres.ts`) :
 *
 * 1. **Une personne sans adresse email ne peut rien recevoir** : on le **dit**, en la nommant, et on
 *    envoie aux autres — plutôt que d'échouer en bloc, qui laisserait le bureau décocher au hasard
 *    pour trouver laquelle bloque. C'est déjà ce que fait « Renvoyer les liens » d'une période
 *    (`renvoyerTousLesLiens`, qui saute les sans-adresse et les compte).
 * 2. **Un compte désactivé ne reçoit pas de lien mort-né** : son lien ne s'ouvrirait pas. Même
 *    traitement — nommé, écarté, et les autres partent.
 *
 * Ce module ne dépend de rien : il est lu par un composant client, et tout module touchant aux
 * réglages entraînerait `node:crypto` dans le paquet du navigateur (échec de `npm run build` que ni
 * `tsc` ni les tests ne voient).
 */

/**
 * Une ligne de l'annuaire, vue par ce geste : son nom (les écartés sont **nommés**), l'état de son
 * accès et **le fait qu'elle ait une adresse** — jamais l'adresse elle-même, qui n'a rien à faire
 * dans le paquet du navigateur pour quatre-vingts comptes.
 */
export type LigneLien = { id: string; nom: string; actif: boolean; aUnEmail: boolean };

/** Ce qu'un lot va faire, avant de le faire. */
export type ResumeLiens = {
  /** Combien de comptes sont sélectionnés. */
  total: number;
  /** **Combien d'emails vont partir** : un par personne joignable, et pas un de plus. */
  emails: number;
  /** Celles qui n'ont pas d'adresse : rien ne peut partir pour elles, et on le dit. */
  sansEmail: string[];
  /** Les comptes désactivés : leur lien ne s'ouvrirait pas, on ne l'envoie pas. */
  inactifs: string[];
};

/**
 * Le décompte des trois populations d'un lot.
 *
 * **L'ordre des tests est celui du geste unitaire** : désactivé d'abord, adresse ensuite
 * (`envoyerLienMembre` refuse dans cet ordre). Quelqu'un de désactivé *et* sans adresse est donc
 * compté une seule fois, et la phrase qui le concerne est la plus utile des deux — réactive-le
 * d'abord, le reste suivra.
 */
export function resumeLiens(lignes: readonly LigneLien[]): ResumeLiens {
  const sansEmail: string[] = [];
  const inactifs: string[] = [];
  let emails = 0;
  for (const l of lignes) {
    if (!l.actif) inactifs.push(l.nom);
    else if (!l.aUnEmail) sansEmail.push(l.nom);
    else emails += 1;
  }
  return { total: lignes.length, emails, sansEmail, inactifs };
}

/**
 * **Combien de noms on détaille avant de compter le reste.**
 *
 * Un lot peut porter trente comptes sans adresse ; une fenêtre de confirmation de trente lignes ne se
 * lit pas, elle se clique. Douze noms tiennent sur un téléphone, et au-delà le reste est **compté et
 * dit** — même plafond et même raison qu'aux réponses de présence perdues (`selection-gestes.ts`).
 */
const NOMS_DETAILLES_MAX = 12;

/** « Chloé Dubois, Marc Aubry et 3 autres » — jamais une liste qu'on ne peut pas lire. */
function noms(liste: readonly string[]): string {
  const detailles = liste.slice(0, NOMS_DETAILLES_MAX);
  const reste = liste.length - detailles.length;
  if (reste === 0) return detailles.join(", ");
  return `${detailles.join(", ")} et ${reste} autre${reste > 1 ? "s" : ""}`;
}

function phraseSansEmail(liste: readonly string[]): string {
  if (liste.length === 1) return `1 personne n'a pas d'adresse email et ne recevra rien : ${noms(liste)}.`;
  return `${liste.length} personnes n'ont pas d'adresse email et ne recevront rien : ${noms(liste)}.`;
}

function phraseInactifs(liste: readonly string[]): string {
  if (liste.length === 1) return `1 compte est désactivé : son lien ne s'ouvrirait pas, rien ne partira pour lui (${noms(liste)}).`;
  return `${liste.length} comptes sont désactivés : leur lien ne s'ouvrirait pas, rien ne partira pour eux (${noms(liste)}).`;
}

/**
 * **La question posée avant que les emails partent.** Elle dit, dans cet ordre : **combien d'emails**,
 * ce que chacun contient (une clé neuve, donc l'ancienne meurt), qui est écarté et pourquoi, et que le
 * journal gardera la trace nom par nom.
 *
 * Le premier chiffre n'est pas le nombre de cases cochées mais le nombre d'**envois** : c'est lui
 * qu'on ne peut pas rattraper, et les deux diffèrent dès qu'une personne du lot n'a pas d'adresse.
 *
 * Elle n'est posée que si au moins un email peut partir ; sinon c'est {@link texteRienAEnvoyer} qui
 * parle, et rien n'est demandé au serveur.
 */
export function texteConfirmationLiens(resume: ResumeLiens): string {
  const morceaux = [
    resume.emails === 1
      ? "Envoyer 1 email maintenant, avec un nouveau lien personnel ?"
      : `Envoyer ${resume.emails} emails maintenant, chacun avec un nouveau lien personnel ?`,
  ];
  // Le geste unitaire promet exactement cela sur une ligne (« L'ancien cessera de fonctionner ») : le
  // bureau doit retrouver la même promesse qu'il agisse sur une personne ou sur trente.
  morceaux.push(
    resume.emails === 1
      ? "Son lien précédent cessera de fonctionner, et ses appareils déjà connectés seront déconnectés."
      : "Les liens précédents cesseront de fonctionner, et les appareils déjà connectés seront déconnectés.",
  );
  if (resume.inactifs.length > 0) morceaux.push(phraseInactifs(resume.inactifs));
  if (resume.sansEmail.length > 0) morceaux.push(phraseSansEmail(resume.sansEmail));
  morceaux.push("Chaque envoi est inscrit au journal, nom par nom.");
  return morceaux.join("\n");
}

/**
 * **Quand aucun email ne peut partir, on ne pose pas la question.**
 *
 * Un lot de cinq comptes sans adresse n'a rien à confirmer : une fenêtre « Envoyer 0 email ? » est un
 * piège, et appeler le serveur ferait redemander un code 2FA pour un envoi à blanc — exactement ce que
 * les trois autres gestes de masse évitent déjà (« inutile de réclamer un code pour un enregistrement
 * à blanc », `appliquerGesteEnMasse`). L'écran dit donc ce qui manque, et rien ne part.
 */
export function texteRienAEnvoyer(resume: ResumeLiens): string {
  const morceaux = ["Aucun email ne peut partir."];
  if (resume.inactifs.length > 0) morceaux.push(phraseInactifs(resume.inactifs));
  if (resume.sansEmail.length > 0) morceaux.push(phraseSansEmail(resume.sansEmail));
  return morceaux.join(" ");
}

/* ------------------------------------------------------------------ */
/* Révoquer le lien de plusieurs personnes                             */
/* ------------------------------------------------------------------ */

/**
 * Une ligne de l'annuaire, vue par la révocation : a-t-elle un lien **en cours** pour la période des
 * liens ? C'est le booléen de la colonne « État du lien » (`aUnLienEnCours`, `page.tsx`), pas une
 * nouvelle lecture.
 */
export type LigneRevocation = { id: string; nom: string; lienEnCours: boolean };

/** Ce qu'une révocation en masse va faire, avant de le faire. */
export type ResumeRevocation = {
  /** **Combien de liens vont cesser de s'ouvrir** : un par personne qui en a un. */
  liens: number;
  /** Celles qui n'ont pas de lien en cours : rien à révoquer, et on le dit. */
  sansLien: string[];
};

export function resumeRevocation(lignes: readonly LigneRevocation[]): ResumeRevocation {
  const sansLien = lignes.filter((l) => !l.lienEnCours).map((l) => l.nom);
  return { liens: lignes.length - sansLien.length, sansLien };
}

/**
 * **La question posée avant de couper des clés.** Le chiffre est celui des liens révoqués, pas des
 * cases cochées, pour la même raison qu'à l'envoi ; et elle dit ce que la ligne dit à l'unité : la
 * personne n'entrera plus par ce lien tant qu'un nouveau ne lui est pas envoyé — sans laisser croire
 * que ses appareils déjà connectés tombent avec.
 */
export function texteConfirmationRevocation(resume: ResumeRevocation): string {
  const morceaux = [
    resume.liens === 1
      ? "Révoquer 1 lien personnel ? La personne ne pourra plus entrer par ce lien tant qu'un nouveau ne lui est pas envoyé."
      : `Révoquer ${resume.liens} liens personnels ? Ces personnes ne pourront plus entrer par leur lien tant qu'un nouveau ne leur est pas envoyé.`,
    "Aucun email ne part, et les appareils déjà connectés le restent.",
  ];
  if (resume.sansLien.length > 0) {
    morceaux.push(
      resume.sansLien.length === 1
        ? `1 personne n'a pas de lien en cours, rien ne change pour elle : ${noms(resume.sansLien)}.`
        : `${resume.sansLien.length} personnes n'ont pas de lien en cours, rien ne change pour elles : ${noms(resume.sansLien)}.`,
    );
  }
  morceaux.push("Chaque révocation est inscrite au journal, nom par nom.");
  return morceaux.join("\n");
}

/** Quand personne n'a de lien en cours, on ne pose pas la question — et le serveur ne redemande aucun code. */
export function texteRienARevoquer(resume: ResumeRevocation): string {
  return `Aucun lien à révoquer : personne dans la sélection n'a de lien en cours (${noms(resume.sansLien)}).`;
}

/* ------------------------------------------------------------------ */
/* Envoyer l'invitation / Réinitialiser les accès                      */
/* ------------------------------------------------------------------ */

/**
 * Une ligne de l'annuaire, vue par les deux gestes d'accès : **est-elle déjà entrée ?**
 * (`aDejaUnAcces`, src/lib/membres.ts — la même fonction que les gardes serveur), et recevra-t-elle
 * l'invitation qu'une réinitialisation renvoie (compte actif, adresse, inscrite à une période active).
 */
export type LigneAcces = { id: string; nom: string; actif: boolean; aUnEmail: boolean; dejaEntre: boolean; recoitInvitation: boolean };

/** Ce que la réinitialisation coûte à chacun, dit une fois pour la ligne, la sélection et tout le monde. */
const EFFET_REINITIALISATION =
  "efface le mot de passe et la double authentification, révoque les liens, déconnecte tous les appareils, puis renvoie une invitation qui refait tout le parcours d'entrée";

/** « Envoyer l'invitation » d'une ligne : rien n'est effacé, et c'est ce qui la distingue. */
export function texteConfirmationInvitationUnitaire(nom: string): string {
  return `Envoyer l'invitation à ${nom} ?\nUn email part avec son lien personnel et le parcours d'entrée complet, comme à la création du compte. Rien n'est effacé.`;
}

/** « Réinitialiser les accès » d'une ligne : la personne est nommée, ce qui est effacé est dit. */
export function texteConfirmationReinitialisationUnitaire(nom: string, recoitInvitation: boolean): string {
  return [
    `Réinitialiser les accès de ${nom} ?`,
    "Cela efface son mot de passe et sa double authentification, révoque ses liens, le déconnecte de tous ses appareils, et lui renvoie une invitation neuve (tout le parcours d'entrée est à refaire).",
    recoitInvitation ? "" : "Attention : aucune invitation ne pourra lui être envoyée (pas d'adresse, compte désactivé ou pas inscrit à une période active) — son accès sera seulement remis à zéro.",
    "Son historique n'est pas touché.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** « 3 personnes déjà entrées sont ignorées » — ceux que le geste saute, comptés et nommés quand on les connaît. */
function phraseIgnores(n: number, motif: string, liste: readonly string[] | null): string {
  const qui = liste && liste.length > 0 ? ` : ${noms(liste)}` : "";
  return n === 1 ? `1 personne ${motif.replaceAll("{s}", "")} est ignorée${qui}.` : `${n} personnes ${motif.replaceAll("{s}", "s")} sont ignorées${qui}.`;
}

/** Ce qu'« Envoyer l'invitation » fera d'un lot. */
export type ResumeInvitations = { emails: number; dejaEntres: string[]; inactifs: string[]; sansEmail: string[] };

/**
 * **Seuls ceux qui ne sont jamais entrés reçoivent l'invitation** ; les autres sont sautés et comptés.
 * Ordre des tests : déjà entré d'abord (le geste ne les concerne pas du tout), puis les deux refus du
 * lien — compte désactivé, adresse manquante —, dans l'ordre du geste unitaire.
 */
export function resumeInvitations(lignes: readonly LigneAcces[]): ResumeInvitations {
  const r: ResumeInvitations = { emails: 0, dejaEntres: [], inactifs: [], sansEmail: [] };
  for (const l of lignes) {
    if (l.dejaEntre) r.dejaEntres.push(l.nom);
    else if (!l.actif) r.inactifs.push(l.nom);
    else if (!l.aUnEmail) r.sansEmail.push(l.nom);
    else r.emails += 1;
  }
  return r;
}

function phrasesEcartesInvitation(r: { dejaEntres: number; inactifs: number; sansEmail: number }, listes: ResumeInvitations | null): string[] {
  const morceaux: string[] = [];
  if (r.dejaEntres > 0) morceaux.push(phraseIgnores(r.dejaEntres, "déjà entrée{s} (pour elle{s}, c'est « Réinitialiser les accès »)", listes?.dejaEntres ?? null));
  if (r.inactifs > 0) morceaux.push(phraseIgnores(r.inactifs, "au compte désactivé", listes?.inactifs ?? null));
  if (r.sansEmail > 0) morceaux.push(phraseIgnores(r.sansEmail, "sans adresse email", listes?.sansEmail ?? null));
  return morceaux;
}

/** La question avant d'inviter un lot : combien d'emails, que rien n'est effacé, qui est sauté. */
export function texteConfirmationInvitations(r: ResumeInvitations): string {
  return [
    r.emails === 1 ? "Envoyer l'invitation à 1 personne qui n'est jamais entrée ? 1 email partira." : `Envoyer l'invitation aux ${r.emails} personnes qui ne sont jamais entrées ? ${r.emails} emails partiront.`,
    "Chacun porte un lien personnel neuf et le parcours d'entrée complet, comme à la création du compte. Rien n'est effacé.",
    ...phrasesEcartesInvitation({ dejaEntres: r.dejaEntres.length, inactifs: r.inactifs.length, sansEmail: r.sansEmail.length }, r),
    "Chaque envoi est inscrit au journal, nom par nom.",
  ].join("\n");
}

/** Quand personne ne peut être invité, on ne pose pas la question (ni au serveur, qui redemanderait un code). */
export function texteRienAInviter(r: ResumeInvitations): string {
  return ["Aucune invitation ne peut partir.", ...phrasesEcartesInvitation({ dejaEntres: r.dejaEntres.length, inactifs: r.inactifs.length, sansEmail: r.sansEmail.length }, r)].join(" ");
}

/** La même question pour « Pour tout le monde », où l'écran n'a que les chiffres. */
export function texteConfirmationInvitationsTous(emails: number, dejaEntres: number): string {
  return [
    emails === 1 ? "Envoyer l'invitation à la seule personne qui n'est jamais entrée ? 1 email partira." : `Envoyer l'invitation aux ${emails} personnes qui ne sont jamais entrées ? ${emails} emails partiront.`,
    "Chacun porte un lien personnel neuf et le parcours d'entrée complet, comme à la création du compte. Rien n'est effacé.",
    ...phrasesEcartesInvitation({ dejaEntres, inactifs: 0, sansEmail: 0 }, null),
  ].join("\n");
}

/** Ce que « Réinitialiser les accès » fera d'un lot. */
export type ResumeReinitialisation = { total: number; emails: number; muets: string[]; jamaisEntres: string[] };

/** **Seuls ceux qui sont déjà entrés sont réinitialisés** ; les autres sont sautés et comptés. */
export function resumeReinitialisation(lignes: readonly LigneAcces[]): ResumeReinitialisation {
  const r: ResumeReinitialisation = { total: 0, emails: 0, muets: [], jamaisEntres: [] };
  for (const l of lignes) {
    if (!l.dejaEntre) r.jamaisEntres.push(l.nom);
    else {
      r.total += 1;
      if (l.recoitInvitation) r.emails += 1;
      else r.muets.push(l.nom);
    }
  }
  return r;
}

/**
 * **La question avant de réinitialiser un lot.** Deux chiffres, et c'est voulu : combien de gens
 * seront mis dehors, et combien d'emails partiront — le second est celui qu'on ne rattrape pas, le
 * premier celui qui fera sonner le téléphone du bureau.
 */
export function texteConfirmationReinitialisation(r: ResumeReinitialisation): string {
  return texteReinitialisationLot(r.total, r.emails, r.jamaisEntres.length, r);
}

export function texteRienAReinitialiser(r: ResumeReinitialisation): string {
  return `Aucun accès à réinitialiser : ${phraseIgnores(r.jamaisEntres.length, "jamais entrée{s} (pour elle{s}, c'est « Envoyer l'invitation »)", r.jamaisEntres)}`;
}

export function texteConfirmationReinitialisationTous(total: number, emails: number, jamaisEntres: number): string {
  return texteReinitialisationLot(total, emails, jamaisEntres, null);
}

function texteReinitialisationLot(total: number, emails: number, jamaisEntres: number, listes: ResumeReinitialisation | null): string {
  const morceaux = [
    total === 1 ? "Réinitialiser les accès de 1 personne ?" : `Réinitialiser les accès de ${total} personnes ?`,
    `Pour ${total === 1 ? "elle" : "chacune"}, cela ${EFFET_REINITIALISATION}.`,
    emails === 1 ? "1 email partira." : `${emails} emails partiront.`,
  ];
  const muets = total - emails;
  if (muets > 0) {
    const qui = listes && listes.muets.length > 0 ? ` : ${noms(listes.muets)}` : "";
    morceaux.push(
      muets === 1
        ? `1 personne sera remise à zéro sans rien recevoir (pas d'adresse, compte désactivé ou pas inscrite à une période active)${qui}.`
        : `${muets} personnes seront remises à zéro sans rien recevoir (pas d'adresse, compte désactivé ou pas inscrites à une période active)${qui}.`,
    );
  }
  if (jamaisEntres > 0) morceaux.push(phraseIgnores(jamaisEntres, "jamais entrée{s} (pour elle{s}, c'est « Envoyer l'invitation »)", listes?.jamaisEntres ?? null));
  morceaux.push("Les historiques ne sont pas touchés. Chaque réinitialisation est inscrite au journal, nom par nom.");
  return morceaux.join("\n");
}

/* ------------------------------------------------------------------ */
/* « Pour tout le monde » : les questions de l'écran                   */
/* ------------------------------------------------------------------ */

/** « Renvoyer le lien à tout le monde » : le nombre d'emails, et la promesse du bouton d'une ligne. */
export function texteConfirmationRenvoiTous(emails: number, periode: string): string {
  return [
    emails === 1
      ? `Renvoyer son lien à 1 personne inscrite à « ${periode} » ? 1 email partira.`
      : `Renvoyer son lien à chacune des ${emails} personnes inscrites à « ${periode} » ? ${emails} emails partiront.`,
    "Chaque lien est régénéré : les anciens cesseront de fonctionner.",
  ].join("\n");
}

/** « Révoquer le lien de tout le monde » : combien de liens meurent, et ce qui n'en part pas. */
export function texteConfirmationRevocationTous(liens: number, periode: string): string {
  return [
    liens === 1
      ? `Révoquer 1 lien personnel pour « ${periode} » ? La personne ne pourra plus entrer par ce lien tant qu'un nouveau ne lui est pas envoyé.`
      : `Révoquer les ${liens} liens personnels en cours pour « ${periode} » ? Ces personnes ne pourront plus entrer par leur lien tant qu'un nouveau ne leur est pas envoyé.`,
    "Aucun email ne part, les appareils déjà connectés le restent, et ton propre lien n'est pas touché.",
  ].join("\n");
}
