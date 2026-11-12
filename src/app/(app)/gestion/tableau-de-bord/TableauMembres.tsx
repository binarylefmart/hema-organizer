"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useDevoilement } from "@/components/seances/ListeRepliee";
import { libelleAfficher, libelleCompteur, LIBELLE_REPLIER, LIGNES_VISIBLES } from "@/components/seances/listes";
import { Bouton } from "@/components/ui/Bouton";
import { Icone } from "@/components/ui/Icone";

/** Une ligne du tableau : exactement ce que `statsPeriode` calcule pour une personne. */
export type MembreAssiduite = {
  id: string;
  prenom: string;
  nom: string;
  presents: number;
  absents: number;
  peutEtre: number;
  sansReponse: number;
  seances: number;
  pourcentage: number;
  /** Désistements de la personne sur ces séances (couple personne × séance), dont de dernière minute */
  desistements: number;
  derniereMinute: number;
};

/** Les quatre compteurs, écrits une fois : l'en-tête de colonne et l'intitulé de téléphone sont le même mot. */
/**
 * **La présence en une barre** : présent, peut-être, absent, sans réponse, dans cet ordre et dans les
 * couleurs des boutons de réponse. Elle se lit d'un coup d'œil ; les chiffres exacts sont écrits à côté
 * (jamais la couleur seule : contraste et daltonisme).
 */
const PARTS = [
  { cle: "presents", classe: "bg-vert", un: "présent", plusieurs: "présents" },
  { cle: "peutEtre", classe: "bg-ocre", un: "peut-être", plusieurs: "peut-être" },
  { cle: "absents", classe: "bg-rouge", un: "absent", plusieurs: "absents" },
  { cle: "sansReponse", classe: "bg-bordure", un: "sans réponse", plusieurs: "sans réponse" },
] as const satisfies readonly { cle: keyof MembreAssiduite; classe: string; un: string; plusieurs: string }[];

function BarrePresence({ m }: { m: MembreAssiduite }) {
  const total = PARTS.reduce((t, p) => t + m[p.cle], 0);
  const texte = PARTS.filter((p) => m[p.cle] > 0)
    .map((p) => `${m[p.cle]} ${m[p.cle] > 1 ? p.plusieurs : p.un}`)
    .join(" · ");
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex h-3 w-full overflow-hidden rounded bg-surface-douce" aria-hidden>
        {total > 0 && PARTS.map((p) => (m[p.cle] > 0 ? <div key={p.cle} className={p.classe} style={{ width: `${(m[p.cle] / total) * 100}%` }} /> : null))}
      </div>
      <span className="text-sm text-texte-secondaire">{texte || "aucun cours compté"}</span>
    </div>
  );
}

/**
 * `lienDesistements` est la **base** de l'adresse du détail, à laquelle on ajoute l'identifiant : une
 * chaîne et non une fonction, un composant client ne recevant du serveur que des données.
 */
export function TableauMembres({ membres, lienDesistements }: { membres: MembreAssiduite[]; lienDesistements: string }) {
  // Ce qu'on cherche. Le nombre de lignes dévoilées, lui, est tenu par le crochet partagé.
  const [filtre, setFiltre] = useState("");
  const [seulementDesistes, setSeulementDesistes] = useState(false);

  /**
   * **La recherche est toujours là**, même sous le seuil des vingt lignes (Delta : « simple, visible
   * et filtrable ») : c'est l'exception assumée à la règle du repli — le repli, lui, garde son seuil.
   */
  const trouves = useMemo(() => {
    const q = filtre.trim().toLowerCase();
    return membres.filter((m) => (!q || `${m.prenom} ${m.nom}`.toLowerCase().includes(q)) && (!seulementDesistes || m.desistements > 0));
  }, [membres, filtre, seulementDesistes]);
  const filtreActif = Boolean(filtre.trim()) || seulementDesistes;

  /*
   * **Le dévoilement porte sur ce qui est affiché**, c'est-à-dire sur le résultat de la recherche :
   * chercher « mar » dans quatre-vingts noms doit montrer les quatre Delta d'un coup, sans bouton,
   * et le compteur doit dire « 4 sur 4 » — pas « 20 sur 80 ».
   *
   * Les lignes de ce tableau sont des `<tr>` : elles ne peuvent pas passer par `ListeRepliee`, dont
   * le bouton vit dans un `<li>`. C'est donc le **crochet** qui est partagé, pas le composant — la
   * mécanique des tranches n'est écrite qu'une fois, ici comme ailleurs.
   */
  const { affichees, restantes, prochaine, auDebut, suivante, revenir } = useDevoilement(trouves.length);
  const lignes = trouves.slice(0, affichees);

  return (
    <div className="flex flex-col gap-3">
      {/* **Toujours là**, même pour un club de douze (Delta : « simple, visible et filtrable »). */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
        <label className="sr-only" htmlFor="recherche-assiduite">
          Chercher une personne
        </label>
        <input
          id="recherche-assiduite"
          type="search"
          value={filtre}
          onChange={(e) => setFiltre(e.target.value)}
          placeholder="Chercher un nom"
          autoComplete="off"
          className="min-h-12 w-full rounded-xl border-2 border-bordure bg-surface px-4 text-base shadow-champ focus:border-primaire sm:max-w-xs"
        />
        <label htmlFor="seulement-desistes" className="flex min-h-12 cursor-pointer items-center gap-3">
          <input id="seulement-desistes" type="checkbox" checked={seulementDesistes} onChange={(e) => setSeulementDesistes(e.target.checked)} className="size-6 shrink-0 accent-primaire" />
          <span>Seulement les personnes qui se sont désistées</span>
        </label>
      </div>
      <p className="-mt-1 text-sm text-texte-secondaire" aria-live="polite">
        {filtreActif ? `${trouves.length} personne${trouves.length > 1 ? "s" : ""} sur ${membres.length}` : `${membres.length} personne${membres.length > 1 ? "s" : ""}`}
      </p>

      {membres.length === 0 ? (
        <p className="text-texte-secondaire">Personne n&apos;est invité sur cette période.</p>
      ) : trouves.length === 0 ? (
        <p className="text-texte-secondaire">Personne ne correspond à ces filtres.</p>
      ) : (
        <div className="rounded-xl border border-bordure/60">
          <table className="block w-full border-collapse text-left md:table">
            {/* Collant sous l'en-tête de l'application (`h-20`), et en dessous d'elle dans la pile :
                l'en-tête du site porte `z-10`, celui du tableau se contente de 1. Le `sticky` est
                posé sur `<thead>` **et** sur chaque `<th>` : Safari ne l'a longtemps tenu que sur
                les cellules. */}
            <thead className="sticky top-20 z-[1] hidden bg-surface-douce text-sm uppercase tracking-wide text-texte-secondaire md:table-header-group">
              <tr>
                <th scope="col" className="sticky top-20 z-[1] bg-surface-douce px-3 py-2 font-semibold">
                  Membre
                </th>
                <th scope="col" className="sticky top-20 z-[1] bg-surface-douce px-3 py-2 font-semibold">
                  Présence
                </th>
                <th scope="col" className="sticky top-20 z-[1] bg-surface-douce px-3 py-2 text-right font-semibold">
                  Taux
                </th>
                <th scope="col" className="sticky top-20 z-[1] bg-surface-douce px-3 py-2 text-right font-semibold">
                  Désistements
                </th>
              </tr>
            </thead>
            <tbody className="block divide-y divide-bordure/60 md:table-row-group">
              {lignes.map((m) => (
                // Sur téléphone, la ligne est une petite grappe qui passe à la ligne : le nom sur
                // sa ligne (`basis-full`), puis les compteurs et le taux à la suite. Sur PC, c'est
                // une ligne de tableau ordinaire.
                <tr key={m.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-2 md:table-row md:p-0">
                  {/* **Un nom, pas un lien.** Il menait à la fiche du membre — partie dans l'espace
                      admin, et que l'instructeur qui lit ce tableau ne peut plus ouvrir. Un lien
                      qui refoule est pire qu'un nom en texte. */}
                  <td className="basis-full font-semibold md:table-cell md:basis-auto md:px-3 md:py-2.5 md:align-middle">
                    {m.prenom} {m.nom}
                  </td>
                  <td className="basis-full md:table-cell md:w-1/2 md:px-3 md:py-2.5 md:align-middle">
                    <BarrePresence m={m} />
                  </td>
                  {/* `whitespace-nowrap` : sans lui, « 100 % / 12 » passait à la ligne quand
                      « 0 % / 12 » tenait, et les lignes ondulaient sur toute la hauteur du tableau. */}
                  <td className="whitespace-nowrap tabular-nums md:table-cell md:px-3 md:py-2.5 md:text-right md:align-middle">
                    <strong>{m.pourcentage}&nbsp;%</strong> <span className="text-sm text-texte-secondaire">/ {m.seances}</span>
                  </td>
                  <td className="ml-auto whitespace-nowrap md:table-cell md:px-3 md:py-2.5 md:text-right md:align-middle">
                    {m.desistements === 0 ? (
                      <span className="text-sm text-texte-secondaire">aucun désistement</span>
                    ) : (
                      // Le nombre mène au détail de cette personne (page Désistements, filtres prêts).
                      <Link href={`${lienDesistements}${m.id}`} className="inline-flex min-h-11 items-center gap-1 font-semibold">
                        {m.desistements} désistement{m.desistements > 1 ? "s" : ""}
                        {m.derniereMinute > 0 && <span className="font-normal text-ocre">(dont {m.derniereMinute} de dernière minute)</span>}
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pas de bouton tant que tout tient : un club de douze retrouve son tableau entier, et une
          recherche qui tient sous le seuil aussi. `min-h-12` : ces boutons s'appuient plusieurs fois
          de suite pour descendre un tableau de quatre-vingts lignes. */}
      {trouves.length > LIGNES_VISIBLES && (
        <div className="flex flex-wrap items-center gap-2">
          {restantes > 0 && (
            <Bouton variante="secondaire" taille="petite" className="min-h-12 flex-1 basis-48" onClick={suivante}>
              <Icone nom="chevronBas" />
              {libelleAfficher(prochaine)}
            </Bouton>
          )}
          {!auDebut && (
            <Bouton variante="secondaire" taille="petite" className="min-h-12 flex-1 basis-32" onClick={revenir}>
              <Icone nom="chevronHaut" />
              {LIBELLE_REPLIER}
            </Bouton>
          )}
          {/* Monté avec les boutons, et non à la première pression : une zone `aria-live` qui
              apparaît en même temps que son contenu n'est pas annoncée. */}
          <p aria-live="polite" className="basis-full text-center text-sm tabular-nums text-texte-secondaire">
            {libelleCompteur(affichees, trouves.length)}
          </p>
        </div>
      )}
    </div>
  );
}
