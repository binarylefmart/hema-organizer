import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/current-user";
import { db } from "@/lib/db";
import { isIsoDate } from "@/lib/dates";
import { libelleDelaiDesistement } from "@/lib/constants";
import { detailDesistements, type FiltresDesistements, type TypeDesistementFiltre } from "@/lib/historique-reponses";
import { getDelaisDesistement } from "@/lib/settings";
import { Carte } from "@/components/ui/Carte";
import { ChampListe } from "@/components/ui/ChampListe";
import { ListesDesistements } from "@/components/desistements/ListesDesistements";

export const metadata: Metadata = { title: "Désistements" };

type Props = { searchParams: Promise<{ periode?: string; du?: string; au?: string; personne?: string; type?: string }> };

const TYPES: Record<TypeDesistementFiltre, string> = { tous: "Tous", signales: "Désistements signalés", derniere_minute: "Désistements de dernière minute" };
/** Au-delà, le détail se tronque (le tableau par personne, lui, compte tout) : il se resserre par les filtres. */
const LIGNES_MAX = 300;

const identifiant = (v?: string) => (v && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : "");
const CONTROLE = "min-h-12 w-full rounded-xl border-2 border-bordure bg-surface px-3 text-base font-normal";
const PUCE = "flex min-h-12 items-center rounded-full border-2 px-4 text-sm font-semibold no-underline";

/**
 * **Les désistements, nom par nom** (instructeurs et bureau, `dashboard.view`). Filtres dans l'adresse
 * (période, dates du cours, personne, type) : le retour du navigateur ramène la vue précédente, et un
 * lien se partage tel qu'on le lit. La période vaut par défaut la période active ; « Toutes » lève la
 * borne. Les dates portent sur **le jour du cours**, pas sur l'instant du retrait (au journal d'audit).
 */
export default async function PageDesistements({ searchParams }: Props) {
  await requirePermission("dashboard.view");
  const brut = await searchParams;
  const periodes = await db.period.findMany({ orderBy: { dateDebut: "desc" }, select: { id: true, nom: true, statut: true } });
  const periodeParDefaut = periodes.find((p) => p.statut === "ACTIVE")?.id ?? periodes[0]?.id ?? "";
  const periodId = brut.periode === "toutes" ? "" : periodes.some((p) => p.id === brut.periode) ? brut.periode! : periodeParDefaut;
  const f: FiltresDesistements = {
    periodId,
    du: brut.du && isIsoDate(brut.du) ? brut.du : "",
    au: brut.au && isIsoDate(brut.au) ? brut.au : "",
    personne: identifiant(brut.personne),
    type: brut.type && brut.type in TYPES ? (brut.type as TypeDesistementFiltre) : "tous",
  };
  const [detail, delais, personnes] = await Promise.all([
    detailDesistements(f),
    getDelaisDesistement(),
    // La liste des noms : ceux qui se sont désistés au moins une fois, sur toutes les périodes — on ne
    // propose pas une personne pour laquelle il n'y a rien à lire.
    db.user.findMany({
      where: { historiqueReponses: { some: { desistement: true } } },
      select: { id: true, prenom: true, nom: true },
      orderBy: [{ nom: "asc" }, { prenom: "asc" }],
    }),
  ]);

  /** Une adresse qui garde les filtres en cours, sauf ceux qu'on change. */
  const lien = (changes: Partial<Record<"periode" | "du" | "au" | "personne" | "type", string>>) => {
    const v = { periode: brut.periode === "toutes" ? "toutes" : periodId === periodeParDefaut ? "" : periodId, du: f.du, au: f.au, personne: f.personne, type: f.type === "tous" ? "" : f.type, ...changes };
    const p = new URLSearchParams();
    for (const [k, val] of Object.entries(v)) if (val) p.set(k, val);
    const suite = p.toString();
    return `/gestion/tableau-de-bord/desistements${suite ? `?${suite}` : ""}`;
  };
  const filtres = Boolean(f.du || f.au || f.personne || f.type !== "tous" || brut.periode);
  const puce = (actif: boolean) => `${PUCE} ${actif ? "border-primaire bg-primaire text-primaire-texte" : "border-bordure bg-surface text-texte hover:bg-surface-douce"}`;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href="/gestion/tableau-de-bord" className="inline-flex min-h-11 items-center">
          ‹ Tableau de bord
        </Link>
        <h1 className="text-3xl">Désistements</h1>
        <p className="text-texte-secondaire">
          <strong className="text-texte">{detail.total}</strong> désistement{detail.total > 1 ? "s" : ""}, dont <strong className="text-texte">{detail.derniereMinute}</strong> de dernière
          minute, pour <strong className="text-texte">{detail.personnes}</strong> personne{detail.personnes > 1 ? "s" : ""}
          {filtres ? " avec ces filtres" : " sur la période active"}.
        </p>
      </div>

      <Carte titre="Filtrer">
        <form method="get" className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_2fr_3fr]">
            <ChampListe
              key={`periode-${brut.periode ?? ""}`}
              label="Période"
              name="periode"
              valeur={brut.periode === "toutes" ? "toutes" : periodId}
              entrees={[{ valeur: "toutes", libelle: "Toutes les périodes" }, ...periodes.map((p) => ({ valeur: p.id, libelle: p.nom }))]}
            />
            <ChampListe
              key={`personne-${f.personne}`}
              label="Personne"
              name="personne"
              valeur={f.personne}
              entrees={[{ valeur: "", libelle: "Tout le monde" }, ...personnes.map((u) => ({ valeur: u.id, libelle: `${u.prenom} ${u.nom}`.trim() }))]}
            />
            {/* Les deux dates restent côte à côte, téléphone compris : elles se lisent ensemble. */}
            <div className="grid grid-cols-2 gap-3 sm:col-span-2 lg:col-span-1">
              <label className="flex flex-col gap-1 font-semibold">
                Cours du
                <input key={`du-${f.du}`} type="date" name="du" defaultValue={f.du} className={CONTROLE} />
              </label>
              <label className="flex flex-col gap-1 font-semibold">
                au
                <input key={`au-${f.au}`} type="date" name="au" defaultValue={f.au} className={CONTROLE} />
              </label>
            </div>
          </div>
          {f.type !== "tous" && <input type="hidden" name="type" value={f.type} />}
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" className="min-h-12 rounded-xl bg-primaire px-6 font-semibold text-primaire-texte shadow-bouton">
              Filtrer
            </button>
            {filtres && (
              <Link href="/gestion/tableau-de-bord/desistements" className="inline-flex min-h-12 items-center rounded-xl border-2 border-bordure bg-surface px-5 font-semibold no-underline">
                Tout effacer
              </Link>
            )}
          </div>
        </form>
        <nav aria-label="Type de désistement" className="mt-4 flex flex-wrap items-center gap-2 border-t border-bordure pt-4">
          {(Object.keys(TYPES) as TypeDesistementFiltre[]).map((t) => (
            <Link key={t} href={lien({ type: t === "tous" ? "" : t })} className={puce(f.type === t)} aria-current={f.type === t ? "true" : undefined}>
              {TYPES[t]}
            </Link>
          ))}
        </nav>
        <p className="mt-3 text-sm text-texte-secondaire">
          Signalé : les instructeurs ont été prévenus (délai : {libelleDelaiDesistement(delais.delaiMin)}). De dernière minute : dans les{" "}
          {libelleDelaiDesistement(delais.derniereMinuteMin)} qui précèdent le cours (compté depuis la v0.87.0). Les dates portent sur le jour du cours.
        </p>
      </Carte>

      {detail.total === 0 ? (
        <Carte titre="Aucun désistement">
          <p className="text-texte-secondaire">Rien à montrer pour ces filtres.</p>
        </Carte>
      ) : (
        <>
          <ListesDesistements detail={detail} lienPersonne={(id) => lien({ personne: id })} max={LIGNES_MAX} />
        </>
      )}
    </div>
  );
}
