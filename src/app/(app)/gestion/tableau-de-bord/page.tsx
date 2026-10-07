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
import { LIGNES_VISIBLES } from "@/components/seances/listes";
import { lireTri, trierMembres, TRI_LABELS, type TriMembres } from "./tri";
import { TableauMembres } from "./TableauMembres";
import { DeuxPiles } from "@/components/ui/DeuxPiles";

export const metadata: Metadata = { title: "Tableau de bord" };

type Props = { searchParams: Promise<{ periode?: string; h?: string; tri?: string }> };

type IlotProps = { stats: Promise<StatsPeriode | null> };

/** Choix de la saison et de la période : deux listes déroulantes, rien de plus à attendre. */
async function ChoixPeriode({
  periodes,
  choisie,
  horizon,
  aujourdHui,
  peutCreer,
}: {
  periodes: Promise<PeriodeOption[]>;
  choisie: Promise<string | undefined>;
  horizon: Horizon;
  aujourdHui: string;
  peutCreer: boolean;
}) {
  const [liste, id] = await Promise.all([periodes, choisie]);
  return (
    <SelecteurPeriode
      periodes={liste}
      valeur={id ?? ""}
      aujourdHui={aujourdHui}
      base="/gestion/tableau-de-bord"
      peutCreer={peutCreer}
      params={horizon === "periode" ? undefined : { h: horizon }}
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
async function BarreHorizon({ stats, choisie, horizon }: IlotProps & { choisie: Promise<string | undefined>; horizon: Horizon }) {
  const [s, id] = await Promise.all([stats, choisie]);
  if (!s) return null;
  return <SelecteurHorizon horizon={horizon} passe href={(x) => `/gestion/tableau-de-bord?periode=${id}${x === "periode" ? "" : `&h=${x}`}`} compte={s.seances.length} />;
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
async function TauxParMembre({ stats, tri, lienTri }: IlotProps & { tri: TriMembres; lienTri: (t: TriMembres) => string }) {
  const s = await stats;
  if (!s) return null;
  const membres = trierMembres(s.membres, tri);
  return (
    <Carte titre="Taux par membre (séances passées)">
      {/* Pas de tri proposé tant que le tableau se lit d'un coup d'œil : un club de douze n'a rien à classer. */}
      {s.membres.length > LIGNES_VISIBLES && (
        <nav aria-label="Trier le tableau" className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-sm text-texte-secondaire">Trier par :</span>
          {/* **Des puces, pas trois liens en petit texte.** C'étaient des cibles bien sous les 44 px
              et, sur téléphone, rien ne disait que ça se touchait : trois mots colorés au-dessus
              d'un tableau se lisent comme un titre. Ce sont donc les puces du sélecteur de fenêtre
              de temps (`SelecteurHorizon`), à l'identique — même forme, même hauteur, même façon de
              montrer l'entrée active : elle est **remplie**, et pas seulement en gras. */}
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
      )}
      <TableauMembres membres={membres} />
    </Carte>
  );
}

/**
 * Tableau de bord d'une période. Le calcul des taux (toutes les séances, tous les membres) n'est pas
 * attendu par la page : le titre, l'export et le choix de période sont là tout de suite, puis les
 * taux par séance, puis — dans son propre `<Suspense>` — le tableau par membre.
 */
export default async function PageTableauDeBord({ searchParams }: Props) {
  const user = await requirePermission("dashboard.view");
  const { periode, h, tri: triBrut } = await searchParams;
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
        <ChoixPeriode periodes={periodes} choisie={choisie} horizon={horizon} aujourdHui={aujourdHui} peutCreer={can(user, "periods.manage")} />
      </Suspense>
      <Suspense fallback={<SelecteurHorizonSquelette />}>
        <BarreHorizon stats={stats} choisie={choisie} horizon={horizon} />
      </Suspense>
      {/* Chaque pile garde son `<Suspense>` : le taux par séance s'affiche toujours avant le
          tableau par membre, qui est le calcul lourd de l'écran. Les mettre côte à côte ne change
          rien à cet ordre d'arrivée — seulement à l'endroit où chacun atterrit. */}
      <DeuxPiles
        gauche={
          <Suspense fallback={<CarteSquelette lignes={8} />}>
            <TauxParSeance stats={stats} />
          </Suspense>
        }
        droite={
          <Suspense
            fallback={
              <CarteSquelette>
                <TableauSquelette colonnes={6} lignes={7} />
              </CarteSquelette>
            }
          >
            <TauxParMembre
              stats={stats}
              tri={tri}
              lienTri={(t) => {
                // Le tri s'ajoute aux paramètres déjà là (période, fenêtre de temps) : changer de
                // classement ne doit jamais reposer l'écran sur une autre période.
                const p = new URLSearchParams();
                if (periode) p.set("periode", periode);
                if (horizon !== "periode") p.set("h", horizon);
                if (t !== "nom") p.set("tri", t);
                const suite = p.toString();
                return `/gestion/tableau-de-bord${suite ? `?${suite}` : ""}`;
              }}
            />
          </Suspense>
        }
      />
    </div>
  );
}
