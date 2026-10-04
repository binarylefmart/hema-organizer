"use client";

import { useEffect, useState } from "react";
import { formatDateCourte, formatHoraire, lienCarte } from "@/lib/dates";
import { detailDesReponses, MOT_BANDE, segmentsDeBande, type CleBande, type CleNombre, type CleSegment } from "@/lib/frise";
import type { ListesParStatut } from "@/lib/seances";
import type { Compteurs } from "@/lib/presences";
import { Icone } from "@/components/ui/Icone";
import { ListeRepliee } from "@/components/seances/ListeRepliee";
import { couper, ORDRE_GROUPES } from "@/components/seances/listes";

/**
 * **La couleur des deux nombres écrits au-dessus d'une colonne** : vert « Présent », ocre «
 * Peut-être ». Il n'y en a que deux — la frise ne compte plus les absents à l'écran (voir
 * `nombresDeLaColonne`), et avec eux a disparu la dernière rouille des nombres.
 *
 * Elle vit ici plutôt que dans `Frise.tsx` parce que c'est ce fichier qui dessine la bande ; la
 * frise s'en sert pour ses nombres, et les deux restent ainsi accordés par construction.
 */
export const TEXTE_SEGMENT: Record<CleNombre, string> = {
  presents: "text-vert",
  peutEtre: "text-ocre",
};

/**
 * Le fond d'un segment de la bande. Les deux réponses qui remplissent le cours prennent la couleur
 * pleine, comme les barres de la frise ; le texte blanc dessus est l'appariement déjà éprouvé des
 * boutons de réponse (`BoutonsPresence`).
 *
 * **Le reste du club garde le cadre pointillé et aucune couleur** : c'est exactement le haut vide
 * de la colonne, couché. Lui donner un aplat — et à plus forte raison la rouille d'« Absent » —
 * en ferait une accusation ; ce n'en est pas une, c'est ce qui reste à convaincre.
 */
const FOND_BANDE: Record<CleBande, string> = {
  presents: "bg-vert text-primaire-texte",
  peutEtre: "bg-ocre text-primaire-texte",
  reste: "border border-dashed border-bordure bg-surface-douce text-texte-secondaire",
};

/**
 * **La puce d'un nom.** Les noms restent tous là — « qui a répondu » est l'intérêt même du
 * panneau —, mais **sans rouge** : présents en vert doux, peut-être en ocre doux, et **tout le
 * reste en neutre**.
 *
 * La seule nuance gardée est le **pointillé des sans-réponse**, parce que c'est la seule
 * distinction qui appelle un geste : on les relance. Un absent, lui, a répondu — il a fait ce
 * qu'on lui demandait ; sa puce est neutre et pleine, sans marque particulière.
 */
const PUCE_SEGMENT: Record<CleSegment, string> = {
  presents: "bg-vert-doux text-vert",
  peutEtre: "bg-ocre-doux text-ocre",
  absents: "bg-surface-douce text-texte-secondaire",
  sansReponse: "border border-dashed border-bordure text-texte-secondaire",
};

/**
 * La puce, sortie de la boucle pour pouvoir être rendue **des deux côtés de la coupe** : les
 * premiers noms directement, le reste passé en `ReactNode` à `ListeRepliee`. Ce qu'on dévoile est
 * donc exactement ce qu'on aurait vu sans repli.
 */
function Puce({ p }: { p: { id: string; prenom: string; nom: string; cle: CleSegment } }) {
  return (
    <li className={`rounded-full px-2 py-0.5 text-xs ${PUCE_SEGMENT[p.cle]}`}>
      {p.prenom} {p.nom}
    </li>
  );
}

/** Ce qu'une colonne dépliée montre en plus de ce que la frise dessine déjà. */
export type DetailsCours = {
  heureDebut: string;
  heureFin: string;
  lieu: string;
  /** L'adresse postale du lieu, pour le lien vers la carte. Vide tant qu'elle n'est pas saisie :
      `lienCarte` cherche alors le nom du lieu seul. */
  adresse: string;
  participants: ListesParStatut;
};

/**
 * **L'ordre des puces vient de `ORDRE_GROUPES`, comme celui de `ListeParticipants`.**
 *
 * C'est le seul endroit où un membre ordinaire reçoit les quatre-vingts noms du club d'un coup, et
 * il est donc coupé comme les autres listes — mais la coupe n'a de sens que si ce qu'on voit avant
 * de déplier est ce qui compte : d'abord qui n'a pas répondu, en dernier qui a déjà tranché.
 *
 * **La bande colorée juste au-dessus, elle, garde son propre ordre** (présents, peut-être, reste) :
 * ce n'est pas une liste mais une proportion, qui doit rester la colonne de la frise couchée.
 */
const GROUPES: Array<{ cle: CleSegment; liste: keyof ListesParStatut }> = ORDRE_GROUPES.map((cle) => ({ cle, liste: cle }));

/**
 * **Le panneau d'une colonne dépliée** — « la colonne se déplie », maquette choisie par Delta
 * parmi quatre.
 *
 * La barre verticale bascule en **bande horizontale** sous la frise : mêmes couleurs, mêmes
 * proportions, mais la place d'écrire dedans. Le panneau ne répète donc pas la colonne, il
 * l'ouvre — et il ajoute les trois seules choses que la frise ne montre pas : **la date en toutes
 * lettres, l'horaire et le lieu**, puis **les noms**. C'est exactement pour ça qu'on l'ouvre.
 *
 * **L'animation** est une transition, pas une chorégraphie : le panneau part de `grid-rows-[0fr]`
 * et d'une opacité nulle, et l'effet de montage le bascule à sa taille réelle. Sans elle, la bande
 * paraissait sortir de nulle part. `motion-reduce:transition-none` la coupe pour qui a demandé
 * moins de mouvement (et `globals.css` coupe déjà toutes les transitions dans ce cas) : le panneau
 * apparaît alors d'un coup, ce qui est le comportement voulu, pas une dégradation.
 *
 * **`anime` à `false` la coupe aussi, et c'est le cas du premier rendu de la page** : le prochain
 * cours arrive déjà déplié, il ne doit pas se déplier sous les yeux au chargement. Un panneau
 * qu'on n'a pas demandé à ouvrir n'a rien à mettre en scène — le premier écran doit être lisible
 * tout de suite. Concrètement, l'état de départ est alors *ouvert*, donc le navigateur ne voit
 * jamais d'état fermé et n'a rien à animer. Aux ouvertures suivantes, déclenchées par un appui,
 * `anime` vaut `true` : l'état de départ est *fermé* et l'effet l'ouvre juste après la première
 * peinture — c'est ce décalage d'une image qui rend la transition visible.
 *
 * Le composant est monté avec la clé de la séance : changer de colonne le remonte, donc rejoue
 * l'ouverture plutôt que de faire glisser un contenu dans un cadre déjà ouvert.
 */
export function FriseDetail({
  id,
  date,
  details,
  compteurs,
  pointe,
  anime,
}: {
  id: string;
  date: string;
  details: DetailsCours;
  compteurs: Compteurs;
  /** Abscisse de la pointe, en pourcentage de la largeur de la frise : le centre de la colonne ouverte. */
  pointe: number;
  /** Faux pour l'ouverture du premier rendu, qui ne se joue pas ; vrai pour toute ouverture appuyée. */
  anime: boolean;
}) {
  const [ouvert, setOuvert] = useState(!anime);
  useEffect(() => setOuvert(true), []);
  // Les noms, à plat et dans l'ordre partagé, puis coupés : dans un club de douze la coupe ne
  // retire rien et aucun bouton n'apparaît ; dans un club de quatre-vingts, le panneau d'une
  // colonne cesse d'être un annuaire déroulant sous la frise — les noms cachés se dévoilent vingt
  // par vingt, par le patron partagé (`ListeRepliee`) et non par une bascule écrite ici.
  const noms = GROUPES.flatMap((g) => details.participants[g.liste].map((p) => ({ ...p, cle: g.cle })));
  const { montrees, cachees } = couper(noms);

  const segments = segmentsDeBande(compteurs);
  // Le compte complet, absents compris, réservé au lecteur d'écran : du détail à la demande, et
  // non un affichage (voir `detailDesReponses`).
  const resume = detailDesReponses(compteurs);

  return (
    <div
      className={`grid transition-all duration-200 ease-out motion-reduce:transition-none ${
        ouvert ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
      }`}
    >
      <div className="overflow-hidden">
        <section
          id={id}
          aria-label={`Détail du cours du ${formatDateCourte(date)}`}
          className={`relative mt-3 rounded-xl border border-bordure/60 bg-surface-douce/60 p-3 transition-transform duration-200 ease-out motion-reduce:transition-none ${
            ouvert ? "translate-y-0" : "-translate-y-1"
          }`}
        >
          {/* La pointe : un carré tourné, calé sur le centre de la colonne ouverte. Sans elle, le
              panneau flotterait sous la frise sans dire de quel cours il parle. */}
          <div
            aria-hidden
            className="absolute -top-[6px] h-2.5 w-2.5 -translate-x-1/2 rotate-45 border-l border-t border-bordure/60 bg-surface-douce"
            style={{ left: `${pointe}%` }}
          />
          <p className="font-semibold">{formatDateCourte(date)}</p>
          {/* Le lieu mène à la carte, comme sur la carte de séance : on déplie cette colonne sur un
              téléphone, souvent en partant au cours, et « où est-ce ? » finit toujours dans une
              application de carte — recopier l'adresse à la main est le seul geste que
              l'application peut éviter. `lienCarte` sait déjà se passer d'une adresse vide, et la
              ligne porte `min-h-11` pour que le lien reste confortable au doigt. */}
          <p className="mt-0.5 flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 text-sm text-texte-secondaire">
            <span className="inline-flex items-center gap-1">
              <Icone nom="horloge" taille={14} />
              {formatHoraire(details.heureDebut, details.heureFin)}
            </span>
            <a
              href={lienCarte(details.lieu, details.adresse)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 underline decoration-bordure hover:text-lien hover:decoration-lien"
              title={details.adresse ? `${details.adresse} — ouvrir la carte` : "Ouvrir la carte"}
            >
              <Icone nom="lieu" taille={14} />
              {details.lieu}
            </a>
          </p>
          {/* **La bande** : la colonne couchée, et elle en reprend exactement les trois parties —
              le vert, l'ocre, puis le reste du club en neutre. Les segments sont dimensionnés par
              `flex-grow` proportionnel à leur part, ce qui absorbe sans calcul les 2 px de fond qui
              les séparent — deux couleurs qui se touchent se lisent comme une seule barre. Une
              largeur minimale garde le nombre lisible même à une personne sur vingt. */}
          {segments.length > 0 && (
            <div role="img" aria-label={`Sur ${compteurs.invites} invités : ${resume}`} className="mt-3 flex h-8 w-full items-stretch gap-[2px]">
              {segments.map((s) => (
                <span
                  key={s.cle}
                  style={{ flex: `${s.part} 1 0%` }}
                  className={`flex min-w-[2rem] items-center justify-center gap-1 overflow-hidden rounded-md px-1 text-xs font-semibold ${FOND_BANDE[s.cle]}`}
                >
                  <span className="tabular-nums">{s.nombre}</span>
                  {s.avecMot && <span className="truncate">{MOT_BANDE[s.cle]}</span>}
                </span>
              ))}
            </div>
          )}
          {/* Les noms, en puces. Ils ne coûtent aucune donnée de plus : la liste nominative de
              chaque cours est ouverte à tout le club depuis l'étape 3, et elle est déjà chargée
              pour les fiches de séance. */}
          <ul className="mt-3 flex flex-wrap items-center gap-1.5">
            {montrees.map((p) => (
              <Puce key={p.id} p={p} />
            ))}
            {/* Le panneau est étroit et déjà chargé : les deux boutons et le compteur prennent leur
                propre ligne (`basis-full`) plutôt que de se glisser entre deux puces, et gardent
                l'allure discrète qu'ils avaient — une bordure de plus ferait un cadre dans un cadre. */}
            <ListeRepliee
              cachees={cachees.map((p) => <Puce key={p.id} p={p} />)}
              visibles={montrees.length}
              quoi="noms suivants"
              unite="noms"
              variante="discret"
              className="basis-full pt-1"
            />
          </ul>
        </section>
      </div>
    </div>
  );
}
