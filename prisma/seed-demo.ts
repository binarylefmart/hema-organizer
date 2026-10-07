/**
 * Jeu de données de développement, bâti sur le jeu du club (`prisma/donnees-club.ts`) : les 12 membres,
 * la période « Rentrée 2026 », ses 16 séances et les réponses de chacun. Ces réponses ont la **forme
 * de celles d'un vrai sondage de disponibilités** — présent / peut-être / absent, séance par séance,
 * avec des assiduités très inégales — et c'est ce qui donne aux taux, aux séries et aux blasons une
 * allure crédible. S'y ajoute ce qu'un sondage de disponibilités ne porte pas : le programme du
 * planning, quelques propositions d'ateliers, et les accès (liens personnels, mot de passe + 2FA des admins).
 *
 * Mot de passe des comptes administrateurs : "demo-organizer-2026" (développement uniquement).
 *
 * **Les dates du jeu sont recalées sur la semaine en cours** (`ANCRAGE_DEMO`, plus bas) : telles
 * quelles, le jeu se périmait au jour de sa dernière séance — plus une séance à venir, donc des
 * écrans d'aperçu vides, sans que rien ne le dise.
 *
 * **Deux tailles, une seule vérité par défaut.** `SEED_DEMO_TAILLE=grand` (ou
 * `npm run db:seed:demo:grand`) ajoute par-dessus les soixante-huit personnes inventées de
 * `donnees-club-grand.ts`, pour montrer ce que devient l'outil dans un club de quatre-vingts. Sans
 * cette variable, **ce fichier produit exactement le jeu d'avant** : les douze du club, les mêmes
 * couleurs, les mêmes liens, les mêmes réponses — toute la campagne e2e et toutes les captures en
 * dépendent. Les listes du grand jeu s'ajoutent toujours **à la suite** des douze, jamais devant :
 * c'est ce qui garantit que les index (couleur, ancienneté du lien) ne bougent pas.
 */
import { hashPassword, verifyPassword } from "../src/lib/auth/password";
import { hashToken } from "../src/lib/auth/tokens";
import { chiffrer } from "../src/lib/crypto";
import { hacherCodeSecours } from "../src/lib/auth/codes-secours";
import { invitationExpiry } from "../src/lib/invitations";
import { addDays, isoWeekday, joursAvant, todayIso } from "../src/lib/dates";
import { dateDepuisSaison, anneeDeSaison } from "../src/lib/blasons";
import { moisAvant } from "../src/lib/dates";
import { CLUB_DEMO, MEMBRES_CLUB, SEANCES_CLUB } from "./donnees-club";
import {
  EFFECTIFS_PROFILS,
  estTailleGrand,
  fusionnerProgrammes,
  MEMBRES_GRAND,
  PROGRAMME_GRAND,
  seancesGrandClub,
  type ProgrammeSeance,
} from "./donnees-club-grand";
import { enregistrerIdentite } from "../src/lib/identite";
import { COMPTES, DEMO_CODES_SECOURS, DEMO_MOT_DE_PASSE, DEMO_TOTP_SECRET, demoLien, EMAIL_ADMINISTRATION } from "./comptes";
import { exigerBaseDeDemonstration } from "./garde-demonstration";
import { NOMBRE_COULEURS } from "../src/lib/couleurs";
import { libelleElement, type NatureElement } from "../src/lib/constants";
import { placesDansPartie } from "../src/components/planning/rangement";
import { partiesInitiales, placerAtelier, rangerParties, SELECTION_RANGEMENT, synchroniserSeance } from "../src/lib/planning";
import { db } from "../src/lib/db";

export * from "./comptes";

/**
 * **Le jour où le jeu de démonstration était à sa place** — et le point d'où il se recale tout seul.
 *
 * `donnees-club.ts` porte le calendrier du trimestre : seize séances sur septembre et octobre 2026,
 * dans une période « Rentrée 2026 » qui se referme après la dernière (`FIN_PERIODE_CLUB`). Ces
 * dates étaient installées telles quelles, et le jeu se périmait donc à une date précise : le jour
 * de la **dernière séance**, il ne reste qu'une séance à venir, donc plus de séance annulée
 * (`aVenir[1]`) et plus de prochain cours pour porter l'atelier retenu — qui reste « PLANIFIE »
 * sans séance, un état que l'application ne sait pas produire ; le **lendemain**, il n'y a plus
 * aucune séance à venir du tout. L'accueil, le planning, « Prochains cours » et l'API publique
 * rendent alors des listes vides, les captures des guides montrent des écrans creux, et **rien ne
 * le dit** : le seed annonce ses seize séances comme les autres jours.
 *
 * Le jeu se replace donc dans la semaine courante. Trois propriétés, qui sont le cahier des charges :
 *  - **par semaines entières**, jamais par jours : les séances tombent sur deux jours de semaine
 *    fixes, et le créneau (horaire, salle, adresse) se retrouve par `isoWeekday` — voir `CRENEAUX`.
 *    Un décalage de trois jours mettrait tout le trimestre sur le mauvais créneau ;
 *  - **nul le jour de l'ancrage**, et pendant les six jours qui suivent : le jeu produit alors
 *    exactement les dates d'avant, à l'octet près. Rien de ce qui s'appuie sur elles ne bouge ;
 *  - **reproductible** : le décalage ne dépend que de la semaine en cours, pas de l'heure ni d'un
 *    tirage. Deux `db:seed:demo` du même jour — ou de la même semaine — donnent le même jeu, et les
 *    captures d'aperçu gardent leur valeur de référence. Elles changent le jour de semaine de
 *    l'ancrage (un mercredi), quand la semaine change : c'est le prix d'un jeu qui ne se périme pas,
 *    et c'est une raison, pas un hasard.
 */
export const ANCRAGE_DEMO = "2026-09-30";

/** Décalage appliqué aux dates du jeu, en jours — toujours un multiple de 7, jamais négatif. */
export function decalageDemo(aujourdHui: string = todayIso()): number {
  const ecoules = joursAvant(ANCRAGE_DEMO, aujourdHui);
  // Avant l'ancrage (horloge en retard, relecture d'archive), on ne recule rien : le jeu d'origine
  // est encore à venir, il n'y a pas d'écran vide à éviter.
  return ecoules <= 0 ? 0 : Math.floor(ecoules / 7) * 7;
}

/** Une date du jeu, replacée dans la semaine courante (même jour de semaine, par construction). */
export function dateDemo(date: string, aujourdHui?: string): string {
  return addDays(date, decalageDemo(aujourdHui));
}

/** Fin de la période « Rentrée 2026 » — décalée comme les séances qu'elle contient. */
const FIN_PERIODE_CLUB = "2026-10-31";

/**
 * **Les deux créneaux hebdomadaires du club** : un jour de semaine, un horaire, une salle et son
 * adresse — les mêmes d'une semaine à l'autre, comme un club les affiche. Le seed y retrouve
 * l'horaire et le lieu d'une séance par son `isoWeekday` ; toute séance de `SEANCES_CLUB` doit donc
 * tomber sur l'un de ces deux jours.
 */
const CRENEAUX = [
  { jourSemaine: 3, heureDebut: "19:30", heureFin: "21:30", lieu: "Salle des fêtes, Villebourg", adresse: "1 rue des Lices, 00000 Villebourg" },
  { jourSemaine: 6, heureDebut: "10:00", heureFin: "12:00", lieu: "Gymnase municipal, Villebourg", adresse: "3 avenue du Stade, 00000 Villebourg" },
];

/**
 * Programme du planning : ce qu'un sondage de disponibilités ne porte pas (qui anime quoi, et sur
 * quel thème).
 *
 * `rang` désigne la partie **par sa place** dans le modèle d'une séance neuve. Le jeu d'essai
 * décrit ainsi des séances rigoureusement identiques à celles que l'application crée elle-même —
 * c'est tout l'intérêt d'un jeu de démonstration, et les parcours e2e s'appuient dessus.
 *
 * **Deux cases portent une `description`** et pas les autres : c'est la proportion que le champ aura
 * dans la vraie vie (facultatif, rempli quand on a quelque chose à annoncer), et les aperçus doivent
 * montrer les deux cas côte à côte — une carte avec la phrase, une carte sans.
 */
// `niveau` n'est posé que sur deux cases : c'est bien la proportion réelle — l'immense majorité des
// cours est ouverte à tout le monde, et les aperçus doivent montrer les deux cas côte à côte.
const PROGRAMME: ProgrammeSeance[] = [
  {
    date: "2026-09-02",
    parties: [
      {
        rang: 0,
        email: COMPTES.instructeur,
        theme: "Épée longue",
        description: "Reprise après l'été : garde longue, garde de la fenêtre, et trois passes lentes en binôme pour retrouver les distances.",
      },
      { rang: 1, email: COMPTES.admin3, theme: "Messer" },
    ],
  },
  { date: "2026-09-05", parties: [{ rang: 0, email: COMPTES.instructeur2, theme: "Dague" }, { rang: 1, email: "foxtrot07@club.test", theme: "Lutte" }] },
  { date: "2026-09-09", parties: [{ rang: 0, email: COMPTES.admin3, theme: "Hache de pas" }, { rang: 1, email: COMPTES.instructeur, theme: "Sparring" }] },
  { date: "2026-09-12", parties: [{ rang: 0, email: "echo@club.test", theme: "Viking" }, { rang: 1, email: COMPTES.admin3, theme: "Épée longue" }] },
  { date: "2026-09-16", parties: [{ rang: 0, email: COMPTES.adminNominatif, theme: "Antrim Bata" }, { rang: 1, email: COMPTES.instructeur2, theme: "Messer" }] },
  { date: "2026-09-19", parties: [{ rang: 0, email: "foxtrot07@club.test", theme: "Dague" }, { rang: 1, email: "echo@club.test", theme: "Sparring" }] },
  { date: "2026-09-23", parties: [{ rang: 0, email: COMPTES.instructeur, theme: "Épée longue" }, { rang: 1, email: "foxtrot07@club.test", theme: "Lutte" }] },
  { date: "2026-09-26", parties: [{ rang: 0, email: COMPTES.admin3, theme: "Messer" }] },
  {
    date: "2026-09-30",
    parties: [
      {
        rang: 0,
        email: "echo@club.test",
        theme: "Hache de pas",
        niveau: "DEBUTANT",
        description: "Séance d'initiation : prise en main, déplacements, et les trois coups de base. Aucun équipement personnel nécessaire.",
      },
      { rang: 1, email: COMPTES.adminNominatif, theme: "Épée longue" },
    ],
  },
  { date: "2026-10-03", parties: [{ rang: 0, email: COMPTES.instructeur2, theme: "Sparring", niveau: "AVANCE" }] },
];

/** Ateliers : fonctionnalité propre à l'application — aucun sondage de disponibilités ne la porte. */
const ATELIERS = [
  { email: COMPTES.planifie, titre: "Échauffement à la corde", description: "15 minutes de corde à sauter et de déplacements pour préparer les appuis.", materiel: "Cordes à sauter", statut: "PLANIFIE", commentaireInstructeur: "Parfait pour démarrer la séance." },
  { email: COMPTES.proposeur, titre: "Jeu du roi de la colline", description: "Un défenseur au centre, les autres tentent de le toucher à tour de rôle. Le premier qui touche prend sa place.", materiel: "Épées de simulation, masques", statut: "PROPOSE", commentaireInstructeur: null },
  { email: COMPTES.lien, titre: "Lecture commentée d'une planche de Fiore", description: "Lire ensemble une planche du Fior di Battaglia, la traduire et la tester en binôme.", materiel: "Impressions de la planche", statut: "PROPOSE", commentaireInstructeur: null },
  { email: COMPTES.refuse, titre: "Initiation au sabre laser", description: "Découverte ludique avec des sabres lumineux.", materiel: "Sabres lumineux (j'en ai 4)", statut: "REFUSE", commentaireInstructeur: "Hors du cadre AMHE de l'asso, mais pourquoi pas pour la soirée de fin d'année !" },
];

/** Unique compte de connexion du portail (le seul compte à mot de passe ; `estAdmin`, comme tout le bureau). */
const COMPTES_ADMINISTRATION = [{ prenom: "Bureau", nom: "HEMA", email: EMAIL_ADMINISTRATION, avecTotp: true, provisoire: false }];

const couleurs: Record<string, number> = {};

async function main() {
  // Garde-fou partagé : refuse une base qui n'est pas une base de démonstration (voir le module).
  await exigerBaseDeDemonstration();
  const passwordHash = await hashPassword(DEMO_MOT_DE_PASSE);
  const aujourdHui = todayIso();

  /*
   * ---- La taille du jeu (voir `donnees-club-grand.ts`).
   *
   * Tout ce qui suit travaille sur `MEMBRES`, `SEANCES` et `PROGRAMME_COMPLET`. En taille « club »,
   * ces trois-là **sont** les constantes d'origine, à l'identique : le jeu par défaut ne passe par
   * aucun chemin de code supplémentaire, et rien ne peut le faire dériver sans que ça se voie.
   */
  const grand = estTailleGrand();
  const MEMBRES = grand ? [...MEMBRES_CLUB, ...MEMBRES_GRAND] : MEMBRES_CLUB;
  /*
   * **Les dates sont recalées avant tout le reste** (voir `ANCRAGE_DEMO`) : le jeu se périmait au jour
   * de sa dernière séance. Le décalage vaut 0 la semaine de l'ancrage — le jeu est alors celui d'avant,
   * date pour date. Recaler **d'abord** et compléter ensuite n'est pas indifférent :
   * `seancesGrandClub` décide des réponses des quatre-vingts en comparant la date de la séance à
   * aujourd'hui, elle doit donc voir la date qui sera vraiment installée.
   */
  const decaler = (date: string) => dateDemo(date, aujourdHui);
  const SEANCES_RECALEES = SEANCES_CLUB.map((s) => ({ ...s, date: decaler(s.date) }));
  const SEANCES = grand ? seancesGrandClub(SEANCES_RECALEES, aujourdHui) : SEANCES_RECALEES;
  const PROGRAMME_COMPLET = (grand ? fusionnerProgrammes(PROGRAMME, PROGRAMME_GRAND) : PROGRAMME).map((p) => ({ ...p, date: decaler(p.date) }));

  /*
   * **Le nom du club fait partie du jeu d'essai.** Sans lui, une base fraîchement semée n'a pas
   * d'identité réglée et l'outil s'appelle « HEMA Organizer » sur tous les écrans — donc sur toutes
   * les captures qui illustrent les guides, où l'on attend le nom du club. Écrit en dernier parmi
   * les réglages, et **partiel** : un logo déposé à la main survit (voir `enregistrerIdentite`).
   */
  await enregistrerIdentite(CLUB_DEMO);
  if (grand) console.info(`[seed] taille « grand club » demandée : ${MEMBRES.length} comptes (${MEMBRES_CLUB.length} du club + ${MEMBRES_GRAND.length} inventés).`);

  // ---- Comptes du club : personne n'a de mot de passe, tout le monde entre par son lien personnel.
  const emails = [...MEMBRES.map((m) => m.email), ...COMPTES_ADMINISTRATION.map((c) => c.email)];
  /*
   * **Les comptes sans adresse s'en vont aussi**.
   *
   * `notIn` ne rattrape pas les lignes à `email` nul : en SQL, `NOT IN` comparé à NULL ne vaut pas
   * vrai. Or un compte peut parfaitement **perdre** son adresse — l'annuaire le permet, et une
   * campagne de tests le fait. Comme les comptes sont ensuite recréés par `upsert` **sur l'email**,
   * celui qui n'en a plus n'était jamais retrouvé : le seed en fabriquait un second, et l'annuaire
   * finissait avec deux « Foxtrot 08 » et deux « Bravo 02 ». N'importe quel test qui
   * clique sur un nom tombait alors sur deux liens, et les captures montraient des doublons.
   *
   * Un jeu de démonstration n'a d'intérêt que s'il est reproductible : on repart donc de ce que ce
   * fichier décrit, comme on le fait juste après pour les périodes.
   */
  await db.user.deleteMany({
    where: {
      OR: [{ email: null }, { email: { notIn: [...emails, (process.env.ADMIN_EMAIL ?? "").toLowerCase()] } }],
    },
  });
  const users: Record<string, { id: string }> = {};
  // Une couleur d'identification différente par personne (palette de src/lib/couleurs.ts)
  MEMBRES.forEach((m, i) => (couleurs[m.email] = i % NOMBRE_COULEURS));
  for (const m of MEMBRES) {
    // « Au club depuis » : l'ancienneté du jeu de démonstration, en durée (voir `auClubMois` dans
    // donnees-club.ts), convertie en date exactement comme le fait la fiche du membre — donc posée
    // sur la rentrée du 1er septembre de la saison d'arrivée. Sans elle, les douze comptes étant
    // créés le jour du seed, l'accueil n'affichait que des « Recrue ». `auClubMois: 0` laisse la
    // date à `null` : ces comptes-là montrent le repli (arrivée réputée à la rentrée en cours).
    // `estAdmin` est écrit **à chaque fois, y compris à false** : le jeu de démonstration doit être
    // reproductible, et quelqu'un nommé au bureau à la main entre deux exécutions doit retrouver
    // l'état que ce fichier décrit — comme pour le rôle juste à côté.
    const commun = {
      prenom: m.prenom,
      nom: m.nom,
      role: m.role,
      estAdmin: m.estAdmin === true,
      service: false,
      couleur: couleurs[m.email],
      auClubDepuis: m.auClubMois > 0 ? dateDepuisSaison(anneeDeSaison(new Date(`${moisAvant(new Date().toISOString().slice(0, 10), m.auClubMois)}T00:00:00.000Z`))) : null,
    };
    // Personne n'a de mot de passe au départ : tout le monde entre par son lien personnel. Mais un
    // administrateur nominatif PEUT s'être réglé un accès (mot de passe + 2FA) depuis « Mon profil ».
    // Le lui effacer à chaque rechargement du jeu de démonstration, c'est lui reprendre son accès
    // sans prévenir — c'est arrivé. Même règle que pour les comptes d'administration plus bas :
    // un accès réglé à la main est conservé (SEED_DEMO_RESET_ADMIN=1 pour repartir de zéro).
    const existant = await db.user.findUnique({ where: { email: m.email }, select: { passwordHash: true } });
    const acquisAMain = process.env.SEED_DEMO_RESET_ADMIN !== "1" && !!existant?.passwordHash;
    const acces = acquisAMain ? {} : { passwordHash: null, totpSecret: null, totpActiveAt: null, codesSecours: null, doitChangerMotDePasse: false };
    if (acquisAMain) console.info(`[seed] ${m.email} : accès réglé à la main — mot de passe et 2FA conservés.`);
    users[m.email] = await db.user.upsert({
      where: { email: m.email },
      update: { ...commun, ...acces, actif: true },
      create: { ...commun, ...acces, passwordHash: null, totpSecret: null, totpActiveAt: null, codesSecours: null, doitChangerMotDePasse: false, email: m.email },
      select: { id: true },
    });
  }
  // Comptes d'administration (connexion par mot de passe + 2FA).
  // Si quelqu'un a choisi son propre mot de passe et appairé sa 2FA, on n'y touche pas : réinstaller
  // les accès de démonstration lui ferait perdre les siens sans prévenir (SEED_DEMO_RESET_ADMIN=1 force).
  for (const c of COMPTES_ADMINISTRATION) {
    const existant = await db.user.findUnique({ where: { email: c.email }, select: { passwordHash: true } });
    const personnalise =
      process.env.SEED_DEMO_RESET_ADMIN !== "1" && !!existant?.passwordHash && !(await verifyPassword(existant.passwordHash, DEMO_MOT_DE_PASSE));
    if (personnalise) {
      users[c.email] = await db.user.update({ where: { email: c.email }, data: { actif: true, service: true, role: "MEMBRE", estAdmin: true }, select: { id: true } });
      console.info(`[seed] ${c.email} : mot de passe et 2FA choisis à la main — conservés (SEED_DEMO_RESET_ADMIN=1 pour les réinitialiser).`);
      continue;
    }
    const commun = {
      prenom: c.prenom,
      nom: c.nom,
      // Le bureau est un **supplément** : `role: "ADMIN"` ne donnerait aucun droit par la matrice,
      // et la démonstration s'ouvrirait sur un portail qui n'ouvre plus rien.
      role: "MEMBRE",
      estAdmin: true,
      service: true,
      passwordHash,
      doitChangerMotDePasse: c.provisoire,
      totpSecret: c.avecTotp ? chiffrer(DEMO_TOTP_SECRET) : null,
      totpActiveAt: c.avecTotp ? new Date("2026-09-02T10:00:00Z") : null,
      codesSecours: c.avecTotp ? JSON.stringify(DEMO_CODES_SECOURS.map(hacherCodeSecours)) : null,
    };
    users[c.email] = await db.user.upsert({ where: { email: c.email }, update: { ...commun, actif: true }, create: { ...commun, email: c.email }, select: { id: true } });
  }
  /*
   * **L'encadrement de la période : les instructeurs ET le bureau** — exactement les mêmes personnes
   * qu'avant (l'écran de la période propose la même population). Écrit `m.role !== "MEMBRE"`, ce
   * filtre perdait les trois administrateurs du club dès que leur rôle de base est devenu *membre* :
   * la liste se serait vidée de son bureau sans un mot, alors qu'un administrateur mène un cours dans
   * le programme de démonstration.
   */
  const instructeursIds = MEMBRES.filter((m) => m.role === "INSTRUCTEUR" || m.estAdmin === true).map((m) => users[m.email].id);

  // ---- Période « Rentrée 2026 » : celle du jeu du club (première séance → `FIN_PERIODE_CLUB`),
  // recalée sur la semaine en cours comme ses séances — une période qui finirait avant son dernier
  // cours fermerait l'écriture sur des séances à venir (`ecritureFermee`).
  // Une seule période : celle du jeu. Les anciennes (jeux de données précédents) sont supprimées,
  // séances, présences et liens compris (cascade).
  await db.period.deleteMany({});
  const period = await db.period.create({
    data: {
      nom: "Rentrée 2026",
      dateDebut: SEANCES[0].date,
      dateFin: decaler(FIN_PERIODE_CLUB),
      statut: "ACTIVE",
      creneaux: { create: CRENEAUX },
      // Les comptes d'administration ne sont pas des pratiquants : ils ne sont pas invités aux séances
      //
      // **`addedAt` est posé au début de la période, et ce n'est pas un détail**. Il vaut sinon
      // l'heure du `db:seed:demo`, c'est-à-dire *aujourd'hui* : tout le monde paraissait avoir
      // rejoint le trimestre après les cours déjà donnés. Or le taux personnel est borné à la date
      // d'arrivée (« un taux qui compte les cours d'avant l'arrivée de quelqu'un n'est pas un taux,
      // c'est un reproche ») — donc « Mon historique » n'affichait plus aucun taux, les captures
      // montraient des écrans vides de leur chiffre, et un test de bout en bout tombait. Une base
      // de club n'a jamais ce problème : ses lignes portent l'heure réelle où le bureau a ajouté
      // chacun, qui précède les cours. Le jeu de démonstration doit raconter la même chose que la
      // vraie vie.
      membres: { create: MEMBRES.map((m) => ({ userId: users[m.email].id, addedAt: new Date(`${SEANCES[0].date}T00:00:00Z`) })) },
      instructeurs: { create: instructeursIds.map((userId) => ({ userId })) },
    },
  });

  // ---- Séances et réponses : exactement celles de `SEANCES_CLUB`
  const sessionsParDate: Record<string, string> = {};
  for (const s of SEANCES) {
    const creneau = CRENEAUX.find((c) => c.jourSemaine === isoWeekday(s.date)) ?? CRENEAUX[0];
    const programme = PROGRAMME_COMPLET.find((p) => p.date === s.date);
    const parties = programme?.parties ?? [];
    /*
     * **Les cases de la séance : le modèle, et ce qui déborde du modèle.**
     *
     * Le modèle pose une seule partie avec un cours. Les cases que le programme du club remplit
     * en plus sont des **cours de la même partie**, nommés comme l'application les nomme
     * (« Cours 1 », « Cours 2 »… — sans préfixe, la séance n'ayant qu'une partie).
     */
    const modele = partiesInitiales();
    const derniere = modele[modele.length - 1].bloc;
    const nbCases = Math.max(modele.length, ...parties.map((p) => p.rang + 1));
    const elements: Array<{ bloc: number; nature: NatureElement }> = [
      ...modele.map(({ bloc, nature }) => ({ bloc, nature })),
      ...Array.from({ length: nbCases - modele.length }, () => ({ bloc: derniere, nature: "COURS" as const })),
    ];
    // Les éléments sont déjà dans l'ordre de lecture (le cours du modèle, puis les cours en plus,
    // tous dans la partie 1) : `ordre` est l'index, et le nom se calcule comme `rangerParties` le ferait.
    const places = placesDansPartie(elements);
    const nbParties = new Set(elements.map((e) => e.bloc)).size;
    const casesSeance = elements.map((e, ordre) => ({ ...e, ordre, libelle: libelleElement(e.bloc, e.nature, places[ordre].rang, places[ordre].nombre, nbParties) }));
    const session = await db.session.create({
      data: {
        periodId: period.id,
        date: s.date,
        heureDebut: s.heureDebut,
        heureFin: creneau.heureFin,
        lieu: creneau.lieu,
        adresse: creneau.adresse,
        // **Le cours du modèle** (une seule partie), comme pour une séance créée dans l'application,
        // plus les cours que le programme demande ; celles que le programme renseigne reçoivent leur
        // thème et leur instructeur, les autres restent vides mais bien présentes.
        parties: {
          create: casesSeance.map((p, rang) => {
            const saisie = parties.find((x) => x.rang === rang);
            return {
              ...p,
              theme: saisie?.theme ?? "",
              description: saisie?.description ?? "",
              niveau: saisie?.niveau ?? "INDIFFERENT",
              instructeurId: saisie ? users[saisie.email].id : null,
              modifieParId: saisie ? users[COMPTES.adminNominatif].id : null,
            };
          }),
        },
        // Le membre qui n'a jamais ouvert l'application n'a pas encore répondu pour les séances à venir
        attendances: { create: s.reponses.filter(([email]) => !(email === COMPTES.nouveau && s.date >= aujourdHui)).map(([email, statut]) => ({ userId: users[email].id, statut })) },
      },
      select: { id: true },
    });
    // `disciplines` et `SessionInstructeur` étaient recopiés **à la main** ici, avec une règle
    // écrite deux fois : le jeu d'essai a fini par dériver de l'application (thèmes non dédoublonnés
    // par exemple). C'est la fonction de l'application qui décide — une règle, un endroit.
    await synchroniserSeance(session.id);
    sessionsParDate[s.date] = session.id;
  }

  // ---- Une séance à venir annulée (le cas doit rester visible dans l'app)
  const aVenir = SEANCES.filter((s) => s.date >= aujourdHui);
  const annulee = aVenir[1];
  if (annulee) {
    await db.session.update({
      where: { id: sessionsParDate[annulee.date] },
      data: { annulee: true, motifAnnulation: "Salle indisponible (réservée par la mairie)" },
    });
  }

  // ---- Ateliers (propres à l'application) ; celui qui est planifié occupe une option du planning
  const prochaine = aVenir.find((s) => s.date > aujourdHui && s.date !== annulee?.date);
  await db.atelier.deleteMany({});
  for (const a of ATELIERS) {
    const { email, statut, ...data } = a;
    const sessionId = statut === "PLANIFIE" && prochaine ? sessionsParDate[prochaine.date] : null;
    const atelier = await db.atelier.create({ data: { ...data, statut, sessionId, proposeParId: users[email].id } });
    // Le placement passe par l'application (un élément Atelier vide, sinon une option libre, sinon un
    // élément Atelier de plus dans la dernière partie) plutôt
    // que par une case nommée en dur : le jeu d'essai montre ce que l'équipe verrait vraiment.
    if (sessionId) await placerAtelier(atelier.id, sessionId, users[COMPTES.adminNominatif].id);
  }

  // ---- La prochaine séance montre ce qu'une partie peut porter : un échauffement avant le premier
  // cours, une option en parallèle du deuxième (l'atelier planifié ci-dessus occupe déjà la dernière
  // partie). Ajoutés comme l'application les ajoute, puis rangés par la même fonction.
  if (prochaine) {
    const sessionId = sessionsParDate[prochaine.date];
    const auteur = users[COMPTES.adminNominatif].id;
    await db.sessionPartie.createMany({
      data: [
        { sessionId, bloc: 1, nature: "ECHAUFFEMENT", ordre: -1, libelle: "", theme: "Mobilité et jeu de jambes", instructeurId: users[COMPTES.instructeur].id, modifieParId: auteur },
        { sessionId, bloc: 2, nature: "OPTION", ordre: 99, libelle: "", theme: "Sparring encadré", niveau: "INTERMEDIAIRE", instructeurId: users[COMPTES.instructeur].id, modifieParId: auteur },
        // Assez de cours et d'options pour voir les teintes : chacun la sienne, selon son thème.
        { sessionId, bloc: 1, nature: "OPTION", ordre: 50, libelle: "", theme: "Dague", instructeurId: users[COMPTES.adminNominatif].id, modifieParId: auteur },
        { sessionId, bloc: 2, nature: "COURS", ordre: 90, libelle: "", theme: "Messer", niveau: "DEBUTANT", instructeurId: users[COMPTES.adminNominatif].id, modifieParId: auteur },
      ],
    });
    const aRanger = await db.sessionPartie.findMany({ where: { sessionId }, select: SELECTION_RANGEMENT });
    await db.$transaction(rangerParties(aRanger.map((p) => ({ ...p, nature: p.nature as NatureElement })), db));
    await synchroniserSeance(sessionId);
  }

  // ---- Événements : deux annonces publiées et un brouillon (fil, panneau, page publique de partage)
  await db.evenement.deleteMany({});
  const dans = (jours: number) => addDays(aujourdHui, jours);
  const EVENEMENTS = [
    {
      nom: "Stage d'épée longue avec Fiore",
      description:
        "Une journée sur les gardes et les enchaînements du Fior di Battaglia, ouverte aux débutants comme aux confirmés. Repas tiré du sac le midi, matériel de protection fourni pour ceux qui n'en ont pas.",
      dateDebut: dans(24),
      heureDebut: "10:00",
      heureFin: "17:30",
      lieu: "Salle des fêtes, Villebourg",
      adresse: "1 rue des Lices, 00000 Villebourg",
      organisateur: "Mon club d'AMHE",
      lienInscription: "https://www.helloasso.com/",
      // Les deux tarifs séparés : le prix affiché, et le tarif réduit réservé aux adhérents.
      prix: "45 €",
      prixAdherent: "35 €",
      dureeNombre: 1,
      dureeUnite: "jour",
      publie: true,
    },
    {
      nom: "Tournoi de messer de Bourgogne",
      description: "Tournoi amical entre clubs bourguignons, en poules puis élimination directe. Venez encourager nos tireurs !",
      dateDebut: dans(45),
      heureDebut: "09:00",
      dateFin: dans(46),
      heureFin: "18:00",
      lieu: "Gymnase municipal, Villebourg",
      adresse: "3 avenue du Stade, 00000 Villebourg",
      organisateur: "Fédération des AMHE de Bourgogne",
      lienInscription: "https://www.helloasso.com/",
      lienSource: "https://club.test/",
      // Pas de `prix` : l'affichage dira « Gratuit ». C'est la seule annonce **publiée** sans tarif,
      // donc celle qui illustre ce cas dans le fil et sur les captures d'aperçu — le brouillon du
      // marché de Noël, lui, ne paraît pas dans le fil d'un membre.
      dureeNombre: 2,
      dureeUnite: "jour",
      publie: true,
    },
    {
      nom: "Démonstration au marché de Noël",
      description: "Démonstration publique sur la place du village, à confirmer avec la mairie.",
      dateDebut: dans(80),
      heureDebut: "14:00",
      lieu: "Place de l'église, Villebourg",
      organisateur: "Mon club d'AMHE",
      dureeNombre: 1,
      dureeUnite: "demi-journee",
      publie: false,
    },
  ];
  for (const e of EVENEMENTS) {
    await db.evenement.create({
      data: { ...e, creeParId: users[COMPTES.adminNominatif].id, publieAt: e.publie ? new Date() : null },
    });
  }
  console.info(`[seed] ${EVENEMENTS.filter((e) => e.publie).length} événements publiés + 1 brouillon.`);

  // ---- Liens d'accès personnels : jeton fixe par compte (captures, e2e) ; certains jamais ouverts
  await db.invitation.deleteMany({ where: { periodId: period.id } });
  for (const [i, m] of MEMBRES.entries()) {
    const jamaisOuvert = m.email === COMPTES.nouveau || i % 5 === 4;
    // Étalement des ouvertures sur les vingt derniers jours. Le `% 20` ne change rien au jeu du
    // club (douze personnes, i < 20) et évite, en taille « grand », de dater dans le **futur**
    // l'ouverture des liens au-delà du vingtième — un lien ouvert demain n'existe pas.
    const quand = new Date(Date.now() - (20 - (i % 20)) * 86_400_000);
    await db.invitation.create({
      data: {
        userId: users[m.email].id,
        periodId: period.id,
        tokenHash: hashToken(demoLien(m.email)),
        expiresAt: invitationExpiry(),
        usedAt: jamaisOuvert ? null : quand,
        // Un lien déjà ouvert a déjà montré le parcours d'accueil : on ne le repropose pas à
        // chaque connexion (voir `Invitation.parcoursVuLe`). Les liens jamais ouverts, eux, le
        // gardent devant eux — c'est ce que voit un nouveau membre, et ce que rejoue le test e2e.
        parcoursVuLe: jamaisOuvert ? null : quand,
        ouvertures: jamaisOuvert ? 0 : 1,
        derniereOuverture: jamaisOuvert ? null : quand,
      },
    });
  }

  const decalage = decalageDemo(aujourdHui);
  console.info(
    `[seed] ${MEMBRES.length} membres du club, période « ${period.nom} », ${SEANCES.length} séances (données du club)` +
      // Le décalage est dit : sans cette ligne, personne ne saurait que les dates installées ne sont
      // pas celles de `donnees-club.ts` — et c'est la première chose à savoir devant une capture datée.
      (decalage ? `, recalées de ${decalage / 7} semaine(s) depuis l'ancrage du ${ANCRAGE_DEMO} : ${SEANCES[0].date} → ${SEANCES[SEANCES.length - 1].date}.` : "."),
  );
  if (grand) {
    const roles = (r: string) => MEMBRES.filter((m) => m.role === r).length;
    // Le bureau se compte à part : ce n'est plus un rôle, c'est un supplément porté par-dessus.
    const bureau = MEMBRES.filter((m) => m.estAdmin === true).length;
    const reponses = SEANCES.reduce((n, s) => n + s.reponses.length, 0);
    const sansReponse = SEANCES.filter((s) => s.date >= aujourdHui).reduce((n, s) => n + (MEMBRES.length - s.reponses.length), 0);
    console.info(`[seed] rôles : ${roles("INSTRUCTEUR")} instructeurs, ${roles("MEMBRE")} membres, dont ${bureau} du bureau (administrateurs).`);
    console.info(
      `[seed] présences : ${reponses} réponses en tout, ${sansReponse} « sans réponse » sur les séances à venir ` +
        `(noyau ${EFFECTIFS_PROFILS.noyau}, irréguliers ${EFFECTIFS_PROFILS.irregulier}, discrets ${EFFECTIFS_PROFILS.discret}, jamais venus ${EFFECTIFS_PROFILS.jamais}).`,
    );
  }
  const admin = await db.user.findUnique({ where: { email: EMAIL_ADMINISTRATION }, select: { passwordHash: true } });
  const accesDemo = admin?.passwordHash ? await verifyPassword(admin.passwordHash, DEMO_MOT_DE_PASSE) : false;
  console.info(
    accesDemo
      ? `[seed] administration : ${EMAIL_ADMINISTRATION} / ${DEMO_MOT_DE_PASSE} + code TOTP (secret ${DEMO_TOTP_SECRET})`
      : `[seed] administration : ${EMAIL_ADMINISTRATION} — mot de passe et 2FA choisis à la main, conservés.`,
  );
  console.info(`[seed] lien d'un membre : /invitation/${demoLien(COMPTES.membre)}`);
  console.info(`[seed] lien jamais ouvert : /invitation/${demoLien(COMPTES.nouveau)}`);
}

/*
 * **Exécuté directement (`npm run db:seed:demo`) ; importé par les captures et les e2e pour les
 * constantes seulement** — et la reconnaissance se fait sur le NOM DU FICHIER D'ENTRÉE, comme dans
 * `prisma/seed.ts` et `scripts/reparer-donnees.ts`.
 *
 * `import.meta.url` marchait sous `tsx`, qui sait charger de l'ES, et **cassait tout le reste** :
 * le projet n'est pas un module ES, Playwright transpile les specs en CommonJS, et `import.meta`
 * n'y existe pas. Le, une passe de bugs a fait importer `dateDemo` d'ici à deux specs
 * (`filtre-date`, `zy-retrait-membre`) : les deux fichiers ont cessé d'être lisibles, et Playwright
 * **abandonne la campagne entière** quand il n'arrive pas à collecter un fichier — plus un seul
 * test e2e ne tournait, sans que rien ne le dise autrement qu'un `SyntaxError` au milieu du
 * journal.
 */
if (/(^|[\\/])seed-demo\.(ts|js|cjs|mts|mjs)$/.test(process.argv[1] ?? "")) {
  main()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => db.$disconnect());
}
