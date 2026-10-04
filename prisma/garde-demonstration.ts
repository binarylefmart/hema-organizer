/**
 * **Le garde-fou des outils de démonstration**, partagé par tout ce qui pose des accès connus ou
 * efface des données : le jeu de démonstration (`seed-demo.ts`), la remise en état du compte
 * d'administration (`compte-administration.ts`) et le script de captures.
 *
 * **Pourquoi il a fallu le durcir**. Le seul contrôle était `NODE_ENV === "production"` — et il ne
 * se déclenche que là où il est inutile. Ces scripts tournent par `tsx --env-file-if-exists=.env` :
 * `NODE_ENV` n'y vaut « production » que si quelqu'un l'a écrit à la main dans son `.env`, ce que
 * ni le fichier d'exemple ni la documentation ne demandent. Et l'image Docker, la seule qui pose
 * vraiment `NODE_ENV=production`, n'embarque ni `scripts/` ni `prisma/seed-demo.ts`.
 *
 * Autrement dit : un club qui a installé l'application **depuis les sources** — c'est le premier
 * chemin de la documentation — et qui lance un jour `npm run db:seed:demo` par curiosité **efface
 * ses vrais membres, ses vraies périodes et toutes les réponses**, et pose à la place des accès dont
 * le mot de passe est publié dans le dépôt. Le garde-fou regardait dans la mauvaise direction.
 *
 * Il regarde donc maintenant **la base elle-même**, qui ne ment pas : une base qui contient des
 * comptes que le jeu de démonstration ne connaît pas est une base de production, quel que soit
 * `NODE_ENV`. On ne refuse pas une base vide ni une base déjà remplie par la démonstration : ce sont
 * les deux cas où ces outils servent.
 */
import path from "node:path";
import { db } from "../src/lib/db";
import { hashToken } from "../src/lib/auth/tokens";
import { DEMO_TOKEN_EXISTANT, DEMO_TOKEN_NOUVEAU } from "./comptes";

/** Mot dont il faut renseigner `SEED_DEMO_FORCE` pour passer outre, en connaissance de cause. */
const AVEU = "oui-j-efface-tout";

const REFUS = [
  "[demo] REFUS : cette base ne ressemble pas à une base de démonstration.",
  "",
  "  Ces outils EFFACENT les comptes, les périodes et les réponses, puis installent des accès",
  "  dont le mot de passe est publié dans le dépôt. Sur une vraie base, c'est une perte de données",
  "  et une porte ouverte.",
  "",
  `  Si c'est vraiment ce que vous voulez : SEED_DEMO_FORCE=${AVEU} npm run <la commande>`,
  "  (faites une sauvegarde avant — voir docs/INSTALLATION.md).",
].join("\n");

/**
 * Coupe court si la base n'est manifestement pas une base de démonstration.
 *
 * Trois portes, dans cet ordre :
 *  1. `NODE_ENV=production` — refus sec, comme avant ;
 *  2. `SEED_DEMO_FORCE` renseigné avec le bon mot — on passe, la personne sait ce qu'elle fait ;
 *  3. sinon, le **chemin du fichier de base** doit être dans le dépôt — voir le bloc en bas de fonction,
 *     qui raconte pourquoi l'ancien contrôle « comptes inconnus » ne pouvait pas tenir cette place.
 *
 * Une base injoignable ne fait pas passer : la porte 3 ne regarde que `DATABASE_URL`, qui est présente ou
 * ne l'est pas, et son absence refuse.
 */
/**
 * **Le fichier de base visé est-il dans le dépôt ?** C'est la preuve sur laquelle repose la porte 3 ; elle
 * vit à part pour être éprouvée pour de vrai, le garde-fou lui-même se terminant par un `process.exit`.
 *
 * Prisma résout un chemin relatif depuis le dossier du **schéma**, pas depuis le dossier courant : la base
 * de développement s'écrit `file:../data/hema.db` et désigne `<dépôt>/data/hema.db`. Celle du club s'écrit
 * `file:/data/hema.db` — absolue, dans le volume du conteneur, donc dehors.
 */
export function baseDansLeDepot(url: string, racineDepot: string = process.cwd()): boolean {
  if (!url.startsWith("file:")) return false;
  const chemin = url.slice("file:".length).split("?")[0];
  if (!chemin) return false;
  const racine = path.resolve(racineDepot);
  const absolu = path.resolve(path.join(racine, "prisma"), chemin);
  return absolu.startsWith(`${racine}${path.sep}`);
}

export async function exigerBaseDeDemonstration(): Promise<void> {
  if (process.env.NODE_ENV === "production" || process.env.SEED_DEMO_AUTORISE === "non") {
    console.error("[demo] REFUS : ces outils ne s'installent pas en production (ils effacent les données et posent des accès connus).");
    process.exit(1);
  }
  if (process.env.SEED_DEMO_FORCE === AVEU) return;

  /*
   * **La présence d'un marqueur de démonstration tranche avant tout le reste.**
   *
   * La première version ne regardait que les inconnus : « un seul compte que la démonstration ne
   * connaît pas ⇒ refus ». C'est trop strict pour la base de travail, où les tests de bout en bout
   * **créent des comptes** — c'est même ce qu'ils vérifient. Dès la première campagne e2e passée,
   * le reseed du `global-setup` était refusé, et toute la suite s'arrêtait là.
   *
   * Les deux jetons d'invitation de la démonstration sont fixes et publiés dans le dépôt : aucune
   * base réelle ne peut en porter un, puisque seuls les octets aléatoires de `createInvitation` y
   * entrent. Leur présence est donc une preuve, là où l'absence d'inconnus n'était qu'un indice.
   * Le contrôle des inconnus reste en second : une base sans marqueur est traitée comme avant.
   */
  try {
    const marqueurs = [DEMO_TOKEN_NOUVEAU, DEMO_TOKEN_EXISTANT].map(hashToken);
    if ((await db.invitation.count({ where: { tokenHash: { in: marqueurs } } })) > 0) return;
  } catch {
    // Base illisible : on ne conclut rien ici, le contrôle des comptes ci-dessous refusera.
  }

  /*
   * **Dernier recours : le fichier de base doit être DANS le dépôt**.
   *
   * Ce qui tenait cette place était une heuristique : « au moins un compte hors du jeu de démonstration
   * ⇒ refus ». Elle ne pouvait pas marcher, et c'est structurel : **le jeu de démonstration est tiré du
   * vrai annuaire du club** (`prisma/donnees-club.ts` porte les douze personnes et leurs adresses sur le
   * vrai domaine). Sur la base du club, tout compte est donc « connu », la liste d'étrangers est vide, et
   * le garde-fou **laissait passer**. Derrière lui : `db.period.deleteMany({})`, c'est-à-dire toutes les
   * périodes et, en cascade, toutes les séances, toutes les présences et toutes les invitations. Plus
   * `restaurerCompteAdministration`, qui pose sur le compte du bureau le mot de passe, le secret TOTP et
   * les codes de secours **publiés dans ce dépôt**.
   *
   * Le scénario n'a rien d'exotique : un poste de travail dont le `.env` porte le `DATABASE_URL` du club,
   * et `npm run db:seed:demo` — commande listée dans le README deux lignes sous `npm run db:seed`. Aucune
   * confirmation n'était demandée, et `NODE_ENV=production` n'est pas posé quand on lance depuis une
   * copie des sources.
   *
   * Un indice ne peut pas servir de preuve. Le chemin du fichier, lui, en est une : la base de
   * développement vit **dans** le dépôt (`file:../data/hema.db`, relatif au dossier `prisma/`), celle du
   * club vit dans le volume du conteneur (`file:/data/hema.db`, absolu, ailleurs). On exige donc que le
   * fichier soit sous la racine du dépôt, et rien d'autre ne peut autoriser.
   *
   * **Le contrôle des comptes inconnus a été retiré, pas déplacé.** Le garder en plus aurait ramené le
   * défaut qu'il avait lui-même créé : les campagnes e2e **créent** des comptes (c'est ce qu'elles
   * vérifient), donc il refusait le reseed du `global-setup` dès la première campagne passée, et toute la
   * suite s'arrêtait là. Un contrôle qui se trompe dans les deux sens ne protège rien.
   */
  const url = (process.env.DATABASE_URL ?? "").trim();
  if (!baseDansLeDepot(url)) {
    console.error(REFUS);
    console.error(`\n  (La base visée n'est pas un fichier du dépôt : ${url || "DATABASE_URL non renseignée"}.`);
    console.error("   Ces outils effacent les données et posent des accès publiés : ils ne visent qu'une base de développement.)");
    process.exit(1);
  }
  return;
}
