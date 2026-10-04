import { execSync } from "node:child_process";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";

/**
 * Le serveur de développement doit répondre **avant** la suite.
 *
 * Piège déjà rencontré : deux `next dev` sur le même dossier `.next` (par exemple parce que Playwright
 * en a démarré un second « using port 3001 ») corrompent la compilation — le serveur du port 3000 se met
 * alors à répondre 404 ou 500 et toute la suite échoue sans raison visible. On s'arrête net avec la marche
 * à suivre plutôt que de laisser passer vingt échecs fantômes.
 */
async function attendreServeur(): Promise<void> {
  const url = `${BASE}/api/health`;
  let dernier: number | string = "aucune réponse";
  for (let i = 0; i < 40; i++) {
    dernier = await fetch(url)
      .then((r) => r.status)
      .catch(() => "aucune réponse");
    if (dernier === 200) return;
    await new Promise((r) => setTimeout(r, 1_500));
  }
  const serveurs = execSync("pgrep -fc 'next dev' || true", { encoding: "utf8" }).trim();
  throw new Error(
    [
      `Le serveur de développement ne répond pas correctement sur ${url} (${dernier}).`,
      `Processus « next dev » en cours : ${serveurs}.`,
      "Marche à suivre : arrêter tous les « next dev », supprimer .next, relancer « npm run dev »,",
      "puis « npm run db:seed:demo » — et vérifier que /api/health renvoie 200 avant de relancer la suite.",
    ].join("\n"),
  );
}

/**
 * **Les sessions ouvertes par un lien ne survivent pas à la campagne précédente.**
 *
 * Chaque test part d'un contexte de navigateur neuf : ouvrir le lien d'un membre y pose une session
 * de plus, et presque aucun scénario ne se déconnecte. Une session vit douze heures, le seed ne
 * touche pas à `AuthSession` — et le plafond d'appareils compte précisément **les sessions vivantes
 * ouvertes par le lien** (`verifierAppareils`, src/lib/invitations.ts). Au bout de quelques
 * campagnes dans la même journée, le compte d'un membre de démonstration franchit le plafond au
 * milieu d'une suite : son lien est révoqué en cours de route, remplacé, et tous les scénarios qui
 * s'en servent ensuite tombent sur « Lien non valide » — un rouge qui n'apprend rien sur le code.
 *
 * On efface donc ces sessions-là, et elles seules : celles qui viennent d'un mot de passe ne sont
 * pas comptées par le plafond, et les effacer déconnecterait la personne qui a l'application ouverte
 * à côté.
 */
async function effacerSessionsDeLien(): Promise<void> {
  // Playwright ne charge pas `.env` (c'est Next qui le fait pour le serveur, et `tsx` pour le seed).
  if (!process.env.DATABASE_URL) process.loadEnvFile();
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient();
  try {
    await db.authSession.deleteMany({ where: { origine: "lien" } });
  } finally {
    await db.$disconnect();
  }
}

/**
 * **On fait compiler les écrans avant que le premier test ne les demande.**
 *
 * C'est la cause de presque tous les rouges qu'on a réparés, et aucun n'était un bug : `next dev`
 * compile **à la demande**, et la première visite d'un écran coûte de cinq à douze secondes —
 * davantage sur une machine chargée. Le test qui tombe sur cette première visite paie pour tous les
 * autres, et il paie sur un budget d'**affichage** (30 s chez Playwright, 5 s pour une assertion
 * d'URL) qui n'a jamais été pensé pour une compilation. D'où des échecs qui se déplacent d'un
 * fichier à l'autre selon l'ordre d'exécution : `presences.spec.ts:44` passait dans la suite
 * entière et tombait joué seul, parce qu'un voisin avait déjà payé `/planning`.
 *
 * Le préchauffage se fait **pendant le seed**, qui dure de toute façon quelques secondes : à la fin
 * de `globalSetup`, les écrans sont chauds et plus personne ne paie. Les routes visées sont celles
 * que la suite ouvre vraiment, les plus lourdes d'abord (le planning et l'annuaire montent des
 * grilles entières).
 *
 * Aucune n'exige de session : une redirection vers `/connexion` compile la page **et** le middleware,
 * ce qui est tout ce qu'on veut. On ne regarde donc pas le statut, et **un échec ici n'arrête
 * rien** — c'est un confort de vitesse, jamais une condition de la campagne.
 */
const ECRANS_A_CHAUFFER = [
  "/planning",
  "/admin/membres",
  "/seances",
  "/profil",
  "/",
  "/admin/comptes",
  "/admin/presences",
  "/admin/periodes",
  "/admin/audit",
  "/admin/apropos",
  "/admin/notifications",
  "/gestion/ateliers",
  "/gestion/periodes",
  "/gestion/evenements",
  "/ateliers",
  "/mes-presences",
  "/connexion",
  "/connexion/admin",
  "/mot-de-passe-oublie",
];

async function chaufferLesEcrans(): Promise<void> {
  const debut = Date.now();
  // Quatre de front : au-delà, les compilations se disputent les mêmes cœurs et le total ne baisse
  // plus — le serveur de développement compile déjà en parallèle de son côté.
  const file = [...ECRANS_A_CHAUFFER];
  const ouvrier = async () => {
    for (let route = file.shift(); route; route = file.shift()) {
      await fetch(`${BASE}${route}`, { redirect: "manual" }).catch(() => undefined);
    }
  };
  await Promise.all([ouvrier(), ouvrier(), ouvrier(), ouvrier()]);
  console.log(`[e2e] ${ECRANS_A_CHAUFFER.length} écrans préchauffés en ${Math.round((Date.now() - debut) / 1000)} s.`);
}

/**
 * **Les réglages que les scénarios font basculer reviennent à l'état d'une base neuve.**
 *
 * Deux campagnes ont été tuées par le système (mémoire courte), toutes deux au milieu du fichier
 * qui ouvre l'API publique et coche une annonce dans la matrice. Ces scénarios rendent l'état à la
 * fin — mais une campagne interrompue n'arrive jamais à sa fin. La suivante trouvait donc l'API
 * **ouverte** et une case **cochée**, et deux tests tombaient sur ce que la campagne d'avant avait
 * laissé : « fermée par défaut » recevait 200, et « ouvrir la publication ne republie rien à votre
 * place » recevait une annonce.
 *
 * Le seed ne les touche pas — et c'est normal, ce sont des réglages de club, pas des données de
 * démonstration. On les efface donc ici : **une ligne absente vaut le défaut livré** (API fermée,
 * matrice par défaut), ce qui est exactement ce qu'une base neuve donne et ce que les tests
 * affirment. C'est la même doctrine que l'effacement des sessions de lien juste au-dessus : la
 * campagne part d'un état connu au lieu d'espérer que la précédente a bien fini.
 */
async function remettreLesReglagesDeCampagne(): Promise<void> {
  if (!process.env.DATABASE_URL) process.loadEnvFile();
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient();
  try {
    await db.setting.deleteMany({ where: { key: { in: ["publicApiEnabled", "notifications", "alertesSecurite"] } } });
    /*
     * **Les seaux du limiteur de débit, vidés avant chaque campagne**.
     *
     * Le limiteur est **persistant** (table `RateLimit`, fenêtre glissante) : il ne se vide pas entre
     * deux exécutions. Or la campagne se connecte au compte d'administration des dizaines de fois, et
     * les seaux `totp_ip` / `totp_user` plafonnent — à dessein — les tentatives de code. Tout ce qui
     * s'est connecté **avant** la campagne consomme donc le même budget : une campagne d'aperçus
     * (`npm run preview:screenshots`, qui ouvre l'espace admin sur une trentaine de scènes), une
     * connexion à la main pour vérifier un écran, ou une campagne précédente interrompue.
     *
     * Vécu ce soir-là, sur la copie publique : la campagne d'aperçus avait épuisé le seau, et le
     * premier scénario d'administration est resté **deux minutes** sur l'écran du code avant de tomber
     * en délai dépassé. Le message n'aidait pas — « waiting for navigation » — et il fallait ouvrir la
     * capture de la page pour y lire « Trop de tentatives ». La campagne ne passait donc que si
     * personne ne s'était connecté dans le quart d'heure précédent : une réussite qui dépendait de
     * l'ordre dans lequel on avait travaillé, pas de l'état du code.
     *
     * On ne désactive pas le limiteur pour autant (`RATE_LIMIT_DISABLED`) : **deux scénarios
     * l'éprouvent** — les liens inconnus répétés depuis la même adresse, et la devinette de mot de
     * passe. Le vider au départ leur laisse leur budget entier ; l'éteindre les rendrait muets.
     */
    await db.rateLimit.deleteMany({});
  } finally {
    await db.$disconnect();
  }
}

/** Serveur sain + seed de démonstration avant chaque campagne e2e (jetons et comptes dans un état connu). */
export default async function globalSetup(): Promise<void> {
  await attendreServeur();
  // Le préchauffage tourne **pendant** le seed : l'un occupe le serveur, l'autre la base.
  const chauffe = chaufferLesEcrans();
  // Les tests se connectent avec le mot de passe de démonstration : on impose l'état connu du compte.
  execSync("npm run db:seed:demo", { stdio: "inherit", env: { ...process.env, SEED_DEMO_RESET_ADMIN: "1" } });
  await effacerSessionsDeLien();
  await remettreLesReglagesDeCampagne();
  await chauffe;
}
