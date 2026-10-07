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
  NOMS_NATURE,
  REFUS_PERIODE_CLOSE,
  type NatureElement,
} from "@/lib/constants";
import { notifierDecisionAtelier } from "@/lib/notifications/ateliers";
import { champ, zodToFormState, type FormState } from "@/lib/form";
import {
  getThemes,
  natureLue,
  nettoyerThemes,
  partieLibre,
  placerAtelier,
  rangerParties,
  SELECTION_RANGEMENT,
  setLieux,
  setThemes,
  setThemesEchauffement,
  synchroniserSeance,
} from "@/lib/planning";
import { ordreAvant, ordreDInsertion, ordreEntier, rangementsParties, type PartieARanger } from "@/components/planning/rangement";
import { normaliserTheme, prendUneTeinte, teinteAEcrire } from "@/components/seances/teintes";
import { transitionAutorisee } from "@/lib/ateliers";
import { can, estCompteDeService } from "@/lib/permissions";
import {
  casePlanningSchema,
  deplacerElementSchema,
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
 *
 * `client` : la transaction de l'appelant quand le geste doit relire la partie **dans** celle-ci
 * (les déplacements), la base sinon.
 */
async function partiePourEcriture(partieId: string, client: Pick<Prisma.TransactionClient, "sessionPartie"> = db) {
  const partie = await client.sessionPartie.findUnique({
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
 * **La teinte à enregistrer pour un élément qu'on crée ou dont le thème change** (`teinteAEcrire`,
 * `src/components/seances/teintes.ts`) : celle de son thème si aucun autre élément de la séance ne la
 * porte, sinon la suivante libre ; `null` pour un échauffement ou un atelier.
 *
 * Le reste de la séance est relu **dans la transaction de l'écriture** : SQLite n'admet qu'un
 * écrivain à la fois, si bien que deux cours enregistrés au même instant ne peuvent pas lire la même
 * teinte libre. La liste des thèmes du club, elle, se lit avant d'ouvrir la transaction.
 */
async function teinteAEnregistrer(
  tx: Pick<Prisma.TransactionClient, "sessionPartie">,
  sessionId: string,
  element: { id?: string; nature: NatureElement; theme: string },
  themesClub: readonly string[],
): Promise<number | null> {
  if (!prendUneTeinte(element.nature)) return null;
  const autres = await tx.sessionPartie.findMany({
    where: { sessionId, ...(element.id ? { id: { not: element.id } } : {}) },
    select: { id: true, bloc: true, nature: true, theme: true, teinte: true },
  });
  return teinteAEcrire(element, autres.map((p) => ({ ...p, nature: natureLue(p.nature) })), themesClub);
}

/**
 * **La teinte ne se recalcule que si le thème change** — à la casse, aux accents et aux espaces
 * près, qui ne changent pas la teinte d'un thème. Changer l'instructeur, le niveau ou la description
 * la laisse où elle est.
 */
function themeChange(avant: { theme: string }, apres: { theme: string }): boolean {
  return normaliserTheme(avant.theme) !== normaliserTheme(apres.theme);
}

/**
 * **Les refus d'une case, écrits une fois pour les deux portes.**
 *
 * `enregistrerCase` les rendait en clair dans son corps. Depuis qu'un **lot** passe par les mêmes
 * verrous (`enregistrerCases`), la phrase doit venir du même endroit : deux portes vers la même
 * écriture ne peuvent pas avoir deux serrures, et elles ne peuvent pas non plus donner deux raisons
 * différentes pour le même refus — c'est ainsi qu'on s'aperçoit, six mois plus tard, que l'une des
 * deux avait cessé de refuser. Le lot préfixe ces phrases du nom de la case fautive
 * (`nommerCase`) et n'en change pas un mot.
 */
const REFUS_CASE = {
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
 * **Une case qui porte un atelier se règle comme les autres, sauf son thème** (Delta :
 * « pour chaque sous-section les mêmes champs (instructeurs, thèmes, descriptions etc.) »).
 * Instructeur, second, niveau et description s'enregistrent ; le thème, lui, **est** le titre de
 * l'atelier, posé par `placerAtelier` : la valeur envoyée est ignorée et celle de la base gardée —
 * un appel forgé ne peut pas rebaptiser un atelier depuis le planning. Le reste des gardes (même
 * personne, second sans premier, trimestre clos, séance annulée) s'applique tel quel. À appeler
 * **avant** `sansThemeNiDetails`, pour que le niveau et la description d'un atelier ne soient pas
 * effacés parce que l'écran n'a pas renvoyé de thème.
 */
function themeFigeParAtelier(avant: CaseAvant, c: { theme: string }): void {
  if (avant.atelierId) c.theme = avant.theme;
}

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

  const ctx = await partiePourEcriture(parsed.data.partieId);
  if ("erreur" in ctx) return ctx;
  const avant = ctx.partie;
  themeFigeParAtelier(avant, parsed.data);
  sansThemeNiDetails(parsed.data);
  const {
    partieId,
    instructeurId,
    instructeurSecondId,
    theme,
    description,
    niveau,
  } = parsed.data;
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

  // Un thème qui change emporte sa teinte (celle du nouveau thème, si elle est libre dans la séance).
  const retinter = themeChange(avant, parsed.data);
  const themesClub = retinter ? await getThemes() : [];
  const apres = await db.$transaction(async (tx) => {
    const teinte = retinter ? await teinteAEnregistrer(tx, avant.sessionId, { id: partieId, nature: natureLue(avant.nature), theme }, themesClub) : undefined;
    return tx.sessionPartie.update({
      where: { id: partieId },
      data: {
        instructeurId,
        instructeurSecondId,
        theme,
        description,
        niveau,
        ...(teinte !== undefined ? { teinte } : {}),
        modifieParId: user.id,
      },
      include: {
        instructeur: { select: { prenom: true, nom: true } },
        instructeurSecond: { select: { prenom: true, nom: true } },
      },
    });
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
 * depuis la ligne, jamais depuis ce que l'écran a envoyé —, le thème d'une case atelier figé au titre
 * de l'atelier (`themeFigeParAtelier`), le refus d'une même personne en instructeur **et** en second, celui d'un second sans premier, et
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
  for (const c of parsed.data.cases) parPartie.set(c.partieId, c);

  // **Tous les verrous avant la première écriture** : c'est ce qui rend le « tout ou rien » vrai.
  const aEcrire: Array<{ reglages: ReglagesCase; avant: CaseAvant }> = [];
  let inchangees = 0;
  for (const reglages of parPartie.values()) {
    const ctx = await partiePourEcriture(reglages.partieId);
    // Ni libellé ni date à nommer dans ce cas-là (la ligne n'a pas été relue), et l'identifiant ne
    // se recopie pas : la phrase partagée dit déjà ce qu'il faut faire.
    if ("erreur" in ctx) return { erreur: `${ctx.erreur} Rien n'a été enregistré.` };
    const avant = ctx.partie;
    themeFigeParAtelier(avant, reglages);
    sansThemeNiDetails(reglages);
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

  // Une seule transaction, case après case : la teinte d'une case dont le thème change se choisit
  // parmi celles que portent **déjà** les autres éléments de la séance — y compris une voisine du
  // même lot écrite juste avant elle. Tout ou rien, comme avant.
  const themesClub = aEcrire.some(({ reglages, avant }) => themeChange(avant, reglages)) ? await getThemes() : [];
  const apres = await db.$transaction(async (tx) => {
    const ecrites = [];
    for (const { reglages, avant } of aEcrire) {
      const teinte = themeChange(avant, reglages)
        ? await teinteAEnregistrer(tx, avant.sessionId, { id: reglages.partieId, nature: natureLue(avant.nature), theme: reglages.theme }, themesClub)
        : undefined;
      ecrites.push(
        await tx.sessionPartie.update({
          where: { id: reglages.partieId },
          data: {
            instructeurId: reglages.instructeurId,
            instructeurSecondId: reglages.instructeurSecondId,
            theme: reglages.theme,
            description: reglages.description,
            niveau: reglages.niveau,
            ...(teinte !== undefined ? { teinte } : {}),
            modifieParId: user.id,
          },
          include: {
            instructeur: { select: { prenom: true, nom: true } },
            instructeurSecond: { select: { prenom: true, nom: true } },
          },
        }),
      );
    }
    return ecrites;
  });

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

/** Ce que le journal et les messages disent d'une nature : « Cours ajouté. », « Option ajoutée. » */
const AJOUTEE: Record<NatureElement, string> = {
  ECHAUFFEMENT: "Échauffement ajouté",
  COURS: "Cours ajouté",
  OPTION: "Option ajoutée",
  ATELIER: "Atelier placé",
};

/** Le nombre de parties d'une séance : son plus grand `bloc` (contigu à partir de 1 par construction). */
function nombreDeParties(parties: ReadonlyArray<{ bloc: number }>): number {
  return parties.reduce((m, p) => Math.max(m, p.bloc), 0);
}

/**
 * **Où atterrit chaque élément une fois la séance rangée** — `bloc` et `ordre` finaux, par id. C'est
 * ce qui permet de répondre « ce geste change-t-il quelque chose ? » **avant** d'écrire : un élément
 * seul dans la dernière partie qu'on « descend » vers une partie nouvelle retombe, rangé, exactement
 * où il était.
 */
function placesApresRangement(parties: ReadonlyArray<PartieARanger>): Map<string, string> {
  const finales = new Map(parties.map((p) => [p.id, { bloc: p.bloc, ordre: p.ordre }]));
  for (const r of rangementsParties(parties)) {
    const f = finales.get(r.id)!;
    if (r.data.bloc !== undefined) f.bloc = r.data.bloc;
    if (r.data.ordre !== undefined) f.ordre = r.data.ordre;
  }
  return new Map([...finales].map(([id, f]) => [id, `${f.bloc}:${f.ordre}`]));
}

/** Les éléments d'une séance, prêts à ranger (nature lue, jamais une chaîne inconnue). */
async function elementsARanger(client: Pick<Prisma.TransactionClient, "sessionPartie">, sessionId: string): Promise<PartieARanger[]> {
  const lus = await client.sessionPartie.findMany({ where: { sessionId }, select: SELECTION_RANGEMENT });
  return lus.map((p) => ({ ...p, nature: natureLue(p.nature) }));
}

/**
 * **Créer un élément dans une partie, dans une transaction déjà ouverte** — le corps de l'ajout,
 * partagé par le geste unitaire (`ajouterPartie`) et le geste de masse (`ajouterPartiesEnMasse`) :
 * deux portes vers la même écriture, une seule façon de l'écrire (partie, rang, nom calculé,
 * rangement de la séance, plafond). Rend `null` quand la séance a atteint `PARTIES_PAR_SEANCE_MAX`
 * éléments : chaque appelant dit le refus dans ses mots.
 *
 * **La partie demandée est ramenée aux limites de la séance** : au-delà de la dernière, c'est une
 * partie nouvelle à la fin (`nbParties + 1`). C'est ce qui fait marcher le geste de masse sur des
 * séances qui n'ont pas toutes le même nombre de parties — « ajouter un échauffement en partie 3 » à
 * une séance qui n'en a qu'une le pose dans une partie 2 nouvelle, plutôt que de laisser un trou.
 *
 * L'élément naît **à sa place par défaut dans sa partie** (`ordreDInsertion` : après le dernier
 * élément dont la nature vient avant la sienne dans `ORDRE_DEFAUT_NATURES` — échauffement, cours,
 * atelier, option —, sinon en tête) ; le rangement renumérote la séance et recale les noms des
 * voisins — le cours seul d'une partie devient « Cours 1 » quand un second arrive. L'ordre que
 * l'équipe a donné aux autres éléments n'est pas touché.
 */
async function creerPartie(
  tx: Prisma.TransactionClient,
  sessionId: string,
  voulu: { bloc: number; nature: NatureElement },
  auteurId: string,
  themesClub: readonly string[],
) {
  const existantes = await elementsARanger(tx, sessionId);
  if (existantes.length >= PARTIES_PAR_SEANCE_MAX) return null;
  const bloc = Math.min(Math.max(voulu.bloc, 1), nombreDeParties(existantes) + 1);
  const ordre = ordreDInsertion(existantes, bloc, voulu.nature);
  // Un cours ou une option naît sans thème : il prend la teinte 1 si elle est libre dans la séance,
  // sinon la suivante libre — et la garde jusqu'à ce que son thème change.
  const teinte = await teinteAEnregistrer(tx, sessionId, { nature: voulu.nature, theme: "" }, themesClub);
  const nouvelle = await tx.sessionPartie.create({
    // Libellé et rang provisoires : `rangerParties`, juste en dessous, pose les vrais (et rien d'autre
    // ne lit la ligne avant le commit). La base ne prend qu'un rang entier, le rangement reçoit le
    // rang intercalaire (`ordreEntier`).
    data: { sessionId, libelle: "", bloc, nature: voulu.nature, teinte, ordre: ordreEntier(ordre), modifieParId: auteurId },
    select: SELECTION_RANGEMENT,
  });
  for (const ecriture of rangerParties([...existantes, { ...nouvelle, ordre }], tx)) await ecriture;
  return tx.sessionPartie.findUniqueOrThrow({ where: { id: nouvelle.id }, select: { id: true, libelle: true, bloc: true, nature: true } });
}

/**
 * **Ajouter un élément à une séance** : un échauffement, un cours, une option — ou un atelier en
 * attente — dans la partie `bloc` (`nbParties + 1` = une partie nouvelle). Sous `planning.edit`,
 * comme remplir une case : c'est le même geste de tenue du programme, fait par les mêmes personnes.
 *
 * **Un atelier** (`nature: "ATELIER"`) se pose comme depuis une case (`programmerAtelierDansCase`),
 * avec les mêmes serrures : `ateliers.moderate`, un atelier **en attente** (et pas déjà dans une
 * case), une séance **à venir**. Il devient planifié sur la séance, son proposant mène l'élément et
 * son titre en devient le thème (`placerAtelier`), et le membre est prévenu.
 *
 * L'élément naît **sans nom à saisir** : son libellé se déduit de sa partie et de son rang dans sa
 * nature (`libelleElement`).
 */
export async function ajouterPartie(input: {
  sessionId: string;
  bloc: number;
  nature: NatureElement;
  atelierId?: string;
}): Promise<FormState & { partieId?: string }> {
  const user = await assertPermission("planning.edit");
  const parsed = nouvellePartieSchema.safeParse(input);
  if (!parsed.success) return zodToFormState(parsed.error);
  const { sessionId, bloc, nature, atelierId } = parsed.data;

  const ctx = await seancePourEcriture(sessionId);
  if ("erreur" in ctx) return ctx;

  // Les serrures de l'atelier, toutes pesées **avant** la première écriture.
  let aPlacer: Extract<Awaited<ReturnType<typeof atelierAPlacer>>, { atelier: unknown }> | null = null;
  if (nature === "ATELIER" && atelierId) {
    if (!can(user, "ateliers.moderate")) return { erreur: "Programmer un atelier est réservé à l'équipe qui les modère." };
    const verdict = await atelierAPlacer(atelierId, sessionId);
    if ("erreur" in verdict) return { erreur: verdict.erreur };
    aPlacer = verdict;
  }

  /*
   * La séance est **relue dans** la transaction : deux ajouts au même instant (deux instructeurs
   * sur la même séance, ou un double clic) liraient sinon dehors le même nombre de parties. Prisma
   * ne tient qu'une connexion vers SQLite, qui n'accepte qu'un écrivain à la fois : la transaction
   * les met réellement à la file.
   */
  const themesClub = await getThemes();
  const creee = await db.$transaction((tx) => creerPartie(tx, sessionId, { bloc, nature }, user.id, themesClub));
  if (!creee)
    return {
      erreur: `Une séance ne peut pas porter plus de ${PARTIES_PAR_SEANCE_MAX} éléments.`,
    };

  let libelle = creee.libelle;
  if (aPlacer) {
    const a = aPlacer.atelier;
    const decide = await db.atelier.update({ where: { id: a.id }, data: { statut: "PLANIFIE", sessionId } });
    const posee = await placerAtelier(a.id, sessionId, user.id, creee.id);
    libelle = posee?.libelle ?? libelle;
    const prevenir = await notifierDecisionAtelier({
      atelier: decide,
      proposePar: a.proposePar,
      statut: "PLANIFIE",
      commentaire: a.commentaireInstructeur,
      seance: aPlacer.seance,
    });
    await audit(user, "atelier.decision", a.id, { statut: "PLANIFIE", sessionId, partie: libelle, depuis: "planning" });
    await audit(user, "planning.partie.ajout", sessionId, { date: ctx.session.date, partie: libelle, bloc: creee.bloc, nature });
    rafraichir(sessionId);
    return { succes: prevenir ? "Atelier placé — le membre est prévenu par email." : "Atelier placé.", partieId: creee.id };
  }

  await synchroniserSeance(sessionId);
  await audit(user, "planning.partie.ajout", sessionId, {
    date: ctx.session.date,
    partie: libelle,
    bloc: creee.bloc,
    nature,
  });
  rafraichir(sessionId);
  return { succes: `${AJOUTEE[nature]}.`, partieId: creee.id };
}

/**
 * **L'atelier qu'on veut poser depuis le menu d'ajout, et la séance qui le recevra** — les serrures
 * de `programmerAtelierDansCase`, dans les mêmes mots : un atelier en attente qui n'occupe aucune
 * case, et une séance à venir.
 */
async function atelierAPlacer(atelierId: string, sessionId: string) {
  const [atelier, occupe, seance] = await Promise.all([
    db.atelier.findUnique({ where: { id: atelierId }, include: { proposePar: true } }),
    db.sessionPartie.findFirst({ where: { atelierId }, select: { id: true } }),
    db.session.findUnique({ where: { id: sessionId }, select: { date: true, heureDebut: true, lieu: true } }),
  ]);
  if (!atelier || !seance) return { erreur: "Atelier ou séance introuvable." } as const;
  if (atelier.statut !== "PROPOSE" || occupe || !transitionAutorisee(atelier.statut, "PLANIFIE"))
    return { erreur: "Cet atelier n'est plus en attente : il a déjà été traité." } as const;
  if (seance.date < todayIso()) return { erreur: "Choisis une séance à venir pour placer l'atelier." } as const;
  return { atelier, seance } as const;
}

/**
 * **Ajouter un même élément à plusieurs séances d'un coup** — la sélection multiple du planning :
 * un échauffement, un cours ou une option, dans la partie `bloc` (un atelier se place un à un).
 *
 * Comme son jumeau de la carte (`ajouterPartie`), le geste s'enregistre **tout de suite** : un
 * élément provisoire n'aurait pas d'identifiant à donner au brouillon. Les verrous sont **exactement**
 * ceux du geste unitaire, par les **mêmes fonctions** : `planning.edit`, `seancePourEcriture` pour
 * chaque séance (trimestre clos, séance annulée, séance introuvable), puis `creerPartie` — partie
 * ramenée aux limites de **chaque** séance (une séance qui a moins de `bloc - 1` parties reçoit
 * l'élément dans une partie nouvelle, à la fin), rang, nom calculé, rangement, plafond.
 *
 * **Tout ou rien.** Les refus de séance se pèsent tous avant la transaction ; dans la transaction, le
 * plafond est vérifié pour **toutes** les séances avant la première création. Le lot est plafonné à
 * `SELECTION_MAX`, dédoublonné (une séance cochée deux fois ne reçoit pas deux éléments).
 *
 * **Le journal** : une entrée par séance, sous la **même action** que l'ajout unitaire
 * (`planning.partie.ajout`), avec `enMasse: true`, après le commit et hors transaction. Rien ne part
 * vers les gens : le planning ne notifie personne.
 */
export async function ajouterPartiesEnMasse(input: {
  sessionIds: string[];
  bloc: number;
  nature: Exclude<NatureElement, "ATELIER">;
}): Promise<FormState & { ajoutees?: number }> {
  const user = await assertPermission("planning.edit");
  const parsed = partiesEnMasseSchema.safeParse(input);
  if (!parsed.success) return { erreur: "Sélection invalide : coche des séances, puis choisis le geste. Rien n'a été ajouté." };
  const { sessionIds, bloc, nature } = parsed.data;

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

  const themesClub = await getThemes();
  const issue = await db.$transaction(async (tx) => {
    // Le plafond pesé pour toutes avant d'en créer une : c'est ce qui rend le « tout ou rien » vrai.
    for (const s of seances) {
      const existantes = await tx.sessionPartie.findMany({ where: { sessionId: s.id }, select: { id: true } });
      if (existantes.length >= PARTIES_PAR_SEANCE_MAX) return { pleine: s, creees: [] };
    }
    const creees: Array<{ seance: { id: string; date: string }; libelle: string; bloc: number }> = [];
    for (const s of seances) {
      const creee = await creerPartie(tx, s.id, { bloc, nature }, user.id, themesClub);
      // Impossible après la vérification ci-dessus, sauf écriture concurrente : on annule la transaction.
      if (!creee) throw new Error(`Séance pleine : ${s.id}`);
      creees.push({ seance: s, libelle: creee.libelle, bloc: creee.bloc });
    }
    return { pleine: null, creees };
  });
  if (issue.pleine)
    return {
      erreur: `La séance du ${minuscule(formatDateSansAnnee(issue.pleine.date))} porte déjà ${PARTIES_PAR_SEANCE_MAX} éléments, le plafond d'une séance. Rien n'a été ajouté.`,
    };

  for (const { seance } of issue.creees) await synchroniserSeance(seance.id);
  for (const { seance, libelle, bloc: place } of issue.creees) {
    await audit(user, "planning.partie.ajout", seance.id, { date: seance.date, partie: libelle, bloc: place, nature, enMasse: true });
  }
  for (const { seance } of issue.creees) rafraichir(seance.id);
  const n = issue.creees.length;
  const quoi = AJOUTEE[nature];
  return { succes: n === 1 ? `${quoi} à 1 séance.` : `${quoi} à ${n} séances.`, ajoutees: n };
}

/**
 * **Changer la nature d'un élément** : échauffement, cours ou option (le menu de
 * l'élément le propose).
 *
 * L'élément **garde sa place** — sa partie et son rang : l'ordre d'une partie est celui que l'équipe
 * a réglé, et changer de nature n'est pas déplacer. `rangerParties` ne recale que les noms (le second
 * cours qui devient une option fait du premier « Cours » tout court) — **sans** toucher le
 * `updatedAt` des voisins. L'élément dont on change la nature, lui, est horodaté : ce clic-là porte
 * sur lui.
 *
 * **Refusé tant qu'un atelier occupe l'élément** (ses réglages, eux, s'enregistrent par
 * `enregistrerCase`, thème figé) : un atelier se retire depuis la gestion des ateliers ou en
 * retirant l'élément.
 * Un élément Atelier **vide**, lui, peut redevenir un cours ou une option.
 */
export async function changerNaturePartie(input: {
  partieId: string;
  nature: Exclude<NatureElement, "ATELIER">;
}): Promise<FormState> {
  const user = await assertPermission("planning.edit");
  const parsed = naturePartieSchema.safeParse(input);
  if (!parsed.success) return zodToFormState(parsed.error);
  const { partieId, nature } = parsed.data;

  const ctx = await partiePourEcriture(partieId);
  if ("erreur" in ctx) return ctx;
  const avant = ctx.partie;
  if (avant.atelierId)
    return {
      erreur:
        "Un atelier occupe cet élément : déprogramme-le d'abord depuis la gestion des ateliers.",
    };
  if (avant.nature === nature) return { succes: "Rien à changer." };

  const maintenant = new Date();
  const toutes = await elementsARanger(db, avant.sessionId);
  /*
   * **La teinte suit la nature, pas l'inverse** : d'option à cours (ou l'inverse), l'élément garde la
   * sienne — c'est le même élément, au même thème. Devenu échauffement, il n'en a plus (`null`) ; venu
   * d'un échauffement ou d'un atelier vide, il en reçoit une, comme à sa création.
   */
  const garde = prendUneTeinte(natureLue(avant.nature)) && prendUneTeinte(nature);
  const themesClub = garde ? [] : await getThemes();
  await db.$transaction(async (tx) => {
    const teinte = garde ? undefined : await teinteAEnregistrer(tx, avant.sessionId, { id: partieId, nature, theme: avant.theme }, themesClub);
    await tx.sessionPartie.update({
      where: { id: partieId },
      data: { nature, ...(teinte !== undefined ? { teinte } : {}), modifieParId: user.id },
    });
    /*
     * L'élément change de nature **dans la liste** avant le rangement, à son rang d'avant, et avec un
     * horodatage **neuf** : le rangement peut réécrire son nom, donc l'écrire une seconde fois après
     * la ligne ci-dessus — en lui rendant son ancien `updatedAt`, il défairait la seule trace de ce
     * clic.
     */
    for (const ecriture of rangerParties(
      toutes.map((p) => (p.id === partieId ? { ...p, nature, updatedAt: maintenant } : p)),
      tx,
    ))
      await ecriture;
  });
  await synchroniserSeance(avant.sessionId);
  const apres = await db.sessionPartie.findUnique({
    where: { id: partieId },
    select: { libelle: true },
  });
  await audit(user, "planning.partie.nature", avant.sessionId, {
    date: avant.session.date,
    bloc: avant.bloc,
    avant: { partie: avant.libelle, nature: avant.nature },
    apres: { partie: apres?.libelle ?? avant.libelle, nature },
  });
  rafraichir(avant.sessionId);
  return { succes: `Passé en ${NOMS_NATURE[nature].toLocaleLowerCase("fr")}.` };
}

/**
 * **Retirer un élément.** Retirer le dernier élément d'une partie fait disparaître la partie, et les
 * suivantes se renumérotent (`rangerParties`).
 *
 * **Un élément qui porte un atelier** : l'atelier **revient en attente** (PROPOSE, plus de séance —
 * exactement ce que fait `libererAteliersDesSeances` à une séance annulée), journalisé
 * `atelier.decision` avec `depuis: "planning"`, puis l'élément est retiré. Il était refusé tant que
 * l'atelier l'occupait ; le menu de la partie propose désormais « retirer » sur un atelier comme sur
 * le reste, et l'atelier n'est pas perdu : il retourne dans la file, prêt à être placé ailleurs. Ce
 * geste touche à la décision d'un atelier : il demande donc aussi `ateliers.moderate`. Aucun email au
 * membre — la reprogrammation, elle, le préviendra.
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
  const atelier = partie.atelierId
    ? await db.atelier.findUnique({ where: { id: partie.atelierId }, select: { id: true, titre: true, statut: true } })
    : null;
  if (atelier && !can(user, "ateliers.moderate"))
    return { erreur: "Un atelier occupe cet élément : seule l'équipe qui modère les ateliers peut le retirer." };

  const restantes = (await elementsARanger(db, partie.sessionId)).filter((p) => p.id !== partie.id);
  // Retirer un élément recale les noms des voisins (« Cours 2 » redevient « Cours ») et, s'il était
  // seul dans sa partie, les numéros des parties suivantes — dans la même transaction.
  await db.$transaction([
    ...(atelier
      ? [
          db.atelier.updateMany({ where: { id: atelier.id, statut: "PLANIFIE" }, data: { statut: "PROPOSE", sessionId: null } }),
          db.atelier.updateMany({ where: { id: atelier.id }, data: { sessionId: null } }),
        ]
      : []),
    db.sessionPartie.delete({ where: { id: partie.id } }),
    ...rangerParties(restantes, db),
  ]);
  await synchroniserSeance(partie.sessionId);
  if (atelier) {
    await audit(user, "atelier.decision", atelier.id, {
      statut: atelier.statut === "PLANIFIE" ? "PROPOSE" : atelier.statut,
      sessionId: null,
      partie: partie.libelle,
      depuis: "planning",
    });
  }
  await audit(user, "planning.partie.retrait", partie.sessionId, {
    date: partie.session.date,
    partie: partie.libelle,
    bloc: partie.bloc,
    nature: partie.nature,
    /*
     * **Tout ce que la ligne portait au moment du retrait**, dans les mêmes mots que
     * `planning.case` : un seul filtre du journal raconte donc toute la vie d'une case, de son
     * premier remplissage à son retrait. Le geste est irréversible, et le journal est la seule chose
     * qui reste après lui.
     */
    theme: partie.theme,
    instructeur: nomDe(partie.instructeur),
    instructeurSecond: nomDe(partie.instructeurSecond),
    description: partie.description,
    niveau: libelleNiveau(partie.niveau),
    ...(atelier ? { atelier: atelier.titre } : {}),
  });
  rafraichir(partie.sessionId);
  if (atelier) revalidatePath("/ateliers");
  return { succes: atelier ? "Élément retiré — l'atelier est de retour en attente." : "Élément retiré." };
}

/**
 * **Le corps commun des deux déplacements**, dans une transaction : relire la partie et ses serrures
 * (`partiePourEcriture`), relire la séance (`elementsARanger`), demander au geste où poser l'élément
 * (`viser` : `null` pour « déjà là », une erreur pour une place qui n'existe plus), puis écrire la
 * ligne et le rangement — **sans toucher `updatedAt`**, la place change, pas le contenu.
 *
 * « Rien à changer » se mesure sur le résultat **rangé** ; et une ligne disparue malgré tout pendant
 * l'écriture (P2025) se dit en français plutôt que de remonter en exception.
 */
type PartieEcrite = Extract<Awaited<ReturnType<typeof partiePourEcriture>>, { partie: unknown }>["partie"];

async function deplacerDansTransaction(
  partieId: string,
  viser: (partie: PartieEcrite, toutes: PartieARanger[]) => { vers: number; ordre: number } | { erreur: string } | null,
): Promise<{ erreur: string } | { succes: string } | { partie: PartieEcrite; apresRangement: Map<string, string>; vers: number }> {
  try {
    return await db.$transaction(async (tx) => {
      const ctx = await partiePourEcriture(partieId, tx);
      if (ctx.erreur !== undefined) return { erreur: ctx.erreur };
      const partie = ctx.partie;
      const toutes = await elementsARanger(tx, partie.sessionId);
      const vise = viser(partie, toutes);
      if (vise === null) return { succes: "Rien à changer." } as const;
      if ("erreur" in vise) return vise;
      const { vers, ordre } = vise;
      const voulues = toutes.map((p) => (p.id === partieId ? { ...p, bloc: vers, ordre } : p));
      const avantRangement = placesApresRangement(toutes);
      const apresRangement = placesApresRangement(voulues);
      if ([...avantRangement].every(([id, place]) => apresRangement.get(id) === place)) return { succes: "Rien à changer." } as const;
      // Le changement de place lui-même : `rangerParties` compare à la liste qu'on lui donne, où
      // l'élément est **déjà** à sa nouvelle place — il n'écrirait donc pas ce `bloc`-là. Son
      // horodatage est rendu tel quel. Le rangement qui suit peut encore renuméroter la partie : la
      // dernière écriture gagne.
      await tx.sessionPartie.update({ where: { id: partieId }, data: { bloc: vers, ordre: ordreEntier(ordre), updatedAt: partie.updatedAt } });
      for (const ecriture of rangerParties(voulues, tx)) await ecriture;
      return { partie, apresRangement, vers } as const;
    });
  } catch (e) {
    if ((e as { code?: string } | null)?.code === "P2025")
      return { erreur: "Un élément de cette séance a changé entre-temps : recharge la page, puis recommence." } as const;
    throw e;
  }
}

/**
 * **Les numéros de partie d'un déplacement, pour le journal** — trois numéros, deux numérotations,
 * et chacun nommé pour ce qu'il est : `partieDepart` (avant le geste, numérotation d'avant),
 * `versDemande` (ce que l'écran a envoyé, tel quel) et `partieArrivee` (après rangement : une partie
 * vidée disparaît et renumérote les suivantes, si bien que l'arrivée peut valoir un de moins que la
 * demande). Les anciens `de` / `vers` mêlaient la première et la troisième sans le dire.
 */
function placesJournal(depart: number, versDemande: number, apresRangement: ReadonlyMap<string, string>, partieId: string, vers: number) {
  return {
    partieDepart: depart,
    versDemande,
    partieArrivee: Number((apresRangement.get(partieId) ?? `${vers}:0`).split(":")[0]),
  };
}

/**
 * **Changer un élément de partie** : `versBloc` ∈ [1, nbParties + 1] — le bouton ↑ vise la partie
 * précédente, ↓ la suivante (ou une partie nouvelle, à la fin). Le numéro visé est ramené dans les
 * limites de la séance plutôt que refusé : un « monter » dans la partie 1 ne doit pas afficher
 * d'erreur, il ne doit rien faire.
 *
 * L'élément arrive **à sa place par défaut** dans la partie visée (`ordreDInsertion`, comme un
 * élément ajouté) ; le rangement renumérote, recale les noms et — si l'élément était seul dans sa
 * partie — fait disparaître celle-ci en renumérotant les suivantes. Pour le poser ailleurs dans la
 * partie, c'est `deplacerElement`. **Sans toucher `updatedAt`** de personne : la place a changé, pas le
 * contenu ; le geste se lit au journal (`planning.partie.ordre`, qui dit d'où à où).
 *
 * **« Rien à changer » se mesure sur le résultat rangé**, pas sur le numéro demandé : l'élément seul
 * de la dernière partie qu'on « descend » vers une partie nouvelle retombe, rangé, exactement où il
 * était — l'écran ne doit pas annoncer un déplacement qui n'a pas eu lieu.
 */
export async function deplacerPartie(input: {
  partieId: string;
  versBloc: number;
}): Promise<FormState> {
  const user = await assertPermission("planning.edit");
  const parsed = deplacerPartieSchema.safeParse(input);
  if (!parsed.success) return zodToFormState(parsed.error);
  const { partieId, versBloc } = parsed.data;

  /*
   * **Lu et écrit dans la même transaction**, comme l'ajout (`creerPartie`) : lue dehors, la séance
   * pouvait changer entre la lecture et l'écriture — un retrait au même instant, et la mise à jour
   * visait une ligne disparue (P2025, une exception au lieu d'une phrase). SQLite n'accepte qu'un
   * écrivain à la fois : la transaction met réellement les deux gestes à la file.
   */
  const fait = await deplacerDansTransaction(partieId, (partie, toutes) => {
    const vers = Math.min(Math.max(versBloc, 1), nombreDeParties(toutes) + 1);
    if (vers === partie.bloc) return null;
    return { vers, ordre: ordreDInsertion(toutes.filter((p) => p.id !== partieId), vers, natureLue(partie.nature)) };
  });
  if ("erreur" in fait || "succes" in fait) return fait;
  const { partie, apresRangement, vers } = fait;
  // Indispensable ici : `disciplines` est la liste des thèmes **dans l'ordre des éléments**, et c'est
  // elle qu'on lit dans l'objet de l'email du soir. Déplacer un élément change donc ce qui part.
  await synchroniserSeance(partie.sessionId);
  await audit(user, "planning.partie.ordre", partie.sessionId, {
    date: partie.session.date,
    partie: partie.libelle,
    bloc: partie.bloc,
    nature: partie.nature,
    ...placesJournal(partie.bloc, versBloc, apresRangement, partieId, vers),
  });
  rafraichir(partie.sessionId);
  return { succes: "Élément déplacé." };
}

/**
 * **Poser un élément à une place précise** — le glisser-déposer : dans la partie `versBloc` (de 1 à
 * nbParties + 1, la dernière valeur ouvrant une partie nouvelle ; ramenée aux limites comme pour
 * `deplacerPartie`), **juste avant** l'élément `avantId`, ou en fin de partie quand `avantId` vaut
 * `null`. C'est le geste qui rend l'ordre d'une partie libre : on y inverse deux éléments, on remonte
 * une option au-dessus d'un cours.
 *
 * `avantId` doit être un élément **de la même séance et de la partie visée** — sinon l'écran visait
 * une place qui n'existe plus (un voisin retiré entre-temps), et le geste est refusé plutôt que posé
 * au hasard. Viser l'élément lui-même ne déplace rien.
 *
 * Mêmes serrures et même écriture que `deplacerPartie` : `planning.edit`, `partiePourEcriture`
 * (trimestre clos, séance annulée), une transaction avec `rangerParties`, **aucun `updatedAt`
 * touché** — la place change, pas le contenu —, et le journal sous la **même action**
 * (`planning.partie.ordre`) : un seul filtre retrouve tous les déplacements, d'où qu'ils viennent.
 * « Rien à changer » se mesure, là aussi, sur le résultat rangé.
 */
export async function deplacerElement(input: { partieId: string; versBloc: number; avantId: string | null }): Promise<FormState> {
  const user = await assertPermission("planning.edit");
  const parsed = deplacerElementSchema.safeParse(input);
  if (!parsed.success) return zodToFormState(parsed.error);
  const { partieId, versBloc, avantId } = parsed.data;

  // Lu et écrit dans la même transaction, pour la même raison que `deplacerPartie`.
  const fait = await deplacerDansTransaction(partieId, (_partie, toutes) => {
    // Viser l'élément lui-même ne déplace rien — les serrures, elles, sont déjà passées.
    if (avantId === partieId) return null;
    const vers = Math.min(versBloc, nombreDeParties(toutes) + 1);
    const ordre = ordreAvant(
      toutes.filter((p) => p.id !== partieId),
      vers,
      avantId,
    );
    // Un voisin d'une autre séance, d'une autre partie, ou retiré depuis : `ordreAvant` ne le trouve
    // pas dans la partie visée de **cette** séance.
    if (ordre === null) return { erreur: "Cette place n'existe plus : recharge la page, puis recommence." };
    return { vers, ordre };
  });
  if ("erreur" in fait || "succes" in fait) return fait;
  const { partie, apresRangement, vers } = fait;
  // `disciplines` suit l'ordre des éléments : changer l'ordre change ce que l'email du soir annonce.
  await synchroniserSeance(partie.sessionId);
  const places = placesJournal(partie.bloc, versBloc, apresRangement, partieId, vers);
  const ordreFinal = Number((apresRangement.get(partieId) ?? `${vers}:0`).split(":")[1]);
  // La place d'arrivée dans sa partie, à partir de 1 : « 2e de la partie 3 » se relit sans la séance.
  const position = [...apresRangement.values()].filter((place) => {
    const [b, o] = place.split(":").map(Number);
    return b === places.partieArrivee && o <= ordreFinal;
  }).length;
  await audit(user, "planning.partie.ordre", partie.sessionId, {
    date: partie.session.date,
    partie: partie.libelle,
    bloc: partie.bloc,
    nature: partie.nature,
    ...places,
    position,
  });
  rafraichir(partie.sessionId);
  return { succes: "Élément déplacé." };
}

/**
 * Programme un atelier validé directement depuis une case du planning (équipe).
 *
 * **Seulement dans une case vide**. Le seul garde-fou était « pas d'autre atelier ici », et
 * `placerAtelier` **remplace** tout le contenu de la case : l'instructeur et le second deviennent les animateurs de la proposition (à défaut le proposant),
 * le thème devient le titre de l'atelier, la description repart à vide et
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
  // L'élément passe en nature Atelier : son nom change, c'est le nouveau que le journal retient.
  const posee = await placerAtelier(atelierId, partie.sessionId, user.id, partieId);
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
    partie: posee?.libelle ?? partie.libelle,
    bloc: partie.bloc,
    nature: "ATELIER",
    depuis: "planning",
  });
  rafraichir(partie.sessionId);
  return {
    succes: prevenir
      ? "Atelier programmé — le membre est prévenu par email."
      : "Atelier programmé.",
  };
}

/**
 * Liste des **thèmes de cours et options** (une ligne par thème ; la clé `themes`, ex-« Thèmes du
 * planning ») : elle vaut pour tout le club, donc bureau seul (`themes.manage`). Sa jumelle des
 * échauffements est `enregistrerThemesEchauffement`.
 */
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
 * **Les thèmes d'échauffement** : jumelle d'`enregistrerThemes` — même porte
 * (`themes.manage`, donc bureau et élévation), même schéma, même nettoyage, même écran à rafraîchir —
 * avec son propre geste au journal (`themes_echauffement.modifies`), pour qu'on lise laquelle des deux
 * listes a bougé.
 *
 * **Une différence, voulue : la liste vide est acceptée.** C'est l'état de départ (aucun défaut, voir
 * `getThemesEchauffement`), et un club qui ne nomme pas ses échauffements doit pouvoir y revenir ;
 * la case garde alors la saisie libre. Les cours, eux, ont toujours au moins un thème.
 */
export async function enregistrerThemesEchauffement(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const user = await assertPermission("themes.manage");
  const parsed = themesSchema.safeParse({ texte: champ(fd, "texte") });
  if (!parsed.success) return zodToFormState(parsed.error);
  const themes = nettoyerThemes(parsed.data.texte);
  await setThemesEchauffement(themes);
  await audit(user, "themes_echauffement.modifies", null, { nombre: themes.length });
  revalidatePath("/planning");
  revalidatePath("/gestion/ateliers");
  revalidatePath("/admin/themes");
  if (themes.length === 0)
    return { succes: "Aucun thème d'échauffement : il se saisira librement dans chaque case." };
  return {
    succes: `${themes.length} thème${themes.length > 1 ? "s" : ""} d'échauffement enregistré${themes.length > 1 ? "s" : ""}.`,
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
