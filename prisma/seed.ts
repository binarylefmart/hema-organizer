/**
 * Seed du compte d'administration, idempotent : crée ADMIN_EMAIL/ADMIN_PASSWORD s'il n'existe pas.
 * C'est la **seule adresse de connexion du portail** (contact@… en production) ; tout le monde
 * entre par lien personnel. Le mot de passe fourni est **provisoire** : l'application impose
 * d'en choisir un autre, puis de configurer la double authentification, à la première connexion.
 * Ne modifie jamais un compte existant. Exécuté au démarrage du conteneur (entrypoint) et via `npm run db:seed`.
 *
 * L'adresse email des membres est **facultative** (`User.email` est nullable), mais pas celle-ci :
 * ce compte se connecte **par son adresse** (email + mot de passe + 2FA). Sans ADMIN_EMAIL, aucun
 * compte n'est créé — c'est déjà le cas ci-dessous.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * **« Ne modifie jamais un compte existant » est une promesse, pas une intention**.
 *
 * Ce seed promouvait le compte trouvé à l'adresse d'`ADMIN_EMAIL` : `role: "ADMIN"`, `actif: true`,
 * `service: true`. Trois documents promettaient le contraire (cette docstring, `.env.example`,
 * `docs/DEPLOIEMENT.md` § 2) et CLAUDE.md exige un seed « idempotent ». Or il tourne **à chaque
 * démarrage du conteneur** (`docker/entrypoint.sh`, étape 3) : à chaque *Update the stack*, chaque
 * *Re-pull image*, chaque reboot du serveur. Donc à chaque fois :
 *
 * - `ADMIN_EMAIL` valant l'adresse du club, qui est aussi celle d'une personne de l'annuaire, cette
 *   personne devenait ADMIN **et compte de service** : disparue des listes nominatives et des
 *   effectifs, privée de son lien d'accès, plus instructeur, et **son compte n'était plus
 *   modifiable depuis l'interface** (`canEditUser` protège le compte du portail) ;
 * - un administrateur délibérément déchu dans « Comptes admin » était re-promu ;
 * - un compte désactivé exprès était réactivé.
 *
 * Et rien n'en allait dans `AuditLog`, alors que `docs/SECURITE.md` range « nommer ou déchoir un
 * admin » parmi les actions journalisées. Un seed n'a de toute façon **pas d'acteur** à inscrire au
 * journal : il tourne avant toute session, sans personne derrière. C'est une raison de plus pour
 * qu'il ne décide de rien — **il crée, ou il se tait**. Nommer un administrateur est un geste de
 * bureau, qui a son écran (`/admin/comptes`), ses gardes et sa ligne d'audit.
 *
 * Conséquence assumée : sur une base où l'adresse d'`ADMIN_EMAIL` appartient déjà à quelqu'un, le
 * seed ne crée rien et le dit en clair dans le journal du conteneur. C'est le bon comportement —
 * l'installation qui a besoin d'un administrateur en désigne un depuis l'espace admin, ou donne au
 * portail une adresse qui n'est celle de personne.
 */
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/auth/password";

/** Longueur minimale du mot de passe provisoire (en deçà, aucun compte n'est créé). */
export const MOT_DE_PASSE_MIN = 10;

/**
 * Ce que le seed a besoin de savoir d'un compte déjà présent à cette adresse.
 *
 * **`estAdmin` est ce qui dit « administrateur »** : le bureau est un supplément et `role` ne vaut
 * plus jamais `"ADMIN"`. Le rôle reste lu, mais seulement pour **nommer l'état** du compte trouvé
 * dans le journal du conteneur (« un compte membre existe déjà à cette adresse »).
 */
export type CompteExistant = { role: string; estAdmin: boolean; actif: boolean; service: boolean };

/**
 * La décision du seed, prise **sans toucher la base** : elle se teste sans Prisma, et il n'y a
 * qu'une seule branche qui écrit. `message` est ce qui part dans le journal du conteneur — c'est le
 * seul endroit où quelqu'un lira ce qui s'est passé au démarrage.
 */
export type DecisionSeed =
  | { action: "rien"; message: string }
  | { action: "creer"; email: string; message: string }
  | { action: "laisser"; email: string; message: string };

/**
 * `laisser` est le cas qui compte : **aucune écriture**, quel que soit l'état du compte trouvé.
 * Le message nomme cet état, parce que « je n'ai rien fait » n'est utile que si l'on comprend
 * pourquoi — et parce que c'est là qu'un bureau surpris de ne pas pouvoir entrer trouvera quoi faire.
 */
export function decisionSeed(brut: { email?: string; password?: string }, existant: CompteExistant | null): DecisionSeed {
  const email = (brut.email ?? "").trim().toLowerCase();
  const password = brut.password ?? "";
  if (!email || !password) return { action: "rien", message: "ADMIN_EMAIL / ADMIN_PASSWORD absents : aucun compte admin créé." };
  if (password.length < MOT_DE_PASSE_MIN) {
    return { action: "rien", message: `ADMIN_PASSWORD trop court (${MOT_DE_PASSE_MIN} caractères minimum) : compte admin non créé.` };
  }
  if (!existant) {
    return { action: "creer", email, message: `compte d'administration ${email} créé (mot de passe provisoire : à changer à la première connexion).` };
  }
  if (existant.estAdmin && existant.actif) {
    return { action: "laisser", email, message: `compte admin ${email} déjà présent : rien n'est modifié.` };
  }
  // Écrites sur le rôle, ces deux lignes se taisaient : plus aucun compte ne vaut « ADMIN », donc le
  // seed aurait annoncé « un compte membre existe déjà » à propos du compte du bureau lui-même, et
  // décrit comme ordinaire le compte dont dépend l'entrée dans l'administration.
  const etat = existant.estAdmin ? "administrateur désactivé" : `compte ${existant.role.toLowerCase()}`;
  return {
    action: "laisser",
    email,
    message:
      `un ${etat} existe déjà à l'adresse ${email} : rien n'est modifié (ni rôle, ni activation, ni mot de passe). ` +
      "Le seed ne nomme jamais un administrateur : cela se fait dans Espace admin → Comptes admin, par quelqu'un qui a le droit de le faire et dont le geste est journalisé. " +
      "Si personne ne peut plus entrer, donner à ADMIN_EMAIL une adresse qui n'est celle de personne, puis redémarrer la stack.",
  };
}

/** Le strict nécessaire de Prisma : `seedAdmin` se teste avec un faux client, sans base. */
export type ClientSeed = {
  user: {
    findUnique(args: { where: { email: string }; select: { role: true; estAdmin: true; actif: true; service: true } }): Promise<CompteExistant | null>;
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
};

/** Les variables lues par le seed : `process.env` en vrai, un objet nu dans les tests. */
export type VariablesSeed = Record<string, string | undefined>;

/** Applique la décision. **Une seule écriture possible : `create`.** */
export async function seedAdmin(db: ClientSeed, variables: VariablesSeed = process.env): Promise<DecisionSeed> {
  const email = (variables.ADMIN_EMAIL ?? "").trim().toLowerCase();
  const password = variables.ADMIN_PASSWORD ?? "";
  // La base n'est consultée que si la configuration est utilisable : un démarrage sans ADMIN_EMAIL
  // ne doit pas dépendre de l'état de la base pour dire ce qu'il a à dire.
  const preliminaire = decisionSeed({ email, password }, null);
  if (preliminaire.action === "rien") {
    console.info(`[seed] ${preliminaire.message}`);
    return preliminaire;
  }
  const existant = await db.user.findUnique({ where: { email }, select: { role: true, estAdmin: true, actif: true, service: true } });
  const decision = decisionSeed({ email, password }, existant);
  if (decision.action === "creer") {
    await db.user.create({
      data: {
        prenom: variables.ADMIN_PRENOM?.trim() || "Bureau",
        nom: variables.ADMIN_NOM?.trim() || "HEMA",
        email,
        // **Rôle de base neutre, bureau en supplément** : `role: "ADMIN"` n'ouvrirait plus rien —
        // `can()` accorde la ligne ADMIN de la matrice à `estAdmin`, et ce compte-ci est la seule
        // porte de l'administration technique sur une installation neuve. Le portail n'est pas une
        // personne du club : *membre* est ici la valeur qui ne dit rien, comme dans la migration.
        role: "MEMBRE",
        estAdmin: true,
        service: true,
        passwordHash: await hashPassword(password),
        doitChangerMotDePasse: true,
      },
    });
  }
  console.info(`[seed] ${decision.message}`);
  return decision;
}

/*
 * Lancement en ligne de commande seulement (`npm run db:seed`, ou `node seed.cjs` dans l'image) :
 * la reconnaissance se fait sur le nom du fichier d'entrée, comme `scripts/reparer-donnees.ts` —
 * `tsx` compile ces scripts en CommonJS (le projet n'est pas un module ES), où `import.meta`
 * n'existe pas. Sans cette garde, importer ce module depuis un test ouvrirait une vraie base.
 * `seed.cjs` est le nom que porte le seed **dans l'image Docker** (voir le Dockerfile).
 */
if (/(^|[\\/])seed\.(ts|js|cjs|mts|mjs)$/.test(process.argv[1] ?? "")) {
  const db = new PrismaClient();
  void seedAdmin(db)
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => db.$disconnect());
}
