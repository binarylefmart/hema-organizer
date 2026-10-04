import type { ProgrammeSeance } from "@/lib/planning";
import { Icone } from "@/components/ui/Icone";
import { PastilleNiveau } from "@/components/ui/Pastille";
import { couleurPartie, lignesProgramme, programmeMuet, texteLibre, type LigneProgramme } from "./programme-cours";

/**
 * **Ce qu'on va travailler** — le programme d'un cours en lecture seule : le thème de chaque partie,
 * le niveau annoncé s'il y en a un, qui l'encadre, la description quand l'encadrement en a écrit une,
 * et les ateliers qui y sont placés.
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
  const detail = texteLibre(theme);
  const repli = texteLibre(alternative);
  if (programmeMuet(lignes, detail, repli)) return null;

  return (
    <div className={`flex min-w-0 flex-col ${compact ? "gap-1.5 text-sm" : "gap-3"}`}>
      {lignes.length > 0 && (
        <ul aria-label="Programme" className={`flex flex-col ${compact ? "gap-1" : "gap-2.5"}`}>
          {lignes.map((l) => (
            <li key={l.id} className="min-w-0">
              <LigneCase ligne={l} compact={compact} />
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
 * Une partie du cours.
 *
 * Aéré, le libellé de la partie est écrit au-dessus de son contenu, comme dans la grille : sur
 * 390 px, un libellé entier et un thème sur la même ligne renvoyaient le thème à la ligne
 * suivante de toute façon, une fois sur deux au milieu d'un mot.
 *
 * Resserré, il reste sur la même ligne que le contenu, dans une étiquette à la couleur du planning —
 * mais c'est **le libellé**, et lui seul.
 *
 * **Une seule mention de la partie**. Il y en avait deux dans le même `<span>` : une étiquette
 * courte dérivée du rang (« Opt 1 », visible) et le libellé écrit par l'équipe (« 1ère option »,
 * pour les lecteurs d'écran et le survol), lues à la suite par la synthèse vocale. Les deux ne
 * comptaient pas forcément la même chose, un clic suffisait donc à obtenir « Opt 1 — Cours n°1 » et
 * « Opt 3 — 1ère option ».
 *
 * Reste le libellé — qui, depuis que le nom se **calcule** depuis le rang dans sa nature, ne peut plus
 * se désaccorder de rien : la teinte compte exactement le même nombre que lui (`couleurPartie`).
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
          {/* `break-words` : un libellé doit pouvoir se couper plutôt que de déborder de la fiche sur
              un téléphone de 390 px. */}
          <span className={`min-w-0 self-start break-words rounded-md px-1.5 py-0.5 text-xs font-semibold ${couleurPartie(l)}`}>{l.libelle}</span>
          <Contenu ligne={l} compact />
        </p>
        {description}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <span className={`self-start rounded-lg px-2 py-0.5 text-sm font-semibold ${couleurPartie(l)}`}>{l.libelle}</span>
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
 * L'atelier prend la place du thème quand la case n'en porte pas : son titre dit déjà ce qu'on va
 * faire, et annoncer « Thème à venir » au-dessus d'un atelier programmé serait faux.
 */
function Contenu({ ligne: l, compact }: { ligne: LigneProgramme; compact: boolean }) {
  const taille = compact ? 14 : 16;
  return (
    <>
      {l.theme && <span className="min-w-0 break-words font-semibold">{l.theme}</span>}
      {l.enAttente && <span className="text-texte-secondaire">Thème à venir</span>}
      {/* Le niveau qualifie ce qu'on travaille : il suit le thème, avant de dire qui encadre */}
      <PastilleNiveau niveau={l.niveau} compact={compact} />
      {l.atelier && (
        <span className="inline-flex min-w-0 items-center gap-1 font-semibold text-vert">
          <Icone nom="outil" taille={taille} />
          <span className="min-w-0 break-words">Atelier : {l.atelier}</span>
        </span>
      )}
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
