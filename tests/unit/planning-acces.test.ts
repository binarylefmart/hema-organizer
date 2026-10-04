import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserLike } from "@/lib/permissions";

/**
 * Qui a le droit de voir quoi sur le planning.
 *
 * Deux verrous, tous deux côté serveur :
 * 1. **l'appartenance** — le planning d'un trimestre ne s'ouvre qu'à ses invités (l'équipe voit tout).
 *    Un identifiant de période recopié dans l'URL ne doit pas livrer la liste nominative des présents ;
 * 2. **les listes de choix** — l'annuaire du club (prénom, nom, rôle) et les ateliers en attente avec
 *    le nom de leur proposant ne servent qu'à remplir une case. Ils ne partent donc pas dans la page
 *    de qui ne peut pas écrire, même si le sélecteur ne lui est de toute façon pas affiché :
 *    c'est ce que `members.view` (bureau seul) est censée fermer.
 *
 * La base n'est jamais touchée : `@/lib/db` est remplacé par un faux client qui journalise les appels.
 */

type Appel = { modele: string; operation: string; args: Record<string, unknown> };

const { appels, reponses, fauxDb } = vi.hoisted(() => {
  const appels: Appel[] = [];
  const reponses = new Map<string, unknown>();
  const parDefaut = (operation: string) => (operation === "findMany" ? [] : null);
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
                return prete === undefined ? parDefaut(operation) : prete;
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

const MAINTENANT = new Date("2026-09-22T12:00:00Z");
const PERIODE = "p1";

const MEMBRE_INVITE: UserLike & { id: string } = { id: "u-invite", role: "MEMBRE" };
const MEMBRE_ETRANGER: UserLike & { id: string } = { id: "u-etranger", role: "MEMBRE" };
const INSTRUCTEUR: UserLike & { id: string } = { id: "u-instructeur", role: "INSTRUCTEUR" };

const appelsDe = (modele: string, operation?: string): Appel[] => appels.filter((a) => a.modele === modele && (!operation || a.operation === operation));

/** Période telle que `chargerPlanning` la lit : un seul invité, une séance, aucune case remplie. */
function periodeEnBase(statut = "ACTIVE") {
  reponses.set("period.findUnique", {
    id: PERIODE,
    nom: "T4 2026",
    dateDebut: "2026-09-01",
    dateFin: "2026-12-20",
    statut,
    membres: [{ user: { id: MEMBRE_INVITE.id, prenom: "Chloé", nom: "Arnaud" } }],
    sessions: [
      {
        id: "s1",
        date: "2026-10-06",
        heureDebut: "20:00",
        heureFin: "22:00",
        lieu: "Villebourg",
        annulee: false,
        motifAnnulation: null,
        parties: [],
        attendances: [{ userId: MEMBRE_INVITE.id, statut: "PRESENT" }],
      },
    ],
  });
}

beforeEach(() => {
  appels.length = 0;
  reponses.clear();
  periodeEnBase();
  // L'annuaire et les propositions en attente, tels qu'ils seraient servis à qui peut écrire
  reponses.set("user.findMany", [{ id: "u-instructeur", prenom: "Marion", nom: "Ibert", role: "INSTRUCTEUR", couleur: 3 }]);
  reponses.set("atelier.findMany", [{ id: "a1", titre: "Dague", sessionId: null, proposePar: { prenom: "Chloé", nom: "Arnaud" } }]);
});

describe("chargerPlanning : appartenance à la période", () => {
  it("refuse le planning d'un trimestre où le membre n'est pas invité", async () => {
    const { chargerPlanning } = await import("@/lib/planning");
    expect(await chargerPlanning(PERIODE, MEMBRE_ETRANGER, MAINTENANT)).toBeNull();
  });

  it("ne laisse fuir aucun nom de présent au passage", async () => {
    const { chargerPlanning } = await import("@/lib/planning");
    const planning = await chargerPlanning(PERIODE, MEMBRE_ETRANGER, MAINTENANT);
    expect(planning).toBeNull();
    // Rien d'autre n'a été chargé : le refus tombe avant l'annuaire et les propositions
    expect(appelsDe("user", "findMany")).toHaveLength(0);
    expect(appelsDe("atelier", "findMany")).toHaveLength(0);
  });

  it("ouvre le planning au membre invité", async () => {
    const { chargerPlanning } = await import("@/lib/planning");
    const planning = await chargerPlanning(PERIODE, MEMBRE_INVITE, MAINTENANT);
    expect(planning?.periode.nom).toBe("T4 2026");
    expect(planning?.colonnes[0].presents).toEqual(["Chloé Arnaud"]);
  });

  it("ouvre le planning à l'équipe, même sans invitation sur la période", async () => {
    const { chargerPlanning } = await import("@/lib/planning");
    expect(await chargerPlanning(PERIODE, INSTRUCTEUR, MAINTENANT)).not.toBeNull();
  });
});

describe("chargerPlanning : listes de choix réservées à qui peut écrire", () => {
  it("ne donne au membre invité ni l'annuaire ni les propositions en attente", async () => {
    const { chargerPlanning } = await import("@/lib/planning");
    const planning = await chargerPlanning(PERIODE, MEMBRE_INVITE, MAINTENANT);
    expect(planning?.personnes).toEqual([]);
    expect(planning?.ateliersDisponibles).toEqual([]);
    // Et elles ne sont même pas lues en base : rien à oublier de filtrer plus loin
    expect(appelsDe("user", "findMany")).toHaveLength(0);
    expect(appelsDe("atelier", "findMany")).toHaveLength(0);
  });

  it("les donne à l'encadrement, qui remplit les cases", async () => {
    const { chargerPlanning } = await import("@/lib/planning");
    const planning = await chargerPlanning(PERIODE, INSTRUCTEUR, MAINTENANT);
    expect(planning?.modifiable).toBe(true);
    expect(planning?.personnes.map((p) => p.id)).toEqual(["u-instructeur"]);
    expect(planning?.ateliersDisponibles.map((a) => a.proposePar)).toEqual(["Chloé Arnaud"]);
  });

  it("les retire aussi à l'encadrement sur un trimestre clos (plus rien à écrire)", async () => {
    periodeEnBase("CLOSE");
    const { chargerPlanning } = await import("@/lib/planning");
    const planning = await chargerPlanning(PERIODE, INSTRUCTEUR, MAINTENANT);
    expect(planning?.modifiable).toBe(false);
    expect(planning?.personnes).toEqual([]);
    expect(planning?.ateliersDisponibles).toEqual([]);
  });
});

describe("optionsDepuis : ce que la grille remet aux cases", () => {
  const base = {
    periode: { id: PERIODE, nom: "T4 2026", dateDebut: "2026-09-01", dateFin: "2026-12-20", statut: "ACTIVE" },
    colonnes: [],
    mois: [],
    personnes: [{ id: "u-instructeur", prenom: "Marion", nom: "Ibert", role: "INSTRUCTEUR", couleur: 3 }],
    themes: ["Messer"],
    ateliersDisponibles: [{ id: "a1", titre: "Dague", proposePar: "Chloé Arnaud", sessionId: null }],
  };

  it("vide les listes de choix en lecture seule (ceinture et bretelles)", async () => {
    const { optionsDepuis } = await import("@/components/planning/options");
    const o = optionsDepuis({ ...base, modifiable: false, peutProgrammer: false });
    expect(o.personnes).toEqual([]);
    expect(o.ateliersDisponibles).toEqual([]);
    // Les thèmes ne nomment personne : ils restent
    expect(o.themes).toEqual(["Messer"]);
  });

  it("les garde dès que la personne peut écrire dans une case", async () => {
    const { optionsDepuis } = await import("@/components/planning/options");
    const o = optionsDepuis({ ...base, modifiable: true, peutProgrammer: false });
    expect(o.personnes).toHaveLength(1);
    expect(o.ateliersDisponibles).toHaveLength(1);
  });

  it("les garde aussi pour qui ne fait que programmer un atelier", async () => {
    const { optionsDepuis } = await import("@/components/planning/options");
    const o = optionsDepuis({ ...base, modifiable: false, peutProgrammer: true });
    expect(o.ateliersDisponibles).toHaveLength(1);
  });
});

describe("periodePlanningParDefaut", () => {
  it("ne propose au membre que les trimestres où il est invité", async () => {
    const { periodePlanningParDefaut } = await import("@/lib/planning");
    await periodePlanningParDefaut(MEMBRE_ETRANGER, MAINTENANT);
    const filtres = appelsDe("period", "findFirst").map((a) => a.args.where);
    expect(filtres.length).toBeGreaterThan(0);
    for (const where of filtres) expect(where).toMatchObject({ membres: { some: { userId: MEMBRE_ETRANGER.id } } });
  });

  it("laisse l'équipe atteindre n'importe quel trimestre", async () => {
    const { periodePlanningParDefaut } = await import("@/lib/planning");
    await periodePlanningParDefaut(INSTRUCTEUR, MAINTENANT);
    for (const a of appelsDe("period", "findFirst")) expect(JSON.stringify(a.args.where ?? {})).not.toContain("membres");
  });
});

describe("seancesAVenir", () => {
  it("ne propose au membre que les séances des trimestres où il est invité", async () => {
    const { seancesAVenir } = await import("@/lib/ateliers-queries");
    await seancesAVenir(MEMBRE_ETRANGER);
    const where = appelsDe("session", "findMany")[0].args.where as { period: Record<string, unknown> };
    expect(where.period).toMatchObject({ membres: { some: { userId: MEMBRE_ETRANGER.id } }, statut: { not: "CLOSE" } });
  });

  it("laisse l'équipe voir toutes les séances à venir", async () => {
    const { seancesAVenir } = await import("@/lib/ateliers-queries");
    await seancesAVenir(INSTRUCTEUR);
    const where = appelsDe("session", "findMany")[0].args.where as { period: Record<string, unknown> };
    expect(where.period).not.toHaveProperty("membres");
  });
});
