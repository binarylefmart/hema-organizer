import { describe, expect, it } from "vitest";
import {
  analyserCsvMembres,
  BIMESTRES,
  bimestreCourant,
  bimestreDe,
  bimestresChoix,
  cheminNouvellePeriode,
  datesBimestre,
  datesTrimestre,
  estBimestre,
  estDecalageBimestre,
  estTrimestre,
  genererSeances,
  libelleSaison,
  saisonCourante,
  saisonDe,
  saisonsProposees,
  periodeAttendueApres,
  TRIMESTRES,
  trimestreCourant,
} from "@/lib/periodes";
import { addDays } from "@/lib/dates";

const CRENEAUX = [
  { jourSemaine: 2, heureDebut: "20:00", heureFin: "22:00", lieu: "Villebourg", adresse: "" },
  { jourSemaine: 5, heureDebut: "19:00", heureFin: "21:00", lieu: "Villebourg", adresse: "" },
];

describe("génération des séances", () => {
  it("crée une séance par créneau et par semaine dans la période", () => {
    // Du lundi 5 au dimanche : 2 mardis + 2 vendredis
    const s = genererSeances("2026-10-05", "2026-10-18", CRENEAUX);
    expect(s.map((x) => `${x.date} ${x.heureDebut}`)).toEqual(["2026-10-06 20:00", "2026-10-09 19:00", "2026-10-13 20:00", "2026-10-16 19:00"]);
    expect(s[0].lieu).toBe("Villebourg");
    expect(s[1].heureFin).toBe("21:00");
  });
  it("respecte les exclusions et ne recrée pas les séances existantes", () => {
    const s = genererSeances("2026-10-05", "2026-10-18", CRENEAUX, ["2026-10-13"], ["2026-10-06 20:00"]);
    expect(s.map((x) => x.date)).toEqual(["2026-10-09", "2026-10-16"]);
  });
  it("gère deux créneaux le même jour et une période sans créneau", () => {
    const deux = [
      { jourSemaine: 6, heureDebut: "10:00", heureFin: "12:00", lieu: "A", adresse: "" },
      { jourSemaine: 6, heureDebut: "14:00", heureFin: "16:00", lieu: "B", adresse: "" },
    ];
    expect(genererSeances("2026-10-10", "2026-10-10", deux)).toHaveLength(2);
    expect(genererSeances("2026-10-05", "2026-10-18", [])).toEqual([]);
  });
});

describe("import CSV des membres", () => {
  /**
   * **Le séparateur est celui du fichier, pas celui de chaque ligne**. Ce test mêlait les deux dans
   * un même texte — point-virgule pour la première personne, virgule pour la seconde —, et figeait
   * ainsi le comportement qui laissait passer un membre nommé « Claire,Delta,c@d.fr » (voir
   * tests/unit/import-csv-separateur.test.ts). Un fichier, un séparateur ; les deux formes restent
   * acceptées, chacune de son côté.
   */
  it("ignore l'en-tête, met le rôle en majuscules et retire les guillemets", () => {
    const lignes = analyserCsvMembres(`prénom;nom;email;rôle\nChloé;Durand;chloe@ex.fr\n"David";"Lefèvre";"david@ex.fr";"instructeur"\n\n`);
    expect(lignes).toEqual([
      { prenom: "Chloé", nom: "Durand", email: "chloe@ex.fr", role: "MEMBRE", ligne: 2 },
      { prenom: "David", nom: "Lefèvre", email: "david@ex.fr", role: "INSTRUCTEUR", ligne: 3 },
    ]);
  });

  it("lit aussi bien un fichier à virgules, de la première ligne à la dernière", () => {
    const lignes = analyserCsvMembres(`prénom,nom,email,rôle\nChloé,Durand,chloe@ex.fr\n"David","Lefèvre","david@ex.fr","instructeur"\n\n`);
    expect(lignes).toEqual([
      { prenom: "Chloé", nom: "Durand", email: "chloe@ex.fr", role: "MEMBRE", ligne: 2 },
      { prenom: "David", nom: "Lefèvre", email: "david@ex.fr", role: "INSTRUCTEUR", ligne: 3 },
    ]);
  });
});

describe("découpage de la saison du club", () => {
  it("découpe la saison en trois trimestres et une période estivale", () => {
    expect(datesTrimestre(2026, 1)).toEqual({ nom: "T1 2026-2027", dateDebut: "2026-09-01", dateFin: "2026-12-31" });
    expect(datesTrimestre(2026, 2)).toEqual({ nom: "T2 2026-2027", dateDebut: "2027-01-01", dateFin: "2027-03-31" });
    expect(datesTrimestre(2026, 3)).toEqual({ nom: "T3 2026-2027", dateDebut: "2027-04-01", dateFin: "2027-06-30" });
    expect(datesTrimestre(2026, 4)).toEqual({ nom: "Été 2027", dateDebut: "2027-07-01", dateFin: "2027-08-31" });
  });
  it("enchaîne les quatre périodes sans trou ni recouvrement, du 1er septembre au 31 août", () => {
    const bornes = TRIMESTRES.map((t) => datesTrimestre(2026, t.n));
    expect(bornes[0].dateDebut).toBe("2026-09-01");
    expect(bornes.at(-1)!.dateFin).toBe("2027-08-31");
    for (let i = 1; i < bornes.length; i++) expect(addDays(bornes[i - 1].dateFin, 1)).toBe(bornes[i].dateDebut);
    // Aucune période ne porte une année civile seule : ce sont des trimestres de saison
    expect(bornes.map((b) => b.nom)).toEqual(["T1 2026-2027", "T2 2026-2027", "T3 2026-2027", "Été 2027"]);
  });
  it("désigne la saison par son année de départ", () => {
    expect(libelleSaison(2026)).toBe("2026-2027");
    expect(saisonsProposees("2026-09-22")).toEqual([2025, 2026, 2027]);
    expect(saisonsProposees("2026-06-30")).toEqual([2024, 2025, 2026]);
  });
  it("reconnaît les valeurs de trimestre valides", () => {
    expect([1, 2, 3, 4].every(estTrimestre)).toBe(true);
    expect([0, 5, Number.NaN].some(estTrimestre)).toBe(false);
    expect(TRIMESTRES.map((t) => t.n)).toEqual([1, 2, 3, 4]);
  });
  it("situe une date dans sa saison et son trimestre", () => {
    expect(saisonCourante("2026-09-01")).toBe(2026);
    expect(saisonCourante("2026-08-31")).toBe(2025);
    expect(saisonCourante("2027-06-30")).toBe(2026);
    expect(trimestreCourant("2026-10-15")).toBe(1);
    expect(trimestreCourant("2027-02-03")).toBe(2);
    expect(trimestreCourant("2027-05-20")).toBe(3);
    expect(trimestreCourant("2027-07-14")).toBe(4);
    expect(saisonDe("2026-10-01")).toBe("2026-2027");
    expect(saisonDe("2026-04-01")).toBe("2025-2026");
    expect(saisonDe("2026-09-01")).toBe("2026-2027");
  });
  it("place chaque jour de la saison dans le trimestre qui le contient", () => {
    for (let d = "2026-09-01"; d <= "2027-08-31"; d = addDays(d, 1)) {
      const t = datesTrimestre(saisonCourante(d), trimestreCourant(d));
      expect(d >= t.dateDebut && d <= t.dateFin).toBe(true);
    }
  });
});


/**
 * **Bimestres** : six cycles de deux mois par saison, à côté des trimestres. Ils suivent les mêmes
 * bornes que la saison sportive — le premier démarre.
 */
describe("découpage en bimestres", () => {
  it("donne six cycles de deux mois, nommés par leur année civile", () => {
    expect([...BIMESTRES]).toEqual([1, 2, 3, 4, 5, 6]);
    expect(bimestresChoix().map((b) => b.label)).toEqual([
      "Septembre – octobre",
      "Novembre – décembre",
      "Janvier – février",
      "Mars – avril",
      "Mai – juin",
      "Juillet – août",
    ]);
    expect(datesBimestre(2026, 1)).toEqual({ nom: "Sept.-oct. 2026", dateDebut: "2026-09-01", dateFin: "2026-10-31" });
    expect(datesBimestre(2026, 2)).toEqual({ nom: "Nov.-déc. 2026", dateDebut: "2026-11-01", dateFin: "2026-12-31" });
    expect(datesBimestre(2026, 4)).toEqual({ nom: "Mars-avr. 2027", dateDebut: "2027-03-01", dateFin: "2027-04-30" });
    expect(datesBimestre(2026, 6)).toEqual({ nom: "Juil.-août 2027", dateDebut: "2027-07-01", dateFin: "2027-08-31" });
  });

  it("finit février au bon jour, année bissextile comprise", () => {
    expect(datesBimestre(2026, 3).dateFin).toBe("2027-02-28");
    expect(datesBimestre(2027, 3).dateFin).toBe("2028-02-29");
  });

  it("place chaque jour de la saison dans le bimestre qui le contient", () => {
    for (let d = "2026-09-01"; d <= "2027-08-31"; d = addDays(d, 1)) {
      const { saison, bimestre } = bimestreCourant(d);
      expect(saison).toBe(saisonCourante(d));
      const b = datesBimestre(saison, bimestre);
      expect(d >= b.dateDebut && d <= b.dateFin).toBe(true);
    }
  });

  it("reconnaît les valeurs de bimestre valides", () => {
    expect([1, 2, 3, 4, 5, 6].every(estBimestre)).toBe(true);
    expect([0, 7, 1.5, Number.NaN].some(estBimestre)).toBe(false);
  });

  /*
   * **Le calage impair** : la même grille décalée d'un mois, pour un club dont la saison démarre en
   * octobre. Ce n'est pas un septième cycle — les six glissent ensemble, quitte à traverser
   * (décembre-janvier) et à mordre d'un mois sur la saison suivante (août-septembre, le dernier de
   * la grille).
   */
  it("décale toute la grille d'un mois en calage impair", () => {
    expect(datesBimestre(2026, 1, 1)).toEqual({ nom: "Oct.-nov. 2026", dateDebut: "2026-10-01", dateFin: "2026-11-30" });
    expect(datesBimestre(2026, 3, 1)).toEqual({ nom: "Févr.-mars 2027", dateDebut: "2027-02-01", dateFin: "2027-03-31" });
    expect(datesBimestre(2026, 6, 1)).toEqual({ nom: "Août-sept. 2027", dateDebut: "2027-08-01", dateFin: "2027-09-30" });
  });

  it("écrit les deux années quand le cycle les traverse", () => {
    expect(datesBimestre(2026, 2, 1)).toEqual({ nom: "Déc.-janv. 2026-2027", dateDebut: "2026-12-01", dateFin: "2027-01-31" });
    // Un cycle qui reste dans la même année civile n'en porte qu'une : « Janv.-févr. 2026-2027 » ferait hésiter
    expect(datesBimestre(2026, 3).nom).toBe("Janv.-févr. 2027");
  });

  it("nomme les six cycles décalés dans la liste déroulante", () => {
    expect(bimestresChoix(1).map((b) => b.label)).toEqual([
      "Octobre – novembre",
      "Décembre – janvier",
      "Février – mars",
      "Avril – mai",
      "Juin – juillet",
      "Août – septembre",
    ]);
  });

  it("place chaque jour de la grille décalée dans son cycle, saison comprise", () => {
    for (let d = "2026-10-01"; d <= "2027-09-30"; d = addDays(d, 1)) {
      const { saison, bimestre } = bimestreCourant(d, 1);
      expect(saison).toBe(2026);
      const b = datesBimestre(saison, bimestre, 1);
      expect(d >= b.dateDebut && d <= b.dateFin).toBe(true);
    }
  });

  it("reconnaît les valeurs de calage valides", () => {
    expect([0, 1].every(estDecalageBimestre)).toBe(true);
    expect([-1, 2, 0.5, Number.NaN].some(estDecalageBimestre)).toBe(false);
  });

  /** Une période enregistrée ne garde ni saison ni calage : on les relit dans son nom, puis ses dates. */
  it("retrouve le calage d'une période déjà créée", () => {
    expect(bimestreDe(datesBimestre(2026, 2, 1))).toEqual({ saison: 2026, bimestre: 2, decalage: 1 });
    expect(bimestreDe(datesBimestre(2026, 2))).toEqual({ saison: 2026, bimestre: 2, decalage: 0 });
    expect(bimestreDe({ nom: "Stage de Pâques", dateDebut: "2027-04-06", dateFin: "2027-04-10" })).toBeNull();
  });

  /** Le rappel de fin de période marche pour un club qui travaille en bimestres, pas seulement en trimestres. */
  it("réclame le bimestre suivant, et laisse une période libre sans suite", () => {
    const suite = periodeAttendueApres(datesBimestre(2026, 1));
    expect(suite?.nom).toBe("Nov.-déc. 2026");
    expect(suite?.bimestre).toBe(2);
    expect(cheminNouvellePeriode(suite!)).toBe("/admin/periodes/nouvelle?saison=2026&bimestre=2");
    // La suite se cherche dans la MÊME grille : après octobre-novembre vient décembre-janvier
    const decalee = periodeAttendueApres(datesBimestre(2026, 1, 1));
    expect(decalee?.nom).toBe("Déc.-janv. 2026-2027");
    expect(cheminNouvellePeriode(decalee!)).toBe("/admin/periodes/nouvelle?saison=2026&bimestre=2&decalage=1");
    // Un trimestre continue de réclamer un trimestre
    expect(periodeAttendueApres(datesTrimestre(2026, 1))?.nom).toBe("T2 2026-2027");
    expect(cheminNouvellePeriode(periodeAttendueApres(datesTrimestre(2026, 1))!)).toBe("/admin/periodes/nouvelle?saison=2026&trimestre=2");
    expect(periodeAttendueApres({ nom: "Stage de Pâques", dateDebut: "2027-04-06", dateFin: "2027-04-10" })).toBeNull();
  });
});
