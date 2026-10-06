import Link from "next/link";
import type { ReactNode } from "react";
import { formatDateCourte, formatDateSansAnnee, formatHeure, minuscule } from "@/lib/dates";
import { caseVide, type CasePlanning, type ColonnePlanning, type Planning } from "@/lib/planning";
import { Icone } from "@/components/ui/Icone";
import { Alerte } from "@/components/ui/Alerte";
import { LienBouton } from "@/components/ui/Bouton";
import { EnCours } from "@/components/layout/EnCours";
import { ListeParties } from "./ListeParties";
import { SEANCES_VISIBLES } from "@/components/seances/listes";
import { SeancesRepliees } from "./SeancesRepliees";
import { FournisseurOptions } from "./ContexteOptions";
import { FournisseurBrouillon } from "./ContexteBrouillon";
import { BarreEdition } from "./BarreEdition";
import { optionsDepuis } from "./options";
import { CaseSeancePlanning, SelectionPlanning } from "./SelectionPlanning";
import type { LignePlanning } from "./selection-planning";
import type { OptionsCase } from "./options";

/**
 * Les parties à montrer d'une séance.
 *
 * L'équipe les voit **toutes**, y compris celles qu'elle n'a pas encore remplies : il faut bien
 * pouvoir les remplir. Les membres ne voient que ce qui est renseigné — une partie vide n'apprend
 * rien et allonge la carte. Le tri est déjà fait (`ColonnePlanning.parties` arrive dans l'ordre).
 */
function partiesVisibles(c: ColonnePlanning, modifiable: boolean): CasePlanning[] {
  return modifiable ? c.parties : c.parties.filter((p) => !caseVide(p));
}

/** Fenêtre de temps sans aucun cours : on dit quoi faire plutôt que de laisser la page vide. */
function EtatVidePlanning() {
  return (
    <Alerte type="info" titre="Aucun cours dans cette fenêtre">
      <p>Choisis « Toute la période » au-dessus pour voir tous les cours de la période.</p>
      <p className="mt-3">
        <LienBouton href="/seances" variante="secondaire" taille="petite" enCours>
          <Icone nom="calendrier" taille={18} />
          Voir mes prochains cours
        </LienBouton>
      </p>
    </Alerte>
  );
}

/**
 * Découpe les blocs du planning en deux : ce qu'on voit, ce qui se déplie.
 *
 * Le plafond est {@link SEANCES_VISIBLES}, **la** constante des listes de séances : le planning et la
 * liste des séances montrent la même chose, et ils lisent donc le même nombre. Ce fichier en exportait
 * un second du même nom, à une autre valeur que celui de `listes.ts` — un auto-import du mauvais
 * passait la compilation sans broncher.
 *
 * La coupure se compte **en séances**, pas en blocs : les intertitres de mois n'en sont pas, et un
 * mois dont aucune séance n'est visible part entier de l'autre côté — on ne laisse pas « Novembre »
 * tout seul au-dessus du bouton, à annoncer des cartes qui ne sont pas là.
 */
function couper(blocs: Array<{ noeud: ReactNode; estSeance: boolean }>): { visibles: ReactNode[]; cachees: ReactNode[]; restantes: number } {
  const total = blocs.filter((l) => l.estSeance).length;
  if (total <= SEANCES_VISIBLES) return { visibles: blocs.map((l) => l.noeud), cachees: [], restantes: 0 };
  // (La sélection multiple compte de son côté `Math.min(total, SEANCES_VISIBLES)` cartes visibles : même coupure.)
  let vues = 0;
  let coupure = blocs.length;
  for (const [i, bloc] of blocs.entries()) {
    if (!bloc.estSeance) continue;
    vues++;
    if (vues === SEANCES_VISIBLES) {
      coupure = i + 1;
      break;
    }
  }
  return {
    visibles: blocs.slice(0, coupure).map((l) => l.noeud),
    cachees: blocs.slice(coupure).map((l) => l.noeud),
    restantes: total - SEANCES_VISIBLES,
  };
}

/** Jour de la semaine en tête de carte : les créneaux du club s'y distinguent d'un coup d'œil. */
function EnteteSeance({ c, gestion }: { c: ColonnePlanning; gestion: boolean }) {
  const [jour, ...reste] = formatDateCourte(c.date).split(" ");
  /* **L'en-tête de carte ne descend plus à 12 px**. Le jour de la semaine, l'heure et le lieu y
      étaient en `text-xs` : c'est-à-dire que les trois seules choses qui disent **quand et où** un
      cours a lieu étaient les plus petites de la carte, sur l'écran qu'on consulte debout dans une
      salle, dans un club dont une partie des membres est âgée. Le cahier des charges ne connaît
      qu'un plancher, 16 px (`text-base`), et c'est ce genre de ligne qu'il vise. La date, elle,
      garde sa graisse : la hiérarchie tient au gras, pas au rétrécissement de ce qui l'accompagne. */
  const contenu = (
    <>
      <span className={`block text-base uppercase tracking-wide ${c.annulee ? "text-rouge" : "text-texte-secondaire"}`}>{jour}</span>
      <span className={`flex items-center gap-1.5 font-bold ${c.annulee ? "line-through" : ""}`}>
        {reste.join(" ")}
        {/* Ouvrir une séance recharge un écran complet : le lien doit dire tout de suite qu'il a pris */}
        {gestion && <EnCours taille={14} />}
      </span>
      <span className="block text-base text-texte-secondaire">
        {formatHeure(c.heureDebut)} · {c.lieu}
      </span>
    </>
  );
  return gestion ? (
    <Link href={`/seances/${c.id}`} className="block text-texte no-underline hover:text-primaire">
      {contenu}
    </Link>
  ) : (
    // Même enveloppe de bloc que le lien : dans la fiche, l'en-tête reste un seul bloc face au taux
    <span className="block">{contenu}</span>
  );
}

/** Taux de participation de la séance (lien avec l'onglet Présences), infobulle = liste des présents. */
export function TauxColonne({ c }: { c: ColonnePlanning }) {
  if (c.annulee) return <span className="text-sm font-semibold text-rouge">Annulée</span>;
  const titre = c.presents.length ? `Présents : ${c.presents.join(", ")}` : "Personne n'a encore répondu « Présent »";
  /*
   * **`role="img"` pour que le taux ne s'annonce plus « 13 barre oblique 18 »**.
   *
   * Le contenu est une jauge muette, un nombre en gras et un « / 18 » : lu nœud par nœud, cela donne
   * la barre oblique en toutes lettres, sans jamais dire de quoi l'on parle. `role="img"` fait du
   * groupe une image, donc une feuille de l'arbre d'accessibilité : son `aria-label` remplace ce que
   * l'œil lit, exactement comme la barre de répartition des fiches d'accueil (`BarreTaux`).
   */
  const etiquette = `${c.compteurs.presents} présent${c.compteurs.presents > 1 ? "s" : ""} sur ${c.compteurs.invites} invité${c.compteurs.invites > 1 ? "s" : ""}`;
  return (
    <span role="img" aria-label={etiquette} className="inline-flex items-center gap-1.5 text-sm" title={titre}>
      <span className="h-1.5 w-12 overflow-hidden rounded-full bg-surface-douce" aria-hidden>
        <span className="block h-full rounded-full bg-jauge" style={{ width: `${c.compteurs.pourcentage}%` }} />
      </span>
      <strong>{c.compteurs.presents}</strong>
      <span className="text-texte-secondaire">/ {c.compteurs.invites}</span>
    </span>
  );
}

/** « mardi 6 octobre » : le nom de la case d'une carte, et celui des séances citées par la sélection. */
function jourCase(date: string): string {
  return minuscule(formatDateSansAnnee(date));
}

/**
 * **Ce que la sélection multiple sait d'une séance** — `null` pour une séance annulée, qui n'a pas de
 * case (son programme est verrouillé, `partiePourEcriture`). Les parties portent la valeur **du
 * serveur** : c'est le point de comparaison du brouillon, qui n'écrit que ce qui change vraiment.
 * Rien de nominatif ne traverse ici : des identifiants, les mêmes que les cases ont déjà.
 */
function lignePlanning(c: ColonnePlanning): LignePlanning | null {
  if (c.annulee) return null;
  return {
    id: c.id,
    date: c.date,
    jour: jourCase(c.date),
    parties: c.parties.map((p) => ({
      id: p.id,
      libelle: p.libelle,
      estOption: p.estOption,
      rang: p.rang,
      atelier: p.atelier !== null,
      serveur: {
        instructeurId: p.instructeurId ?? "",
        instructeurSecondId: p.instructeurSecondId ?? "",
        theme: p.theme,
        description: p.description,
        niveau: p.niveau,
      },
    })),
  };
}

/** Séances regroupées par mois, dans l'ordre : un simple intertitre de lecture, sans navigation. */
function groupesMois(colonnes: ColonnePlanning[], mois: Planning["mois"]): Array<{ cle: string; label: string; colonnes: ColonnePlanning[] }> {
  const groupes: Array<{ cle: string; label: string; colonnes: ColonnePlanning[] }> = [];
  for (const c of colonnes) {
    const dernier = groupes.at(-1);
    if (dernier?.cle === c.mois) dernier.colonnes.push(c);
    else groupes.push({ cle: c.mois, label: mois.find((m) => m.cle === c.mois)?.label ?? "", colonnes: [c] });
  }
  return groupes;
}

/**
 * **Le planning : une carte par séance.**
 *
 * C'était un tableau — une ligne par séance, une colonne par partie — et ce tableau imposait à
 * toutes les séances d'avoir exactement les mêmes quatre parties, puisqu'une colonne vaut pour
 * toute la grille. Delta a tranché sur maquettes : chaque séance devient un bloc qui liste **ses**
 * parties, dans son ordre à elle. Une séance peut en avoir trois, la suivante cinq, et c'est
 * exactement ce qu'on voulait pouvoir écrire.
 *
 * **Une seule mise en page, adaptée en CSS**, comme avant : les cartes sont posées dans une grille
 * qui compte une colonne sur un téléphone, deux à partir de 1024 px, trois à partir de 1280 px.
 * Rien n'est rendu deux fois — le choix appartient au navigateur (et suit le redimensionnement de
 * la fenêtre), pas au serveur qui ne connaît pas la largeur de l'écran.
 *
 * **Pourquoi deux colonnes d'abord, et trois seulement au-delà :** une carte est une liste de
 * parties, chacune avec son nom, ses deux instructeurs, son thème et son niveau. En dessous de
 * ~24 rem, ces champs se rangent en colonne et la carte double de hauteur pour rien ; au-delà de
 * ~32 rem, la ligne d'une partie s'étire et l'œil ne sait plus relier le nom au thème. Deux colonnes
 * sur un écran d'ordinateur ordinaire donnent en prime une lecture utile : le club s'entraîne deux
 * fois par semaine, une rangée = une semaine.
 *
 * Les cartes ne s'étirent pas (`items-start`) : une séance à trois parties reste courte à côté d'une
 * séance à cinq, plutôt que de se gonfler de vide pour faire la maille.
 */
/**
 * **Le planning est en lecture seule par défaut, même pour l'encadrement**.
 *
 * Ce que ça change pour qui a le droit de remplir : la grille s'ouvre **exactement comme un membre la
 * voit** — les cases vides n'apparaissent pas, aucun contrôle de saisie n'est monté —, avec un bouton
 * « Modifier les séances ». Avant, l'encadrement tombait sur un mur de listes déroulantes : quatre
 * par partie, plus une zone de texte, sur chaque séance du trimestre, pour **lire** le programme.
 *
 * Le mode vit dans l'**URL** (`?modifier=1`, voir `BarreEdition`), comme le trimestre, la fenêtre de
 * temps et la date cherchée : le retour du navigateur sort du mode, et « Annuler » n'a rien à défaire
 * puisque le brouillon n'a jamais touché la base.
 *
 * **Et la lecture seule allège vraiment la page** : `optionsDepuis` ne fait traverser l'annuaire du
 * club et la liste des ateliers que si quelqu'un peut s'en servir. En lecture, plus personne ne peut
 * — donc rien ne part, sur un trimestre de vingt-six séances.
 */
export function GrillePlanning({
  planning: p,
  gestion = false,
  colonnes,
  modeEdition = false,
  lienLecture,
}: {
  planning: Planning;
  gestion?: boolean;
  colonnes: ColonnePlanning[];
  modeEdition?: boolean;
  lienLecture?: string;
}) {
  // Le **droit** de remplir, qui ouvre le bouton ; et le **mode**, qui ouvre les cases.
  const peutModifier = p.modifiable;
  /*
   * **Le mode ne s'ouvre que pour qui a le droit de remplir** — et c'est l'adresse tapée à la main
   * qui l'impose : `?modifier=1` est un paramètre d'URL, donc n'importe qui peut l'écrire. Sans ce
   * `&&`, un membre voyait la barre « Appliquer les modifications » au-dessus d'un planning qu'il ne
   * peut pas régler : un bouton qui ne peut que refuser, exactement ce que le dossier s'interdit.
   * Rien n'était ouvert pour autant — `optionsDepuis` ne rend `modifiable` que d'après le droit, et
   * l'action serveur exige `planning.edit` — mais l'écran promettait un geste qui n'existait pas.
   */
  const enEdition = peutModifier && modeEdition;
  const options = enEdition ? optionsDepuis(p) : optionsDepuis({ ...p, modifiable: false, peutProgrammer: false });
  if (colonnes.length === 0) return <EtatVidePlanning />;
  const mois = groupesMois(colonnes, p.mois);
  const plusieursMois = mois.length > 1;
  // Les cartes sont rendues **toutes** ici, y compris celles qui attendent derrière le bouton : le
  // serveur fait le même travail qu'avant, c'est le navigateur qui n'en monte que le début.
  const decoupe = couper(
    mois.flatMap((m) => [
      ...(plusieursMois
        ? [
            {
              estSeance: false,
              // L'intertitre traverse la grille : un mois ne commence jamais au milieu d'une rangée
              noeud: (
                <h2 key={`mois-${m.cle}`} className="col-span-full mt-2 font-titre text-xl font-normal text-texte-secondaire first:mt-0">
                  {m.label}
                </h2>
              ),
            },
          ]
        : []),
      ...m.colonnes.map((c) => ({
        estSeance: true,
        noeud: (
          <CarteSeancePlanning
            key={c.id}
            c={c}
            gestion={gestion}
            modifiable={options.modifiable}
            // La case de la sélection multiple : jamais sur une séance annulée, dont le programme est verrouillé.
            selection={enEdition && !c.annulee ? <CaseSeancePlanning id={c.id} jour={jourCase(c.date)} /> : undefined}
          />
        ),
      })),
    ]),
  );
  return (
    /*
     * **Une séance par ligne, pleine largeur**. La disposition en deux ou trois colonnes avait deux
     * défauts que seule l'échelle révélait : une séance annulée tient en 190 px à côté d'une séance
     * à sept parties qui en fait 1 400, et la colonne courte laissait plus de mille pixels de
     * blanc ; et la largeur d'une carte en trois colonnes tronquait tout ce qui porte un nom de
     * personne (« Damien Roc… », « personne en sec… ») dès que le club a plus de deux instructeurs.
     *
     * En pleine largeur, chaque ligne de partie a la place d'écrire un nom entier, et une séance
     * courte ne coûte qu'une bande courte. L'élargissement au-delà de la colonne de lecture reste :
     * c'est lui qui donne cette place.
     */
    <FournisseurOptions valeur={options}>
      {/* **L'élargissement n'est plus ici** : il est sur la page (`PLEINE_LARGEUR`,
          `src/components/ui/pleine-largeur.ts`). Posé sur la seule grille, il laissait le titre, le
          volet des filtres et les boutons de partage dans la colonne étroite pendant que les cartes
          juste dessous faisaient 90 rem — et il sautait d'un filtre à l'autre, puisqu'un filtre
          sans résultat remplace la grille par une alerte. */}
      {enEdition && lienLecture ? (
        /* Le brouillon n'enveloppe que le mode modification : hors de lui, une case qui n'a pas de
           brouillon s'enregistre toute seule — c'est ce qui garde la fiche d'une séance inchangée. */
        <FournisseurBrouillon>
          <div className="flex flex-col gap-3">
            {/* **La sélection multiple** (interrupteur, case maîtresse, « Sélectionner par jour »,
                « Que veux-tu faire ? ») enveloppe la grille : elle doit savoir ce qui est déplié. */}
            <SelectionPlanning
              lignes={colonnes.map(lignePlanning)}
              visibles={decoupe.visibles}
              cachees={decoupe.cachees}
              restantes={decoupe.restantes}
              nbVisibles={Math.min(colonnes.length, SEANCES_VISIBLES)}
            />
            <BarreEdition lienLecture={lienLecture} />
          </div>
        </FournisseurBrouillon>
      ) : (
        <div className="flex flex-col gap-3">
          {/* Le bouton d'entrée n'est plus ici : il est sous le titre de la page, à la place commune
              à tous les onglets (`EntreeModification`, rendu par `src/app/(app)/planning/page.tsx`). */}
          <div className="grid grid-cols-1 items-start gap-3">
            {decoupe.visibles}
            <SeancesRepliees cachees={decoupe.cachees} restantes={decoupe.restantes} />
          </div>
        </div>
      )}
    </FournisseurOptions>
  );
}

/**
 * Une séance : sa date et son taux en tête, puis ses parties dans l'ordre.
 *
 * `id` : l'ancre visée par le bouton « Programme de la séance » des tuiles (`CarteSeance`).
 * `scroll-mt` tient compte de l'en-tête collant — sans elle, la carte visée arrive **sous** la barre
 * du haut, et on croit être tombé au mauvais endroit. Elle ne joue que parce que `AllerALAncre`
 * aligne le **haut** de la carte (`block: "start"`) : en centrage, une marge de bord n'a presque
 * aucun effet, et la valeur était inerte — voir le commentaire de ce composant.
 */
function CarteSeancePlanning({ c, gestion, modifiable, selection }: { c: ColonnePlanning; gestion: boolean; modifiable: boolean; selection?: ReactNode }) {
  const parties = partiesVisibles(c, modifiable);
  return (
    <article
      id={`seance-${c.id}`}
      className={`flex min-w-0 scroll-mt-24 flex-col gap-3 rounded-2xl border bg-surface p-4 shadow-carte ${c.annulee ? "border-rouge/30" : "border-bordure/60"}`}
    >
      {/* La date et le taux côte à côte, séparés du programme par un filet : c'est l'en-tête de la
          carte, et il doit se lire sans être confondu avec la première partie. */}
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-bordure/60 pb-2">
        <div className="flex min-w-0 items-start gap-2">
          {selection}
          <EnteteSeance c={c} gestion={gestion} />
        </div>
        <TauxColonne c={c} />
      </header>
      {c.annulee ? (
        // Une séance annulée n'a pas de programme à montrer : le motif prend toute la carte.
        <p className="rounded-xl bg-rouge-doux p-3">Séance annulée{c.motifAnnulation ? ` — ${c.motifAnnulation}` : ""}.</p>
      ) : (
        <ListeParties sessionId={c.id} parties={parties} />
      )}
    </article>
  );
}

/**
 * Les parties d'une séance, empilées (écran de gestion d'une séance) : les listes communes sont
 * montées ici, une fois pour toutes les parties.
 *
 * C'est le **même** composant que dans les cartes du planning : une partie ne se règle qu'à un seul
 * endroit dans le code, quel que soit l'écran depuis lequel on la remplit.
 */
export function ProgrammeCases({ sessionId, parties, options }: { sessionId: string; parties: CasePlanning[]; options: OptionsCase }) {
  return (
    <FournisseurOptions valeur={options}>
      <ListeParties sessionId={sessionId} parties={options.modifiable ? parties : parties.filter((p) => !caseVide(p))} />
    </FournisseurOptions>
  );
}
