import { libelleSaison } from "./periodes";

export { libelleSaison };

/**
 * **Blasons et rangs** — la part « récompense » de la vue Personnel (fonctions pures, testées).
 *
 * ## La règle qui prime sur toutes les autres
 *
 * **Un blason non débloqué ne doit jamais sonner comme un reproche.** Le club compte des gens qui
 * travaillent le mardi soir, qui gardent des enfants, qui habitent à quarante minutes de la salle :
 * leur emploi du temps n'est pas un mérite, et son contraire n'est pas une faute. Une vue qui
 * récompense la présence court donc un vrai risque — celui de dire à quelqu'un, chiffres à l'appui,
 * qu'il est un mauvais membre parce qu'il travaille. Trois décisions tiennent cette règle, et elles
 * vivent ici plutôt que dans les composants pour qu'aucun écran ne puisse s'en écarter :
 *
 * - **rien ne se reprend en cours de route.** À l'intérieur d'un horizon donné, {@link blasons} ne
 *   regarde que des compteurs qui montent (présences, plus longue série, ateliers proposés, mois
 *   d'ancienneté) : un blason gagné en octobre est toujours là en décembre, quoi qu'il arrive
 *   ensuite. Un badge qui redescendrait en pleine saison transformerait une récompense en dette, et
 *   une dette en reproche.
 *
 *   **La rentrée, elle, remet le compteur des deux premiers horizons à zéro, et c'est assumé.** Les
 *   blasons du « trimestre » et de « l'assiduité » se calculent sur le trimestre en cours (les
 *   compteurs que l'accueil leur passe viennent de la période affichée) : à chaque nouveau
 *   trimestre, ils se rejouent. C'est exactement ce que la vitrine annonce, horizon par horizon —
 *   « Ce qui se rejoue à chaque trimestre », « Le rythme, pas le nombre » —, et c'est pour cela que
 *   l'horizon « La saison » existe : lui seul ne retombe jamais (il compte les présences depuis
 *   l'arrivée au club et l'ancienneté), et c'est lui qui porte la mémoire longue. La règle se lit
 *   donc ainsi : **un blason ne se reprend pas ; un trimestre, si, et il recommence pour tout le
 *   monde le même jour.** Une remise à zéro que le club vit ensemble n'est pas un retrait ;
 * - **la progression est chiffrée, et rien de plus.** `progres` donne « 3 sur 5 » ; aucun texte de
 *   ce module ne dit « il te manque », « seulement » ni « raté ». Ce n'est pas une question de ton
 *   mais de vocabulaire : il n'existe pas de façon bienveillante d'écrire un manque, alors on
 *   n'écrit que l'acquis ;
 * - **on récompense un geste, pas une disponibilité.** D'où {@link blasons} `jamais-muet`
 *   (« Le héraut »), qui
 *   couronne la seule chose qui ne dépend que de soi — répondre — et qui est aussi la seule dont le
 *   club ait réellement besoin pour s'organiser.
 *
 * ## Une collection de taille fixe
 *
 * Tous les blasons sont rendus à chaque appel, gagnés ou non, y compris ceux que le trimestre ne met
 * pas encore en jeu (« La garde de fer » demande au moins quatre cours passés). **Pourquoi :** une
 * collection à trous changerait de taille d'une semaine à l'autre, les cases se déplaceraient sous
 * les doigts, et un blason apparu de nulle part ressemblerait à une exigence ajoutée en cours de
 * route. Une vitrine se remplit, elle ne s'allonge pas.
 *
 * **La seule chose qui en fait varier la taille est le calendrier du club, pas la personne.** Les
 * blasons de créneau (« Le fer du mardi ») suivent les vrais jours de cours du club
 * ({@link joursDeCoursDuClub}) : deux soirs de cours donnent deux blasons, un seul soir en donne un,
 * et un club dont aucun créneau n'a jamais tenu quatre cours dans le même mois n'en a aucun — plutôt
 * qu'un blason inatteignable. Cela ne contredit pas la règle : le calendrier d'un club ne change pas
 * d'une semaine à l'autre, et personne ne voit sa vitrine rétrécir pour ce qu'il a fait ou pas fait.
 *
 * Aucune de ces fonctions ne touche la base : elles reçoivent des compteurs déjà calculés, ce qui
 * les rend testables au cas limite près — et les cas limites sont ici la règle, puisqu'un trimestre
 * commence toujours à zéro cours passé.
 */

/** Un blason : une récompense qui se gagne une fois et ne se reprend jamais. */
/**
 * **L'horizon d'un blason** : en combien de temps il se gagne, et sur quelle matière.
 *
 * C'est ce qui range la vitrine en trois groupes (voir {@link blasons}) — et c'est aussi ce qui
 * empêche la collection de redevenir une liste de compteurs : chaque groupe répond à une question
 * différente, « ce trimestre », « à quel rythme », « depuis mon arrivée ».
 */
export type HorizonBlason = "trimestre" | "assiduite" | "saison";

/** Le titre de chaque horizon, dans l'ordre d'affichage de la vitrine. */
export const HORIZONS: ReadonlyArray<{ cle: HorizonBlason; titre: string; quoi: string }> = [
  { cle: "trimestre", titre: "Le trimestre", quoi: "Ce qui se rejoue à chaque trimestre." },
  { cle: "assiduite", titre: "L'assiduité", quoi: "Le rythme, pas le nombre." },
  { cle: "saison", titre: "La saison", quoi: "Ce qui se construit sur des mois, et ne retombe jamais." },
];

export type Blason = {
  cle: string;
  /** Deux ou trois mots, dans le vocabulaire de l'escrime historique. */
  nom: string;
  /**
   * Ce qu'il récompense, en une phrase courte et chaleureuse : ce qui le débloque et, quand c'est
   * utile, d'où vient son nom. C'est le texte de la bulle au survol, il doit donc se suffire à
   * lui-même — personne n'ira chercher ailleurs ce que « La quinte » veut dire.
   */
  quoi: string;
  /** Le groupe de la vitrine où il se range (voir {@link HorizonBlason}). */
  horizon: HorizonBlason;
  gagne: boolean;
  /** Où en est la personne : `fait` sur `but`. `fait` ne dépasse jamais `but`. */
  progres: { fait: number; but: number };
  /**
   * L'unité de la progression quand ce ne sont pas des cours : « 6 sur 12 mois », « 3 sur 4
   * mardis ». Absente, la vitrine écrit « 3 sur 5 » tout court — des cours, comme partout ailleurs
   * sur l'écran. Sans elle, « 6 sur 12 » d'un blason d'ancienneté se lirait comme six cours.
   */
  unite?: string;
};

/** Ce qu'il faut savoir d'une personne pour décerner ses blasons. */
export type SituationBlasons = {
  /** Ses présences aux cours déjà passés et non annulés du trimestre. */
  presences: number;
  /** Ces cours passés, tous statuts confondus (le dénominateur). */
  seancesPassees: number;
  /** Combien de fois elle s'est prononcée sur ces cours (Présent, Absent ou Peut-être). */
  reponses: number;
  /** Sa plus longue suite de présences consécutives sur ces cours. */
  serie: number;
  /** Ateliers qu'elle a proposés, toutes périodes confondues. */
  ateliersProposes: number;
  /**
   * Ses présences **depuis son arrivée**, tous trimestres confondus — la matière des blasons de
   * l'horizon « La saison », les seuls que le changement de trimestre ne remet pas à zéro.
   */
  presencesTotales: number;
  /** Son ancienneté au club en mois révolus, telle que la calcule {@link moisDepuis}. */
  ancienneteMois: number;
  /**
   * **Les jours de cours du club**, et pour chacun ses présences ce jour-là sur le mois civil qui en
   * compte le plus (voir {@link presencesDuMeilleurMois}).
   *
   * `jour` est un jour au sens de `getUTCDay` : 0 = dimanche, 2 = mardi. La liste est celle que rend
   * {@link joursDeCoursDuClub} — au plus {@link JOURS_DE_COURS_MAX} jours, dans l'ordre de la semaine
   * —, et c'est elle qui décide des blasons de créneau décernés : un club qui s'entraîne le lundi et
   * le jeudi en a deux, un club qui n'a qu'un seul soir de cours n'en a qu'un, un club dont aucun
   * créneau n'a jamais tenu quatre cours dans le même mois n'en a aucun.
   */
  joursDeCours: ReadonlyArray<{ jour: number; presences: number }>;
};

/**
 * Nombre de cours passés en dessous duquel un blason « sur tout le trimestre » n'a pas de sens.
 *
 * Répondre à un seul cours, ou être venu au seul cours qui a eu lieu, ne récompense rien : ça
 * décernerait une médaille à la première semaine de septembre, et surtout ça la décernerait à tout
 * le monde. « La garde de fer » demande une marche de plus que « Le héraut » ({@link COURS_SANS_FAUTE})
 * parce qu'il porte, lui, sur la présence : venir à quatre cours sur quatre est un fait rare, y
 * répondre quatre fois ne l'est pas.
 */
const COURS_MINIMUM = 3;

/** Cours passés exigés par « La garde de fer » (voir {@link COURS_MINIMUM}). */
const COURS_SANS_FAUTE = 4;

/**
 * Cours d'un même jour de la semaine, dans un même mois civil, exigés par « Le fer du mardi », « Le
 * fer du jeudi » — le nom suit le jour de cours du club, voir {@link joursDeCoursDuClub}.
 *
 * Quatre, parce qu'un club tient ses cours toutes les semaines : un mois en compte quatre, parfois
 * cinq. Le blason demande donc **un mois entier** de ce jour-là, et jamais davantage qu'un mois
 * court ne peut offrir.
 */
const COURS_DU_MOIS = 4;

/**
 * **Combien de créneaux hebdomadaires portent un blason : deux.**
 *
 * Deux parce que c'est le nombre de soirs qu'un club d'AMHE tient d'ordinaire, et surtout parce que
 * la vitrine doit garder une taille lisible : un club à cinq créneaux aurait cinq écus de créneau sur
 * douze, et l'horizon « L'assiduité » ne parlerait plus que de calendrier. Les deux retenus sont les
 * **plus fréquents** — ceux où le club s'entraîne vraiment.
 */
export const JOURS_DE_COURS_MAX = 2;

/**
 * Le nom de chaque jour de la semaine, au singulier et au pluriel, indexé comme `getUTCDay`
 * (0 = dimanche). Le pluriel sert à l'unité de la progression (« 3 sur 4 mardis ») : « dimanche »
 * prend un *s* sans rien perdre, « mardi » aussi, mais les écrire à la main évite d'inventer une
 * règle de pluriel française dans un module de récompenses.
 */
const JOURS: ReadonlyArray<{ nom: string; pluriel: string }> = [
  { nom: "dimanche", pluriel: "dimanches" },
  { nom: "lundi", pluriel: "lundis" },
  { nom: "mardi", pluriel: "mardis" },
  { nom: "mercredi", pluriel: "mercredis" },
  { nom: "jeudi", pluriel: "jeudis" },
  { nom: "vendredi", pluriel: "vendredis" },
  { nom: "samedi", pluriel: "samedis" },
];

/** Le rang d'un jour dans la semaine **française** : lundi d'abord, dimanche en dernier. */
function rangDansLaSemaine(jour: number): number {
  return (jour + 6) % 7;
}

/** Mois d'une saison du club, de rentrée à rentrée — le but de « La saison entière ». */
const MOIS_D_UNE_SAISON = 12;

/**
 * Ramène une entrée quelconque à un compte affichable : un entier positif, jamais `NaN`.
 *
 * Les compteurs arrivent d'agrégats SQL et de calculs faits ailleurs ; une seule valeur absente
 * suffirait à écrire « NaN sur 5 » dans la vitrine de quelqu'un. On préfère un zéro honnête.
 */
function compte(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

/**
 * Fabrique un blason en appliquant les garde-fous d'affichage communs à toute la collection :
 *
 * - **`but` ne vaut jamais 0** : sur un trimestre sans aucun cours passé, les blasons qui se
 *   mesurent au trimestre auraient un but nul, et toute division d'affichage (une jauge, un
 *   pourcentage) tomberait sur zéro. Un but de 1 non atteint se lit « 0 sur 1 », ce qui est juste ;
 * - **`fait` est plafonné à `but`** : quelqu'un qui totalise sept présences n'a pas « 7 sur 5 »
 *   d'un blason qui en demande cinq. Une barre pleine est pleine.
 *
 * `enJeu` dit si le trimestre met ce blason en jeu. Un blason hors jeu est rendu quand même, avec
 * une progression honnête, mais ne peut pas être gagné — sans quoi « La garde de fer » se décernerait
 * au premier cours du trimestre.
 */
type Recette = {
  cle: string;
  nom: string;
  quoi: string;
  horizon: HorizonBlason;
  fait: number;
  but: number;
  /** Le trimestre met-il ce blason en jeu ? Vrai par défaut. */
  enJeu?: boolean;
  /** L'unité de la progression quand ce ne sont pas des cours (« mois », « mardis »). */
  unite?: string;
};

function decerner({ cle, nom, quoi, horizon, fait, but, enJeu = true, unite }: Recette): Blason {
  const cible = Math.max(1, compte(but));
  const avance = compte(fait);
  return {
    cle,
    nom,
    quoi,
    horizon,
    unite,
    gagne: enJeu && avance >= cible,
    progres: { fait: Math.min(avance, cible), but: cible },
  };
}
/**
 * **Les blasons de créneau** : un par jour de cours du club, dans l'ordre où la liste arrive.
 *
 * Le nom, la phrase et l'unité suivent le jour — « Le fer du lundi », « 3 sur 4 lundis » —, et rien
 * n'est codé en dur : c'était le défaut de la version précédente, où « Le fer du mardi » et « Le fer
 * du vendredi » étaient les deux soirs du club pour lequel l'outil a été écrit, donc deux blasons
 * inatteignables chez un club qui s'entraîne le lundi et le jeudi.
 *
 * La clé porte le **numéro** du jour (`jour-2-du-mois`) et non son nom : elle voyage dans les tests et
 * dans le rendu, et un numéro ne dépend ni de l'orthographe ni de la langue. Une entrée dont le jour
 * n'est pas un jour de la semaine est ignorée, et la liste est tronquée à {@link JOURS_DE_COURS_MAX} :
 * ces deux garde-fous sont ici parce que la liste arrive de l'appelant, qui la déduit de la base.
 */
function blasonsDeCreneau(joursDeCours: ReadonlyArray<{ jour: number; presences: number }>): Blason[] {
  return joursDeCours
    .filter(({ jour }) => Number.isInteger(jour) && jour >= 0 && jour < JOURS.length)
    .slice(0, JOURS_DE_COURS_MAX)
    .map(({ jour, presences }) => {
      const { nom, pluriel } = JOURS[jour];
      return decerner({
        cle: `jour-${jour}-du-mois`,
        nom: `Le fer du ${nom}`,
        quoi: `${COURS_DU_MOIS} ${pluriel} dans le même mois : un mois entier au fer du ${nom}.`,
        horizon: "assiduite",
        fait: presences,
        but: COURS_DU_MOIS,
        unite: pluriel,
      });
    });
}

/**
 * **La collection complète**, rangée par **horizon** : ce qui se joue dans le trimestre, ce qui
 * récompense un rythme, et ce qui se construit sur la saison.
 *
 * ## Trois horizons, et pourquoi
 *
 * Delta, en regardant la vitrine : « ils sont trop faciles à atteindre, par exemple 1er, 2e, 3e
 * cours », puis « crées-en qui sont atteignables sur 1 an, d'autres sur un trimestre, d'autres sur
 * l'assiduité ». Les deux remarques n'en font qu'une : une collection dont tout se gagne en trois
 * semaines n'a plus rien à offrir au bout d'un mois, et une collection qui ne parle que du
 * trimestre en cours redevient vide tous les quatre mois — le même défaut qui avait fait passer les
 * **rangs** à l'ancienneté la veille.
 *
 * D'où trois groupes de quatre, affichés sous leur titre :
 *
 * - **Le trimestre** — ce qui se rejoue à chaque rentrée de trimestre : venir cinq fois, dix fois,
 *   répondre à chaque appel, être là à tous les cours passés. Ce sont les plus rapides, et ils
 *   redeviennent tous les quatre mois quelque chose à aller chercher ;
 * - **L'assiduité** — le **rythme**, pas le volume : des cours de suite, et un mois entier au fer
 *   de l'un des soirs de cours du club. Deux personnes venues huit fois n'ont pas la même vitrine
 *   selon qu'elles sont venues huit semaines de suite ou huit fois au hasard ;
 * - **La saison** — ce qui demande des mois : cinquante cours depuis l'arrivée, un an au club,
 *   trois ateliers proposés. Ceux-là ne retombent jamais à zéro, par construction, et ce sont eux
 *   qui donnent à la vitrine une profondeur que le trimestre seul ne peut pas avoir.
 *
 * **Trois blasons sont partis ce jour-là** : « Le premier fer » (une présence), « Le doublé » (deux
 * cours de suite) et « Les trois passes » (trois de suite). C'est la seule entorse jamais faite à
 * la règle « rien ne se reprend », et elle est assumée : ces trois-là se décernaient au bout de
 * trois semaines à peu près à tout le monde, et une récompense que tout le monde a ne récompense
 * plus personne. L'entrée de la collection est désormais « La quinte », cinq cours — deux semaines
 * et demie du rythme du club.
 *
 * ## Ce qui n'a pas changé, et ne changera pas
 *
 * `jamais-muet` (« Le héraut ») reste dans le premier groupe, là où le regard s'arrête, parce que
 * **c'est le blason le plus important de la collection** : il ne demande pas d'être libre le mardi,
 * il demande de dire si on vient. C'est le seul geste qui ne dépend que de soi, et le seul dont le
 * club a besoin pour décider s'il ouvre la salle.
 */
export function blasons(s: SituationBlasons): Blason[] {
  const presences = compte(s.presences);
  const seancesPassees = compte(s.seancesPassees);
  const reponses = compte(s.reponses);
  const serie = compte(s.serie);
  const ateliersProposes = compte(s.ateliersProposes);
  const presencesTotales = compte(s.presencesTotales);
  const ancienneteMois = compte(s.ancienneteMois);

  // Deux cours sur trois, arrondis au supérieur : le même rythme que le « noyau » du tableau de
  // bord (SEUIL_NOYAU), pour qu'un membre et un instructeur ne lisent pas deux définitions de
  // l'assiduité. Sur 5 cours passés, cela fait 4 — on arrondit vers l'exigeant, jamais vers le
  // cadeau, sinon le blason ne récompenserait plus rien.
  const deuxTiers = Math.ceil((seancesPassees * 2) / 3);

  // Un trimestre trop jeune ne met pas en jeu les blasons qui portent sur son ensemble.
  const trimestreCommence = seancesPassees >= COURS_MINIMUM;
  const trimestreEtabli = seancesPassees >= COURS_SANS_FAUTE;

  // **D'où viennent ces noms.** Le club fait de l'AMHE : on y lit des traités, on y nomme les gardes,
  // et la salle d'armes a son vocabulaire à elle. Les blasons l'empruntent plutôt que de décrire leur
  // compteur — « La quinte » est la cinquième garde (et cinq cours), « Le héraut » est celui qui
  // annonce (et qui a répondu à chaque appel), « Le porteur de traité » renvoie aux sources que le
  // club étudie, « La garde de fer » est une garde de Fiore. Qu'un nom demande à être expliqué n'est
  // pas un défaut : la bulle au survol porte le `quoi`, et c'est justement ce qui donne envie d'aller
  // le lire. D'où la règle d'écriture de ces phrases — dire ce qui débloque le blason, en tournure
  // qui ne genre personne, et glisser l'origine du nom quand elle éclaire.
  return [
    // ── Le trimestre ────────────────────────────────────────────────────────────────────────────
    decerner({
      cle: "cinq-cours",
      nom: "La quinte",
      quoi: "Cinq cours dans le trimestre — la quinte, c'est la cinquième garde.",
      horizon: "trimestre",
      fait: presences,
      but: 5,
    }),
    decerner({
      cle: "dix-cours",
      nom: "Le tapis usé",
      quoi: "Dix cours dans le trimestre : le plancher de la salle se marque sous tes pas.",
      horizon: "trimestre",
      fait: presences,
      but: 10,
    }),
    decerner({
      cle: "jamais-muet",
      nom: "Le héraut",
      quoi: "Tu as répondu à chaque appel du trimestre, quelle que soit la réponse — le héraut, c'est celui qui annonce.",
      horizon: "trimestre",
      fait: reponses,
      but: seancesPassees,
      enJeu: trimestreCommence,
    }),
    decerner({
      cle: "sans-faute",
      nom: "La garde de fer",
      quoi: "Tous les cours passés du trimestre, tu y étais — la garde de fer est l'une des gardes de Fiore.",
      horizon: "trimestre",
      fait: presences,
      but: seancesPassees,
      enJeu: trimestreEtabli,
    }),

    // ── L'assiduité ─────────────────────────────────────────────────────────────────────────────
    decerner({
      cle: "fidele",
      nom: "Le pilier de salle",
      quoi: "Deux cours sur trois du trimestre, tu y étais.",
      horizon: "assiduite",
      fait: presences,
      but: deuxTiers,
      enJeu: trimestreCommence,
    }),
    decerner({
      cle: "cinq-daffilee",
      nom: "L'enchaînement",
      quoi: "Cinq cours de suite, sans rompre la mesure.",
      horizon: "assiduite",
      fait: serie,
      but: 5,
    }),
    // `?? []` comme les `compte()` du dessus : la liste arrive d'une déduction faite en base, et une
    // colonne absente doit vider la rangée des créneaux, pas faire tomber la vitrine entière.
    ...blasonsDeCreneau(s.joursDeCours ?? []),

    // ── La saison ───────────────────────────────────────────────────────────────────────────────
    decerner({
      cle: "cinquante-cours",
      nom: "Le plancher poli",
      quoi: "Cinquante cours depuis ton arrivée, toutes saisons confondues.",
      horizon: "saison",
      fait: presencesTotales,
      but: 50,
    }),
    decerner({
      cle: "une-saison",
      nom: "La saison entière",
      quoi: "Un an au club, d'une rentrée à la suivante.",
      horizon: "saison",
      fait: ancienneteMois,
      but: MOIS_D_UNE_SAISON,
      unite: "mois",
    }),
    decerner({
      cle: "force-de-proposition",
      nom: "Le porteur de traité",
      quoi: "Tu as proposé un atelier au club — le porteur de traité apporte les sources qu'on étudie.",
      horizon: "saison",
      fait: ateliersProposes,
      but: 1,
    }),
    decerner({
      cle: "maitre-de-traite",
      nom: "Le maître d'armes de papier",
      quoi: "Trois ateliers proposés : tu nourris le programme du club autant que tu le suis.",
      horizon: "saison",
      fait: ateliersProposes,
      but: 3,
    }),
  ];
}

/**
 * **Le meilleur mois d'un jour de la semaine** — la matière des blasons de créneau (« Le fer du
 * mardi », « Le fer du jeudi » : le nom suit les vrais jours de cours du club).
 *
 * Rend, parmi tous les mois civils traversés, le plus grand nombre de présences tombées ce jour-là.
 * Quatre mardis dans le même mois, c'est un mois entier de mardis : un club en compte quatre ou
 * cinq par mois, et le blason ne demande donc jamais l'impossible d'un mois court.
 *
 * **Pourquoi le mois civil et non quatre semaines glissantes.** Un mois est une unité que tout le
 * monde lit sur son calendrier — « j'ai fait tous les mardis de septembre » se vérifie d'un coup
 * d'œil, là où une fenêtre glissante demanderait de croire l'application sur parole. Et une
 * fenêtre glissante se recalcule chaque jour : le blason gagné lundi pourrait sembler perdu mardi,
 * ce que la vitrine s'interdit.
 *
 * Tout est lu en **UTC**, comme partout où ce module manipule des dates : les séances sont rangées
 * à minuit UTC, et lire leur jour en heure locale ferait basculer un mardi sur un lundi selon le
 * fuseau de qui regarde. Les dates illisibles sont ignorées plutôt que de propager un `NaN`.
 *
 * @param dates Les dates des cours où la personne était présente (l'ordre n'a aucune importance).
 * @param jour Le jour de la semaine au sens de `getUTCDay` : 2 = mardi, 5 = vendredi.
 */
export function presencesDuMeilleurMois(dates: readonly Date[], jour: number): number {
  const parMois = new Map<string, number>();
  for (const date of dates) {
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) continue;
    if (date.getUTCDay() !== jour) continue;
    const mois = `${date.getUTCFullYear()}-${date.getUTCMonth()}`;
    parMois.set(mois, (parMois.get(mois) ?? 0) + 1);
  }
  let meilleur = 0;
  for (const n of parMois.values()) if (n > meilleur) meilleur = n;
  return meilleur;
}

/**
 * **Les jours de cours du club**, déduits de ses séances : les {@link JOURS_DE_COURS_MAX} jours de la
 * semaine les plus fréquents, rendus dans l'ordre de la semaine (lundi d'abord).
 *
 * **Pourquoi les déduire au lieu de les régler.** Le club a déjà dit quand il s'entraîne — il l'a dit
 * en créant ses séances, et la récurrence du trimestre les engendre toutes d'un coup. Un réglage de
 * plus dans l'espace admin serait une seconde vérité à tenir à jour, et la première divergence
 * donnerait un blason inatteignable : exactement le défaut qu'on répare ici.
 *
 * **Un jour n'est retenu que si le blason y est atteignable** : il faut que le club ait réellement
 * tenu {@link COURS_DU_MOIS} cours ce jour-là **dans un même mois civil**, ce qu'on lit avec la même
 * fonction que les présences d'une personne ({@link presencesDuMeilleurMois}) — le blason demande un
 * mois plein, le créneau doit pouvoir en offrir un. C'est ce garde-fou qui fait qu'un club aux
 * séances trop rares, ou dont le trimestre vient d'ouvrir, n'a **aucun** blason de créneau plutôt
 * qu'un blason impossible.
 *
 * Le classement se fait sur le **nombre total** de séances du jour, et les ex æquo se départagent par
 * l'ordre de la semaine : deux soirs aussi fréquents l'un que l'autre doivent donner la même paire
 * d'une visite à l'autre, sans dépendre de l'ordre dans lequel la base a rendu ses lignes.
 *
 * Tout est lu en **UTC**, comme partout dans ce module : les séances sont rangées à minuit UTC, et
 * lire leur jour en heure locale ferait basculer un mardi sur un lundi selon le fuseau du serveur.
 *
 * @param datesDesSeances Les dates des cours qui ont été programmés (annulés retirés par l'appelant :
 *   un cours annulé n'a pas eu lieu, mais il dit quand le club s'entraîne — c'est à l'appelant de
 *   trancher, et il tranche comme partout ailleurs, en les écartant).
 */
export function joursDeCoursDuClub(datesDesSeances: readonly Date[]): number[] {
  const valides = datesDesSeances.filter((d) => d instanceof Date && Number.isFinite(d.getTime()));
  const total = new Map<number, number>();
  for (const date of valides) {
    const jour = date.getUTCDay();
    total.set(jour, (total.get(jour) ?? 0) + 1);
  }
  return [...total.entries()]
    .filter(([jour]) => presencesDuMeilleurMois(valides, jour) >= COURS_DU_MOIS)
    .sort(([jourA, nA], [jourB, nB]) => nB - nA || rangDansLaSemaine(jourA) - rangDansLaSemaine(jourB))
    .slice(0, JOURS_DE_COURS_MAX)
    .map(([jour]) => jour)
    .sort((a, b) => rangDansLaSemaine(a) - rangDansLaSemaine(b));
}
/** Mois de la rentrée, en index JavaScript : 8 = septembre. */
const MOIS_RENTREE = 8;

/**
 * **Le 1er septembre qui ouvre la saison d'une date** — le pas de toute l'ancienneté du club.
 *
 * La saison du club court du **1er septembre** : une date appartient à la saison ouverte, une date
 * à celle
 * 2025. Une date déjà posée sur un 1er septembre ne bouge pas (la fonction est idempotente), et
 * rien n'est jamais renvoyé dans le futur : on ne fait que reculer jusqu'à la rentrée précédente ou
 * égale.
 *
 * **Pourquoi compter en saisons** : ainsi **tout le club prend une année d'ancienneté le même jour,
 * à la rentrée**. Personne ne change de rang un mardi de février sans que rien ne se soit passé, et
 * « depuis 2 ans » veut dire « depuis deux rentrées » — c'est exactement la façon dont un club se
 * compte, par promotions plutôt que par dates anniversaires.
 *
 * **Conséquence assumée** : quelqu'un arrivé en janvier est réputé arrivé au 1er septembre
 * précédent, donc un peu plus ancien que la stricte vérité. C'est le bon arrondi — il a bien fait
 * cette saison-là, et l'arrondi inverse la lui retirerait.
 *
 * Tout se lit et s'écrit en **UTC**, comme {@link moisDepuis} : une bascule de rang ne doit pas
 * dépendre du fuseau de la machine qui regarde.
 */
export function debutDeSaison(date: Date): Date {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return date;
  const annee = date.getUTCFullYear() - (date.getUTCMonth() >= MOIS_RENTREE ? 0 : 1);
  return new Date(Date.UTC(annee, MOIS_RENTREE, 1));
}

/**
 * Ce qu'il faut d'un compte pour savoir depuis quand la personne est du club.
 *
 * Volontairement réduit à deux dates : cette règle se rejoue partout (accueil, fiche du membre,
 * tests), et un type qui exigerait la ligne entière de `User` la rendrait impossible à appeler
 * ailleurs qu'en base.
 */
export type CompteDate = {
  /** Date d'adhésion saisie par le bureau (« Au club depuis »), `null` si personne ne la connaît. */
  auClubDepuis?: Date | null;
  /** Création du **compte** dans l'application : le repli, jamais la vérité sur l'adhésion. */
  createdAt: Date;
};

/**
 * **Depuis quand cette personne est du club** — la règle de repli, écrite ici et nulle part ailleurs.
 *
 * `auClubDepuis` **quand elle est renseignée**, `createdAt` sinon. Le club existait bien avant
 * l'application : adosser l'ancienneté à la date de création du compte faisait de tout le monde une
 * « Recrue », y compris de gens qui tirent depuis huit ans. Le bureau saisit donc une vraie date
 * d'adhésion dans la fiche du membre.
 *
 * **Pourquoi un repli, et non une date obligatoire.** Les comptes existants — ceux de l'import, ceux
 * créés avant ce champ — n'ont aucune date d'adhésion connue, et personne ne va inventer douze dates
 * pour que l'écran fonctionne. Une ancienneté prudente (celle du compte, toujours plus courte que la
 * vraie) vaut mieux qu'un champ vide qui casserait le rang : elle ne donne jamais un titre que la
 * personne n'aurait pas mérité, et elle se corrige d'une saisie.
 *
 * Une date illisible (colonne abîmée, valeur hors norme) compte comme absente : on retombe sur
 * `createdAt` plutôt que de propager un `NaN` jusque dans la vitrine de quelqu'un.
 */
export function dateDAdhesion(compte: CompteDate): Date {
  const adhesion = compte.auClubDepuis;
  const depart = adhesion instanceof Date && Number.isFinite(adhesion.getTime()) ? adhesion : compte.createdAt;
  // Les deux chemins passent par la **même** rentrée : une date d'adhésion saisie est déjà posée sur
  // un 1er septembre (voir `dateDepuisDuree`), mais la création du compte, elle, tombe n'importe
  // quand. Sans ce ramenage, deux personnes arrivées la même saison n'auraient pas la même
  // ancienneté selon que le bureau a saisi sa durée ou non — et le repli serait un rang de moins.
  return debutDeSaison(depart);
}

/**
 * **L'ancienneté au club, en mois révolus** — l'unique entrée de l'échelle des rangs.
 *
 * « Révolus » au sens courant : un compte créé le 31 janvier a **six mois** le 31 juillet, et cinq
 * la veille. Les mois n'ayant pas tous la même longueur, la date anniversaire est **bornée au
 * dernier jour du mois d'arrivée** — l'anniversaire mensuel du 31 janvier tombe le 28 (ou le 29)
 * février, comme dans `moisAvant` (src/lib/dates.ts). Sans ce garde-fou, un compte créé un 31
 * attendrait le 1er mars pour gagner son premier mois.
 *
 * Tout se lit en **UTC**, et volontairement : cette fonction doit rendre la même chose sur le
 * serveur de production (Europe/Paris) et sur la machine qui joue les tests. Le décalage d'une ou
 * deux heures ne peut déplacer une bascule de rang que d'un soir — et un rang qui se gagne le
 * 31 juillet à 22 h plutôt qu'à minuit n'est visible de personne.
 *
 * Jamais négatif : une date de création dans le futur (horloge décalée, jeu de démonstration) rend
 * **0**, c'est-à-dire « Recrue », plutôt qu'un rang impossible ou un `NaN` dans la vitrine de
 * quelqu'un. Une date invalide fait de même.
 */
export function moisDepuis(date: Date, maintenant: Date = new Date()): number {
  const depart = date instanceof Date ? date.getTime() : Number.NaN;
  const arrivee = maintenant instanceof Date ? maintenant.getTime() : Number.NaN;
  if (!Number.isFinite(depart) || !Number.isFinite(arrivee)) return 0;

  const mois =
    (maintenant.getUTCFullYear() - date.getUTCFullYear()) * 12 + (maintenant.getUTCMonth() - date.getUTCMonth());
  // Le jour anniversaire, ramené dans le mois d'arrivée : le 31 d'un mois de 30 jours, c'est le 30.
  const dernierJour = new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth() + 1, 0)).getUTCDate();
  const jourCible = Math.min(date.getUTCDate(), dernierJour);
  const jour = maintenant.getUTCDate();
  const atteint = jour > jourCible || (jour === jourCible && heureDuJour(maintenant) >= heureDuJour(date));
  return Math.max(0, atteint ? mois : mois - 1);
}

/** Millisecondes écoulées depuis minuit (UTC) : ce qui départage deux dates tombées le même jour. */
function heureDuJour(d: Date): number {
  return d.getTime() - Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * **Les saisons sportives, telles que le bureau les nomme** : « 2025-2026 », année de la rentrée en
 * premier. Une saison se désigne par l'année de sa rentrée (2025 pour 2025-2026).
 *
 * Le bureau saisissait une **durée** (années + mois), que le serveur reculait depuis le jour de la
 * saisie puis ramenait à la rentrée : « 1 an et 2 mois » tapé en octobre se relisait « 2 ans et
 * 1 mois », parce que quatorze mois en arrière tombaient en août, donc dans la saison d'avant.
 * Le club se compte en saisons : on choisit donc directement **la saison d'arrivée**, et ce qu'on
 * relit est exactement ce qu'on a choisi.
 */
export function anneeDeSaison(date: Date): number {
  return debutDeSaison(date).getUTCFullYear();
}

/** « 1re saison », « 2e saison »… : le rang de la saison en cours depuis la saison d'arrivée (incluse). */
export function libelleNumeroSaison(n: number): string {
  const k = Math.max(1, Math.floor(n));
  return `${k}${k === 1 ? "re" : "e"} saison`;
}

/** La saison en cours est la combientième depuis l'arrivée : 1 la première saison, 2 à la rentrée suivante… */
export function numeroDeSaison(adhesion: Date, maintenant: Date = new Date()): number {
  return Math.max(1, anneeDeSaison(maintenant) - anneeDeSaison(adhesion) + 1);
}

/** **La saison choisie → la date à ranger en base** : son 1er septembre ; `null` pour « je ne sais pas ». */
export function dateDepuisSaison(annee: number | null): Date | null {
  return annee === null ? null : new Date(Date.UTC(annee, MOIS_RENTREE, 1));
}

/** La saison d'arrivée enregistrée, ou `null` si personne ne l'a renseignée (le compte fait foi). */
export function saisonEnregistree(date: Date | null | undefined): number | null {
  return date instanceof Date && Number.isFinite(date.getTime()) ? anneeDeSaison(date) : null;
}

/** Les saisons qu'on peut choisir, de la plus récente à la plus ancienne. */
export const SAISONS_PROPOSEES = 40;
export function saisonsProposees(maintenant: Date = new Date()): number[] {
  const courante = anneeDeSaison(maintenant);
  return Array.from({ length: SAISONS_PROPOSEES }, (_, i) => courante - i);
}

/** Un rang de la salle d'armes : on y monte, on n'en redescend jamais. */
export type Rang = {
  nom: string;
  /** L'ancienneté qu'il demande, **en mois** (voir {@link ECHELLE}). */
  seuil: number;
  atteint: boolean;
  actuel: boolean;
};

/**
 * **L'échelle des rangs, sur l'ancienneté au club** — et non plus sur les présences du trimestre.
 *
 * Les blasons récompensent des gestes ; le rang donne une **place** — un mot à se dire quand on
 * ouvre l'application, dans le vocabulaire de la salle d'armes plutôt que dans celui des
 * statistiques.
 *
 * ## Pourquoi l'ancienneté, et non les présences
 *
 * Adossé aux présences du trimestre, le rang **retombait à « Recrue » au premier jour de chaque
 * trimestre** : quelqu'un qui pratiquait depuis trois ans redevenait une recrue tous les quatre
 * mois, et le titre finissait par ne plus rien vouloir dire. Or un rang n'est pas un compteur,
 * c'est un **titre acquis** : la place qu'on occupe dans la salle, pas la fréquence à laquelle on
 * y passe. Un titre qui se reprend n'est plus un titre.
 *
 * L'ancienneté a exactement cette forme : **elle ne redescend jamais, par construction**, parce
 * qu'elle ne mesure pas un effort mais un temps écoulé. C'est aussi ce qui la met à l'abri de la
 * règle de fond de ce module : elle ne peut pas reculer sur un travail du mardi soir, un enfant
 * malade ou un déménagement, donc elle ne peut pas se lire comme un reproche. Ce qui relève de
 * l'assiduité continue de vivre dans les blasons, où rien ne se reprend non plus.
 *
 * ## Pourquoi ces paliers-là
 *
 * **Six mois** pour cesser d'être une recrue : c'est le temps d'avoir traversé une rentrée, un
 * hiver et ses premiers assauts, et cela ne se franchit pas en s'inscrivant. Puis **un an, deux
 * ans, quatre ans** — le rythme d'un club, pas celui d'une saison. Les marches s'écartent à mesure
 * qu'on monte : les premières se franchissent en restant, la dernière demande d'avoir vu passer
 * quatre rentrées, ce qui est précisément ce que « Maître d'armes » raconte.
 *
 * **Compagnon passe avant Bretteur** : c'est l'ordre donné par Delta, et il se tient — le
 * compagnon est celui qui a fait son temps auprès des autres, le bretteur celui qui sait tenir la
 * lame.
 *
 * `Recrue` est à **zéro mois**, et c'est le point important de toute l'échelle : **personne n'est
 * jamais hors du classement.** Quelqu'un qui vient de s'inscrire est une recrue du club, pas un
 * membre sans rang — l'échelle commence là où commence l'adhésion.
 */
const ECHELLE: ReadonlyArray<{ nom: string; seuil: number }> = [
  { nom: "Recrue", seuil: 0 },
  { nom: "Élève", seuil: 6 },
  { nom: "Compagnon", seuil: 12 },
  { nom: "Bretteur", seuil: 24 },
  { nom: "Maître d'armes", seuil: 48 },
];

/**
 * L'échelle entière, avec le rang atteint et le rang courant, pour une **ancienneté en mois**.
 *
 * Toute l'échelle est rendue, y compris les rangs à venir : on voit où l'on est **et** ce vers quoi
 * on monte. Il y a toujours exactement un `actuel` — le plus haut rang atteint —, `Recrue` compris
 * à zéro mois d'ancienneté.
 */
export function rangs(ancienneteMois: number): Rang[] {
  const mois = compte(ancienneteMois);
  const atteints = ECHELLE.map((rang) => mois >= rang.seuil);
  const dernierAtteint = atteints.lastIndexOf(true);
  return ECHELLE.map((rang, i) => ({
    nom: rang.nom,
    seuil: rang.seuil,
    atteint: atteints[i],
    actuel: i === dernierAtteint,
  }));
}

/**
 * Le prochain rang et ce qu'il reste à **attendre**, en mois ; `null` quand le dernier est atteint.
 *
 * `reste` est une durée, pas un nombre de cours : il n'y a rien à faire pour le franchir, qu'à
 * rester du club. C'est ce qui rend la phrase de la tuile inoffensive — « encore 4 mois pour
 * devenir Élève » n'attend aucun geste de personne.
 */
export function prochainRang(ancienneteMois: number): { nom: string; reste: number } | null {
  const mois = compte(ancienneteMois);
  const suivant = ECHELLE.find((rang) => mois < rang.seuil);
  return suivant ? { nom: suivant.nom, reste: suivant.seuil - mois } : null;
}

/**
 * **Quand un seuil se dit en saisons** : 12, 24, 48 mois tombent pile sur une rentrée (l'ancienneté
 * part d'un 1er septembre) — « dès sa 3e saison » se lit mieux que « à partir de 2 ans ». Le seuil
 * de six mois, lui, tombe en cours de saison et reste une durée.
 */
export function seuilEnSaisons(seuilMois: number): string {
  return seuilMois % 12 === 0 ? `dès sa ${libelleNumeroSaison(seuilMois / 12 + 1)}` : `à partir de ${formatDuree(seuilMois)}`;
}

/**
 * **Une durée en toutes lettres**, à partir d'un nombre de mois : « 4 mois », « 1 an »,
 * « 1 an et 2 mois », « 4 ans ».
 *
 * En dessous d'un an, les mois seuls : « 18 mois » se compte, « 1 an et 6 mois » se voit. Au-delà,
 * l'année devient l'unité qu'on retient — personne ne dit qu'il pratique depuis trente mois.
 * Le pluriel est accordé sur « an » (« 1 an », « 2 ans ») ; « mois » est invariable, et le zéro
 * mois n'est jamais écrit (« 2 ans », pas « 2 ans et 0 mois »).
 *
 * Elle vivait dans `src/components/accueil/Blasons.tsx` et a migré ici, quand la fiche du membre a
 * eu besoin d'écrire la même phrase sous le champ « Au club depuis ». **Un seul formateur de
 * durée** : deux copies finiraient par ne plus dire la même chose du même nombre de mois, et c'est
 * le genre d'écart qu'on ne voit jamais venir.
 */
export function formatDuree(mois: number): string {
  const total = Math.max(0, Math.round(Number.isFinite(mois) ? mois : 0));
  if (total < 12) return `${total} mois`;
  const ans = Math.floor(total / 12);
  const reste = total % 12;
  const enAns = `${ans} an${ans > 1 ? "s" : ""}`;
  return reste === 0 ? enAns : `${enAns} et ${reste} mois`;
}
