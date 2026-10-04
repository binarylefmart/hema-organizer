import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  choixOuDefaut,
  estChoixThemeConnu,
  estThemeConnu,
  GROUPES_THEMES,
  lireChoixTheme,
  nomDuChoix,
  THEME_DEFAUT,
  THEMES,
  themeOuDefaut,
  type ThemeId,
} from "@/lib/themes";

/**
 * Le catalogue des thèmes et la feuille de style doivent rester d'accord : un thème proposé dans la
 * liste du profil mais oublié dans `globals.css` donnerait une page à moitié repeinte (les variables
 * non redéfinies retombant sur « parchemin »). Ces tests lisent donc le CSS pour de vrai.
 */
const CSS = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");

/** Variables sans lesquelles un thème ne tient pas : fonds, texte, accent et les trois sens de présence. */
const VARIABLES_MINIMALES = ["--fond", "--surface", "--texte", "--primaire", "--vert", "--rouge", "--ocre"] as const;

/** Corps du bloc `{ … }` qui suit la position donnée (accolades appariées). */
function corpsDuBloc(css: string, depuis: number): string {
  const ouverture = css.indexOf("{", depuis);
  if (ouverture === -1) throw new Error("bloc CSS sans accolade ouvrante");
  let profondeur = 0;
  for (let i = ouverture; i < css.length; i++) {
    if (css[i] === "{") profondeur++;
    else if (css[i] === "}" && --profondeur === 0) return css.slice(ouverture + 1, i);
  }
  throw new Error("bloc CSS non refermé");
}

/** Intervalles [début, fin] des `@media (prefers-color-scheme: dark)` du fichier. */
function zonesSombres(css: string): [number, number][] {
  const zones: [number, number][] = [];
  const media = /@media[^{]*prefers-color-scheme\s*:\s*dark[^{]*/g;
  for (let m = media.exec(css); m; m = media.exec(css)) {
    const ouverture = css.indexOf("{", m.index);
    const corps = corpsDuBloc(css, m.index);
    zones.push([ouverture, ouverture + corps.length + 1]);
  }
  return zones;
}

const ZONES_SOMBRES = zonesSombres(CSS);
const dansLeSombre = (i: number) => ZONES_SOMBRES.some(([debut, fin]) => i > debut && i < fin);

/**
 * Corps du bloc portant ce sélecteur, en mode clair (hors `@media`) ou sombre (dedans).
 * Le sélecteur est cherché tel quel : un bloc partagé (`[data-theme="a"], [data-theme="b"] { … }`)
 * est donc bien rendu pour chacun des deux.
 */
function blocs(selecteur: RegExp, sombre: boolean): string[] {
  const motif = new RegExp(selecteur.source, "g");
  const trouves: string[] = [];
  for (let m = motif.exec(CSS); m; m = motif.exec(CSS)) {
    // Une occurrence n'est un début de règle que si une accolade ouvrante vient avant la prochaine fermante.
    const ouverture = CSS.indexOf("{", m.index);
    const fermeture = CSS.indexOf("}", m.index);
    if (ouverture === -1 || (fermeture !== -1 && fermeture < ouverture)) continue;
    // Un bloc sombre s'écrit `sélecteur { @variant sombre { … } }` (voir l'en-tête de globals.css) ;
    // l'ancienne forme, sous `@media (prefers-color-scheme: dark)`, reste reconnue.
    const corps = corpsDuBloc(CSS, m.index);
    const variante = /^\s*@variant\s+sombre\s*\{/.test(corps);
    if ((variante || dansLeSombre(m.index)) === sombre) trouves.push(variante ? corpsDuBloc(corps, 0) : corps);
  }
  return trouves;
}

const selecteurTheme = (id: string) => new RegExp(`\\[data-theme\\s*=\\s*["']?${id}["']?\\s*\\]`);
const selecteurRacine = /:root(?![\w-])/;

/** Blocs qui s'appliquent à un thème dans un mode : sa règle propre, sinon (pour « parchemin ») `:root`. */
function blocsDuTheme(id: ThemeId, sombre: boolean): string[] {
  const propres = blocs(selecteurTheme(id), sombre);
  return propres.length ? propres : id === THEME_DEFAUT ? blocs(selecteurRacine, sombre) : [];
}

/** Dernière valeur déclarée pour une variable dans ces blocs (la dernière règle gagne en CSS). */
function valeur(corps: string[], variable: string): string | null {
  let trouvee: string | null = null;
  const motif = new RegExp(`(?:^|[;{\\s])${variable}\\s*:\\s*([^;}]+)`, "g");
  for (const c of corps) for (let m = motif.exec(c); m; m = motif.exec(c)) trouvee = m[1].trim();
  return trouvee;
}

/** Valeur d'une variable pour un thème dans un mode, en retombant sur `:root` quand le thème ne la redéfinit pas. */
function variableDuTheme(id: ThemeId, variable: string, sombre: boolean): string | null {
  return valeur(blocsDuTheme(id, sombre), variable) ?? valeur(blocs(selecteurRacine, sombre), variable);
}

/** #rgb, #rrggbb, rgb() ou hsl() → canaux 0–1 (conversion écrite ici, sans dépendance). */
function canaux(couleur: string): [number, number, number] {
  const c = couleur.trim();
  const court = /^#([0-9a-f]{3})$/i.exec(c);
  if (court) return [0, 1, 2].map((i) => parseInt(court[1][i].repeat(2), 16) / 255) as [number, number, number];
  const hex = /^#([0-9a-f]{6})$/i.exec(c);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16) / 255) as [number, number, number];
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(c);
  if (rgb) return [1, 2, 3].map((i) => Number(rgb[i]) / 255) as [number, number, number];
  const hsl = /^hsla?\(\s*(-?\d+(?:\.\d+)?)(?:deg)?[\s,]+(\d+(?:\.\d+)?)%[\s,]+(\d+(?:\.\d+)?)%/i.exec(c);
  if (hsl) {
    const [t, s, l] = [Number(hsl[1]), Number(hsl[2]) / 100, Number(hsl[3]) / 100];
    const a = s * Math.min(l, 1 - l);
    const canal = (n: number) => {
      const k = (n + t / 30) % 12;
      return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    };
    return [canal(0), canal(8), canal(4)];
  }
  throw new Error(`couleur illisible : ${couleur}`);
}

/** Luminance relative WCAG 2.1. */
function luminance(couleur: string): number {
  const lineaire = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const [r, v, b] = canaux(couleur);
  return 0.2126 * lineaire(r) + 0.7152 * lineaire(v) + 0.0722 * lineaire(b);
}

function contraste(a: string, b: string): number {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Toute couleur lisible ramenée à « #rrggbb » minuscule, pour comparer le catalogue et le CSS. */
function enHex(couleur: string): string {
  return `#${canaux(couleur)
    .map((v) => Math.round(v * 255).toString(16).padStart(2, "0"))
    .join("")}`;
}

/** Les trois rôles d'une pastille et la variable CSS dont chacun recopie la valeur. */
const PASTILLES = [
  ["fond", "--fond"],
  ["primaire", "--primaire"],
  ["texte", "--texte"],
] as const;

const IDS = THEMES.map((t) => t.id);
const AUTRES = THEMES.filter((t) => t.id !== THEME_DEFAUT);

describe("catalogue des thèmes", () => {
  it("propose au moins dix thèmes, « parchemin » en tête", () => {
    expect(THEMES.length).toBeGreaterThanOrEqual(10);
    expect(THEME_DEFAUT).toBe("parchemin");
    expect(IDS[0]).toBe(THEME_DEFAUT);
  });

  it("n'a ni deux identifiants ni deux noms identiques", () => {
    expect(new Set(IDS).size).toBe(THEMES.length);
    expect(new Set(THEMES.map((t) => t.nom)).size).toBe(THEMES.length);
  });

  it("ne liste que des identifiants reconnus par estThemeConnu", () => {
    for (const id of IDS) expect(estThemeConnu(id), id).toBe(true);
  });

  it("donne à chaque thème un nom et une description non vides", () => {
    for (const t of THEMES) {
      expect(t.nom.trim(), t.id).not.toBe("");
      expect(t.description.trim(), t.id).not.toBe("");
    }
  });

  it("donne trois couleurs d'aperçu au format #rrggbb, en clair comme en sombre", () => {
    for (const t of THEMES) {
      for (const [mode, apercu] of [
        ["clair", t.apercu],
        ["sombre", t.apercuSombre],
      ] as const) {
        expect(Object.keys(apercu).sort(), `${t.id} / ${mode}`).toEqual(["fond", "primaire", "texte"]);
        for (const [role, couleur] of Object.entries(apercu)) {
          expect(couleur, `${t.id} / ${mode} / ${role}`).toMatch(/^#[0-9a-f]{6}$/i);
        }
      }
    }
  });
});

describe("lecture d'un thème enregistré", () => {
  it("accepte tel quel chacun des identifiants connus", () => {
    for (const id of IDS) {
      expect(themeOuDefaut(id), id).toBe(id);
      expect(estThemeConnu(id), id).toBe(true);
    }
  });

  it("retombe sur le thème par défaut pour toute valeur inconnue", () => {
    for (const valeurDouteuse of ["violet", "", " ", "PARCHEMIN", "Dracula", "parchemin ", "../etc/passwd"]) {
      expect(themeOuDefaut(valeurDouteuse), JSON.stringify(valeurDouteuse)).toBe(THEME_DEFAUT);
      expect(estThemeConnu(valeurDouteuse), JSON.stringify(valeurDouteuse)).toBe(false);
    }
  });

  it("retombe sur le thème par défaut pour null et undefined", () => {
    expect(themeOuDefaut(null)).toBe(THEME_DEFAUT);
    expect(themeOuDefaut(undefined)).toBe(THEME_DEFAUT);
  });

  it("refuse tout ce qui n'est pas une chaîne", () => {
    for (const valeurDouteuse of [null, undefined, 0, 12, true, {}, { id: "dracula" }, ["dracula"], () => "dracula"]) {
      expect(estThemeConnu(valeurDouteuse), String(valeurDouteuse)).toBe(false);
    }
  });
});

describe("accord entre le catalogue et globals.css", () => {
  it("donne à chaque thème autre que parchemin son bloc [data-theme]", () => {
    for (const t of AUTRES) expect(blocs(selecteurTheme(t.id), false).length, t.id).toBeGreaterThan(0);
  });

  it("donne à chaque thème autre que parchemin sa déclinaison sombre", () => {
    // Sans elle, l'appareil en mode sombre repeindrait la page avec le parchemin éteint.
    for (const t of AUTRES) expect(blocs(selecteurTheme(t.id), true).length, t.id).toBeGreaterThan(0);
  });

  it("redéfinit partout les variables qui portent le sens des couleurs", () => {
    for (const t of AUTRES) {
      for (const mode of [false, true]) {
        const corps = blocs(selecteurTheme(t.id), mode);
        for (const v of VARIABLES_MINIMALES) {
          expect(valeur(corps, v), `${t.id} / ${v} / ${mode ? "sombre" : "clair"}`).not.toBeNull();
        }
      }
    }
  });

  it("garde le texte lisible sur le fond, en clair comme en sombre (WCAG AA)", () => {
    for (const t of THEMES) {
      for (const mode of [false, true]) {
        const etiquette = `${t.id} / ${mode ? "sombre" : "clair"}`;
        const texte = variableDuTheme(t.id, "--texte", mode);
        const fond = variableDuTheme(t.id, "--fond", mode);
        expect(texte, `${etiquette} : --texte introuvable`).not.toBeNull();
        expect(fond, `${etiquette} : --fond introuvable`).not.toBeNull();
        expect(contraste(texte!, fond!), etiquette).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("garde lisibles les couleurs d'aperçu montrées dans la liste du profil", () => {
    for (const t of THEMES) {
      expect(contraste(t.apercu.texte, t.apercu.fond), `${t.id} / clair : texte sur fond`).toBeGreaterThanOrEqual(4.5);
      expect(contraste(t.apercuSombre.texte, t.apercuSombre.fond), `${t.id} / sombre : texte sur fond`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("montre en sombre les couleurs que le thème donnera vraiment", () => {
    // Les pastilles du profil sont lues sur ce catalogue : si elles s'écartent du CSS, elles mentent.
    for (const t of THEMES) {
      for (const [role, variable] of PASTILLES) {
        const declaree = variableDuTheme(t.id, variable, true);
        expect(declaree, `${t.id} / ${variable} : introuvable en sombre`).not.toBeNull();
        expect(enHex(t.apercuSombre[role]), `${t.id} / ${role} (${variable})`).toBe(enHex(declaree!));
      }
    }
  });
});

/**
 * **La vignette du prochain cours se pose sur le fond encre**, et c'est le seul endroit de
 * l'application où les couleurs de statut sont peintes sur ce fond-là.
 *
 * Or le vert de « Présent » est fait pour être lu sur du parchemin : posé sur l'encre en mode
 * clair, il ne donne que 2,2:1 — en dessous du 3:1 exigé d'un élément graphique porteur de sens,
 * et les silhouettes de la vignette s'y effaçaient. D'où `--vert-sur-encre` et `--ocre-sur-encre`
 * (globals.css), mélangés à l'encre-texte du thème en cours. Ce test vérifie le résultat **sur tous les
 * thèmes et dans les deux modes** : c'est exactement la promesse qu'on ne peut pas tenir à
 * l'œil, et un nouveau thème ajouté sans y penser la casserait en silence.
 */
describe("la vignette du prochain cours, sur tous les thèmes", () => {
  /** `color-mix(in srgb, var(--a) N%, var(--b))` évalué comme le ferait le navigateur. */
  function melange(declaration: string, resoudre: (variable: string) => string): string {
    const m = /^color-mix\(\s*in\s+srgb\s*,\s*var\(\s*(--[\w-]+)\s*\)\s+(\d+(?:\.\d+)?)%\s*,\s*var\(\s*(--[\w-]+)\s*\)\s*\)$/.exec(
      declaration.trim(),
    );
    if (!m) return declaration.startsWith("var(") ? resoudre(/var\(\s*(--[\w-]+)/.exec(declaration)![1]) : declaration;
    const part = Number(m[2]) / 100;
    const [a, b] = [canaux(resoudre(m[1])), canaux(resoudre(m[3]))];
    // `color-mix` interpole les canaux sRGB non linéaires, comme ici.
    return `#${a
      .map((v, i) => Math.round((v * part + b[i] * (1 - part)) * 255).toString(16).padStart(2, "0"))
      .join("")}`;
  }

  /** Ce que la vignette peint sur l'encre, et le contraste minimal que chacun doit tenir. */
  const MARQUES = [
    ["--vert-sur-encre", "silhouettes et pastille des présents"],
    ["--ocre-sur-encre", "silhouettes et pastille des peut-être"],
  ] as const;

  for (const sombre of [false, true]) {
    const mode = sombre ? "sombre" : "clair";

    it(`garde les couleurs de statut lisibles sur l'encre en mode ${mode}`, () => {
      for (const id of IDS) {
        // Les deux variables dérivées ne sont déclarées qu'une fois, dans le `:root` clair : le
        // bloc sombre ne redéclare que ce qu'il change, et la cascade garde le reste. Le repli sur
        // le mode clair reproduit donc ce que fait vraiment le navigateur.
        const resoudre = (v: string) => {
          const trouve = variableDuTheme(id, v, sombre) ?? variableDuTheme(id, v, false);
          expect(trouve, `${id} / ${mode} : ${v} introuvable`).not.toBeNull();
          return trouve!;
        };
        const encre = resoudre("--encre");
        for (const [variable, role] of MARQUES) {
          const couleur = melange(resoudre(variable), resoudre);
          const etiquette = `${id} / ${mode} : ${role} (${variable})`;
          // 4,5:1 et non 3:1 : la pastille porte du texte en encre par-dessus cette couleur, donc
          // c'est le seuil du texte qui commande, et il couvre du même coup celui des silhouettes.
          expect(contraste(couleur, encre), etiquette).toBeGreaterThanOrEqual(4.5);
        }
      }
    });

    it(`garde lisibles les textes de la vignette sur l'encre en mode ${mode}`, () => {
      for (const id of IDS) {
        const encre = variableDuTheme(id, "--encre", sombre)!;
        for (const variable of ["--encre-texte", "--marque"] as const) {
          const couleur = variableDuTheme(id, variable, sombre);
          expect(couleur, `${id} / ${mode} : ${variable} introuvable`).not.toBeNull();
          expect(contraste(couleur!, encre), `${id} / ${mode} : ${variable} sur --encre`).toBeGreaterThanOrEqual(4.5);
        }
      }
    });
  }

  it("garde le repli des navigateurs sans color-mix", () => {
    // Chaque variable est déclarée deux fois : la couleur brute d'abord, le mélange ensuite. Un
    // navigateur qui ne sait pas lire `color-mix` ignore la seconde ligne et garde la première —
    // moins contrastée, mais jamais absente, ce qui laisserait la silhouette sans couleur du tout.
    for (const [variable] of MARQUES) {
      const brute = variable.replace("-sur-encre", "");
      expect(CSS, `${variable} : repli manquant`).toMatch(new RegExp(`${variable}\\s*:\\s*var\\(${brute}\\)`));
    }
  });
});

/**
 * **Les six repères de partie, sur tous les thèmes**.
 *
 * L'étiquette d'une partie n'alterne plus deux teintes mais en porte **une par rang** (« cours/option
 * 1 couleur 1, cours/option 2 couleur 2 etc »). Deux d'entre elles sont des couleurs que chaque thème
 * définit déjà ; les deux autres s'en dérivent par `color-mix`, et c'est **exactement ce que ce bloc
 * existe pour surveiller** : une valeur calculée ne se relit pas à l'œil dans la feuille de style, et
 * personne ne va vérifier quinze thèmes × deux modes × quatre teintes à la main. C'est aussi lui qui a
 * **ramené six teintes à quatre** : il a trouvé deux mélanges indiscernables et un contraste à 3,9:1.
 *
 * Deux propriétés, et aucune n'est cosmétique :
 *
 * 1. **le texte posé sur l'étiquette reste lisible** — l'aplat du cours porte `--primaire-texte`, le
 *    contour de l'option porte sa propre teinte sur son fond `-doux` ;
 * 2. **deux teintes ne se confondent pas**, sinon le repère ne sépare plus rien et le rang 3 vaut le
 *    rang 1 — le défaut qu'on vient de corriger.
 */
describe("les six repères de partie, sur tous les thèmes", () => {
  /** Découpe les arguments d'un `color-mix(...)` sur les virgules **de premier niveau**. */
  function arguments_(dedans: string): string[] {
    const morceaux: string[] = [];
    let profondeur = 0;
    let courant = "";
    for (const c of dedans) {
      if (c === "(") profondeur++;
      if (c === ")") profondeur--;
      if (c === "," && profondeur === 0) {
        morceaux.push(courant);
        courant = "";
      } else courant += c;
    }
    return [...morceaux, courant].map((m) => m.trim());
  }

  /**
   * Une déclaration de couleur réduite à son `#rrggbb`, comme le ferait le navigateur : `var(--x)`,
   * `color-mix(…)`, et **les deux imbriqués** — `--partie-4-doux` mélange `--partie-4`, qui est
   * elle-même un mélange. Le `melange` du bloc précédent ne descend pas d'un niveau ; celui-ci est
   * récursif, et c'est la seule différence entre les deux.
   */
  function resolue(declaration: string, lire: (variable: string) => string): string {
    const e = declaration.trim();
    const v = /^var\(\s*(--[\w-]+)\s*\)$/.exec(e);
    if (v) return resolue(lire(v[1]), lire);
    if (!/^color-mix\(/i.test(e)) return e;
    const [espace, premier, second] = arguments_(e.slice(e.indexOf("(") + 1, e.lastIndexOf(")")));
    expect(espace.replace(/\s+/g, " ").trim(), `espace de mélange inattendu : ${e}`).toBe("in srgb");
    const part = /(\d+(?:\.\d+)?)%\s*$/.exec(premier);
    expect(part, `pourcentage introuvable : ${premier}`).not.toBeNull();
    const p = Number(part![1]) / 100;
    const a = canaux(resolue(premier.replace(/(\d+(?:\.\d+)?)%\s*$/, "").trim(), lire));
    const b = canaux(resolue(second, lire));
    return `#${a
      .map((x, i) => Math.round((x * p + b[i] * (1 - p)) * 255).toString(16).padStart(2, "0"))
      .join("")}`;
  }

  /** Écart entre deux couleurs, en unités de canal (0–255) : de quoi dire « ce ne sont pas les mêmes ». */
  function ecart(a: string, b: string): number {
    const [x, y] = [canaux(a), canaux(b)];
    return Math.sqrt(x.reduce((s, v, i) => s + ((v - y[i]) * 255) ** 2, 0));
  }

  const RANGS = [1, 2, 3, 4, 5, 6] as const;

  for (const sombre of [false, true]) {
    const mode = sombre ? "sombre" : "clair";

    it(`gardent l'étiquette lisible en mode ${mode} (WCAG AA)`, () => {
      for (const id of IDS) {
        const lire = (v: string) => {
          const trouve = variableDuTheme(id, v, sombre) ?? variableDuTheme(id, v, false);
          expect(trouve, `${id} / ${mode} : ${v} introuvable`).not.toBeNull();
          return trouve!;
        };
        const surAplat = resolue(lire("--primaire-texte"), lire);
        for (const n of RANGS) {
          const teinte = resolue(lire(`--partie-${n}`), lire);
          const doux = resolue(lire(`--partie-${n}-doux`), lire);
          expect(contraste(teinte, surAplat), `${id} / ${mode} : « Cours ${n} » (texte sur l'aplat)`).toBeGreaterThanOrEqual(4.5);
          expect(contraste(teinte, doux), `${id} / ${mode} : « Option ${n} » (teinte sur son fond doux)`).toBeGreaterThanOrEqual(4.5);
        }
      }
    });

    it(`restent distinguables deux à deux en mode ${mode}`, () => {
      for (const id of IDS) {
        const lire = (v: string) => variableDuTheme(id, v, sombre) ?? variableDuTheme(id, v, false)!;
        const teintes = RANGS.map((n) => ({ n, hex: resolue(lire(`--partie-${n}`), lire) }));
        for (const a of teintes)
          for (const b of teintes)
            if (a.n < b.n)
              // 24 unités sur 255 : l'écart au-dessous duquel deux étiquettes voisines se lisent
              // comme la même couleur.
              expect(ecart(a.hex, b.hex), `${id} / ${mode} : « ${a.n} » et « ${b.n} » trop proches`).toBeGreaterThanOrEqual(24);
      }
    });
  }
});

describe("choix d'un thème clair ou sombre", () => {
  it("lit un thème seul (suit l'appareil) et un thème avec son mode", () => {
    expect(lireChoixTheme("dracula")).toEqual({ id: "dracula", mode: null });
    expect(lireChoixTheme("dracula:sombre")).toEqual({ id: "dracula", mode: "sombre" });
    expect(lireChoixTheme("catppuccin-mocha:clair")).toEqual({ id: "catppuccin-mocha", mode: "clair" });
  });

  it("refuse ce qui ne désigne rien — la valeur finit dans un attribut de <html>", () => {
    for (const v of ["dracula:nuit", "inconnu:sombre", "dracula:sombre:x", "", ":sombre", null, 12, { id: "dracula" }]) {
      expect(lireChoixTheme(v), String(v)).toBeNull();
      expect(estChoixThemeConnu(v)).toBe(false);
    }
  });

  it("retombe sur le thème du club, qui suit l'appareil, quand le membre n'a rien de valable", () => {
    expect(choixOuDefaut(null, "foret")).toEqual({ id: "foret", mode: null });
    expect(choixOuDefaut("n'importe quoi", "foret")).toEqual({ id: "foret", mode: null });
    expect(choixOuDefaut("ocean:clair", "foret")).toEqual({ id: "ocean", mode: "clair" });
  });

  it("range chaque thème une fois dans chaque groupe, clairs puis sombres, triés par nom", () => {
    expect(GROUPES_THEMES.map((g) => g.mode)).toEqual(["clair", "sombre"]);
    for (const g of GROUPES_THEMES) {
      expect(g.choix.map((c) => c.theme.id).sort()).toEqual([...IDS].sort());
      const noms = g.choix.map((c) => c.nom);
      expect(noms).toEqual([...noms].sort((a, b) => a.localeCompare(b, "fr")));
      expect(new Set(noms).size, `${g.mode} : deux lignes portent le même nom`).toBe(noms.length);
      for (const c of g.choix) expect(lireChoixTheme(c.valeur)).toEqual({ id: c.theme.id, mode: g.mode });
    }
  });

  it("nomme Catppuccin par sa saveur : Latte le jour, la saveur sombre la nuit", () => {
    const mocha = THEMES.find((t) => t.id === "catppuccin-mocha")!;
    expect(nomDuChoix(mocha, "clair")).toBe("Catppuccin Latte · Mauve");
    expect(nomDuChoix(mocha, "sombre")).toBe("Catppuccin Mocha · Mauve");
    expect(nomDuChoix(THEMES.find((t) => t.id === "foret")!, "sombre")).toBe("Forêt sombre");
  });
});

describe("le mode choisi s'impose dans la feuille de style", () => {
  it("une seule définition sert l'appareil en sombre et le thème sombre choisi", () => {
    const variante = corpsDuBloc(CSS, CSS.indexOf("@custom-variant sombre"));
    expect(variante).toMatch(/prefers-color-scheme:\s*dark[\s\S]*:not\(\[data-mode="clair"\]\)/);
    expect(variante).toMatch(/&\[data-mode="sombre"\]/);
    // Plus aucune palette sous l'ancienne forme, qui ignorait le choix du membre.
    // Les deux seules media queries « sombre » du fichier sont celles des variantes `sombre` et `dark`.
    expect(CSS.match(/@media[^{]*prefers-color-scheme/g)).toHaveLength(2);
  });
});
