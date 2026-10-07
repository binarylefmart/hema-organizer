"use client";

import { useState } from "react";

import { ajouterPartie, deplacerElement, retirerPartie } from "@/actions/planning";
import { enParallele, nomElement, nomPartie, partiesNommees } from "@/lib/constants";
import type { CasePlanning } from "@/lib/planning";
import { Icone } from "@/components/ui/Icone";
import { Bouton } from "@/components/ui/Bouton";
import { ListeDeroulante } from "@/components/ui/ListeDeroulante";
import { couleurNature } from "@/components/seances/programme-cours";
import { EcuNature } from "@/components/seances/EcuNature";
import { CaseEditeur } from "./CaseEditeur";
import { ListePartiesTelephone } from "./ListePartiesTelephone";
import { useActionPartie } from "./useActionPartie";
import { useEcranTelephone } from "@/components/ui/useEcranTelephone";
import { useOptionsCase } from "./ContexteOptions";
import { useBrouillon } from "./ContexteBrouillon";
import { champsLus } from "./options";
import { confirmationRetrait, pasVoisins, entreesAjout, grouperParPartie, lireAjout, nombreDeParties, type PasVoisin } from "./parties-carte";

/**
 * **Le programme d'une séance, partie par partie, et les gestes qui le font bouger.**
 *
 * Une séance se lit « Partie 1 », « Partie 2 »… (demande de Delta : « fais une gestion
 * par partie, partie 1, 2, 3. Et dans chaque partie ajouter (via un menu déroulant) un échauffement,
 * un cours, une option (et/ou atelier si proposé) »). Chaque partie porte ses **éléments**, dans
 * l'ordre que le serveur rend (la colonne `ordre`, libre et réglée par l'équipe) — la carte le
 * **découpe** (`grouperParPartie`), elle ne le recalcule pas.
 *
 * **Le nom d'un élément ne se saisit pas** : « Cours », « Option 2 » (`nomElement`, numéroté
 * seulement quand la partie en porte plusieurs), à la couleur de sa nature (`couleurNature`). Ce qui
 * le décrit, ce sont ses informations : instructeur, thème, niveau, description (`CaseEditeur`).
 *
 * Le même composant sert la carte du planning et l'écran d'une séance : il n'y a qu'un seul endroit
 * où un élément se règle, change de nature, change de partie ou se retire.
 *
 * **Vider une case n'est pas retirer un élément.** Effacer l'instructeur et le thème laisse l'élément
 * en place, vide, prêt à être rempli. Retirer, c'est dire que la partie ne le compte plus : le geste
 * est rare, irréversible, et demande donc une confirmation.
 *
 * **Sur ordinateur, ↑ et ↓ déplacent d'une place dans l'ordre de lecture** (`pasVoisins`) : devant
 * le voisin du dessus, ou derrière celui du dessous, dans la partie ; en tête ou en fin de partie,
 * l'élément passe dans la partie voisine (à la fin de la précédente, au début de la suivante, ou dans
 * une nouvelle après la dernière). L'ordre d'une partie est libre (colonne `ordre`, `deplacerElement`) :
 * c'est le même geste que le glisser-déposer du téléphone, une place à la fois, et il a son
 * équivalent au clavier. Sur un téléphone, en modification, la liste se règle par gestes
 * (`ListePartiesTelephone`), où une poignée dédiée tient lieu de glisser.
 *
 * **Les intitulés « Partie N » ne se montrent que s'il y a plusieurs parties** (avenant,
 * `partiesNommees`) : en modification, on compte les parties **réelles** de la séance ; en lecture,
 * celles qui ont **au moins un élément affiché** — une séance dont une seule partie se lit se lit
 * comme avant, « Cours », « Option ». Les étiquettes ne changent pas (`nomElement`) ; les noms
 * accessibles, eux, gardent le libellé enregistré (`partie.libelle`), calculé par le serveur.
 *
 * **La structure se règle dès le mode modification**, sans second bouton par carte (demande de
 * Delta : « quand je fais modifier dans planning il faut que je refasse de nouveau modifier sur un
 * programme pour l'éditer, retire le bouton »). Chaque partie montre son menu « Ajouter dans la
 * partie N… » et chaque élément ses ↑ ↓ Retirer ; « Modifier le planning » est la seule porte.
 *
 * Tout ce qui touche à la **forme** du programme (ajouter, retirer, déplacer, changer de nature) part
 * **sans attendre** « Appliquer les modifications » : un élément provisoire n'aurait pas
 * d'identifiant à donner au rangement. Seul le **contenu** des cases passe par le brouillon.
 */
export function ListeParties({ sessionId, parties, compact = false }: { sessionId: string; parties: CasePlanning[]; compact?: boolean }) {
  const { modifiable } = useOptionsCase();
  const telephone = useEcranTelephone();
  /*
   * **Sur un téléphone, en modification, la liste se règle par gestes** (`ListePartiesTelephone`) :
   * une ligne compacte par élément, qu'on touche pour la régler, qu'on glisse pour la retirer, qu'on
   * déplace par sa poignée. Les ↑ ↓ Retirer ci-dessous restent ceux de l'ordinateur, et la lecture
   * ne change nulle part. Le menu d'ajout et « Ajouter une partie » sont les mêmes des deux côtés.
   */
  if (modifiable && telephone) {
    return (
      <ListePartiesTelephone
        sessionId={sessionId}
        parties={parties}
        compact={compact}
        ajout={(bloc) => <AjouterDansPartie sessionId={sessionId} bloc={bloc} />}
        pied={<PiedCarte sessionId={sessionId} bloc={nombreDeParties(parties) + 1} />}
      />
    );
  }
  if (parties.length === 0 && !modifiable) return <p className="text-texte-secondaire">Programme à venir.</p>;
  const nbParties = nombreDeParties(parties);
  const gestes = modifiable;
  /*
   * **En lecture, un élément qui n'a rien à dire ne montre pas son étiquette** — et une partie
   * dont aucun élément ne se lit ne montre pas son intitulé.
   *
   * `CaseEditeur` ne rend rien lorsqu'il n'y a aucun champ à lire (`champsLus`), et l'étiquette
   * de couleur restait alors seule au milieu de la carte : une « Option 2 » suivie de rien, qui
   * se lit comme un affichage tronqué. Le cas n'est pas théorique — un élément qui ne porte
   * qu'un **second** instructeur, sans premier (donnée héritée, ou import), passe le filtre
   * d'amont (`caseVide` le voit rempli) et n'affiche pourtant personne. Côté encadrement, au
   * contraire, tout reste : c'est justement un élément vide qu'on vient remplir.
   */
  const groupes = grouperParPartie(parties)
    .map((groupe) => ({
      ...groupe,
      elements: groupe.elements.filter((partie) => {
        if (!modifiable && !partie.atelier && champsLus(partie).length === 0) return false;
        return true;
      }),
    }))
    .filter((groupe) => groupe.elements.length > 0);
  // Modification : les parties réelles. Lecture : celles qui ont encore quelque chose à montrer.
  const intitules = partiesNommees(modifiable ? nbParties : groupes.length);
  return (
    <div className="flex flex-col gap-3">
      {groupes.map((groupe) => {
        const { elements } = groupe;
        const idTitre = `${sessionId}-partie-${groupe.bloc}`;
        return (
          // Sans intitulé, la partie n'est plus une région nommée : une `section` sans nom ne se
          // distingue de rien, la liste suffit.
          <section key={groupe.bloc} aria-labelledby={intitules ? idTitre : undefined} className="flex min-w-0 flex-col gap-2">
            {intitules && (
              <h3 id={idTitre} className="font-titre text-base font-semibold text-texte-secondaire">
                {nomPartie(groupe.bloc)}
              </h3>
            )}
            <ul className={`flex flex-col gap-2 ${intitules ? "border-l-2 border-bordure/60 pl-2" : ""}`}>
              {elements.map((partie) => (
                <li key={partie.id} className="flex min-w-0 flex-col gap-1">
                  {modifiable ? (
                    <ReglagesElement partie={partie} parties={parties} gestes={gestes} />
                  ) : (
                    // En lecture, le nom est une simple étiquette : rien à régler, rien à annoncer
                    <span className={`inline-flex items-center gap-1.5 self-start rounded-lg px-2 py-1 text-sm font-semibold ${couleurNature(partie.nature)}`}>
                      <EcuNature nature={partie.nature} />
                      {nomElement(partie.nature, partie.rang, partie.nombre)}
                    </span>
                  )}
                  <CaseEditeur sessionId={sessionId} valeur={partie} compact={compact} discret={enParallele(partie.nature)} />
                </li>
              ))}
            </ul>
            {gestes && <AjouterDansPartie sessionId={sessionId} bloc={groupe.bloc} />}
          </section>
        );
      })}
      {modifiable && <PiedCarte sessionId={sessionId} bloc={nbParties + 1} />}
    </div>
  );
}

/**
 * Ce qui agit sur l'élément **entier** — sa partie, son existence — rassemblé sur la ligne de titre,
 * au-dessus des champs qui, eux, décrivent son contenu.
 *
 * **La nature se choisit à l'ajout, et ne change plus après coup** (décision, voir
 * `CLAUDE.md`) : le menu « Ajouter dans la partie N… » la décide, et l'étiquette ne fait que la
 * montrer, exactement comme la lit un membre. Pour changer d'avis, on retire et on ajoute l'autre.
 */
function ReglagesElement({ partie, parties, gestes }: { partie: CasePlanning; parties: CasePlanning[]; gestes: boolean }) {
  // Un seul verrou et un seul message pour les gestes de la ligne : ils portent tous sur le même
  // élément, ils ne peuvent donc pas se chevaucher, et un échec se dit une fois.
  const [enVol, start, erreur] = useActionPartie();
  const voisins = pasVoisins(partie, parties);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1">
        <span className={`inline-flex min-h-12 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold ${couleurNature(partie.nature)}`}>
          <EcuNature nature={partie.nature} taille={20} />
          {nomElement(partie.nature, partie.rang, partie.nombre)}
        </span>
        {gestes && <BoutonsElement partie={partie} haut={voisins.haut} bas={voisins.bas} enVol={enVol} start={start} />}
      </div>
      <p className="text-base font-semibold text-rouge empty:hidden" aria-live="polite">
        {erreur}
      </p>
    </div>
  );
}

/**
 * Monter, descendre, retirer : les trois gestes qui touchent à l'élément lui-même.
 *
 * **Le retrait est séparé des deux flèches, et il porte son nom dès 640 px**. Trois boutons muets à
 * 4 px d'écart — chevron haut, chevron bas, croix — faisaient qu'en ratant la descente d'un cheveu on
 * supprimait l'élément. Le geste est irréversible : il lui faut un mot et une distance. En dessous de
 * 640 px, la largeur manque pour le mot ; l'écart, lui, reste, et la confirmation tient le reste.
 */
function BoutonsElement({
  partie,
  haut,
  bas,
  enVol,
  start,
}: {
  partie: CasePlanning;
  /** Le pas de ↑ (`pasVoisins`), `null` quand rien ne changerait */
  haut: PasVoisin | null;
  /** Le pas de ↓, `null` quand rien ne changerait */
  bas: PasVoisin | null;
  enVol: boolean;
  start: (action: () => Promise<{ erreur?: string } | undefined>, apres?: (succes: boolean) => void) => void;
}) {
  const brouillon = useBrouillon();
  const classe = "inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-bordure/70 bg-surface text-texte shadow-carte hover:bg-surface-douce disabled:opacity-40";
  const titreHaut = haut?.titre ?? "Déjà en tête de la séance";
  const titreBas = bas?.titre ?? "Déjà seul dans la dernière partie";
  // **Figées jusqu'à la nouvelle liste** : `enVol` retombe avant que la séance rangée n'arrive, et un
  // second clic visait alors l'ancienne place (« Rien à changer », ou une partie renumérotée). Les
  // flèches restent grisées tant que leurs pas sont ceux du clic ; un échec, ou un délai, les rend.
  const cle = `${haut?.versBloc}:${haut?.avantId}|${bas?.versBloc}:${bas?.avantId}`;
  const [figee, setFigee] = useState<string | null>(null);
  const bloquee = enVol || figee === cle;
  const deplacer = (pas: PasVoisin) => {
    setFigee(cle);
    start(
      () => deplacerElement({ partieId: partie.id, versBloc: pas.versBloc, avantId: pas.avantId }),
      (ok) => (ok ? window.setTimeout(() => setFigee(null), 4000) : setFigee(null)),
    );
  };
  return (
    <>
      <span className="flex shrink-0 items-center gap-1">
        <button type="button" className={classe} disabled={bloquee || haut === null} title={titreHaut} onClick={() => haut && deplacer(haut)}>
          <Icone nom="chevronHaut" titre={`${titreHaut} : « ${partie.libelle} »`} />
        </button>
        <button type="button" className={classe} disabled={bloquee || bas === null} title={titreBas} onClick={() => bas && deplacer(bas)}>
          <Icone nom="chevronBas" titre={`${titreBas} : « ${partie.libelle} »`} />
        </button>
      </span>
      {/* `ml-3` : avec le `gap-1` de la ligne, 16 px séparent le retrait du couple de flèches —
          assez pour que le pouce ne confonde pas les deux. Le nom accessible est porté par
          `aria-label` : il reste complet, et identique, que le mot soit affiché ou non. */}
      <button
        type="button"
        className={`${classe.replace("text-texte", "text-rouge")} ml-3 gap-1.5 hover:bg-rouge-doux sm:w-auto sm:px-3`}
        disabled={enVol}
        title={partie.atelier ? "Retirer cet atelier de la séance" : "Retirer cet élément"}
        aria-label={`Retirer « ${partie.libelle} »`}
        onClick={() => {
          /* Retirer n'est pas vider une case : ce qui y était écrit s'en va avec l'élément — sauf un
             atelier, qui repart dans les propositions en attente. D'où la question, la même que
             partout ailleurs dans l'application (`BoutonAction`). Le journal d'audit garde ce qui
             est perdu (`planning.partie.retrait`), et la décision d'atelier (`atelier.decision`). */
          if (!window.confirm(confirmationRetrait(partie.libelle, partie.atelier))) return;
          // Un élément retiré n'a plus de réglage à appliquer : laissé au brouillon, il ferait refuser
          // tout le lot par le serveur (« Cette partie n'existe plus »).
          start(
            () => retirerPartie({ partieId: partie.id }),
            (ok) => ok && brouillon?.oublier(partie.id),
          );
        }}
      >
        {/* Rouge, avec le pictogramme d'alerte : comme tout ce qui retire quelque chose. */}
        <Icone nom="alerte" />
        <span className="hidden sm:inline">Retirer</span>
      </button>
    </>
  );
}

/**
 * **« Ajouter dans la partie N… » : un menu déroulant sous chaque partie.**
 *
 * Il propose un échauffement, un cours, une option — et, s'il y en a en attente, chaque atelier
 * proposé par un membre, nommé avec son proposeur. Il **commande**, il ne mémorise rien : sa valeur
 * reste l'entrée de tête, et choisir une ligne ajoute aussitôt. Le nom de l'élément ne se demande
 * pas : il se calcule. Le focus reste sur le déclencheur, qui ne se démonte pas.
 */
function AjouterDansPartie({ sessionId, bloc }: { sessionId: string; bloc: number }) {
  const { ateliersDisponibles, peutProgrammer } = useOptionsCase();
  const [enVol, start, erreur] = useActionPartie();
  const id = `ajout-${sessionId}-${bloc}`;
  const libelle = `Ajouter dans la partie ${bloc}`;
  return (
    <div className="flex flex-col gap-1">
      <label id={`${id}-libelle`} htmlFor={id} className="sr-only">
        {libelle}
      </label>
      <ListeDeroulante
        id={id}
        libelleId={`${id}-libelle`}
        libelle={libelle}
        valeur=""
        entrees={entreesAjout(bloc, peutProgrammer ? ateliersDisponibles : [], sessionId)}
        disabled={enVol}
        onChoisir={(v) => {
          const ajout = lireAjout(v);
          if (!ajout) return;
          start(() => ajouterPartie({ sessionId, bloc, ...ajout }));
        }}
        className="min-h-12 w-full rounded-xl border-2 border-dashed border-bordure/70 bg-transparent px-3 text-base font-semibold text-texte sm:w-auto sm:min-w-64"
      />
      {/* Cette erreur-là est la seule trace d'un ajout refusé (période close, plafond atteint) :
          elle doit être **annoncée**. Rendue en permanence (`empty:hidden`) — une région vivante
          créée en même temps que son texte n'est pas toujours lue. */}
      <p className="text-base font-semibold text-rouge empty:hidden" aria-live="polite">
        {erreur}
      </p>
    </div>
  );
}

/**
 * **Le pied de la carte en modification : « Ajouter une partie ».** Une partie de plus, qui naît avec
 * un cours vide — une partie n'existe que par ses éléments. On y ajoute ensuite ce qu'on veut avec son
 * menu. Pleine largeur sous 390 px : à 48 px de haut, le libellé se coupait sur un petit téléphone.
 */
function PiedCarte({ sessionId, bloc }: { sessionId: string; bloc: number }) {
  const [enVol, start, erreur] = useActionPartie();
  /* Pas d'icône « plus » dans le jeu du projet — c'est la croix, tournée d'un quart de tour : un seul
     tracé à maintenir, et le signe reste celui que tout le monde lit « ajouter ». */
  return (
    <div className="flex flex-col gap-1">
      <Bouton
        variante="secondaire"
        taille="petite"
        className="w-full min-[390px]:w-auto min-[390px]:self-start"
        disabled={enVol}
        onClick={() => start(() => ajouterPartie({ sessionId, bloc, nature: "COURS" }))}
      >
        <Icone nom="croix" taille={18} className="rotate-45" />
        Ajouter une partie
      </Bouton>
      <p className="text-base font-semibold text-rouge empty:hidden" aria-live="polite">
        {erreur}
      </p>
    </div>
  );
}
