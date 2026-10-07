import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { transitionAutorisee } from "@/lib/ateliers";
import { gesteRouge } from "@/components/ui/choix-geste";
import { gesteAvecMot, gestesAtelier, ouvrirVolet, STATUT_VISE, type PropositionAtelier } from "@/app/(app)/gestion/ateliers/gestes-atelier";

/**
 * **« Que veux-tu faire ? » sur une proposition d'atelier** : seulement les gestes que le statut
 * permet (les mêmes transitions que le serveur), l'effacement au bureau seul et en dernier, rouge,
 * avec la confirmation que la carte posait déjà.
 */

const proposition = (statut: string, extra: Partial<PropositionAtelier> = {}): PropositionAtelier => ({
  titre: "Jeu du roi de la colline",
  prenom: "Golf",
  statut,
  seancePlacee: statut === "PLANIFIE" ? "Mar. 6 oct. à 20h00" : null,
  ...extra,
});
const encadrement = { effacer: false, seancesDisponibles: true };
const bureau = { effacer: true, seancesDisponibles: true };
const noms = (statut: string, d = encadrement) => gestesAtelier(proposition(statut), d).map((g) => g.geste);

describe("les gestes d'une proposition", () => {
  it("ne propose que ce que le statut permet, effacement au bureau seul et en dernier", () => {
    expect(noms("PROPOSE")).toEqual(["placer", "refuser"]);
    expect(noms("PLANIFIE")).toEqual(["retirer", "refuser"]);
    expect(noms("REFUSE")).toEqual(["remettre"]);
    expect(noms("PROPOSE", bureau)).toEqual(["placer", "refuser", "effacer"]);
    expect(noms("REFUSE", bureau)).toEqual(["remettre", "effacer"]);
  });

  it("chaque décision proposée est une transition que le serveur accepte", () => {
    for (const statut of ["PROPOSE", "PLANIFIE", "REFUSE"]) {
      for (const g of gestesAtelier(proposition(statut), bureau)) {
        if (g.geste === "effacer") continue;
        expect(transitionAutorisee(statut, STATUT_VISE[g.geste]), `${statut} → ${g.geste}`).toBe(true);
      }
    }
  });

  it("sans séance à venir, « Placer » n'est pas proposé", () => {
    expect(noms("PROPOSE", { effacer: false, seancesDisponibles: false })).toEqual(["refuser"]);
  });

  it("seul l'effacement est définitif, et il garde sa confirmation mot pour mot", () => {
    const gestes = gestesAtelier(proposition("PROPOSE"), bureau);
    expect(gestes.filter((g) => g.definitif).map((g) => g.geste)).toEqual(["effacer"]);
    // « Retirer du planning » est rouge aussi : comme tout ce qui retire quelque chose.
    expect(gestesAtelier(proposition("PLANIFIE"), bureau).filter((g) => g.definitif).map((g) => g.geste)).toEqual(["retirer", "effacer"]);
    for (const statut of ["PROPOSE", "PLANIFIE", "REFUSE"]) {
      for (const g of gestesAtelier(proposition(statut), bureau)) expect(Boolean(g.definitif), g.geste).toBe(gesteRouge(g.bouton));
    }
    const effacer = gestes.find((g) => g.geste === "effacer")!;
    expect(effacer.confirmation).toBe(
      "Effacer « Jeu du roi de la colline » ? La proposition de Golf disparaît et personne n'est prévenu — pour lui répondre non, utilise « Refuser ».",
    );
    expect(gestes.filter((g) => g.confirmation).map((g) => g.geste)).toEqual(["effacer"]);
  });

  it("l'explication dit qui est prévenu, et quand personne ne l'est", () => {
    const [placer, refuser] = gestesAtelier(proposition("PROPOSE"), encadrement);
    expect(placer.explication.phrases.join(" ")).toMatch(/Golf est prévenu par email/);
    expect(refuser.explication.phrases.join(" ")).toMatch(/Golf est prévenu par email/);
    const [retirer] = gestesAtelier(proposition("PLANIFIE"), encadrement);
    expect(retirer.explication.phrases.join(" ")).toMatch(/Aucun email ne part/);
    expect(retirer.explication.titre).toContain("Mar. 6 oct. à 20h00");
  });

  it("le mot facultatif n'accompagne que les gestes qui écrivent au membre", () => {
    expect(["placer", "refuser"].every((g) => gesteAvecMot(g as never))).toBe(true);
    expect(["retirer", "remettre", "effacer", ""].some((g) => gesteAvecMot(g as never))).toBe(false);
  });

  it("la carte passe par la forme commune, et l'effacement n'est plus un bouton à part", () => {
    const decision = readFileSync(path.join(process.cwd(), "src/app/(app)/gestion/ateliers/DecisionAtelier.tsx"), "utf8");
    expect(decision).toContain("<ChoixGeste");
    const page = readFileSync(path.join(process.cwd(), "src/app/(app)/gestion/ateliers/page.tsx"), "utf8");
    expect(page).not.toContain("BoutonAction");
    expect(page).toContain("effacerProposition.bind(null, a.id)");
  });
});

describe("le mot facultatif des volets du téléphone", () => {
  it("chaque volet s'ouvre sur un mot vide", () => {
    expect(ouvrirVolet("refuser")).toEqual({ panneau: "refuser", mot: "" });
    expect(ouvrirVolet("placer")).toEqual({ panneau: "placer", mot: "" });
  });
  it("la carte n'ouvre ses volets que par là : le mot d'un geste ne part pas avec l'autre", () => {
    const source = readFileSync(path.join(process.cwd(), "src/app/(app)/gestion/ateliers/DecisionAtelier.tsx"), "utf8");
    expect(source).not.toMatch(/setPanneau\("(placer|refuser)"\)/);
    expect(source).toContain('ouvrir("refuser")');
    expect(source).toContain('ouvrir("placer")');
  });
});
