import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LIBELLE_VIDE } from "@/lib/constants";
import { estEntreeVide } from "@/components/ui/liste-deroulante";
import { ENTREES_BUREAU, LIBELLE_BUREAU, texteConfirmationBureau, valeurBureau, VALEUR_BUREAU } from "@/app/(app)/admin/membres/bureau";

/**
 * **« Admin » est un supplément, et l'annuaire a un second menu déroulant pour le dire**.
 *
 * Ce fichier garde la partie **visible** de ce changement dans `/admin/membres` :
 *
 * - les **deux** entrées de la liste du bureau, et la place de l'écriture du vide ;
 * - la **confirmation**, parce que ce menu-ci n'enregistre pas au `change` : le geste donne ou retire
 *   tous les droits du club ;
 * - le **miroir de la valeur du serveur** (`vuDuServeur`), joué de bout en bout — c'est le défaut
 *   vécu sur le rôle, et il se rejoue à l'identique sur un booléen ;
 * - et le fait qu'aucune garde `role === "ADMIN"` ne subsiste dans ce dossier : elle ne lèverait plus
 *   jamais, et une garde muette refuse tout ou rien **sans rien dire**.
 */

const DOSSIER = "src/app/(app)/admin/membres";
const lire = (relatif: string) => readFileSync(path.join(process.cwd(), relatif), "utf8");

/* ------------------------------------------------------------------ */
/* 1. Les deux entrées, et rien de plus                                */
/* ------------------------------------------------------------------ */

describe("la liste déroulante du bureau", () => {
  it("ne propose que l'écriture du vide et « admin », dans cet ordre", () => {
    expect(ENTREES_BUREAU.map((e) => e.libelle)).toEqual([LIBELLE_VIDE, LIBELLE_BUREAU]);
    expect(ENTREES_BUREAU.map((e) => e.valeur)).toEqual(["", VALEUR_BUREAU]);
  });

  it("écrit le vide avec le libellé du dépôt, jamais à la main", () => {
    // `----------` est l'unique écriture du vide de tout le dépôt (`LIBELLE_VIDE`) : recopié à la
    // main, il finirait par avoir un tiret de plus ou de moins qu'ailleurs, sur le même écran.
    expect(lire(`${DOSSIER}/bureau.ts`)).toMatch(/LIBELLE_VIDE/);
    // Et elle se reconnaît à sa **valeur vide**, ce qui la fait épingler en tête d'une recherche par
    // `ListeDeroulante` : sans quoi on ne pourrait plus retirer le bureau après avoir tapé une lettre.
    expect(estEntreeVide(ENTREES_BUREAU[0])).toBe(true);
    expect(estEntreeVide(ENTREES_BUREAU[1])).toBe(false);
  });

  it("traduit l'état du serveur en valeur de liste, dans les deux sens", () => {
    expect(valeurBureau(true)).toBe(VALEUR_BUREAU);
    expect(valeurBureau(false)).toBe("");
  });
});

/* ------------------------------------------------------------------ */
/* 2. La confirmation : ce geste ne s'applique pas au `change`         */
/* ------------------------------------------------------------------ */

describe("ce que la confirmation annonce avant d'écrire", () => {
  it("nommer : dit ce qui s'ouvre, ce qui ne change pas, et le journal", () => {
    const texte = texteConfirmationBureau("Chloé Dupont", true);
    expect(texte).toContain("Chloé Dupont");
    expect(texte).toMatch(/Tous les droits du club/);
    // Le point du nouveau modèle : le rôle de base ne bouge pas, le bureau s'ajoute par-dessus.
    expect(texte).toMatch(/rôle de base ne change pas/);
    // Le rôle ouvre la porte, il ne dispense pas du second facteur.
    expect(texte).toMatch(/double authentification/);
    expect(texte).toMatch(/journal/);
  });

  it("retirer : dit que le compte reste, et que ce n'est pas une suppression", () => {
    const texte = texteConfirmationBureau("Chloé Dupont", false);
    expect(texte).toMatch(/Retirer les droits/);
    expect(texte).toMatch(/pas une suppression/);
    expect(texte).toMatch(/rôle de base/);
    expect(texte).toMatch(/journal/);
  });

  /**
   * **La liste choisit, le bouton écrit.** C'est la doctrine du dépôt pour tout ce qui porte à
   * conséquence (voir la liste déroulante du rôle **en masse** : « un rôle effleuré écrirait sur douze
   * personnes »). Ici c'est une personne, mais le geste donne ou retire tous les droits du club : une
   * molette sur un téléphone ne nomme pas un administrateur.
   */
  it("le composant n'appelle aucune action depuis `onChoisir`", () => {
    const code = lire(`${DOSSIER}/SelecteurBureau.tsx`);
    // `onChoisir` ne fait que poser l'état et effacer le message : rien ne part au serveur.
    const choisir = code.slice(code.indexOf("onChoisir={"), code.indexOf("className=\"min-h-12 flex-1 basis-32"));
    expect(choisir).not.toMatch(/nommerAdministrateur|retirerDroitsAdmin/);
    // L'écriture part du bouton, derrière `window.confirm`.
    expect(code).toMatch(/window\.confirm\(texteConfirmationBureau\(nom, versBureau\)\)/);
  });

  /**
   * **Le bouton est `type="button"`**, et ce n'est pas un détail de forme : sur la fiche d'un membre,
   * ce réglage est posé **à côté** du formulaire « Identité et rôle ». Un bouton sans type est un
   * bouton de soumission — il aurait enregistré la fiche au lieu de nommer l'administrateur, ou les
   * deux à la fois.
   */
  it("son bouton ne soumet pas le formulaire voisin", () => {
    expect(lire(`${DOSSIER}/SelecteurBureau.tsx`)).toMatch(/type="button"/);
  });
});

/* ------------------------------------------------------------------ */
/* 3. Les verrous : aucune action nouvelle, celles qui existaient      */
/* ------------------------------------------------------------------ */

/**
 * **Les verrous ne bougent pas d'un cran.** Nommer ou retirer un administrateur était déjà un geste
 * de l'écran « Comptes admin », derrière `admins.manage` + élévation. Le menu déroulant de l'annuaire
 * appelle **ces mêmes actions** (`nommerAdministrateur`, `retirerDroitsAdmin`) : il n'écrit rien
 * lui-même, et le dossier n'a pas d'action à lui pour `estAdmin`.
 *
 * `CLAUDE.md` : « deux chemins d'écriture aux règles différentes, c'est une porte dérobée d'un côté ou
 * une fonctionnalité morte de l'autre. »
 */
describe("les verrous du geste, et d'où ils viennent", () => {
  it("le sélecteur appelle les deux actions existantes, et pas une des siennes", () => {
    const code = lire(`${DOSSIER}/SelecteurBureau.tsx`);
    expect(code).toMatch(/import \{ nommerAdministrateur, retirerDroitsAdmin \} from "@\/actions\/membres"/);
  });

  it("aucune action du dossier n'écrit `estAdmin`", () => {
    // Les cinq gestes de masse de l'annuaire ne touchent que `role`, `actif`, ou effacent la ligne.
    // C'est à cette condition qu'un administrateur a retrouvé sa case à cocher.
    const code = lire(`${DOSSIER}/actions.ts`);
    expect(code).not.toMatch(/data: \{[^}]*estAdmin/);
  });

  it("les verrous des deux actions appelées sont bien ceux annoncés", () => {
    const code = lire("src/actions/membres.ts");
    for (const action of ["nommerAdministrateur", "retirerDroitsAdmin"]) {
      const debut = code.indexOf(`export async function ${action}(`);
      expect(debut, action).toBeGreaterThan(0);
      // Le corps de la fonction : jusqu'à la prochaine déclaration exportée.
      const suite = code.indexOf("\nexport ", debut + 1);
      const corps = code.slice(debut, suite === -1 ? undefined : suite);
      expect(corps, `${action} : la permission du bureau`).toMatch(/assertPermission\("admins\.manage"\)/);
      expect(corps, `${action} : un code 2FA récent`).toMatch(/exigerReauth/);
      expect(corps, `${action} : la frontière du bureau`).toMatch(/canEditUser/);
      expect(corps, `${action} : une entrée d'audit nominative`).toMatch(/audit\(acteur, "admin\.droits_/);
    }
    // Le compte du portail et « personne ne se retire son propre bureau » : le retrait porte les deux.
    const retrait = code.slice(code.indexOf("export async function retirerDroitsAdmin("));
    expect(retrait).toMatch(/estCompteDeService/);
    expect(retrait).toMatch(/acteur\.id === userId/);
  });
});

/* ------------------------------------------------------------------ */
/* 4. Le miroir de la valeur du serveur, joué de bout en bout          */
/* ------------------------------------------------------------------ */

/**
 * **Le défaut, rejoué sur un booléen.**
 *
 * Un `useState(props.valeur)` n'est semé qu'au montage, et la ligne de l'annuaire garde son identité
 * (`key={m.id}`) : rien ne la remonte. Qu'une nomination se fasse ailleurs — depuis « Comptes admin »,
 * depuis la fiche, ou par un autre membre du bureau pendant que l'écran est ouvert — et la liste
 * continuerait d'afficher l'état du chargement de la page.
 *
 * Le pire n'est pas l'affichage faux, c'est **le geste suivant** : convaincu que le changement n'a pas
 * pris, on le refait — et comme la liste montre l'ancien état, le choix « inverse » qu'on croit
 * appliquer **retire vraiment** le bureau qu'on venait de donner.
 *
 * `tests/unit/etat-seme-par-le-serveur.test.ts` balaie la **source** et exige le miroir ; ce scénario-ci
 * montre ce qu'il empêche. Les deux sont nécessaires : le balayage ne sait pas lire une conséquence.
 */

/** Le serveur, réduit à ce qui compte : qui est du bureau, et qui l'a écrit. */
class Serveur {
  ecritures: Array<{ userId: string; estAdmin: boolean }> = [];
  constructor(private bureau: Record<string, boolean>) {}
  estAdmin(userId: string): boolean {
    return this.bureau[userId];
  }
  /** `nommerAdministrateur` / `retirerDroitsAdmin` : un état déjà en place ne s'écrit pas. */
  definir(userId: string, estAdmin: boolean): void {
    if (this.bureau[userId] === estAdmin) return;
    this.bureau[userId] = estAdmin;
    this.ecritures.push({ userId, estAdmin });
  }
}

/** La liste du bureau telle que React la tient : un état semé au montage, piloté ensuite. */
class ListeBureau {
  /** Ce que le bureau lit dans la liste. */
  affiche: string;
  private miroir: string | null;
  constructor(
    private serveur: Serveur,
    private userId: string,
    private suitLeServeur: boolean,
  ) {
    this.affiche = valeurBureau(serveur.estAdmin(userId));
    this.miroir = suitLeServeur ? this.affiche : null;
  }
  /** Un rendu serveur arrive (l'action a invalidé le chemin de la page). */
  rendre(): void {
    if (!this.suitLeServeur) return; // l'état est semé une fois pour toutes
    const duServeur = valeurBureau(this.serveur.estAdmin(this.userId));
    if (this.miroir !== duServeur) {
      this.miroir = duServeur;
      this.affiche = duServeur;
    }
  }
  /** Un choix dans la liste : il ne part pas tout seul — c'est le bouton qui écrit. */
  choisir(valeur: string): void {
    this.affiche = valeur;
  }
  /** L'appui sur le bouton, inerte tant que la liste montre l'état du serveur. */
  appliquer(): void {
    const duServeur = valeurBureau(this.serveur.estAdmin(this.userId));
    if (this.affiche === duServeur) return;
    this.serveur.definir(this.userId, this.affiche === VALEUR_BUREAU);
  }
}

describe("après une nomination faite ailleurs, la liste du bureau", () => {
  it("semée une fois : elle ment, et le geste pour « forcer » retire le bureau qu'on venait de donner", () => {
    const serveur = new Serveur({ "u-chloe": false });
    const liste = new ListeBureau(serveur, "u-chloe", false);

    // Chloé est nommée depuis « Comptes admin ». La pastille de la ligne le dit (rendu serveur)…
    serveur.definir("u-chloe", true);
    liste.rendre();
    expect(serveur.estAdmin("u-chloe")).toBe(true);
    // … mais la liste déroulante affiche encore `----------`.
    expect(liste.affiche).toBe("");

    // « Ça n'a pas pris » : on choisit « admin ». Le bouton est inerte — la liste et le serveur
    // s'accordent déjà — et rien ne bouge, ce qui confirme le doute.
    serveur.ecritures = [];
    liste.choisir(VALEUR_BUREAU);
    liste.appliquer();
    expect(serveur.ecritures).toEqual([]);

    // Alors on bascule `----------` pour « forcer » — et ce clic-là retire vraiment le bureau.
    liste.choisir("");
    liste.appliquer();
    expect(serveur.estAdmin("u-chloe"), "le bureau qu'on venait de donner vient d'être retiré").toBe(false);
    expect(serveur.ecritures).toEqual([{ userId: "u-chloe", estAdmin: false }]);
  });

  it("avec le miroir : elle suit le serveur, et le geste de forçage n'a plus lieu d'être", () => {
    const serveur = new Serveur({ "u-chloe": false });
    const liste = new ListeBureau(serveur, "u-chloe", true);

    serveur.definir("u-chloe", true);
    liste.rendre();
    expect(liste.affiche).toBe(VALEUR_BUREAU);

    // Rien à forcer : ce qui est lu est ce qui est écrit, dans la liste comme sur la pastille.
    serveur.ecritures = [];
    liste.appliquer();
    expect(serveur.ecritures).toEqual([]);
    expect(serveur.estAdmin("u-chloe")).toBe(true);
  });

  it("ne ressème rien tant que le serveur ne bouge pas : un choix en cours n'est pas effacé", () => {
    const serveur = new Serveur({ "u-chloe": false });
    const liste = new ListeBureau(serveur, "u-chloe", true);
    // On choisit « admin » sans encore appuyer, et la page se rafraîchit pour une autre raison.
    liste.choisir(VALEUR_BUREAU);
    liste.rendre();
    expect(liste.affiche).toBe(VALEUR_BUREAU);
  });
});

/* ------------------------------------------------------------------ */
/* 5. Plus aucune garde muette dans ce dossier                         */
/* ------------------------------------------------------------------ */

/**
 * **Une garde `role === "ADMIN"` ne lève plus jamais** : `role` ne porte plus cette valeur depuis la
 * migration `role_de_base_et_admin_en_supplement`. Elle ne refuse donc plus rien — ou refuse tout —
 * **sans rien dire**, et c'est le piège nommé dans le dossier de ce changement. Ce qui veut savoir si
 * quelqu'un est du bureau lit `estAdmin`.
 */
describe("l'annuaire ne compare plus un rôle à « ADMIN »", () => {
  const fichiers = (dossier: string): string[] =>
    readdirSync(path.join(process.cwd(), dossier), { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? fichiers(`${dossier}/${e.name}`) : e.name.endsWith(".ts") || e.name.endsWith(".tsx") ? [`${dossier}/${e.name}`] : [],
    );

  it("aucun fichier du dossier ne teste `role === \"ADMIN\"` ni n'écrit l'entrée de liste correspondante", () => {
    const fautifs = fichiers(DOSSIER).filter((f) => {
      // Les commentaires racontent le changement : ils ont le droit de citer la valeur. On ne regarde
      // donc que le code, commentaires de bloc (JSDoc et `{/* … */}` du JSX) et de ligne retirés.
      const code = lire(f)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      return /role\s*[=!]==\s*"ADMIN"|"ADMIN"\s*[=!]==\s*\w*role/.test(code) || /<option value="ADMIN">/.test(code);
    });
    expect(fautifs).toEqual([]);
  });

  it("et la valeur « ADMIN » qui reste dans le dossier est celle de la liste du bureau, pas d'un rôle", () => {
    // `VALEUR_BUREAU` est le nom de la **ligne de la matrice** de permissions, porté par l'entrée de
    // liste : c'est ce qui voyage jusqu'au composant, pas ce qui s'écrit dans la colonne `role`.
    expect(VALEUR_BUREAU).toBe("ADMIN");
    expect(ENTREES_BUREAU.some((e) => e.valeur === VALEUR_BUREAU)).toBe(true);
  });
});
