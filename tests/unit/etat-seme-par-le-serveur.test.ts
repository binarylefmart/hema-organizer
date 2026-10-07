import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { cleValeurServeur } from "@/components/ui/valeur-serveur";

/**
 * **Un état semé par le serveur doit suivre la valeur du serveur.**
 *
 * C'est le troisième visage du défaut que garde déjà `valeurs-fraiches.test.ts` (« après
 * Enregistrer, l'écran réaffiche l'ancienne valeur »), et le seul que son balayage ne peut pas voir.
 * Là-bas, le champ est **non contrôlé** : sa valeur vient de `defaultValue`, React ne la relit qu'au
 * montage, et le remède est une `key` qui suit la valeur du serveur (`cleValeurServeur`). Ici, le
 * contrôle est **piloté** par React (`value=`) et sa valeur vient d'un `useState(propDuServeur)` :
 * l'état est **semé une fois**, au montage, et plus jamais relu. La règle écrite dans CLAUDE.md —
 * « un champ piloté par React n'a pas de clé » — exclut explicitement ce cas du balayage général, et
 * le balayage lui-même ne cherche que des `defaultValue` / `defaultChecked` dynamiques. Ce fichier
 * ferme ce trou.
 *
 * **Le scénario, relevé sur `/admin/membres`** après l'arrivée du changement de rôle en masse :
 *
 * 1. le bureau coche sept personnes et les passe instructeur. Les pastilles de la liste se mettent à
 *    jour : elles sont rendues par le serveur ;
 * 2. la liste déroulante du volet, elle, garde l'ancien rôle — son état a été semé au chargement de
 *    la page, et rien ne la remonte (la ligne garde son identité, `key={m.id}`) ;
 * 3. on en conclut que le lot n'a pas pris. On rouvre le volet, on choisit « Instructeur » : le
 *    serveur s'arrête aussitôt (`definirRoleMembre` : `if (role === cible.role) return {}`) et ce
 *    contrôle ne dit rien quand tout va bien. **Rien ne bouge**, ce qui confirme le doute ;
 * 4. réflexe suivant : basculer « Membre » puis « Instructeur » pour forcer. Et le premier de ces
 *    deux clics **écrit réellement MEMBRE** : le lot vient d'être défait à la main, ligne par ligne.
 *
 * Le remède est le même patron que les cases du planning (`vuDuServeur`, dans `CaseEditeur`) : un
 * miroir de la dernière valeur vue du serveur, comparé **au rendu**, qui ressème l'état dès que le
 * serveur bouge.
 */

/* ------------------------------------------------------------------ */
/* 1. Le défaut, joué de bout en bout                                  */
/* ------------------------------------------------------------------ */

/** Le serveur, réduit à ce qui compte : le rôle de chacun, et qui l'a écrit. */
class Serveur {
  ecritures: Array<{ userId: string; role: string }> = [];
  constructor(private roles: Record<string, string>) {}
  role(userId: string): string {
    return this.roles[userId];
  }
  /** `definirRoleMembre` : un rôle déjà en place ne s'écrit pas, et l'écran n'en est pas averti. */
  definirRole(userId: string, role: string): void {
    if (this.roles[userId] === role) return;
    this.roles[userId] = role;
    this.ecritures.push({ userId, role });
  }
  /** `definirRolesEnMasse` : le lot écrit, et la page repart du serveur (`revalidatePath`). */
  definirRolesEnMasse(userIds: string[], role: string): void {
    for (const userId of userIds) this.definirRole(userId, role);
  }
}

/**
 * La liste déroulante telle que React la tient : un état semé au montage, et un rendu serveur qui
 * arrive ensuite **sans remonter le composant** (la ligne garde sa `key`).
 */
class ListeDeroulante {
  /** Ce que le bureau lit dans la liste. */
  affiche: string;
  /** La dernière valeur du serveur vue par le composant — le miroir, quand il existe. */
  private miroir: string | null;
  constructor(
    private serveur: Serveur,
    private userId: string,
    private suitLeServeur: boolean,
  ) {
    this.affiche = serveur.role(userId);
    this.miroir = suitLeServeur ? this.affiche : null;
  }
  /** Un rendu serveur arrive (le lot a invalidé le chemin de la page). */
  rendre(): void {
    const duServeur = this.serveur.role(this.userId);
    if (!this.suitLeServeur) return; // l'état est semé une fois pour toutes
    if (this.miroir !== duServeur) {
      this.miroir = duServeur;
      this.affiche = duServeur;
    }
  }
  /** Un choix dans la liste : l'état suit, et l'action part. */
  choisir(role: string): void {
    this.affiche = role;
    this.serveur.definirRole(this.userId, role);
  }
}

describe("après un lot de rôles, la liste déroulante du volet", () => {
  it("semée une fois : elle ment, et le geste pour « forcer » rétrograde l'instructeur", () => {
    const serveur = new Serveur({ "u-chloe": "MEMBRE" });
    const liste = new ListeDeroulante(serveur, "u-chloe", false);

    serveur.definirRolesEnMasse(["u-chloe"], "INSTRUCTEUR");
    liste.rendre();
    // Les pastilles disent « Instructeur », la liste déroulante dit encore « Membre »
    expect(serveur.role("u-chloe")).toBe("INSTRUCTEUR");
    expect(liste.affiche).toBe("MEMBRE");

    // « Le lot n'a pas pris » : on choisit Instructeur. Le serveur s'arrête, l'écran ne dit rien.
    serveur.ecritures = [];
    liste.choisir("INSTRUCTEUR");
    expect(serveur.ecritures).toEqual([]);

    // Alors on bascule Membre puis Instructeur pour forcer — et le premier clic écrit MEMBRE.
    liste.choisir("MEMBRE");
    expect(serveur.role("u-chloe"), "l'instructeur du lot vient d'être rétrogradé").toBe("MEMBRE");
    expect(serveur.ecritures).toEqual([{ userId: "u-chloe", role: "MEMBRE" }]);
  });

  it("resynchronisée : elle suit le serveur, et le geste de forçage n'a plus lieu d'être", () => {
    const serveur = new Serveur({ "u-chloe": "MEMBRE" });
    const liste = new ListeDeroulante(serveur, "u-chloe", true);

    serveur.definirRolesEnMasse(["u-chloe"], "INSTRUCTEUR");
    liste.rendre();
    expect(liste.affiche).toBe("INSTRUCTEUR");

    // Rien à forcer : le rôle lu est le rôle écrit, dans la liste comme sur la pastille.
    serveur.ecritures = [];
    liste.choisir(liste.affiche);
    expect(serveur.ecritures).toEqual([]);
    expect(serveur.role("u-chloe")).toBe("INSTRUCTEUR");
  });

  it("ne ressème rien tant que le serveur ne bouge pas : un choix en vol n'est pas effacé", () => {
    const serveur = new Serveur({ "u-chloe": "MEMBRE" });
    const liste = new ListeDeroulante(serveur, "u-chloe", true);
    // Le choix est fait, l'action est partie, et la page se rafraîchit pour une autre raison
    liste.choisir("INSTRUCTEUR");
    liste.rendre();
    expect(liste.affiche).toBe("INSTRUCTEUR");
  });
});

/* ------------------------------------------------------------------ */
/* 2. Pourquoi le balayage général ne peut pas voir ce cas             */
/* ------------------------------------------------------------------ */

const lire = (relatif: string) => fs.readFileSync(path.join(process.cwd(), relatif), "utf8");
const SELECTEUR = "src/app/(app)/admin/membres/SelecteurRole.tsx";

describe("le trou du balayage de valeurs-fraiches.test.ts", () => {
  it("un contrôle piloté n'a pas de clé de remontage : la doctrine le dit elle-même", () => {
    // `cleValeurServeur` refuse par construction de poser une clé sur un champ piloté — c'est la
    // règle, et elle est juste : un remontage arracherait son état au composant.
    expect(cleValeurServeur({ value: "MEMBRE" })).toBeUndefined();
  });

  it("et le sélecteur de rôle n'offre aucun `defaultValue` à balayer", () => {
    const source = lire(SELECTEUR);
    // Le balayage ne cherche que des `defaultValue` / `defaultChecked` dynamiques sans `key` : ce
    // fichier n'en porte aucun, il est donc invisible pour lui de bout en bout.
    expect(source).not.toMatch(/defaultValue|defaultChecked/);
    // Piloté : la liste du dépôt (`ListeDeroulante`) reçoit l'état en `valeur=`, comme le `<select>`
    // qu'elle remplace le recevait en `value=` — et n'a donc, elle non plus, aucune clé à porter.
    expect(source).toMatch(/valeur=\{valeur\}/);
  });
});

/* ------------------------------------------------------------------ */
/* 3. Le balayage : TOUS les composants client, plus un seul fichier   */
/* ------------------------------------------------------------------ */

/**
 * **Ce balayage ne regardait qu'un fichier**, `SelecteurRole.tsx`, celui du défaut qui l'a fait
 * naître — et le troisième visage du même défaut est réapparu deux écrans plus loin, sur la fiche
 * d'une séance : `ThemeAutosave` semait `{theme, alternative}` une fois pour toutes pendant que le
 * formulaire du bas éditait **les mêmes** champs, lui avec clé de remontage. On mettait « Dague »
 * en bas, le widget du haut affichait encore « Messer », et le premier réglage de l'alternative
 * renvoyait « Messer » par-dessus « Dague », sous un « Enregistré automatiquement ».
 *
 * Une garde qui ne regarde qu'un fichier ne garde rien : elle atteste d'une réparation, elle
 * n'empêche pas la suivante. Le balayage porte donc sur **tous les composants client** du dépôt.
 *
 * **Ce qu'il cherche**, et rien d'autre : un `useState` du premier niveau d'un composant dont la
 * graine mentionne une de ses propriétés — c'est-à-dire un état *semé par le serveur*. Chacun doit
 * alors, au choix :
 *
 *  - **suivre le serveur** : un `if` du premier niveau du corps (donc évalué à chaque rendu) dont la
 *    condition porte sur cette propriété — ou sur une valeur qui en dérive — et qui ressème l'état ;
 *  - ou **figurer dans {@link SEMES_SANS_MIROIR}, avec sa raison écrite**. Beaucoup d'états semés
 *    n'ont rien à suivre : un formulaire de création, une position d'accordéon, une sélection en
 *    cours. Ce qui compte, c'est que le choix soit *fait* et *dit*, pas qu'il soit toujours le même.
 *
 * Le balayage lit la **source** (compilateur TypeScript) plutôt que le rendu : la configuration du
 * dépôt garde `jsx: "preserve"`, donc les tests unitaires ne transforment pas le JSX — même raison que
 * dans `valeurs-fraiches.test.ts`.
 */

type EtatSeme = { fichier: string; composant: string; etat: string; sème: string; suitLeServeur: boolean };

/** La clé d'un état dans la liste des exceptions : fichier, composant, nom de l'état. */
const cleEtat = (e: EtatSeme) => `${e.fichier}::${e.composant}::${e.etat}`;

/**
 * **Les états semés qui n'ont délibérément pas de miroir, et pourquoi.**
 *
 * Chaque ligne est une décision, pas une dispense : on l'écrit quand la valeur du serveur n'a aucune
 * raison de reprendre la main en cours de route. Un nouvel état semé qui n'entre dans aucun de ces
 * cas fait échouer le test — c'est tout l'objet du balayage.
 */
const SEMES_SANS_MIROIR: Record<string, string> = {
  // Formulaire de création : la « valeur du serveur » est un pré-remplissage de départ (le trimestre
  // courant, le calage de la grille), il n'existe aucun second chemin qui la changerait pendant la saisie.
  "src/app/(app)/admin/periodes/nouvelle/FormulairePeriode.tsx::FormulairePeriode::type": "création : rien à suivre",
  "src/app/(app)/admin/periodes/nouvelle/FormulairePeriode.tsx::FormulairePeriode::saison": "création : rien à suivre",
  "src/app/(app)/admin/periodes/nouvelle/FormulairePeriode.tsx::FormulairePeriode::saisonTexte": "création : rien à suivre",
  "src/app/(app)/admin/periodes/nouvelle/FormulairePeriode.tsx::FormulairePeriode::trimestre": "création : rien à suivre",
  "src/app/(app)/admin/periodes/nouvelle/FormulairePeriode.tsx::FormulairePeriode::decalage": "création : rien à suivre",
  "src/app/(app)/admin/periodes/nouvelle/FormulairePeriode.tsx::FormulairePeriode::bimestre": "création : rien à suivre",
  // Sélections en cours : ce sont des cases que la personne est en train de cocher avant d'envoyer.
  // Les ressemer sur un rendu serveur déferait le travail commencé — l'inverse du service rendu.
  "src/app/(app)/admin/periodes/[id]/Formulaires.tsx::InstructeursPeriode::choix": "sélection en cours, pas une valeur enregistrée",
  "src/app/(app)/admin/periodes/[id]/SelectionDates.tsx::SelectionDates::cochees": "sélection en cours, pas une valeur enregistrée",
  // Le lieu choisi pour « Changer le lieu » d'un lot de séances : un réglage du geste en cours, semé
  // par la seule présence (ou non) de lieux du club — il ne reflète aucune valeur enregistrée.
  "src/components/seances/SelectionSeances.tsx::SelectionSeances::choixLieu": "réglage d'un geste en cours, pas une valeur enregistrée",
  // Position d'un dépliant : un état d'écran, jamais écrit en base. Rien à écraser, rien à suivre.
  "src/components/accueil/Frise.tsx::Frise::ouvert": "état d'affichage (quelle colonne est ouverte)",
  "src/components/accueil/FriseDetail.tsx::FriseDetail::ouvert": "état d'affichage (animation déjà jouée)",
  // Le thème appliqué tout de suite dans le navigateur : c'est l'écran qui mène, et le serveur
  // enregistre derrière. Une valeur du serveur qui reprendrait la main ferait clignoter la page.
  "src/app/(app)/profil/SelecteurTheme.tsx::SelecteurTheme::choix": "réglage appliqué localement, le serveur suit",
  // Formulaire d'un événement : **seul éditeur** de ces quatre champs sur son écran, et ils ne se
  // règlent nulle part ailleurs. Le défaut connu de cet écran (le formulaire à moitié vidé après
  // « Événement créé. ») n'est pas un état qui mentirait, c'est une action qui ne redirige pas : voir
  // `creerEvenement` (`src/actions/evenements.ts`), qui doit finir par un `redirect` comme `creerSeance`.
  "src/components/evenements/FormulaireEvenement.tsx::FormulaireEvenement::nom": "éditeur unique de ce champ sur l'écran",
  "src/components/evenements/FormulaireEvenement.tsx::FormulaireEvenement::description": "éditeur unique de ce champ sur l'écran",
  "src/components/evenements/FormulaireEvenement.tsx::FormulaireEvenement::imageUrl": "éditeur unique de ce champ sur l'écran",
  "src/components/evenements/FormulaireEvenement.tsx::FormulaireEvenement::lienSource": "éditeur unique de ce champ sur l'écran",
  // Le lieu d'une séance : deux états qui traduisent une seule valeur en « salle connue ou adresse
  // libre ». Éditeur unique lui aussi, dans un formulaire à bouton « Enregistrer ».
  "src/components/gestion/SelecteurLieu.tsx::SelecteurLieu::choix": "éditeur unique de ce champ sur l'écran",
  "src/components/gestion/SelecteurLieu.tsx::SelecteurLieu::libre": "éditeur unique de ce champ sur l'écran",
  // L'assistant « Proposer un atelier » du téléphone : une proposition neuve, semée par la seule
  // identité de qui propose (« Moi » anime par défaut). Rien d'enregistré à suivre pendant la saisie.
  "src/components/ateliers/AssistantAtelier.tsx::AssistantAtelier::saisie": "création : rien à suivre",
  "src/components/ateliers/AssistantAtelier.tsx::AssistantAtelier::animePar": "création : rien à suivre",
};

/** Tous les `.tsx` du dossier `src`, du plus haut au plus bas. */
function fichiersTsx(dossier: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(path.join(process.cwd(), dossier), { withFileTypes: true })) {
    const relatif = `${dossier}/${e.name}`;
    if (e.isDirectory()) out.push(...fichiersTsx(relatif));
    else if (e.name.endsWith(".tsx")) out.push(relatif);
  }
  return out.sort();
}

/** Les fonctions d'un fichier qui reçoivent des propriétés déstructurées : ses composants. */
function composantsDe(source: ts.SourceFile): Array<{ nom: string; props: string[]; corps: ts.Block }> {
  const trouves: Array<{ nom: string; props: string[]; corps: ts.Block }> = [];
  const visiter = (n: ts.Node) => {
    let nom: string | undefined;
    let params: readonly ts.ParameterDeclaration[] | undefined;
    let corps: ts.Block | undefined;
    if (ts.isFunctionDeclaration(n) && n.body) {
      nom = n.name?.text;
      params = n.parameters;
      corps = n.body;
    } else if (
      ts.isVariableDeclaration(n) &&
      n.initializer &&
      (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer)) &&
      ts.isBlock(n.initializer.body)
    ) {
      nom = n.name.getText();
      params = n.initializer.parameters;
      corps = n.initializer.body;
    }
    if (nom && corps && params) {
      const premier = params[0]?.name;
      const props = premier && ts.isObjectBindingPattern(premier) ? premier.elements.map((e) => e.name.getText()) : [];
      if (props.length > 0) trouves.push({ nom, props, corps });
    }
    ts.forEachChild(n, visiter);
  };
  ts.forEachChild(source, visiter);
  return trouves;
}

const mentionne = (texte: string, nom: string) => new RegExp(`\\b${nom.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(texte);

/** Les noms déclarés par une déclaration, motif de déstructuration compris. */
function nomsDeclares(nom: ts.BindingName): string[] {
  if (ts.isIdentifier(nom)) return [nom.text];
  return nom.elements.flatMap((e) => (ts.isOmittedExpression(e) ? [] : nomsDeclares(e.name)));
}

/**
 * Les états semés d'un composant, et ceux qui suivent le serveur.
 *
 * Un état est « semé » quand son `useState` part d'une propriété du composant, c'est-à-dire d'une
 * valeur venue du rendu serveur. Il « suit le serveur » quand le corps du composant compare cette
 * propriété **au rendu** (un `if` parmi ses instructions, pas dans un gestionnaire d'événement ni
 * dans un effet) et ressème l'état dans la foulée.
 *
 * La comparaison a le droit de porter sur une valeur **dérivée** de la propriété : les cases du
 * planning comparent `paireServeur(valeur)`, pas `valeur`. On suit donc les noms dérivés de proche en
 * proche, au premier niveau du corps.
 */
function etatsSemes(relatif: string, filtre?: string): EtatSeme[] {
  const source = ts.createSourceFile(relatif, lire(relatif), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const resultats: EtatSeme[] = [];
  for (const composant of composantsDe(source)) {
    if (filtre && composant.nom !== filtre) continue;
    const etats: Array<{ etat: string; setteur: string; graine: string }> = [];
    // Les noms qui « parlent du serveur » : les propriétés, puis tout ce qui en dérive.
    const duServeur = new Set(composant.props);
    for (const instruction of composant.corps.statements) {
      if (!ts.isVariableStatement(instruction)) continue;
      for (const d of instruction.declarationList.declarations) {
        const init = d.initializer;
        if (init && ts.isCallExpression(init) && init.expression.getText() === "useState") {
          if (!ts.isArrayBindingPattern(d.name) || d.name.elements.length < 2) continue;
          const [etat, setteur] = d.name.elements.map((e) => e.getText());
          etats.push({ etat, setteur, graine: init.arguments.map((a) => a.getText()).join(", ") });
          continue;
        }
        // Une valeur dérivée d'une propriété (ou d'une autre dérivée) parle encore du serveur.
        if (init && [...duServeur].some((n) => mentionne(init.getText(), n))) {
          for (const nom of nomsDeclares(d.name)) duServeur.add(nom);
        }
      }
    }
    const resynchros = composant.corps.statements.filter(ts.isIfStatement).map((si) => {
      const setteurs: string[] = [];
      const visiter = (n: ts.Node) => {
        if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) setteurs.push(n.expression.text);
        ts.forEachChild(n, visiter);
      };
      visiter(si.thenStatement);
      return { condition: si.expression.getText(), setteurs };
    });
    for (const e of etats) {
      const sème = composant.props.find((p) => mentionne(e.graine, p));
      if (!sème) continue;
      resultats.push({
        fichier: relatif,
        composant: composant.nom,
        etat: e.etat,
        sème,
        suitLeServeur: resynchros.some(
          (r) => [...duServeur].some((n) => mentionne(r.condition, n)) && r.setteurs.includes(e.setteur),
        ),
      });
    }
  }
  return resultats;
}

/** Tous les états semés du dépôt : les composants client, et eux seuls (le serveur n'a pas d'état). */
function tousLesEtatsSemes(): EtatSeme[] {
  return fichiersTsx("src")
    .filter((f) => lire(f).startsWith('"use client"'))
    .flatMap((f) => etatsSemes(f));
}

describe("tout état semé par le serveur suit le serveur, ou dit pourquoi il ne le suit pas", () => {
  const semes = tousLesEtatsSemes();

  it("le balayage trouve bien des états semés dans plusieurs fichiers", () => {
    // Un balayage cassé (chemin, extension, `"use client"` déplacé) rendrait une liste vide et
    // passerait au vert sans rien vérifier : c'est le premier risque d'une garde de ce genre.
    expect(semes.length).toBeGreaterThan(10);
    expect(new Set(semes.map((s) => s.fichier)).size).toBeGreaterThan(4);
  });

  it("aucun état semé n'ignore le serveur sans raison écrite", () => {
    const sansMiroir = semes.filter((s) => !s.suitLeServeur && !(cleEtat(s) in SEMES_SANS_MIROIR));
    expect(
      sansMiroir.map(cleEtat),
      "un `useState(props.x)` n'est semé qu'au montage : ajoute-lui un miroir `vuDuServeur`, ou inscris-le dans SEMES_SANS_MIROIR avec sa raison",
    ).toEqual([]);
  });

  it("la liste des exceptions ne pourrit pas : chaque ligne désigne un état qui existe encore", () => {
    const vus = new Set(semes.map(cleEtat));
    expect(Object.keys(SEMES_SANS_MIROIR).filter((c) => !vus.has(c))).toEqual([]);
    // Et une exception n'est jamais vide : c'est la raison qui fait la décision.
    for (const [cle, raison] of Object.entries(SEMES_SANS_MIROIR)) expect(raison.length, cle).toBeGreaterThan(10);
  });
});

describe("SelecteurRole : son état est semé par le serveur, il doit le suivre", () => {
  const semes = etatsSemes(SELECTEUR, "SelecteurRole");

  it("le rôle affiché est bien un état semé par le serveur", () => {
    expect(semes.map((s) => `${s.etat} ← ${s.sème}`)).toContain("valeur ← role");
  });

  it("chaque état semé est resynchronisé au rendu, miroir compris", () => {
    // Le miroir (`vuDuServeur`) est semé lui aussi : s'il ne se remettait pas à jour, la
    // comparaison ne serait vraie qu'une fois et le correctif ne tiendrait qu'un changement.
    expect(semes.filter((s) => !s.suitLeServeur)).toEqual([]);
    expect(semes.length).toBeGreaterThanOrEqual(2);
  });
});

