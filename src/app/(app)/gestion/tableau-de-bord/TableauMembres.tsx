"use client";

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
};

/** Les quatre compteurs, écrits une fois : l'en-tête de colonne et l'intitulé de téléphone sont le même mot. */
const COMPTEURS = [
  { cle: "presents", libelle: "Présent" },
  { cle: "absents", libelle: "Absent" },
  { cle: "peutEtre", libelle: "Peut-être" },
  { cle: "sansReponse", libelle: "Sans réponse" },
] as const satisfies readonly { cle: keyof MembreAssiduite; libelle: string }[];

/**
 * **Le tableau « Taux par membre », tenable à quatre-vingts lignes.**
 *
 * Les captures d'un club de quatre-vingts ont montré trois choses, et ce composant répond aux
 * trois :
 *
 * - **Tout sortait d'un coup** : 4 600 px de tableau sur PC, et sur téléphone une fiche par
 *   personne d'environ 240 px — vingt-trois écrans de défilement. D'où la **recherche** (le champ
 *   de `PresencesEquipe`, même patron, filtrage dans le navigateur puisque tout est déjà chargé) et
 *   le **dévoilement par tranches** des listes de l'application (`LIGNES_VISIBLES` : vingt lignes de
 *   plus par appui, « Afficher les 20 suivantes », un compteur « 20 sur 80 », « Replier » qui
 *   ramène aux vingt premières). Les deux n'apparaissent **qu'au-delà du seuil** : un club de douze
 *   retrouve son tableau entier, sans champ ni bouton.
 * - **L'en-tête ne collait pas** : passé la dixième ligne, les colonnes n'étaient plus que des
 *   chiffres sans titre. Il colle désormais sous l'en-tête de l'application (`md:top-20`, la
 *   hauteur de la barre `h-20`).
 * - **La fiche de téléphone était verbeuse** : cinq lignes « intitulé / valeur », dont quatre
 *   pleines de zéros. Ici, la ligne de téléphone tient en deux lignes — le nom, puis les compteurs
 *   et le taux à la suite.
 *
 * **Pourquoi un tableau écrit ici plutôt que `<Tableau>`** : la brique partagée enferme le tableau
 * dans un conteneur `md:overflow-x-auto`, qui est un conteneur de défilement — un `<thead>` collant
 * y colle au haut d'une boîte qui ne défile pas, c'est-à-dire nulle part. Et sa retombée de
 * téléphone est justement la fiche à cinq lignes qu'on veut resserrer. Les lignes restent des
 * `<tr>` de tableau : c'est bien un tableau, avec ses en-têtes de colonnes et ses six colonnes sur
 * PC.
 */
export function TableauMembres({ membres }: { membres: MembreAssiduite[] }) {
  // Ce qu'on cherche. Le nombre de lignes dévoilées, lui, est tenu par le crochet partagé.
  const [filtre, setFiltre] = useState("");

  /**
   * **Ni recherche ni repli tant que le tableau se lit d'un coup d'œil.** C'est la règle de toute
   * l'application, et le seuil est le même partout : un club de douze ne doit rien voir changer.
   */
  const longue = membres.length > LIGNES_VISIBLES;

  const trouves = useMemo(() => {
    const q = filtre.trim().toLowerCase();
    if (!q) return membres;
    return membres.filter((m) => `${m.prenom} ${m.nom}`.toLowerCase().includes(q));
  }, [membres, filtre]);

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
      {longue && (
        <div>
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
            className="min-h-12 w-full rounded-xl border-2 border-bordure bg-surface px-4 text-base shadow-champ focus:border-primaire"
          />
          <p className="mt-1 text-sm text-texte-secondaire" aria-live="polite">
            {filtre.trim() ? `${trouves.length} personne${trouves.length > 1 ? "s" : ""} sur ${membres.length}` : `${membres.length} personnes`}
          </p>
        </div>
      )}

      {membres.length === 0 ? (
        <p className="text-texte-secondaire">Personne n&apos;est invité sur cette période.</p>
      ) : trouves.length === 0 ? (
        <p className="text-texte-secondaire">Aucun nom ne correspond à cette recherche.</p>
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
                {COMPTEURS.map((c) => (
                  <th key={c.cle} scope="col" className="sticky top-20 z-[1] bg-surface-douce px-3 py-2 font-semibold">
                    {c.libelle}
                  </th>
                ))}
                <th scope="col" className="sticky top-20 z-[1] bg-surface-douce px-3 py-2 text-right font-semibold">
                  Taux
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
                  {COMPTEURS.map((c) => (
                    <td key={c.cle} className="text-sm md:table-cell md:px-3 md:py-2.5 md:align-middle md:text-base">
                      {/* L'intitulé n'existe que sur téléphone, où il n'y a pas d'en-tête de colonne :
                          « présents 9 absents 2 » se lit d'un trait, là où cinq lignes
                          « intitulé / valeur » prenaient un quart d'écran par personne. */}
                      <span className="text-texte-secondaire md:hidden">{c.libelle.toLowerCase()} </span>
                      <span className="tabular-nums">{m[c.cle]}</span>
                    </td>
                  ))}
                  {/* `whitespace-nowrap` : sans lui, « 100 % / 12 » passait à la ligne quand
                      « 0 % / 12 » tenait, et les lignes ondulaient sur toute la hauteur du tableau. */}
                  <td className="whitespace-nowrap tabular-nums md:table-cell md:px-3 md:py-2.5 md:text-right md:align-middle">
                    <strong>{m.pourcentage} %</strong> <span className="text-sm text-texte-secondaire">/ {m.seances}</span>
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
