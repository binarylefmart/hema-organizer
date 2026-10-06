import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { cleValeurServeur } from "@/components/ui/valeur-serveur";

/**
 * **« Après Enregistrer, l'écran réaffiche l'ancienne valeur. »**
 *
 * React n'applique `defaultValue` (et `defaultChecked`) qu'au **montage**, et React 19 réinitialise
 * un formulaire dès que son action a rendu la main : le champ retombe alors sur la valeur qu'il
 * avait au chargement de la page. Le pire n'est pas l'affichage — c'est le **second clic sur
 * « Enregistrer »**, qui renvoie cette ancienne valeur au serveur et l'écrit par-dessus la bonne
 * (vu en production sur les thèmes du planning et sur les dates d'une période).
 *
 * Ce fichier tient les trois pièces du correctif :
 *  1. `cleValeurServeur` — la clé de remontage, et ce qu'elle refuse de faire sur un champ piloté ;
 *  2. les briques de saisie, qui la portent toutes, donc tous les écrans d'un coup ;
 *  3. `FormulaireAction`, qui redemande la page au serveur après un succès — sans quoi la valeur
 *     fraîche n'arriverait jamais jusqu'au champ.
 *
 * On analyse la source (compilateur TypeScript) plutôt que le rendu : la configuration du dépôt
 * garde `jsx: "preserve"`, donc les tests unitaires ne transforment pas le JSX.
 */

const lire = (relatif: string) => fs.readFileSync(path.join(process.cwd(), relatif), "utf8");

/**
 * Simulacre d'un champ **non contrôlé** de React, réduit aux deux règles qui ont causé le bug :
 * la valeur affichée est prise à `defaultValue` **au montage seulement**, et la réinitialisation
 * qui suit une action y ramène le champ.
 */
class ChampNonControle {
  private valeurAuMontage: string;
  valeur: string;
  private cle: string | undefined;
  constructor(valeurDuServeur: string, aveCle: boolean) {
    this.valeurAuMontage = valeurDuServeur;
    this.valeur = valeurDuServeur;
    this.cle = aveCle ? cleValeurServeur({ defaultValue: valeurDuServeur }) : undefined;
  }
  /** Ce que le serveur renvoie au re-rendu : seul un changement de clé remonte le champ. */
  rendre(valeurDuServeur: string, avecCle: boolean) {
    const nouvelle = avecCle ? cleValeurServeur({ defaultValue: valeurDuServeur }) : undefined;
    if (avecCle && nouvelle !== this.cle) {
      this.cle = nouvelle;
      this.valeurAuMontage = valeurDuServeur;
      this.valeur = valeurDuServeur;
    }
  }
  taper(texte: string) {
    this.valeur = texte;
  }
  /** La remise à zéro de React 19, dès que l'action a rendu la main. */
  reinitialiser() {
    this.valeur = this.valeurAuMontage;
  }
}

/** Un aller-retour complet : on tape, on enregistre, le serveur renvoie ce qu'il a retenu. */
function enregistrer(champ: ChampNonControle, saisie: string, avecCle: boolean, serveur: { valeur: string }) {
  champ.taper(saisie);
  serveur.valeur = saisie; // le serveur, lui, enregistre bien
  champ.reinitialiser(); // React 19 remet le formulaire à zéro…
  champ.rendre(serveur.valeur, avecCle); // … puis la page fraîche arrive
}

describe("le défaut : un second « Enregistrer » réécrit l'ancienne valeur", () => {
  it("sans clé de remontage, le champ ment et renvoie l'ancienne valeur au serveur", () => {
    const serveur = { valeur: "Épée longue" };
    const champ = new ChampNonControle(serveur.valeur, false);

    enregistrer(champ, "Messer", false, serveur);
    expect(serveur.valeur).toBe("Messer"); // le serveur a bien enregistré…
    expect(champ.valeur).toBe("Épée longue"); // … mais l'écran affiche l'ancienne valeur

    // Second clic sur « Enregistrer », sans rien toucher : c'est l'ancienne valeur qui repart.
    enregistrer(champ, champ.valeur, false, serveur);
    expect(serveur.valeur).toBe("Épée longue"); // perte de donnée
  });

  it("avec la clé de remontage, le champ repart de la valeur du serveur", () => {
    const serveur = { valeur: "Épée longue" };
    const champ = new ChampNonControle(serveur.valeur, true);

    enregistrer(champ, "Messer", true, serveur);
    expect(champ.valeur).toBe("Messer");

    enregistrer(champ, champ.valeur, true, serveur);
    expect(serveur.valeur).toBe("Messer");
  });
});

describe("cleValeurServeur", () => {
  it("change avec la valeur du serveur, et seulement avec elle", () => {
    expect(cleValeurServeur({ defaultValue: "a" })).not.toBe(cleValeurServeur({ defaultValue: "b" }));
    expect(cleValeurServeur({ defaultValue: "a" })).toBe(cleValeurServeur({ defaultValue: "a" }));
    expect(cleValeurServeur({ defaultValue: 4 })).toBe(cleValeurServeur({ defaultValue: 4 }));
  });

  it("distingue une case cochée d'une case décochée", () => {
    expect(cleValeurServeur({ defaultChecked: true })).not.toBe(cleValeurServeur({ defaultChecked: false }));
  });

  it("laisse tranquille un champ piloté par React", () => {
    // `value=` / `checked=` : la valeur vient de l'état du composant, un remontage la lui arracherait.
    expect(cleValeurServeur({ value: "saisie en cours" })).toBeUndefined();
    expect(cleValeurServeur({ checked: true })).toBeUndefined();
    expect(cleValeurServeur({})).toBeUndefined();
  });
});

describe("les briques de saisie portent la clé", () => {
  // Toutes les briques passent par `cleValeurServeur` : corriger là, c'est corriger tous les écrans.
  // `Select` n'en est plus : la liste native a cédé la place à `ChampListe`, dont l'état est piloté
  // par React et suit le serveur par son miroir (`vuDuServeur`) — l'autre moitié de la doctrine,
  // gardée par `etat-seme-par-le-serveur.test.ts`.
  const briques = ["src/components/ui/Champ.tsx", "src/components/ui/ZoneTexte.tsx"];
  for (const fichier of briques) {
    it(`${path.basename(fichier)} : la clé est sur le contrôle, pas sur le formulaire`, () => {
      const source = ts.createSourceFile(fichier, lire(fichier), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const sansCle: string[] = [];
      let controles = 0;
      const visiter = (n: ts.Node) => {
        if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
          const balise = n.tagName.getText();
          if (["input", "select", "textarea"].includes(balise)) {
            controles += 1;
            const cle = n.attributes.properties
              .filter(ts.isJsxAttribute)
              .find((a) => ts.isIdentifier(a.name) && a.name.text === "key");
            if (!cle || cle.initializer?.getText() !== "{cleValeurServeur(props)}") sansCle.push(balise);
          }
        }
        ts.forEachChild(n, visiter);
      };
      ts.forEachChild(source, visiter);
      expect(controles).toBeGreaterThan(0);
      expect(sansCle).toEqual([]);
    });
  }
});

/** Le corps d'une fonction exportée, du `export` suivant : de quoi lire ses `revalidatePath`. */
function corpsDeLaFonction(source: string, nom: string): string {
  const debut = source.indexOf(`export async function ${nom}`);
  expect(debut, `fonction ${nom} introuvable`).toBeGreaterThan(-1);
  const suite = source.indexOf("\nexport ", debut + 1);
  return source.slice(debut, suite === -1 ? undefined : suite);
}

describe("FormulaireAction", () => {
  const source = lire("src/components/ui/FormulaireAction.tsx");

  /**
   * **La valeur fraîche arrive par l'action, pas par un second aller-retour.**
   *
   * Le correctif d'origine posait un `router.refresh()` à chaque succès. Mais la plupart des actions
   * invalident déjà le chemin de leur propre page : la réponse de la server action porte alors la
   * charge à jour, et le refresh en redemande une seconde — sur `/admin/periodes/[id]`, tout le
   * `findUnique` de la période, ses requêtes annexes et le calcul des séances, à chaque
   * « Enregistrer ». Le refresh reste donc **conditionnel**, et il se coupe là où l'action fait le
   * travail (`rafraichirApresSucces={false}`).
   */
  it("ne redemande la page que si le formulaire le demande", () => {
    expect(source).toContain('import { useRouter } from "next/navigation";');
    expect(source).toContain("if (state.succes && rafraichirApresSucces) router.refresh();");
  });

  it("l'écran d'une période se passe du second aller-retour, parce que ses actions invalident sa page", () => {
    const page = lire("src/app/(app)/admin/periodes/[id]/page.tsx");
    const actions = lire("src/actions/periodes.ts");
    // Les deux formulaires de l'écran (informations, créneau) coupent le refresh…
    expect(page.match(/rafraichirApresSucces=\{false\}/g)).toHaveLength(2);
    // … et c'est légitime : leur action invalide bien le chemin de cette page.
    expect(actions).toContain("if (periodId) revalidatePath(`/admin/periodes/${periodId}`);");
    for (const nom of ["modifierPeriode", "ajouterCreneau"]) {
      expect(corpsDeLaFonction(actions, nom)).toContain("rafraichir(periodId)");
    }
  });

  it("les trois actions de « Thèmes et lieux » invalident leur propre écran", () => {
    // C'est le bug qui avait fait poser le refresh global : la zone de texte gardait l'ancienne
    // liste, et un second « Enregistrer » la réécrivait en base. Il se règle à la source.
    const actions = lire("src/actions/planning.ts");
    for (const nom of ["enregistrerThemes", "enregistrerThemesEchauffement", "enregistrerLieux"]) {
      expect(corpsDeLaFonction(actions, nom)).toContain('revalidatePath("/admin/themes")');
    }
  });

  it("restaure toujours la saisie quand le serveur refuse", () => {
    expect(source).toContain("if (!state.erreur || !saisie || !formulaire.current) return;");
  });

  it("laisse le message de succès hors des champs, pour qu'il survive au remontage", () => {
    expect(source).toContain('{state.succes && <Alerte type="succes">{state.succes}</Alerte>}');
  });
});

/**
 * **Le balayage.** Écran par écran : tout `defaultValue` / `defaultChecked` dont la valeur vient du
 * serveur doit repartir de cette valeur après un enregistrement — soit parce qu'il est porté par une
 * brique de saisie (qui pose la clé elle-même), soit parce qu'il porte une `key` explicite.
 * Une valeur écrite en dur (`defaultValue="19:00"`) ne change jamais : rien à remonter.
 */
const BRIQUES_AVEC_CLE = new Set(["Champ", "Case", "Select", "ZoneTexte"]);

function fichiersTsx(dossier: string): string[] {
  return fs.readdirSync(dossier, { withFileTypes: true }).flatMap((e) => {
    const complet = path.join(dossier, e.name);
    if (e.isDirectory()) return fichiersTsx(complet);
    return e.name.endsWith(".tsx") ? [complet] : [];
  });
}

/** Une valeur écrite en dur dans le JSX : littéral de texte, nombre, booléen, ou attribut nu. */
function estEcriteEnDur(attribut: ts.JsxAttribute): boolean {
  const valeur = attribut.initializer;
  if (!valeur) return true; // `defaultChecked` tout court
  if (ts.isStringLiteral(valeur)) return true;
  if (ts.isJsxExpression(valeur) && valeur.expression) {
    const e = valeur.expression;
    return ts.isStringLiteral(e) || ts.isNumericLiteral(e) || e.kind === ts.SyntaxKind.TrueKeyword || e.kind === ts.SyntaxKind.FalseKeyword;
  }
  return false;
}

describe("balayage des écrans : plus aucun champ ne ment", () => {
  it("chaque valeur venue du serveur repart du serveur après un enregistrement", () => {
    const fautifs: string[] = [];
    for (const fichier of fichiersTsx(path.join(process.cwd(), "src"))) {
      const source = ts.createSourceFile(fichier, fs.readFileSync(fichier, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const visiter = (n: ts.Node) => {
        if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
          const attributs = n.attributes.properties.filter(ts.isJsxAttribute);
          const defauts = attributs.filter((a) => ts.isIdentifier(a.name) && (a.name.text === "defaultValue" || a.name.text === "defaultChecked"));
          const dynamique = defauts.some((a) => !estEcriteEnDur(a));
          const balise = n.tagName.getText();
          const aUneCle = attributs.some((a) => ts.isIdentifier(a.name) && a.name.text === "key");
          if (dynamique && !BRIQUES_AVEC_CLE.has(balise) && !aUneCle) {
            const { line } = source.getLineAndCharacterOfPosition(n.getStart());
            fautifs.push(`${path.relative(process.cwd(), fichier)}:${line + 1} <${balise}>`);
          }
        }
        ts.forEachChild(n, visiter);
      };
      ts.forEachChild(source, visiter);
    }
    expect(fautifs).toEqual([]);
  });
});
