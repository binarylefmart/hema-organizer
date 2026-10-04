import type { AttendanceStatut } from "@/lib/constants";
import { ATTENDANCE_STATUTS } from "@/lib/constants";
import { STATUT_LABELS } from "@/lib/presences";
import { texteInviteMasse } from "@/components/ui/selection";

/**
 * **Corriger la réponse de plusieurs personnes d'un coup** — la partie qui ne touche ni à React ni
 * à la base, donc la seule qui se teste.
 *
 * ## Pourquoi ce module existe
 *
 * Un soir de cours dans un club de quatre-vingts, la feuille de présence est relevée à la main et
 * l'écran s'ouvre sur quarante-six à cinquante-cinq personnes **sans réponse**. Une liste
 * déroulante par personne, cinquante fois, n'est pas un geste : c'est une corvée qui finit par ne
 * plus être faite, et le registre cesse d'être juste.
 *
 * ## Les deux règles qui tiennent tout
 *
 * 1. **La sélection ne porte que sur ce qui est affiché.** Le résultat de la recherche en cours et
 *    les lignes dépliées, jamais la liste entière en silence. D'où des libellés qui **nomment ce
 *    sur quoi la case agit** ({@link libelleToutSelectionner}) : « Sélectionner les 12 résultats »
 *    et non « Tout ». Une case « Tout » devant vingt lignes visibles et soixante repliées est un
 *    piège — on croit en avoir pris quatre-vingts, on en a pris vingt (ou, pire, l'inverse).
 * 2. **La confirmation dit ce qu'elle écrase.** Une correction en masse passe sur des gens qui ont
 *    **déjà répondu eux-mêmes** ; les compter à part et les nommer par statut est la seule façon de
 *    décider en connaissance de cause ({@link resumeEcrasement}, {@link texteConfirmation}). C'est
 *    le patron de `SeancesCreees`, qui annonce les réponses effacées avant de supprimer des séances.
 *
 * Il ne dépend de rien d'autre que de deux constantes et d'une table de libellés — il est lu par un
 * composant client, et tout module touchant aux réglages entraînerait `node:crypto` dans le paquet
 * du navigateur (échec de `npm run build` que ni `tsc` ni les tests ne voient).
 */

/** Une ligne de la liste, vue par la sélection : son identité et la réponse qu'elle porte. */
export type LigneSelectionnable = { id: string; statut: AttendanceStatut | null };

/* ------------------------------------------------------------------ */
/* Cocher, décocher — la mécanique commune aux deux écrans de masse    */
/* ------------------------------------------------------------------ */

/*
 * Ces sept outils vivent dans `src/components/ui/selection.ts` : l'annuaire s'en sert aussi pour
 * le changement de rôle en masse, et c'est ce partage qui garantit que les deux écrans se
 * comportent pareil. Ils sont ré-exportés ici pour que ce module reste la seule porte d'entrée de
 * l'écran des présences.
 */
export {
  basculer,
  ajouter,
  retirer,
  restreindre,
  etatToutCocher,
  lignesSelectionnees,
  libelleToutSelectionner,
  libelleDeplierEtSelectionner,
  texteRepliees,
  compterHorsAffichage,
  texteHorsAffichage,
  memoriserLignes,
  barreDeMasseVisible,
} from "@/components/ui/selection";
export type { EtatToutCocher, MotsLignes } from "@/components/ui/selection";

/**
 * **Ce que les cases permettent, dit à côté d'elles**.
 *
 * La tuile de masse n'est plus montée tant que rien n'est coché — « pour presence (admin) pareil,
 * rends cette tuile visible uniquement si quelqu'un est coché ». La phrase qu'elle portait
 * (« Coche des lignes ci-dessus, puis choisis la réponse à leur donner. ») n'a pas disparu pour
 * autant : elle descend d'un cran, sur la case maîtresse, en **une ligne**. C'est la même forme
 * qu'à l'annuaire ({@link texteInviteMasse}), avec les mots de cet écran-ci.
 */
export const INVITE_SELECTION = texteInviteMasse("corriger plusieurs réponses à la fois");

/**
 * **Les mots de cet écran** : on y coche des *personnes*, et le mot est féminin. C'est la seule
 * chose que la phrase partagée (`texteHorsAffichage`) attend de l'écran — le reste de la phrase est
 * commun aux deux écrans de masse, comme l'exige `CLAUDE.md` : « ce qui se duplique, ce sont les
 * mots, jamais la mécanique ».
 */
export const MOTS_PERSONNES = { singulier: "personne", pluriel: "personnes", accord: "f" } as const;

/* ------------------------------------------------------------------ */
/* Les corrections en cours, et le moment de les oublier                */
/* ------------------------------------------------------------------ */

/**
 * **Ce qu'une ligne porte à l'écran** : la correction en cours si elle existe, sinon la valeur du
 * serveur. Une valeur qui n'est pas un statut connu ne s'affiche pas comme un statut.
 *
 * Elle est ici plutôt que dans le composant parce que **deux chemins d'écriture s'en servent** : le
 * verrou du geste unitaire (« la valeur ne change pas, il n'y a rien à envoyer ») et le résumé
 * d'écrasement du lot. Les laisser lire deux choses différentes, c'est exactement la divergence que
 * `CLAUDE.md` interdit — un chemin qui s'abstient là où l'autre écrase.
 */
export function reponseAffichee(
  modifs: Readonly<Record<string, string | null>>,
  participant: { id: string; statut: string | null },
): AttendanceStatut | null {
  const v = participant.id in modifs ? modifs[participant.id] : participant.statut;
  return v !== null && (ATTENDANCE_STATUTS as readonly string[]).includes(v) ? (v as AttendanceStatut) : null;
}

/**
 * **Oublier les corrections dont le serveur a repris la main.**
 *
 * Le dictionnaire des corrections fait primer ce qu'on vient de saisir sur ce que le serveur envoie
 * — il le faut, le temps de l'aller-retour. Mais il n'était **jamais purgé**, et ce « le temps de »
 * devenait « pour toujours » :
 *
 * - le bureau passe quelqu'un à Absent mardi ; la personne répond Présent de son téléphone
 *   mercredi ; jeudi, sur le même onglet, sa case porte encore Absent. Le registre se lit faux, la
 *   liste déroulante affiche déjà la valeur (donc n'émet aucun changement), et le geste unitaire
 *   s'arrête de lui-même sur « rien n'a changé » : **il devient impossible de corriger** ;
 * - pire, la confirmation du lot se calcule sur ce qui est affiché : elle annonçait « 1 y est déjà »
 *   au moment même où le lot allait effacer une réponse réelle. C'est le chiffre censé faire hésiter.
 *
 * La règle est donc simple : **seules les lignes encore en vol** gardent leur correction affichée.
 * Dès que le serveur renvoie la liste, tout le reste retombe sur ce qu'il dit — c'est lui qui a
 * raison, il vient de relire la base. La purge se déclenche à l'arrivée de nouvelles données, ce qui
 * suppose que l'action **revalide l'écran d'où part la correction** (`rafraichirApresCorrection`) ;
 * sans ça, la purge afficherait les réponses d'avant.
 *
 * Le dictionnaire reçu **est rendu tel quel** quand il n'y a rien à retirer : c'est un état React, et
 * en fabriquer une copie identique coûterait un rendu de plus à chaque revalidation du serveur.
 */
export function oublierCorrectionsArrivees<T>(modifs: Record<string, T>, enVol: ReadonlySet<string>): Record<string, T> {
  const ids = Object.keys(modifs);
  const gardes = ids.filter((id) => enVol.has(id));
  if (gardes.length === ids.length) return modifs;
  return Object.fromEntries(gardes.map((id) => [id, modifs[id]]));
}


/* ------------------------------------------------------------------ */
/* Ce que la confirmation annonce                                      */
/* ------------------------------------------------------------------ */

/** Ce qu'un lot va faire, avant de le faire. */
export type ResumeEcrasement = {
  /** Combien de personnes sont sélectionnées. */
  total: number;
  /** Combien n'avaient rien dit — le cas ordinaire, et celui qui ne coûte rien à personne. */
  sansReponse: number;
  /**
   * Combien **avaient répondu elles-mêmes** une chose différente de ce qu'on va écrire. C'est le
   * chiffre délicat : ce sont les seules dont on efface la parole.
   */
  ecrasees: number;
  /** Le détail des réponses effacées, par statut, dans l'ordre des statuts de l'application. */
  detail: { statut: AttendanceStatut; nombre: number }[];
  /** Combien portent déjà la réponse visée : rien ne changera pour elles. */
  inchangees: number;
};

/**
 * Le décompte des deux populations d'un lot.
 *
 * Quelqu'un qui porte **déjà** la réponse visée n'est pas « écrasé » : on ne lui prend rien, et le
 * confondre avec les autres gonflerait le chiffre qui doit faire hésiter. Pour la cible « Sans
 * réponse », toute réponse existante compte comme effacée — c'est bien ce que le geste fait.
 */
export function resumeEcrasement(lignes: readonly LigneSelectionnable[], cible: AttendanceStatut | null): ResumeEcrasement {
  const parStatut = new Map<AttendanceStatut, number>();
  let sansReponse = 0;
  let inchangees = 0;
  for (const l of lignes) {
    if (l.statut === null) {
      sansReponse += 1;
      if (cible === null) inchangees += 1;
      continue;
    }
    if (l.statut === cible) {
      inchangees += 1;
      continue;
    }
    parStatut.set(l.statut, (parStatut.get(l.statut) ?? 0) + 1);
  }
  const detail = ATTENDANCE_STATUTS.filter((s) => parStatut.has(s)).map((statut) => ({ statut, nombre: parStatut.get(statut) as number }));
  return {
    total: lignes.length,
    sansReponse,
    ecrasees: detail.reduce((n, d) => n + d.nombre, 0),
    detail,
    inchangees,
  };
}

/**
 * **Les réponses que la barre propose : seulement celles qui changeraient quelqu'un.** Un lot de
 * quatre « Présent » ne se voit pas offrir « Présent » — un bouton qui ne s'applique pas n'apparaît
 * pas, comme partout dans l'administration. L'ordre reste celui de l'application, « Sans réponse »
 * en dernier. Sans sélection, rien n'est proposé.
 */
export function ciblesUtiles(lignes: readonly LigneSelectionnable[]): (AttendanceStatut | null)[] {
  if (lignes.length === 0) return [];
  return [...ATTENDANCE_STATUTS, null].filter((cible) => resumeEcrasement(lignes, cible).inchangees < lignes.length);
}

/**
 * Le détail entre parenthèses : « 2 Absent, 1 Peut-être ». Quand il n'y en a qu'une, le nombre
 * n'apprend rien et on n'écrit que le statut — « (Absent) ».
 */
function detailEcrase(resume: ResumeEcrasement): string {
  if (resume.ecrasees === 1) return STATUT_LABELS[resume.detail[0].statut];
  return resume.detail.map((d) => `${d.nombre} ${STATUT_LABELS[d.statut]}`).join(", ");
}

const personnes = (n: number) => `${n} personne${n > 1 ? "s" : ""}`;

/**
 * **La question posée avant d'écrire.** Elle dit trois choses, dans cet ordre : combien de
 * personnes, ce qu'on va leur écrire, et **ce que ça écrase**.
 *
 * Le troisième point est le seul qui compte vraiment. Passer quarante-six silencieux à « Présent »
 * ne prend rien à personne ; le même geste sur un lot où trois personnes ont répondu elles-mêmes
 * efface leur réponse, et le bureau doit le savoir **avec le détail** — « 2 Absent, 1 Peut-être »
 * n'est pas la même information que « 3 réponses ». C'est le patron de `SeancesCreees`, qui
 * annonce les réponses perdues avant de supprimer des séances.
 *
 * La dernière phrase rappelle le journal : elle n'est pas décorative, c'est lui qui tranchera le
 * désaccord de la semaine suivante, personne par personne.
 */
export function texteConfirmation(resume: ResumeEcrasement, cible: AttendanceStatut | null): string {
  const morceaux: string[] = [];
  if (cible === null) {
    morceaux.push(`Remettre ${personnes(resume.total)} à « Sans réponse » ?`);
    if (resume.ecrasees === 0) {
      morceaux.push("Aucune n'avait répondu : rien ne changera.");
    } else if (resume.ecrasees === 1) {
      morceaux.push(`1 réponse sera effacée (${detailEcrase(resume)}).`);
    } else {
      morceaux.push(`${resume.ecrasees} réponses seront effacées (${detailEcrase(resume)}).`);
    }
  } else {
    morceaux.push(`Passer ${personnes(resume.total)} à « ${STATUT_LABELS[cible]} » ?`);
    if (resume.ecrasees === 1) {
      morceaux.push(`1 avait déjà répondu elle-même (${detailEcrase(resume)}) : sa réponse sera remplacée.`);
    } else if (resume.ecrasees > 1) {
      morceaux.push(`${resume.ecrasees} avaient déjà répondu elles-mêmes (${detailEcrase(resume)}) : leur réponse sera remplacée.`);
    }
    if (resume.inchangees === 1) morceaux.push("1 y est déjà.");
    else if (resume.inchangees > 1) morceaux.push(`${resume.inchangees} y sont déjà.`);
  }
  morceaux.push("Chaque changement est inscrit au journal, personne par personne.");
  return morceaux.join(" ");
}

/** Ce que l'écran annonce une fois le lot enregistré — le chiffre écrit, et ce qui n'avait rien à changer. */
export function texteApresCoup(modifiees: number, inchangees: number): string {
  if (modifiees === 0) return `Rien à changer : ${inchangees > 1 ? `ces ${inchangees} réponses étaient` : "cette réponse était"} déjà à jour.`;
  const debut = `${modifiees} réponse${modifiees > 1 ? "s" : ""} enregistrée${modifiees > 1 ? "s" : ""}`;
  if (inchangees === 0) return `${debut}.`;
  return `${debut}, ${inchangees} ${inchangees > 1 ? "étaient" : "était"} déjà à jour.`;
}
