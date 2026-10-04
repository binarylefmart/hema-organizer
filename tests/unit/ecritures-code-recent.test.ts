import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * **Deux portes vers la même chose ne peuvent pas avoir deux serrures** — et la liste des portes se
 * découvre, elle ne se recopie pas.
 *
 * Trois écritures sensibles passaient sans code récent, et les trois étaient des oublis locaux dans
 * des fichiers où le geste voisin l'exigeait :
 *
 *  - **`supprimerSeancesPeriode`** efface un lot de séances **avec toutes les réponses des membres**.
 *    `CLAUDE.md` affirmait depuis le 30/09 qu'elle exigeait l'élévation « exactement comme son geste
 *    jumeau `supprimerSeance` » : la phrase décrivait un état qui n'existait pas. Depuis un poste admin
 *    laissé ouvert (l'élévation vit jusqu'à douze heures), décocher toutes les lignes de « Séances déjà
 *    créées » vidait le trimestre sans redemander de code — là où le même geste séance par séance
 *    s'arrêtait net sur `/connexion/verifier`.
 *  - **`enregistrerListeEmail`** règle **la** destination des envois collectifs (récap, rappels,
 *    annonces, annulations — des messages qui nomment des membres). Basculer une notification *vers* le
 *    mode « liste » exigeait un code ; déplacer la destination n'en exigeait aucun.
 *  - **`definirHeureRecap`**, sur le même écran, dont `CLAUDE.md` dit « toute écriture exige
 *    `exigerReauth` ».
 *
 * Ce fichier ne vérifie donc pas trois noms : il **balaie** les deux modules et exige que chaque export
 * qui écrit demande un code. C'est lui qui attrapera la prochaine écriture ajoutée sans garde — et c'est
 * exactement par là que les trois sont arrivées. Les exceptions se déclarent ici, avec leur raison.
 */

/** Source sans ses commentaires : un `exigerReauth` cité dans une phrase ne vaut pas un appel. */
function sansCommentaires(fichier: string): string {
  return readFileSync(fichier, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/** Découpe un module en blocs « un export exporté par bloc », dans l'ordre du fichier. */
function exports(fichier: string): Array<{ nom: string; corps: string }> {
  const code = sansCommentaires(fichier);
  const morceaux = code.split(/^export async function /m).slice(1);
  return morceaux.map((m) => ({ nom: m.slice(0, m.indexOf("(")), corps: m }));
}

/** Les appels qui écrivent durablement un réglage ou détruisent une donnée de membre. */
const ECRIT = /\b(setSetting|setPreferencesNotifications|setSalonDiscord|setSalonNotification|setAlertesActivees|setRetentionAuditJours|setTelegram|retirerTelegram|deleteMany|updateMany|\$transaction)\s*\(/;

describe("écran des notifications et des paramètres techniques", () => {
  /**
   * Les quatre exports « tester … » envoient un message de démonstration et **n'écrivent aucun
   * réglage** : ils n'ont rien à protéger d'un code récent, et en exiger un rendrait l'essai inutile
   * (on teste justement parce qu'on doute de la configuration). `chercherSalonsTelegram` ne lit que la
   * liste des salons du bot.
   */
  const SANS_ECRITURE = ["testerSalonNotification", "testerSalonDiscord", "testerEnvoiEmail", "testerWhatsApp", "testerTelegram", "chercherSalonsTelegram"];

  it("toute écriture de l'écran exige un code récent", () => {
    const tous = exports("src/actions/admin.ts");
    expect(tous.length, "le balayage ne trouve plus les exports : il regarde au mauvais endroit").toBeGreaterThanOrEqual(15);
    const fautifs = tous.filter((e) => ECRIT.test(e.corps) && !e.corps.includes("exigerReauth(")).map((e) => e.nom);
    expect(fautifs, "ces exports écrivent un réglage sans redemander de code").toEqual([]);
    // Contre-épreuve : la liste des exemptés est exacte, et chacun est bien sans écriture.
    for (const nom of SANS_ECRITURE) {
      const e = tous.find((x) => x.nom === nom);
      expect(e, `${nom} a disparu : revoir l'exemption et sa raison`).toBeDefined();
      expect(ECRIT.test(e!.corps), `${nom} s'est mis à écrire : il lui faut un code récent`).toBe(false);
    }
  });
});

describe("les deux portes de la même destruction", () => {
  it("effacer une séance et effacer un lot de séances ont la même serrure", () => {
    const seule = exports("src/actions/seances.ts").find((e) => e.nom === "supprimerSeance");
    const lot = exports("src/actions/periodes.ts").find((e) => e.nom === "supprimerSeancesPeriode");
    expect(seule).toBeDefined();
    expect(lot).toBeDefined();
    for (const porte of [seule!, lot!]) {
      // Même permission (le bureau), même second facteur, dans les deux cas.
      expect(porte.corps, `${porte.nom} : la destruction des réponses appartient au bureau`).toContain('assertPermission("periods.manage")');
      expect(porte.corps, `${porte.nom} : un code récent avant d'effacer des réponses`).toContain("exigerReauth(");
    }
  });

  /** Le code est demandé **après** les refus : sinon on fait payer une preuve d'identité pour rien. */
  it("le lot refuse d'abord, demande le code ensuite", () => {
    const corps = exports("src/actions/periodes.ts").find((e) => e.nom === "supprimerSeancesPeriode")!.corps;
    const refus = corps.indexOf("n'appartiennent pas à cette période");
    const code = corps.indexOf("exigerReauth(");
    const effacement = corps.indexOf("deleteMany");
    expect(refus).toBeGreaterThan(-1);
    expect(code).toBeGreaterThan(refus);
    expect(effacement).toBeGreaterThan(code);
  });
});
