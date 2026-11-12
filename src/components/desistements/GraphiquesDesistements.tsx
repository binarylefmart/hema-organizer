import Link from "next/link";
import { formatDateCourte, formatHeure } from "@/lib/dates";
import {
  desistementsParCreneau,
  TRANCHES_DELAI,
  type DetailDesistements,
  type LigneDesistement,
} from "@/lib/historique-reponses";
import { Carte } from "@/components/ui/Carte";

/**
 * **Les désistements en graphiques** (Delta : « je veux du graph, que ce soit visuel »).
 *
 * Quatre types ordonnés — anticipé, signalé, de dernière minute, non signalé (inscrit Présent, pas
 * venu) — donc **une seule teinte** : le rouge du thème, mêlé à la surface pour les plus légers (45 %,
 * 72 %), plein pour la dernière minute, mêlé au texte pour le non signalé — le plus contrasté dans les
 * deux modes (il fonce en clair, s'éclaircit en sombre). Validé : gamme ordinale, daltonisme, clair et
 * sombre, contraste ≥ 2:1 au plus léger. Rouge et ocre, essayés d'abord, se confondaient. La légende
 * est toujours là, chaque barre porte son nom accessible, et le détail, dessous, en est le tableau.
 */

type Type = "nonsignale" | "derniere" | "signale" | "anticipe";
/** Du plus grave au moins grave : l'ordre de la légende, et le haut d'une colonne. */
const TYPES: ReadonlyArray<{ cle: Type; libelle: string; pluriel: string; fond: string }> = [
  { cle: "nonsignale", libelle: "désistement non signalé", pluriel: "désistements non signalés", fond: "color-mix(in srgb, var(--rouge) 65%, var(--texte))" },
  { cle: "derniere", libelle: "désistement de dernière minute", pluriel: "désistements de dernière minute", fond: "var(--rouge)" },
  { cle: "signale", libelle: "désistement signalé", pluriel: "désistements signalés", fond: "color-mix(in srgb, var(--rouge) 72%, var(--surface))" },
  { cle: "anticipe", libelle: "désistement anticipé", pluriel: "désistements anticipés", fond: "color-mix(in srgb, var(--rouge) 45%, var(--surface))" },
];
const typeDe = (l: LigneDesistement): Type => (l.nonSignale ? "nonsignale" : l.derniereMinute ? "derniere" : l.signale ? "signale" : "anticipe");
type Compte = Record<Type, number>;
const vide = (): Compte => ({ nonsignale: 0, derniere: 0, signale: 0, anticipe: 0 });
const total = (c: Compte) => c.nonsignale + c.derniere + c.signale + c.anticipe;
const phrase = (c: Compte) =>
  TYPES.filter((t) => c[t.cle] > 0)
    .map((t) => `${c[t.cle]} ${c[t.cle] > 1 ? t.pluriel : t.libelle}`)
    .join(", ");

function Legende() {
  return (
    <ul
      className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-texte-secondaire"
      aria-label="Légende"
    >
      {TYPES.map((t) => (
        <li key={t.cle} className="inline-flex items-center gap-2">
          <span
            aria-hidden
            className="inline-block size-3 rounded-sm"
            style={{ background: t.fond }}
          />
          {t.libelle}
        </li>
      ))}
    </ul>
  );
}

/** Des segments empilés, séparés par 2 px de surface ; vertical (colonne) ou horizontal (barre). */
function Pile({
  c,
  max,
  sens,
}: {
  c: Compte;
  max: number;
  sens: "colonne" | "barre";
}) {
  const n = total(c);
  if (n === 0) return null;
  const taille = `${(n / max) * 100}%`;
  // Le type le plus grave au bout de la barre (en haut d'une colonne, à droite d'une barre).
  const ordre = sens === "colonne" ? TYPES : [...TYPES].reverse();
  return (
    <div
      className={`flex gap-[2px] overflow-hidden ${sens === "colonne" ? "w-full flex-col rounded-t" : "h-full flex-row rounded-r"}`}
      style={sens === "colonne" ? { height: taille } : { width: taille }}
    >
      {ordre.map((t) =>
        c[t.cle] > 0 ? (
          <div
            key={t.cle}
            style={{ background: t.fond, flexGrow: c[t.cle], flexBasis: 0 }}
          />
        ) : null,
      )}
    </div>
  );
}

/** Des graduations rondes (0, 1, 2… ou de 2 en 2) pour un maximum entier. */
function graduations(max: number): number[] {
  const pas = max <= 5 ? 1 : max <= 10 ? 2 : Math.ceil(max / 5);
  const haut = Math.ceil(max / pas) * pas;
  return Array.from({ length: haut / pas + 1 }, (_, i) => i * pas);
}

export function GraphiquesDesistements({
  detail,
  seances,
  lienPersonne,
}: {
  detail: DetailDesistements;
  /** Les séances de la fenêtre, dans l'ordre du calendrier (annulées exclues) */
  seances: ReadonlyArray<{ id: string; date: string; heureDebut: string }>;
  lienPersonne: (userId: string) => string;
}) {
  // 1. Par cours
  const parSeance = new Map(seances.map((s) => [s.id, vide()]));
  for (const l of detail.lignes) {
    const c = parSeance.get(l.sessionId);
    if (c) c[typeDe(l)] += 1;
  }
  const colonnes = seances.map((s) => ({
    ...s,
    c: parSeance.get(s.id) ?? vide(),
  }));
  const ticks = graduations(Math.max(1, ...colonnes.map((x) => total(x.c))));
  const maxCol = ticks[ticks.length - 1];

  // 2. Par personne (les dix premiers ; la liste complète est dans le détail)
  const parPersonne = new Map<string, { nom: string; c: Compte }>();
  for (const l of detail.lignes) {
    const p = parPersonne.get(l.userId) ?? { nom: l.nom, c: vide() };
    p.c[typeDe(l)] += 1;
    parPersonne.set(l.userId, p);
  }
  const barres = [...parPersonne.entries()]
    .map(([userId, p]) => ({ userId, ...p }))
    .sort(
      (a, b) =>
        total(b.c) - total(a.c) ||
        b.c.derniere - a.c.derniere ||
        a.nom.localeCompare(b.nom, "fr"),
    )
    .slice(0, 10);
  const maxBarre = Math.max(1, ...barres.map((b) => total(b.c)));
  // 2 bis. Le top de la dernière minute, à part (Delta : « un top des désistements, et de ceux de
  // dernière minute ») : seules les personnes qui en ont, rouge plein — une seule série, pas de légende.
  const barresDm = [...parPersonne.entries()]
    .map(([userId, p]) => ({ userId, nom: p.nom, n: p.c.derniere }))
    .filter((b) => b.n > 0)
    .sort((a, b) => b.n - a.n || a.nom.localeCompare(b.nom, "fr"))
    .slice(0, 10);
  const maxDm = Math.max(1, ...barresDm.map((b) => b.n));

  // 2 ter. Par jour de cours (mardi, vendredi…), tous cours confondus
  const creneaux = desistementsParCreneau(seances, detail.lignes);
  const maxCreneau = Math.max(1, ...creneaux.map((c) => c.desistements));

  // 3. À quel moment
  // Un « pas venu » n'a pas de délai : sa ligne à lui, en tête (la plus tardive des situations).
  const pasVenus = { libelle: "Pas venu, sans prévenir", c: vide() };
  const tranches = TRANCHES_DELAI.map((t) => ({
    libelle: t.libelle,
    c: vide(),
  }));
  for (const l of detail.lignes) {
    if (l.nonSignale) {
      pasVenus.c.nonsignale += 1;
      continue;
    }
    const i = TRANCHES_DELAI.findIndex((t, k) =>
      k === 0 ? l.avantCoursMin <= t.maxMin : l.avantCoursMin < t.maxMin,
    );
    tranches[i].c[typeDe(l)] += 1;
  }
  tranches.unshift(pasVenus);
  const maxTranche = Math.max(1, ...tranches.map((t) => total(t.c)));

  return (
    <div className="flex flex-col gap-4">
      <Carte titre="Désistements par cours">
        <div className="flex flex-col gap-3">
          <Legende />
          {/* Défilement de côté si les cours ne tiennent pas : jamais de colonne écrasée. Le conteneur
              est en `rtl` pour **s'ouvrir sur les cours les plus récents** (à droite) — c'est là que
              tombent les désistements ; le contenu, lui, reste dans le sens de lecture. */}
          <div className="overflow-x-auto" dir="rtl">
            <div className="relative flex min-w-max gap-0 pl-6 pt-6" dir="ltr">
              {/* Graduations : traits fins, recessifs, derrière les colonnes. */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 top-6 h-40"
              >
                {ticks.map((t) => (
                  <div
                    key={t}
                    className="absolute inset-x-0 flex translate-y-1/2 items-center gap-1"
                    style={{ bottom: `${(t / maxCol) * 100}%` }}
                  >
                    <span className="w-5 text-right text-xs tabular-nums text-texte-secondaire">
                      {t}
                    </span>
                    <span
                      className={`h-px flex-1 ${t === 0 ? "bg-texte-secondaire/50" : "bg-bordure/60"}`}
                    />
                  </div>
                ))}
              </div>
              {colonnes.map((x) => {
                const n = total(x.c);
                const nom = `${formatDateCourte(x.date)} ${formatHeure(x.heureDebut)} : ${n === 0 ? "aucun désistement" : phrase(x.c)}`;
                return (
                  <Link
                    key={x.id}
                    href={`/seances/${x.id}`}
                    title={nom}
                    aria-label={nom}
                    className="group flex w-9 shrink-0 flex-col items-center gap-1 no-underline"
                  >
                    <div className="relative flex h-40 w-6 items-end group-hover:opacity-80 group-focus-visible:opacity-80">
                      <Pile c={x.c} max={maxCol} sens="colonne" />
                      {/* La valeur sur la colonne : les graduations défilent hors de l'écran sur téléphone. */}
                      {n > 0 && (
                        <span
                          aria-hidden
                          className="absolute inset-x-0 text-center text-xs font-semibold tabular-nums text-texte"
                          style={{ bottom: `calc(${(n / maxCol) * 100}% + 2px)` }}
                        >
                          {n}
                        </span>
                      )}
                    </div>
                    <span className="text-xs tabular-nums text-texte-secondaire">
                      {x.date.slice(8, 10)}/{x.date.slice(5, 7)}
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      </Carte>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Carte titre="Top des désistements">
          {barres.length === 0 ? (
            <p className="text-texte-secondaire">Personne sur ces séances.</p>
          ) : (
            <div className="flex flex-col gap-3">
              <Legende />
              <ol className="flex flex-col gap-1">
                {barres.map((b) => {
                  const nom = `${b.nom} : ${phrase(b.c)}`;
                  return (
                    <li key={b.userId}>
                      <Link
                        href={lienPersonne(b.userId)}
                        title={nom}
                        aria-label={nom}
                        className="grid min-h-11 grid-cols-[minmax(6rem,9rem)_1fr_2rem] items-center gap-2 rounded no-underline hover:bg-surface-douce"
                      >
                        <span className="truncate text-sm text-texte">
                          {b.nom}
                        </span>
                        <span className="flex h-4 items-stretch">
                          <Pile c={b.c} max={maxBarre} sens="barre" />
                        </span>
                        <span className="text-right text-sm font-semibold tabular-nums text-texte">
                          {total(b.c)}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}
        </Carte>

        <Carte titre="Top des désistements de dernière minute">
          {barresDm.length === 0 ? (
            <p className="text-texte-secondaire">Aucun désistement de dernière minute sur ces séances.</p>
          ) : (
            <ol className="flex flex-col gap-1">
              {barresDm.map((b) => {
                const nom = `${b.nom} : ${b.n} désistement${b.n > 1 ? "s" : ""} de dernière minute`;
                return (
                  <li key={b.userId}>
                    <Link
                      href={`${lienPersonne(b.userId)}&type=derniere_minute`}
                      title={nom}
                      aria-label={nom}
                      className="grid min-h-11 grid-cols-[minmax(6rem,9rem)_1fr_2rem] items-center gap-2 rounded no-underline hover:bg-surface-douce"
                    >
                      <span className="truncate text-sm text-texte">{b.nom}</span>
                      <span className="flex h-4 items-stretch">
                        <span className="h-full rounded-r" style={{ width: `${(b.n / maxDm) * 100}%`, background: "var(--rouge)" }} />
                      </span>
                      <span className="text-right text-sm font-semibold tabular-nums text-texte">{b.n}</span>
                    </Link>
                  </li>
                );
              })}
            </ol>
          )}
        </Carte>

        <Carte titre="Par jour de cours">
          {creneaux.length === 0 ? (
            <p className="text-texte-secondaire">Aucun cours sur cette fenêtre.</p>
          ) : (
            <div className="flex flex-col gap-3">
              <Legende />
              <ol className="flex flex-col gap-1.5">
                {creneaux.map((c) => {
                  const compte: Compte = {
                    nonsignale: c.nonSignales,
                    derniere: c.derniereMinute,
                    signale: c.signales,
                    anticipe: c.desistements - c.nonSignales - c.derniereMinute - c.signales,
                  };
                  const moyenne = c.cours > 0 ? (c.desistements / c.cours).toLocaleString("fr-FR", { maximumFractionDigits: 1 }) : "0";
                  const nom = `${c.libelle} : ${c.desistements === 0 ? "aucun désistement" : phrase(compte)} sur ${c.cours} cours (${moyenne} par cours)`;
                  return (
                    <li key={c.cle} title={nom} aria-label={nom} className="grid min-h-11 grid-cols-[minmax(6rem,9rem)_1fr_auto] items-center gap-2">
                      <span className="flex flex-col leading-tight">
                        <span className="text-sm font-semibold">{c.libelle}</span>
                        <span className="text-xs text-texte-secondaire">
                          {c.cours} cours · {moyenne} par cours
                        </span>
                      </span>
                      <span className="flex h-4 items-stretch">
                        <Pile c={compte} max={maxCreneau} sens="barre" />
                      </span>
                      <span className="text-right text-sm font-semibold tabular-nums">{c.desistements}</span>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}
        </Carte>

        <Carte titre="À quel moment on se désiste">
          <ol className="flex flex-col gap-1.5">
            {tranches.map((t) => {
              const n = total(t.c);
              const nom = `${t.libelle} : ${n === 0 ? "aucun" : phrase(t.c)}`;
              return (
                <li
                  key={t.libelle}
                  title={nom}
                  aria-label={nom}
                  className="grid min-h-9 grid-cols-[minmax(7rem,9.5rem)_1fr_2rem] items-center gap-2"
                >
                  <span className="text-sm">{t.libelle}</span>
                  <span className="flex h-4 items-stretch">
                    <Pile c={t.c} max={maxTranche} sens="barre" />
                  </span>
                  <span className="text-right text-sm font-semibold tabular-nums">
                    {n}
                  </span>
                </li>
              );
            })}
          </ol>
        </Carte>
      </div>
    </div>
  );
}
