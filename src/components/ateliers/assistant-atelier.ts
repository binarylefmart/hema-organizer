/**
 * **« Proposer un atelier » en quatre questions, sur téléphone** — la partie pure, donc testable.
 *
 * Sur un téléphone, le formulaire d'une traite demandait de deviner ce qui était obligatoire et ce
 * qui ne l'était pas, au milieu de six champs. L'assistant pose une question par écran, et chaque
 * étape ne laisse passer que ce que le serveur accepterait (`atelierSchema`) : les mêmes plafonds,
 * la même règle « un titre ou une phrase », le même « second animateur, une autre personne ».
 *
 * **Le serveur ne voit aucune différence** : un seul `<form>`, les mêmes noms de champs, la même
 * action (`proposerAtelier`). Les étapes cachent et montrent des `<fieldset>`, les valeurs restent
 * dans le DOM. Ce module ne dit donc que deux choses : ce qu'une étape exige, et à quelle étape
 * ramener quand le serveur refuse un champ.
 */

import { listeCherchable, type EntreeListe } from "@/components/ui/liste-deroulante";

/** Les noms de champs que lit `proposerAtelier` — ni plus, ni moins. */
export type ChampAtelier = "titre" | "description" | "animateurId" | "animateurSecondId" | "materiel" | "sessionId";

/** La saisie en cours, champ par champ, telle qu'elle partira dans le `FormData`. */
export type SaisieAtelier = Record<ChampAtelier, string>;

/** Les plafonds de `atelierSchema`, repris tels quels (un test les relie au schéma). */
export const PLAFONDS_ATELIER = { titre: 80, description: 1500, materiel: 300 } as const;

/** Les quatre étapes, dans l'ordre : leur titre court, leur question, et les champs qu'elles portent. */
export const ETAPES_ATELIER = [
  { titre: "L'idée", question: "Quelle est ton idée ?", champs: ["titre", "description"] },
  { titre: "Qui anime ?", question: "Qui anime ?", champs: ["animateurId", "animateurSecondId"] },
  { titre: "Le matériel", question: "Faut-il du matériel ?", champs: ["materiel"] },
  { titre: "La séance", question: "Une séance en tête ?", champs: ["sessionId"] },
] as const satisfies readonly { titre: string; question: string; champs: readonly ChampAtelier[] }[];

export const NB_ETAPES_ATELIER = ETAPES_ATELIER.length;

/** « Étape 2 sur 4 » — les étapes se comptent à partir de 1, comme on les lit. */
export const libelleProgression = (etape: number) => `Étape ${etape} sur ${NB_ETAPES_ATELIER}`;

/** L'étape qui porte un champ ; un nom inconnu (erreur générale) ramène à la dernière. */
export function etapeDuChamp(champ: string): number {
  const i = ETAPES_ATELIER.findIndex((e) => (e.champs as readonly string[]).includes(champ));
  return i === -1 ? NB_ETAPES_ATELIER : i + 1;
}

/** **La première étape fautive** d'un refus du serveur : c'est là que l'assistant ramène. */
export function premiereEtapeFautive(erreurs: Record<string, string> | undefined): number | null {
  const champs = Object.keys(erreurs ?? {});
  return champs.length ? Math.min(...champs.map(etapeDuChamp)) : null;
}

const TROP_LONG = "Trop long.";

/**
 * **Ce qu'une étape refuse**, champ par champ — vide quand elle peut passer. Mêmes règles et mêmes
 * mots que le serveur, plus une seule, propre à l'assistant : « Quelqu'un d'autre… » sans personne
 * choisie. Le serveur lirait ce vide comme « la personne qui propose », ce qui contredirait le choix
 * qu'on vient de faire à l'écran.
 */
export function erreursEtape(etape: number, s: SaisieAtelier): Partial<Record<ChampAtelier, string>> {
  const erreurs: Partial<Record<ChampAtelier, string>> = {};
  switch (etape) {
    case 1:
      if (s.titre.trim().length > PLAFONDS_ATELIER.titre) erreurs.titre = TROP_LONG;
      else if (!s.titre.trim() && !s.description.trim()) erreurs.titre = "Écris au moins un titre ou une phrase.";
      if (s.description.trim().length > PLAFONDS_ATELIER.description) erreurs.description = `${PLAFONDS_ATELIER.description} caractères maximum.`;
      break;
    case 2:
      if (!s.animateurId) erreurs.animateurId = "Choisis qui anime.";
      else if (s.animateurSecondId && s.animateurSecondId === s.animateurId) erreurs.animateurSecondId = "Le second animateur doit être une autre personne.";
      break;
    case 3:
      if (s.materiel.trim().length > PLAFONDS_ATELIER.materiel) erreurs.materiel = TROP_LONG;
      break;
  }
  return erreurs;
}

/** La première étape qui ne passerait pas, au moment d'envoyer — `null` si tout passe. */
export function premiereEtapeIncomplete(s: SaisieAtelier): number | null {
  for (let etape = 1; etape <= NB_ETAPES_ATELIER; etape++) {
    if (Object.keys(erreursEtape(etape, s)).length) return etape;
  }
  return null;
}

/**
 * **Des puces tant que la liste ne réclamerait pas de recherche**, la liste du dépôt au-delà. C'est
 * la même règle que le champ de recherche (`listeCherchable`, « pas plus de vingt ») : une rangée de
 * quatre-vingts puces serait l'annuaire à parcourir du doigt, exactement ce que la recherche évite.
 */
export const enPuces = (entrees: readonly EntreeListe[]) => !listeCherchable(entrees);

/**
 * **Les erreurs à montrer sous les champs** : celles de l'assistant, et celles du dernier retour du
 * serveur **pour les seuls champs qu'on n'a pas retouchés depuis**. Un refus du serveur décrit la
 * saisie envoyée, pas celle qu'on est en train de corriger : laissé sous le champ, il continuait de
 * dire « Trop long » à un titre déjà raccourci, jusqu'au prochain envoi. Les erreurs de l'assistant,
 * elles, se recalculent à chaque « Suivant » et passent devant.
 */
export function erreursAffichees(
  serveur: Readonly<Record<string, string>> | undefined,
  locales: Partial<Record<ChampAtelier, string>>,
  corriges: ReadonlySet<string>,
): Partial<Record<string, string>> {
  const restantes: Partial<Record<string, string>> = {};
  for (const [champ, message] of Object.entries(serveur ?? {})) {
    if (!corriges.has(champ)) restantes[champ] = message;
  }
  return { ...restantes, ...locales };
}

/**
 * **Une proposition vient-elle d'arriver ?** — un identifiant que la liste précédente ne portait pas.
 * C'est le seul signe, vu de l'écran, d'un envoi réussi (l'action redirige vers la même adresse à
 * chaque fois) ; et c'est le seul moment où l'assistant doit repartir de zéro. Retirer une ancienne
 * proposition, ou la plus récente, ne fait que raccourcir la liste : le brouillon en cours reste.
 */
export function nouvelleProposition(avant: readonly string[], apres: readonly string[]): boolean {
  const connus = new Set(avant);
  return apres.some((id) => !connus.has(id));
}
