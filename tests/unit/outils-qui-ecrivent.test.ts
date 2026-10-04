import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ETENDUE_PERIODE_MAX_JOURS, periodeSchema, retraitSeancesSchema } from "@/lib/validation/gestion";
import { baseDansLeDepot } from "../../prisma/garde-demonstration";

/**
 * **Les outils qui écrivent, et les bornes de ce qu'on leur confie**.
 *
 * Quatre défauts de la même famille : un outil de développement qui peut viser la base du club, et un
 * champ de formulaire sans borne. Aucun n'est une porte — il faut déjà un shell, ou être du bureau — mais
 * chacun transforme une faute de frappe en perte de données, et c'est exactement ce contre quoi on écrit.
 */

const source = (f: string) => readFileSync(f, "utf8");

describe("une commande de développement ne vise pas la base du club", () => {
  /**
   * `npm run db:migrate` lance `prisma migrate dev`, qui **propose de réinitialiser** la base quand
   * l'historique ne correspond pas, puis rejoue le seed. `db:deploy` existe pour la production et ne
   * réinitialise rien ; rien n'empêchait la confusion, et un `.env` recopié suffit.
   */
  it("`db:migrate` passe par le garde-fou, `db:deploy` n'en a pas besoin", () => {
    const pkg = JSON.parse(source("package.json")) as { scripts: Record<string, string> };
    expect(pkg.scripts["db:migrate"]).toContain("exiger-base-dev");
    expect(pkg.scripts["db:migrate"]).toContain("prisma migrate dev");
    // `migrate deploy` ne réinitialise jamais : c'est la commande de production, elle reste libre.
    expect(pkg.scripts["db:deploy"]).toBe("prisma migrate deploy");
  });

  it("la preuve est la même que celle du garde-fou de démonstration", () => {
    expect(source("scripts/exiger-base-dev.ts")).toContain("baseDansLeDepot");
    expect(baseDansLeDepot("file:../data/hema.db", "/d")).toBe(true);
    expect(baseDansLeDepot("file:/data/hema.db", "/d")).toBe(false);
  });

  /**
   * Un bloc `allowScripts` avait **la forme** d'une liste blanche de scripts d'installation sans en être
   * une : l'outil qui la lit n'est ni dans les dépendances, ni dans le verrou, ni installé, et aucun
   * `.npmrc` ne pose `ignore-scripts`. Ressembler à un contrôle est pire que de ne rien avoir : on s'y fie.
   */
  it("aucun bloc ne fait semblant de garder les scripts d'installation", () => {
    const pkg = JSON.parse(source("package.json")) as Record<string, unknown>;
    expect(pkg.allowScripts).toBeUndefined();
    // Et si la garde est un jour vraiment posée, les deux pièces vont ensemble.
    const devDeps = (pkg.devDependencies ?? {}) as Record<string, string>;
    if ("@lavamoat/allow-scripts" in devDeps) expect(pkg.allowScripts).toBeDefined();
  });
});

describe("les deux outils de secours montrent avant d'écrire", () => {
  /**
   * `admin:reset-2fa` désarme le second facteur d'un compte à partir d'une adresse tapée à la main. Une
   * faute de frappe sur une adresse voisine ouvrait le compte de quelqu'un d'autre au seul mot de passe,
   * en silence. C'est aussi la sortie que nomment `/admin/activer` et l'écran de connexion quand un secret
   * est devenu illisible : il doit rester utilisable, mais pas par accident.
   */
  it("la remise à zéro de la 2FA n'écrit rien sans `--confirmer`", () => {
    const code = source("scripts/reset-2fa.ts");
    expect(code).toContain('includes("--confirmer")');
    // L'affichage vient avant la transaction, et la sortie sans écriture est un `return`.
    expect(code.indexOf("Rien n'a été écrit")).toBeLessThan(code.indexOf("$transaction"));
  });

  /** Onze messages au nom du club, dont une imitation d'alerte de sécurité. */
  it("l'essai de notifications refuse une adresse étrangère sans drapeau explicite", () => {
    const code = source("scripts/test-notifications.ts");
    expect(code).toContain("ADMIN_EMAIL");
    expect(code).toContain("--vraiment-envoyer");
    expect(code.indexOf("REFUS")).toBeLessThan(code.indexOf("sendEmailNow({"));
  });
});

describe("les bornes des lots de séances", () => {
  it("le lot à retirer se valide comme celui à créer", () => {
    expect(retraitSeancesSchema.safeParse({ supprimer: Array.from({ length: 401 }, () => "s-1") }).success).toBe(false);
    expect(retraitSeancesSchema.safeParse({ supprimer: ["", "s-2"] }).success).toBe(false);
    expect(retraitSeancesSchema.safeParse({ supprimer: ["s-1", "s-2"] }).success).toBe(true);
  });

  /**
   * `genererSeances` parcourt la période **jour par jour**, et le plafond de 400 ne portait que sur les
   * dates **cochées** : une période `2026-01-01 → 9999-12-31` faisait calculer près de trois millions de
   * candidates puis insérer autant d'exclusions.
   */
  it("une période a une étendue bornée", () => {
    const base = { nom: "Rentrée", dateDebut: "2026-09-01" };
    expect(periodeSchema.safeParse({ ...base, dateFin: "2026-12-31" }).success).toBe(true);
    expect(periodeSchema.safeParse({ ...base, dateFin: "9999-12-31" }).success).toBe(false);
    expect(ETENDUE_PERIODE_MAX_JOURS).toBeGreaterThan(366);
  });
});

describe("un trimestre clos ne gagne ni ne perd de séances", () => {
  /**
   * Le verrou d'état vivait sur la séance et sur le planning, pas sur la **liste** des séances de la
   * période : on pouvait créer et effacer des cours — donc des réponses — sur un trimestre terminé, depuis
   * un écran muet, pendant que l'écran de la séance refusait le même geste.
   */
  it("les deux gestes de l'écran de la période lisent le statut", () => {
    const code = source("src/actions/periodes.ts").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const nom of ["genererSeancesPeriode", "supprimerSeancesPeriode"]) {
      const corps = code.split(`export async function ${nom}`)[1].split("\nexport async function")[0];
      expect(corps, `${nom} : le statut de la période doit trancher`).toContain("ecritureFermee(");
      expect(corps, `${nom} : et le refus se dit dans les mots de l'objet touché`).toContain("REFUS_PERIODE_CLOSE.seances");
    }
  });
});
