import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Accès administrateur compte par compte (/admin/activer), **et** mot de passe facultatif pour
 * tous.
 *
 * Ce que ce fichier verrouille :
 * - qui règle un accès fort (membre du bureau actif avec une adresse, compte du portail compris) et
 *   qui ne le règle pas (membre, instructeur, bureau sans adresse) ;
 * - **l'obligation** : un membre du bureau non réglé est déposé sur `/admin/activer` après la
 *   connexion, et ramené sur ce parcours par `requireUser` ; ses server actions sont refusées ;
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
  /** Chemin de la requête, tel que le middleware le pose dans `x-chemin`. */
  chemin: null as string | null,
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
  headers: async () => new Headers({ "user-agent": "vitest", ...(faux.chemin ? { "x-chemin": faux.chemin } : {}) }),
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

const authActions = await import("@/actions/auth");
const { definirMotDePasseAdmin, activerDeuxFaAdmin, preparerDeuxFaAdmin, confirmerCodesSecours, seConnecter } = authActions;
const {
  accesAdminRegle,
  cheminLibrePendantReglage,
  compteAcces,
  etapeAcces,
  lireReglage2fa,
  ouvrirReglage2fa,
  peutOuvrirSessionForte,
  peutReglerSonAcces,
  peutSeConnecterParMotDePasse,
  reglageAccesDu,
} = await import("@/lib/auth/acces-admin");
const { AccesRefuse, assertPermission, getCurrentUser, requireUser } = await import("@/lib/auth/current-user");
const { lireAffichageCodes } = await import("@/lib/auth/deux-fa");
const { emettreCodeActivation } = await import("@/lib/auth/activation-bureau");
const { formaterCodeActivation } = await import("@/lib/auth/code-activation");

/**
 * **Code d'activation remis par un autre membre du bureau** (étape 2 des comptes nominatifs). Rendu
 * sous sa forme affichée (`K7P-42M`) : la saisie tolère le tiret, c'est ce que la personne recopie.
 */
async function codeActivationPour(compte: { id: string }): Promise<string> {
  return formaterCodeActivation((await emettreCodeActivation(compte.id)).code);
}
const { codeTotp } = await import("@/lib/auth/totp");
const { chiffrer, dechiffrer } = await import("@/lib/crypto");

/** Secret TOTP du compte du portail : une vraie valeur base32, chiffrée comme en production. */
const SECRET_PORTAIL = "JBSWY3DPEHPK3PXP";
const { generateToken, hashToken, signPayload } = await import("@/lib/auth/tokens");
const { utiliserMagasinMemoire } = await import("@/lib/auth/rate-limit");
const { SESSION_COOKIE } = await import("@/lib/constants");

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
  faux.chemin = null;
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
  it("l'autorise à un membre du bureau actif avec une adresse, compte du portail compris", () => {
    expect(peutReglerSonAcces(delta)).toBe(true);
    expect(peutReglerSonAcces(portail)).toBe(true);
    expect(peutReglerSonAcces(instructeur)).toBe(false);
    expect(peutReglerSonAcces(membre)).toBe(false);
    expect(peutReglerSonAcces({ ...delta, actif: false })).toBe(false);
    // Sans adresse, la connexion par mot de passe n'existe pas : rien à régler
    expect(peutReglerSonAcces({ ...delta, email: null })).toBe(false);
    expect(peutReglerSonAcces(null)).toBe(false);
  });

  /**
   * **La règle unique de l'obligation** (`reglageAccesDu`) : bureau actif, avec une adresse, accès
   * pas encore réglé (mot de passe + 2FA). Le compte du portail y est soumis comme les autres.
   */
  it("oblige au réglage le bureau non réglé, et lui seul", () => {
    expect(reglageAccesDu(delta)).toBe(true);
    expect(reglageAccesDu({ ...delta, passwordHash: "$argon2id$x" })).toBe(true); // 2FA manquante
    expect(reglageAccesDu({ ...delta, passwordHash: "$argon2id$x", totpSecret: "chiffre", totpActiveAt: new Date() })).toBe(false);
    expect(reglageAccesDu(portail)).toBe(false); // réglé
    expect(reglageAccesDu({ ...portail, totpSecret: null, totpActiveAt: null })).toBe(true);
    expect(reglageAccesDu({ ...portail, doitChangerMotDePasse: true })).toBe(true);
    // Membres et instructeurs : jamais, même sans rien
    expect(reglageAccesDu(membre)).toBe(false);
    expect(reglageAccesDu(instructeur)).toBe(false);
    // Bureau sans adresse : pas d'obligation (il ne pourrait pas la terminer) ; compte désactivé non plus
    expect(reglageAccesDu({ ...delta, email: null })).toBe(false);
    expect(reglageAccesDu({ ...delta, actif: false })).toBe(false);
    expect(reglageAccesDu(null)).toBe(false);
  });

  it("laisse ouverts le parcours, la bienvenue, le mot de passe provisoire et les codes, rien d'autre", () => {
    expect(cheminLibrePendantReglage("/admin/activer")).toBe(true);
    expect(cheminLibrePendantReglage("/admin/activer?erreur=expire")).toBe(true);
    expect(cheminLibrePendantReglage("/bienvenue?suite=%2Fadmin%2Factiver")).toBe(true);
    expect(cheminLibrePendantReglage("/nouveau-mot-de-passe")).toBe(true);
    expect(cheminLibrePendantReglage("/connexion/codes-secours")).toBe(true);
    expect(cheminLibrePendantReglage("/")).toBe(false);
    expect(cheminLibrePendantReglage("/planning")).toBe(false);
    expect(cheminLibrePendantReglage("/profil#securite")).toBe(false);
    expect(cheminLibrePendantReglage("/admin")).toBe(false);
    expect(cheminLibrePendantReglage("/admin/activer-tout")).toBe(false);
    expect(cheminLibrePendantReglage("/connexion/admin")).toBe(false);
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

  it("ne rejoue rien sur le compte du portail déjà réglé", async () => {
    connecterParLien(portail.id);
    expect(await redirectionDe(definirMotDePasseAdmin({}, motsDePasse()))).toBe("/admin/activer");
    expect(await redirectionDe(preparerDeuxFaAdmin())).toBe("/admin/activer");
    expect(portail.passwordHash).toBe("$argon2id$factice");
    expect(dechiffrer(portail.totpSecret!)).toBe(SECRET_PORTAIL);
  });

  /**
   * **Le compte du portail fait le parcours comme tout le bureau** : son étape 1 est déjà faite (il
   * a choisi son mot de passe sur `/nouveau-mot-de-passe`), il commence donc à la double
   * authentification.
   */
  it("mène le compte du portail sans 2FA de l'étape 2 à la session forte", async () => {
    const { hashPassword } = await import("@/lib/auth/password");
    portail.passwordHash = await hashPassword(MOT_DE_PASSE);
    portail.totpSecret = null;
    portail.totpActiveAt = null;
    const session = connecterParLien(portail.id);
    expect(etapeAcces(portail)).toBe("deux-fa");
    // L'étape 1 ne se rejoue pas : le mot de passe ne change pas par ici
    const hash = portail.passwordHash;
    expect(await redirectionDe(definirMotDePasseAdmin({}, motsDePasse("un-autre-mot-de-passe")))).toBe("/admin/activer");
    expect(portail.passwordHash).toBe(hash);

    expect(await redirectionDe(preparerDeuxFaAdmin())).toBe("/admin/activer");
    const secret = await lireReglage2fa(portail.id);
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(await redirectionDe(activerDeuxFaAdmin({}, formulaire({ motDePasse: MOT_DE_PASSE, code: codeTotp(secret!) })))).toBe("/admin/activer");
    expect(portail.totpActiveAt).toBeInstanceOf(Date);
    expect((await lireAffichageCodes(portail.id))?.codes).toHaveLength(8);
    expect(session.forte).toBe(true);
    expect(accesAdminRegle(portail)).toBe(true);
    expect(reglageAccesDu(portail)).toBe(false);
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
    // Le code d'activation remis de vive voix par un autre membre du bureau (voir plus bas, sans lui)
    const codeActivation = await codeActivationPour(delta);
    const mauvais = await activerDeuxFaAdmin({}, formulaire({ motDePasse: MOT_DE_PASSE, codeActivation, code: "000000" }));
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

    // **Sans code d'activation, rien ne s'active** — même avec le bon mot de passe et le bon code TOTP
    const sansCodeActivation = await activerDeuxFaAdmin({}, formulaire({ motDePasse: MOT_DE_PASSE, code: codeTotp(secret!) }));
    expect(sansCodeActivation.erreurs?.codeActivation).toBeDefined();
    expect(sansCodeActivation.erreur).toContain("Demande un code d'activation à un membre du bureau");
    expect(delta.totpActiveAt).toBeNull();

    expect(await redirectionDe(activerDeuxFaAdmin({}, formulaire({ motDePasse: MOT_DE_PASSE, codeActivation, code: codeTotp(secret!) })))).toBe("/admin/activer");
    expect((delta as unknown as { codeActivationHash: string | null }).codeActivationHash).toBeNull(); // consommé
    expect(faux.audits.map((a) => a.action)).toContain("deux_fa.code_activation_utilise");
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
    await redirectionDe(activerDeuxFaAdmin({}, formulaire({ motDePasse: MOT_DE_PASSE, codeActivation: await codeActivationPour(foxtrot), code: codeTotp((await lireReglage2fa(foxtrot.id))!) })));
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

  it("refuse l'administrateur nominatif avant son réglage, l'accepte après", async () => {
    const identifiants = formulaire({ email: delta.email, motDePasse: MOT_DE_PASSE });
    const avant = await seConnecter({}, identifiants);
    expect(avant.erreur).toContain("Email ou mot de passe incorrect.");

    connecterParLien(delta.id);
    await redirectionDe(definirMotDePasseAdmin({}, motsDePasse()));
    await redirectionDe(activerDeuxFaAdmin({}, formulaire({ motDePasse: MOT_DE_PASSE, codeActivation: await codeActivationPour(delta), code: codeTotp((await lireReglage2fa(delta.id))!) })));
    // Il revient plus tard, sur un autre appareil : plus de session, plus de lien, juste ses identifiants
    faux.cookies = {};
    faux.sessions = [];

    // Le mot de passe suffit pour entrer dans l'application : aucun code ici, 2FA réglée ou non
    expect(await redirectionDe(seConnecter({}, formulaire({ email: delta.email, motDePasse: MOT_DE_PASSE })))).toBe("/");
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

  it("connecte un membre au mot de passe seul, sans rien lui proposer", async () => {
    const { hashPassword } = await import("@/lib/auth/password");
    membre.passwordHash = await hashPassword(MOT_DE_PASSE);

    expect(await redirectionDe(seConnecter({}, formulaire({ email: membre.email, motDePasse: MOT_DE_PASSE })))).toBe("/");
    expect(faux.sessions).toHaveLength(1);
    expect(faux.sessions[0].userId).toBe(membre.id);
    // Session ordinaire : la même que par lien personnel. Jamais forte.
    expect(faux.sessions[0].forte).toBe(false);
    expect(faux.cookies[SESSION_COOKIE]).toBeDefined();
  });

  it("ne demande pas de code au membre qui avait activé la double authentification", async () => {
    const { hashPassword } = await import("@/lib/auth/password");
    membre.passwordHash = await hashPassword(MOT_DE_PASSE);
    membre.totpSecret = chiffrer("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    membre.totpActiveAt = new Date();

    expect(await redirectionDe(seConnecter({}, formulaire({ email: membre.email, motDePasse: MOT_DE_PASSE })))).toBe("/");
    expect(faux.sessions).toHaveLength(1);
    expect(faux.sessions[0].forte).toBe(false);
  });

  it("connecte le compte du portail réglé au mot de passe seul, sans code et sans ouvrir l'espace admin", async () => {
    const { hashPassword } = await import("@/lib/auth/password");
    portail.passwordHash = await hashPassword(MOT_DE_PASSE);
    expect(await redirectionDe(seConnecter({}, formulaire({ email: portail.email, motDePasse: MOT_DE_PASSE, suite: "/ateliers/proposer" })))).toBe("/ateliers/proposer");
    expect(faux.sessions.filter((s) => s.forte)).toHaveLength(0);
  });

  it("dépose le compte du portail sans 2FA sur son réglage obligatoire", async () => {
    const { hashPassword } = await import("@/lib/auth/password");
    portail.passwordHash = await hashPassword(MOT_DE_PASSE);
    portail.totpSecret = null;
    portail.totpActiveAt = null;
    expect(await redirectionDe(seConnecter({}, formulaire({ email: portail.email, motDePasse: MOT_DE_PASSE, suite: "/planning" })))).toBe("/admin/activer");
    expect(faux.sessions).toHaveLength(1);
    expect(faux.sessions[0].forte).toBe(false);
  });

  /**
   * **Un membre du bureau non réglé ne va pas où il voulait aller** : le parcours `/admin/activer`
   * passe avant, dès la connexion (Delta : « oblige le setup […] à la connexion »). La session reste
   * ordinaire ; c'est la fin du parcours qui l'élève.
   */
  it("dépose un administrateur non réglé sur /admin/activer, quelle que soit la page demandée", async () => {
    const { hashPassword } = await import("@/lib/auth/password");
    delta.passwordHash = await hashPassword(MOT_DE_PASSE);
    expect(await redirectionDe(seConnecter({}, formulaire({ email: delta.email, motDePasse: MOT_DE_PASSE, suite: "/planning" })))).toBe("/admin/activer");
    expect(faux.sessions).toHaveLength(1);
    expect(faux.sessions[0].forte).toBe(false);
  });

  it("ouvre la page demandée à un administrateur réglé, sans code", async () => {
    const { hashPassword } = await import("@/lib/auth/password");
    delta.passwordHash = await hashPassword(MOT_DE_PASSE);
    delta.totpSecret = chiffrer("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    delta.totpActiveAt = new Date();
    expect(await redirectionDe(seConnecter({}, formulaire({ email: delta.email, motDePasse: MOT_DE_PASSE, suite: "/ateliers/proposer" })))).toBe("/ateliers/proposer");
  });

  it("n'envoie jamais un membre ni un instructeur sur le réglage", async () => {
    const { hashPassword } = await import("@/lib/auth/password");
    membre.passwordHash = await hashPassword(MOT_DE_PASSE);
    instructeur.passwordHash = await hashPassword(MOT_DE_PASSE);
    expect(await redirectionDe(seConnecter({}, formulaire({ email: membre.email, motDePasse: MOT_DE_PASSE, suite: "/ateliers/proposer" })))).toBe("/ateliers/proposer");
    expect(await redirectionDe(seConnecter({}, formulaire({ email: instructeur.email, motDePasse: MOT_DE_PASSE, suite: "/ateliers/proposer" })))).toBe("/ateliers/proposer");
  });
});

/* ---------------------------------------------------------------- */
/* L'obligation tient aussi aux écrans et aux actions                */
/* ---------------------------------------------------------------- */

/**
 * **« Si je passe un user en bureau, à la prochaine connexion oblige le setup »** : la personne a
 * peut-être déjà une session ouverte. Le drapeau `reglageAccesDu` est relu à chaque requête sur la
 * ligne du compte ; `requireUser` (toutes les pages) la renvoie sur le parcours, `assertPermission`
 * (les server actions) la refuse.
 */
describe("obligation de réglage pour une session déjà ouverte", () => {
  it("renvoie sur /admin/activer depuis tout écran, sauf ceux du parcours", async () => {
    connecterParLien(delta.id);
    expect((await getCurrentUser())?.reglageAccesDu).toBe(true);
    for (const chemin of ["/", "/planning", "/profil", "/admin"]) {
      faux.chemin = chemin;
      expect(await redirectionDe(requireUser())).toBe("/admin/activer");
    }
    for (const chemin of ["/admin/activer", "/admin/activer?erreur=expire", "/bienvenue?suite=%2Fadmin%2Factiver", "/nouveau-mot-de-passe"]) {
      faux.chemin = chemin;
      await expect(requireUser()).resolves.toMatchObject({ id: delta.id });
    }
  });

  it("rattrape un membre nommé au bureau en cours de session", async () => {
    connecterParLien(membre.id);
    faux.chemin = "/planning";
    await expect(requireUser()).resolves.toMatchObject({ id: membre.id });
    // Nommé au bureau entre deux requêtes : la requête suivante relit la ligne du compte
    membre.estAdmin = true;
    expect(await redirectionDe(requireUser())).toBe("/admin/activer");
  });

  it("refuse les server actions tant que le réglage est dû, et les rend une fois réglé", async () => {
    connecterParLien(delta.id);
    await expect(assertPermission("sessions.manage")).rejects.toBeInstanceOf(AccesRefuse);
    delta.passwordHash = "$argon2id$x";
    delta.totpSecret = chiffrer("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    delta.totpActiveAt = new Date();
    await expect(assertPermission("sessions.manage")).resolves.toMatchObject({ id: delta.id });
  });

  it("ne gêne ni un membre ni un instructeur", async () => {
    connecterParLien(instructeur.id);
    faux.chemin = "/planning";
    await expect(requireUser()).resolves.toMatchObject({ id: instructeur.id });
    await expect(assertPermission("sessions.manage")).resolves.toMatchObject({ id: instructeur.id });
  });
});

/* ---------------------------------------------------------------- */
/* La double authentification ne s'active que pour le bureau        */
/* ---------------------------------------------------------------- */

describe("double authentification : une seule porte d'activation", () => {
  /*
   * « Mon profil » n'active plus de double authentification : elle se règle par le parcours
   * `/admin/activer`, réservé au bureau, et se gère ensuite dans l'espace admin. Les deux actions du
   * profil ont disparu — un module `"use server"` qui les exporterait encore serait une route ouverte.
   */
  it("n'expose plus d'activation depuis le profil", () => {
    expect("preparerMaDeuxFa" in authActions).toBe(false);
    expect("activerMaDeuxFa" in authActions).toBe(false);
  });

  it("refuse le parcours d'activation à un membre, même muni d'un secret glissé à la main", async () => {
    const { hashPassword } = await import("@/lib/auth/password");
    membre.passwordHash = await hashPassword(MOT_DE_PASSE);
    connecterParLien(membre.id);
    expect(await redirectionDe(preparerDeuxFaAdmin())).toBe("/?acces=refuse");
    expect(await lireReglage2fa(membre.id)).toBeNull();
    await ouvrirReglage2fa(membre.id, "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(await redirectionDe(activerDeuxFaAdmin({}, formulaire({ motDePasse: MOT_DE_PASSE, code: codeTotp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ") })))).toBe("/?acces=refuse");
    expect(membre.totpActiveAt).toBeNull();
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
 * vérifie **l'issue** : un jeton d'une autre famille présenté aux cookies de parcours ne se lit pas.
 * Un futur lecteur qui oublierait de nommer son usage rendrait ce test rouge.
 *
 * (La relecture de sécurité qui a motivé ce garde-fou est racontée dans `docs/ETAT.md`, qui ne quitte
 * pas ce dépôt.)
 */
describe("un jeton signé d'un autre usage", () => {
  /** Sur les deux cookies de parcours : la portée se vérifie partout, pas au seul endroit trouvé. */
  it("ne se fait pas passer pour le cookie des codes de secours ni pour celui du réglage 2FA", async () => {
    const secret = process.env.SESSION_SECRET!;
    const charge = { uid: membre.id, exp: Date.now() + 60_000, codes: "", suite: "/", secret: "" };

    faux.cookies["hema_codes"] = signPayload(charge, secret, "elevation");
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

    // Connexion au mot de passe (aucun code n'est demandé pour entrer)
    expect(await redirectionDe(seConnecter({}, formulaire({ email: instructeur.email, motDePasse: MOT_DE_PASSE })))).toBe("/");

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

  it("n'ouvre jamais de session forte par la connexion, même à un administrateur réglé", async () => {
    const { hashPassword } = await import("@/lib/auth/password");
    delta.passwordHash = await hashPassword(MOT_DE_PASSE);
    delta.totpSecret = chiffrer("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    delta.totpActiveAt = new Date();
    expect(await redirectionDe(seConnecter({}, formulaire({ email: delta.email, motDePasse: MOT_DE_PASSE })))).toBe("/");
    expect(faux.sessions).toHaveLength(1);
    expect(faux.sessions[0].forte).toBe(false);
    // L'espace admin reste fermé : il faut l'élévation (mot de passe + code sur /connexion/admin)
    await expect(assertPermission("settings.technical")).rejects.toBeInstanceOf(AccesRefuse);
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

/* ---------------------------------------------------------------- */
/* Code d'activation à l'étape 2 (remis hors bande)                  */
/* ---------------------------------------------------------------- */

/**
 * **Le trou que le code ferme** : quiconque tient la boîte email ou le lien personnel d'un membre du
 * bureau pas encore réglé choisit le mot de passe à l'étape 1 — il ne lui manquait plus que de
 * scanner le QR code avec **son** téléphone. Le code d'activation, remis de vive voix par un autre
 * membre du bureau, ne passe jamais par l'email : sans lui, l'étape 2 n'active rien.
 */
describe("code d'activation exigé à l'étape 2", () => {
  /** Delta à l'étape 2 : session par lien, mot de passe choisi, QR code prêt. */
  async function deltaALEtape2(): Promise<{ secret: string; session: FauxSession }> {
    const session = connecterParLien(delta.id);
    await redirectionDe(definirMotDePasseAdmin({}, motsDePasse()));
    return { secret: (await lireReglage2fa(delta.id))!, session };
  }
  const activer = (champs: Record<string, string>) => activerDeuxFaAdmin({}, formulaire({ motDePasse: MOT_DE_PASSE, ...champs }));
  const enBase = (compte: FauxCompte) => compte as unknown as { codeActivationHash: string | null; codeActivationExpireLe: Date | null };

  it("refuse sans code, avec un message qui dit qui le donne, et n'active rien", async () => {
    const { secret, session } = await deltaALEtape2();
    const res = await activer({ code: codeTotp(secret) });
    expect(res.erreur).toContain("Aucun code d'activation n'est en cours");
    expect(res.erreur).toContain("Demande un code d'activation à un membre du bureau : il le génère dans Comptes admin");
    expect(delta.totpActiveAt).toBeNull();
    expect(session.forte).toBe(false);
  });

  it("refuse un code faux sans le consommer : le bon passe ensuite", async () => {
    const { secret } = await deltaALEtape2();
    const bon = await codeActivationPour(delta);
    const faux2 = bon.startsWith("A") ? "BBB-BBB" : "AAA-AAA";
    const res = await activer({ codeActivation: faux2, code: codeTotp(secret) });
    expect(res.erreurs?.codeActivation).toBe("Code d'activation incorrect.");
    expect(delta.totpActiveAt).toBeNull();
    expect(enBase(delta).codeActivationHash).not.toBeNull();
    expect(await redirectionDe(activer({ codeActivation: bon, code: codeTotp(secret) }))).toBe("/admin/activer");
    expect(delta.totpActiveAt).toBeInstanceOf(Date);
  });

  it("tolère la casse, les espaces et l'absence de tiret à la saisie", async () => {
    const { secret } = await deltaALEtape2();
    const bon = await codeActivationPour(delta);
    const saisie = ` ${bon.replace("-", " ").toLowerCase()} `;
    expect(await redirectionDe(activer({ codeActivation: saisie, code: codeTotp(secret) }))).toBe("/admin/activer");
    expect(delta.totpActiveAt).toBeInstanceOf(Date);
  });

  it("refuse un code expiré (48 h)", async () => {
    const { secret } = await deltaALEtape2();
    const bon = await codeActivationPour(delta);
    enBase(delta).codeActivationExpireLe = new Date(Date.now() - 1000);
    const res = await activer({ codeActivation: bon, code: codeTotp(secret) });
    expect(res.erreurs?.codeActivation).toContain("expiré");
    expect(delta.totpActiveAt).toBeNull();
  });

  it("un nouveau code invalide le précédent", async () => {
    const { secret } = await deltaALEtape2();
    const ancien = await codeActivationPour(delta);
    const nouveau = await codeActivationPour(delta);
    expect((await activer({ codeActivation: ancien, code: codeTotp(secret) })).erreurs?.codeActivation).toBeDefined();
    expect(await redirectionDe(activer({ codeActivation: nouveau, code: codeTotp(secret) }))).toBe("/admin/activer");
  });

  it("ne sert qu'une fois : après usage il n'existe plus, même si la 2FA est à refaire", async () => {
    const { secret } = await deltaALEtape2();
    const bon = await codeActivationPour(delta);
    expect(await redirectionDe(activer({ codeActivation: bon, code: codeTotp(secret) }))).toBe("/admin/activer");
    expect(enBase(delta).codeActivationHash).toBeNull();
    expect(enBase(delta).codeActivationExpireLe).toBeNull();
    // Sa 2FA est remise à zéro sans nouveau code : l'ancien ne rouvre rien
    delta.totpSecret = null;
    delta.totpActiveAt = null;
    await redirectionDe(preparerDeuxFaAdmin());
    const res = await activer({ codeActivation: bon, code: codeTotp((await lireReglage2fa(delta.id))!) });
    expect(res.erreurs?.codeActivation).toBeDefined();
    expect(delta.totpActiveAt).toBeNull();
  });

  it("un code ne vaut que pour la personne à qui il a été donné", async () => {
    const codeDeFoxtrot = await codeActivationPour(foxtrot);
    const { secret } = await deltaALEtape2();
    expect((await activer({ codeActivation: codeDeFoxtrot, code: codeTotp(secret) })).erreurs?.codeActivation).toBeDefined();
    expect(delta.totpActiveAt).toBeNull();
  });

  it("le compte du portail en est exempté : personne d'autre que lui ne touche à sa 2FA", async () => {
    const { hashPassword } = await import("@/lib/auth/password");
    portail.passwordHash = await hashPassword(MOT_DE_PASSE);
    portail.totpSecret = null;
    portail.totpActiveAt = null;
    connecterParLien(portail.id);
    await redirectionDe(preparerDeuxFaAdmin());
    expect(await redirectionDe(activer({ code: codeTotp((await lireReglage2fa(portail.id))!) }))).toBe("/admin/activer");
    expect(portail.totpActiveAt).toBeInstanceOf(Date);
  });

  it("la réinitialisation faite par soi-même exige aussi un code d'activation", async () => {
    const { secret } = await deltaALEtape2();
    // Ce que pose `reinitialiserMaDeuxFa` : un réglage en cours, sans aucune dispense
    await ouvrirReglage2fa(delta.id, secret);
    expect((await activer({ code: codeTotp(secret) })).erreur).toMatch(/code d'activation/);
    expect(delta.totpActiveAt).toBeNull();
  });

  /*
   * **Le calcul qui rend le code impossible à deviner** : 31⁶ ≈ 8,9 × 10⁸ codes, et chaque essai
   * passe par le limiteur `totp_user` (8 par quart d'heure et par compte). Sur les 48 h de validité :
   * 8 × 4 × 48 = 1 536 essais au plus, soit une chance sur ~578 000.
   */
  it("compte chaque essai au limiteur : au 9e dans le quart d'heure, plus rien n'est vérifié", async () => {
    const { RATE_LIMITS } = await import("@/lib/auth/rate-limit");
    const { ALPHABET_CODE_ACTIVATION, LONGUEUR_CODE_ACTIVATION, DUREE_CODE_ACTIVATION_MS } = await import("@/lib/auth/code-activation");
    const { secret } = await deltaALEtape2();
    const bon = await codeActivationPour(delta);
    const faux2 = bon.startsWith("A") ? "BBB-BBB" : "AAA-AAA";
    for (let i = 0; i < RATE_LIMITS.totp_user.max; i++) {
      expect((await activer({ codeActivation: faux2, code: codeTotp(secret) })).erreurs?.codeActivation).toBeDefined();
    }
    // Même le bon code est refusé : le plafond est atteint
    expect((await activer({ codeActivation: bon, code: codeTotp(secret) })).erreur).toBe("Trop de tentatives. Réessaie dans quelques minutes.");
    expect(delta.totpActiveAt).toBeNull();

    const essaisSurLaValidite = RATE_LIMITS.totp_user.max * (DUREE_CODE_ACTIVATION_MS / RATE_LIMITS.totp_user.windowMs);
    const espace = ALPHABET_CODE_ACTIVATION.length ** LONGUEUR_CODE_ACTIVATION;
    expect(essaisSurLaValidite).toBe(1536);
    expect(espace).toBe(887_503_681);
    expect(essaisSurLaValidite / espace).toBeLessThan(2e-6);
  });

  it("journalise l'usage du code", async () => {
    const { secret } = await deltaALEtape2();
    const bon = await codeActivationPour(delta);
    await redirectionDe(activer({ codeActivation: bon, code: codeTotp(secret) }));
    expect(faux.audits.map((a) => a.action)).toContain("deux_fa.code_activation_utilise");
  });
});
