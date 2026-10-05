import { pluriel, type Explication } from "@/components/ui/choix-geste";
import { texteInviteMasse, type MotsLignes } from "@/components/ui/selection";
import { seanceAnnulable, seanceRetablissable } from "./gestes-seance";

/**
 * **Agir sur plusieurs séances à la fois** — la partie sans React ni base, donc testable.
 *
 * L'onglet Séances, en mode modification, donne une case à chaque carte : on coche, puis « Que
 * veux-tu faire ? ». C'est le geste de l'annuaire et des présences (`src/components/ui/selection.ts`
 * pour la mécanique, `ChoixGeste` pour la forme) — **ce qui se duplique ici, ce sont les mots** de
 * l'écran des séances, jamais la mécanique.
 *
 * Cinq gestes, et chacun n'est proposé que s'il touche au moins une séance du lot :
 *
 * - **annuler** les séances ni annulées ni commencées — un motif commun, et **une annonce par
 *   séance** : c'est ce qui la distingue des quatre autres, et l'écran le dit avant ;
 * - **rétablir** les séances annulées, pas encore commencées ;
 * - **changer le lieu**, **changer l'horaire** — de toutes les séances cochées ;
 * - **supprimer** — au bureau seulement, session forte (l'appelant le décide, comme pour la carte).
 *
 * Les règles « annulable » et « rétablissable » ne s'écrivent pas ici : elles sont celles de la carte
 * et du serveur (`seanceAnnulable`, `seanceRetablissable`, `gestes-seance.ts`).
 */

/** Une séance cochable, telle que l'écran la connaît. Une séance d'un trimestre clos n'en a pas. */
export type LigneSeance = {
  id: string;
  /** « mardi 6 octobre » : le nom de la case, et celui des séances citées. */
  jour: string;
  heureDebut: string;
  heureFin: string;
  lieu: string;
  adresse: string;
  annulee: boolean;
  /** Le cours a commencé (ou est passé) : il ne s'annule ni ne se rétablit plus. */
  commencee: boolean;
  /** Réponses déjà données par les membres : ce qu'une suppression emporte. */
  reponses: number;
};

export type GesteSeances = "annuler" | "retablir" | "lieu" | "horaire" | "supprimer";

/** Les mots de cet écran pour la phrase partagée `texteHorsAffichage` : on y coche des *séances*. */
export const MOTS_SEANCES: MotsLignes = { singulier: "séance", pluriel: "séances", accord: "f" };

/** La phrase posée sous la case maîtresse tant que rien n'est coché (`texteInviteMasse`). */
export const INVITE_SEANCES = texteInviteMasse("agir sur plusieurs séances à la fois");

/** « 1 séance », « 3 séances ». */
export const nbSeances = (n: number) => pluriel(n, "séance");

/**
 * **Le libellé de la case maîtresse nomme ce qu'elle prend** — les séances *affichées* : la liste est
 * filtrée (trimestre, fenêtre de temps, jour) et repliée à cinq cartes, et c'est justement là qu'on
 * s'en sert. Le mot « Tout » ne s'écrit nulle part (`CLAUDE.md`).
 */
export function libelleToutesSeances(affichees: number): string {
  if (affichees === 0) return "Aucune séance à sélectionner";
  if (affichees === 1) return "Sélectionner la séance affichée";
  return `Sélectionner les ${affichees} séances affichées`;
}

/** Le second bouton, quand des cartes sont repliées : le geste qu'on voulait vraiment faire. */
export function libelleAfficherEtSelectionner(total: number): string {
  return `Afficher et sélectionner les ${total} séances`;
}

/** Les séances du lot qu'un geste toucherait. */
export function ciblesGeste(geste: GesteSeances, lot: readonly LigneSeance[]): LigneSeance[] {
  if (geste === "annuler") return lot.filter((l) => seanceAnnulable({ annulee: l.annulee, passee: l.commencee }));
  if (geste === "retablir") return lot.filter((l) => seanceRetablissable({ annulee: l.annulee, passee: l.commencee }));
  return [...lot];
}

export type GesteSeancesOffert = { geste: GesteSeances; libelle: string; nombre: number };

/**
 * **Les gestes applicables au lot**, chacun avec le nombre de séances qu'il toucherait. Un geste à
 * zéro n'est pas proposé : « Rétablir (0 séance) » dans une liste est un geste qui ne fait rien.
 */
export function gestesSeancesApplicables(lot: readonly LigneSeance[], { supprimer }: { supprimer: boolean }): GesteSeancesOffert[] {
  const noms: Record<GesteSeances, string> = {
    annuler: "Annuler les séances",
    retablir: "Rétablir les séances",
    lieu: "Changer le lieu",
    horaire: "Changer l'horaire",
    supprimer: "Supprimer les séances",
  };
  const ordre: GesteSeances[] = ["annuler", "retablir", "lieu", "horaire", ...(supprimer ? (["supprimer"] as const) : [])];
  return ordre
    .map((geste) => ({ geste, nombre: ciblesGeste(geste, lot).length }))
    .filter((g) => g.nombre > 0)
    .map((g) => ({ ...g, libelle: `${noms[g.geste]} (${nbSeances(g.nombre)})` }));
}

/** Le réglage qu'un geste demande, tel que l'écran l'a saisi. */
export type ReglageSeances = { motif?: string; lieu?: string; adresse?: string; heureDebut?: string; heureFin?: string };

/**
 * **Les séances que le geste changerait vraiment** : pour le lieu et l'horaire, celles qui sont déjà à
 * la valeur visée restent dehors — c'est aussi ce que fait le serveur, qui ne les écrit ni ne les
 * journalise. Sans réglage encore choisi, toutes les cibles comptent.
 */
export function seancesQuiChangent(geste: GesteSeances, lot: readonly LigneSeance[], reglage: ReglageSeances = {}): LigneSeance[] {
  const cibles = ciblesGeste(geste, lot);
  if (geste === "lieu" && reglage.lieu) return cibles.filter((l) => l.lieu !== reglage.lieu || l.adresse !== (reglage.adresse ?? ""));
  if (geste === "horaire" && reglage.heureDebut && reglage.heureFin) return cibles.filter((l) => l.heureDebut !== reglage.heureDebut || l.heureFin !== reglage.heureFin);
  return cibles;
}

/** L'horaire saisi tient-il ? Deux heures, et la fin après le début — la règle de `seanceSchema`. */
export function horaireValide(heureDebut = "", heureFin = ""): boolean {
  return /^\d{2}:\d{2}$/.test(heureDebut) && /^\d{2}:\d{2}$/.test(heureFin) && heureFin > heureDebut;
}

/**
 * **Le réglage manque-t-il encore ?** Le bouton reste inerte tant que le geste attend son motif, son
 * lieu ou son horaire — et tant qu'il ne changerait aucune séance.
 */
export function reglageManquant(geste: GesteSeances, lot: readonly LigneSeance[], reglage: ReglageSeances): boolean {
  if (geste === "annuler" && !reglage.motif?.trim()) return true;
  if (geste === "lieu" && !reglage.lieu?.trim()) return true;
  if (geste === "horaire" && !horaireValide(reglage.heureDebut, reglage.heureFin)) return true;
  return seancesQuiChangent(geste, lot, reglage).length === 0;
}

/** L'unique bouton : un verbe et un nombre. */
export function libelleBoutonSeances(geste: GesteSeances, n: number): string {
  const s = nbSeances(n);
  switch (geste) {
    case "annuler":
      return `Annuler ${s}`;
    case "retablir":
      return `Rétablir ${s}`;
    case "lieu":
      return `Changer le lieu de ${s}`;
    case "horaire":
      return `Changer l'horaire de ${s}`;
    case "supprimer":
      return `Supprimer ${s}`;
  }
}

/**
 * **Rouge pour annuler et supprimer** : la première prévient tout le club, la seconde efface des
 * réponses. C'est la couleur de leurs jumeaux sur la carte (`gestesSeance`).
 */
export function gesteSeancesDefinitif(geste: GesteSeances): boolean {
  return geste === "annuler" || geste === "supprimer";
}

/** « 3 annonces d'annulation partiront » — le chiffre qu'on ne rattrape pas. */
export function phraseAnnonces(n: number): string {
  return n === 1 ? "1 annonce d'annulation partira" : `${n} annonces d'annulation partiront`;
}

/** Les réponses qu'une suppression emporte, au total du lot. */
export function reponsesPerdues(lot: readonly LigneSeance[]): number {
  return lot.reduce((total, l) => total + l.reponses, 0);
}

/** Ce qui reste de côté pour annuler ou rétablir, et pourquoi. */
function phraseEcartees(geste: "annuler" | "retablir", lot: readonly LigneSeance[]): string | null {
  const ecartees = lot.length - ciblesGeste(geste, lot).length;
  if (ecartees === 0) return null;
  const e = ecartees > 1 ? "s" : "";
  const raison = geste === "annuler" ? `déjà annulée${e} ou déjà commencée${e}` : `pas annulée${e}, ou déjà commencée${e}`;
  return ecartees === 1 ? `1 séance de la sélection reste de côté : ${raison}.` : `${ecartees} séances de la sélection restent de côté : ${raison}.`;
}

/**
 * **Le geste expliqué avant d'agir** : à qui, ce qui arrive, qui reste de côté, ce qui part.
 *
 * L'annulation dit **combien d'annonces partent, et pourquoi c'est voulu** : la règle du dépôt est
 * qu'un geste de masse n'envoie pas la notification du geste unitaire multipliée — mais ici l'annonce
 * n'est pas l'écho d'une écriture, elle **est** le geste demandé (une séance annulée en silence, c'est
 * un club qui vient pour rien). Même raisonnement que « Renvoyer le lien » en masse à l'annuaire.
 */
export function expliquerGesteSeances(geste: GesteSeances, lot: readonly LigneSeance[], reglage: ReglageSeances = {}): Explication {
  const touchees = seancesQuiChangent(geste, lot, reglage);
  const n = touchees.length;
  const reste = (phrases: (string | null)[]) => phrases.filter((p): p is string => Boolean(p));
  switch (geste) {
    case "annuler":
      return {
        titre: `${phraseAnnonces(n)} : chaque séance annulée prévient tout le club, tout de suite.`,
        phrases: reste([
          "Une annonce par séance, exactement comme une annulation faite séance par séance : un email aux invités et l'annonce aux salons du club, avec le motif. C'est le geste demandé, pas un effet de bord.",
          phraseEcartees("annuler", lot),
          "Une séance annulée se rétablit tant qu'elle n'a pas commencé — mais l'annonce, elle, est partie.",
        ]),
      };
    case "retablir":
      return {
        titre: n === 1 ? "La séance redevient un cours prévu." : `Les ${n} séances redeviennent des cours prévus.`,
        phrases: reste(["Les réponses déjà données sont gardées. Aucun email ne part.", phraseEcartees("retablir", lot)]),
      };
    case "lieu":
    case "horaire": {
      const quoi = geste === "lieu" ? "Le lieu" : "L'horaire";
      const deja = ciblesGeste(geste, lot).length - n;
      return {
        titre: `${quoi} change sur ${n === 1 ? "la séance" : `les ${n} séances`}.`,
        phrases: reste([
          deja > 0 ? `${nbSeances(deja)} y ${deja > 1 ? "sont" : "est"} déjà : rien n'y change.` : null,
          "Aucun email ne part, comme pour une séance modifiée seule : si le cours est proche, préviens le club toi-même.",
        ]),
      };
    }
    case "supprimer": {
      const r = reponsesPerdues(touchees);
      return {
        titre: n === 1 ? "La séance disparaît, avec toutes les réponses des membres." : `Les ${n} séances disparaissent, avec toutes les réponses des membres.`,
        phrases: [
          r === 0 ? "Aucune réponse de membre n'est encore donnée sur ces séances." : `${pluriel(r, "réponse")} de membres ${r > 1 ? "seront effacées" : "sera effacée"}.`,
          "Les ateliers planifiés sur ces séances repassent en attente.",
          "Rien ne se récupère. Aucun email ne part. Un code de vérification peut t'être redemandé.",
        ],
      };
    }
  }
}

/**
 * **La question d'avant**, avec les chiffres qui doivent faire hésiter : le nombre d'annonces pour
 * une annulation, le nombre de réponses effacées pour une suppression.
 */
export function confirmationSeances(geste: GesteSeances, lot: readonly LigneSeance[], reglage: ReglageSeances = {}): string {
  const touchees = seancesQuiChangent(geste, lot, reglage);
  const n = touchees.length;
  const s = nbSeances(n);
  switch (geste) {
    case "annuler":
      return `Annuler ${s} ? ${phraseAnnonces(n)} — une par séance, aux invités et aux salons du club —, avec le motif « ${reglage.motif?.trim() ?? ""} ».`;
    case "retablir":
      return `Rétablir ${s} ?`;
    case "lieu":
      return `Déplacer ${s} à « ${reglage.lieu?.trim() ?? ""} » ? Personne n'est prévenu.`;
    case "horaire":
      return `Passer ${s} de ${reglage.heureDebut} à ${reglage.heureFin} ? Personne n'est prévenu.`;
    case "supprimer": {
      const r = reponsesPerdues(touchees);
      return `Supprimer définitivement ${s} et ${pluriel(r, "réponse")} de membres ? Rien ne se récupère.`;
    }
  }
}

/** Ce que la barre dit en clair, et que la région vivante annonce. */
export function compteurSeances(n: number): string {
  if (n === 0) return "";
  return n === 1 ? "1 séance sélectionnée" : `${n} séances sélectionnées`;
}

/**
 * **Les séances sans case**, et pourquoi : celles d'un trimestre clos. Leur geste se refuse au serveur
 * (`seancePourEcriture`) ; une case qui ne mènerait qu'à un refus serait pire que pas de case.
 */
export function texteSansCaseSeances(verrouillees: number): string | null {
  if (verrouillees === 0) return null;
  return verrouillees === 1
    ? "1 séance n'a pas de case : son trimestre est clos, elle ne se modifie plus."
    : `${verrouillees} séances n'ont pas de case : leur trimestre est clos, elles ne se modifient plus.`;
}
