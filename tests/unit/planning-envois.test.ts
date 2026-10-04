import { describe, expect, it } from "vitest";
import { auRepos, fileInitiale, poser, retour, suivreServeur, type Envoi, type FileEnvoi, type Paire } from "@/components/planning/file-envoi";

/**
 * Régler une case du planning plus vite que le serveur ne répond.
 *
 * Le défaut corrigé : trois réglages dans la même case — thème, instructeur, thème à nouveau —
 * partaient en trois requêtes, chacune portant le couple complet. La deuxième, partie avec l'ancien
 * thème, était encore en chemin quand la troisième s'ajoutait derrière elle ; et la case
 * s'annonçait « enregistrée » dès la première réponse revenue. Un rechargement à ce moment-là (ou
 * une fenêtre fermée) emportait le dernier geste, qui n'était jamais parti — et la personne ne
 * l'apprenait qu'au chargement suivant.
 *
 * Ce que ces tests verrouillent : **un seul envoi en vol par case**, l'attente réduite au **dernier**
 * état voulu, et la case qui ne se dit au repos qu'une fois tout écrit.
 */

// Le niveau, le second instructeur et la description font partie de l'état envoyé ; ces tests-ci
// portent sur l'ordonnancement, ils les laissent au repos.
const p = (instructeurId: string, theme: string): Paire => ({ instructeurId, instructeurSecondId: "", theme, description: "", niveau: "INDIFFERENT" });
const cas = (instructeurId: string, theme: string): Envoi => ({ type: "case", paire: p(instructeurId, theme) });
const VIDE = p("", "");

/**
 * Déroule une suite de gestes sur une case, en laissant choisir **quand** chaque réponse revient :
 * `gestes` est lu dans l'ordre, et une réponse est traitée dès qu'un envoi est en vol et que le
 * geste courant est `"repondre"`. Rend les couples réellement partis vers le serveur, dans l'ordre.
 */
function derouler(depart: Paire, gestes: Array<Envoi | "repondre" | "echouer">): { partis: Envoi[]; file: FileEnvoi } {
  let file = fileInitiale(depart);
  const partis: Envoi[] = [];
  for (const geste of gestes) {
    if (geste === "repondre" || geste === "echouer") {
      const r = retour(file, geste === "repondre");
      file = r.file;
      if (r.partir) partis.push(r.partir);
      continue;
    }
    const r = poser(file, geste);
    file = r.file;
    if (r.partir) partis.push(r.partir);
  }
  return { partis, file };
}

describe("file d'envoi d'une case", () => {
  it("envoie tout de suite quand rien n'est en vol", () => {
    const { partis, file } = derouler(VIDE, [cas("", "Épée longue")]);
    expect(partis).toEqual([cas("", "Épée longue")]);
    expect(auRepos(file)).toBe(false);
  });

  it("n'envoie rien quand le couple est déjà celui du serveur", () => {
    // Le cas du faux enregistrement : un `onBlur` de saisie libre, ou le même thème rechoisi.
    const { partis, file } = derouler(p("u1", "Hache de pas"), [cas("u1", "Hache de pas")]);
    expect(partis).toEqual([]);
    expect(auRepos(file)).toBe(true);
  });

  it("ne garde qu'un envoi en vol : le suivant attend", () => {
    const { partis } = derouler(VIDE, [cas("", "Épée longue"), cas("u1", "Épée longue")]);
    expect(partis).toEqual([cas("", "Épée longue")]);
  });

  it("oublie le réglage intermédiaire : seul le dernier état part ensuite", () => {
    // Exactement la séquence du test e2e : thème, instructeur, thème à nouveau, puis la réponse.
    const { partis, file } = derouler(VIDE, [cas("", "Épée longue"), cas("u1", "Épée longue"), cas("u1", "Messer"), "repondre"]);
    expect(partis).toEqual([cas("", "Épée longue"), cas("u1", "Messer")]);
    // L'état intermédiaire — l'instructeur posé alors que le thème allait changer — n'est jamais
    // parti : c'est lui qui, arrivé en second, réinstallait l'ancien thème.
    expect(partis).not.toContainEqual(cas("u1", "Épée longue"));
    expect(auRepos(file)).toBe(false);
  });

  it("le dernier réglage fait foi, quel que soit le nombre de gestes empilés", () => {
    const { partis, file } = derouler(VIDE, [cas("", "Dague"), cas("u1", "Dague"), cas("u1", "Messer"), cas("u2", "Messer"), cas("u2", "Lutte"), "repondre", "repondre"]);
    expect(partis).toEqual([cas("", "Dague"), cas("u2", "Lutte")]);
    expect(file.applique).toEqual(p("u2", "Lutte"));
    expect(auRepos(file)).toBe(true);
  });

  it("abandonne une attente devenue inutile", () => {
    // On revient au réglage déjà en vol : une fois celui-ci confirmé, l'attente ne dit plus rien.
    const { partis, file } = derouler(VIDE, [cas("u1", "Messer"), cas("u1", "Dague"), cas("u1", "Messer"), "repondre"]);
    expect(partis).toEqual([cas("u1", "Messer")]);
    expect(auRepos(file)).toBe(true);
  });

  it("ne se dit au repos qu'une fois le dernier état écrit", () => {
    // C'est ce repos que la prise invisible `data-enregistrement="ok"` traduit : la case ne doit pas
    // s'annoncer enregistrée pendant qu'un réglage attend encore son tour.
    let file = fileInitiale(VIDE);
    for (const envoi of [cas("", "Épée longue"), cas("u1", "Épée longue"), cas("u1", "Messer")]) file = poser(file, envoi).file;
    expect(auRepos(file)).toBe(false);
    file = retour(file, true).file; // le premier envoi revient : le dernier état part
    expect(auRepos(file)).toBe(false);
    file = retour(file, true).file;
    expect(auRepos(file)).toBe(true);
    expect(file.applique).toEqual(p("u1", "Messer"));
  });

  it("laisse repartir le même couple après un échec", () => {
    // Coupure réseau : le serveur n'a rien reçu, `applique` ne bouge pas, la reprise doit passer.
    const { partis, file } = derouler(VIDE, [cas("u1", "Messer"), "echouer", cas("u1", "Messer")]);
    expect(partis).toEqual([cas("u1", "Messer"), cas("u1", "Messer")]);
    expect(file.applique).toEqual(VIDE);
  });

  it("envoie quand même l'état en attente après un échec", () => {
    const { partis } = derouler(VIDE, [cas("u1", "Messer"), cas("u1", "Dague"), "echouer"]);
    expect(partis).toEqual([cas("u1", "Messer"), cas("u1", "Dague")]);
  });

  it("fait passer la programmation d'un atelier par la même file", () => {
    const atelier: Envoi = { type: "atelier", atelierId: "a1" };
    const { partis, file } = derouler(VIDE, [cas("u1", "Messer"), atelier, "repondre"]);
    // L'atelier remplace le contenu de la case : il ne se coalesce pas, mais il attend son tour
    expect(partis).toEqual([cas("u1", "Messer"), atelier]);
    // Une réponse d'atelier ne dit rien du couple : `applique` reste celui du dernier `case` confirmé
    expect(file.applique).toEqual(p("u1", "Messer"));
  });

  it("suit le serveur quand le changement vient d'ailleurs", () => {
    // Le planning re-rendu apporte une valeur qu'on n'a pas envoyée : elle devient le point de comparaison,
    // et le même couple ne repart donc pas inutilement.
    const file = suivreServeur(fileInitiale(VIDE), p("u2", "Viking"));
    expect(poser(file, cas("u2", "Viking")).partir).toBeNull();
    expect(poser(file, cas("u2", "Lutte")).partir).toEqual(cas("u2", "Lutte"));
  });
});
