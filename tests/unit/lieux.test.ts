import { describe, expect, it } from "vitest";
import { lieuConnu, lieuxEnTexte, nettoyerLieux } from "@/lib/lieux";

/**
 * Les lieux des cours sont passés d'une constante du code (avec les adresses postales du club) à un
 * réglage. `nettoyerLieux` est la seule règle de forme, à l'aller comme au retour : ces tests la
 * tiennent, sans base.
 */
describe("nettoyerLieux", () => {
  it("lit « Nom | Adresse », l'adresse étant facultative", () => {
    const l = nettoyerLieux("Salle des fêtes | 1 rue des Lices, 00000 Villebourg\nGymnase");
    expect(l).toHaveLength(2);
    expect(l[0]).toMatchObject({ lieu: "Salle des fêtes", adresse: "1 rue des Lices, 00000 Villebourg" });
    expect(l[1]).toMatchObject({ lieu: "Gymnase", adresse: "" });
  });

  it("ignore les lignes vides et les lignes sans nom", () => {
    expect(nettoyerLieux("\n  \n| juste une adresse\nSalle A\n")).toHaveLength(1);
  });

  it("ne garde qu'une entrée par nom, la première", () => {
    const l = nettoyerLieux("Salle A | ici\nsalle a | là-bas");
    expect(l).toHaveLength(1);
    expect(l[0].adresse).toBe("ici");
  });

  it("donne une clé stable, lisible, et jamais deux fois la même", () => {
    const l = nettoyerLieux("Gymnase municipal, Villebourg\nGymnase Municipal Villebourg !");
    expect(l[0].cle).toBe("gymnase-municipal-villebourg");
    // Deux noms différents qui se réduisent au même mot : le second est suffixé plutôt qu'écrasé.
    expect(l[1].cle).toBe("gymnase-municipal-villebourg-2");
  });

  it("les accents ne cassent pas la clé", () => {
    expect(nettoyerLieux("Villebourg — Salle des fêtes")[0].cle).toBe("villebourg-salle-des-fetes");
  });

  it("une adresse qui contient une barre verticale n'est pas coupée", () => {
    expect(nettoyerLieux("Salle | 3 rue A | bâtiment B")[0].adresse).toBe("3 rue A | bâtiment B");
  });

  it("borne le nombre de lieux et la longueur des champs", () => {
    const beaucoup = Array.from({ length: 50 }, (_, i) => `Salle ${i}`).join("\n");
    expect(nettoyerLieux(beaucoup)).toHaveLength(30);
    expect(nettoyerLieux(`${"x".repeat(300)} | ${"y".repeat(500)}`)[0].lieu).toHaveLength(120);
    expect(nettoyerLieux(`${"x".repeat(300)} | ${"y".repeat(500)}`)[0].adresse).toHaveLength(200);
  });

  it("le texte et la liste font l'aller-retour sans se déformer", () => {
    const texte = "Salle des fêtes | 1 rue des Lices\nGymnase";
    expect(lieuxEnTexte(nettoyerLieux(texte))).toBe(texte);
  });
});

describe("lieuConnu", () => {
  it("reconnaît un lieu de la liste, et rien d'autre", () => {
    const lieux = nettoyerLieux("Salle A | ici");
    expect(lieuConnu(lieux, "Salle A")?.adresse).toBe("ici");
    expect(lieuConnu(lieux, "Salle B")).toBeUndefined();
    // Liste vide : tout lieu est « autre », et rien ne doit lever.
    expect(lieuConnu([], "Salle A")).toBeUndefined();
  });
});
