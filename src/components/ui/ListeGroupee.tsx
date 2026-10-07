"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useId, useState, type ReactNode } from "react";
import { Icone, type NomIcone } from "./Icone";
import { REQUETE_TELEPHONE } from "./ecran";

/**
 * **La liste groupée du téléphone**, façon Réglages du téléphone — une seule écriture pour tous les
 * écrans qui rangent leurs entrées en lignes : le menu de l'espace admin, « Mon profil », la fiche
 * d'un membre, les périodes, les canaux de notification. Mêmes hauteurs (56 px au moins), même
 * typographie, même chevron, même résumé à droite : un bureau qui apprend la ligne sur un écran la
 * retrouve sur les autres.
 *
 * - `GroupeListe` : des lignes sous un intitulé (« Mon compte », « Saison 2026-2027 »…) ;
 * - `LigneLien` : une ligne qui **mène à une page** (chevron vers la droite) ;
 * - `LigneDepliable` : une ligne qui **déplie son contenu juste en dessous** (chevron vers le bas,
 *   `aria-expanded`), dans une `ListeGroupee` qui n'en laisse qu'une ouverte et que les ancres ouvrent.
 *
 * **La forme ordinateur d'une ligne dépliable est son contenu.** Dans un groupe `fonduSurOrdinateur`,
 * la bascule est en CSS : le bouton de la ligne est `ordi:hidden`, le contenu vit dans un bloc
 * `tel:hidden` tant qu'il est replié, et le groupe passe en `ordi:contents` — les cartes redeviennent
 * les enfants directs de leur pile, comme si la liste n'existait pas. Un contenu replié reste donc
 * **dans le DOM** (ses champs, ses effets, son ancre), il n'est que caché : aucun formulaire n'est
 * rendu deux fois.
 *
 * **Les ancres ouvrent leur ligne.** `/profil#securite` part de liens, de redirections et d'emails :
 * à l'arrivée, puis à chaque changement d'ancre, on cherche l'élément visé, on ouvre la ligne qui le
 * contient et on la fait défiler jusqu'en haut. Le navigateur ne le fait pas seul — on ne défile pas
 * jusqu'à un élément caché.
 */

/** Les classes d'une ligne, sans ses marges latérales : la matrice des notifications les reprend. */
export const CLASSE_LIGNE =
  "flex min-h-14 w-full items-center gap-3 py-2 text-left text-texte no-underline hover:bg-surface-douce focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-jauge";

/** L'intérieur d'une ligne : pictogramme, titre (et sa précision), résumé à droite, chevron. */
export function ContenuLigne({
  icone,
  titre,
  detail,
  resume,
  sens,
  ouvert = false,
}: {
  icone?: NomIcone;
  titre: ReactNode;
  /** Une seconde ligne sous le titre (les dates d'une période). */
  detail?: ReactNode;
  /** L'état de la ligne en un mot ou une pastille, à droite. */
  resume?: ReactNode;
  /** `lien` : la ligne mène ailleurs (›) ; `deplier` : elle déplie sous elle (⌄, retourné ouvert). */
  sens: "lien" | "deplier";
  ouvert?: boolean;
}) {
  return (
    <>
      {icone && (
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primaire/10 text-primaire">
          <Icone nom={icone} taille={20} />
        </span>
      )}
      <span className="min-w-0 flex-1 font-semibold">
        {titre}
        {detail && <span className="block font-normal text-texte-secondaire">{detail}</span>}
      </span>
      {resume != null && resume !== "" && <span className="max-w-[45%] shrink-0 text-right text-texte-secondaire">{resume}</span>}
      <Icone
        nom="chevronBas"
        taille={22}
        className={`shrink-0 text-texte-secondaire motion-safe:transition ${sens === "lien" ? "-rotate-90" : ouvert ? "rotate-180" : ""}`}
      />
    </>
  );
}

type Etat = { ouverte: string | null; basculer: (ancre: string) => void };

const ContexteListe = createContext<Etat | null>(null);

/** La ligne qui contient l'élément visé par une ancre (`#securite`), s'il y en a une. */
function ligneVisee(ancre: string): HTMLElement | null {
  // Une ancre mal encodée (`#%`, un lien réécrit par une messagerie) est ignorée : `decodeURIComponent`
  // lèverait, et la page tomberait sur l'écran d'erreur pour un lien qui ne vise rien.
  let id = "";
  try {
    id = decodeURIComponent(ancre.replace(/^#/, ""));
  } catch {
    return null;
  }
  if (!id) return null;
  return document.getElementById(id)?.closest<HTMLElement>("[data-ligne-depliable]") ?? null;
}

/**
 * **L'état des lignes dépliables** : une seule ouverte, et l'ancre de l'adresse ouvre la sienne. Une
 * liste qui n'a que des liens n'en a pas besoin.
 */
export function ListeGroupee({ ouverteInitiale = null, children }: { ouverteInitiale?: string | null; children: ReactNode }) {
  // `undefined` tant que personne n'a rien touché : c'est alors le serveur qui dit quelle ligne est
  // ouverte (une erreur de « Sécuriser mon compte » l'ouvre d'office), sans état semé à suivre.
  const [choisie, setOuverte] = useState<string | null | undefined>(undefined);
  const ouverte = choisie === undefined ? ouverteInitiale : choisie;
  // La ligne à faire défiler une fois dépliée : le défilement attend le rendu qui l'a rendue visible.
  const [aViser, setAViser] = useState<string | null>(null);

  useEffect(() => {
    const suivreAncre = (ancreVisee = window.location.hash) => {
      const ligne = ligneVisee(ancreVisee);
      const ancre = ligne?.dataset.ligneDepliable;
      if (!ancre) return;
      setOuverte(ancre);
      setAViser(ancre);
    };
    suivreAncre();
    const surAncre = () => suivreAncre();
    window.addEventListener("hashchange", surAncre);
    // Un lien interne de Next (`<Link href="/profil#lien">`) change l'ancre par l'historique, sans
    // `hashchange` : on lit donc l'ancre du lien touché lui-même, s'il vise cette page — y compris
    // quand c'est déjà l'ancre de l'adresse et que la ligne a été refermée entre-temps.
    const surClic = (e: MouseEvent) => {
      const lien = e.target instanceof Element ? e.target.closest<HTMLAnchorElement>('a[href*="#"]') : null;
      if (!lien) return;
      const cible = new URL(lien.href, window.location.href);
      if (cible.pathname === window.location.pathname && cible.hash) setTimeout(() => suivreAncre(cible.hash), 0);
    };
    document.addEventListener("click", surClic);
    return () => {
      window.removeEventListener("hashchange", surAncre);
      document.removeEventListener("click", surClic);
    };
  }, []);

  useEffect(() => {
    if (!aViser) return;
    setAViser(null);
    // Sur ordinateur, le contenu était déjà visible et le navigateur a déjà fait le chemin.
    if (!window.matchMedia(REQUETE_TELEPHONE).matches) return;
    document.querySelector<HTMLElement>(`[data-ligne-depliable="${aViser}"]`)?.scrollIntoView({ block: "start" });
  }, [aViser]);

  const basculer = (ancre: string) => setOuverte(ouverte === ancre ? null : ancre);
  return <ContexteListe.Provider value={{ ouverte, basculer }}>{children}</ContexteListe.Provider>;
}

/**
 * Des lignes sous leur intitulé. `fonduSurOrdinateur` : l'intitulé et le cadre n'existent qu'en
 * version téléphone, et sur ordinateur les contenus redeviennent les enfants de la page.
 */
export function GroupeListe({ titre, fonduSurOrdinateur = false, children }: { titre: string; fonduSurOrdinateur?: boolean; children: ReactNode }) {
  const id = useId();
  return (
    <div className={`flex flex-col gap-2 ${fonduSurOrdinateur ? "ordi:contents" : ""}`} data-groupe-liste={titre}>
      <p id={id} className={`px-1 text-base font-semibold uppercase tracking-wide text-texte-secondaire ${fonduSurOrdinateur ? "ordi:hidden" : ""}`}>
        {titre}
      </p>
      <div
        role="group"
        aria-labelledby={id}
        className={`overflow-hidden rounded-2xl border border-bordure/60 bg-surface shadow-carte ${
          fonduSurOrdinateur ? "tel:divide-y tel:divide-bordure/60 ordi:contents" : "divide-y divide-bordure/60"
        }`}
      >
        {children}
      </div>
    </div>
  );
}

/** Une ligne qui mène à une page. `nomAccessible` précède le titre pour le lecteur d'écran (« Configurer »). */
export function LigneLien({
  href,
  icone,
  titre,
  detail,
  resume,
  nomAccessible,
}: {
  href: string;
  icone?: NomIcone;
  titre: ReactNode;
  detail?: ReactNode;
  resume?: ReactNode;
  nomAccessible?: string;
}) {
  return (
    <Link href={href} className={`${CLASSE_LIGNE} px-4`}>
      <ContenuLigne
        icone={icone}
        titre={
          <>
            {nomAccessible && <span className="sr-only">{nomAccessible} </span>}
            {titre}
          </>
        }
        detail={detail}
        resume={resume}
        sens="lien"
      />
    </Link>
  );
}

/**
 * Une ligne qui déplie son contenu (version téléphone) ; sur ordinateur, le contenu seul.
 *
 * `ancre` est celle du contenu qu'elle range (`securite`, `lien`…) : c'est elle que les liens visent,
 * et c'est par elle qu'une ancre retrouve sa ligne.
 */
export function LigneDepliable({
  ancre,
  icone,
  titre,
  resume,
  children,
}: {
  ancre: string;
  icone?: NomIcone;
  titre: string;
  resume?: ReactNode;
  children: ReactNode;
}) {
  const etat = useContext(ContexteListe);
  const ouvert = etat?.ouverte === ancre;
  const idCorps = `ligne-${ancre}`;
  return (
    <div data-ligne-depliable={ancre} className="scroll-mt-20">
      <button
        type="button"
        aria-expanded={ouvert}
        aria-controls={idCorps}
        onClick={() => etat?.basculer(ancre)}
        className={`${CLASSE_LIGNE} px-4 ordi:hidden`}
      >
        <ContenuLigne icone={icone} titre={titre} resume={resume} sens="deplier" ouvert={ouvert} />
      </button>
      <div id={idCorps} className={ouvert ? "tel:px-2 tel:pb-2" : "tel:hidden"}>
        {children}
      </div>
    </div>
  );
}
