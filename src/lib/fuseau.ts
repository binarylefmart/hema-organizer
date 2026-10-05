/**
 * **Le fuseau horaire du club** — la partie sans base ni réglage, lisible du serveur comme du
 * navigateur.
 *
 * Les séances stockent une date « AAAA-MM-JJ » et des heures « HH:MM » **locales** : tout ce qui
 * passe d'un instant à une date du calendrier (aujourd'hui, une séance commencée, l'heure du récap)
 * dépend du fuseau. Il était figé sur Europe/Paris ; c'est maintenant un réglage du club (*Club*,
 * dans l'espace admin), à défaut la variable `TZ` du déploiement, à défaut Paris.
 *
 * **Où vit la valeur courante, et pourquoi deux endroits.**
 * - côté serveur, sur `globalThis` : Next charge ce module plusieurs fois (rendu serveur, rendu des
 *   composants clients, instrumentation), et une variable de module ne serait vue que d'une copie.
 *   Elle est posée au démarrage (`src/instrumentation.ts`), à chaque rendu de la mise en page racine,
 *   et à l'enregistrement du réglage ;
 * - côté navigateur, sur `<html data-fuseau>`, rendu par la mise en page racine : présent dans le
 *   HTML avant l'hydratation, il donne au navigateur **exactement** le fuseau du serveur — sans quoi
 *   un club hors de Paris verrait le rendu serveur et le rendu du navigateur se contredire.
 *
 * Les tests unitaires n'ont ni l'un ni l'autre : ils tournent en heure de Paris, comme avant.
 */

/** Le fuseau livré, celui du club qui a commandé l'outil. */
export const FUSEAU_LIVRE = "Europe/Paris";

declare global {
  var __fuseauClub: string | undefined;
}

/** Un identifiant IANA que le moteur sait employer (« Europe/Paris », « America/Montreal »…). */
export function fuseauValide(f: unknown): f is string {
  if (typeof f !== "string" || f.trim() === "") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: f });
    return true;
  } catch {
    return false;
  }
}

/** Le fuseau à employer **maintenant**, au serveur comme dans le navigateur. */
export function fuseauCourant(): string {
  if (typeof document !== "undefined") {
    const f = document.documentElement.dataset.fuseau;
    if (fuseauValide(f)) return f;
  }
  return fuseauValide(globalThis.__fuseauClub) ? globalThis.__fuseauClub : FUSEAU_LIVRE;
}

/** Pose le fuseau du club côté serveur (démarrage, rendu racine, enregistrement du réglage). */
export function poserFuseau(f: string): void {
  if (fuseauValide(f)) globalThis.__fuseauClub = f;
}

/** Décalage d'un fuseau avec UTC à un instant donné, en minutes (+60, +120, −240…). */
export function decalageMinutes(fuseau: string, at: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: fuseau,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const commeUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((commeUtc - at.getTime()) / 60_000);
}

/** « UTC+2 », « UTC−5 », « UTC+5:30 », « UTC » — le décalage tel qu'on le lit. */
export function libelleDecalage(minutes: number): string {
  if (minutes === 0) return "UTC";
  const signe = minutes > 0 ? "+" : "−";
  const abs = Math.abs(minutes);
  const reste = abs % 60;
  return `UTC${signe}${Math.floor(abs / 60)}${reste ? `:${String(reste).padStart(2, "0")}` : ""}`;
}

/** Les continents, en français, pour ranger la liste. */
const REGIONS: Record<string, string> = {
  Europe: "Europe",
  America: "Amériques",
  Africa: "Afrique",
  Asia: "Asie",
  Australia: "Océanie",
  Pacific: "Océanie",
  Indian: "Océan Indien",
  Atlantic: "Atlantique",
  Antarctica: "Antarctique",
  Arctic: "Arctique",
};

/** Les fuseaux d'un club francophone, proposés en tête de liste. */
export const FUSEAUX_FREQUENTS = [
  "Europe/Paris",
  "Europe/Brussels",
  "Europe/Luxembourg",
  "Europe/Zurich",
  "Europe/Monaco",
  "America/Montreal",
  "America/Toronto",
  "America/Deltaique",
  "America/Guadeloupe",
  "America/Cayenne",
  "Indian/Reunion",
  "Indian/Mayotte",
  "Pacific/Noumea",
  "Pacific/Tahiti",
] as const;

/** « America/Port_of_Spain » → « Port of Spain » ; « America/Argentina/Salta » → « Argentina, Salta ». */
function nomVille(f: string): string {
  return f.split("/").slice(1).join(", ").replaceAll("_", " ") || f;
}

/**
 * Les entrées de la liste du réglage : les fuseaux fréquents d'abord, puis tous les autres rangés par
 * continent. Chaque libellé dit la ville et le décalage du jour (« Paris — UTC+2 »), c'est ce qu'on
 * vérifie d'un coup d'œil. Le fuseau réglé, s'il n'est pas dans la liste du moteur, reste proposé.
 */
export function entreesFuseaux(reglé: string, at: Date = new Date()): { valeur: string; libelle: string; groupe: string }[] {
  const tous = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [...FUSEAUX_FREQUENTS];
  const libelle = (f: string) => `${nomVille(f)} — ${libelleDecalage(decalageMinutes(f, at))}`;
  const frequents = FUSEAUX_FREQUENTS.filter(fuseauValide);
  const autres = tous.filter((f) => !(frequents as readonly string[]).includes(f) && REGIONS[f.split("/")[0]]);
  if (fuseauValide(reglé) && !(frequents as readonly string[]).includes(reglé) && !autres.includes(reglé)) autres.unshift(reglé);
  return [
    ...frequents.map((f) => ({ valeur: f, libelle: libelle(f), groupe: "Les plus courants" })),
    ...autres
      .map((f) => ({ valeur: f, libelle: libelle(f), groupe: REGIONS[f.split("/")[0]] ?? "Autres" }))
      .sort((a, b) => a.groupe.localeCompare(b.groupe, "fr") || a.libelle.localeCompare(b.libelle, "fr")),
  ];
}
