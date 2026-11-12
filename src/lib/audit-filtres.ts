import type { Prisma } from "@prisma/client";
import { isIsoDate } from "@/lib/dates";

/**
 * **Les filtres et le tri du journal d'audit**, lus une seule fois pour l'écran et pour l'export CSV
 * (demande de Delta : « trier les logs par user et/ou par date »). L'export appliquait
 * jusqu'ici un filtre à lui (sans les raccourcis) : deux lectures d'une même adresse finissent toujours
 * par ne plus rendre les mêmes lignes.
 */

/**
 * Raccourcis : chacun désigne une famille d'actions, pas un mot à chercher partout. Filtrer en préfixe
 * suit l'index AuditLog(action, date) au lieu de balayer trois colonnes de texte.
 */
export const RACCOURCIS_AUDIT = [
  // Toute la famille `planning.` : la case remplie, mais aussi les parties ajoutées, renommées,
  // retirées ou déplacées.
  { q: "planning.", label: "programme", prefixes: ["planning."] },
  { q: "invitation.", label: "liens", prefixes: ["invitation."] },
  { q: "connexion.", label: "connexions", prefixes: ["connexion."] },
  { q: "deux_fa", label: "2FA", prefixes: ["deux_fa", "admin.deux_fa"] },
  // Réponses aux séances : chaque changement, horodaté, et les corrections du bureau.
  { q: "presence.", label: "présences", prefixes: ["presence."] },
  { q: "presence.desistement", label: "désistements", prefixes: ["presence.desistement"] },
  { q: "presence.desistement_derniere_minute", label: "désistements de dernière minute", prefixes: ["presence.desistement_derniere_minute"] },
  // Les retraits avant le délai d'alerte : comptés nulle part, visibles ici seulement.
  { q: "presence.desistement_anticipe", label: "désistements anticipés", prefixes: ["presence.desistement_anticipe"] },
  // Les alertes envoyées aux instructeurs (et celles qui n'ont pas été remises), les deux fenêtres.
  { q: "notification.desistement", label: "alertes de désistement", prefixes: ["notification.desistement"] },
] as const;

export const TRIS_AUDIT = { recent: "Plus récent d'abord", ancien: "Plus ancien d'abord", personne: "Par personne" } as const;
export type TriAudit = keyof typeof TRIS_AUDIT;

export type FiltresAudit = {
  /** Texte libre (mot, adresse, code d'action) */
  q: string;
  du: string;
  au: string;
  personne: string;
  tri: TriAudit;
  /** **Plusieurs familles à la fois** : les clés (`q`) des raccourcis cochés, dans l'ordre de la liste */
  types: string[];
  /** Un cours précis : tout ce qui le cite (en cible, ou dans le détail) */
  seance: string;
  /** Une adresse IP, ou son début (« 192.168. ») */
  ip: string;
};

type BrutAudit = { q?: string | null; du?: string | null; au?: string | null; personne?: string | null; tri?: string | null; types?: string | null; seance?: string | null; ip?: string | null };

const dateValide = (v?: string | null) => (v && isIsoDate(v) ? v : "");
const identifiantValide = (v?: string | null) => (v && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : "");

/** Normalise ce que dit l'adresse : une valeur illisible est ignorée, jamais une erreur. */
export function lireFiltresAudit(brut: BrutAudit): FiltresAudit {
  const tri = brut.tri && brut.tri in TRIS_AUDIT ? (brut.tri as TriAudit) : "recent";
  const connus = RACCOURCIS_AUDIT.map((r) => r.q as string);
  const demandes = new Set((brut.types ?? "").split(",").map((t) => t.trim()));
  let q = (brut.q ?? "").slice(0, 200);
  // Un ancien lien `?q=presence.` désignait une famille : il devient une case cochée.
  if (connus.includes(q)) {
    demandes.add(q);
    q = "";
  }
  return {
    q,
    du: dateValide(brut.du),
    au: dateValide(brut.au),
    personne: identifiantValide(brut.personne),
    tri,
    types: connus.filter((c) => demandes.has(c)),
    seance: identifiantValide(brut.seance),
    // Chiffres, lettres hexadécimales, points et deux-points : IPv4 comme IPv6, rien d'autre.
    ip: brut.ip && /^[0-9a-fA-F.:]{1,45}$/.test(brut.ip.trim()) ? brut.ip.trim() : "",
  };
}

/** Ces paramètres, lus depuis une adresse (écran et export CSV). */
export function lireFiltresAuditDepuis(p: URLSearchParams): FiltresAudit {
  return lireFiltresAudit({ q: p.get("q"), du: p.get("du"), au: p.get("au"), personne: p.get("personne"), tri: p.get("tri"), types: p.get("types"), seance: p.get("seance"), ip: p.get("ip") });
}

export function whereAudit(f: FiltresAudit): Prisma.AuditLogWhereInput {
  const et: Prisma.AuditLogWhereInput[] = [];
  if (f.q) et.push({ OR: [{ action: { contains: f.q } }, { acteurEmail: { contains: f.q } }, { cible: { contains: f.q } }] });
  // Plusieurs familles : une entrée qui appartient à **l'une** d'elles (filtrer en préfixe suit l'index).
  const prefixes = RACCOURCIS_AUDIT.filter((r) => f.types.includes(r.q)).flatMap((r) => r.prefixes);
  if (prefixes.length > 0) et.push({ OR: prefixes.map((prefixe) => ({ action: { startsWith: prefixe } })) });
  // Un cours : il est la cible (programme, annulation, modification) ou il est cité dans le détail
  // (réponses, désistements, « pas venu », alertes envoyées) sous la forme `"sessionId":"<id>"`.
  if (f.seance) et.push({ OR: [{ cible: f.seance }, { details: { contains: `"sessionId":"${f.seance}"` } }] });
  if (f.ip) et.push({ ip: { startsWith: f.ip } });
  // **Une personne** : ce qu'elle a fait, et ce qu'on a fait à son compte (sa réponse corrigée, son
  // lien renvoyé…) — c'est la question qu'on pose en choisissant un nom.
  if (f.personne) et.push({ OR: [{ acteurId: f.personne }, { cible: f.personne }] });
  if (f.du || f.au) et.push({ date: { ...(f.du ? { gte: new Date(`${f.du}T00:00:00Z`) } : {}), ...(f.au ? { lte: new Date(`${f.au}T23:59:59Z`) } : {}) } });
  return et.length ? { AND: et } : {};
}

export function orderByAudit(tri: TriAudit): Prisma.AuditLogOrderByWithRelationInput[] {
  if (tri === "ancien") return [{ date: "asc" }];
  // Par personne : regroupé sur l'adresse de l'acteur, figée dans chaque ligne — elle existe aussi pour
  // un compte supprimé ou sans nom (trier sur le nom les faisait remonter en tête) —, le plus récent d'abord.
  if (tri === "personne") return [{ acteurEmail: "asc" }, { date: "desc" }];
  return [{ date: "desc" }];
}

/** Les paramètres remplis, pour reconduire les filtres d'une adresse à l'autre (pagination, export, tri). */
export function paramsAudit(f: FiltresAudit, changes: Partial<FiltresAudit> = {}): URLSearchParams {
  const tout = { ...f, ...changes };
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(tout)) {
    if (k === "types") {
      if ((v as string[]).length > 0) p.set("types", (v as string[]).join(","));
      continue;
    }
    if (v === "" || (k === "tri" && v === "recent")) continue;
    p.set(k, String(v));
  }
  return p;
}

/** Coche ou décoche une famille, en gardant l'ordre de la liste. */
export function basculerType(types: readonly string[], q: string): string[] {
  const ensemble = new Set(types);
  if (ensemble.has(q)) ensemble.delete(q);
  else ensemble.add(q);
  return RACCOURCIS_AUDIT.map((r) => r.q as string).filter((c) => ensemble.has(c));
}
