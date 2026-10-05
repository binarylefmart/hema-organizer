import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { gestesSeance } from "@/components/seances/gestes-seance";

/**
 * **Le filet qui manquait : une server action sans garde ne doit pas pouvoir naître.**
 *
 * Un module `"use server"` expose chacune de ses fonctions exportées comme un **point d'entrée HTTP**,
 * atteignable par quiconque sait en former l'appel — que le fichier vive dans `src/actions/` ou à côté
 * de son écran. Le dépôt se protège déjà par balayage sur d'autres familles de défauts — les
 * `defaultValue` qui mentent (`valeurs-fraiches.test.ts`), les plafonds annoncés et techniques qui se
 * contredisent, les constantes homonymes, les neuf modules d'envoi et leur clé de déduplication — mais
 * rien ne vérifiait **le contrôle d'accès**, alors que CLAUDE.md l'exige noir sur blanc (« contrôle
 * d'accès vérifié côté serveur sur chaque route/action »). Une action oubliée n'échoue nulle part :
 * elle marche, et pour tout le monde.
 *
 * Trois balayages, écrits après la relecture de sécurité — chacun aurait attrapé un des défauts
 * qu'elle a trouvés :
 *
 *  1. **une garde par export** : `assertPermission`, `requirePermission`, `requireUser`,
 *     `exigerReauth`, ou `getCurrentUser` suivi d'un refus. Les exceptions se déclarent une par une,
 *     **avec leur raison écrite** : un tableau de noms nus se remplit tout seul et ne se relit jamais ;
 *  2. **effacer des réponses de membres : la même serrure à toutes les portes** — `supprimerSeance`
 *     demandait `sessions.manage` (donc un instructeur, sans élévation) et effaçait la séance *et* ses
 *     réponses, quand son jumeau `supprimerSeancesPeriode` exigeait `periods.manage` pour cette raison
 *     précise. Deux portes vers la même destruction, deux serrures : le balayage les compare ;
 *  3. **une période close verrouille aussi ses séances** — modifier, réécrire le thème, annuler (donc
 *     envoyer emails, Discord et Telegram) et effacer passaient tous sur un trimestre clos, alors que
 *     le planning refusait déjà.
 *
 * On lit la **source** (compilateur TypeScript) et non les modules : importer un `"use server"` ici
 * n'apprendrait rien de ce qu'il vérifie avant d'écrire, et le balayage doit voir les fichiers que
 * personne n'a encore pensé à tester.
 */

/**
 * **On cherche les modules serveur par leur directive, pas par leur dossier.** `src/actions/**` en
 * tient l'essentiel, mais pas tout : deux écrans gardent leurs actions à côté d'eux
 * (`src/app/(app)/admin/membres/actions.ts`, `src/app/(public)/desinscription/actions.ts`), et c'est
 * précisément le genre de fichier qu'une liste de dossiers oublie. Ce qui définit un point d'entrée
 * HTTP, c'est `"use server"` en tête de fichier — donc c'est lui qu'on cherche.
 */
const RACINE = "src";

/** Ce qui compte comme garde, sans rien connaître de l'appelant : les portes de `auth/current-user`. */
const GARDES_FORTES = ["assertPermission", "requirePermission", "requireUser", "exigerReauth"];

/**
 * **Les exports qui n'ont délibérément pas de garde, et pourquoi.**
 *
 * Chaque ligne est une décision, pas une dispense. Toutes disent la même chose sous une forme
 * différente : **ces actions sont les portes d'entrée de qui n'est pas encore connecté**, et ce qui
 * remplace la session y est nommé — un mot de passe, un code, un jeton signé, un limiteur. Une action
 * qui écrit sur les données du club n'a rien à faire dans cette liste.
 *
 * Un export nouveau qui n'entre dans aucun de ces cas fait échouer le balayage, et une ligne devenue
 * inutile le fait échouer aussi : une exception qu'on a oublié de retirer finit par couvrir une action
 * qui n'est plus la même.
 */
const SANS_GARDE_ASSUME: Record<string, string> = {
  // La connexion elle-même : on n'est par définition pas connecté. Le mot de passe (argon2id) tient le
  // rôle de la garde, avec un limiteur par IP et par compte, et un message générique (pas d'énumération).
  "src/actions/auth.ts::seConnecter": "porte d'entrée : mot de passe + limiteur, pas de session à vérifier",
  "src/actions/auth.ts::verifierCode2fa": "second facteur de la connexion en deux temps : l'attente signée tient lieu de session",
  "src/actions/auth.ts::passerDeuxFa": "même attente signée (`lireAttente2fa`), et un ADMIN ne peut pas passer",
  "src/actions/auth.ts::annulerConnexion2fa": "abandon de la connexion : n'écrit rien, ferme l'attente et repart sur /connexion",
  // « Mot de passe oublié » : la personne est dehors, c'est tout l'objet du parcours. Réponse toujours
  // identique (aucune énumération de comptes), limiteur par IP et par adresse, lien à usage unique 30 min.
  "src/actions/auth.ts::demanderReinitialisation": "parcours de qui est dehors : réponse générique + limiteur",
  "src/actions/auth.ts::reinitialiserMotDePasse": "jeton de réinitialisation à usage unique (30 min) en guise de preuve",
  // Se déconnecter n'a rien à garder : sans session, il n'y a rien à détruire et on repart sur /connexion.
  "src/actions/auth.ts::seDeconnecter": "geste de sortie : rien à protéger, et sans session il ne fait rien",
  // Fin du parcours d'activation : elle referme l'affichage des codes de secours et redirige. Elle
  // n'écrit rien sur un compte, et sans session elle ne fait que renvoyer vers la page demandée.
  "src/actions/auth.ts::confirmerCodesSecours": "ferme l'affichage des codes et redirige : aucune écriture sur un compte",
  // Les deux portes du lien personnel : le **jeton** est la preuve d'identité, vérifié par
  // `checkInvitation` (existence, échéance, révocation), avec limiteur par IP, comptage des jetons
  // inconnus et alerte de balayage. Exiger une session ici fermerait la seule porte de qui n'en a pas.
  "src/actions/auth.ts::connexionParInvitation": "le jeton du lien personnel EST la preuve (`checkInvitation`) + limiteur par IP",
  "src/actions/auth.ts::ouvrirParLienColle": "même chemin de vérification, pour l'app installée qui n'a pas de barre d'adresse",
  "src/actions/auth.ts::renvoyerLienExpire":
    "porte de qui est dehors : son lien a expiré, il n'a donc ni session ni mot de passe forcément. Le jeton expiré tient lieu de preuve — il nomme la personne à qui écrire —, et l'action refuse tout autre état de lien. Limiteur par IP et un renouvellement par jour et par personne",
  // Le seul geste du dépôt qui écrit sans session, et il est documenté comme tel : le jeton est
  // **nominatif** (signé avec le compte destinataire), revérifié au clic (compte actif, toujours
  // habilité, trimestre encore ouvert), le porteur est journalisé comme acteur, et un limiteur le borne.
  "src/actions/seances.ts::annulerDepuisEmail": "lien signé nominatif (`porteurJetonAnnulation`) + limiteur, à usage unique",
  // Les deux bascules du lien de désinscription, au pied des emails : **aucune connexion n'est
  // demandée, c'est le principe d'un lien de désinscription**. Le jeton signé (valable un an) nomme sa
  // personne et ne sait rien faire d'autre que basculer son `User.rappelEmail` ; elles sont ici parce
  // qu'elles écrivent sur un POST, justement pour qu'un préchargement de messagerie ne le fasse pas.
  "src/app/(public)/desinscription/actions.ts::confirmerDesinscription": "jeton signé nominatif, ne bascule que `rappelEmail` de sa propre personne",
  "src/app/(public)/desinscription/actions.ts::reactiverRappels": "même jeton, geste inverse : un lien de désinscription ne demande jamais de session",
};

/** Tous les `.ts` **et `.tsx`** d'un dossier, sous-dossiers compris. */
function fichiersTs(dossier: string): string[] {
  return fs.readdirSync(dossier, { withFileTypes: true }).flatMap((e) => {
    const complet = path.join(dossier, e.name);
    if (e.isDirectory()) return fichiersTs(complet);
    return e.name.endsWith(".ts") || e.name.endsWith(".tsx") ? [complet] : [];
  });
}

const source = (fichier: string) =>
  ts.createSourceFile(
    fichier,
    fs.readFileSync(path.join(process.cwd(), fichier), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    fichier.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

/**
 * **La directive se reconnaît par l'AST, jamais par le début du texte**.
 *
 * Le filtre était `contenu.trimStart().startsWith('"use server"')`, et trois écritures **légales**
 * lui échappaient — vérifiées avec le compilateur SWC que ce dépôt utilise pour construire, qui
 * émettait bien un `registerServerReference` dans les trois cas :
 *
 * - `'use server'` en **apostrophes** (rien ne normalise les guillemets : pas de Prettier dans ce
 *   dépôt, et la configuration ESLint n'étend que `next/core-web-vitals` + `next/typescript`) ;
 * - un **commentaire JSDoc avant la directive** — et c'est le style dominant du dépôt : `membres.ts`,
 *   `acces-admin.ts`, `push.ts` commencent tous par un en-tête. Poser `"use server"` sous l'en-tête
 *   d'un tel fichier est le geste naturel, et il sortait du balayage **sans bruit** ;
 * - un `// commentaire` avant la directive.
 *
 * Un module non ramassé ne déclenchait aucune alerte : il disparaissait, simplement. D'où aussi la
 * liste figée plus bas — un module invisible doit **crier**, pas s'effacer.
 *
 * `.tsx` compte désormais, parce qu'un module `"use server"` peut parfaitement en être un (la forme
 * la plus idiomatique des server actions modernes), et `fichiersTs` ne regardait que `.ts`.
 */
function porteLaDirectiveServeur(fichier: string): boolean {
  for (const st of source(fichier).statements) {
    // Les directives sont les premières instructions, et ce sont des littéraux de chaîne nus.
    if (!ts.isExpressionStatement(st) || !ts.isStringLiteralLike(st.expression)) return false;
    if (st.expression.text === "use server") return true;
  }
  return false;
}

const FICHIERS = fichiersTs(path.join(process.cwd(), RACINE))
  .map((f) => path.relative(process.cwd(), f))
  .filter(porteLaDirectiveServeur)
  .sort();

type Fonction = { nom: string; exportee: boolean; corps: ts.Node };

/**
 * Les fonctions de premier niveau d'un module, exportées ou non — `export async function` comme
 * `export const … = async => …`. Les `export type` n'écrivent rien, ils ne sont pas des points
 * d'entrée. Les fonctions **non exportées** comptent quand même : ce sont les portes locales dans
 * lesquelles un module factorise sa garde (`enReglageDacces`, dans `auth.ts`, en est une).
 */
function fonctionsDuModule(fichier: string): Fonction[] {
  const out: Fonction[] = [];
  for (const st of source(fichier).statements) {
    const exportee = ts.canHaveModifiers(st) && (ts.getModifiers(st) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (ts.isFunctionDeclaration(st) && st.name) {
      out.push({ nom: st.name.text, exportee, corps: st });
    } else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || !d.initializer) continue;
        if (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer)) out.push({ nom: d.name.text, exportee, corps: d });
      }
    }
  }
  return out;
}

/**
 * **Les formes d'export que le modèle ci-dessus ne sait PAS lire** — et qui doivent donc faire
 * échouer le balayage plutôt que d'être ignorées en silence.
 *
 * `fonctionsDuModule` ne voit qu'un `export async function nommée` et un `export const x = async …`.
 * Vérifié au compilateur : `export { effacerTout as purger }` produit bien un point d'entrée HTTP
 * (`registerServerReference`), et le balayage n'en voyait **aucun** — pire, la fonction était vue
 * comme « non exportée », donc elle entrait dans le calcul des portes locales et pouvait **blanchir
 * ses appelantes** tout en étant elle-même un point d'entrée jamais vérifié.
 *
 * Aucun des modules du dépôt n'emploie ces formes aujourd'hui. Le jour où l'un d'eux le fera, ce
 * test dira lequel, au lieu de laisser un trou.
 */
function exportsNonModelises(fichier: string): string[] {
  const out: string[] = [];
  for (const st of source(fichier).statements) {
    const exportee = ts.canHaveModifiers(st) && (ts.getModifiers(st) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (ts.isExportDeclaration(st)) out.push(st.exportClause ? "export { … }" : "export * from …");
    else if (ts.isExportAssignment(st)) out.push("export =");
    else if (exportee && ts.isFunctionDeclaration(st) && !st.name) out.push("export default function anonyme");
    else if (exportee && ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (!ts.isIdentifier(d.name)) out.push("export const déstructuré");
        else if (d.initializer && !ts.isArrowFunction(d.initializer) && !ts.isFunctionExpression(d.initializer)) {
          // `export const x = withLog(async => …)` ou un objet d'actions : une valeur que le
          // modèle ne sait pas suivre, donc un point d'entrée possible qu'il ne vérifiera pas.
          if (!ts.isLiteralExpression(d.initializer) && !ts.isObjectLiteralExpression(d.initializer)) out.push(`export const ${d.name.text} = <appel>`);
          else if (ts.isObjectLiteralExpression(d.initializer)) out.push(`export const ${d.name.text} = { … }`);
        }
      }
    }
  }
  return out;
}

/** Les fonctions appelées dans un corps, par leur nom simple (`db.session.delete` → `delete`). */
function appels(n: ts.Node): Set<string> {
  const noms = new Set<string>();
  const visiter = (x: ts.Node) => {
    if (ts.isCallExpression(x)) {
      const cible = x.expression;
      if (ts.isIdentifier(cible)) noms.add(cible.text);
      else if (ts.isPropertyAccessExpression(cible)) noms.add(cible.name.text);
    }
    ts.forEachChild(x, visiter);
  };
  ts.forEachChild(n, visiter);
  return noms;
}

/** Le texte d'un appel tel qu'il est écrit (`db.session.delete`, `assertPermission`) : pour viser une table. */
function appelsEcrits(n: ts.Node): string[] {
  const out: string[] = [];
  const visiter = (x: ts.Node) => {
    if (ts.isCallExpression(x)) out.push(x.expression.getText().replace(/\s+/g, ""));
    ts.forEachChild(x, visiter);
  };
  ts.forEachChild(n, visiter);
  return out;
}

/** Les arguments littéraux d'un appel donné (`assertPermission("periods.manage")` → `periods.manage`). */
function argumentsLitteraux(n: ts.Node, fonction: string): string[] {
  const out: string[] = [];
  const visiter = (x: ts.Node) => {
    if (ts.isCallExpression(x) && x.expression.getText().replace(/\s+/g, "") === fonction) {
      for (const a of x.arguments) if (ts.isStringLiteralLike(a)) out.push(a.text);
    }
    ts.forEachChild(x, visiter);
  };
  ts.forEachChild(n, visiter);
  return out;
}

/** Une branche qui sort : `return`, `throw`, ou une redirection (qui lève). */
function sortEnRefusant(n: ts.Node): boolean {
  let sort = false;
  const visiter = (x: ts.Node) => {
    if (ts.isReturnStatement(x) || ts.isThrowStatement(x)) sort = true;
    if (ts.isCallExpression(x) && ["redirect", "notFound"].includes(x.expression.getText())) sort = true;
    ts.forEachChild(x, visiter);
  };
  visiter(n);
  return sort;
}

/**
 * `getCurrentUser` **suivi d'un refus** : la lecture seule de la session ne garde rien, c'est le
 * `if (!user …) return | throw | redirect` qui garde. On exige donc les deux, et sur la **même**
 * variable — celle qui a reçu la session.
 */
function refuseUnInconnu(fn: ts.Node): boolean {
  const issuesDeLaSession = new Set<string>();
  const repererVariables = (x: ts.Node) => {
    if (ts.isVariableDeclaration(x) && ts.isIdentifier(x.name) && x.initializer && appels(x).has("getCurrentUser")) {
      issuesDeLaSession.add(x.name.text);
    }
    ts.forEachChild(x, repererVariables);
  };
  ts.forEachChild(fn, repererVariables);
  if (issuesDeLaSession.size === 0) return false;

  let refuse = false;
  const chercherLeRefus = (x: ts.Node) => {
    if (ts.isIfStatement(x)) {
      const nie = (c: ts.Node): boolean => {
        if (ts.isPrefixUnaryExpression(c) && c.operator === ts.SyntaxKind.ExclamationToken) {
          const op = c.operand;
          if (ts.isIdentifier(op) && issuesDeLaSession.has(op.text)) return true;
        }
        return ts.forEachChild(c, nie) ?? false;
      };
      if (nie(x.expression) && sortEnRefusant(x.thenStatement)) refuse = true;
    }
    ts.forEachChild(x, chercherLeRefus);
  };
  ts.forEachChild(fn, chercherLeRefus);
  return refuse;
}

/**
 * Les fonctions **gardées** d'un module, par point fixe : celles qui appellent une garde forte ou
 * refusent un inconnu, puis celles qui appellent l'une des précédentes. C'est ce qui rend légitime la
 * factorisation d'une garde dans une porte locale — `auth.ts` en a trois — sans ouvrir la porte à
 * l'inverse : une fonction qui n'appelle **rien** de gardé reste nue.
 */
function gardees(fonctions: Fonction[]): Set<string> {
  const gardes = new Set<string>(GARDES_FORTES);
  for (let tour = 0; tour < fonctions.length + 1; tour += 1) {
    let bouge = false;
    for (const f of fonctions) {
      if (gardes.has(f.nom)) continue;
      const appelees = appels(f.corps);
      if (GARDES_FORTES.some((g) => appelees.has(g)) || refuseUnInconnu(f.corps) || [...appelees].some((a) => gardes.has(a))) {
        gardes.add(f.nom);
        bouge = true;
      }
    }
    if (!bouge) break;
  }
  return gardes;
}

describe("balayage : chaque export d'un module « use server » porte une garde", () => {
  /**
   * **La liste des modules ramassés est figée, pour qu'un module invisible crie au lieu de
   * disparaître**. Le test ne vérifiait qu'un seuil (« plus de dix dans `src/actions/` ») et deux
   * noms : un module `"use server"` que le filtre ne voyait pas n'échouait nulle part, il était
   * simplement absent du balayage.
   *
   * Ajouter un module d'actions **doit** faire échouer ce test : c'est le moment où quelqu'un relit
   * la liste et constate que le nouveau venu y est bien.
   */
  it("la liste des modules ramassés est exactement celle-là", () => {
    expect(FICHIERS).toEqual([
      "src/actions/admin.ts",
      "src/actions/ateliers.ts",
      "src/actions/auth.ts",
      "src/actions/evenements.ts",
      "src/actions/identite.ts",
      "src/actions/liens.ts",
      "src/actions/membres.ts",
      "src/actions/periodes.ts",
      "src/actions/planning.ts",
      "src/actions/presences.ts",
      "src/actions/profil.ts",
      "src/actions/push.ts",
      "src/actions/seances.ts",
      "src/app/(app)/admin/comptes/actions.ts",
      "src/app/(app)/admin/membres/actions.ts",
      "src/app/(public)/desinscription/actions.ts",
    ]);
  });

  /**
   * **Aucune forme d'export que le balayage ne sait pas lire.** Un `export { x as y }` est un point
   * d'entrée HTTP réel (vérifié au compilateur) que `fonctionsDuModule` ne voyait pas du tout — et
   * qui était même compté comme « porte locale », donc capable de blanchir ses appelantes.
   */
  it("aucun module n'emploie une forme d'export que le balayage ne modélise pas", () => {
    for (const fichier of FICHIERS) {
      expect(exportsNonModelises(fichier), `${fichier} : forme d'export non modélisée`).toEqual([]);
    }
  });

  it("tous les modules de src/actions sont trouvés, et ceux qui vivent ailleurs aussi", () => {
    // Le balayage ne vaut que s'il voit tout : on vérifie qu'il a bien ramassé les treize modules du
    // dossier `src/actions` **et** les deux qui vivent à côté de leur écran.
    expect(FICHIERS.filter((f) => f.startsWith("src/actions/")).length).toBeGreaterThan(10);
    expect(FICHIERS).toContain("src/app/(app)/admin/membres/actions.ts");
    expect(FICHIERS).toContain("src/app/(public)/desinscription/actions.ts");
  });

  it("aucun point d'entrée n'écrit sans avoir vérifié qui appelle", () => {
    const nus: string[] = [];
    for (const fichier of FICHIERS) {
      const fonctions = fonctionsDuModule(fichier);
      const gardes = gardees(fonctions);
      for (const f of fonctions) {
        if (!f.exportee) continue;
        const cle = `${fichier}::${f.nom}`;
        if (gardes.has(f.nom) || cle in SANS_GARDE_ASSUME) continue;
        nus.push(cle);
      }
    }
    expect(nus).toEqual([]);
  });

  it("la liste des exceptions ne garde aucune ligne périmée", () => {
    const existants = new Set(FICHIERS.flatMap((f) => fonctionsDuModule(f).filter((x) => x.exportee).map((x) => `${f}::${x.nom}`)));
    const fantomes = Object.keys(SANS_GARDE_ASSUME).filter((cle) => !existants.has(cle));
    expect(fantomes).toEqual([]);
  });

  it("chaque exception porte une raison écrite, pas un nom nu", () => {
    for (const [cle, raison] of Object.entries(SANS_GARDE_ASSUME)) {
      expect(raison.length, `${cle} : raison trop courte pour dire quoi que ce soit`).toBeGreaterThan(25);
    }
  });
});

/**
 * **Effacer les réponses des membres : une seule serrure, à toutes les portes.**
 *
 * Trois gestes du dépôt emportent des `Attendance` en cascade — la séance, les séances d'une
 * période, la période. Le, le premier demandait `sessions.manage` (l'encadrement, sans élévation)
 * et les deux autres `periods.manage` / `periods.delete` : un instructeur vidait donc un trimestre
 * séance par séance depuis un bouton qu'on lui affichait, alors que le même geste en un clic depuis
 * l'écran de la période lui était refusé. Ce balayage va chercher les portes **par ce qu'elles
 * font** (un `delete` sur la table des séances ou des périodes), et non par leur nom : la
 * quatrième, le jour où quelqu'un l'écrira, sera trouvée aussi.
 */
const TABLES_PORTEUSES_DE_REPONSES = ["db.session.delete", "db.session.deleteMany", "db.period.delete", "db.period.deleteMany"];
const PERMISSIONS_DU_BUREAU = ["periods.manage", "periods.delete"];

describe("balayage : la destruction des réponses des membres appartient au bureau", () => {
  it("toute action qui efface une séance ou un trimestre exige periods.* et l'élévation", () => {
    const fautives: string[] = [];
    for (const fichier of FICHIERS) {
      for (const f of fonctionsDuModule(fichier)) {
        if (!f.exportee) continue;
        const ecrits = appelsEcrits(f.corps);
        if (!TABLES_PORTEUSES_DE_REPONSES.some((t) => ecrits.includes(t))) continue;
        const permissions = argumentsLitteraux(f.corps, "assertPermission");
        const bureau = permissions.some((p) => PERMISSIONS_DU_BUREAU.includes(p));
        // L'élévation : `exigerReauth` explicite, ou la permission ADMIN seule, qui l'exige déjà par
        // `exigeSessionForte` — les deux gestes de `periodes.ts` illustrent les deux formes.
        if (!bureau) fautives.push(`${fichier}::${f.nom} → ${permissions.join(", ") || "aucune permission"}`);
      }
    }
    expect(fautives).toEqual([]);
  });

  it("les trois portes connues sont bien celles-là (le balayage regarde quelque chose)", () => {
    const portes: string[] = [];
    for (const fichier of FICHIERS) {
      for (const f of fonctionsDuModule(fichier)) {
        if (!f.exportee) continue;
        const ecrits = appelsEcrits(f.corps);
        if (TABLES_PORTEUSES_DE_REPONSES.some((t) => ecrits.includes(t))) portes.push(`${fichier}::${f.nom}`);
      }
    }
    expect(portes.sort()).toEqual([
      "src/actions/periodes.ts::supprimerPeriode",
      "src/actions/periodes.ts::supprimerSeancesPeriode",
      // Le geste de masse de l'onglet Séances : « Supprimer les séances », même serrure que la séance seule.
      "src/actions/seances.ts::appliquerGesteSeancesEnMasse",
      "src/actions/seances.ts::supprimerSeance",
    ]);
  });

  it("le bouton « Supprimer » n'est rendu qu'à qui peut aboutir", () => {
    // Un droit vérifié côté serveur qui resterait affiché côté écran ferait un bouton qui ne sait que
    // refuser — et l'écran de la séance s'ouvre avec `sessions.manage`, donc **sans** élévation, alors
    // que `periods.manage` l'exige. Les deux conditions sont donc dans le rendu.
    const page = fs.readFileSync(path.join(process.cwd(), "src/app/(app)/seances/[id]/page.tsx"), "utf8");
    expect(page).toContain('can(user, "periods.manage") && user.sessionForte');
    // …et c'est bien elle qui ouvre le geste « Supprimer » de « Que veux-tu faire ? », pas à côté.
    expect(page).toMatch(/<GestesSeance[^>]*supprimer=\{can\(user, "periods\.manage"\) && user\.sessionForte\}/);
    // Le geste n'existe que si l'appelant l'ouvre.
    expect(gestesSeance({ annulee: false, passee: false, ouvrir: false, supprimer: false }).map((g) => g.geste)).not.toContain("supprimer");
    expect(gestesSeance({ annulee: false, passee: false, ouvrir: false, supprimer: true }).map((g) => g.geste)).toContain("supprimer");
  });

  it("le nombre de réponses perdues part dans le journal, aux trois portes", () => {
    // C'est la seule trace qui restera : sans ce décompte, l'audit dit qu'une séance a disparu et
    // rien de ce qu'elle emportait.
    for (const [fichier, nom] of [
      ["src/actions/seances.ts", "supprimerSeance"],
      ["src/actions/periodes.ts", "supprimerSeancesPeriode"],
      ["src/actions/periodes.ts", "supprimerPeriode"],
    ] as const) {
      const f = fonctionsDuModule(fichier).find((x) => x.nom === nom);
      expect(f, `${nom} introuvable`).toBeDefined();
      const corps = f!.corps.getText();
      expect(corps, `${nom} ne compte pas les réponses effacées`).toContain("db.attendance.count");
      expect(corps, `${nom} ne journalise pas le décompte`).toMatch(/reponses[,:\s}]/);
    }
  });
});

/**
 * **Une période close verrouille aussi ses séances.**
 *
 * Le planning refusait déjà toute écriture sur un trimestre clos (`partiePourEcriture`,
 * `seancePourEcriture` dans `src/actions/planning.ts`, `periodeOuverte` dans `src/actions/ateliers.ts`)
 * — mais les actions de la séance elle-même passaient toutes : l'horaire, le thème en autosave, la
 * suppression, et **l'annulation**, qui fait partir un email à tous les invités plus une annonce sur
 * Discord et Telegram à propos d'un cours d'un trimestre terminé.
 *
 * Le balayage ne vise que `src/actions/seances.ts`, et c'est délibéré : les gestes de l'écran d'une
 * période portent **sur** la période (on efface exprès les séances d'un trimestre clos), et le planning
 * a sa propre porte. Ici, toute écriture sur la table des séances doit passer par la garde du module.
 */
const ECRITURES_SUR_UNE_SEANCE = ["db.session.update", "db.session.updateMany", "db.session.delete", "db.session.create"];

describe("balayage : les actions d'une séance consultent le statut de sa période", () => {
  const fichier = "src/actions/seances.ts";
  const fonctions = fonctionsDuModule(fichier);

  it("la garde existe et lit bien le statut de la période, par la règle partagée", () => {
    const garde = fonctions.find((f) => f.nom === "seancePourEcriture");
    expect(garde, "la garde `seancePourEcriture` a disparu du module").toBeDefined();
    const corps = garde!.corps.getText();
    expect(corps).toContain("period: { select: { statut: true } }");
    /*
     * **La règle passe par `ecritureFermee`, pas par un `"CLOSE"` recopié**. Cette assertion
     * attendait le littéral, ce qui était le bon test le temps où quatre modules écrivaient la même
     * comparaison — c'est justement cette quatrième copie qui a décidé de la regrouper dans
     * `src/lib/constants.ts`. Exiger la fonction partagée est plus fort : le jour où la table des
     * statuts gagne un `ARCHIVE`, un seul endroit décide, et ce test refuse une cinquième copie.
     */
    expect(corps).toContain("ecritureFermee(");
    expect(corps, "le statut ne se compare pas à la main : `ecritureFermee` le fait pour tout le dépôt").not.toContain('"CLOSE"');
  });

  it("aucune écriture sur une séance n'échappe à la garde", () => {
    const nues: string[] = [];
    for (const f of fonctions) {
      if (!f.exportee) continue;
      const ecrits = appelsEcrits(f.corps);
      if (!ECRITURES_SUR_UNE_SEANCE.some((t) => ecrits.includes(t))) continue;
      const appelees = appels(f.corps);
      // `annulerDepuisEmail` passe par la validité du lien, qui porte déjà le même refus : un jeton
      // dont le trimestre est clos ne désigne plus personne (voir `porteurJetonAnnulation`).
      const gardee = appelees.has("seancePourEcriture") || appelees.has("periodePourEcriture") || appelees.has("porteurJetonAnnulation");
      if (!gardee) nues.push(`${fichier}::${f.nom}`);
    }
    expect(nues).toEqual([]);
  });

  it("les six gestes du cycle de vie d'une séance sont nommément gardés", () => {
    // Nommés un par un, en plus du balayage : c'est la liste que la relecture a trouvée ouverte, et
    // on veut qu'un renommage de l'un d'eux fasse échouer les tests plutôt que de le laisser sortir
    // du balayage sans bruit.
    const sansGarde = ["creerSeance", "modifierSeance", "annulerSeance", "retablirSeance", "supprimerSeance"].filter((nom) => {
      const f = fonctions.find((x) => x.nom === nom);
      if (!f) return true;
      const appelees = appels(f.corps);
      return !appelees.has("seancePourEcriture") && !appelees.has("periodePourEcriture");
    });
    expect(sansGarde).toEqual([]);
  });
});
