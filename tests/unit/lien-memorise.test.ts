import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apercuLien, lireLienMemorise, memoriserLien, oublierLienMemorise } from "@/lib/lien-memorise";

/**
 * **Le lien gardé sur l'appareil, et le seul geste qui l'efface.**
 *
 * Une session dure 12 h. Sans cette mémoire, un membre sans mot de passe rouvrirait sa boîte mail
 * chaque matin — et dans l'application installée sur iPhone, qui n'a pas de barre d'adresse et ne
 * partage pas le stockage de Safari, ce champ est sa **seule** porte.
 *
 * Du 24/09, « Se déconnecter » effaçait la mémoire, au nom d'une distinction qui paraissait juste :
 * fermer l'application n'est pas s'en aller. À l'usage elle est fausse, et c'est Delta qui l'a
 * relevé sur son propre téléphone — on se déconnecte de son **propre** appareil cent fois pour une
 * fois qu'on rend celui d'un autre, et chacune de ces fois renvoyait chercher son email. Le geste
 * fort n'a pas disparu : il s'appelle **« Oublier »**, il est sur l'écran de connexion,
 * c'est-à-dire exactement là où la déconnexion dépose.
 *
 * Ces trois règles se défont d'une ligne, chacune sans qu'aucun test ne bronche si on ne les garde
 * pas ici.
 */

const RACINE = process.cwd();
const source = (p: string) => readFileSync(path.join(RACINE, p), "utf8");
const DECONNEXION = "src/app/(app)/profil/BoutonDeconnexion.tsx";
const FORMULAIRE = "src/app/(public)/connexion/FormulaireLienColle.tsx";
const PAGE_CONNEXION = "src/app/(public)/connexion/page.tsx";

describe("la mémoire du lien, sur l'appareil", () => {
  let magasin: Record<string, string>;

  beforeEach(() => {
    magasin = {};
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => magasin[k] ?? null,
        setItem: (k: string, v: string) => {
          magasin[k] = v;
        },
        removeItem: (k: string) => {
          delete magasin[k];
        },
      },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("garde un seul lien, et le rend tel quel", () => {
    expect(lireLienMemorise()).toBeNull();
    memoriserLien("  https://planning.exemple.fr/invitation/abcdef123456  ");
    expect(lireLienMemorise()).toBe("https://planning.exemple.fr/invitation/abcdef123456");
    memoriserLien("https://planning.exemple.fr/invitation/zzzzzz999999");
    expect(Object.keys(magasin)).toHaveLength(1);
  });

  it("l'oubli rend l'écran à son état neuf", () => {
    memoriserLien("https://planning.exemple.fr/invitation/abcdef123456");
    oublierLienMemorise();
    expect(lireLienMemorise()).toBeNull();
  });

  /**
   * En navigation privée, données de site bloquées, ou dans un aperçu, `localStorage` **lève** au
   * lieu de rendre `null`. L'écran doit continuer de marcher sans mémoire : il propose de coller.
   */
  it("ne casse rien quand le navigateur refuse son stockage", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("SecurityError");
        },
        setItem: () => {
          throw new Error("SecurityError");
        },
        removeItem: () => {
          throw new Error("SecurityError");
        },
      },
    });
    expect(() => memoriserLien("https://exemple.fr/invitation/x")).not.toThrow();
    expect(lireLienMemorise()).toBeNull();
    expect(() => oublierLienMemorise()).not.toThrow();
  });

  it("n'en montre que la fin : assez pour le reconnaître, pas pour le recopier", () => {
    const lien = "https://planning.exemple.fr/invitation/abcdef123456";
    expect(apercuLien(lien)).toBe("…ef123456");
    expect(apercuLien(lien)).not.toContain("planning.exemple.fr");
    expect(apercuLien("court")).toBe("court");
  });
});

describe("qui efface la mémoire, et qui ne l'efface pas", () => {
  it("« Se déconnecter » ne touche plus au lien gardé ici", () => {
    const code = source(DECONNEXION);
    // Le commentaire a le droit de **citer** le module — c'est même là qu'il explique pourquoi il
    // n'y touche plus. Ce qui est interdit, c'est de l'importer et de l'appeler.
    expect(code).not.toMatch(/^import[^;]*lien-memorise/m);
    expect(code).not.toContain("oublierLienMemorise(");
  });

  /**
   * **Et il se voit sans rien déplier**. Pendant quelques heures, la page de connexion enfermait
   * tout le bloc dans un `<details>` replié intitulé « J'ai reçu un lien par email » : rien ne
   * disait qu'une clé de quatre mois restait sur l'appareil, et « Oublier » dormait derrière un pli
   * — sur une tablette de club, qui n'a pas la boîte mail, les 12 h de session redevenaient
   * décoratives. Le repli appartient donc au composant, qui seul sait (`localStorage`) s'il y a une
   * clé : bloc **visible** quand il y en a une, pli quand il n'y en a pas.
   */
  it("le lien gardé se voit sans rien déplier, et le pli ne reste que pour le champ vide", () => {
    const page = source(PAGE_CONNEXION);
    // La page ne replie plus rien elle-même : elle n'a aucun moyen de savoir s'il y a une clé.
    expect(page).toContain("{!lienCopie && <FormulaireLienColle />}");
    // Plus aucun pli sur cet écran : un `<details>` sans `<summary>` n'existe pas.
    expect(page).not.toContain("<summary");

    const code = source(FORMULAIRE);
    expect(code).toContain("const avecLienGarde = charge && memorise && !modifie;");
    // Le cas « une clé est gardée » rend une `<section>` ; le `<details>` ne vient qu'après, pour le champ.
    const section = code.indexOf("if (avecLienGarde) {");
    const pli = code.indexOf('<details className='); // l'élément, pas sa mention dans un commentaire
    expect(section).toBeGreaterThan(0);
    expect(pli).toBeGreaterThan(section);
    // Et il le **dit** : une clé, sa durée, et le geste qui l'efface.
    const bloc = code.slice(section, pli);
    expect(bloc).toContain("<section");
    expect(bloc).toMatch(/gardé sur cet appareil/);
    expect(bloc).toMatch(/4 mois/);
  });

  /**
   * **Une seule clé est mémorisée par appareil** : c'est la dernière collée, pas forcément la sienne.
   * L'écran ne peut donc pas l'appeler « ton lien » — il ne le sait pas.
   */
  it("l'écran n'affirme pas à qui est le lien gardé", () => {
    const code = source(FORMULAIRE);
    expect(code).not.toMatch(/Ton lien\s*:/);
    expect(code).not.toContain("Me connecter avec mon lien");
    expect(code).toContain("Lien gardé :");
  });

  it("« Oublier » existe sur l'écran de connexion, là où la déconnexion dépose", () => {
    const code = source(FORMULAIRE);
    expect(code).toMatch(/onClick=\{oublier\}/);
    expect(code).toMatch(/>\s*Oublier\s*</);
    // Et il efface vraiment, au lieu de seulement rouvrir le champ.
    expect(code).toMatch(/const oublier = \(\) => \{[^}]*oublierLienMemorise\(\)/);
  });

  /**
   * L'autre effacement, lui, reste : un lien expiré, révoqué ou d'un trimestre clos laisserait un
   * bouton qui échoue à chaque appui, sans jamais dire pourquoi.
   */
  it("un lien refusé est toujours oublié de lui-même", () => {
    const code = source(FORMULAIRE);
    // Un lien **expiré renouvelé** (`succes`) ne vaut pas mieux qu'un lien refusé : celui qui
    // arrive par email le remplace, et le garder laisserait un bouton condamné à échouer.
    expect(code).toMatch(/if \(!\(state\.erreur \|\| state\.succes\) \|\| !memorise\) return;[\s\S]{0,160}oublierLienMemorise\(\)/);
  });
});
