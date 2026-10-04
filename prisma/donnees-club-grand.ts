/**
 * **Le jeu de démonstration « grand club »** — facultatif, et sans effet tant qu'on ne le demande pas.
 *
 * `donnees-club.ts` décrit le club du jeu d'essai : douze comptes. C'est le bon jeu pour la plupart des
 * captures, et c'est celui sur lequel repose toute la campagne e2e. Mais l'outil a été retaillé pour
 * des clubs de quatre-vingts (listes repliées au-delà de vingt lignes, recherche et tri sur l'écran
 * des présences, parties libres par séance) et **rien de tout cela ne se voit à douze** : un écran
 * qui ne se replie jamais ne prouve ni qu'il se replie bien, ni — ce qui compte autant — qu'un petit
 * club ne paie rien pour un problème qu'il n'a pas.
 *
 * D'où ce second jeu, choisi par `SEED_DEMO_TAILLE=grand` (ou `npm run db:seed:demo:grand`) :
 * **les douze du club, inchangés, plus soixante-huit personnes inventées**. Les douze restent en
 * tête de liste, dans le même ordre, avec les mêmes couleurs, les mêmes liens et les mêmes
 * réponses : les comptes d'essai des tests et des captures sont donc rigoureusement les mêmes dans
 * les deux tailles, et le mode par défaut ne change pas d'un octet.
 *
 * **Les gens d'ici n'existent pas**, et leurs adresses non plus : le domaine `club-demo.test` est
 * un domaine réservé aux essais (RFC 2606), il ne peut appartenir à personne et rien ne peut lui
 * être envoyé. Les adresses de `donnees-club.ts`, elles, sont déduites des noms sur le domaine du
 * club lui-même : un nom inventé posé sur un domaine qui existe ferait une adresse plausible, donc
 * une adresse qui peut tomber chez quelqu'un.
 */
import type { MembreClub, SeanceClub } from "./donnees-club";

/** Domaine réservé aux essais (RFC 2606) : aucune de ces adresses ne peut exister ni recevoir. */
export const DOMAINE_GRAND = "club-demo.test";

/**
 * Comment on demande le grand jeu. Une valeur inconnue **arrête le seed** au lieu de retomber en
 * silence sur le petit : « SEED_DEMO_TAILLE=gros » qui produirait douze membres sans rien dire
 * coûterait une heure à comprendre.
 */
export type TailleDemo = "club" | "grand";

export function tailleDemandee(valeur: string | undefined = process.env.SEED_DEMO_TAILLE): TailleDemo {
  const v = (valeur ?? "").trim().toLowerCase();
  if (v === "" || v === "club" || v === "normal" || v === "petit") return "club";
  if (v === "grand") return "grand";
  throw new Error(`SEED_DEMO_TAILLE : valeur inattendue « ${valeur} ». Valeurs acceptées : « grand », ou rien du tout pour le jeu habituel.`);
}

/** Vrai quand le jeu « grand club » est demandé. */
export const estTailleGrand = (valeur?: string) => tailleDemandee(valeur) === "grand";

const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** Adresse d'une personne inventée : `prenom.nom@club-demo.test`. */
export const emailGrand = (prenom: string, nom: string) => `${slug(prenom)}.${slug(nom)}@${DOMAINE_GRAND}`;

/**
 * Les soixante-huit personnes inventées, dans l'ordre où elles rejoignent la liste.
 *
 * La troisième case n'est portée que par l'encadrement : **1 personne du bureau et 4 instructeurs**,
 * qui s'ajoutent aux 3 du bureau et 3 instructeurs du jeu du club — soit, au total, 4 personnes du
 * bureau, 7 instructeurs et 73 membres (les quatre du bureau portant le rôle de base *membre*).
 * C'est l'encadrement qu'on voit dans un club de cette taille : un bureau restreint, une poignée
 * d'enseignants, et tout le reste sur le tapis.
 *
 * **`BUREAU` n'est pas un rôle** : la case disait `"ADMIN"`, c'est-à-dire une valeur de `role` qui
 * ne s'écrit plus en base — un compte semé ainsi n'aurait eu **aucun droit** par la matrice. Le
 * bureau est un supplément (`estAdmin`), et il s'ajoute au rôle de base *membre*.
 */
const GENS: Array<[prenom: string, nom: string, encadrement?: "BUREAU" | "INSTRUCTEUR"]> = [
  ["Adèle", "Vaubourg", "BUREAU"],
  ["Basile", "Trémoulet", "INSTRUCTEUR"],
  ["Camille", "Estrabaud", "INSTRUCTEUR"],
  ["Damien", "Rochebrune", "INSTRUCTEUR"],
  ["Élise", "Mazerolles", "INSTRUCTEUR"],
  ["Fabien", "Quentric"],
  ["Gaëlle", "Lanverne"],
  ["Hugo", "Delcampe"],
  ["Inès", "Bourgade"],
  ["Jonas", "Verchère"],
  ["Karine", "Ollivet"],
  ["Loïc", "Mervaux"],
  ["Maëlle", "Pasqualin"],
  ["Nathan", "Fourbier"],
  ["Ophélie", "Dancourt"],
  ["Pierrick", "Vaugelade"],
  ["Quentin", "Bareilles"],
  ["Romane", "Chastagnol"],
  ["Sylvain", "Tourdeau"],
  ["Tiphaine", "Marcombe"],
  ["Ulysse", "Bénazet"],
  ["Valentine", "Grosperrin"],
  ["Wilfried", "Lachaume"],
  ["Xavier", "Pontanier"],
  ["Yann", "Coudreau"],
  ["Zoé", "Marbeuf"],
  ["Amandine", "Vieilleville"],
  ["Bastien", "Rouvignac"],
  ["Clémence", "Delaunois"],
  ["Dorian", "Fressange"],
  ["Emma", "Tassigny"],
  ["Florent", "Bougival"],
  ["Gwendoline", "Haussaire"],
  ["Hélios", "Vantours"],
  ["Iris", "Peyrolles"],
  ["Julien", "Marchandeau"],
  ["Kilian", "Vergnaud"],
  ["Léonie", "Brassoult"],
  ["Mathis", "Doulcier"],
  ["Noémie", "Ravanel"],
  ["Oscar", "Ferrandier"],
  ["Pauline", "Vaucresson"],
  ["Raphaël", "Montbazin"],
  ["Sarah", "Leguellec"],
  ["Thibaud", "Vaillancourt"],
  ["Ugo", "Barbelin"],
  ["Victoire", "Nanteuil"],
  ["Wendy", "Framboisier"],
  ["Yanis", "Tercelin"],
  ["Anaïs", "Roquevaire"],
  ["Benoît", "Lachassagne"],
  ["Charline", "Dupeyrat"],
  ["David", "Vignemale"],
  ["Élodie", "Souchereau"],
  ["Firmin", "Baladier"],
  ["Garance", "Mouchotte"],
  ["Hector", "Valdenaire"],
  ["Ingrid", "Poulmarch"],
  ["Jérémie", "Cassaigne"],
  ["Khadija", "Bellenfant"],
  ["Lucas", "Mirambeau"],
  ["Margaux", "Tréguier"],
  ["Nils", "Charpentrat"],
  ["Océane", "Vaudrecourt"],
  ["Paul", "Gorsselin"],
  ["Rémi", "Beauchesne"],
  ["Solène", "Marquefave"],
  ["Tristan", "Ombredane"],
];

/**
 * Ancienneté, en mois, dans le même esprit que `donnees-club.ts` : des **saisons pleines**, parce
 * que le club compte ainsi (tout le monde prend une année à la rentrée), et `0` pour ceux dont
 * personne n'a noté l'adhésion — c'est le repli qu'il faut voir à l'écran autant que les anciens.
 * Elle est calculée par la place dans la liste : un cycle suffit à obtenir le dégradé
 * recrues / installés / anciens que montre l'accueil.
 */
const ANCIENNETES = [0, 12, 24, 36, 48, 12, 0, 24, 60, 12, 36, 84];

/** Les 68 comptes supplémentaires du jeu « grand club » (les 12 de `donnees-club.ts` restent en tête). */
export const MEMBRES_GRAND: MembreClub[] = GENS.map(([prenom, nom, encadrement], i) => ({
  prenom,
  nom,
  email: emailGrand(prenom, nom),
  // Le bureau garde le rôle de base **membre** et reçoit le supplément : deux colonnes distinctes,
  // comme en base. Un `role: "ADMIN"` ne donnerait plus aucun droit par la matrice.
  role: encadrement === "INSTRUCTEUR" ? "INSTRUCTEUR" : "MEMBRE",
  estAdmin: encadrement === "BUREAU",
  auClubMois: ANCIENNETES[i % ANCIENNETES.length],
}));

/**
 * **Comment chacun répond** — c'est tout l'intérêt du jeu : un club de quatre-vingts n'est pas un
 * club de douze en plus gros, c'est un club où **la plupart des gens n'ont pas répondu**.
 *
 * Quatre profils, répartis par la place dans la liste (donc stables d'une exécution à l'autre) :
 *  - `noyau` (15) : viennent presque toujours et répondent tôt ;
 *  - `irregulier` (34, soit la moitié) : répondent au coup par coup, souvent après le cours ;
 *  - `discret` (13) : viennent peu et répondent encore moins ;
 *  - `jamais` (6) : inscrits, jamais venus — ils tirent les taux vers le bas, comme dans la vraie vie.
 *
 * Et surtout : **sur les séances à venir, presque personne n'a répondu**. C'est le cas qui rend les
 * écrans illisibles — soixante lignes « sans réponse » à faire tenir sous un bouton — donc celui
 * qu'il faut pouvoir montrer.
 */
export type ProfilPresence = "noyau" | "irregulier" | "discret" | "jamais";

const REPARTITION: Array<[ProfilPresence, number]> = [
  ["noyau", 15],
  ["irregulier", 34],
  ["discret", 13],
  ["jamais", 6],
];

const PROFILS: ProfilPresence[] = REPARTITION.flatMap(([profil, n]) => Array.from({ length: n }, () => profil));

/** Profil de présence d'un compte du grand jeu (`null` pour les douze de `donnees-club.ts`). */
export function profilDe(email: string): ProfilPresence | null {
  const i = MEMBRES_GRAND.findIndex((m) => m.email === email);
  return i === -1 ? null : PROFILS[i];
}

/** Effectif de chaque profil, pour les tests et pour le message de fin du seed. */
export const EFFECTIFS_PROFILS = Object.fromEntries(REPARTITION) as Record<ProfilPresence, number>;

/**
 * Tirage **déterministe** dans [0, 1[ à partir de clés textuelles (FNV-1a).
 *
 * Un jeu de démonstration n'a d'intérêt que s'il est reproductible : deux exécutions doivent donner
 * exactement les mêmes réponses, sans quoi une capture ne se refait jamais à l'identique et un
 * écart entre deux essais ne veut plus rien dire. D'où un tirage tiré du couple (personne, date)
 * plutôt que de `Math.random`.
 */
function alea(...cles: string[]): number {
  let h = 0x811c9dc5;
  const texte = cles.join("|");
  for (let i = 0; i < texte.length; i++) {
    h ^= texte.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h / 0x1_0000_0000;
}

/** Probabilité de répondre, et répartition des réponses, par profil et selon que le cours est passé. */
const TENDANCES: Record<ProfilPresence, { passe: { repond: number; present: number; peutEtre: number }; avenir: { repond: number; present: number; peutEtre: number } }> = {
  // Le noyau répond, et vient. Sur les séances à venir il répond encore, mais pas tout le monde.
  noyau: { passe: { repond: 1, present: 0.85, peutEtre: 0.1 }, avenir: { repond: 0.75, present: 0.8, peutEtre: 0.15 } },
  // L'irrégulier répond une fois sur cinq avant le cours : c'est lui qui remplit les « sans réponse ».
  irregulier: { passe: { repond: 0.85, present: 0.45, peutEtre: 0.15 }, avenir: { repond: 0.2, present: 0.5, peutEtre: 0.25 } },
  discret: { passe: { repond: 0.5, present: 0.15, peutEtre: 0.15 }, avenir: { repond: 0.08, present: 0.4, peutEtre: 0.3 } },
  // Inscrit, jamais venu : quand il répond, c'est pour dire non.
  jamais: { passe: { repond: 0.6, present: 0, peutEtre: 0 }, avenir: { repond: 0.03, present: 0, peutEtre: 0 } },
};

/** Réponse d'une personne du grand jeu à une séance, ou `null` = elle n'a pas répondu. */
export function reponseGrand(email: string, date: string, aujourdHui: string): "PRESENT" | "PEUT_ETRE" | "ABSENT" | null {
  const profil = profilDe(email);
  if (!profil) return null;
  const t = TENDANCES[profil][date >= aujourdHui ? "avenir" : "passe"];
  if (alea(email, date, "repond") >= t.repond) return null;
  const d = alea(email, date, "statut");
  if (d < t.present) return "PRESENT";
  if (d < t.present + t.peutEtre) return "PEUT_ETRE";
  return "ABSENT";
}

/**
 * Les séances du club, **complétées** des réponses des soixante-huit personnes inventées.
 *
 * Les réponses de `donnees-club.ts` ne sont pas touchées : elles restent en tête, dans leur ordre. On ne
 * fait qu'ajouter — le jeu « grand club » est le petit jeu, plus du monde autour.
 */
export function seancesGrandClub(seances: readonly SeanceClub[], aujourdHui: string): SeanceClub[] {
  return seances.map((s) => ({
    ...s,
    reponses: [
      ...s.reponses,
      ...MEMBRES_GRAND.map((m) => [m.email, reponseGrand(m.email, s.date, aujourdHui)] as const)
        .filter((r): r is readonly [string, "PRESENT" | "PEUT_ETRE" | "ABSENT"] => r[1] !== null)
        .map(([email, statut]) => [email, statut] as [string, "PRESENT" | "PEUT_ETRE" | "ABSENT"]),
    ],
  }));
}

/** Une case du planning décrite par sa place (`rang`) dans la séance — même forme que `PROGRAMME`. */
export type ProgrammeSeance = {
  date: string;
  /** `description` est **facultative**, comme dans l'application : la plupart des cases s'en passent. */
  parties: Array<{ rang: number; email: string; theme: string; niveau?: string; description?: string }>;
};

const E = (prenom: string, nom: string) => emailGrand(prenom, nom);

/**
 * **Le planning d'un gros club : plus de quatre parties, et des niveaux annoncés.**
 *
 * À douze, deux cours et deux options suffisent, et la grille en cartes ne montre jamais son point
 * de rupture. À quatre-vingts, on ouvre un groupe débutants en parallèle, on garde un créneau de
 * sparring encadré, et les quatre cases du modèle ne suffisent plus : trois séances en portent
 * **cinq ou six**. Les cases au-delà du modèle sont nommées comme le fait l'application quand elle
 * en ajoute une (« 3e option », « 4e option »…), pour que le jeu d'essai montre exactement ce que
 * l'équipe verrait.
 *
 * Les rangs commencent à 2 sur les dates que `PROGRAMME` renseigne déjà (il occupe 0 et 1) : les
 * deux listes se concatènent, elles ne se marchent pas dessus.
 */
export const PROGRAMME_GRAND: ProgrammeSeance[] = [
  {
    date: "2026-09-26",
    parties: [
      { rang: 1, email: E("Basile", "Trémoulet"), theme: "Épée longue", niveau: "INTERMEDIAIRE" },
      {
        rang: 2,
        email: E("Élise", "Mazerolles"),
        theme: "Prise en main du matériel",
        niveau: "DEBUTANT",
        description: "Tour du matériel du club : masque, gants, veste. On règle chacun à sa taille, puis premiers déplacements sans arme.",
      },
      { rang: 3, email: E("Camille", "Estrabaud"), theme: "Sparring encadré", niveau: "AVANCE" },
    ],
  },
  {
    // Six parties : la grille à son point de rupture, sur une séance annulée (le cas cumulé).
    date: "2026-10-03",
    parties: [
      { rang: 1, email: E("Damien", "Rochebrune"), theme: "Bouclier et épée", niveau: "INTERMEDIAIRE" },
      { rang: 2, email: E("Élise", "Mazerolles"), theme: "Groupe débutants — déplacements", niveau: "DEBUTANT" },
      { rang: 3, email: E("Basile", "Trémoulet"), theme: "Lutte au corps", niveau: "INTERMEDIAIRE" },
      { rang: 4, email: E("Camille", "Estrabaud"), theme: "Arbitrage et comptage", niveau: "INDIFFERENT" },
      { rang: 5, email: E("Adèle", "Vaubourg"), theme: "Préparation au tournoi", niveau: "AVANCE" },
    ],
  },
  {
    // Six parties, sans rien hériter de PROGRAMME : la séance la plus chargée du trimestre.
    date: "2026-10-07",
    parties: [
      { rang: 0, email: E("Basile", "Trémoulet"), theme: "Épée longue — les quatre gardes", niveau: "DEBUTANT" },
      { rang: 1, email: E("Damien", "Rochebrune"), theme: "Messer — coups de taille", niveau: "INTERMEDIAIRE" },
      { rang: 2, email: E("Élise", "Mazerolles"), theme: "Dague", niveau: "DEBUTANT" },
      { rang: 3, email: E("Camille", "Estrabaud"), theme: "Sparring libre", niveau: "AVANCE" },
      { rang: 4, email: E("Adèle", "Vaubourg"), theme: "Étirements et récupération" },
      { rang: 5, email: E("Basile", "Trémoulet"), theme: "Lecture de source — Meyer", niveau: "INTERMEDIAIRE" },
    ],
  },
  {
    date: "2026-10-10",
    parties: [
      { rang: 0, email: E("Camille", "Estrabaud"), theme: "Hache de pas", niveau: "INTERMEDIAIRE" },
      { rang: 1, email: E("Élise", "Mazerolles"), theme: "Groupe débutants — distance", niveau: "DEBUTANT" },
      { rang: 2, email: E("Damien", "Rochebrune"), theme: "Viking" },
      { rang: 3, email: E("Basile", "Trémoulet"), theme: "Sparring encadré", niveau: "AVANCE" },
    ],
  },
  {
    // Cinq parties : une de plus que le modèle, le cas le plus courant dans un gros club.
    date: "2026-10-14",
    parties: [
      { rang: 0, email: E("Damien", "Rochebrune"), theme: "Épée longue", niveau: "INTERMEDIAIRE" },
      { rang: 1, email: E("Basile", "Trémoulet"), theme: "Messer" },
      { rang: 2, email: E("Élise", "Mazerolles"), theme: "Groupe débutants — gardes", niveau: "DEBUTANT" },
      { rang: 3, email: E("Camille", "Estrabaud"), theme: "Antrim Bata", niveau: "AVANCE" },
      { rang: 4, email: E("Adèle", "Vaubourg"), theme: "Bilan de trimestre" },
    ],
  },
  {
    date: "2026-10-21",
    parties: [
      { rang: 0, email: E("Élise", "Mazerolles"), theme: "Groupe débutants — premier assaut", niveau: "DEBUTANT" },
      { rang: 1, email: E("Camille", "Estrabaud"), theme: "Épée longue", niveau: "AVANCE" },
    ],
  },
];

/**
 * Concatène deux programmes, date par date. Les cases du grand jeu s'ajoutent à celles du club, elles
 * ne les remplacent pas — d'où l'ordre des rangs choisi ci-dessus.
 */
export function fusionnerProgrammes(base: readonly ProgrammeSeance[], ajout: readonly ProgrammeSeance[]): ProgrammeSeance[] {
  const dates = [...new Set([...base, ...ajout].map((p) => p.date))];
  return dates.map((date) => ({
    date,
    parties: [...(base.find((p) => p.date === date)?.parties ?? []), ...(ajout.find((p) => p.date === date)?.parties ?? [])],
  }));
}
