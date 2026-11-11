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
] as const;

export const TRIS_AUDIT = { recent: "Plus récent d'abord", ancien: "Plus ancien d'abord", personne: "Par personne" } as const;
export type TriAudit = keyof typeof TRIS_AUDIT;

export type FiltresAudit = { q: string; du: string; au: string; personne: string; tri: TriAudit };

const dateValide = (v?: string | null) => (v && isIsoDate(v) ? v : "");
const identifiantValide = (v?: string | null) => (v && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : "");

/** Normalise ce que dit l'adresse : une valeur illisible est ignorée, jamais une erreur. */
export function lireFiltresAudit(brut: { q?: string | null; du?: string | null; au?: string | null; personne?: string | null; tri?: string | null }): FiltresAudit {
  const tri = brut.tri && brut.tri in TRIS_AUDIT ? (brut.tri as TriAudit) : "recent";
  return { q: (brut.q ?? "").slice(0, 200), du: dateValide(brut.du), au: dateValide(brut.au), personne: identifiantValide(brut.personne), tri };
}

export function whereAudit(f: FiltresAudit): Prisma.AuditLogWhereInput {
  const famille = RACCOURCIS_AUDIT.find((r) => r.q === f.q);
  const et: Prisma.AuditLogWhereInput[] = [];
  if (f.q) {
    et.push(
      famille
        ? { OR: famille.prefixes.map((prefixe) => ({ action: { startsWith: prefixe } })) }
        : { OR: [{ action: { contains: f.q } }, { acteurEmail: { contains: f.q } }, { cible: { contains: f.q } }] },
    );
  }
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
  return new URLSearchParams(Object.entries(tout).filter(([k, v]) => v !== "" && !(k === "tri" && v === "recent")));
}
