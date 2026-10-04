import { beforeEach, describe, expect, it, vi } from "vitest";
// Le vrai module des écrans, jamais simulé : c'est l'enjeu même du troisième bloc de ce fichier —
// l'alerte et les écrans doivent lire la même fonction, pas deux règles qui se ressemblent.
import { palierEffectif, sousLeSeuil, PALIER_LABELS, seuilConfort, seuilEnPersonnes } from "@/lib/presences";

/**
 * **L'alerte « peu de monde » : sa reprise après échec, ses chiffres, et son juge.**
 *
 * Trois blocs, pour trois défauts qui se manifestaient tous par un message de trop ou de moins :
 *
 * 1. **le journal** — c'était le seul envoi du dossier à ne pas suivre les règles de `journal.ts` :
 *    sa ligne était écrite **après** la boucle d'envoi, par un `create` brut, et aucun rattrapage
 *    n'était branché sur l'envoi. Trois minutes de SMTP en panne suffisaient à perdre l'alerte pour
 *    de bon — le journal disait « envoyé », l'idempotence empêchait toute nouvelle tentative, et
 *    l'équipe ouvrait la salle pour deux personnes sans avoir jamais été prévenue ;
 * 2. **les chiffres** — ils se dérivent de la liste des invités de la séance, jamais des lignes de
 *    présence brutes ;
 * 3. **le juge** — `palierEffectif`, celui des écrans, et pas une seconde règle qui lui ressemble.
 *
 * Tout est simulé : la base, la file d'emails (qui rend la main à son appelant, comme la vraie) et
 * l'état des canaux. Seul `src/lib/presences.ts` reste réel, et c'est voulu : le troisième bloc ne
 * vérifie rien d'autre que l'accord entre l'alerte et ce que les écrans affichent.
 */

type LigneLog = { type: string; canal: string; sessionId: string | null; userId: string | null; dedupKey: string; statut: string; erreur: string | null };

const faux = vi.hoisted(() => ({
  seances: [] as Array<Record<string, unknown>>,
  logs: [] as Array<Record<string, unknown>>,
  emails: [] as Array<{ to: string; ref?: string }>,
  /** Ce qui est parti sur le salon Discord : c'est là qu'on relit les chiffres publiés */
  salon: [] as Array<{ embed: { fields?: Array<{ name: string; value: string }> } }>,
  /** L'erreur que la file d'emails rend à son appelant (null = tout est parti) */
  echecEmail: null as Error | null,
  /** Canaux ouverts pour `effectif_faible` */
  canaux: { email: true, push: false, discord: false, telegram: false } as Record<string, boolean>,
}));

vi.mock("@/lib/db", () => ({
  db: {
    // Aucun réglage en base : le club tourne sur les valeurs par défaut de la matrice.
    setting: { findUnique: vi.fn(async () => null) },
    session: { findMany: vi.fn(async () => faux.seances) },
    notificationLog: {
      findUnique: vi.fn(async (args: { where: { dedupKey: string } }) => faux.logs.find((l) => l.dedupKey === args.where.dedupKey) ?? null),
      findMany: vi.fn(async (args: { where: { dedupKey: { in: string[] } } }) =>
        faux.logs.filter((l) => args.where.dedupKey.in.includes(l.dedupKey as string)).map((l) => ({ dedupKey: l.dedupKey })),
      ),
      create: vi.fn(async ({ data }: { data: LigneLog }) => {
        if (faux.logs.some((l) => l.dedupKey === data.dedupKey)) throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
        faux.logs.push({ ...data });
        return data;
      }),
      update: vi.fn(async ({ where, data }: { where: { dedupKey: string }; data: Partial<LigneLog> }) => {
        const ligne = faux.logs.find((l) => l.dedupKey === where.dedupKey);
        if (!ligne) throw new Error("introuvable");
        Object.assign(ligne, data);
        return ligne;
      }),
    },
  },
}));

/** La vraie file rappelle son appelant quand l'envoi a échoué : le faux fait pareil, à la demande. */
vi.mock("@/lib/email/mailer", () => ({
  enqueueEmail: vi.fn((mail: { to: string; ref?: string }, onDone?: (err: Error | null) => void) => {
    faux.emails.push(mail);
    onDone?.(faux.echecEmail);
  }),
}));

/** L'état des canaux se règle test par test : ce qui compte ici est le journal, pas les réglages. */
vi.mock("@/lib/notifications/canaux", () => ({
  envoiPossible: vi.fn(async (_type: string, canal: string) => faux.canaux[canal] === true),
}));

vi.mock("@/lib/identite", () => ({
  identite: vi.fn(async () => ({ nomClub: "Cercle d'escrime ancienne", nomCourt: "Cercle Organizer", partEffectifMin: 20 })),
}));

vi.mock("@/lib/notifications/salon", () => ({
  publierSurSalon: vi.fn(async (args: { embed: { fields?: Array<{ name: string; value: string }> } }) => {
    faux.salon.push(args);
    return true;
  }),
  publierSurTelegram: vi.fn(async () => false),
}));

const { alerterEffectifFaible } = await import("@/lib/notifications/seances");

/** 7 h à Paris, le 23 septembre 2026 : la séance du 25 est dans l'horizon des trois jours. */
const MATIN = new Date("2026-09-23T05:00:00Z");

const instructeur = (id: string) => ({
  user: { id, prenom: id, email: `${id}@club.test`, actif: true, rappelEmail: true, preferencesNotifications: null, service: false },
});

/** Les invités d'un trimestre : `m1`, `m2`… — le même jeu de noms que les réponses. */
const membresDuTrimestre = (n: number) => Array.from({ length: n }, (_, i) => `m${i + 1}`);

/**
 * Une séance du 25 septembre dans un trimestre de `invites` personnes, avec les réponses données.
 * Un seul instructeur (`charlie`) : ce qui se juge ici est l'effectif, pas la liste des destinataires.
 */
function seancePour(invites: number, reponses: ReadonlyArray<{ userId: string; statut: string }>): Record<string, unknown> {
  return {
    id: "s1",
    date: "2026-09-25",
    heureDebut: "19:30",
    heureFin: "21:30",
    lieu: "Gymnase municipal",
    attendances: [...reponses],
    instructeurs: [instructeur("charlie")],
    period: { membres: membresDuTrimestre(invites).map((userId) => ({ userId })), instructeurs: [] },
  };
}

/** `n` réponses d'un statut donné, prises dans l'ordre des invités à partir du rang `depuis`. */
function reponsesDe(statut: string, n: number, depuis = 1): Array<{ userId: string; statut: string }> {
  return Array.from({ length: n }, (_, i) => ({ userId: `m${depuis + i}`, statut }));
}

/**
 * **Une séance vraiment creuse : 25 invités, un seul « Présent », aucun « peut-être ».**
 *
 * L'effectif invité est passé de 3 à 25, quand l'alerte a cessé de comparer les seuls `presents` au
 * seuil pour passer par `palierEffectif` — le même juge que les cartes, les fiches, la frise, le
 * tableau de bord et l'embed du récap. Ce n'est pas un ajustement pour faire passer un test : avec
 * 3 invités, la séance tombait dans la garde `indetermine` de `palierEffectif` (`invites <= seuil`,
 * ici 3 ≤ 4 à cause du plancher `SEUIL_PLANCHER`), c'est-à-dire dans le cas où **aucun écran
 * n'affiche de couleur** parce qu'aucun effectif n'atteindra jamais le seuil. La fixture éprouvait
 * donc un cours dont l'alerte ne doit précisément rien dire, et l'aurait laissée passer si le code
 * avait continué de juger sur les seuls confirmés.
 *
 * Avec 25 invités et 20 % réglés, le seuil vaut 5 (au-dessus du plancher de 4 : c'est bien la part
 * du club qui décide, pas la constante livrée), 25 > 5 donc l'échelle a un sens, et l'effectif
 * attendu vaut 1 — « en danger » sans ambiguïté. Ce que ces six tests éprouvent, c'est le **journal**
 * de l'alerte ; la fixture doit donc être un cas en danger que personne ne conteste.
 */
function seanceCreuse(id: string, instructeurs: string[]): Record<string, unknown> {
  return {
    id,
    date: "2026-09-25",
    heureDebut: "19:30",
    heureFin: "21:30",
    lieu: "Gymnase municipal",
    attendances: [{ userId: "m1", statut: "PRESENT" }],
    instructeurs: instructeurs.map(instructeur),
    period: { membres: membresDuTrimestre(25).map((userId) => ({ userId })), instructeurs: [] },
  };
}

beforeEach(() => {
  faux.seances = [seanceCreuse("s1", ["charlie", "chloe"])];
  faux.logs = [];
  faux.emails = [];
  faux.salon = [];
  faux.echecEmail = null;
  faux.canaux = { email: true, push: false, discord: false, telegram: false };
});

describe("alerte « peu de monde » : le journal et l'envoi", () => {
  it("écrit à toute l'équipe et journalise l'alerte une fois", async () => {
    expect(await alerterEffectifFaible(MATIN)).toBe(1);
    expect(faux.emails.map((e) => e.to).sort()).toEqual(["charlie@club.test", "chloe@club.test"]);
    expect(faux.logs).toHaveLength(1);
    expect(faux.logs[0]).toMatchObject({ type: "EFFECTIF", canal: "EMAIL", sessionId: "s1", dedupKey: "effectif_s1_2026-09-25-1930", statut: "ENVOYE" });
  });

  it("ne réalerte pas au passage suivant", async () => {
    await alerterEffectifFaible(MATIN);
    expect(await alerterEffectifFaible(MATIN)).toBe(0);
    expect(faux.emails).toHaveLength(2);
  });

  /**
   * Le cœur du correctif : la clé est posée **avant** l'envoi, donc un passage concurrent qui l'a
   * déjà prise fait renoncer celui-ci — au lieu de réécrire à toute l'équipe puis de se heurter à la
   * contrainte d'unicité.
   */
  it("renonce sans rien envoyer si la clé vient d'être prise par un autre passage", async () => {
    faux.logs.push({ type: "EFFECTIF", canal: "EMAIL", sessionId: "s1", dedupKey: "effectif_s1_2026-09-25-1930", statut: "ENVOYE" });
    expect(await alerterEffectifFaible(MATIN)).toBe(0);
    expect(faux.emails).toHaveLength(0);
    expect(faux.logs).toHaveLength(1);
  });

  it("libère la clé quand l'envoi échoue, et réalerte au passage suivant", async () => {
    faux.echecEmail = new Error("SMTP : connexion refusée");
    await alerterEffectifFaible(MATIN);
    // La clé nominale est devenue une clé d'échec horodatée : plus rien ne bloque la prochaine
    // tentative, et la raison est écrite noir sur blanc.
    expect(faux.logs).toHaveLength(1);
    expect(faux.logs[0].statut).toBe("ECHEC");
    expect(String(faux.logs[0].dedupKey)).toMatch(/^effectif_s1_2026-09-25-1930_echec_\d+$/);
    expect(String(faux.logs[0].erreur)).toContain("SMTP");

    faux.echecEmail = null;
    faux.emails = [];
    expect(await alerterEffectifFaible(MATIN)).toBe(1);
    expect(faux.emails.map((e) => e.to).sort()).toEqual(["charlie@club.test", "chloe@club.test"]);
    expect(faux.logs.some((l) => l.dedupKey === "effectif_s1_2026-09-25-1930" && l.statut === "ENVOYE")).toBe(true);
  });

  it("ne libère la clé qu'une fois, même si les deux emails échouent", async () => {
    faux.echecEmail = new Error("SMTP : connexion refusée");
    await alerterEffectifFaible(MATIN);
    expect(faux.logs.filter((l) => String(l.dedupKey).includes("_echec_"))).toHaveLength(1);
  });

  it("ne consomme pas la clé quand personne n'a d'adresse (une adresse ajoutée demain vaudra alerte)", async () => {
    const sansAdresse = seanceCreuse("s1", []);
    (sansAdresse.instructeurs as Array<{ user: { email: string | null } }>).push({
      user: { id: "charlie", prenom: "Charlie", email: null, actif: true, rappelEmail: true, preferencesNotifications: null, service: false } as never,
    });
    faux.seances = [sansAdresse];
    expect(await alerterEffectifFaible(MATIN)).toBe(0);
    expect(faux.logs).toHaveLength(0);
  });
});

/**
 * **Les chiffres de l'alerte se dérivent de la liste des invités de la séance.**
 *
 * Quatrième endroit du dossier à avoir compté sans filtre, trouvé — les trois autres (carte de
 * séance, tableau de bord, page publique) l'avaient été la veille. `Attendance` pend à `User` et à
 * `Session`, jamais à `PeriodMember` : retirer quelqu'un du trimestre laisse ses réponses derrière
 * lui, et le compte de service du portail répond comme n'importe quel compte.
 *
 * Le club simulé ici invite 80 personnes, donc le seuil vaut 16 (20 % arrondi au supérieur). Quinze
 * présents et deux réponses héritées en faisaient 17 : l'alerte ne partait pas, alors que tous les
 * écrans du club affichaient « Peu de monde » sur le même cours.
 */
describe("alerte « peu de monde » : les chiffres viennent de la liste des invités", () => {
  const presentsDe = (ids: readonly string[]) => ids.map((userId) => ({ userId, statut: "PRESENT" }));

  /** Un grand club (80 invités, seuil 16) dont les réponses se règlent test par test. */
  const seanceGrandClub = (reponses: ReadonlyArray<{ userId: string; statut: string }>) => seancePour(80, reponses);

  /** Les champs de l'embed publié sur le salon, par leur intitulé. */
  const champsPublies = () => Object.fromEntries((faux.salon[0]?.embed.fields ?? []).map((f) => [f.name, f.value]));

  beforeEach(() => {
    faux.canaux = { email: true, push: false, discord: true, telegram: false };
  });

  it("ne compte pas comme présents ceux qui ne sont plus membres du trimestre", async () => {
    faux.seances = [
      seanceGrandClub([
        ...presentsDe(membresDuTrimestre(15)),
        // Partis du trimestre en cours de route (`retirerMembrePeriode`) : leurs « Présent » sont restés.
        ...presentsDe(["ancienne", "ancien"]),
        // Et le compte de connexion du portail, que la requête écarte déjà du dénominateur.
        ...presentsDe(["portail"]),
      ]),
    ];
    expect(await alerterEffectifFaible(MATIN)).toBe(1);
    expect(champsPublies()["Réponses"]).toBe("✅ 15 présents / 80 — 19 %");
  });

  it("compte les sans-réponse sur les invités, jamais sur le nombre de lignes de présence", async () => {
    faux.seances = [
      seanceGrandClub([
        ...presentsDe(membresDuTrimestre(12)),
        ...["m13", "m14", "m15"].map((userId) => ({ userId, statut: "ABSENT" })),
        // Deux réponses héritées : elles rongeaient le « sans réponse » de deux personnes, et
        // l'équipe croyait avoir relancé tout le monde.
        ...presentsDe(["ancienne", "ancien"]),
      ]),
    ];
    expect(await alerterEffectifFaible(MATIN)).toBe(1);
    expect(champsPublies()["Sans réponse"]).toBe("65");
  });
});

/**
 * **L'alerte juge exactement ce que les écrans jugent.**
 *
 * Deux docstrings s'affirmaient identiques et le code disait le contraire : l'alerte comparait les
 * seuls `presents` au seuil, là où `palierEffectif` (`src/lib/presences.ts`, lu par les cartes, les
 * fiches, la frise, le tableau de bord **et l'embed du récap** via `contenu.ts`) juge l'**effectif
 * attendu** — les confirmés plus la moitié des « peut-être ». `presences.ts` écrit noir sur blanc
 * pourquoi : « juger un cours sur les seuls confirmés ferait passer au rouge une séance de 3
 * confirmés et 6 indécis, qui n'est évidemment pas en danger ».
 *
 * Ce bloc est le filet de ce correctif. Chaque cas vérifie deux choses ensemble : ce que l'alerte
 * fait, et ce que les écrans affichent du **même** jeu de chiffres — c'est cet accord-là qui manquait,
 * pas un seuil.
 */
describe("alerte « peu de monde » : le même juge que les écrans", () => {
  beforeEach(() => {
    faux.canaux = { email: true, push: false, discord: true, telegram: false };
  });

  /** Le palier affiché par les écrans pour ces chiffres-là, avec la part du club simulé (20 %). */
  const motAffiche = (c: { presents: number; peutEtre: number; invites: number }) => PALIER_LABELS[palierEffectif(c, 20)];

  /**
   * **Le cas vécu.** Club de 80, part à 20 % → seuil 16, confort 24. Séance à J-2 : 14 PRESENT et
   * 20 PEUT-ÊTRE. Avant le correctif, l'alerte partait (14 < 16) : email aux instructeurs **avec le
   * lien d'annulation signé**, plus « ⚠️ Peu de monde annoncé » sur Discord et Telegram — pendant que
   * la même séance affichait « Bien rempli » sur la carte, la fiche, la frise, le tableau de bord, et
   * dans l'embed du récap posté **sur le même salon Discord**.
   */
  it("se tait sur 14 présents et 20 « peut-être » dans un club de 80, que les écrans disent « Bien rempli »", async () => {
    const chiffres = { presents: 14, peutEtre: 20, invites: 80 };
    // Le seuil et le confort se lisent, ils ne sont pas recopiés : 20 % de 80 font 16, le confort 24.
    expect(seuilEnPersonnes(20, 80)).toBe(16);
    expect(seuilConfort(16)).toBe(24);
    // Les seuls confirmés (14) sont bien sous le seuil : c'est exactement ce qui faisait partir
    // l'alerte. L'effectif attendu, lui, vaut 14 + 10 = 24 — le haut de l'échelle.
    expect(motAffiche(chiffres)).toBe("Bien rempli");

    faux.seances = [seancePour(80, [...reponsesDe("PRESENT", 14), ...reponsesDe("PEUT_ETRE", 20, 15)])];
    expect(await alerterEffectifFaible(MATIN)).toBe(0);
    // Rien, sur aucun canal : ni email (donc aucun lien d'annulation en circulation), ni salon.
    expect(faux.emails).toHaveLength(0);
    expect(faux.salon).toHaveLength(0);
    expect(faux.logs).toHaveLength(0);
  });

  /**
   * L'exemple de la docstring de `presences.ts`, à l'échelle où il a un sens : un club de 12 invités
   * (seuil 4, confort 7). Trois confirmés valent moins que le seuil, six indécis en font six
   * attendus — « Effectif juste », et il n'y a rien à annoncer.
   */
  it("se tait sur 3 confirmés et 6 indécis, l'exemple que `presences.ts` déclare non dangereux", async () => {
    const chiffres = { presents: 3, peutEtre: 6, invites: 12 };
    expect(seuilEnPersonnes(20, 12)).toBe(4);
    expect(motAffiche(chiffres)).toBe("Effectif juste");

    faux.seances = [seancePour(12, [...reponsesDe("PRESENT", 3), ...reponsesDe("PEUT_ETRE", 6, 4)])];
    expect(await alerterEffectifFaible(MATIN)).toBe(0);
    expect(faux.emails).toHaveLength(0);
    expect(faux.salon).toHaveLength(0);
  });

  /**
   * **La garde `indetermine`, et pourquoi elle vient avec le correctif.** `palierEffectif` rend
   * `indetermine` quand `invites <= seuil` : aucun effectif n'y atteindra le seuil, et **aucun écran
   * n'affiche de couleur**. L'alerte n'avait pas cette garde : un trimestre de 4 invités la
   * déclenchait à *chaque* cours tant que les 4 n'étaient pas tous confirmés, pour un club où il n'y
   * a rien à décider. Passer par `palierEffectif` donne les deux d'un coup.
   */
  it("ne dit rien d'un trimestre de 4 invités, où aucun écran n'affiche de couleur", async () => {
    const chiffres = { presents: 1, peutEtre: 0, invites: 4 };
    // 4 invités, seuil 4 (le plancher) : l'échelle ne veut rien dire, et le mot est absent.
    expect(palierEffectif(chiffres, 20)).toBe("indetermine");
    expect(motAffiche(chiffres)).toBeNull();

    faux.seances = [seancePour(4, reponsesDe("PRESENT", 1))];
    expect(await alerterEffectifFaible(MATIN)).toBe(0);
    expect(faux.emails).toHaveLength(0);
    expect(faux.logs).toHaveLength(0);
  });

  /**
   * **Un cours déplacé s'alerte de nouveau**.
   *
   * La clé ne portait que l'identifiant de la séance, et le dossier annonçait « une seule alerte par
   * séance ». Mais l'argument qui a mis l'empreinte du créneau dans les clés du récap et des rappels
   * valait mot pour mot ici : **une séance déplacée garde son identifiant**. Un cours alerté le 5 pour
   * le 8, que l'équipe décale au 22 plutôt que d'annuler, ne réalertait donc plus jamais — la clé était
   * prise. On ouvrait la salle pour trois personnes, la panne exacte que l'alerte existe pour éviter.
   *
   * L'empreinte ne porte **que** le créneau : corriger un thème ou un lieu ne réalerte pas.
   */
  it("réalerte après un déplacement de créneau : la clé n'est plus la même", async () => {
    faux.seances = [seancePour(12, reponsesDe("PRESENT", 1))];
    expect(await alerterEffectifFaible(MATIN)).toBe(1);
    const avant = faux.logs.map((l) => String(l.dedupKey)).sort();
    expect(avant.every((c) => c.includes("2026-09-25-1930"))).toBe(true);

    // La séance est **déplacée** : même identifiant, autre créneau. Les clés doivent toutes changer,
    // sinon celles déjà posées interdisent l'alerte du nouveau créneau — pour toujours.
    faux.logs = [];
    faux.emails = [];
    const deplacee = seancePour(12, reponsesDe("PRESENT", 1));
    deplacee.date = "2026-10-09";
    faux.seances = [deplacee];
    expect(await alerterEffectifFaible(new Date("2026-10-07T06:00:00Z"))).toBe(1);
    const apres = faux.logs.map((l) => String(l.dedupKey)).sort();
    expect(apres.every((c) => c.includes("2026-10-09-1930"))).toBe(true);
    // Aucune clé en commun : c'est la propriété qui rend l'alerte du nouveau créneau possible.
    expect(apres.filter((c) => avant.includes(c))).toEqual([]);
  });

  /**
   * **Le club de cinq ou six : l'écran se tait, l'alerte parle.** C'est la contre-épreuve qui
   * manquait, et son absence a coûté une régression.
   *
   * Ce jour-là, `palierEffectif` a gagné une seconde borne dégénérée : un groupe trop petit pour que
   * « bien » soit atteignable n'est plus noté, parce que la carte affichait « 6 présents / 6 — 100 % »
   * avec « Effectif juste » juste à côté. Correct pour une **étiquette**. Mais l'alerte et la tuile du
   * tableau de bord testaient `palierEffectif(...) === "danger"` — elles demandaient une **décision** —
   * et se sont donc éteintes définitivement pour ces clubs-là : un cours à un présent sur six ne
   * prévenait plus personne, jamais.
   *
   * Les fixtures de ce fichier utilisaient 80, 12 et 4 invités. Jamais 5 ni 6. La régression était donc
   * muette, et c'est une relecture adverse qui l'a trouvée, pas la suite. D'où ces deux tailles-ci,
   * explicitement : **une taille de club qu'aucun test ne visite est une taille où l'on peut casser
   * quelque chose sans le savoir.**
   */
  for (const invites of [5, 6]) {
    it(`alerte un club de ${invites} invités, alors que l'écran n'y affiche aucun mot`, async () => {
      const chiffres = { presents: 1, peutEtre: 0, invites };
      // L'écran se tait : l'échelle n'a pas de sens pour un groupe qui ne peut pas atteindre le confort.
      expect(palierEffectif(chiffres, 20)).toBe("indetermine");
      expect(motAffiche(chiffres)).toBeNull();
      // L'alerte, elle, juge sur le seuil : un présent sur six est sous les quatre du plancher.
      expect(sousLeSeuil(chiffres, 20)).toBe(true);

      faux.seances = [seancePour(invites, reponsesDe("PRESENT", 1))];
      expect(await alerterEffectifFaible(MATIN)).toBe(1);
      expect(faux.emails.length).toBeGreaterThan(0);
    });
  }

  /** Et le club de six au complet n'alerte pas : la décision se juge sur le seuil, pas sur le confort. */
  it("ne dit rien d'un club de 6 au complet, qui n'a aucun problème de remplissage", async () => {
    faux.seances = [seancePour(6, reponsesDe("PRESENT", 6))];
    expect(await alerterEffectifFaible(MATIN)).toBe(0);
    expect(faux.emails).toHaveLength(0);
  });

  /**
   * Le témoin, sans lequel les trois silences ci-dessus ne prouveraient rien : la même mécanique, sur
   * un cours que les écrans marquent « Peu de monde », alerte bel et bien. Aligner l'alerte sur les
   * écrans ne l'a pas éteinte — cinq « peut-être » ne suffisent pas à sauver 8 confirmés sur 80.
   */
  it("alerte encore sur un cours que les écrans marquent « Peu de monde »", async () => {
    const chiffres = { presents: 8, peutEtre: 5, invites: 80 };
    // 8 + round(5/2) = 11, sous le seuil de 16.
    expect(motAffiche(chiffres)).toBe("Peu de monde");

    faux.seances = [seancePour(80, [...reponsesDe("PRESENT", 8), ...reponsesDe("PEUT_ETRE", 5, 9)])];
    expect(await alerterEffectifFaible(MATIN)).toBe(1);
    expect(faux.emails.map((e) => e.to)).toEqual(["charlie@club.test"]);
    expect(faux.salon).toHaveLength(1);
  });

  /**
   * Et les « peut-être » comptent pour moitié, pas pour rien ni pour un : c'est la charnière du
   * correctif, et elle se vérifie sur le cours qui change d'avis d'une réponse à l'autre. Club de 80,
   * seuil 16 : 10 confirmés et 11 indécis font 16 attendus (le cours tient, silence), le même cours
   * avec un indécis de moins n'en fait plus que 15 (l'alerte part).
   */
  it("compte chaque « peut-être » pour une demi-personne, ni zéro ni une", async () => {
    expect(palierEffectif({ presents: 10, peutEtre: 11, invites: 80 }, 20)).toBe("juste");
    expect(palierEffectif({ presents: 10, peutEtre: 10, invites: 80 }, 20)).toBe("danger");

    faux.seances = [seancePour(80, [...reponsesDe("PRESENT", 10), ...reponsesDe("PEUT_ETRE", 11, 11)])];
    expect(await alerterEffectifFaible(MATIN)).toBe(0);

    faux.logs = [];
    faux.emails = [];
    faux.salon = [];
    faux.seances = [seancePour(80, [...reponsesDe("PRESENT", 10), ...reponsesDe("PEUT_ETRE", 10, 11)])];
    expect(await alerterEffectifFaible(MATIN)).toBe(1);
  });
});
