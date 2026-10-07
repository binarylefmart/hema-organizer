import { beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { brancherGardeFermeture, cleBrouillon, doitPrevenir, marquerEnAttente, oublierTout, reglagesEnAttente } from "@/components/planning/garde-fermeture";

/**
 * **La garde ne doit retenir la fermeture que s'il y a vraiment quelque chose à perdre.**
 *
 * C'est toute la difficulté d'un `beforeunload` : posée à chaque fermeture, la question devient un
 * réflexe (« Quitter », sans lire) et ne sert plus le jour où elle compte. Ces cas vérifient donc
 * autant ce que la garde retient que ce qu'elle **laisse passer**.
 *
 * Le registre est un module partagé par toutes les cases de la grille : on le remet à zéro entre
 * chaque cas, comme le ferait un planning que l'on quitte.
 *
 * **La clé est l'identifiant de la partie**, depuis que les parties sont libres par séance : c'est
 * la partie que l'on règle, et deux séances n'en partagent plus aucune. Une clé « séance + rang »
 * n'aurait d'ailleurs plus de sens — le rang change dès qu'on monte une partie d'un cran.
 */
beforeEach(() => oublierTout());

describe("registre des réglages pas encore écrits", () => {
  it("ne retient rien quand tout est enregistré", () => {
    expect(doitPrevenir()).toBe(false);
    expect(reglagesEnAttente()).toBe(0);
  });

  it("retient la fermeture dès qu'une case attend son écriture", () => {
    marquerEnAttente("partie-1a", true);
    expect(doitPrevenir()).toBe(true);
  });

  it("relâche la fermeture quand la case revient au repos", () => {
    marquerEnAttente("partie-1a", true);
    marquerEnAttente("partie-1a", false);
    expect(doitPrevenir()).toBe(false);
  });

  it("compte les cases, pas les réglages : une case qui se règle trois fois ne pèse qu'une fois", () => {
    marquerEnAttente("partie-1b", true);
    marquerEnAttente("partie-1b", true);
    marquerEnAttente("partie-1b", true);
    expect(reglagesEnAttente()).toBe(1);
  });

  it("compte la partie, pas son affichage : la même partie vue sur deux écrans ne pèse qu'une fois", () => {
    // Le planning et l'écran de la séance montrent la même partie ; si elle s'y comptait deux fois,
    // le démontage de l'un relâcherait la garde alors que l'autre attend toujours son écriture.
    marquerEnAttente("partie-1b", true);
    marquerEnAttente("partie-1b", true);
    marquerEnAttente("partie-1b", false);
    expect(doitPrevenir()).toBe(false);
  });

  it("attend que TOUTES les cases soient écrites avant de laisser partir", () => {
    marquerEnAttente("partie-1b", true);
    marquerEnAttente("partie-2a", true);
    marquerEnAttente("partie-1b", false);
    // Une seule case enregistrée ne suffit pas : l'autre ferait toujours perdre son réglage.
    expect(doitPrevenir()).toBe(true);
    marquerEnAttente("partie-2a", false);
    expect(doitPrevenir()).toBe(false);
  });

  it("oublie une case qui disparaît de l'écran, même en attente", () => {
    marquerEnAttente("partie-1b", true);
    // C'est ce que fait le démontage de la case : ce qui n'est plus affiché n'a plus rien à perdre.
    marquerEnAttente("partie-1b", false);
    expect(doitPrevenir()).toBe(false);
  });
});

describe("branchement de la garde", () => {
  it("ne demande rien au navigateur quand il n'y en a pas (rendu serveur, tests)", () => {
    // `window` n'existe pas dans l'environnement « node » de vitest : le branchement doit être muet
    // et rendre malgré tout de quoi se débrancher, sinon chaque case ferait tomber le rendu serveur.
    const debrancher = brancherGardeFermeture();
    expect(typeof debrancher).toBe("function");
    expect(() => debrancher()).not.toThrow();
  });

  it("supporte d'être débranché deux fois (React monte et démonte deux fois en mode strict)", () => {
    const debrancher = brancherGardeFermeture();
    debrancher();
    expect(() => debrancher()).not.toThrow();
  });
});

/**
 * **Un réglage du brouillon survit à sa case, et la garde avec lui.**
 *
 * Sur téléphone, seule la ligne dépliée monte sa `CaseEditeur` : régler puis « Fermer » la démonte,
 * le volet de la sélection multiple règle des lignes qui ne l'ont jamais été, et sur ordinateur
 * replier le trimestre démonte les cartes. La case relâchait au démontage la clé de sa partie, la
 * même que celle du brouillon, et retirait l'écouteur : fermer l'onglet perdait le brouillon sans une
 * question.
 */
describe("la garde du brouillon ne dépend pas des cases montées", () => {
  it("une case qui se démonte ne relâche pas le réglage que le brouillon garde pour elle", () => {
    marquerEnAttente(cleBrouillon("partie-1a"), true);
    // Le démontage de la case : elle relâche sa propre clé, celle de ses envois en vol.
    marquerEnAttente("partie-1a", false);
    expect(doitPrevenir()).toBe(true);
    // C'est le brouillon qui la rend, quand la case revient à la valeur du serveur ou à l'application.
    marquerEnAttente(cleBrouillon("partie-1a"), false);
    expect(doitPrevenir()).toBe(false);
  });

  it("la clé du brouillon et celle des envois en vol ne se confondent pas", () => {
    expect(cleBrouillon("partie-1a")).not.toBe("partie-1a");
  });

  it("c'est le fournisseur du brouillon qui branche l'écouteur, tant qu'il n'est pas vide", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/components/planning/ContexteBrouillon.tsx"), "utf8");
    expect(source).toContain("brancherGardeFermeture()");
    expect(source).toMatch(/modifiees\.size > 0/);
    // Et il n'écrit jamais au registre sous la clé nue d'une partie, celle que la case relâche.
    expect(source).not.toMatch(/marquerEnAttente\((partieId|cle),/);
  });
});
