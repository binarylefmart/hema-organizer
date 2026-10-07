"use client";

import { Fragment, useEffect, useState, type ReactNode } from "react";
import { Bouton } from "@/components/ui/Bouton";
import { EntreeVolet } from "@/components/ui/GestesVolet";
import { GestesProposes, type GestePret } from "@/components/ui/GestesProposes";
import { Icone, type NomIcone } from "@/components/ui/Icone";
import { VoletBas } from "@/components/ui/VoletBas";
import { useEcranTelephone } from "@/components/ui/useEcranTelephone";

/** Une rubrique du volet : son entrée dans la liste, et ce qu'elle ouvre — un formulaire existant, rangé. */
export type Rubrique = { cle: string; libelle: string; contenu: ReactNode };

/**
 * **Au téléphone, l'annuaire range ses formulaires et ses gestes rares dans un volet du bas**
 * (`VoletBas`) : « + Ajouter » sur la liste (une personne, un fichier CSV, les gestes sur tout le
 * club), « ⋯ » sur la fiche d'une personne (son nom et son adresse, le bureau, puis les gestes de
 * « Que veux-tu faire ? »).
 *
 * - **sans rien choisi**, les rubriques en gros boutons, puis les gestes (`GestesProposes` présenté en
 *   volet : mêmes gestes, mêmes confirmations, rouges pour ce qui enlève quelque chose) ;
 * - **une rubrique choisie**, son contenu tel que l'écran le rend sur ordinateur — on range les
 *   formulaires, on ne les réécrit pas — et « ‹ Retour » revient à la liste.
 *
 * Le déclencheur est `ordi:hidden` : sur ordinateur, ces formulaires et ces gestes restent à leur place
 * dans la page, et ce composant ne montre rien. Le volet ne se rend que tant qu'il est ouvert : son
 * contenu n'est donc jamais dans la page en même temps que celui de l'ordinateur (`HorsTelephone`) —
 * deux formulaires aux mêmes `id` feraient viser au libellé le mauvais champ.
 */
export function RubriquesVolet({
  libelle,
  icone,
  variante,
  libelleAccessible,
  iconeSeule = false,
  titre,
  rubriques,
  gestes = [],
  idGestes,
  enTeteGestes,
  ancre,
  className = "",
}: {
  libelle: string;
  icone: NomIcone;
  variante: "primaire" | "secondaire";
  /** Le nom du bouton pour le lecteur d'écran, quand il n'est qu'un pictogramme (« ⋯ »). */
  libelleAccessible?: string;
  iconeSeule?: boolean;
  titre: string;
  rubriques: readonly Rubrique[];
  gestes?: readonly GestePret[];
  idGestes?: string;
  /**
   * Ce qui précède la liste des gestes (leur intitulé, leur portée). Le composant le pose lui-même sous
   * une clé : sans elle, React signale cet élément venu du serveur comme un enfant de liste sans clé,
   * et la page n'a plus à s'en souvenir.
   */
  enTeteGestes?: ReactNode;
  /**
   * L'ancre qui visait la carte de l'ordinateur (`/admin/membres#ajouter`, depuis « Comptes admin ») :
   * au téléphone, elle ouvre le volet sur sa rubrique — la carte n'y est plus.
   */
  ancre?: { id: string; cle: string };
  className?: string;
}) {
  const telephone = useEcranTelephone();
  const [ouvert, setOuvert] = useState(false);
  const [cle, setCle] = useState<string | null>(null);
  const idAncre = ancre?.id;
  const cleAncre = ancre?.cle;
  useEffect(() => {
    if (!telephone || !idAncre || !cleAncre) return;
    const viser = () => {
      if (window.location.hash !== `#${idAncre}`) return;
      setCle(cleAncre);
      setOuvert(true);
    };
    viser();
  }, [telephone, idAncre, cleAncre]);
  const choisie = rubriques.find((r) => r.cle === cle) ?? null;

  const liste = (
    <>
      {rubriques.length > 0 && (
        <ul className="flex flex-col gap-2">
          {rubriques.map((r) => (
            <li key={r.cle}>
              <EntreeVolet libelle={r.libelle} onClick={() => setCle(r.cle)} />
            </li>
          ))}
        </ul>
      )}
      {gestes.length > 0 && <Fragment key="en-tete-gestes">{enTeteGestes}</Fragment>}
    </>
  );

  return (
    <>
      <Bouton
        type="button"
        variante={variante}
        aria-haspopup="dialog"
        aria-label={libelleAccessible}
        onClick={() => {
          setCle(null);
          setOuvert(true);
        }}
        className={`ordi:hidden ${className}`}
      >
        <Icone
          nom={icone}
          taille={iconeSeule ? 24 : 20}
          strokeWidth={iconeSeule ? 3 : undefined}
        />
        {!iconeSeule && libelle}
      </Bouton>
      <VoletBas
        ouvert={telephone && ouvert}
        titre={titre}
        onFermer={() => setOuvert(false)}
      >
        {choisie ? (
          <>
            <Bouton
              type="button"
              variante="discret"
              taille="petite"
              className="-ml-2 self-start"
              onClick={() => setCle(null)}
            >
              <span aria-hidden>‹</span> Retour
            </Bouton>
            <h3 className="text-lg font-bold">{choisie.libelle}</h3>
            {choisie.contenu}
          </>
        ) : gestes.length > 0 ? (
          <GestesProposes
            id={idGestes ?? "gestes-volet"}
            gestes={gestes}
            presentation="volet"
            note={liste}
          />
        ) : (
          liste
        )}
      </VoletBas>
    </>
  );
}

/**
 * **Ce qui ne vit que sur ordinateur et tablette** quand le téléphone le range ailleurs (le volet
 * ci-dessus). Le serveur rend la version que le cookie `ecran` lui a dite (l'ordinateur à la première
 * visite), et le navigateur corrige au montage s'il le faut (`useEcranTelephone`) — un seul exemplaire
 * d'un formulaire dans la page, jamais deux.
 */
export function HorsTelephone({ children }: { children: ReactNode }) {
  return useEcranTelephone() ? null : <>{children}</>;
}
