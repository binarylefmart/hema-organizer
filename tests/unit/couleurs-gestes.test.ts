import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { gesteRouge, varianteGeste, VERBES_ROUGES } from "@/components/ui/choix-geste";
import { gestesEvenement } from "@/components/evenements/gestes-evenement";
import { GESTES_SELECTION, gestesTousApplicables, libelleBouton, varianteBouton, type ChiffresTous } from "@/app/(app)/admin/membres/choix-geste";

/**
 * **Une seule grammaire des couleurs dans l'application** :
 *
 * - **aucun bouton vert** ;
 * - **rouge, avec le pictogramme d'alerte, pour tout geste qui enlève quelque chose** — son libellé
 *   commence par « Supprimer », « Effacer », « Retirer », « Réinitialiser », « Révoquer », « Remettre … à
 *   zéro » ou « Débrancher » (`VERBES_ROUGES`, `gesteRouge`). Même un geste qui se rattrape (un lien
 *   révoqué se renvoie, un administrateur retiré se renomme) est rouge : ce qui est parti est à recréer ;
 * - **pas de rouge ailleurs sans raison écrite** (`ROUGES_PERMIS`) : en ajouter un oblige à dire ce
 *   qu'il fait partir sans retour.
 *
 * Le balayage lit chaque bouton du JSX (`Bouton`, `BoutonAction`, `BoutonEnvoi`, `FormulaireAction` et
 * `<button>`), son libellé visible (texte et chaînes de ses expressions, ou la prop `bouton`) et sa
 * couleur. Les gestes du composant commun « Que veux-tu faire ? » sont vérifiés plus bas, sur les données.
 */

const RACINE = path.join(process.cwd(), "src");

function fichiers(dossier: string): string[] {
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = path.join(dossier, nom);
    return statSync(chemin).isDirectory() ? fichiers(chemin) : chemin.endsWith(".tsx") ? [chemin] : [];
  });
}

/**
 * Les rouges qui ne commencent pas par un verbe du rouge, chacun avec sa raison. Clé : le fichier et
 * le libellé du bouton.
 */
const ROUGES_PERMIS: Record<string, string> = {
  "app/(app)/profil/BoutonDeconnexion.tsx › Se déconnecter": "sans mot de passe, revenir demande le lien gardé ou son email",
  "app/(public)/annuler/[token]/page.tsx › Confirmer l'annulation": "confirmer l'annulation d'un cours depuis un email : l'annonce part à tout le club",
  "app/(public)/desinscription/[token]/page.tsx › Ne plus recevoir les rappels": "page de confirmation d'un lien d'email, un seul geste",
  "app/(app)/seances/page.tsx › Oui, je ne viens plus": "la réponse « absent » venue d'un email, aux couleurs de la charte (Absent en rouge)",
};

/**
 * Le seul vert permis : la réponse « présent » venue d'un email, aux couleurs de la charte (Présent en
 * vert, Absent en rouge). Ce n'est pas un vert « réussite » : c'est la couleur de la réponse.
 */
const VERTS_PERMIS: Record<string, string> = {
  "app/(app)/seances/page.tsx › Oui, je viens": "la réponse « présent » venue d'un email, aux couleurs de la charte",
};

/**
 * Les gestes qui commencent par un verbe du rouge **sans rien enlever**, chacun avec sa raison. Clé :
 * le fichier et le libellé.
 */
const HORS_REGLE: Record<string, string> = {
  "components/filtres/ChampDate.tsx › Effacer": "vide le champ de date d'un filtre : rien n'est effacé, la liste revient entière",
};

const BALISES = ["Bouton", "BoutonAction", "BoutonEnvoi", "FormulaireAction", "button"] as const;

type Geste = { rel: string; balise: string; attributs: string; contenu: string; libelles: string[] };

/** La fin d'un bloc qui commence à `i` sur `{`, en sautant chaînes et commentaires. */
function finAccolade(code: string, i: number): number {
  let profondeur = 0;
  for (let j = i; j < code.length; j++) {
    const c = code[j];
    if (c === '"' || c === "'" || c === "`") j = finChaine(code, j);
    else if (c === "/" && code[j + 1] === "/") j = code.indexOf("\n", j);
    else if (c === "/" && code[j + 1] === "*") j = code.indexOf("*/", j) + 1;
    else if (c === "{") profondeur++;
    else if (c === "}" && --profondeur === 0) return j;
  }
  return code.length;
}

function finChaine(code: string, i: number): number {
  const q = code[i];
  for (let j = i + 1; j < code.length; j++) {
    if (code[j] === "\\") j++;
    else if (q === "`" && code[j] === "$" && code[j + 1] === "{") j = finAccolade(code, j + 1);
    else if (code[j] === q) return j;
  }
  return code.length;
}

/** La fin de la balise ouvrante qui commence à `i` (sur `<`) : l'indice du `>`, et si elle se ferme seule. */
function finBalise(code: string, i: number): { fin: number; seule: boolean } {
  for (let j = i + 1; j < code.length; j++) {
    const c = code[j];
    if (c === "{") j = finAccolade(code, j);
    else if (c === '"' || c === "'") j = finChaine(code, j);
    else if (c === "/" && code[j + 1] === "/") j = code.indexOf("\n", j);
    else if (c === "/" && code[j + 1] === "*") j = code.indexOf("*/", j) + 1;
    else if (c === ">") return { fin: j, seule: code[j - 1] === "/" };
  }
  return { fin: code.length, seule: true };
}

/** Les chaînes littérales d'une expression : « Supprimer » dans `{enCours ? "Suppression…" : "Supprimer"}`. */
const chaines = (expr: string) => [...expr.matchAll(/"([^"]*)"|'([^']*)'|`([^`$]*)/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? "");

/** Le libellé visible d'un contenu JSX : son texte, et les chaînes de ses expressions. */
function libellesDuContenu(contenu: string): string[] {
  const libelles: string[] = [];
  let texte = "";
  for (let j = 0; j < contenu.length; j++) {
    const c = contenu[j];
    if (c === "{") {
      const fin = finAccolade(contenu, j);
      const expr = contenu.slice(j + 1, fin);
      if (!expr.trim().startsWith("/*")) {
        libelles.push(...chaines(expr.replace(/<[A-Za-z][^>]*>/g, " ")));
        const fragment = expr.match(/<>([\s\S]*)<\/>/);
        if (fragment) libelles.push(...libellesDuContenu(fragment[1]));
      }
      libelles.push(texte);
      texte = "";
      j = fin;
    } else if (c === "<") {
      j = /[A-Za-z]/.test(contenu[j + 1] ?? "") ? finBalise(contenu, j).fin : contenu.indexOf(">", j);
      texte += " ";
    } else texte += c;
  }
  libelles.push(texte);
  return libelles.map((l) => l.replace(/&apos;/g, "'").replace(/\s+/g, " ").trim()).filter(Boolean);
}

function gestesDuFichier(rel: string, code: string): Geste[] {
  const gestes: Geste[] = [];
  const ouverture = new RegExp(`<(${BALISES.join("|")})(?=[\\s>/])`, "g");
  for (const m of code.matchAll(ouverture)) {
    const balise = m[1];
    const { fin, seule } = finBalise(code, m.index);
    const attributs = code.slice(m.index, fin + 1);
    let contenu = "";
    if (!seule) {
      const fermeture = code.indexOf(`</${balise}>`, fin);
      contenu = code.slice(fin + 1, fermeture < 0 ? fin + 1 : fermeture);
    }
    const prop = attributs.match(/\sbouton=("([^"]*)"|\{)/);
    const libelles =
      balise === "FormulaireAction" && prop
        ? prop[2] !== undefined
          ? [prop[2]]
          : libellesDuContenu(attributs.slice(attributs.indexOf("{", prop.index), finAccolade(attributs, attributs.indexOf("{", prop.index)) + 1))
        : libellesDuContenu(contenu);
    gestes.push({ rel, balise, attributs, contenu, libelles });
  }
  return gestes;
}

/** Rouge : la variante `danger` (écrite ou choisie par une expression), ou un `<button>` peint en rouge. */
const estRouge = (g: Geste) => /"danger"|varianteGeste\(/.test(g.attributs) || /className=[^>]*(^|[\s"'`{])(text|bg)-rouge\b/.test(g.attributs);
const aLeSigne = (g: Geste) => /nom="alerte"/.test(g.contenu) || /nom="alerte"/.test(g.attributs);

describe("les couleurs des gestes", () => {
  const tous = fichiers(RACINE).map((f) => ({ rel: path.relative(RACINE, f), code: readFileSync(f, "utf8") }));
  const gestes = tous.filter((f) => !f.rel.startsWith("components/ui/")).flatMap((f) => gestesDuFichier(f.rel, f.code));
  const cle = (g: Geste, libelle: string) => `${g.rel} › ${libelle}`;

  it("le balayage voit bien les boutons (garde-fou du garde-fou)", () => {
    const vus = gestes.flatMap((g) => g.libelles.map((l) => cle(g, l)));
    expect(vus).toContain("app/(app)/admin/comptes/page.tsx › Retirer");
    expect(vus).toContain("app/(app)/admin/membres/page.tsx › Retirer l'adresse");
    expect(vus).toContain("components/planning/ListeParties.tsx › Retirer");
    expect(vus).toContain("components/evenements/ChampAffiche.tsx › Retirer l'affiche");
    expect(gestes.length).toBeGreaterThan(100);
  });

  it("aucun bouton vert", () => {
    const verts = gestes.filter((g) => /variante=(\{[^}]*)?"succes"/.test(g.attributs)).filter((g) => !g.libelles.some((l) => cle(g, l) in VERTS_PERMIS));
    expect(verts.map((g) => `${g.rel} › ${g.libelles.join(" / ")}`)).toEqual([]);
    expect(tous.filter((f) => !f.rel.startsWith("components/ui/") && /variante="succes"/.test(f.code) && !gestes.some((g) => g.rel === f.rel && /variante=(\{[^}]*)?"succes"/.test(g.attributs))).map((f) => f.rel)).toEqual([]);
  });

  it("tout geste qui supprime, efface, retire, réinitialise ou révoque est rouge, avec le pictogramme d'alerte", () => {
    const fautifs = gestes.flatMap((g) =>
      g.libelles
        .filter((l) => gesteRouge(l) && !(cle(g, l) in HORS_REGLE))
        .filter(() => !estRouge(g) || !aLeSigne(g))
        .map((l) => `${cle(g, l)}${estRouge(g) ? " (sans pictogramme)" : ""}`),
    );
    expect(fautifs).toEqual([]);
  });

  it("le rouge seulement là où quelque chose s'en va, ou avec sa raison", () => {
    const sansRaison = gestes
      // Un rouge choisi par `varianteGeste` suit la règle commune : il est vérifié sur les données, plus bas.
      .filter((g) => /variante=(\{[^}]*)?"danger"/.test(g.attributs) && !/varianteGeste\(/.test(g.attributs) && !g.libelles.some(gesteRouge))
      .filter((g) => !g.libelles.some((l) => cle(g, l) in ROUGES_PERMIS))
      .map((g) => `${g.rel} › ${g.libelles.join(" / ")}`);
    expect(sansRaison).toEqual([]);
  });

  it("aucun rouge écrit hors d'un bouton que le balayage sait lire", () => {
    const vus = new Map<string, number>();
    const variantesRouges = (code: string) => code.match(/variante=(\{[^}]*)?"danger"/g)?.length ?? 0;
    for (const g of gestes) vus.set(g.rel, (vus.get(g.rel) ?? 0) + variantesRouges(g.attributs));
    const ailleurs = tous
      .filter((f) => !f.rel.startsWith("components/ui/"))
      .filter((f) => variantesRouges(f.code) > (vus.get(f.rel) ?? 0))
      .map((f) => f.rel);
    expect(ailleurs).toEqual([]);
  });

  it("chaque exception est encore là : une raison sans bouton ment", () => {
    const vus = new Set(gestes.flatMap((g) => g.libelles.map((l) => cle(g, l))));
    expect([...Object.keys(ROUGES_PERMIS), ...Object.keys(VERTS_PERMIS), ...Object.keys(HORS_REGLE)].filter((k) => !vus.has(k))).toEqual([]);
  });
});

describe("la règle du rouge, dans « Que veux-tu faire ? »", () => {
  it("reconnaît les verbes, accents et majuscules compris", () => {
    for (const l of ["Supprimer 3 comptes", "Effacer la proposition", "Retirer l'adresse", "Réinitialiser les accès", "RÉVOQUER", "Révoquer le lien", "Tout révoquer", "Remettre l'accès à zéro", "Débrancher ce salon", "Désactiver le compte", "Dépublier", "Oublier"]) {
      expect(gesteRouge(l), l).toBe(true);
    }
    for (const l of ["Renvoyer le lien", "Remettre en attente", "Réactiver", "Publier", "Refuser", "Placer dans le planning", "Annuler la sélection"]) {
      expect(gesteRouge(l), l).toBe(false);
    }
    expect(VERBES_ROUGES).toContain("Révoquer");
  });

  it("un libellé rouge rend le bouton rouge, même si le geste n'est pas marqué", () => {
    expect(varianteGeste(undefined, "Révoquer le lien de Paul")).toBe("danger");
    expect(varianteGeste(true)).toBe("danger");
    expect(varianteGeste(undefined, "Renvoyer le lien à Paul")).toBe("primaire");
  });

  it("dans la barre de l'annuaire, le bouton est rouge si et seulement si son libellé l'est", () => {
    for (const g of GESTES_SELECTION) {
      expect(varianteBouton(g) === "danger", g).toBe(gesteRouge(libelleBouton(g, 2, { libelle: "Membre", changent: 2 })));
    }
  });

  it("sur une annonce d'événement, pareil : dépublier et supprimer rouges, modifier et publier neutres", () => {
    for (const publie of [true, false]) {
      for (const g of gestesEvenement({ nom: "Stage", publie }, { modifier: true, supprimer: true })) expect(Boolean(g.definitif), g.geste).toBe(gesteRouge(g.bouton));
    }
  });

  it("dans le volet « Pour tout le monde », pareil", () => {
    const chiffres: ChiffresTous = {
      inviter: 2,
      dejaEntres: 1,
      renvoyer: 2,
      revoquer: 2,
      reinitialiser: 2,
      reinitialiserEmails: 1,
      jamaisEntres: 1,
      desactiver: 2,
      reactiver: 2,
      periode: "T4",
    };
    for (const g of gestesTousApplicables(chiffres)) expect(g.definitif, g.geste).toBe(gesteRouge(g.bouton));
  });
});
