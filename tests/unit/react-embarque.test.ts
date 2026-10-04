import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { corrigerPingPerdu, FICHIERS_REACT_EMBARQUE } from "../../scripts/corriger-react-embarque.mjs";

/**
 * **Le ping perdu du React embarqué par Next 15.5 reste corrigé.**
 *
 * Voir `scripts/corriger-react-embarque.mjs` pour le défaut et sa mesure : un bouton resté sur «
 * Ajout… » et une liste figée, au hasard, en production seulement. La correction est une ligne de
 * `pingSuspendedRoot`, réécrite au `postinstall` dans la copie de React que Next charge dans le
 * navigateur. Trois choses doivent rester vraies, et rien d'autre ne les relie :
 * - la réécriture produit bien la forme d'amont (React 19.3), et une seule fois ;
 * - les fichiers installés portent l'une ou l'autre forme — sinon Next a changé de React et le
 *   script ferait échouer l'installation (c'est voulu, mais autant le savoir ici) ;
 * - l'image Docker exécute le script **avant** de bâtir : `npm ci` doit le trouver.
 */
const RACINE = process.cwd();
const lire = (p: string) => fs.readFileSync(path.join(RACINE, p), "utf8");

/** Les deux formes du défaut, telles que les fichiers de Next 15.5 les portent. */
const PRODUCTION = `
    workInProgressRoot === root &&
      (workInProgressRootRenderLanes & pingedLanes) === pingedLanes &&
      (4 === workInProgressRootExitStatus ||
      (3 === workInProgressRootExitStatus &&
        (workInProgressRootRenderLanes & 62914560) ===
          workInProgressRootRenderLanes &&
        300 > now() - globalMostRecentFallbackTime)
        ? 0 === (executionContext & 2) && prepareFreshStack(root, 0)
        : (workInProgressRootPingedLanes |= pingedLanes),
      workInProgressSuspendedRetryLanes === workInProgressRootRenderLanes &&
        (workInProgressSuspendedRetryLanes = 0));`;
const DEVELOPPEMENT = `
          now$1() - globalMostRecentFallbackTime < FALLBACK_THROTTLE_MS)
          ? (executionContext & RenderContext) === NoContext &&
            prepareFreshStack(root, 0)
          : (workInProgressRootPingedLanes |= pingedLanes),`;

describe("le ping perdu de pingSuspendedRoot", () => {
  it("pendant le rendu, le ping est noté au lieu d'être jeté (forme de production)", () => {
    const { source, corrections } = corrigerPingPerdu(PRODUCTION);
    expect(corrections).toBe(1);
    expect(source).toContain(
      "? 0 === (executionContext & 2) ? prepareFreshStack(root, 0) : (workInProgressRootPingedLanes |= pingedLanes) : (workInProgressRootPingedLanes |= pingedLanes)",
    );
    expect(source).not.toMatch(/&&\s*prepareFreshStack\(root, 0\)/);
  });

  it("même correction sur la forme de développement", () => {
    const { source, corrections } = corrigerPingPerdu(DEVELOPPEMENT);
    expect(corrections).toBe(1);
    expect(source).toContain("? (executionContext & RenderContext) === NoContext ? prepareFreshStack(root, 0) : (workInProgressRootPingedLanes |= pingedLanes)");
  });

  it("une seconde passe ne touche plus rien, et reconnaît la forme corrigée", () => {
    const premiere = corrigerPingPerdu(PRODUCTION).source;
    const seconde = corrigerPingPerdu(premiere);
    expect(seconde.corrections).toBe(0);
    expect(seconde.dejaCorrige).toBe(true);
    expect(seconde.source).toBe(premiere);
  });

  it("un fichier qui ne porte aucune des deux formes n'est pas déclaré corrigé", () => {
    const r = corrigerPingPerdu("function pingSuspendedRoot(root) { ensureRootIsScheduled(root); }");
    expect(r.corrections).toBe(0);
    expect(r.dejaCorrige).toBe(false);
  });

  it("chaque fichier du React installé par Next porte la forme fautive ou la forme corrigée", () => {
    for (const fichier of FICHIERS_REACT_EMBARQUE) {
      const r = corrigerPingPerdu(lire(fichier));
      expect(r.corrections + (r.dejaCorrige ? 1 : 0), `${fichier} : forme inconnue — Next a changé de React ?`).toBeGreaterThan(0);
    }
  });
});

describe("la correction s'applique à chaque installation", () => {
  it("package.json lance le script au postinstall", () => {
    const paquet = JSON.parse(lire("package.json")) as { scripts: Record<string, string> };
    expect(paquet.scripts.postinstall).toBe("node scripts/corriger-react-embarque.mjs");
  });

  it("le Dockerfile copie le script avant `npm ci`", () => {
    const dockerfile = lire("Dockerfile");
    const copie = dockerfile.indexOf("COPY scripts/corriger-react-embarque.mjs scripts/");
    const installation = dockerfile.indexOf("RUN npm ci");
    expect(copie, "le script n'est pas copié dans l'étape des dépendances").toBeGreaterThan(-1);
    expect(copie, "le script est copié après `npm ci` : le postinstall échouerait").toBeLessThan(installation);
  });
});
