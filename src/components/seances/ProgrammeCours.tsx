import type { ProgrammeSeance } from "@/lib/planning";
import { Icone } from "@/components/ui/Icone";
import { PastilleNiveau } from "@/components/ui/Pastille";
import { couleurNature, lignesProgramme, partiesProgramme, programmeMuet, texteLibre, type LigneProgramme, type PartieProgramme } from "./programme-cours";
import { EcuNature } from "./EcuNature";
import { classesPartie } from "./teintes";

/**
 * **Ce qu'on va travailler** — le programme d'un cours en lecture seule : le thème de chaque partie,
 * le niveau annoncé s'il y en a un, qui l'encadre, la description quand l'encadrement en a écrit une —
 * un atelier placé s'y lit comme n'importe quel élément, son titre pour thème.
 *
 * C'est la seconde question qu'on se pose sur une séance, juste après « est-ce que je viens ? », et
 * elle se lit sur trois écrans différents (la séance, l'accueil, le planning). D'où un composant
 * unique et deux densités, plutôt que trois mises en forme qui finiraient par se contredire : le
 * planning est l'endroit où l'on **remplit** les cases (`CaseEditeur`), ici on ne fait que les lire —
 * rien n'est cliquable, donc aucune cible tactile à réserver.
 *
 * Il se pose **sans condition** : quand il n'y a rien à montrer il ne rend rien du tout. Le cas est
 * la règle plus que l'exception — un cours se programme souvent quelques jours avant seulement —,
 * et laisser à chaque appelant le soin de tester « programme vide *et* pas de thème *et* pas
 * d'alternative » revenait à écrire trois fois la même condition, avec trois occasions de l'oublier.
 */
export function ProgrammeCours({
  programme,
  theme,
  alternative,
  compact = false,
}: {
  /** Cases du planning renseignées, déjà dans l'ordre des parties */
  programme: ProgrammeSeance;
  /** Thème « libre » de la séance, saisi hors planning (souvent vide) */
  theme?: string;
  /** Alternative de la séance (souvent vide) */
  alternative?: string;
  /** Variante resserrée, pour une fiche de l'accueil */
  compact?: boolean;
}) {
  const lignes = lignesProgramme(programme);
  const parties = partiesProgramme(lignes);
  const detail = texteLibre(theme);
  const repli = texteLibre(alternative);
  if (programmeMuet(lignes, detail, repli)) return null;

  return (
    <div className={`flex min-w-0 flex-col ${compact ? "gap-1.5 text-sm" : "gap-3"}`}>
      {parties.length > 0 && (
        /* **Partie par partie** : le titre de la partie, puis ses éléments. Les parties muettes ne
           sont pas là — elles n'ont plus d'élément pour les porter (`partiesProgramme`). */
        <ul aria-label="Programme" className={`flex flex-col ${compact ? "gap-1.5" : "gap-3"}`}>
          {parties.map((p) => (
            <li key={p.bloc} className="min-w-0">
              <BlocPartie partie={p} compact={compact} />
            </li>
          ))}
        </ul>
      )}
      {(detail || repli) && (
        /* Les deux champs libres de la séance viennent après les cases, séparés par un filet : ils
           précisent le programme (« Messer — garde haute ») ou disent par quoi on le remplace, mais
           ils ne se rattachent à aucune partie — les mêler aux lignes les ferait lire comme une
           cinquième case. */
        <div className={`flex flex-col gap-1 ${lignes.length > 0 ? "border-t border-bordure/50 pt-2" : ""}`}>
          {detail && <ChampLibre icone="livre" intitule="En détail" texte={detail} compact={compact} />}
          {/* Boussole : l'alternative, c'est l'autre cap qu'on prend si la météo ou l'effectif l'imposent */}
          {repli && <ChampLibre icone="boussole" intitule="Alternative" texte={repli} compact={compact} />}
        </div>
      )}
    </div>
  );
}

/**
 * Une partie du cours : son titre (« Partie 1 »), puis ses éléments — sans titre quand elle est la
 * seule à montrer quelque chose.
 *
 * Le titre est écrit **sobrement** — petites capitales — parce que ce sont les éléments qui portent
 * l'information ; il ne fait que dire où commence le bloc suivant. Il prend la **teinte de la partie**
 * (`classesPartie`), et le bloc entier une bande de cette teinte à gauche, sans fond : deux parties
 * voisines se séparent d'un coup d'œil sans qu'on ait à lire le numéro.
 */
function BlocPartie({ partie: p, compact }: { partie: PartieProgramme; compact: boolean }) {
  const elements = p.elements.map((l) => (
    <li key={l.id} className="min-w-0">
      <LigneCase ligne={l} compact={compact} />
    </li>
  ));
  /* **Une seule partie affichée** (`nom: null`, `partiesNommees`) : ni titre ni filet — les éléments
     se lisent directement, comme avant les parties. */
  if (!p.nom) return <ul className={`flex min-w-0 flex-col ${compact ? "gap-1" : "gap-2.5"}`}>{elements}</ul>;
  const couleur = classesPartie(p.bloc);
  return (
    <div className={`flex min-w-0 flex-col gap-1 ${couleur.bande} ${compact ? "pl-2" : "pl-3"}`}>
      <p className={`font-semibold uppercase tracking-wide ${couleur.titre} ${compact ? "text-[0.7rem]" : "text-xs"}`}>{p.nom}</p>
      <ul aria-label={p.nom} className={`flex min-w-0 flex-col ${compact ? "gap-1" : "gap-2.5"}`}>
        {elements}
      </ul>
    </div>
  );
}

/**
 * Un élément d'une partie.
 *
 * Aéré, le nom de l'élément est écrit au-dessus de son contenu, comme dans la grille : sur 390 px, un
 * nom et un thème sur la même ligne renvoyaient le thème à la ligne suivante de toute façon, une fois
 * sur deux au milieu d'un mot.
 *
 * Resserré, il reste sur la même ligne que le contenu, dans une étiquette dont la forme dit la nature
 * et la teinte le rang du cours ou de l'option dans la séance (`couleurNature`).
 *
 * **Une seule mention de l'élément** : son nom dans la partie (« Échauffement », « Cours 2 »), calculé
 * depuis sa nature et son rang (`nomElement`) — la partie, elle, est déjà dite par le titre du bloc,
 * et « Partie 1 · Cours » sous « Partie 1 » la dirait deux fois.
 */
function LigneCase({ ligne: l, compact }: { ligne: LigneProgramme; compact: boolean }) {
  /* **La description sous le reste, jamais dans la même ligne que lui.** C'est une phrase, et la
     glisser entre le thème, le niveau et les noms la ferait lire comme un quatrième champ court. Elle
     reprend `ChampLibre`, la mise en forme des champs libres de la séance (« En détail »,
     « Alternative ») : c'est la même nature de texte, elle mérite la même présentation — son intitulé
     devant, parce que rien d'autre ne dirait de quoi elle parle. */
  const description = l.description ? <ChampLibre icone="livre" intitule="Description" texte={l.description} compact={compact} /> : null;
  if (compact) {
    return (
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          {/* `break-words` : un nom doit pouvoir se couper plutôt que de déborder de la fiche sur
              un téléphone de 390 px. */}
          <span className={`inline-flex min-w-0 items-center gap-1 self-start break-words rounded-md px-1.5 py-0.5 text-xs font-semibold ${couleurNature(l.nature, l.teinte)}`}>
            <EcuNature nature={l.nature} teinte={l.teinte} taille={14} />
            {l.nom}
          </span>
          <Contenu ligne={l} compact />
        </p>
        {description}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <span className={`inline-flex items-center gap-1.5 self-start rounded-lg px-2 py-0.5 text-sm font-semibold ${couleurNature(l.nature, l.teinte)}`}>
        <EcuNature nature={l.nature} teinte={l.teinte} />
        {l.nom}
      </span>
      <span className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <Contenu ligne={l} compact={false} />
      </span>
      {description}
    </div>
  );
}

/**
 * Le contenu d'une case, dans l'ordre où on le lit : ce qu'on travaille, puis avec qui.
 *
 * **Le titre d'un atelier est son thème** : il se lit à la place du thème, écrit comme lui — ni vert,
 * ni icône, ni mise en valeur à lui (avenant : « ne mets pas les ateliers en
 * surlignage »). C'est l'étiquette « Atelier », à la couleur de sa nature, qui dit ce que c'est. Il
 * vient donc en tête, avant le niveau et l'encadrement, comme tout thème ; et annoncer « Thème à
 * venir » au-dessus d'un atelier programmé serait faux.
 */
function Contenu({ ligne: l, compact }: { ligne: LigneProgramme; compact: boolean }) {
  const taille = compact ? 14 : 16;
  return (
    <>
      {l.atelier && (
        /* Sous l'étiquette « Atelier », le mot ne se répète pas ; ailleurs (donnée ancienne, atelier
           resté dans un élément d'une autre nature) un simple « Atelier : » dit encore ce que c'est. */
        <span className="min-w-0 break-words font-semibold">{l.nature === "ATELIER" ? l.atelier : `Atelier : ${l.atelier}`}</span>
      )}
      {l.theme && <span className="min-w-0 break-words font-semibold">{l.theme}</span>}
      {l.enAttente && <span className="text-texte-secondaire">Thème à venir</span>}
      {/* Le niveau qualifie ce qu'on travaille : il suit le thème, avant de dire qui encadre */}
      <PastilleNiveau niveau={l.niveau} compact={compact} />
      {l.instructeur && (
        /* Qui mène, puis qui assiste : le second n'est jamais une seconde ligne ni une seconde
           icône — il se lit dans la foulée du premier, d'un cran plus discret, parce que c'est
           exactement son rôle. « avec » suffit à dire lequel des deux encadre. */
        <span className="inline-flex min-w-0 flex-wrap items-baseline gap-x-1 text-texte-secondaire">
          <Icone nom="personne" taille={taille} className="self-center" />
          <span className="min-w-0 break-words">{l.instructeur}</span>
          {l.instructeurSecond && <span className="min-w-0 break-words text-[0.85em] opacity-90">avec {l.instructeurSecond}</span>}
        </span>
      )}
    </>
  );
}

/** Un champ libre de la séance : son intitulé en gras, parce que rien d'autre ne dit de quoi il parle. */
function ChampLibre({ icone, intitule, texte, compact }: { icone: "livre" | "boussole"; intitule: string; texte: string; compact: boolean }) {
  return (
    <p className={`flex items-start gap-2 ${compact ? "" : "text-sm"}`}>
      <Icone nom={icone} taille={compact ? 16 : 18} className="mt-0.5 text-texte-secondaire" />
      <span className="min-w-0 break-words">
        <span className="font-semibold">{intitule} : </span>
        {texte}
      </span>
    </p>
  );
}
