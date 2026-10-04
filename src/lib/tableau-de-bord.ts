import { db } from "./db";
import { seanceCommencee, toIsoDate, todayIso } from "./dates";
import { filtrerHorizonPasse, type Horizon } from "./horizon";
import { calculerTaux, compteursDepuisTotaux, cumulerTotaux, type Compteurs, type TotauxStatuts } from "./presences";

/**
 * Données du tableau de bord d'une période : taux par séance et par membre.
 *
 * Dans `membres`, `seances` est le nombre de cours **de cette personne** : les séances passées non
 * annulées depuis son arrivée dans la période, jamais celles d'avant. `seances === 0` se lit
 * « pas encore eu de cours », et non « 0 % ».
 */
export type StatsPeriode = {
  period: { id: string; nom: string; statut: string };
  seances: Array<{ id: string; date: string; heureDebut: string; theme: string; annulee: boolean; passee: boolean; compteurs: Compteurs }>;
  membres: Array<{
    id: string;
    prenom: string;
    nom: string;
    presents: number;
    absents: number;
    peutEtre: number;
    sansReponse: number;
    seances: number;
    pourcentage: number;
    /**
     * **Son jour d'entrée dans la période**, au format des dates de séance (`""` = inconnu, donc
     * aucune borne : voir {@link jourDArrivee}). Il voyage sur la ligne parce que les colonnes
     * `presents` / `seances` / `pourcentage` sont bornées par lui : c'est la seule chose qui explique
     * qu'une ligne détaillée séance par séance — l'export CSV — puisse porter plus de réponses que de
     * présences comptées. L'export l'écrit donc dans une colonne plutôt que d'effacer des cellules
     * pour faire coïncider les deux (voir {@link csvPresences}, « la règle »).
     */
    arrivee: string;
  }>;
  moyenne: number;
};

/**
 * **Le jour d'entrée de quelqu'un dans une période**, au format des dates de séance
 * (« AAAA-MM-JJ », heure de Paris) — `""` quand la donnée est absente.
 *
 * `""` veut dire « aucune borne » : la chaîne vide est plus petite que toute date, donc
 * `s.date >= ""` est toujours vrai. C'est le repli le plus prudent pour les données d'avant
 * `PeriodMember.addedAt` — présent depuis le début, l'ancien comportement.
 *
 * **Une seule définition**, exportée : le taux personnel s'affiche sur trois écrans, calculé par
 * deux modules (`statsPeriode` ici pour le tableau de bord, l'export et l'accueil ;
 * `historiquePresences` dans `seances.ts` pour « Mes présences »). Deux versions de cette règle,
 * c'était deux chiffres pour la même personne à un onglet d'écart.
 */
export function jourDArrivee(addedAt: Date | null | undefined): string {
  return addedAt instanceof Date ? toIsoDate(addedAt) : "";
}

/**
 * **L'ordre alphabétique français de la liste des membres, sur ce que la ligne affiche : « Prénom Nom ».**
 *
 * SQLite classe avec une collation binaire, où « Éric » (le « É » est U+00C9) passe **après**
 * « Zoé ». L'écran, lui, affiche la liste triée en JavaScript avec `localeCompare` français, où
 * « Éric » tombe entre « Emma » et « Fabien ». Tant que le classement venait de la requête, les deux
 * ordres coexistaient : on cliquait sur « Exporter », on ouvrait le fichier, on descendait jusqu'au
 * E pour retrouver Éric — et il était tout en bas, derrière Zoé. Un export dans lequel on ne sait
 * plus chercher, et quelqu'un finit par conclure qu'il y « manque » du monde.
 *
 * D'où un tri posé **au même endroit et avec la même règle que l'écran** : ici, en JavaScript, sur
 * la liste construite. `stats.membres` sort donc déjà dans l'ordre affiché, et `csvPresences`, qui
 * la consomme telle quelle, en hérite sans rien retrier.
 *
 * `sensitivity: "base"` ignore accents et casse pour le classement ; le nom de famille départage
 * les homonymes de prénom (le club compte deux Foxtrot).
 *
 * Exporté pour devenir **la seule définition de la règle** : `comparerAlphabetique` de
 * `src/app/(app)/gestion/tableau-de-bord/tri.ts` fait aujourd'hui exactement la même comparaison de
 * son côté — duplication à résorber en faisant lire celle-ci au tableau.
 */
export function comparerAlphabetique(a: { prenom: string; nom: string }, b: { prenom: string; nom: string }): number {
  return `${a.prenom} ${a.nom}`.localeCompare(`${b.prenom} ${b.nom}`, "fr", { sensitivity: "base" });
}

/** `horizon` resserre la fenêtre observée (mois, 2 semaines, semaine, dernier cours) ; « periode » = tout. */
export async function statsPeriode(periodId: string, now = new Date(), horizon: Horizon = "periode"): Promise<StatsPeriode | null> {
  const p = await db.period.findUnique({
    where: { id: periodId },
    select: {
      id: true,
      nom: true,
      statut: true,
      // Le compte de connexion du portail n'est pas un membre du club : ni dans le tableau, ni dans
      // le total des invités. `addedAt` est la date d'entrée dans la période : on ne compte à
      // personne les cours d'avant son arrivée (voir le taux personnel plus bas) — colonne lue au
      // passage, aucune requête de plus.
      membres: {
        where: { user: { service: false } },
        select: { addedAt: true, user: { select: { id: true, prenom: true, nom: true } } },
        // Prénom d'abord : c'est ainsi que les lignes s'écrivent partout dans l'application. Mais
        // cet `orderBy` ne donne qu'une **base stable** : la collation de SQLite étant binaire, il
        // laisse « Éric » après « Zoé ». Le dernier mot revient à `comparerAlphabetique`, appliqué
        // plus bas sur la liste construite — sans quoi on cherche quelqu'un au mauvais endroit dans
        // le fichier qu'on vient de télécharger.
        orderBy: [{ user: { prenom: "asc" } }, { user: { nom: "asc" } }],
      },
      // Uniquement les colonnes affichées : après plusieurs saisons, une période compte des centaines de séances
      sessions: { orderBy: [{ date: "asc" }, { heureDebut: "asc" }], select: { id: true, date: true, heureDebut: true, theme: true, annulee: true } },
    },
  });
  if (!p) return null;
  const invites = p.membres.length;
  // La fenêtre se referme au **début du cours**, pas à minuit : `now` part avec le jour de référence,
  // sans quoi l'horizon « Dernier cours » retenait, un mardi à 18 h, le cours de 20 h qui n'a pas
  // encore eu lieu — une ligne unique à « 0 % » et tout le club à zéro (voir `filtrerHorizonPasse`).
  const sessions = filtrerHorizonPasse(p.sessions, horizon, todayIso(now), now);
  // Taux par membre sur les séances passées non annulées
  const passees = sessions.filter((s) => !s.annulee && seanceCommencee(s.date, s.heureDebut, now));
  // Les présences sont comptées en base (deux agrégats) au lieu d'être chargées ligne à ligne :
  // une période de cinq saisons, c'est des milliers de lignes dont on ne veut que des totaux.
  // Quand la fenêtre retient toutes les séances, on filtre par période (pas de liste d'identifiants).
  const toutes = { session: { periodId } };
  /**
   * **Le numérateur se compte sur les mêmes personnes que le dénominateur.** `invites` est le
   * nombre de membres de la période, compte de service exclu ; sans ce filtre, l'agrégat ramassait
   * *toutes* les lignes de présence de la séance — y compris celles laissées derrière par quelqu'un
   * retiré de la période depuis, et celles du compte de service. D'où des « 19/18 » et des taux
   * au-dessus de 100 %. Filtre de relation plutôt que liste d'identifiants : la requête ne grossit
   * pas avec l'effectif du club, et le compte des requêtes ne bouge pas.
   */
  const membreDeLaPeriode = { service: false, periodes: { some: { periodId } } };
  /**
   * **Le numérateur porte sur les mêmes séances que le dénominateur.**
   *
   * Le dénominateur personnel, ce sont *ses* cours (voir plus bas) ; l'agrégat, lui, comptait ses
   * réponses sur **toutes** les séances passées du trimestre. Les deux ne parlaient donc plus du
   * même ensemble, et l'écart n'est pas théorique : `/admin/presences` sert précisément à corriger
   * la réponse de n'importe qui après le cours, sans garde de date. On inscrit quelqu'un à la
   * Toussaint, on coche les cours d'octobre où il était venu avant d'être enregistré, et le tableau
   * de bord lit « 3 présences sur 1 séance » — 300 %, que la borne de `calculerTaux` ramenait
   * silencieusement à 100 %, avec « sans réponse » à zéro. La borne reste une ceinture de sécurité
   * pour les données d'avant ; elle ne doit plus masquer quoi que ce soit d'actuel.
   *
   * **Regroupé par jour d'arrivée, pas par personne** : au club, tout le monde est inscrit en
   * quelques fournées (l'ouverture du trimestre, la rentrée de la Toussaint), donc la clause tient
   * en deux ou trois branches quel que soit l'effectif — et surtout **aucune requête de plus** :
   * la borne part avec l'agrégat qui existait déjà.
   */
  const cohortes = new Map<string, string[]>();
  for (const m of p.membres) {
    const cle = jourDArrivee(m.addedAt);
    const liste = cohortes.get(cle);
    if (liste) liste.push(m.user.id);
    else cohortes.set(cle, [m.user.id]);
  }
  const depuisLeurArrivee = [...cohortes].map(([arrivee, userIds]) => ({
    userId: { in: userIds },
    // Arrivée inconnue : aucune borne, le trimestre entier — exactement ce que compte `siennes`.
    ...(arrivee ? { session: { date: { gte: arrivee } } } : {}),
  }));
  const [parSeance, parMembre] = await Promise.all([
    sessions.length === 0
      ? []
      : /*
         * **Le remplissage d'une séance n'a aucune borne d'arrivée, et c'est la règle.** Ce compteur
         * répond à « combien de monde y avait-il dans la salle ce soir-là ? » : quelqu'un venu en
         * essai avant son inscription y était, la fiche de la séance et `/admin/presences` le disent,
         * ce total doit le dire aussi. La borne d'arrivée est une règle de **personne** (le taux
         * personnel, plus bas) — la poser ici ferait dire à cet écran « 7 présents » là où la fiche
         * du même cours en montre 8. Voir `csvPresences` pour la règle écrite en entier.
         */
        db.attendance.groupBy({
          by: ["sessionId", "statut"],
          where: {
            ...(sessions.length === p.sessions.length ? toutes : { sessionId: { in: sessions.map((s) => s.id) } }),
            user: membreDeLaPeriode,
          },
          _count: { _all: true },
        }),
    passees.length === 0
      ? []
      : db.attendance.groupBy({
          by: ["userId", "statut"],
          where: {
            ...(passees.length === p.sessions.length ? toutes : { sessionId: { in: passees.map((s) => s.id) } }),
            user: membreDeLaPeriode,
            // Chacun sur ses propres cours : la moitié haute de la fraction, posée en base. Aucune
            // cohorte = période sans invité : `user` ne laisse déjà rien passer, on n'émet pas un
            // `OR` vide dont le sens dépendrait du connecteur.
            ...(depuisLeurArrivee.length === 0 ? {} : { OR: depuisLeurArrivee }),
          },
          _count: { _all: true },
        }),
  ]);
  const totauxSeance = new Map<string, TotauxStatuts>();
  for (const g of parSeance) cumulerTotaux(totauxSeance, g.sessionId, g.statut, g._count._all);
  const totauxMembre = new Map<string, TotauxStatuts>();
  for (const g of parMembre) cumulerTotaux(totauxMembre, g.userId, g.statut, g._count._all);

  const seances = sessions.map((s) => ({
    id: s.id,
    date: s.date,
    heureDebut: s.heureDebut,
    theme: s.theme,
    annulee: s.annulee,
    passee: seanceCommencee(s.date, s.heureDebut, now),
    compteurs: compteursDepuisTotaux(totauxSeance.get(s.id) ?? {}, invites),
  }));
  const membres = p.membres.map(({ addedAt, user }) => {
    const t = totauxMembre.get(user.id) ?? {};
    const presents = t.PRESENT ?? 0;
    const absents = t.ABSENT ?? 0;
    const peutEtre = t.PEUT_ETRE ?? 0;
    /*
     * **Le dénominateur personnel, ce sont SES cours** — ceux qui ont eu lieu depuis son arrivée
     * dans la période, pas tous ceux du trimestre.
     *
     * Quelqu'un inscrit à la Toussaint n'a pas « manqué » les six cours de septembre : il n'y était
     * pas invité. Compté sur tout le trimestre, il apparaissait à 0 % et « jamais venu » avant même
     * d'avoir eu un seul cours à honorer — sur le tableau de bord, dans l'export CSV, et dans le
     * taux affiché sur sa fiche. C'est la même règle que la tuile « Jamais venus » de l'accueil, qui
     * se compte déjà depuis la date d'arrivée.
     *
     * **Et le numérateur suit la même borne**, posée en base sur le même jour d'arrivée
     * (`depuisLeurArrivee`) : sans quoi ses présences d'avant son inscription — le bureau peut les
     * cocher après coup — se rapporteraient à un dénominateur qui les ignore, et le tableau
     * annoncerait « 3 sur 1 ».
     *
     * Arrivée inconnue (donnée ancienne) = présent depuis le début : le repli le plus prudent est
     * l'ancien comportement. Et si aucun cours n'a encore eu lieu depuis son arrivée, le
     * dénominateur vaut zéro : `calculerTaux` rend alors 0 — jamais `NaN` — et les écrans qui
     * distinguent « pas encore de cours » lisent `seances === 0` (voir `accueil.ts`, qui écarte du
     * calcul d'assiduité tout membre dont `seances` vaut 0).
     */
    const arrivee = jourDArrivee(addedAt);
    const siennes = passees.filter((s) => s.date >= arrivee).length;
    return {
      ...user,
      presents,
      absents,
      peutEtre,
      // Jamais négatif : « sans réponse » est le reste d'une soustraction, et un reste négatif
      // n'aurait aucun sens à l'écran (même garde-fou que `enAttente` dans `compteursDepuisTotaux`).
      sansReponse: Math.max(0, siennes - presents - absents - peutEtre),
      seances: siennes,
      pourcentage: calculerTaux(presents, siennes),
      // La borne part avec la ligne : l'export CSV détaille séance par séance ce que ces trois
      // colonnes résument, et c'est cette date qui explique l'écart entre le détail et le total
      // (voir `csvPresences`, qui l'écrit dans une colonne plutôt que d'effacer des cellules).
      arrivee,
    };
  });
  // Le classement, en français et sur « Prénom Nom », comme le tableau l'affiche : `membres` sort
  // dans l'ordre de l'écran, et le CSV téléchargé range Éric à sa lettre (voir
  // `comparerAlphabetique`). Tri **stable**, donc l'ordre de la requête départage les parfaits
  // homonymes plutôt que de bouger d'une ouverture à l'autre.
  membres.sort(comparerAlphabetique);
  const seancesPassees = seances.filter((s) => s.passee && !s.annulee);
  const moyenne = seancesPassees.length ? Math.round(seancesPassees.reduce((n, s) => n + s.compteurs.pourcentage, 0) / seancesPassees.length) : 0;
  return { period: { id: p.id, nom: p.nom, statut: p.statut }, seances, membres, moyenne };
}

/**
 * CSV (séparateur ;) des présences d'une période : une ligne par membre, une colonne par séance
 * **déjà donnée**.
 *
 * ## La règle, tranchée une fois pour toutes
 *
 * **Un compteur de séance compte ce qui s'est passé dans la salle ; un compteur de personne ne
 * compte que les cours donnés depuis son arrivée dans la période.** Les deux ne parlent pas de la
 * même chose, et c'est pour ça qu'ils ne peuvent pas porter la même borne :
 *
 * - le **remplissage d'une séance** est un fait — `seances[].compteurs` n'a donc aucune borne
 *   d'arrivée, et il dit la même chose que la fiche de la séance et que `/admin/presences` ;
 * - le **taux de quelqu'un** s'arrête à son arrivée (`membres[].presents / seances / pourcentage`) :
 *   on ne reproche à personne les cours d'avant son inscription.
 *
 * **Conséquence pour ce fichier : une cellule n'est plus jamais effacée.** Elle disait ce qui avait
 * été saisi, sauf avant l'arrivée de la personne — si bien que la ligne « 01/09 » du tableau de bord
 * annonçait 8 présents pendant que la colonne du fichier n'en portait que 7, et que la réponse
 * cochée par le bureau sur un cours d'essai devenait invisible partout sauf dans le total de la
 * séance. Masquer une donnée saisie pour faire coïncider une colonne avec un total, c'est faire
 * douter du fichier entier ; on montre donc le fait, et **la colonne « Arrivée » dit pourquoi** une
 * ligne peut compter plus de réponses que de « Présences ». Les trois colonnes de totaux le disent
 * aussi dans leur intitulé (« depuis l'arrivée »).
 *
 * ## Les séances à venir n'ont pas de colonne
 *
 * L'en-tête portait une colonne par séance de la période, celles qui n'ont pas encore eu lieu
 * comprises, et leurs cellules restaient remplies : quelqu'un qui a répondu « Présent » aux trois
 * prochains cours alignait huit réponses en face d'une colonne « Présences » qui en annonçait cinq.
 * Une réponse à un cours à venir est une **intention**, pas une présence — elle se lit sur les
 * écrans du club, pas dans un relevé de présences. La frontière est celle de partout ailleurs :
 * `seances[].passee`, donc l'heure de début du cours (voir `seanceCommencee`). Les séances annulées
 * gardent leur colonne, qui porte la mention « (annulée) » : elle a eu lieu dans le calendrier, et
 * son absence décalerait la lecture.
 */
export function csvPresences(stats: StatsPeriode, attendances: Map<string, Map<string, string>>): string {
  // Toutes les cellules sont entre guillemets, mais **les guillemets ne protègent pas d'une
  // formule** : Excel lit `"=..."` comme du texte CSV, puis l'exécute comme une formule. Un prénom
  // ou un nom saisi à l'import commençant par `=` suffirait. D'où la même neutralisation que
  // l'export d'audit, par apostrophe de tête (voir `celluleCsv`, src/lib/alertes.ts).
  const esc = (v: string | number) => {
    const t = String(v);
    return `"${(/^[=+\-@\t\r]/.test(t) ? `'${t}` : t).replace(/"/g, '""')}"`;
  };
  // Les cours déjà donnés, et eux seuls : une réponse à un cours à venir n'est pas une présence.
  const donnees = stats.seances.filter((s) => s.passee);
  const entete = [
    "Prénom",
    "Nom",
    // Elle explique, et elle seule, qu'une ligne puisse porter plus de réponses que de « Présences ».
    "Arrivée",
    ...donnees.map((s) => `${s.date} ${s.heureDebut}${s.annulee ? " (annulée)" : ""}`),
    "Présences depuis l'arrivée",
    "Séances depuis l'arrivée",
    "Taux % depuis l'arrivée",
  ];
  const lignes = stats.membres.map((m) => [
    m.prenom,
    m.nom,
    m.arrivee,
    // La cellule dit ce qui a été saisi, sans exception : c'est le registre du soir de cours.
    ...donnees.map((s) => attendances.get(s.id)?.get(m.id) ?? ""),
    m.presents,
    m.seances,
    m.pourcentage,
  ]);
  return [entete, ...lignes].map((l) => l.map(esc).join(";")).join("\r\n");
}
