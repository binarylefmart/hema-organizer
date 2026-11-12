import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { formatDateCourte } from "@/lib/dates";
import { statsPeriode, type StatsPeriode } from "@/lib/tableau-de-bord";
import { Carte } from "@/components/ui/Carte";
import { LienBouton } from "@/components/ui/Bouton";
import { Alerte } from "@/components/ui/Alerte";
import { SelecteurHorizon } from "@/components/ui/SelecteurHorizon";
import { CarteSquelette, SelecteurHorizonSquelette, SelecteurPeriodeSquelette, TableauSquelette } from "@/components/ui/Squelette";
import { EnCours } from "@/components/layout/EnCours";
import { SelecteurPeriode, type PeriodeOption } from "@/components/filtres/SelecteurPeriode";
import { todayIso } from "@/lib/dates";
import { lireHorizon, type Horizon } from "@/lib/horizon";
import { lireTri, trierMembres, TRI_LABELS, type TriMembres } from "./tri";
import { TableauMembres } from "./TableauMembres";
import { getChoixCoursActif } from "@/lib/settings";
import { choixDesPresents } from "@/lib/choix-cours";
import { statsChoix, type LigneStat } from "@/components/seances/choix-cours";
import { libelleDelaiDesistement, libelleNiveau } from "@/lib/constants";
import { detailDesistementsSeances, statsDesistements, type StatsDesistements } from "@/lib/historique-reponses";
import { coursEnDanger } from "@/lib/pilotage";
import { identite } from "@/lib/identite";
import { seanceCommencee } from "@/lib/dates";
import { getDelaisDesistement } from "@/lib/settings";
import { ListesDesistements } from "@/components/desistements/ListesDesistements";
import { GraphiquesDesistements } from "@/components/desistements/GraphiquesDesistements";

export const metadata: Metadata = { title: "Tableau de bord" };

type Props = { searchParams: Promise<{ periode?: string; h?: string; tri?: string; vue?: string }> };

/**
 * **Trois onglets, une vue à la fois** (Delta, sur maquettes : « la A, mais montre d'abord la page
 * désistement »). Désistements d'abord — c'est la vue par défaut —, puis les personnes, puis les
 * séances. L'onglet vit dans l'adresse (`?vue=`), comme la période et la fenêtre de temps : le retour
 * du navigateur le ramène, un lien le garde.
 */
const VUES = { desistements: "Désistements", personnes: "Personnes", seances: "Séances" } as const;
type Vue = keyof typeof VUES;
const lireVue = (v?: string): Vue => (v && v in VUES ? (v as Vue) : "desistements");
/** Les paramètres que tout lien de l'écran garde, l'onglet compris (« desistements » est le défaut, il ne s'écrit pas). */
const paramVue = (vue: Vue): Record<string, string> => (vue === "desistements" ? {} : { vue });

type IlotProps = { stats: Promise<StatsPeriode | null> };

/** Choix de la saison et de la période : deux listes déroulantes, rien de plus à attendre. */
async function ChoixPeriode({
  periodes,
  choisie,
  horizon,
  aujourdHui,
  peutCreer,
  vue,
}: {
  periodes: Promise<PeriodeOption[]>;
  choisie: Promise<string | undefined>;
  horizon: Horizon;
  aujourdHui: string;
  peutCreer: boolean;
  vue: Vue;
}) {
  const [liste, id] = await Promise.all([periodes, choisie]);
  return (
    <SelecteurPeriode
      periodes={liste}
      valeur={id ?? ""}
      aujourdHui={aujourdHui}
      base="/gestion/tableau-de-bord"
      peutCreer={peutCreer}
      params={{ ...(horizon === "periode" ? {} : { h: horizon }), ...paramVue(vue) }}
    />
  );
}

/**
 * Export CSV : la période affichée **et la fenêtre de temps affichée**.
 *
 * Le bouton n'envoyait que la période : l'écran pouvait montrer « 1 mois » pendant que le fichier
 * couvrait le trimestre entier. Un export doit être le fichier de ce qu'on a sous les yeux —
 * autrement on cherche l'erreur dans les chiffres.
 */
async function BoutonExport({ choisie, horizon }: { choisie: Promise<string | undefined>; horizon: Horizon }) {
  const id = await choisie;
  if (!id) return null;
  // Téléchargement de fichier : pas de témoin de navigation, il n'y a pas d'écran à attendre
  return (
    <LienBouton href={`/api/export/presences?periode=${id}${horizon === "periode" ? "" : `&h=${horizon}`}`} variante="secondaire" prefetch={false}>
      Exporter en CSV
    </LienBouton>
  );
}

/** Fenêtre de temps : elle n'a besoin que du nombre de séances observées. */
async function BarreHorizon({ stats, choisie, horizon, vue }: IlotProps & { choisie: Promise<string | undefined>; horizon: Horizon; vue: Vue }) {
  const [s, id] = await Promise.all([stats, choisie]);
  if (!s) return null;
  const suite = vue === "desistements" ? "" : `&vue=${vue}`;
  return <SelecteurHorizon horizon={horizon} passe href={(x) => `/gestion/tableau-de-bord?periode=${id}${x === "periode" ? "" : `&h=${x}`}${suite}`} compte={s.seances.length} />;
}

/** Les trois onglets : des liens (l'onglet est dans l'adresse), qui gardent la période et la fenêtre. */
async function Onglets({ choisie, horizon, vue }: { choisie: Promise<string | undefined>; horizon: Horizon; vue: Vue }) {
  const id = await choisie;
  const lien = (v: Vue) => {
    const p = new URLSearchParams({ ...(id ? { periode: id } : {}), ...(horizon === "periode" ? {} : { h: horizon }), ...paramVue(v) });
    return `/gestion/tableau-de-bord?${p.toString()}`;
  };
  return (
    <nav aria-label="Vue du tableau de bord" className="grid grid-cols-3 gap-1 rounded-xl bg-surface-douce p-1">
      {(Object.keys(VUES) as Vue[]).map((v) => (
        <Link
          key={v}
          href={lien(v)}
          scroll={false}
          aria-current={v === vue ? "page" : undefined}
          className={`flex min-h-12 items-center justify-center rounded-lg px-2 text-center font-semibold no-underline ${
            v === vue ? "bg-surface text-texte shadow-carte" : "text-texte-secondaire hover:text-texte"
          }`}
        >
          {VUES[v]}
        </Link>
      ))}
    </nav>
  );
}

/**
 * **L'onglet Désistements** : les désistements des séances affichées, nom par nom (le même rendu que
 * la page « Désistements »), une ligne de chiffres, et le bouton vers la page complète pour filtrer
 * par dates et par personne.
 */
async function OngletDesistements({ stats, choisie }: IlotProps & { choisie: Promise<string | undefined> }) {
  const [s, id, delais] = await Promise.all([stats, choisie, getDelaisDesistement()]);
  if (!s) return <Alerte type="info">Aucune période.</Alerte>;
  const detail = await detailDesistementsSeances(s.seances.map((x) => x.id));
  const base = `/gestion/tableau-de-bord/desistements?${id ? `periode=${id}&` : ""}`;
  const signales = detail.lignes.filter((l) => l.signale && !l.derniereMinute).length;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p>
          <strong>{detail.total}</strong> désistement{detail.total > 1 ? "s" : ""} · <strong>{signales}</strong> signalé{signales > 1 ? "s" : ""} (délai :{" "}
          {libelleDelaiDesistement(delais.delaiMin)}) · <strong>{detail.derniereMinute}</strong> de dernière minute (moins de {libelleDelaiDesistement(delais.derniereMinuteMin)}) ·{" "}
          <strong>{detail.personnes}</strong> personne{detail.personnes > 1 ? "s" : ""}
        </p>
        <LienBouton href={base.replace(/[?&]$/, "")} variante="secondaire" enCours className="shrink-0">
          Filtrer par dates et par personne
        </LienBouton>
      </div>
      {detail.total === 0 ? (
        <Carte titre="Aucun désistement">
          <p className="text-texte-secondaire">Aucun désistement noté sur ces séances. La page de filtres lit aussi les autres périodes.</p>
        </Carte>
      ) : (
        <>
          <GraphiquesDesistements
            detail={detail}
            seances={s.seances.filter((x) => !x.annulee).sort((a, b) => a.date.localeCompare(b.date) || a.heureDebut.localeCompare(b.heureDebut))}
            lienPersonne={(userId) => `${base}personne=${userId}`}
          />
          <ListesDesistements detail={detail} lienPersonne={(userId) => `${base}personne=${userId}`} max={100} parPersonne={false} />
        </>
      )}
    </div>
  );
}

/** Première lecture : le taux de chaque séance, une barre par ligne. */
async function TauxParSeance({ stats }: IlotProps) {
  const s = await stats;
  if (!s) return <Alerte type="info">Aucune période.</Alerte>;
  return (
    <Carte titre={`Taux par séance — moyenne ${s.moyenne}\u00a0%`}>
      {s.seances.length === 0 ? (
        <p className="text-texte-secondaire">Aucune séance.</p>
      ) : (
        <ol className="flex flex-col gap-1.5" aria-label="Taux de présence par séance">
          {s.seances.map((seance) => (
            /* **Sur téléphone, la barre prend toute la largeur.** À trois colonnes fixes, il lui
               restait environ 130 px : 21 % et 28 % y dessinaient le même trait. La date et le
               pourcentage tiennent donc la première ligne, la barre la seconde ; à partir de `md`,
               la place existe et les trois colonnes reviennent (l'ordre y remet la barre au milieu). */
            <li key={seance.id} className="grid grid-cols-[1fr_auto] items-center gap-x-2 gap-y-1 py-0.5 text-sm md:grid-cols-[7.5rem_1fr_4.5rem] md:gap-2 md:py-0">
              <Link href={`/seances/${seance.id}`} className={`inline-flex min-w-0 items-center gap-1.5 ${seance.annulee ? "text-texte-secondaire line-through" : ""}`}>
                {/* La date garde sa coupure propre : c'est elle qui est tronquée, pas le témoin d'attente */}
                <span className="truncate">{formatDateCourte(seance.date)}</span>
                <EnCours taille={12} />
              </Link>
              {/* `row-start-2` place la barre sur la deuxième ligne de la grille du téléphone ; le
                  pourcentage, placé automatiquement, prend donc la place restée libre à droite de
                  la date. À partir de `md`, les deux reviennent dans l'ordre du HTML. */}
              <div className="col-span-2 row-start-2 h-4 overflow-hidden rounded bg-surface-douce md:col-span-1 md:row-start-auto" role="presentation">
                {!seance.annulee && <div className={`h-full rounded ${seance.passee ? "bg-jauge" : "bg-primaire/70"}`} style={{ width: `${seance.compteurs.pourcentage}%` }} />}
              </div>
              <span className="text-right tabular-nums">{seance.annulee ? "annulée" : `${seance.compteurs.pourcentage}\u00a0%`}</span>
            </li>
          ))}
        </ol>
      )}
      {/* **Une légende ne nomme jamais une couleur.** Celle-ci en nommait deux, dont la couleur
          primaire ; depuis que le thème du club est un réglage (v0.51.0), cette primaire change
          d'un thème à l'autre, et la phrase était donc fausse sur presque tous. On montre la
          couleur au lieu de l'écrire : la pastille est décorative (`aria-hidden`), c'est le texte
          à côté qui porte le sens, et il reste juste quel que soit le thème choisi. */}
      <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-texte-secondaire">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-3 w-6 shrink-0 rounded bg-jauge" />
          séances passées
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-3 w-6 shrink-0 rounded bg-primaire/70" />
          réponses déjà reçues pour les séances à venir
        </span>
      </p>
    </Carte>
  );
}

/**
 * La partie la plus lourde de l'écran : une ligne par membre du club, six colonnes.
 * Son `<Suspense>` la laisse arriver **après** le taux par séance, qui se lit en premier.
 *
 * **Un tri, et aussi un repli.** On vient ici chercher les décrocheurs, et remonter les plus bas
 * taux met la réponse dans les premières lignes : c'est le tri qui répond à la question. Mais à
 * quatre-vingts, les soixante lignes du dessous restaient dans la page — vingt-trois écrans de
 * défilement sur téléphone. Le tri **classe**, le repli et la recherche **raccourcissent** ; les
 * trois vivent ensemble dans `TableauMembres`, et aucun des trois n'apparaît sous le seuil.
 *
 * Le tri voyage dans l'URL — l'écran reste un composant serveur, et le retour du navigateur ramène
 * le classement précédent. Ses trois entrées sont posées **au-dessus** du tableau, pas dans ses
 * en-têtes : sur téléphone, la ligne d'en-têtes n'existe pas, et un tri écrit dedans serait
 * invisible là où il sert le plus.
 */
async function TauxParMembre({
  stats,
  desistements,
  choisie,
  tri,
  lienTri,
}: IlotProps & { desistements: Promise<StatsDesistements | null>; choisie: Promise<string | undefined>; tri: TriMembres; lienTri: (t: TriMembres) => string }) {
  const [s, d, id] = await Promise.all([stats, desistements, choisie]);
  if (!s) return null;
  // **Présence et désistements sur la même ligne** (Delta : « rends les infos de désistement et de
  // présence plus ergonomiques ») : une personne se lit en un endroit, plus en deux cartes.
  const membres = trierMembres(
    s.membres.map((m) => ({ ...m, desistements: d?.compteParMembre[m.id]?.n ?? 0, derniereMinute: d?.compteParMembre[m.id]?.derniereMinute ?? 0 })),
    tri,
  );
  const base = `/gestion/tableau-de-bord/desistements?${id ? `periode=${id}&` : ""}personne=`;
  return (
    <Carte titre="Présences et désistements, par personne">
      <p className="-mt-2 mb-3 text-sm text-texte-secondaire">Présences sur les séances passées ; désistements sur les séances affichées.</p>
      {/* Le tri est **toujours** proposé (« filtrable ») : des puces, comme le sélecteur de fenêtre de
          temps — même forme, même hauteur, l'entrée active est remplie. Posées au-dessus du tableau et
          non dans ses en-têtes : sur téléphone, la ligne d'en-têtes n'existe pas. */}
      <nav aria-label="Trier le tableau" className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-sm text-texte-secondaire">Trier par :</span>
        {(Object.keys(TRI_LABELS) as TriMembres[]).map((t) => {
          const actif = t === tri;
          return (
            <Link
              key={t}
              href={lienTri(t)}
              scroll={false}
              aria-current={actif ? "true" : undefined}
              className={`flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-full border-2 px-4 text-sm font-semibold no-underline transition ${
                actif ? "border-primaire bg-primaire text-primaire-texte shadow-bouton" : "border-bordure bg-surface text-texte hover:bg-surface-douce"
              }`}
            >
              {TRI_LABELS[t]}
            </Link>
          );
        })}
      </nav>
      <TableauMembres membres={membres} lienDesistements={base} />
    </Carte>
  );
}

/**
 * **Le résumé, en tête** : quatre chiffres lus avant tout le reste — le taux moyen, les cours à venir
 * sous le seuil du club (même règle que l'accueil : `coursEnDanger`), les désistements, dont de
 * dernière minute. Chacun mène à l'endroit où il se détaille.
 */
async function Resume({ stats, desistements, choisie }: IlotProps & { desistements: Promise<StatsDesistements | null>; choisie: Promise<string | undefined> }) {
  const [s, d, id, club] = await Promise.all([stats, desistements, choisie, identite()]);
  if (!s) return null;
  const now = new Date();
  const aVenir = s.seances.filter((x) => !x.passee && !x.annulee && !seanceCommencee(x.date, x.heureDebut, now));
  const danger = coursEnDanger(aVenir, club.partEffectifMin).length;
  const detail = `/gestion/tableau-de-bord/desistements${id ? `?periode=${id}` : ""}`;
  const tuiles: Array<{ valeur: string; legende: string; href?: string; alerte?: boolean }> = [
    { valeur: `${s.moyenne} %`, legende: "taux de présence moyen" },
    { valeur: String(danger), legende: "cours à venir sous le seuil", alerte: danger > 0 },
    { valeur: String(d?.desistements ?? 0), legende: (d?.desistements ?? 0) > 1 ? "désistements" : "désistement", href: detail },
    { valeur: String(d?.derniereMinute ?? 0), legende: "de dernière minute", href: `${detail}${id ? "&" : "?"}type=derniere_minute`, alerte: (d?.derniereMinute ?? 0) > 0 },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {tuiles.map((t) => {
        const contenu = (
          <>
            <span className={`block text-3xl font-bold tabular-nums ${t.alerte ? "text-rouge" : ""}`}>{t.valeur}</span>
            <span className="block text-sm text-texte-secondaire">{t.legende}</span>
          </>
        );
        // `text-texte` : une tuile cliquable ne prend pas la couleur des liens — seul un chiffre en alerte se colore.
        const classes = "block rounded-xl border border-bordure bg-surface px-4 py-3 text-texte no-underline shadow-carte";
        return t.href ? (
          <Link key={t.legende} href={t.href} className={`${classes} hover:bg-surface-douce`}>
            {contenu}
          </Link>
        ) : (
          <div key={t.legende} className={classes}>
            {contenu}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Tableau de bord d'une période. Le calcul des taux (toutes les séances, tous les membres) n'est pas
 * attendu par la page : le titre, l'export et le choix de période sont là tout de suite, puis les
 * taux par séance, puis — dans son propre `<Suspense>` — le tableau par membre.
 */
/** Un petit tableau de la carte « Choix des cours » : une ligne par cours, niveau ou mois. */
function TableStat({ titre, lignes }: { titre: string; lignes: LigneStat[] }) {
  return (
    <div className="min-w-0">
      <h3 className="mb-1 text-base font-semibold">{titre}</h3>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-texte-secondaire">
            <th className="py-1 pr-2 font-normal">{titre.replace("Par ", "").replace(/^./, (c) => c.toUpperCase())}</th>
            <th className="py-1 pr-2 text-right font-normal">Choix</th>
            <th className="py-1 text-right font-normal">Séances</th>
          </tr>
        </thead>
        <tbody>
          {lignes.map((l) => (
            <tr key={l.cle} className="border-t border-bordure/50">
              <td className="py-1 pr-2">{l.libelle}</td>
              <td className="py-1 pr-2 text-right tabular-nums">{l.choix}</td>
              <td className="py-1 text-right tabular-nums">{l.seances}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * **Le choix des cours** (retours du club d'Arras), sur les séances de la fenêtre affichée : combien
 * de présents ont choisi chaque cours, chaque niveau, chaque mois. Rien quand le club n'a pas ouvert
 * le réglage.
 */
async function ChoixDesCours({ stats }: IlotProps) {
  const [s, actif] = await Promise.all([stats, getChoixCoursActif()]);
  if (!s || !actif) return null;
  const ids = s.seances.filter((x) => !x.annulee).map((x) => x.id);
  const st = statsChoix(await choixDesPresents(s.period.id, ids), libelleNiveau);
  return (
    <Carte titre={`Choix des cours — ${st.total} choix`}>
      {st.total === 0 ? (
        <p className="text-texte-secondaire">Aucun présent n&apos;a encore choisi de cours sur ces séances.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <TableStat titre="Par cours" lignes={st.parCours} />
          <TableStat titre="Par niveau" lignes={st.parNiveau} />
          <TableStat titre="Par mois" lignes={st.parMois} />
        </div>
      )}
      <p className="mt-2 text-sm text-texte-secondaire">Seuls comptent les choix des personnes qui ont répondu « Présent ».</p>
    </Carte>
  );
}


export default async function PageTableauDeBord({ searchParams }: Props) {
  const user = await requirePermission("dashboard.view");
  const { periode, h, tri: triBrut, vue: vueBrute } = await searchParams;
  const vue = lireVue(vueBrute);
  const horizon = lireHorizon(h);
  const tri = lireTri(triBrut);
  const aujourdHui = todayIso();
  // Promesses volontairement non attendues : elles sont remises aux îlots ci-dessus.
  const periodes: Promise<PeriodeOption[]> = db.period.findMany({
    orderBy: { dateDebut: "desc" },
    select: { id: true, nom: true, statut: true, dateDebut: true, dateFin: true },
  });
  const choisie: Promise<string | undefined> = periodes.then((ps) => periode ?? ps.find((p) => p.statut === "ACTIVE")?.id ?? ps[0]?.id);
  const stats: Promise<StatsPeriode | null> = choisie.then((id) => (id ? statsPeriode(id, new Date(), horizon) : null));
  // **Une seule lecture des désistements** pour le résumé, le tableau par personne et la carte.
  const desistements: Promise<StatsDesistements | null> = stats.then((s) => (s ? statsDesistements(s.seances.map((x) => x.id)) : null));
  return (
    /*
     * **La page s'élargit, et les deux lectures montent côte à côte**.
     *
     * Deux paliers, et ils ne disent pas la même chose :
     *
     * - **1 024 px** ({@link PLEINE_LARGEUR}) : la page prend la largeur. Les deux blocs restent
     *   **empilés**, mais chacun l'occupe entière — les seize barres de « Taux par séance »
     *   s'allongent, et le tableau par membre cesse de serrer ses six colonnes dans 692 px ;
     * - **1 536 px** (`DeuxPiles`) : il y a la place de mettre quelque chose à côté, et les deux
     *   blocs se partagent la ligne. On lit d'abord la courbe du trimestre, à droite les décrocheurs.
     *
     * **Ce qui reste en pleine largeur au-dessus** : la saison, la période et les puces d'horizon.
     * Ce sont les réglages de *tout* ce qui est en dessous — les mettre dans une des deux piles en
     * ferait les réglages de cette pile-là.
     */
    <div className={`flex flex-col gap-5`}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl">Tableau de bord</h1>
        </div>
        <Suspense fallback={null}>
          <BoutonExport choisie={choisie} horizon={horizon} />
        </Suspense>
      </div>
      <Suspense fallback={<SelecteurPeriodeSquelette />}>
        <ChoixPeriode periodes={periodes} choisie={choisie} horizon={horizon} aujourdHui={aujourdHui} peutCreer={can(user, "periods.manage")} vue={vue} />
      </Suspense>
      <Suspense fallback={<SelecteurHorizonSquelette />}>
        <BarreHorizon stats={stats} choisie={choisie} horizon={horizon} vue={vue} />
      </Suspense>
      <Suspense fallback={null}>
        <Resume stats={stats} desistements={desistements} choisie={choisie} />
      </Suspense>
      <Suspense fallback={null}>
        <Onglets choisie={choisie} horizon={horizon} vue={vue} />
      </Suspense>
      {/* Une vue à la fois : seul l'onglet ouvert lit ce dont il a besoin. */}
      {vue === "desistements" && (
        <Suspense fallback={<CarteSquelette lignes={6} />}>
          <OngletDesistements stats={stats} choisie={choisie} />
        </Suspense>
      )}
      {vue === "personnes" && (
        <Suspense
          fallback={
            <CarteSquelette>
              <TableauSquelette colonnes={4} lignes={7} />
            </CarteSquelette>
          }
        >
          <TauxParMembre
            stats={stats}
            desistements={desistements}
            choisie={choisie}
            tri={tri}
            lienTri={(t) => {
              // Le tri s'ajoute aux paramètres déjà là (période, fenêtre de temps, onglet) : changer de
              // classement ne doit jamais reposer l'écran sur une autre période ni un autre onglet.
              const p = new URLSearchParams();
              if (periode) p.set("periode", periode);
              if (horizon !== "periode") p.set("h", horizon);
              p.set("vue", "personnes");
              if (t !== "nom") p.set("tri", t);
              return `/gestion/tableau-de-bord?${p.toString()}`;
            }}
          />
        </Suspense>
      )}
      {vue === "seances" && (
        <>
          <Suspense fallback={<CarteSquelette lignes={8} />}>
            <TauxParSeance stats={stats} />
          </Suspense>
          <Suspense fallback={null}>
            <ChoixDesCours stats={stats} />
          </Suspense>
        </>
      )}
    </div>
  );
}
