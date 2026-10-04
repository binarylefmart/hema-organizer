/**
 * **Une nouvelle version est-elle publiée ?** — l'encart que voit un administrateur dans « Mon profil ».
 *
 * Depuis que la stack suit `latest`, rien ne dit au bureau qu'une image plus récente l'attend : le
 * conteneur tourne, l'écran *À propos* donne sa version, et il faut aller voir ailleurs ce qui est
 * sorti. On lit donc les tags de l'image **publique** sur Docker Hub — anonymement, sans jeton —,
 * parce que chaque version y est publiée sous le même numéro que l'image d'un club, qu'elle vienne
 * de Docker Hub ou d'un registre privé.
 *
 * **Ce qui sort** : une requête HTTPS vers `hub.docker.com`, au plus une toutes les six heures et
 * seulement quand un administrateur ouvre son profil. Elle ne porte rien du club (ni nom, ni version,
 * ni domaine), mais elle révèle l'adresse IP du serveur à Docker. `MISE_A_JOUR_DEPOT=` (vide) la coupe.
 *
 * **Jamais bloquant** : trois secondes au plus, et toute erreur (réseau, quota de Docker Hub, réponse
 * inattendue) vaut « on ne sait pas » — l'encart ne s'affiche pas, et rien d'autre ne change.
 */

/** Le dépôt Docker Hub lu par défaut : l'image publique, celle dont toutes les versions portent le numéro. */
export const DEPOT_PAR_DEFAUT = "hematools/hema-organizer";
const DUREE_CACHE_MS = 6 * 60 * 60 * 1000;
const DELAI_MS = 3000;

type Version = [number, number, number];

/** « 0.64.0 » → [0, 64, 0] ; tout ce qui n'est pas exactement trois nombres (« latest », « 0.64 ») → null. */
export function lireVersion(texte: string | null | undefined): Version | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec((texte ?? "").trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function comparerVersions(a: Version, b: Version): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** La plus haute version parmi des noms de tags ; les tags qui ne sont pas des versions sont ignorés. */
export function plusHauteVersion(tags: readonly string[]): string | null {
  let meilleure: { texte: string; v: Version } | null = null;
  for (const t of tags) {
    const v = lireVersion(t);
    if (v && (!meilleure || comparerVersions(v, meilleure.v) > 0)) meilleure = { texte: v.join("."), v };
  }
  return meilleure?.texte ?? null;
}

/**
 * Ce que l'encart doit dire. `null` quand il n'a rien à dire : version courante inconnue (une image
 * construite sans `APP_VERSION`), dernière version inconnue, ou instance déjà à jour — voire en avance,
 * le cas d'un serveur de développement.
 */
export function etatMiseAJour(courante: string | null | undefined, derniere: string | null | undefined): { courante: string; derniere: string } | null {
  const c = lireVersion(courante);
  const d = lireVersion(derniere);
  if (!c || !d || comparerVersions(d, c) <= 0) return null;
  return { courante: c.join("."), derniere: d.join(".") };
}

/** La version qui tourne : gravée dans l'image (`APP_VERSION`), sinon celle de `npm run` en développement. */
export function versionCourante(): string | null {
  return process.env.APP_VERSION || process.env.npm_package_version || null;
}

let cache: { depot: string; quand: number; version: string | null } | null = null;

/** La dernière version publiée, lue chez Docker Hub et gardée six heures. `null` si on ne sait pas. */
export async function derniereVersionPubliee(): Promise<string | null> {
  const depot = (process.env.MISE_A_JOUR_DEPOT ?? DEPOT_PAR_DEFAUT).trim();
  // Vide : la vérification est coupée. Un nom mal formé ne part pas non plus dans une URL.
  if (!/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/.test(depot)) return null;
  if (cache && cache.depot === depot && Date.now() - cache.quand < DUREE_CACHE_MS) return cache.version;
  let version: string | null = null;
  try {
    const reponse = await fetch(`https://hub.docker.com/v2/repositories/${depot}/tags?page_size=50&ordering=last_updated`, {
      signal: AbortSignal.timeout(DELAI_MS),
      cache: "no-store",
    });
    if (reponse.ok) {
      const corps = (await reponse.json()) as { results?: { name?: unknown }[] };
      version = plusHauteVersion((corps.results ?? []).map((r) => (typeof r.name === "string" ? r.name : "")));
    }
  } catch {
    version = null;
  }
  // Un échec se garde aussi (six heures) : un Docker Hub injoignable ne doit pas coûter trois
  // secondes à chaque ouverture du profil.
  cache = { depot, quand: Date.now(), version };
  return version;
}

/**
 * **Où lire ce que change une version** : la release GitHub de son tag, publiée par le workflow à
 * partir de `CHANGELOG.md`. Celle du dépôt public par défaut, lisible sans compte ; un autre modèle
 * se donne par `MISE_A_JOUR_NOTES` (`{version}` y est remplacé). Seule une adresse `https://` est
 * acceptée : elle finit dans un lien cliqué par un administrateur.
 */
export const NOTES_PAR_DEFAUT = "https://github.com/binarylefmart/hema-organizer/releases/tag/v{version}";

export function notesDeVersionUrl(version: string): string | null {
  const modele = (process.env.MISE_A_JOUR_NOTES ?? NOTES_PAR_DEFAUT).trim();
  if (!modele.startsWith("https://") || !lireVersion(version)) return null;
  try {
    return new URL(modele.replaceAll("{version}", version)).toString();
  } catch {
    return null;
  }
}

/** Pour les tests : oublie la dernière lecture. */
export function oublierCacheMiseAJour(): void {
  cache = null;
}
