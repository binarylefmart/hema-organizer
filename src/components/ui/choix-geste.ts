/**
 * **La grammaire commune de « Que veux-tu faire ? »** — la partie sans React, donc testable.
 *
 * Partout dans l'administration où une sélection, une carte ou une fiche offre **plusieurs gestes**,
 * l'écran pose la même question, de la même façon :
 *
 * - une seule liste, « Que veux-tu faire ? », qui ne propose **que les gestes applicables**, chacun
 *   avec le nombre de personnes ou d'éléments qu'il toucherait ;
 * - elle s'ouvre sur « Choisir une action… », et le bouton reste inerte tant que rien n'est choisi ;
 * - le geste choisi est **expliqué avant d'agir** (à qui, ce qui arrive, qui reste de côté et
 *   pourquoi, emails, effacement) ;
 * - **un seul bouton**, au libellé verbe + nombre, plein — rouge pour ce qui supprime, efface, retire,
 *   réinitialise ou révoque (`gesteRouge`) ;
 * - après le geste, ou si la sélection change sous lui, le choix revient à « Choisir une action… ».
 *
 * Chaque écran garde son propre module pour **ses** mots et **ses** décomptes (`choix-geste.ts` de
 * l'annuaire, `gestes-fiche.ts` de la fiche d'un membre…) : ce qui se partage, c'est la mécanique et
 * le vocabulaire, jamais les règles métier d'un écran.
 *
 * Ce module ne dépend de rien qui touche aux réglages : il est lu par des composants clients.
 */

/** L'explication d'un geste : une phrase titre et les précisions, dans l'ordre où on les lit. */
export type Explication = { titre: string; phrases: string[] };

/** La valeur vide de la liste : aucun geste choisi, le bouton reste inerte. */
export const CHOIX_VIDE = { valeur: "", libelle: "Choisir une action…" } as const;

/** L'intitulé du champ, au-dessus de la liste. */
export const QUESTION_GESTE = "Que veux-tu faire ?";

/** « 1 personne », « 3 personnes ». */
export const pluriel = (n: number, mot: string, motPluriel = `${mot}s`) => `${n} ${n > 1 ? motPluriel : mot}`;

/** Les entrées de la liste déroulante : « Choisir une action… » en tête, puis les gestes applicables. */
export function entreesGestes(applicables: readonly { geste: string; libelle: string }[]): { valeur: string; libelle: string }[] {
  return [{ ...CHOIX_VIDE }, ...applicables.map((g) => ({ valeur: g.geste, libelle: g.libelle }))];
}

/**
 * **Le geste choisi tient-il encore ?** La sélection change sous lui (une case décochée, une page
 * revenue du serveur) : un geste qui ne s'applique plus n'est plus proposé, et le choix revient à
 * « Choisir une action… » plutôt que de garder une valeur que la liste ne montre plus.
 */
export function gesteRetenu<G extends string>(choisi: G | "", applicables: readonly { geste: G }[]): G | "" {
  return choisi !== "" && applicables.some((g) => g.geste === choisi) ? choisi : "";
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

/** « 1 email partira. » / « 3 emails partiront. » */
export const phraseEmails = (n: number) => (n === 1 ? "1 email partira." : `${n} emails partiront.`);

export const AUCUN_EMAIL = "Aucun email ne part.";

/**
 * **Un geste prêt à proposer** par un écran qui n'a qu'à choisir lequel lancer (`GestesProposes`) :
 * ses mots, son explication, sa confirmation, et s'il est définitif.
 *
 * Ce sont des données, pas du code : un écran serveur les compose, les passe au composant client, et
 * un test peut les relire sans navigateur.
 */
export type GesteOffert = {
  geste: string;
  /** L'entrée de la liste : le nom du geste et, quand il y a lieu, le nombre (« … (3 personnes) »). */
  libelle: string;
  /** L'unique bouton : un verbe et un nombre. */
  bouton: string;
  explication: Explication;
  /** La question d'avant — celle que l'écran posait déjà. Absente : le geste part sans confirmation. */
  confirmation?: string;
  /**
   * **Rouge** : le geste supprime, efface, retire, réinitialise ou révoque quelque chose
   * (`gesteRouge`). Rien d'autre ne l'est.
   */
  definitif?: boolean;
  /** Ce que l'écran dit après coup quand l'action ne répond rien. */
  fait: string;
};

/**
 * **Les verbes du rouge.** Tout geste dont le libellé commence par l'un d'eux enlève quelque chose —
 * un compte, un lien, un accès, une proposition, un réglage secret — et se montre en rouge, avec le
 * pictogramme d'alerte : même quand il se rattrape (un lien révoqué se renvoie), ce qui est parti est
 * à recréer. « Tout révoquer » compte aussi. Désactiver, dépublier et oublier en sont aussi, même
 * s'ils se défont : ils retirent un accès, une annonce ou un lien gardé, et le club veut les voir venir.
 */
export const VERBES_ROUGES = ["Supprimer", "Effacer", "Retirer", "Réinitialiser", "Révoquer", "Remettre … à zéro", "Débrancher", "Désactiver", "Dépublier", "Oublier"] as const;

const MOTIF_ROUGE = /^(tout\s+)?(supprimer|effacer|retirer|réinitialiser|révoquer|débrancher|désactiver|dépublier|oublier|remettre\b.*\sà zéro)\b/iu;

/** Le libellé de ce geste commence-t-il par un verbe du rouge (`VERBES_ROUGES`) ? */
export function gesteRouge(libelle: string): boolean {
  return MOTIF_ROUGE.test(libelle.normalize("NFC").trim());
}

/**
 * **Rouge pour ce qui enlève quelque chose** — partout la même règle, un seul endroit pour l'écrire.
 * Le libellé du bouton, quand il est donné, suffit à rendre le geste rouge : un geste marqué à tort
 * comme neutre ne peut pas l'être s'il dit « Supprimer », « Retirer » ou « Révoquer ».
 */
export function varianteGeste(definitif: boolean | undefined, bouton?: string): "primaire" | "danger" {
  return definitif || (bouton !== undefined && gesteRouge(bouton)) ? "danger" : "primaire";
}

/**
 * **Ce que l'écran dit après coup.** Les actions ne répondent pas toutes de la même façon :
 * `{ succes }` / `{ erreur }`, une phrase, ou rien du tout. Le message n'est jamais vide : un geste
 * qui part sans un mot se refait.
 */
export function messageApresGeste(res: unknown, fait: string): { type: "ok" | "erreur"; texte: string } {
  if (res && typeof res === "object") {
    const r = res as { erreur?: string; succes?: string };
    if (r.erreur) return { type: "erreur", texte: r.erreur };
    if (r.succes) return { type: "ok", texte: r.succes };
  }
  if (typeof res === "string" && res.trim() !== "") return { type: "ok", texte: res.charAt(0).toUpperCase() + res.slice(1) };
  return { type: "ok", texte: fait };
}
