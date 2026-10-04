import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Accès administrateur compte par compte (/admin/activer), **et** mot de passe facultatif pour
 * tous.
 *
 * Ce que ce fichier verrouille :
 * - qui a le droit de régler un accès fort (administrateur nominatif actif) et qui ne l'a pas
 *   (membre, instructeur, et le compte de service du portail, déjà réglé) ;
 * - l'ordre des trois étapes : mot de passe, double authentification, codes de secours ;
 * - la session en cours qui devient forte, rattachée à la bonne personne ;
 * - la connexion par mot de passe sur /connexion : ouverte à **quiconque s'en est donné un**, sans
 *   second facteur s'il n'en a pas activé, avec code s'il en a activé un ;
 * - **le point délicat** : un instructeur muni d'un mot de passe *et* d'une double authentification
 *   n'obtient **jamais** de session forte, et l'administration technique lui reste fermée ;
 * - un administrateur, lui, ne peut **jamais** ouvrir de session (forte ou non) sans son code ;
 * - un compte sans mot de passe est renvoyé à son lien personnel, par un message générique ;
 * - l'impossibilité de régler le compte de quelqu'un d'autre.
 */

type FauxCompte = {
  id: string;
  prenom: string;
  nom: string;
  email: string;
  /** Rôle **de base** : `MEMBRE` ou `INSTRUCTEUR` — `role` ne vaut plus jamais « ADMIN ». */
  role: string;
  /* **Du bureau, en supplément** : c'est lui, et plus le rôle, qui ouvre l'espace admin. */
  estAdmin: boolean;
  actif: boolean;
  service: boolean;
  passwordHash: string | null;
  totpSecret: string | null;
  totpActiveAt: Date | null;
  codesSecours: string | null;
  doitChangerMotDePasse: boolean;
  rappelEmail: boolean;
  /** Dernière proposition de double authentification (bouton « Plus tard ») */
  deuxFaProposeeLe: Date | null;
};

type FauxSession = { id: string; userId: string; tokenHash: string; forte: boolean; reauthAt: Date | null; expiresAt: Date; createdAt: Date; lastSeenAt: Date };

const faux = vi.hoisted(() => ({
  comptes: [] as Record<string, unknown>[],
  sessions: [] as Record<string, unknown>[],
  audits: [] as { action: string; acteurId: string | null }[],
  cookies: {} as Record<string, string>,
}));

/* ---------------------------------------------------------------- */
/* Faux environnement : cookies, navigation, base, envois d'emails.  */
/* ---------------------------------------------------------------- */

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (nom: string) => (nom in faux.cookies ? { name: nom, value: faux.cookies[nom] } : undefined),
    set: (nom: string, valeur: string, options?: { maxAge?: number }) => {
      if (options?.maxAge === 0) delete faux.cookies[nom];
      else faux.cookies[nom] = valeur;
    },
    delete: (nom: string) => {
      delete faux.cookies[nom];
    },
  }),
  headers: async () => new Headers({ "user-agent": "vitest" }),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECTION:${url}`);
  }),
}));

vi.mock("@/lib/email/mailer", () => ({ enqueueEmail: vi.fn() }));

const trouverCompte = (where: { id?: string; email?: string }) =>
  faux.comptes.find((u) => (where.id ? u.id === where.id : u.email === where.email)) ?? null;

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id?: string; email?: string } }) => trouverCompte(where)),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id?: string; email?: string } }) => {
        const u = trouverCompte(where);
        if (!u) throw new Error("compte introuvable");
        return u;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const u = trouverCompte(where);
        if (!u) throw new Error("compte introuvable");
        Object.assign(u, data);
        return u;
      }),
    },
    authSession: {
      findUnique: vi.fn(async ({ where }: { where: { tokenHash: string } }) => {
        const s = faux.sessions.find((x) => x.tokenHash === where.tokenHash);
        return s ? { ...s, user: trouverCompte({ id: s.userId as string }) } : null;
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const s = { id: `sess-${faux.sessions.length + 1}`, createdAt: new Date(), lastSeenAt: new Date(), ...data };
        faux.sessions.push(s);
        return s;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const s = faux.sessions.find((x) => x.id === where.id);
        if (!s) throw new Error("session introuvable");
        Object.assign(s, data);
        return s;
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        faux.sessions = faux.sessions.filter((x) => x.id !== where.id);
        return {};
      }),
      deleteMany: vi.fn(async ({ where }: { where: { tokenHash?: string; userId?: string } }) => {
        const avant = faux.sessions.length;
        faux.sessions = faux.sessions.filter((x) => (where.tokenHash ? x.tokenHash !== where.tokenHash : where.userId ? x.userId !== where.userId : false));
        return { count: avant - faux.sessions.length };
      }),
    },
    auditLog: {
      create: vi.fn(async ({ data }: { data: { action: string; acteurId: string | null } }) => {
        faux.audits.push({ action: data.action, acteurId: data.acteurId });
        return data;
      }),
    },
  },
}));

const { definirMotDePasseAdmin, activerDeuxFaAdmin, passerDeuxFa, preparerDeuxFaAdmin, confirmerCodesSecours, seConnecter, verifierCode2fa } = await import("@/actions/auth");
const { accesAdminRegle, compteAcces, DELAI_PROPOSITION_DEUX_FA_MS, etapeAcces, exigeDeuxFaConnexion, lireReglage2fa, ouvrirReglage2fa, peutOuvrirSessionForte, peutProposerDeuxFa, peutReglerSonAcces, peutSeConnecterParMotDePasse } =
  await import("@/lib/auth/acces-admin");
const { AccesRefuse, assertPermission } = await import("@/lib/auth/current-user");
const { lireAffichageCodes } = await import("@/lib/auth/deux-fa");
const { codeTotp } = await import("@/lib/auth/totp");
const { chiffrer, dechiffrer } = await import("@/lib/crypto");

/** Secret TOTP du compte du portail : une vraie valeur base32, chiffrée comme en production. */
const SECRET_PORTAIL = "JBSWY3DPEHPK3PXP";
const { generateToken, hashToken, signPayload } = await import("@/lib/auth/tokens");
const { utiliserMagasinMemoire } = await import("@/lib/auth/rate-limit");
const { DEUX_FA_COOKIE, SESSION_COOKIE } = await import("@/lib/constants");

const MOT_DE_PASSE = "grand-escrimeur-2026";

function creerCompte(p: Partial<FauxCompte> & { id: string; email: string; role: string }): FauxCompte {
  const compte: FauxCompte = {
    prenom: "Prénom",
    nom: "Nom",
    estAdmin: false,
    actif: true,
    service: false,
    passwordHash: null,
    totpSecret: null,
    totpActiveAt: null,
    codesSecours: null,
    doitChangerMotDePasse: false,
    rappelEmail: true,
    deuxFaProposeeLe: null,
    ...p,
  };
  faux.comptes.push(compte as unknown as Record<string, unknown>);
  return compte;
}

/** Connexion par lien personnel : session ordinaire (pas forte), comme tous les administrateurs nominatifs. */
function connecterParLien(userId: string): FauxSession {
  const token = generateToken();
  const session: FauxSession = {
    id: `sess-lien-${userId}`,
    userId,
    tokenHash: hashToken(token),
    forte: false,
    reauthAt: null,
    expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
    createdAt: new Date(),
    lastSeenAt: new Date(),
  };
  faux.sessions.push(session as unknown as Record<string, unknown>);
  faux.cookies[SESSION_COOKIE] = token;
  return session;
}

function formulaire(champs: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(champs)) fd.set(k, v);
  return fd;
}

const motsDePasse = (valeur = MOT_DE_PASSE) => formulaire({ motDePasse: valeur, confirmation: valeur });

/** Les server actions signalent leur redirection en levant : on lit la destination. */
async function redirectionDe(promesse: Promise<unknown>): Promise<string> {
  try {
    await promesse;
  } catch (e) {
    const m = /^REDIRECTION:(.*)$/.exec((e as Error).message);
    if (m) return m[1];
    throw e;
  }
  throw new Error("aucune redirection");
}

let delta: FauxCompte;
let foxtrot: FauxCompte;
let portail: FauxCompte;
let instructeur: FauxCompte;
let membre: FauxCompte;

beforeEach(() => {
  faux.comptes = [];
  faux.sessions = [];
  faux.audits = [];
  faux.cookies = {};
  utiliserMagasinMemoire();
  /*
   * **« Administrateur » n'est plus un rôle, c'est un supplément** : les acteurs du bureau portent
   * un rôle de base — et Delta prend `INSTRUCTEUR`, le cas que les trois rôles exclusifs rendaient
   * impossible, pour que ce parcours soit éprouvé sur celui-là aussi. Ce qui décide ici, c'est
   * `estAdmin` : si une garde retombait sur `role`, Delta passerait pour un simple instructeur.
   */
  delta = creerCompte({ id: "u-delta", prenom: "Delta", email: "delta@club.test", role: "INSTRUCTEUR", estAdmin: true });
  foxtrot = creerCompte({ id: "u-foxtrot", prenom: "Foxtrot", email: "foxtrot@club.test", role: "MEMBRE", estAdmin: true });
  /*
   * Le secret du portail est un **vrai chiffré**, et non plus le mot-témoin « chiffre ». Depuis que
   * « jamais chiffré » et « chiffré illisible » se distinguent (voir `etatSecretTotp`), une valeur
   * qui n'a pas la forme d'un chiffré fait refuser la connexion — ce qui est la bonne règle, mais
   * faisait échouer ce fixture, et pour la mauvaise raison : il voulait dire « ce compte a une
   * 2FA », pas « ce compte a une colonne abîmée ». Le dire pour de vrai fait aussi passer le test
   * par le même chemin que la production.
   */
  portail = creerCompte({ id: "u-portail", prenom: "Bureau", email: "contact@club.test", role: "MEMBRE", estAdmin: true, service: true, passwordHash: "$argon2id$factice", totpSecret: chiffrer(SECRET_PORTAIL), totpActiveAt: new Date() });
  instructeur = creerCompte({ id: "u-charlie", prenom: "Charlie", email: "charlie@club.test", role: "INSTRUCTEUR" });
  membre = creerCompte({ id: "u-chloe", prenom: "Chloé", email: "chloe@club.test", role: "MEMBRE" });
});

/* ---------------------------------------------------------------- */
/* Qui a le droit de régler un accès fort                            */
/* ---------------------------------------------------------------- */

describe("qui peut régler son accès administrateur", () => {
  it("l'autorise à un administrateur nominatif actif, et à lui seul", () => {
    expect(peutReglerSonAcces(delta)).toBe(true);
    expect(peutReglerSonAcces(instructeur)).toBe(false);
    expect(peutReglerSonAcces(membre)).toBe(false);
    expect(peutReglerSonAcces(portail)).toBe(false); // compte du portail : déjà réglé
    expect(peutReglerSonAcces({ ...delta, actif: false })).toBe(false);
    expect(peutReglerSonAcces(null)).toBe(false);
  });

  it("refuse le parcours à un membre et à un instructeur", async () => {
    connecterParLien(membre.id);
    expect(await redirectionDe(definirMotDePasseAdmin({}, motsDePasse()))).toBe("/?acces=refuse");
    faux.cookies = {};
    connecterParLien(instructeur.id);
    expect(await redirectionDe(definirMotDePasseAdmin({}, motsDePasse()))).toBe("/?acces=refuse");
    expect(membre.passwordHash).toBeNull();
    expect(instructeur.passwordHash).toBeNull();
    expect(faux.audits).toHaveLength(0);
  });

  it("refuse le parcours au compte de service du portail, qui reste intact", async () => {
    connecterParLien(portail.id); // (le portail ouvre normalement une session forte : on force le cas)
    expect(await redirectionDe(definirMotDePasseAdmin({}, motsDePasse()))).toBe("/?acces=refuse");
    expect(await redirectionDe(preparerDeuxFaAdmin())).toBe("/?acces=refuse");
    expect(portail.passwordHash).toBe("$argon2id$factice");
    expect(dechiffrer(portail.totpSecret!)).toBe(SECRET_PORTAIL);
  });

  it("refuse le parcours sans session", async () => {
    expect(await redirectionDe(definirMotDePasseAdmin({}, motsDePasse()))).toBe("/connexion?erreur=session");
  });
});

/* ---------------------------------------------------------------- */
/* Les trois étapes, dans l'ordre                                    */
/* ---------------------------------------------------------------- */

describe("parcours en trois étapes", () => {
  it("enchaîne mot de passe, double authentification et codes de secours, puis rend la session forte", async () => {
    const session = connecterParLien(delta.id);
    expect(etapeAcces(delta)).toBe("mot-de-passe");

    // 1. Mot de passe (argon2id, jamais en clair) — et le QR code de l'étape 2 est préparé dans la foulée
    expect(await redirectionDe(definirMotDePasseAdmin({}, motsDePasse()))).toBe("/admin/activer");
    expect(delta.passwordHash).toMatch(/^\$argon2id\$/);
    expect(delta.doitChangerMotDePasse).toBe(false);
    expect(etapeAcces(delta)).toBe("deux-fa");
    expect(faux.audits.map((a) => a.action)).toContain("admin.mot_de_passe_defini");

    // 2. Double authentification : secret provisoire rattaché à ce compte, activé par un premier code juste
    const secret = await lireReglage2fa(delta.id);
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    const mauvais = await activerDeuxFaAdmin({}, formulaire({ motDePasse: MOT_DE_PASSE, code: "000000" }));
    expect(mauvais.erreurs?.code).toBeDefined();
    expect(delta.totpActiveAt).toBeNull();

    // **Le mot de passe courant est exigé ici**, et pas seulement le code : c'est cette étape qui
    // rend la session forte. Sans elle, détenir le lien personnel d'un administrateur suffisait à
    // scanner le QR code avec son propre téléphone et à prendre sa place.
    const sansMotDePasse = await activerDeuxFaAdmin({}, formulaire({ code: codeTotp(secret!) }));
    expect(sansMotDePasse.erreurs?.motDePasse).toBeDefined();
    const mauvaisMotDePasse = await activerDeuxFaAdmin({}, formulaire({ motDePasse: "pas-le-bon-du-tout", code: codeTotp(secret!) }));
    expect(mauvaisMotDePasse.erreurs?.motDePasse).toBeDefined();
    expect(delta.totpActiveAt).toBeNull();

    expect(await redirectionDe(activerDeuxFaAdmin({}, formulaire({ motDePasse: MOT_DE_PASSE, code: codeTotp(secret!) })))).toBe("/admin/activer");
    expect(delta.totpSecret).not.toBeNull();
    expect(dechiffrer(delta.totpSecret!)).toBe(secret); // secret chiffré en base, jamais en clair
    expect(delta.totpActiveAt).toBeInstanceOf(Date);
    expect(await lireReglage2fa(delta.id)).toBeNull(); // le réglage provisoire est refermé

    // 3. Codes de secours : 8 codes hachés en base, affichés une seule fois
    const affichage = await lireAffichageCodes(delta.id);
    expect(affichage?.codes).toHaveLength(8);
    expect(JSON.parse(delta.codesSecours!)).toHaveLength(8);
    expect(delta.codesSecours).not.toContain(affichage!.codes[0]);
    expect(etapeAcces(delta, true)).toBe("codes-secours");

    // La session ouverte par lien est **élevée**, et toujours la sienne. Son échéance, elle, ne
    // bouge pas : depuis que l'espace admin vit dans un cookie d'élévation à part
    // (`src/lib/auth/elevation.ts`), ouvrir les réglages ne raccourcit plus la session de 60 jours
    // à 12 h — on ne met plus un administrateur dehors de toute l'application pour ça. Le plafond
    // de 12 h est porté par le cookie, l'échéance d'inactivité (10 min) par la session en base.
    expect(session.forte).toBe(true);
    expect(session.userId).toBe(delta.id);
    expect(session.reauthAt).toBeInstanceOf(Date);
    const jours = (session.expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(jours).toBeGreaterThan(59);

    // Fin du parcours : les codes notés, direction l'administration
    expect(await redirectionDe(confirmerCodesSecours("/admin"))).toBe("/admin");
    expect(await lireAffichageCodes(delta.id)).toBeNull();
    expect(etapeAcces(delta)).toBe("termine");
    expect(accesAdminRegle(delta)).toBe(true);

    const actions = faux.audits.map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["admin.mot_de_passe_defini", "admin.deux_fa_activee", "admin.codes_secours_generes"]));
    expect(faux.audits.every((a) => a.acteurId === delta.id)).toBe(true);
  });

  it("refuse l'étape 2 tant que l'étape 1 n'est pas faite", async () => {
    connecterParLien(delta.id);
    expect(await redirectionDe(preparerDeuxFaAdmin())).toBe("/admin/activer");
    expect(await lireReglage2fa(delta.id)).toBeNull(); // aucun secret n'a été préparé
    expect(await redirectionDe(activerDeuxFaAdmin({}, formulaire({ motDePasse: MOT_DE_PASSE, code: "123456" })))).toBe("/admin/activer");
    expect(delta.totpSecret).toBeNull();
    expect(delta.totpActiveAt).toBeNull();
  });

  it("ne rejoue pas l'étape 1 quand le mot de passe est déjà défini", async () => {
    connecterParLien(delta.id);
    await redirectionDe(definirMotDePasseAdmin({}, motsDePasse()));
    const hash = delta.passwordHash;
    expect(await redirectionDe(definirMotDePasseAdmin({}, motsDePasse("un-autre-mot-de-passe")))).toBe("/admin/activer");
    expect(delta.passwordHash).toBe(hash);
  });

  it("limite le débit du réglage comme celui de la connexion", async () => {
    connecterParLien(delta.id);
    let dernier = {} as { erreur?: string };
    for (let i = 0; i < 11; i++) dernier = await definirMotDePasseAdmin({}, motsDePasse("court"));
    expect(dernier.erreur).toContain("Trop de tentatives");
    expect(delta.passwordHash).toBeNull();
  });
});

/* ---------------------------------------------------------------- */
/* On ne règle jamais le compte d'un autre                           */
/* ---------------------------------------------------------------- */

describe("réglage du compte d'un autre", () => {
  it("ignore un réglage 2FA ouvert au nom de quelqu'un d'autre", async () => {
    connecterParLien(foxtrot.id);
    await redirectionDe(definirMotDePasseAdmin({}, motsDePasse()));
    const secretDeFoxtrot = (await lireReglage2fa(foxtrot.id))!;

    // Delta reprend l'appareil (le cookie de réglage de Foxtrot est encore là) : rien ne lui est
    // rattaché. Son mot de passe est un vrai haché : depuis que l'étape 2 l'exige, un faux
    // arrêterait le test avant le point qu'il veut vérifier — le secret provisoire d'autrui.
    const { hashPassword } = await import("@/lib/auth/password");
    delta.passwordHash = await hashPassword(MOT_DE_PASSE);
    faux.cookies = {};
    connecterParLien(delta.id);
    await ouvrirReglage2fa(foxtrot.id, secretDeFoxtrot);
    expect(await lireReglage2fa(delta.id)).toBeNull();
    expect(await redirectionDe(activerDeuxFaAdmin({}, formulaire({ motDePasse: MOT_DE_PASSE, code: codeTotp(secretDeFoxtrot) })))).toBe("/admin/activer?erreur=expire");
    expect(delta.totpSecret).toBeNull();
    expect(foxtrot.totpSecret).toBeNull();
  });

  it("n'affiche pas les codes de secours de quelqu'un d'autre", async () => {
    connecterParLien(foxtrot.id);
    await redirectionDe(definirMotDePasseAdmin({}, motsDePasse()));
    await redirectionDe(activerDeuxFaAdmin({}, formulaire({ motDePasse: MOT_DE_PASSE, code: codeTotp((await lireReglage2fa(foxtrot.id))!) })));
    expect((await lireAffichageCodes(foxtrot.id))?.codes).toHaveLength(8);
    expect(await lireAffichageCodes(delta.id)).toBeNull();
  });
});

/* ---------------------------------------------------------------- */
/* Connexion par mot de passe : avant / après le réglage             */
/* ---------------------------------------------------------------- */

describe("connexion sur /connexion", () => {
  it("est ouverte à tout compte actif qui a une adresse et un mot de passe", () => {
    expect(peutSeConnecterParMotDePasse(portail)).toBe(true);
    expect(peutSeConnecterParMotDePasse(delta)).toBe(false); // pas encore de mot de passe
    expect(peutSeConnecterParMotDePasse({ ...delta, passwordHash: "$argon2id$x" })).toBe(true);
    expect(peutSeConnecterParMotDePasse({ ...delta, passwordHash: "$argon2id$x", actif: false })).toBe(false);
    // Le changement : un membre ou un instructeur qui s'est donné un mot de passe entre aussi
    expect(peutSeConnecterParMotDePasse({ ...membre, passwordHash: "$argon2id$x" })).toBe(true);
    expect(peutSeConnecterParMotDePasse({ ...instructeur, passwordHash: "$argon2id$x" })).toBe(true);
    // …mais sans mot de passe, ou sans adresse (on se connecte *par* son adresse), la porte n'existe pas
    expect(peutSeConnecterParMotDePasse(membre)).toBe(false);
    expect(peutSeConnecterParMotDePasse({ ...membre, passwordHash: "$argon2id$x", email: null })).toBe(false);
  });

  it("n'exige le code que d'un administrateur, ou de qui a activé la double authentification", () => {
    // Le code est demandé **à qui l'a configuré**, et à personne d'autre — le rôle n'entre pas dans
    // cette règle-là. Un ADMIN qui n'a encore rien réglé se connecte donc au mot de passe comme un
    // membre ; ce qui lui reste fermé, c'est l'espace admin.
    expect(exigeDeuxFaConnexion(delta)).toBe(false);
    expect(exigeDeuxFaConnexion(portail)).toBe(true); // le compte du portail, lui, a sa 2FA en place
    expect(exigeDeuxFaConnexion(membre)).toBe(false);
    expect(exigeDeuxFaConnexion(instructeur)).toBe(false);
    expect(exigeDeuxFaConnexion({ ...instructeur, totpSecret: "chiffre", totpActiveAt: new Date() })).toBe(true);
  });

  it("refuse l'administrateur nominatif avant son réglage, l'accepte après", async () => {
    const identifiants = formulaire({ email: delta.email, motDePasse: MOT_DE_PASSE });
    const avant = await seConnecter({}, identifiants);
    expect(avant.erreur).toContain("Email ou mot de passe incorrect.");

    connecterParLien(delta.id);
    await redirectionDe(definirMotDePasseAdmin({}, motsDePasse()));
    await redirectionDe(activerDeuxFaAdmin({}, formulaire({ motDePasse: MOT_DE_PASSE, code: codeTotp((await lireReglage2fa(delta.id))!) })));
    // Il revient plus tard, sur un autre appareil : plus de session, plus de lien, juste ses identifiants
    faux.cookies = {};
    faux.sessions = [];

    // Même parcours que le compte du portail : mot de passe, puis code de l'application
    expect(await redirectionDe(seConnecter({}, formulaire({ email: delta.email, motDePasse: MOT_DE_PASSE })))).toBe("/connexion/code");
    const secret = dechiffrer(delta.totpSecret!)!;
    /*
     * **Le code du pas SUIVANT, et pas celui de l'activation**. Ce test présentait ici les mêmes
     * six chiffres qu'à l'activation, quelques lignes plus haut. Il passait, et c'était justement
     * le défaut : un code TOTP ne se consommait nulle part, donc il resservait. Depuis, chaque
     * porte retient le pas employé (`consommerCodeTotp`) et refuse tout pas inférieur ou égal —
     * l'activation comprise, parce que le pas appartient au compte et non au secret provisoire du
     * réglage. Ce scénario-ci reste ce qu'il a toujours voulu dire (« il revient plus tard, sur un
     * autre appareil ») ; il le dit maintenant avec un code que son application lui donnerait
     * vraiment plus tard. Le rejeu, lui, a son fichier : `tests/unit/totp-rejeu.test.ts`.
     */
    expect(await redirectionDe(verifierCode2fa({}, formulaire({ code: codeTotp(secret, Date.now(), 1) })))).toBe("/");

    /*
     * **Et la session obtenue est ordinaire**. Elle naissait « forte » ici même : se connecter au
     * mot de passe et au code ouvrait l'espace admin du même geste. Delta l'a signalé — « je viens
     * de me reconnecter et j'étais en admin » — et c'est la bonne lecture : l'élévation se prend
     * depuis « Mon profil », en redonnant les deux preuves, et c'est le seul endroit qui la donne
     * (voir `tests/unit/elevation-admin.test.ts`).
     */
    expect(faux.sessions.filter((s) => s.forte)).toHaveLength(0);
    expect(faux.sessions.map((s) => s.userId)).toEqual([delta.id]);
  });

  it("renvoie un compte sans mot de passe à son lien personnel, par un message générique", async () => {
    // Même message pour une adresse inconnue et pour un compte bien réel mais sans mot de passe :
    // aucune énumération de comptes, et l'issue est nommée (le lien reçu par email).
    const inconnu = await seConnecter({}, formulaire({ email: "personne@club.test", motDePasse: MOT_DE_PASSE }));
    const sansMotDePasse = await seConnecter({}, formulaire({ email: membre.email, motDePasse: MOT_DE_PASSE }));
    expect(sansMotDePasse.erreur).toBe(inconnu.erreur);
    expect(sansMotDePasse.erreur).toContain("lien personnel");
    expect(faux.cookies).toEqual({});
    expect(faux.sessions).toHaveLength(0);
  });

  it("connecte directement un membre à qui la double authentification a déjà été proposée", async () => {
    const { hashPassword } = await import("@/lib/auth/password");
    membre.passwordHash = await hashPassword(MOT_DE_PASSE);
    membre.deuxFaProposeeLe = new Date(); // « Plus tard » cliqué récemment : on ne lui repose pas la question

    expect(await redirectionDe(seConnecter({}, formulaire({ email: membre.email, motDePasse: MOT_DE_PASSE })))).toBe("/");
    expect(faux.sessions).toHaveLength(1);
    expect(faux.sessions[0].userId).toBe(membre.id);
    // Session ordinaire : la même que par lien personnel. Jamais forte.
    expect(faux.sessions[0].forte).toBe(false);
    expect(faux.cookies[SESSION_COOKIE]).toBeDefined();
  });

  it("demande son code au membre qui a activé la double authentification", async () => {
    const { hashPassword } = await import("@/lib/auth/password");
    const { chiffrer } = await import("@/lib/crypto");
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    membre.passwordHash = await hashPassword(MOT_DE_PASSE);
    membre.totpSecret = chiffrer(secret);
    membre.totpActiveAt = new Date();

    // Le mot de passe ne suffit plus : il faut passer par le second temps
    expect(await redirectionDe(seConnecter({}, formulaire({ email: membre.email, motDePasse: MOT_DE_PASSE })))).toBe("/connexion/code");
    expect(faux.sessions).toHaveLength(0);
    // Un code faux n'ouvre rien
    expect((await verifierCode2fa({}, formulaire({ code: "000000" }))).erreurs?.code).toBeDefined();
    expect(faux.sessions).toHaveLength(0);
    // Le bon code ouvre une session — ordinaire, toujours pas forte
    expect(await redirectionDe(verifierCode2fa({}, formulaire({ code: codeTotp(secret) })))).toBe("/");
    expect(faux.sessions).toHaveLength(1);
    expect(faux.sessions[0].forte).toBe(false);
  });

  it("laisse le compte du portail fonctionner comme avant", async () => {
    const { hashPassword } = await import("@/lib/auth/password");
    portail.passwordHash = await hashPassword(MOT_DE_PASSE);
    expect(await redirectionDe(seConnecter({}, formulaire({ email: portail.email, motDePasse: MOT_DE_PASSE })))).toBe("/connexion/code");
  });
});

/* ---------------------------------------------------------------- */
/* La double authentification proposée, jamais imposée (sauf ADMIN)  */
/* ---------------------------------------------------------------- */

describe("proposition de la double authentification", () => {
  it("ne la propose qu'à qui a un mot de passe, pas de 2FA, et pas déjà été sollicité ce trimestre", () => {
    expect(peutProposerDeuxFa(membre)).toBe(false); // pas de mot de passe : on n'arrive jamais là
    const avecMdp = { ...membre, passwordHash: "$argon2id$x" };
    expect(peutProposerDeuxFa(avecMdp)).toBe(true);
    expect(peutProposerDeuxFa({ ...avecMdp, actif: false })).toBe(false);
    // Déjà proposée il y a peu : on se tait
    expect(peutProposerDeuxFa({ ...avecMdp, deuxFaProposeeLe: new Date() })).toBe(false);
    // …mais on la repropose un trimestre plus tard
    expect(peutProposerDeuxFa({ ...avecMdp, deuxFaProposeeLe: new Date(Date.now() - DELAI_PROPOSITION_DEUX_FA_MS - 1) })).toBe(true);
    // Déjà active : il n'y a rien à proposer, il y a un code à saisir
    expect(peutProposerDeuxFa({ ...avecMdp, totpSecret: "chiffre", totpActiveAt: new Date() })).toBe(false);
    // Le rôle n'entre pas dans cette règle : un ADMIN qui n'a pas encore réglé la sienne se la
    // voit proposer comme tout le monde. Ce qui la lui **impose**, c'est son parcours
    // `/admin/activer`, et la porte de l'espace admin — pas un écran de connexion.
    expect(peutProposerDeuxFa({ ...delta, passwordHash: "$argon2id$x" })).toBe(true);
  });

  it("la propose au membre après son mot de passe, et « Plus tard » ouvre quand même la session", async () => {
    const { hashPassword } = await import("@/lib/auth/password");
    membre.passwordHash = await hashPassword(MOT_DE_PASSE);

    // Le mot de passe est accepté, mais on s'arrête pour proposer le second facteur
    expect(await redirectionDe(seConnecter({}, formulaire({ email: membre.email, motDePasse: MOT_DE_PASSE })))).toBe("/connexion/code");
    expect(faux.sessions).toHaveLength(0);

    // « Plus tard » : la session s'ouvre, rien n'est configuré, et la date est notée
    expect(await redirectionDe(passerDeuxFa())).toBe("/");
    expect(faux.sessions).toHaveLength(1);
    expect(faux.sessions[0].userId).toBe(membre.id);
    expect(faux.sessions[0].forte).toBe(false);
    expect(membre.totpActiveAt).toBeNull();
    expect(membre.deuxFaProposeeLe).toBeInstanceOf(Date);
    expect(faux.audits.map((a) => a.action)).toContain("deux_fa.proposition_reportee");

    // La fois suivante, on ne lui repose pas la question : session directe
    faux.cookies = {};
    faux.sessions = [];
    expect(await redirectionDe(seConnecter({}, formulaire({ email: membre.email, motDePasse: MOT_DE_PASSE })))).toBe("/");
    expect(faux.sessions).toHaveLength(1);
  });

  it("l'accepte : le membre active sa 2FA au vol, et repart avec une session ordinaire", async () => {
    const { hashPassword } = await import("@/lib/auth/password");
    membre.passwordHash = await hashPassword(MOT_DE_PASSE);
    await redirectionDe(seConnecter({}, formulaire({ email: membre.email, motDePasse: MOT_DE_PASSE })));

    const attente = await (await import("@/lib/auth/deux-fa")).lireAttente2fa();
    const secret = attente!.secretProvisoire!;
    // Les codes de secours passent en premier, comme pour un administrateur
    expect(await redirectionDe(verifierCode2fa({}, formulaire({ code: codeTotp(secret) })))).toBe("/connexion/codes-secours");
    expect(membre.totpActiveAt).toBeInstanceOf(Date);
    expect(JSON.parse(membre.codesSecours!)).toHaveLength(8);
    // Activer un second facteur n'élève rien : la session reste ordinaire
    expect(faux.sessions).toHaveLength(1);
    expect(faux.sessions[0].forte).toBe(false);
  });

  /** Le garde-fou : « Plus tard » ne doit jamais devenir la porte dérobée de l'administration. */
  /**
   * **Un administrateur se connecte à l'application comme tout le monde** : la 2FA lui est proposée
   * s'il ne l'a pas, et « Plus tard » lui ouvre la session comme à un membre. Ce qui reste fermé,
   * c'est l'espace admin — qui redemande, lui, mot de passe **et** code sur `/connexion/admin`, et
   * n'accepte aucun « plus tard ».
   */
  it("laisse un administrateur entrer au mot de passe, et refuse le code à qui l'a configuré", async () => {
    const { hashPassword } = await import("@/lib/auth/password");
    delta.passwordHash = await hashPassword(MOT_DE_PASSE);

    // Pas de 2FA configurée : elle est proposée, et « Plus tard » ouvre bien la session — mais
    // comme son accès administrateur n'est pas réglé, il est déposé sur son parcours obligatoire
    // au lieu de l'accueil. La session, elle, est bien ouverte : ce n'est pas un refus d'entrer.
    expect(await redirectionDe(seConnecter({}, formulaire({ email: delta.email, motDePasse: MOT_DE_PASSE })))).toBe("/connexion/code");
    expect(await redirectionDe(passerDeuxFa())).toBe("/admin/activer");
    expect(faux.sessions).toHaveLength(1);
    // Session **ordinaire** : entrer dans l'application n'ouvre aucun réglage
    expect(faux.sessions[0].forte).toBe(false);
    expect(delta.deuxFaProposeeLe).toBeInstanceOf(Date);

    // 2FA configurée : le code est exigé, et « Plus tard » ne fonctionne plus — pour lui comme
    // pour n'importe qui d'autre l'ayant activée.
    const { chiffrer } = await import("@/lib/crypto");
    delta.totpSecret = chiffrer("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    delta.totpActiveAt = new Date();
    expect(await redirectionDe(seConnecter({}, formulaire({ email: delta.email, motDePasse: MOT_DE_PASSE })))).toBe("/connexion/code");
    expect(await redirectionDe(passerDeuxFa())).toBe("/connexion/code");
  });
});

/* ---------------------------------------------------------------- */
/* Un jeton d'un autre usage n'ouvre pas de session                  */
/* ---------------------------------------------------------------- */

/**
 * **Le jeton d'une famille ne vaut pas la session d'une autre.**
 *
 * Un seul secret (`SESSION_SECRET`) signe tout ce que l'application frappe : un lecteur qui se
 * contenterait de vérifier la signature et de lire les champs qui l'intéressent accepterait donc
 * **n'importe quel** jeton de même forme — et certains dorment en clair dans le pied d'un email, pour
 * un an. C'est la raison d'être de l'usage écrit dans la charge signée (`USAGES_JETON`,
 * `src/lib/auth/tokens.ts`).
 *
 * Ce test ne vérifie pas la primitive — `tests/unit/tokens.test.ts` croise les usages deux à deux. Il
 * vérifie **l'issue**, bout en bout : un jeton d'une autre famille présenté au cookie d'attente 2FA
 * n'ouvre aucune session. Un futur lecteur qui oublierait de nommer son usage rendrait ce test rouge.
 *
 * (La relecture de sécurité qui a motivé ce garde-fou est racontée dans `docs/ETAT.md`, qui ne quitte
 * pas ce dépôt.)
 */
describe("un jeton signé d'un autre usage", () => {
  it("ne se fait pas passer pour le cookie d'attente 2FA (jeton de désinscription)", async () => {
    const { hashPassword } = await import("@/lib/auth/password");
    membre.passwordHash = await hashPassword(MOT_DE_PASSE);

    // Le jeton tel qu'il part dans le pied de l'email de rappel de Chloé, pas un jeton fabriqué :
    // c'est la fonction de production qui le frappe, avec le secret de production.
    const { jetonDesinscription } = await import("@/lib/notifications/desinscription");
    faux.cookies[DEUX_FA_COOKIE] = jetonDesinscription(membre.id);

    // Le cookie ne se lit même pas : ce n'est pas « périmé » ni « mal formé », c'est un autre usage.
    expect(await (await import("@/lib/auth/deux-fa")).lireAttente2fa()).toBeNull();
    // Et l'issue qui compte : aucune session n'est ouverte au nom de Chloé.
    expect(await redirectionDe(passerDeuxFa())).toBe("/connexion?erreur=session");
    expect(faux.sessions).toHaveLength(0);
    expect(faux.cookies[SESSION_COOKIE]).toBeUndefined();

    // Le jeton reste valable **pour ce qu'il est** : couper ses rappels, et rien d'autre.
    const { lireJetonDesinscription } = await import("@/lib/notifications/desinscription");
    expect(lireJetonDesinscription(jetonDesinscription(membre.id))).toBe(membre.id);
  });

  /** Dans l'autre sens, et sur les deux autres cookies : la portée se vérifie partout, pas au seul endroit trouvé. */
  it("ne se fait pas passer pour le cookie des codes de secours ni pour celui du réglage 2FA", async () => {
    const secret = process.env.SESSION_SECRET!;
    const charge = { uid: membre.id, exp: Date.now() + 60_000, codes: "", suite: "/", secret: "" };

    faux.cookies["hema_codes"] = signPayload(charge, secret, "attente-2fa");
    expect(await lireAffichageCodes(membre.id)).toBeNull();

    faux.cookies["hema_activation"] = signPayload(charge, secret, "desinscription");
    expect(await lireReglage2fa(membre.id)).toBeNull();
  });
});

/* ---------------------------------------------------------------- */
/* La session forte ne se distribue pas : elle tient au bureau       */
/* ---------------------------------------------------------------- */

describe("session forte et administration technique", () => {
  it("ne la donne qu'au bureau (estAdmin), jamais à un instructeur ni à un membre", () => {
    const equipe = { totpSecret: "chiffre", totpActiveAt: new Date(), passwordHash: "$argon2id$x" };
    expect(peutOuvrirSessionForte({ ...delta, ...equipe })).toBe(true);
    expect(peutOuvrirSessionForte({ ...delta, ...equipe, actif: false })).toBe(false);
    // Tout l'équipement du monde n'en fait pas un administrateur
    expect(peutOuvrirSessionForte({ ...instructeur, ...equipe })).toBe(false);
    expect(peutOuvrirSessionForte({ ...membre, ...equipe })).toBe(false);
    /*
     * **Et le rôle n'y donne plus rien** : `delta` porte `role: "INSTRUCTEUR"`, c'est `estAdmin`
     * qui l'élève. Lui retirer le supplément doit refermer la porte, quel que soit son rôle — sans
     * cette ligne, une garde revenue sur `role` passerait inaperçue ici.
     */
    expect(peutOuvrirSessionForte({ ...delta, ...equipe, estAdmin: false })).toBe(false);
    expect(peutOuvrirSessionForte({ ...instructeur, ...equipe, estAdmin: true })).toBe(true);
  });

  /**
   * Le test que Delta a demandé noir sur blanc : un instructeur équipé d'un mot de passe **et**
   * d'une double authentification se connecte normalement… et l'administration technique lui reste
   * fermée, à la porte (`/admin/parametres`, via `settings.technical`) comme aux actions.
   */
  it("refuse l'administration technique à un instructeur muni d'un mot de passe et d'une 2FA", async () => {
    const { hashPassword } = await import("@/lib/auth/password");
    const { chiffrer } = await import("@/lib/crypto");
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    instructeur.passwordHash = await hashPassword(MOT_DE_PASSE);
    instructeur.totpSecret = chiffrer(secret);
    instructeur.totpActiveAt = new Date();

    // Connexion complète : mot de passe, puis code juste
    expect(await redirectionDe(seConnecter({}, formulaire({ email: instructeur.email, motDePasse: MOT_DE_PASSE })))).toBe("/connexion/code");
    expect(await redirectionDe(verifierCode2fa({}, formulaire({ code: codeTotp(secret) })))).toBe("/");

    // Sa session existe, elle est à lui… et elle n'est pas forte
    expect(faux.sessions).toHaveLength(1);
    expect(faux.sessions[0].userId).toBe(instructeur.id);
    expect(faux.sessions[0].forte).toBe(false);

    // La page /admin/parametres et les actions techniques passent toutes par cette garde
    await expect(assertPermission("settings.technical")).rejects.toBeInstanceOf(AccesRefuse);
    await expect(assertPermission("admins.manage")).rejects.toBeInstanceOf(AccesRefuse);
    await expect(assertPermission("audit.view")).rejects.toBeInstanceOf(AccesRefuse);
    await expect(assertPermission("auth_sessions.revoke")).rejects.toBeInstanceOf(AccesRefuse);
    // …alors que ses droits d'encadrement, eux, fonctionnent comme avant
    await expect(assertPermission("sessions.manage")).resolves.toMatchObject({ id: instructeur.id });
  });

  it("n'ouvre aucune session à un administrateur qui n'a pas donné son code", async () => {
    const { hashPassword } = await import("@/lib/auth/password");
    delta.passwordHash = await hashPassword(MOT_DE_PASSE);
    // Pas de 2FA configurée : le mot de passe ne l'exempte pas, il l'envoie sur la configuration guidée
    expect(await redirectionDe(seConnecter({}, formulaire({ email: delta.email, motDePasse: MOT_DE_PASSE })))).toBe("/connexion/code");
    expect(faux.sessions).toHaveLength(0);
    expect(faux.cookies[SESSION_COOKIE]).toBeUndefined();

    // Même une 2FA déjà active ne raccourcit rien : sans code, pas de session
    const { chiffrer } = await import("@/lib/crypto");
    delta.totpSecret = chiffrer("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    delta.totpActiveAt = new Date();
    expect(await redirectionDe(seConnecter({}, formulaire({ email: delta.email, motDePasse: MOT_DE_PASSE })))).toBe("/connexion/code");
    expect((await verifierCode2fa({}, formulaire({ code: "000000" }))).erreurs?.code).toBeDefined();
    expect(faux.sessions).toHaveLength(0);
  });
});

/* ---------------------------------------------------------------- */
/* Lecture de l'état du compte                                       */
/* ---------------------------------------------------------------- */

describe("état du réglage", () => {
  it("reprend le parcours là où il s'est arrêté", async () => {
    expect(etapeAcces(delta)).toBe("mot-de-passe");
    delta.passwordHash = "$argon2id$x";
    expect(etapeAcces(delta)).toBe("deux-fa");
    // Mot de passe provisoire (compte créé par le bureau) : l'étape 1 reste à faire
    expect(etapeAcces({ ...delta, doitChangerMotDePasse: true })).toBe("mot-de-passe");
    delta.totpSecret = "chiffre";
    delta.totpActiveAt = new Date();
    expect(etapeAcces(delta)).toBe("termine");
    expect(etapeAcces(delta, true)).toBe("codes-secours");
    expect((await compteAcces(delta.id))?.email).toBe(delta.email);
  });
});
