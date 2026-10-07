import { db } from "./db";
import { estNatureElement, libelleElement, niveauAffiche, NIVEAU_DEFAUT, PARTIES_MODELE, type NatureElement, type Niveau } from "./constants";
import { THEMES_DU_CLUB, THEMES_ECHAUFFEMENT_DU_CLUB } from "./themes-club";
import { addDays, formatDateCourte, isoWeekday, nomMois, seanceCommencee, todayIso } from "./dates";
import { compterPresences, type Compteurs } from "./presences";
import { can, isStaff, type UserLike } from "./permissions";
import { nettoyerLieux, type Lieu } from "./lieux";
import { LIEUX_DU_CLUB } from "./lieux-club";
import { CLES, getSetting, setSetting } from "./settings";
// Même raison : la définition de « case vide » doit être lisible par le navigateur (`CaseEditeur` ne
// peut rien importer d'ici) autant que par le serveur. Une seule règle, un seul fichier.
import { reglagesVides } from "@/components/planning/options";
// Le calcul des invariants d'une séance (parties contiguës, rangs contigus, libellés d'accord avec
// eux) vit dans un module **sans Prisma** : le script de réparation doit pouvoir le relever sans ouvrir
// de base, et la règle ne doit exister qu'une fois (voir l'en-tête de `rangement.ts`). La place d'un
// élément dans sa partie (`placesDansPartie`) en vient aussi : le rang qui décide du nom est celui qui
// s'affiche à côté.
import { ordreDInsertion, ordreEntier, placesDansPartie, rangementsParties, type PartieARanger, type RangementPartie } from "@/components/planning/rangement";

/**
 * Planning de cours : une colonne par séance, **autant de cases que la séance a de parties**,
 * chacune avec son (ou ses) instructeur(s), son thème, son niveau et sa description.
 *
 * Les cases étaient au nombre de quatre, figées dans le code, et le nom de la case servait de clé en
 * base. Une séance porte maintenant ses propres parties : elles s'ajoutent, se retirent, se
 * déplacent et changent de nature. L'`id` de la partie a remplacé son nom partout où il fallait la
 * désigner.
 *
 * **Parties et éléments** : chaque ligne `SessionPartie` est un **élément** (échauffement,
 * cours, option, atelier) rangé dans une **partie** numérotée (`bloc`). Une partie n'existe que par
 * ses éléments.
 *
 * **Le nom d'un élément n'est pas une donnée saisie** : il se calcule depuis sa partie et son rang
 * dans sa nature (`libelleElement`) et la colonne `libelle` est tenue à jour par `rangerParties`, au
 * seul endroit où les éléments d'une séance se rangent. Ce qui décrit l'élément, c'est son contenu.
 *
 * Les cases restent la source de vérité du « programme » : après chaque modification,
 * `synchroniserSeance` recopie thèmes et instructeurs dans la séance (cartes, exports, récaps).
 */

export type Personne = { id: string; prenom: string; nom: string; role: string; couleur: number | null };

export type CasePlanning = {
  id: string;
  /** Rang dans la séance, contigu à partir de 0 (voir `rangerParties`) */
  ordre: number;
  /** **Numéro de la partie** (« Partie 2 »), contigu à partir de 1 */
  bloc: number;
  /** Ce qu'est l'élément dans sa partie : échauffement, cours, option ou atelier */
  nature: NatureElement;
  /**
   * Rang de l'élément **dans sa partie et sa nature**, à partir de 1, et le **nombre** d'éléments de
   * cette nature dans la partie (`placesDansPartie`) — calculés sur la séance **entière**, jamais
   * recomptés après un filtre d'affichage. `nomElement(nature, rang, nombre)` en fait le nom court.
   */
  rang: number;
  nombre: number;
  /** Nom complet calculé (« Partie 1 · Cours »), tenu à jour par `rangerParties` */
  libelle: string;
  instructeurId: string | null;
  instructeur: string | null;
  /** **Celui qui assiste** : un second encadrant, facultatif — jamais publié vers l'extérieur */
  instructeurSecondId: string | null;
  instructeurSecond: string | null;
  theme: string;
  /**
   * **Ce qu'on fera dans cette partie**, en texte libre, vide tant que personne ne l'a écrit. C'est
   * le seul champ de la case qui raconte plutôt que de désigner — et il **sort du club** (API
   * publique, pages de partage), comme le thème.
   */
  description: string;
  /** Niveau annoncé de la case — `INDIFFERENT` tant que personne n'en a choisi un (voir `niveauAffiche`) */
  niveau: Niveau;
  atelier: { id: string; titre: string; materiel: string | null } | null;
  modifiePar: string | null;
  modifieLe: string | null;
};

export type ColonnePlanning = {
  id: string;
  date: string;
  heureDebut: string;
  heureFin: string;
  lieu: string;
  annulee: boolean;
  motifAnnulation: string | null;
  commencee: boolean;
  /** "AAAA-MM" pour le regroupement par mois */
  mois: string;
  /** Les parties de la séance, **déjà triées par `ordre`** : la grille les affiche telles quelles */
  parties: CasePlanning[];
  compteurs: Compteurs;
  /** Nombre de participants ayant répondu « Présent » parmi la liste nominative (pour l'infobulle) */
  presents: string[];
};

export type Planning = {
  periode: { id: string; nom: string; dateDebut: string; dateFin: string; statut: string };
  colonnes: ColonnePlanning[];
  mois: Array<{ cle: string; label: string; nombre: number }>;
  /**
   * Personnes proposables dans une case — les **instructeurs**, plus celles déjà posées sur une case
   * de la période (`personnesPlanning`). **Vide** pour qui ne peut pas écrire : la liste ne sort pas.
   */
  personnes: Personne[];
  /** Thèmes proposés aux cours et options (réglage « Thèmes de cours et options ») */
  themes: string[];
  /** Thèmes proposés aux échauffements (réglage « Thèmes d'échauffement ») */
  themesEchauffement: string[];
  /** Ateliers en attente (proposables dans une case par l'équipe : un seul geste pour les placer) — vide sinon */
  ateliersDisponibles: Array<{ id: string; titre: string; proposePar: string; sessionId: string | null }>;
  /** L'utilisateur courant peut modifier les cases */
  modifiable: boolean;
  /** L'utilisateur courant peut programmer un atelier depuis une case */
  peutProgrammer: boolean;
};

/** Lundi de la semaine contenant la date (AAAA-MM-JJ). */
export function debutSemaine(iso: string): string {
  return addDays(iso, 1 - isoWeekday(iso));
}

/** Semaines d'un mois du planning : clé = lundi, libellé « Sem. du 1 sept. », colonnes concernées. */
export function semainesDuMois(colonnes: Array<{ date: string; mois: string }>, mois: string): Array<{ cle: string; label: string; nombre: number }> {
  const semaines: Array<{ cle: string; label: string; nombre: number }> = [];
  for (const c of colonnes.filter((c) => c.mois === mois)) {
    const cle = debutSemaine(c.date);
    const existante = semaines.find((s) => s.cle === cle);
    if (existante) existante.nombre++;
    else semaines.push({ cle, label: `Semaine du ${formatDateCourte(cle).split(" ").slice(1).join(" ")}`, nombre: 1 });
  }
  return semaines;
}

/** Liste des thèmes (réglage `themes`, sinon les thèmes du club : `themes-club.ts`). */
export async function getThemes(): Promise<string[]> {
  const brut = await getSetting(CLES.themes);
  if (!brut) return [...THEMES_DU_CLUB];
  try {
    const liste = JSON.parse(brut);
    if (Array.isArray(liste) && liste.every((t) => typeof t === "string")) return liste;
  } catch {
    /* réglage corrompu : on retombe sur la liste par défaut */
  }
  return [...THEMES_DU_CLUB];
}

export async function setThemes(themes: string[]): Promise<void> {
  await setSetting(CLES.themes, JSON.stringify(themes));
}

/**
 * **Les thèmes d'échauffement** (réglage `themesEchauffement`) : la liste que propose
 * une case de nature ÉCHAUFFEMENT, quand cours et options gardent `getThemes`.
 *
 * **Son propre défaut** (`THEMES_ECHAUFFEMENT_DU_CLUB`, src/lib/themes-club.ts) tant que rien n'est
 * enregistré, ou si le réglage est abîmé — jamais les thèmes de cours. Une liste enregistrée, même
 * vide, fait foi : la case n'offre alors que la saisie libre (« Autre… »). Publiée telle quelle dans le
 * dépôt public, comme les thèmes de cours.
 */
export async function getThemesEchauffement(): Promise<string[]> {
  const brut = await getSetting(CLES.themesEchauffement);
  if (!brut) return [...THEMES_ECHAUFFEMENT_DU_CLUB];
  try {
    const liste = JSON.parse(brut);
    if (Array.isArray(liste) && liste.every((t) => typeof t === "string")) return liste;
  } catch {
    /* réglage corrompu : on retombe sur la liste par défaut */
  }
  return [...THEMES_ECHAUFFEMENT_DU_CLUB];
}

export async function setThemesEchauffement(themes: string[]): Promise<void> {
  await setSetting(CLES.themesEchauffement, JSON.stringify(themes));
}

/**
 * **Les lieux habituels des cours**, rangés ici et non dans `src/lib/lieux.ts` : ce module-là est
 * **pur**, pour être lisible depuis le sélecteur de lieu, qui est un composant client. Importer une
 * lecture de base depuis le navigateur entraînerait `settings.ts`, donc `crypto.ts`, donc
 * `node:crypto` — et le build échoue (constaté, et c'est tant mieux).
 *
 * **Réglage jamais enregistré → les salles du club** (`LIEUX_DU_CLUB`, `src/lib/lieux-club.ts` —
 * vide dans le dépôt public, où un club qui vient d'installer l'outil saisit le lieu séance par
 * séance). Dès qu'une liste a été enregistrée, **même vide**, c'est elle qui fait foi : le défaut ne
 * revient jamais par-dessus une décision du bureau.
 */
export async function getLieux(): Promise<Lieu[]> {
  const brut = await getSetting(CLES.lieux);
  if (brut === null) return nettoyerLieux(LIEUX_DU_CLUB.map((l) => `${l.lieu} | ${l.adresse}`).join("\n"));
  if (!brut) return [];
  try {
    const liste = JSON.parse(brut);
    if (!Array.isArray(liste)) return [];
    // On revalide en relisant : un réglage écrit par une version antérieure (ou abîmé) ne doit pas
    // faire tomber le formulaire de séance, qui est un écran de travail quotidien.
    return nettoyerLieux(
      liste
        .filter((l): l is Record<string, unknown> => typeof l === "object" && l !== null)
        .map((l) => `${typeof l.lieu === "string" ? l.lieu : ""} | ${typeof l.adresse === "string" ? l.adresse : ""}`)
        .join("\n"),
    );
  } catch {
    return [];
  }
}

export async function setLieux(lieux: Lieu[]): Promise<void> {
  await setSetting(CLES.lieux, JSON.stringify(lieux));
}

/** Nettoie une liste saisie (une ligne par thème) : coupe, dédoublonne, ignore les vides. */
export function nettoyerThemes(texte: string, max = 60): string[] {
  const vus = new Set<string>();
  const liste: string[] = [];
  for (const ligne of texte.split(/\r?\n|,/)) {
    const t = ligne.trim().slice(0, max);
    const cle = t.toLocaleLowerCase("fr");
    if (!t || vus.has(cle)) continue;
    vus.add(cle);
    liste.push(t);
  }
  return liste;
}

/**
 * Périodes qu'une personne a le droit de regarder : l'équipe les voit toutes, chacun d'autre
 * ne voit que celles où il est invité. Le même filtre qu'à l'onglet Séances, pour que la liste
 * proposée et le planning effectivement chargé disent exactement la même chose.
 */
export function periodesVisiblesPar(user: UserLike & { id: string }) {
  return isStaff(user) ? {} : { membres: { some: { userId: user.id } } };
}

/**
 * Période affichée par défaut : la période active en cours (ou la prochaine à démarrer),
 * sinon la période active la plus récente, sinon un brouillon, sinon la dernière.
 * Toujours parmi celles où la personne a sa place : proposer d'office le trimestre d'à côté
 * reviendrait à en ouvrir la porte sans que personne ne l'ait demandé.
 */
export async function periodePlanningParDefaut(user: UserLike & { id: string }, now = new Date()): Promise<{ id: string } | null> {
  const aujourdHui = todayIso(now);
  const sienne = periodesVisiblesPar(user);
  return (
    (await db.period.findFirst({ where: { ...sienne, statut: "ACTIVE", dateFin: { gte: aujourdHui } }, orderBy: { dateDebut: "asc" }, select: { id: true } })) ??
    (await db.period.findFirst({ where: { ...sienne, statut: "ACTIVE" }, orderBy: { dateDebut: "desc" }, select: { id: true } })) ??
    (await db.period.findFirst({ where: { ...sienne, statut: "BROUILLON" }, orderBy: { dateDebut: "desc" }, select: { id: true } })) ??
    (await db.period.findFirst({ where: sienne, orderBy: { dateDebut: "desc" }, select: { id: true } }))
  );
}

/**
 * Personnes proposables dans une case : **les instructeurs**, plus celles déjà posées sur une case.
 *
 * **Décision, Delta, après la v0.53.0** : « pour le champ des instructeurs dans planning tu as mis
 * en liste tous les users, je ne veux que ceux qui ont le rôle instructeur ».
 *
 * *Ce qu'elle remplace.* Le, la même liste avait été **ouverte à tout le club** (« dans planning je
 * veux que tous les users, même les prochains ajouts, soient visibles dans la liste déroulante ») :
 * elle était alors restreinte à l'équipe **plus les membres invités sur cette période**, si bien
 * qu'une personne inscrite après la génération du trimestre n'apparaissait nulle part. Le
 * commentaire d'alors défendait l'ouverture totale — « mener une partie de cours n'est pas un
 * droit » —, et c'est cette phrase-là qui tombe : **le vrai défaut était le filtre de période, pas
 * le filtre de rôle**. Les deux se confondaient dans une seule condition, les séparer les traite
 * chacun pour ce qu'il est. Un instructeur recruté demain reste donc dans la liste sans qu'on ait
 * rien à faire — c'est ce que l'ouverture cherchait —, mais les trente membres du club n'encombrent
 * plus un menu où l'on cherche un encadrant.
 *
 * *Le rôle retenu est `INSTRUCTEUR`, et lui seul — et c'est devenu la bonne réponse.* Ce paragraphe
 * disait l'inverse : les trois rôles étant exclusifs, « un administrateur qui anime un cours n'est
 * plus proposable tant qu'il est ADMIN », conséquence assumée faute de mieux. Depuis que le bureau
 * est un **supplément** (`User.estAdmin`) et non un rôle, un membre du bureau qui enseigne porte
 * `role = "INSTRUCTEUR"` : il est dans cette liste, sans qu'on ait rien ajouté. Et c'est bien
 * `role` qu'on interroge ici, **pas `estAdmin`** : mener une partie de cours est un métier, pas un
 * droit — un trésorier qui ne descend jamais sur la piste n'a rien à faire dans un menu
 * d'encadrants. Qui encadre se dit maintenant en une seule colonne, c'est tout l'intérêt du
 * changement.
 *
 * *`dejaPosees` : on ne fait jamais disparaître quelqu'un d'une case.* Une liste déroulante doit
 * **toujours** contenir sa propre valeur. Sans ce second terme, une partie menée par une personne
 * qui n'est pas (ou plus) instructeur se retrouverait avec un `<select>` sans entrée correspondante :
 * le navigateur afficherait alors la première entrée — `----------` —, et le premier enregistrement
 * de la case écraserait **en silence** une donnée juste. L'appelant (`chargerPlanning`) passe les
 * identifiants d'instructeur et de second lus sur les parties de la période affichée : ce sont
 * exactement les valeurs que les listes auront à représenter, et ça ne coûte aucune requête de plus.
 * Ces identifiants-là entrent **sans condition** — ni `actif`, ni `service`, ni rôle : le but n'est
 * pas de dire qui mérite d'être proposé, mais de savoir nommer ce qui est déjà écrit. Un compte
 * désactivé en cours de trimestre tombait dans le même piège, silencieusement, depuis toujours.
 *
 * *L'ordre est alphabétique, simplement.* Le tri rangeait les MEMBRE en dernier, derrière
 * l'encadrement : ça avait un sens quand la liste était le club entier, ça n'en a plus quand elle
 * est l'encadrement. Garder ce rang reviendrait à reléguer en queue de menu la poignée de personnes
 * retenues par `dejaPosees`, c'est-à-dire justement celles qu'on cherche à retrouver dans leur case.
 */
export async function personnesPlanning(dejaPosees: Iterable<string> = []): Promise<Personne[]> {
  const retenues = [...new Set([...dejaPosees].filter(Boolean))];
  const users = await db.user.findMany({
    // Deux branches, et pas un `AND` : la seconde est un **rattrapage**, elle doit pouvoir passer
    // outre les exclusions de la première (voir `dejaPosees` ci-dessus).
    where: { OR: [{ actif: true, service: false, role: "INSTRUCTEUR" }, { id: { in: retenues } }] },
    select: { id: true, prenom: true, nom: true, role: true, couleur: true },
  });
  return users.sort((a, b) => a.prenom.localeCompare(b.prenom, "fr") || a.nom.localeCompare(b.nom, "fr"));
}

/**
 * **La nature d'un élément lu en base.** La colonne est un texte libre pour SQLite : une valeur
 * inconnue (écrite à la main, ou par une version future) se lit comme un cours — la nature par
 * défaut de la colonne — plutôt que de faire tomber l'écran. Le script de réparation la signale.
 */
export function natureLue(v: string): NatureElement {
  return estNatureElement(v) ? v : "COURS";
}

export async function chargerPlanning(periodId: string, user: UserLike & { id: string }, now = new Date()): Promise<Planning | null> {
  const periode = await db.period.findUnique({
    where: { id: periodId },
    // `select` et non `include` : la grille n'affiche ni l'adresse, ni les disciplines, ni les dates techniques
    select: {
      id: true,
      nom: true,
      dateDebut: true,
      dateFin: true,
      statut: true,
      membres: { where: { user: { service: false } }, select: { user: { select: { id: true, prenom: true, nom: true } } } },
      sessions: {
        orderBy: [{ date: "asc" }, { heureDebut: "asc" }],
        select: {
          id: true,
          date: true,
          heureDebut: true,
          heureFin: true,
          lieu: true,
          annulee: true,
          motifAnnulation: true,
          parties: {
            // Triées **par la base** : l'ordre des parties est une donnée de la séance, pas une
            // mise en forme de la grille — les écrans le reçoivent déjà juste.
            orderBy: { ordre: "asc" },
            select: {
              id: true,
              ordre: true,
              libelle: true,
              bloc: true,
              nature: true,
              instructeurId: true,
              instructeurSecondId: true,
              theme: true,
              description: true,
              niveau: true,
              updatedAt: true,
              instructeur: { select: { prenom: true, nom: true } },
              instructeurSecond: { select: { prenom: true, nom: true } },
              atelier: { select: { id: true, titre: true, materiel: true } },
              modifiePar: { select: { prenom: true, nom: true } },
            },
          },
          /*
           * **Deux colonnes suffisent — mais seulement pour les invités de la période**.
           *
           * Cette lecture n'avait aucun filtre, alors que le dénominateur, lui, en a un
           * (`periode.membres`, `service: false`). Numérateur et dénominateur ne portaient donc pas
           * sur les mêmes personnes : `Attendance` pend à `User` et à `Session`, jamais à
           * `PeriodMember`, si bien qu'une réponse laissée par quelqu'un sorti du trimestre — ou le
           * compte de service du portail — comptait dans le chiffre **et** disparaissait de la
           * liste des noms, qui est filtrée juste en dessous. La grille annonçait « 12 / 12, 100 % »
           * au-dessus de onze noms, pendant que la fiche de la même séance, le tableau de bord et la
           * page publique disaient « 11 / 12 ».
           *
           * C'était le **cinquième** compteur du dossier à compter sans filtre ; les quatre autres
           * (carte de séance, tableau de bord, page publique, alerte d'effectif) ont été corrigés
           * les 29 et 30/09, et la docstring de `retirerMembrePeriode` annonçait déjà que le même
           * écart se propageait « au planning ». Il n'y avait pas suivi.
           *
           * **Le filtre est l'appartenance à la période, jamais la date d'arrivée** : le remplissage
           * d'une séance est un fait de la salle, pas un compte de personne. Borner à l'arrivée ferait
           * dire « 7 présents » au planning là où la fiche du même cours en montre 8 — le même défaut
           * déplacé d'un cran.
           */
          attendances: { where: { user: { service: false, periodes: { some: { periodId } } } }, select: { userId: true, statut: true } },
        },
      },
    },
  });
  if (!periode) return null;
  // Appartenance vérifiée ici, pas seulement par l'appelant : un identifiant de période recopié
  // dans l'URL ne doit rien ouvrir. La page affiche alors son état « rien à voir ».
  // (Pas de requête de plus : les invités de la période sont déjà dans `periode.membres`.)
  if (!isStaff(user) && !periode.membres.some((m) => m.user.id === user.id)) return null;

  const modifiable = can(user, "planning.edit") && periode.statut !== "CLOSE";
  const peutProgrammer = can(user, "ateliers.moderate") && periode.statut !== "CLOSE";
  // Les listes de *choix* — l'annuaire du club (prénom, nom, rôle) et les ateliers en attente avec
  // le nom de leur proposant — ne servent qu'à remplir une case. Qui ne peut pas écrire ne les reçoit
  // pas : sinon elles partiraient quand même dans la charge de la page, alors que `members.view` est
  // réservée au bureau. Les noms déjà posés dans les cases, eux, restent lisibles par tout le monde.
  const peutEcrire = modifiable || peutProgrammer;
  /*
   * Les personnes **déjà posées** sur une case de ce trimestre, lues dans ce qu'on vient de charger :
   * aucune requête de plus. Elles entrent dans la liste déroulante même si elles ne sont pas (ou
   * plus) instructrices, sans quoi leur case n'aurait plus d'entrée à sa valeur — et le premier
   * enregistrement l'effacerait (voir `personnesPlanning`).
   */
  const dejaPosees = periode.sessions.flatMap((s) =>
    s.parties.flatMap((p) => [p.instructeurId, p.instructeurSecondId].filter((id): id is string => Boolean(id))),
  );
  // Les deux listes de thèmes sortent pour tout le monde, comme avant la coupure : elles ne nomment
  // personne, et la lecture s'en sert pour reconnaître un thème connu.
  const [personnes, themes, themesEchauffement, ateliers] = await Promise.all([
    peutEcrire ? personnesPlanning(dejaPosees) : [],
    getThemes(),
    getThemesEchauffement(),
    peutEcrire
      ? db.atelier.findMany({
          where: { statut: "PROPOSE", partie: null },
          orderBy: { createdAt: "asc" },
          select: { id: true, titre: true, sessionId: true, proposePar: { select: { prenom: true, nom: true } } },
        })
      : [],
  ]);
  const nomParId = new Map(periode.membres.map((m) => [m.user.id, `${m.user.prenom} ${m.user.nom}`]));

  const colonnes: ColonnePlanning[] = periode.sessions.map((s) => {
    // Rang et nombre dans la partie et la nature, comptés sur la séance entière et **avant** tout
    // filtre d'affichage : la grille cache les cases vides aux membres, et les recompter là donnerait
    // le rang 1 au second cours (même règle, même fonction que `programmeDepuisParties`). Les
    // éléments arrivent déjà triés par `ordre`, qui matérialise l'ordre de lecture.
    const lus = s.parties.map((p) => ({ ...p, nature: natureLue(p.nature) }));
    const places = placesDansPartie(lus);
    const parties: CasePlanning[] = lus.map((p, i) => ({
      id: p.id,
      ordre: p.ordre,
      bloc: p.bloc,
      nature: p.nature,
      rang: places[i].rang,
      nombre: places[i].nombre,
      libelle: p.libelle,
      instructeurId: p.instructeurId,
      instructeur: p.instructeur ? `${p.instructeur.prenom} ${p.instructeur.nom}` : null,
      instructeurSecondId: p.instructeurSecondId,
      instructeurSecond: p.instructeurSecond ? `${p.instructeurSecond.prenom} ${p.instructeurSecond.nom}` : null,
      theme: p.theme,
      description: p.description,
      niveau: niveauAffiche(p.niveau) ?? NIVEAU_DEFAUT,
      atelier: p.atelier,
      modifiePar: p.modifiePar ? `${p.modifiePar.prenom} ${p.modifiePar.nom}` : null,
      modifieLe: p.updatedAt.toISOString(),
    }));
    return {
      id: s.id,
      date: s.date,
      heureDebut: s.heureDebut,
      heureFin: s.heureFin,
      lieu: s.lieu,
      annulee: s.annulee,
      motifAnnulation: s.motifAnnulation,
      commencee: seanceCommencee(s.date, s.heureDebut, now),
      mois: s.date.slice(0, 7),
      parties,
      compteurs: compterPresences(
        s.attendances.map((a) => a.statut),
        periode.membres.length,
      ),
      presents: s.attendances
        .filter((a) => a.statut === "PRESENT")
        .map((a) => nomParId.get(a.userId) ?? "")
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, "fr")),
    };
  });

  const mois: Planning["mois"] = [];
  for (const c of colonnes) {
    const dernier = mois[mois.length - 1];
    if (dernier && dernier.cle === c.mois) dernier.nombre++;
    else mois.push({ cle: c.mois, label: nomMois(c.mois), nombre: 1 });
  }

  return {
    periode: { id: periode.id, nom: periode.nom, dateDebut: periode.dateDebut, dateFin: periode.dateFin, statut: periode.statut },
    colonnes,
    mois,
    personnes,
    themes,
    themesEchauffement,
    ateliersDisponibles: ateliers.map((a) => ({ id: a.id, titre: a.titre, sessionId: a.sessionId, proposePar: `${a.proposePar.prenom} ${a.proposePar.nom}` })),
    modifiable,
    peutProgrammer,
  };
}

/**
 * **Une case est vide quand elle n'a rien à dire** : ni encadrant, ni thème, ni description, ni
 * atelier, ni niveau annoncé. Une seule définition, ici, pour les écrans comme pour le serveur —
 * c'est elle qui décide qu'un atelier peut venir se poser dans une partie, et qu'une séance est
 * « sans programme ».
 *
 * Le niveau en fait partie, et la description aussi : quelqu'un qui n'a écrit qu'une phrase sur ce
 * qu'on va travailler a bel et bien rempli sa case, et elle ne doit pas se faire prendre par le
 * premier atelier venu — il l'effacerait.
 *
 * Les cinq réglages sont pesés par `reglagesVides` (`src/components/planning/options.ts`), module
 * pur que le navigateur peut lire lui aussi : c'est la **même** définition qui décide ce que l'écran
 * propose et ce que le serveur accepte.
 */
export function caseVide(c: Pick<CasePlanning, "instructeur" | "instructeurSecond" | "theme" | "description" | "atelier" | "niveau">): boolean {
  return reglagesVides(c) && !c.atelier;
}

/** Une ligne du programme d'une séance, pour la carte Présences et la page de gestion. */
export type LigneProgrammeSeance = Pick<
  CasePlanning,
  "id" | "ordre" | "libelle" | "bloc" | "nature" | "rang" | "nombre" | "instructeur" | "instructeurId" | "instructeurSecond" | "instructeurSecondId" | "theme" | "description" | "niveau"
> & {
  atelier: { id: string; titre: string } | null;
};

export type ProgrammeSeance = LigneProgrammeSeance[];

/**
 * Le programme lisible d'une séance : les parties dans leur ordre, **les muettes écartées**.
 *
 * C'est ce filtre — et lui seul — qui définit « Sans programme » sur l'accueil : une partie qui n'a
 * ni encadrant, ni thème, ni atelier n'apprend rien à personne, et une séance neuve en porte une
 * d'office depuis qu'elles naissent avec le modèle — davantage dès qu'on y ajoute des cases. Les afficher toutes remplirait chaque fiche de
 * lignes vides.
 *
 * Le niveau, lui, ne suffit pas à faire parler une partie : « Débutant » sans thème ni encadrant ne
 * dit rien au lecteur d'une fiche (à la différence d'une case du planning, qu'il ne faut pas
 * écraser — voir `caseVide`). La **description**, si : une phrase sur ce qu'on va travailler est
 * exactement ce qu'un membre vient lire, et la taire parce que le thème n'est pas encore choisi
 * serait perdre le seul renseignement disponible.
 */
export function programmeDepuisParties(
  // `niveau` facultatif : une case lue par une requête écrite avant ce champ (ou un jeu d'essai) ne
  // le porte pas, et son absence vaut « indifférent » — exactement ce que dit la colonne en base.
  parties: Array<{
    id: string;
    ordre: number;
    libelle: string;
    bloc: number;
    nature: string;
    theme: string;
    /** Facultatif pour la même raison que `niveau` : une requête écrite avant ce champ ne le porte pas. */
    description?: string | null;
    niveau?: string | null;
    instructeurId: string | null;
    instructeur: { prenom: string; nom: string } | null;
    instructeurSecondId?: string | null;
    instructeurSecond?: { prenom: string; nom: string } | null;
    atelier: { id: string; titre: string } | null;
  }>,
): ProgrammeSeance {
  const ordonnees = [...parties].sort((a, b) => a.ordre - b.ordre).map((c) => ({ ...c, nature: natureLue(c.nature) }));
  /*
   * **Les rangs se comptent ici, sur la séance entière, et jamais après le filtre.**
   *
   * C'est la seule place où la séance est encore complète : deux lignes plus bas, les éléments
   * muets ont disparu, et compter sur ce qui reste ferait dire « Cours » (seul) à côté d'un libellé
   * « Partie 1 · Cours 2 ». Rang et nombre partent donc avec la ligne au lieu d'être redérivés à
   * l'écran.
   */
  const places = placesDansPartie(ordonnees);
  return ordonnees
    .map((c, i) => ({
      id: c.id,
      ordre: c.ordre,
      bloc: c.bloc,
      nature: c.nature,
      rang: places[i].rang,
      nombre: places[i].nombre,
      libelle: c.libelle,
      instructeur: c.instructeur ? `${c.instructeur.prenom} ${c.instructeur.nom}` : null,
      instructeurId: c.instructeurId,
      instructeurSecond: c.instructeurSecond ? `${c.instructeurSecond.prenom} ${c.instructeurSecond.nom}` : null,
      instructeurSecondId: c.instructeurSecondId ?? null,
      theme: c.theme,
      description: (c.description ?? "").trim(),
      niveau: niveauAffiche(c.niveau) ?? NIVEAU_DEFAUT,
      atelier: c.atelier,
    }))
    // Une description seule fait parler la partie : c'est précisément ce qu'elle est là pour dire.
    .filter((c) => c.instructeur || c.instructeurSecond || c.theme.trim() || c.description || c.atelier);
}

/**
 * Recopie le contenu des cases dans la séance : `disciplines` = thèmes distincts (ordre des
 * parties), instructeurs = personnes distinctes, **celui qui mène et celui qui assiste**. Ainsi
 * cartes, exports et récaps restent alimentés sans requête supplémentaire.
 *
 * Le second instructeur entre dans `SessionInstructeur` par la même porte que le premier : il
 * encadre la séance, donc il reçoit ce que reçoit l'encadrement (l'alerte « peu de monde », le récap
 * du soir). C'est un mouvement **interne** — rien de tout cela ne sort vers le public.
 */
export async function synchroniserSeance(sessionId: string): Promise<void> {
  const parties = await db.sessionPartie.findMany({
    where: { sessionId },
    orderBy: { ordre: "asc" },
    select: { theme: true, instructeurId: true, instructeurSecondId: true },
  });
  const themes = [...new Set(parties.map((p) => p.theme.trim()).filter(Boolean))];
  // Celui qui mène avant celui qui assiste, partie par partie : l'ordre n'a pas d'effet visible
  // aujourd'hui, mais un ordre stable rend la table relisible et les tests lisibles.
  const instructeurs = [...new Set(parties.flatMap((p) => [p.instructeurId, p.instructeurSecondId]).filter((id): id is string => !!id))];
  await db.$transaction([
    db.session.update({ where: { id: sessionId }, data: { disciplines: themes.join(",") } }),
    db.sessionInstructeur.deleteMany({ where: { sessionId } }),
    db.sessionInstructeur.createMany({ data: instructeurs.map((userId) => ({ sessionId, userId })) }),
  ]);
}

/**
 * **Ranger les éléments d'une séance : parties contiguës, rangs contigus, noms d'accord avec eux.**
 *
 * Les trois invariants d'une séance tiennent ici, et **nulle part ailleurs** :
 *
 * 1. `bloc` redevient **contigu à partir de 1** : retirer le dernier élément d'une partie la fait
 *    disparaître, et les suivantes se renumérotent.
 * 2. `ordre` redevient **contigu à partir de 0**, dans l'ordre de lecture (partie, puis ordre
 *    d'avant, puis id — **jamais la nature** : l'ordre d'une partie est libre, l'équipe le règle).
 *    Sans cette renumérotation, c'est l'ordre d'insertion en base — le hasard — qui déciderait de
 *    l'affichage. Un élément qui arrive reçoit d'abord un rang intercalaire (`ordreDInsertion`).
 * 3. `libelle` redit la partie — quand la séance en a plusieurs — et le rang dans la nature
 *    (`libelleElement`) : « Partie 1 · Cours », « Partie 2 · Option 2 », ou « Cours » seul. Passer
 *    d'une à deux parties renomme donc toutes les lignes, et revenir à une seule retire le préfixe.
 *    Ajouter, retirer, déplacer un élément ou changer sa nature décale les
 *    voisins, et c'est cette fonction qui remet la colonne d'accord.
 *
 * **Tout dans la même fonction, et c'est voulu** : le libellé dépend de la partie et du rang
 * *finaux*. Un élément qui change à la fois de place et de nom ne coûte ainsi qu'une écriture.
 *
 * **On n'émet une écriture que pour ce qui change vraiment, et `updatedAt` n'est jamais touché.**
 * La grille affiche ce champ dans la bulle « Modifié par … le … » de chaque case, avec `modifieParId`
 * inchangé : renommer une voisine parce qu'on a retiré l'élément d'à côté ferait dire à sa case que
 * la personne qui l'a remplie la semaine d'avant y est revenue à l'instant. Chaque écriture émise
 * ici renvoie l'horodatage que la ligne portait déjà (Prisma respecte une valeur explicite, même sur
 * un `@updatedAt`). Le geste, lui, se lit dans le journal (`planning.partie.*`). L'élément dont on
 * change la **nature**, lui, est marqué par `changerNaturePartie` : ce clic-là porte sur lui.
 *
 * La fonction rend les écritures à faire : l'appelant les glisse dans **sa** transaction, pour qu'on
 * ne puisse jamais lire une séance à moitié rangée. Le client est un paramètre parce que les deux
 * formes de transaction Prisma en ont besoin (le tableau d'écritures avec `db`, la fonction avec
 * `tx`). Elle vit ici et non dans les actions : `placerAtelier` en a besoin aussi.
 *
 * Le **calcul**, lui, vit dans `src/components/planning/rangement.ts` — module sans Prisma, pour que
 * le script de réparation puisse relever les invariants sans ouvrir de base. Le tri y est fait :
 * l'appelant exprime un déplacement en changeant le `bloc` d'un élément et en lui donnant un rang
 * intercalaire (`ordreDInsertion`, `ordreAvant`).
 */
export function rangerParties<R>(
  parties: ReadonlyArray<Omit<PartieARanger, "nature"> & { nature: string }>,
  client: { sessionPartie: { update: (args: { where: { id: string }; data: RangementPartie["data"] }) => R } },
): R[] {
  return rangementsParties(parties.map((p) => ({ ...p, nature: natureLue(p.nature) }))).map((r) =>
    client.sessionPartie.update({ where: { id: r.id }, data: r.data }),
  );
}

/** Ce qu'il faut lire d'un élément pour le ranger — la sélection commune de toutes les écritures. */
export const SELECTION_RANGEMENT = { id: true, ordre: true, bloc: true, nature: true, libelle: true, updatedAt: true } as const;

/**
 * **Les éléments d'une séance qui vient de naître** : le modèle du club (`PARTIES_MODELE` — une
 * seule partie, un cours, nommé « Cours » sans préfixe), avec leur rang et leur nom déjà justes, pour que `rangerParties`
 * n'ait rien à réécrire dessus.
 */
export function partiesInitiales(): Array<{ libelle: string; ordre: number; bloc: number; nature: NatureElement }> {
  const places = placesDansPartie(PARTIES_MODELE);
  const nbParties = new Set(PARTIES_MODELE.map((p) => p.bloc)).size;
  return PARTIES_MODELE.map((p, ordre) => ({
    libelle: libelleElement(p.bloc, p.nature, places[ordre].rang, places[ordre].nombre, nbParties),
    ordre,
    bloc: p.bloc,
    nature: p.nature,
  }));
}

/** Ce qu'il faut savoir d'un élément pour décider si un atelier peut s'y poser. */
export type PartiePlacable = {
  id: string;
  ordre: number;
  bloc?: number;
  nature: string;
  instructeurId: string | null;
  instructeurSecondId?: string | null;
  theme: string;
  description?: string | null;
  niveau?: string | null;
  atelierId: string | null;
};

/**
 * **Un élément où un atelier peut se poser sans rien effacer** : aucun atelier, et aucun des cinq
 * réglages renseignés.
 *
 * C'est `caseVide` vue depuis la base — les mêmes champs, sous leur nom de colonne —, et c'est la
 * seule question que doivent poser les **deux** portes qui placent un atelier : le choix automatique
 * (`partieLibrePourAtelier`, ci-dessous) et la case désignée à la main depuis la grille
 * (`programmerAtelierDansCase`).
 */
export function partieLibre(p: PartiePlacable): boolean {
  return (
    !p.atelierId &&
    reglagesVides({ instructeur: p.instructeurId, instructeurSecond: p.instructeurSecondId, theme: p.theme, description: p.description, niveau: p.niveau })
  );
}

/**
 * **Où poser un atelier sans rien effacer**, ou `null` si nulle part :
 * 1. un élément **Atelier vide** — celui qu'un atelier retiré a laissé, prévu pour en recevoir un ;
 * 2. sinon une **option** libre — ce qui se tient en parallèle d'un cours, comme un atelier.
 * Dans chaque groupe, le premier dans l'ordre de lecture. Jamais un cours ni un échauffement : poser
 * un atelier à la place du cours principal serait un choix que personne n'a fait. Quand cette
 * fonction rend `null`, `placerAtelier` **crée un élément Atelier** dans la dernière partie, à sa
 * place par défaut (après les cours, avant les options : `ordreDInsertion`).
 */
export function partieLibrePourAtelier(parties: readonly PartiePlacable[]): string | null {
  const libres = [...parties].sort((a, b) => a.ordre - b.ordre).filter(partieLibre);
  return (libres.find((p) => p.nature === "ATELIER") ?? libres.find((p) => p.nature === "OPTION"))?.id ?? null;
}

/**
 * Place un atelier planifié dans le planning de sa séance (instructeur = animateur choisi dans la
 * proposition, à défaut le proposeur ; second instructeur = second animateur ; thème = titre).
 * Rend l'élément utilisé, qui passe en nature **ATELIER** (il était peut-être une option libre, ou
 * l'élément désigné à la main depuis la grille) **sans changer de place** : changer de nature ne
 * déplace rien, seul son nom suit.
 *
 * **Plus jamais `null` faute de place** : quand aucun élément n'est libre, un élément Atelier naît
 * dans la **dernière** partie de la séance (la partie 1 d'une séance qui n'en a aucune), à la place
 * par défaut d'un atelier — après les cours, avant les options (`ordreDInsertion`). Un atelier
 * validé par l'équipe doit se poser quelque part — le rendre invisible faute de case libre serait un
 * refus silencieux d'une décision déjà prise. (`null` ne subsiste que pour un élément explicitement
 * demandé qui n'existe plus.)
 *
 * Pas de plafond ici, à la différence de `ajouterPartie` : cette création n'est pas une boucle
 * ouverte sur le réseau — il faut une décision de modération pour chaque atelier.
 */
export async function placerAtelier(atelierId: string, sessionId: string, acteurId: string, partieId?: string): Promise<{ id: string; libelle: string } | null> {
  const atelier = await db.atelier.findUniqueOrThrow({ where: { id: atelierId }, select: { titre: true, proposeParId: true, animateurId: true, animateurSecondId: true } });
  const existantes = await db.sessionPartie.findMany({
    where: { sessionId },
    select: { id: true, ordre: true, bloc: true, nature: true, instructeurId: true, instructeurSecondId: true, theme: true, description: true, niveau: true, atelierId: true },
  });
  if (partieId && !existantes.some((p) => p.id === partieId)) return null;
  const choisie = partieId ?? partieLibrePourAtelier(existantes);
  /*
   * **Une seule transaction, séance relue dedans** : créer l'élément au besoin, vider l'ancienne case
   * de l'atelier, remplir la nouvelle, puis ranger — la nature de la case change (option → atelier),
   * donc son nom et sa place aussi. Deux ateliers programmés au même instant sur la même séance
   * liraient sinon la même dernière partie.
   */
  const cible = await db.$transaction(async (tx) => {
    let id = choisie;
    // Le rang intercalaire de l'élément créé ici : la base n'en garde que la partie entière, le
    // rangement ci-dessous reçoit le vrai (`ordreEntier`).
    let creation: { id: string; ordre: number } | null = null;
    if (!id) {
      const lues = await tx.sessionPartie.findMany({ where: { sessionId }, select: { id: true, bloc: true, ordre: true, nature: true } });
      const parties = lues.map((p) => ({ ...p, nature: natureLue(p.nature) }));
      const derniere = parties.reduce((m, p) => Math.max(m, p.bloc), 0) || 1;
      const ordre = ordreDInsertion(parties, derniere, "ATELIER");
      const creee = await tx.sessionPartie.create({
        // Libellé provisoire : `rangerParties`, juste en dessous, pose le vrai.
        data: { sessionId, libelle: "", ordre: ordreEntier(ordre), bloc: derniere, nature: "ATELIER", modifieParId: acteurId },
        select: { id: true },
      });
      id = creee.id;
      creation = { id, ordre };
    }
    // L'atelier ne peut être que dans une seule case ; l'ancienne reste un élément Atelier vide.
    await tx.sessionPartie.updateMany({ where: { atelierId, id: { not: id } }, data: { atelierId: null } });
    await tx.sessionPartie.update({
      where: { id },
      // Le niveau repart à « indifférent » comme le reste : placer un atelier **remplace** le contenu
      // de la case, et garder le niveau du cours d'avant ferait porter à l'atelier une annonce que
      // personne n'a faite pour lui. La description part pour la même raison — une phrase qui
      // décrivait le cours d'avant mentirait sur l'atelier qui prend sa place. Instructeur et second
      // sont ceux de la proposition (« Qui anime ? », « Second animateur ») ; si le premier a été
      // effacé depuis, le second mène seul (comme le dit `libelleAnimation`), et sans aucun des deux
      // la case retombe sur la personne qui a proposé.
      data: {
        atelierId,
        nature: "ATELIER",
        instructeurId: atelier.animateurId ?? atelier.animateurSecondId ?? atelier.proposeParId,
        instructeurSecondId: atelier.animateurId ? atelier.animateurSecondId : null,
        theme: atelier.titre,
        description: "",
        niveau: NIVEAU_DEFAUT,
        modifieParId: acteurId,
      },
    });
    const parties = await tx.sessionPartie.findMany({ where: { sessionId }, select: SELECTION_RANGEMENT });
    const nee = creation;
    const aRanger = nee ? parties.map((p) => (p.id === nee.id ? { ...p, ordre: nee.ordre } : p)) : parties;
    for (const ecriture of rangerParties(aRanger, tx)) await ecriture;
    return id;
  });
  await synchroniserSeance(sessionId);
  const posee = await db.sessionPartie.findUnique({ where: { id: cible }, select: { id: true, libelle: true } });
  return posee;
}

/**
 * Retire un atelier du planning (déprogrammation, refus) : **la case est vidée, pas supprimée**.
 *
 * Un refus d'atelier n'a aucune raison de défaire le programme : l'élément reste, **de nature
 * Atelier et vide**, prêt à recevoir le prochain atelier placé (`partieLibrePourAtelier` le choisit
 * en premier). Sa nature ne change pas, donc ni son nom ni sa place : rien à ranger. Retirer
 * l'élément est un autre geste, qui se demande (`retirerPartie`).
 */
export async function retirerAtelier(atelierId: string): Promise<void> {
  const cases = await db.sessionPartie.findMany({ where: { atelierId }, select: { id: true, sessionId: true } });
  if (cases.length === 0) return;
  await db.sessionPartie.updateMany({
    where: { atelierId },
    data: { atelierId: null, instructeurId: null, instructeurSecondId: null, theme: "", description: "", niveau: NIVEAU_DEFAUT },
  });
  for (const c of new Set(cases.map((c) => c.sessionId))) await synchroniserSeance(c);
}

/**
 * **Une séance qui s'annule rend ses ateliers à la file des propositions**, comme une séance supprimée
 * (`detacherAteliers`, `src/actions/seances.ts`).
 *
 * Un atelier planifié sur un cours qui n'aura pas lieu n'est planifié nulle part : il resterait
 * « Dans le planning » sans date, invisible dans la file à trancher, et sa case garderait son titre
 * dans un programme verrouillé. On vide donc la case (`retirerAtelier`, le geste « Retirer du planning »)
 * et l'atelier repasse en attente, prêt à être reprogrammé ailleurs. Aucun email au membre : la séance
 * annulée vient d'être annoncée, et la reprogrammation, elle, le préviendra.
 *
 * Rétablir la séance ne raccroche rien : l'atelier a peut-être été placé ailleurs entre-temps.
 */
export async function libererAteliersDesSeances(sessionIds: readonly string[]): Promise<{ id: string; titre: string; sessionId: string }[]> {
  if (sessionIds.length === 0) return [];
  const [rattaches, cases] = await Promise.all([
    db.atelier.findMany({ where: { sessionId: { in: [...sessionIds] } }, select: { id: true, titre: true, sessionId: true } }),
    db.sessionPartie.findMany({ where: { sessionId: { in: [...sessionIds] }, atelierId: { not: null } }, select: { atelierId: true, sessionId: true } }),
  ]);
  const liberes = new Map<string, { id: string; titre: string; sessionId: string }>();
  for (const a of rattaches) if (a.sessionId) liberes.set(a.id, { id: a.id, titre: a.titre, sessionId: a.sessionId });
  const manquants = cases.filter((c) => c.atelierId && !liberes.has(c.atelierId));
  if (manquants.length > 0) {
    const autres = await db.atelier.findMany({ where: { id: { in: manquants.map((c) => c.atelierId as string) } }, select: { id: true, titre: true } });
    for (const a of autres) liberes.set(a.id, { id: a.id, titre: a.titre, sessionId: manquants.find((c) => c.atelierId === a.id)?.sessionId ?? "" });
  }
  const ids = [...liberes.keys()];
  if (ids.length === 0) return [];
  for (const id of ids) await retirerAtelier(id);
  await db.$transaction([
    db.atelier.updateMany({ where: { id: { in: ids }, statut: "PLANIFIE" }, data: { statut: "PROPOSE", sessionId: null } }),
    db.atelier.updateMany({ where: { id: { in: ids } }, data: { sessionId: null } }),
  ]);
  return [...liberes.values()];
}
