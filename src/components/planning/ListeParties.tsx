"use client";

import { useState, useTransition } from "react";
import { ajouterPartie, deplacerPartie, retirerPartie } from "@/actions/planning";
import type { CasePlanning } from "@/lib/planning";
import { Icone } from "@/components/ui/Icone";
import { Bouton } from "@/components/ui/Bouton";
import { couleurPartie } from "@/components/seances/programme-cours";
import { CaseEditeur } from "./CaseEditeur";
import { useOptionsCase } from "./ContexteOptions";
import { champsLus } from "./options";

/**
 * **Les parties d'une séance, dans l'ordre, et les gestes qui les font bouger.**
 *
 * C'est le cœur de la refonte : le planning n'est plus un tableau à quatre colonnes figées, mais
 * une carte par séance qui liste **ses** parties. Deux séances n'ont donc plus forcément le même
 * nombre de parties — c'était le but.
 *
 * **Le nom d'une partie ne se saisit plus**. Il s'affiche, en tête de la ligne, et se **calcule**
 * depuis le rang de la partie dans sa nature (`libellePartie`, tenu à jour par `rangerParties`).
 * Ont disparu avec le champ : le formulaire de renommage, le module qui rattrapait Échap
 * (`renommage.ts`), l'avertissement « ce nom est publié » — reporté sur la **description**, qui est
 * le seul texte que quelqu'un écrit ici — et la saisie d'un nom à l'ajout. Ce qui décrit la partie,
 * ce sont ses informations : instructeur, thème, niveau, description.
 *
 * Le même composant sert la carte du planning et l'écran d'une séance : il n'y a qu'un seul endroit
 * où une partie se règle, se déplace, change de nature ou se retire.
 *
 * **Vider une case n'est pas retirer une partie.** Effacer l'instructeur et le thème laisse la
 * partie en place, vide, prête à être remplie — c'est le cas courant en début de trimestre. Retirer
 * la partie, c'est dire que la séance n'en compte plus autant : le geste est rare, irréversible, et
 * demande donc une confirmation.
 *
 * **On réordonne en montant et en descendant, pas en glissant.** Cet écran se tient surtout sur un
 * téléphone, souvent debout dans une salle : un glisser-déposer y est une loterie, et il n'a aucun
 * équivalent au clavier. Deux boutons disent exactement ce qu'ils font, marchent au doigt comme à la
 * tabulation, et ne peuvent pas « lâcher » au mauvais endroit.
 */
export function ListeParties({ sessionId, parties, compact = false }: { sessionId: string; parties: CasePlanning[]; compact?: boolean }) {
  const { modifiable } = useOptionsCase();
  if (parties.length === 0 && !modifiable) return <p className="text-texte-secondaire">Programme à venir.</p>;
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-2">
        {parties.map((partie, rang) => {
          /*
           * **En lecture, une partie qui n'a rien à dire ne montre pas son étiquette.**
           *
           * `CaseEditeur` ne rend rien lorsqu'il n'y a aucun champ à lire (`champsLus`), et
           * l'étiquette de couleur restait alors seule au milieu de la carte : un « 2e option »
           * rouille suivi de rien, qui se lit comme un affichage tronqué. Le cas n'est pas
           * théorique — une partie qui ne porte qu'un **second** instructeur, sans premier (donnée
           * héritée, ou import), passe le filtre d'amont (`caseVide` la voit remplie) et n'affiche
           * pourtant personne, puisqu'un second sans premier n'assiste personne. Côté encadrement,
           * au contraire, l'étiquette reste : c'est la poignée qui sert à renommer ou retirer la
           * partie, et c'est justement une partie vide qu'on vient remplir.
           */
          if (!modifiable && !partie.atelier && champsLus(partie).length === 0) return null;
          return (
            <li key={partie.id} className="flex min-w-0 flex-col gap-1">
              {modifiable ? (
                <ReglagesPartie partie={partie} premiere={rang === 0} derniere={rang === parties.length - 1} />
              ) : (
                // En lecture, le libellé est une simple étiquette : rien à régler, rien à annoncer
                <span className={`self-start rounded-lg px-2 py-1 text-sm font-semibold ${couleurPartie(partie)}`}>{partie.libelle}</span>
              )}
              <CaseEditeur sessionId={sessionId} valeur={partie} compact={compact} discret={partie.estOption} />
            </li>
          );
        })}
      </ul>
      {modifiable && <AjouterPartie sessionId={sessionId} />}
    </div>
  );
}

/**
 * Ce qui agit sur la partie **entière** — sa nature, sa place, son existence — rassemblé sur la ligne
 * de titre, au-dessus des champs qui, eux, décrivent son contenu.
 *
 * C'est le partage qui se retient : la ligne de titre, c'est la poignée de la partie ; en dessous, ce
 * qu'on y met. Les mêmes droits qu'une case suffisent pour les deux — quelqu'un qui peut écrire qui
 * encadre le « Cours 2 » peut décider qu'il y en a un troisième.
 *
 * **Le nom est écrit, il n'est plus tapé**. Il y avait ici un champ texte de quarante signes, son
 * avertissement de publication, son garde-fou d'Échap et son miroir de la valeur du serveur — tout
 * cela pour une valeur que personne ne changeait jamais et que le code sait calculer. Reste
 * l'étiquette, à la couleur de la partie : c'est le seul endroit où son nom s'écrit, et il dit
 * exactement le rang que la partie occupe dans sa série.
 */
function ReglagesPartie({ partie, premiere, derniere }: { partie: CasePlanning; premiere: boolean; derniere: boolean }) {
  // Un seul verrou et un seul message pour les quatre gestes de la ligne : ils portent tous sur la
  // même partie, ils ne peuvent donc pas se chevaucher, et un échec se dit une fois.
  const [enVol, start, erreur] = useActionPartie();
  /*
   * **Un atelier occupe la partie : deux des quatre gestes n'existent pas**. Le serveur refuse le
   * retrait (« déprogramme-le d'abord ») et refuse désormais aussi le changement de nature — un
   * atelier occupe une option, et le faire atterrir dans « Cours 3 » était publié tel quel par
   * l'API et les pages de partage.
   *
   * L'écran les retirait-il ? Non : la croix « Retirer » s'affichait avec sa confirmation alarmante
   * (« son instructeur, son thème et sa description seront perdus »), on confirmait la perte, puis le
   * serveur refusait. Un geste offert pour être refusé, après avoir fait peur pour rien. On dit donc
   * où aller à la place, une fois, sur la ligne même. Monter et descendre restent : la place d'un
   * atelier dans la soirée se règle ici comme celle des autres parties.
   */
  const verrouille = !!partie.atelier;

  /*
   * **La nature se montre avant d'être confirmée**.
   *
   * La pastille se plaçait d'après `partie.estOption` — la réponse du serveur — et les deux moitiés
   * étaient `disabled` pendant l'aller-retour : le curseur restait immobile *et* sourd, on recliquait
   * sur un bouton désactivé, rien ne partait, et c'est le troisième clic qui semblait « enfin »
   * marcher. L'écran n'avait pas de retard, il n'avait aucune réponse à donner.
   *
   * L'ordonnancement vit dans `bascule-nature.ts` (sans React, donc testable sans navigateur) ; ici
   * il ne reste que l'état et l'appel. Même découpage que la case du planning et sa `file-envoi.ts`.
   */
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1">
        {/* Le nom de la partie : la même étiquette qu'en lecture, à la même couleur. Un membre et un
            instructeur lisent donc exactement la même chose au même endroit.

            **À la hauteur du curseur, et par construction** (« met l'icone cour et option
            aux mêmes dimensions que le slider, actuellement il est plus petit ») : l'étiquette faisait
            ~28 px contre 54, et deux boîtes de hauteurs différentes sur la même ligne se lisent comme
            un alignement raté. Elle reprend donc **le même emboîtement** que `ChoixNature` — un liseré
            transparent de 1 px, 2 px de marge intérieure, et un contenu à `min-h-12` — plutôt qu'une
            hauteur recopiée à la main : le jour où la cible tactile du projet changera, les deux
            bougeront ensemble. */}
        <span className="inline-flex shrink-0 items-center self-center rounded-lg border border-transparent p-0.5">
          <span className={`inline-flex min-h-12 items-center rounded-md px-3 text-sm font-semibold ${couleurPartie(partie)}`}>
            {partie.libelle}
          </span>
        </span>
        {verrouille && (
          <span className="min-w-0 basis-full text-sm text-texte-secondaire sm:basis-auto">
            Atelier programmé — pour retirer la partie, déprogramme-le depuis la gestion des ateliers.
          </span>
        )}
        <BoutonsOrdre partie={partie} premiere={premiere} derniere={derniere} enVol={enVol} start={start} retirable={!verrouille} />
      </div>
      <p className="text-base font-semibold text-rouge empty:hidden" aria-live="polite">
        {erreur}
      </p>
    </div>
  );
}

/**
 * Monter, descendre, retirer : les trois gestes qui touchent à la partie elle-même.
 *
 * **Le retrait est séparé des deux flèches, et il porte son nom dès 640 px**. Les trois boutons
 * étaient côte à côte à 4 px d'écart, tous les trois muets : chevron haut, chevron bas, **croix**.
 * Rater la descente d'un cheveu supprimait la partie — et la même croix, tournée d'un quart de
 * tour, veut dire « Ajouter » trois lignes plus bas, si bien que rien dans le dessin ne disait
 * lequel des deux gestes on s'apprêtait à faire. Le geste est irréversible (le thème et
 * l'instructeur partent avec la partie) : il lui faut un mot et une distance. En dessous de 640 px,
 * la largeur manque pour le mot ; l'écart, lui, reste, et la confirmation tient le reste.
 */
function BoutonsOrdre({
  partie,
  premiere,
  derniere,
  enVol,
  start,
  retirable,
}: {
  partie: CasePlanning;
  premiere: boolean;
  derniere: boolean;
  enVol: boolean;
  start: (action: () => Promise<{ erreur?: string } | undefined>) => void;
  /** Le retrait est-il possible ? **Non** quand un atelier occupe la partie : le serveur le refuse */
  retirable: boolean;
}) {
  const classe = "inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-bordure/70 bg-surface text-texte shadow-carte hover:bg-surface-douce disabled:opacity-40";
  return (
    <>
      <span className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          className={classe}
          disabled={enVol || premiere}
          title="Monter cette partie"
          onClick={() => start(() => deplacerPartie({ partieId: partie.id, versOrdre: partie.ordre - 1 }))}
        >
          <Icone nom="chevronHaut" titre={`Monter « ${partie.libelle} »`} />
        </button>
        <button
          type="button"
          className={classe}
          disabled={enVol || derniere}
          title="Descendre cette partie"
          onClick={() => start(() => deplacerPartie({ partieId: partie.id, versOrdre: partie.ordre + 1 }))}
        >
          <Icone nom="chevronBas" titre={`Descendre « ${partie.libelle} »`} />
        </button>
      </span>
      {/* `ml-3` : avec le `gap-1` de la ligne, 16 px séparent le retrait du couple de flèches —
          assez pour que le pouce ne confonde pas les deux. `sm:w-auto` défait la largeur carrée dès
          que le mot s'écrit. Le nom accessible est porté par `aria-label` (et non par le titre de
          l'icône) : il reste complet, et identique, que le mot soit affiché ou non. */}
      {retirable && (
        <button
          type="button"
          className={`${classe} ml-3 gap-1.5 hover:bg-rouge-doux hover:text-rouge sm:w-auto sm:px-3`}
          disabled={enVol}
          title="Retirer cette partie"
          aria-label={`Retirer « ${partie.libelle} »`}
          onClick={() => {
            /* Retirer une partie n'est pas vider une case : la séance en comptera une de moins, et ce
               qui y était écrit s'en va avec elle. D'où la question — la même que partout ailleurs
               dans l'application (`BoutonAction`), pour que le geste se reconnaisse. Ce que la
               question annonce, le journal d'audit le garde (`planning.partie.retrait` : les deux
               encadrants, le thème, la description et le niveau) — c'est tout ce qui reste après. */
            if (!window.confirm(`Retirer « ${partie.libelle} » de cette séance ? Son instructeur, son thème et sa description seront perdus.`)) return;
            start(() => retirerPartie({ partieId: partie.id }));
          }}
        >
          <Icone nom="croix" />
          <span className="hidden sm:inline">Retirer</span>
        </button>
      )}
    </>
  );
}

/**
 * **Deux boutons : « Ajouter un cours », « Ajouter une option »**.
 *
 * Le geste a eu quatre formes en trois jours, et l'histoire vaut d'être gardée entière, parce qu'elle
 * revient à son point de départ :
 *
 * 1. « Ajouter une partie », avec une case à cocher pour la nature — Delta : « j'ai l'impression que
 *    ça n'ajoute que des options » ;
 * 2. **deux boutons**, pour que le geste dise ce qu'il pose ;
 * 3. **un seul** bouton (01/10 au matin, « ne mets que ajouter un cours/option, un seul bouton au lieu
 *    de 2 ») — le curseur de chaque ligne rendait le second inutile : se tromper coûtait un clic ;
 * 4. **deux boutons de nouveau** (01/10 au soir), et le curseur retiré avec. Ce qui justifiait le
 *    bouton unique était la bascule ; elle part, donc la nature se choisit là où elle se décide : **à
 *    l'ajout**. Une partie ne change plus de nature — on la retire et on ajoute l'autre, ce qui est
 *    aussi la seule façon de ne jamais faire bouger une ligne sous le doigt.
 *
 * Le nom ne se demande pas : il se calcule depuis le rang (« Cours 3 », « Option 2 »). Le focus reste
 * sur le bouton, qui ne se démonte pas.
 */
function AjouterPartie({ sessionId }: { sessionId: string }) {
  const [enVol, start, erreur] = useActionPartie();
  /* Pas d'icône « plus » dans le jeu du projet — c'est la croix, tournée d'un quart de tour : un seul
     tracé à maintenir, et le signe reste celui que tout le monde lit « ajouter ». */
  const ajout = (estOption: boolean, libelle: string) => (
    <Bouton
      variante="secondaire"
      taille="petite"
      className="flex-1 basis-40"
      disabled={enVol}
      onClick={() => start(() => ajouterPartie({ sessionId, estOption }))}
    >
      <Icone nom="croix" taille={18} className="rotate-45" />
      {libelle}
    </Bouton>
  );
  return (
    <>
      {/* Côte à côte dès qu'il y a la largeur, empilés sinon : à 390 px, deux boutons sur une ligne
          tomberaient sous la cible tactile de 48 px que le projet tient partout. */}
      <div className="flex flex-wrap gap-2">
        {ajout(false, "Ajouter un cours")}
        {ajout(true, "Ajouter une option")}
      </div>
      {/* Cette erreur-là est la seule trace d'un ajout refusé (période close, plafond de parties
          atteint) : elle doit être **annoncée**, comme celle de la ligne d'une partie. Rendue en
          permanence (`empty:hidden`) pour la même raison qu'ailleurs dans le projet — une région
          vivante créée en même temps que son texte n'est pas toujours lue. */}
      <p className="text-base font-semibold text-rouge empty:hidden" aria-live="polite">
        {erreur}
      </p>
    </>
  );
}

function useActionPartie(): [boolean, (action: () => Promise<{ erreur?: string } | undefined>, apres?: (succes: boolean) => void) => void, string | null] {
  const [, start] = useTransition();
  const [enVol, setEnVol] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  // `apres` rend le verdict à l'appelant. Il n'en avait pas besoin tant que chaque geste se
  // contentait d'afficher son erreur ; la bascule Cours/Option, elle, montre l'état voulu avant la
  // réponse et doit donc savoir s'il faut le confirmer ou revenir en arrière.
  const lancer = (action: () => Promise<{ erreur?: string } | undefined>, apres?: (succes: boolean) => void) => {
    setErreur(null);
    setEnVol(true);
    start(async () => {
      try {
        const res = await action();
        if (res?.erreur) setErreur(res.erreur);
        apres?.(!res?.erreur);
      } catch {
        setErreur("Action impossible — vérifie ta connexion et recommence.");
        apres?.(false);
      } finally {
        setEnVol(false);
      }
    });
  };
  return [enVol, lancer, erreur];
}
