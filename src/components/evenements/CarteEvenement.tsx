import type { ReactNode } from "react";
import Link from "next/link";
import { lienCarte } from "@/lib/dates";
import { identite } from "@/lib/identite";
import { LienBouton } from "@/components/ui/Bouton";
import { Icone } from "@/components/ui/Icone";
import { BandeauEvenement } from "./BandeauEvenement";
import { DescriptionEvenement } from "./DescriptionEvenement";
import {
  dateEvenement,
  dateEvenementCourte,
  horaireEvenement,
  horaireEvenementCourt,
  libelleDuree,
  libellePrix,
  proximite,
  type EvenementAffiche,
} from "./libelles";
import { Pastille } from "@/components/ui/Pastille";

type Props = {
  evenement: EvenementAffiche;
  aujourdHui: string;
  /** Événement déjà passé : l'inscription n'a plus d'objet, la carte se met en retrait */
  passe?: boolean;
};

/** Une ligne du bloc « quand / où / qui », icône à gauche, texte qui peut passer à la ligne. */
function Ligne({ icone, children }: { icone: "calendrier" | "lieu" | "groupe" | "sablier" | "etiquette"; children: ReactNode }) {
  return (
    <span className="flex items-start gap-2">
      <Icone nom={icone} taille={18} className="mt-0.5" />
      <span className="min-w-0">{children}</span>
    </span>
  );
}

/**
 * Une annonce du fil : l'affiche, le nom, quand, où, qui organise, ce que c'est, et comment s'y
 * inscrire.
 *
 * L'ordre suit la question qu'on se pose en faisant défiler — « c'est quoi ? », « c'est quand ? »,
 * « c'est où ? », « j'y vais ? ». L'inscription est le seul bouton plein de la carte : le lien vers
 * la publication d'origine reste discret, c'est une vérification, pas une action.
 *
 * Le lieu n'ouvre un plan que s'il y a une adresse pour le chercher — sans adresse, un lien de
 * carte tombe au hasard : on affiche alors le nom du lieu tel quel.
 *
 * Le nom mène à la page de l'événement : c'est là que vivent le texte entier et, pour l'équipe,
 * les gestes d'écriture — la carte, elle, reste une annonce qu'on parcourt.
 */
export async function CarteEvenement({ evenement: e, aujourdHui, passe = false }: Props) {
  // L'écu du club, pour le bandeau de repli quand l'événement n'a pas d'affiche : le bandeau est un
  // composant client, il ne lit pas la base. `identite()` est mise en cache pour la requête.
  const club = await identite();
  const horaire = horaireEvenement(e.heureDebut, e.heureFin);
  // La durée est annoncée à la main (un nombre, une unité) : elle peut ne pas coller aux dates de
  // début et de fin, et rien ne l'en empêche. On affiche ce qui a été saisi, on ne le calcule pas.
  const duree = libelleDuree(e.dureeNombre, e.dureeUnite);
  const quand = passe ? null : proximite(aujourdHui, e.dateDebut);
  const brouillon = e.publie === false;
  // Les deux lignes de la carte resserrée du téléphone : « quand · où », puis « combien de temps ·
  // combien ». Le plan et l'organisateur restent sur la fiche, à un toucher du titre.
  const ligneQuand = [dateEvenementCourte(e.dateDebut, e.dateFin, aujourdHui), horaireEvenementCourt(e.heureDebut, e.heureFin), e.lieu]
    .filter(Boolean)
    .join("\u00a0· ");
  const ligneCombien = [duree, libellePrix(e.prix, e.prixAdherent, { court: true })].filter(Boolean).join("\u00a0· ");
  return (
    /*
     * **La carte est un conteneur, et ses découpes internes le mesurent — jamais la fenêtre**.
     * Depuis que le fil se range en deux colonnes, cette carte vaut **358 px** sur un téléphone,
     * **480** à 1 024, **608** à 1 280 et **712** à 1 920 : un palier `sm:` y répondrait sur la foi
     * de la fenêtre à une question qui porte sur la carte, et c'est le piège que `CLAUDE.md` nomme
     * en toutes lettres. D'où `@container` ici, et `@sm:` / `@md:` plus bas.
     *
     * **`flex flex-col` + `flex-1` + `mt-auto` : le bouton reste en bas.** Une grille étire les
     * cartes d'une même rangée à la même hauteur (`stretch`, et surtout pas `items-start` — « ne
     * fais pas de trous ») ; sans ces trois classes, l'`<article>` était bien étiré mais son
     * contenu restait collé en haut, et « S'inscrire » flottait au milieu du vide de la carte la
     * plus courte. Sur un téléphone, une rangée ne contient qu'une carte : il n'y a aucune hauteur
     * en trop à distribuer, et l'affichage est **identique au pixel**.
     */
    <article
      aria-label={e.nom}
      className={`@container flex flex-col overflow-hidden rounded-2xl border bg-surface shadow-carte motion-safe:transition-shadow hover:shadow-carte-survol ${
        brouillon ? "border-ocre/50" : quand ? "border-primaire/50" : "border-bordure/60"
      } ${passe ? "opacity-90" : ""}`}
    >
      <BandeauEvenement src={e.imageUrl} nom={e.nom} ecu={club.ecu} resserre />
      <div className="flex flex-1 flex-col gap-2 p-4 ordi:gap-3 @sm:p-5">
        <header className="flex flex-col gap-2">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
            <h2 className="min-w-0 text-xl font-bold">
              <Link href={`/evenements/${e.id}`} className="text-texte no-underline hover:underline">
                {e.nom}
              </Link>
            </h2>
            {/* Un seul marqueur à la fois : le brouillon prime, c'est l'état qui demande une décision */}
            {brouillon ? <Pastille ton="ocre">Brouillon</Pastille> : quand && <Pastille ton="primaire">{quand}</Pastille>}
          </div>
          {/*
           * **En version téléphone, la carte se resserre** : les infos pratiques tiennent en
           * deux lignes de texte, sans icônes. La bascule est en CSS — le serveur rend les deux
           * blocs, la fenêtre choisit — puisqu'il n'y a ici aucun champ de formulaire à ne pas
           * doubler. Sur ordinateur, rien ne change.
           */}
          <p className="flex flex-col text-texte-secondaire ordi:hidden" data-infos-resserrees>
            <span className="font-semibold text-texte">{ligneQuand}</span>
            <span>{ligneCombien}</span>
          </p>
          <p className="hidden flex-col gap-1 text-texte-secondaire ordi:flex">
            <Ligne icone="calendrier">
              <span className="font-semibold text-texte">{dateEvenement(e.dateDebut, e.dateFin)}</span>
              {horaire && <span className="block">{horaire}</span>}
            </Ligne>
            {e.lieu &&
              (e.adresse ? (
                <a
                  href={lienCarte(e.lieu, e.adresse)}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`${e.adresse} — ouvrir la carte`}
                  className="inline-flex min-h-12 items-start gap-2 self-start text-lien underline decoration-lien/40 hover:decoration-lien"
                >
                  <Icone nom="lieu" taille={18} className="mt-0.5" />
                  <span className="min-w-0">{e.lieu}</span>
                </a>
              ) : (
                <Ligne icone="lieu">{e.lieu}</Ligne>
              ))}
            {e.organisateur && <Ligne icone="groupe">Organisé par {e.organisateur}</Ligne>}
            {/* Deux informations courtes : une seule ligne à elles deux tant que la place le permet.
                Le prix est toujours là — vide veut dire « Gratuit », pas « on ne sait pas ». */}
            <span className="flex flex-wrap items-start gap-x-4 gap-y-1">
              {duree && <Ligne icone="sablier">{duree}</Ligne>}
              <Ligne icone="etiquette">{libellePrix(e.prix, e.prixAdherent)}</Ligne>
            </span>
          </p>
        </header>

        {e.description && <DescriptionEvenement texte={e.description} />}

        {/* S'inscrire d'abord (plein), la publication d'origine ensuite (discrète). `mt-auto` colle
            la rangée au bas de la carte : dans une rangée de deux, la carte la plus courte garde son
            bouton aligné sur celui de sa voisine. */}
        {(e.lienInscription || e.lienSource) && (
          <div className="mt-auto flex flex-wrap items-center gap-2">
            {e.lienInscription && !passe && (
              <LienBouton href={e.lienInscription} target="_blank" rel="noopener noreferrer" className="w-full @md:w-auto">
                S&apos;inscrire
                <Icone nom="lienExterne" taille={18} />
              </LienBouton>
            )}
            {e.lienSource && (
              <LienBouton href={e.lienSource} target="_blank" rel="noopener noreferrer" variante="discret" taille="petite">
                Voir la publication
                <Icone nom="lienExterne" taille={16} />
              </LienBouton>
            )}
          </div>
        )}

      </div>
    </article>
  );
}
