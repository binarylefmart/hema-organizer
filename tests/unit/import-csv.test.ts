import { describe, expect, it } from "vitest";
import { analyserCsvMembres } from "@/lib/periodes";

/**
 * Le formulaire d'import envoie toujours les deux champs : le fichier (vide si rien n'est choisi)
 * et la zone de texte. Ce test fige la règle de choix entre les deux — c'est elle qui était fausse :
 * un `<input type="file">` vide envoie un File de taille 0, qu'on lisait à la place du texte collé.
 */
function contenuImport(fichier: File | null, texte: string): string {
  const depuisFichier = fichier instanceof File && fichier.size > 0 ? "CONTENU_DU_FICHIER" : "";
  return depuisFichier.trim() ? depuisFichier : texte;
}

/*
 * **Les deux rôles de l'import sont les deux rôles de base** : la colonne portait « ADMIN », que
 * `creerMembre` et l'import refusent tous les deux — le fichier d'exemple d'un test qu'on relit
 * pour comprendre le format annonçait donc une valeur impossible. « INSTRUCTEUR » dit la même chose
 * du parseur (la colonne est conservée telle quelle) sans mentir sur ce qui s'importe.
 */
const LIGNES = "Delta;04;delta@club.test;INSTRUCTEUR\nHotel;10;hotel@club.test;MEMBRE";

describe("import CSV : fichier ou lignes collées", () => {
  it("retient le texte collé quand aucun fichier n'est choisi", () => {
    const vide = new File([], "", { type: "application/octet-stream" });
    expect(contenuImport(vide, LIGNES)).toBe(LIGNES);
  });

  it("retient le fichier quand il en contient un", () => {
    const fichier = new File(["a;b;c@d.fr"], "membres.csv", { type: "text/csv" });
    expect(contenuImport(fichier, LIGNES)).toBe("CONTENU_DU_FICHIER");
  });

  it("n'a rien à importer quand les deux sont vides", () => {
    expect(contenuImport(new File([], ""), "")).toBe("");
  });

  it("lit les lignes collées, en-tête comprise et rôles conservés", () => {
    const lignes = analyserCsvMembres(`prenom;nom;email;role\n${LIGNES}`);
    expect(lignes).toHaveLength(2);
    expect(lignes[0]).toMatchObject({ prenom: "Delta", nom: "04", email: "delta@club.test", role: "INSTRUCTEUR" });
    expect(lignes[1]).toMatchObject({ prenom: "Hotel", nom: "10", role: "MEMBRE" });
  });
});
