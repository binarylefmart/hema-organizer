import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LIBELLE_VIDE, libelleElement, nomElement, nomPartie, PARTIE_DESCRIPTION_MAX, PARTIES_MODELE, partiesNommees } from "@/lib/constants";
import { placesDansPartie } from "@/components/planning/rangement";
import { partiesInitiales } from "@/lib/planning";
import { champsLus } from "@/components/planning/options";

/**
 * **Le vocabulaire des parties d'une séance, et ce qu'une case donne à lire.**
 *
 * Trois décisions de Delta, prises sur les captures d'un club de quatre-vingts, et qui n'ont de sens
 * qu'ensemble :
 *
 * 1. **« Partie 1 · Cours », « Partie 2 · Option 2 »…** (« une gestion par partie »).
 *    La partie se numérote, et dans une partie chaque nature se numérote **seulement quand elle est
 *    plusieurs** — le « n° » et le cas particulier « 1ère option » ont disparu depuis longtemps —, et
 *    surtout : ce nom **ne se saisit plus**, il se calcule (`libelleElement`). Ce qui décrit un cours,
 *    ce sont ses informations : instructeur, thème, niveau, et sa **description** facultative.
 * 2. **`----------` plutôt qu'un mot inventé** dans les listes déroulantes d'une case vide
 *    (« Indifférent », « aucun thème », « personne en second » disaient trois choses différentes pour
 *    le même état : rien de choisi).
 * 3. **Ce qui vaut `----------` ne s'affiche pas du tout pour un membre** — ni la valeur, ni son
 *    intitulé. L'encadrement voit des champs à remplir, le club ne voit que ce qui est renseigné.
 *
 * Ces trois points sont testables sans navigateur, et c'est ici qu'ils le sont : les composants qui
 * les appliquent (`CaseEditeur`, `ListeParties`) sont des `.tsx` que les tests ne peuvent pas
 * importer, d'où les fonctions pures de `constants.ts` et de `planning/options.ts`.
 */

const lire = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

describe("le vocabulaire des parties", () => {
  /**
   * **Le modèle : une seule partie, un cours** (« par défaut 1 seule partie par
   * séance, qui n'est pas notifiée partie 1, uniquement à partir de 2 »). Autant de cours,
   * échauffements, options et ateliers qu'on veut s'ajoutent ensuite, dans cette partie ou une autre.
   */
  it("fait naître une séance avec un seul « Cours », sans « Partie 1 · »", () => {
    expect(PARTIES_MODELE).toEqual([{ bloc: 1, nature: "COURS" }]);
    expect(partiesInitiales().map((p) => p.libelle)).toEqual(["Cours"]);
  });

  it("ne numérote une nature que quand la partie en porte plusieurs", () => {
    expect(nomElement("COURS", 1, 1)).toBe("Cours");
    expect(nomElement("COURS", 1, 2)).toBe("Cours 1");
    expect(nomElement("COURS", 2, 2)).toBe("Cours 2");
    expect(nomElement("ECHAUFFEMENT", 1, 1)).toBe("Échauffement");
    expect(nomElement("ATELIER", 3, 3)).toBe("Atelier 3");
    expect(nomPartie(2)).toBe("Partie 2");
    expect(libelleElement(2, "OPTION", 2, 2, 3)).toBe("Partie 2 · Option 2");
    expect(libelleElement(1, "COURS", 1, 1, 2)).toBe("Partie 1 · Cours");
  });

  it("ne dit « Partie N » que si la séance a plusieurs parties (avenant du 06/10)", () => {
    expect(partiesNommees(0)).toBe(false);
    expect(partiesNommees(1)).toBe(false);
    expect(partiesNommees(2)).toBe(true);
    expect(partiesNommees(3)).toBe(true);
    expect(libelleElement(1, "COURS", 1, 1, 1)).toBe("Cours");
    expect(libelleElement(1, "OPTION", 2, 2, 1)).toBe("Option 2");
    expect(libelleElement(1, "ECHAUFFEMENT", 1, 1, 1)).toBe("Échauffement");
    expect(libelleElement(1, "ATELIER", 1, 1, 1)).toBe("Atelier");
  });

  it("compte le rang dans la nature **et** dans la partie, jamais sur la séance entière", () => {
    const elements = [
      { bloc: 1, nature: "COURS" as const },
      { bloc: 1, nature: "OPTION" as const },
      { bloc: 2, nature: "COURS" as const },
      { bloc: 2, nature: "COURS" as const },
      { bloc: 2, nature: "OPTION" as const },
    ];
    const places = placesDansPartie(elements);
    expect(elements.map((e, i) => libelleElement(e.bloc, e.nature, places[i].rang, places[i].nombre, 2))).toEqual([
      "Partie 1 · Cours",
      "Partie 1 · Option",
      "Partie 2 · Cours 1",
      "Partie 2 · Cours 2",
      "Partie 2 · Option",
    ]);
  });

  it("ne laisse plus les anciens mots **en valeur** nulle part (les commentaires d'histoire, eux, restent)", () => {
    for (const fichier of ["src/lib/constants.ts", "src/lib/planning.ts", "src/components/planning/ListeParties.tsx", "prisma/seed-demo.ts"]) {
      // Une chaîne entre guillemets, c'est une donnée écrite par le code ; une phrase de commentaire
      // qui raconte d'où l'on vient n'en est pas une, et elle a sa place.
      expect(lire(fichier), fichier).not.toMatch(/["'`](1ère partie|2nde partie|Cours n°\d|\d?(ère|e) option)["'`]/);
    }
  });
});

/**
 * **Le nom d'une partie ne se saisit plus**. Le champ texte a disparu de l'écran d'édition, avec
 * tout ce qui vivait autour de lui — et c'est justement ce qui ne doit pas revenir par
 * inadvertance : un champ de nom réintroduit ferait des deux moitiés de l'application deux versions
 * du même objet, l'une qui calcule le libellé à chaque écriture et l'autre qui l'écrase.
 */
describe("plus aucun champ de saisie pour le nom d'une partie", () => {
  const liste = lire("src/components/planning/ListeParties.tsx");

  it("ne porte plus ni champ de nom, ni formulaire de renommage", () => {
    // Le nom s'affiche dans une étiquette, il ne s'écrit nulle part.
    expect(liste).not.toMatch(/placeholder="Nom de la partie/);
    expect(liste).not.toMatch(/Nom de la nouvelle partie/);
    expect(liste).not.toContain("renommerPartie");
    expect(liste).not.toContain("decisionRenommage");
  });

  /**
   * **Plus aucune action de nature appelée depuis l'écran**. La nature se choisit **à l'ajout**,
   * elle ne se change plus après coup : on retire la partie et on ajoute l'autre.
   * `changerNaturePartie` existe toujours côté serveur, avec ses gardes et ses tests, mais **aucun
   * écran ne l'appelle** — c'est écrit dans son en-tête.
   */
  it("ne change jamais la nature depuis l'écran : elle se choisit à l'ajout", () => {
    // le menu « Ajouter dans la partie N… » décide de la nature,
    // l'étiquette ne fait que la montrer — la décision du 01/10 tient.
    expect(liste).not.toContain("changerNaturePartie");
    expect(fs.existsSync(path.join(process.cwd(), "src/components/planning/bascule-nature.ts"))).toBe(false);
  });

  it("a emporté avec lui le module qui rattrapait Échap et son plafond de saisie", () => {
    // `renommage.ts` n'existait que pour un défaut du champ texte (Échap enregistrait le nom qu'il
    // abandonnait) et `LIBELLE_PARTIE_MAX` pour son `maxLength` : sans champ, les deux sont du code
    // mort, et du code mort qui laisse croire qu'un nom peut encore être tapé.
    expect(fs.existsSync(path.join(process.cwd(), "src/components/planning/renommage.ts"))).toBe(false);
    expect(lire("src/components/planning/options.ts")).not.toMatch(/export const LIBELLE_PARTIE_MAX/);
    expect(lire("src/lib/validation/gestion.ts")).not.toMatch(/export const libellePartieSchema/);
  });

  /**
   * **Deux boutons, un par nature** — et le geste a fait l'aller-retour dans la même journée :
   * « ne mets que ajouter un cours/option, un seul bouton au lieu de 2 » le matin, puis « enlève le
   * slider et mets 2 boutons » le soir. Ce qui justifiait le bouton unique était la bascule de
   * chaque ligne ; elle est partie, donc la nature se choisit là où elle se décide, à l'ajout.
   */
  it("ajoute **sans demander de nom** : un menu par partie, et « Ajouter une partie »", () => {
    expect(liste).toContain("ajouterPartie({ sessionId, bloc, ...ajout })");
    expect(liste).toContain("Ajouter une partie");
    expect(lire("src/components/planning/parties-carte.ts")).toContain("`Ajouter dans la partie ${bloc}…`");
  });
});

describe("les migrations de renommage", () => {
  const RENOMMAGE = "prisma/migrations/20260929220000_libelles_cours_numerotes/migration.sql";
  const RATTRAPAGE = "prisma/migrations/20260929230000_libelles_par_rang_dans_la_nature/migration.sql";
  const renommage = lire(RENOMMAGE);
  const rattrapage = lire(RATTRAPAGE);

  /*
   * **Ce fichier ne juge que la forme du SQL** — ce qu'il fait vraiment est vérifié en l'exécutant,
   * dans `migration-rangs-parties.test.ts`, sur les 66 séances possibles d'avant la migration.
   * C'est la leçon du défaut relevé en revue : le renommage (`20260929220000`) était bien formé et
   * pourtant faux, parce qu'il renommait **par valeur** (« 2nde partie » → « Cours n°2 ») juste
   * après que `20260929210000` ait renuméroté les rangs. Une séance qui n'avait que son ancien
   * `MOITIE_2` en sortait avec le rang 1 et le libellé « Cours n°2 ».
   *
   * `20260929230000_libelles_par_rang_dans_la_nature` rattrape le tir : il renomme **par rang dans la
   * nature**. Les deux fichiers restent ici, le premier tel qu'il a été livré — on ne réécrit pas une
   * migration déjà passée en base chez quelqu'un.
   */

  it("le rattrapage numérote par **rang dans la nature**, chaque série pour elle-même", () => {
    // La partition par `estOption` est ce qui sépare les deux séries : le troisième cours s'appelle
    // « Cours n°3 » même s'il est la cinquième ligne de la séance.
    expect(rattrapage).toMatch(/ROW_NUMBER\(\)\s*OVER\s*\(\s*PARTITION BY "sessionId", "estOption"\s+ORDER BY "ordre", "id"\s*\)/);
  });

  it("matérialise les rangs **avant** la première écriture : une sous-requête corrélée relirait la table entamée", () => {
    // C'est le piège qui a coûté la migration `20260929200000` : SQLite met à jour ligne par ligne.
    // On lit les instructions, pas le fichier : la prose des commentaires parle d'`UPDATE` elle aussi.
    const etapes = instructions(rattrapage);
    expect(etapes[0]).toMatch(/^CREATE TEMP TABLE "rangs_nature" AS\s+SELECT/);
    expect(etapes.findIndex((l) => /^UPDATE/i.test(l))).toBeGreaterThan(0);
    expect(etapes.at(-1)).toMatch(/^DROP TABLE "rangs_nature"$/);
    // La fonction de fenêtrage vit dans le `CREATE … AS SELECT`, jamais dans un `UPDATE` : écrite
    // dans la sous-requête, elle serait réévaluée ligne par ligne sur la table déjà entamée.
    for (const ligne of etapes.filter((l) => l.startsWith("UPDATE"))) {
      expect(ligne, ligne).not.toContain("ROW_NUMBER");
    }
  });

  it("écrivait les libellés d'alors **au caractère près**, `n°` compris", () => {
    // Le degré est U+00B0, pas un « o » en exposant ni le signe masculin ordinal U+00BA. Ces deux
    // formes-là ne sont plus celles du code (voir `libellePartie`) : ces fichiers sont de l'histoire
    // déjà passée en base, on ne réécrit pas une migration livrée.
    expect(rattrapage).toContain(`'Cours n\u00b0' ||`);
    expect(rattrapage).toContain(`'1ère option'`);
    expect(rattrapage).toContain(`'e option'`);
  });

  it("ne touche que ce que le modèle sait écrire — jamais un `LIKE`, jamais ce qu'un club a tapé", () => {
    for (const [nom, sql] of [
      [RENOMMAGE, renommage],
      [RATTRAPAGE, rattrapage],
    ] as const) {
      for (const ligne of instructions(sql).filter((l) => l.startsWith("UPDATE"))) {
        expect(ligne, `${nom} : ${ligne}`).not.toMatch(/LIKE/i);
        // Chaque `UPDATE` reste dans une seule nature : une option qu'un club aurait nommée
        // « 1ère partie » n'est pas le « Cours n°1 » du modèle.
        expect(ligne, `${nom} : ${ligne}`).toMatch(/"estOption"\s*=\s*(false|true|0|1)/);
      }
    }
    // Le rattrapage reconnaît la forme du modèle par un aller-retour (on relit le nombre écrit dans
    // le libellé et on exige l'égalité exacte), et non par un préfixe : « Cours n°2 bis » échoue.
    expect(rattrapage).toContain(`"libelle" = 'Cours n\u00b0' || CAST(substr("libelle", 9) AS INTEGER)`);
    expect(rattrapage).toContain(`"libelle" = CAST("libelle" AS INTEGER) || 'e option'`);
  });

  it("ne déplace aucun `updatedAt` : changer un libellé n'est pas une modification du programme", () => {
    for (const [nom, sql] of [
      [RENOMMAGE, renommage],
      [RATTRAPAGE, rattrapage],
    ] as const) {
      for (const ligne of instructions(sql)) expect(ligne, `${nom} : ${ligne}`).not.toMatch(/"updatedAt"\s*=/);
    }
  });

  it("est rejouable : chaque `UPDATE` compare au libellé voulu avant de l'écrire", () => {
    // Deux `UPDATE`, un par nature, et chacun porte sa propre condition d'inégalité : aucune ligne
    // déjà juste n'est réécrite. L'effet est mesuré à l'exécution dans `migration-rangs-parties`.
    const mises = instructions(rattrapage).filter((l) => l.startsWith("UPDATE"));
    expect(mises).toHaveLength(2);
    for (const ligne of mises) expect(ligne, ligne).toMatch(/"libelle" <>/);
  });
});

/**
 * Le SQL d'un fichier de migration, découpé en instructions : les commentaires partent d'abord, ils
 * contiennent des points-virgules de français qui découperaient au mauvais endroit.
 */
function instructions(sql: string): string[] {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*--.*$/gm, "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * **La migration** : la colonne `description`, et les libellés passés à la forme calculée (« Cours
 * 1 », « Option 1 »).
 *
 * Elle diffère des trois précédentes sur un point, et c'est le point à verrouiller : **elle n'a plus
 * aucun garde-fou de forme**. Les migrations de vocabulaire d'avant ne réécrivaient que les libellés
 * que le modèle savait produire, pour ne pas toucher à ce qu'un club aurait tapé à la main. Le libellé
 * n'est plus une donnée saisie — le champ texte a disparu de l'écran, et le code le réécrit à chaque
 * écriture (`rangerParties`) : un libellé « maison » deviendrait faux au premier ajout de partie. Le
 * sauvetage serait donc du code mort qui protège un cas qui n'existe pas, et il ferait croire au
 * prochain lecteur qu'un libellé manuscrit peut encore arriver.
 *
 * Ce que fait vraiment ce SQL est vérifié en l'exécutant (`migration-rangs-parties.test.ts`) ; ici on
 * ne juge que sa forme.
 */
describe("la migration des libellés calculés et de la description", () => {
  const CHEMIN = "prisma/migrations/20260930120000_description_partie_et_libelles_calcules/migration.sql";
  const sql = lire(CHEMIN);
  const etapes = instructions(sql);
  const mises = etapes.filter((l) => l.startsWith("UPDATE"));

  it("ajoute la colonne `description`, vide par défaut — le patron de `theme`", () => {
    expect(etapes[0]).toMatch(/^ALTER TABLE "SessionPartie" ADD COLUMN "description" TEXT NOT NULL DEFAULT ''$/);
  });

  it("écrit exactement ce que le code écrit, au caractère près", () => {
    expect(sql).toContain(`'Cours ' ||`);
    expect(sql).toContain(`'Option ' ||`);
    // La règle du code d'alors (`libellePartie`, remplacée depuis par
    // `libelleElement`) ; la migration « Parties et éléments » a réécrit ces libellés depuis, et son
    // propre test la compare à `rangementsParties` (`migration-parties-elements.test.ts`).
    // Plus de « n° », plus de « 1ère » **dans le SQL exécuté** : ce sont les deux formes que la
    // migration fait disparaître. La prose du fichier a le droit de les citer — c'est là qu'elle
    // raconte ce qu'elle remplace.
    const execute = etapes.join("; ");
    expect(execute).not.toContain("n\u00b0");
    expect(execute).not.toContain("1ère option");
  });

  it("numérote par **rang dans la nature**, chaque série pour elle-même", () => {
    expect(sql).toMatch(/ROW_NUMBER\(\)\s*OVER\s*\(\s*PARTITION BY "sessionId", "estOption"\s+ORDER BY "ordre", "id"\s*\)/);
    expect(mises).toHaveLength(2); // un par nature
    for (const ligne of mises) expect(ligne, ligne).toMatch(/"estOption"\s*=\s*(false|true|0|1)/);
  });

  it("matérialise les rangs **avant** la première écriture : une sous-requête corrélée relirait la table entamée", () => {
    // Le piège qui a coûté la migration `20260929200000` : SQLite met à jour ligne par ligne. Ce
    // n'est pas une précaution sur les données — c'est un défaut du moteur.
    expect(etapes[1]).toMatch(/^CREATE TEMP TABLE "rangs_nature" AS\s+SELECT/);
    expect(etapes.findIndex((l) => /^UPDATE/i.test(l))).toBeGreaterThan(1);
    expect(etapes.at(-1)).toMatch(/^DROP TABLE "rangs_nature"$/);
    for (const ligne of mises) expect(ligne, ligne).not.toContain("ROW_NUMBER");
  });

  it("réécrit **tous** les libellés : aucune reconnaissance de forme, aucune exception", () => {
    /*
     * Décision de Delta, : « on s'en fiche, rien n'a été publié ». Le `WHERE` ne porte donc que
     * deux choses — la nature de la partie, et « ce libellé n'est pas déjà le bon » (pour rester
     * rejouable). Surtout pas un `CAST(substr(...))` comme le rattrapage de la veille : ce serait
     * remettre un garde-fou sur une donnée qui n'est plus saisie.
     */
    for (const ligne of mises) {
      expect(ligne, ligne).not.toMatch(/LIKE/i);
      expect(ligne, ligne).not.toMatch(/substr/i);
      expect(ligne, ligne).not.toMatch(/\bCAST\b/i);
    }
  });

  it("est rejouable : chaque `UPDATE` compare au libellé voulu avant de l'écrire", () => {
    for (const ligne of mises) expect(ligne, ligne).toMatch(/"libelle" <>/);
  });

  it("ne déplace aucun `updatedAt` : changer le vocabulaire n'est pas une modification du programme", () => {
    for (const ligne of etapes) expect(ligne, ligne).not.toMatch(/"updatedAt"\s*=/);
  });
});

describe("`----------` : ce qui n'est pas renseigné", () => {
  const editeur = lire("src/components/planning/CaseEditeur.tsx");

  it("est le même signe pour les quatre réglages d'une case", () => {
    expect(LIBELLE_VIDE).toBe("----------");
    // Les quatre listes d'une case (les deux instructeurs, le thème, le niveau) le partagent.
    expect(editeur.match(/LIBELLE_VIDE/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
  });

  it("a remplacé les trois mots qui disaient chacun la même absence à leur façon", () => {
    // On vise l'**entrée** de liste, pas la prose : le commentaire qui explique d'où vient
    // « personne en second » raconte l'histoire de la case, il n'en règle plus rien.
    for (const ancien of ["personne en second", "aucun thème", "aucun"]) {
      expect(editeur, ancien).not.toContain(`libelle: "${ancien}"`);
    }
  });
});

describe("ce qu'un membre lit d'une case", () => {
  const pleine = {
    instructeur: "Damien Rochebrune",
    instructeurSecond: "Élise Mazerolles",
    theme: "Épée longue",
    description: "Garde longue et garde de la fenêtre, puis trois passes lentes en binôme.",
    niveau: "DEBUTANT",
  };

  it("écrit devant chaque valeur ce qu'elle est", () => {
    expect(champsLus(pleine)).toEqual([
      { intitule: "Instructeur", valeur: "Damien Rochebrune" },
      { intitule: "Second instructeur", valeur: "Élise Mazerolles" },
      { intitule: "Thème", valeur: "Épée longue" },
      { intitule: "Niveau", valeur: "Débutant" },
      { intitule: "Description", valeur: "Garde longue et garde de la fenêtre, puis trois passes lentes en binôme." },
    ]);
  });

  it("n'écrit **rien du tout** pour un champ laissé à `----------` — pas même son intitulé", () => {
    expect(champsLus({ instructeur: null, instructeurSecond: null, theme: "", description: "", niveau: "INDIFFERENT" })).toEqual([]);
    expect(champsLus({ ...pleine, niveau: "INDIFFERENT" }).map((c) => c.intitule)).toEqual(["Instructeur", "Second instructeur", "Thème", "Description"]);
    expect(champsLus({ ...pleine, theme: "   " }).map((c) => c.intitule)).toEqual(["Instructeur", "Second instructeur", "Niveau", "Description"]);
    expect(champsLus({ ...pleine, instructeurSecond: "" }).map((c) => c.intitule)).toEqual(["Instructeur", "Thème", "Niveau", "Description"]);
  });

  /**
   * **La description est facultative, et une case vide ne la montre pas** — c'est ce qui rend un champ
   * de plus supportable sur une carte lue par tout le club (« un champ vide ne s'affiche pas du tout
   * aux membres, ni sa valeur ni son intitulé »). L'immense majorité des parties s'en passeront.
   */
  it("tait la description vide, et n'oublie pas de la montrer quand elle est écrite", () => {
    expect(champsLus({ ...pleine, description: "" }).map((c) => c.intitule)).toEqual(["Instructeur", "Second instructeur", "Thème", "Niveau"]);
    expect(champsLus({ ...pleine, description: "   " }).map((c) => c.intitule)).not.toContain("Description");
    // Une partie qui ne porte qu'une description parle quand même : c'est ce qu'elle est là pour dire.
    expect(champsLus({ instructeur: null, instructeurSecond: null, theme: "", niveau: "INDIFFERENT", description: "On révise les trois gardes." })).toEqual([
      { intitule: "Description", valeur: "On révise les trois gardes." },
    ]);
  });

  it("la lit en dernier : les quatre autres valeurs désignent en deux mots, celle-ci raconte", () => {
    expect(champsLus(pleine).at(-1)?.intitule).toBe("Description");
  });

  it("n'annonce pas un second sans premier : il assiste quelqu'un, et ce quelqu'un n'est pas là", () => {
    expect(champsLus({ ...pleine, instructeur: null }).map((c) => c.intitule)).toEqual(["Thème", "Niveau", "Description"]);
  });

  it("ignore un niveau inconnu, écrit par une autre version : « EXPERT » n'est pas du vocabulaire du club", () => {
    expect(champsLus({ ...pleine, niveau: "EXPERT" }).map((c) => c.intitule)).not.toContain("Niveau");
  });

  it("ne compte pas le nom de la partie parmi les valeurs lues : il se calcule, il ne se remplit pas", () => {
    // Le nom est écrit **au-dessus** de la case, comme titre de la ligne (`ListeParties`). Le mettre
    // dans cette liste laisserait croire qu'on peut le laisser vide — ce qui n'a plus de sens.
    expect(champsLus(pleine).map((c) => c.intitule)).not.toContain("Nom");
  });
});

describe("l'écran de réglage nomme ses champs à voix haute comme à l'œil", () => {
  const editeur = lire("src/components/planning/CaseEditeur.tsx");

  /**
   * Demande de. La vue membre avait été traitée (chaque valeur sous son nom, `champsLus`), l'écran
   * de réglage non : ses quatre listes déroulantes s'empilaient sans rien devant, et on lisait «
   * Damien Rochebrune / personne en second / Autre… / Intermédiaire » sans savoir lequel était
   * quoi. Les intitulés existaient, mais en `sr-only` — audibles, invisibles.
   */
  it("affiche les cinq titres, et pas seulement pour la synthèse vocale", () => {
    for (const mot of ["Instructeur", "Second instructeur", "Thème", "Niveau", "Description"]) {
      expect(editeur, mot).toContain(`<Intitule>${mot}</Intitule>`);
    }
  });

  it("ne les fait pas annoncer deux fois : le titre visible sort de l'arbre d'accessibilité", () => {
    // Le nom accessible du champ reste celui du `<label>` masqué ; sans `aria-hidden`, la synthèse
    // vocale dirait « Instructeur, Instructeur — Cours n°2 ».
    expect(editeur).toMatch(/function Intitule\([\s\S]*?aria-hidden="true"/);
  });

  it("garde intact le libellé masqué, par lequel la campagne de bout en bout retrouve une case", () => {
    // `label:text-is("Thème — …")` dans tests/e2e/planning-options.spec.ts : un second mot dans le
    // `<label>` casserait cette prise. Le titre visible est donc un élément à côté, pas dedans.
    for (const champ of ["instructeur", "instructeur-second", "theme", "niveau"]) {
      expect(editeur, champ).toContain(`<label className="sr-only" id={\`\${partieId}-${champ}-libelle\`}`);
    }
    for (const mot of ["Instructeur", "Second instructeur", "Thème", "Niveau"]) {
      expect(editeur, mot).toContain(mot + " — ${label}");
    }
    // La description n'est pas une `ListeDeroulante` (elle n'a donc pas de propriété `libelle`) : son
    // nom accessible vient du `<label>` masqué, avec exactement la même forme « Champ — <partie> ».
    expect(editeur).toMatch(/htmlFor=\{`\$\{partieId\}-description`\}>\s*\n\s*Description — \{label\}/);
  });
});

/**
 * **« Ce qui est publié doit être annoncé à qui le saisit. »**
 *
 * La description sort du club — pages de partage, et API publique si le club l'a ouverte. L'écran
 * où on l'écrit doit donc le dire, **au moment de la saisie**. C'est l'avertissement que portait le
 * champ du nom d'une partie avant de disparaître avec lui : on reprend ses mots plutôt que d'en
 * inventer d'autres.
 */
describe("la description annonce qu'elle sort du club", () => {
  const editeur = lire("src/components/planning/CaseEditeur.tsx");

  it("le dit sous le champ, dans les mots du dépôt", () => {
    expect(editeur).toMatch(/Cette description est publiée sur les pages de partage/);
    expect(editeur).toContain("visibles hors du club");
  });

  it("dit aussi ce qui ne sort pas : les noms des instructeurs", () => {
    // Le corollaire de la règle, et il compte autant : celui qui écrit doit savoir que son nom, lui,
    // reste dedans — sinon il s'autocensure là où il n'y a rien à craindre.
    expect(editeur).toMatch(/Les noms des instructeurs, eux, ne sortent jamais/);
  });

  it("annonce le plafond, et c'est celui que le champ applique", () => {
    // Un plafond annoncé et un plafond technique se relient par un test (règle du dossier) : ici, la
    // même constante sert au `maxLength` du champ, au schéma Zod et à la phrase.
    expect(editeur).toContain("maxLength={PARTIE_DESCRIPTION_MAX}");
    expect(editeur).toContain("{PARTIE_DESCRIPTION_MAX} signes au plus");
    expect(lire("src/lib/validation/gestion.ts")).toContain("texteCourt(PARTIE_DESCRIPTION_MAX");
    expect(PARTIE_DESCRIPTION_MAX).toBe(500);
  });

  it("est toujours dans la page pour les lecteurs d'écran, et visible dès qu'on entre dans le champ", () => {
    // Écrit en permanence sous chacune des parties de chacune des séances, il noierait la carte ;
    // absent du DOM, il n'existerait pas pour la synthèse vocale. D'où `aria-describedby` + `sr-only`.
    expect(editeur).toContain("aria-describedby={`${partieId}-description-avertissement`}");
    expect(editeur).toContain('descriptionEnSaisie ? "text-base text-texte-secondaire" : "sr-only"');
  });
});

describe("une étiquette de partie ne reste jamais seule", () => {
  const liste = lire("src/components/planning/ListeParties.tsx");

  it("saute la partie entière, en lecture, quand il n'y a aucun champ à lire", () => {
    /*
     * `CaseEditeur` ne rend rien quand `champsLus` est vide : l'étiquette de couleur restait alors
     * seule dans la carte — un « 2e option » rouille suivi de rien, qui se lit comme un affichage
     * tronqué. Cas réel : une partie qui ne porte qu'un **second** instructeur sans premier (donnée
     * héritée) passe le filtre d'amont — `caseVide` la voit remplie — mais n'affiche personne.
     */
    expect(liste).toContain("champsLus(partie).length === 0");
    expect(liste).toMatch(/if \(!modifiable && !partie\.atelier && champsLus\(partie\)\.length === 0\) return false;/);
    // Et la partie dont aucun élément ne se lit ne montre pas son intitulé.
    expect(liste).toContain(".filter((groupe) => groupe.elements.length > 0)");
  });

  it("garde l'étiquette côté encadrement : c'est la poignée qui renomme et retire la partie", () => {
    // Le filtre ne doit surtout pas s'appliquer à l'écran de réglage, où l'on vient remplir des
    // parties encore vides — sans poignée, on ne pourrait plus ni les nommer ni les supprimer.
    expect(liste).toContain("!modifiable &&");
  });
});

describe("les tailles des cases suivent la place disponible", () => {
  const editeur = lire("src/components/planning/CaseEditeur.tsx");

  it("étale vraiment les quatre réglages sur une rangée : quatre colonnes, **quatre** cases", () => {
    expect(editeur).toContain("xl:grid-cols-4");
    // Le défaut corrigé : la grille déclarait quatre colonnes mais ne portait que deux enfants
    // (instructeurs d'un côté, thème et niveau de l'autre), chacun empilant ses deux champs. Chaque
    // champ tombait au quart de la carte et tronquait les noms.
    //
    // Cinq blocs de ce gabarit : les **quatre** de la rangée, plus la **description**, qui est
    // volontairement *hors* de la grille — c'est une phrase, et le quart d'une carte ne se lit pas
    // (voir `CaseEditeur`). La grille, elle, s'arrête bien avant.
    //
    // Depuis le 06/10, le **thème** s'écrit sous deux formes exclusives dans la source : la liste
    // déroulante, ou — pour un atelier — son titre figé. Six blocs dans le fichier, cinq dans la
    // grille, mais toujours **quatre** rendus : une case n'est jamais les deux à la fois.
    expect(editeur.match(/className="flex min-w-0 flex-col gap-1\.5/g)).toHaveLength(6);
    const grille = editeur.slice(editeur.indexOf("xl:grid-cols-4"));
    expect(grille.slice(0, grille.indexOf("La description, sur toute la largeur")).match(/className="flex min-w-0 flex-col gap-1\.5/g)).toHaveLength(5);
    expect(editeur).toContain("{valeur.atelier && (");
  });

  it("ne tronque plus rien hors de l'affichage resserré", () => {
    // Le seul `truncate` qui reste est celui de la fiche compacte, et il est conditionné.
    for (const occurrence of editeur.match(/[^\n]*truncate[^\n]*/g) ?? []) {
      expect(occurrence, occurrence.trim()).toMatch(/compact/);
    }
  });
});

/**
 * **Deux mots, et deux seulement : cours et option**.
 *
 * L'écran d'édition disait « En parallèle » et « Ajouter une partie en parallèle », pendant que les
 * libellés qu'il engendre (« 1ère option »), la fiche de l'accueil, la ligne du planning et les trois
 * guides disaient tous **option**. Deux mots pour une même chose, dont un seul figure sur les lignes
 * qu'on lit en même temps — et « parallèle » décrit en plus un *déroulement*, pas une nature.
 *
 * Le commentaire du code a le droit de citer l'ancien mot : c'est là qu'il raconte pourquoi il a
 * disparu. Ce qui est interdit, c'est qu'il revienne **à l'écran**.
 */
describe("l'écran d'édition ne connaît que « cours » et « option »", () => {
  const LISTE_PARTIES = "src/components/planning/ListeParties.tsx";

  /** Le code sans ses commentaires : ce qui reste est ce que la personne peut lire. */
  function sansCommentaires(chemin: string): string {
    return fs.readFileSync(path.join(process.cwd(), chemin), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
  }

  it("ne montre le mot « parallèle » nulle part", () => {
    expect(sansCommentaires(LISTE_PARTIES)).not.toMatch(/parallèle/i);
  });

  it("nomme les natures par leur nom commun, et c'est le menu d'ajout qui les porte", () => {
    const code = sansCommentaires(LISTE_PARTIES);
    // Les mots viennent de `NOMS_NATURE` (« Échauffement », « Cours », « Option ») par le menu
    // « Ajouter dans la partie N… » (`entreesAjout`), et du nom calculé de chaque élément.
    expect(code).toContain("entreesAjout(");
    expect(code).toContain("nomElement(");
    // « Nouvelle option dans cette séance » était le titre du formulaire d'ajout. Le formulaire a
    // disparu avec le champ du nom : il n'existait que pour lui.
    expect(code).not.toContain("Nouvelle option dans cette séance");
  });
});
