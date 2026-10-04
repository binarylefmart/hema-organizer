import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/current-user";
import { db } from "@/lib/db";
import { formatDateHeure } from "@/lib/dates";
import { getRetentionAuditJours } from "@/lib/alertes";
import { Carte } from "@/components/ui/Carte";
import { LienBouton } from "@/components/ui/Bouton";
import { Cellule, Ligne, Tableau } from "@/components/ui/Tableau";
import { isIsoDate } from "@/lib/dates";

export const metadata: Metadata = { title: "Journal d'audit" };

const PAR_PAGE = 50;
type Props = { searchParams: Promise<{ page?: string; q?: string; du?: string; au?: string }> };

/**
 * **La forme ne suffit pas, il faut que la date existe**. `^\d{4}-\d{2}-\d{2}$` accepte
 * `2026-13-45`, dont `new Date` fait un `Invalid Date` que Prisma refuse : l'écran rendait une 500
 * au lieu d'ignorer un filtre qu'on ne peut pas lire. Même correctif, même validateur que l'export
 * CSV.
 */
const dateValide = (v?: string) => (v && isIsoDate(v) ? v : "");

/**
 * Raccourcis : chacun désigne une famille d'actions, pas un mot à chercher partout.
 * `prefixes` liste les débuts d'action de la famille (le 2FA en a deux : les actions de la personne
 * et celles de l'administration). Filtrer en préfixe suit l'index AuditLog(action, date) au lieu de
 * balayer trois colonnes de texte sur des dizaines de milliers de lignes ; les entrées affichées
 * sont exactement les mêmes. L'URL ne change pas (même paramètre `q`) : champ de recherche,
 * pagination et export CSV restent identiques.
 */
const RACCOURCIS = [
  // Toute la famille `planning.` : la case remplie, mais aussi les parties ajoutées, renommées,
  // retirées ou déplacées — un filtre « planning » qui ne montrerait pas qui a retiré une partie
  // laisserait justement hors du journal le geste qui efface quelque chose.
  { q: "planning.", label: "planning", prefixes: ["planning."] },
  { q: "invitation.", label: "liens", prefixes: ["invitation."] },
  { q: "connexion.", label: "connexions", prefixes: ["connexion."] },
  { q: "deux_fa", label: "2FA", prefixes: ["deux_fa", "admin.deux_fa"] },
] as const;

const raccourci = (q: string) => RACCOURCIS.find((r) => r.q === q);

export default async function PageAudit({ searchParams }: Props) {
  await requirePermission("audit.view");
  const { page = "1", q = "", du: duBrut, au: auBrut } = await searchParams;
  const du = dateValide(duBrut);
  const au = dateValide(auBrut);
  const p = Math.max(1, Number(page) || 1);
  const famille = raccourci(q);
  const where = {
    ...(q
      ? famille
        ? { OR: famille.prefixes.map((prefixe) => ({ action: { startsWith: prefixe } })) }
        : { OR: [{ action: { contains: q } }, { acteurEmail: { contains: q } }, { cible: { contains: q } }] }
      : {}),
    ...(du || au ? { date: { ...(du ? { gte: new Date(`${du}T00:00:00Z`) } : {}), ...(au ? { lte: new Date(`${au}T23:59:59Z`) } : {}) } } : {}),
  };
  const retention = await getRetentionAuditJours();
  // Les filtres qu'on reconduit d'une adresse à l'autre (export CSV, pagination) : seuls ceux qui
  // sont remplis y entrent. Sans ce tri, chaque lien traînait un « q=&du=&au= » sans objet, et la
  // pagination fabriquait des adresses terminées par « & » le jour où la chaîne serait vide.
  const params = new URLSearchParams(Object.entries({ q, du, au }).filter(([, v]) => v !== "")).toString();
  const avecFiltres = (chemin: string) => (params ? `${chemin}${chemin.includes("?") ? "&" : "?"}${params}` : chemin);
  const [total, lignes] = await Promise.all([
    db.auditLog.count({ where }),
    db.auditLog.findMany({ where, orderBy: { date: "desc" }, skip: (p - 1) * PAR_PAGE, take: PAR_PAGE }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAR_PAGE));
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-3xl">Journal d&apos;audit</h1>
        <p className="text-texte-secondaire">
          {total} entrée{total > 1 ? "s" : ""} · conservées {retention} jours
        </p>
      </div>
      <Carte>
        <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
          <input key={`q-${q}`} type="search" name="q" defaultValue={q} placeholder="Filtrer (action, email, cible)" className="min-h-12 min-w-56 flex-1 rounded-xl border-2 border-bordure bg-surface px-4" aria-label="Filtrer" />
          <label className="flex flex-col text-sm">
            Du
            <input key={`du-${du}`} type="date" name="du" defaultValue={du} className="min-h-12 rounded-xl border-2 border-bordure bg-surface px-3" />
          </label>
          <label className="flex flex-col text-sm">
            Au
            <input key={`au-${au}`} type="date" name="au" defaultValue={au} className="min-h-12 rounded-xl border-2 border-bordure bg-surface px-3" />
          </label>
          <button type="submit" className="min-h-12 rounded-xl border-2 border-bordure bg-surface px-5 font-semibold">
            Filtrer
          </button>
          <a href={avecFiltres("/api/export/audit")} className="min-h-12 inline-flex items-center rounded-xl border-2 border-bordure bg-surface px-5 font-semibold no-underline" download>
            Exporter en CSV
          </a>
        </form>
        {/* Raccourcis : des puces tapables (≥ 44 px), pas des mots perdus dans une phrase */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-sm text-texte-secondaire">Raccourcis :</span>
          {RACCOURCIS.map((r) => (
            <Link
              key={r.q}
              href={`/admin/audit?q=${encodeURIComponent(r.q)}`}
              className="flex min-h-12 items-center rounded-full border-2 border-bordure bg-surface px-4 text-sm font-semibold text-texte no-underline"
            >
              {r.label}
            </Link>
          ))}
        </div>
        <Tableau entetes={["Date", "Acteur", "Action", "Cible", "Détails", "IP"]} vide={lignes.length === 0 && <p className="p-4 text-texte-secondaire">Aucune entrée.</p>}>
          {lignes.map((l) => (
            <Ligne key={l.id}>
              <Cellule className="whitespace-nowrap text-sm">{formatDateHeure(l.date)}</Cellule>
              <Cellule label="Acteur" className="text-sm">{l.acteurEmail}</Cellule>
              <Cellule label="Action">
                <code className="text-sm">{l.action}</code>
              </Cellule>
              {/* Sur téléphone la valeur revient à la ligne (rien de coupé) ; sur PC elle reste sur une ligne */}
              <Cellule label="Cible" className="break-all text-sm md:max-w-40 md:truncate lg:max-w-none lg:whitespace-normal" title={l.cible ?? ""}>{l.cible ?? "—"}</Cellule>
              <Cellule label="Détails" className="break-all text-sm text-texte-secondaire md:max-w-72 md:truncate lg:max-w-none lg:whitespace-normal" title={l.details ?? ""}>{l.details ?? "—"}</Cellule>
              <Cellule label="IP" className="text-sm">{l.ip ?? "—"}</Cellule>
            </Ligne>
          ))}
        </Tableau>
        {pages > 1 && (
          <div className="mt-3 flex items-center justify-between gap-2 text-sm">
            <span>
              {p > 1 && (
                <LienBouton href={avecFiltres(`/admin/audit?page=${p - 1}`)} variante="secondaire" taille="petite">
                  ← Plus récent
                </LienBouton>
              )}
            </span>
            <span className="text-texte-secondaire">
              Page {p} / {pages}
            </span>
            <span>
              {p < pages && (
                <LienBouton href={avecFiltres(`/admin/audit?page=${p + 1}`)} variante="secondaire" taille="petite">
                  Plus ancien →
                </LienBouton>
              )}
            </span>
          </div>
        )}
      </Carte>
    </div>
  );
}
