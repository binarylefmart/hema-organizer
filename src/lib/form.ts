import type { ZodError } from "zod";

/** État standard renvoyé par les server actions de formulaire (useActionState). */
export type FormState = {
  erreur?: string;
  erreurs?: Record<string, string>;
  succes?: string;
};

export const FORM_INITIAL: FormState = {};

/** Convertit une erreur Zod en messages par champ (+ message global). */
/**
 * Nom lisible d'un champ, pour la liste d'erreurs sous un formulaire. Sans cette table, l'écran
 * affichait le nom technique du champ — « imageUrl : Indique un lien… » —, ce qui ne veut rien dire
 * pour quelqu'un qui remplit une annonce. Un champ absent de la table garde son nom : mieux vaut un
 * nom technique qu'une erreur muette.
 */
const LIBELLES: Record<string, string> = {
  nom: "Nom",
  description: "Description",
  dateDebut: "Date de début",
  heureDebut: "Heure de début",
  dateFin: "Date de fin",
  heureFin: "Heure de fin",
  lieu: "Lieu",
  adresse: "Adresse",
  organisateur: "Organisateur",
  lienInscription: "Lien d'inscription",
  lienSource: "Publication d'origine",
  imageUrl: "Affiche",
  email: "Email",
  prenom: "Prénom",
  motDePasse: "Mot de passe",
  theme: "Thème",
  titre: "Titre",
  // Les deux cases de « Au club depuis » : sans ces libellés, la liste d'erreurs sous la fiche
  // afficherait « saisonArrivee », qui ne veut rien dire pour qui remplit un annuaire.
  saisonArrivee: "Arrivé(e) au club la saison",
  // Les deux animateurs d'une proposition d'atelier.
  animateurId: "Qui anime ?",
  animateurSecondId: "Second animateur",
};

export function libelleChamp(nom: string): string {
  return LIBELLES[nom] ?? nom;
}

export function zodToFormState(err: ZodError): FormState {
  const erreurs: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = String(issue.path[0] ?? "_");
    if (!erreurs[key]) erreurs[key] = issue.message;
  }
  return { erreur: "Vérifie les champs en rouge.", erreurs };
}

export function champ(fd: FormData, name: string): string {
  const v = fd.get(name);
  return typeof v === "string" ? v : "";
}

export function caseCochee(fd: FormData, name: string): boolean {
  return fd.get(name) === "on" || fd.get(name) === "true";
}
