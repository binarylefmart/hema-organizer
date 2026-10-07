import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkRateLimit, RATE_LIMITS, utiliserMagasinMemoire } from "@/lib/auth/rate-limit";
import { lignesSeance, texteSeance } from "@/lib/notifications/contenu";
import { compterPresences } from "@/lib/presences";
import {
  chiffresImage,
  dateEvenement,
  descriptionEvenement,
  descriptionPlanning,
  descriptionSeance,
  horaireEvenement,
  lignesEvenement,
  LIBELLE_ANNULEE,
  ligneSansPictogramme,
  lignesResume,
  MAX_SEANCES_PLANNING,
  titreResume,
  tronquer,
  type EvenementPartage,
  type SeancePartagee,
} from "@/lib/partage";

/**
 * **Partage public** (`/partage/seance/<id>`, `/partage/planning/<periodId>`).
 *
 * Deux promesses sont vérifiées ici :
 * 1. la page publique **ne réécrit pas** le résumé : elle reprend, ligne pour ligne, le contenu
 *    commun des notifications (`src/lib/notifications/contenu.ts`), pictogrammes remplacés par les
 *    icônes de l'application ;
 * 2. **rien de nominatif** ne sort de la base : les requêtes de `src/lib/partage.ts` ne
 *    sélectionnent aucune colonne qui porterait un nom, une adresse email ou un identifiant de
 *    personne — ce qui n'est pas lu ne peut pas fuir dans une mise en forme ultérieure.
 *
 * La base n'est jamais touchée : `@/lib/db` est remplacé par un faux client qui journalise les
 * appels et renvoie des réponses préparées (même procédé que `perf-requetes.test.ts`).
 */

type Appel = { modele: string; operation: string; args: Record<string, unknown> };

const { appels, reponses, fauxDb } = vi.hoisted(() => {
  const appels: Array<{ modele: string; operation: string; args: Record<string, unknown> }> = [];
  const reponses = new Map<string, unknown>();
  const parDefaut = (operation: string) => (operation === "findMany" || operation === "groupBy" ? [] : operation === "count" ? 0 : null);
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

const MAINTENANT = new Date("2026-09-23T12:00:00Z");
const PERIODE = { id: "p1", nom: "Rentrée 2026", statut: "ACTIVE" };

const SEANCE: SeancePartagee = {
  id: "s1",
  date: "2026-09-24",
  heureDebut: "19:30",
  heureFin: "21:30",
  lieu: "Gymnase municipal",
  adresse: "1 rue des Lices, 00000 Villebourg",
  theme: "Messer — garde haute",
  alternative: "",
  disciplines: "Messer",
  annulee: false,
  motifAnnulation: null,
  compteurs: compterPresences([...Array(13).fill("PRESENT"), ...Array(3).fill("ABSENT")], 18),
  programme: [{ ordre: 0, bloc: 1, nature: "COURS", nom: "Cours", teinte: 1, libelle: "Partie 1 · Cours", theme: "Messer", description: "", niveau: "INDIFFERENT", atelier: false }],
  periode: PERIODE,
};

const ANNULEE: SeancePartagee = { ...SEANCE, annulee: true, motifAnnulation: "Salle indisponible" };

/** Lignes brutes du seul module de mise en forme autorisé, pour comparaison. */
const lignesCommunes = (s: SeancePartagee) => lignesSeance(s, { presents: s.compteurs.presents, invites: s.compteurs.invites });

beforeEach(() => {
  appels.length = 0;
  reponses.clear();
});

/* ------------------------------------------------------------------ */
/* Mise en forme : le contenu commun, sans emoji dans l'interface      */
/* ------------------------------------------------------------------ */

describe("résumé public d'une séance", () => {
  it("reprend exactement les lignes du contenu commun, pictogramme remplacé par une icône", () => {
    expect(lignesResume(SEANCE)).toEqual([
      { icone: "calendrier", texte: "Jeudi 24 septembre 2026 — 19h30 à 21h30" },
      { icone: "lieu", texte: "Gymnase municipal" },
      { icone: "livre", texte: "Messer — garde haute" },
      { icone: "groupe", texte: "13 présents / 18 — 72 %" },
    ]);
    // Aucun texte affiché ne doit contenir de pictogramme : l'interface est sans emoji
    for (const l of lignesResume(SEANCE)) expect(l.texte).not.toMatch(/\p{Extended_Pictographic}/u);
    // …et chaque texte est bien celui de la notification correspondante, au pictogramme près
    expect(lignesResume(SEANCE).map((l) => l.texte)).toEqual(lignesCommunes(SEANCE).map((l) => ligneSansPictogramme(l).texte));
  });

  it("titre = date en toutes lettres et horaire, comme la première ligne du contenu commun", () => {
    expect(titreResume(SEANCE)).toBe("Jeudi 24 septembre 2026 — 19h30 à 21h30");
    expect(ligneSansPictogramme(lignesCommunes(SEANCE)[0]).texte).toBe(titreResume(SEANCE));
  });

  it("remplace les chiffres par le motif quand la séance est annulée", () => {
    const lignes = lignesResume(ANNULEE);
    expect(lignes.map((l) => l.icone)).toEqual(["calendrier", "lieu", "livre", "interdit"]);
    expect(lignes.at(-1)).toEqual({ icone: "interdit", texte: "Motif : Salle indisponible" });
    expect(LIBELLE_ANNULEE).toBe("Cours annulé");
  });

  it("annonce « motif non précisé » plutôt que rien", () => {
    expect(lignesResume({ ...ANNULEE, motifAnnulation: null }).at(-1)?.texte).toBe("Motif : non précisé");
  });

  it("tient sans thème (repli sur les disciplines du planning)", () => {
    const sansTheme = { ...SEANCE, theme: "" };
    expect(lignesResume(sansTheme)[2]).toEqual({ icone: "livre", texte: "Messer" });
    expect(lignesResume({ ...sansTheme, disciplines: "" }).map((l) => l.icone)).toEqual(["calendrier", "lieu", "groupe"]);
  });

  it("garde une ligne inconnue telle quelle plutôt que de la perdre", () => {
    expect(ligneSansPictogramme("Texte sans pictogramme")).toEqual({ icone: "info", texte: "Texte sans pictogramme" });
  });
});

/* ------------------------------------------------------------------ */
/* Aperçu enrichi (Open Graph / Twitter Card) et image                 */
/* ------------------------------------------------------------------ */

describe("aperçu embarqué", () => {
  it("décrit la séance avec le texte que le club poste déjà sur ses réseaux", () => {
    expect(descriptionSeance(SEANCE)).toBe("📍 Gymnase municipal · 📖 Messer — garde haute · ✅ 13 présents / 18 — 72 %");
    // Le même contenu que la notification, à la date près (elle est le titre de l'aperçu)
    expect(texteSeance(SEANCE, { presents: 13, invites: 18 })).toContain("✅ 13 présents / 18 — 72 %");
  });

  it("annonce l'annulation et son motif, sans chiffres", () => {
    const d = descriptionSeance(ANNULEE);
    expect(d).toBe("❌ Cours annulé · 📍 Gymnase municipal · 📖 Messer — garde haute · 💬 Salle indisponible");
    expect(d).not.toContain("présent");
  });

  it("découpe les chiffres pour l'image : le taux en gros, l'effectif en légende", () => {
    expect(chiffresImage(SEANCE)).toEqual({ taux: "72 %", effectif: "13 présents / 18" });
  });

  it("décrit une période par ses séances à venir, la prochaine en détail", () => {
    const planning = { periode: { ...PERIODE, dateDebut: "2026-09-01", dateFin: "2026-10-31" }, seances: [SEANCE], total: 7 };
    expect(descriptionPlanning(planning)).toBe(
      "7 séances à venir · Prochaine : Jeudi 24 septembre 2026 — 19h30 à 21h30 · 📍 Gymnase municipal · 📖 Messer — garde haute · ✅ 13 présents / 18 — 72 %",
    );
    expect(descriptionPlanning({ ...planning, seances: [], total: 0 })).toBe("Aucune séance à venir — période « Rentrée 2026 ».");
  });
});

/* ------------------------------------------------------------------ */
/* Lecture en base : rien de nominatif                                 */
/* ------------------------------------------------------------------ */

const LIGNE_SEANCE = {
  id: "s1",
  date: "2026-09-24",
  heureDebut: "19:30",
  heureFin: "21:30",
  lieu: "Gymnase municipal",
  adresse: "1 rue des Lices",
  theme: "Messer",
  alternative: "",
  disciplines: "Messer",
  annulee: false,
  motifAnnulation: null,
  periodId: PERIODE.id,
  period: PERIODE,
  parties: [{ id: "c1", libelle: "Partie 1 · Cours", ordre: 0, bloc: 1, nature: "COURS", theme: "Messer", description: "Garde haute.", niveau: "INDIFFERENT", atelier: null }],
};

/**
 * Les présences ne remontent plus ligne à ligne : elles sont **agrégées en base**, sur les seuls
 * invités de la période (voir `taux-membres-periode.test.ts`). Un présent, un absent.
 */
const TOTAUX_SEANCE = [
  { sessionId: "s1", statut: "PRESENT", _count: { _all: 1 } },
  { sessionId: "s1", statut: "ABSENT", _count: { _all: 1 } },
];

/** Colonnes booléennes d'un `select` (éventuellement imbriqué). */
function colonnes(select: unknown, chemin: string[] = []): string[] {
  let courant = select as Record<string, unknown> | undefined;
  for (const etape of chemin) courant = (courant?.[etape] as { select?: Record<string, unknown> } | undefined)?.select;
  return Object.keys(courant ?? {}).filter((c) => typeof (courant as Record<string, unknown>)[c] === "boolean");
}

const appelDe = (modele: string, operation: string): Appel | undefined => appels.find((a) => a.modele === modele && a.operation === operation);

describe("lecture d'une séance partagée", () => {
  beforeEach(() => {
    reponses.set("session.findUnique", LIGNE_SEANCE);
    reponses.set("periodMember.count", 18);
    reponses.set("attendance.groupBy", TOTAUX_SEANCE);
  });

  it("ne sélectionne aucune colonne nominative", async () => {
    const { seancePartagee } = await import("@/lib/partage");
    await seancePartagee("s1");
    const select = JSON.stringify(appelDe("session", "findUnique")?.args.select);
    for (const interdit of ["prenom", "email", "userId", "instructeur", "proposePar", "modifiePar", "membres"]) {
      expect(select).not.toContain(interdit);
    }
    // Aucune ligne de présence ne remonte du tout : seulement des totaux agrégés en base
    expect(select).not.toContain("attendances");
    expect(appelDe("attendance", "groupBy")?.args.by).toEqual(["sessionId", "statut"]);
    // Une case du planning ne donne que son thème, son niveau et le titre de son atelier — jamais qui encadre
    // `id`, `libelle`, `ordre`, `bloc` et `nature` ont remplacé le code de partie : ce sont des données
    // de la séance, pas des données de personne — `teinte` aussi, un repère d'affichage. Aucun
    // identifiant d'encadrant ne figure ici.
    expect(colonnes(appelDe("session", "findUnique")?.args.select, ["parties"])).toEqual(["id", "libelle", "ordre", "bloc", "nature", "teinte", "theme", "description", "niveau"]);
    expect(colonnes(appelDe("session", "findUnique")?.args.select, ["parties", "atelier"])).toEqual(["titre"]);
  });

  it("calcule les chiffres globaux sur les invités de la période, compte de service exclu", async () => {
    const { seancePartagee } = await import("@/lib/partage");
    const s = await seancePartagee("s1");
    expect(appelDe("periodMember", "count")?.args.where).toEqual({ periodId: "p1", user: { service: false } });
    expect(s?.compteurs).toMatchObject({ presents: 1, invites: 18, pourcentage: 6 });
  });

  it("range le programme partie par partie et nomme chaque élément dans sa partie, sans élément muet", async () => {
    const partie = (id: string, ordre: number, bloc: number, nature: string, theme: string) => ({
      id,
      libelle: "",
      ordre,
      bloc,
      nature,
      theme,
      description: "",
      niveau: "INDIFFERENT",
      atelier: null,
    });
    reponses.set("session.findUnique", {
      ...LIGNE_SEANCE,
      parties: [
        partie("c3", 3, 2, "OPTION", "Lutte"),
        partie("c1", 1, 1, "COURS", ""),
        partie("c2", 2, 1, "COURS", "Messer"),
        partie("c0", 0, 1, "ECHAUFFEMENT", "Mobilité"),
      ],
    });
    const { seancePartagee } = await import("@/lib/partage");
    const { grouperParPartie } = await import("@/components/seances/programme-cours");
    const s = await seancePartagee("s1");
    const parties = grouperParPartie(s?.programme ?? []);
    expect(parties.map((p) => [p.nom, p.elements.map((c) => c.nom)])).toEqual([
      ["Partie 1", ["Échauffement", "Cours 2"]],
      ["Partie 2", ["Option"]],
    ]);
  });

  it("reste consultable quand la période est close", async () => {
    reponses.set("session.findUnique", { ...LIGNE_SEANCE, period: { ...PERIODE, statut: "CLOSE" } });
    const { seancePartagee } = await import("@/lib/partage");
    expect((await seancePartagee("s1"))?.periode.statut).toBe("CLOSE");
  });

  it("ne publie rien d'un trimestre en brouillon, même avec le bon identifiant", async () => {
    reponses.set("session.findUnique", { ...LIGNE_SEANCE, period: { ...PERIODE, statut: "BROUILLON" } });
    const { seancePartagee } = await import("@/lib/partage");
    // Le trimestre n'a pas encore été ouvert au club : ni date, ni lieu, ni thème, ni taux ne sortent
    expect(await seancePartagee("s1")).toBeNull();
    // …et on ne va même pas compter les invités : la lecture s'arrête à la période
    expect(appelDe("periodMember", "count")).toBeUndefined();
  });

  it("rend null sur un identifiant inconnu, et n'interroge même pas la base sur un identifiant aberrant", async () => {
    reponses.set("session.findUnique", null);
    const { seancePartagee } = await import("@/lib/partage");
    expect(await seancePartagee("inconnu")).toBeNull();
    appels.length = 0;
    expect(await seancePartagee("x".repeat(200))).toBeNull();
    expect(await seancePartagee("")).toBeNull();
    expect(appels).toHaveLength(0);
  });
});

describe("lecture du planning partagé", () => {
  beforeEach(() => {
    reponses.set("period.findUnique", { ...PERIODE, dateDebut: "2026-09-01", dateFin: "2026-10-31" });
    reponses.set("session.findMany", [LIGNE_SEANCE]);
    reponses.set("session.count", 7);
    reponses.set("periodMember.count", 18);
    reponses.set("attendance.groupBy", TOTAUX_SEANCE);
  });

  it("ne publie que les séances d'aujourd'hui et à venir, écrêtées", async () => {
    const { planningPartage } = await import("@/lib/partage");
    const p = await planningPartage("p1", MAINTENANT);
    const args = appelDe("session", "findMany")?.args as { where: { date: { gte: string } }; take: number; orderBy: unknown };
    expect(args.where.date.gte).toBe("2026-09-23");
    expect(args.take).toBe(MAX_SEANCES_PLANNING);
    expect(args.orderBy).toEqual([{ date: "asc" }, { heureDebut: "asc" }]);
    expect(p?.total).toBe(7);
    expect(p?.seances).toHaveLength(1);
  });

  it("ne sélectionne rien de nominatif non plus, et compte les invités une seule fois", async () => {
    const { planningPartage } = await import("@/lib/partage");
    await planningPartage("p1", MAINTENANT);
    const select = JSON.stringify(appelDe("session", "findMany")?.args.select);
    for (const interdit of ["prenom", "email", "userId", "instructeur", "proposePar", "modifiePar"]) expect(select).not.toContain(interdit);
    expect(appels.filter((a) => a.modele === "periodMember")).toHaveLength(1);
    expect(colonnes(appelDe("period", "findUnique")?.args.select)).toEqual(["id", "nom", "statut", "dateDebut", "dateFin"]);
  });

  it("rend null sur une période inconnue", async () => {
    reponses.set("period.findUnique", null);
    const { planningPartage } = await import("@/lib/partage");
    expect(await planningPartage("p404", MAINTENANT)).toBeNull();
  });

  it("refuse un trimestre en brouillon, accepte un trimestre clos", async () => {
    const { planningPartage } = await import("@/lib/partage");
    reponses.set("period.findUnique", { ...PERIODE, statut: "BROUILLON", dateDebut: "2026-11-01", dateFin: "2026-12-31" });
    expect(await planningPartage("p1", MAINTENANT)).toBeNull();
    // Rien n'est lu au-delà de la période : aucune séance ne remonte d'un trimestre pas encore ouvert
    expect(appelDe("session", "findMany")).toBeUndefined();

    // Un lien partagé ne meurt pas : un trimestre clos reste consultable
    appels.length = 0;
    reponses.set("period.findUnique", { ...PERIODE, statut: "CLOSE", dateDebut: "2026-09-01", dateFin: "2026-10-31" });
    expect((await planningPartage("p1", MAINTENANT))?.periode.statut).toBe("CLOSE");
  });
});

/* ------------------------------------------------------------------ */
/* Limiteur de débit                                                   */
/* ------------------------------------------------------------------ */

describe("limiteur de débit des pages publiques", () => {
  beforeEach(() => utiliserMagasinMemoire());

  it("plafonne les visites par IP, et plus sévèrement le balayage d'identifiants", async () => {
    expect(RATE_LIMITS.partage_ip.max).toBeGreaterThan(RATE_LIMITS.partage_inconnu_ip.max);
    const { max } = RATE_LIMITS.partage_ip;
    for (let i = 0; i < max; i++) expect(await checkRateLimit("partage_ip", "203.0.113.7", 1_000_000 + i)).toBe(true);
    expect(await checkRateLimit("partage_ip", "203.0.113.7", 1_000_000 + max)).toBe(false);
    // Une autre IP n'est pas pénalisée, et le compteur des identifiants inconnus est distinct
    expect(await checkRateLimit("partage_ip", "203.0.113.8")).toBe(true);
    expect(await checkRateLimit("partage_inconnu_ip", "203.0.113.7")).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Événements : seule une annonce publiée est partageable              */
/* ------------------------------------------------------------------ */

const LIGNE_EVENEMENT = {
  id: "e1",
  nom: "Stage d'épée longue — Fiore dei Liberi",
  description: "Deux jours de travail à l'épée longue.\nRepas tiré du sac.",
  dateDebut: "2026-10-05",
  heureDebut: "10:00",
  dateFin: "2026-10-06",
  heureFin: "17:30",
  lieu: "Salle des fêtes, Villebourg",
  adresse: "1 rue des Lices, 00000 Villebourg",
  organisateur: "Mon club d'AMHE",
  lienInscription: "https://club.test/inscription",
  lienSource: "https://exemple.test/annonce",
  imageUrl: "https://exemple.test/affiche.jpg",
  publie: true,
  publieAt: new Date("2026-09-01T10:00:00Z"),
  creeParId: "u-admin",
  createdAt: new Date("2026-09-01T10:00:00Z"),
  updatedAt: new Date("2026-09-01T10:00:00Z"),
};

describe("résumé public d'un événement", () => {
  beforeEach(() => reponses.set("evenement.findUnique", LIGNE_EVENEMENT));

  it("ne publie qu'un événement publié : un brouillon est introuvable, comme un identifiant inventé", async () => {
    reponses.set("evenement.findUnique", { ...LIGNE_EVENEMENT, publie: false });
    const { evenementPartage } = await import("@/lib/partage");
    expect(await evenementPartage("e1", MAINTENANT)).toBeNull();
    // …et l'identifiant aberrant n'atteint même pas la base
    appels.length = 0;
    expect(await evenementPartage("x".repeat(200), MAINTENANT)).toBeNull();
    expect(await evenementPartage("", MAINTENANT)).toBeNull();
    expect(appels).toHaveLength(0);
  });

  it("ne recopie rien de nominatif ni d'interne (auteur, brouillon, image distante, lien d'origine)", async () => {
    const { evenementPartage } = await import("@/lib/partage");
    const e = await evenementPartage("e1", MAINTENANT);
    expect(Object.keys(e ?? {}).sort()).toEqual(
      // Le tarif (plein et adhérent) et la durée sont publiables : ce ne sont pas des données de
      // personne, et ce sont les questions qu'on se pose en découvrant l'annonce par un lien partagé.
      [
        "adresse",
        "dateDebut",
        "dateFin",
        "description",
        "dureeNombre",
        "dureeUnite",
        "heureDebut",
        "heureFin",
        "id",
        "lienInscription",
        "lieu",
        "nom",
        "organisateur",
        "prix",
        "prixAdherent",
        "termine",
      ].sort(),
    );
    expect(JSON.stringify(e)).not.toContain("u-admin");
    expect(JSON.stringify(e)).not.toContain("affiche.jpg");
  });

  it("reste consultable une fois l'événement terminé", async () => {
    const { evenementPartage } = await import("@/lib/partage");
    const passe = await evenementPartage("e1", new Date("2026-11-01T12:00:00Z"));
    expect(passe?.termine).toBe(true);
    expect(passe?.nom).toBe(LIGNE_EVENEMENT.nom);
    expect((await evenementPartage("e1", MAINTENANT))?.termine).toBe(false);
  });

  it("ne rend qu'un lien d'inscription http(s)", async () => {
    const { evenementPartage, lienExterneSur } = await import("@/lib/partage");
    expect(lienExterneSur("https://exemple.test/x")).toBe("https://exemple.test/x");
    for (const mauvais of ["javascript:alert(1)", "data:text/html,<script>", "", "   ", "pas une URL"]) {
      expect(lienExterneSur(mauvais)).toBe("");
    }
    reponses.set("evenement.findUnique", { ...LIGNE_EVENEMENT, lienInscription: "javascript:alert(1)" });
    expect((await evenementPartage("e1", MAINTENANT))?.lienInscription).toBe("");
  });
});

describe("mise en forme d'un événement", () => {
  const EVENEMENT = {
    id: "e1",
    nom: LIGNE_EVENEMENT.nom,
    description: LIGNE_EVENEMENT.description,
    dateDebut: "2026-10-05",
    heureDebut: "10:00" as string | null,
    dateFin: "2026-10-06" as string | null,
    heureFin: "17:30" as string | null,
    lieu: "Salle des fêtes, Villebourg",
    adresse: "1 rue des Lices",
    organisateur: "Mon club d'AMHE",
    prix: "45 €",
    prixAdherent: "35 €",
    dureeNombre: 2 as number | null,
    dureeUnite: "jour",
    lienInscription: "",
    termine: false,
  };

  /** Le texte de la ligne « durée » d'un événement — `undefined` quand elle n'est pas affichée. */
  const ligneDuree = (e: EvenementPartage) => lignesEvenement(e).find((l) => l.icone === "sablier")?.texte;
  /** Le texte de la ligne « tarif » — toujours présente, « Gratuit » à défaut de prix saisi. */
  const lignePrix = (e: EvenementPartage) => lignesEvenement(e).find((l) => l.icone === "etiquette")?.texte;

  it("écrit les dates en toutes lettres, sur un ou plusieurs jours", () => {
    expect(dateEvenement(EVENEMENT)).toBe("Du lundi 5 octobre 2026 au mardi 6 octobre 2026");
    expect(dateEvenement({ dateDebut: "2026-10-05", dateFin: null })).toBe("Lundi 5 octobre 2026");
    expect(dateEvenement({ dateDebut: "2026-10-05", dateFin: "2026-10-05" })).toBe("Lundi 5 octobre 2026");
  });

  it("dit l'horaire, même incomplet", () => {
    expect(horaireEvenement(EVENEMENT)).toBe("10h00 à 17h30");
    expect(horaireEvenement({ heureDebut: "19:30", heureFin: null })).toBe("à partir de 19h30");
    expect(horaireEvenement({ heureDebut: null, heureFin: "17:30" })).toBe("jusqu'à 17h30");
    expect(horaireEvenement({ heureDebut: null, heureFin: null })).toBe("");
  });

  it("donne les lignes affichées, sans jamais nommer qui a saisi l'annonce", () => {
    expect(lignesEvenement(EVENEMENT).map((l) => [l.icone, l.texte])).toEqual([
      ["calendrier", "Du lundi 5 octobre 2026 au mardi 6 octobre 2026"],
      ["horloge", "10h00 à 17h30"],
      ["sablier", "Durée : 2 jours"],
      ["lieu", "Salle des fêtes, Villebourg"],
      ["groupe", "Organisé par Mon club d'AMHE"],
      ["etiquette", "45 € · 35 € pour les adhérents"],
    ]);
    for (const l of lignesEvenement(EVENEMENT)) expect(l.texte).not.toMatch(/\p{Extended_Pictographic}/u);
    // Champs vides : la ligne disparaît plutôt que d'afficher un libellé creux
    expect(lignesEvenement({ ...EVENEMENT, lieu: " ", organisateur: "", dureeNombre: null }).map((l) => l.icone)).toEqual([
      "calendrier",
      "horloge",
      "etiquette",
    ]);
    // Sauf le tarif : sans prix saisi, l'événement est **gratuit**, et la page publique le dit.
    // « On ne sait pas » et « c'est gratuit » ne sont pas la même réponse avant de s'inscrire.
    expect(lignePrix({ ...EVENEMENT, prix: "  ", prixAdherent: "" })).toBe("Gratuit");
    // Le tarif adhérent, lui, disparaît quand il est vide : son absence ne veut rien dire
    expect(lignePrix({ ...EVENEMENT, prixAdherent: " " })).toBe("45 €");
    // Gratuit : le tarif adhérent se tait — un tarif réduit est moins cher que le plein tarif,
    // et rien n'est moins cher que gratuit
    expect(lignePrix({ ...EVENEMENT, prix: "" })).toBe("Gratuit");
    // Durée accordée, « mois » compris — il est invariable
    expect(ligneDuree({ ...EVENEMENT, dureeNombre: 1 })).toBe("Durée : 1 jour");
    expect(ligneDuree({ ...EVENEMENT, dureeNombre: 1, dureeUnite: "demi-journee" })).toBe("Durée : 1 demi-journée");
    expect(ligneDuree({ ...EVENEMENT, dureeNombre: 2, dureeUnite: "demi-journee" })).toBe("Durée : 2 demi-journées");
    expect(ligneDuree({ ...EVENEMENT, dureeNombre: 3, dureeUnite: "semaine" })).toBe("Durée : 3 semaines");
    expect(ligneDuree({ ...EVENEMENT, dureeNombre: 1, dureeUnite: "mois" })).toBe("Durée : 1 mois");
    expect(ligneDuree({ ...EVENEMENT, dureeNombre: 6, dureeUnite: "mois" })).toBe("Durée : 6 mois");
  });

  it("décrit l'événement pour l'aperçu, pictogrammes compris, et coupe l'extrait", () => {
    expect(descriptionEvenement(EVENEMENT)).toBe(
      "📅 Du lundi 5 octobre 2026 au mardi 6 octobre 2026 · 🕒 10h00 à 17h30 · ⏳ Durée : 2 jours · 📍 Salle des fêtes, Villebourg · 👥 Organisé par Mon club d'AMHE · 🏷️ 45 € · 35 € pour les adhérents · Deux jours de travail à l'épée longue. Repas tiré du sac.",
    );
    const long = descriptionEvenement({ ...EVENEMENT, description: "a".repeat(400) });
    expect(long.endsWith("…")).toBe(true);
    expect(tronquer("abcdef", 4)).toBe("abc…");
    expect(tronquer("abc", 4)).toBe("abc");
  });
});

/* ------------------------------------------------------------------ */
/* Les trois pages publiques : la garde de débit tient vraiment        */
/* ------------------------------------------------------------------ */

/**
 * Ces deux règles ne se voient qu'à la lecture du fichier — une page serveur asynchrone de Next ne
 * se rend pas dans un test unitaire. Elles ont toutes les deux déjà été perdues une fois :
 *
 *  1. `gardeInconnu()` **renvoie** un booléen : appelé sans regarder sa réponse, le compteur du
 *     balayage d'identifiants se remplissait sans jamais rien arrêter ;
 *  2. `generateMetadata` est rendu **avant** la page : la garde doit y passer en premier, sinon le
 *     `<head>` livrait le résumé complet (date, lieu, thème, taux) à qui la page refusait d'afficher.
 */
const PAGES_PARTAGE = [
  "src/app/(public)/partage/seance/[id]/page.tsx",
  "src/app/(public)/partage/planning/[periodId]/page.tsx",
  "src/app/(public)/partage/evenement/[id]/page.tsx",
];

/** La source d'une page, coupée en deux : ses métadonnées, puis le composant. */
function morceaux(relatif: string): { metadonnees: string; page: string } {
  const source = fs.readFileSync(path.join(process.cwd(), relatif), "utf8");
  const coupe = source.indexOf("export default async function");
  expect(coupe).toBeGreaterThan(0);
  return { metadonnees: source.slice(0, coupe), page: source.slice(coupe) };
}

describe.each(PAGES_PARTAGE)("garde de débit de %s", (relatif) => {
  it("s'arrête vraiment quand le compteur des identifiants inconnus est plein", () => {
    const { page } = morceaux(relatif);
    expect(page).toContain("if (!(await gardeInconnu()))");
    // L'appel « nu », dont la réponse se perd, est précisément la régression à empêcher
    expect(page).not.toMatch(/^\s*await gardeInconnu\(\);/m);
  });

  /**
   * La vignette d'aperçu est une **route publique de plus** sur le même identifiant : elle se
   * demande sans la page, et un robot qui balaye les identifiants la demande tout autant. Elle ne
   * passait que par `gardePartage()` — le compteur sévère du balayage, lui, ne se remplissait
   * jamais, et la porte principale restait ouverte tant que le quota ordinaire tenait.
   */
  it("compte le balayage d'identifiants sur sa vignette comme sur sa page", () => {
    const vignette = relatif.replace(/page\.tsx$/, "opengraph-image.tsx");
    const source = fs.readFileSync(path.join(process.cwd(), vignette), "utf8");
    expect(source).toContain("await gardePartage()");
    expect(source).toContain("if (!(await gardeInconnu()))");
    expect(source).not.toMatch(/^\s*await gardeInconnu\(\);/m);
  });

  it("franchit la garde avant de charger quoi que ce soit dans generateMetadata", () => {
    const { metadonnees } = morceaux(relatif);
    const garde = metadonnees.indexOf("await garde()");
    const chargement = metadonnees.indexOf("await charger(");
    expect(garde).toBeGreaterThan(0);
    expect(garde).toBeLessThan(chargement);
    // Pas d'indexation, garde franchie ou non
    expect(metadonnees).toContain("robots: { index: false, follow: false }");
  });
});
