import { readFileSync } from "node:fs";
import path from "node:path";
import { caseCochee } from "@/lib/form";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { evenementSchema } from "@/lib/validation/evenements";

/**
 * Espace « Événements » : qui peut écrire, ce que la validation refuse, et comment la liste se
 * partage entre « à venir » et « passés » — brouillons compris.
 */

type LigneEvenement = {
  id: string;
  nom: string;
  description: string;
  dateDebut: string;
  heureDebut: string | null;
  dateFin: string | null;
  heureFin: string | null;
  lieu: string;
  adresse: string;
  organisateur: string;
  prix: string;
  prixAdherent: string;
  dureeNombre: number | null;
  dureeUnite: string;
  lienInscription: string;
  lienSource: string;
  imageUrl: string;
  publie: boolean;
  publieAt: Date | null;
  creeParId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const faux = vi.hoisted(() => ({
  acteur: { id: "u-instru", email: "echo@club.test", role: "INSTRUCTEUR", actif: true },
  lignes: [] as Record<string, unknown>[],
  crees: [] as Record<string, unknown>[],
  majs: [] as { id: string; data: Record<string, unknown> }[],
  supprimes: [] as string[],
  audits: [] as { action: string; cible: string | null; details: unknown }[],
  visites: {} as Record<string, Date | null>,
  majComptes: [] as { id: string; data: Record<string, unknown> }[],
}));

/** Évaluateur minimal des filtres Prisma utilisés par src/lib/evenements.ts (egalité, null, gte/lte, OR/AND). */
function correspond(ligne: Record<string, unknown>, where: Record<string, unknown>): boolean {
  for (const [cle, attendu] of Object.entries(where)) {
    if (cle === "OR") {
      if (!(attendu as Record<string, unknown>[]).some((c) => correspond(ligne, c))) return false;
      continue;
    }
    if (cle === "AND") {
      if (!(attendu as Record<string, unknown>[]).every((c) => correspond(ligne, c))) return false;
      continue;
    }
    const valeur = ligne[cle] as string | boolean | null;
    if (attendu === null) {
      if (valeur !== null) return false;
      continue;
    }
    if (typeof attendu === "object") {
      const { gte, lte, lt, in: dans } = attendu as { gte?: string; lte?: string; lt?: string; in?: string[] };
      if (gte !== undefined && !(typeof valeur === "string" && valeur >= gte)) return false;
      if (lte !== undefined && !(typeof valeur === "string" && valeur <= lte)) return false;
      if (lt !== undefined && !(typeof valeur === "string" && valeur < lt)) return false;
      if (dans !== undefined && !(typeof valeur === "string" && dans.includes(valeur))) return false;
      continue;
    }
    if (valeur !== attendu) return false;
  }
  return true;
}

vi.mock("@/lib/db", () => ({
  db: {
    evenement: {
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => faux.lignes.filter((l) => correspond(l, where))),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => faux.lignes.find((l) => l.id === where.id) ?? null),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
        const ligne = faux.lignes.find((l) => l.id === where.id);
        if (!ligne) throw new Error("Événement introuvable");
        return ligne;
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const ligne = { id: `e-${faux.crees.length + 1}`, ...data };
        faux.crees.push(ligne);
        return ligne;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        faux.majs.push({ id: where.id, data });
        const ligne = faux.lignes.find((l) => l.id === where.id) ?? { id: where.id, nom: "Événement" };
        return { ...ligne, ...data };
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        faux.supprimes.push(where.id);
        return faux.lignes.find((l) => l.id === where.id) ?? { id: where.id, nom: "Événement", dateDebut: "2026-10-10" };
      }),
      deleteMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const vises = faux.lignes.filter((l) => correspond(l, where));
        for (const l of vises) faux.supprimes.push(l.id as string);
        faux.lignes = faux.lignes.filter((l) => !vises.includes(l));
        return { count: vises.length };
      }),
    },
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({ evenementsVusAt: faux.visites[where.id] ?? null })),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        faux.majComptes.push({ id: where.id, data });
        return { id: where.id, ...data };
      }),
    },
  },
}));

vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async (_acteur: unknown, action: string, cible?: string | null, details?: unknown) => {
    faux.audits.push({ action, cible: cible ?? null, details });
  }),
}));

// La matrice réelle des permissions décide : l'acteur simulé change simplement de rôle.
vi.mock("@/lib/auth/current-user", async () => {
  const { can: vraiCan } = await vi.importActual<typeof import("@/lib/permissions")>("@/lib/permissions");
  return {
    assertPermission: vi.fn(async (permission: Parameters<typeof vraiCan>[1]) => {
      if (!vraiCan(faux.acteur, permission)) throw new Error("Accès refusé");
      return faux.acteur;
    }),
    getCurrentUser: vi.fn(async () => faux.acteur),
  };
});

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECTION:${url}`);
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const {
  dateDePublication,
  evenementsAVenir,
  evenementsPasses,
  evenementParId,
  nombreEvenementsNouveaux,
  peutCreerSupprimerEvenement,
  peutGererEvenements,
  peutModifierEvenement,
  purgerEvenementsAnciens,
} = await import("@/lib/evenements");
const { creerEvenement, marquerEvenementsVus, modifierEvenement, publierEvenement, supprimerEvenement } =
  await import("@/actions/evenements");

const MEMBRE = { id: "u-m1", email: "joris@club.test", role: "MEMBRE", actif: true };
const INSTRUCTEUR = { id: "u-instru", email: "echo@club.test", role: "INSTRUCTEUR", actif: true };
/**
 * **Le bureau est un supplément** : `role` ne vaut plus jamais « ADMIN ». Le rôle de base retenu
 * ici est `MEMBRE` **exprès** — ainsi tout ce que cet acteur obtient sur les annonces ne peut venir
 * que de `estAdmin`, c'est-à-dire de la ligne ADMIN de la matrice. Décrit `role: "ADMIN"`, il
 * passait par le repli de compatibilité de `can()`, et le test ne distinguait plus rien.
 */
const ADMIN = { id: "u-admin", email: "delta@club.test", role: "MEMBRE", estAdmin: true, actif: true };

/** Jeudi 23 septembre 2026, 10h00 à Paris. */
const MAINTENANT = new Date("2026-09-23T10:00:00+02:00");

function evenement(id: string, valeurs: Partial<LigneEvenement>): LigneEvenement {
  return {
    id,
    nom: id,
    description: "",
    dateDebut: "2026-10-10",
    heureDebut: null,
    dateFin: null,
    heureFin: null,
    lieu: "",
    adresse: "",
    organisateur: "",
    prix: "",
    prixAdherent: "",
    dureeNombre: null,
    dureeUnite: "jour",
    lienInscription: "",
    lienSource: "",
    imageUrl: "",
    publie: true,
    publieAt: new Date("2026-09-01T10:00:00Z"),
    creeParId: "u-instru",
    createdAt: new Date("2026-09-01T10:00:00Z"),
    updatedAt: new Date("2026-09-01T10:00:00Z"),
    ...valeurs,
  };
}

function jeuDEvenements(): LigneEvenement[] {
  return [
    // à venir
    evenement("stage-futur", { dateDebut: "2026-10-10", heureDebut: "09:00", heureFin: "18:00" }),
    evenement("tournoi-du-jour", { dateDebut: "2026-09-23", heureDebut: "19:00", heureFin: "22:00" }),
    evenement("demo-du-jour", { dateDebut: "2026-09-23" }), // journée entière, sans horaire
    evenement("stage-en-cours", { dateDebut: "2026-09-22", dateFin: "2026-09-24" }),
    // passés
    evenement("atelier-du-matin", { dateDebut: "2026-09-23", heureDebut: "08:00" }), // commencé, sans fin connue
    evenement("tournoi-passe", { dateDebut: "2026-09-20", heureDebut: "10:00", heureFin: "17:00" }),
    // brouillon (à venir)
    evenement("brouillon-stage", { dateDebut: "2026-11-01", heureDebut: "09:00", publie: false, publieAt: null }),
  ];
}

function saisie(valeurs: Record<string, string | boolean> = {}) {
  return {
    nom: "Stage de messer",
    description: "Une journée avec un invité.",
    dateDebut: "2026-11-14",
    heureDebut: "09:30",
    dateFin: "",
    heureFin: "17:00",
    lieu: "Gymnase municipal",
    adresse: "",
    organisateur: "Mon club d'AMHE",
    prix: "25 €",
    prixAdherent: "15 €",
    dureeNombre: "1",
    dureeUnite: "jour",
    lienInscription: "https://helloasso.com/stage",
    lienSource: "",
    imageUrl: "",
    publie: true,
    ...valeurs,
  };
}

function formulaire(valeurs: Record<string, string> = {}): FormData {
  const base = saisie();
  const fd = new FormData();
  for (const [cle, valeur] of Object.entries({ ...base, ...valeurs })) {
    if (cle === "publie") continue;
    fd.set(cle, String(valeur));
  }
  // La case « Publié » est cochée par défaut dans le formulaire réel : on l'envoie donc, comme le
  // navigateur. Pour un brouillon, on passe `publie: ""` — c'est-à-dire le champ **absent**, qui est
  // exactement ce qu'un navigateur envoie pour une case décochée.
  if (valeurs.publie !== undefined) {
    if (valeurs.publie !== "") fd.set("publie", valeurs.publie);
  } else {
    fd.set("publie", "on");
  }
  return fd;
}

beforeEach(() => {
  faux.acteur = { ...ADMIN };
  faux.lignes = jeuDEvenements();
  faux.crees = [];
  faux.majs = [];
  faux.supprimes = [];
  faux.audits = [];
  faux.visites = {};
  faux.majComptes = [];
});

/**
 * **`creerEvenement` redirige vers l'annonce créée** : une server action signale sa redirection en
 * **levant**, ce qui est un succès et non une erreur. On lit donc la destination au lieu d'un
 * `FormState` — le même patron que `tests/unit/admin-activation.test.ts`.
 */
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

describe("permissions", () => {
  it("un membre ne peut rien écrire", async () => {
    faux.acteur = { ...MEMBRE };
    await expect(creerEvenement({}, formulaire())).rejects.toThrow("Accès refusé");
    await expect(modifierEvenement("stage-futur", {}, formulaire())).rejects.toThrow("Accès refusé");
    await expect(publierEvenement("brouillon-stage", true)).rejects.toThrow("Accès refusé");
    await expect(supprimerEvenement("stage-futur")).rejects.toThrow("Accès refusé");
    expect(faux.crees).toHaveLength(0);
    expect(faux.majs).toHaveLength(0);
    expect(faux.supprimes).toHaveLength(0);
  });

  /**
   * **Les annonces appartiennent à l'encadrement entier** : les stages, tournois et démonstrations
   * sont la vie du club, et c'est l'instructeur qui les connaît, les organise et sait quand ils
   * tombent à l'eau. Une annonce se retire d'un clic et n'ouvre aucun accès à personne — ce n'est
   * ni un compte ni un trimestre.
   */
  it("un instructeur fait tout sur les annonces : créer, modifier, publier, supprimer", async () => {
    faux.acteur = { ...INSTRUCTEUR };
    const etat = await modifierEvenement("stage-futur", {}, formulaire({ nom: "Stage de dague" }));
    expect(etat.succes).toBeTruthy();
    await publierEvenement("brouillon-stage", true);
    expect(faux.majs).toHaveLength(2);

    await redirectionDe(creerEvenement({}, formulaire()));
    await supprimerEvenement("stage-futur");
    expect(faux.crees).toHaveLength(1);
    expect(faux.supprimes).toHaveLength(1);
    expect(faux.audits.map((a) => a.action)).toEqual(["evenement.modifie", "evenement.publie", "evenement.cree", "evenement.supprime"]);
  });

  it("un administrateur fait tout", async () => {
    faux.acteur = { ...ADMIN };
    // La création **redirige** vers l'annonce : c'est là qu'on lit qu'elle a réussi, et non dans un
    // message sous un formulaire à moitié vidé.
    expect(await redirectionDe(creerEvenement({}, formulaire()))).toBe("/evenements/e-1");
    expect(faux.crees[0]).toMatchObject({
      nom: "Stage de messer",
      dateDebut: "2026-11-14",
      organisateur: "Mon club d'AMHE",
      creeParId: ADMIN.id,
      publie: true,
    });
    await modifierEvenement("stage-futur", {}, formulaire());
    await publierEvenement("brouillon-stage", false);
    await supprimerEvenement("tournoi-passe");
    expect(faux.audits.map((a) => a.action)).toEqual(["evenement.cree", "evenement.modifie", "evenement.publie", "evenement.supprime"]);
    expect(faux.audits.map((a) => a.cible)).toEqual([faux.crees[0].id, "stage-futur", "brouillon-stage", "tournoi-passe"]);
    expect(faux.majs[1]).toMatchObject({ id: "brouillon-stage", data: { publie: false } });
    expect(faux.supprimes).toEqual(["tournoi-passe"]);
  });

  it("les deux questions de droits se posent séparément (boutons des écrans)", () => {
    // Un membre est en **lecture seule** sur les annonces : il les consulte, il n'en touche aucune
    expect([peutModifierEvenement(MEMBRE), peutCreerSupprimerEvenement(MEMBRE)]).toEqual([false, false]);
    expect([peutModifierEvenement(INSTRUCTEUR), peutCreerSupprimerEvenement(INSTRUCTEUR)]).toEqual([true, true]);
    expect([peutModifierEvenement(ADMIN), peutCreerSupprimerEvenement(ADMIN)]).toEqual([true, true]);
    expect(peutModifierEvenement({ ...INSTRUCTEUR, actif: false })).toBe(false);
    expect(peutModifierEvenement(null)).toBe(false);
    // Raccourci « cette personne a-t-elle quelque chose à faire ici ? » = au moins modifier
    expect([peutGererEvenements(MEMBRE), peutGererEvenements(INSTRUCTEUR), peutGererEvenements(ADMIN)]).toEqual([false, true, true]);
  });

  it("la modification ne réécrit jamais qui a créé l'événement", async () => {
    faux.acteur = { ...INSTRUCTEUR };
    await modifierEvenement("stage-futur", {}, formulaire());
    expect(faux.majs[0].data).not.toHaveProperty("creeParId");
  });
});

describe("validation", () => {
  it("accepte une affiche déposée dans l'application, pas seulement une adresse http", () => {
    const depose = "/api/affiche/" + "a".repeat(64) + ".png";
    expect(evenementSchema.safeParse(saisie({ imageUrl: depose })).success).toBe(true);
    expect(evenementSchema.safeParse(saisie({ imageUrl: "https://exemple.fr/affiche.jpg" })).success).toBe(true);
    expect(evenementSchema.safeParse(saisie({ imageUrl: "" })).success).toBe(true);
  });

  it("refuse un chemin interne bricolé : seul le nom qu'écrit l'application passe", () => {
    for (const faux of [
      "/api/affiche/../../etc/passwd",
      "/api/affiche/court.png",
      "/api/affiche/" + "a".repeat(64) + ".svg",
      "/api/autre/" + "a".repeat(64) + ".png",
      "javascript:alert(1)",
      "data:image/png;base64,AAAA",
    ]) {
      expect(evenementSchema.safeParse(saisie({ imageUrl: faux })).success, faux).toBe(false);
    }
  });

  it("accepte une saisie complète et enregistre les champs vides en null", () => {
    const r = evenementSchema.safeParse(saisie({ heureFin: "", lienInscription: "" }));
    expect(r.success).toBe(true);
    expect(r.success && r.data).toMatchObject({ dateFin: null, heureFin: null, heureDebut: "09:30", lienInscription: "" });
  });

  it("refuse un nom vide ou trop court", () => {
    for (const nom of ["", "   ", "a"]) {
      const r = evenementSchema.safeParse(saisie({ nom }));
      expect(r.success).toBe(false);
      expect(!r.success && r.error.issues[0].path).toEqual(["nom"]);
    }
  });

  it("refuse une date de fin antérieure à la date de début", () => {
    const r = evenementSchema.safeParse(saisie({ dateDebut: "2026-11-14", dateFin: "2026-11-13" }));
    expect(r.success).toBe(false);
    expect(!r.success && r.error.issues[0].message).toMatch(/date de fin/i);
  });

  it("refuse une heure de fin avant l'heure de début le même jour, mais l'accepte sur deux jours", () => {
    expect(evenementSchema.safeParse(saisie({ heureDebut: "18:00", heureFin: "09:00" })).success).toBe(false);
    expect(evenementSchema.safeParse(saisie({ heureDebut: "18:00", heureFin: "09:00", dateFin: "2026-11-15" })).success).toBe(true);
  });

  it("refuse une date ou une heure mal formée", () => {
    expect(evenementSchema.safeParse(saisie({ dateDebut: "14/11/2026" })).success).toBe(false);
    expect(evenementSchema.safeParse(saisie({ heureDebut: "9h30" })).success).toBe(false);
    expect(evenementSchema.safeParse(saisie({ heureDebut: "25:00" })).success).toBe(false);
  });

  it("refuse les liens qui ne sont pas en http(s)", () => {
    const dangereux = [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html;base64,PHNjcmlwdD4=",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
      "/evenements",
      "www.exemple.fr",
    ];
    for (const lien of dangereux) {
      expect(evenementSchema.safeParse(saisie({ lienInscription: lien })).success, lien).toBe(false);
      expect(evenementSchema.safeParse(saisie({ lienSource: lien })).success, lien).toBe(false);
      expect(evenementSchema.safeParse(saisie({ imageUrl: lien })).success, lien).toBe(false);
    }
    expect(evenementSchema.safeParse(saisie({ lienSource: "https://www.facebook.com/hema/posts/42" })).success).toBe(true);
    expect(evenementSchema.safeParse(saisie({ imageUrl: "http://exemple.fr/affiche.jpg" })).success).toBe(true);
  });

  it("garde la description en texte brut (affichée échappée) et la borne à 600 caractères", () => {
    const description = "<script>alert('x')</script> & une \"citation\"";
    const r = evenementSchema.safeParse(saisie({ description }));
    expect(r.success && r.data.description).toBe(description);
    expect(evenementSchema.safeParse(saisie({ description: "a".repeat(601) })).success).toBe(false);
    expect(evenementSchema.safeParse(saisie({ description: "a".repeat(600) })).success).toBe(true);
  });

  it("organisateur : facultatif, nettoyé des espaces, refusé au-delà de 120 caractères", () => {
    const vide = evenementSchema.safeParse(saisie({ organisateur: "" }));
    expect(vide.success && vide.data.organisateur).toBe("");
    const espaces = evenementSchema.safeParse(saisie({ organisateur: "  Cercle d'escrime de Villebourg  " }));
    expect(espaces.success && espaces.data.organisateur).toBe("Cercle d'escrime de Villebourg");
    expect(evenementSchema.safeParse(saisie({ organisateur: "o".repeat(120) })).success).toBe(true);
    expect(evenementSchema.safeParse(saisie({ organisateur: "o".repeat(121) })).success).toBe(false);
  });

  it("prix : texte libre facultatif, borné à 60 caractères — vide veut dire gratuit", () => {
    // Le champ laissé vide reste vide en base : c'est l'affichage qui dira « Gratuit »,
    // la validation n'a surtout pas à écrire ce mot à la place de l'encadrement.
    const vide = evenementSchema.safeParse(saisie({ prix: "" }));
    expect(vide.success && vide.data.prix).toBe("");
    // Les formes réelles d'un tarif de club : un montant, deux tarifs, une participation libre.
    for (const prix of ["25 €", "15 € / 10 € adhérents", "prix libre", "Gratuit pour les mineurs"]) {
      const r = evenementSchema.safeParse(saisie({ prix }));
      expect(r.success && r.data.prix, prix).toBe(prix);
    }
    expect(evenementSchema.safeParse(saisie({ prix: "p".repeat(60) })).success).toBe(true);
    expect(evenementSchema.safeParse(saisie({ prix: "p".repeat(61) })).success).toBe(false);
  });

  it("prix adhérent : facultatif comme le prix, borné pareil — mais un vide qui ne dit rien", () => {
    // Le contraste avec `prix` est tout l'intérêt du champ : un prix vide veut dire « gratuit »,
    // un prix adhérent vide veut dire « il n'y a pas de tarif adhérent », et l'écran se tait.
    const vide = evenementSchema.safeParse(saisie({ prixAdherent: "" }));
    expect(vide.success && vide.data.prixAdherent).toBe("");
    const rempli = evenementSchema.safeParse(saisie({ prixAdherent: "  10 €\u0000  " }));
    expect(rempli.success && rempli.data.prixAdherent).toBe("10 €");
    expect(evenementSchema.safeParse(saisie({ prixAdherent: "a".repeat(60) })).success).toBe(true);
    expect(evenementSchema.safeParse(saisie({ prixAdherent: "a".repeat(61) })).success).toBe(false);
  });

  it("durée : le nombre est facultatif, et un champ vide veut dire « non précisée »", () => {
    const vide = evenementSchema.safeParse(saisie({ dureeNombre: "" }));
    expect(vide.success && vide.data.dureeNombre).toBeNull();
    const deux = evenementSchema.safeParse(saisie({ dureeNombre: "2" }));
    // Le formulaire envoie du texte, la base reçoit un entier : la conversion est bien faite ici.
    expect(deux.success && deux.data.dureeNombre).toBe(2);
    expect(evenementSchema.safeParse(saisie({ dureeNombre: " 99 " })).success).toBe(true);
  });

  it("durée : refuse zéro, au-delà de 99, et tout ce qui n'est pas un entier", () => {
    // « 2.5 » et « -1 » sont les pièges de `Number()`, qui les aurait convertis sans broncher.
    for (const dureeNombre of ["0", "100", "-1", "deux", "2.5", "1e3", "٢"]) {
      const r = evenementSchema.safeParse(saisie({ dureeNombre }));
      expect(r.success, dureeNombre).toBe(false);
      expect(!r.success && r.error.issues[0].path, dureeNombre).toEqual(["dureeNombre"]);
    }
  });

  it("durée : les quatre unités passent, une unité inconnue retombe sur « jour »", () => {
    for (const dureeUnite of ["demi-journee", "jour", "semaine", "mois"]) {
      const r = evenementSchema.safeParse(saisie({ dureeUnite }));
      expect(r.success && r.data.dureeUnite, dureeUnite).toBe(dureeUnite);
    }
    // Liste déroulante bricolée ou absente : on n'échoue pas, mais on n'écrit pas ça en base non plus.
    for (const bricole of ["", "annee", "JOUR", "<script>"]) {
      const r = evenementSchema.safeParse(saisie({ dureeUnite: bricole }));
      expect(r.success, bricole).toBe(true);
      expect(r.success && r.data.dureeUnite, bricole).toBe("jour");
    }
  });

  it("le prix est nettoyé comme les autres textes (espaces, caractères de contrôle)", () => {
    const r = evenementSchema.safeParse(saisie({ prix: "  25\u0000 €  " }));
    expect(r.success && r.data.prix).toBe("25 €");
  });

  it("l'action renvoie les erreurs champ par champ au lieu d'écrire en base", async () => {
    const etat = await creerEvenement({}, formulaire({ nom: "", lienInscription: "javascript:alert(1)" }));
    expect(etat.erreurs?.nom).toBeTruthy();
    expect(etat.erreurs?.lienInscription).toBeTruthy();
    expect(faux.crees).toHaveLength(0);
  });
});

describe("séparation passé / à venir", () => {
  it("à venir : du plus proche au plus lointain, l'événement du jour compris", async () => {
    const liste = await evenementsAVenir(MEMBRE, MAINTENANT);
    expect(liste.map((e) => e.id)).toEqual(["stage-en-cours", "demo-du-jour", "tournoi-du-jour", "stage-futur"]);
  });

  it("passés : du plus récent au plus ancien", async () => {
    const liste = await evenementsPasses(MEMBRE, MAINTENANT);
    expect(liste.map((e) => e.id)).toEqual(["atelier-du-matin", "tournoi-passe"]);
  });

  it("une annonce ouverte après une autre, mais plus proche, passe devant", async () => {
    // Le 10 octobre existe déjà ; on ouvre ensuite le 7 octobre. C'est la date de l'événement qui
    // classe, jamais l'ordre de création — ce que l'écran doit montrer aussitôt (voir `rafraichir`
    // dans src/actions/evenements.ts : sans revalidation de l'en-tête, on regardait une liste périmée).
    faux.lignes.push(evenement("annonce-10-octobre", { dateDebut: "2026-10-10" }));
    faux.lignes.push(evenement("annonce-07-octobre", { dateDebut: "2026-10-07" }));
    const liste = (await evenementsAVenir(MEMBRE, MAINTENANT)).map((e) => e.id);
    expect(liste.indexOf("annonce-07-octobre")).toBeLessThan(liste.indexOf("annonce-10-octobre"));
    expect(liste.indexOf("annonce-07-octobre")).toBeLessThan(liste.indexOf("stage-futur"));
  });

  it("aucun événement ne figure dans les deux listes", async () => {
    const aVenir = (await evenementsAVenir(ADMIN, MAINTENANT)).map((e) => e.id);
    const passes = (await evenementsPasses(ADMIN, MAINTENANT)).map((e) => e.id);
    expect(aVenir.filter((id) => passes.includes(id))).toEqual([]);
    expect(aVenir.length + passes.length).toBe(faux.lignes.length);
  });

  it("la frontière se fait sur la fin quand elle existe, sinon sur le début", async () => {
    // Le tournoi du jour finit à 22h00 : à 21h00 il est encore à venir, à 22h01 il est passé.
    const avant = await evenementsAVenir(MEMBRE, new Date("2026-09-23T21:00:00+02:00"));
    expect(avant.map((e) => e.id)).toContain("tournoi-du-jour");
    const apres = await evenementsPasses(MEMBRE, new Date("2026-09-23T22:01:00+02:00"));
    expect(apres.map((e) => e.id)).toContain("tournoi-du-jour");
    // La démonstration sans horaire tient toute sa journée, puis bascule le lendemain.
    expect((await evenementsAVenir(MEMBRE, new Date("2026-09-23T23:00:00+02:00"))).map((e) => e.id)).toContain("demo-du-jour");
    expect((await evenementsPasses(MEMBRE, new Date("2026-09-24T00:30:00+02:00"))).map((e) => e.id)).toContain("demo-du-jour");
    // Le stage sur trois jours reste à venir tant que sa date de fin n'est pas dépassée.
    expect((await evenementsAVenir(MEMBRE, new Date("2026-09-24T18:00:00+02:00"))).map((e) => e.id)).toContain("stage-en-cours");
    expect((await evenementsPasses(MEMBRE, new Date("2026-09-25T09:00:00+02:00"))).map((e) => e.id)).toContain("stage-en-cours");
  });
});

describe("brouillons", () => {
  it("un membre ne voit pas les brouillons", async () => {
    const liste = await evenementsAVenir(MEMBRE, MAINTENANT);
    expect(liste.map((e) => e.id)).not.toContain("brouillon-stage");
    expect(await evenementParId("brouillon-stage", MEMBRE)).toBeNull();
  });

  it("l'équipe voit les brouillons, à leur place chronologique", async () => {
    for (const acteur of [INSTRUCTEUR, ADMIN]) {
      const liste = await evenementsAVenir(acteur, MAINTENANT);
      expect(liste.map((e) => e.id)).toEqual(["stage-en-cours", "demo-du-jour", "tournoi-du-jour", "stage-futur", "brouillon-stage"]);
      expect(await evenementParId("brouillon-stage", acteur)).not.toBeNull();
    }
  });

  it("un compte désactivé est traité comme un membre", async () => {
    const suspendu = { ...INSTRUCTEUR, actif: false };
    expect((await evenementsAVenir(suspendu, MAINTENANT)).map((e) => e.id)).not.toContain("brouillon-stage");
  });

  it("le formulaire enregistre un brouillon quand la case « Publié » est décochée", async () => {
    // Une case décochée n'envoie aucun champ : c'est cette absence qui doit valoir brouillon.
    // Jusqu', elle valait publication — et l'annonce partait à tout le club. Le brouillon redirige
    // comme l'annonce publiée : c'est la carte d'arrivée qui dit laquelle des deux on vient de
    // créer, plutôt qu'un message sur l'écran qu'on quitte.
    await redirectionDe(creerEvenement({}, formulaire({ publie: "" })));
    expect(faux.crees[0]).toMatchObject({ publie: false });
  });
});

describe("pastille « du nouveau »", () => {
  /** Dernière visite : la veille au soir, avant que rien n'ait été publié. */
  const VEILLE = new Date("2026-09-22T20:00:00+02:00");

  it("jamais ouvert le panneau : tout ce qui est visible est nouveau", async () => {
    expect(await nombreEvenementsNouveaux(MEMBRE, MAINTENANT)).toBe(4);
    expect(await nombreEvenementsNouveaux(INSTRUCTEUR, MAINTENANT)).toBe(5); // + le brouillon
  });

  it("plus rien de nouveau juste après un passage", async () => {
    faux.visites[MEMBRE.id] = MAINTENANT;
    expect(await nombreEvenementsNouveaux(MEMBRE, MAINTENANT)).toBe(0);
    faux.visites[INSTRUCTEUR.id] = MAINTENANT;
    expect(await nombreEvenementsNouveaux(INSTRUCTEUR, MAINTENANT)).toBe(0);
  });

  it("ne compte que ce que la personne voit : le brouillon est pour l'équipe seule", async () => {
    faux.lignes = [
      evenement("annonce-publique", { dateDebut: "2026-10-10", publieAt: new Date("2026-09-23T09:00:00+02:00") }),
      // Brouillon ouvert ce matin : nouveau pour l'équipe (il n'a pas de date de publication,
      // c'est donc sa création qui dit quand il est apparu), invisible pour un membre.
      evenement("brouillon", {
        dateDebut: "2026-10-11",
        publie: false,
        publieAt: null,
        createdAt: new Date("2026-09-23T08:30:00+02:00"),
      }),
    ];
    faux.visites[MEMBRE.id] = VEILLE;
    faux.visites[INSTRUCTEUR.id] = VEILLE;
    faux.visites[ADMIN.id] = VEILLE;
    expect(await nombreEvenementsNouveaux(MEMBRE, MAINTENANT)).toBe(1);
    expect(await nombreEvenementsNouveaux(INSTRUCTEUR, MAINTENANT)).toBe(2);
    expect(await nombreEvenementsNouveaux(ADMIN, MAINTENANT)).toBe(2);
  });

  it("un événement terminé n'est pas une nouveauté, même publié à l'instant", async () => {
    faux.lignes = [
      evenement("tournoi-passe", { dateDebut: "2026-09-20", heureFin: "17:00", publieAt: new Date("2026-09-23T09:00:00+02:00") }),
      evenement("stage-a-venir", { dateDebut: "2026-10-10", publieAt: new Date("2026-09-23T09:00:00+02:00") }),
    ];
    faux.visites[MEMBRE.id] = VEILLE;
    expect(await nombreEvenementsNouveaux(MEMBRE, MAINTENANT)).toBe(1);
  });

  it("un vieux brouillon publié aujourd'hui compte comme nouveau (c'est la publication qui fait foi)", async () => {
    faux.lignes = [
      // créé il y a une semaine, resté au brouillon, publié ce matin
      evenement("stage-enfin-publie", {
        dateDebut: "2026-10-10",
        createdAt: new Date("2026-09-16T10:00:00Z"),
        publieAt: new Date("2026-09-23T09:00:00+02:00"),
      }),
      // créé et publié il y a une semaine : déjà vu
      evenement("stage-deja-connu", {
        dateDebut: "2026-10-12",
        createdAt: new Date("2026-09-16T10:00:00Z"),
        publieAt: new Date("2026-09-16T10:00:00Z"),
      }),
    ];
    faux.visites[MEMBRE.id] = VEILLE;
    expect(await nombreEvenementsNouveaux(MEMBRE, MAINTENANT)).toBe(1);
    // Annonce d'avant la colonne `publieAt` : on retombe sur la date de création
    expect(dateDePublication({ publieAt: null, createdAt: new Date("2026-09-16T10:00:00Z") })).toEqual(new Date("2026-09-16T10:00:00Z"));
  });

  it("la publication d'un brouillon pose sa date, une simple correction ne la bouge pas", async () => {
    faux.acteur = { ...INSTRUCTEUR };
    await publierEvenement("brouillon-stage", true);
    expect(faux.majs[0].data.publieAt).toBeInstanceOf(Date);
    // Annonce déjà publiée : la date de publication d'origine est conservée
    await modifierEvenement("stage-futur", {}, formulaire({ nom: "Stage de dague" }));
    expect(faux.majs[1].data.publieAt).toEqual(new Date("2026-09-01T10:00:00Z"));
    // Dépublier garde la date d'avant : l'annonce est cachée, elle ne compte plus de toute façon
    await publierEvenement("stage-futur", false);
    expect(faux.majs[2].data).toMatchObject({ publie: false, publieAt: new Date("2026-09-01T10:00:00Z") });
  });

  it("un brouillon créé n'a pas de date de publication, une annonce publiée en a une", async () => {
    faux.acteur = { ...ADMIN };
    // Case « Publié » décochée : le navigateur n'envoie **rien**, le champ est absent.
    await redirectionDe(creerEvenement({}, formulaire({ publie: "" })));
    expect(faux.crees[0].publieAt).toBeNull();
    await redirectionDe(creerEvenement({}, formulaire()));
    expect(faux.crees[1].publieAt).toBeInstanceOf(Date);
  });

  it("marquer comme vu pose l'horodatage sur la personne connectée, et seulement cela", async () => {
    faux.acteur = { ...MEMBRE };
    await marquerEvenementsVus();
    expect(faux.majComptes).toHaveLength(1);
    expect(faux.majComptes[0].id).toBe(MEMBRE.id);
    expect(Object.keys(faux.majComptes[0].data)).toEqual(["evenementsVusAt"]);
    expect(faux.majComptes[0].data.evenementsVusAt).toBeInstanceOf(Date);
    // Geste de lecture : rien dans le journal d'audit
    expect(faux.audits).toHaveLength(0);
    // Idempotente : la rappeler ne fait que réécrire la même chose
    await marquerEvenementsVus();
    expect(faux.majComptes).toHaveLength(2);
    expect(faux.majComptes[1].id).toBe(MEMBRE.id);
  });

  it("personne de connectée : aucune pastille, aucune écriture", async () => {
    expect(await nombreEvenementsNouveaux(null, MAINTENANT)).toBe(0);
  });
});

/**
 * Oubli automatique : une annonce d'événement est une affiche, pas un registre. Passé six mois,
 * elle n'informe plus personne et garde en base des noms, des adresses et une image pour rien.
 * (Les présences aux cours, elles, ne sont jamais concernées : l'historique du club se conserve.)
 */
describe("purge des annonces de plus de six mois", () => {
  // MAINTENANT =, donc la borne tombe.
  it("une annonce de l'an dernier disparaît", async () => {
    faux.lignes.push(evenement("tournoi-2025", { dateDebut: "2025-06-14", heureDebut: "09:00", heureFin: "18:00" }));
    expect(await purgerEvenementsAnciens(MAINTENANT)).toBe(1);
    expect(faux.supprimes).toEqual(["tournoi-2025"]);
  });

  it("une annonce terminée il y a cinq mois est gardée", async () => {
    faux.lignes.push(evenement("stage-avril", { dateDebut: "2026-04-18" }));
    expect(await purgerEvenementsAnciens(MAINTENANT)).toBe(0);
    expect(faux.supprimes).toEqual([]);
  });

  it("la borne se lit sur la fin, pas sur le début : un stage à cheval reste", async () => {
    // Commencé avant la borne du 23 mars, terminé après : il n'a pas encore six mois.
    faux.lignes.push(evenement("stage-a-cheval", { dateDebut: "2026-03-20", dateFin: "2026-03-25" }));
    // Celui-ci s'achève la veille de la borne : il part.
    faux.lignes.push(evenement("stage-juste-avant", { dateDebut: "2026-03-18", dateFin: "2026-03-22" }));
    expect(await purgerEvenementsAnciens(MAINTENANT)).toBe(1);
    expect(faux.supprimes).toEqual(["stage-juste-avant"]);
  });

  it("les annonces à venir et les brouillons ne sont jamais touchés", async () => {
    const avant = faux.lignes.length;
    expect(await purgerEvenementsAnciens(MAINTENANT)).toBe(0);
    expect(faux.lignes).toHaveLength(avant);
    expect(faux.lignes.map((l) => l.id)).toContain("brouillon-stage");
  });

  it("un brouillon oublié depuis deux ans part comme les autres", async () => {
    faux.lignes.push(evenement("brouillon-2024", { dateDebut: "2024-11-02", publie: false, publieAt: null }));
    expect(await purgerEvenementsAnciens(MAINTENANT)).toBe(1);
    expect(faux.supprimes).toEqual(["brouillon-2024"]);
  });
});

/**
 * **La case « Publié » décochée doit garder l'annonce pour l'équipe** — trouvé par la campagne e2e,
 * en constatant que douze emails partaient pour un brouillon.
 *
 * Une case à cocher non cochée n'est pas envoyée par le navigateur : le champ est **absent** du
 * `FormData`, il ne vaut pas « false ». Le code lisait alors un second champ, `brouillon`, qui
 * n'existe dans aucun formulaire du dépôt — l'absence valait donc publication, et l'annonce partait
 * à tout le club par email, Discord, Telegram et téléphone. On ne pouvait pas non plus dépublier
 * depuis le formulaire.
 *
 * Le test lit la source plutôt que d'appeler l'action (qui exige une session, une permission et une
 * base) : ce qu'on veut interdire, c'est le retour de la branche morte.
 */
describe("la case « Publié » est la seule à décider", () => {
  const source = readFileSync(path.join(process.cwd(), "src/actions/evenements.ts"), "utf8");

  it("ne lit que le champ `publie`, jamais un champ `brouillon` qui n'existe pas", () => {
    const corps = source.slice(source.indexOf("function lirePublication"), source.indexOf("function lirePublication") + 400);
    expect(corps).toContain('caseCochee(fd, "publie")');
    expect(corps).not.toContain("brouillon");
  });

  it("le formulaire porte bien la case que l'action lit", () => {
    const formulaire = readFileSync(path.join(process.cwd(), "src/components/evenements/FormulaireEvenement.tsx"), "utf8");
    expect(formulaire).toContain('name="publie"');
  });

  it("un champ absent vaut brouillon : entre les deux erreurs, on garde l'annonce pour soi", () => {
    // `caseCochee` est la fonction réellement employée : une clé absente n'est ni "on" ni "true".
    expect(caseCochee(new FormData(), "publie")).toBe(false);
  });
});
