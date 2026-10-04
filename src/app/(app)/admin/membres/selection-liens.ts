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
