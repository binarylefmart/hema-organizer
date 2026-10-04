import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * **Une attente affichée doit s'arrêter quand le serveur a répondu.**
 *
 * Deux fois le même piège, deux fois le même correctif : `pending` d'une transition React reste
 * vrai pendant le re-rendu déclenché par `revalidatePath`, et si ce re-rendu traîne (ou n'arrive
 * jamais), le bouton reste sur « Un instant… » alors que le geste est fait. C'est arrivé aux cases
 * du planning, puis à la remise à zéro d'un accès — où recliquer renvoie un second email.
 *
 * Ce fichier garde la règle : l'attente suit la **promesse de l'action**, pas la transition.
 */
const lire = (relatif: string) => fs.readFileSync(path.join(process.cwd(), relatif), "utf8");

describe("le bouton d'action", () => {
  const source = lire("src/components/ui/BoutonAction.tsx");

  it("n'affiche plus l'attente d'après `pending`", () => {
    expect(source).toContain("const [, start] = useTransition();");
    expect(source).toContain("{enVol ? enCours : children}");
    expect(source).not.toMatch(/pending \? enCours/);
  });

  it("rend la main quoi qu'il arrive, y compris sur une erreur", () => {
    expect(source).toContain("} finally {");
    expect(source).toContain("setEnVol(false);");
  });

  it("ne prend pas une redirection pour une erreur", () => {
    // `redirect()` lève côté client aussi : le routeur s'en occupe, l'écran n'a rien à dire
    expect(source).toContain('if (!message.includes("NEXT_REDIRECT")) setErreur(message);');
  });

  /**
   * **Il dit aussi ce que l'action a fait**. Seul `res.erreur` était affiché : le `succes` d'un
   * `FormState` tombait dans le vide, alors que les actions les plus bavardes passent par ce bouton
   * — « Rouvrir la période » explique combien de liens sont remis en service et qui n'en récupère
   * pas, « Reproposer » combien de dates reviennent. Rien de tout cela n'était visible ailleurs sur
   * l'écran, et l'on recliquait.
   */
  it("affiche le message de succès rendu par l'action", () => {
    expect(source).toContain("const res = (await action()) as { erreur?: string; succes?: string } | undefined;");
    expect(source).toContain("else if (res.succes) setSucces(res.succes);");
    expect(source).toContain('<span role="status" className="max-w-prose text-sm font-semibold text-vert">');
  });

  it("repart d'un écran propre à chaque clic", () => {
    // Sans cela, le compte rendu du geste précédent resterait sous un bouton qu'on vient de recliquer.
    expect(source).toContain("setErreur(null);\n          setSucces(null);");
  });
});

/**
 * Le compte rendu de la réouverture ne sert à rien s'il n'est pas affiché : le bouton et l'action
 * tiennent ensemble, c'est donc ici qu'on vérifie que l'écran de la période branche bien un
 * `BoutonAction` sur `reactiverPeriode`, qui rend un `FormState`.
 */
describe("la réouverture d'une période, de l'action à l'écran", () => {
  it("passe par le bouton qui sait afficher un succès", () => {
    const page = lire("src/app/(app)/admin/periodes/[id]/page.tsx");
    expect(page).toContain("<BoutonAction\n              action={reactiverPeriode.bind(null, p.id)}");
  });
});

describe("la case du planning, même règle", () => {
  it("ne parle que pour un échec ou une attente anormale", () => {
    const source = lire("src/components/planning/CaseEditeur.tsx");
    expect(source).toContain('{etat === "erreur" ? message : lent ? "Toujours en cours');
    expect(source).not.toContain("Enregistrement…\" : etat");
  });
});

describe("le dépôt d'une image, même règle et un piège de plus", () => {
  /**
   * Le corps d'une server action est plafonné par Next **avant** que l'action ne soit appelée :
   * une affiche de plus d'un mégaoctet était refusée là, la promesse rejetait sans jamais produire
   * de `res.erreur`, et l'écran restait sur « Envoi de l'affiche… » indéfiniment — sans rien à
   * cliquer. C'est vrai de tout rejet : réseau coupé, onglet en veille, serveur qui tombe.
   */
  const fichiers = ["src/components/evenements/ChampAffiche.tsx", "src/components/admin/ChampLogo.tsx"];
  for (const fichier of fichiers) {
    const source = lire(fichier);

    it(`${fichier} : l'attente est un état à part, pas le \`pending\` de la transition`, () => {
      expect(source).toContain("const [, demarrer] = useTransition();");
      expect(source).toContain("const [envoi, setEnvoi] = useState(false);");
    });

    it(`${fichier} : un envoi qui rejette rend la main et se dit`, () => {
      expect(source).toContain("      } catch {");
      expect(source).toContain("      } finally {");
      expect(source).toContain("        setEnvoi(false);");
      expect(source).toMatch(/a échoué/);
    });
  }
});
