import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **Qui peut être proposé dans une case du planning : les instructeurs, et personne d'autre —
 * sauf ceux qui y sont déjà.**
 *
 * Demandé par Delta, après la v0.53.0 : « pour le champ des instructeurs dans planning tu as mis
 * en liste tous les users, je ne veux que ceux qui ont le rôle instructeur ».
 *
 * Ce fichier verrouillait l'inverse, et c'est **volontairement** qu'il est réécrit :, la liste
 * avait été ouverte à tout le club pour corriger un **filtre de période** (une personne inscrite
 * après la génération du trimestre n'apparaissait nulle part). Les deux filtres vivaient dans une
 * seule condition ; ils sont désormais séparés, et seul celui de période a disparu pour de bon — un
 * instructeur recruté demain est toujours dans la liste sans qu'on ait rien à faire.
 *
 * Ce que ce fichier verrouille, et qui se casserait sans bruit :
 *  - **aucune condition de période** dans la requête — c'était elle, le défaut de septembre ;
 * - **un MEMBRE n'est pas proposable**, fût-il du bureau — et c'est le seul endroit du dépôt où
 * `estAdmin` **ne donne rien** : mener une partie de cours est un métier, pas un droit, et
 * `personnesPlanning` interroge donc `role` et lui seul. Un trésorier qui ne descend jamais sur la
 * piste n'a rien à faire dans un menu d'encadrants. Le pendant, impossible : **un instructeur du
 * bureau est proposable comme n'importe quel instructeur** — les rôles étant exclusifs, le nommer
 * au bureau l'effaçait de cette liste ;
 *  - **une personne déjà posée sur une case reste dans la liste**, même si elle n'est pas (ou plus)
 *    instructrice, même désactivée : sans elle, le `<select>` n'aurait plus d'entrée à sa valeur,
 *    afficherait `----------`, et le premier enregistrement écraserait une donnée juste ;
 *  - les deux exclusions de toujours : comptes **désactivés** et **compte de service** du bureau —
 *    qui ne valent que pour la branche « instructeur », jamais pour le rattrapage ;
 *  - l'ordre affiché : **alphabétique**, par prénom puis nom (le rang qui reléguait les MEMBRE en
 *    queue n'a plus d'objet, et reléguerait justement les personnes rattrapées).
 *
 * La base n'est jamais touchée : `@/lib/db` est remplacé par un faux client qui journalise sa requête.
 */

type Appel = { modele: string; operation: string; args: Record<string, unknown> };

const { appels, reponses, fauxDb } = vi.hoisted(() => {
  const appels: Appel[] = [];
  const reponses = new Map<string, unknown>();
  const fauxDb = new Proxy(
    {},
    {
      get(_cible, modele) {
        if (typeof modele !== "string") return undefined;
        return new Proxy(
          {},
          {
            get(_c2, operation) {
              if (typeof operation !== "string") return undefined;
              return async (args: Record<string, unknown> = {}) => {
                appels.push({ modele, operation, args });
                const prete = reponses.get(`${modele}.${operation}`);
                return prete === undefined ? (operation === "findMany" ? [] : null) : prete;
              };
            },
          },
        );
      },
    },
  );
  return { appels, reponses, fauxDb };
});

vi.mock("@/lib/db", () => ({ db: fauxDb }));

/**
 * Le club tel que la base le contient, dans un ordre quelconque — avec les deux cas limites qui
 * font tout l'intérêt du filtre : l'ancienne instructrice redevenue membre et l'instructeur dont le
 * compte a été désactivé, l'un et l'autre **déjà posés sur une case** du trimestre affiché.
 */
const CLUB = [
  { id: "u-membre-nouveau", prenom: "Zoé", nom: "Arnaud", role: "MEMBRE", estAdmin: false, couleur: 1, actif: true, service: false },
  { id: "u-instructeur", prenom: "Charlie", nom: "03", role: "INSTRUCTEUR", estAdmin: false, couleur: 2, actif: true, service: false },
  { id: "u-membre", prenom: "Bravo", nom: "02", role: "MEMBRE", estAdmin: false, couleur: 3, actif: true, service: false },
  // Echo est du bureau et n'enseigne pas : rôle de base `MEMBRE`, `estAdmin` par-dessus. Elle
  // n'est **pas** proposable, et ce n'est plus une conséquence subie — c'est la règle elle-même.
  { id: "u-admin", prenom: "Echo", nom: "05", role: "MEMBRE", estAdmin: true, couleur: 4, actif: true, service: false },
  /*
   * **Le cas que l'ancien modèle rendait impossible** : Élodie enseigne *et* siège au bureau. Les
   * trois rôles étant exclusifs, la nommer au bureau lui retirait l'instruction — elle disparaissait
   * donc de cette liste, et la case du cours qu'elle mène se vidait au premier enregistrement. Elle
   * est ici pour que la liste ne puisse plus se refermer sur `estAdmin` par mégarde.
   */
  { id: "u-instructrice-bureau", prenom: "Élodie", nom: "Perrin", role: "INSTRUCTEUR", estAdmin: true, couleur: 7, actif: true, service: false },
  { id: "u-ancienne", prenom: "Camille", nom: "Boucher", role: "MEMBRE", estAdmin: false, couleur: 5, actif: true, service: false },
  { id: "u-parti", prenom: "David", nom: "Enard", role: "INSTRUCTEUR", estAdmin: false, couleur: 6, actif: false, service: false },
  { id: "u-portail", prenom: "Portail", nom: "HEMA", role: "MEMBRE", estAdmin: true, couleur: null, actif: true, service: true },
];

/**
 * **L'ordre de l'annuaire** : prénom puis nom, comparés en français — la règle que `personnesPlanning`
 * applique à la liste qu'elle rend. Elle est écrite ici pour que l'ordre attendu plus bas se
 * **calcule** sur `CLUB` au lieu d'être recopié à la main : recopié, il cessait d'être l'ordre
 * alphabétique au premier renommage d'une personne du jeu d'essai, et le test tombait sans qu'aucune
 * règle n'ait bougé.
 */
const ordreAnnuaire = (a: { prenom: string; nom: string }, b: { prenom: string; nom: string }) =>
  a.prenom.localeCompare(b.prenom, "fr") || a.nom.localeCompare(b.nom, "fr");

/** Le `where` de la requête, tel qu'il est parti vers Prisma. */
function conditionEnvoyee(): Record<string, unknown> {
  const requete = appels.find((a) => a.modele === "user" && a.operation === "findMany");
  expect(requete).toBeDefined();
  return requete!.args.where as Record<string, unknown>;
}

/**
 * **On rejoue le `where` sur le club**, au lieu de croire le faux client sur parole.
 *
 * Le faux `@/lib/db` ne sait pas filtrer : il rend ce qu'on lui a préparé, quelle que soit la
 * condition. Un test qui se contenterait de sa réponse resterait donc vert avec n'importe quel
 * filtre — y compris celui qu'on vient de corriger. On applique ici, à la main, le `OR` réellement
 * envoyé, et c'est **ce** résultat qu'on redonne au faux client.
 */
function selonLaCondition(): typeof CLUB {
  const where = conditionEnvoyee();
  const branches = (where.OR ?? [where]) as Array<Record<string, unknown>>;
  const correspond = (u: (typeof CLUB)[number], c: Record<string, unknown>) =>
    Object.entries(c).every(([champ, attendu]) => {
      if (champ === "id" && attendu && typeof attendu === "object") return ((attendu as { in?: string[] }).in ?? []).includes(u.id);
      return (u as unknown as Record<string, unknown>)[champ] === attendu;
    });
  return CLUB.filter((u) => branches.some((c) => correspond(u, c)));
}

/** La liste telle qu'un instructeur la verrait vraiment, pour les cases déjà remplies données. */
async function listeRendue(dejaPosees: string[] = []) {
  const { personnesPlanning } = await import("@/lib/planning");
  await personnesPlanning(dejaPosees); // premier passage : il nous donne le `where`
  reponses.set("user.findMany", selonLaCondition());
  appels.length = 0;
  return personnesPlanning(dejaPosees);
}

beforeEach(() => {
  appels.length = 0;
  reponses.clear();
});

describe("personnesPlanning — la liste déroulante d'une case", () => {
  it("ne retient que le rôle INSTRUCTEUR, sans condition de période", async () => {
    const { personnesPlanning } = await import("@/lib/planning");
    await personnesPlanning();
    const where = conditionEnvoyee();
    expect(where).toEqual({ OR: [{ actif: true, service: false, role: "INSTRUCTEUR" }, { id: { in: [] } }] });
    // Le filtre de septembre, celui qui enfermait vraiment la liste : il ne doit jamais revenir.
    expect(JSON.stringify(where)).not.toContain("periode");
  });

  it("un membre du club n'est pas proposable", async () => {
    const personnes = await listeRendue();
    expect(personnes.map((p) => p.id)).not.toContain("u-membre");
    expect(personnes.map((p) => p.id)).not.toContain("u-membre-nouveau");
  });

  it("un membre du bureau qui n'enseigne pas non plus : `estAdmin` n'ouvre pas cette liste", async () => {
    const personnes = await listeRendue();
    expect(personnes.map((p) => p.id)).not.toContain("u-admin");
  });

  /**
   * **La contre-épreuve du supplément**, et elle n'a de sens que : un instructeur **du bureau** se
   * choisit comme n'importe quel instructeur. Si quelqu'un refermait un jour la requête sur «
   * l'encadrement qui n'est pas du bureau » — ou l'ouvrait à `estAdmin` —, l'un des deux tests
   * tomberait : ils encadrent la règle des deux côtés.
   */
  it("un instructeur du bureau est proposable, comme n'importe quel instructeur", async () => {
    const personnes = await listeRendue();
    expect(personnes.map((p) => p.id)).toContain("u-instructrice-bureau");
  });

  it("un instructeur recruté après la génération du trimestre y est sans qu'on fasse rien", async () => {
    // L'acquis : aucune appartenance à la période n'est demandée.
    const personnes = await listeRendue();
    expect(personnes.map((p) => p.id)).toEqual(["u-instructeur", "u-instructrice-bureau"]);
  });

  it("une personne déjà posée sur une case y reste, même sans le rôle instructeur", async () => {
    // Camille a mené des cours avant de redevenir membre : sa case porte toujours son identifiant.
    // Si la liste ne la contenait plus, le `<select>` afficherait `----------` et le premier
    // enregistrement de la case effacerait son nom sans que personne ne l'ait demandé.
    const personnes = await listeRendue(["u-ancienne"]);
    expect(personnes.map((p) => p.id)).toContain("u-ancienne");
  });

  it("… et même si son compte a été désactivé entre-temps", async () => {
    // Le rattrapage passe outre `actif` et `service` : il ne dit pas qui mérite d'être proposé, il
    // permet de **nommer ce qui est déjà écrit**.
    const personnes = await listeRendue(["u-parti"]);
    expect(personnes.map((p) => p.id)).toContain("u-parti");
  });

  it("ne rattrape que ce qui est posé : le reste du club n'entre pas par cette porte", async () => {
    const personnes = await listeRendue(["u-ancienne"]);
    expect(personnes.map((p) => p.id).sort()).toEqual(["u-ancienne", "u-instructeur", "u-instructrice-bureau"]);
  });

  it("dédoublonne les identifiants reçus et ignore les cases vides", async () => {
    // `chargerPlanning` passe un identifiant par case remplie : la même personne revient autant de
    // fois qu'elle mène de parties dans le trimestre.
    const { personnesPlanning } = await import("@/lib/planning");
    await personnesPlanning(["u-ancienne", "u-ancienne", "", "u-parti"]);
    expect((conditionEnvoyee().OR as Array<{ id?: { in: string[] } }>)[1].id!.in).toEqual(["u-ancienne", "u-parti"]);
  });

  it("range la liste par ordre alphabétique, sans reléguer personne en queue", async () => {
    // Le rang qui mettait les MEMBRE en dernier n'a plus d'objet — et il aurait rejeté en bas de
    // menu les personnes rattrapées, c'est-à-dire justement celles qu'on cherche dans leur case.
    const personnes = await listeRendue(["u-ancienne", "u-parti"]);
    // **Qui** doit être là reste écrit (les quatre identifiants) ; **dans quel ordre** se déduit de
    // `CLUB` par la règle de l'annuaire, au lieu d'une seconde écriture des mêmes prénoms que le
    // moindre renommage rendait fausse. Rien n'est relâché pour autant : l'absence de tri (l'ordre
    // de `CLUB` : l'instructeur, Élodie, Camille, David), un tri sur le nom (Boucher, Enard,
    // puis les deux autres) et le rang qui reléguait les MEMBRE en queue donnent chacun un
    // résultat différent de celui-ci.
    const attendus = CLUB.filter((u) => ["u-instructeur", "u-instructrice-bureau", "u-ancienne", "u-parti"].includes(u.id))
      .sort(ordreAnnuaire)
      .map((u) => u.prenom);
    expect(personnes.map((p) => p.prenom)).toEqual(attendus);
  });

  it("ne demande rien d'autre à la base que le nécessaire de la liste", async () => {
    const { personnesPlanning } = await import("@/lib/planning");
    await personnesPlanning();
    const requete = appels.find((a) => a.modele === "user" && a.operation === "findMany");
    expect(requete!.args.select).toEqual({ id: true, prenom: true, nom: true, role: true, couleur: true });
  });
});
