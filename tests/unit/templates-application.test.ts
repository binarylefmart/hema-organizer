import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isoWeekday } from "@/lib/dates";
import { DATES_APPLICATION_MAX, planApplication } from "@/lib/templates";
import {
  ajouterDates,
  datesDuJour,
  jourParDefaut,
  joursProposes,
  lienAppliquer,
  lienPlanningPeriode,
  periodeParDefaut,
  premierJourOuvert,
  refusDate,
} from "@/app/(app)/admin/templates/appliquer/dates-application";
import { versSeanceExistante, type SeanceLue } from "@/app/(app)/admin/templates/appliquer/seances-application";

/**
 * **L'écran « Appliquer un template »** : le choix des dates (« tous les mardis », une date précise,
 * le plafond), la période ouverte d'emblée, et le fait que l'aperçu parte des mêmes faits que
 * l'action — sans quoi l'écran annoncerait ce que le serveur ne fait pas.
 */

const DOSSIER = path.join(process.cwd(), "src/app/(app)/admin/templates/appliquer");
const lire = (fichier: string) => fs.readFileSync(fichier, "utf8");

// Trimestre d'automne 2026 : du mardi 1er septembre au jeudi 17 décembre.
const T1 = { dateDebut: "2026-09-01", dateFin: "2026-12-17" };

describe("« Tous les [jour] de la période »", () => {
  it("donne chaque mardi, à partir d'aujourd'hui, jusqu'à la fin de la période", () => {
    const mardis = datesDuJour(T1, "2026-10-26", 2);
    expect(mardis[0]).toBe("2026-10-27");
    expect(mardis.at(-1)).toBe("2026-12-15");
    expect(mardis).toHaveLength(8);
    expect(mardis.every((d) => isoWeekday(d) === 2)).toBe(true);
  });

  it("compte aujourd'hui quand c'est le bon jour", () => {
    expect(datesDuJour(T1, "2026-10-27", 2)[0]).toBe("2026-10-27");
  });

  it("part du début de la période quand elle n'a pas commencé", () => {
    expect(datesDuJour(T1, "2026-06-01", 2)[0]).toBe("2026-09-01");
    expect(datesDuJour(T1, "2026-06-01", 4).at(-1)).toBe("2026-12-17");
  });

  it("ne rend rien pour une période terminée ou un jour impossible", () => {
    expect(datesDuJour(T1, "2027-01-05", 2)).toEqual([]);
    expect(premierJourOuvert(T1, "2027-01-05")).toBeNull();
    expect(datesDuJour(T1, "2026-10-26", 0)).toEqual([]);
    expect(datesDuJour(T1, "2026-10-26", 8)).toEqual([]);
  });

  it("traverse le passage à l'heure d'hiver sans glisser d'un jour", () => {
    // Dimanche 25 octobre 2026 : changement d'heure en Europe. Un calcul en heure locale y perdrait un jour.
    expect(datesDuJour({ dateDebut: "2026-10-20", dateFin: "2026-11-03" }, "2026-10-20", 2)).toEqual(["2026-10-20", "2026-10-27", "2026-11-03"]);
  });

  it("ne propose que les jours qui ont encore au moins une date", () => {
    // Il ne reste que jeudi 17 décembre et rien d'autre.
    expect(joursProposes(T1, "2026-12-17")).toEqual([{ jour: 4, nombre: 1 }]);
    expect(joursProposes(T1, "2026-10-26")).toHaveLength(7);
  });
});

describe("le jour proposé d'emblée", () => {
  const seance = (date: string, annulee = false) => ({ date, annulee });

  it("est celui où la période a le plus de séances à venir, non annulées", () => {
    const seances = [seance("2026-10-29"), seance("2026-11-05"), seance("2026-10-27"), seance("2026-11-03", true), seance("2026-11-10", true)];
    expect(jourParDefaut(T1, "2026-10-26", seances)).toBe(4);
  });

  it("ignore les séances passées", () => {
    const seances = [seance("2026-09-01"), seance("2026-09-08"), seance("2026-09-15"), seance("2026-10-30")];
    expect(jourParDefaut(T1, "2026-10-26", seances)).toBe(5);
  });

  it("sans séance, retombe sur le jour du premier jour ouvert", () => {
    expect(jourParDefaut(T1, "2026-10-26", [])).toBe(1);
    expect(jourParDefaut(T1, "2027-01-05", [])).toBeNull();
  });
});

describe("une date précise", () => {
  it("est refusée hors de la période, dans le passé, ou vide", () => {
    expect(refusDate("2027-01-05", T1, "2026-10-26")).toMatch(/pas dans la période/);
    expect(refusDate("2026-10-01", T1, "2026-10-26")).toMatch(/déjà passée/);
    expect(refusDate("", T1, "2026-10-26")).toMatch(/Choisis une date/);
    expect(refusDate("2026-10-26", T1, "2026-10-26")).toBeNull();
  });
});

describe("la sélection, sous le plafond", () => {
  it("fusionne sans doublon, dans l'ordre du calendrier, et compte ce qui était déjà là", () => {
    const r = ajouterDates(["2026-11-03"], ["2026-10-27", "2026-11-03", "2026-10-27"], DATES_APPLICATION_MAX);
    expect(r).toEqual({ dates: ["2026-10-27", "2026-11-03"], ajoutees: 1, deja: 1, refusees: 0 });
  });

  it("ne dépasse jamais le plafond du serveur, et dit combien restent dehors", () => {
    const toutes = Array.from({ length: 30 }, (_, i) => `2026-11-${String(i + 1).padStart(2, "0")}`);
    const r = ajouterDates(toutes.slice(0, 2), toutes, 10);
    expect(r.dates).toHaveLength(10);
    expect(r.ajoutees).toBe(8);
    expect(r.deja).toBe(2);
    expect(r.refusees).toBe(20);
    // On garde les premières du calendrier.
    expect(r.dates.at(-1)).toBe("2026-11-10");
  });
});

describe("la période ouverte d'emblée", () => {
  const p = (id: string, statut: string, dateDebut: string, dateFin: string) => ({ id, statut, dateDebut, dateFin });
  const brouillonLointain = p("b2", "BROUILLON", "2027-04-01", "2027-06-30");
  const brouillonProche = p("b1", "BROUILLON", "2027-01-04", "2027-03-31");
  const active = p("a", "ACTIVE", "2026-09-01", "2026-12-17");

  it("est celle que l'URL nomme, si elle est proposée", () => {
    expect(periodeParDefaut([active, brouillonProche], "2026-10-26", "b1")?.id).toBe("b1");
  });

  it("sinon la période active, même si l'URL nomme une période inconnue (close, effacée)", () => {
    expect(periodeParDefaut([brouillonProche, active, brouillonLointain], "2026-10-26", "close")?.id).toBe("a");
  });

  it("sans période active, la brouillon la plus proche d'aujourd'hui", () => {
    expect(periodeParDefaut([brouillonLointain, brouillonProche], "2026-10-26")?.id).toBe("b1");
    // Une brouillon qui contient aujourd'hui passe avant une à venir.
    const enCours = p("b0", "BROUILLON", "2026-10-01", "2026-10-31");
    expect(periodeParDefaut([brouillonProche, enCours], "2026-10-26")?.id).toBe("b0");
  });

  it("rien quand il n'y a rien à proposer", () => {
    expect(periodeParDefaut([], "2026-10-26")).toBeNull();
  });
});

describe("les liens de l'écran", () => {
  it("« Voir le planning » passe par `?periode=`, le paramètre que lit la page planning", () => {
    expect(lienPlanningPeriode("abc")).toBe("/planning?periode=abc");
    const planning = lire(path.join(process.cwd(), "src/app/(app)/planning/page.tsx"));
    expect(planning).toMatch(/searchParams: Promise<\{ periode\?: string/);
  });

  it("changer de période garde le template dans l'URL", () => {
    expect(lienAppliquer({ template: "t1", periode: "p2" })).toBe("/admin/templates/appliquer?template=t1&periode=p2");
    expect(lienAppliquer({})).toBe("/admin/templates/appliquer");
  });
});

describe("l'aperçu part des mêmes faits que l'action", () => {
  const vide = { instructeurId: null, instructeurSecondId: null, theme: "", description: "", niveau: "INDIFFERENT", atelierId: null };
  const seance = (id: string, date: string, parties: SeanceLue["parties"], annulee = false): SeanceLue => ({ id, date, heureDebut: "19:30", annulee, parties });
  const now = new Date("2026-10-27T17:00:00Z"); // mardi 27 octobre, 18 h à Paris

  it("dit vide un programme sans réglage ni atelier, et plein dès qu'une case porte quelque chose", () => {
    expect(versSeanceExistante(seance("s1", "2026-11-03", [vide, vide]), now).programmeVide).toBe(true);
    expect(versSeanceExistante(seance("s1", "2026-11-03", []), now).programmeVide).toBe(true);
    expect(versSeanceExistante(seance("s1", "2026-11-03", [vide, { ...vide, theme: "Messer" }]), now).programmeVide).toBe(false);
    expect(versSeanceExistante(seance("s1", "2026-11-03", [{ ...vide, instructeurId: "u1" }]), now).programmeVide).toBe(false);
    expect(versSeanceExistante(seance("s1", "2026-11-03", [{ ...vide, atelierId: "a1" }]), now).programmeVide).toBe(false);
    expect(versSeanceExistante(seance("s1", "2026-11-03", [{ ...vide, niveau: "AVANCE" }]), now).programmeVide).toBe(false);
    // Un thème fait d'espaces n'est pas un thème.
    expect(versSeanceExistante(seance("s1", "2026-11-03", [{ ...vide, theme: "   " }]), now).programmeVide).toBe(true);
  });

  it("dit commencée une séance dont l'heure de début est atteinte, dans le fuseau du club", () => {
    expect(versSeanceExistante(seance("s1", "2026-10-27", [vide]), now).commencee).toBe(false);
    expect(versSeanceExistante(seance("s1", "2026-10-27", [vide]), new Date("2026-10-27T18:30:00Z")).commencee).toBe(true);
  });

  it("donne un plan cohérent : créer, remplir, écarter", () => {
    const seances = [
      versSeanceExistante(seance("s1", "2026-11-03", [vide]), now),
      versSeanceExistante(seance("s2", "2026-11-10", [{ ...vide, theme: "Épée longue" }]), now),
      versSeanceExistante(seance("s3", "2026-11-17", [vide], true), now),
    ];
    const plan = planApplication({ dates: datesDuJour(T1, "2026-10-28", 2).slice(0, 4), aujourdHui: "2026-10-28", periode: T1, heureDebut: "19:30", seances });
    expect(plan.map((e) => e.action)).toEqual(["remplir", "ignorer", "ignorer", "creer"]);
  });

  /** **Une seule écriture de la règle** : l'action importe la fonction dont l'écran se sert. */
  it("fait lire les séances à l'action par la même fonction que l'écran", () => {
    const action = lire(path.join(process.cwd(), "src/actions/templates.ts"));
    expect(action).toContain("versSeanceExistante(s, now)");
    expect(action).toContain("select: SELECT_SEANCE_APPLICATION");
  });
});

describe("le composant client", () => {
  const source = lire(path.join(DOSSIER, "AppliquerTemplate.tsx"));
  const imports = [...source.matchAll(/^import [^;]*? from "([^"]+)";/gm)].map((m) => m[1]);

  it("n'importe rien qui touche la base (Prisma, node:crypto au build)", () => {
    for (const interdit of ["@/lib/db", "@/lib/planning", "./seances-application", "@prisma/client"]) expect(imports).not.toContain(interdit);
  });

  it("calcule l'aperçu avec la fonction du serveur, et affiche le plan retourné", () => {
    expect(imports).toContain("@/lib/templates");
    expect(source).toMatch(/planApplication\(/);
    expect(source).toMatch(/plan=\{resultat\.plan\}/);
  });

  it("n'utilise aucune liste native", () => {
    expect(source).not.toMatch(/<select/);
  });
});
