import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { lienPlanning, modeEditionDemande } from "@/components/planning/mode-edition";

/**
 * **Le planning s'ouvre en lecture seule, même pour l'encadrement**.
 *
 * Avant, l'encadrement tombait sur un mur de contrôles de saisie — quatre listes déroulantes et une
 * zone de texte **par partie**, sur chaque séance du trimestre — pour simplement **lire** le
 * programme. Et comme chaque réglage partait tout seul, les deux boutons demandés n'auraient rien eu
 * à faire : « Enregistrer » n'aurait rien à écrire, « Annuler » rien à défaire.
 *
 * Ce fichier garde les trois décisions qui, défaites sans y penser, ramèneraient l'écran d'avant ou
 * feraient mentir les boutons.
 */
describe("le mode modification du planning vit dans l'URL", () => {
  const FILTRES = { periode: "cmu-trim", h: "2s", quand: "a-venir", date: "2026-10-16" };

  it("entrer en modification ne fait perdre aucun filtre", () => {
    /*
     * C'est tout l'objet de cette fonction. Le planning d'un club de quatre-vingts se regarde
     * toujours filtré ; un lien qui repartirait de `/planning` ramènerait la grille entière et
     * obligerait à tout refiltrer avant de corriger la case qu'on avait sous les yeux.
     */
    const edition = lienPlanning(FILTRES, true);
    // La **paire**, pas seulement la clé : un lien qui garderait les noms des filtres en perdant
    // leurs valeurs passerait ce test tout en ramenant la grille entière.
    for (const [cle, valeur] of Object.entries(FILTRES)) expect(decodeURIComponent(edition), cle).toContain(`${cle}=${valeur}`);
    expect(edition).toContain("modifier=1");
    expect(decodeURIComponent(edition)).toContain("date=2026-10-16");
  });

  it("et en sortir ne laisse aucune trace du mode", () => {
    // « Annuler » mène ici : sans cette propriété, on resterait en modification en croyant sortir.
    const lecture = lienPlanning(FILTRES, false);
    expect(lecture).not.toContain("modifier");
    // Les mêmes filtres, dans le même ordre : deux lectures du même écran donnent la même adresse.
    expect(lecture).toBe(lienPlanning(FILTRES, false));
    expect(lienPlanning({}, false)).toBe("/planning");
  });

  it("n'ouvre la modification que sur `1`, jamais sur un à-peu-près", () => {
    expect(modeEditionDemande("1")).toBe(true);
    for (const valeur of [undefined, "", "0", "true", "oui", "1 ", "01"]) {
      expect(modeEditionDemande(valeur), JSON.stringify(valeur)).toBe(false);
    }
  });
});

describe("la grille n'ouvre ses cases qu'en mode modification", () => {
  const lire = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

  it("en lecture, la grille demande explicitement des options non modifiables", () => {
    const grille = lire("src/components/planning/GrillePlanning.tsx");
    /*
     * `optionsDepuis` ne fait traverser l'annuaire du club et la liste des ateliers vers le
     * navigateur que si quelqu'un peut s'en servir : couper `modifiable` **et** `peutProgrammer` en
     * lecture allège donc la page d'un trimestre entier, en plus de fermer la saisie.
     */
    expect(grille).toContain("enEdition ? optionsDepuis(p) : optionsDepuis({ ...p, modifiable: false, peutProgrammer: false })");
    // Le droit de remplir et le mode sont deux choses : le bouton d'entrée suit le droit.
    expect(grille).toContain("const peutModifier = p.modifiable");
    // Le bouton d'entrée vit sous le titre de la page, à la place commune à tous les onglets.
    expect(lire("src/app/(app)/planning/page.tsx")).toContain("<EntreeModification");
  });

  /**
   * **Le mode ne s'ouvre que pour qui a le droit de remplir**.
   *
   * Oui — `planning.edit` vaut `["ADMIN", "INSTRUCTEUR"]`, donc un membre n'a pas le bouton. Mais
   * `?modifier=1` est un **paramètre d'URL** : n'importe qui peut l'écrire. Sans la conjonction
   * ci-dessous, un membre voyait la barre « Appliquer les modifications » au-dessus d'un planning
   * qu'il ne peut pas régler. Rien n'était ouvert (les options ne rendent `modifiable` que d'après le
   * droit, et l'action serveur exige la permission) : c'est l'écran qui promettait un geste
   * inexistant — un bouton qui ne peut que refuser.
   *
   * Mesuré dans le navigateur, avant et après : membre sur `?modifier=1` → bouton non, barre **non**
   * (oui avant le correctif), zéro zone de saisie ; instructeur → bouton en lecture, barre et huit
   * zones de saisie en modification.
   */
  it("n'ouvre le mode qu'à qui a le droit, même sur une adresse tapée à la main", () => {
    const grille = lire("src/components/planning/GrillePlanning.tsx");
    expect(grille).toContain("const enEdition = peutModifier && modeEdition");
    // Et c'est bien cette conjonction qui commande les deux branches, pas le paramètre d'URL seul.
    expect(grille).toContain("const options = enEdition ?");
    expect(grille).toContain("{enEdition && lienLecture ? (");
  });

  it("le brouillon n'enveloppe que le mode modification", () => {
    const grille = lire("src/components/planning/GrillePlanning.tsx");
    // Hors de lui, une case sans brouillon s'enregistre toute seule : c'est ce qui laisse la fiche
    // d'une séance (`ProgrammeCases`) inchangée, où l'on ne règle qu'une séance.
    const avecBrouillon = grille.slice(grille.indexOf("<FournisseurBrouillon>"), grille.indexOf("</FournisseurBrouillon>"));
    expect(avecBrouillon).toContain("<BarreEdition");
    const programme = grille.slice(grille.indexOf("export function ProgrammeCases"));
    expect(programme).not.toContain("FournisseurBrouillon");
  });

  it("une case n'a qu'un entonnoir, et c'est lui qui bifurque vers le brouillon", () => {
    const editeur = lire("src/components/planning/CaseEditeur.tsx");
    /*
     * Un second chemin d'écriture du contenu d'une case voudrait dire une moitié de planning qui
     * continue de s'enregistrer toute seule en mode modification — donc « Annuler » qui ne défait
     * qu'une partie de ce qu'on a touché.
     */
    expect(editeur.match(/const sauver = /g) ?? []).toHaveLength(1);
    expect(editeur).toContain("brouillon.poser(partieId, v)");
    expect(editeur.match(/await enregistrerCase\(/g) ?? [], "un seul envoi unitaire").toHaveLength(1);
  });

  it("et elle dit qu'elle attend : le silence voudrait dire « appliqué »", () => {
    const editeur = lire("src/components/planning/CaseEditeur.tsx");
    expect(editeur).toContain("pas encore appliqué");
  });
});

describe("la barre d'édition ne promet que ce qu'elle tient", () => {
  const barre = fs.readFileSync(path.join(process.cwd(), "src/components/planning/BarreEdition.tsx"), "utf8");

  it("dit, en toutes lettres, ce qui part sans attendre", () => {
    /*
     * Ajouter, retirer ou déplacer une partie, et programmer un atelier, partent sans attendre :
     * une partie provisoire n'aurait pas d'identifiant à donner au rangement des rangs ni au
     * placement d'un atelier. Promettre qu'« Annuler » les défait serait la promesse à moitié tenue
     * que ce dépôt s'interdit — d'où la phrase, qui doit rester.
     */
    expect(barre).toContain("sont enregistrés tout de suite");
    expect(barre).toContain("Seules les cases");
  });

  it("ne vide le brouillon qu'après un succès, et entoure l'appel d'un `catch`", () => {
    // Un refus ne doit rien perdre : on corrige et on réessaie. Et une promesse qui rejette sans
    // réponse laisserait sinon la barre sur « Enregistrement… » avec un brouillon qu'on croit parti.
    const envoi = barre.slice(barre.indexOf("const enregistrer"), barre.indexOf("return ("));
    expect(envoi).toContain("catch");
    expect(envoi.indexOf("brouillon.vider()")).toBeGreaterThan(envoi.indexOf("if (res.erreur)"));
  });

  it("porte les trois libellés demandés : entrer, sortir, et jeter", () => {
    /*
     * Delta, : « au lieu de faire enregistrer annuler, fais plutôt deux boutons, modifier le
     * planning et appliquer les modifications », puis « pour rentrer et sortir du mode
     * modification » ; **et** : « ajoute dans le mode modification de planning un bouton annuler a
     * coté de appliquer les modifications ».
     *
     * Le libellé d'application ne compte pas les cases (un bouton dont le texte change de longueur à
     * chaque réglage se déplace sous le doigt) ; le chiffre vit dans la phrase à gauche.
     */
    expect(fs.readFileSync(path.join(process.cwd(), "src/app/(app)/planning/page.tsx"), "utf8")).toContain("Modifier le planning");
    expect(barre).toContain("Appliquer les modifications");
    expect(barre).toContain(">\n            Annuler\n          <");
  });

  /**
   * **« Annuler » est un bouton, toujours montré, et il n'écrit pas**.
   *
   * C'était un lien, et il n'apparaissait **que** sur un brouillon non vide : entré par erreur dans le
   * mode, on avait sous les yeux un seul geste, et il s'appelait « Appliquer ». Les trois assertions
   * ci-dessous gardent les trois moitiés de la demande — la forme (un bouton), la présence (toujours),
   * et la nature (secondaire : le geste qui écrit reste le seul bouton plein de la barre).
   */
  it("et « Annuler » ne dépend pas du brouillon pour s'afficher", () => {
    // La zone des deux boutons : entre la phrase qui compte les cases et le message d'erreur.
    const gestes = barre.slice(barre.indexOf("</p>"), barre.indexOf("{erreur &&"));
    expect(gestes).toContain("onClick={annuler}");
    expect(gestes).toContain('variante="secondaire"');
    // Aucune condition sur le nombre de cases dans la zone des deux boutons : c'est tout l'objet du
    // revirement. Un `{nb > 0 && (` ici ramènerait le lien d'hier sous forme de bouton.
    expect(gestes).not.toContain("nb > 0");
    // Et il est **avant** « Appliquer » : on ne met pas ce qui jette sous le pouce qui valide.
    expect(gestes.indexOf("onClick={annuler}")).toBeLessThan(gestes.indexOf("onClick={enregistrer}"));
  });

  /**
   * **Annuler désarme la garde de fermeture.** Le registre de `garde-fermeture.ts` porte une clé par
   * case réglée, et seul `vider()` les retire. Sans lui, on quitterait le mode en laissant la garde
   * armée : le navigateur poserait sa question sur un planning en lecture seule, où il n'y a plus rien
   * à perdre — et un avertissement qu'on apprend à fermer sans lire ne vaut plus rien le jour où il
   * compte. C'est la raison pour laquelle ce geste ne peut pas être un simple `<Link>`.
   */
  it("jette le brouillon avant de quitter l'adresse, et pas seulement l'adresse", () => {
    const geste = barre.slice(barre.indexOf("const annuler"), barre.indexOf("return ("));
    expect(geste).toContain("brouillon?.vider()");
    expect(geste.indexOf("brouillon?.vider()")).toBeLessThan(geste.indexOf("router.push"));
  });

  /**
   * **La barre ne vole pas un tiers du téléphone**.
   *
   * Ajouter « Annuler » avait fait **passer les deux boutons à la ligne** : mesurée à 390 × 844, la
   * barre montait à **258 px, soit 31 % de l'écran**, et recouvrait le champ qu'on était en train de
   * régler. Deux corrections, mesurées après : rangée **sans `flex-wrap`** (les deux boutons tiennent
   * sur une ligne, « Annuler » en taille réduite) et phrase ramenée de quatre lignes à trois —
   * **189 px, 22 %**.
   *
   * Un test unitaire ne mesure pas un navigateur ; il garde la **cause**. `flex-wrap` sur cette
   * rangée est exactement ce qui a produit le défaut, et c'est ce qui le reproduirait.
   */
  it("garde ses deux boutons sur une seule rangée", () => {
    const gestes = barre.slice(barre.indexOf("</p>"), barre.indexOf("{erreur &&"));
    expect(gestes).not.toContain("flex-wrap");
    expect(gestes).toContain('taille="petite"');
  });

  it("compte les cases en attente plutôt que de dire « des modifications »", () => {
    // Le chiffre est ce qui fait hésiter avant d'annuler : « 7 cases modifiées » se vérifie, « des
    // modifications » ne se vérifie pas. Et la confirmation ne se pose **que** s'il y a de quoi
    // perdre : sinon elle n'ajoute qu'un clic à une sortie qui ne coûte rien.
    expect(barre).toContain("modifiees.size");
    expect(barre).toContain("if (nb > 0 && !window.confirm(");
  });
});
