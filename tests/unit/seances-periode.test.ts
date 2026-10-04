import { beforeEach, describe, expect, it, vi } from "vitest";
import { seanceCarte, seancesDePeriode } from "@/lib/seances";
import type { UserLike } from "@/lib/permissions";

/**
 * Cartes d'une période entière : une seule requête pour toutes les séances (plus de N+1),
 * même contenu et même ordre qu'avec l'ancien chargement séance par séance,
 * et invitation revérifiée dans le helper (pas seulement par l'appelant).
 */

type Personne = { id: string; prenom: string; nom: string; couleur: number | null };

const ALICE: Personne = { id: "u-alice", prenom: "Alice", nom: "Durand", couleur: 1 };
const CHARLIE: Personne = { id: "u-charlie", prenom: "Charlie", nom: "03", couleur: 2 };

const faux = vi.hoisted(() => ({
  /** Séances brutes, telles que Prisma les renvoie avec l'include des cartes */
  seances: [] as Record<string, unknown>[],
  /** Invités par période */
  membres: {} as Record<string, string[]>,
  appels: { findMany: [] as unknown[], findUnique: [] as unknown[] },
}));

/** Filtre Prisma minimal : uniquement les clauses utilisées par les requêtes de cartes. */
function correspond(s: Record<string, unknown>, where: Record<string, unknown> = {}): boolean {
  if (where.id !== undefined && s.id !== where.id) return false;
  if (where.periodId !== undefined && s.periodId !== where.periodId) return false;
  const invite = (where.period as { membres?: { some?: { userId?: string } } } | undefined)?.membres?.some?.userId;
  if (invite !== undefined && !(faux.membres[s.periodId as string] ?? []).includes(invite)) return false;
  return true;
}

vi.mock("@/lib/db", () => ({
  db: {
    session: {
      findMany: vi.fn(async (args: { where?: Record<string, unknown>; orderBy?: unknown }) => {
        faux.appels.findMany.push(args);
        return faux.seances
          .filter((s) => correspond(s, args.where))
          .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.heureDebut).localeCompare(String(b.heureDebut)));
      }),
      findUnique: vi.fn(async (args: { where: Record<string, unknown> }) => {
        faux.appels.findUnique.push(args);
        return faux.seances.find((s) => correspond(s, args.where)) ?? null;
      }),
    },
    // La liste nominative des invités est lue une fois par période (plus une fois par carte) :
    // elle vient de la table des membres de période, pas de la relation de chaque séance.
    periodMember: {
      findMany: vi.fn(async (args: { where: { periodId: { in: string[] } } }) =>
        args.where.periodId.in.flatMap((periodId) => {
          const source = faux.seances.find((s) => s.periodId === periodId) as { period?: { membres?: Array<{ user: unknown }> } } | undefined;
          return (source?.period?.membres ?? []).map(({ user }) => ({ periodId, user }));
        }),
      ),
    },
  },
}));

/** Séance brute, avec le contenu que la carte affiche (invités, instructeur, atelier, réponses). */
function seance(id: string, periodId: string, date: string, heureDebut: string, invites: Personne[]) {
  return {
    id,
    periodId,
    date,
    heureDebut,
    heureFin: "22:00",
    lieu: "Villebourg",
    adresse: "Salle des fêtes",
    disciplines: "Épée longue",
    theme: "Garde haute",
    alternative: "Dague",
    annulee: false,
    motifAnnulation: null,
    period: { nom: "T1 2026-2027", membres: invites.map((user) => ({ user })) },
    instructeurs: [{ user: { id: CHARLIE.id, prenom: CHARLIE.prenom, nom: CHARLIE.nom } }],
    parties: [
      {
        id: "c1",
        ordre: 0,
        libelle: "Cours 1",
        estOption: false,
        theme: "Garde haute",
        instructeurId: CHARLIE.id,
        instructeur: { prenom: CHARLIE.prenom, nom: CHARLIE.nom },
        instructeurSecondId: null,
        instructeurSecond: null,
        atelier: null,
      },
    ],
    ateliers: [{ id: "a-1", titre: "Jeu de jambes", proposePar: { prenom: ALICE.prenom, nom: ALICE.nom } }],
    attendances: [{ userId: ALICE.id, statut: "PRESENT" }],
  };
}

const MEMBRE: UserLike & { id: string } = { id: ALICE.id, role: "MEMBRE", actif: true };
const INSTRUCTEUR: UserLike & { id: string } = { id: CHARLIE.id, role: "INSTRUCTEUR", actif: true };
const MAINTENANT = new Date("2026-09-20T12:00:00Z");

beforeEach(() => {
  // Dates volontairement mélangées : le tri est celui du helper, pas celui de la source
  faux.seances = [
    seance("s-3", "p-1", "2026-10-13", "20:00", [ALICE, CHARLIE]),
    seance("s-1", "p-1", "2026-10-06", "18:00", [ALICE, CHARLIE]),
    seance("s-2", "p-1", "2026-10-06", "20:00", [ALICE, CHARLIE]),
    seance("s-x", "p-2", "2026-10-07", "20:00", [CHARLIE]),
  ];
  faux.membres = { "p-1": [ALICE.id, CHARLIE.id], "p-2": [CHARLIE.id] };
  faux.appels = { findMany: [], findUnique: [] };
});

describe("séances d'une période", () => {
  it("charge N séances en une seule requête", async () => {
    const cartes = await seancesDePeriode("p-1", MEMBRE, MAINTENANT);
    expect(cartes).toHaveLength(3);
    expect(faux.appels.findMany).toHaveLength(1);
    expect(faux.appels.findUnique).toHaveLength(0);
  });

  it("rend exactement les mêmes cartes, dans le même ordre, que le chargement séance par séance", async () => {
    const parPeriode = await seancesDePeriode("p-1", MEMBRE, MAINTENANT);
    faux.appels = { findMany: [], findUnique: [] };
    // Ancien chemin : un appel par séance (l'ordre venait déjà de la date puis de l'heure de début)
    const ids = ["s-1", "s-2", "s-3"];
    const uneAUne = await Promise.all(ids.map((id) => seanceCarte(id, MEMBRE, MAINTENANT)));
    expect(faux.appels.findUnique).toHaveLength(3);
    expect(parPeriode).toEqual(uneAUne);
    expect(parPeriode.map((c) => c.id)).toEqual(ids);
  });

  it("remplit la carte comme avant : invités, instructeurs, ateliers, compteurs et statut personnel", async () => {
    const [carte] = await seancesDePeriode("p-1", MEMBRE, MAINTENANT);
    expect(carte.periodNom).toBe("T1 2026-2027");
    expect(carte.instructeurs).toEqual([{ id: CHARLIE.id, prenom: CHARLIE.prenom, nom: CHARLIE.nom }]);
    expect(carte.ateliers).toEqual([{ id: "a-1", titre: "Jeu de jambes", animateur: "Alice Durand" }]);
    expect(carte.programme[0]).toMatchObject({ libelle: "Cours 1", ordre: 0, theme: "Garde haute", instructeur: "Charlie 03" });
    expect(carte.monStatut).toBe("PRESENT");
    expect(carte.inscrit).toBe(true);
    expect(carte.compteurs.presents).toBe(1);
    expect(carte.participants.presents.map((p) => p.id)).toEqual([ALICE.id]);
    expect(carte.participants.sansReponse.map((p) => p.id)).toEqual([CHARLIE.id]);
    expect(carte.commencee).toBe(false);
  });

  it("ne renvoie rien sur une période où la personne n'est pas invitée", async () => {
    expect(await seancesDePeriode("p-2", MEMBRE, MAINTENANT)).toEqual([]);
    // La garantie est dans la requête, pas dans un filtre de l'appelant
    expect(faux.appels.findMany[0]).toMatchObject({ where: { periodId: "p-2", period: { membres: { some: { userId: ALICE.id } } } } });
  });

  it("laisse l'équipe voir une période où elle n'est pas invitée", async () => {
    // Un membre **du bureau** qui n'enseigne pas : rôle de base `MEMBRE`, `estAdmin` par-dessus.
    // C'est donc bien le supplément qui lui ouvre la vue d'équipe, et l'instructeur vérifié deux
    // lignes plus bas tient l'autre moitié de la règle.
    const staff: UserLike & { id: string } = { id: "u-admin", role: "MEMBRE", estAdmin: true, actif: true };
    const cartes = await seancesDePeriode("p-2", staff, MAINTENANT);
    expect(cartes.map((c) => c.id)).toEqual(["s-x"]);
    expect(faux.appels.findMany[0]).toEqual(expect.objectContaining({ where: { periodId: "p-2" } }));
    // Un instructeur invité nulle part voit lui aussi la période, sans y être inscrit
    const vuInstructeur = await seancesDePeriode("p-1", INSTRUCTEUR, MAINTENANT);
    expect(vuInstructeur).toHaveLength(3);
    expect((await seancesDePeriode("p-2", staff, MAINTENANT))[0].inscrit).toBe(false);
  });

  it("trie par date puis par heure de début", async () => {
    const cartes = await seancesDePeriode("p-1", MEMBRE, MAINTENANT);
    expect(cartes.map((c) => `${c.date} ${c.heureDebut}`)).toEqual(["2026-10-06 18:00", "2026-10-06 20:00", "2026-10-13 20:00"]);
    expect(faux.appels.findMany[0]).toMatchObject({ orderBy: [{ date: "asc" }, { heureDebut: "asc" }] });
  });
});
