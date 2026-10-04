import { describe, expect, it } from "vitest";
import {
  grouperParSaison,
  periodePertinente,
  rangDansSaison,
  saisonDePeriode,
  situationPeriode,
  suffixeStatut,
  SITUATION_LABELS,
  type PeriodeOption,
} from "@/components/filtres/saisons";
import {
  datesBimestre,
  datesTrimestre,
  lireSaison,
  SAISON_MAX,
  SAISON_MIN,
  saisonsChoix,
  type Bimestre,
  type DecalageBimestre,
  type Trimestre,
} from "@/lib/periodes";

/** Fabrique une période « trimestre du club » (T1, T2, T3 ou Été) d'une saison donnée. */
function trimestre(saison: number, n: Trimestre, statut = "ACTIVE"): PeriodeOption {
  const t = datesTrimestre(saison, n);
  return { id: `${saison}-T${n}`, nom: t.nom, statut, dateDebut: t.dateDebut, dateFin: t.dateFin };
}

/** Fabrique une période « bimestre » (cycle de deux mois) d'une saison donnée, dans l'un des deux calages. */
function bimestre(saison: number, n: Bimestre, statut = "ACTIVE", decalage: DecalageBimestre = 0): PeriodeOption {
  const b = datesBimestre(saison, n, decalage);
  return { id: `${saison}-B${n}-${decalage}`, nom: b.nom, statut, dateDebut: b.dateDebut, dateFin: b.dateFin };
}

const STAGE_2026: PeriodeOption = {
  id: "stage",
  nom: "Stage de la Toussaint",
  statut: "CLOSE",
  dateDebut: "2026-10-24",
  dateFin: "2026-11-02",
};

describe("saison d'une période", () => {
  it("rattache une date au 1er septembre → 31 août", () => {
    expect(saisonDePeriode({ dateDebut: "2026-09-01" })).toBe(2026);
    expect(saisonDePeriode({ dateDebut: "2027-08-31" })).toBe(2026);
    expect(saisonDePeriode({ dateDebut: "2027-09-01" })).toBe(2027);
  });
  it("reconnaît les trimestres du club et met les périodes personnalisées à part", () => {
    expect(rangDansSaison(trimestre(2026, 1))).toBe(1);
    expect(rangDansSaison(trimestre(2026, 2))).toBe(2);
    expect(rangDansSaison(trimestre(2026, 3))).toBe(3);
    expect(rangDansSaison(trimestre(2026, 4))).toBe(4);
    expect(rangDansSaison(STAGE_2026)).toBe(11);
  });

  /* Les bimestres se rangent entre les trimestres et les périodes libres. */
  it("range les bimestres après les trimestres, dans l'ordre de la saison", () => {
    expect(rangDansSaison(bimestre(2026, 1))).toBe(5);
    expect(rangDansSaison(bimestre(2026, 2))).toBe(6);
    expect(rangDansSaison(bimestre(2026, 5))).toBe(9);
    // Juillet-août, ce sont exactement les dates de la période estivale : c'est le même cycle,
    // il garde donc le rang du trimestre d'été plutôt que d'en faire un doublon à la fin.
    expect(rangDansSaison(bimestre(2026, 6))).toBe(4);
  });
  /* La grille décalée d'un mois (calage impair) se range au **rang de son cycle**, pas de son mois :
     octobre-novembre est le premier cycle de la saison, comme septembre-octobre l'est de l'autre. */
  it("range aussi les bimestres du calage impair", () => {
    expect(rangDansSaison(bimestre(2026, 1, "ACTIVE", 1))).toBe(5);
    expect(rangDansSaison(bimestre(2026, 2, "ACTIVE", 1))).toBe(6);
    // Août-septembre déborde sur la saison suivante, mais il commence en août : il reste rangé
    // dans la saison qui l'ouvre, et au rang de son cycle — le sixième.
    expect(rangDansSaison(bimestre(2026, 6, "ACTIVE", 1))).toBe(10);
    expect(saisonDePeriode(bimestre(2026, 6, "ACTIVE", 1))).toBe(2026);
  });
  it("classe une période aux dates d'un trimestre mais au nom libre comme ce trimestre", () => {
    const rentree = { ...trimestre(2026, 1), id: "rentree", nom: "Rentrée 2026" };
    expect(rangDansSaison(rentree)).toBe(1);
    expect(saisonDePeriode(rentree)).toBe(2026);
  });
});

describe("regroupement par saison", () => {
  const periodes = [
    trimestre(2027, 1, "BROUILLON"),
    STAGE_2026,
    trimestre(2026, 3),
    trimestre(2025, 2, "CLOSE"),
    trimestre(2026, 1, "CLOSE"),
    trimestre(2026, 4),
    trimestre(2026, 2),
  ];

  it("ne retient que les saisons réellement présentes, la plus récente en premier", () => {
    expect(grouperParSaison(periodes).map((s) => s.libelle)).toEqual(["2027-2028", "2026-2027", "2025-2026"]);
  });
  it("range les périodes T1 → T2 → T3 → Été → personnalisées", () => {
    const saison = grouperParSaison(periodes).find((s) => s.saison === 2026)!;
    expect(saison.periodes.map((p) => p.nom)).toEqual([
      "T1 2026-2027",
      "T2 2026-2027",
      "T3 2026-2027",
      "Été 2027",
      "Stage de la Toussaint",
    ]);
  });
  it("ne perd aucune période et gère la liste vide", () => {
    expect(grouperParSaison(periodes).flatMap((s) => s.periodes)).toHaveLength(periodes.length);
    expect(grouperParSaison([])).toEqual([]);
  });
});

describe("situation d'une période", () => {
  const aujourdHui = "2026-11-15"; // dans le T1 2026-2027
  it("distingue en cours, à venir et passée", () => {
    expect(situationPeriode(trimestre(2026, 1), aujourdHui)).toBe("en-cours");
    expect(situationPeriode(trimestre(2026, 2), aujourdHui)).toBe("a-venir");
    expect(situationPeriode(trimestre(2025, 3), aujourdHui)).toBe("passee");
  });
  it("compte les bornes dans la période", () => {
    expect(situationPeriode({ dateDebut: aujourdHui, dateFin: "2026-12-31" }, aujourdHui)).toBe("en-cours");
    expect(situationPeriode({ dateDebut: "2026-09-01", dateFin: aujourdHui }, aujourdHui)).toBe("en-cours");
  });
  it("donne les mêmes mots que les anciens groupes du sélecteur", () => {
    expect(SITUATION_LABELS["en-cours"]).toBe("En cours");
    expect(SITUATION_LABELS["a-venir"]).toBe("À venir");
    expect(SITUATION_LABELS.passee).toBe("Passée");
  });
  it("affiche les mentions brouillon et clôturée", () => {
    expect(suffixeStatut({ statut: "BROUILLON" })).toBe(" (brouillon)");
    expect(suffixeStatut({ statut: "CLOSE" })).toBe(" (clôturée)");
    expect(suffixeStatut({ statut: "ACTIVE" })).toBe("");
  });
});

describe("période ouverte au changement de saison", () => {
  const aujourdHui = "2026-11-15";
  const saison2026 = grouperParSaison([trimestre(2026, 1), trimestre(2026, 2), STAGE_2026]).find((s) => s.saison === 2026)!;

  it("ouvre la période en cours quand la saison en contient une", () => {
    expect(periodePertinente(saison2026.periodes, aujourdHui)!.nom).toBe("T1 2026-2027");
  });
  it("ouvre la première à venir pour une saison future", () => {
    const future = grouperParSaison([trimestre(2027, 3), trimestre(2027, 1), trimestre(2027, 2)])[0];
    expect(periodePertinente(future.periodes, aujourdHui)!.nom).toBe("T1 2027-2028");
  });
  it("ouvre la dernière période pour une saison écoulée", () => {
    const passee = grouperParSaison([trimestre(2025, 1), trimestre(2025, 3), trimestre(2025, 2)])[0];
    expect(periodePertinente(passee.periodes, aujourdHui)!.nom).toBe("T3 2025-2026");
  });
  it("renvoie rien pour une saison sans période", () => {
    expect(periodePertinente([], aujourdHui)).toBeUndefined();
  });
});

describe("saison saisie à la main (création d'une période)", () => {
  it("propose la saison précédente, celle en cours et les cinq suivantes", () => {
    expect(saisonsChoix("2026-09-22")).toEqual([2025, 2026, 2027, 2028, 2029, 2030, 2031]);
    expect(saisonsChoix("2026-06-30")).toEqual([2024, 2025, 2026, 2027, 2028, 2029, 2030]);
  });
  it("accepte n'importe quelle année de la plage, même lointaine", () => {
    expect(lireSaison("2029")).toBe(2029);
    expect(lireSaison(2029)).toBe(2029);
    expect(lireSaison(SAISON_MIN)).toBe(SAISON_MIN);
    expect(lireSaison(SAISON_MAX)).toBe(SAISON_MAX);
  });
  it("refuse proprement ce qui sort de la plage ou n'est pas une année", () => {
    expect(lireSaison(SAISON_MIN - 1)).toBeNull();
    expect(lireSaison(SAISON_MAX + 1)).toBeNull();
    expect(lireSaison("2029,5")).toBeNull();
    expect(lireSaison("2029.5")).toBeNull();
    expect(lireSaison("l'an prochain")).toBeNull();
    expect(lireSaison("")).toBeNull();
    expect(lireSaison(undefined)).toBeNull();
    expect(lireSaison(null)).toBeNull();
  });
  it("calcule les dates d'une saison lointaine", () => {
    expect(datesTrimestre(2029, 1)).toEqual({ nom: "T1 2029-2030", dateDebut: "2029-09-01", dateFin: "2029-12-31" });
    expect(datesTrimestre(2029, 2)).toEqual({ nom: "T2 2029-2030", dateDebut: "2030-01-01", dateFin: "2030-03-31" });
    expect(datesTrimestre(2029, 3)).toEqual({ nom: "T3 2029-2030", dateDebut: "2030-04-01", dateFin: "2030-06-30" });
    expect(datesTrimestre(2029, 4)).toEqual({ nom: "Été 2030", dateDebut: "2030-07-01", dateFin: "2030-08-31" });
  });
  it("range une période d'une saison lointaine dans sa propre saison", () => {
    const t1 = datesTrimestre(2029, 1);
    const groupes = grouperParSaison([
      { id: "loin", nom: t1.nom, statut: "BROUILLON", dateDebut: t1.dateDebut, dateFin: t1.dateFin },
      trimestre(2026, 1),
    ]);
    expect(groupes.map((g) => g.libelle)).toEqual(["2029-2030", "2026-2027"]);
    expect(rangDansSaison({ dateDebut: t1.dateDebut, dateFin: t1.dateFin })).toBe(1);
  });
});
