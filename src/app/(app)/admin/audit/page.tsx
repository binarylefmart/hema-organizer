import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/current-user";
import { db } from "@/lib/db";
import { formatDateLongue, formatHorodatage, todayIso } from "@/lib/dates";
import {
  detailsLisibles,
  libelleAction,
  tonAction,
} from "@/lib/audit-libelles";
import { Pastille } from "@/components/ui/Pastille";
import { getRetentionAuditJours } from "@/lib/alertes";
import { Carte } from "@/components/ui/Carte";
import { LienBouton } from "@/components/ui/Bouton";
import { ChampListe } from "@/components/ui/ChampListe";
import {
  lireFiltresAudit,
  orderByAudit,
  paramsAudit,
  RACCOURCIS_AUDIT,
  TRIS_AUDIT,
  whereAudit,
  type TriAudit,
} from "@/lib/audit-filtres";

export const metadata: Metadata = { title: "Journal d'audit" };

const PAR_PAGE = 50;
type Props = {
  searchParams: Promise<{
    page?: string;
    q?: string;
    du?: string;
    au?: string;
    personne?: string;
    tri?: string;
  }>;
};

const CLASSES_PUCE =
  "flex min-h-12 items-center rounded-full border-2 px-4 text-sm font-semibold no-underline";

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
  const lien = (
    changes: Parameters<typeof paramsAudit>[1] = {},
    page?: number,
  ) => {
    const params = paramsAudit(f, changes);
    if (page && page > 1) params.set("page", String(page));
    const suite = params.toString();
    return `/admin/audit${suite ? `?${suite}` : ""}`;
  };
  const exportParams = paramsAudit(f).toString();
  const [retention, total, lignes, personnes] = await Promise.all([
    getRetentionAuditJours(),
    db.auditLog.count({ where }),
    db.auditLog.findMany({
      where,
      orderBy: orderByAudit(f.tri),
      skip: (p - 1) * PAR_PAGE,
      take: PAR_PAGE,
      include: { acteur: { select: { prenom: true, nom: true } } },
    }),
    db.user.findMany({
      select: { id: true, prenom: true, nom: true, email: true },
      orderBy: [{ nom: "asc" }, { prenom: "asc" }],
    }),
  ]);
  const nomDe = new Map(
    personnes.map((u) => [
      u.id,
      `${u.prenom} ${u.nom}`.trim() || (u.email ?? u.id),
    ]),
  );
  const pages = Math.max(1, Math.ceil(total / PAR_PAGE));
  // La date des séances citées dans les détails (corrections du bureau) : une seule lecture pour la page.
  const idsSeances = [
    ...new Set(
      lignes.flatMap((l) =>
        l.details
          ? [...l.details.matchAll(/"sessionId":"([^"]+)"/g)].map((m) => m[1])
          : [],
      ),
    ),
  ];
  const seances = new Map(
    (idsSeances.length
      ? await db.session.findMany({
          where: { id: { in: idsSeances } },
          select: { id: true, date: true, heureDebut: true },
        })
      : []
    ).map((x) => [x.id, x]),
  );
  // **Des groupes** : par jour quand on trie par date, par personne quand on trie par personne.
  const parPersonne = f.tri === "personne";
  const groupes: Array<{ cle: string; titre: string; lignes: typeof lignes }> =
    [];
  for (const l of lignes) {
    const cle = parPersonne ? l.acteurEmail : todayIso(l.date);
    const dernier = groupes.at(-1);
    if (dernier && dernier.cle === cle) dernier.lignes.push(l);
    else
      groupes.push({
        cle,
        titre: parPersonne
          ? l.acteur
            ? `${l.acteur.prenom} ${l.acteur.nom}`.trim() || l.acteurEmail
            : l.acteurEmail
          : formatDateLongue(cle),
        lignes: [l],
      });
  }
  const filtresActifs = Boolean(
    f.q || f.personne || f.du || f.au || f.tri !== "recent",
  );
  const puce = (actif: boolean) =>
    `${CLASSES_PUCE} ${actif ? "border-primaire bg-primaire text-primaire-texte" : "border-bordure bg-surface text-texte hover:bg-surface-douce"}`;
  const controle =
    "min-h-12 w-full rounded-xl border-2 border-bordure bg-surface px-3 text-base";
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-3xl">Journal d&apos;audit</h1>
        <p className="text-texte-secondaire">
          {total}&nbsp;entrée{total > 1 ? "s" : ""}
          {filtresActifs ? " pour ces filtres" : ""}&nbsp;· conservées{" "}
          {retention}&nbsp;jours · heures à la seconde, heure du club
        </p>
      </div>
      <Carte titre="Chercher">
        <form method="get" className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_2fr_2fr]">
            <label className="flex flex-col gap-1 font-semibold">
              Mot ou adresse
              <input
                key={`q-${f.q}`}
                type="search"
                name="q"
                defaultValue={f.q}
                placeholder="ex. desistement, jean@…"
                className={`${controle} font-normal`}
              />
            </label>
            <ChampListe
              key={`personne-${f.personne}`}
              label="Personne"
              name="personne"
              valeur={f.personne}
              entrees={[
                { valeur: "", libelle: "Tout le monde" },
                ...personnes.map((u) => ({
                  valeur: u.id,
                  libelle: nomDe.get(u.id) ?? u.id,
                })),
              ]}
            />
            {/* Les deux dates restent côte à côte, téléphone compris : elles se lisent ensemble. */}
            <div className="grid grid-cols-2 gap-3 sm:col-span-2 lg:col-span-1">
              <label className="flex flex-col gap-1 font-semibold">
                Du
                <input
                  key={`du-${f.du}`}
                  type="date"
                  name="du"
                  defaultValue={f.du}
                  className={`${controle} font-normal`}
                />
              </label>
              <label className="flex flex-col gap-1 font-semibold">
                Au
                <input
                  key={`au-${f.au}`}
                  type="date"
                  name="au"
                  defaultValue={f.au}
                  className={`${controle} font-normal`}
                />
              </label>
            </div>
          </div>
          {f.tri !== "recent" && (
            <input type="hidden" name="tri" value={f.tri} />
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              className="min-h-12 rounded-xl bg-primaire px-6 font-semibold text-primaire-texte shadow-bouton"
            >
              Chercher
            </button>
            {filtresActifs && (
              <Link
                href="/admin/audit"
                className="inline-flex min-h-12 items-center rounded-xl border-2 border-bordure bg-surface px-5 font-semibold no-underline"
              >
                Tout effacer
              </Link>
            )}
            <a
              href={`/api/export/audit${exportParams ? `?${exportParams}` : ""}`}
              className="ml-auto inline-flex min-h-12 items-center rounded-xl border-2 border-bordure bg-surface px-5 font-semibold no-underline"
              download
            >
              Exporter en CSV
            </a>
          </div>
        </form>
        {/* Type et tri : des puces tapables (≥ 44 px), qui gardent les autres filtres. */}
        <div className="mt-4 flex flex-col gap-3 border-t border-bordure pt-4">
          <nav
            aria-label="Type d'entrée"
            className="flex flex-wrap items-center gap-2"
          >
            <span className="w-14 text-sm text-texte-secondaire">Type</span>
            <Link
              href={lien({
                q: RACCOURCIS_AUDIT.some((r) => r.q === f.q) ? "" : f.q,
              })}
              className={puce(!RACCOURCIS_AUDIT.some((r) => r.q === f.q))}
            >
              tout
            </Link>
            {RACCOURCIS_AUDIT.map((r) => (
              <Link
                key={r.q}
                href={lien({ q: r.q })}
                aria-current={f.q === r.q ? "true" : undefined}
                className={puce(f.q === r.q)}
              >
                {r.label}
              </Link>
            ))}
          </nav>
          <nav
            aria-label="Trier le journal"
            className="flex flex-wrap items-center gap-2"
          >
            <span className="w-14 text-sm text-texte-secondaire">Trier</span>
            {(Object.keys(TRIS_AUDIT) as TriAudit[]).map((t) => (
              <Link
                key={t}
                href={lien({ tri: t })}
                aria-current={f.tri === t ? "true" : undefined}
                className={puce(f.tri === t)}
              >
                {TRIS_AUDIT[t]}
              </Link>
            ))}
          </nav>
        </div>
      </Carte>

      {lignes.length === 0 ? (
        <Carte>
          <p className="text-texte-secondaire">
            Aucune entrée{filtresActifs ? " pour ces filtres" : ""}.
          </p>
        </Carte>
      ) : (
        groupes.map((g) => (
          <Carte key={`${g.cle}-${g.lignes[0].id}`} titre={g.titre}>
            <ul className="flex flex-col divide-y divide-bordure">
              {g.lignes.map((l) => {
                const acteurNom = l.acteur
                  ? `${l.acteur.prenom} ${l.acteur.nom}`.trim()
                  : "";
                const cibleNom = l.cible ? nomDe.get(l.cible) : undefined;
                const horodatage = formatHorodatage(l.date);
                const ton = tonAction(l.action);
                const details = detailsLisibles(l.details, seances);
                return (
                  <li
                    key={l.id}
                    className="grid gap-1 py-3 sm:grid-cols-[7rem_1fr] sm:gap-4"
                  >
                    <time
                      dateTime={l.date.toISOString()}
                      title={horodatage}
                      className="text-sm tabular-nums text-texte-secondaire sm:pt-0.5"
                    >
                      {parPersonne
                        ? horodatage.replace(" à ", " ")
                        : horodatage.split(" à ")[1]}
                    </time>
                    <div className="min-w-0">
                      <p>
                        {l.acteurId && (acteurNom || l.acteurEmail) ? (
                          <Link
                            href={lien({ personne: l.acteurId })}
                            title="Ne voir que cette personne"
                            className="font-semibold"
                          >
                            {acteurNom || l.acteurEmail}
                          </Link>
                        ) : (
                          <span className="font-semibold">
                            {l.acteurEmail === "anonyme"
                              ? "Quelqu'un (non connecté)"
                              : l.acteurEmail}
                          </span>
                        )}{" "}
                        {ton === "neutre" ? (
                          <span>{libelleAction(l.action)}</span>
                        ) : (
                          <Pastille ton={ton}>
                            {libelleAction(l.action)}
                          </Pastille>
                        )}
                        {cibleNom && l.cible && l.cible !== l.acteurId && (
                          <>
                            {" "}
                            →{" "}
                            <Link
                              href={lien({ personne: l.cible })}
                              title="Ne voir que cette personne"
                            >
                              {cibleNom}
                            </Link>
                          </>
                        )}
                      </p>
                      {details.length > 0 && (
                        <p className="break-words text-sm text-texte-secondaire">
                          {details.join(" · ")}
                        </p>
                      )}
                      <p className="break-all text-xs text-texte-secondaire">
                        <code>{l.action}</code>
                        {acteurNom && l.acteurEmail
                          ? ` · ${l.acteurEmail}`
                          : ""}
                        {l.ip ? ` · IP ${l.ip}` : ""}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Carte>
        ))
      )}

      {pages > 1 && (
        <div className="flex items-center justify-between gap-2 text-sm">
          <span>
            {p > 1 && (
              <LienBouton
                href={lien({}, p - 1)}
                variante="secondaire"
                taille="petite"
              >
                {f.tri === "recent"
                  ? "← Plus récent"
                  : f.tri === "ancien"
                    ? "← Plus ancien"
                    : "← Précédent"}
              </LienBouton>
            )}
          </span>
          <span className="text-texte-secondaire">
            Page {p} / {pages}
          </span>
          <span>
            {p < pages && (
              <LienBouton
                href={lien({}, p + 1)}
                variante="secondaire"
                taille="petite"
              >
                {f.tri === "recent"
                  ? "Plus ancien →"
                  : f.tri === "ancien"
                    ? "Plus récent →"
                    : "Suivant →"}
              </LienBouton>
            )}
          </span>
        </div>
      )}
    </div>
  );
}
