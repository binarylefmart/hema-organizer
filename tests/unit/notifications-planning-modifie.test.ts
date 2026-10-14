import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **Planning modifié** (`planning_modifie`) : un échauffement, un cours ou une option ajouté ou modifié
 * dans le planning, annoncé aux instructeurs du club.
 *
 * Ce qui se juge ici : le registre (canaux, raisons, visibilité), la phrase de chaque changement
 * (ajout, modification champ par champ, rien à dire), le regroupement (un message par geste, toutes
 * séances confondues ; les réglages case par case de la fiche fusionnés), les destinataires (tous les
 * instructeurs et l'équipe de la séance, jamais l'auteur, préférences respectées), les verrous de
 * séance, la clé posée avant l'envoi et libérée sur échec — et l'écriture, qui ne dépend jamais de
 * l'envoi.
 */

type Personne = { id: string; prenom: string; nom: string; email: string | null; actif: boolean; rappelEmail: boolean; preferencesNotifications: string | null; service: boolean };
type Seance = { id: string; date: string; heureDebut: string; heureFin: string; lieu: string; annulee: boolean; instructeurs: string[]; period: { id: string; statut: string; instructeurs: string[] } };

const faux = vi.hoisted(() => ({
  seances: [] as Seance[],
  personnes: new Map<string, Record<string, unknown>>(),
  instructeursClub: [] as string[],
  logs: [] as Array<Record<string, unknown>>,
  emails: [] as Array<{ to: string; sujet: string; ref?: string; contenu: { paragraphes: string[]; boutons?: Array<{ url: string }> } }>,
  push: [] as Array<{ userId: string; titre: string; corps: string; url: string }>,
  echecEmail: null as Error | null,
  canaux: { email: true, push: true } as Record<string, boolean>,
  reglages: null as string | null,
  basePanne: false,
}));

function utilisateur(id: string): Record<string, unknown> {
  const p = faux.personnes.get(id);
  if (!p) throw new Error(`personne inconnue ${id}`);
  return p;
}

vi.mock("@/lib/db", () => ({
  db: {
    setting: { findUnique: vi.fn(async () => (faux.reglages ? { value: faux.reglages } : null)) },
    session: {
      findMany: vi.fn(async (args: { where: { id: { in: string[] } } }) => {
        if (faux.basePanne) throw new Error("base indisponible");
        return faux.seances
          .filter((s) => args.where.id.in.includes(s.id))
          .map((s) => ({
            ...s,
            instructeurs: s.instructeurs.map((id) => ({ user: utilisateur(id) })),
            period: { ...s.period, instructeurs: s.period.instructeurs.map((id) => ({ user: utilisateur(id) })) },
          }));
      }),
    },
    user: {
      // Deux lectures : les instructeurs du club, puis le tri « accès actif » (tout le monde en a un ici).
      findMany: vi.fn(async (args: { where: { role?: string; AND?: [{ id: { in: string[] } }, unknown] } }) =>
        args.where.role === "INSTRUCTEUR" ? faux.instructeursClub.map(utilisateur) : args.where.AND![0].id.in.map((id) => ({ id })),
      ),
    },
    notificationLog: {
      findMany: vi.fn(async (args: { where: { dedupKey: { in: string[] } } }) =>
        faux.logs.filter((l) => args.where.dedupKey.in.includes(l.dedupKey as string)).map((l) => ({ dedupKey: l.dedupKey })),
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (faux.logs.some((l) => l.dedupKey === data.dedupKey)) throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
        faux.logs.push({ ...data });
        return data;
      }),
      update: vi.fn(async ({ where, data }: { where: { dedupKey: string }; data: Record<string, unknown> }) => {
        const ligne = faux.logs.find((l) => l.dedupKey === where.dedupKey);
        if (!ligne) throw new Error("introuvable");
        Object.assign(ligne, data);
        return ligne;
      }),
    },
  },
}));

vi.mock("@/lib/email/mailer", () => ({
  enqueueEmail: vi.fn((mail: { to: string; sujet: string; ref?: string; contenu: { paragraphes: string[] } }, onDone?: (err: Error | null) => void) => {
    // La clé doit déjà être posée quand le message entre dans la file.
    if (!faux.logs.some((l) => l.dedupKey === mail.ref && l.statut === "ENVOYE")) throw new Error(`email mis en file avant sa clé : ${mail.ref}`);
    faux.emails.push(mail);
    onDone?.(faux.echecEmail);
  }),
}));

vi.mock("@/lib/notifications/canaux", () => ({
  envoiPossible: vi.fn(async (_type: string, canal: string) => faux.canaux[canal] === true),
}));

vi.mock("@/lib/notifications/push", () => ({
  notifierPersonnes: vi.fn(async (ids: string[], charge: (id: string) => { titre: string; corps: string; url: string }) => {
    for (const id of ids) faux.push.push({ userId: id, ...charge(id) });
    return new Map(ids.map((id) => [id, { appareils: 1, atteints: 1 }]));
  }),
}));

const {
  changementDepuis,
  clePlanningModifie,
  contenuPlanningModifie,
  differerModificationsPlanning,
  differerRetraitPlanning,
  annoncerAttentePlanning,
  oublierRetraitsPlanning,
  envoyerAttente,
  phraseChangement,
  signalerEcrituresPlanning,
  signalerModificationsPlanning,
} = await import("@/lib/notifications/planning-modifie");
type ChangementElement = import("@/lib/notifications/planning-modifie").ChangementElement;
type EtatElement = import("@/lib/notifications/planning-modifie").EtatElement;
const { CANAUX_PAR_NOTIFICATION, COUPLES_EMIS, DESCRIPTIONS, RAISON_API_EXCLUE, RAISON_ROUTAGE_FIXE, TYPES_NOTIFICATION, estRoutable, preferencesDefaut, serialiserPreferences } = await import(
  "@/lib/notifications/preferences"
);
const { typesVisiblesPour } = await import("@/lib/notifications/membre");
const { emailPlanningModifie } = await import("@/lib/email/templates/planning");

const NOW = new Date("2026-10-14T08:00:00Z");
const AUTEUR = { id: "delta", prenom: "Delta", nom: "Lefèvre" };

function personne(id: string, prenom: string, nom: string, extra: Partial<Personne> = {}): Personne {
  return { id, prenom, nom, email: `${id}@club.fr`, actif: true, rappelEmail: true, preferencesNotifications: null, service: false, ...extra };
}

const VIDE: EtatElement = { theme: "", instructeur: null, instructeurSecond: null, niveau: "INDIFFERENT", description: "" };

function changement(extra: Partial<ChangementElement> & Pick<ChangementElement, "partieId" | "sessionId">): ChangementElement {
  return {
    nature: "COURS",
    libelle: "Cours",
    bloc: 1,
    ordre: 0,
    avant: VIDE,
    apres: { ...VIDE, theme: "Épée longue", instructeur: "Damien Rochebrune" },
    horodatage: 1_000,
    ...extra,
  };
}

const AJOUT = changement({ partieId: "p1", sessionId: "s1" });
const MODIF = changement({
  partieId: "p2",
  sessionId: "s2",
  nature: "OPTION",
  libelle: "Option 1",
  ordre: 1,
  avant: { ...VIDE, theme: "Messer", instructeur: "Léa Garnier" },
  apres: { ...VIDE, theme: "Dussack", instructeur: "Hugo Perrin" },
});

beforeEach(() => {
  faux.personnes = new Map(
    [personne("delta", "Delta", "Lefèvre"), personne("charlie", "Charlie", "Morel"), personne("lea", "Léa", "Garnier"), personne("hugo", "Hugo", "Perrin"), personne("invite", "Inès", "Roux")].map((p) => [p.id, p]),
  );
  faux.instructeursClub = ["delta", "charlie", "lea"];
  faux.seances = [
    { id: "s1", date: "2026-10-16", heureDebut: "19:30", heureFin: "21:30", lieu: "Gymnase municipal", annulee: false, instructeurs: [], period: { id: "per", statut: "ACTIVE", instructeurs: [] } },
    // Hugo encadre cette séance sans avoir le rôle INSTRUCTEUR : il est prévenu quand même.
    { id: "s2", date: "2026-10-23", heureDebut: "19:30", heureFin: "21:30", lieu: "Gymnase municipal", annulee: false, instructeurs: ["hugo"], period: { id: "per", statut: "ACTIVE", instructeurs: [] } },
  ];
  faux.logs = [];
  faux.emails = [];
  faux.push = [];
  faux.echecEmail = null;
  faux.canaux = { email: true, push: true };
  faux.reglages = null;
  faux.basePanne = false;
});

const signaler = (changements: ChangementElement[], now = NOW) => signalerModificationsPlanning({ auteur: AUTEUR, changements, now });

/* ------------------------------------------------------------------ */

describe("registre : une ligne d'encadrement, email et téléphone seulement", () => {
  it("est déclarée partout où le registre l'attend", () => {
    expect(TYPES_NOTIFICATION).toContain("planning_modifie");
    expect(DESCRIPTIONS.planning_modifie.titre).toBe("Planning modifié");
    expect(CANAUX_PAR_NOTIFICATION.planning_modifie).toEqual(["email", "push"]);
    expect(COUPLES_EMIS.planning_modifie).toEqual(["email", "push"]);
    expect(RAISON_API_EXCLUE.planning_modifie).toBeTruthy();
    expect(estRoutable("planning_modifie")).toBe(false);
    expect(RAISON_ROUTAGE_FIXE.planning_modifie).toBeTruthy();
    expect(preferencesDefaut().notifications.planning_modifie).toEqual({ email: true, push: true });
  });

  it("ne se montre qu'à l'encadrement dans « Mon profil »", () => {
    expect(typesVisiblesPour({ role: "INSTRUCTEUR", estAdmin: false })).toContain("planning_modifie");
    expect(typesVisiblesPour({ role: "MEMBRE", estAdmin: false })).not.toContain("planning_modifie");
    expect(typesVisiblesPour({ role: "MEMBRE", estAdmin: true })).not.toContain("planning_modifie");
  });

  it("est branchée aux deux portes d'écriture des cases du planning", () => {
    const code = readFileSync(path.join(process.cwd(), "src/actions/planning.ts"), "utf8");
    const lot = code.slice(code.indexOf("export async function enregistrerCases"));
    expect(lot.slice(0, lot.indexOf("\nexport async function", 10))).toMatch(/await signalerEcrituresPlanning\(user,/);
    const unitaire = code.slice(code.indexOf("export async function enregistrerCase("));
    expect(unitaire.slice(0, unitaire.indexOf("\nexport async function", 10))).toMatch(/differerModificationsPlanning\(user,/);
  });
});

describe("la phrase de chaque changement", () => {
  it("un élément qui passe de vide à rempli est un ajout, avec son thème et ses instructeurs", () => {
    expect(phraseChangement(AJOUT)).toBe("Ajouté : Cours « Épée longue », par Damien Rochebrune");
    expect(phraseChangement({ ...AJOUT, apres: { ...AJOUT.apres, instructeurSecond: "Léa Garnier", niveau: "AVANCE" } })).toBe(
      "Ajouté : Cours « Épée longue », par Damien Rochebrune et Léa Garnier (niveau avancé)",
    );
  });

  it("une modification dit chaque champ changé, avec sa seule nouvelle valeur", () => {
    expect(phraseChangement(MODIF)).toBe("Modifié : Option 1 — thème : « Dussack » ; instructeur : Hugo Perrin");
    expect(phraseChangement({ ...MODIF, apres: { ...MODIF.avant, theme: "Dussack", niveau: "DEBUTANT" } })).toBe("Modifié : Option 1 — thème : « Dussack » ; niveau : débutant");
    expect(phraseChangement({ ...MODIF, apres: { ...MODIF.avant, instructeur: null } })).toBe("Modifié : Option 1 — instructeur : personne");
  });

  it("second instructeur, niveau et description n'accompagnent qu'un changement de thème ou d'instructeur principal", () => {
    // Seuls, ils n'annoncent rien
    expect(phraseChangement({ ...MODIF, apres: { ...MODIF.avant, description: "Avec masques" } })).toBeNull();
    expect(phraseChangement({ ...MODIF, apres: { ...MODIF.avant, instructeurSecond: "Léa Garnier", niveau: "AVANCE", description: "Avec masques" } })).toBeNull();
    // Avec le thème ou l'instructeur principal, elle suit
    expect(phraseChangement({ ...MODIF, apres: { ...MODIF.avant, theme: "Dussack", description: "Avec masques" } })).toBe(
      "Modifié : Option 1 — thème : « Dussack » ; description : « Avec masques »",
    );
    expect(phraseChangement({ ...MODIF, apres: { ...MODIF.avant, instructeur: "Hugo Perrin", description: "" }, avant: { ...MODIF.avant, description: "Ancienne" } })).toBe(
      "Modifié : Option 1 — instructeur : Hugo Perrin ; description retirée",
    );
  });

  it("un élément rempli retiré s'annonce ; un élément vide retiré, non", () => {
    expect(phraseChangement({ ...MODIF, apres: VIDE, retire: true })).toBe("Supprimé : Option 1 « Messer », par Léa Garnier");
    expect(phraseChangement({ ...AJOUT, avant: VIDE, apres: VIDE, retire: true })).toBeNull();
  });

  it("rien de lisible n'a changé : rien à dire", () => {
    expect(phraseChangement({ ...MODIF, apres: MODIF.avant })).toBeNull();
    expect(phraseChangement({ ...AJOUT, apres: VIDE })).toBeNull();
  });

  it("le contenu range les séances par date, en toutes lettres, avec l'horaire et le lien du planning", () => {
    const c = contenuPlanningModifie({
      auteur: "Delta Lefèvre",
      seances: [
        { ...faux.seances[1], periodId: "per" },
        { ...faux.seances[0], periodId: "per" },
      ],
      changements: [MODIF, AJOUT],
    })!;
    expect(c.intro).toBe("Delta Lefèvre a modifié le planning de 2 cours :");
    expect(c.blocs.map((b) => b.entete)).toEqual(["Vendredi 16 octobre 2026 — 19h30 à 21h30 (Gymnase municipal)", "Vendredi 23 octobre 2026 — 19h30 à 21h30 (Gymnase municipal)"]);
    expect(c.blocs[0].chemin).toBe("/planning?periode=per#seance-s1");
    expect(c.sujet).toBe("📝 Planning modifié — 2 cours, du vendredi 16 octobre au vendredi 23 octobre");
    // Le téléphone : une notification par journée, compacte
    expect(c.pushParJour).toEqual([
      { sessionId: "s1", titre: "Planning modifié · ven. 16 oct 19h30", corps: "Delta Lefèvre : + Cours (Épée longue)", chemin: "/planning?periode=per#seance-s1" },
      { sessionId: "s2", titre: "Planning modifié · ven. 23 oct 19h30", corps: "Delta Lefèvre : ✎ Option 1 (thème, instructeur)", chemin: "/planning?periode=per#seance-s2" },
    ]);

    const { contenu } = emailPlanningModifie({ prenom: "Charlie", contenu: c });
    expect(contenu.paragraphes[1]).toBe("📅 Vendredi 16 octobre 2026 — 19h30 à 21h30 (Gymnase municipal)\n• Ajouté : Cours « Épée longue », par Damien Rochebrune");
    expect(contenu.boutons?.map((b) => b.label)).toEqual(["Voir le vendredi 16 octobre", "Voir le vendredi 23 octobre"]);
  });

  it("le téléphone dit une suppression d'un signe, et coupe un corps trop long", () => {
    const c = contenuPlanningModifie({
      auteur: "Delta Lefèvre",
      seances: [{ ...faux.seances[1], periodId: "per" }],
      changements: [{ ...MODIF, apres: VIDE, retire: true }],
    })!;
    expect(c.pushParJour[0].corps).toBe("Delta Lefèvre : − Option 1");
    const long = contenuPlanningModifie({
      auteur: "Delta Lefèvre",
      seances: [{ ...faux.seances[0], periodId: "per" }],
      changements: [{ ...AJOUT, apres: { ...AJOUT.apres, theme: "x".repeat(200) } }],
    })!;
    expect(long.pushParJour[0].corps.length).toBeLessThanOrEqual(120);
    expect(long.pushParJour[0].corps.endsWith("…")).toBe(true);
  });

  it("se construit depuis les lignes que les actions du planning ont sous la main", () => {
    const c = changementDepuis({
      avant: { id: "p9", sessionId: "s1", nature: "ECHAUFFEMENT", bloc: 1, ordre: 0, theme: "", description: "", niveau: "INDIFFERENT", instructeur: null, instructeurSecond: null },
      apres: { libelle: "Échauffement", theme: "Cardio", description: "", niveau: "INDIFFERENT", instructeur: { prenom: "Léa", nom: "Garnier" }, instructeurSecond: null, updatedAt: new Date(5) },
    });
    expect(c).toMatchObject({ partieId: "p9", nature: "ECHAUFFEMENT", horodatage: 5 });
    expect(phraseChangement(c)).toBe("Ajouté : Échauffement « Cardio », par Léa Garnier");
  });
});

describe("destinataires", () => {
  it("tous les instructeurs du club et l'équipe des séances, jamais l'auteur — un seul message chacun pour tout le geste", async () => {
    expect(await signaler([AJOUT, MODIF])).toBeGreaterThan(0);
    expect(faux.emails.map((e) => e.to).sort()).toEqual(["charlie@club.fr", "hugo@club.fr", "lea@club.fr"]);
    // Téléphone : une notification par journée modifiée (deux séances → deux par personne)
    expect(faux.push.map((p) => p.userId).sort()).toEqual(["charlie", "charlie", "hugo", "hugo", "lea", "lea"]);
    // Un email, les deux séances dedans.
    const corps = faux.emails[0].contenu.paragraphes.join("\n");
    expect(corps).toContain("Vendredi 16 octobre 2026");
    expect(corps).toContain("Vendredi 23 octobre 2026");
    expect(corps).toContain("Ajouté : Cours « Épée longue »");
    expect(corps).toContain("Modifié : Option 1 — thème : « Dussack »");
    expect(faux.push[0]).toMatchObject({ titre: "Planning modifié · ven. 16 oct 19h30", url: "/planning?periode=per#seance-s1" });
  });

  it("respecte les préférences de chacun, canal par canal", async () => {
    faux.personnes.set("charlie", personne("charlie", "Charlie", "Morel", { preferencesNotifications: JSON.stringify({ planning_modifie: { email: false, push: true } }) }));
    faux.personnes.set("lea", personne("lea", "Léa", "Garnier", { preferencesNotifications: JSON.stringify({ planning_modifie: { email: false, push: false } }) }));
    await signaler([AJOUT]);
    expect(faux.emails.map((e) => e.to)).toEqual([]);
    expect(faux.push.map((p) => p.userId)).toEqual(["charlie"]);
  });

  it("le club peut couper la ligne pour tout le monde", async () => {
    const prefs = preferencesDefaut();
    prefs.notifications.planning_modifie = { email: false, push: true };
    faux.reglages = serialiserPreferences(prefs);
    await signaler([AJOUT]);
    expect(faux.emails).toHaveLength(0);
    expect(faux.push.length).toBeGreaterThan(0);
  });

  it("un atelier ne déclenche rien, ni un enregistrement qui ne change rien", async () => {
    expect(await signaler([{ ...AJOUT, nature: "ATELIER" }, { ...MODIF, apres: MODIF.avant }])).toBe(0);
    expect(faux.logs).toHaveLength(0);
  });

  it("ni une séance annulée, ni une période close, ni un cours commencé", async () => {
    faux.seances[0].annulee = true;
    faux.seances[1].period.statut = "CLOSE";
    expect(await signaler([AJOUT, MODIF])).toBe(0);
    faux.seances[0].annulee = false;
    expect(await signaler([AJOUT], new Date("2026-10-16T18:00:00Z"))).toBe(0); // 20h00 à Paris, cours commencé
    expect(faux.emails).toHaveLength(0);
  });

  it("l'auteur seul instructeur du club : personne à prévenir", async () => {
    faux.instructeursClub = ["delta"];
    expect(await signaler([AJOUT])).toBe(0);
  });
});

describe("idempotence et pannes", () => {
  it("la même écriture ne part qu'une fois ; une nouvelle écriture repart", async () => {
    await signaler([AJOUT]);
    const n = faux.emails.length;
    expect(await signaler([AJOUT])).toBe(0);
    expect(faux.emails).toHaveLength(n);
    await signaler([{ ...AJOUT, horodatage: 2_000 }]);
    expect(faux.emails).toHaveLength(2 * n);
  });

  it("la clé est posée avant l'envoi, et libérée quand l'envoi échoue", async () => {
    faux.echecEmail = new Error("SMTP indisponible");
    await signaler([AJOUT]);
    const cle = clePlanningModifie({ canal: "email", destinataireId: "charlie", empreinte: (faux.emails[0].ref ?? "").split("_")[2] });
    expect(faux.logs.some((l) => l.dedupKey === cle)).toBe(false);
    expect(faux.logs.some((l) => String(l.dedupKey).startsWith(`${cle}_echec_`) && l.statut === "ECHEC")).toBe(true);
    // La reprise repart.
    faux.echecEmail = null;
    faux.emails = [];
    await signaler([AJOUT]);
    expect(faux.emails.map((e) => e.to)).toContain("charlie@club.fr");
  });

  it("ne lève jamais : une base en panne ne défait pas l'écriture", async () => {
    faux.basePanne = true;
    const erreur = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(signaler([AJOUT])).resolves.toBe(0);
    erreur.mockRestore();
  });
});

describe("réglages case par case (fiche de séance) : regroupés par auteur", () => {
  const ecriture = (theme: string, instructeur: { prenom: string; nom: string } | null, avantTheme: string, avantInstr: { prenom: string; nom: string } | null, t: number) => ({
    avant: { id: "p2", sessionId: "s2", nature: "OPTION", bloc: 1, ordre: 1, theme: avantTheme, description: "", niveau: "INDIFFERENT", instructeur: avantInstr, instructeurSecond: null },
    apres: { libelle: "Option 1", theme, description: "", niveau: "INDIFFERENT", instructeur, instructeurSecond: null, updatedAt: new Date(t) },
  });
  const LEA = { prenom: "Léa", nom: "Garnier" };
  const HUGO = { prenom: "Hugo", nom: "Perrin" };

  it("deux réglages successifs font un seul message, de l'état d'avant le premier à celui d'après le second", async () => {
    // Séance lointaine : le minuteur réel ne doit pas la juger commencée.
    faux.seances[1].date = "2099-10-23";
    differerModificationsPlanning(AUTEUR, [ecriture("Dussack", LEA, "Messer", LEA, 1)]);
    differerModificationsPlanning(AUTEUR, [ecriture("Dussack", HUGO, "Dussack", LEA, 2)]);
    expect(faux.emails).toHaveLength(0);
    await envoyerAttente(AUTEUR.id);
    const destinataires = faux.emails.filter((e) => e.to === "charlie@club.fr");
    expect(destinataires).toHaveLength(1);
    expect(destinataires[0].contenu.paragraphes.join("\n")).toContain("Modifié : Option 1 — thème : « Dussack » ; instructeur : Hugo Perrin");
  });

  it("un retrait attend, puis rejoint le message d'« Appliquer les modifications »", async () => {
    faux.seances[1].date = "2099-10-23";
    differerRetraitPlanning(AUTEUR, { id: "p9", sessionId: "s2", nature: "COURS", bloc: 1, ordre: 0, libelle: "Cours", theme: "Rapière", description: "", niveau: "INDIFFERENT", instructeur: LEA, instructeurSecond: null });
    expect(faux.emails).toHaveLength(0);
    await signalerEcrituresPlanning(AUTEUR, [ecriture("Dussack", HUGO, "Messer", LEA, 3)]);
    const recus = faux.emails.filter((e) => e.to === "charlie@club.fr");
    expect(recus).toHaveLength(1);
    const texte = recus[0].contenu.paragraphes.join("\n");
    expect(texte).toContain("Supprimé : Cours « Rapière », par Léa Garnier");
    expect(texte).toContain("Modifié : Option 1 — thème : « Dussack » ; instructeur : Hugo Perrin");
    // Plus rien n'attend : le retrait ne repart pas une seconde fois
    expect(await envoyerAttente(AUTEUR.id)).toBe(0);
  });

  it("chaque suppression se périme d'après sa propre date, pas d'après la plus ancienne", async () => {
    faux.seances[1].date = "2099-10-23";
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2099-10-01T10:00:00Z"));
      differerRetraitPlanning(AUTEUR, { id: "vieux", sessionId: "s2", nature: "COURS", bloc: 1, ordre: 0, libelle: "Cours", theme: "Rapière", description: "", niveau: "INDIFFERENT", instructeur: LEA, instructeurSecond: null });
      vi.setSystemTime(new Date("2099-10-03T10:00:00Z"));
      differerRetraitPlanning(AUTEUR, { id: "recent", sessionId: "s2", nature: "OPTION", bloc: 1, ordre: 1, libelle: "Option 1", theme: "Dussack", description: "", niveau: "INDIFFERENT", instructeur: LEA, instructeurSecond: null });
      await annoncerAttentePlanning(AUTEUR);
    } finally {
      vi.useRealTimers();
    }
    const texte = faux.emails.find((e) => e.to === "charlie@club.fr")!.contenu.paragraphes.join("\n");
    expect(texte).toContain("Supprimé : Option 1 « Dussack »");
    expect(texte).not.toContain("Rapière");
  });

  it("« Appliquer » sans case à écrire annonce quand même les suppressions (lot inchangé compris)", () => {
    const source = readFileSync(path.join(process.cwd(), "src/actions/planning.ts"), "utf8");
    const lot = source.slice(source.indexOf("export async function enregistrerCases"));
    const retourAnticipe = lot.slice(lot.indexOf("if (aEcrire.length === 0)"), lot.indexOf("if (aEcrire.length === 0)") + 200);
    expect(retourAnticipe).toContain("await signalerEcrituresPlanning(user, [])");
  });

  it("une suppression ne part jamais seule, et « Annuler » la fait oublier", async () => {
    faux.seances[1].date = "2099-10-23";
    differerRetraitPlanning(AUTEUR, { id: "p9", sessionId: "s2", nature: "COURS", bloc: 1, ordre: 0, libelle: "Cours", theme: "Rapière", description: "", niveau: "INDIFFERENT", instructeur: LEA, instructeurSecond: null });
    expect(await envoyerAttente(AUTEUR.id)).toBe(0);
    oublierRetraitsPlanning(AUTEUR.id);
    expect(await annoncerAttentePlanning(AUTEUR)).toBe(0);
    expect(faux.emails).toHaveLength(0);
    // Appliquer sans case à écrire annonce les suppressions en attente
    differerRetraitPlanning(AUTEUR, { id: "p9", sessionId: "s2", nature: "COURS", bloc: 1, ordre: 0, libelle: "Cours", theme: "Rapière", description: "", niveau: "INDIFFERENT", instructeur: LEA, instructeurSecond: null });
    expect(await annoncerAttentePlanning(AUTEUR)).toBeGreaterThan(0);
    expect(faux.emails.find((e) => e.to === "charlie@club.fr")!.contenu.paragraphes.join("\n")).toContain("Supprimé : Cours « Rapière », par Léa Garnier");
  });

  it("un aller-retour (A → B → A) n'envoie rien", async () => {
    faux.seances[1].date = "2099-10-23";
    differerModificationsPlanning(AUTEUR, [ecriture("Dussack", LEA, "Messer", LEA, 1)]);
    differerModificationsPlanning(AUTEUR, [ecriture("Messer", LEA, "Dussack", LEA, 2)]);
    expect(await envoyerAttente(AUTEUR.id)).toBe(0);
    expect(faux.emails).toHaveLength(0);
  });
});
