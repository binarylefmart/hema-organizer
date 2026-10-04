import type { ReactElement } from "react";
import { SERIE_MINIMALE, type CompteRendu } from "@/lib/accueil";
import { blasons, formatDuree, HORIZONS, libelleNumeroSaison, prochainRang, rangs, seuilEnSaisons, type Blason } from "@/lib/blasons";
import { Bande, Tuile, type PropsTuile } from "@/components/accueil/Indicateurs";
import { Bulle, coteEnGrille } from "@/components/ui/Bulle";

/**
 * **La forme de l'écu du logo**, en 24×28 : un rectangle dont le bas se referme en pointe arrondie.
 *
 * C'est le même dessin que la silhouette de l'icône « bouclier » (voir `Icone`), en plus grand et
 * sans les planches : ici l'intérieur sert à porter la marque du blason, il doit rester vide.
 */
const ECU = "M3 2.5h18v11.8c0 5.9-4.1 9.6-9 11.7-4.9-2.1-9-5.8-9-11.7V2.5z";

/**
 * Les marques qui s'inscrivent dans un écu gagné — **géométriques et sobres**, comme sur un vrai
 * blason : une croix de saint André, un chevron, une étoile à cinq branches.
 *
 * Elles tournent avec le rang du blason dans la **collection entière** (et non au hasard, ni sur son
 * rang dans son groupe) : chaque blason garde ainsi toujours la même marque d'une visite à l'autre,
 * ce qui le rend reconnaissable sans lire son nom, et le rangement par horizon ne la déplace pas.
 * Elles ne veulent rien dire de plus — ce ne sont pas trois niveaux déguisés.
 */
const MARQUES = [
  // Croix de saint André (sautoir)
  "M8.5 9.5l7 7M15.5 9.5l-7 7",
  // Chevron
  "M7.5 15.5L12 11l4.5 4.5",
  // Étoile à cinq branches, centrée sur le champ de l'écu
  "M12 7.5L13.3 11.2L17.2 11.3L14.1 13.7L15.2 17.4L12 15.2L8.8 17.4L9.9 13.7L6.8 11.3L10.7 11.2Z",
] as const;

/**
 * **La progression d'un blason en toutes lettres** : « 3 sur 5 », « 6 sur 12 mois », « 3 sur 4
 * mardis ».
 *
 * **Pourquoi l'unité.** Tout le reste de cet écran compte des cours, et rien d'autre : « 6 sur 12 »
 * d'un blason d'ancienneté se lirait donc comme six cours, et « 3 sur 4 » du fer du mardi comme
 * trois cours au lieu de trois mardis. L'unité n'est écrite que quand ce ne sont pas des cours
 * (voir `Blason.unite`) — l'ajouter partout alourdirait douze lignes pour n'en éclairer que trois.
 *
 * Écrite **une seule fois** et rendue aux trois endroits qui disent la progression — sous le nom,
 * dans la bulle et dans l'`aria-label` de l'écu — pour qu'ils ne puissent pas diverger : la voix et
 * l'œil doivent lire le même blason.
 */
function progression(b: Blason): string {
  const { fait, but } = b.progres;
  return b.unite ? `${fait} sur ${but} ${b.unite}` : `${fait} sur ${but}`;
}

/**
 * **Un écu**, gagné ou non, et rien d'autre : ni compteur de temps, ni barre de progression, ni
 * phrase de manque.
 *
 * Gagné : l'écu est plein (`fill-vert-doux`), bordé de vert, et porte sa marque. Non débloqué : le
 * même écu, vide, en contour pointillé — **il se lit comme une case encore à remplir, pas comme un
 * reproche**. C'est la règle de fond de toute la section : le club compte des gens qui travaillent
 * le mardi soir, et qui ne viendront jamais à tous les cours. Sous le nom, on écrit donc la
 * progression brute (« 3 sur 5 »), qui est un fait, et jamais « il te manque 2 cours », qui serait
 * une remontrance.
 *
 * **La bulle au survol** (`Bulle`, partagée avec les tuiles de pilotage) dit ce que le nom seul ne
 * dit pas — « La quinte », « Le héraut », « La garde de fer » sont empruntés à l'escrime
 * historique, et c'est le `quoi` qui les explique. Elle ne parle qu'au survol et au focus clavier,
 * d'où l'écu focalisable (`tabIndex={0}`) et son anneau de focus : la tabulation ouvre exactement
 * ce que la souris ouvre. Et elle n'est **jamais la seule source** — au doigt, le survol n'existe
 * pas : le nom et la progression restent écrits sous l'écu, et l'`aria-label` de l'écu porte l'état
 * complet (« La quinte — 3 sur 5 »).
 *
 * Le calage sur les bords de la grille vient de `coteEnGrille`, appelé une seule fois : les grilles
 * gardent **trois colonnes à toute largeur**, du téléphone à l'écran large. `index` est le rang de
 * l'écu **dans la grille de son horizon**, et non dans la collection entière : c'est cette grille-là
 * qui a des bords, et une bulle calée d'après le mauvais rang sortirait de l'écran sur les colonnes
 * extrêmes.
 */
function Ecu({ blason: b, marque, index }: { blason: Blason; marque: string; index: number }) {
  const etat = b.gagne ? "débloqué" : progression(b);
  return (
    <li className="group relative flex flex-col items-center gap-1 text-center">
      <span
        tabIndex={0}
        role="img"
        aria-label={`${b.nom} — ${etat}`}
        className="inline-flex rounded-md outline-offset-2 focus-visible:outline-3 focus-visible:outline-jauge"
      >
        <svg
          width={36}
          height={42}
          viewBox="0 0 24 28"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="shrink-0"
        >
          {b.gagne ? (
            <>
              <path d={ECU} className="fill-vert-doux stroke-vert" strokeWidth={2} />
              <path d={marque} className="stroke-vert" strokeWidth={2} fill="none" />
            </>
          ) : (
            // Pointillé plutôt que grisé plein : un aplat gris se lit « désactivé », donc « perdu ».
            // Le trait discontinu dit « pas encore tracé », ce qui est exactement la situation.
            <path d={ECU} className="stroke-bordure" strokeWidth={2} strokeDasharray="3 3" fill="none" />
          )}
        </svg>
      </span>
      <span className={`text-xs leading-tight ${b.gagne ? "font-semibold text-texte" : "text-texte-secondaire"}`}>{b.nom}</span>
      {!b.gagne && (
        <span className="text-xs leading-tight text-texte-secondaire tabular-nums">{progression(b)}</span>
      )}

      <Bulle cote={coteEnGrille(index, 2)} coteSm={coteEnGrille(index, 4)}>
        <span className="font-semibold">{b.nom}</span>
        <span>{b.quoi}</span>
        {!b.gagne && (
          <span className="tabular-nums opacity-80">{progression(b)}</span>
        )}
      </Bulle>
    </li>
  );
}

/**
 * **Mon rang**, en une tuile : où j'en suis sur l'échelle du club, et ce qui vient après.
 *
 * L'échelle entière vivait ici en pastilles — les cinq rangs, le courant en plein, les franchis en
 * contour vert. Elle est passée **dans la bulle** : une bande de tuiles ne peut pas porter cinq
 * pastilles sur 149 px de large, et surtout le rang courant se lit en un mot là où il fallait
 * auparavant repérer la pastille pleine parmi cinq. Rien n'est perdu : la bulle donne les cinq
 * rangs **et leur seuil**, ce que les pastilles ne disaient qu'au survol (`title`), et l'ancienneté
 * réelle, qui était écrite dessous.
 *
 * **Le rang se compte en ancienneté, plus en présences** (même jour, voir `ECHELLE` dans
 * `src/lib/blasons.ts`), et le détail de la tuile devient donc une **durée** : « encore 4 mois pour
 * devenir Élève », « encore 1 an et 2 mois pour devenir Bretteur ». C'est la formulation la plus
 * inoffensive qu'ait jamais portée ce bloc : elle n'attend aucun geste de personne, il n'y a rien à
 * faire qu'à rester du club — là où « encore 3 cours » se lisait comme une consigne.
 *
 * Le nom du rang est rendu **plus petit que les chiffres des autres tuiles** (`text-xl`) : « Maître
 * d'armes » en 30 px repousserait son propre libellé hors de la bande sur un téléphone, là où les
 * autres tuiles n'ont qu'un nombre à écrire dans la même colonne de tête.
 */
function tuileRang(ancienneteMois: number): ReactElement<PropsTuile> {
  const echelle = rangs(ancienneteMois);
  // Il y a toujours exactement un rang courant (« Recrue » à zéro mois d'ancienneté) ; le repli
  // protège la tuile d'une échelle vidée par mégarde plutôt qu'il ne décrit un cas réel.
  const actuel = echelle.find((r) => r.actuel) ?? echelle[0];
  const suivant = prochainRang(ancienneteMois);
  return (
    <Tuile
      key="rang"
      valeur={<span className="text-xl">{actuel.nom}</span>}
      valeurTexte={actuel.nom}
      libelle="Mon rang"
      detail={suivant ? `encore ${formatDuree(suivant.reste)} pour devenir ${suivant.nom}` : "au sommet de l'échelle"}
      bulle={[
        // Le club se compte en saisons : l'ancienneté part d'une rentrée, chaque année pleine en est une.
        `${libelleNumeroSaison(Math.floor(ancienneteMois / 12) + 1)} au club`,
        // « Recrue à partir de 0 mois » ne se dit pas : le premier rang n'a pas de seuil à
        // attendre, il est celui de l'arrivée — et c'est tout le propos de l'échelle.
        `L'échelle : ${echelle
          .map((r) => (r.seuil === 0 ? `${r.nom} dès l'arrivée` : `${r.nom} ${seuilEnSaisons(r.seuil)}`))
          .join(", ")}.`,
      ]}
    />
  );
}

/**
 * **La série** — et la règle d'écriture qui gouverne tout ce bloc, appliquée ici plus qu'ailleurs :
 * **on montre le record, jamais la chute.**
 *
 * Une série de présences se casse sur une grippe, un déménagement, un enfant malade. Un compteur
 * remis à zéro et annoncé comme tel punirait quelqu'un qui n'a rien fait de mal — c'est le seul
 * indicateur de la page qui puisse, tout seul, transformer un imprévu en reproche. D'où trois
 * états, et **aucun quatrième** :
 *
 * - **série en cours d'au moins {@link SERIE_MINIMALE}** : le compte en vert, « cours d'affilée ».
 *   C'est la seule tuile de tout le bloc qui se réjouisse, et elle ne parle que de ce qui est vrai
 *   en ce moment ;
 * - **sinon, mais un record d'au moins {@link SERIE_MINIMALE}** : le record, en **ton neutre**, sous
 *   « ta plus longue série ». Ni vert ni ocre : c'est un fait acquis du trimestre, pas un
 *   encouragement déguisé, et surtout pas le constat d'une série perdue. Rien n'indique que la
 *   série d'aujourd'hui est retombée — la personne le sait déjà, l'écrire ne l'aiderait pas ;
 * - **record en dessous de {@link SERIE_MINIMALE}** : **la règle, et aucun chiffre.** « À venir »,
 *   en ton neutre, sous « deux cours de suite et elle s'affiche ». La tuile annonce ce qu'elle
 *   montrera le jour venu ; elle ne dit rien de ce qui n'y est pas. Surtout, elle n'écrit ni « 0 »
 *   ni « 1 » : une « série de 1 » n'est pas une série, et la chiffrer reviendrait à dire « tu n'as
 *   jamais enchaîné deux cours ».
 *
 * **Et elle ne rend plus jamais `null`**. Elle s'effaçait jusque-là dans ce troisième cas, et la
 * bande de « Ma progression » se retrouvait avec **une seule ligne** là où l'on en annonce deux :
 * une bande trouée se lit comme une panne, et une tuile qui s'évapore d'une visite à l'autre donne
 * l'impression que l'application a perdu quelque chose — exactement l'inverse de ce que ce bloc
 * raconte. Énoncer la règle ne coûte rien à personne : « deux cours de suite et elle s'affiche »
 * est une promesse, pas une consigne, et elle se tient toute seule pour qui n'a encore aucune
 * série.
 *
 * Ce qu'on n'écrira jamais ici, quelle que soit la suite : « 0 cours d'affilée », « série
 * interrompue », « tu étais à 5 » — et aucune comparaison avec le record du club. Celui-là vit dans
 * la vue Admin, où il appelle un merci de l'équipe ; mis en face du sien, il ferait de sa propre
 * vue un classement où quelqu'un est dernier.
 */
function tuileSerie({ enCours, record }: { enCours: number; record: number }): ReactElement<PropsTuile> {
  // « cours » est invariable : « 2 cours » comme « 1 cours ». Et le singulier ne se présente de
  // toute façon jamais — en dessous de deux, aucun des deux premiers cas ne s'ouvre, et c'est le
  // troisième, qui n'écrit aucun chiffre, qui prend la main.
  if (enCours >= SERIE_MINIMALE) {
    return (
      <Tuile
        key="serie"
        ton="vert"
        valeur={enCours}
        valeurTexte={`${enCours}`}
        libelle="Ma série"
        detail="cours d'affilée"
        bulle={[`Tu es sur une série de ${enCours} cours`, "Des cours suivis d'affilée, sans en manquer un entre deux."]}
      />
    );
  }
  if (record >= SERIE_MINIMALE) {
    return (
      <Tuile
        key="serie"
        valeur={record}
        valeurTexte={`${record}`}
        libelle="Ma série"
        detail="ta plus longue série"
        bulle={[
          `Ta plus longue série : ${record} cours`,
          "La plus longue suite de cours que tu aies suivis d'affilée ce trimestre. Elle ne se reprend jamais.",
        ]}
      />
    );
  }
  // « À venir » est rendu dans la taille du nom de rang (`text-xl`) et non dans celle des chiffres :
  // deux mots en 30 px repousseraient leur libellé hors de la bande sur un téléphone, là où les
  // autres tuiles n'ont qu'un nombre à écrire dans la même colonne de tête.
  return (
    <Tuile
      key="serie"
      valeur={<span className="text-xl">À venir</span>}
      valeurTexte="À venir"
      libelle="Ma série"
      detail="deux cours de suite et elle s'affiche"
      bulle={[
        "Ta série",
        "Des cours suivis d'affilée, sans en manquer un entre deux. À partir de deux, elle s'affiche ici — et ton record y reste ensuite.",
      ]}
    />
  );
}

type Props = {
  /**
   * Sa propre situation, telle que la donne le compte rendu — personne d'autre n'entre ici, et
   * c'est la **seule** entrée du bloc : plus un chiffre du groupe n'y passe.
   */
  moi: CompteRendu["moi"];
};

/**
 * **« Ma progression »** — la part de l'accueil qui parle à la personne qui regarde, et à elle seule.
 *
 * Delta a validé la « gamification » : des blasons à débloquer, comme des récompenses, sous la
 * première bande d'indicateurs de la vue Personnel.
 *
 * **La règle qui prime sur tout le reste : un blason non débloqué ne doit jamais sonner comme un
 * reproche.** Le club compte des gens qui travaillent le mardi soir, des parents, des gens qui
 * viennent un cours sur trois et c'est déjà beaucoup. Tout ce qui est écrit ici a été relu avec cette
 * question : est-ce que ça peut se lire comme « tu ne fais pas assez » ? D'où trois interdits :
 * - **aucun ocre, aucun rouge** : les couleurs d'alerte disent « un geste est attendu », et ici rien
 *   n'est attendu de personne. Ce qui n'est pas gagné est neutre, jamais chaud ;
 * - **aucune phrase de manque** : on écrit « 3 sur 5 », jamais « il te manque 2 cours » ;
 * - **rien de comparatif, rien de nominatif** : personne n'est nommé, aucun rang n'est mis en face
 *   de celui d'un autre, et il n'y reste plus un seul chiffre qui ne soit le sien.
 *
 * **Et cette section n'existe qu'en vue Personnel.** En vue Club elle deviendrait un palmarès (les
 * blasons des uns lus par les autres), et la vue Admin est faite pour piloter, pas pour décorer.
 *
 * ## Une bande de tuiles, une par indicateur
 *
 * Les indicateurs s'empilaient jusqu'ici en lignes de texte dans une seule carte, et Delta les
 * comptait pour ce qu'ils paraissaient : « je n'ai toujours que 2 tuiles de gamification ». Une
 * carte qui contient cinq phrases **est** une carte — l'œil ne compte pas les phrases, il compte les
 * cadres. Chaque indicateur a donc sa tuile, comme dans les bandes Club, Personnel et Admin, dont
 * elle reprend exactement le dessin (`Tuile` et `Bande`, exportés par `Indicateurs.tsx`) : un
 * indicateur se lit partout de la même façon.
 *
 * Dans l'ordre de ce qu'on se demande sur soi :
 * 1. **Mon rang** : où j'en suis sur l'échelle du club — celle de l'**ancienneté**, et non plus
 *    celle des présences du trimestre, qui remettait tout le monde recrue tous les quatre mois —, et
 *    ce qui vient après ;
 * 2. **Ma série**, juste après le rang parce qu'elle parle de la même matière — ses présences —,
 *    mais dans leur enchaînement. C'est la plus délicate du bloc : **on y montre le record, jamais
 *    la chute** (voir `tuileSerie`). Elle reste **après** le rang, jamais avant : le rang est
 *    acquis, la série peut retomber — c'est le plus fragile des deux qui passe en second ;
 * 3. **Les blasons**, en dessous, dans leur propre carte.
 *
 * **La bande porte toujours ses deux tuiles**. « Ma série » s'effaçait quand le record n'atteignait
 * pas deux cours, et la bande se réduisait alors à « Mon rang » seul, sur une largeur faite pour
 * deux — ce que Delta a vu depuis son compte : « il manque des tuiles gaming dans l'accueil
 * user ». Une bande à moitié vide se lit comme un trou, et une tuile qui disparaît d'une visite à
 * l'autre donne l'impression que l'application a perdu quelque chose. `tuileSerie` rend donc
 * toujours une tuile : à défaut de série, elle énonce la règle (« deux cours de suite et elle
 * s'affiche »), qui n'attend rien de personne.
 *
 * **« Mon objectif » et « Le club » sont partis**. La bande ne porte donc plus que du sien : le
 * total des présences du club, dernier chiffre de groupe qu'elle contenait, s'en va avec sa tuile,
 * et la section devient entièrement personnelle. Leurs deux jauges avaient déjà disparu la veille —
 * une barre de 12 px sous un chiffre de 30 px dans une tuile de 149 px ne se lisait plus, elle
 * décorait.
 *
 * **Chaque tuile porte une bulle** : ce que les lignes de texte disaient en clair (l'échelle des
 * rangs et ses seuils, ce que « répondre » veut dire) y est repris mot pour mot. La bulle n'est
 * jamais la seule source — au doigt le survol n'existe pas —, mais l'`aria-label` de la tuile la
 * redonne d'une seule voix.
 *
 * **La grille des blasons garde sa carte à part** : c'est une collection, pas un indicateur. Elle
 * est haute, et la coller sous la bande donnerait un pavé où les tuiles se fondraient dans le décor.
 *
 * **Et cette carte est rangée en trois groupes**, dans l'ordre de `HORIZONS` : le trimestre,
 * l'assiduité, la saison. Douze écus d'affilée se lisaient comme une liste de compteurs où tout se
 * valait — celui qui demande cinq cours à côté de celui qui demande un an au club. Sous leurs
 * titres, chaque groupe répond à une question différente, et un écu vide de « La saison » ne se lit
 * plus comme un retard mais comme quelque chose qui vient avec le temps. Le compte reste en tête de
 * carte et porte la **collection entière** (« 4 blasons sur 12 ») : ce qu'on possède est un seul
 * chiffre, pas trois sous-totaux à additionner de tête. Ce total se lit sur la longueur de la
 * collection et n'est jamais écrit en dur — le groupe « L'assiduité » porte **autant d'écus de
 * créneau que le club a de soirs de cours** (« Le fer du mardi », « Le fer du jeudi »…), donc onze
 * blasons pour un club qui n'en a qu'un et dix pour un club qui n'en tient aucun régulièrement.
 *
 * Tout est **statique** : composant serveur, aucune animation, et **plus rien n'y est cliquable**
 * depuis le retrait de la tuile de l'objectif, qui portait le seul lien du bloc. L'accueil reste un
 * compte rendu — on ne « joue » pas avec ses blasons, on les croise en passant.
 */
export function BlocProgression({ moi }: Props) {
  const collection = blasons({
    presences: moi.presences,
    seancesPassees: moi.seancesPassees,
    reponses: moi.reponses,
    serie: moi.serie,
    ateliersProposes: moi.ateliersProposes,
    // `moi.presencesToutesSaisons` et non `presencesTotales` : ce dernier nom porte, dans le compte
    // rendu, le total du **club**. Deux champs homonymes sur le même écran, l'un personnel et
    // l'autre collectif, finiraient un jour par être intervertis sans que rien ne le signale.
    presencesTotales: moi.presencesToutesSaisons,
    ancienneteMois: moi.ancienneteMois,
    // Les soirs de cours du club, déduits de ses séances : c'est le compte rendu qui les a établis
    // (`joursDeCoursDuClub`), la vitrine ne fait que décerner ce qu'ils permettent.
    joursDeCours: moi.joursDeCours,
  });
  const gagnes = collection.filter((b) => b.gagne).length;

  /*
   * La marque de chaque écu est figée **ici**, sur son rang dans la collection entière, avant tout
   * rangement par horizon (voir `MARQUES`) : un blason doit garder la même marque d'une visite à
   * l'autre, et la lire sur son rang dans son groupe la déplacerait au premier blason ajouté ou
   * retiré ailleurs. L'`index` passé à `Ecu`, lui, est celui de la grille du groupe : c'est elle qui
   * a des bords, et c'est d'elle que dépend le calage des bulles.
   */
  const groupes = HORIZONS.map((horizon) => ({
    ...horizon,
    ecus: collection
      .map((blason, rang) => ({ blason, marque: MARQUES[rang % MARQUES.length] }))
      .filter(({ blason }) => blason.horizon === horizon.cle),
  }));

  /*
   * **Il n'y a pas de tuile « Mes réponses », et c'est délibéré**.
   *
   * Elle en faisait deux, en effet. La bande du dessus porte déjà « À jour / À répondre », qui dit
   * la même chose **et** appelle un geste — elle compte les cours à venir, là où la tuile comptait
   * les cours passés, mais les deux s'écrivaient « tu as répondu à tout » et se lisaient donc comme
   * un seul chiffre répété. Et le blason **« Le héraut »** récompense exactement la même vertu,
   * dans la même section, quelques centimètres plus bas.
   *
   * La règle qui en sort, et qui vaut pour tout ce qu'on ajoutera ici : **une tuile de progression
   * ne se justifie que si son chiffre n'est écrit nulle part ailleurs sur l'écran.**
   */
  const tuiles: ReactElement<PropsTuile>[] = [
    tuileRang(moi.ancienneteMois),
    // Toujours présente, quelle que soit la série : voir `tuileSerie`. Une bande à une seule tuile
    // se lit comme un trou, et celle-ci sait quoi dire même quand il n'y a aucune série à montrer.
    tuileSerie({ enCours: moi.serieEnCours, record: moi.serie }),
  ];

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xl">Ma progression</h2>

      <Bande tuiles={tuiles} />

      <div className="flex flex-col gap-4 rounded-2xl border border-bordure/60 bg-surface p-3 shadow-carte sm:p-4">
        <p className="text-sm text-texte-secondaire">
          <strong className="font-semibold text-texte">
            {gagnes} blason{gagnes > 1 ? "s" : ""} sur {collection.length}
          </strong>
        </p>
        {groupes.map((groupe) => (
          <div key={groupe.cle} className="flex flex-col gap-2">
            {/* Le titre du groupe puis, en petit, ce qu'il récompense : sans cette seconde ligne,
                « L'assiduité » et « Le trimestre » se ressembleraient assez pour qu'on cherche la
                différence dans les écus eux-mêmes. Un `h3` parce que la section a déjà son `h2`. */}
            <div className="flex flex-col gap-0.5">
              <h3 className="font-semibold leading-tight">{groupe.titre}</h3>
              <p className="text-xs leading-tight text-texte-secondaire">{groupe.quoi}</p>
            </div>
            {/* **Deux colonnes sur téléphone, quatre sur grand écran** — c'est-à-dire, dans les
                deux cas, un groupe qui **remplit** ses lignes : chaque horizon compte exactement
                quatre blasons, et trois colonnes laissaient le quatrième seul sur une deuxième
                ligne, ce qui se lit comme un oubli. À 390 px, la moitié de la largeur laisse « Le
                maître d'armes de papier » tenir sans se couper en trois ; sur PC, les quatre écus
                d'un horizon se lisent d'un seul regard, côte à côte, ce qui est exactement ce que
                le groupe raconte. Le `sm:` est sûr **ici** : les points de rupture de Tailwind
                regardent la fenêtre et non le conteneur, or ce bloc occupe toute la largeur de la
                vue Personnel. C'est du temps où il vivait dans une demi-colonne que vient la
                cicatrice des noms coupés en deux (« Le tapis / usé ») — si la vitrine y retourne un
                jour, ce `sm:` doit sauter. */}
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {groupe.ecus.map(({ blason, marque }, i) => (
                <Ecu key={blason.cle} blason={blason} marque={marque} index={i} />
              ))}
            </ul>
          </div>
        ))}
        {/* Écrit une fois, en petit, et c'est ce qui rend la grille inoffensive : un écu vide n'est
            pas une dette, et un écu plein ne se reperd pas à la première absence. */}
        <p className="text-xs text-texte-secondaire">Un blason gagné ne se reprend jamais.</p>
      </div>
    </section>
  );
}
