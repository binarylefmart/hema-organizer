import { z } from "zod";
import { ATTENDANCE_STATUTS } from "@/lib/constants";

/**
 * **Ce qu'une correction de registre a le droit de contenir.**
 *
 * Les deux corrections — une personne, ou un lot — partagent volontairement le **même** schéma de
 * statut : une action en masse qui accepterait une valeur que l'action unitaire refuse serait une
 * porte dérobée, et c'est exactement le genre de divergence qui ne se voit pas à la relecture.
 */

/** Un identifiant venu du réseau : forme grossière ici, c'est la base qui tranche l'existence. */
export const identifiantSchema = z.string().min(1).max(64);

/**
 * Le statut tel que l'écran l'envoie.
 *
 * Le bureau saisit « sans réponse » avec une case vide (le `<select>` renvoie `""`), pas avec le
 * mot `null` : on ramène les deux à la même chose plutôt que de rejeter la forme la plus naturelle.
 * `null` **efface** la ligne de présence — on distingue « n'a rien dit » de « a dit non », et seule
 * l'absence de ligne exprime la première.
 */
export const statutCorrigeSchema = z
  .union([z.literal(""), z.enum(ATTENDANCE_STATUTS), z.null()])
  .transform((v) => (v === "" ? null : v));

/** La correction d'une seule personne. */
export const presenceAutruiSchema = z.object({
  sessionId: identifiantSchema,
  userId: identifiantSchema,
  statut: statutCorrigeSchema,
});

/**
 * **Combien de personnes un seul lot peut porter.**
 *
 * Une server action est une route ouverte : rien n'oblige l'appelant à passer par l'écran, et une
 * boucle pourrait y empiler des dizaines de milliers d'identifiants — autant de lignes à lire, à
 * écrire et à journaliser dans une seule transaction, sur une base SQLite. Cinq cents laisse une
 * marge confortable au plus gros club imaginable (le dossier parle de quatre-vingts) tout en
 * bornant la casse. Ce n'est **pas** un réglage de club : c'est un garde-fou technique, et l'écran
 * ne peut de toute façon proposer que les invités de la période.
 */
export const SELECTION_MAX = 500;

/**
 * La correction d'un lot.
 *
 * Les doublons sont **écartés ici** (`Set`) plutôt que plus bas : une même case cochée deux fois —
 * un identifiant répété par un appelant maladroit — ne doit pas produire deux écritures ni deux
 * entrées de journal pour la même personne.
 */
export const presencesEnMasseSchema = z.object({
  sessionId: identifiantSchema,
  userIds: z
    .array(identifiantSchema)
    .min(1, "Sélectionne au moins une personne.")
    .max(SELECTION_MAX, "Sélection trop grande.")
    .transform((ids) => [...new Set(ids)]),
  statut: statutCorrigeSchema,
});
