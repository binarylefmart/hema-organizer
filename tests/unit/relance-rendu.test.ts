import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DELAI_SANS_REPONSE_MS,
  planifier,
  RELANCES_APRES_REPONSE_MS,
  RELANCES_PENDANT_ATTENTE_MS,
  reponseQuiPorteUnRendu,
} from "@/lib/relance-rendu";

/**
 * **Un bouton figé sur « Ajout… » alors que le serveur a répondu.**
 *
 * Reproduit à coup sûr en build de production sur « Ajouter le membre » : réponse 200 complète en
 * 200 ms, membre créé, et l'écran ne bouge plus. Livrée d'un bloc, la même réponse passe. La cause
 * est une course dans le React que Next 15.5 embarque ; le remède, une mise à jour d'état qui force
 * React à retenter la transition. Ces tests gardent les deux faits sur lesquels le remède repose
 * (lus dans le code embarqué, pas supposés) et la logique pure des relances.
 */
const lire = (relatif: string) => fs.readFileSync(path.join(process.cwd(), relatif), "utf8");

describe("ce que fait le React embarqué par Next (preuves lues dans node_modules)", () => {
  const reactDom = lire("node_modules/next/dist/compiled/react-dom/cjs/react-dom-client.production.js");

  it("toute mise à jour d'état efface les voies suspendues de la racine (ce sur quoi la relance compte)", () => {
    expect(reactDom).toMatch(/function markRootUpdated\$1\(root, updateLane\) \{[\s\S]{0,120}root\.suspendedLanes = 0/);
  });

  it("une action serveur part sans délai de garde : une requête pendante bloque pour de bon", () => {
    const reducteur = lire("node_modules/next/dist/client/components/router-reducer/reducers/server-action-reducer.js");
    const appel = reducteur.slice(reducteur.indexOf("const res = await fetch(state.canonicalUrl"));
    expect(appel.slice(0, appel.indexOf("});"))).not.toContain("signal");
  });

  it("le routeur fait passer les actions une par une : la suivante attend la précédente", () => {
    const file = lire("node_modules/next/dist/client/components/app-router-instance.js");
    expect(file).toContain("// The queue is not empty, so add the action to the end of the queue");
  });
});

describe("planifier", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("appelle à chaque délai, puis plus rien", () => {
    const fn = vi.fn();
    planifier([0, 100, 500], fn);
    vi.advanceTimersByTime(0);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(10_000);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("s'annule entièrement", () => {
    const fn = vi.fn();
    const annuler = planifier(RELANCES_PENDANT_ATTENTE_MS, fn);
    vi.advanceTimersByTime(RELANCES_PENDANT_ATTENTE_MS[0]);
    annuler();
    vi.advanceTimersByTime(60_000);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("les délais", () => {
  it("relancent vite après une réponse, le temps que le flux soit lu", () => {
    expect(RELANCES_APRES_REPONSE_MS[0]).toBe(0);
    expect(Math.max(...RELANCES_APRES_REPONSE_MS)).toBeLessThanOrEqual(2000);
  });

  it("relancent pendant toute l'attente, et l'alerte vient après la dernière relance", () => {
    const tries = [...RELANCES_PENDANT_ATTENTE_MS].sort((a, b) => a - b);
    expect(tries).toEqual([...RELANCES_PENDANT_ATTENTE_MS]);
    expect(Math.max(...RELANCES_PENDANT_ATTENTE_MS)).toBeLessThan(DELAI_SANS_REPONSE_MS);
    // Assez long pour un envoi d'emails en masse, assez court pour ne pas laisser quelqu'un figé.
    expect(DELAI_SANS_REPONSE_MS).toBeGreaterThanOrEqual(15_000);
    expect(DELAI_SANS_REPONSE_MS).toBeLessThanOrEqual(30_000);
  });
});

describe("reponseQuiPorteUnRendu", () => {
  const origine = "https://club.example";
  it("retient les requêtes de l'application (action, rafraîchissement, navigation)", () => {
    expect(reponseQuiPorteUnRendu({ name: "https://club.example/admin/membres", initiatorType: "fetch" }, origine)).toBe(true);
    expect(reponseQuiPorteUnRendu({ name: "https://club.example/seances?_rsc=1abc", initiatorType: "fetch" }, origine)).toBe(true);
  });
  it("écarte les fichiers statiques, les images, les autres origines et ce qui n'est pas un fetch", () => {
    expect(reponseQuiPorteUnRendu({ name: "https://club.example/_next/static/chunks/a.js", initiatorType: "fetch" }, origine)).toBe(false);
    expect(reponseQuiPorteUnRendu({ name: "https://club.example/_next/image?url=x", initiatorType: "fetch" }, origine)).toBe(false);
    expect(reponseQuiPorteUnRendu({ name: "https://ailleurs.example/x", initiatorType: "fetch" }, origine)).toBe(false);
    expect(reponseQuiPorteUnRendu({ name: "https://club.example/logo.png", initiatorType: "img" }, origine)).toBe(false);
  });
});

describe("le branchement", () => {
  it("la relance après réponse est montée à la racine, donc sur tous les écrans", () => {
    expect(lire("src/app/layout.tsx")).toContain("<RelanceRendu />");
    const composant = lire("src/components/layout/RelanceRendu.tsx");
    expect(composant).toContain('observe({ type: "resource"');
    expect(composant).toContain("useReducer((n: number) => n + 1, 0)");
  });

  it("le bouton de tout formulaire surveille son attente", () => {
    const source = lire("src/components/ui/BoutonEnvoi.tsx");
    expect(source).toContain("useAttenteSurveillee(pending)");
    expect(source).toContain("{silence && <SansReponse />}");
  });

  it("le bouton d'action surveille la promesse ET la transition qui suit", () => {
    const source = lire("src/components/ui/BoutonAction.tsx");
    expect(source).toContain("useAttenteSurveillee(enVol || transition)");
    expect(source).toContain("{silence && <SansReponse />}");
  });

  it("la relance est une vraie mise à jour (un compteur), pas une valeur identique que React ignorerait", () => {
    const source = lire("src/components/ui/attente-surveillee.tsx");
    expect(source).toContain("useReducer((n: number) => n + 1, 0)");
    expect(source).toContain("window.location.reload()");
  });
});
