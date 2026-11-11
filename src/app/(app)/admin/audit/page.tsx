import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/current-user";
import { db } from "@/lib/db";
import { formatHorodatage } from "@/lib/dates";
import { getRetentionAuditJours } from "@/lib/alertes";
import { Carte } from "@/components/ui/Carte";
import { LienBouton } from "@/components/ui/Bouton";
import { Cellule, Ligne, Tableau } from "@/components/ui/Tableau";
import { ChampListe } from "@/components/ui/ChampListe";
import { lireFiltresAudit, orderByAudit, paramsAudit, RACCOURCIS_AUDIT, TRIS_AUDIT, whereAudit, type TriAudit } from "@/lib/audit-filtres";

export const metadata: Metadata = { title: "Journal d'audit" };

const PAR_PAGE = 50;
type Props = { searchParams: Promise<{ page?: string; q?: string; du?: string; au?: string; personne?: string; tri?: string }> };

const CLASSES_PUCE = "flex min-h-12 items-center rounded-full border-2 px-4 text-sm font-semibold no-underline";

/**
 * **Journal d'audit** : filtres (texte, raccourcis, personne, dates) et tri (date dans les deux sens,
 * ou par personne). Filtres et tri sont lus par `lireFiltresAudit`, le même lecteur que l'export CSV.
 * Une date ou une personne illisible est ignorée : l'écran ne rend jamais une 500 pour une adresse.
 */
export default async function PageAudit({ searchParams }: Props) {
  await requirePermission("audit.view");
  const brut = await searchParams;
  const f = lireFiltresAudit(brut);
  const p = Math.max(1, Number(brut.page) || 1);
  const where = whereAudit(f);
  const lien = (changes: Parameters<typeof paramsAudit>[1] = {}, page?: number) => {
    const params = paramsAudit(f, changes);
    if (page && page > 1) params.set("page", String(page));
    const suite = params.toString();
    return `/admin/audit${suite ? `?${suite}` : ""}`;
  };
  const exportParams = paramsAudit(f).toString();
  const [retention, total, lignes, personnes] = await Promise.all([
    getRetentionAuditJours(),
    db.auditLog.count({ where }),
    db.auditLog.findMany({ where, orderBy: orderByAudit(f.tri), skip: (p - 1) * PAR_PAGE, take: PAR_PAGE, include: { acteur: { select: { prenom: true, nom: true } } } }),
    db.user.findMany({ select: { id: true, prenom: true, nom: true, email: true }, orderBy: [{ nom: "asc" }, { prenom: "asc" }] }),
  ]);
  const nomDe = new Map(personnes.map((u) => [u.id, `${u.prenom} ${u.nom}`.trim() || (u.email ?? u.id)]));
  const pages = Math.max(1, Math.ceil(total / PAR_PAGE));
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-3xl">Journal d&apos;audit</h1>
        <p className="text-texte-secondaire">
          {total}&nbsp;entrée{total > 1 ? "s" : ""}&nbsp;· conservées {retention}&nbsp;jours
        </p>
      </div>
      <Carte>
        <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
          <input key={`q-${f.q}`} type="search" name="q" defaultValue={f.q} placeholder="Filtrer (action, email, cible)" className="min-h-12 min-w-56 flex-1 rounded-xl border-2 border-bordure bg-surface px-4" aria-label="Filtrer" />
          <div className="min-w-56">
            <ChampListe
              key={`personne-${f.personne}`}
              label="Personne"
              name="personne"
              valeur={f.personne}
              entrees={[{ valeur: "", libelle: "Tout le monde" }, ...personnes.map((u) => ({ valeur: u.id, libelle: nomDe.get(u.id) ?? u.id }))]}
            />
          </div>
          <label className="flex flex-col text-sm">
            Du
            <input key={`du-${f.du}`} type="date" name="du" defaultValue={f.du} className="min-h-12 rounded-xl border-2 border-bordure bg-surface px-3" />
          </label>
          <label className="flex flex-col text-sm">
            Au
            <input key={`au-${f.au}`} type="date" name="au" defaultValue={f.au} className="min-h-12 rounded-xl border-2 border-bordure bg-surface px-3" />
          </label>
          {f.tri !== "recent" && <input type="hidden" name="tri" value={f.tri} />}
          <button type="submit" className="min-h-12 rounded-xl border-2 border-bordure bg-surface px-5 font-semibold">
            Filtrer
          </button>
          <a href={`/api/export/audit${exportParams ? `?${exportParams}` : ""}`} className="min-h-12 inline-flex items-center rounded-xl border-2 border-bordure bg-surface px-5 font-semibold no-underline" download>
            Exporter en CSV
          </a>
        </form>
        {/* Raccourcis : des puces tapables (≥ 44 px), pas des mots perdus dans une phrase */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-sm text-texte-secondaire">Raccourcis :</span>
          {RACCOURCIS_AUDIT.map((r) => (
            <Link key={r.q} href={lien({ q: r.q }) } className={`${CLASSES_PUCE} ${f.q === r.q ? "border-primaire bg-primaire text-primaire-texte" : "border-bordure bg-surface text-texte"}`}>
              {r.label}
            </Link>
          ))}
        </div>
        {/* Le tri, en puces comme au tableau de bord : il garde les filtres et repart page 1. */}
        <nav aria-label="Trier le journal" className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-sm text-texte-secondaire">Trier :</span>
          {(Object.keys(TRIS_AUDIT) as TriAudit[]).map((t) => (
            <Link
              key={t}
              href={lien({ tri: t })}
              aria-current={f.tri === t ? "true" : undefined}
              className={`${CLASSES_PUCE} ${f.tri === t ? "border-primaire bg-primaire text-primaire-texte" : "border-bordure bg-surface text-texte"}`}
            >
              {TRIS_AUDIT[t]}
            </Link>
          ))}
          {(f.q || f.personne || f.du || f.au || f.tri !== "recent") && (
            <Link href="/admin/audit" className="inline-flex min-h-12 items-center text-sm">
              Tout effacer
            </Link>
          )}
        </nav>
        <Tableau entetes={["Date", "Acteur", "Action", "Cible", "Détails", "IP"]} vide={lignes.length === 0 && <p className="p-4 text-texte-secondaire">Aucune entrée.</p>}>
          {lignes.map((l) => {
            const acteurNom = l.acteur ? `${l.acteur.prenom} ${l.acteur.nom}`.trim() : null;
            const cibleNom = l.cible ? nomDe.get(l.cible) : undefined;
            return (
              <Ligne key={l.id}>
                <Cellule className="whitespace-nowrap text-sm tabular-nums">{formatHorodatage(l.date)}</Cellule>
                <Cellule label="Acteur" className="text-sm">
                  {acteurNom && l.acteurId ? (
                    <Link href={lien({ personne: l.acteurId })} title="Ne voir que cette personne" className="font-semibold">
                      {acteurNom}
                    </Link>
                  ) : null}
                  <span className={acteurNom ? "block text-texte-secondaire" : ""}>{l.acteurEmail}</span>
                </Cellule>
                <Cellule label="Action">
                  <code className="text-sm">{l.action}</code>
                </Cellule>
                {/* Sur téléphone la valeur revient à la ligne (rien de coupé) ; sur PC elle reste sur une ligne */}
                <Cellule label="Cible" className="break-all text-sm md:max-w-40 md:truncate lg:max-w-none lg:whitespace-normal" title={l.cible ?? ""}>
                  {cibleNom && l.cible ? (
                    <Link href={lien({ personne: l.cible })} title="Ne voir que cette personne">
                      {cibleNom}
                    </Link>
                  ) : (
                    (l.cible ?? "—")
                  )}
                </Cellule>
                <Cellule label="Détails" className="break-all text-sm text-texte-secondaire md:max-w-72 md:truncate lg:max-w-none lg:whitespace-normal" title={l.details ?? ""}>{l.details ?? "—"}</Cellule>
                <Cellule label="IP" className="text-sm">{l.ip ?? "—"}</Cellule>
              </Ligne>
            );
          })}
        </Tableau>
        {pages > 1 && (
          <div className="mt-3 flex items-center justify-between gap-2 text-sm">
            <span>
              {p > 1 && (
                <LienBouton href={lien({}, p - 1)} variante="secondaire" taille="petite">
                  {f.tri === "recent" ? "← Plus récent" : f.tri === "ancien" ? "← Plus ancien" : "← Précédent"}
                </LienBouton>
              )}
            </span>
            <span className="text-texte-secondaire">
              Page {p} / {pages}
            </span>
            <span>
              {p < pages && (
                <LienBouton href={lien({}, p + 1)} variante="secondaire" taille="petite">
                  {f.tri === "recent" ? "Plus ancien →" : f.tri === "ancien" ? "Plus récent →" : "Suivant →"}
                </LienBouton>
              )}
            </span>
          </div>
        )}
      </Carte>
    </div>
  );
}
