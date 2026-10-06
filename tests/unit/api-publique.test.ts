import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ANNONCES_EVENEMENTS_MAX,
  annoncesPubliques,
  CACHE_SECONDES,
  entetesPubliques,
  HORIZON_ANNONCES_JOURS,
  LIMITE_DEFAUT,
  LIMITE_MAX,
  limiteDemandee,
  reponseAnnonces,
  reponsePublique,
  TYPES_ANNONCE,
  typesAnnonceDeLaMatrice,
  versEvenementPublic,
  versSeancePublique,
} from "@/lib/api-publique";
import { TITRE_ANNULATION, TITRE_EVENEMENT, TITRE_RECAP } from "@/lib/notifications/contenu";
import { CANAUX_PAR_NOTIFICATION, RAISON_API_EXCLUE } from "@/lib/notifications/preferences";
import { RATE_LIMITS } from "@/lib/auth/rate-limit";
import { prochainesSeancesPubliques, type SeancePartagee } from "@/lib/partage";
import { compterPresences } from "@/lib/presences";

/**
 * **API publique** (`GET /api/public/prochaines-seances`), la source du site WordPress.
 *
 * Trois promesses sont vérifiées ici :
 * 1. **rien de nominatif ne sort** — ni dans les colonnes lues en base, ni dans le JSON rendu ;
 * 2. **aucun effectif en clair** : un taux, jamais « 13 présents sur 18 » (voir l'en-tête de
 *    `src/lib/api-publique.ts`) ;
 * 3. un paramètre `limit` mal écrit **ne vide pas la page d'accueil du club** : il retombe sur la
 *    valeur par défaut, et reste plafonné.
 *
 * La base n'est jamais touchée : `@/lib/db` est remplacé par un faux client qui journalise les
 * appels (même procédé que `partage.test.ts`).
 */

const { appels, reponses, fauxDb } = vi.hoisted(() => {
  const appels: Array<{ modele: string; operation: string; args: Record<string, unknown> }> = [];
  const reponses = new Map<string, unknown>();
  const parDefaut = (operation: string) => (operation === "findMany" || operation === "groupBy" ? [] : operation === "count" ? 0 : null);
  const fauxDb = new Proxy(
    {},
    {
      get(_cible, modele) {
        if (typeof modele !== "string") return undefined;
        return new Proxy(
          {},
          {
            get(_c2, operation) {
              if (typeof operation !== "string") return undefined;
              return async (args: Record<string, unknown> = {}) => {
                appels.push({ modele, operation, args });
                const prete = reponses.get(`${modele}.${operation}`);
                return prete === undefined ? parDefaut(operation) : prete;
              };
            },
          },
        );
      },
    },
  );
  return { appels, reponses, fauxDb };
});

vi.mock("@/lib/db", () => ({ db: fauxDb }));

const MAINTENANT = new Date("2026-09-23T12:00:00Z");

const SEANCE: SeancePartagee = {
  id: "s1",
  date: "2026-09-24",
  heureDebut: "19:30",
  heureFin: "21:30",
  lieu: "Villebourg",
  adresse: "Salle des fêtes, 00000 Villebourg",
  theme: "Messer",
  alternative: "Dague",
  disciplines: "Messer",
  annulee: false,
  motifAnnulation: null,
  compteurs: compterPresences([...Array(13).fill("PRESENT"), ...Array(3).fill("ABSENT")], 18),
  programme: [
    {
      ordre: 0,
      bloc: 1,
      nature: "COURS",
      nom: "Cours",
      libelle: "Partie 1 · Cours",
      theme: "Messer",
      description: "Garde haute, puis trois passes lentes en binôme.",
      niveau: "INDIFFERENT",
      atelier: false,
    },
  ],
  periode: { id: "p1", nom: "Rentrée 2026", statut: "ACTIVE" },
};

const ANNULEE: SeancePartagee = { ...SEANCE, annulee: true, motifAnnulation: "Salle indisponible" };

beforeEach(() => {
  appels.length = 0;
  reponses.clear();
});

/* ------------------------------------------------------------------ */
/* Paramètre limit                                                     */
/* ------------------------------------------------------------------ */

describe("paramètre limit", () => {
  it("lit un entier valide", () => {
    expect(limiteDemandee("3")).toBe(3);
    expect(limiteDemandee(" 4 ")).toBe(4);
    expect(limiteDemandee("1")).toBe(1);
  });

  it("retombe sur la valeur par défaut plutôt que de rendre une erreur", () => {
    for (const valeur of [null, undefined, "", "  ", "douze", "0", "-2", "2.5", "1e3", "NaN"]) {
      expect(limiteDemandee(valeur)).toBe(LIMITE_DEFAUT);
    }
  });

  it("plafonne : une API publique annonce les prochains cours, elle ne livre pas le planning entier", () => {
    expect(limiteDemandee("20")).toBe(LIMITE_MAX);
    expect(limiteDemandee("500")).toBe(LIMITE_MAX);
  });
});

/* ------------------------------------------------------------------ */
/* Mise en forme : ce qui sort, et surtout ce qui ne sort pas          */
/* ------------------------------------------------------------------ */

describe("séance publiée", () => {
  /**
   * **L'identifiant de la séance ne sort pas.** Cette API s'interdit l'effectif exact (elle ne
   * donne qu'un taux) — mais `/partage/seance/<id>` est une page ouverte qui, elle, affiche
   * « 13 présents / 18 ». Ces pages ne tiennent que parce que leur adresse ne se devine pas :
   * publier l'identifiant sur le site du club la distribuait à tout le monde.
   */
  it("ne publie aucun identifiant interne", () => {
    const publiee = versSeancePublique(SEANCE) as Record<string, unknown>;
    expect(publiee.id).toBeUndefined();
    expect(Object.keys(publiee)).not.toContain("periodeId");
    expect(JSON.stringify(publiee)).not.toContain("s1");
  });

  /**
   * **Ni celui des cases du programme.** Chaque case portait le `cuid` de sa ligne `SessionPartie`,
   * recopié tel quel dans cette réponse — non authentifiée, mise en cache cinq minutes, servie au
   * site du club. La même règle que pour la séance vaut ici : rien de ce que la base nomme ne sort.
   * Et la liste blanche de `versSeancePublique` fait qu'un champ ajouté demain à `CasePartage` ne
   * partira pas tout seul avec elle.
   */
  it("ne publie aucun identifiant de case du programme, même si la case en portait un", () => {
    // Une case telle qu'elle sortirait d'une base où l'on aurait laissé traîner l'identifiant
    const avecId = { ...SEANCE, programme: [{ ...SEANCE.programme[0], id: "cm2xk9f0000abcde" }] } as unknown as SeancePartagee;
    const publiee = versSeancePublique(avecId);
    expect(JSON.stringify(publiee)).not.toContain("cm2xk9f0000abcde");
    expect(Object.keys(publiee.programme[0])).toEqual(["ordre", "partie", "nature", "libelle", "estOption", "theme", "description", "niveau", "atelier"]);
  });

  /**
   * **Parties et éléments** : chaque ligne gagne `partie` (le numéro) et `nature`, et
   * **garde `estOption`** — la colonne a disparu de la base, mais un site qui la lisait (le plugin
   * `hema-prochains-cours`, ou une intégration du club) ne doit pas casser : elle vaut
   * `enParallele(nature)`, vrai pour une option ou un atelier.
   */
  it("publie la partie et la nature de chaque élément, et garde estOption pour les sites qui le lisent", () => {
    const programme = (["ECHAUFFEMENT", "COURS", "OPTION", "ATELIER"] as const).map((nature, ordre) => ({
      ...SEANCE.programme[0],
      ordre,
      bloc: 2,
      nature,
    }));
    const publiee = versSeancePublique({ ...SEANCE, programme });
    expect(publiee.programme.map((c) => [c.partie, c.nature, c.estOption])).toEqual([
      [2, "ECHAUFFEMENT", false],
      [2, "COURS", false],
      [2, "OPTION", true],
      [2, "ATELIER", true],
    ]);
    // Le nom court (« Cours ») est une affaire d'affichage des pages de partage : la liste blanche ne le recopie pas.
    expect(Object.keys(publiee.programme[0])).not.toContain("nom");
    expect(Object.keys(publiee.programme[0])).not.toContain("bloc");
  });

  /**
   * **La description d'une partie sort par cette porte**. C'est du texte sur le contenu du cours,
   * de la même nature que le thème — et la porte est fermée par défaut (`isPublicApiEnabled` exige
   * un `"1"` explicite), donc rien n'en sort tant que le club n'a pas coché la case. L'écran où
   * elle se saisit l'annonce (`CaseEditeur`), ce que la règle du dossier exige de tout champ
   * publié.
   *
   * Ce qui n'en sort **pas**, et que ce test garde aussi : **aucun nom**. Le code n'ajoute jamais un
   * encadrant à côté d'une description ; si quelqu'un écrit un prénom dans sa phrase, c'est son
   * choix, mais rien dans l'application ne l'y met.
   */
  it("publie la description de chaque partie — et n'y accroche **aucun nom**", () => {
    const publiee = versSeancePublique({
      ...SEANCE,
      programme: [{ ...SEANCE.programme[0], description: "Reprise après l'été : garde longue, garde de la fenêtre." }],
    });
    expect(publiee.programme[0].description).toBe("Reprise après l'été : garde longue, garde de la fenêtre.");
    // Le texte entier de la réponse : ni instructeur, ni second, ni animateur d'atelier, ni présent.
    expect(JSON.stringify(publiee)).not.toMatch(/instructeur/i);
    expect(Object.keys(publiee.programme[0])).not.toContain("instructeur");
    expect(Object.keys(publiee.programme[0])).not.toContain("instructeurSecond");
  });

  it("laisse une description vide telle quelle : c'est l'écran de lecture qui décide de la taire", () => {
    // La règle « un champ vide ne s'affiche pas du tout » vit dans `champsLus` et dans
    // `lignesProgramme`, pas ici : l'API rend une forme stable, avec tous ses champs, pour que le site
    // du club n'ait pas à deviner si la clé existe.
    const publiee = versSeancePublique({ ...SEANCE, programme: [{ ...SEANCE.programme[0], description: "" }] });
    expect(publiee.programme[0].description).toBe("");
  });

  it("rend une forme prête à afficher, valeurs brutes comprises", () => {
    expect(versSeancePublique(SEANCE)).toEqual({
      date: "2026-09-24",
      dateTexte: "Jeudi 24 septembre 2026",
      heureDebut: "19:30",
      heureFin: "21:30",
      horaire: "19h30 à 21h30",
      lieu: "Villebourg",
      adresse: "Salle des fêtes, 00000 Villebourg",
      theme: "Messer (ou Dague)",
      alternative: "Dague",
      programme: [
        {
          ordre: 0,
          partie: 1,
          nature: "COURS",
          libelle: "Partie 1 · Cours",
          estOption: false,
          theme: "Messer",
          description: "Garde haute, puis trois passes lentes en binôme.",
          niveau: "INDIFFERENT",
          atelier: false,
        },
      ],
      taux: 72,
      annulee: false,
      motif: "",
    });
  });

  it("publie un taux, jamais l'effectif : le nombre de présents ne sort pas du club", () => {
    const publiee = versSeancePublique(SEANCE);
    expect(publiee.taux).toBe(72);
    expect(Object.keys(publiee)).not.toContain("presents");
    expect(Object.keys(publiee)).not.toContain("invites");
    expect(Object.keys(publiee)).not.toContain("compteurs");
    // 13 et 18 ne doivent apparaître nulle part dans le JSON servi
    expect(JSON.stringify(publiee)).not.toMatch(/\b(13|18)\b/);
  });

  it("une séance annulée porte son motif et perd son taux, qui ne veut plus rien dire", () => {
    const publiee = versSeancePublique(ANNULEE);
    expect(publiee.annulee).toBe(true);
    expect(publiee.motif).toBe("Salle indisponible");
    expect(publiee.taux).toBe(0);
  });

  it("aucune clé nominative dans la réponse complète", () => {
    const reponse = reponsePublique("Cercle d'escrime ancienne", [SEANCE, ANNULEE], MAINTENANT);
    expect(reponse.club).toBe("Cercle d'escrime ancienne");
    expect(reponse.genereLe).toBe("2026-09-23T12:00:00.000Z");
    expect(reponse.seances).toHaveLength(2);
    const json = JSON.stringify(reponse);
    for (const interdit of ["prenom", "nom\"", "email", "userId", "instructeur", "animateur", "membre"]) {
      expect(json).not.toContain(interdit);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Lecture en base                                                     */
/* ------------------------------------------------------------------ */

describe("lecture des prochaines séances", () => {
  it("ne lit que des colonnes publiables, sur les périodes actives, à partir d'aujourd'hui", async () => {
    await prochainesSeancesPubliques(5, MAINTENANT);
    const requete = appels.find((a) => a.modele === "session" && a.operation === "findMany");
    expect(requete).toBeDefined();
    const args = requete!.args as { where: Record<string, unknown>; take: number; select: Record<string, unknown> };
    expect(args.take).toBe(5);
    expect(args.where).toEqual({ date: { gte: "2026-09-23" }, period: { statut: "ACTIVE" } });
    // Aucune ligne de présence n'est lue : le taux vient d'un total agrégé en base, sur les seuls
    // invités de la période (`chiffresPartage`) — il n'y a donc rien à anonymiser ensuite
    expect(args.select.attendances).toBeUndefined();
    const json = JSON.stringify(args.select);
    for (const interdit of ["user", "email", "prenom", "instructeurs", "animateur", "modifiePar"]) {
      expect(json).not.toContain(interdit);
    }
  });

  it("le dénominateur du taux exclut le compte de service, comme les écrans de l'application", async () => {
    reponses.set("session.findMany", [
      {
        ...SEANCE,
        periodId: SEANCE.periode.id,
        period: SEANCE.periode,
        parties: [],
      },
    ]);
    reponses.set("periodMember.count", 4);
    reponses.set("attendance.groupBy", [
      { sessionId: "s1", statut: "PRESENT", _count: { _all: 1 } },
      { sessionId: "s1", statut: "ABSENT", _count: { _all: 1 } },
    ]);
    const seances = await prochainesSeancesPubliques(5, MAINTENANT);
    const compte = appels.find((a) => a.modele === "periodMember" && a.operation === "count");
    expect(compte!.args).toEqual({ where: { periodId: "p1", user: { service: false } } });
    expect(versSeancePublique(seances[0]).taux).toBe(25);
  });
});

/* ------------------------------------------------------------------ */
/* En-têtes et garde de débit                                          */
/* ------------------------------------------------------------------ */

describe("en-têtes de la réponse", () => {
  it("CORS limité à l'origine configurée, cache de 5 minutes", () => {
    const entetes = entetesPubliques("https://club.test");
    expect(entetes["Access-Control-Allow-Origin"]).toBe("https://club.test");
    expect(entetes["Access-Control-Allow-Origin"]).not.toBe("*");
    expect(entetes.Vary).toBe("Origin");
    expect(entetes["Cache-Control"]).toBe(`public, max-age=${CACHE_SECONDES}, s-maxage=${CACHE_SECONDES}`);
    expect(CACHE_SECONDES).toBe(300);
  });

  it("une page publique n'a que le limiteur par IP à opposer à un robot", () => {
    expect(RATE_LIMITS.public_api_ip).toEqual({ max: 60, windowMs: 60 * 1000 });
  });
});

/* ------------------------------------------------------------------ */
/* Annonces (`GET /api/public/annonces`) — le canal « Site du club »   */
/* ------------------------------------------------------------------ */

/**
 * **Le canal qui n'envoie rien.** Demande de.
 *
 * Quatre promesses sont vérifiées ici, et chacune avec sa contre-épreuve :
 *
 * 1. **la matrice décide** — un type sans sa case ne produit **aucune** annonce, et l'inverse ;
 * 2. **la liste des types qui ont une case est celle de la matrice** : elle ne peut pas dériver ;
 * 3. **rien de nominatif, aucun identifiant interne** — même patron de liste blanche que les séances ;
 * 4. **un seul contenu pour tous les canaux** : les titres sont les constantes de `contenu.ts`, et
 *    les lignes toutes faites (qui portent l'effectif en clair) n'entrent volontairement pas ici.
 */

const MAINTENANT_ANNONCES = new Date("2026-09-23T12:00:00Z"); // aujourd'hui = 2026-09-23, demain = 2026-09-24

/** La séance de référence tombe justement demain : c'est elle que le récap de la veille annonce. */
const DEMAIN: SeancePartagee = SEANCE;
const ANNULEE_PROCHE: SeancePartagee = { ...ANNULEE, id: "s2", date: "2026-09-29" };
const ANNULEE_LOINTAINE: SeancePartagee = { ...ANNULEE, id: "s3", date: "2026-10-20" };

const EVENEMENT = {
  nom: "Stage d'épée longue",
  description: "Une journée sur les gardes du Fior di Battaglia.",
  dateDebut: "2026-10-17",
  dateFin: "2026-10-18",
  heureDebut: "10:00",
  heureFin: "17:30",
  lieu: "Salle des fêtes, Villebourg",
  adresse: "1 rue des Lices, 00000 Villebourg",
  organisateur: "Mon club d'AMHE",
  prix: "45 €",
  prixAdherent: "35 €",
  dureeNombre: 2,
  dureeUnite: "jour",
  lienInscription: "https://www.helloasso.com/",
};

const SOURCES = {
  seances: [DEMAIN, ANNULEE_PROCHE, ANNULEE_LOINTAINE],
  evenements: [EVENEMENT],
  now: MAINTENANT_ANNONCES,
};

describe("annonces : la matrice décide, notification par notification", () => {
  it("la liste des types qui ont une case est exactement la colonne « Site du club » de la matrice", () => {
    expect([...TYPES_ANNONCE]).toEqual(typesAnnonceDeLaMatrice());
    // Contre-épreuve : les types **sans** case ne s'y glissent pas. `effectif_faible` est le point à
    // ne pas rater — « peu de monde annoncé » est une alerte aux instructeurs, pas une publication.
    for (const exclu of ["effectif_faible", "rappel_sans_reponse", "atelier_statut", "periode_suivante", "periode_non_activee"] as const) {
      expect(CANAUX_PAR_NOTIFICATION[exclu], `${exclu} ne doit pas avoir de case « Site du club »`).not.toContain("api");
      expect([...TYPES_ANNONCE]).not.toContain(exclu);
      // Et la raison de l'absence est écrite, pour être affichée : un réglage absent sans explication
      // passe pour un oubli, et quelqu'un finit par l'« ajouter ».
      expect(RAISON_API_EXCLUE[exclu], `${exclu} : raison d'exclusion manquante`).toBeTruthy();
    }
  });

  it("ne publie rien tant qu'aucune case n'est cochée", () => {
    expect(annoncesPubliques({ ...SOURCES, types: [] })).toEqual([]);
  });

  it("publie les trois sortes quand les trois cases sont cochées, dans un ordre stable", () => {
    const annonces = annoncesPubliques({ ...SOURCES, types: [...TYPES_ANNONCE] });
    expect(annonces.map((a) => a.type)).toEqual(["recap_veille", "seance_annulee", "evenement_nouveau"]);
  });

  it("décocher une case retire ses annonces, et seulement les siennes", () => {
    const sansRecap = annoncesPubliques({ ...SOURCES, types: ["seance_annulee", "evenement_nouveau"] });
    expect(sansRecap.map((a) => a.type)).toEqual(["seance_annulee", "evenement_nouveau"]);
    const recapSeul = annoncesPubliques({ ...SOURCES, types: ["recap_veille"] });
    expect(recapSeul.map((a) => a.type)).toEqual(["recap_veille"]);
    const evenementSeul = annoncesPubliques({ ...SOURCES, types: ["evenement_nouveau"] });
    expect(evenementSeul.map((a) => a.type)).toEqual(["evenement_nouveau"]);
  });
});

describe("annonces : ce qui est courant, et rien d'autre", () => {
  it("le récap annonce le cours de demain — celui du cron du soir, pas un second calcul", () => {
    const annonces = annoncesPubliques({ ...SOURCES, types: ["recap_veille"] });
    expect(annonces).toHaveLength(1);
    expect(annonces[0].type === "recap_veille" && annonces[0].seance.date).toBe("2026-09-24");
    // Contre-épreuve : un cours d'après-demain n'est pas « le cours de demain ».
    const apresDemain = annoncesPubliques({ seances: [{ ...DEMAIN, date: "2026-09-25" }], evenements: [], types: ["recap_veille"], now: MAINTENANT_ANNONCES });
    expect(apresDemain).toEqual([]);
  });

  it("un cours de demain annulé n'est pas un récap : c'est une annulation", () => {
    const annule = { ...DEMAIN, annulee: true, motifAnnulation: "Salle indisponible" };
    expect(annoncesPubliques({ seances: [annule], evenements: [], types: ["recap_veille"], now: MAINTENANT_ANNONCES })).toEqual([]);
    const annonces = annoncesPubliques({ seances: [annule], evenements: [], types: ["seance_annulee"], now: MAINTENANT_ANNONCES });
    expect(annonces).toHaveLength(1);
    expect(annonces[0].type === "seance_annulee" && annonces[0].seance.motif).toBe("Salle indisponible");
  });

  it("une annulation s'annonce dans la quinzaine, pas au-delà", () => {
    const annonces = annoncesPubliques({ ...SOURCES, types: ["seance_annulee"] });
    expect(annonces).toHaveLength(1);
    expect(annonces[0].type === "seance_annulee" && annonces[0].seance.date).toBe(ANNULEE_PROCHE.date);
    // Contre-épreuve, des deux côtés de la fenêtre : le cours du 20 octobre est hors quinzaine, et un
    // cours **déjà passé** n'est plus une nouvelle.
    const hier = { ...ANNULEE, date: "2026-09-22" };
    expect(annoncesPubliques({ seances: [ANNULEE_LOINTAINE, hier], evenements: [], types: ["seance_annulee"], now: MAINTENANT_ANNONCES })).toEqual([]);
    expect(HORIZON_ANNONCES_JOURS).toBe(14);
  });

  it("n'annonce jamais plus d'événements que son plafond de lecture", () => {
    const beaucoup = Array.from({ length: ANNONCES_EVENEMENTS_MAX + 5 }, (_, i) => ({ ...EVENEMENT, nom: `Stage ${i}` }));
    const annonces = annoncesPubliques({ seances: [], evenements: beaucoup, types: ["evenement_nouveau"], now: MAINTENANT_ANNONCES });
    expect(annonces).toHaveLength(ANNONCES_EVENEMENTS_MAX);
  });
});

describe("annonces : un seul contenu pour tous les canaux", () => {
  it("reprend les titres des autres canaux, pictogramme séparé", () => {
    const annonces = annoncesPubliques({ ...SOURCES, types: [...TYPES_ANNONCE] });
    const attendus = { recap_veille: TITRE_RECAP, seance_annulee: TITRE_ANNULATION, evenement_nouveau: TITRE_EVENEMENT };
    for (const a of annonces) {
      // Le titre rendu, remis bout à bout, **est** la constante que portent l'email, l'embed Discord
      // et le message Telegram : un titre recopié à la main aurait dérivé au premier ajustement.
      expect(`${a.picto} ${a.titre}`).toBe(attendus[a.type]);
      expect(a.titre).not.toBe("");
    }
  });

  /**
   * **Les lignes toutes faites du contenu commun n'entrent pas ici, et c'est la seule exception à
   * « un seul contenu ».** `lignesSeance` porte « ✅ 13 présents / 18 — 72 % » : l'effectif en clair,
   * que la règle 2 de `src/lib/api-publique.ts` interdit à une page web indexable. On rend donc du
   * JSON construit depuis les **mêmes données** (le taux en est), et le site compose sa phrase.
   */
  it("publie le taux, jamais l'effectif — même dans une annonce", () => {
    const annonces = annoncesPubliques({ ...SOURCES, types: ["recap_veille"] });
    const corps = JSON.stringify(annonces);
    expect(annonces[0].type === "recap_veille" && annonces[0].seance.taux).toBe(72);
    expect(corps).not.toContain("13 présents");
    expect(corps).not.toContain("presents");
    expect(corps).not.toContain("invites");
  });

  it("garde la forme prête à afficher des séances : date en toutes lettres, horaire, thème avec alternative", () => {
    const annonces = annoncesPubliques({ ...SOURCES, types: ["recap_veille"] });
    expect(annonces[0].type === "recap_veille" && annonces[0].seance).toMatchObject({
      dateTexte: "Jeudi 24 septembre 2026",
      horaire: "19h30 à 21h30",
      theme: "Messer (ou Dague)",
    });
  });
});

describe("annonces : liste blanche d'un événement", () => {
  it("rend la forme prête à afficher, valeurs brutes comprises", () => {
    expect(versEvenementPublic(EVENEMENT)).toEqual({
      nom: "Stage d'épée longue",
      description: "Une journée sur les gardes du Fior di Battaglia.",
      dateDebut: "2026-10-17",
      dateFin: "2026-10-18",
      dateTexte: "Du samedi 17 octobre 2026 au dimanche 18 octobre 2026",
      heureDebut: "10:00",
      heureFin: "17:30",
      horaire: "10h00 à 17h30",
      duree: "2 jours",
      lieu: "Salle des fêtes, Villebourg",
      adresse: "1 rue des Lices, 00000 Villebourg",
      organisateur: "Mon club d'AMHE",
      prix: "45 €",
      prixAdherent: "35 €",
      lienInscription: "https://www.helloasso.com/",
    });
  });

  /**
   * Même règle que pour les séances : **ce qui n'est pas recopié ne sort pas**. On passe donc une
   * ligne de base complète — identifiant, auteur de la saisie, affiche, lien de travail — et on
   * vérifie qu'il n'en reste rien.
   */
  it("ne publie ni identifiant, ni auteur de la saisie, ni affiche, ni lien de travail", () => {
    const ligne = {
      ...EVENEMENT,
      id: "evt_cuid_interne",
      creeParId: "usr_03",
      publie: true,
      imageUrl: "/affiches/abcdef.png",
      lienSource: "https://club.test/brouillon",
    };
    const publie = versEvenementPublic(ligne) as Record<string, unknown>;
    for (const interdit of ["id", "creeParId", "publie", "imageUrl", "lienSource"]) {
      expect(Object.keys(publie), `« ${interdit} » ne sort pas du club`).not.toContain(interdit);
    }
    const corps = JSON.stringify(publie);
    for (const fuite of ["evt_cuid_interne", "usr_03", "abcdef.png", "brouillon"]) {
      expect(corps, `« ${fuite} » ne sort pas du club`).not.toContain(fuite);
    }
  });

  it("ne relaie qu'un lien http(s), et rend une chaîne vide plutôt qu'un null", () => {
    expect(versEvenementPublic({ ...EVENEMENT, lienInscription: "javascript:alert(1)" }).lienInscription).toBe("");
    expect(versEvenementPublic({ ...EVENEMENT, lienInscription: null }).lienInscription).toBe("");
    // Contre-épreuve : un vrai lien passe.
    expect(versEvenementPublic({ ...EVENEMENT, lienInscription: "http://exemple.fr/inscription" }).lienInscription).toBe("http://exemple.fr/inscription");
    // Tout ce qui peut manquer sort en chaîne vide : un site qui affiche « null » est mal servi.
    const nu = versEvenementPublic({ nom: "Démonstration", dateDebut: "2026-11-02" });
    expect(Object.values(nu).every((v) => typeof v === "string")).toBe(true);
    expect(nu).toMatchObject({ description: "", dateFin: "", heureDebut: "", horaire: "", duree: "", prix: "", lienInscription: "" });
  });
});

describe("annonces : aucun nom, nulle part", () => {
  it("ne laisse passer aucune clé nominative dans la réponse complète", () => {
    // Une séance venue de la base avec, en plus, ce que `partage.ts` ne sélectionne jamais : si un
    // jour quelqu'un l'ajoute à la lecture, la liste blanche doit continuer de tenir toute seule.
    const avecNoms = {
      ...DEMAIN,
      instructeurs: [{ prenom: "Camille", nom: "03" }],
      programme: [{ ...DEMAIN.programme[0], instructeurId: "u1", instructeurSecondId: "u2", animateur: "08" }],
    } as unknown as SeancePartagee;
    const reponse = reponseAnnonces(
      "Mon club d'AMHE",
      annoncesPubliques({ seances: [avecNoms], evenements: [EVENEMENT], types: [...TYPES_ANNONCE], now: MAINTENANT_ANNONCES }),
      MAINTENANT_ANNONCES,
    );
    const corps = JSON.stringify(reponse);
    for (const interdit of ["03", "08", "instructeur", "animateur", "userId", "u1", "u2"]) {
      expect(corps, `« ${interdit} » ne doit pas sortir du club`).not.toContain(interdit);
    }
    expect(reponse.genereLe).toBe(MAINTENANT_ANNONCES.toISOString());
    expect(reponse.club).toBe("Mon club d'AMHE");
  });
});
