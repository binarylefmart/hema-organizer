import { z } from "zod";
import { joursAvant } from "@/lib/dates";
import { ATELIER_STATUTS, FORME_WEBHOOK_DISCORD, NIVEAU_DEFAUT, NIVEAUX, PARTIE_DESCRIPTION_MAX, ROLES, THEME_MAX } from "@/lib/constants";
import { dateDepuisSaison, saisonsProposees } from "@/lib/blasons";
import { isHHMM, isIsoDate } from "@/lib/dates";
import { emailSchema } from "./auth";
import { identifiantSchema, SELECTION_MAX } from "./presences";

export const dateIsoSchema = z.string().refine(isIsoDate, "Date invalide (AAAA-MM-JJ attendu).");
export const heureSchema = z.string().refine(isHHMM, "Heure invalide (HH:MM attendu).");
const texteCourt = (max: number, msg = "Trop long.") => z.string().trim().max(max, msg);

/**
 * Adresse email **facultative** : une personne peut appartenir au club sans adresse (elle compte dans
 * l'effectif et dans les taux, mais ne reçoit aucun message et n'a pas de lien personnel).
 * Une case laissée vide — ou une colonne CSV absente — vaut « pas d'adresse » et s'enregistre en
 * **`null`**, jamais en `""` : l'index unique de `User.email` accepte autant de `null` qu'on veut,
 * mais refuserait la deuxième chaîne vide. Une adresse renseignée reste validée comme avant
 * (`emailSchema` : minuscules, format vérifié, unicité).
 */
export const emailFacultatifSchema = z
  .preprocess((v) => (typeof v === "string" ? v.trim() : v == null ? "" : v), z.union([z.literal(""), emailSchema]))
  .transform((v) => (v === "" ? null : v));

export const creneauSchema = z
  .object({
    jourSemaine: z.coerce.number().int().min(1).max(7),
    heureDebut: heureSchema,
    heureFin: heureSchema,
    lieu: texteCourt(120).min(1, "Indique le lieu."),
    adresse: texteCourt(200),
  })
  .refine((c) => c.heureFin > c.heureDebut, { path: ["heureFin"], message: "L'heure de fin doit suivre l'heure de début." });

/**
 * Étendue maximale d'une période, en jours : voir le `refine` de `periodeSchema`. Deux ans et demi — la
 * plus longue période qu'un club puisse vouloir tient largement dedans.
 */
export const ETENDUE_PERIODE_MAX_JOURS = 900;

export const periodeSchema = z
  .object({
    nom: texteCourt(60).min(1, "Donne un nom à la période (ex. T4 2026)."),
    dateDebut: dateIsoSchema,
    dateFin: dateIsoSchema,
  })
  .refine((p) => p.dateFin >= p.dateDebut, { path: ["dateFin"], message: "La date de fin doit suivre la date de début." })
  /*
   * **Une période a une étendue bornée**. `dateIsoSchema` accepte l'année 9999, et `genererSeances`
   * parcourt la période **jour par jour** : une période `2026-01-01 → 9999-12-31` avec un créneau
   * faisait calculer près de trois millions de dates candidates, puis insérer autant de lignes
   * `PeriodDateExclue` — le plafond de 400 ne portait que sur les dates **cochées**, pas sur le
   * travail engendré.
   *
   * Deux ans et demi : la plus longue période qu'un club puisse vouloir (`personnalisee`) tient
   * largement dedans, et aucune saison n'en approche.
   */
  .refine((p) => joursAvant(p.dateDebut, p.dateFin) <= ETENDUE_PERIODE_MAX_JOURS, {
    path: ["dateFin"],
    message: `Une période ne peut pas durer plus de ${Math.round(ETENDUE_PERIODE_MAX_JOURS / 365)} ans.`,
  });


export const generationSchema = z.object({
  dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2} ([01]\d|2[0-3]):[0-5]\d$/)).max(400),
});

/**
 * **Le lot de séances à retirer se valide comme celui à créer**. `supprimerSeancesPeriode` lisait
 * `fd.getAll("supprimer")` sans schéma, sans borne de forme et sans plafond, puis passait le
 * tableau à un `in` suivi d'un `deleteMany` : son voisin immédiat de l'écran, `generationSchema`,
 * plafonne pourtant à 400. Deux portes du même écran, deux exigences.
 */
export const retraitSeancesSchema = z.object({
  supprimer: z.array(z.string().min(1).max(64)).max(400),
});

/**
 * **La partie se désigne par son identifiant**, plus par son nom.
 *
 * Le nom était la clé (`MOITIE_1`…), donc une liste fermée que Zod vérifiait mot à mot. Les parties
 * étant devenues des lignes à part entière, ce qui arrive du réseau est un `cuid` : on en vérifie la
 * forme grossière (non vide, borné) et c'est la base qui tranche l'existence — vérifier ici qu'il
 * existe demanderait une requête que l'action fait de toute façon.
 */
export const partieIdSchema = z.string().min(1).max(64);

/**
 * **Combien de parties une séance peut porter, au plus.**
 *
 * Rien ne bornait l'ajout : `ajouterPartie` est une action serveur, donc une route ouverte, et une
 * boucle pouvait empiler des lignes jusqu'à faire déborder ce qui les recopie — l'objet de l'email
 * du soir, l'embed Discord, la fiche d'accueil. Un plafond ici règle la question à la source, une
 * fois, au lieu de la rattraper dans chaque message.
 *
 * Trente : le modèle du club en pose quatre, une séance très chargée en ateliers en atteint dix ;
 * trente laisse une marge que personne n'atteindra en rangeant son programme, et refuse net ce qui
 * n'est plus du rangement. C'est aussi la borne que `deplacerPartieSchema` applique au rang visé —
 * une seule valeur, pour qu'elles ne puissent pas se désaccorder.
 */
export const PARTIES_PAR_SEANCE_MAX = 30;

/**
 * Un encadrant **facultatif** : la case vide vaut « personne ». Même transformation pour celui qui
 * mène et celui qui assiste — deux champs de même nature ne doivent pas se valider différemment.
 */
const instructeurFacultatif = z.string().trim().max(40).transform((v) => v || null);

/**
 * Une case à cocher, reçue d'un objet (booléen) **ou** d'un formulaire (`"on"`, `"true"`, `"1"`,
 * ou rien du tout). Surtout pas `z.coerce.boolean()` : il rend `true` pour la chaîne `"false"`, et
 * une option cochée par erreur ne se voit qu'une fois la partie créée.
 */
const drapeau = z.preprocess((v) => (typeof v === "string" ? ["on", "true", "1"].includes(v.trim().toLowerCase()) : v ?? false), z.boolean());

export const casePlanningSchema = z.object({
  partieId: partieIdSchema,
  instructeurId: instructeurFacultatif,
  instructeurSecondId: instructeurFacultatif,
  theme: texteCourt(THEME_MAX, `${THEME_MAX} caractères maximum.`),
  /*
   * **La description : facultative, plafonnée, et publiée.**
   *
   * Même patron que le thème (texte libre coupé à sa longueur), et même `.default("")` que le niveau,
   * pour la même raison de mise en ligne : une grille déjà ouverte dans un navigateur au moment du
   * déploiement n'envoie pas encore ce champ, et refuser son enregistrement ferait perdre un geste à
   * quelqu'un qui n'a rien fait de mal. Une description absente est une description vide.
   *
   * Elle **sort du club** (API publique, pages de partage) comme le thème : c'est du texte sur le
   * contenu du cours, et c'est l'écran de saisie qui l'annonce (`CaseEditeur`).
   */
  description: texteCourt(PARTIE_DESCRIPTION_MAX, `${PARTIE_DESCRIPTION_MAX} caractères maximum.`).default(""),
  /*
   * Le niveau est un mot d'une liste fermée, jamais un texte libre : `enregistrerCase` est une
   * action exportée, donc une route ouverte sur le réseau, et ce qui entre ici ressort sur la page
   * publique de partage.
   *
   * `.default` plutôt qu'un champ obligatoire, pour une raison de mise en ligne : une grille déjà
   * ouverte dans un navigateur au moment du déploiement n'envoie pas encore ce champ, et refuser
   * son enregistrement ferait perdre un geste à quelqu'un qui n'a rien fait de mal. Un niveau
   * absent est un niveau indifférent.
   */
  niveau: z.enum(NIVEAUX).default(NIVEAU_DEFAUT),
});

/**
 * **Les quatre gestes qui font vivre les parties d'une séance** : ajouter, retirer, déplacer,
 * changer de nature.
 *
 * Ajouter et retirer sont deux gestes distincts de « remplir » et « vider » : vider une case ne
 * fait plus jamais disparaître sa ligne. Réordonner se fait par `versOrdre` — l'écran ne connaît
 * que « monter » et « descendre », mais l'action reçoit le rang visé, ce qui la rend juste quelle
 * que soit la façon dont l'écran l'appelle.
 *
 * **Aucun des quatre ne porte de libellé** : le nom d'une partie se calcule depuis son rang dans sa
 * nature, il n'arrive donc plus du réseau. `libellePartieSchema` a disparu avec le champ texte — un
 * schéma qui valide une saisie qui n'existe plus est une porte ouverte sur rien.
 */
export const nouvellePartieSchema = z.object({
  sessionId: z.string().min(1),
  // Le drapeau se règle **à l'ajout** : c'est là qu'on sait si la partie est un cours ou une option,
  // et c'est lui — avec le rang — qui décide du nom.
  estOption: drapeau.default(false),
});

/** Changer la nature d'une partie : cours ↔ option. Les deux séries se renumérotent ensuite. */
export const naturePartieSchema = z.object({
  partieId: partieIdSchema,
  estOption: drapeau,
});

export const retirerPartieSchema = z.object({ partieId: partieIdSchema });

export const deplacerPartieSchema = z.object({
  partieId: partieIdSchema,
  /*
   * Borné par le plafond d'une séance, **des deux côtés de zéro** : l'action ramène de toute façon le
   * rang dans les limites réelles (`Math.min(Math.max(versOrdre, 0), …)`) et promet de le faire —
   * « le rang visé est ramené dans les limites de la séance plutôt que refusé : un "monter" sur la
   * première ligne ne doit pas afficher d'erreur, il ne doit rien faire ». Un `min(0)` contredisait
   * cette promesse : « monter la première ligne » vaut `-1`, et Zod le **refusait** avant que
   * l'action n'ait la main — un message d'erreur rouge pour un geste qui devait être sans effet.
   * Au-delà d'une séance entière, dans un sens comme dans l'autre, ce n'est plus un déplacement : là,
   * le refus est juste.
   */
  versOrdre: z.coerce.number().int().min(-PARTIES_PAR_SEANCE_MAX).max(PARTIES_PAR_SEANCE_MAX),
});

export const themesSchema = z.object({
  texte: z.string().max(4000, "Liste trop longue."),
});

/** Saisie des lieux habituels : une ligne par salle, « Nom | Adresse ». La mise en forme est dans `src/lib/lieux.ts`. */
export const lieuxSchema = z.object({
  // 4 000 caractères : trente salles avec leur adresse tiennent largement, et une zone de texte
  // collée par erreur (un CSV entier) est refusée avant d'atteindre la base.
  texte: z.string().max(4000, "Liste trop longue."),
});

export const seanceSchema = z
  .object({
    periodId: z.string().min(1),
    date: dateIsoSchema,
    heureDebut: heureSchema,
    heureFin: heureSchema,
    lieu: texteCourt(120).min(1, "Indique le lieu."),
    adresse: texteCourt(200),
  })
  .refine((s) => s.heureFin > s.heureDebut, { path: ["heureFin"], message: "L'heure de fin doit suivre l'heure de début." });

export const annulationSchema = z.object({
  sessionId: z.string().min(1),
  motif: texteCourt(200).min(1, "Indique le motif (il sera envoyé aux membres)."),
});

/**
 * **Un geste sur plusieurs séances à la fois** (`appliquerGesteSeancesEnMasse`), depuis l'onglet
 * Séances en mode modification.
 *
 * Chaque geste reprend **le schéma de son geste unitaire**, champ pour champ : le motif d'annulation
 * est celui d'`annulationSchema`, le lieu et l'horaire ceux de `seanceSchema` (mêmes longueurs, même
 * « la fin suit le début »). Un lot qui accepterait un motif de 500 signes là où la séance seule en
 * refuse 201 serait une seconde porte, plus large, vers le même message envoyé à tout le club.
 *
 * Le plafond et la forme d'un identifiant sont ceux de tous les gestes de masse du dépôt
 * (`SELECTION_MAX`, `identifiantSchema`) : un lot plus gros que le plus gros club imaginable n'est pas
 * un geste d'encadrement, c'est un appel forgé. Les doublons sont écartés ici, comme pour les
 * présences : une séance cochée deux fois ne s'écrit ni ne s'annonce deux fois.
 */
const seancesDuLot = z
  .array(identifiantSchema)
  .min(1, "Coche au moins une séance.")
  .max(SELECTION_MAX, "Sélection trop grande.")
  .transform((ids) => [...new Set(ids)]);

export const GESTES_SEANCES_MASSE = ["annuler", "retablir", "lieu", "horaire", "supprimer"] as const;
export type GesteSeancesMasse = (typeof GESTES_SEANCES_MASSE)[number];

export const seancesEnMasseSchema = z.discriminatedUnion("geste", [
  z.object({ geste: z.literal("annuler"), sessionIds: seancesDuLot, motif: annulationSchema.shape.motif }),
  z.object({ geste: z.literal("retablir"), sessionIds: seancesDuLot }),
  z.object({ geste: z.literal("lieu"), sessionIds: seancesDuLot, lieu: texteCourt(120).min(1, "Indique le lieu."), adresse: texteCourt(200) }),
  z
    .object({ geste: z.literal("horaire"), sessionIds: seancesDuLot, heureDebut: heureSchema, heureFin: heureSchema })
    .refine((s) => s.heureFin > s.heureDebut, { path: ["heureFin"], message: "L'heure de fin doit suivre l'heure de début." }),
  z.object({ geste: z.literal("supprimer"), sessionIds: seancesDuLot }),
]);

/**
 * **La fiche d'un membre**, telle que l'annuaire l'enregistre — plus « Au club depuis », choisi en
 * **saison d'arrivée** (« 2024-2025 », envoyée comme l'année de sa rentrée) et rangé en **date**
 * (`auClubDepuis`, le 1er septembre de cette saison).
 *
 * Le club se compte en saisons : on choisit la saison, on relit la même. Une saisie en durée
 * (années + mois) était reculée depuis le jour de la saisie puis ramenée à la rentrée, et se relisait
 * autrement qu'on l'avait tapée. **Vide vaut `null`**, c'est-à-dire « le club ne sait pas » :
 * l'ancienneté repart alors de la création du compte, et c'est aussi la façon d'effacer une saisie
 * approximative. Seules les saisons proposées par la liste sont acceptées : jamais une saison à
 * venir, jamais une faute de frappe de trois siècles.
 */
const saisonArrivee = z.preprocess(
  (v) => (typeof v === "string" ? v.trim() : v == null ? "" : v),
  z.union([
    z.literal("").transform(() => null),
    z.coerce
      .number()
      .int("Choisis une saison dans la liste.")
      .refine((an) => saisonsProposees().includes(an), "Choisis une saison dans la liste."),
  ]),
);

export const membreSchema = z
  .object({
    prenom: texteCourt(60).min(1, "Indique le prénom."),
    nom: texteCourt(60).min(1, "Indique le nom."),
    email: emailFacultatifSchema,
    role: z.enum(ROLES),
    saisonArrivee,
  })
  // Le formulaire parle en durée, la base en date : la fiche ressort avec exactement les colonnes de
  // `User`, et personne n'a à se souvenir de faire la conversion au moment d'enregistrer.
  .transform(({ saisonArrivee, ...fiche }) => ({ ...fiche, auClubDepuis: dateDepuisSaison(saisonArrivee) }));

/**
 * Ligne d'import CSV.
 *
 * Le schéma **accepte** encore le rôle ADMIN, mais `importerMembres` (src/actions/membres.ts)
 * **écarte la ligne** en le disant :, un administrateur ne se crée plus de zéro, il se *nomme*
 * parmi les personnes de l'annuaire (onglet « Comptes admin »). Le schéma le laisse passer pour que
 * l'action puisse nommer la ligne fautive dans son compte rendu plutôt que de rendre un « ligne
 * invalide » sans explication. Il n'y a plus de ré-authentification 2FA liée à ce cas : il
 * n'aboutit jamais.
 */
export const ligneCsvSchema = z.object({
  prenom: texteCourt(60).min(1),
  nom: texteCourt(60).min(1),
  email: emailFacultatifSchema,
  role: z.enum(ROLES).default("MEMBRE"),
});

/** Proposition d'atelier : aucun champ obligatoire, mais pas de formulaire entièrement vide. */
export const atelierSchema = z
  .object({
    titre: texteCourt(80),
    description: z.string().trim().max(1500, "1500 caractères maximum."),
    materiel: texteCourt(300),
    sessionId: z.string().max(64).optional().or(z.literal("").transform(() => undefined)),
  })
  .refine((a) => a.titre || a.description, { path: ["titre"], message: "Écris au moins un titre ou une phrase." });

export const decisionAtelierSchema = z.object({
  atelierId: z.string().min(1),
  statut: z.enum(ATELIER_STATUTS),
  commentaire: texteCourt(500).optional(),
  sessionId: z.string().max(64).optional().or(z.literal("").transform(() => undefined)),
});

export const recapHourSchema = z.object({ recapHour: heureSchema });

/**
 * **Deux réglages, deux formulaires**.
 *
 * Les deux vivaient dans un seul formulaire, sous un seul bouton « Enregistrer » : publier les cours
 * sur le site du club et prévenir le bureau qu'un accès a été volé se réglaient d'un même geste,
 * dans une carte appelée « Partage et alertes », au milieu de l'écran des notifications. Une case
 * lue de travers ouvrait donc au public un calendrier que personne n'avait décidé de publier.
 *
 * **Et il fallait bien deux schémas, pas un seul coupé en deux à l'usage** : une case absente d'un
 * envoi vaut « décochée » (c'est ainsi que les cases HTML fonctionnent, voir `caseCochee`). Deux
 * formulaires qui partageraient ce schéma éteindraient donc l'autre réglage à chaque
 * enregistrement, en silence.
 */
export const publicationCoursSchema = z.object({
  publicApiEnabled: z.boolean(),
});

export const alertesSecuriteSchema = z.object({
  alertesSecurite: z.boolean(),
});

/** Le seul réglage purement technique restant : la durée de conservation du journal d'audit. */
export const retentionAuditSchema = z.object({
  auditRetentionJours: z.coerce.number().int().min(30, "30 jours minimum.").max(3650, "10 ans maximum."),
});

/** URL d'un webhook Discord (écran *Notifications → Canal Discord*). */
export const webhookDiscordSchema = z.object({
  discordWebhookUrl: z
    .string()
    .trim()
    .max(300)
    // La forme vient de `src/lib/constants.ts` : la variable de la stack lit **la même**
    // (`normaliserWebhookDiscord`), et une valeur refusée ici mais acceptée là n'aurait rien vérifié.
    .refine((u) => u === "" || FORME_WEBHOOK_DISCORD.test(u), "URL de webhook Discord invalide."),
});
