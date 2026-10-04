import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { derniereVersionPubliee, etatMiseAJour, oublierCacheMiseAJour, plusHauteVersion } from "@/lib/mise-a-jour";

describe("comparer la version qui tourne à la dernière publiée", () => {
  it("prend la plus haute version, pas la plus récente ni l'ordre alphabétique", () => {
    expect(plusHauteVersion(["latest", "0.9.0", "0.64.0", "0.10.2", "v0.63.1"])).toBe("0.64.0");
    expect(plusHauteVersion(["latest", "main", "0.64"])).toBeNull();
  });

  it("n'annonce une mise à jour que si la publiée est strictement plus haute", () => {
    expect(etatMiseAJour("0.64.0", "0.65.0")).toEqual({ courante: "0.64.0", derniere: "0.65.0" });
    expect(etatMiseAJour("0.64.0", "0.64.0")).toBeNull();
    // Un serveur de développement en avance sur la dernière publiée n'a rien à mettre à jour
    expect(etatMiseAJour("0.66.0", "0.65.0")).toBeNull();
  });

  it("se tait quand l'une des deux versions est inconnue", () => {
    expect(etatMiseAJour(null, "0.65.0")).toBeNull();
    expect(etatMiseAJour("0.64.0", null)).toBeNull();
    expect(etatMiseAJour("dev", "0.65.0")).toBeNull();
  });
});

describe("la lecture chez Docker Hub", () => {
  const avant = process.env.MISE_A_JOUR_DEPOT;
  beforeEach(() => oublierCacheMiseAJour());
  afterEach(() => {
    vi.unstubAllGlobals();
    if (avant === undefined) delete process.env.MISE_A_JOUR_DEPOT;
    else process.env.MISE_A_JOUR_DEPOT = avant;
  });

  it("lit les tags de l'image publique et garde la réponse en cache", async () => {
    delete process.env.MISE_A_JOUR_DEPOT;
    const appel = vi.fn(async () => new Response(JSON.stringify({ results: [{ name: "latest" }, { name: "0.65.0" }, { name: "0.64.0" }] })));
    vi.stubGlobal("fetch", appel);
    expect(await derniereVersionPubliee()).toBe("0.65.0");
    expect(await derniereVersionPubliee()).toBe("0.65.0");
    expect(appel).toHaveBeenCalledTimes(1);
    expect(String((appel.mock.calls[0] as unknown[])[0])).toContain("hub.docker.com/v2/repositories/hematools/hema-organizer/tags");
  });

  it("vaut « on ne sait pas » quand Docker Hub ne répond pas, sans lever", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    expect(await derniereVersionPubliee()).toBeNull();
  });

  it("ne sort pas du tout quand la vérification est coupée (variable vide)", async () => {
    process.env.MISE_A_JOUR_DEPOT = "";
    const appel = vi.fn();
    vi.stubGlobal("fetch", appel);
    expect(await derniereVersionPubliee()).toBeNull();
    expect(appel).not.toHaveBeenCalled();
  });

  it("refuse un nom de dépôt qui sortirait de l'URL prévue", async () => {
    process.env.MISE_A_JOUR_DEPOT = "../../evil?x=";
    const appel = vi.fn();
    vi.stubGlobal("fetch", appel);
    expect(await derniereVersionPubliee()).toBeNull();
    expect(appel).not.toHaveBeenCalled();
  });
});

describe("le lien vers les notes de version", () => {
  const avant = process.env.MISE_A_JOUR_NOTES;
  afterEach(() => {
    if (avant === undefined) delete process.env.MISE_A_JOUR_NOTES;
    else process.env.MISE_A_JOUR_NOTES = avant;
  });

  it("pointe vers la release du tag, dans le dépôt public par défaut", async () => {
    delete process.env.MISE_A_JOUR_NOTES;
    const { notesDeVersionUrl } = await import("@/lib/mise-a-jour");
    expect(notesDeVersionUrl("0.65.0")).toBe("https://github.com/binarylefmart/hema-organizer/releases/tag/v0.65.0");
  });

  it("refuse un modèle qui n'est pas en https, et une version mal formée", async () => {
    const { notesDeVersionUrl } = await import("@/lib/mise-a-jour");
    process.env.MISE_A_JOUR_NOTES = "javascript:alert({version})";
    expect(notesDeVersionUrl("0.65.0")).toBeNull();
    process.env.MISE_A_JOUR_NOTES = "https://exemple.fr/notes/{version}";
    expect(notesDeVersionUrl("0.65.0")).toBe("https://exemple.fr/notes/0.65.0");
    expect(notesDeVersionUrl("latest")).toBeNull();
  });
});

describe("les notes de version rédigées depuis l'historique", () => {
  it("range les commits en nouveautés, corrections et autres, sans les montées de version", async () => {
    const { sectionDeVersion } = await import("../../scripts/notes-de-version");
    const s = sectionDeVersion("0.65.0", ["feat(themes): neuf thèmes", "fix(mobile): bas de page", "chore(version): 0.64.0", "docs: guide", ""]);
    expect(s).toBe("## 0.65.0\n\n### Nouveautés\n\n- **themes** : neuf thèmes\n\n### Corrections\n\n- **mobile** : bas de page\n\n### Autres changements\n\n- guide\n");
  });

  it("insère la section en tête, et la remplace si la version y est déjà", async () => {
    const { insererSection } = await import("../../scripts/notes-de-version");
    let c = insererSection("", "0.1.0", "## 0.1.0\n\nA\n");
    c = insererSection(c, "0.2.0", "## 0.2.0\n\nB\n");
    expect(c.indexOf("## 0.2.0")).toBeLessThan(c.indexOf("## 0.1.0"));
    c = insererSection(c, "0.2.0", "## 0.2.0\n\nB bis\n");
    expect(c.match(/## 0\.2\.0/g)).toHaveLength(1);
    expect(c).toContain("B bis");
    expect(c).toContain("## 0.1.0\n\nA");
  });
});
