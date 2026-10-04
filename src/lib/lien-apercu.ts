import { lookup } from "node:dns/promises";
import { SIGLE_LIVRE, SUFFIXE_LIVRE } from "./constants";

/**
 * Aperçu d'un lien collé (« unfurl ») : on va chercher le `<head>` d'une page publique pour
 * pré-remplir la fiche d'un événement (titre, description, image, nom du site).
 *
 * ⚠️ Une fonction qui va chercher une URL **fournie par un utilisateur** est une arme de
 * falsification de requête côté serveur (SSRF) : depuis l'intérieur du réseau, elle peut sonder
 * des machines privées, lire des métadonnées de cloud (169.254.169.254), atteindre la base…
 * Tout ce module est écrit pour rendre cela impossible :
 *   1. schéma `http`/`https` uniquement, pas d'identifiants dans l'URL ;
 *   2. résolution DNS **avant** la requête, refus de toute adresse privée/locale/réservée,
 *      **revérifiée à chaque redirection** (3 sauts au maximum) ;
 *   3. délai court, taille de réponse plafonnée, type de contenu exigé ;
 *   4. pas de cookies, pas d'authentification, pas de « referer », User-Agent honnête.
 *
 * Les fonctions de jugement (URL, adresse IP, extraction des balises) sont **pures** et testées
 * une par une dans tests/unit/lien-apercu.test.ts ; l'action serveur, elle, reste mince.
 *
 * Limite connue et assumée : entre la résolution DNS et la connexion, un domaine hostile peut en
 * théorie changer sa réponse DNS (« DNS rebinding »). Sans dépendance supplémentaire (agent HTTP
 * maison), on ne peut pas épingler l'adresse ; le plafond de temps, le plafond de taille, le type
 * de contenu exigé et l'absence de tout secret sortant limitent fortement ce qu'un tel détour
 * rapporterait : la réponse n'est jamais renvoyée telle quelle, seules quelques balises le sont.
 */

/** Résultat d'un aperçu : uniquement du texte court et une URL d'image, jamais la page elle-même. */
export type ApercuLien = {
  titre: string | null;
  description: string | null;
  /** URL absolue de l'illustration — à afficher via /api/image, jamais en source directe. */
  image: string | null;
  siteNom: string | null;
  /** URL finale, après redirections et normalisation. */
  url: string;
};

/** Délai maximal, toutes redirections comprises. */
export const APERCU_DELAI_MS = 5_000;
/** On ne lit que le début de la page : le `<head>` y est largement contenu. */
export const APERCU_MAX_OCTETS = 512 * 1024;
export const IMAGE_MAX_OCTETS = 3 * 1024 * 1024;
export const APERCU_MAX_REDIRECTIONS = 3;
export const URL_MAX_LONGUEUR = 2048;
/** Cache de la route image : une journée. */
export const IMAGE_CACHE_SECONDES = 24 * 60 * 60;

const TITRE_MAX = 200;
const DESCRIPTION_MAX = 500;
const SITE_MAX = 100;
/** Garde-fou contre les `<head>` démesurés : au-delà, les expressions régulières travaillent pour rien. */
const HEAD_MAX_CARACTERES = 200_000;

/** Erreur « parlante » : son message est en français et peut être montré tel quel. */
export class ErreurApercu extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ErreurApercu";
  }
}

/* ------------------------------------------------------------------ */
/* 1. Validation de l'URL saisie                                       */
/* ------------------------------------------------------------------ */

/**
 * Domaine public de cette instance, pour un User-Agent honnête (ASCII uniquement : c'est un
 * en-tête). Chaîne vide si `DOMAIN` manque ou n'est pas un nom d'hôte : mieux vaut ne rien dire que
 * d'annoncer le domaine d'un autre club.
 */
function domainePublic(): string {
  const brut = (process.env.DOMAIN ?? "").replace(/^https?:\/\//i, "").replace(/\/.*$/, "").trim();
  return /^[A-Za-z0-9.:-]+$/.test(brut) ? brut : "";
}

/**
 * On dit qui l'on est et pourquoi : aucun site n'est trompé sur l'origine de la requête.
 *
 * Le **nom de l'outil**, jamais celui du club : cet en-tête part chez des tiers, il n'a pas à leur
 * apprendre quel club regarde quel lien, et il doit rester en ASCII quel que soit le nom réglé dans
 * l'écran *Identité* (que `identite()` lit de surcroît en base, là où un en-tête se construit sans
 * attendre). Le domaine, lui, suffit à nous joindre — quand il est connu.
 */
export function userAgent(): string {
  const chez = domainePublic();
  return `${SIGLE_LIVRE}-${SUFFIXE_LIVRE}/1.0 (${chez ? `+https://${chez}; ` : ""}apercu de lien colle par un instructeur)`;
}

export type UrlValidee = { ok: true; url: URL } | { ok: false; erreur: string };

/**
 * Premier filtre, purement syntaxique : `http`/`https` seulement (donc ni `javascript:`, ni `data:`,
 * ni `file:`, ni `ftp:`…), pas d'identifiants glissés dans l'URL, longueur raisonnable.
 */
export function validerUrlSaisie(saisie: string, interdite: (adresse: string) => boolean = estAdresseInterdite): UrlValidee {
  const texte = (saisie ?? "").trim();
  if (!texte) return { ok: false, erreur: "Colle d'abord un lien." };
  if (texte.length > URL_MAX_LONGUEUR) return { ok: false, erreur: "Ce lien est trop long." };
  // Un lien « collé » n'a pas toujours son schéma : on le complète, sans jamais accepter un autre schéma.
  const candidat = /^[a-z][a-z0-9+.-]*:/i.test(texte) ? texte : `https://${texte}`;
  let url: URL;
  try {
    url = new URL(candidat);
  } catch {
    return { ok: false, erreur: "Ce lien n'est pas une adresse valide." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, erreur: "Seuls les liens http:// et https:// sont acceptés." };
  }
  if (url.username || url.password) {
    return { ok: false, erreur: "Ce lien contient un identifiant : retire la partie avant le « @ »." };
  }
  if (!url.hostname) return { ok: false, erreur: "Ce lien n'a pas de nom de site." };
  if (estNomInterdit(url.hostname, interdite)) return { ok: false, erreur: "Ce lien pointe vers le réseau local : refusé." };
  url.hash = "";
  return { ok: true, url };
}

/** Noms qui désignent la machine elle-même ou le réseau interne — refusés avant même le DNS. */
export function estNomInterdit(hostname: string, interdite: (adresse: string) => boolean = estAdresseInterdite): boolean {
  const nom = hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (!nom) return true;
  if (nom === "localhost" || nom.endsWith(".localhost")) return true;
  if (nom.endsWith(".local") || nom.endsWith(".internal") || nom.endsWith(".home.arpa") || nom.endsWith(".lan")) return true;
  // Le nom est déjà une adresse IP littérale : on la juge tout de suite.
  if (analyserIPv4(nom) || analyserIPv6(nom)) return interdite(nom);
  return false;
}

/* ------------------------------------------------------------------ */
/* 2. Jugement d'une adresse IP                                        */
/* ------------------------------------------------------------------ */

/**
 * Analyse une IPv4 sous **toutes** ses écritures acceptées par les résolveurs : pointée
 * (127.0.0.1), décimale (2130706433), octale (0177.0.0.1), hexadécimale (0x7f000001),
 * abrégée (127.1). Renvoie les 4 octets, ou null si ce n'est pas une IPv4.
 */
export function analyserIPv4(texte: string): number[] | null {
  const parts = texte.trim().split(".");
  if (parts.length < 1 || parts.length > 4) return null;
  const nombres: number[] = [];
  for (const p of parts) {
    if (p === "") return null;
    let valeur: number;
    if (/^0[xX][0-9a-fA-F]+$/.test(p)) valeur = parseInt(p.slice(2), 16);
    else if (/^0[0-7]+$/.test(p)) valeur = parseInt(p.slice(1), 8);
    else if (/^[0-9]+$/.test(p)) valeur = parseInt(p, 10);
    else return null;
    if (!Number.isFinite(valeur) || valeur < 0) return null;
    nombres.push(valeur);
  }
  // La dernière partie absorbe les octets manquants (127.1 → 127.0.0.1), comme inet_aton.
  const reste = nombres.pop() as number;
  const maxReste = Math.pow(256, 4 - nombres.length);
  if (reste >= maxReste) return null;
  if (nombres.some((n) => n > 255)) return null;
  const octets = [...nombres];
  for (let i = 4 - nombres.length - 1; i >= 0; i--) octets.push(Math.floor(reste / Math.pow(256, i)) % 256);
  return octets;
}

/** Analyse une IPv6 (compression `::` et queue IPv4 comprises). Renvoie 16 octets, ou null. */
export function analyserIPv6(texte: string): number[] | null {
  let nom = texte.trim().replace(/^\[|\]$/g, "").toLowerCase();
  if (!nom.includes(":")) return null;
  nom = nom.replace(/%[^:]*$/, ""); // identifiant de zone (fe80::1%eth0)
  const morceaux = nom.split("::");
  if (morceaux.length > 2) return null;
  const lire = (partie: string): number[] | null => {
    if (!partie) return [];
    const octets: number[] = [];
    const groupes = partie.split(":");
    for (let i = 0; i < groupes.length; i++) {
      const g = groupes[i];
      if (g.includes(".")) {
        // Queue IPv4 : uniquement en dernière position, et en écriture pointée classique
        if (i !== groupes.length - 1) return null;
        if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(g)) return null;
        const v4 = analyserIPv4(g);
        if (!v4) return null;
        octets.push(...v4);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
      const valeur = parseInt(g, 16);
      octets.push(valeur >> 8, valeur & 0xff);
    }
    return octets;
  };
  const gauche = lire(morceaux[0]);
  const droite = morceaux.length === 2 ? lire(morceaux[1]) : [];
  if (!gauche || !droite) return null;
  if (morceaux.length === 1) return gauche.length === 16 ? gauche : null;
  const manquants = 16 - gauche.length - droite.length;
  if (manquants < 0) return null;
  return [...gauche, ...new Array<number>(manquants).fill(0), ...droite];
}

/** Une IPv4 hors du monde public : privée, bouclage, lien-local, multicast, réservée. */
function ipv4Interdite(o: number[]): boolean {
  const [a, b] = o;
  if (a === 0) return true; // 0.0.0.0/8 (dont 0.0.0.0)
  if (a === 10) return true; // privé
  if (a === 127) return true; // bouclage
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a === 169 && b === 254) return true; // lien-local (métadonnées cloud !)
  if (a === 172 && b >= 16 && b <= 31) return true; // privé 172.16/12
  if (a === 192 && b === 168) return true; // privé
  if (a === 192 && b === 0) return true; // 192.0.0/24 et 192.0.2/24 (documentation)
  if (a === 192 && b === 88) return true; // 192.88.99/24 (relais 6to4)
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18/15 (bancs d'essai)
  if (a === 198 && b === 51) return true; // 198.51.100/24 (documentation)
  if (a === 203 && b === 0) return true; // 203.0.113/24 (documentation)
  if (a >= 224) return true; // multicast 224/4 + réservé 240/4 + diffusion 255.255.255.255
  return false;
}

/**
 * Cette adresse doit-elle être refusée ? **Répond oui par défaut** : tout ce qui n'est pas une
 * adresse publique clairement analysable est rejeté (on ne devine pas, on refuse).
 */
export function estAdresseInterdite(adresse: string): boolean {
  const texte = (adresse ?? "").trim().replace(/^\[|\]$/g, "");
  if (!texte) return true;
  const v4 = analyserIPv4(texte);
  if (v4) return ipv4Interdite(v4);
  const v6 = analyserIPv6(texte);
  if (!v6) return true;
  // ::ffff:127.0.0.1 (IPv4 mappée), ::127.0.0.1 (compatible), 64:ff9b::/96 (NAT64) : c'est une IPv4 déguisée
  const douzeZeros = v6.slice(0, 10).every((x) => x === 0);
  if (douzeZeros && v6[10] === 0xff && v6[11] === 0xff) return ipv4Interdite(v6.slice(12));
  if (douzeZeros && v6[10] === 0 && v6[11] === 0) return true; // :: et ::1 et ::a.b.c.d
  if (v6[0] === 0x00 && v6[1] === 0x64 && v6[2] === 0xff && v6[3] === 0x9b) return ipv4Interdite(v6.slice(12));
  if ((v6[0] & 0xfe) === 0xfc) return true; // fc00::/7 (unique local)
  if (v6[0] === 0xfe && (v6[1] & 0xc0) === 0x80) return true; // fe80::/10 (lien-local)
  if (v6[0] === 0xff) return true; // ff00::/8 (multicast)
  if (v6[0] === 0x20 && v6[1] === 0x02) return true; // 2002::/16 (6to4, encapsule une IPv4 quelconque)
  return false;
}

/* ------------------------------------------------------------------ */
/* 3. Extraction des balises (pure)                                    */
/* ------------------------------------------------------------------ */

const ENTITES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", eacute: "é", egrave: "è", agrave: "à", ccedil: "ç", rsquo: "’", hellip: "…", laquo: "«", raquo: "»" };

/** Décode les entités HTML les plus courantes (nommées et numériques). */
export function decoderEntites(texte: string): string {
  return texte.replace(/&(#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (entier, code: string) => {
    if (code.startsWith("#")) {
      const point = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      if (!Number.isFinite(point) || point <= 0 || point > 0x10ffff) return entier;
      try {
        return String.fromCodePoint(point);
      } catch {
        return entier;
      }
    }
    return ENTITES[code.toLowerCase()] ?? entier;
  });
}

/** Texte de balise → texte affichable : entités décodées, espaces normalisés, longueur plafonnée. */
export function nettoyerTexte(valeur: string | null | undefined, max: number): string | null {
  if (!valeur) return null;
  const propre = decoderEntites(valeur).replace(/\s+/g, " ").trim();
  if (!propre) return null;
  return propre.length > max ? `${propre.slice(0, max - 1).trimEnd()}…` : propre;
}

/** Ne garde que le `<head>` (ou un début borné, si la page n'en referme pas). */
export function limiterAuHead(html: string): string {
  const fin = html.search(/<\/head\s*>/i);
  return fin >= 0 ? html.slice(0, fin) : html.slice(0, HEAD_MAX_CARACTERES);
}

/** Toutes les balises `<meta>` du `<head>`, indexées par `property` ou `name` (première occurrence gagnante). */
export function lireMetas(head: string): Map<string, string> {
  const metas = new Map<string, string>();
  const balises = head.matchAll(/<meta\b([^>]*)>/gi);
  for (const balise of balises) {
    const attributs = new Map<string, string>();
    for (const attr of balise[1].matchAll(/([a-zA-Z0-9:_.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
      attributs.set(attr[1].toLowerCase(), attr[2] ?? attr[3] ?? attr[4] ?? "");
    }
    const cle = (attributs.get("property") ?? attributs.get("name") ?? attributs.get("itemprop") ?? "").trim().toLowerCase();
    const contenu = attributs.get("content");
    if (cle && contenu !== undefined && !metas.has(cle)) metas.set(cle, contenu);
  }
  return metas;
}

/**
 * Résout une URL d'image relative (« /img/a.jpg », « ../a.png », « //cdn/a.png ») contre la page.
 * Refuse tout ce qui n'est pas http/https (pas de `data:`, pas de `javascript:`).
 */
export function resoudreUrlImage(source: string | null | undefined, base: string): string | null {
  const brut = (source ?? "").trim();
  if (!brut) return null;
  try {
    const url = new URL(decoderEntites(brut), base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.href.length > URL_MAX_LONGUEUR) return null;
    return url.href;
  } catch {
    return null;
  }
}

/**
 * Extraction d'aperçu : Open Graph d'abord, puis Twitter Card, puis `<title>` et
 * `<meta name="description">`. Une expression régulière sur le `<head>` suffit ici et évite
 * d'embarquer un analyseur HTML complet (le plafond de taille borne le travail).
 */
export function extraireApercu(html: string, urlFinale: string): ApercuLien {
  const head = limiterAuHead(html);
  const metas = lireMetas(head);
  const baseBalise = head.match(/<base\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i);
  let base = urlFinale;
  const baseCandidate = baseBalise?.[1] ?? baseBalise?.[2] ?? baseBalise?.[3];
  if (baseCandidate) {
    try {
      base = new URL(decoderEntites(baseCandidate.trim()), urlFinale).href;
    } catch {
      base = urlFinale;
    }
  }
  const titreBalise = head.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1] ?? null;
  const image =
    metas.get("og:image") ?? metas.get("og:image:url") ?? metas.get("og:image:secure_url") ?? metas.get("twitter:image") ?? metas.get("twitter:image:src") ?? null;
  let siteNom = nettoyerTexte(metas.get("og:site_name") ?? metas.get("application-name") ?? null, SITE_MAX);
  if (!siteNom) {
    try {
      siteNom = new URL(urlFinale).hostname.replace(/^www\./, "");
    } catch {
      siteNom = null;
    }
  }
  return {
    titre: nettoyerTexte(metas.get("og:title") ?? metas.get("twitter:title") ?? titreBalise, TITRE_MAX),
    description: nettoyerTexte(metas.get("og:description") ?? metas.get("twitter:description") ?? metas.get("description"), DESCRIPTION_MAX),
    image: resoudreUrlImage(image, base),
    siteNom,
    url: urlFinale,
  };
}

/* ------------------------------------------------------------------ */
/* 4. Types de contenu                                                 */
/* ------------------------------------------------------------------ */

export function typeContenuEstHtml(entete: string | null): boolean {
  const type = (entete ?? "").split(";")[0].trim().toLowerCase();
  return type === "text/html" || type === "application/xhtml+xml";
}

/**
 * Images acceptées par la route /api/image. **SVG exclu volontairement** : un SVG est un document
 * qui peut porter du script, et il serait servi depuis notre propre origine.
 */
const IMAGES_AUTORISEES = new Set(["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp", "image/avif", "image/bmp", "image/x-icon", "image/vnd.microsoft.icon"]);

/** Renvoie le type d'image assaini, ou null si ce n'est pas une image que l'on accepte de servir. */
export function typeImageAutorise(entete: string | null): string | null {
  const type = (entete ?? "").split(";")[0].trim().toLowerCase();
  return IMAGES_AUTORISEES.has(type) ? type : null;
}

/* ------------------------------------------------------------------ */
/* 5. Récupération réseau (mince, s'appuie sur tout ce qui précède)    */
/* ------------------------------------------------------------------ */

export type OptionsRecuperation = {
  delaiMs?: number;
  maxOctets?: number;
  maxRedirections?: number;
  /**
   * Politique d'adresse. **Tests unitaires uniquement** (un serveur HTTP local écoute forcément sur
   * une adresse de bouclage) : hors `vitest`, la politique stricte s'impose quoi qu'on passe ici.
   */
  adresseInterdite?: (adresse: string) => boolean;
};

function politique(options: OptionsRecuperation): (adresse: string) => boolean {
  const surcharge = options.adresseInterdite;
  if (surcharge && process.env.VITEST && process.env.NODE_ENV !== "production") return surcharge;
  return estAdresseInterdite;
}

/**
 * Résout le nom **avant** de se connecter et refuse si **la moindre** adresse renvoyée est privée,
 * locale, de bouclage, lien-local, multicast ou réservée.
 */
async function verifierHote(url: URL, interdite: (adresse: string) => boolean): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new ErreurApercu("Seuls les liens http:// et https:// sont acceptés.");
  if (url.username || url.password) throw new ErreurApercu("Ce lien contient un identifiant : refusé.");
  const hote = url.hostname.replace(/^\[|\]$/g, "");
  if (!hote || estNomInterdit(url.hostname, interdite)) throw new ErreurApercu("Ce lien pointe vers le réseau local : refusé.");
  let adresses: { address: string }[];
  try {
    adresses = await lookup(hote, { all: true, verbatim: true });
  } catch {
    throw new ErreurApercu("Ce site est introuvable (nom de domaine inconnu).");
  }
  if (adresses.length === 0) throw new ErreurApercu("Ce site est introuvable (nom de domaine inconnu).");
  if (adresses.some((a) => interdite(a.address))) throw new ErreurApercu("Ce lien pointe vers une adresse du réseau interne : refusé.");
}

/**
 * Suit jusqu'à `maxRedirections` sauts, en revérifiant l'hôte **à chaque saut** (une redirection
 * vers 127.0.0.1 ou 169.254.169.254 est le contournement classique).
 */
async function parcourir(depart: URL, accept: string, options: OptionsRecuperation): Promise<{ reponse: Response; url: URL }> {
  const interdite = politique(options);
  const maxSauts = options.maxRedirections ?? APERCU_MAX_REDIRECTIONS;
  const signal = AbortSignal.timeout(options.delaiMs ?? APERCU_DELAI_MS);
  let url = depart;
  for (let saut = 0; saut <= maxSauts; saut++) {
    await verifierHote(url, interdite);
    let reponse: Response;
    try {
      reponse = await fetch(url, {
        method: "GET",
        redirect: "manual", // on suit nous-mêmes, pour revérifier chaque destination
        signal,
        credentials: "omit", // aucun cookie
        referrerPolicy: "no-referrer",
        headers: { accept, "accept-language": "fr,en;q=0.8", "user-agent": userAgent() },
      });
    } catch (e) {
      if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) throw new ErreurApercu("Ce site met trop de temps à répondre.");
      throw new ErreurApercu("Impossible de joindre ce site.");
    }
    if (reponse.status >= 300 && reponse.status < 400) {
      const cible = reponse.headers.get("location");
      await reponse.body?.cancel().catch(() => {});
      if (!cible) throw new ErreurApercu("Ce site renvoie une redirection incomplète.");
      if (saut === maxSauts) throw new ErreurApercu("Ce lien enchaîne trop de redirections.");
      try {
        url = new URL(cible, url);
      } catch {
        throw new ErreurApercu("Ce site renvoie une redirection invalide.");
      }
      url.hash = "";
      continue;
    }
    if (!reponse.ok) {
      await reponse.body?.cancel().catch(() => {});
      if (reponse.status === 401 || reponse.status === 403) throw new ErreurApercu("Ce lien demande une connexion : son aperçu n'est pas accessible.");
      if (reponse.status === 404) throw new ErreurApercu("Cette page n'existe pas (erreur 404).");
      throw new ErreurApercu(`Ce site a répondu par une erreur (${reponse.status}).`);
    }
    return { reponse, url };
  }
  throw new ErreurApercu("Ce lien enchaîne trop de redirections.");
}

/**
 * Lit le corps en s'arrêtant au plafond : `tronquer` (HTML — le `<head>` est au début) ou refus
 * (image — on ne sert pas un fichier démesuré).
 */
export async function lireCorpsPlafonne(reponse: Response, max: number, tronquer: boolean, quoi: string): Promise<Uint8Array> {
  const declaree = Number(reponse.headers.get("content-length"));
  if (!tronquer && Number.isFinite(declaree) && declaree > max) {
    await reponse.body?.cancel().catch(() => {});
    throw new ErreurApercu(`${quoi} dépasse ${Math.round(max / (1024 * 1024))} Mo : trop volumineux.`);
  }
  const flux = reponse.body;
  if (!flux) return new Uint8Array(0);
  const lecteur = flux.getReader();
  const morceaux: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await lecteur.read();
      if (done) break;
      if (!value) continue;
      morceaux.push(value);
      total += value.byteLength;
      if (total >= max) {
        if (!tronquer) throw new ErreurApercu(`${quoi} dépasse ${Math.round(max / (1024 * 1024))} Mo : trop volumineux.`);
        break;
      }
    }
  } catch (e) {
    if (e instanceof ErreurApercu) throw e;
    if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) throw new ErreurApercu("Ce site met trop de temps à répondre.");
    throw new ErreurApercu("La lecture de ce site a échoué.");
  } finally {
    await lecteur.cancel().catch(() => {});
  }
  const taille = Math.min(total, max);
  const sortie = new Uint8Array(taille);
  let position = 0;
  for (const morceau of morceaux) {
    if (position >= taille) break;
    const n = Math.min(morceau.byteLength, taille - position);
    sortie.set(morceau.subarray(0, n), position);
    position += n;
  }
  return sortie;
}

/** Décode le corps selon le jeu de caractères annoncé (utf-8 par défaut, jamais d'exception). */
function decoderHtml(octets: Uint8Array, typeContenu: string | null): string {
  const jeu = /charset\s*=\s*"?([\w-]+)"?/i.exec(typeContenu ?? "")?.[1]?.toLowerCase() ?? "utf-8";
  try {
    return new TextDecoder(jeu, { fatal: false }).decode(octets);
  } catch {
    return new TextDecoder("utf-8", { fatal: false }).decode(octets);
  }
}

/**
 * Aperçu complet d'un lien public. Lève une `ErreurApercu` (message en français) en cas de refus ;
 * n'expose jamais le détail réseau à l'appelant.
 */
export async function recupererApercu(saisie: string, options: OptionsRecuperation = {}): Promise<ApercuLien> {
  const validee = validerUrlSaisie(saisie, politique(options));
  if (!validee.ok) throw new ErreurApercu(validee.erreur);
  const { reponse, url } = await parcourir(validee.url, "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1", options);
  const typeContenu = reponse.headers.get("content-type");
  if (!typeContenuEstHtml(typeContenu)) {
    await reponse.body?.cancel().catch(() => {});
    throw new ErreurApercu("Ce lien ne mène pas à une page web (aucun aperçu possible).");
  }
  const octets = await lireCorpsPlafonne(reponse, options.maxOctets ?? APERCU_MAX_OCTETS, true, "Cette page");
  const apercu = extraireApercu(decoderHtml(octets, typeContenu), url.href);
  // L'illustration que nous venons de lire devient, pour une heure, une adresse que `/api/image`
  // accepte de rapatrier : c'est le seul moyen d'afficher l'affiche d'un événement **pas encore
  // enregistré** sans rouvrir le relais à toutes les adresses du Web (voir section 6).
  /*
   * **On n'inscrit au registre que ce que le serveur accepterait d'aller chercher**.
   *
   * L'en-tête de la section 6 promet « on n'autorise que ce que le serveur a lu de ses propres yeux ».
   * C'était vrai de `verifierImageCollee`, qui rapatrie l'image avant d'autoriser son adresse ; c'était
   * faux ici : `apercu.image` est l'`og:image` d'une page **contrôlée par un tiers**, et `resoudreUrlImage`
   * ne vérifie que le schéma et la longueur. Une page pouvait donc faire inscrire
   * `http://127.0.0.1:9200/…` au registre — pour une heure, pour tout le processus et pour **tout
   * utilisateur connecté**, le registre n'ayant pas de notion de propriétaire.
   *
   * Rien ne fuyait : `recupererImage` refuse une adresse privée en aval, et c'est bien ce qui rattrapait
   * la situation. Mais la défense en profondeur était perdue, et l'invariant écrit juste au-dessus était
   * faux. On passe donc l'adresse par la même validation que celle d'une saisie.
   */
  if (apercu.image && validerUrlSaisie(apercu.image).ok) autoriserImageApercu(apercu.image);
  return apercu;
}

/* ------------------------------------------------------------------ */
/* 6. Registre des images que le serveur a lui-même proposées           */
/* ------------------------------------------------------------------ */

/**
 * **Le relais `/api/image` ne va chercher que des adresses que le serveur connaît déjà.** Deux
 * sources, et deux seulement : l'affiche d'un événement **enregistré** (`Evenement.imageUrl`, lue en
 * base par la route), et l'illustration qu'un aperçu de lien vient tout juste de proposer —
 * celle-ci, qui n'est encore écrite nulle part, est retenue ici.
 *
 * **Pourquoi ce registre existe** : la route acceptait n'importe quelle URL publique, sur n'importe
 * quel port, 300 fois par quart d'heure, pour **n'importe quel membre** — une session s'ouvre par
 * simple lien personnel, sans mot de passe. Le réseau interne, lui, était bien fermé (adresses
 * privées, bouclage, lien-local, CGNAT, NAT64, 6to4, revérifiées à chaque saut) : ce qui était en
 * jeu n'était pas une brèche mais **la réputation de l'adresse IP du club**, qui partait sonder des
 * hôtes et des ports avec un `User-Agent` nommant son domaine. Un balayage mené depuis chez nous se
 * lit comme un balayage de chez nous.
 *
 * **Le registre vit en mémoire du processus**, volontairement : c'est un sas de quelques minutes
 * entre « je colle un lien » et « j'enregistre l'événement », pas une donnée. Redémarrage, second
 * processus : au pire l'aperçu de l'affiche **pas encore enregistrée** ne s'affiche plus dans le
 * formulaire (l'écran a déjà son repli, et le champ d'adresse reste rempli) ; une affiche
 * enregistrée, elle, passe par la base et ne dépend pas de ceci.
 *
 * **Deux fonctions y écrivent, et ce qu'elles ont en commun est l'invariant** : `recupererApercu`,
 * qui a lu l'illustration dans le `<head>` d'une page publique, et `verifierImageCollee`
 * (`src/actions/liens.ts`), qui a rapatrié l'image elle-même pour une adresse collée à la main. Aucun
 * appelant n'inscrit une adresse qu'il n'a fait que recevoir : **on n'autorise que ce que le serveur
 * a lu de ses propres yeux**, et c'est ce qui empêche le registre de redevenir la porte ouverte que
 * la liste blanche vient de fermer.
 */
export const IMAGE_APERCU_TTL_MS = 60 * 60 * 1000;
/** Plafond du registre : au-delà, les plus anciennes sortent (il borne la mémoire, rien d'autre). */
const IMAGE_APERCU_MAX = 500;
const imagesProposees = new Map<string, number>();

function purgerImagesApercu(maintenant: number): void {
  for (const [url, echeance] of imagesProposees) {
    if (echeance <= maintenant) imagesProposees.delete(url);
  }
  // `Map` garde l'ordre d'insertion : la plus ancienne est la première.
  while (imagesProposees.size > IMAGE_APERCU_MAX) {
    const plusAncienne = imagesProposees.keys().next();
    if (plusAncienne.done) break;
    imagesProposees.delete(plusAncienne.value);
  }
}

/** Retient une illustration que le serveur vient de lire dans le `<head>` d'une page publique. */
export function autoriserImageApercu(url: string, maintenant: number = Date.now()): void {
  const propre = (url ?? "").trim();
  if (!propre || propre.length > URL_MAX_LONGUEUR) return;
  imagesProposees.delete(propre); // réinsertion : l'ordre d'insertion reste l'ordre d'ancienneté
  imagesProposees.set(propre, maintenant + IMAGE_APERCU_TTL_MS);
  purgerImagesApercu(maintenant);
}

/** Cette adresse est-elle une illustration que le serveur a proposée il y a peu ? */
export function imageApercuAutorisee(url: string, maintenant: number = Date.now()): boolean {
  const echeance = imagesProposees.get((url ?? "").trim());
  if (echeance === undefined) return false;
  if (echeance <= maintenant) {
    imagesProposees.delete((url ?? "").trim());
    return false;
  }
  return true;
}

/** Vide le registre. **Tests uniquement** : en production il ne se vide qu'en vieillissant. */
export function oublierImagesApercu(): void {
  imagesProposees.clear();
}

/** Image distante, rapatriée pour être servie depuis l'application (route /api/image). */
export async function recupererImage(saisie: string, options: OptionsRecuperation = {}): Promise<{ octets: Uint8Array; typeContenu: string }> {
  const validee = validerUrlSaisie(saisie, politique(options));
  if (!validee.ok) throw new ErreurApercu(validee.erreur);
  const { reponse } = await parcourir(validee.url, "image/*", options);
  const typeContenu = typeImageAutorise(reponse.headers.get("content-type"));
  if (!typeContenu) {
    await reponse.body?.cancel().catch(() => {});
    throw new ErreurApercu("Ce lien ne mène pas à une image acceptée.");
  }
  const octets = await lireCorpsPlafonne(reponse, options.maxOctets ?? IMAGE_MAX_OCTETS, false, "Cette image");
  if (octets.byteLength === 0) throw new ErreurApercu("Cette image est vide.");
  return { octets, typeContenu };
}
