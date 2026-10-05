import { describe, expect, it } from "vitest";
import {
  ciblesGeste,
  confirmationSeances,
  expliquerGesteSeances,
  gesteSeancesDefinitif,
  gestesSeancesApplicables,
  INVITE_SEANCES,
  libelleBoutonSeances,
  libelleToutesSeances,
  reglageManquant,
  seancesQuiChangent,
  texteSansCaseSeances,
  type LigneSeance,
} from "@/components/seances/selection-seances";
import { seanceAnnulable, seanceRetablissable } from "@/components/seances/gestes-seance";
import { selectionApresInterrupteur } from "@/components/ui/selection";
import { varianteGeste } from "@/components/ui/choix-geste";

/**
 * **La sélection multiple de l'onglet Séances** — les règles sans React : quels gestes un lot
 * propose, avec quels nombres, ce que la confirmation annonce, et quand le bouton reste inerte.
 */

const ligne = (id: string, x: Partial<LigneSeance> = {}): LigneSeance => ({
  id,
  jour: `jour ${id}`,
  heureDebut: "19:30",
  heureFin: "21:30",
  lieu: "Salle du Sud",
  adresse: "1 rue du Stade",
  annulee: false,
  commencee: false,
  reponses: 0,
  ...x,
});

const prevue = ligne("a", { reponses: 4 });
const annulee = ligne("b", { annulee: true, reponses: 2 });
const passee = ligne("c", { commencee: true, reponses: 9 });
const annuleePassee = ligne("d", { annulee: true, commencee: true });

describe("les gestes proposés à un lot de séances", () => {
  it("ne propose que ce qui toucherait au moins une séance, avec son nombre", () => {
    const g = gestesSeancesApplicables([prevue, annulee, passee], { supprimer: false });
    expect(g.map((x) => [x.geste, x.nombre])).toEqual([
      ["annuler", 1],
      ["retablir", 1],
      ["lieu", 3],
      ["horaire", 3],
    ]);
    expect(g[0].libelle).toBe("Annuler les séances (1 séance)");
    expect(g[2].libelle).toBe("Changer le lieu (3 séances)");
  });

  it("une séance commencée ne s'annule ni ne se rétablit — la règle de la carte, pas une copie", () => {
    expect(ciblesGeste("annuler", [passee, annuleePassee])).toEqual([]);
    expect(ciblesGeste("retablir", [passee, annuleePassee])).toEqual([]);
    for (const l of [prevue, annulee, passee, annuleePassee]) {
      expect(ciblesGeste("annuler", [l]).length === 1).toBe(seanceAnnulable({ annulee: l.annulee, passee: l.commencee }));
      expect(ciblesGeste("retablir", [l]).length === 1).toBe(seanceRetablissable({ annulee: l.annulee, passee: l.commencee }));
    }
    expect(gestesSeancesApplicables([passee], { supprimer: false }).map((g) => g.geste)).toEqual(["lieu", "horaire"]);
  });

  it("« Supprimer » n'existe que si l'appelant l'ouvre (bureau, session forte)", () => {
    expect(gestesSeancesApplicables([prevue], { supprimer: false }).map((g) => g.geste)).not.toContain("supprimer");
    expect(gestesSeancesApplicables([prevue], { supprimer: true }).map((g) => g.geste)).toContain("supprimer");
  });

  it("annuler et supprimer sont rouges ; les autres non", () => {
    for (const g of ["annuler", "supprimer"] as const) expect(varianteGeste(gesteSeancesDefinitif(g), libelleBoutonSeances(g, 2))).toBe("danger");
    for (const g of ["retablir", "lieu", "horaire"] as const) expect(varianteGeste(gesteSeancesDefinitif(g), libelleBoutonSeances(g, 2))).toBe("primaire");
  });

  it("le bouton dit le verbe et le nombre", () => {
    expect(libelleBoutonSeances("annuler", 1)).toBe("Annuler 1 séance");
    expect(libelleBoutonSeances("horaire", 3)).toBe("Changer l'horaire de 3 séances");
    expect(libelleBoutonSeances("supprimer", 2)).toBe("Supprimer 2 séances");
  });
});

describe("ce que l'annulation annonce avant de partir", () => {
  it("le nombre d'annonces, une par séance annulée — pas une par case cochée", () => {
    const lot = [prevue, ligne("e"), annulee];
    const texte = confirmationSeances("annuler", lot, { motif: "Salle inondée" });
    expect(texte).toContain("2 annonces d'annulation partiront");
    expect(texte).toContain("« Salle inondée »");
    const explication = expliquerGesteSeances("annuler", lot, { motif: "x" });
    expect(explication.titre).toContain("2 annonces d'annulation partiront");
    // Dire que l'annonce est voulue, et ce qui reste de côté.
    expect(explication.phrases.join(" ")).toContain("C'est le geste demandé");
    expect(explication.phrases.join(" ")).toContain("1 séance de la sélection reste de côté");
  });

  it("le motif est exigé avant que le bouton ne s'ouvre", () => {
    expect(reglageManquant("annuler", [prevue], { motif: "  " })).toBe(true);
    expect(reglageManquant("annuler", [prevue], { motif: "Salle prise" })).toBe(false);
  });
});

describe("lieu et horaire : seules les séances qui changent comptent", () => {
  it("une séance déjà au lieu visé reste dehors", () => {
    const lot = [prevue, ligne("f", { lieu: "Gymnase du Nord", adresse: "" })];
    expect(seancesQuiChangent("lieu", lot, { lieu: "Gymnase du Nord", adresse: "" }).map((l) => l.id)).toEqual(["a"]);
    expect(reglageManquant("lieu", [ligne("g", { lieu: "Gymnase du Nord", adresse: "" })], { lieu: "Gymnase du Nord", adresse: "" })).toBe(true);
    expect(reglageManquant("lieu", lot, { lieu: "" })).toBe(true);
  });

  it("un horaire à l'envers ou incomplet laisse le bouton inerte", () => {
    expect(reglageManquant("horaire", [prevue], { heureDebut: "20:00", heureFin: "19:00" })).toBe(true);
    expect(reglageManquant("horaire", [prevue], { heureDebut: "20:00", heureFin: "" })).toBe(true);
    expect(reglageManquant("horaire", [prevue], { heureDebut: "19:30", heureFin: "21:30" })).toBe(true);
    expect(reglageManquant("horaire", [prevue], { heureDebut: "20:00", heureFin: "22:00" })).toBe(false);
  });
});

describe("supprimer : le décompte des réponses perdues", () => {
  it("est dit dans l'explication et dans la confirmation", () => {
    const lot = [prevue, annulee, passee];
    expect(confirmationSeances("supprimer", lot)).toContain("15 réponses de membres");
    expect(expliquerGesteSeances("supprimer", lot).phrases[0]).toBe("15 réponses de membres seront effacées.");
  });
});

describe("les mots de la case maîtresse et de l'invite", () => {
  it("nomment les séances affichées, jamais « Tout »", () => {
    expect(libelleToutesSeances(5)).toBe("Sélectionner les 5 séances affichées");
    expect(libelleToutesSeances(1)).toBe("Sélectionner la séance affichée");
    expect(libelleToutesSeances(0)).toBe("Aucune séance à sélectionner");
    for (const n of [0, 1, 5]) expect(libelleToutesSeances(n)).not.toMatch(/\btout/i);
  });

  it("l'invite a la forme commune (`texteInviteMasse`)", () => {
    expect(INVITE_SEANCES).toBe("Coche des lignes pour agir sur plusieurs séances à la fois.");
  });

  it("les séances d'un trimestre clos sont comptées et la raison dite", () => {
    expect(texteSansCaseSeances(0)).toBeNull();
    expect(texteSansCaseSeances(2)).toContain("trimestre est clos");
  });
});

describe("l'interrupteur « Sélection multiple »", () => {
  it("l'éteindre vide le lot ; l'allumer ne coche rien", () => {
    const lot = new Set(["a", "b"]);
    expect([...selectionApresInterrupteur(lot, false)]).toEqual([]);
    expect(selectionApresInterrupteur(lot, true)).toBe(lot);
    expect([...selectionApresInterrupteur(new Set(), true)]).toEqual([]);
  });
});
