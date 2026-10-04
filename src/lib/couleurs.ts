/**
 * Couleur d'identification d'une personne : sert de pastille dans les listes nominatives
 * et de liseré dans le planning, pour repérer quelqu'un d'un coup d'œil.
 *
 * Chaque personne reçoit un **numéro de couleur** à sa création (`User.couleur`), choisi parmi
 * les moins utilisés : deux membres du club n'ont donc jamais la même couleur tant que la palette
 * n'est pas épuisée. Les comptes sans numéro (anciens jeux de données) retombent sur un hachage.
 */

/** 12 teintes bien séparées sur la roue, déclinées en deux tons → 24 couleurs distinctes. */
const TEINTES = [8, 30, 48, 88, 120, 150, 172, 192, 212, 250, 285, 322];

/** Surfaces sur lesquelles ces couleurs sont posées (`--surface` de globals.css, clair puis sombre). */
const SURFACE_CLAIRE = "#fffdfa";
const SURFACE_SOMBRE = "#3a322c";

/**
 * Deux tons par teinte, décrits par un **contraste cible** et non par une luminosité fixe.
 *
 * La luminosité HSL ne dit rien de la clarté perçue — un jaune à 50 % est bien plus clair qu'un bleu
 * au même niveau — si bien qu'à luminosité constante la moitié de la palette tombait sous les 4,5:1
 * exigés par WCAG AA (la couleur sert aussi de texte : noms dans les listes déroulantes du planning).
 * En partant du contraste, chaque teinte reçoit la luminosité qu'il lui faut.
 *
 * Les deux cibles de chaque ton alternent d'une teinte à l'autre : deux teintes voisines sur la roue
 * (88/120, 285/322) se distinguent alors aussi par la clarté, ce qui maintient l'écart entre les
 * 24 couleurs — leur raison d'être — malgré la contrainte de contraste.
 */
const TONS = [
  // Ton profond : sombre sur fond clair, lumineux sur fond sombre.
  { sClair: 74, ciblesClair: [6, 7], sSombre: 66, ciblesSombre: [6, 7] },
  // Ton vif : nettement moins contrasté que le premier, mais toujours au-dessus du seuil AA.
  { sClair: 58, ciblesClair: [4.7, 5.5], sSombre: 56, ciblesSombre: [4.7, 5.5] },
];

export const NOMBRE_COULEURS = TEINTES.length * TONS.length;

/** Canal sRGB linéarisé (formule WCAG), à partir d'une valeur 0–1. */
function canalLineaire(valeur: number): number {
  return valeur <= 0.03928 ? valeur / 12.92 : ((valeur + 0.055) / 1.055) ** 2.4;
}

/** Luminance relative WCAG de canaux rouge/vert/bleu exprimés de 0 à 1. */
function luminance(r: number, v: number, b: number): number {
  return 0.2126 * canalLineaire(r) + 0.7152 * canalLineaire(v) + 0.0722 * canalLineaire(b);
}

/** Luminance relative d'une couleur HSL, sans passer par le DOM (le calcul doit tenir côté serveur). */
function luminanceHsl(teinte: number, saturation: number, luminosite: number): number {
  const s = saturation / 100;
  const l = luminosite / 100;
  const a = s * Math.min(l, 1 - l);
  const canal = (n: number) => {
    const k = (n + teinte / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return luminance(canal(0), canal(8), canal(4));
}

/** Luminance relative d'une couleur `#rrggbb`. */
function luminanceHex(hex: string): number {
  const [r, v, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return luminance(r, v, b);
}

/** Rapport de contraste WCAG entre deux luminances relatives. */
function contraste(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * Luminosité entière la plus proche du fond qui atteint encore le contraste demandé :
 * on descend depuis les couleurs claires sur fond clair, on monte depuis les sombres sur fond sombre.
 */
function luminositePour(teinte: number, saturation: number, cible: number, luminanceFond: number, surFondSombre: boolean): number {
  const pas = surFondSombre ? 1 : -1;
  for (let l = surFondSombre ? 25 : 70; l >= 0 && l <= 100; l += pas) {
    if (contraste(luminanceHsl(teinte, saturation, l), luminanceFond) >= cible) return l;
  }
  return surFondSombre ? 100 : 0;
}

/** Les 24 couleurs, calculées une fois au chargement du module (même résultat serveur et navigateur). */
const PALETTE: readonly string[] = Array.from({ length: NOMBRE_COULEURS }, (_, n) => {
  const rang = n % TEINTES.length;
  const teinte = TEINTES[rang];
  const ton = TONS[Math.floor(n / TEINTES.length) % TONS.length];
  const alternance = rang % 2;
  const lClaire = luminositePour(teinte, ton.sClair, ton.ciblesClair[alternance], luminanceHex(SURFACE_CLAIRE), false);
  const lSombre = luminositePour(teinte, ton.sSombre, ton.ciblesSombre[alternance], luminanceHex(SURFACE_SOMBRE), true);
  return `light-dark(hsl(${teinte} ${ton.sClair}% ${lClaire}%), hsl(${teinte} ${ton.sSombre}% ${lSombre}%))`;
});

/** Hachage déterministe (FNV-1a 32 bits) : même identifiant → même couleur, quelle que soit la machine. */
export function hachage(texte: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < texte.length; i++) {
    h ^= texte.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** Numéro de couleur effectif : celui attribué à la personne, sinon dérivé de son identifiant. */
export function numeroCouleur(id: string, couleur?: number | null): number {
  const n = couleur ?? hachage(id);
  return ((n % NOMBRE_COULEURS) + NOMBRE_COULEURS) % NOMBRE_COULEURS;
}

/** Couleur CSS de la personne (fond de pastille, liseré), lisible en clair comme en sombre. */
export function couleurPersonne(id: string, couleur?: number | null): string {
  return PALETTE[numeroCouleur(id, couleur)];
}
