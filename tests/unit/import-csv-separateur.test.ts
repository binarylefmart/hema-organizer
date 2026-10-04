import { describe, expect, it } from "vitest";
import { analyserCsvMembres } from "@/lib/periodes";

/**
 * Deux pièges de l'analyse d'un CSV collé, tous deux **silencieux** — c'est ce qui les rend graves :
 * l'import annonce des lignes prêtes à créer, et ce sont les mauvaises.
 *
 * 1. **Le numéro de ligne** était celui des lignes **retenues**, pas celles du fichier : une ligne
 *    vide au milieu, et « erreur ligne 3 » désignait la 6e ligne du tableur. On cherche son erreur
 *    au mauvais endroit, on ne la trouve pas, et on finit par renoncer.
 * 2. **Le séparateur** était deviné ligne par ligne. En mode virgule, une seule ligne contenant un
 *    point-virgule (un nom composé, une adresse recopiée) basculait de séparateur pour elle seule
 *    et fondait ses trois colonnes en une : un membre nommé « Claire,Delta,c@d.fr » entrait dans
 *    l'annuaire sans la moindre erreur affichée.
 */

describe("numérotation des lignes", () => {
  it("numérote d'après le fichier, lignes vides comprises", () => {
    const lignes = analyserCsvMembres("Prénom;Nom;Email\n\nChloé;Durand;chloe@ex.fr\n\n\nDavid;Lefèvre;david@ex.fr");
    expect(lignes.map((l) => l.ligne)).toEqual([3, 6]);
    expect(lignes[1]).toMatchObject({ prenom: "David", nom: "Lefèvre" });
  });

  it("garde la numérotation d'origine quand le fichier commence par des lignes vides", () => {
    const lignes = analyserCsvMembres("\n\nChloé;Durand;chloe@ex.fr");
    expect(lignes).toHaveLength(1);
    expect(lignes[0].ligne).toBe(3);
  });
});

describe("séparateur : celui du fichier, deviné une seule fois", () => {
  it("ne bascule pas en point-virgule pour une seule ligne qui en contient un", () => {
    const lignes = analyserCsvMembres("Chloé,Durand,chloe@ex.fr\nClaire;Delta,claire@ex.fr,MEMBRE");
    expect(lignes).toHaveLength(2);
    // La seconde garde ses trois colonnes : le « ; » reste dans le prénom, il n'avale pas la ligne
    expect(lignes[1]).toMatchObject({ prenom: "Claire;Delta", nom: "claire@ex.fr", email: "MEMBRE" });
    expect(lignes[1].nom).not.toContain(",");
  });

  it("lit un fichier à point-virgule sans se laisser distraire par une virgule dans un champ", () => {
    const lignes = analyserCsvMembres("Prénom;Nom;Email\nChloé;Durand, épouse Roy;chloe@ex.fr");
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({ prenom: "Chloé", nom: "Durand, épouse Roy", email: "chloe@ex.fr" });
  });
});

describe("reconnaissance de l'en-tête", () => {
  it("reconnaît une en-tête qui ne commence pas par « Prénom »", () => {
    const lignes = analyserCsvMembres("Nom;Prénom;Email\nDurand;Chloé;chloe@ex.fr");
    // Sans cela, l'en-tête devenait un membre nommé « Nom Prénom », avec « Email » pour adresse
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({ prenom: "Durand", nom: "Chloé", ligne: 2 });
  });

  it("ne prend pas une première ligne de données pour une en-tête", () => {
    const lignes = analyserCsvMembres("Chloé;Durand;chloe@ex.fr\nDavid;Lefèvre;david@ex.fr");
    expect(lignes).toHaveLength(2);
    expect(lignes[0]).toMatchObject({ prenom: "Chloé", ligne: 1 });
  });

  it("ne cherche l'en-tête que sur la première ligne", () => {
    // Une personne dont le nom est un mot d'en-tête reste un membre : seule la première ligne
    // peut être une en-tête, et une seule.
    const lignes = analyserCsvMembres("Chloé;Durand;chloe@ex.fr\nRole;Nom;role@ex.fr");
    expect(lignes).toHaveLength(2);
  });
});
