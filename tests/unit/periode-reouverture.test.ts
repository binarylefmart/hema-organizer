import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **Rouvrir un trimestre clos** — le geste inverse de la clôture.
 *
 * Ce qui est vérifié ici, c'est surtout ce que la réouverture **ne fait pas** : aucun email ne part,
 * ni tout de suite, ni au balayage du lendemain matin, et personne ne se retrouve avec deux liens
 * vivants. Trois garde-fous s'en chargent, et ce sont eux que le fichier tient : on ne remet en
 * service que les liens **encore valables** et **fermés par la clôture**, un seul par personne (et
 * aucun à qui a déjà une clé), et un trimestre déjà commencé sort de la file des premiers envois.
 *
 * Le tri des liens vit dans `remettreEnServiceLiensDeCloture` (src/lib/invitations.ts) : le faux
 * client Prisma sert donc une vraie table en mémoire plutôt que des `count` décidés d'avance, et
 * les assertions portent sur **l'état des liens après le geste**. Simuler la fonction reviendrait à
 * ne tester que le message affiché.
 */

const faux = vi.hoisted(() => {
  type Lien = {
    id: string;
    userId: string;
    periodId: string;
    motifRevocation: string | null;
    revokedAt: Date | null;
    expiresAt: Date;
    createdAt: Date;
  };

  /** Le morceau de Prisma dont la vraie fonction se sert, et rien de plus : égalité, `gt`, `in`. */
  const correspond = (lien: Lien, where: Record<string, unknown>) =>
    Object.entries(where).every(([champ, attendu]) => {
      const valeur = lien[champ as keyof Lien];
      if (attendu && typeof attendu === "object" && !(attendu instanceof Date)) {
        const operateur = attendu as { gt?: Date; in?: unknown[] };
        if (operateur.gt !== undefined) return valeur instanceof Date && valeur > operateur.gt;
        if (operateur.in !== undefined) return operateur.in.includes(valeur);
        throw new Error(`filtre non simulé par ce test : ${JSON.stringify(attendu)}`);
      }
      return valeur === attendu;
    });

  return {
    // `role` ne vaut plus « ADMIN » : rôle de base + `estAdmin` par-dessus. INSTRUCTEUR exprès —
    // `periods.manage` n'est ouverte à aucun instructeur, donc ce qui aboutit ici ne passe que par
    // `estAdmin`, jamais par le repli `role === "ADMIN"` de `can()`.
    acteur: { id: "u-admin", email: "delta@club.test", role: "INSTRUCTEUR", estAdmin: true, actif: true } as { id: string; email: string; role: string; estAdmin: boolean; actif: boolean },
    periode: {} as Record<string, unknown>,
    majPeriode: [] as Array<{ where: unknown; data: Record<string, unknown> }>,
    liens: [] as Lien[],
    /** Nombre d'écritures sur la table des liens : un refus ne doit en faire aucune. */
    ecrituresLiens: 0,
    audits: [] as Array<{ action: string; cible: string | null; details: unknown }>,
    correspond,
  };
});

type Lien = (typeof faux.liens)[number];

vi.mock("@/lib/db", () => ({
  db: {
    period: {
      findUniqueOrThrow: vi.fn(async () => faux.periode),
      update: vi.fn(async ({ where, data }: { where: unknown; data: Record<string, unknown> }) => {
        faux.majPeriode.push({ where, data });
        return faux.periode;
      }),
      findFirst: vi.fn(async () => null),
    },
    invitation: {
      findMany: vi.fn(async ({ where, orderBy }: { where: Record<string, unknown>; orderBy?: { createdAt?: "asc" | "desc" } }) => {
        const trouves = faux.liens.filter((l) => faux.correspond(l, where));
        if (orderBy?.createdAt === "desc") trouves.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return trouves;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        faux.ecrituresLiens += 1;
        const touches = faux.liens.filter((l) => faux.correspond(l, where));
        for (const lien of touches) Object.assign(lien, data);
        return { count: touches.length };
      }),
    },
  },
}));

vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async (_a: unknown, action: string, cible: string | null, details: unknown) => {
    faux.audits.push({ action, cible, details });
  }),
}));

// `remettreEnServiceLiensDeCloture` reste la vraie : c'est elle que ce fichier met à l'épreuve.
vi.mock("@/lib/invitations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/invitations")>()),
  envoyerInvitation: vi.fn(async () => true),
  revokeInvitation: vi.fn(async () => {}),
}));

vi.mock("@/lib/auth/current-user", async () => {
  const { can } = await vi.importActual<typeof import("@/lib/permissions")>("@/lib/permissions");
  return {
    assertPermission: vi.fn(async (permission: Parameters<typeof can>[1]) => {
      if (!can(faux.acteur, permission)) throw new Error("Accès refusé");
      return faux.acteur;
    }),
    exigerReauth: vi.fn(async () => {}),
    getCurrentUser: vi.fn(async () => null),
  };
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECTION:${url}`);
  }),
}));

const { reactiverPeriode } = await import("@/actions/periodes");
const { envoyerInvitation } = await import("@/lib/invitations");

const JOUR = 24 * 60 * 60 * 1000;

/** Un trimestre clos, commencé il y a longtemps : le cas le plus courant d'une réouverture. */
function periodeClose(sur: Partial<Record<string, unknown>> = {}) {
  return { id: "p1", statut: "CLOSE", dateDebut: "2026-01-06", liensEnvoyesLe: new Date("2026-01-03"), ...sur };
}

/** Un lien fermé par la clôture et encore valable : celui que la réouverture doit rendre. */
function lienDeCloture(id: string, userId: string, sur: Partial<Lien> = {}): Lien {
  return {
    id,
    userId,
    periodId: "p1",
    motifRevocation: "CLOTURE",
    revokedAt: new Date("2026-04-30"),
    expiresAt: new Date(Date.now() + 60 * JOUR),
    createdAt: new Date("2026-01-03"),
    ...sur,
  };
}

/** Un lien vivant : ni révoqué, ni périmé. C'est ce qui interdit d'en rendre un second. */
function lienVivant(id: string, userId: string, sur: Partial<Lien> = {}): Lien {
  return lienDeCloture(id, userId, { motifRevocation: null, revokedAt: null, ...sur });
}

/** Les identifiants des liens vivants après le geste : l'état qui compte vraiment. */
const vivants = () => faux.liens.filter((l) => l.revokedAt === null && l.expiresAt > new Date()).map((l) => l.id);

beforeEach(() => {
  vi.mocked(envoyerInvitation).mockClear();
  faux.acteur = { id: "u-admin", email: "delta@club.test", role: "INSTRUCTEUR", estAdmin: true, actif: true };
  faux.periode = periodeClose();
  faux.majPeriode = [];
  faux.liens = Array.from({ length: 12 }, (_, i) => lienDeCloture(`i-${i + 1}`, `u-${i + 1}`));
  faux.ecrituresLiens = 0;
  faux.audits = [];
});

describe("rouvrir une période close", () => {
  it("la remet en ACTIVE, rend les liens et journalise le geste, sans qu'aucun email ne parte", async () => {
    const res = await reactiverPeriode("p1");
    expect(faux.majPeriode[0].data.statut).toBe("ACTIVE");
    expect(res.succes).toContain("12 liens");
    expect(vivants()).toHaveLength(12);
    expect(faux.audits).toEqual([{ action: "periode.reactivee", cible: "p1", details: { liensRemisEnService: 12, gardentLaLeur: 0, sansAcces: 0 } }]);
    expect(envoyerInvitation).not.toHaveBeenCalled();
  });

  /** La clôture avait révoqué les liens : la réouverture leur rend leur validité, sans email. */
  it("ne rend que les liens fermés par la clôture, et seulement s'ils sont encore valables", async () => {
    faux.liens = [
      lienDeCloture("i-valable", "u-1"),
      // Rendre un lien périmé ferait repartir un « lien renouvelé » à tout le club au balayage de 7 h
      lienDeCloture("i-perime", "u-2", { expiresAt: new Date(Date.now() - JOUR) }),
      // Révoqué à la main (départ du club, lien compromis) : la réouverture n'a pas à revenir dessus
      lienDeCloture("i-revoque-main", "u-3", { motifRevocation: "MANUEL" }),
    ];
    const res = await reactiverPeriode("p1");
    expect(res.succes).toContain("1 lien");
    expect(vivants()).toEqual(["i-valable"]);
    // Le lien périmé n'est pas rendu, et la personne qui le portait est comptée « sans accès » :
    // c'est elle, et elle seule, qu'il faudra servir à la main.
    expect(faux.audits[0].details).toEqual({ liensRemisEnService: 1, gardentLaLeur: 0, sansAcces: 1 });
  });

  /**
   * **L'invariant : une seule clé en circulation par personne**. Le plus vieux des deux liens dort
   * dans une boîte mail — souvent celle qu'on avait justement voulu fermer.
   */
  it("ne redonne jamais un second lien vivant à la même personne", async () => {
    faux.liens = [
      // Une clôture peut en avoir fermé deux d'un coup (renouvellement anticipé) : le récent gagne
      lienDeCloture("i-vieux", "u-1", { createdAt: new Date("2026-01-03") }),
      lienDeCloture("i-recent", "u-1", { createdAt: new Date("2026-03-01") }),
      // Cette personne a reçu un lien neuf depuis la clôture : son ancien reste fermé
      lienDeCloture("i-ancien", "u-2"),
      lienVivant("i-neuf", "u-2", { periodId: "p2", createdAt: new Date("2026-05-02") }),
    ];
    const res = await reactiverPeriode("p1");
    expect(res.succes).toContain("1 lien");
    expect(vivants().sort()).toEqual(["i-neuf", "i-recent"]);
    const parPersonne = faux.liens.filter((l) => vivants().includes(l.id)).map((l) => l.userId);
    expect(new Set(parPersonne).size).toBe(parPersonne.length);
  });

  /**
   * **Les deux zéros n'ont rien à voir l'un avec l'autre**. `remettreEnServiceLiensDeCloture` rend
   * `0` aussi bien quand les liens de la clôture ont expiré — personne n'a d'accès — que quand
   * chacun a déjà une clé vivante : il n'y avait rien à rendre, et tout va bien. Le message
   * affirmait le premier dans les deux cas, et enchaînait sur « Renvoyer les liens », geste qui
   * **révoque la clé de tout le monde** et écrit à tout le club : exactement ce que la réouverture
   * est faite d'éviter.
   */
  describe("les deux façons de ne rendre aucun lien", () => {
    it("liens périmés : le dit, et renvoie à l'envoi groupé — personne n'a de clé à perdre", async () => {
      faux.liens = faux.liens.map((l) => ({ ...l, expiresAt: new Date(Date.now() - JOUR) }));
      const res = await reactiverPeriode("p1");
      expect(res.succes).toContain("périmés");
      expect(res.succes).toContain("Renvoyer les liens");
      expect(vivants()).toEqual([]);
      expect(faux.ecrituresLiens).toBe(0);
      expect(faux.audits[0].details).toEqual({ liensRemisEnService: 0, gardentLaLeur: 0, sansAcces: 12 });
    });

    it("chacun a déjà une clé vivante : le dit, et ne renvoie surtout pas à l'envoi groupé", async () => {
      faux.liens = [
        // Sa clé de la clôture est encore valable, mais il en a reçu une plus récente entre-temps :
        // c'est celle-là qui vit, l'ancienne reste fermée.
        lienDeCloture("i-ancien", "u-1"),
        lienVivant("i-neuf", "u-1", { periodId: "p2", createdAt: new Date("2026-05-02") }),
      ];
      const res = await reactiverPeriode("p1");
      expect(res.succes).toContain("garde le lien plus récent");
      expect(res.succes).not.toContain("Renvoyer les liens");
      expect(res.succes).not.toContain("périmés");
      expect(vivants()).toEqual(["i-neuf"]);
      expect(faux.ecrituresLiens).toBe(0);
      expect(faux.audits[0].details).toEqual({ liensRemisEnService: 0, gardentLaLeur: 1, sansAcces: 0 });
    });

    it("cas mixte : ceux qui restent dehors sont renvoyés au lien de leur ligne, pas à l'envoi groupé", async () => {
      faux.liens = [
        lienDeCloture("i-rendu", "u-1"),
        lienDeCloture("i-perime", "u-2", { expiresAt: new Date(Date.now() - JOUR) }),
      ];
      const res = await reactiverPeriode("p1");
      expect(res.succes).toContain("1 lien personnel remis en service");
      expect(res.succes).toContain("« Renvoyer le lien » sur sa ligne");
      expect(res.succes).not.toContain("Renvoyer les liens");
      expect(faux.audits[0].details).toEqual({ liensRemisEnService: 1, gardentLaLeur: 0, sansAcces: 1 });
    });

    it("aucun lien fermé par la clôture : aucun conseil, aucun email", async () => {
      faux.liens = [];
      const res = await reactiverPeriode("p1");
      expect(res.succes).toContain("La clôture n'avait fermé aucun lien.");
      expect(res.succes).toContain("Aucun email n'est parti.");
      expect(faux.audits[0].details).toEqual({ liensRemisEnService: 0, gardentLaLeur: 0, sansAcces: 0 });
    });
  });

  /**
   * Le piège de la réouverture : un trimestre activé puis clos **avant** que ses liens ne partent.
   * Sans ce marquage, le balayage de 7 h enverrait le lendemain un premier lien à tout le club pour
   * un trimestre commencé depuis des semaines.
   */
  it("sort de la file des premiers envois un trimestre déjà commencé dont les liens n'étaient pas partis", async () => {
    faux.periode = periodeClose({ liensEnvoyesLe: null });
    await reactiverPeriode("p1");
    expect(faux.majPeriode[0].data.liensEnvoyesLe).toBeInstanceOf(Date);
  });

  it("laisse partir les liens d'un trimestre qui n'a pas encore commencé", async () => {
    faux.periode = periodeClose({ liensEnvoyesLe: null, dateDebut: "2099-01-06" });
    await reactiverPeriode("p1");
    expect(faux.majPeriode[0].data).toEqual({ statut: "ACTIVE" });
  });

  it("refuse une période qui n'est pas close, sans rien toucher", async () => {
    faux.periode = periodeClose({ statut: "ACTIVE" });
    const res = await reactiverPeriode("p1");
    expect(res.erreur).toBe("Cette période n'est pas close.");
    expect(faux.majPeriode).toEqual([]);
    expect(faux.ecrituresLiens).toBe(0);
    expect(vivants()).toEqual([]);
    expect(faux.audits).toEqual([]);
  });

  it("reste au bureau : un instructeur ne rouvre pas un trimestre", async () => {
    faux.acteur = { id: "u-i", email: "charlie@club.test", role: "INSTRUCTEUR", estAdmin: false, actif: true };
    await expect(reactiverPeriode("p1")).rejects.toThrow("Accès refusé");
    expect(faux.majPeriode).toEqual([]);
    expect(faux.ecrituresLiens).toBe(0);
  });
});
