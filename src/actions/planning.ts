"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { formatDateSansAnnee, minuscule, todayIso } from "@/lib/dates";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { assertPermission } from "@/lib/auth/current-user";
import {
  ecritureFermee,
  libelleNiveau,
  NIVEAU_DEFAUT,
  prochainLibellePartie,
  REFUS_PERIODE_CLOSE,
} from "@/lib/constants";
import { notifierDecisionAtelier } from "@/lib/notifications/ateliers";
import { champ, zodToFormState, type FormState } from "@/lib/form";
import {
  nettoyerThemes,
  partieLibre,
  placerAtelier,
  rangerParties,
  setLieux,
  setThemes,
  synchroniserSeance,
} from "@/lib/planning";
import { sequenceRangee } from "@/components/planning/rangement";
import { transitionAutorisee } from "@/lib/ateliers";
import { estCompteDeService } from "@/lib/permissions";
import {
  casePlanningSchema,
  deplacerPartieSchema,
  lieuxSchema,
  naturePartieSchema,
  nouvellePartieSchema,
  partiesEnMasseSchema,
  PARTIES_PAR_SEANCE_MAX,
  partieIdSchema,
  retirerPartieSchema,
  themesSchema,
} from "@/lib/validation/gestion";
import { SELECTION_MAX } from "@/lib/validation/presences";
import { nettoyerLieux } from "@/lib/lieux";

function rafraichir(sessionId?: string) {
  revalidatePath("/planning");
  revalidatePath("/seances");
  revalidatePath("/");
  revalidatePath("/gestion/ateliers");
  if (sessionId) revalidatePath(`/seances/${sessionId}`);
}

/**
 * **La partie, la séance qui la porte, et le droit d'y toucher** — la porte commune des actions qui
 * suivent.
 *
 * Toutes reçoivent un `partieId` (le nom de la partie n'est plus sa clé) : la séance et sa période
 * se retrouvent depuis la ligne, et non depuis ce que l'écran a bien voulu envoyer. Un identifiant
 * recopié dans une requête forgée ne peut donc pas faire écrire dans une autre séance que la sienne.
 */
async function partiePourEcriture(partieId: string) {
  const partie = await db.sessionPartie.findUnique({
    where: { id: partieId },
    include: {
      instructeur: { select: { prenom: true, nom: true } },
      instructeurSecond: { select: { prenom: true, nom: true } },
      session: {
        select: { id: true, date: true, annulee: true, period: { select: { statut: true } } },
      },
    },
  });
  if (!partie) return { erreur: "Cette partie n'existe plus." } as const;
  // La règle et sa phrase vivent dans `src/lib/constants.ts` : quatre endroits la recopiaient.
  if (ecritureFermee(partie.session.period.statut))
    return { erreur: REFUS_PERIODE_CLOSE.planning } as const;
  /*
   * **Une séance annulée n'a plus de programme à régler**. Cette porte ne regardait que le
   * trimestre : on pouvait donc remplir, par un appel forgé, le programme d'un cours annulé — qui
   * **sort du club** (pages de partage, API publique si le club l'a ouverte), où il annoncerait un
   * contenu pour une soirée qui n'a pas lieu.
   *
   * Ce n'était pas un oubli isolé mais une **divergence** : `programmerAtelierDansCase` refusait
   * déjà l'annulation de son côté, si bien que deux portes vers la même écriture avaient deux
   * serrures — ce que le dossier s'interdit. Et rien n'est perdu pour l'équipe : l'écran ne montre
   * aucun programme sur une séance annulée, et `retablirSeance` existe — on rétablit, puis on règle.
   */
  if (partie.session.annulee) return { erreur: "Cette séance est annulée : son programme n'a plus d'objet. Rétablis-la d'abord." } as const;
  return { partie } as const;
}

/** Même contrôle pour la séance elle-même (ajout d'une partie : il n'y a pas encore de ligne). */
async function seancePourEcriture(sessionId: string) {
  const session = await db.session.findUnique({
    where: { id: sessionId },
    select: { id: true, date: true, annulee: true, period: { select: { statut: true } } },
  });
  if (!session) return { erreur: "Séance introuvable." } as const;
  if (ecritureFermee(session.period.statut))
    return { erreur: REFUS_PERIODE_CLOSE.planning } as const;
  // Même règle que pour une partie existante, et pour la même raison : ajouter une ligne au
  // programme d'un cours annulé n'a pas d'objet, et ce programme sort du club.
  if (session.annulee) return { erreur: "Cette séance est annulée : son programme n'a plus d'objet. Rétablis-la d'abord." } as const;
  return { session } as const;
}

/** Une personne peut-elle encadrer une partie ? (compte vivant, et pas le compte de service) */
async function instructeurUtilisable(
  id: string | null,
  /**
   * Qui était **déjà** posé sur cette case. Une valeur inchangée n'est pas un choix : c'est ce que
   * la case portait déjà, et on doit pouvoir enregistrer le thème d'une partie sans être forcé de
   * remplacer son instructeur.
   *
   * Sans cette exception, une case dont l'instructeur a été **désactivé** en cours de trimestre
   * devenait inenregistrable : le refus « Cette personne n'existe plus » tombait sur une valeur
   * qu'on ne touchait pas, et bloquait du même coup le thème, le niveau et la description. Le
   * défaut existait avant, mais il était invisible — la liste déroulante ne proposait plus la
   * personne, le champ retombait sur « ---------- » et le premier enregistrement effaçait son nom
   * en silence. Depuis que la liste la retient (`personnesPlanning`, `dejaPosees`), le nom
   * s'affiche : le refus devient donc visible, et il faut le rendre juste.
   *
   * On **n'assouplit rien d'autre** : poser une personne désactivée sur une case où elle n'était pas
   * reste refusé. L'exception ne couvre que « laisser en place ce qui est déjà écrit ».
   */
  dejaPose: string | null = null,
): Promise<string | null> {
  if (!id) return null;
  if (id === dejaPose) return null;
  const personne = await db.user.findUnique({
    where: { id },
    select: { actif: true, service: true },
  });
  if (!personne?.actif) return "Cette personne n'existe plus.";
  // Le compte de connexion du portail n'est pas une personne du club : il n'anime aucune partie
  if (estCompteDeService(personne))
    return "Ce compte ne peut pas être instructeur.";
  return null;
}

/** Les réglages d'une case, tels que le schéma les rend : la même forme pour une case ou pour un lot. */
type ReglagesCase = z.infer<typeof casePlanningSchema>;

/** La case telle que `partiePourEcriture` la rend — avec sa séance, ses noms et son atelier. */
type CaseAvant = Extract<
  Awaited<ReturnType<typeof partiePourEcriture>>,
  { partie: unknown }
>["partie"];

/**
 * **Les trois refus d'une case, écrits une fois pour les deux portes.**
 *
 * `enregistrerCase` les rendait en clair dans son corps. Depuis qu'un **lot** passe par les mêmes
 * verrous (`enregistrerCases`), la phrase doit venir du même endroit : deux portes vers la même
 * écriture ne peuvent pas avoir deux serrures, et elles ne peuvent pas non plus donner deux raisons
 * différentes pour le même refus — c'est ainsi qu'on s'aperçoit, six mois plus tard, que l'une des
 * deux avait cessé de refuser. Le lot préfixe ces phrases du nom de la case fautive
 * (`nommerCase`) et n'en change pas un mot.
 */
const REFUS_CASE = {
  atelier:
    "Cette case est réservée à un atelier programmé : passe par la gestion des ateliers pour la changer.",
  // Une même personne ne peut pas s'assister elle-même : deux fois le même nom sur une ligne du
  // programme n'annonce rien de plus, et fausserait la lecture de « qui encadre ».
  memePersonne: "Choisis deux personnes différentes pour mener et assister.",
  /*
   * **Un second sans premier est refusé ici, et pas seulement à l'écran.** La grille l'interdit
   * déjà, mais ces actions sont des routes ouvertes sur le réseau : sans ce refus, l'état entrait en
   * base et coupait l'application en deux moitiés qui se contredisent — `caseVide` et
   * `partieLibrePourAtelier` tenaient la case pour occupée (plus aucun atelier ne pouvait s'y
   * poser), `synchroniserSeance` inscrivait la personne dans les instructeurs de la séance (récap
   * du soir, alerte « peu de monde »), et l'affichage, lui, faisait disparaître la ligne entière.
   *
   * On ferme la porte plutôt que de faire remonter le second au rang de premier : celui qui assiste
   * n'a pas décidé de mener, et une promotion silencieuse écrirait son nom en tête du programme
   * sans que personne ne l'ait demandé. Vider les deux d'un coup reste évidemment permis.
   */
  secondSansPremier:
    "Indique d'abord qui mène la partie : le second instructeur vient assister quelqu'un.",
} as const;

/**
 * **Sans thème, ni niveau ni description.** La grille ne montre ces deux champs qu'une fois un thème
 * choisi, comme le second instructeur attend le premier. Ici on vide plutôt que de refuser : une case
 * qui portait déjà un niveau sans thème doit rester enregistrable, et ce qu'elle perd n'avait plus de
 * champ pour être relu. La description, elle, est publiée hors du club : une phrase sans thème qui
 * sortirait sans que la grille la montre serait la pire des deux issues.
 */
function sansThemeNiDetails(c: { theme: string; description: string; niveau: string }): void {
  if (c.theme.trim()) return;
  c.description = "";
  c.niveau = NIVEAU_DEFAUT;
}

/**
 * **Une case dont les cinq valeurs sont déjà celles de la base n'est pas une écriture.**
 *
 * `SessionPartie.updatedAt` est un `@updatedAt`, et la grille l'affiche dans « Modifié par … le … » :
 * repeindre cette bulle pour un enregistrement qui ne change rien ferait mentir l'écran — et, dans un
 * lot, ferait mentir **toute une séance** d'un coup. Même doctrine que `rangerParties`, qui renomme
 * ses voisines sans toucher leur horodatage.
 *
 * La comparaison vit ici parce que les deux portes doivent peser exactement les mêmes cinq champs :
 * une case « inchangée » pour l'une et « modifiée » pour l'autre, c'est une entrée de journal qui
 * apparaît ou disparaît selon l'écran par lequel on est passé.
 */
function caseInchangee(avant: CaseAvant, r: ReglagesCase): boolean {
  return (
    avant.instructeurId === r.instructeurId &&
    avant.instructeurSecondId === r.instructeurSecondId &&
    avant.theme === r.theme &&
    avant.description === r.description &&
    (avant.niveau || NIVEAU_DEFAUT) === r.niveau
  );
}

/**
 * **Ce que le journal d'audit retient d'une case écrite**, pour le geste unitaire comme pour le lot.
 *
 * Tout est **nominatif** (`nomDe`) et lisible : la date de la séance, le nom de la partie, et les cinq
 * valeurs avant / après. Le journal ne porte aucun identifiant de ligne — il se lit, il ne se
 * déréférence pas. Les deux portes partagent cette fonction pour que `/admin/audit?q=planning.case`
 * retrouve **tout** ce qui a été écrit dans le planning sous une seule forme, quel que soit le geste.
 */
function detailsCase(
  avant: CaseAvant,
  apres: {
    instructeur: { prenom: string; nom: string } | null;
    instructeurSecond: { prenom: string; nom: string } | null;
  },
  r: ReglagesCase,
): Record<string, unknown> {
  return {
    date: avant.session.date,
    partie: avant.libelle,
    avant: {
      instructeur: nomDe(avant.instructeur),
      instructeurSecond: nomDe(avant.instructeurSecond),
      theme: avant.theme,
      description: avant.description,
      niveau: libelleNiveau(avant.niveau),
    },
    apres: {
      instructeur: nomDe(apres.instructeur),
      instructeurSecond: nomDe(apres.instructeurSecond),
      theme: r.theme,
      description: r.description,
      niveau: libelleNiveau(r.niveau),
    },
  };
}

/**
 * Enregistre une case du planning (les deux instructeurs + thème + description + niveau).
 *
 * **Réservé à l'équipe** — `planning.edit` vaut pour ADMIN et INSTRUCTEUR (voir
 * `src/lib/permissions.ts`), et c'est aussi ce que la page applique (`modifiable`, dans
 * `src/lib/planning.ts`) : un membre invité consulte le planning, il ne le remplit pas.
 *
 * Chaque changement est journalisé (avant / après) pour que le bureau puisse suivre qui fait quoi.
 *
 * **Vider une case ne retire plus jamais la partie**. La ligne était effacée quand ses trois
 * réglages revenaient à vide : le geste « j'efface ce que j'avais écrit » supprimait du même coup
 * la ligne du programme, que plus rien ne permettait de récupérer sinon en la recréant. Ce sont
 * deux gestes différents, et `retirerPartie` fait le second.
 *
 * **Dernier arrivé gagne**, volontairement : deux personnes sur la même case, la seconde écrase la
 * première, dont l'écran continue d'afficher sa propre valeur jusqu'au prochain rafraîchissement.
 * Le couple avant/après reste dans le journal d'audit, donc rien n'est perdu.
 */
export async function enregistrerCase(input: {
  partieId: string;
  instructeurId: string;
  instructeurSecondId?: string;
  theme: string;
  description?: string;
  niveau: string;
}): Promise<FormState> {
  const user = await assertPermission("planning.edit");
  const parsed = casePlanningSchema.safeParse({
    instructeurSecondId: "",
    ...input,
  });
  if (!parsed.success) return zodToFormState(parsed.error);
  sansThemeNiDetails(parsed.data);
  const {
    partieId,
    instructeurId,
    instructeurSecondId,
    theme,
    description,
    niveau,
  } = parsed.data;

  const ctx = await partiePourEcriture(partieId);
  if ("erreur" in ctx) return ctx;
  const avant = ctx.partie;
  if (avant.atelierId) return { erreur: REFUS_CASE.atelier };
  if (instructeurId && instructeurId === instructeurSecondId)
    return { erreur: REFUS_CASE.memePersonne };
  if (!instructeurId && instructeurSecondId)
    return { erreur: REFUS_CASE.secondSansPremier };
  for (const [id, dejaPose] of [
    [instructeurId, avant.instructeurId],
    [instructeurSecondId, avant.instructeurSecondId],
  ] as const) {
    const refus = await instructeurUtilisable(id, dejaPose);
    if (refus) return { erreur: refus };
  }
  if (caseInchangee(avant, parsed.data)) return { succes: "Rien à changer." };

  const apres = await db.sessionPartie.update({
    where: { id: partieId },
    data: {
      instructeurId,
      instructeurSecondId,
      theme,
      description,
      niveau,
      modifieParId: user.id,
    },
    include: {
      instructeur: { select: { prenom: true, nom: true } },
      instructeurSecond: { select: { prenom: true, nom: true } },
    },
  });
  await synchroniserSeance(avant.sessionId);
  await audit(
    user,
    "planning.case",
    avant.sessionId,
    detailsCase(avant, apres, parsed.data),
  );
  rafraichir(avant.sessionId);
  return { succes: "Enregistré" };
}

/** « Prénom Nom », ou `null` : le journal d'audit lit des noms, pas des identifiants. */
function nomDe(p: { prenom: string; nom: string } | null): string | null {
  return p ? `${p.prenom} ${p.nom}` : null;
}

/**
 * **Combien de cases un seul lot peut porter : `SELECTION_MAX`, et pas un nombre de plus.**
 *
 * La question posée ici est **exactement** celle des présences en masse et des trois gestes de
 * l'annuaire — « combien de lignes une server action accepte-t-elle d'un coup, sachant que rien
 * n'oblige l'appelant à passer par l'écran ? » —, et elle a déjà sa réponse
 * (`src/lib/validation/presences.ts`). Un second plafond du même genre se désaccorde du premier au
 * premier ajustement, et le dépôt a déjà payé une fois pour deux constantes homonymes à deux
 * valeurs.
 *
 * Cinq cents est largement au-dessus du besoin : un trimestre ordinaire compte vingt-six cours, un
 * très chargé une cinquantaine, et une séance porte deux à quatre parties — soit **une à trois
 * centaines de cases** pour un trimestre entier sélectionné d'un bloc, pendant que
 * `PARTIES_PAR_SEANCE_MAX` (30) borne déjà chaque séance. Ce n'est pas un réglage de club, c'est un
 * garde-fou technique : au-delà, ce n'est plus un brouillon de planning qu'on enregistre.
 */
const lotCasesSchema = z.object({
  cases: z.array(casePlanningSchema).min(1).max(SELECTION_MAX),
});

/** « Cours 2 » du jeudi 2 octobre — de quoi retrouver la case nommément, sans recopier son identifiant. */
function nommerCase(partie: CaseAvant): string {
  return `« ${partie.libelle} » du ${minuscule(formatDateSansAnnee(partie.session.date))}`;
}

/**
 * Le refus d'un lot : **la case fautive nommée, la raison du geste unitaire mot pour mot**, et le
 * rappel que rien n'a été écrit — c'est la seule information qui manque à qui vient d'appuyer sur
 * « Enregistrer » avec quarante cases devant lui.
 */
function refusDuLot(partie: CaseAvant, raison: string): FormState {
  return { erreur: `${nommerCase(partie)} — ${raison} Rien n'a été enregistré.` };
}

/**
 * Le compte rendu d'un lot, calqué sur celui des présences en masse (`texteApresCoup`) : il
 * **distingue ce qui a été écrit de ce qui l'était déjà**. Sans cette seconde moitié, un « 3 cases
 * enregistrées » pour un lot de quarante laisserait croire à une perte.
 */
function compteRenduLot(ecrites: number, inchangees: number): string {
  if (ecrites === 0)
    return `Rien à changer : ${inchangees > 1 ? `ces ${inchangees} cases étaient` : "cette case était"} déjà à jour.`;
  const debut = `${ecrites} case${ecrites > 1 ? "s" : ""} enregistrée${ecrites > 1 ? "s" : ""}`;
  if (inchangees === 0) return `${debut}.`;
  return `${debut}, ${inchangees} ${inchangees > 1 ? "étaient" : "était"} déjà à jour.`;
}

/**
 * **Enregistre tout un brouillon de planning d'un coup**.
 *
 * ## Pourquoi
 *
 * Chaque case s'enregistrait toute seule, à chaque réglage (autosave) : il n'y avait donc rien à
 * « enregistrer » ni à « annuler », et régler le programme d'un trimestre faisait partir une centaine
 * d'écritures, d'entrées de journal et de revalidations — une par clic, dont celles qu'on venait de
 * corriger. Le brouillon vit dans le navigateur ; **un seul appel** arrive ici.
 *
 * ## Les mêmes verrous que le geste unitaire, à la lettre
 *
 * `planning.edit`, `casePlanningSchema` (avec le même pré-remplissage `instructeurSecondId: ""`),
 * `partiePourEcriture` **par case** — qui porte le refus d'une période close et retrouve la séance
 * depuis la ligne, jamais depuis ce que l'écran a envoyé —, le refus d'une case réservée à un atelier,
 * celui d'une même personne en instructeur **et** en second, celui d'un second sans premier, et
 * `instructeurUtilisable` avec son exception « laisser en place ce qui est déjà écrit ». Aucun verrou
 * en plus, aucun en moins, et **aucune règle reformulée** : ce sont les mêmes fonctions et les mêmes
 * phrases (`REFUS_CASE`), parce que deux chemins d'écriture aux règles différentes, c'est une porte
 * dérobée d'un côté ou une fonctionnalité morte de l'autre.
 *
 * ## Tout ou rien
 *
 * Les verrous se pèsent **tous** avant la première écriture, et un seul refus refuse le **lot
 * entier** en nommant la case (son libellé et la date de sa séance, pris du contexte relu en base —
 * jamais un identifiant recopié de l'appel). Un lot à moitié écrit sur un planning est pire qu'un
 * refus : plus personne ne sait ce qui a pris, et l'écran qui l'a envoyé affiche l'autre moitié.
 *
 * ## Ce qui ne change pas ne s'écrit pas
 *
 * `caseInchangee` écarte les cases dont les cinq valeurs sont déjà celles de la base : ni écriture, ni
 * entrée de journal, ni `updatedAt` repoussé. C'est le cas **ordinaire** d'un brouillon — on ouvre le
 * trimestre, on règle trois cases, on enregistre —, et sans ce tri la bulle « Modifié par … le … » de
 * toutes les autres annoncerait un changement qui n'a pas eu lieu.
 *
 * ## Une transaction, une entrée de journal par case, une synchronisation par séance
 *
 * Toutes les écritures partent dans un unique `$transaction`. Le journal reste **nominatif** : une
 * entrée par case réellement modifiée, sous la **même action** que le geste unitaire
 * (`planning.case`) et avec les mêmes `avant` / `apres`, plus `enMasse: true` — un seul filtre
 * (`/admin/audit?q=planning.case`) doit tout retrouver, quel que soit l'écran par lequel l'équipe est
 * passée. Les entrées s'écrivent **après** le commit et **hors** transaction : `audit()` ne lève
 * jamais, et un programme enregistré ne doit pas être annulé parce que sa trace a échoué.
 *
 * `synchroniserSeance` et `rafraichir` sont appelés **une fois par séance touchée** — un lot en porte
 * plusieurs, et les appeler par case recopierait dix fois le même programme dans la même séance.
 *
 * ## Rien ne part vers les gens
 *
 * Comme le geste unitaire : le planning ne notifie personne, c'est le récap de la veille qui publie
 * le programme, et un geste de masse n'envoie jamais la notification du geste unitaire multipliée.
 */
export async function enregistrerCases(input: {
  cases: Array<{
    partieId: string;
    instructeurId: string;
    instructeurSecondId?: string;
    theme: string;
    description?: string;
    niveau: string;
  }>;
}): Promise<FormState> {
  const user = await assertPermission("planning.edit");
  /*
   * Le **même** pré-remplissage que le geste unitaire, case par case : une grille déjà ouverte dans
   * un navigateur au moment du déploiement n'envoie pas encore le second instructeur, et une case
   * sans ce champ vaut « personne », pas « lot invalide ». L'entrée du réseau peut n'être rien du
   * tout (`input` est ce que l'appelant veut) : c'est le schéma qui tranche, pas le `map`.
   */
  const brut = Array.isArray(input?.cases)
    ? input.cases.map((c) => ({ instructeurSecondId: "", ...c }))
    : input?.cases;
  const parsed = lotCasesSchema.safeParse({ cases: brut });
  /*
   * **Un seul message, et aucune valeur reçue dedans.** Le geste unitaire rend `zodToFormState`,
   * dont les messages se posent sous les champs rouges d'un formulaire ; un lot n'a pas de champ à
   * rougir — et les messages par défaut de Zod sont en anglais. On dit donc la seule chose utile
   * ici : ce lot n'est pas lisible, et il n'a rien écrit.
   */
  if (!parsed.success)
    return {
      erreur:
        "Ce lot n'a pas pu être lu (une case mal formée, un lot vide ou trop grand) : rien n'a été enregistré. Recharge le planning et recommence.",
    };

  /*
   * **Un identifiant répété n'écrit qu'une fois** (même règle que `modifierPresencesEnMasse`, qui
   * dédoublonne sa sélection) : une case envoyée deux fois par un brouillon maladroit ne doit pas
   * produire deux écritures ni deux entrées de journal pour la même ligne. C'est la **dernière**
   * valeur qui est retenue, exactement comme deux personnes qui remplissent la même case à la suite
   * — « dernier arrivé gagne », la doctrine du geste unitaire.
   */
  const parPartie = new Map<string, ReglagesCase>();
  for (const c of parsed.data.cases) {
    sansThemeNiDetails(c);
    parPartie.set(c.partieId, c);
  }

  // **Tous les verrous avant la première écriture** : c'est ce qui rend le « tout ou rien » vrai.
  const aEcrire: Array<{ reglages: ReglagesCase; avant: CaseAvant }> = [];
  let inchangees = 0;
  for (const reglages of parPartie.values()) {
    const ctx = await partiePourEcriture(reglages.partieId);
    // Ni libellé ni date à nommer dans ce cas-là (la ligne n'a pas été relue), et l'identifiant ne
    // se recopie pas : la phrase partagée dit déjà ce qu'il faut faire.
    if ("erreur" in ctx) return { erreur: `${ctx.erreur} Rien n'a été enregistré.` };
    const avant = ctx.partie;
    if (avant.atelierId) return refusDuLot(avant, REFUS_CASE.atelier);
    if (reglages.instructeurId && reglages.instructeurId === reglages.instructeurSecondId)
      return refusDuLot(avant, REFUS_CASE.memePersonne);
    if (!reglages.instructeurId && reglages.instructeurSecondId)
      return refusDuLot(avant, REFUS_CASE.secondSansPremier);
    for (const [id, dejaPose] of [
      [reglages.instructeurId, avant.instructeurId],
      [reglages.instructeurSecondId, avant.instructeurSecondId],
    ] as const) {
      const refus = await instructeurUtilisable(id, dejaPose);
      if (refus) return refusDuLot(avant, refus);
    }
    if (caseInchangee(avant, reglages)) {
      inchangees += 1;
      continue;
    }
    aEcrire.push({ reglages, avant });
  }

  // Rien à écrire : on ne synchronise pas, on ne journalise pas et on ne revalide rien — le geste
  // unitaire s'arrête de la même façon sur sa case (« Rien à changer. »).
  if (aEcrire.length === 0) return { succes: compteRenduLot(0, inchangees) };

  // Prisma n'a pas d'« update de masse » qui rende les lignes écrites : on empile les opérations et
  // c'est `$transaction` qui en fait un seul aller-retour atomique.
  const apres = await db.$transaction(
    aEcrire.map(({ reglages }) =>
      db.sessionPartie.update({
        where: { id: reglages.partieId },
        data: {
          instructeurId: reglages.instructeurId,
          instructeurSecondId: reglages.instructeurSecondId,
          theme: reglages.theme,
          description: reglages.description,
          niveau: reglages.niveau,
          modifieParId: user.id,
        },
        include: {
          instructeur: { select: { prenom: true, nom: true } },
          instructeurSecond: { select: { prenom: true, nom: true } },
        },
      }),
    ),
  );

  // **Une fois par séance touchée, jamais une fois par case** : `synchroniserSeance` recopie tout le
  // programme de la séance dans la séance (cartes, exports, récap du soir) — l'appeler dix fois pour
  // les dix cases d'un même cours ferait dix fois le même travail.
  const seancesTouchees = [...new Set(aEcrire.map(({ avant }) => avant.sessionId))];
  for (const sessionId of seancesTouchees) await synchroniserSeance(sessionId);

  for (const [i, { reglages, avant }] of aEcrire.entries()) {
    await audit(user, "planning.case", avant.sessionId, {
      ...detailsCase(avant, apres[i], reglages),
      enMasse: true,
    });
  }

  for (const sessionId of seancesTouchees) rafraichir(sessionId);
  return { succes: compteRenduLot(aEcrire.length, inchangees) };
}

/**
 * **Créer une partie en queue de sa série, dans une transaction déjà ouverte** — le corps de
 * l'ajout, partagé par le geste unitaire (`ajouterPartie`) et le geste de masse
 * (`ajouterPartiesEnMasse`) : deux portes vers la même écriture, une seule façon de l'écrire (rang,
 * nom calculé, rangement de la séance, plafond). Rend `null` quand la séance a atteint
 * `PARTIES_PAR_SEANCE_MAX` : chaque appelant dit le refus dans ses mots.
 */
async function creerPartie(tx: Prisma.TransactionClient, sessionId: string, estOption: boolean, auteurId: string) {
  const existantes = await tx.sessionPartie.findMany({
    where: { sessionId },
    select: {
      id: true,
      ordre: true,
      estOption: true,
      libelle: true,
      updatedAt: true,
    },
  });
  if (existantes.length >= PARTIES_PAR_SEANCE_MAX) return null;
  const nouvelle = await tx.sessionPartie.create({
    // Le nom se déduit du rang que la partie prend dans sa nature : dernière de sa série, puisque
    // l'ajout se fait en queue de **sa** série. Le rang, lui, est provisoire — `rangerParties`
    // juste en dessous le remet à sa place.
    data: {
      sessionId,
      libelle: prochainLibellePartie(existantes, estOption),
      estOption,
      ordre: existantes.length,
      modifieParId: auteurId,
    },
    select: {
      id: true,
      libelle: true,
      ordre: true,
      estOption: true,
      updatedAt: true,
    },
  });
  /*
   * **La nouvelle ligne est rangée AVEC les autres, pas après elles**.
   *
   * Le rangement ne portait que sur `existantes`, et la nouvelle gardait son rang provisoire
   * `existantes.length` — soit la dernière place de la séance. Or `rangerParties` tient l'invariant
   * « les cours d'abord, les options ensuite » : sur une séance au modèle livré (Cours 1, Cours 2,
   * Option 1, Option 2), « Ajouter un cours » posait donc **Cours 3 derrière Option 2**.
   *
   * Rien ne se contredisait — le libellé reste juste, `rangsDansNature` comptant par nature — mais
   * la **place** était fausse, et tous les lecteurs trient sur `ordre` seul : la grille du planning,
   * la fiche de séance, la carte de l'accueil, la colonne `disciplines` qui nourrit l'objet de l'email
   * du soir, le programme des embeds Discord et Telegram, et l'API publique. Tous affichaient
   * « Cours 1 · Cours 2 · Option 1 · Option 2 · Cours 3 », c'est-à-dire exactement ce que la demande
   * du 30/09 au matin voulait supprimer.
   *
   * L'état se réparait de lui-même à la première autre écriture sur la séance (déplacer, retirer,
   * changer de nature, poser un atelier) — ce qui explique qu'il n'ait pas sauté aux yeux.
   */
  for (const ecriture of rangerParties([...existantes, nouvelle], tx))
    await ecriture;
  return nouvelle;
}

/**
 * **Ajouter une partie à une séance.** Sous `planning.edit`, comme remplir une case : c'est le même
 * geste de tenue du programme, fait par les mêmes personnes, et le réserver au bureau obligerait un
 * instructeur à demander l'autorisation d'ajouter la ligne qu'il va lui-même remplir.
 *
 * La partie naît **en queue** : ajouter n'insère pas au milieu, on monte ensuite si besoin. Elle
 * naît aussi **sans nom à saisir** : seule sa nature est demandée, et son libellé se déduit du rang
 * qu'elle prend dans cette série — le troisième cours de la séance s'appelle « Cours 3 ».
 */
export async function ajouterPartie(input: {
  sessionId: string;
  estOption?: boolean;
}): Promise<FormState & { partieId?: string }> {
  const user = await assertPermission("planning.edit");
  const parsed = nouvellePartieSchema.safeParse(input);
  if (!parsed.success) return zodToFormState(parsed.error);
  const { sessionId, estOption } = parsed.data;

  const ctx = await seancePourEcriture(sessionId);
  if ("erreur" in ctx) return ctx;

  /*
   * **L'ajout était la seule écriture qui ne renumérotait ni ne vérifiait rien** : il posait
   * `ordre = nombre de parties`, hors transaction, alors que le retrait et le déplacement
   * enferment bien les leurs. Deux ennuis, tous les deux corrigés ici :
   *
   * 1. sur une séance aux rangs troués — celles qu'a laissées la migration — le nombre de parties
   *    n'est pas le rang libre suivant : la nouvelle ligne venait s'asseoir sur un rang déjà pris, et
   *    l'ajout **propageait** l'état faux au lieu de le réparer. On renumérote l'existant dans la même
   *    transaction, et la nouvelle vient juste après.
   * 2. la séance est **relue dans** la transaction : deux ajouts au même instant (deux instructeurs
   *    sur la même séance, ou un double clic) lisaient dehors la même longueur et naissaient au
   *    même rang. Prisma ne tient qu'une connexion vers SQLite, qui n'accepte de toute façon qu'un
   *    écrivain à la fois : la transaction les met donc réellement à la file.
   */
  const creee = await db.$transaction((tx) => creerPartie(tx, sessionId, estOption, user.id));
  if (!creee)
    return {
      erreur: `Une séance ne peut pas porter plus de ${PARTIES_PAR_SEANCE_MAX} parties.`,
    };

  await synchroniserSeance(sessionId);
  await audit(user, "planning.partie.ajout", sessionId, {
    date: ctx.session.date,
    partie: creee.libelle,
    option: estOption,
  });
  rafraichir(sessionId);
  return {
    succes: estOption ? "Option ajoutée." : "Cours ajouté.",
    partieId: creee.id,
  };
}

/**
 * **Ajouter un cours ou une option à plusieurs séances d'un coup** — la sélection multiple du planning.
 *
 * Comme son jumeau de la carte (`ajouterPartie`), le geste s'enregistre **tout de suite** : une partie
 * provisoire n'aurait pas d'identifiant à donner au brouillon. Les verrous sont **exactement** ceux du
 * geste unitaire, par les **mêmes fonctions** : `planning.edit`, `seancePourEcriture` pour chaque
 * séance (trimestre clos, séance annulée, séance introuvable), puis `creerPartie` — rang, nom calculé,
 * rangement, plafond `PARTIES_PAR_SEANCE_MAX`.
 *
 * **Tout ou rien.** Les refus de séance se pèsent tous avant la transaction ; dans la transaction, le
 * plafond est vérifié pour **toutes** les séances avant la première création — un lot où la douzième
 * séance déborderait n'a rien écrit sur les onze premières. Le lot est plafonné à `SELECTION_MAX`,
 * dédoublonné (une séance cochée deux fois ne reçoit pas deux cours).
 *
 * **Le journal** : une entrée par séance, sous la **même action** que l'ajout unitaire
 * (`planning.partie.ajout`), avec `enMasse: true`, après le commit et hors transaction. Rien ne part
 * vers les gens : le planning ne notifie personne.
 */
export async function ajouterPartiesEnMasse(input: { sessionIds: string[]; estOption?: boolean }): Promise<FormState & { ajoutees?: number }> {
  const user = await assertPermission("planning.edit");
  const parsed = partiesEnMasseSchema.safeParse(input);
  if (!parsed.success) return { erreur: "Sélection invalide : coche des séances, puis choisis le geste. Rien n'a été ajouté." };
  const { sessionIds, estOption } = parsed.data;

  // **Toutes les gardes avant la première écriture** : la garde du geste unitaire, séance par séance.
  const seances: Array<{ id: string; date: string }> = [];
  const refus = new Set<string>();
  for (const id of sessionIds) {
    const ctx = await seancePourEcriture(id);
    if (ctx.erreur !== undefined) refus.add(ctx.erreur);
    else seances.push({ id: ctx.session.id, date: ctx.session.date });
  }
  // Le même refus pour dix séances (trimestre clos) se dit une fois.
  if (refus.size > 0) return { erreur: ["Rien n'a été ajouté : le lot entier est refusé.", ...refus].join(" ") };
  // L'ordre du journal est celui du calendrier, jamais celui des clics.
  seances.sort((x, y) => x.date.localeCompare(y.date));

  const issue = await db.$transaction(async (tx) => {
    // Le plafond pesé pour toutes avant d'en créer une : c'est ce qui rend le « tout ou rien » vrai.
    for (const s of seances) {
      const existantes = await tx.sessionPartie.findMany({ where: { sessionId: s.id }, select: { id: true } });
      if (existantes.length >= PARTIES_PAR_SEANCE_MAX) return { pleine: s, creees: [] };
    }
    const creees: Array<{ seance: { id: string; date: string }; libelle: string }> = [];
    for (const s of seances) {
      const creee = await creerPartie(tx, s.id, estOption, user.id);
      // Impossible après la vérification ci-dessus, sauf écriture concurrente : on annule la transaction.
      if (!creee) throw new Error(`Séance pleine : ${s.id}`);
      creees.push({ seance: s, libelle: creee.libelle });
    }
    return { pleine: null, creees };
  });
  if (issue.pleine)
    return {
      erreur: `La séance du ${minuscule(formatDateSansAnnee(issue.pleine.date))} porte déjà ${PARTIES_PAR_SEANCE_MAX} parties, le plafond d'une séance. Rien n'a été ajouté.`,
    };

  for (const { seance } of issue.creees) await synchroniserSeance(seance.id);
  for (const { seance, libelle } of issue.creees) {
    await audit(user, "planning.partie.ajout", seance.id, { date: seance.date, partie: libelle, option: estOption, enMasse: true });
  }
  for (const { seance } of issue.creees) rafraichir(seance.id);
  const n = issue.creees.length;
  const quoi = estOption ? "Option ajoutée" : "Cours ajouté";
  return { succes: n === 1 ? `${quoi} à 1 séance.` : `${quoi} à ${n} séances.`, ajoutees: n };
}

/**
 * **Aucun écran n'appelle plus cette action** : la nature d'une partie se choisit **à l'ajout**, et
 * ne se change plus après coup — on retire la partie et on ajoute l'autre.
 *
 * Elle est gardée, avec ses verrous et ses quinze tests, pour deux raisons : la règle qu'elle porte
 * (une bascule renumérote les deux séries, refuse une période close et refuse une partie occupée par
 * un atelier) est celle du rangement lui-même, et la nature d'une partie a changé de forme **quatre
 * fois en trois jours** — case à cocher, deux boutons, curseur, deux boutons. Si un écran la
 * rappelle, elle est prête ; si l'on décide qu'elle ne reviendra pas, c'est elle **et** ses tests qui
 * partent ensemble, pas l'un sans l'autre.
 */
/**
 * **Changer la nature d'une partie** : un cours devient une option, ou l'inverse.
 *
 * C'est tout ce qui reste de l'ancien « renommer » : le libellé ne se saisit plus, donc il n'y a
 * plus de nom à recevoir — seulement un drapeau. Et comme le nom se déduit du rang **dans la
 * nature**, changer la nature d'une partie décale les deux séries d'un coup : la 2e option devient
 * la 1ère, le 2e cours devient le 3e. `rangerParties` réécrit donc les libellés de toute la séance
 * — et il ne touche **jamais** `updatedAt` : sans cela, la bulle « Modifié par … le … » des
 * **voisines** dont le nom glisse porterait l'heure de ce clic sous le nom de quelqu'un d'autre. La
 * partie dont on change la nature, elle, est bien horodatée ici : ce clic-là porte sur elle, et
 * c'est le seul de la séance qui la modifie.
 *
 * **Refusé tant qu'un atelier occupe la partie**, comme le refusent déjà ses deux voisines
 * (`enregistrerCase`, `retirerPartie`). Rien ne le testait : un clic sur « Cours » faisait atterrir
 * l'atelier dans « Cours 3 » avec `estOption = false`, et il était **publié tel quel** par l'API
 * publique et les pages de partage, alors que tout le modèle dit qu'un atelier occupe une option. On
 * le déprogramme depuis la gestion des ateliers — ce qui **vide** la case —, et la partie redevient
 * une partie ordinaire, de la nature qu'on veut.
 */
export async function changerNaturePartie(input: {
  partieId: string;
  estOption: boolean;
}): Promise<FormState> {
  const user = await assertPermission("planning.edit");
  const parsed = naturePartieSchema.safeParse(input);
  if (!parsed.success) return zodToFormState(parsed.error);
  const { partieId, estOption } = parsed.data;

  const ctx = await partiePourEcriture(partieId);
  if ("erreur" in ctx) return ctx;
  const avant = ctx.partie;
  if (avant.atelierId)
    return {
      erreur:
        "Un atelier occupe cette partie : déprogramme-le d'abord depuis la gestion des ateliers.",
    };
  if (avant.estOption === estOption) return { succes: "Rien à changer." };

  const maintenant = new Date();
  const toutes = await db.sessionPartie.findMany({
    where: { sessionId: avant.sessionId },
    select: {
      id: true,
      ordre: true,
      estOption: true,
      libelle: true,
      updatedAt: true,
    },
  });
  await db.$transaction([
    db.sessionPartie.update({
      where: { id: partieId },
      data: { estOption, modifieParId: user.id },
    }),
    /*
     * La partie bascule **dans la liste** avant le rangement : sans cela, les rangs seraient comptés
     * sur son ancienne nature et les libellés sortiraient d'un cran faux.
     *
     * Et elle y entre avec un horodatage **neuf** : le rangement va très probablement réécrire son
     * libellé, donc l'écrire une seconde fois après la ligne ci-dessus — en lui rendant son ancien
     * `updatedAt`, il défairait la seule trace de ce clic et la case annoncerait « Modifié par
     * <celui qui clique> » à la date où quelqu'un d'autre l'avait remplie.
     */
    ...rangerParties(
      toutes.map((p) =>
        p.id === partieId ? { ...p, estOption, updatedAt: maintenant } : p,
      ),
      db,
    ),
  ]);
  // Rien de ce que la séance recopie ne dépend de la nature d'une partie — mais les cinq actions
  // repassent toutes par là, sans exception à retenir : le jour où `disciplines` portera autre chose,
  // aucune ne sera à rattraper.
  await synchroniserSeance(avant.sessionId);
  const apres = await db.sessionPartie.findUnique({
    where: { id: partieId },
    select: { libelle: true },
  });
  await audit(user, "planning.partie.nature", avant.sessionId, {
    date: avant.session.date,
    avant: { partie: avant.libelle, option: avant.estOption },
    apres: { partie: apres?.libelle ?? avant.libelle, option: estOption },
  });
  rafraichir(avant.sessionId);
  return {
    succes: estOption ? "Partie passée en option." : "Partie passée en cours.",
  };
}

/**
 * **Retirer une partie.** Refusé tant qu'un atelier l'occupe : l'atelier a été validé par l'équipe
 * et annoncé à son proposant — le faire disparaître par la bande, en supprimant la ligne qui le
 * porte, laisserait un atelier « planifié » qui n'est nulle part. On le déprogramme d'abord, depuis
 * la gestion des ateliers, ce qui **vide** la case ; ensuite seulement on retire la ligne.
 */
export async function retirerPartie(input: {
  partieId: string;
}): Promise<FormState> {
  const user = await assertPermission("planning.edit");
  const parsed = retirerPartieSchema.safeParse(input);
  if (!parsed.success) return zodToFormState(parsed.error);

  const ctx = await partiePourEcriture(parsed.data.partieId);
  if ("erreur" in ctx) return ctx;
  const partie = ctx.partie;
  if (partie.atelierId)
    return {
      erreur:
        "Un atelier occupe cette partie : déprogramme-le d'abord depuis la gestion des ateliers.",
    };

  const restantes = (
    await db.sessionPartie.findMany({
      where: { sessionId: partie.sessionId },
      select: {
        id: true,
        ordre: true,
        estOption: true,
        libelle: true,
        updatedAt: true,
      },
    })
  ).filter((p) => p.id !== partie.id);
  // Retirer « Cours 1 » fait du second cours le premier : les libellés se recalent avec les rangs,
  // dans la même transaction que la suppression.
  await db.$transaction([
    db.sessionPartie.delete({ where: { id: partie.id } }),
    ...rangerParties(restantes, db),
  ]);
  await synchroniserSeance(partie.sessionId);
  await audit(user, "planning.partie.retrait", partie.sessionId, {
    date: partie.session.date,
    partie: partie.libelle,
    /*
     * **Tout ce que la ligne portait au moment du retrait.** Sans cela, le journal dirait qu'on a
     * retiré « Option 2 » sans dire qu'on effaçait un cours de Messer confié à quelqu'un.
     *
     * La règle était écrite avant que la description, le niveau et le second instructeur n'existent :
     * il n'en gardait que le thème et l'instructeur. Or l'écran promet exactement le contraire
     * (« Son instructeur, son thème et sa description seront perdus », `ListeParties`), le geste est
     * irréversible, et le journal est la seule chose qui reste après lui. Les cinq champs y sont
     * maintenant, dans les mêmes mots que `planning.case` : un seul filtre du journal raconte donc
     * toute la vie d'une case, de son premier remplissage à son retrait.
     */
    theme: partie.theme,
    instructeur: nomDe(partie.instructeur),
    instructeurSecond: nomDe(partie.instructeurSecond),
    description: partie.description,
    niveau: libelleNiveau(partie.niveau),
  });
  rafraichir(partie.sessionId);
  return { succes: "Partie retirée." };
}

/**
 * **Déplacer une partie** vers un rang donné (l'écran n'en propose que deux : un cran plus haut, un
 * cran plus bas). Le rang visé est ramené dans les limites de la séance plutôt que refusé : un
 * « monter » sur la première ligne ne doit pas afficher d'erreur, il ne doit rien faire.
 */
export async function deplacerPartie(input: {
  partieId: string;
  versOrdre: number;
}): Promise<FormState> {
  const user = await assertPermission("planning.edit");
  const parsed = deplacerPartieSchema.safeParse(input);
  if (!parsed.success) return zodToFormState(parsed.error);
  const { partieId, versOrdre } = parsed.data;

  const ctx = await partiePourEcriture(partieId);
  if ("erreur" in ctx) return ctx;
  const partie = ctx.partie;

  const toutes = (
    await db.sessionPartie.findMany({
      where: { sessionId: partie.sessionId },
      select: {
        id: true,
        ordre: true,
        estOption: true,
        libelle: true,
        updatedAt: true,
      },
    })
  ).sort((a, b) => a.ordre - b.ordre);
  const depuis = toutes.findIndex((p) => p.id === partieId);
  const vers = Math.min(Math.max(versOrdre, 0), toutes.length - 1);
  if (depuis === vers) return { succes: "Rien à changer." };

  /*
   * **On n'écrit que les lignes dont le rang change vraiment — et sans jamais toucher `updatedAt`.**
   *
   * La transaction réécrivait `ordre` sur **toutes** les parties de la séance, celles déjà au bon
   * rang comprises. Or la ligne porte `@updatedAt` : chaque « monter » ou « descendre » repoussait
   * donc l'horodatage de toute la séance, et `chargerPlanning` recopie ce champ (`modifieLe`) dans la
   * bulle « Modifié par … le … » de chaque case — avec `modifieParId`, lui, inchangé. Quelqu'un
   * remplit « Cours n°1 » le 12 septembre ; le 30 à 20h14 une autre personne descend « 2e option »
   * d'un cran ; la case de « Cours n°1 » annonce « Modifié par <la première> le 30 septembre à
   * 20:14 ». Elle n'a rien fait ce soir-là, et c'est la seule trace que la grille montre.
   *
   * `rangerParties` fait déjà exactement ce calcul **et** exactement ce filtre (il saute les lignes
   * déjà au bon rang et au bon nom) — c'est la même règle que les migrations qui réparent des rangs
   * sans toucher à `updatedAt` : ranger une séance n'est pas une modification du programme par
   * quelqu'un. Il trie par `ordre`, donc on lui donne la place voulue sous la forme d'un **rang
   * intercalaire** (`vers ± 0,5`) plutôt que d'un tableau déjà réordonné : trié, il place la partie
   * juste avant (montée) ou juste après (descente) celle qui occupe le rang visé, et tasse le reste à
   * partir de zéro.
   *
   * Et il recale les **libellés** au passage : descendre « Cours 1 » sous « Cours 2 » échange leurs
   * rangs, donc leurs noms — le nom suit la place, c'est tout l'objet de la décision. C'est
   * précisément ce qui faisait revenir le mensonge par la fenêtre : le nom d'une **voisine** change
   * pour de bon, donc sa ligne est réécrite, donc son `updatedAt` bougeait. `rangerParties` rend
   * désormais à chaque ligne l'horodatage qu'elle portait ; le déplacement, lui, se lit dans le
   * journal d'audit (`planning.partie.ordre`), qui dit **qui** a déplacé **quoi**, d'où à où. La
   * case déplacée ne repeint donc pas sa bulle non plus : sa place a changé, pas son contenu.
   */
  const rangIntercalaire = vers < depuis ? vers - 0.5 : vers + 0.5;
  const voulues = toutes.map((p) =>
    p.id === partieId ? { ...p, ordre: rangIntercalaire } : p,
  );
  /*
   * **« Rien à changer » se mesure sur la séquence, pas sur les index de départ ni sur les écritures.**
   *
   * La comparaison `depuis === vers` ne suffit plus depuis que les cours passent devant les
   * options : une option qu'on monte « tout en haut » vise un rang situé avant le premier cours,
   * donc un index différent du sien — et le tri la repose exactement où elle était, parce qu'elle
   * est déjà en tête de **sa** série. L'écran annonçait alors « Partie déplacée. » sans que rien
   * n'ait bougé, et le journal gardait un déplacement qui n'a pas eu lieu.
   *
   * Et compter les écritures ne répondrait pas non plus : le rang intercalaire (`-0,5`) n'est jamais
   * un rang valable, il est donc **toujours** réécrit en entier, même quand la partie retombe à sa
   * place. On compare donc les deux séquences d'identifiants, avant et après.
   */
  if (sequenceRangee(voulues).join() === sequenceRangee(toutes).join())
    return { succes: "Rien à changer." };
  await db.$transaction(rangerParties(voulues, db));
  // Indispensable ici : `disciplines` est la liste des thèmes **dans l'ordre des parties**, et c'est
  // elle qu'on lit dans l'objet de l'email du soir. Déplacer une partie change donc ce qui part.
  await synchroniserSeance(partie.sessionId);
  await audit(user, "planning.partie.ordre", partie.sessionId, {
    date: partie.session.date,
    partie: partie.libelle,
    de: depuis,
    vers,
  });
  rafraichir(partie.sessionId);
  return { succes: "Partie déplacée." };
}

/**
 * Programme un atelier validé directement depuis une case du planning (équipe).
 *
 * **Seulement dans une case vide**. Le seul garde-fou était « pas d'autre atelier ici », et
 * `placerAtelier` **remplace** tout le contenu de la case : l'instructeur devient le proposant, le
 * second est mis à `null`, le thème devient le titre de l'atelier, la description repart à vide et
 * le niveau à *indifférent*. Le groupe « Programmer un atelier en attente » vivant au bas de la
 * liste **Thème**, un clic un peu bas en cherchant à corriger un mot effaçait cinq champs d'un coup
 * — sans confirmation, et l'audit d'alors ne gardait rien de ce qui partait.
 *
 * C'est l'asymétrie que ce refus ferme : `enregistrerCase` refuse de toucher une case occupée par un
 * atelier, `retirerPartie` refuse d'enlever une partie qu'un atelier occupe — mais rien n'empêchait
 * de poser un atelier **sur** le travail de quelqu'un. Vider la case reste possible, et c'est un
 * geste explicite, journalisé avant/après : on ne perd donc rien, on l'exige seulement de celui qui
 * veut la place. L'écran ne propose d'ailleurs plus les ateliers sur une case remplie (`CaseEditeur`)
 * — un geste offert pour être refusé est un piège, pas une sécurité.
 */
export async function programmerAtelierDansCase(input: {
  partieId: string;
  atelierId: string;
}): Promise<FormState> {
  const user = await assertPermission("ateliers.moderate");
  const parsed = z
    .object({ partieId: partieIdSchema, atelierId: z.string().min(1) })
    .safeParse(input);
  if (!parsed.success) return zodToFormState(parsed.error);
  const { partieId, atelierId } = parsed.data;

  const ctx = await partiePourEcriture(partieId);
  if ("erreur" in ctx) return ctx;
  const partie = ctx.partie;
  if (partie.atelierId)
    return { erreur: "Un autre atelier occupe déjà cette case." };
  if (!partieLibre(partie)) {
    return {
      erreur: `« ${partie.libelle} » porte déjà un programme : vide la case (instructeur, thème, description, niveau) avant d'y placer un atelier, ou choisis une autre partie.`,
    };
  }

  const [atelier, seance] = await Promise.all([
    db.atelier.findUnique({
      where: { id: atelierId },
      include: { proposePar: true },
    }),
    db.session.findUnique({
      where: { id: partie.sessionId },
      select: { date: true, heureDebut: true, lieu: true, annulee: true },
    }),
  ]);
  if (!atelier || !seance) return { erreur: "Atelier ou séance introuvable." };
  if (seance.annulee) return { erreur: "Cette séance est annulée." };
  /*
   * **Un atelier ne se programme pas sur un cours passé, ici comme dans la file**.
   *
   * La file des propositions le refusait déjà (`seanceValide`, `src/actions/ateliers.ts` : « à venir et
   * non annulée ») ; cette porte-ci, qui passe par la grille du planning, ne regardait que l'annulation.
   * Or le planning affiche **toutes** les séances de la période, passées comprises, et propose les
   * ateliers en attente dès qu'une case est vide.
   *
   * Le scénario : le 30 septembre, un instructeur ouvre le cours du 12, dont « Option 2 » est restée
   * vide, et y choisit un atelier en attente. Le serveur acceptait : l'atelier passait « planifié » sur
   * un cours donné dix-huit jours plus tôt, son auteur recevait « ton atelier est placé dans le
   * planning », et la proposition disparaissait de la file — planifiée sur du passé, donc jamais.
   *
   * Deux portes vers la même écriture ne peuvent pas avoir deux serrures. Même règle, mêmes mots.
   */
  if (seance.date < todayIso())
    return { erreur: "Choisis une séance à venir pour placer l'atelier." };
  if (!transitionAutorisee(atelier.statut, "PLANIFIE"))
    return {
      erreur:
        "Cet atelier ne peut pas être programmé (il doit être validé d'abord).",
    };

  const decide = await db.atelier.update({
    where: { id: atelierId },
    data: { statut: "PLANIFIE", sessionId: partie.sessionId },
  });
  await placerAtelier(atelierId, partie.sessionId, user.id, partieId);
  // Exactement la même réponse que depuis la file des propositions (`src/actions/ateliers.ts`), et
  // par le même chemin : c'est le même événement pour le membre, il n'a pas à dépendre de l'écran par
  // lequel l'équipe est passée pour placer l'atelier.
  const prevenir = await notifierDecisionAtelier({
    atelier: decide,
    proposePar: atelier.proposePar,
    statut: "PLANIFIE",
    commentaire: atelier.commentaireInstructeur,
    seance,
  });
  await audit(user, "atelier.decision", atelierId, {
    statut: "PLANIFIE",
    sessionId: partie.sessionId,
    partie: partie.libelle,
    depuis: "planning",
  });
  rafraichir(partie.sessionId);
  return {
    succes: prevenir
      ? "Atelier programmé — le membre est prévenu par email."
      : "Atelier programmé.",
  };
}

/** Liste des thèmes du planning (une ligne par thème) : elle vaut pour tout le club, donc bureau seul (`themes.manage`). */
export async function enregistrerThemes(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const user = await assertPermission("themes.manage");
  const parsed = themesSchema.safeParse({ texte: champ(fd, "texte") });
  if (!parsed.success) return zodToFormState(parsed.error);
  const themes = nettoyerThemes(parsed.data.texte);
  if (themes.length === 0)
    return {
      erreur: "Indique au moins un thème.",
      erreurs: { texte: "Liste vide." },
    };
  await setThemes(themes);
  await audit(user, "themes.modifies", null, { nombre: themes.length });
  revalidatePath("/planning");
  revalidatePath("/gestion/ateliers");
  // **Son propre écran d'abord** : sans cette ligne, la zone de texte de « Thèmes et lieux » gardait
  // la liste du chargement de la page, et un second « Enregistrer » la réécrivait en base (c'est le
  // bug qui avait fait poser un `router.refresh()` global dans `FormulaireAction`). Une action rend
  // fraîche la page qui l'appelle : c'est à elle de le faire, pas au composant de le demander deux fois.
  revalidatePath("/admin/themes");
  return {
    succes: `${themes.length} thème${themes.length > 1 ? "s" : ""} enregistré${themes.length > 1 ? "s" : ""}.`,
  };
}

/**
 * **Les lieux habituels des cours** (ADMIN, session forte — même porte que les thèmes du planning).
 *
 * Une liste **vide est un état légitime**, à la différence des thèmes : un club qui n'a pas de salle
 * fixe saisit le lieu séance par séance, et c'est l'état de départ d'une installation neuve. On ne
 * refuse donc pas la liste vide — on dit seulement ce qu'elle veut dire.
 */
export async function enregistrerLieux(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const user = await assertPermission("themes.manage");
  const parsed = lieuxSchema.safeParse({ texte: champ(fd, "texte") });
  if (!parsed.success) return zodToFormState(parsed.error);
  const lieux = nettoyerLieux(parsed.data.texte);
  await setLieux(lieux);
  await audit(user, "lieux.modifies", null, { nombre: lieux.length });
  // Les formulaires de séance portent la liste déroulante ; l'accueil et les cartes affichent le
  // lieu **déjà enregistré** sur chaque séance, que ce réglage ne touche pas.
  revalidatePath("/seances");
  revalidatePath("/admin/themes");
  if (lieux.length === 0)
    return {
      succes: "Aucun lieu habituel : le lieu sera saisi à chaque séance.",
    };
  return {
    succes: `${lieux.length} lieu${lieux.length > 1 ? "x" : ""} enregistré${lieux.length > 1 ? "s" : ""}.`,
  };
}
