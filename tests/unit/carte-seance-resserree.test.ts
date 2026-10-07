import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * **La carte d'une séance, resserrée sur téléphone seulement.**
 *
 * Sous le palier `md` (768 px de fenêtre), la carte perd le grand chiffre, la pastille, la jauge
 * épaisse et les trois tuiles au profit d'une ligne de chiffres, et « Qui vient ? » / « Programme »
 * deviennent deux liens courts. Au-dessus, rien ne change. Tout se joue en CSS, pour un rendu serveur
 * sans clignotement : ces tests relisent la source, comme le reste du dépôt pour ce genre de règle.
 */

const RACINE = process.cwd();
const lire = (relatif: string) => readFileSync(path.join(RACINE, relatif), "utf8");
/** Le code seul : un commentaire a le droit de citer ce que le code n'a pas le droit d'employer. */
const sansCommentaires = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const CARTE = sansCommentaires(lire("src/components/seances/CarteSeance.tsx"));
const BARRE = sansCommentaires(lire("src/components/seances/BarreTaux.tsx"));
const LISTE = sansCommentaires(lire("src/components/seances/ListeParticipants.tsx"));

describe("la carte resserrée ne vaut que sur téléphone", () => {
  it("les chiffres de l'ordinateur se masquent sous md, la ligne resserrée au-dessus", () => {
    expect(CARTE).toMatch(/className="[^"]*tel:hidden"[^]{0,40}<BarreTaux /);
    expect(CARTE).toMatch(/className="[^"]*ordi:hidden"[^]{0,40}<LigneTaux /);
    // Les trois tuiles partent avec le grand chiffre, dans le même bloc masqué.
    expect(CARTE).toMatch(/tel:hidden">\s*<BarreTaux[^>]*\/>\s*<RepartitionPresences/);
  });

  it("le palier est celui de la fenêtre (md), jamais lg — la règle du dépôt sur les cartes", () => {
    expect(CARTE).not.toMatch(/\blg:hidden\b|\bmax-lg:/);
  });

  it("les boutons de réponse et la liste nominative ne sont rendus qu'une fois", () => {
    expect(CARTE.match(/<BoutonsPresence/g) ?? []).toHaveLength(1);
    expect(CARTE.match(/<ListeParticipants/g) ?? []).toHaveLength(1);
    // La liste de la carte, seule, prend la forme du lien court.
    expect(CARTE).toMatch(/<ListeParticipants[^>]*resserre/);
  });

  it("le lien court du programme mène au même endroit que le bouton, et fait 48 px", () => {
    const cibles = CARTE.match(/\/planning\?periode=\$\{s\.periodId\}\$\{s\.commencee \? "&quand=passe" : ""\}#seance-\$\{s\.id\}/g) ?? [];
    expect(cibles).toHaveLength(2);
    expect(CARTE).toMatch(/className="absolute right-0 top-0 inline-flex min-h-12[^"]*ordi:hidden"/);
  });

  it("rien de ce qui est rendu en double ne porte d'id ni de région vivante", () => {
    const ligne = BARRE.slice(BARRE.indexOf("export function LigneTaux"));
    expect(ligne).not.toMatch(/\bid=|aria-live|<button|onClick/);
    expect(CARTE).not.toMatch(/\bid=|aria-live/);
  });

  it("la ligne resserrée garde les règles de couleur de la grande barre", () => {
    const ligne = BARRE.slice(BARRE.indexOf("export function LigneTaux"));
    // Le nombre de présents reste vert ; la couleur du palier se pose sur son mot.
    expect(ligne).toMatch(/text-vert">\{c\.presents\}/);
    expect(ligne).toContain("TEXTE_PALIER[palier]");
    expect(ligne).toContain('palier !== "indetermine"');
  });

  it("le repli resserré n'existe que sous md : au-dessus, la liste garde son cadre et son compte", () => {
    // Toutes les retouches de `resserre` sont préfixées `tel:` — aucune ne touche l'ordinateur.
    const classesResserre = [...LISTE.matchAll(/resserre \? "([^"]*)"/g)].map((m) => m[1]);
    expect(classesResserre.length).toBeGreaterThan(0);
    for (const classes of classesResserre) for (const c of classes.split(/\s+/)) expect(c, c).toMatch(/^tel:/);
    expect(LISTE).toContain("({total} invités)");
  });
});
