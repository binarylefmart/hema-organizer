import type { ReactElement, ReactNode } from "react";
import type { BlocAdmin } from "@/lib/accueil";
import { capitale, formatDateCourte, minuscule } from "@/lib/dates";
import { FENETRE_DECROCHAGE, SEUIL_NOYAU } from "@/lib/pilotage";
import { Bulle } from "@/components/ui/Bulle";
import { Icone } from "@/components/ui/Icone";

type Ton = "neutre" | "ocre" | "vert" | "rouge";

const COULEURS: Record<Ton, string> = {
  neutre: "text-texte",
  ocre: "text-ocre",
  vert: "text-vert",
  // Le rouge ne sert qu'à une fréquentation qui recule : c'est la seule chose de cet écran qui soit
  // vraiment mauvaise. Ailleurs, un chiffre qui demande un geste est ocre, pas rouge — on rend
  // compte, on n'alarme pas.
  rouge: "text-rouge",
};

/**
 * **Combien de noms une bulle écrit avant de compter les autres.**
 *
 * Au-delà, la bulle devient un annuaire : on ne la lit plus, on la parcourt. Six tient en deux
 * lignes dans la largeur d'une bulle et laisse voir *qui* est concerné, ce qui est tout ce qu'on
 * lui demande — le compte exact, lui, est déjà écrit en grand sur la tuile.
 */
const NOMS_MONTRES = 6;

/** « Jean, Marie, … et 3 autres » — une liste qui reste une phrase, quelle que soit sa longueur. */
function listeCourte(elements: readonly string[]): string {
  if (elements.length <= NOMS_MONTRES) return elements.join(", ");
  const reste = elements.length - NOMS_MONTRES;
  return `${elements.slice(0, NOMS_MONTRES).join(", ")} et ${reste} autre${reste > 1 ? "s" : ""}`;
}

/** Les dates d'une bulle : « Vendredi 3 oct. », dans l'ordre reçu, écourtées comme les noms. */
function listeDeDates(iso: readonly string[]): string {
  return listeCourte(iso.map(formatDateCourte));
}

export type PropsTuile = {
  valeur: ReactNode;
  libelle: string;
  /**
   * La ligne en petit sous le libellé. Du texte, aujourd'hui, dans toutes les tuiles de
   * l'application — le type accepte un fragment parce qu'une tuile a déjà porté un lien dans son
   * détail. Si le cas revient, il faut donner `detailTexte` avec, sans quoi l'`aria-label` de la
   * tuile perdrait cette ligne.
   */
  detail: ReactNode;
  ton?: Ton;
  /**
   * Ce que la tuile a à dire **de plus** au survol, une ligne par entrée : qui se cache derrière le
   * chiffre (les noms, les dates), ou comment il est calculé.
   *
   * Vide ou absent, la tuile n'a rien à ajouter et ne reçoit aucune bulle : on ne montre pas une
   * bulle pour y écrire ce que le libellé dit déjà.
   */
  bulle?: string[];
  /** La valeur en toutes lettres, quand `valeur` n'est pas du texte (« 7 / 18 », une icône). */
  valeurTexte?: string;
  /** Le détail en toutes lettres, quand `detail` n'est pas du texte (un détail qui porte un lien). */
  detailTexte?: string;
};

/**
 * Une tuile de la bande : **une bande horizontale, une par ligne** — le chiffre et son libellé à
 * gauche, ce qui complète à droite.
 *
 * **Pourquoi une bande plutôt qu'une case**. En cases de deux à quatre colonnes, le libellé et le
 * détail devaient tenir dans une demi-largeur de téléphone : ils étaient écrits court **pour la
 * grille**, et la moindre phrase un peu longue repoussait la liste des cours d'une ligne sur toute
 * la rangée. Empilées, les tuiles se lisent comme un tableau — une ligne, un chiffre — et chacune
 * n'occupe plus que sa propre hauteur.
 *
 * **Les deux bouts sont tenus.** Le chiffre et le libellé se collent au bord gauche, le détail au
 * bord droit : sur un grand écran, une bande de 1 200 px ne laisse donc pas un nombre seul et perdu
 * à gauche d'une ligne vide — l'œil a un point d'ancrage à chaque extrémité, et c'est le blanc du
 * milieu qui s'étire. Le chiffre garde une largeur minimale (`min-w-20`) pour que les libellés
 * s'alignent verticalement d'une tuile à l'autre : c'est cette colonne invisible qui fait tenir la
 * pile ensemble. Sur un téléphone, `flex-wrap` renvoie simplement le détail à la ligne suivante.
 *
 * **Rien de cliquable nulle part** — l'accueil est un compte rendu, pas un tableau de commandes. La
 * seule exception qu'ait connue l'écran était la tuile « Mon objectif », dont le détail portait un
 * lien ; elle est partie, et avec elle le dernier endroit cliquable du bloc.
 *
 * **Exportée** (avec {@link Bande} et {@link Rapport}) parce que « Ma progression » rend elle aussi
 * une bande de tuiles : un indicateur se lit partout de la même façon, et deux dessins de tuile sur
 * le même écran se liraient comme deux natures de chiffres.
 *
 * **La bulle est un supplément, jamais le porteur de l'information.** Un chiffre de pilotage pose
 * toujours la même question — *qui*, derrière ce nombre ? —, et la bulle y répond au survol et au
 * focus clavier (d'où le `tabIndex={0}` et l'anneau de focus, posés seulement sur les tuiles qui
 * ont quelque chose à dire). Au doigt, le survol n'existe pas : la tuile reste donc lisible telle
 * quelle, et c'est l'`aria-label` — valeur, libellé, détail, puis le contenu de la bulle — qui
 * redonne le tout d'une seule voix, la bulle elle-même étant `aria-hidden`.
 */
export function Tuile({ valeur, libelle, detail, ton = "neutre", bulle, valeurTexte, detailTexte }: PropsTuile) {
  const parle = bulle !== undefined && bulle.length > 0;
  const texte = valeurTexte ?? (typeof valeur === "string" ? valeur : null);
  const texteDetail = detailTexte ?? (typeof detail === "string" ? detail : "");
  return (
    <li
      tabIndex={parle ? 0 : undefined}
      aria-label={parle ? `${[texte, libelle].filter(Boolean).join(" — ")} — ${texteDetail}. ${bulle.join(" ")}` : undefined}
      className="group relative flex min-h-16 flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-2xl border border-bordure/60 bg-surface px-3 py-2.5 shadow-carte outline-offset-2 focus-visible:outline-3 focus-visible:outline-jauge sm:px-4 sm:py-3"
    >
      <span className="flex min-w-0 items-center gap-3">
        {/* `min-w-20` : la colonne invisible sur laquelle s'alignent les libellés de toute la pile.
            Elle ne borne rien — un « +53 % » plus large pousse simplement son libellé. */}
        <span className={`flex min-w-20 items-center text-3xl font-bold leading-none ${COULEURS[ton]}`}>{valeur}</span>
        <span className="font-semibold leading-tight">{libelle}</span>
      </span>
      <span className="text-sm leading-tight text-texte-secondaire sm:text-right">{detail}</span>
      {parle && (
        /* La bulle s'accroche au bord gauche : la tuile occupe toute la largeur, une bulle centrée
           sur elle sortirait de l'écran par la droite (voir `coteEnGrille`, qui règle le même
           problème pour les grilles). */
        <Bulle cote="gauche">
          {bulle.map((ligne, i) => (
            // La première ligne porte le propos, les suivantes le détaillent (les noms, les dates) :
            // c'est le même dessin que la bulle des blasons, nom en tête et explication dessous.
            <span key={ligne} className={i === 0 ? "font-semibold" : undefined}>
              {ligne}
            </span>
          ))}
        </Bulle>
      )}
    </li>
  );
}

/**
 * « 7 / 18 » : un chiffre et son repère, dans une seule tuile.
 *
 * Le premier se lit de loin, le second passe en retrait — deux nombres de même taille se lisent
 * comme deux indicateurs, et l'œil ne sait plus lequel compte. C'est ce qui permet de fondre deux
 * tuiles en une (les présents et les invités, un créneau et l'autre) sans rien perdre, et surtout sans
 * écrire deux fois le même nombre sur le même écran.
 */
export function Rapport({ premier, second }: { premier: ReactNode; second: ReactNode }) {
  return (
    <>
      {premier}
      <span className="ml-1 text-xl font-semibold text-texte-secondaire">/ {second}</span>
    </>
  );
}

/** « 4,8 » : une décimale et la virgule française — `toFixed` écrirait un point. */
function unDecimal(n: number): string {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/**
 * **Les tuiles en bandes : une par ligne sur un téléphone, deux par rangée dès qu'il y a la place.**
 *
 * **Partagée** : les quatre bandes de l'accueil — Club, Personnel, Admin, le trimestre en chiffres —
 * et celle de « Ma progression » passent toutes par ici. C'est elle qui garantit qu'un indicateur se
 * lit partout de la même façon, quel que soit le bloc qui l'a fabriquée.
 *
 * **Une seule mise en page**, et elle a bougé deux fois. D'abord la grille de deux à quatre
 * colonnes est tombée : elle rendait comparables des chiffres qui n'ont rien à voir (« Silencieux »
 * à côté de « La salle »), imposait à tous les libellés la largeur de la case la plus étroite, et
 * demandait une propriété « large » posée à la main pour boucher le trou d'un nombre impair. Puis
 * la pile d'une seule colonne est tombée à son tour, sur les captures d'un grand écran : une bande
 * de trois mots étirée sur 1 400 px met son chiffre et son détail à trente centimètres l'un de
 * l'autre. Deux colonnes, donc — et le trou du nombre impair se bouche **en CSS**, sans rien
 * compter, ce qui était le seul vrai reproche fait à la grille d'origine.
 *
 * Les libellés et les détails restent courts pour autant — une bande qui passe à deux lignes de
 * texte sur un téléphone repousse d'autant la liste des cours, qui est ce que l'on vient voir.
 */
export function Bande({ tuiles }: { tuiles: ReactElement<PropsTuile>[] }) {
  /*
   * **Deux colonnes dès qu'il y a la place, et jamais de trou**.
   *
   * Une tuile est une bande : un chiffre à gauche, son libellé, et le détail poussé à droite. Sur une
   * page large, cette bande occupait toute la largeur pour trois mots — le chiffre et son détail se
   * retrouvaient à trente centimètres l'un de l'autre, avec un vide au milieu que l'œil doit
   * traverser. Deux colonnes rapprochent les deux bouts **et** montrent deux fois plus d'indicateurs
   * sans dérouler.
   *
   * **Le trou, lui, est interdit** : un nombre impair de tuiles laisserait la dernière seule dans sa
   * rangée, à côté d'une case vide. Elle reprend donc les deux colonnes — c'est ce que fait la
   * variante `[&>li:last-child:nth-child(odd)]`, en CSS seul, sans compter les tuiles côté serveur ni
   * poser une propriété « large » à la main comme le faisait la grille d'avant le 29/09.
   *
   * Ce qui **ne** passe **pas** en colonnes : les fiches de cours. Une séance porte une liste
   * nominative, une jauge et trois réponses ; côte à côte, elles retomberaient dans le défaut que la
   * pile avait corrigé — une séance annulée de 90 px laissant un demi-écran de blanc à côté d'une
   * séance à sept parties.
   */
  /*
   * **Et le palier mesure la BANDE, pas la fenêtre**.
   *
   * C'était `sm:grid-cols-2`, donc « deux colonnes dès que la **fenêtre** fait 640 px ». Or depuis
   * le 01/10 ces bandes vivent dans la **colonne de droite** de `DeuxColonnes`, large de 22 rem
   * (352 px) : sur un grand écran, la fenêtre autorisait les deux colonnes et chaque tuile se
   * retrouvait dans 170 px — le chiffre, son libellé et son détail débordaient de la tuile, « cours
   * en attente » passant par-dessus la bordure. Le commentaire de l'appelant annonçait pourtant
   * l'inverse (« elles passent à une colonne dans la colonne de droite ») : c'était vrai de
   * l'intention, faux du code, et c'est la troisième fois que ce dépôt paie la même leçon — **`sm:`
   * et `lg:` mesurent la fenêtre, jamais le conteneur** (voir
   * `tests/unit/bandes-pleine-largeur.test.ts`).
   *
   * La requête de conteneur mesure la boîte : `@xl` (36 rem) reprend la largeur qu'avait une bande
   * pleine page au moment où elle se coupait en deux, donc le même rendu qu'avant partout où la bande
   * est large — et une seule colonne dans l'aside, quelle que soit la taille de l'écran. Le `div`
   * porte `@container` parce qu'un élément ne peut pas interroger sa propre boîte.
   */
  return (
    <div className="@container">
      <ul className="grid gap-2 @xl:grid-cols-2 [&>li:last-child:nth-child(odd)]:@xl:col-span-2">{tuiles}</ul>
    </div>
  );
}

type PropsClub = {
  /** Cours encore à venir sur la période */
  aVenir: number;
};

/**
 * La bande « Club » : de quoi s'organiser, et rien de plus.
 *
 * **Ce qui reste ici est ce qui n'est écrit nulle part ailleurs sur l'écran** : la frise, juste
 * au-dessus, dit déjà combien de monde vient à chaque prochain cours, et chaque carte porte son
 * propre nombre de présents. La bande ne garde donc qu'une chose :
 * 1. **Cours restants** : ce qui reste au calendrier, la profondeur de champ du trimestre.
 *
 * **Ce qui n'y est plus.** La participation moyenne et le nombre d'invités restés muets ont rejoint
 * la vue Admin : ce sont des chiffres qui appellent un travail d'équipe (relancer, décider en
 * réunion de bureau), pas de quoi savoir si on prend son masque mardi. Le club ne perd rien au
 * change — le détail nominatif de chaque cours reste ouvert à tous, replié sous chaque carte de
 * l'onglet Séances, où vivent désormais les cartes.
 *
 * La bande s'adapte à ce qui existe : sans prochain cours au calendrier (fin de trimestre, ou les
 * trois prochains annulés), son premier chiffre vaudrait 0 sans rien vouloir dire, et on le retire
 * plutôt que d'afficher un zéro trompeur.
 *
 * Aucune bulle ici : ces chiffres-là n'ont personne derrière eux, et un calendrier n'a rien à
 * expliquer. Les bulles vivent dans la vue Admin, où un nombre pose toujours la question « qui ? ».
 */
export function IndicateursClub({ aVenir }: PropsClub) {
  // La tuile « Prochain cours » a été retirée : la frise, juste au-dessus, montre déjà ce cours —
  // et affichait un autre nombre (l'effectif attendu, là où la tuile comptait les seuls présents).
  // Deux chiffres différents pour la même séance, à dix centimètres l'un de l'autre, se lisaient
  // comme une contradiction. La frise reste, elle est plus riche ; la bande dit ce qu'elle ne dit pas.
  const tuiles: ReactElement<PropsTuile>[] = [];
  tuiles.push(
    <Tuile
      key="restants"
      valeur={aVenir}
      libelle="Cours restants"
      detail={aVenir > 0 ? "d'ici la fin du trimestre" : "plus rien de prévu"}
    />,
  );
  return <Bande tuiles={tuiles} />;
}

type PropsPerso = {
  aVenir: number;
  /** La situation de la personne connectée, telle que la donne le compte rendu */
  moi: { presences: number; seancesPassees: number; pourcentage: number; sansReponse: number };
};

/**
 * La bande « Personnel » : la même page, vue de sa place.
 *
 * Trois chiffres, dans l'ordre des questions qu'on se pose sur soi :
 * 1. **Ma présence** : mon taux sur le trimestre, et le compte qui le fabrique (« 2 cours sur 7 »).
 * 2. **À répondre** : les cours qui attendent encore ma réponse — le seul qui demande un geste,
 *    d'où l'ocre, et la seule tuile qui devienne verte quand il n'y a plus rien à faire. Le bouton
 *    qui mène à ces réponses est juste au-dessus, dans cette vue et dans elle seule.
 * 3. **Cours à venir** : ce qui m'attend d'ici la fin du trimestre — le même chiffre que côté
 *    club, et c'est normal : le calendrier ne change pas selon qui le regarde.
 *
 * Mon taux est ici sans son repère de groupe : le taux moyen du club est un chiffre de pilotage,
 * il vit dans la vue Admin. Se comparer aux autres n'est pas ce qu'on vient chercher en ouvrant
 * l'application — savoir ce qu'on a encore à répondre, si.
 *
 * Hors période, ou pour quelqu'un qui n'est invité sur aucune séance passée (un instructeur, une
 * recrue du jour), « Ma présence » tomberait à 0 % sans rien vouloir dire : on la retire.
 */
export function IndicateursPersonnels({ aVenir, moi }: PropsPerso) {
  const tuiles: ReactElement<PropsTuile>[] = [];
  if (moi.seancesPassees > 0) {
    tuiles.push(
      <Tuile key="presence" valeur={`${moi.pourcentage} %`} libelle="Ma présence" detail={`${moi.presences} cours sur ${moi.seancesPassees}`} />,
    );
  }
  tuiles.push(
    moi.sansReponse > 0 ? (
      <Tuile key="repondre" ton="ocre" valeur={moi.sansReponse} libelle="À répondre" detail="cours en attente" />
    ) : (
      <Tuile key="repondre" ton="vert" valeur={<Icone nom="check" taille={30} strokeWidth={2.5} titre="À jour" />} libelle="À jour" detail="tu as répondu à tout" />
    ),
    <Tuile
      key="restants"
      valeur={aVenir}
      libelle="Cours restants"
      detail={aVenir > 0 ? "d'ici la fin du trimestre" : "plus rien de prévu"}
    />,
  );
  return <Bande tuiles={tuiles} />;
}

type PropsAdmin = {
  /** Les chiffres de pilotage, calculés côté serveur derrière `settings.technical`. */
  admin: BlocAdmin;
  /** Séances déjà passées : en dessous de 1, ni la moyenne ni le décrochage ne reposent sur quoi que ce soit. */
  seancesPassees: number;
  /**
   * Cours encore à venir sur **tout** le trimestre — le même chiffre que la vue Club.
   *
   * Il sert de dénominateur à « Cours en danger », qui compte sur tout ce qui reste et non sur les
   * quatre cours mis en avant : écrire « 0 sur les 4 prochains » quand douze cours restent à venir
   * rassurerait à tort.
   */
  aVenir: number;
};

/**
 * La bande « Admin » : ce qui appelle un geste de l'équipe, et rien qui se lise déjà ailleurs.
 *
 * **La règle de cette bande est qu'aucun de ses chiffres n'est ailleurs sur la page.** Elle a
 * commencé par répéter la vue Club — le taux du trimestre y était mot pour mot, l'effectif invité
 * aussi, à la formulation près (« N annoncés sur M »). Une troisième position de bascule qui
 * redonne les mêmes nombres ne sert à rien : on l'ouvre une fois, on n'y revient pas. Les deux
 * doublons sont partis.
 *
 * **Cette bande-ci ne garde que ce qui appelle un geste** ; ce qui se lit et ne se fait pas est
 * descendu dans « Le trimestre en chiffres », juste en dessous (voir `ChiffresDuTrimestre`).
 *
 * Ce qui reste répond à des questions que personne d'autre ne se pose sur cet écran :
 * 1. **Taux de réponse** : s'est-on prononcé sur les prochains cours ? C'est lui qui dit s'il faut
 *    relancer — le taux de présence, lui, ne dit que qui vient. À 40 % de réponses, un cours qui
 *    paraît vide n'est pas vide : on n'en sait encore rien.
 * 2. **Silencieux** : combien de personnes n'ont répondu à *aucun* des prochains cours. Un total de
 *    réponses manquantes ne le dit pas ; celles-là s'appellent une par une.
 * 3. **Cours en danger** : combien de prochains cours passeraient sous le seuil d'effectif, et
 *    surtout **quand tombe le plus proche**. La frise juste au-dessus montre le mois, colonne par
 *    colonne ; elle ne nomme pas la date, et c'est la date qui décide si on relance ce soir.
 * 4. **La salle** : combien de personnes sur le tapis, sur combien d'invités — « 7 / 18 » d'un seul
 *    coup d'œil. « 7 présents en moyenne » se lit sans traduction là où « 80 % » sonne bien même
 *    quand on est quatre, et l'effectif invité n'est plus écrit deux fois sur le même écran (il
 *    avait sa propre tuile, qui redisait ce nombre trois lignes plus bas).
 * 5. **Jamais venus** et **Décrochages** vivent côte à côte sans se répéter : la première compte
 *    ceux qui ne sont jamais venus du trimestre, la seconde ceux qui venaient et ne viennent plus
 *    (absents des trois derniers cours). Elles ne comptent jamais la même personne, et ce sont deux
 *    appels très différents à passer.
 *
 * **Les bulles : le nom derrière le nombre.** Une tuile de relance dit « 4 » ; le geste qu'elle
 * appelle, lui, demande *lesquels*. Le survol (et la tabulation) donne donc les noms pour les
 * quatre tuiles de personnes, les dates pour les deux tuiles de cours, et pour les deux chiffres
 * calculés — le taux de réponse, la salle — **la règle de calcul**, qui est la seule chose qu'on
 * puisse leur demander de plus. Une tuile qui n'a rien à ajouter n'a pas de bulle : « personne à
 * relancer » se lit déjà en toutes lettres, et une bulle vide serait une promesse déçue.
 *
 * Ce qui se clique — ateliers à trancher, réponses à relancer — vit dans le bloc de l'encadrement
 * juste en dessous : une tuile se regarde, un signal mène quelque part.
 *
 * Les chiffres de relance ne veulent rien dire sans cours à venir (fin de trimestre, prochains
 * cours tous annulés), ceux du groupe sans cours déjà passé : dans les deux cas on retire le
 * paquet plutôt que d'afficher des zéros trompeurs.
 */
export function IndicateursAdmin({ admin: a, seancesPassees, aVenir }: PropsAdmin) {
  const tuiles: ReactElement<PropsTuile>[] = [];
  if (a.prochainsCours > 0) {
    tuiles.push(
      <Tuile
        key="reponse"
        valeur={`${a.tauxReponse} %`}
        libelle="Taux de réponse"
        detail={a.prochainsCours > 1 ? `sur les ${a.prochainsCours} prochains cours` : "sur le prochain cours"}
        bulle={[
          "Se prononcer, c'est avoir dit Présent, Absent ou Peut-être.",
          "À 90 % de réponses, un cours à trois personnes est un cours à trois personnes ; à 40 %, on ne sait encore rien.",
        ]}
      />,
      a.silencieux > 0 ? (
        <Tuile
          key="silencieux"
          ton="ocre"
          valeur={a.silencieux}
          libelle="Silencieux"
          detail="sans aucune réponse"
          bulle={
            a.silencieuxNoms.length > 0 ? ["Pas un mot sur les prochains cours :", listeCourte(a.silencieuxNoms)] : undefined
          }
        />
      ) : (
        <Tuile
          key="silencieux"
          ton="vert"
          valeur={<Icone nom="check" taille={30} strokeWidth={2.5} titre="Personne à relancer" />}
          libelle="Silencieux"
          detail="personne à relancer"
        />
      ),
      // Le seuil d'effectif est déjà tracé sur la frise, mais une frise se lit en diagonale : ce
      // qui manque, c'est la date du cours menacé. On la donne en toutes lettres, parce que c'est
      // elle qui dit s'il reste le temps d'écrire au club.
      a.coursEnDanger > 0 ? (
        <Tuile
          key="danger"
          ton="ocre"
          valeur={a.coursEnDanger}
          libelle="Cours en danger"
          detail={a.prochainCoursEnDanger ? `le ${minuscule(formatDateCourte(a.prochainCoursEnDanger))}` : "sous le seuil d'effectif"}
          bulle={a.coursEnDangerDates.length > 0 ? ["Sous le seuil d'effectif :", listeDeDates(a.coursEnDangerDates)] : undefined}
        />
      ) : (
        <Tuile
          key="danger"
          ton="vert"
          valeur={a.coursEnDanger}
          libelle="Cours en danger"
          detail={aVenir > 1 ? `sur les ${aVenir} qui restent` : "sur le cours qui reste"}
        />
      ),
    );
  }
  if (seancesPassees > 0) {
    // « 0 / 0 » ne dirait rien : sans un seul invité sur la période (annuaire vidé, trimestre en
    // cours de montage), la tuile se tait plutôt que d'aligner deux zéros.
    if (a.invites > 0) {
      tuiles.push(
        <Tuile
          key="salle"
          valeur={<Rapport premier={a.participationMoyenne} second={a.invites} />}
          valeurTexte={`${a.participationMoyenne} sur ${a.invites}`}
          libelle="La salle"
          detail="présents sur invités, en moyenne"
          bulle={[
            "La moyenne des présents sur les cours déjà donnés.",
            `Le second nombre est l'effectif invité du trimestre : ${a.invites} personnes, venues ou non.`,
          ]}
        />,
      );
    }
    tuiles.push(
      <Tuile
        key="dormants"
        ton={a.jamaisVenus > 0 ? "ocre" : "neutre"}
        valeur={a.jamaisVenus}
        libelle="Jamais venus"
        detail="depuis le début du trimestre"
        bulle={a.jamaisVenusNoms.length > 0 ? ["Invités, jamais vus au cours :", listeCourte(a.jamaisVenusNoms)] : undefined}
      />,
      // Le pendant de la tuile précédente : ceux-là sont venus, puis ont cessé. Une moyenne tient
      // bon pendant qu'ils s'éloignent — seul ce compte les fait apparaître, un par un.
      a.decrochages > 0 ? (
        <Tuile
          key="decrochages"
          ton="ocre"
          valeur={a.decrochages}
          libelle="Décrochages"
          detail={`absents des ${FENETRE_DECROCHAGE} derniers cours`}
          bulle={
            a.decrochagesNoms.length > 0
              ? [
                  // Ces gens-là venaient : ils savent où est la salle et connaissent le groupe. La
                  // bulle le dit, pour que la liste se lise comme un carnet d'adresses et non comme
                  // une liste de fautifs.
                  "Ils venaient, puis se sont arrêtés — un appel à passer, pas un reproche.",
                  listeCourte(a.decrochagesNoms),
                ]
              : undefined
          }
        />
      ) : (
        <Tuile key="decrochages" ton="vert" valeur={a.decrochages} libelle="Décrochages" detail="personne ne s'éloigne" />
      ),
    );
  }
  // Ceux qui ne sont jamais entrés : ils ne répondent pas faute d'avoir ouvert leur lien, et aucun
  // autre chiffre ne les sépare des silencieux. Un email à renvoyer, pas une relance à faire.
  if (a.liensJamaisOuverts > 0) {
    tuiles.push(
      <Tuile
        key="liens"
        ton="ocre"
        valeur={a.liensJamaisOuverts}
        libelle="Liens jamais ouverts"
        detail="invitations restées sans usage"
        bulle={
          a.liensJamaisOuvertsNoms.length > 0
            ? ["Un email à renvoyer, pas une relance :", listeCourte(a.liensJamaisOuvertsNoms)]
            : undefined
        }
      />,
    );
  }
  // Le programme qui manque se voit la veille, quand il est trop tard pour s'organiser.
  if (a.coursSansProgramme > 0) {
    tuiles.push(
      <Tuile
        key="programme"
        ton="ocre"
        valeur={a.coursSansProgramme}
        libelle="Sans programme"
        detail="parmi les prochains cours"
        bulle={a.coursSansProgrammeDates.length > 0 ? ["Aucune case du planning remplie :", listeDeDates(a.coursSansProgrammeDates)] : undefined}
      />,
    );
  }
  // La tuile « Invités » a disparu : son chiffre est désormais le second de « La salle », où il dit
  // enfin quelque chose (7 sur 18, ce n'est pas 7 sur 8). Seul, il ne servait qu'à répéter un
  // nombre que la même bande écrivait déjà.
  //
  // Avant le premier cours de la saison et sans rien au calendrier, il ne reste aucune tuile : une
  // grille vide dessinerait une bordure autour de rien.
  if (tuiles.length === 0) return null;
  return <Bande tuiles={tuiles} />;
}

/**
 * La seconde bande du bureau : **ce qui se lit, quand la première ne garde que ce qui se fait**.
 *
 * La bande du dessus a un seul travail — dire quoi faire d'ici le prochain cours (qui relancer,
 * quel cours est menacé, qui s'éloigne). Ces chiffres-là n'appellent aucun geste le jour même : ils
 * disent où en est le trimestre, et c'est en réunion de bureau qu'on en fait quelque chose. Les
 * mélanger aux premiers noyait les deux — d'où le titre, qui annonce un autre registre de lecture.
 *
 * Dans l'ordre :
 * 1. **Tendance** : le trimestre monte-t-il ou descend-il ? Une moyenne seule ne le dit jamais, et
 *    c'est pourtant la seule question à laquelle un président veut une réponse. Le détail donne les
 *    deux bouts (« 4,8 puis 7,3 présents ») : sans eux, « +53 % » peut vouloir dire trois personnes.
 * 2. **Assiduité médiane** : la moitié du club est en dessous. La moyenne, elle, se laisse tirer
 *    vers le haut par trois fidèles qui ne manquent rien.
 * 3. **Le noyau** : combien viennent à deux cours sur trois — les gens sur qui un stage se monte.
 * 4. **Plus longue série** : ce qu'on cite à l'assemblée générale, et la seule tuile de l'écran qui
 *    nomme quelqu'un (quand une seule personne détient la série).
 * 5. **Un créneau contre l'autre** : celui qui porte le club et celui qui s'essouffle, côte à côte.
 *    On ne l'affiche qu'à deux créneaux exactement — à un seul il n'y a rien à comparer, à trois la
 *    tuile deviendrait un tableau.
 *
 * **Les bulles de cette bande n'appellent personne** — c'est la différence avec celles du dessus.
 * Elles disent d'où sort le chiffre (quelles moitiés de trimestre on compare, sur combien de cours
 * porte une moyenne de créneau), situent la médiane dans l'étendue des taux du club, et nomment le
 * noyau et les meilleures séries : ce qu'on cite à l'assemblée générale, pas ce qu'on relance.
 *
 * Chaque tuile ne paraît que si elle repose sur quelque chose (un trimestre commencé, assez de
 * cours passés pour comparer un début et une fin, deux créneaux dans la semaine) ; si aucune ne
 * tient debout, la section entière disparaît plutôt que d'afficher un titre suivi de rien.
 */
export function ChiffresDuTrimestre({ admin: a, seancesPassees }: { admin: BlocAdmin; seancesPassees: number }) {
  const tuiles: ReactElement<PropsTuile>[] = [];
  if (a.tendance) {
    const t = a.tendance;
    // Le signe est écrit à la main pour deux raisons : il est **toujours** présent (« +0 % » se lit
    // comme une stabilité, « 0 % » comme une absence de mesure), et c'est le vrai signe moins
    // (U+2212) et non le trait d'union que poserait `Intl` — à cette taille, un tiret se confond
    // avec un trait de séparation.
    tuiles.push(
      <Tuile
        key="tendance"
        ton={t.variation >= 0 ? "vert" : "rouge"}
        valeur={`${t.variation < 0 ? "−" : "+"}${Math.abs(t.variation)} %`}
        libelle="Tendance"
        detail={`${unDecimal(t.debut)} puis ${unDecimal(t.fin)} présents`}
        bulle={[
          "La première moitié du trimestre comparée à la seconde.",
          "Des moitiés plutôt que les deux derniers cours : un cours creux (vacances, météo) ne fait pas une tendance. Sur un nombre impair, le cours du milieu compte des deux côtés.",
        ]}
      />,
    );
  }
  if (seancesPassees > 0) {
    tuiles.push(
      <Tuile
        key="mediane"
        valeur={`${a.assiduiteMediane} %`}
        libelle="Assiduité médiane"
        detail="la moitié du club est en dessous"
        bulle={
          a.assiduiteEtendue
            ? [
                `Du plus bas au plus haut : ${a.assiduiteEtendue.min} % à ${a.assiduiteEtendue.max} %.`,
                "La médiane est le taux de la personne du milieu : quelques inscrits jamais venus tireraient une moyenne vers le bas.",
              ]
            : undefined
        }
      />,
      <Tuile
        key="noyau"
        valeur={a.noyau}
        libelle="Le noyau"
        detail="présents à 2 cours sur 3"
        bulle={a.noyauNoms.length > 0 ? [`Présents à au moins ${SEUIL_NOYAU} % des cours passés :`, listeCourte(a.noyauNoms)] : undefined}
      />,
    );
  }
  if (a.serie) {
    const s = a.serie;
    tuiles.push(
      <Tuile
        key="serie"
        valeur={s.longueur}
        libelle="Plus longue série"
        // À plusieurs, on ne peut plus citer un nom sans en oublier : on dit combien ils sont.
        detail={s.combien === 1 ? `cours d'affilée, ${s.qui}` : `cours d'affilée, ${s.combien} personnes`}
        // Le podium rend à la tuile ce que le seul maximum lui retire : à trois ex æquo, le détail
        // n'écrit plus aucun nom, et c'est justement là qu'on veut savoir lesquels.
        bulle={
          a.meilleuresSeries.length > 0
            ? ["Les plus longues séries du trimestre :", ...a.meilleuresSeries.slice(0, 3).map((m) => `${m.qui} — ${m.longueur} cours`)]
            : undefined
        }
      />,
    );
  }
  if (a.parJour.length === 2) {
    const [premier, second] = a.parJour;
    tuiles.push(
      <Tuile
        key="jours"
        valeur={<Rapport premier={unDecimal(premier.moyenne)} second={unDecimal(second.moyenne)} />}
        valeurTexte={`${unDecimal(premier.moyenne)} contre ${unDecimal(second.moyenne)}`}
        libelle={`${capitale(premier.jour)} contre ${second.jour}`}
        detail="présents en moyenne"
        bulle={[
          `La moyenne des présents sur les ${premier.cours} cours du ${premier.jour} et les ${second.cours} du ${second.jour}.`,
          "Un jour n'entre dans la comparaison qu'à partir de deux cours tenus : sur un seul, la « moyenne » serait ce cours-là.",
        ]}
      />,
    );
  }
  if (tuiles.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xl">Le trimestre en chiffres</h2>
      <Bande tuiles={tuiles} />
    </section>
  );
}
