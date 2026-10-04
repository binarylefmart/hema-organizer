#!/usr/bin/env node
/**
 * **Le React embarqué par Next 15.5 perd un « ping » : on le corrige à l'installation.**
 *
 * Next ne se sert pas du `react-dom` de `package.json` pour l'App Router : il embarque sa propre
 * copie (`node_modules/next/dist/compiled/react-dom*`), une canary 19.2 identique dans toutes les
 * 15.5.x, 15.5.27 comprise. Cette copie a un défaut dans `pingSuspendedRoot`, corrigé en amont
 * (React 19.3) :
 *
 * ```js
 * // embarqué (défaut)                              // React 19.3 (corrigé)
 * ? (contexte de rendu ?) && prepareFreshStack()    ? (contexte de rendu ?) ? prepareFreshStack()
 * : (workInProgressRootPingedLanes |= lanes)                                 : (workInProgressRootPingedLanes |= lanes)
 *                                                   : (workInProgressRootPingedLanes |= lanes)
 * ```
 *
 * **Ce que ça produisait chez nous, mesuré dans l'image de production** (Playwright, Pixel 7) : une
 * action qui invalide sa page renvoie l'arbre de la page **en flux**. La transition du routeur se
 * suspend sur un morceau pas encore arrivé ; le morceau arrive et « pingue » React **pendant** le
 * rendu, alors que celui-ci est déjà marqué « suspendu avec délai ». Le code embarqué ne relance pas
 * (on est en plein rendu) **et ne note pas non plus le ping** ; à la fin du rendu, la racine est
 * marquée suspendue, ce qui efface le ping. Plus rien ne la réveille : `pendingLanes =
 * suspendedLanes`, `pingedLanes = 0`, aucun rendu prévu, alors que toutes les données sont là. Le
 * bouton reste sur « Ajout… », la liste ne bouge plus, il faut recharger la page. Au hasard, parce
 * que tout dépend du découpage du flux sur le réseau : 24 « Ajouter le membre » sur 40 à travers le
 * proxy, et aucun quand la même réponse arrive d'un bloc.
 *
 * La correction est **celle d'amont, à la lettre** : pendant le rendu, le ping est noté dans
 * `workInProgressRootPingedLanes`, que `markRootSuspended` retire des voies suspendues — la racine
 * repart d'elle-même.
 *
 * **Le script refuse de se taire.** Une forme connue est corrigée, une forme déjà corrigée est
 * laissée ; mais si un des fichiers attendus ne porte ni l'une ni l'autre (Next mis à jour, React
 * réécrit), l'installation **échoue** en disant quoi vérifier, au lieu de livrer une image où le
 * défaut serait revenu sans bruit. Après une montée de Next qui embarque React 19.3 ou plus, ce
 * script ne trouve plus rien à corriger : il le dit, et il peut alors partir.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** La forme fautive : production (`0 === (executionContext & 2)`) et développement (`RenderContext`). */
const FAUTIVE =
  /\?\s*(0 === \(executionContext & 2\)|\(executionContext & RenderContext\) === NoContext)\s*&&\s*prepareFreshStack\(root, 0\)\s*:\s*\(workInProgressRootPingedLanes \|= pingedLanes\)/g;

/** La forme corrigée, telle que ce script l'écrit (et telle qu'amont l'écrit, aux espaces près). */
const CORRIGEE =
  /\?\s*(0 === \(executionContext & 2\)|\(executionContext & RenderContext\) === NoContext)\s*\?\s*prepareFreshStack\(root, 0\)\s*:\s*\(workInProgressRootPingedLanes \|= pingedLanes\)\s*:\s*\(workInProgressRootPingedLanes \|= pingedLanes\)/;

/**
 * Corrige un fichier source de react-dom.
 * @param {string} source
 * @returns {{ source: string, corrections: number, dejaCorrige: boolean }}
 */
export function corrigerPingPerdu(source) {
  let corrections = 0;
  const corrige = source.replace(FAUTIVE, (_tout, contexte) => {
    corrections++;
    return `? ${contexte} ? prepareFreshStack(root, 0) : (workInProgressRootPingedLanes |= pingedLanes) : (workInProgressRootPingedLanes |= pingedLanes)`;
  });
  return { source: corrige, corrections, dejaCorrige: corrections === 0 && CORRIGEE.test(source) };
}

/**
 * Les fichiers du client React que Next charge dans le navigateur (canal stable et expérimental,
 * production, développement et profilage). Chacun DOIT être trouvé et finir corrigé.
 */
export const FICHIERS_REACT_EMBARQUE = ["react-dom", "react-dom-experimental"].flatMap((canal) =>
  ["react-dom-client.production.js", "react-dom-client.development.js", "react-dom-profiling.profiling.js", "react-dom-profiling.development.js"].map(
    (f) => `node_modules/next/dist/compiled/${canal}/cjs/${f}`,
  ),
);

function principal() {
  const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const problemes = [];
  let corriges = 0;
  for (const relatif of FICHIERS_REACT_EMBARQUE) {
    const fichier = path.join(racine, relatif);
    if (!existsSync(fichier)) {
      problemes.push(`${relatif} : introuvable`);
      continue;
    }
    const { source, corrections, dejaCorrige } = corrigerPingPerdu(readFileSync(fichier, "utf8"));
    if (corrections > 0) {
      writeFileSync(fichier, source);
      corriges++;
      console.info(`[react-embarque] ${relatif} : ping perdu corrigé (${corrections}).`);
    } else if (!dejaCorrige) {
      problemes.push(`${relatif} : ni la forme fautive ni la forme corrigée de pingSuspendedRoot`);
    }
  }
  if (problemes.length > 0) {
    console.error(
      "[react-embarque] ERREUR : la correction du ping perdu (pingSuspendedRoot) n'a pas pu être vérifiée.\n  " +
        problemes.join("\n  ") +
        "\n  Next a sans doute changé de version de React. Si celle qu'il embarque est 19.3 ou plus, le défaut est corrigé" +
        " en amont : retirer ce script et sa ligne « postinstall ». Sinon, adapter les motifs de scripts/corriger-react-embarque.mjs.",
    );
    process.exit(1);
  }
  if (corriges === 0) console.info("[react-embarque] déjà corrigé, rien à faire.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) principal();
