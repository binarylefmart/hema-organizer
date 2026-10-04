import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **`/api/image` était un relais ouvert.**
 *
 * La route ne vérifiait **jamais** que son paramètre `url` correspondait à quoi que ce soit. Un
 * MEMBRE — et une session de membre s'ouvre par simple lien personnel, sans mot de passe — pouvait
 * donc faire chercher n'importe quelle adresse publique, sur n'importe quel port, 300 fois par quart
 * d'heure, **depuis l'adresse IP du club et avec un `User-Agent` qui nomme son domaine**. Pire, les
 * messages d'erreur distinguaient les cas (« nom de domaine inconnu », « met trop de temps à
 * répondre », « demande une connexion », « erreur 404 », « a répondu par une erreur (500) ») : de
 * quoi lire l'état d'un hôte et d'un port dans la réponse, gratuitement.
 *
 * Ce qui n'était **pas** en jeu, et ce test ne le prétend pas : le réseau interne. La garde de
 * `lien-apercu.ts` (privé, bouclage, lien-local, CGNAT, NAT64, 6to4, revérifiée à chaque saut) est
 * stricte et reste la seule à décider des adresses. Ce qui était en jeu, c'est la **réputation de
 * l'adresse du club** : un balayage mené depuis chez nous se lit comme un balayage de chez nous.
 *
 * Deux moitiés se vérifient ici :
 *  1. **la liste blanche** — seules deux adresses passent : l'affiche d'un événement **enregistré**
 *     (lue en base) et l'illustration qu'un **aperçu de lien** vient de proposer. Et le refus tombe
 *     *avant* la requête sortante, sinon il ne protège rien ;
 *  2. **un message unique** pour tout échec réseau, quel qu'il soit.
 */

const faux = vi.hoisted(() => ({
  session: { id: "u1" } as { id: string } | null,
  /** Les `imageUrl` d'événements enregistrés. */
  enBase: [] as string[],
  /** Ce que la route a vraiment demandé au réseau. */
  demandees: [] as string[],
  /** Erreur à lever au lieu de servir l'image. */
  echec: null as Error | null,
}));

vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: vi.fn(async () => faux.session) }));

// Résolution de nom neutralisée : le seul aperçu joué ici n'a pas à dépendre du DNS de la machine.
vi.mock("node:dns/promises", () => ({ lookup: vi.fn(async () => [{ address: "93.184.216.34" }]) }));

vi.mock("@/lib/db", () => ({
  db: {
    evenement: {
      count: vi.fn(async ({ where }: { where: { imageUrl: string } }) => faux.enBase.filter((u) => u === where.imageUrl).length),
    },
  },
}));

// Le registre d'aperçu et `ErreurApercu` restent les vrais : c'est la liste blanche qu'on éprouve.
vi.mock("@/lib/lien-apercu", async (original) => {
  const vrai = await original<typeof import("@/lib/lien-apercu")>();
  return {
    ...vrai,
    recupererImage: vi.fn(async (url: string) => {
      faux.demandees.push(url);
      if (faux.echec) throw faux.echec;
      return { octets: new Uint8Array([1, 2, 3]), typeContenu: "image/png" };
    }),
  };
});

const { NextRequest } = await import("next/server");
const { GET } = await import("@/app/api/image/route");
const { ErreurApercu, autoriserImageApercu, oublierImagesApercu, IMAGE_APERCU_TTL_MS, recupererApercu } = await import("@/lib/lien-apercu");
const { utiliserMagasinMemoire } = await import("@/lib/auth/rate-limit");

const AFFICHE = "https://exemple-club.fr/affiches/stage-messer.jpg";

function demander(url: string) {
  return GET(new NextRequest(`https://organizer.exemple.fr/api/image?url=${encodeURIComponent(url)}`));
}

beforeEach(() => {
  utiliserMagasinMemoire();
  oublierImagesApercu();
  faux.session = { id: "u1" };
  faux.enBase = [];
  faux.demandees = [];
  faux.echec = null;
});

describe("le relais ne va chercher que des adresses que le serveur connaît", () => {
  it("une adresse inventée est refusée, et rien ne sort sur le réseau", async () => {
    const res = await demander("https://192-0-2-33.exemple.fr:8080/sonde");
    expect(res.status).toBe(400);
    expect(faux.demandees).toEqual([]); // le point dur : aucune requête sortante
  });

  it("l'affiche d'un événement enregistré passe", async () => {
    faux.enBase = [AFFICHE];
    const res = await demander(AFFICHE);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(faux.demandees).toEqual([AFFICHE]);
  });

  it("une variante de l'adresse enregistrée ne passe pas : la comparaison est exacte", async () => {
    faux.enBase = [AFFICHE];
    for (const variante of [`${AFFICHE}?x=1`, `${AFFICHE}#a`, AFFICHE.replace("https", "http"), `${AFFICHE} `.replace(".jpg ", ".jpg.")]) {
      expect((await demander(variante)).status).toBe(400);
    }
    expect(faux.demandees).toEqual([]);
  });

  it("l'illustration que le serveur vient de proposer passe, le temps de remplir le formulaire", async () => {
    autoriserImageApercu(AFFICHE);
    expect((await demander(AFFICHE)).status).toBe(200);
  });

  it("… et cesse de passer quand elle a vieilli", async () => {
    const depart = Date.parse("2026-09-30T18:00:00Z");
    autoriserImageApercu(AFFICHE, depart);
    vi.setSystemTime(depart + IMAGE_APERCU_TTL_MS + 1);
    try {
      expect((await demander(AFFICHE)).status).toBe(400);
    } finally {
      vi.useRealTimers();
    }
  });

  it("une session fermée est refusée avant tout, comme avant", async () => {
    faux.session = null;
    faux.enBase = [AFFICHE];
    expect((await demander(AFFICHE)).status).toBe(403);
    expect(faux.demandees).toEqual([]);
  });

  it("une adresse vide ou démesurée est refusée sans toucher à la base", async () => {
    expect((await demander("")).status).toBe(400);
    expect((await demander(`https://exemple.fr/${"a".repeat(3000)}`)).status).toBe(400);
  });
});

describe("un aperçu de lien autorise l'illustration qu'il a lue", () => {
  it("la chaîne complète tient : aperçu puis affichage, sans rien enregistrer en base", async () => {
    const html = `<html><head><meta property="og:image" content="${AFFICHE}"><title>Stage</title></head></html>`;
    const reponse = new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => reponse.clone()),
    );
    try {
      // Politique d'adresse relâchée : c'est prévu pour les tests (`OptionsRecuperation`).
      const apercu = await recupererApercu("https://exemple-club.fr/stage", { adresseInterdite: () => false });
      expect(apercu.image).toBe(AFFICHE);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(faux.enBase).toEqual([]); // rien n'est enregistré : c'est tout l'intérêt du registre
    expect((await demander(AFFICHE)).status).toBe(200);
  });
});

describe("un seul message pour tout échec réseau", () => {
  const CAS = [
    "Ce site est introuvable (nom de domaine inconnu).",
    "Ce site met trop de temps à répondre.",
    "Ce lien demande une connexion : son aperçu n'est pas accessible.",
    "Cette page n'existe pas (erreur 404).",
    "Ce site a répondu par une erreur (500).",
    "Ce lien ne mène pas à une image acceptée.",
  ];

  it("les cinq oracles d'autrefois rendent tous le même corps et le même statut", async () => {
    faux.enBase = [AFFICHE];
    const verdicts = new Set<string>();
    for (const message of CAS) {
      faux.echec = new ErreurApercu(message);
      const res = await demander(AFFICHE);
      verdicts.add(`${res.status} ${await res.text()}`);
    }
    expect(verdicts.size).toBe(1);
    // Et le verdict unique ne nomme ni l'hôte, ni le port, ni le code de l'autre serveur.
    const [verdict] = [...verdicts];
    expect(verdict).toBe("502 Cette image n'a pas pu être chargée.");
    for (const message of CAS) expect(verdict).not.toContain(message);
  });

  it("une panne inattendue rend le même verdict qu'un refus réseau", async () => {
    faux.enBase = [AFFICHE];
    faux.echec = new TypeError("fetch failed");
    const res = await demander(AFFICHE);
    expect(`${res.status} ${await res.text()}`).toBe("502 Cette image n'a pas pu être chargée.");
  });
});
