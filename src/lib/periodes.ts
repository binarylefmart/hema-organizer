import { addDays, capitale, isoWeekday } from "./dates";

/**
 * Génération des séances d'une période à partir de ses créneaux hebdomadaires (fonction pure).
 */
export type CreneauSource = { jourSemaine: number; heureDebut: string; heureFin: string; lieu: string; adresse: string };
export type SeanceGeneree = { date: string; heureDebut: string; heureFin: string; lieu: string; adresse: string };

/**
 * `exclusions` porte les dates **écartées à la main** — vacances scolaires, jours fériés, ponts.
 * Deux formes y sont acceptées, et c'est volontaire :
 * - « AAAA-MM-JJ » écarte **toute la journée**, quel que soit le nombre de créneaux ;
 * - « AAAA-MM-JJ HH:MM » n'écarte **qu'un créneau** — un club à deux cours le même soir peut n'en
 *   annuler qu'un, et c'est exactement ce que proposent les cases de l'écran, une par créneau.
 *
 * C'est la même clé que `dejaExistantes` et que les cases du formulaire : une seule forme dans tout
 * le code, comparée telle quelle. Aucune `Date` n'est construite ici — elle basculerait d'un jour
 * selon le fuseau du serveur.
 *
 * Ces exclusions viennent de `Period.datesExclues` (table `PeriodDateExclue`) : la génération est
 * rejouable, et sans mémoire les dates décochées revenaient cochées à la visite suivante.
 */
export function genererSeances(
  dateDebut: string,
  dateFin: string,
  creneaux: CreneauSource[],
  exclusions: Iterable<string> = [],
  dejaExistantes: Iterable<string> = [],
): SeanceGeneree[] {
  const exclues = new Set(exclusions);
  const existantes = new Set(dejaExistantes);
  const parJour = new Map<number, CreneauSource[]>();
  for (const c of creneaux) parJour.set(c.jourSemaine, [...(parJour.get(c.jourSemaine) ?? []), c]);
  const resultat: SeanceGeneree[] = [];
  for (let date = dateDebut; date <= dateFin; date = addDays(date, 1)) {
    if (exclues.has(date)) continue;
    for (const c of parJour.get(isoWeekday(date)) ?? []) {
      const cle = `${date} ${c.heureDebut}`;
      if (existantes.has(cle) || exclues.has(cle)) continue;
      resultat.push({ date, heureDebut: c.heureDebut, heureFin: c.heureFin, lieu: c.lieu, adresse: c.adresse });
    }
  }
  return resultat;
}

/** La clé d'une date de séance, partout la même : « AAAA-MM-JJ HH:MM ». */
export function cleSeance(s: { date: string; heureDebut: string }): string {
  return `${s.date} ${s.heureDebut}`;
}

export const JOURS_SEMAINE = ["", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"] as const;

/**
 * Les mots qu'on trouve dans une **en-tête** de colonne, quelle que soit sa place dans la ligne.
 * Ils sont comparés à la colonne entière : « Durand » n'est pas « nom », et une personne ne devient
 * pas une en-tête parce que son nom contient le mot.
 */
const ENTETE_CSV = /^(pr[ée]noms?|noms?|e-?mails?|courriels?|adresses?|r[ôo]les?)$/i;

/**
 * Analyse un CSV « prénom;nom;email;rôle » (séparateur ; ou , ; en-tête facultative).
 *
 * Trois règles, et chacune répare une erreur qui ne se voyait pas :
 *
 * - **le numéro de ligne est celui du fichier**, lignes vides comprises. Il était celui des lignes
 *   retenues : une ligne vide au milieu, et « erreur ligne 3 » désignait la 6e ligne du tableur.
 *   Un message qui envoie chercher au mauvais endroit est pire qu'un message absent ;
 * - **le séparateur est celui du fichier**, deviné une seule fois sur sa première ligne. Deviné
 *   ligne par ligne, une seule ligne contenant un « ; » — un nom composé, une adresse recopiée —
 *   basculait pour elle seule et fondait ses trois colonnes en une : un membre nommé
 *   « Claire,Delta,c@d.fr » entrait dans l'annuaire sans la moindre erreur ;
 * - **l'en-tête se reconnaît sur n'importe laquelle de ses colonnes**, et seulement sur la première
 *   ligne. On ne cherchait « prénom » que dans la première colonne : « Nom;Prénom;Email » partait
 *   donc comme un membre appelé « Nom Prénom », avec « Email » pour adresse.
 */
export function analyserCsvMembres(texte: string): Array<{ prenom: string; nom: string; email: string; role: string; ligne: number }> {
  const lignes = texte
    .split(/\r?\n/)
    .map((contenu, index) => ({ contenu: contenu.trim(), ligne: index + 1 }))
    .filter((l) => l.contenu !== "");
  if (lignes.length === 0) return [];
  const sep = lignes[0].contenu.includes(";") ? ";" : ",";
  const resultat: Array<{ prenom: string; nom: string; email: string; role: string; ligne: number }> = [];
  lignes.forEach(({ contenu, ligne }, i) => {
    const cols = contenu.split(sep).map((c) => c.trim().replace(/^"|"$/g, ""));
    if (i === 0 && cols.some((c) => ENTETE_CSV.test(c))) return; // en-tête
    const [prenom = "", nom = "", email = "", role = "MEMBRE"] = cols;
    resultat.push({ prenom, nom, email, role: (role || "MEMBRE").toUpperCase(), ligne });
  });
  return resultat;
}

/**
 * Découpage de l'année du club (fonctions pures, testées). Le club travaille par **trimestres de
 * la saison sportive**, jamais à l'année : T1 septembre→décembre, T2 janvier→mars, T3 avril→juin,
 * plus la **période estivale** (juillet→août). La saison est désignée par son année de départ
 * (2026 = saison 2026-2027).
 */
export type Trimestre = 1 | 2 | 3 | 4;

export const TRIMESTRES: ReadonlyArray<{ n: Trimestre; label: string }> = [
  { n: 1, label: "T1 — septembre à décembre" },
  { n: 2, label: "T2 — janvier à mars" },
  { n: 3, label: "T3 — avril à juin" },
  { n: 4, label: "Été — juillet et août" },
];

/** Garde de type : convertit sans risque la valeur d'une liste déroulante en trimestre. */
export function estTrimestre(valeur: number): valeur is Trimestre {
  return valeur === 1 || valeur === 2 || valeur === 3 || valeur === 4;
}

/** Libellé d'une saison à partir de son année de départ : 2026 → « 2026-2027 ». */
export function libelleSaison(saison: number): string {
  return `${saison}-${saison + 1}`;
}

export function datesTrimestre(saison: number, trimestre: Trimestre): { nom: string; dateDebut: string; dateFin: string } {
  const suivante = saison + 1;
  switch (trimestre) {
    case 1:
      return { nom: `T1 ${libelleSaison(saison)}`, dateDebut: `${saison}-09-01`, dateFin: `${saison}-12-31` };
    case 2:
      return { nom: `T2 ${libelleSaison(saison)}`, dateDebut: `${suivante}-01-01`, dateFin: `${suivante}-03-31` };
    case 3:
      return { nom: `T3 ${libelleSaison(saison)}`, dateDebut: `${suivante}-04-01`, dateFin: `${suivante}-06-30` };
    case 4:
      return { nom: `Été ${suivante}`, dateDebut: `${suivante}-07-01`, dateFin: `${suivante}-08-31` };
  }
}

/**
 * Le trimestre qui suit, en **changeant de saison après l'été** : T1 → T2 → T3 → Été → T1 de la
 * saison d'après. C'est le cycle de l'année du club, et la seule règle d'enchaînement qui existe :
 * une période ne porte en base ni saison, ni numéro de trimestre, ni lien vers la suivante — elle
 * n'a qu'un nom et deux dates (voir `trimestreDe`).
 */
export function trimestreSuivant(saison: number, trimestre: Trimestre): { saison: number; trimestre: Trimestre } {
  return trimestre === 4 ? { saison: saison + 1, trimestre: 1 } : { saison, trimestre: (trimestre + 1) as Trimestre };
}

/**
 * Reconnaître un trimestre dans une période **enregistrée**, qui n'en garde aucune trace : ni la
 * saison ni le numéro choisis au moment de la création ne sont conservés (l'action ne reçoit qu'un
 * nom et deux dates).
 *
 * On l'identifie donc par **son nom d'abord** — « T2 2026-2027 », « Été 2027 », tels que
 * `datesTrimestre` les propose —, par ses **dates** ensuite. Le nom passe en premier parce que
 * c'est le champ que l'on ne retouche pas, là où les dates se rognent volontiers d'une semaine
 * pour tomber sur les vacances scolaires.
 *
 * `null` pour une période libre (un stage, un cycle hors saison) : elle n'a pas de suivante
 * attendue, et rien ne doit être réclamé à son sujet.
 */
export function trimestreDe(p: { nom: string; dateDebut: string; dateFin: string }): { saison: number; trimestre: Trimestre } | null {
  const nom = p.nom.trim();
  // Deux saisons candidates : celle où commence la période, et la précédente — « Été 2027 »
  // commence en juillet 2027, qui appartient encore à la saison 2026-2027.
  const debut = saisonCourante(p.dateDebut);
  for (const saison of [debut, debut - 1]) {
    for (const { n } of TRIMESTRES) {
      const t = datesTrimestre(saison, n);
      if (t.nom === nom) return { saison, trimestre: n };
      if (t.dateDebut === p.dateDebut && t.dateFin === p.dateFin) return { saison, trimestre: n };
    }
  }
  return null;
}

/**
 * La période attendue après celle-ci : son nom et ses dates, tels que le formulaire les proposera.
 * `null` si la période qui s'achève n'est pas un trimestre reconnu — on ne réclame pas de suite à
 * un stage de Pâques.
 */
export function periodeAttendueApres(p: { nom: string; dateDebut: string; dateFin: string }): {
  nom: string;
  dateDebut: string;
  dateFin: string;
  saison: number;
  trimestre?: Trimestre;
  bimestre?: Bimestre;
  decalage?: DecalageBimestre;
} | null {
  const actuel = trimestreDe(p);
  if (actuel) {
    const { saison, trimestre } = trimestreSuivant(actuel.saison, actuel.trimestre);
    return { ...datesTrimestre(saison, trimestre), saison, trimestre };
  }
  // Un club qui travaille par bimestres a droit au même rappel de fin de période. La suite se
  // cherche **dans la même grille** : qui travaille en octobre-novembre attend décembre-janvier,
  // pas novembre-décembre.
  const bim = bimestreDe(p);
  if (bim) {
    const { saison, bimestre } = bimestreSuivant(bim.saison, bim.bimestre);
    return { ...datesBimestre(saison, bimestre, bim.decalage), saison, bimestre, decalage: bim.decalage };
  }
  return null;
}

/**
 * **Bimestres** — le découpage en périodes de deux mois, demandé par Delta à côté des trimestres.
 * Six par saison, et **deux calages possibles** (demandés le même jour) : *pair*, calé sur la
 * saison — septembre-octobre, novembre-décembre… — ou *impair*, décalé d'**un mois** —
 * octobre-novembre, décembre-janvier… Un club dont les cours démarrent en octobre pose ses six
 * cycles d'un geste au lieu de saisir douze dates à la main.
 */
export type Bimestre = 1 | 2 | 3 | 4 | 5 | 6;

/**
 * Le **calage** de la grille : 0 = pair (le premier cycle ouvre en septembre), 1 = impair (il ouvre
 * en octobre). C'est un décalage **en mois**, pas un cycle de plus : les six cycles restent six,
 * ils glissent tous ensemble.
 */
export type DecalageBimestre = 0 | 1;

export const BIMESTRES: ReadonlyArray<Bimestre> = [1, 2, 3, 4, 5, 6];

export const DECALAGES_BIMESTRE: ReadonlyArray<{ d: DecalageBimestre; label: string }> = [
  { d: 0, label: "Pair (sept.-oct.)" },
  { d: 1, label: "Impair (oct.-nov.)" },
];

/** Garde de type : convertit sans risque la valeur d'une liste déroulante en bimestre. */
export function estBimestre(valeur: number): valeur is Bimestre {
  return Number.isInteger(valeur) && valeur >= 1 && valeur <= 6;
}

/** Garde de type : convertit sans risque un paramètre d'URL en calage. */
export function estDecalageBimestre(valeur: number): valeur is DecalageBimestre {
  return valeur === 0 || valeur === 1;
}

/** Dernier jour d'un mois (le seul qui bouge est février : 28 ou 29). */
function dernierJour(annee: number, mois: number): string {
  const j = new Date(Date.UTC(annee, mois, 0, 12)).getUTCDate();
  return `${annee}-${String(mois).padStart(2, "0")}-${String(j).padStart(2, "0")}`;
}

/* Les mois sont écrits en toutes lettres ici plutôt que tirés d'`Intl` : ces noms sont ceux des
   périodes enregistrées en base, et `bimestreDe` les relit. Une mise à jour d'ICU ne doit pas
   pouvoir changer « Sept.-oct. 2026 » sous les pieds des périodes déjà créées. */
const MOIS_COURT = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."] as const;
const MOIS_LONG = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"] as const;

/**
 * Les deux mois d'un cycle, comptés depuis **septembre de la saison** : le rang 0 est septembre, et
 * le calage ne fait qu'ajouter un mois à ce départ. Un cycle peut donc changer d'année civile
 * (décembre-janvier) et, pour le dernier de la grille impaire, mordre d'un mois sur la saison
 * suivante (août-septembre) — c'est ce que veut dire décaler toute la grille.
 */
function moisDuBimestre(saison: number, bimestre: Bimestre, decalage: DecalageBimestre) {
  const rang = 9 + (bimestre - 1) * 2 + decalage;
  const mois = (n: number) => ({ annee: saison + Math.floor((n - 1) / 12), mois: ((n - 1) % 12) + 1 });
  return { debut: mois(rang), fin: mois(rang + 1) };
}

/**
 * Nom et dates d'un bimestre. Le nom est écrit comme on le dirait — « Sept.-oct. 2026 » — et porte
 * l'**année civile** de ses mois, là où un trimestre porte la saison : « Janv.-févr. 2027 » est sans
 * ambiguïté, alors que « Janv.-févr. 2026-2027 » ferait hésiter. Les deux années ne s'écrivent que
 * lorsque le cycle les traverse vraiment : « Déc.-janv. 2026-2027 ».
 */
export function datesBimestre(saison: number, bimestre: Bimestre, decalage: DecalageBimestre = 0): { nom: string; dateDebut: string; dateFin: string } {
  const { debut, fin } = moisDuBimestre(saison, bimestre, decalage);
  const annees = debut.annee === fin.annee ? `${debut.annee}` : `${debut.annee}-${fin.annee}`;
  return {
    nom: `${capitale(MOIS_COURT[debut.mois - 1])}-${MOIS_COURT[fin.mois - 1]} ${annees}`,
    dateDebut: `${debut.annee}-${String(debut.mois).padStart(2, "0")}-01`,
    dateFin: dernierJour(fin.annee, fin.mois),
  };
}

/** Les six cycles d'une grille, tels que la liste déroulante les nomme : « Septembre – octobre »… */
export function bimestresChoix(decalage: DecalageBimestre = 0): ReadonlyArray<{ n: Bimestre; label: string }> {
  return BIMESTRES.map((n) => {
    const { debut, fin } = moisDuBimestre(2000, n, decalage);
    return { n, label: `${capitale(MOIS_LONG[debut.mois - 1])} – ${MOIS_LONG[fin.mois - 1]}` };
  });
}

/** Le bimestre qui suit, en changeant de saison après le sixième cycle. */
export function bimestreSuivant(saison: number, bimestre: Bimestre): { saison: number; bimestre: Bimestre } {
  return bimestre === 6 ? { saison: saison + 1, bimestre: 1 } : { saison, bimestre: (bimestre + 1) as Bimestre };
}

/**
 * Saison et bimestre auxquels appartient une date, dans le calage donné. On essaie les cycles
 * plutôt que de calculer un reste : en grille impaire, septembre 2027 est le **dernier** cycle de
 * la saison 2026, et aucune division ne le dit aussi simplement que ses deux bornes.
 */
export function bimestreCourant(dateIso: string, decalage: DecalageBimestre = 0): { saison: number; bimestre: Bimestre } {
  const debut = saisonCourante(dateIso);
  for (const saison of [debut, debut - 1]) {
    for (const n of BIMESTRES) {
      const b = datesBimestre(saison, n, decalage);
      if (b.dateDebut <= dateIso && dateIso <= b.dateFin) return { saison, bimestre: n };
    }
  }
  return { saison: debut, bimestre: 1 };
}

/**
 * Reconnaître un bimestre dans une période enregistrée — même méthode que `trimestreDe`, et le
 * **calage** en plus, pour que le rappel de fin de période propose la suite dans la même grille.
 *
 * Les noms sont tous essayés avant les dates : deux grilles décalées d'un mois ne produisent jamais
 * le même nom, alors qu'une période dont on a rogné les dates pourrait tomber par hasard sur les
 * bornes de l'autre grille. Le nom est le champ qu'on ne retouche pas ; il tranche en premier.
 */
export function bimestreDe(p: { nom: string; dateDebut: string; dateFin: string }): { saison: number; bimestre: Bimestre; decalage: DecalageBimestre } | null {
  const nom = p.nom.trim();
  const debut = saisonCourante(p.dateDebut);
  const grilles = [0, 1].flatMap((d) => [debut, debut - 1].map((saison) => ({ saison, decalage: d as DecalageBimestre })));
  for (const { saison, decalage } of grilles) {
    for (const n of BIMESTRES) if (datesBimestre(saison, n, decalage).nom === nom) return { saison, bimestre: n, decalage };
  }
  for (const { saison, decalage } of grilles) {
    for (const n of BIMESTRES) {
      const b = datesBimestre(saison, n, decalage);
      if (b.dateDebut === p.dateDebut && b.dateFin === p.dateFin) return { saison, bimestre: n, decalage };
    }
  }
  return null;
}

/**
 * Le chemin du formulaire « Nouvelle période » **pré-rempli** par ce que le calendrier attend :
 * un trimestre ou un bimestre, selon le découpage de la période qui s'achève. Un seul endroit sait
 * écrire ces paramètres — l'email et la notification de fin de période s'en servent tous les deux.
 */
export function cheminNouvellePeriode(attendue: { saison: number; trimestre?: number; bimestre?: number; decalage?: number }): string {
  // Le calage ne s'écrit que s'il décale quelque chose : une grille paire est la grille par défaut.
  const cycle =
    attendue.bimestre !== undefined
      ? `bimestre=${attendue.bimestre}${attendue.decalage ? `&decalage=${attendue.decalage}` : ""}`
      : `trimestre=${attendue.trimestre ?? 1}`;
  return `/admin/periodes/nouvelle?saison=${attendue.saison}&${cycle}`;
}

/** Saison sportive en cours à une date donnée (2026 = saison 2026-2027, qui démarre le 1er septembre). */
export function saisonCourante(dateIso: string): number {
  const annee = Number(dateIso.slice(0, 4));
  return Number(dateIso.slice(5, 7)) >= 9 ? annee : annee - 1;
}

/** Trimestre du club auquel appartient une date (4 = période estivale). */
export function trimestreCourant(dateIso: string): Trimestre {
  const mois = Number(dateIso.slice(5, 7));
  if (mois >= 9) return 1;
  if (mois <= 3) return 2;
  if (mois <= 6) return 3;
  return 4;
}

/** Saison à laquelle appartient une date : « 2026-2027 » pour tout ce qui va du 1er sept. 2026 au 31 août 2027. */
export function saisonDe(dateIso: string): string {
  return libelleSaison(saisonCourante(dateIso));
}


/** Bornes acceptées pour une année de départ de saison saisie à la main. */
export const SAISON_MIN = 2000;
export const SAISON_MAX = 2100;

/**
 * Année de départ de saison saisie librement (champ « Saison » du formulaire) :
 * renvoie l'année si elle est entière et dans la plage acceptée, sinon null.
 */
export function lireSaison(valeur: string | number | null | undefined): number | null {
  if (valeur === null || valeur === undefined || (typeof valeur === "string" && valeur.trim() === "")) return null;
  const n = Number(valeur);
  if (!Number.isInteger(n) || n < SAISON_MIN || n > SAISON_MAX) return null;
  return n;
}

/** Saisons proposées en accès rapide à la création : la précédente, celle en cours et les cinq suivantes. */
export function saisonsChoix(dateIso: string): number[] {
  const s = saisonCourante(dateIso);
  return [s - 1, s, s + 1, s + 2, s + 3, s + 4, s + 5];
}

/** Saisons proposées à la création d'une période : la précédente, celle en cours et la suivante. */
export function saisonsProposees(dateIso: string): number[] {
  const s = saisonCourante(dateIso);
  return [s - 1, s, s + 1];
}
