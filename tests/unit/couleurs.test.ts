import { describe, expect, it } from "vitest";
import { couleurPersonne, hachage, NOMBRE_COULEURS, numeroCouleur } from "@/lib/couleurs";

/** Surfaces de globals.css sur lesquelles ces couleurs sont posées. */
const SURFACE_CLAIRE = "#fffdfa";
const SURFACE_SOMBRE = "#3a322c";

/** Les deux `hsl(...)` d'un `light-dark(clair, sombre)`. */
function tons(css: string): [string, string] {
  const m = /^light-dark\((hsl\([^)]*\)), (hsl\([^)]*\))\)$/.exec(css);
  if (!m) throw new Error(`format inattendu : ${css}`);
  return [m[1], m[2]];
}

/** Conversion indépendante de celle du module testé : hsl()/#rrggbb → canaux 0–1. */
function canaux(couleur: string): [number, number, number] {
  const hex = /^#([0-9a-f]{6})$/i.exec(couleur);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16) / 255) as [number, number, number];
  const hsl = /^hsl\((\d+(?:\.\d+)?) (\d+(?:\.\d+)?)% (\d+(?:\.\d+)?)%\)$/.exec(couleur);
  if (!hsl) throw new Error(`couleur illisible : ${couleur}`);
  const [t, s, l] = [Number(hsl[1]), Number(hsl[2]) / 100, Number(hsl[3]) / 100];
  const a = s * Math.min(l, 1 - l);
  const canal = (n: number) => {
    const k = (n + t / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [canal(0), canal(8), canal(4)];
}

function luminance(couleur: string): number {
  const lineaire = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const [r, v, b] = canaux(couleur);
  return 0.2126 * lineaire(r) + 0.7152 * lineaire(v) + 0.0722 * lineaire(b);
}

function contraste(a: string, b: string): number {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Coordonnées OKLab : sert à mesurer l'écart *perçu* entre deux couleurs. */
function oklab(couleur: string): [number, number, number] {
  const lineaire = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const [r, v, b] = canaux(couleur).map(lineaire);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * v + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * v + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * v + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function ecartMinimal(couleurs: string[]): number {
  let min = Infinity;
  for (let i = 0; i < couleurs.length; i++) {
    for (let j = i + 1; j < couleurs.length; j++) {
      const [a, b] = [oklab(couleurs[i]), oklab(couleurs[j])];
      min = Math.min(min, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
    }
  }
  return min;
}

const PALETTE = Array.from({ length: NOMBRE_COULEURS }, (_, i) => couleurPersonne("peu-importe", i));

describe("couleurs d'identification", () => {
  it("donne toujours la même couleur pour un identifiant", () => {
    expect(hachage("abc")).toBe(hachage("abc"));
    expect(couleurPersonne("cmu5o9dvy0001")).toBe(couleurPersonne("cmu5o9dvy0001"));
  });

  it("donne une couleur différente à chaque numéro de la palette", () => {
    expect(new Set(PALETTE).size).toBe(NOMBRE_COULEURS);
  });

  it("préfère le numéro attribué à la personne, et retombe sur le hachage sans numéro", () => {
    expect(numeroCouleur("x", 5)).toBe(5);
    expect(numeroCouleur("x", NOMBRE_COULEURS + 3)).toBe(3);
    expect(numeroCouleur("x", null)).toBe(hachage("x") % NOMBRE_COULEURS);
  });

  it("produit une couleur lisible en clair comme en sombre", () => {
    expect(couleurPersonne("x", 0)).toMatch(/^light-dark\(hsl\(\d+ \d+% \d+%\), hsl\(\d+ \d+% \d+%\)\)$/);
  });

  it("respecte WCAG AA sur la surface des deux thèmes", () => {
    // La couleur sert aussi de texte (noms des listes nominatives, posés sur `--surface`) : 4,5:1
    // minimum, avec une marge pour absorber les arrondis d'affichage. Elle ne sert **plus** de texte
    // dans le panneau des listes déroulantes du planning : sur `--primaire-doux`, fond de l'option
    // survolée, la palette tombait à 3,80:1 (clair) et 3,91:1 (sombre) — elle y est devenue une
    // pastille devant le libellé, où 3:1 suffit. La propriété reste exigée ici : c'est elle qui
    // autorise le prochain emploi en texte sans avoir à tout remesurer.
    for (const [i, css] of PALETTE.entries()) {
      const [clair, sombre] = tons(css);
      expect(contraste(clair, SURFACE_CLAIRE), `couleur ${i} en thème clair`).toBeGreaterThanOrEqual(4.6);
      expect(contraste(sombre, SURFACE_SOMBRE), `couleur ${i} en thème sombre`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("garde les 24 couleurs franchement distinctes à l'œil", () => {
    // Seuil calé sur la palette d'origine (écart minimal 0,046 en clair, 0,042 en sombre) :
    // la mise aux normes de contraste ne doit pas rapprocher les couleurs entre elles.
    expect(ecartMinimal(PALETTE.map((c) => tons(c)[0]))).toBeGreaterThanOrEqual(0.046);
    expect(ecartMinimal(PALETTE.map((c) => tons(c)[1]))).toBeGreaterThanOrEqual(0.042);
  });
});
