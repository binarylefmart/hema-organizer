import { beforeEach, describe, expect, it, vi } from "vitest";
import { compteRendu } from "@/lib/accueil";

/**
 * Compte rendu de l'écran d'accueil.
 *
 * L'accueil porte deux vues derrière une bascule — le club (par défaut) et soi —, et une
 * troisième, « Admin », **réservée au bureau** (`settings.technical`). Les deux premières sont
 * toujours renseignées ensemble et sans requête de plus ; la troisième n'est calculée que si la
 * permission est vérifiée côté serveur, et vaut `null` sinon. C'est l'invariant de sécurité
 * documenté dans `docs/ETAT.md` : rien n'est envoyé au navigateur puis masqué en CSS, d'où les
 * tests qui vérifient à la fois le `null` et l'absence de la requête qui l'alimenterait.
 *
 * La base n'est jamais touchée : `@/lib/db` est remplacé par un faux client qui applique les
 * quelques filtres dont se sert le code (dates, statut, invitation) et **journalise ses appels** —
 * l'accueil étant l'écran le plus ouvert de l'application, le nombre de requêtes fait partie du
 * contrat, au même titre que les chiffres affichés.
 */

const MAINTENANT = new Date("2026-09-22T12:00:00Z");
/**
 * Le seuil d'effectif du club, celui qui est livré. Il **arrive en argument** : `compteRendu` ne lit
 * aucun réglage — c'est ce qui permet de l'éprouver ici sans table `Setting` ni identité en base.
 */
const SEUIL = 4;
/**
 * Date de création du compte des personnes de ces tests : **huit mois** avant `MAINTENANT`.
 *
 * C'est de là que sort `moi.ancienneteMois`, et donc le rang —, les rangs se gagnent à l'ancienneté
 * au club et non plus aux présences du trimestre. Huit mois placent une « Élève » entre deux seuils
 * (6 et 12), ce qui est le cas le plus instructif : ni le tout début de l'échelle, ni son sommet.
 */
const INSCRITE_DEPUIS = new Date("2026-01-22T12:00:00Z");
const MOI = { id: "u-moi", prenom: "Chloé", nom: "Arnaud", role: "MEMBRE", estAdmin: false, service: false, actif: true };
const INSTRU = { id: "u-instru", prenom: "Echo", nom: "Blanc", role: "INSTRUCTEUR", estAdmin: false, service: false, actif: true };
/**
 * **Un administrateur porte un rôle de base et le supplément** : `role: "ADMIN"` n'existe plus en
 * base. On écrit donc ce que la migration a écrit — membre du club, et du bureau.
 */
const ADMIN = { id: "u-admin", prenom: "Delta", nom: "Roy", role: "MEMBRE", estAdmin: true, service: false, actif: true };

type LignePeriode = { id: string; nom: string; statut: string; dateDebut: string; dateFin: string };
type LigneSeance = { id: string; periodId: string; date: string; heureDebut: string; annulee: boolean };
type Personne = { id: string; prenom: string; nom: string };

const faux = vi.hoisted(() => ({
  periodes: [] as Array<{ id: string; nom: string; statut: string; dateDebut: string; dateFin: string }>,
  /** Invitations : qui est convié sur quelle période, et depuis quand (`PeriodMember.addedAt`) */
  invites: [] as Array<{ periodId: string; addedAt: Date; user: { id: string; prenom: string; nom: string; couleur: number | null } }>,
  seances: [] as Array<{ id: string; periodId: string; date: string; heureDebut: string; annulee: boolean }>,
  presences: [] as Array<{ userId: string; sessionId: string; statut: string }>,
  evenements: [] as Array<Record<string, unknown>>,
  ateliersProposes: 0,
  /** Ateliers proposés par la personne connectée, toutes périodes confondues */
  mesAteliers: 0,
  /** Liens d'accès encore dormants : les personnes qui ne sont jamais entrées */
  liensJamaisOuverts: [] as Personne[],
  appels: [] as string[],
}));

/** Une séance telle que Prisma la rendrait avec l'`include` des cartes (cf. src/lib/seances.ts). */
function carteBrute(s: LigneSeance) {
  const periode = faux.periodes.find((p) => p.id === s.periodId);
  return {
    id: s.id,
    periodId: s.periodId,
    date: s.date,
    heureDebut: s.heureDebut,
    heureFin: "22:00",
    lieu: "Gymnase municipal",
    adresse: "",
    disciplines: "",
    theme: "Messer",
    alternative: "",
    annulee: s.annulee,
    motifAnnulation: s.annulee ? "Salle indisponible" : null,
    period: { nom: periode?.nom ?? "" },
    instructeurs: [],
    parties: [],
    ateliers: [],
    attendances: faux.presences.filter((a) => a.sessionId === s.id).map((a) => ({ userId: a.userId, statut: a.statut })),
  };
}

/** Tri « date puis heure de début », comme l'`orderBy` de la requête. */
function parDate(a: LigneSeance, b: LigneSeance): number {
  return `${a.date} ${a.heureDebut}`.localeCompare(`${b.date} ${b.heureDebut}`);
}

function estInvite(periodId: string, userId: string): boolean {
  return faux.invites.some((i) => i.periodId === periodId && i.user.id === userId);
}

/** Les filtres de période effectivement émis par src/lib/accueil.ts. */
function periodeRetenue(p: LignePeriode, where: Record<string, unknown>): boolean {
  const statut = where.statut as string | { not: string } | undefined;
  if (typeof statut === "string" && p.statut !== statut) return false;
  if (statut && typeof statut === "object" && p.statut === statut.not) return false;
  const dateFin = where.dateFin as { gte?: string } | undefined;
  if (dateFin?.gte && p.dateFin < dateFin.gte) return false;
  const membres = where.membres as { some: { userId: string } } | undefined;
  if (membres && !estInvite(p.id, membres.some.userId)) return false;
  return true;
}

/** Séances visées par un agrégat : soit une liste d'identifiants, soit toute une période. */
function seancesVisees(where: Record<string, unknown>): string[] {
  const parId = where.sessionId as { in: string[] } | undefined;
  if (parId) return parId.in;
  const periode = (where.session as { periodId: string } | undefined)?.periodId;
  return faux.seances.filter((s) => s.periodId === periode).map((s) => s.id);
}

vi.mock("@/lib/db", () => ({
  db: {
    // La liste des thèmes du club (teinte d'un élément) : le réglage n'est jamais enregistré ici.
    setting: { findUnique: vi.fn(async () => null) },
    period: {
      findFirst: vi.fn(async ({ where, orderBy }: { where: Record<string, unknown>; orderBy: { dateDebut: "asc" | "desc" } }) => {
        faux.appels.push("period.findFirst");
        const retenues = faux.periodes.filter((p) => periodeRetenue(p, where));
        retenues.sort((a, b) => (orderBy.dateDebut === "asc" ? 1 : -1) * a.dateDebut.localeCompare(b.dateDebut));
        const p = retenues[0];
        return p ? { id: p.id, nom: p.nom, dateDebut: p.dateDebut, dateFin: p.dateFin } : null;
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        faux.appels.push("period.findUnique");
        const p = faux.periodes.find((x) => x.id === where.id);
        if (!p) return null;
        return {
          id: p.id,
          nom: p.nom,
          statut: p.statut,
          // `addedAt` est bien dans le `select` de `statsPeriode` : c'est lui qui borne le
          // dénominateur personnel, et donc le « jamais venu » que l'accueil en déduit.
          membres: faux.invites
            .filter((i) => i.periodId === p.id)
            .map((i) => ({ addedAt: i.addedAt, user: { id: i.user.id, prenom: i.user.prenom, nom: i.user.nom } })),
          sessions: faux.seances
            .filter((s) => s.periodId === p.id)
            .sort(parDate)
            .map((s) => ({ id: s.id, date: s.date, heureDebut: s.heureDebut, theme: "Messer", annulee: s.annulee })),
        };
      }),
    },
    /*
     * Un seul appelant : les cartes (src/lib/seances.ts), qui lisent les invités de **plusieurs**
     * périodes pour nommer les participants. L'accueil a eu un temps sa propre lecture des dates
     * d'arrivée, sous l'étiquette `periodMember.findMany(arrivees)` ; elle a été retirée, le
     * nombre de cours de chacun étant déjà compté par `statsPeriode`. La forme `periodId: string`
     * n'est donc plus attendue — si elle revenait, elle sortirait du contrat de requêtes.
     */
    periodMember: {
      findMany: vi.fn(async ({ where }: { where: { periodId: { in: string[] } } }) => {
        faux.appels.push("periodMember.findMany");
        const ids = where.periodId.in;
        return faux.invites.filter((i) => ids.includes(i.periodId)).map((i) => ({ periodId: i.periodId, user: i.user }));
      }),
    },
    session: {
      findMany: vi.fn(async ({ where }: { where: { date: { gte: string }; period: { membres?: { some: { userId: string } } } } }) => {
        faux.appels.push("session.findMany");
        const invite = where.period.membres?.some.userId;
        return faux.seances
          .filter((s) => s.date >= where.date.gte)
          .filter((s) => faux.periodes.find((p) => p.id === s.periodId)?.statut === "ACTIVE")
          .filter((s) => !invite || estInvite(s.periodId, invite))
          .sort(parDate)
          .map(carteBrute);
      }),
    },
    attendance: {
      /**
       * **Ses présences depuis son arrivée**, toutes périodes confondues : la lecture ajoutée pour
       * les blasons de l'horizon « La saison ». Un `count` sur une seule personne, qui ne rapporte
       * aucune colonne — le faux client applique les trois filtres émis (elle, les « Présent », les
       * cours passés et non annulés), pour qu'un test échoue si le code venait à compter les cours
       * à venir ou les annulés.
       */
      count: vi.fn(
        async ({
          where,
        }: {
          where: { userId: string; statut: string; session: { annulee: boolean; OR: [{ date: { lt: string } }, { date: string; heureDebut: { lte: string } }] } };
        }) => {
          faux.appels.push("attendance.count(moi)");
          // La frontière posée en SQL est celle de `seanceCommencee` : la veille, ou aujourd'hui
          // une fois l'heure de début atteinte. Le faux client l'applique telle quelle, pour qu'un
          // retour à « avant aujourd'hui » fasse échouer le test du soir de cours.
          const [avant, dujour] = where.session.OR;
          const tenues = new Set(
            faux.seances
              .filter((s) => s.annulee === where.session.annulee)
              .filter((s) => s.date < avant.date.lt || (s.date === dujour.date && s.heureDebut <= dujour.heureDebut.lte))
              .map((s) => s.id),
          );
          return faux.presences.filter((a) => a.userId === where.userId && a.statut === where.statut && tenues.has(a.sessionId)).length;
        },
      ),
      /**
       * Les deux agrégats du tableau de bord. Le faux client applique **aussi les cohortes
       * d'arrivée** (`OR`) que `statsPeriode` émet sur l'agrégat par membre : sans elles, `m.presents`
       * compterait ici les cours d'avant l'inscription de quelqu'un, et aucun test ne pourrait plus
       * distinguer un compteur borné d'un compteur qui ne l'est pas — c'est-à-dire ce qui sépare la
       * tuile « Jamais venus » de la tuile « Décrochages ».
       */
      groupBy: vi.fn(async ({ by, where }: { by: string[]; where: Record<string, unknown> }) => {
        faux.appels.push("attendance.groupBy");
        const vises = seancesVisees(where);
        const cohortes = where.OR as Array<{ userId: { in: string[] }; session?: { date: { gte: string } } }> | undefined;
        const dateDe = new Map(faux.seances.map((s) => [s.id, s.date] as const));
        const totaux = new Map<string, number>();
        for (const a of faux.presences) {
          if (!vises.includes(a.sessionId)) continue;
          if (cohortes && !cohortes.some((c) => c.userId.in.includes(a.userId) && (!c.session || (dateDe.get(a.sessionId) ?? "") >= c.session.date.gte))) continue;
          const cle = `${by[0] === "sessionId" ? a.sessionId : a.userId}|${a.statut}`;
          totaux.set(cle, (totaux.get(cle) ?? 0) + 1);
        }
        return [...totaux].map(([cle, n]) => {
          const [id, statut] = cle.split("|");
          return { ...(by[0] === "sessionId" ? { sessionId: id } : { userId: id }), statut, _count: { _all: n } };
        });
      }),
      /**
       * Les présences ligne à ligne du trimestre — la seule lecture de l'accueil qui ne soit pas
       * un agrégat, et elle sert **deux** appels très différents :
       * - sans `userId`, celles de tout le club, réservées au bureau (série, décrochages) ;
       * - avec `userId`, les siennes, pour tout le monde (`moi.serie`).
       *
       * D'où les deux étiquettes distinctes dans le journal : sans elles, un test ne pourrait plus
       * vérifier qu'un membre ne déclenche **pas** la lecture nominative du club. Le faux client
       * applique tous les filtres émis et ne rend que les colonnes du `select`, pour que le test
       * échoue si le code en réclamait davantage.
       */
      findMany: vi.fn(
        async ({ where, select }: { where: { userId?: string; statut: string; session: { periodId: string } }; select: { userId?: boolean; sessionId?: boolean } }) => {
          faux.appels.push(where.userId ? "attendance.findMany(moi)" : "attendance.findMany");
          const dePeriode = new Set(faux.seances.filter((s) => s.periodId === where.session.periodId).map((s) => s.id));
          return faux.presences
            .filter((a) => a.statut === where.statut && dePeriode.has(a.sessionId) && (where.userId === undefined || a.userId === where.userId))
            .map((a) => ({ ...(select.userId ? { userId: a.userId } : {}), ...(select.sessionId ? { sessionId: a.sessionId } : {}) }));
        },
      ),
    },
    evenement: {
      findMany: vi.fn(async ({ where }: { where: { publie?: boolean } }) => {
        faux.appels.push("evenement.findMany");
        return faux.evenements.filter((e) => where.publie === undefined || e.publie === where.publie);
      }),
    },
    atelier: {
      // Deux comptages, deux publics : la file des propositions à trancher (bureau, `statut`) et
      // le nombre d'ateliers qu'on a soi-même proposés (tout le monde, `proposeParId`). Étiquetés
      // séparément pour la même raison que les présences ci-dessus.
      count: vi.fn(async ({ where }: { where: { statut?: string; proposeParId?: string } }) => {
        faux.appels.push(where.proposeParId ? "atelier.count(moi)" : "atelier.count");
        return where.proposeParId ? faux.mesAteliers : faux.ateliersProposes;
      }),
    },
    /*
     * Liens d'accès jamais ouverts : lus pour le bureau seulement (voir le contrat de requêtes).
     *
     * **Un `findMany`, là où c'était un `count`** : le bureau a besoin de *qui* n'est jamais
     * entré, et personne d'autre sur la page ne nomme ces gens-là (ils ne figurent dans aucune
     * liste de présence, puisqu'ils ne sont jamais venus). Le faux client ne rend que les colonnes
     * du `select`, pour que le test échoue si le code en réclamait davantage — et le journal ne
     * compte toujours qu'**une** requête, ce que vérifie le contrat plus bas.
     */
    invitation: {
      findMany: vi.fn(async ({ select }: { select: { user: { select: Record<string, boolean> } } }) => {
        faux.appels.push("invitation.findMany");
        expect(Object.keys(select.user.select).sort()).toEqual(["nom", "prenom"]);
        return faux.liensJamaisOuverts.map((p) => ({ user: { prenom: p.prenom, nom: p.nom } }));
      }),
    },
  },
}));

// Chargé par src/lib/evenements.ts ; le compte rendu passe toujours la personne explicitement,
// donc cette lecture de session n'est jamais sollicitée.
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: vi.fn(async () => null) }));

/**
 * Utilisateur au format attendu par `compteRendu`.
 *
 * `sessionForte` compte désormais autant que le rôle : le bloc de pilotage n'est calculé que pour
 * un administrateur **connecté en tant qu'administrateur** (élévation en cours). Un membre du bureau
 * entré par son lien personnel n'y a pas droit — c'est le cas couvert par le garde-fou plus bas. La valeur
 * par défaut suit donc le rôle, et se force à `false` pour éprouver ce cas-là.
 */
function commeConnecte(
  u: Personne & { role: string; estAdmin?: boolean; actif: boolean },
  // Le bureau se lit sur `estAdmin` : `role` ne vaut plus jamais « ADMIN ».
  sessionForte = u.estAdmin === true,
  createdAt: Date = INSCRITE_DEPUIS,
  // Date d'adhésion saisie par le bureau (« Au club depuis ») : elle prime sur la création du
  // compte pour l'ancienneté, et `null` — le cas de tout le monde — rend la main à `createdAt`.
  auClubDepuis: Date | null = null,
) {
  return { ...u, estAdmin: u.estAdmin === true, service: false, email: null, rappelEmail: true, theme: "hema", createdAt, auClubDepuis, sessionId: "sess", sessionForte, elevationRetombee: false, elevationOuverteLe: null, reauthAt: null };
}

/**
 * Date d'arrivée par défaut : bien avant toute séance de ces tests. C'est le cas ordinaire — tout
 * le monde est là depuis l'ouverture du trimestre —, et il laisse `inviterLe` porter le cas qui
 * nous intéresse : celui qui arrive en cours de route.
 */
const DEPUIS_TOUJOURS = new Date("2020-01-01T00:00:00Z");

function inviter(periodId: string, ...gens: Personne[]) {
  for (const g of gens) faux.invites.push({ periodId, addedAt: DEPUIS_TOUJOURS, user: { ...g, couleur: null } });
}

/** Le même, avec une date d'inscription : quelqu'un qui rejoint le trimestre en cours de route. */
function inviterLe(periodId: string, addedAt: Date, ...gens: Personne[]) {
  for (const g of gens) faux.invites.push({ periodId, addedAt, user: { ...g, couleur: null } });
}

function seance(id: string, date: string, annulee = false): LigneSeance {
  return { id, periodId: "p-auto", date, heureDebut: "20:00", annulee };
}

beforeEach(() => {
  faux.periodes = [];
  faux.invites = [];
  faux.seances = [];
  faux.presences = [];
  faux.evenements = [];
  faux.ateliersProposes = 0;
  faux.mesAteliers = 0;
  faux.liensJamaisOuverts = [];
  faux.appels = [];
});

/** Le trimestre en cours : 3 séances passées (dont une annulée), 3 à venir (dont une annulée). */
function trimestreEnCours() {
  faux.periodes.push({ id: "p-auto", nom: "T4 2026", statut: "ACTIVE", dateDebut: "2026-09-01", dateFin: "2026-12-20" });
  inviter("p-auto", MOI, { id: "u-charlie", prenom: "Charlie", nom: "Bernard" }, { id: "u-alice", prenom: "Alice", nom: "Colin" });
  faux.seances.push(
    seance("s1", "2026-09-08"),
    seance("s2", "2026-09-15"),
    seance("s3", "2026-09-18", true),
    seance("s4", "2026-09-29"),
    seance("s5", "2026-10-06", true),
    seance("s6", "2026-10-13"),
  );
  // s1 : 3 présents sur 3 invités (100 %) ; s2 : 1 présent, 1 absent (33 %) → moyenne 67 %
  for (const userId of [MOI.id, "u-charlie", "u-alice"]) faux.presences.push({ userId, sessionId: "s1", statut: "PRESENT" });
  faux.presences.push({ userId: "u-charlie", sessionId: "s2", statut: "PRESENT" });
  faux.presences.push({ userId: MOI.id, sessionId: "s2", statut: "ABSENT" });
  // Réponses sur les séances à venir : présente sur s4, rien sur s5 (annulée) ni sur s6
  faux.presences.push({ userId: MOI.id, sessionId: "s4", statut: "PRESENT" });
}


/**
 * Un trimestre taillé pour les indicateurs de pilotage : sept invités, six cours passés sur deux
 * créneaux (mardi et jeudi), une salle qui se vide de moitié à mi-parcours, trois habitués qui
 * s'arrêtent, une inscrite jamais venue, et cinq cours encore à venir dont trois manqueront de
 * monde — le dernier volontairement au-delà des quatre cartes mises en avant.
 */
function trimestreDePilotage() {
  faux.periodes.push({ id: "p-auto", nom: "T4 2026", statut: "ACTIVE", dateDebut: "2026-09-01", dateFin: "2026-12-20" });
  const charlie = { id: "u-charlie", prenom: "Charlie", nom: "Bernard" };
  const alice = { id: "u-alice", prenom: "Alice", nom: "Colin" };
  const dorian = { id: "u-dorian", prenom: "Dorian", nom: "Faure" };
  const elsa = { id: "u-elsa", prenom: "Elsa", nom: "Garnier" };
  const hugo = { id: "u-hugo", prenom: "Hugo", nom: "Petit" };
  const inga = { id: "u-inga", prenom: "Inga", nom: "Vidal" };
  inviter("p-auto", MOI, charlie, alice, dorian, elsa, hugo, inga);
  // Six cours passés : un mardi et un jeudi par semaine, trois semaines de suite
  faux.seances.push(
    seance("p1", "2026-09-01"),
    seance("p2", "2026-09-03"),
    seance("p3", "2026-09-08"),
    seance("p4", "2026-09-10"),
    seance("p5", "2026-09-15"),
    seance("p6", "2026-09-17"),
  );
  // Cinq cours à venir, dont un annulé ; f5 tombe hors des quatre cartes de la frise
  faux.seances.push(
    seance("f1", "2026-09-29"),
    seance("f2", "2026-10-01"),
    seance("f3", "2026-10-06"),
    seance("f4", "2026-10-08", true),
    seance("f5", "2026-10-13"),
  );
  const presents = (sessionId: string, ...gens: Personne[]) => {
    for (const g of gens) faux.presences.push({ userId: g.id, sessionId, statut: "PRESENT" });
  };
  // Les trois premiers cours font le plein (6 sur 7), les trois suivants tombent à 3 : la première
  // moitié du trimestre à 6 de moyenne, la seconde à 3.
  for (const id of ["p1", "p2", "p3"]) presents(id, MOI, charlie, alice, dorian, elsa, hugo);
  for (const id of ["p4", "p5", "p6"]) presents(id, MOI, charlie, alice);
  // À venir : f1 se remplit, f2 n'a qu'une réponse, f3 et f5 aucune
  presents("f1", MOI, charlie, alice, dorian, elsa);
  presents("f2", MOI);
}

describe("compte rendu d'accueil", () => {
  it("résume la période en cours du club : avancement du trimestre", async () => {
    trimestreEnCours();
    const cr = await compteRendu(commeConnecte(MOI), SEUIL, MAINTENANT);
    expect(cr.periode).toEqual({ id: "p-auto", nom: "T4 2026", dateDebut: "2026-09-01", dateFin: "2026-12-20", invites: 3 });
    // Les séances annulées ne comptent ni dans le réalisé ni dans le total : 2 faites sur 4 prévues
    expect(cr.seancesPassees).toBe(2);
    expect(cr.seancesTotal).toBe(4);
  });

  it("donne à un membre de quoi s'organiser : le club et lui, prêts pour la bascule", async () => {
    trimestreEnCours();
    const cr = await compteRendu(commeConnecte(MOI), SEUIL, MAINTENANT);
    // Prochaine séance non annulée (s4) : 1 « Présent » annoncé sur 3 invités, et le taux du
    // trimestre en repère — il est public, c'est lui qui donne son sens au « ma présence » d'à côté.
    expect(cr.groupe).toEqual({ invites: 3, presentsProchaine: 1, tauxMoyen: 67, presencesTotales: 4 });
    // Présente à s1, absente à s2 : 1 présence sur 2 séances ; s6 attend encore sa réponse
    // Présente à s1, absente à s2 : une seule présence, donc un record (`serie`) de 1 — et une
    // série **en cours** nulle, puisque le dernier cours tenu a été manqué. Mais deux réponses
    // données, et c'est ce chiffre-là qui récompense d'avoir répondu plutôt que d'être venue.
    // Aucun atelier proposé pour l'instant.
    expect(cr.moi).toEqual({ presences: 1, seancesPassees: 2, pourcentage: 50, sansReponse: 1, serie: 1, serieEnCours: 0, reponses: 2, ateliersProposes: 0, ancienneteMois: 12, presencesToutesSaisons: 1, joursDeCours: [] });
    // Le pilotage de la période, lui, ne le concerne pas
    expect(cr.admin).toBeNull();
  });

  it("compte comme « sans réponse » les séances à venir où la personne est invitée et n'a rien répondu", async () => {
    trimestreEnCours();
    const cr = await compteRendu(commeConnecte(MOI), SEUIL, MAINTENANT);
    // s4 : répondu ; s5 : annulée, on n'attend rien ; s6 : c'est la seule réponse attendue
    expect(cr.moi.sansReponse).toBe(1);
  });

  it("compte toutes les séances encore à venir dans la période", async () => {
    trimestreEnCours();
    const cr = await compteRendu(commeConnecte(MOI), SEUIL, MAINTENANT);
    // s4, s5 (annulée) et s6 restent à venir
    expect(cr.aVenir).toBe(3);
  });

  it("met en avant les quatre séances les plus proches, la plus proche d'abord, annulation comprise", async () => {
    trimestreEnCours();
    faux.seances.push(seance("s7", "2026-10-20"), seance("s8", "2026-10-22"));
    const cr = await compteRendu(commeConnecte(MOI), SEUIL, MAINTENANT);
    // Quatre, c'est le format de la frise des prochains cours : une colonne par séance
    expect(cr.prochaines.map((s) => s.id)).toEqual(["s4", "s5", "s6", "s7"]);
    expect(cr.prochaines[1].annulee).toBe(true);
    // La séance que l'affichage laisse de côté reste comptée dans le total à venir
    expect(cr.aVenir).toBe(5);
  });

  it("porte sur chaque prochaine séance de quoi s'organiser : le compte des présents et qui vient", async () => {
    trimestreEnCours();
    const cr = await compteRendu(commeConnecte(MOI), SEUIL, MAINTENANT);
    const prochaine = cr.prochaines[0];
    // Le grand chiffre de la carte (BarreTaux) et la liste nominative repliée en dessous
    expect(prochaine.compteurs.presents).toBe(1);
    expect(prochaine.compteurs.invites).toBe(3);
    expect(prochaine.participants.presents.map((p) => p.id)).toEqual([MOI.id]);
    expect(prochaine.participants.sansReponse).toHaveLength(2);
  });

  it("annonce un prochain cours dont personne n'a encore parlé, sans se tromper de zéro", async () => {
    faux.periodes.push({ id: "p-auto", nom: "T4 2026", statut: "ACTIVE", dateDebut: "2026-09-01", dateFin: "2026-12-20" });
    inviter("p-auto", MOI, { id: "u-charlie", prenom: "Charlie", nom: "Bernard" }, { id: "u-alice", prenom: "Alice", nom: "Colin" });
    faux.seances.push(seance("s4", "2026-09-29"));
    const cr = await compteRendu(commeConnecte(MOI), SEUIL, MAINTENANT);
    // Aucune réponse : personne d'annoncé, tout le monde attendu
    expect(cr.groupe.presentsProchaine).toBe(0);
    expect(cr.prochaines[0].compteurs.enAttente).toBe(3);
  });

  it("répond proprement à une personne sans aucune période, sans rien inventer", async () => {
    const cr = await compteRendu(commeConnecte(MOI), SEUIL, MAINTENANT);
    expect(cr.periode).toBeNull();
    expect(cr.prochaines).toEqual([]);
    expect(cr.aVenir).toBe(0);
    expect(cr.seancesPassees).toBe(0);
    expect(cr.seancesTotal).toBe(0);
    expect(cr.groupe).toEqual({ invites: 0, presentsProchaine: 0, tauxMoyen: 0, presencesTotales: 0 });
    expect(cr.moi).toEqual({ presences: 0, seancesPassees: 0, pourcentage: 0, sansReponse: 0, serie: 0, serieEnCours: 0, reponses: 0, ateliersProposes: 0, ancienneteMois: 12, presencesToutesSaisons: 0, joursDeCours: [] });
    expect(cr.evenement).toBeNull();
    expect(cr.admin).toBeNull();
  });

  it("affiche des zéros sur une période dont aucune séance n'a eu lieu (jamais de division par zéro)", async () => {
    faux.periodes.push({ id: "p-auto", nom: "T1 2027", statut: "ACTIVE", dateDebut: "2026-09-01", dateFin: "2026-12-20" });
    inviter("p-auto", MOI);
    faux.seances.push(seance("s1", "2026-09-29"), seance("s2", "2026-10-06"));
    const cr = await compteRendu(commeConnecte(ADMIN), SEUIL, MAINTENANT);
    expect(cr.seancesPassees).toBe(0);
    // Aucune séance passée : la moyenne de participation vaut 0, et surtout pas NaN
    expect(cr.admin?.participationMoyenne).toBe(0);
    // Personne n'a encore eu l'occasion de venir : personne ne décroche non plus
    expect(cr.admin?.jamaisVenus).toBe(0);
    expect(cr.moi.pourcentage).toBe(0);
    expect(Number.isFinite(cr.admin?.tauxReponse)).toBe(true);
    expect(Number.isFinite(cr.admin?.participationMoyenne)).toBe(true);
    expect(Number.isFinite(cr.moi.pourcentage)).toBe(true);
    // Deux séances à venir, aucune réponse : la seule invitée est encore attendue sur les deux,
    // le taux de réponse est donc à zéro et elle compte pour une personne restée muette.
    expect(cr.aVenir).toBe(2);
    expect(cr.admin?.invitesSansReponse).toBe(2);
    expect(cr.admin?.tauxReponse).toBe(0);
    expect(cr.admin?.silencieux).toBe(1);
  });

  it("se rabat hors saison sur la période la plus récente, jamais sur un brouillon", async () => {
    faux.periodes.push(
      { id: "p-close", nom: "T3 2026", statut: "CLOSE", dateDebut: "2026-04-01", dateFin: "2026-06-30" },
      { id: "p-brouillon", nom: "T1 2027", statut: "BROUILLON", dateDebut: "2027-01-05", dateFin: "2027-03-30" },
    );
    inviter("p-close", MOI);
    inviter("p-brouillon", MOI);
    const cr = await compteRendu(commeConnecte(MOI), SEUIL, MAINTENANT);
    expect(cr.periode?.id).toBe("p-close");
    expect(cr.prochaines).toEqual([]);
  });

  /**
   * L'invariant documenté dans `docs/ETAT.md` : le bloc de pilotage n'est **calculé** que si
   * `settings.technical` est vérifiée côté serveur. Rien n'est envoyé au navigateur puis masqué
   * en CSS — d'où les deux vérifications de chaque test : `admin` est `null`, et la requête qui
   * l'alimente n'est même pas partie.
   */
  it("ne laisse filtrer vers un membre ni le pilotage de la période ni la file des ateliers", async () => {
    trimestreEnCours();
    faux.ateliersProposes = 4;
    const cr = await compteRendu(commeConnecte(MOI), SEUIL, MAINTENANT);
    expect(cr.admin).toBeNull();
    expect(faux.appels).not.toContain("atelier.count");
    // Les présences nominatives **du club** suivent exactement la même garde : un membre ne
    // déclenche pas la lecture qui dirait qui était là quel soir.
    expect(faux.appels).not.toContain("attendance.findMany");
    // Les siennes, en revanche, partent bien : c'est la nuance que les deux étiquettes protègent.
    // Elles ne disent rien de personne d'autre, et sans elles sa série n'existe pas.
    expect(faux.appels).toContain("attendance.findMany(moi)");
    expect(faux.appels).toContain("atelier.count(moi)");
  });

  it("ne donne pas non plus la vue Admin à un instructeur : elle tient au bureau, pas à l'encadrement", async () => {
    trimestreEnCours();
    faux.ateliersProposes = 4;
    const cr = await compteRendu(commeConnecte(INSTRU), SEUIL, MAINTENANT);
    expect(cr.admin).toBeNull();
    expect(faux.appels).not.toContain("atelier.count");
    expect(faux.appels).not.toContain("attendance.findMany");
    // Il voit exactement le même club qu'un membre, et dispose des deux mêmes positions de bascule
    expect(cr.groupe).toEqual({ invites: 3, presentsProchaine: 1, tauxMoyen: 67, presencesTotales: 4 });
    expect(cr.moi).toEqual({ presences: 0, seancesPassees: 0, pourcentage: 0, sansReponse: 0, serie: 0, serieEnCours: 0, reponses: 0, ateliersProposes: 0, ancienneteMois: 12, presencesToutesSaisons: 0, joursDeCours: [] });
  });

  /**
   * **Le rôle ne suffit pas.** Un administrateur entré par son lien personnel — le téléphone posé
   * sur un banc pendant le cours — ne doit pas voir la vue « Admin » de l'accueil : qui ne répond
   * plus, qui n'est jamais venu, la fréquentation du mois. Ce sont les chiffres de pilotage du
   * club, ils appartiennent à l'espace admin, et l'espace admin se prend en redonnant mot de passe
   * et code. Le bloc n'est alors pas caché : il n'est pas calculé du tout.
   */
  it("ne calcule aucun bloc de pilotage pour un administrateur qui n'est pas élevé", async () => {
    trimestreEnCours();
    inviter("p-auto", ADMIN);
    faux.ateliersProposes = 4;
    const cr = await compteRendu(commeConnecte(ADMIN, false), SEUIL, MAINTENANT);
    expect(cr.admin).toBeNull();
    // Ni la file des ateliers, ni les présences nominatives : le rôle seul n'ouvre aucune des deux
    expect(faux.appels).not.toContain("atelier.count");
    expect(faux.appels).not.toContain("attendance.findMany");
    // …et le reste de l'accueil lui reste ouvert, comme à tout le monde
    expect(cr.prochaines.length).toBeGreaterThan(0);
  });

  it("ouvre à un administrateur le pilotage de la période et le travail de l'encadrement", async () => {
    trimestreEnCours();
    inviter("p-auto", ADMIN);
    // Présent aux deux séances passées non annulées, muet sur les cours à venir
    faux.presences.push({ userId: ADMIN.id, sessionId: "s1", statut: "PRESENT" });
    faux.presences.push({ userId: ADMIN.id, sessionId: "s2", statut: "PRESENT" });
    faux.ateliersProposes = 4;
    const cr = await compteRendu(commeConnecte(ADMIN), SEUIL, MAINTENANT);
    expect(cr.admin).toEqual({
      // Prochains cours retenus : s4 et s6 ; s5 est annulée, elle n'attend aucune réponse
      prochainsCours: 2,
      // 8 réponses attendues (4 invités × 2 cours), une seule donnée → 13 %
      tauxReponse: 13,
      // Muets sur s4 **et** s6 : Charlie, Alice et le compte du bureau (Chloé a répondu à s4)
      silencieux: 3,
      // …et la bulle les nomme, dans l'ordre de l'annuaire : c'est la liste d'appels du soir,
      // là où le compteur seul ne se traite pas. Elle sort des listes nominatives des cartes.
      silencieuxNoms: ["Charlie Bernard", "Alice Colin", "Delta Roy"],
      // Tout le monde est venu au moins une fois sur les deux cours passés
      jamaisVenus: 0,
      jamaisVenusNoms: [],
      // Présents des séances passées non annulées : 4 à s1, 2 à s2 → 3 en moyenne
      participationMoyenne: 3,
      ateliersEnAttente: 4,
      // Prochains cours affichés : s4 (1 réponse sur 4), s5 annulée (rien attendu), s6 (0 sur 4)
      invitesSansReponse: 7,
      // La frise du bureau porte le **mois civil en cours**, passé compris : c'est la comparaison
      // qui parle. Elle sort des séances déjà chargées, sans lecture supplémentaire.
      frequentationDuMois: expect.any(Array),
      // L'effectif invité, revenu au bureau depuis que la vue Club ne l'affiche plus
      invites: 4,
      // Aucun lien dormant dans ce jeu d'essai (le faux client n'en rend aucun)
      liensJamaisOuverts: 0,
      liensJamaisOuvertsNoms: [],
      // s4 et s6 n'ont aucune case de planning remplie : leur programme reste à écrire
      coursSansProgramme: 2,
      // Un programme s'écrit pour un soir : la bulle donne les deux dates, pas un total
      coursSansProgrammeDates: ["2026-09-29", "2026-10-13"],
      // Le club de ce jeu d'essai compte 4 invités, soit le seuil d'effectif lui-même : l'échelle
      // des paliers se déclare « indéterminée » plutôt que de reprocher à un cours d'être donné à
      // un petit groupe. Aucun cours ne peut donc être « en danger » ici (voir `palierEffectif`).
      coursEnDanger: 0,
      prochainCoursEnDanger: null,
      coursEnDangerDates: [],
      // Deux cours passés : une « moitié de trimestre » d'un seul cours n'est pas une tendance
      tendance: null,
      // Les deux cours passés tombent le même jour : il n'y a pas deux créneaux à comparer
      parJour: [],
      // Charlie et le compte du bureau sont venus aux deux cours (100 %), Chloé et Alice à un seul
      // (50 %) : deux personnes tiennent le rythme, et la médiane passe entre les deux groupes.
      noyau: 2,
      // Les deux qui tiennent le rythme, nommés : ce sont eux qu'on sollicite pour un stage
      noyauNoms: ["Charlie Bernard", "Delta Roy"],
      assiduiteMediane: 75,
      // Ce qui donne son sens à la médiane : le club va de 50 à 100 %, pas de 0 à 100 %
      assiduiteEtendue: { min: 50, max: 100 },
      // Deux présences d'affilée pour Charlie et Delta ; Chloé vient en premier dans l'annuaire,
      // mais sa série s'arrête à 1. `combien` permet d'écrire « et 1 autre » sans trancher.
      serie: { longueur: 2, qui: "Charlie Bernard", combien: 2 },
      // Le podium nomme les deux ex æquo, et laisse dehors les séries de 1 (Chloé, Alice) : venir
      // une fois n'est pas une série. La tête du podium est bien le nom que porte la tuile.
      meilleuresSeries: [
        { qui: "Charlie Bernard", longueur: 2 },
        { qui: "Delta Roy", longueur: 2 },
      ],
      // Moins de trois cours passés : tout le monde « manque les trois derniers », on ne dit rien
      decrochages: 0,
      decrochagesNoms: [],
    });
    // Le mois de « maintenant » dans le jeu d'essai, et lui seul
    for (const s of cr.admin?.frequentationDuMois ?? []) expect(s.date.slice(0, 7)).toBe("2026-09");
    // Aucun doublon avec la vue Club : le taux du trimestre et l'effectif invité s'y lisent déjà,
    // les reprendre au bureau ne lui apprenait rien (« Taux moyen » et « Invités » ont disparu).
    expect(cr.admin).not.toHaveProperty("tauxMoyen");
    // `invites` est revenu depuis : la tuile « N annoncés sur M » a disparu de la vue Club, le
    // chiffre n'était donc plus écrit nulle part. Un doublon cesse d'en être un quand l'original
    // s'en va — d'où cette assertion inversée, et le commentaire qui dit pourquoi.
    expect(cr.admin?.invites).toBe(4);
    expect(cr.groupe).toEqual({ invites: 4, presentsProchaine: 1, tauxMoyen: 75, presencesTotales: 6 });
    // Sa propre situation reste dans la vue Personnel : elle ne bascule pas avec le pilotage
    expect(cr.moi).toEqual({ presences: 2, seancesPassees: 2, pourcentage: 100, sansReponse: 2, serie: 2, serieEnCours: 2, reponses: 2, ateliersProposes: 0, ancienneteMois: 12, presencesToutesSaisons: 2, joursDeCours: [] });
  });

  /**
   * Les deux chiffres de relance de la vue Admin ne se recouvrent pas : l'un se compte sur les
   * cours **passés** (qui ne vient plus), l'autre sur les cours **à venir** (de qui n'a-t-on aucune
   * nouvelle). Quelqu'un peut répondre à tout sans jamais venir, et l'inverse.
   */
  it("distingue celui qui ne vient plus de celui qui ne répond pas", async () => {
    trimestreEnCours();
    const dorian = { id: "u-dorian", prenom: "Dorian", nom: "Faure" };
    inviter("p-auto", dorian);
    // Il répond à tout — absent aux deux cours passés, présent aux deux cours à venir
    faux.presences.push({ userId: dorian.id, sessionId: "s1", statut: "ABSENT" });
    faux.presences.push({ userId: dorian.id, sessionId: "s2", statut: "ABSENT" });
    faux.presences.push({ userId: dorian.id, sessionId: "s4", statut: "PRESENT" });
    faux.presences.push({ userId: dorian.id, sessionId: "s6", statut: "PRESENT" });
    const cr = await compteRendu(commeConnecte(ADMIN), SEUIL, MAINTENANT);
    // Venu à aucun des deux cours passés : c'est lui, et lui seul, qu'il faut rappeler
    expect(cr.admin?.jamaisVenus).toBe(1);
    // Muets sur s4 et s6 : Charlie et Alice. Ni Dorian (il a répondu), ni Chloé (elle a répondu à s4)
    expect(cr.admin?.silencieux).toBe(2);
  });

  it("ne calcule aucun taux personnel pour un administrateur qui n'est pas du cours", async () => {
    trimestreEnCours();
    const cr = await compteRendu(commeConnecte(ADMIN), SEUIL, MAINTENANT);
    // Le compte du bureau n'est invité sur rien : sa vue personnelle est vide, pas fausse
    expect(cr.moi).toEqual({ presences: 0, seancesPassees: 0, pourcentage: 0, sansReponse: 0, serie: 0, serieEnCours: 0, reponses: 0, ateliersProposes: 0, ancienneteMois: 12, presencesToutesSaisons: 0, joursDeCours: [] });
    // Le pilotage, lui, porte sur toute la période : 3 présents à s1, 1 à s2 → 2 en moyenne
    expect(cr.admin?.participationMoyenne).toBe(2);
    // Le taux du trimestre, lui, est public et reste là où tout le club le lit : la vue Club
    expect(cr.groupe.tauxMoyen).toBe(67);
  });

  it("rend compte du club à un instructeur, sans rien lui réclamer de personnel", async () => {
    trimestreEnCours();
    const cr = await compteRendu(commeConnecte(INSTRU), SEUIL, MAINTENANT);
    // Il n'est pas invité sur la période : sa vue personnelle est vide, pas fausse
    expect(cr.moi).toEqual({ presences: 0, seancesPassees: 0, pourcentage: 0, sansReponse: 0, serie: 0, serieEnCours: 0, reponses: 0, ateliersProposes: 0, ancienneteMois: 12, presencesToutesSaisons: 0, joursDeCours: [] });
    expect(cr.periode?.id).toBe("p-auto");
    // Les invités comptés restent ceux de la période, pas ceux qui la consultent
    expect(cr.groupe.invites).toBe(3);
  });

  it("annonce le prochain événement du club", async () => {
    trimestreEnCours();
    faux.evenements.push({
      id: "e1",
      nom: "Tournoi de Villebourg",
      description: "",
      dateDebut: "2026-11-14",
      heureDebut: "09:00",
      dateFin: null,
      heureFin: null,
      lieu: "Villebourg",
      adresse: "",
      organisateur: "",
      lienInscription: "",
      lienSource: "",
      imageUrl: "",
      publie: true,
      publieAt: null,
      creeParId: null,
      createdAt: new Date("2026-09-01T10:00:00Z"),
      updatedAt: new Date("2026-09-01T10:00:00Z"),
    });
    const cr = await compteRendu(commeConnecte(MOI), SEUIL, MAINTENANT);
    // L'adresse voyage avec le lieu : la ligne de l'accueil en fait un lien vers la carte.
    expect(cr.evenement).toEqual({ id: "e1", nom: "Tournoi de Villebourg", dateDebut: "2026-11-14", lieu: "Villebourg", adresse: "" });
  });

  it("ne divise par zéro sur aucune période encore vide de séances", async () => {
    faux.periodes.push({ id: "p-auto", nom: "T1 2027", statut: "ACTIVE", dateDebut: "2026-09-01", dateFin: "2026-12-20" });
    inviter("p-auto", MOI, { id: "u-charlie", prenom: "Charlie", nom: "Bernard" });
    const cr = await compteRendu(commeConnecte(ADMIN), SEUIL, MAINTENANT);
    expect(cr.periode).toEqual({ id: "p-auto", nom: "T1 2027", dateDebut: "2026-09-01", dateFin: "2026-12-20", invites: 2 });
    expect(cr.seancesTotal).toBe(0);
    expect(cr.aVenir).toBe(0);
    expect(cr.prochaines).toEqual([]);
    // Les invités sont connus, mais il n'y a rien à quoi les inviter
    expect(cr.groupe).toEqual({ invites: 2, presentsProchaine: 0, tauxMoyen: 0, presencesTotales: 0 });
    expect(cr.moi).toEqual({ presences: 0, seancesPassees: 0, pourcentage: 0, sansReponse: 0, serie: 0, serieEnCours: 0, reponses: 0, ateliersProposes: 0, ancienneteMois: 12, presencesToutesSaisons: 0, joursDeCours: [] });
    expect(cr.admin).toEqual({
      prochainsCours: 0,
      tauxReponse: 0,
      silencieux: 0,
      // Personne à nommer : une liste vide, jamais `null` — l'affichage n'a pas à distinguer
      // « aucun silencieux » de « on ne sait pas ».
      silencieuxNoms: [],
      jamaisVenus: 0,
      jamaisVenusNoms: [],
      participationMoyenne: 0,
      ateliersEnAttente: 0,
      invitesSansReponse: 0,
      // Aucune séance dans la période : la frise du mois n'a rien à montrer non plus
      frequentationDuMois: [],
      // L'effectif invité du trimestre, pas celui du prochain cours : il n'y en a aucun ici, et
      // la tuile « La salle » annonçait « 0 sur 0 » là où le club compte deux invités.
      invites: 2,
      liensJamaisOuverts: 0,
      liensJamaisOuvertsNoms: [],
      coursSansProgramme: 0,
      coursSansProgrammeDates: [],
      // Rien à piloter non plus : pas un seul zéro n'est inventé, et aucun `NaN` ne sort d'une
      // division sur zéro cours ou zéro membre compté.
      coursEnDanger: 0,
      prochainCoursEnDanger: null,
      coursEnDangerDates: [],
      tendance: null,
      parJour: [],
      noyau: 0,
      noyauNoms: [],
      assiduiteMediane: 0,
      // Aucun membre encore compté : pas d'étendue à annoncer, et surtout pas un « 0 à 0 » qui
      // se lirait comme un club à l'arrêt le jour de la rentrée.
      assiduiteEtendue: null,
      serie: null,
      meilleuresSeries: [],
      decrochages: 0,
      decrochagesNoms: [],
    });
    expect(Number.isFinite(cr.admin?.tauxReponse)).toBe(true);
    // Aucune séance à agréger : les deux `groupBy` ne partent même pas
    expect(faux.appels).not.toContain("attendance.groupBy");
  });

  it("interroge deux fois les périodes quand aucune n'est en cours, et rien de plus", async () => {
    const cr = await compteRendu(commeConnecte(MOI), SEUIL, MAINTENANT);
    expect(cr.periode).toBeNull();
    // La période en cours, puis le repli sur la plus récente — et aucune lecture d'agrégat derrière
    expect(faux.appels).toEqual(["period.findFirst", "period.findFirst", "session.findMany", "evenement.findMany"]);
  });

  it("sort une séance des « à venir » dès qu'elle a commencé, et cesse d'en attendre des réponses", async () => {
    // MAINTENANT = 14 h à Paris : le cours de 10 h a commencé, celui de 20 h non.
    faux.periodes.push({ id: "p-auto", nom: "T4 2026", statut: "ACTIVE", dateDebut: "2026-09-01", dateFin: "2026-12-20" });
    inviter("p-auto", MOI, { id: "u-charlie", prenom: "Charlie", nom: "Bernard" });
    faux.seances.push(
      { id: "s-matin", periodId: "p-auto", date: "2026-09-22", heureDebut: "10:00", annulee: false },
      { id: "s-soir", periodId: "p-auto", date: "2026-09-22", heureDebut: "20:00", annulee: false },
      seance("s4", "2026-09-29"),
    );
    // Une seule réponse sur le cours du matin, aucune sur celui du soir
    faux.presences.push({ userId: "u-charlie", sessionId: "s-matin", statut: "PRESENT" });

    const cr = await compteRendu(commeConnecte(ADMIN), SEUIL, MAINTENANT);
    // Le tableau de bord la compte déjà comme passée : elle ne peut pas être « à venir » en même temps
    expect(cr.seancesPassees).toBe(1);
    expect(cr.prochaines.map((s) => s.id)).toEqual(["s-soir", "s4"]);
    expect(cr.aVenir).toBe(2);
    // Le prochain cours, c'est celui du soir : 2 invités, personne n'a répondu
    expect(cr.groupe.presentsProchaine).toBe(0);
    expect(cr.prochaines[0].compteurs.enAttente).toBe(2);
    // Le cours du matin, lui, a bien eu lieu : 1 présent sur la seule séance passée
    expect(cr.admin?.participationMoyenne).toBe(1);
    // L'appel du matin est verrouillé : on ne relance plus dessus, seulement s-soir et s4 (2 × 2)
    expect(cr.admin?.invitesSansReponse).toBe(4);
  });

  it("dit où va la fréquentation du trimestre, et quel créneau la porte", async () => {
    trimestreDePilotage();
    const cr = await compteRendu(commeConnecte(ADMIN), SEUIL, MAINTENANT);
    // Première moitié du trimestre à 6 de moyenne, seconde à 3 : la salle s'est vidée de moitié.
    // Aucune moyenne ne dit ça toute seule — c'est la pente qui appelle un geste, pas le niveau.
    expect(cr.admin?.tendance).toEqual({ variation: -50, debut: 6, fin: 3 });
    // Autant de cours le mardi que le jeudi, mais le mardi remplit mieux : le seul chiffre de la
    // page qui parle du créneau plutôt que des personnes.
    expect(cr.admin?.parJour).toEqual([
      { jour: "mardi", moyenne: 5, cours: 3 },
      { jour: "jeudi", moyenne: 4, cours: 3 },
    ]);
  });

  it("compte les cours en danger jusqu'à la fin du trimestre, et nomme la date du premier", async () => {
    trimestreDePilotage();
    const cr = await compteRendu(commeConnecte(ADMIN), SEUIL, MAINTENANT);
    // f2, f3 et f5 sont sous le seuil d'effectif ; f1 se remplit, f4 est annulée
    expect(cr.admin?.coursEnDanger).toBe(3);
    // f5 n'est pas sur la frise, qui s'arrête à quatre colonnes : le compteur parle bien de tout
    // ce qui reste au trimestre, sans quoi il rassurerait à tort.
    expect(cr.prochaines.map((s) => s.id)).toEqual(["f1", "f2", "f3", "f4"]);
    // La date, que la frise ne donne jamais : c'est elle qui fait du compteur un geste à poser
    expect(cr.admin?.prochainCoursEnDanger).toBe("2026-10-01");
  });

  it("ne compte jamais la même personne comme décrocheuse et comme jamais venue", async () => {
    trimestreDePilotage();
    const cr = await compteRendu(commeConnecte(ADMIN), SEUIL, MAINTENANT);
    // Dorian, Elsa et Hugo étaient là aux trois premiers cours et à aucun des trois derniers :
    // des habitués qui s'arrêtent, et que la moyenne du groupe ne signale nulle part.
    expect(cr.admin?.decrochages).toBe(3);
    // Inga n'est jamais venue : elle ne décroche pas, elle n'a pas commencé. Les deux chiffres
    // vivent côte à côte sur le même écran, ils ne doivent jamais compter la même personne.
    expect(cr.admin?.jamaisVenus).toBe(1);
  });

  it("met en avant la plus longue série, et situe le milieu du club plutôt que sa moyenne", async () => {
    trimestreDePilotage();
    const cr = await compteRendu(commeConnecte(ADMIN), SEUIL, MAINTENANT);
    // Alice, Charlie et Chloé ont fait les six cours. Le nom est celui de la première dans l'ordre
    // affiché — l'ordre alphabétique français de `statsPeriode` —, et `combien` permet d'écrire
    // « et 2 autres » sans désigner quelqu'un au hasard.
    expect(cr.admin?.serie).toEqual({ longueur: 6, qui: "Alice Colin", combien: 3 });
    // Trois personnes à 100 %, trois à 50 %, une à 0 % : la moitié du club est à 50 %…
    expect(cr.admin?.assiduiteMediane).toBe(50);
    // …et trois seulement tiennent le rythme de deux cours sur trois
    expect(cr.admin?.noyau).toBe(3);
    // Le taux du trimestre de la vue Club, lui, reste tiré vers le haut par les cours pleins du
    // début : c'est tout l'intérêt d'afficher aussi la médiane au bureau.
    expect(cr.groupe.tauxMoyen).toBeGreaterThan(cr.admin?.assiduiteMediane ?? 0);
  });

  /**
   * **Chaque chiffre du bureau dit qui se cache derrière lui.** Un compteur seul ne se traite pas :
   * « 3 silencieux » s'oublie, trois noms s'appellent le soir même. Ces listes ne coûtent aucune
   * lecture — elles sortent des listes nominatives des cartes, des lignes déjà agrégées et des
   * présences nominatives déjà chargées pour la série.
   */
  it("nomme les silencieux, ceux qui ne sont jamais venus et ceux qui décrochent", async () => {
    trimestreDePilotage();
    const cr = await compteRendu(commeConnecte(ADMIN), SEUIL, MAINTENANT);
    // Muets sur f1, f2 **et** f3 : les autres ont au moins répondu à f1
    expect(cr.admin?.silencieuxNoms).toEqual(["Hugo Petit", "Inga Vidal"]);
    expect(cr.admin?.silencieux).toBe(cr.admin?.silencieuxNoms.length);
    // Invitée à six cours, venue à aucun : c'est un appel à passer, pas une statistique
    expect(cr.admin?.jamaisVenusNoms).toEqual(["Inga Vidal"]);
    // Des habitués qui s'arrêtent : présents aux trois premiers cours, absents des trois derniers
    expect(cr.admin?.decrochagesNoms).toEqual(["Dorian Faure", "Elsa Garnier", "Hugo Petit"]);
    // Chaque liste tient exactement le compte annoncé par sa tuile : une bulle qui nommerait deux
    // personnes sous un « 3 » ferait perdre confiance dans tout le tableau de bord.
    expect(cr.admin?.jamaisVenus).toBe(cr.admin?.jamaisVenusNoms.length);
    expect(cr.admin?.decrochages).toBe(cr.admin?.decrochagesNoms.length);
  });

  /**
   * Les deux bulles voisines ne doivent **jamais** citer la même personne : « jamais venue » et
   * « décroche » appellent deux messages différents, et les lire côte à côte sur un même nom
   * rendrait les deux illisibles. C'est l'invariant déjà tenu par les compteurs, vérifié ici sur
   * les noms.
   */
  it("ne nomme jamais la même personne comme décrocheuse et comme jamais venue", async () => {
    trimestreDePilotage();
    const cr = await compteRendu(commeConnecte(ADMIN), SEUIL, MAINTENANT);
    const jamais = new Set(cr.admin?.jamaisVenusNoms ?? []);
    expect(cr.admin?.decrochagesNoms.filter((n) => jamais.has(n))).toEqual([]);
    // Inga n'a pas commencé, Hugo s'est arrêté : deux gestes distincts, deux bulles distinctes
    expect(jamais.has("Inga Vidal")).toBe(true);
    expect(cr.admin?.decrochagesNoms).toContain("Hugo Petit");
  });

  /**
   * **Le cas qui mettait la même personne dans les deux bulles**.
   *
   * Les deux tuiles lisaient deux bornes différentes : « Jamais venus » sortait de `m.presents`,
   * **borné à la date d'arrivée** par `statsPeriode`, quand les décrochages sortaient d'une lecture
   * nominative **sans aucune borne**. Nina s'inscrit le 12 septembre et était venue en essai le 1er
   * (le bureau la coche après coup depuis `/admin/presences`) : borne d'un côté, pas de l'autre, elle
   * était à la fois « jamais venue » (0 présence depuis son arrivée) et « décrochage » (venue une
   * fois, absente des trois derniers cours) — deux scripts d'appel contradictoires, sur le même écran,
   * pour la même personne, pendant que les deux docstrings juraient les tuiles disjointes.
   *
   * La borne est désormais la même des deux côtés : **un compteur de personne ne compte que les cours
   * donnés depuis son arrivée.** Sa venue d'essai n'est effacée de rien pour autant — elle est sur la
   * fiche du cours du 1er septembre, dans le total de cette séance et dans la colonne du CSV.
   */
  it("ne met pas dans les deux bulles quelqu'un venu avant son inscription", async () => {
    trimestreDePilotage();
    const nina = { id: "u-nina", prenom: "Nina", nom: "Roux" };
    // Inscrite le 12 : les quatre premiers cours sont derrière elle, p5 et p6 sont les siens.
    inviterLe("p-auto", new Date("2026-09-12T10:00:00Z"), nina);
    // Sa venue d'essai, cochée après coup sur le cours du 1er septembre.
    faux.presences.push({ userId: nina.id, sessionId: "p1", statut: "PRESENT" });
    const cr = await compteRendu(commeConnecte(ADMIN), SEUIL, MAINTENANT);
    // Aucune présence depuis son arrivée, et deux cours à son nom : c'est une recrue qu'on n'a pas
    // encore vue, et c'est ce message-là qu'il faut lui adresser.
    expect(cr.admin?.jamaisVenusNoms).toContain("Nina Roux");
    // Et surtout pas « on ne t'a pas vue depuis trois cours » : elle n'a jamais commencé.
    expect(cr.admin?.decrochagesNoms).not.toContain("Nina Roux");
    // L'invariant, écrit sur les deux listes entières : aucune intersection, jamais.
    const jamais = new Set(cr.admin?.jamaisVenusNoms ?? []);
    expect(cr.admin?.decrochagesNoms.filter((n) => jamais.has(n))).toEqual([]);
    // Les deux compteurs restent la longueur de leur liste : une bulle et sa tuile ne divergent pas.
    expect(cr.admin?.jamaisVenus).toBe(cr.admin?.jamaisVenusNoms.length);
    expect(cr.admin?.decrochages).toBe(cr.admin?.decrochagesNoms.length);
  });

  /**
   * **La même borne vaut pour les séries du bureau.** Sans elle, la tuile « Série » félicitait une
   * suite de cours qu'une personne avait faits **avant** d'être inscrite, à côté d'un tableau où sa
   * ligne annonce zéro présence.
   */
  it("ne prête à personne une série faite avant son inscription", async () => {
    faux.periodes.push({ id: "p-auto", nom: "T4 2026", statut: "ACTIVE", dateDebut: "2026-09-01", dateFin: "2026-12-20" });
    const nina = { id: "u-nina", prenom: "Nina", nom: "Roux" };
    inviter("p-auto", MOI);
    inviterLe("p-auto", new Date("2026-09-12T10:00:00Z"), nina);
    faux.seances.push(seance("q1", "2026-09-01"), seance("q2", "2026-09-03"), seance("q3", "2026-09-08"), seance("q4", "2026-09-15"), seance("q5", "2026-09-17"));
    // Trois cours d'affilée en essai, rien depuis son inscription : personne d'autre n'a de série,
    // donc la tuile citerait Nina et son podium l'afficherait en tête.
    for (const sessionId of ["q1", "q2", "q3"]) faux.presences.push({ userId: nina.id, sessionId, statut: "PRESENT" });
    const cr = await compteRendu(commeConnecte(ADMIN), SEUIL, MAINTENANT);
    expect(cr.admin?.serie).toBeNull();
    expect(cr.admin?.meilleuresSeries).toEqual([]);
    // Elle reste ce qu'elle est : une recrue qu'on n'a pas encore vue, et pas une habituée qui part.
    expect(cr.admin?.jamaisVenusNoms).toContain("Nina Roux");
    expect(cr.admin?.decrochagesNoms).not.toContain("Nina Roux");
  });

  it("nomme le noyau et situe la médiane entre les deux extrêmes du club", async () => {
    trimestreDePilotage();
    const cr = await compteRendu(commeConnecte(ADMIN), SEUIL, MAINTENANT);
    // Les trois qui ont fait les six cours : ceux sur qui le club peut bâtir un cycle technique
    expect(cr.admin?.noyauNoms).toEqual(["Alice Colin", "Charlie Bernard", "Chloé Arnaud"]);
    expect(cr.admin?.noyau).toBe(cr.admin?.noyauNoms.length);
    // Une médiane à 50 % ne dit pas la même chose dans un club qui va de 40 à 60 % : ici, il va
    // de 0 à 100 %, c'est-à-dire trois fidèles, trois occasionnels et une inscrite jamais venue.
    expect(cr.admin?.assiduiteEtendue).toEqual({ min: 0, max: 100 });
    expect(cr.admin?.assiduiteMediane).toBe(50);
  });

  it("donne les dates des cours en danger, y compris au-delà des quatre cartes, et celles des cours sans programme", async () => {
    trimestreDePilotage();
    const cr = await compteRendu(commeConnecte(ADMIN), SEUIL, MAINTENANT);
    // f2, f3 et f5 sont sous le seuil ; f5 n'est pas sur la frise, qui s'arrête à quatre colonnes
    expect(cr.admin?.coursEnDangerDates).toEqual(["2026-10-01", "2026-10-06", "2026-10-13"]);
    expect(cr.prochaines.map((s) => s.id)).not.toContain("f5");
    // La liste est triée : la tuile affiche la première date, la bulle montre la suite du trimestre
    expect(cr.admin?.prochainCoursEnDanger).toBe(cr.admin?.coursEnDangerDates[0]);
    expect(cr.admin?.coursEnDanger).toBe(cr.admin?.coursEnDangerDates.length);
    // Les trois prochains cours non annulés n'ont aucune case de planning remplie
    expect(cr.admin?.coursSansProgrammeDates).toEqual(["2026-09-29", "2026-10-01", "2026-10-06"]);
    expect(cr.admin?.coursSansProgramme).toBe(cr.admin?.coursSansProgrammeDates.length);
  });

  it("classe les trois plus longues séries, ex æquo compris, et ne va pas au-delà de trois", async () => {
    trimestreDePilotage();
    const cr = await compteRendu(commeConnecte(ADMIN), SEUIL, MAINTENANT);
    // Six personnes ont une série d'au moins deux cours (trois à 6, trois à 3) : le podium n'en
    // nomme que trois — au-delà, on ne félicite plus personne, on publie un classement.
    expect(cr.admin?.meilleuresSeries).toEqual([
      { qui: "Alice Colin", longueur: 6 },
      { qui: "Charlie Bernard", longueur: 6 },
      { qui: "Chloé Arnaud", longueur: 6 },
    ]);
    // Et la tête du podium est bien la personne que cite la tuile : les deux sortent du même calcul
    expect(cr.admin?.serie).toEqual({ longueur: 6, qui: "Alice Colin", combien: 3 });
  });

  it("ne retient aucune « série de 1 » : être venu une fois n'est pas une série", async () => {
    trimestreEnCours();
    const cr = await compteRendu(commeConnecte(ADMIN), SEUIL, MAINTENANT);
    // Chloé et Alice n'étaient là qu'à s1 ; Charlie a enchaîné s1 et s2, et il est le seul
    expect(cr.admin?.meilleuresSeries).toEqual([{ qui: "Charlie Bernard", longueur: 2 }]);
    expect(cr.admin?.serie).toEqual({ longueur: 2, qui: "Charlie Bernard", combien: 1 });
  });

  /**
   * Les liens dormants sont la seule bulle dont les noms ne se déduisaient de rien : ces gens-là
   * ne figurent dans aucune liste de présence, puisqu'ils ne sont jamais entrés. D'où la seule
   * lecture du fichier à avoir changé de forme — et **pas de nombre** : un `findMany` au même
   * `where`, dont la longueur donne le compteur.
   */
  it("nomme qui n'a jamais ouvert son lien, sans une requête de plus", async () => {
    trimestreEnCours();
    faux.liensJamaisOuverts = [
      { id: "u-inga", prenom: "Inga", nom: "Vidal" },
      { id: "u-dorian", prenom: "Dorian", nom: "Faure" },
    ];
    const cr = await compteRendu(commeConnecte(ADMIN), SEUIL, MAINTENANT);
    // Triés par nom de famille, comme l'annuaire : un email à renvoyer, pas une relance
    expect(cr.admin?.liensJamaisOuvertsNoms).toEqual(["Dorian Faure", "Inga Vidal"]);
    // Le compteur n'est plus que la longueur de la liste : les deux ne peuvent pas se contredire
    expect(cr.admin?.liensJamaisOuverts).toBe(2);
    expect(faux.appels.filter((a) => a === "invitation.findMany")).toHaveLength(1);
    expect(faux.appels).toHaveLength(13);
  });

  /**
   * **L'invariant de sécurité, appliqué aux noms.** Tout ce que ces bulles nomment — qui ne répond
   * plus, qui n'est jamais venu, qui n'a jamais ouvert son lien — vit dans `BlocAdmin`, donc sous
   * la double garde `settings.technical` + `sessionForte`. Un administrateur entré par son lien
   * personnel, téléphone posé sur un banc pendant le cours, n'en reçoit rien : ce n'est pas masqué
   * en CSS, ce n'est pas calculé.
   */
  it("ne laisse filtrer aucun nom de pilotage vers un administrateur qui n'est pas élevé", async () => {
    trimestreDePilotage();
    faux.liensJamaisOuverts = [{ id: "u-inga", prenom: "Inga", nom: "Vidal" }];
    const cr = await compteRendu(commeConnecte(ADMIN, false), SEUIL, MAINTENANT);
    expect(cr.admin).toBeNull();
    // Aucun des nouveaux champs ne part au navigateur, sous quelque forme que ce soit
    const envoye = JSON.stringify(cr);
    for (const champ of [
      "silencieuxNoms",
      "jamaisVenusNoms",
      "decrochagesNoms",
      "liensJamaisOuvertsNoms",
      "noyauNoms",
      "coursEnDangerDates",
      "coursSansProgrammeDates",
      "meilleuresSeries",
      "assiduiteEtendue",
    ]) {
      expect(envoye).not.toContain(champ);
    }
    // Les deux lectures qui les alimenteraient ne partent pas davantage : la liste nominative des
    // présences du club, et celle des liens dormants (qui nomme des gens absents de toute carte).
    expect(faux.appels).not.toContain("attendance.findMany");
    expect(faux.appels).not.toContain("invitation.findMany");
  });

  /**
   * Un trimestre taillé pour la vue Personnel : cinq cours déjà donnés (le troisième annulé), et
   * personne d'autre que la personne qui regarde — ce qu'elle lit d'elle-même ne dépend d'aucun
   * autre membre, et le jeu d'essai le montre en n'en mettant aucun.
   */
  function trimestreDeSerie() {
    faux.periodes.push({ id: "p-auto", nom: "T4 2026", statut: "ACTIVE", dateDebut: "2026-09-01", dateFin: "2026-12-20" });
    inviter("p-auto", MOI);
    faux.seances.push(seance("c1", "2026-09-01"), seance("c2", "2026-09-03"), seance("c3", "2026-09-08", true), seance("c4", "2026-09-10"), seance("c5", "2026-09-15"));
  }

  const presenteA = (...ids: string[]) => {
    for (const sessionId of ids) faux.presences.push({ userId: MOI.id, sessionId, statut: "PRESENT" });
  };

  it("compte la plus longue suite de présences, et la casse à la première absence", async () => {
    trimestreDeSerie();
    // c3 est annulée : les cours qui ont eu lieu sont c1, c2, c4, c5. Présente aux trois premiers,
    // absente au dernier → la suite vaut 3, et non 4.
    presenteA("c1", "c2", "c4");
    faux.presences.push({ userId: MOI.id, sessionId: "c5", statut: "ABSENT" });
    const cr = await compteRendu(commeConnecte(MOI), SEUIL, MAINTENANT);
    expect(cr.moi.serie).toBe(3);
    // Une absence ne se contente pas de ne pas compter : elle remet le compteur à zéro. Reprendre
    // après coup ne recolle pas les deux morceaux.
    faux.appels = [];
    faux.presences = faux.presences.filter((a) => a.sessionId !== "c2");
    faux.presences.push({ userId: MOI.id, sessionId: "c2", statut: "ABSENT" });
    expect((await compteRendu(commeConnecte(MOI), SEUIL, MAINTENANT)).moi.serie).toBe(1);
  });

  it("ne prête aucune série à qui n'est jamais venu, sans passer par un moins-un ni un NaN", async () => {
    trimestreDeSerie();
    // Elle a répondu à tout, toujours « Absent » : quatre réponses, aucune présence
    for (const sessionId of ["c1", "c2", "c4", "c5"]) faux.presences.push({ userId: MOI.id, sessionId, statut: "ABSENT" });
    const cr = await compteRendu(commeConnecte(MOI), SEUIL, MAINTENANT);
    expect(cr.moi.serie).toBe(0);
    expect(cr.moi.presences).toBe(0);
    // Répondre compte quand même : c'est le geste que l'application demande, et le seul qu'elle
    // puisse reconnaître à quelqu'un qui ne peut pas venir.
    expect(cr.moi.reponses).toBe(4);
  });

  it("ne casse aucune série sur un cours annulé : il n'a manqué à personne", async () => {
    trimestreDeSerie();
    // Présente aux deux cours qui encadrent l'annulation (c2 et c4), pas de réponse sur c3 —
    // personne n'en attendait. La suite court donc à travers l'annulation.
    presenteA("c2", "c4");
    const cr = await compteRendu(commeConnecte(MOI), SEUIL, MAINTENANT);
    expect(cr.moi.serie).toBe(2);
    // Et le cours annulé ne se glisse pas non plus dans le décompte : quatre cours ont eu lieu
    expect(cr.moi.seancesPassees).toBe(4);
  });

  /**
   * **La série en cours**, à distinguer du record — et c'est toute la règle d'écriture du bloc
   * « Ma progression » : `serie` est la plus longue suite du trimestre, elle ne redescend jamais ;
   * `serieEnCours` est celle qui **se termine au dernier cours passé**, et elle retombe à zéro dès
   * qu'un cours est manqué. L'affichage montre la première quand la seconde est tombée — une série
   * se casse sur une grippe ou un enfant malade, et un compteur remis à zéro punirait quelqu'un qui
   * n'a rien fait de mal. Les tests ci-dessous fixent les deux chiffres ensemble, jamais l'un sans
   * l'autre : c'est leur écart qui porte la décision d'affichage.
   */
  it("compte la série qui se termine au dernier cours passé", async () => {
    trimestreDeSerie();
    // Les cours tenus sont c1, c2, c4, c5 (c3 est annulée). Absente au premier, présente aux trois
    // derniers : la série en cours vaut 3, et le record aussi — tant qu'elle court, les deux
    // chiffres coïncident, et c'est bien pour ça qu'un seul des deux s'affiche à la fois.
    presenteA("c2", "c4", "c5");
    const cr = await compteRendu(commeConnecte(MOI), SEUIL, MAINTENANT);
    expect(cr.moi.serieEnCours).toBe(3);
    expect(cr.moi.serie).toBe(3);
  });

  it("ramène la série en cours à zéro au dernier cours manqué, sans toucher au record", async () => {
    trimestreDeSerie();
    // Présente à c1, c2 et c4, absente au dernier cours tenu : la suite qui se termine aujourd'hui
    // est vide, mais les trois cours d'affilée du début restent acquis.
    presenteA("c1", "c2", "c4");
    faux.presences.push({ userId: MOI.id, sessionId: "c5", statut: "ABSENT" });
    const cr = await compteRendu(commeConnecte(MOI), SEUIL, MAINTENANT);
    expect(cr.moi.serieEnCours).toBe(0);
    // Le record, lui, ne bouge pas — c'est **lui** que la vue Personnel écrira, en neutre, plutôt
    // que d'annoncer une série interrompue (« on montre le record, jamais la chute »).
    expect(cr.moi.serie).toBe(3);
  });

  it("ne prête aucune série en cours à qui n'est jamais venue, ni zéro négatif ni NaN", async () => {
    trimestreDeSerie();
    // Elle a répondu à chaque appel, toujours « Absent » : aucune présence, donc aucune suite —
    // et rien ne sera écrit sur sa page, puisque le record est lui aussi en dessous de deux.
    for (const sessionId of ["c1", "c2", "c4", "c5"]) faux.presences.push({ userId: MOI.id, sessionId, statut: "ABSENT" });
    const cr = await compteRendu(commeConnecte(MOI), SEUIL, MAINTENANT);
    expect(cr.moi.serieEnCours).toBe(0);
    expect(cr.moi.serie).toBe(0);
    expect(Number.isFinite(cr.moi.serieEnCours)).toBe(true);
  });

  it("ne coupe aucune série en cours sur une séance annulée : elle n'a pas eu lieu", async () => {
    trimestreDeSerie();
    // Deux annulations : c3 **au milieu** de la suite, et c5 en dernière date. Les cours qui ont eu
    // lieu sont donc c1, c2 et c4 ; présente à c2 et c4, elle est là aux deux derniers cours tenus,
    // de part et d'autre de l'annulation du milieu.
    faux.seances = faux.seances.map((s) => (s.id === "c5" ? { ...s, annulee: true } : s));
    presenteA("c2", "c4");
    const cr = await compteRendu(commeConnecte(MOI), SEUIL, MAINTENANT);
    // 2, et non 1 : un cours annulé n'a manqué à personne, il ne coupe donc rien. Et la dernière
    // annulation ne remet pas non plus le compteur à zéro — il n'y avait rien à manquer.
    expect(cr.moi.serieEnCours).toBe(2);
    expect(cr.moi.serie).toBe(2);
    expect(cr.moi.seancesPassees).toBe(3);
  });

  /**
   * **Sa série s'arrête à son arrivée dans le trimestre, comme ses trois compteurs**.
   *
   * Le parcours courait sur *tous* les cours passés du trimestre, pendant que `presences`,
   * `seancesPassees` et `pourcentage` sortent de la ligne **bornée** de `statsPeriode`. Quelqu'un
   * inscrit en cours de trimestre, venu en essai avant de s'inscrire (le bureau coche après coup),
   * lisait donc « 0 présence, 0 %, 2 cours passés » à côté de « ta plus longue série : 2 cours », dans
   * le même bloc « Personnel ». C'est le défaut réparé le matin même sur « Mes présences » (80 % sur
   * un écran, 33 % sur l'autre), déplacé d'un cran.
   */
  it("n'annonce aucune série faite avant son inscription au trimestre", async () => {
    faux.periodes.push({ id: "p-auto", nom: "T4 2026", statut: "ACTIVE", dateDebut: "2026-09-01", dateFin: "2026-12-20" });
    // Elle s'inscrit le 9 septembre : c4 et c5 sont ses cours, c1 et c2 sont d'avant.
    inviterLe("p-auto", new Date("2026-09-09T10:00:00Z"), MOI);
    faux.seances.push(seance("c1", "2026-09-01"), seance("c2", "2026-09-03"), seance("c4", "2026-09-10"), seance("c5", "2026-09-15"));
    // Deux cours d'affilée en essai, et rien depuis qu'elle est inscrite.
    presenteA("c1", "c2");
    const cr = await compteRendu(commeConnecte(MOI), SEUIL, MAINTENANT);
    // Ses trois compteurs, bornés comme ils l'ont toujours été…
    expect([cr.moi.presences, cr.moi.seancesPassees, cr.moi.pourcentage]).toEqual([0, 2, 0]);
    // …et sa série, qui disait « 2 cours d'affilée » juste à côté.
    expect(cr.moi.serie).toBe(0);
    expect(cr.moi.serieEnCours).toBe(0);
    // Ses présences de toute la saison, elles, ne connaissent aucune frontière de trimestre et
    // comptent bien ses deux venues : c'est un autre horizon, pas un autre chiffre du même (blasons).
    expect(cr.moi.presencesToutesSaisons).toBe(2);
  });

  /**
   * Le point qui conditionnait tout : la série en cours devait **ne rien coûter**. Elle sort du
   * même parcours des cours passés et de la même lecture de ses « Présent » que le record — le
   * contrat de requêtes de l'accueil (dix pour un membre, treize pour un administrateur élevé) est
   * donc rejoué ici, pour qu'un champ de plus dans la vue Personnel ne puisse pas le faire glisser
   * en silence.
   */
  it("n'ajoute aucune requête pour la série en cours : elle sort du même passage que le record", async () => {
    trimestreEnCours();
    const cr = await compteRendu(commeConnecte(MOI), SEUIL, MAINTENANT);
    // Présente à s1, absente à s2 (le dernier cours tenu) : record de 1, série en cours nulle
    expect(cr.moi.serie).toBe(1);
    expect(cr.moi.serieEnCours).toBe(0);
    expect(faux.appels).toHaveLength(10);
    // Une seule lecture de ses présences, et pas deux : les deux chiffres sortent de la même
    expect(faux.appels.filter((a) => a === "attendance.findMany(moi)")).toHaveLength(1);

    faux.appels = [];
    await compteRendu(commeConnecte(ADMIN), SEUIL, MAINTENANT);
    expect(faux.appels).toHaveLength(13);
    expect(faux.appels.filter((a) => a === "attendance.findMany(moi)")).toHaveLength(1);
  });

  it("compte les réponses données, Présent, Absent ou Peut-être, sans aller les rechercher", async () => {
    trimestreDeSerie();
    presenteA("c1");
    faux.presences.push({ userId: MOI.id, sessionId: "c2", statut: "ABSENT" });
    faux.presences.push({ userId: MOI.id, sessionId: "c4", statut: "PEUT_ETRE" });
    // Sur le cours annulé, une réponse restée en base : elle ne compte pas, le cours n'a pas eu lieu
    faux.presences.push({ userId: MOI.id, sessionId: "c3", statut: "PRESENT" });
    faux.appels = [];
    const cr = await compteRendu(commeConnecte(MOI), SEUIL, MAINTENANT);
    // Trois cours tenus sur quatre, un seul silence (c5)
    expect(cr.moi.reponses).toBe(3);
    expect(cr.moi.presences).toBe(1);
    // Le chiffre sort de la ligne du tableau de bord, déjà chargée : pas un agrégat de plus
    expect(faux.appels.filter((a) => a === "attendance.groupBy")).toHaveLength(2);
  });

  it("additionne toutes les présences du trimestre pour le compteur collectif, sans une requête de plus", async () => {
    trimestreDePilotage();
    faux.appels = [];
    const cr = await compteRendu(commeConnecte(MOI), SEUIL, MAINTENANT);
    // Trois cours à 6 présents puis trois à 3 : 27 présences depuis la rentrée. Les cours à venir
    // n'y sont pas — s'inscrire n'est pas venir — et les annulés non plus.
    expect(cr.groupe.presencesTotales).toBe(27);
    // Les présents de chaque séance sont déjà comptés en SQL : la somme se fait en mémoire
    expect(faux.appels.filter((a) => a === "attendance.groupBy")).toHaveLength(2);
  });

  it("compte les ateliers proposés toutes périodes confondues, et rien pour qui n'en a proposé aucun", async () => {
    trimestreEnCours();
    // La file du bureau (4 propositions en attente) et ses propres propositions (2) sont deux
    // chiffres distincts : un membre n'a jamais accès au premier.
    faux.ateliersProposes = 4;
    faux.mesAteliers = 2;
    expect((await compteRendu(commeConnecte(MOI), SEUIL, MAINTENANT)).moi.ateliersProposes).toBe(2);
    faux.mesAteliers = 0;
    expect((await compteRendu(commeConnecte(MOI), SEUIL, MAINTENANT)).moi.ateliersProposes).toBe(0);
  });

  /**
   * **L'ancienneté au club** : le chiffre qui donne son rang, adossé à la date de création du
   * compte plutôt qu'aux présences du trimestre — un rang ne peut pas retomber à « Recrue » tous
   * les quatre mois.
   *
   * Elle sort de `CurrentUser.createdAt`, une colonne que la session charge déjà avec la ligne du
   * compte : **aucune requête de plus**. Le contrat (dix et treize) est donc rejoué ici, comme il
   * l'a été pour la série en cours, pour qu'un champ de la vue Personnel ne puisse pas le faire
   * glisser en silence.
   */
  it("remonte l'ancienneté en mois révolus, sans une requête de plus", async () => {
    trimestreEnCours();
    const cr = await compteRendu(commeConnecte(MOI), SEUIL, MAINTENANT);
    // Compte créé, donc pendant la saison ouverte : douze mois révolus. L'ancienneté se compte en
    // **saisons**, pas en dates.
    expect(cr.moi.ancienneteMois).toBe(12);
    expect(faux.appels).toHaveLength(10);

    // Un compte créé le lendemain donne exactement la même chose : c'est la même rentrée, et tout
    // le club prend son année le même jour plutôt que chacun à sa date.
    faux.appels = [];
    const veille = await compteRendu(commeConnecte(MOI, false, new Date("2026-01-23T12:00:00Z")), SEUIL, MAINTENANT);
    expect(veille.moi.ancienneteMois).toBe(12);
    expect(faux.appels).toHaveLength(10);

    // Un compte du jour est à zéro — « Recrue », et non un membre hors de l'échelle : la rentrée
    // vient de passer.
    const dujour = await compteRendu(commeConnecte(MOI, false, MAINTENANT), SEUIL, MAINTENANT);
    expect(dujour.moi.ancienneteMois).toBe(0);

    // Un administrateur élevé paie les mêmes treize requêtes qu'avant : l'ancienneté ne coûte rien.
    faux.appels = [];
    const admin = await compteRendu(commeConnecte(ADMIN), SEUIL, MAINTENANT);
    expect(admin.moi.ancienneteMois).toBe(12);
    expect(faux.appels).toHaveLength(13);
  });

  it("compte l'ancienneté même sans période ni invitation : on est du club avant d'être inscrit à un trimestre", async () => {
    // Aucun trimestre du tout : tout le reste de `moi` est à zéro, l'ancienneté reste vraie.
    const cr = await compteRendu(commeConnecte(MOI, false, new Date("2023-09-22T12:00:00Z")), SEUIL, MAINTENANT);
    expect(cr.periode).toBeNull();
    expect(cr.moi.ancienneteMois).toBe(36);
    expect(cr.moi.presences).toBe(0);
  });

  /**
   * **La date d'adhésion prime sur la création du compte** : le club existait bien avant
   * l'application, et son premier écran affichait douze « Recrue » — dont des gens qui tirent
   * depuis huit ans. Le bureau saisit désormais une vraie ancienneté dans la fiche du membre, et
   * c'est elle que lit le rang.
   *
   * La règle de repli est écrite une seule fois (`dateDAdhesion`, src/lib/blasons.ts) ; ce test
   * vérifie que l'accueil l'applique bien — et **sans une requête de plus** : la colonne arrive avec
   * la ligne du compte, comme `createdAt`.
   */
  it("compte l'ancienneté depuis la date d'adhésion quand elle est renseignée, sans une requête de plus", async () => {
    trimestreEnCours();
    // Compte créé il y a moins d'un an, mais au club depuis la rentrée 2022 : c'est l'adhésion qui
    // parle, et elle se compte en saisons (quatre rentrées).
    const ancien = await compteRendu(commeConnecte(MOI, false, INSCRITE_DEPUIS, new Date("2022-09-01T00:00:00Z")), SEUIL, MAINTENANT);
    expect(ancien.moi.ancienneteMois).toBe(48);
    expect(faux.appels).toHaveLength(10);

    // Sans date d'adhésion, on retombe sur la création du compte — ramenée, elle aussi, à la
    // rentrée de sa saison : les deux chemins restent comparables.
    faux.appels = [];
    const sansDate = await compteRendu(commeConnecte(MOI, false, INSCRITE_DEPUIS, null), SEUIL, MAINTENANT);
    expect(sansDate.moi.ancienneteMois).toBe(12);
    expect(faux.appels).toHaveLength(10);

    // Quelqu'un arrivé à la rentrée en cours : zéro mois, « Recrue », et non un membre hors échelle.
    const recente = await compteRendu(commeConnecte(MOI, false, INSCRITE_DEPUIS, new Date("2026-09-01T00:00:00Z")), SEUIL, MAINTENANT);
    expect(recente.moi.ancienneteMois).toBe(0);

    // Un administrateur élevé paie toujours ses treize requêtes, pas une de plus.
    faux.appels = [];
    const admin = await compteRendu(commeConnecte(ADMIN, true, INSCRITE_DEPUIS, new Date("2020-09-01T00:00:00Z")), SEUIL, MAINTENANT);
    expect(admin.moi.ancienneteMois).toBe(72);
    expect(faux.appels).toHaveLength(13);
  });

  /**
   * **Les trois champs**, ajoutés pour les blasons : ses présences depuis son arrivée (horizon « La
   * saison ») et ses mardis / vendredis du meilleur mois (blasons de créneau).
   *
   * Le jeu d'essai est taillé pour que le total et le meilleur mois ne puissent pas se confondre :
   * six présences en tout, mais jamais plus de trois le même mardi de mois — un champ qui
   * renverrait le total tomberait ici.
   */
  function trimestreDeCreneaux() {
    faux.periodes.push({ id: "p-auto", nom: "T1 2026-2027", statut: "ACTIVE", dateDebut: "2026-08-01", dateFin: "2026-12-20" });
    inviter("p-auto", MOI);
    // Mardis et vendredis d'août et de septembre 2026, tous déjà passés au 22 septembre.
    faux.seances.push(
      seance("m1", "2026-08-04"),
      seance("v1", "2026-08-07"),
      seance("m2", "2026-08-11"),
      seance("v1b", "2026-08-14"),
      seance("m3", "2026-08-18"),
      seance("v1c", "2026-08-21"),
      // Le quatrième mardi et le quatrième vendredi d'août : ils ne disent rien d'elle — elle n'y
      // était pas — mais ils disent du **club** qu'il tient bien ces deux soirs toutes les semaines.
      // Sans un mois plein de chaque, `joursDeCoursDuClub` n'en retiendrait aucun et la vitrine
      // n'aurait aucun blason de créneau à décerner (voir tests/unit/blasons.test.ts).
      seance("m3b", "2026-08-25"),
      seance("v1d", "2026-08-28"),
      seance("m4", "2026-09-01"),
      seance("v2", "2026-09-04"),
      seance("m5", "2026-09-08"),
      seance("v3", "2026-09-11"),
      // Un mardi annulé sur lequel une réponse traîne : il n'a eu lieu pour personne.
      seance("m6", "2026-09-15", true),
      seance("v4", "2026-09-18"),
      // Un mardi encore à venir, sans réponse : il ne compte dans aucun des trois chiffres —
      // s'inscrire n'est pas venir — mais il donne à l'accueil une carte à afficher, donc le
      // compte de requêtes complet du contrat.
      seance("m7", "2026-09-29"),
    );
    // Trois mardis en août, un seul en septembre : le meilleur mois de mardis vaut 3, pas 4.
    presenteA("m1", "m2", "m3", "m4");
    // Deux vendredis en septembre, aucun en août : le meilleur mois de vendredis vaut 2.
    presenteA("v2", "v3");
    // Sur le cours annulé, une présence restée en base : elle ne compte nulle part.
    presenteA("m6");
  }

  /**
   * **Ses présences depuis son arrivée**, la seule lecture ajoutée. Elle ne regarde pas le
   * trimestre — c'est tout son intérêt : les blasons de l'horizon « La saison » sont les seuls qui
   * ne retombent pas à zéro tous les quatre mois, et aucun agrégat de la période ne sait compter
   * au-delà d'elle.
   */
  it("compte ses présences de toutes les saisons, cours tenus seulement, là où le reste s'arrête au trimestre", async () => {
    trimestreDeCreneaux();
    // Un trimestre clos de l'an dernier, avec une présence de plus : elle compte dans le total de
    // toujours, et dans rien d'autre sur la page.
    faux.periodes.push({ id: "p-2025", nom: "T2 2025-2026", statut: "CLOSE", dateDebut: "2025-11-01", dateFin: "2026-01-31" });
    inviter("p-2025", MOI);
    faux.seances.push({ id: "a1", periodId: "p-2025", date: "2025-11-04", heureDebut: "20:00", annulee: false });
    presenteA("a1");
    const cr = await compteRendu(commeConnecte(MOI), SEUIL, MAINTENANT);
    // Sept depuis son arrivée, six sur le trimestre en cours : le cours annulé n'est dans ni l'un
    // ni l'autre, et les cours à venir non plus — s'inscrire n'est pas venir.
    expect(cr.moi.presencesToutesSaisons).toBe(7);
    expect(cr.moi.presences).toBe(6);
    // Une seule lecture, et une seule : c'est la 10e requête du contrat, pas deux
    expect(faux.appels.filter((a) => a === "attendance.count(moi)")).toHaveLength(1);
    // Et elle ne dit rien du club : le total collectif reste celui du trimestre
    expect(cr.groupe.presencesTotales).toBe(6);
  });

  it("ne va pas chercher ses présences de toujours sans trimestre : la lecture est gardée comme les autres", async () => {
    const cr = await compteRendu(commeConnecte(MOI), SEUIL, MAINTENANT);
    expect(cr.periode).toBeNull();
    expect(cr.moi.presencesToutesSaisons).toBe(0);
    expect(faux.appels).not.toContain("attendance.count(moi)");
  });

  /**
   * **Les blasons de créneau** : « Habituée du mardi » se gagne sur un mois plein, pas sur un total
   * de trimestre — d'où le **meilleur mois**, et non le mois courant : un titre acquis ne se reprend
   * pas parce qu'on a manqué décembre.
   *
   * Et **sans une requête de plus** : les dates sortent du parcours qui calcule déjà la série, sur
   * les « Présent » déjà chargés. Le contrat est donc rejoué ici, comme il l'a été pour la série en
   * cours et pour l'ancienneté.
   */
  it("compte ses présences du meilleur mois sur chaque soir de cours du club, sans une requête de plus", async () => {
    trimestreDeCreneaux();
    const cr = await compteRendu(commeConnecte(MOI), SEUIL, MAINTENANT);
    // Les deux soirs de cours sont **déduits des séances** du trimestre, jamais codés en dur : mardi
    // (2) et vendredi (5) au sens de `getUTCDay`, dans l'ordre de la semaine.
    expect(cr.moi.joursDeCours.map((j) => j.jour)).toEqual([2, 5]);
    // Trois mardis en août contre un en septembre : 3, et surtout pas les 4 du trimestre
    expect(cr.moi.joursDeCours[0].presences).toBe(3);
    // Deux vendredis en septembre, aucun en août
    expect(cr.moi.joursDeCours[1].presences).toBe(2);
    // Le mardi annulé n'a compté pour personne : six présences au compteur, pas sept
    expect(cr.moi.presencesToutesSaisons).toBe(6);
    expect(faux.appels).toHaveLength(10);
    // Les deux chiffres sortent du même passage que la série : une seule lecture de ses présences
    expect(faux.appels.filter((a) => a === "attendance.findMany(moi)")).toHaveLength(1);
  });

  it("ne prête aucun créneau à qui n'est venue à aucun mardi ni à aucun vendredi", async () => {
    trimestreDeCreneaux();
    // Elle a tout décliné : aucune présence, donc aucun créneau — zéro, jamais NaN ni moins-un. Les
    // deux soirs du club restent les deux soirs du club : ce sont ses séances qui les disent, pas elle.
    faux.presences = [];
    for (const sessionId of ["m1", "v1", "m2"]) faux.presences.push({ userId: MOI.id, sessionId, statut: "ABSENT" });
    const cr = await compteRendu(commeConnecte(MOI), SEUIL, MAINTENANT);
    expect(cr.moi.joursDeCours).toEqual([
      { jour: 2, presences: 0 },
      { jour: 5, presences: 0 },
    ]);
    expect(cr.moi.presencesToutesSaisons).toBe(0);
  });

  it("tient en dix requêtes pour un membre comme pour un instructeur, treize pour un administrateur", async () => {
    trimestreEnCours();
    const cr = await compteRendu(commeConnecte(MOI), SEUIL, MAINTENANT);
    // Le club et le personnel sortent des deux mêmes `groupBy` : la bascule ne coûte rien
    expect(cr.groupe.presentsProchaine).toBe(1);
    expect(cr.moi.pourcentage).toBe(50);
    const attendues = [
      "attendance.groupBy",
      "attendance.groupBy",
      // Les lectures de la vue Personnel : ses présences du trimestre (une colonne, une personne —
      // aucun agrégat ne dit à **quels** cours elle est venue, donc aucune série ne s'en déduit) et
      // le compte de ses ateliers proposés, ajoutées ; puis, ses présences depuis son arrivée.
      // Elles partent pour tout le monde parce qu'elles ne parlent que de qui les déclenche, et le
      // contrat les chiffre au lieu de les laisser passer : sept requêtes sont devenues neuf, puis
      // dix.
      "attendance.findMany(moi)",
      "atelier.count(moi)",
      "attendance.count(moi)",
      "evenement.findMany",
      "period.findFirst",
      "period.findUnique",
      "periodMember.findMany",
      "session.findMany",
    ].sort();
    expect(faux.appels.slice().sort()).toEqual(attendues);
    expect(faux.appels).toHaveLength(10);
    // La troisième vue n'existant pas pour lui, un instructeur ne paie pas la file des ateliers
    faux.appels = [];
    await compteRendu(commeConnecte(INSTRU), SEUIL, MAINTENANT);
    expect(faux.appels.slice().sort()).toEqual(attendues);
    faux.appels = [];
    await compteRendu(commeConnecte(ADMIN), SEUIL, MAINTENANT);
    // Treize : taux de réponse, silencieux, effectif invité, cours sans programme, frise du mois,
    // tendance, moyennes par jour, assiduité et « jamais venus » se déduisent tous des cartes et
    // des deux agrégats déjà chargés. Seules trois lectures sont propres au bureau et ne se
    // devinent pas autrement — la file des ateliers, les liens jamais ouverts et les présences
    // nominatives de tout le club (sans lesquelles ni une série ni un décrochage ne se lisent).
    // Les dates d'arrivée en ont fait partie une demi-journée : elles sont déjà comptées par
    // `statsPeriode`, qui en tire le nombre de cours de chacun.
    expect(faux.appels).toHaveLength(13);
    expect(faux.appels.filter((a) => a === "atelier.count")).toHaveLength(1);
    // Les liens dormants ont changé de forme (un `findMany` qui nomme les gens, au même `where`)
    // et **pas de nombre** : c'est tout l'intérêt, la bulle des noms n'a rien coûté.
    expect(faux.appels.filter((a) => a === "invitation.findMany")).toHaveLength(1);
    expect(faux.appels.filter((a) => a === "attendance.findMany")).toHaveLength(1);
    // …et il paie aussi les trois lectures personnelles, comme tout le monde : elles ne sont pas
    // fondues dans celles du bureau, qui portent sur le club entier et ne sauraient pas répondre
    // pour lui seul.
    expect(faux.appels.filter((a) => a === "attendance.findMany(moi)")).toHaveLength(1);
    expect(faux.appels.filter((a) => a === "atelier.count(moi)")).toHaveLength(1);
    expect(faux.appels.filter((a) => a === "attendance.count(moi)")).toHaveLength(1);
  });

  /**
   * **L'effectif invité du trimestre ne dépend pas de ce qu'il lui reste à jouer.**
   *
   * Il se lisait sur le premier cours à venir. En fin de trimestre, quand il n'en reste plus un
   * seul, il retombait à zéro — et la tuile « La salle » annonçait « 7 sur 0 », c'est-à-dire une
   * moyenne de présents rapportée à personne.
   */
  it("garde l'effectif invité quand il ne reste plus un seul cours à venir", async () => {
    faux.periodes.push({ id: "p-auto", nom: "T4 2026", statut: "ACTIVE", dateDebut: "2026-09-01", dateFin: "2026-09-20" });
    inviter("p-auto", MOI, { id: "u-charlie", prenom: "Charlie", nom: "Bernard" }, { id: "u-alice", prenom: "Alice", nom: "Colin" });
    // Deux cours, tous deux passés : le trimestre est joué, ses invités sont toujours trois.
    faux.seances.push(seance("s1", "2026-09-08"), seance("s2", "2026-09-15"));
    for (const userId of [MOI.id, "u-charlie"]) {
      faux.presences.push({ userId, sessionId: "s1", statut: "PRESENT" }, { userId, sessionId: "s2", statut: "PRESENT" });
    }
    const cr = await compteRendu(commeConnecte(ADMIN), SEUIL, MAINTENANT);
    expect(cr.admin?.prochainsCours).toBe(0);
    expect(cr.admin?.participationMoyenne).toBe(2);
    // C'est le second nombre de la tuile : « 2 sur 3 », et jamais « 2 sur 0 »
    expect(cr.admin?.invites).toBe(3);
    // La vue Club dit exactement le même effectif : les deux ne peuvent plus se contredire
    expect(cr.groupe.invites).toBe(3);
  });

  /**
   * **Les cours d'avant l'arrivée de quelqu'un ne comptent pas contre lui.**
   *
   * « Jamais venus » est une liste d'appel : le bureau décroche son téléphone. Une personne
   * inscrite à la Toussaint y entrait dès son inscription, pour des cours de septembre auxquels
   * elle n'était pas invitée — le pire message possible pour une recrue.
   */
  it("ne compte pas « jamais venu » quelqu'un inscrit après les cours déjà passés", async () => {
    trimestreEnCours();
    const inga = { id: "u-inga", prenom: "Inga", nom: "Vidal" };
    // Elle arrive le 20 septembre : s1 (le 8) et s2 (le 15) sont derrière elle, et il ne reste
    // aucun cours passé à son nom.
    inviterLe("p-auto", new Date("2026-09-20T10:00:00Z"), inga);
    const cr = await compteRendu(commeConnecte(ADMIN), SEUIL, MAINTENANT);
    expect(cr.admin?.jamaisVenus).toBe(0);
    expect(cr.admin?.jamaisVenusNoms).toEqual([]);
  });

  it("compte « jamais venu » dès qu'un cours a eu lieu depuis son arrivée", async () => {
    trimestreEnCours();
    const inga = { id: "u-inga", prenom: "Inga", nom: "Vidal" };
    // Arrivée le 10 : le cours du 15 lui était bien proposé, et elle n'y est pas venue.
    inviterLe("p-auto", new Date("2026-09-10T10:00:00Z"), inga);
    const cr = await compteRendu(commeConnecte(ADMIN), SEUIL, MAINTENANT);
    expect(cr.admin?.jamaisVenusNoms).toEqual(["Inga Vidal"]);
  });

  /**
   * **« Jamais venu », c'est « aucune présence alors qu'il a eu des cours » — et le nombre de ses
   * cours, le tableau de bord le rend déjà.**
   *
   * La tuile a été corrigée deux fois, aux deux bouts : `statsPeriode` a appris à borner le
   * dénominateur personnel à la date d'arrivée (`membres[].seances`), et l'accueil, de son côté,
   * relisait les dates d'arrivée pour refaire exactement le même calcul — `passees.some((s) =>
   * s.date >= arrivee)`, qui n'est rien d'autre que `seances > 0`. Une requête, une Map et une
   * condition pour un chiffre déjà en mémoire.
   *
   * Ce test tient les deux bouts de la simplification : la tuile dit toujours la même chose (les
   * deux cas d'Inga, juste au-dessus, n'ont pas bougé) **et** le bureau redescend à treize
   * requêtes. Si quelqu'un remet un jour une lecture des dates d'arrivée ici, le compte le dira.
   */
  it("déduit « jamais venu » du tableau de bord, sans relire les dates d'arrivée", async () => {
    trimestreEnCours();
    inviterLe("p-auto", new Date("2026-09-20T10:00:00Z"), { id: "u-inga", prenom: "Inga", nom: "Vidal" });
    inviterLe("p-auto", new Date("2026-09-10T10:00:00Z"), { id: "u-dorian", prenom: "Dorian", nom: "Faure" });
    const cr = await compteRendu(commeConnecte(ADMIN), SEUIL, MAINTENANT);
    // Inga n'a encore eu aucun cours à honorer ; Dorian en a eu un, et n'est pas venu.
    expect(cr.admin?.jamaisVenusNoms).toEqual(["Dorian Faure"]);
    // La lecture des dates d'arrivée n'a plus lieu d'être : treize requêtes, et pas quatorze.
    expect(faux.appels).not.toContain("periodMember.findMany(arrivees)");
    expect(faux.appels).toHaveLength(13);
    // L'équivalence, écrite : la tuile ne nomme que des membres dont le trimestre a compté des
    // cours — exactement ce que `statsPeriode` met dans `seances`.
    const jamais = new Set(cr.admin?.jamaisVenusNoms ?? []);
    expect(jamais.size).toBe(cr.admin?.jamaisVenus);
  });

  /**
   * **Le soir d'un cours, les deux compteurs de présence disent la même chose.**
   *
   * Celui du trimestre lit `seanceCommencee` (donc l'heure de début) ; celui de la saison
   * s'arrêtait à « avant aujourd'hui ». À 21 h, un cours de 20 h avait donc avancé l'un et pas
   * l'autre, côte à côte sur le même écran.
   */
  it("compte le cours du soir même dans les présences de toute la saison", async () => {
    faux.periodes.push({ id: "p-auto", nom: "T4 2026", statut: "ACTIVE", dateDebut: "2026-09-01", dateFin: "2026-12-20" });
    inviter("p-auto", MOI);
    // Le cours de 20 h du jour même : à 22 h (heure de Paris), il a eu lieu.
    faux.seances.push(seance("s-ce-soir", "2026-09-22"));
    faux.presences.push({ userId: MOI.id, sessionId: "s-ce-soir", statut: "PRESENT" });
    const cr = await compteRendu(commeConnecte(MOI), SEUIL, new Date("2026-09-22T20:30:00Z"));
    expect(cr.seancesPassees).toBe(1);
    expect(cr.moi.presences).toBe(1);
    // Le compteur de la saison suit exactement le même cours : il ne reste plus une soirée en retard
    expect(cr.moi.presencesToutesSaisons).toBe(1);
  });

  it("ne compte pas un cours du jour qui n'a pas encore commencé", async () => {
    faux.periodes.push({ id: "p-auto", nom: "T4 2026", statut: "ACTIVE", dateDebut: "2026-09-01", dateFin: "2026-12-20" });
    inviter("p-auto", MOI);
    faux.seances.push(seance("s-ce-soir", "2026-09-22"));
    faux.presences.push({ userId: MOI.id, sessionId: "s-ce-soir", statut: "PRESENT" });
    // 14 h à Paris : le cours de 20 h est annoncé, pas encore donné. S'inscrire n'est pas venir.
    const cr = await compteRendu(commeConnecte(MOI), SEUIL, new Date("2026-09-22T12:00:00Z"));
    expect(cr.seancesPassees).toBe(0);
    expect(cr.moi.presencesToutesSaisons).toBe(0);
  });
});
