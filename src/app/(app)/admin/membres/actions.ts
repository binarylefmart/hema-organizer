"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { assertPermission, exigerReauth } from "@/lib/auth/current-user";
import { ROLES_DE_BASE } from "@/lib/constants";
import { canEditUser, estCompteDeService, peutEtreInvite } from "@/lib/permissions";
import { envoyerInvitation } from "@/lib/invitations";
import { revokeAllSessions } from "@/lib/auth/session";
import { identifiantSchema, SELECTION_MAX } from "@/lib/validation/presences";
import { GESTES_MASSE, type GesteMasse } from "./selection-gestes";

/**
 * **Changer le rôle de plusieurs personnes d'un coup**, depuis l'annuaire.
 *
 * En début de saison, le bureau fait sept instructeurs. À douze comptes, sept listes déroulantes
 * ne coûtent rien ; à quatre-vingts, ce sont sept allers-retours dans autant de lignes qu'il faut
 * d'abord retrouver. Le geste devient : cocher les sept, choisir le rôle une fois.
 *
 * **Pourquoi ici et non dans `src/actions/membres.ts`** : cette action ne sert qu'à cet écran, et
 * le dépôt a déjà ce patron (`src/app/(public)/desinscription/actions.ts`). Elle reste malgré tout
 * une **route appelable de l'extérieur**, comme toute fonction exportée d'un fichier `"use server"` :
 * ses gardes sont donc écrites ici en entier, jamais déléguées à ce que l'écran affiche.
 *
 * **Ses gardes sont exactement celles du geste unitaire** (`definirRoleMembre`, `src/actions/membres.ts`) :
 * - permission `members.manage`, et `canEditUser` sur chaque personne ;
 * - le **compte de connexion du portail** ne change pas de rôle ;
 * - **personne ne change le sien** ;
 * - le rôle écrit est un **rôle de base** et rien d'autre (`ROLES_DE_BASE`) : c'est cette frontière,
 *   et non une garde sur la cible, qui empêche l'annuaire de donner le bureau.
 *
 * **Un administrateur n'est plus écarté du lot, et c'est le changement.** Il l'était parce que les
 * trois rôles étaient **exclusifs** : lui écrire un rôle l'aurait **rétrogradé en silence**, et une
 * exclusion annoncée valait mieux qu'une destitution muette. Le bureau est devenu un supplément
 * (`User.estAdmin`), ce lot n'écrit **que** `role` — jamais `estAdmin`, voir l'écriture groupée
 * ci-dessous —, et il ne retire donc plus rien à personne : un instructeur du bureau passé membre
 * reste du bureau. L'exclusion n'avait plus d'objet, et une garde `role === "ADMIN"` ne lève de
 * toute façon plus jamais, puisque cette valeur ne s'écrit plus en base.
 *
 * **Pas de `exigerReauth`, pour la même raison qu'à l'unité** : le seul effet possible est
 * membre ↔ instructeur, et un instructeur ne touche ni aux comptes ni aux accès. C'est ce qui la
 * distingue de `definirActifTous`, qui coupe l'accès de tout le club et redemande donc le code.
 */

/**
 * **Le plafond est celui des présences en masse, pas un second plafond du même genre.**
 *
 * `SELECTION_MAX` (`src/lib/validation/presences.ts`) répond déjà à la question posée ici : un lot
 * plus gros que le plus gros club imaginable n'est pas un geste de bureau, c'est un appel forgé, et
 * il borne aussi la taille de la transaction. Le recopier ici en donnait **deux** valeurs à corriger
 * le jour où elle bouge — et une divergence entre les deux écrans de masse est précisément ce que le
 * partage de `src/components/ui/selection.ts` cherche à éviter côté écran.
 *
 * Même raison pour `identifiantSchema` : un identifiant venu du réseau a la même forme sur les deux
 * chemins (`.min(1).max(64)`), et le `.max(64)` n'est pas un détail — sans lui, un appel forgé fait
 * lire à SQLite cinq cents chaînes de n'importe quelle longueur.
 */
const schema = z.object({
  /**
   * **Les deux rôles de base, lus là où ils sont déclarés** (`ROLES_DE_BASE`, `src/lib/constants.ts`)
   * et non recopiés ici : c'est la même liste que celle qu'un écran propose dans sa liste déroulante,
   * et le jour où elle bouge, elle ne doit bouger qu'une fois. C'est aussi elle qui **empêche qu'une
   * requête forgée se donne le bureau par l'annuaire** — `"ADMIN"` n'en fait pas partie, donc il est
   * refusé par la validation, avant toute lecture de base.
   */
  role: z.enum(ROLES_DE_BASE),
  userIds: z.array(identifiantSchema).min(1).max(SELECTION_MAX),
});

export type ResultatRolesEnMasse = { succes?: string; erreur?: string };

export async function definirRolesEnMasse(entree: unknown): Promise<ResultatRolesEnMasse> {
  const acteur = await assertPermission("members.manage");
  const lu = schema.safeParse(entree);
  // Message unique et sans détail : une sélection invalide vient d'un appel forgé, pas de l'écran.
  if (!lu.success) return { erreur: "Sélection invalide : choisis des personnes et un rôle (membre ou instructeur)." };
  const { role } = lu.data;
  const identifiants = [...new Set(lu.data.userIds)];

  /**
   * **L'ordre rendu est celui de la liste, jamais celui des clics** (CLAUDE.md) — et sans `orderBy`,
   * ce n'était ni l'un ni l'autre : c'était l'ordre des lignes en base, c'est-à-dire l'ordre
   * d'inscription des comptes. Le journal d'audit du lot se lisait donc dans un ordre que l'écran ne
   * montre nulle part, alors que c'est **le journal qui tranchera** le désaccord d'après (« qui est
   * devenu instructeur, et quand »).
   *
   * `prenom` puis `nom` : exactement le classement de l'annuaire d'où part le geste (`page.tsx`,
   * « Prénom Nom »). L'action jumelle des présences journalise dans l'ordre de la liste qu'elle
   * reçoit (`modifierPresencesEnMasse`), et `definirActifTous` prend déjà la peine d'un `orderBy` ;
   * il n'y avait ici qu'un oubli. On ne se fie pas pour autant à l'ordre des identifiants reçus : il
   * vient du réseau, et un appel forgé le donnerait dans n'importe quel ordre.
   */
  const cibles = await db.user.findMany({
    where: { id: { in: identifiants } },
    orderBy: [{ prenom: "asc" }, { nom: "asc" }],
    /*
     * **`estAdmin` fait partie de ce qu'on lit, et ce n'est pas un détail de confort** : `canEditUser`
     * le lit pour savoir si la cible est du bureau. Un `select` qui prendrait `role` sans lui passerait
     * `undefined` — donc « pas du bureau » — et la frontière se tairait au lieu de refuser.
     */
    select: { id: true, prenom: true, nom: true, email: true, role: true, estAdmin: true, actif: true, service: true },
  });

  /**
   * **Les identifiants sans compte en base sont comptés avant tout le reste.**
   *
   * Le `findMany` ci-dessus ne rend que ce qu'il trouve : une personne supprimée de l'annuaire
   * pendant que l'écran était ouvert sort de la liste sans un mot, et le bureau qui avait coché
   * quatorze noms lisait « 13 comptes passés instructeur ». Le quatorzième n'a pas disparu, il n'a
   * simplement jamais été raconté — et c'est ce silence que l'action jumelle des présences refuse
   * par principe (`modifierPresencesEnMasse`, qui va jusqu'à refuser le lot entier plutôt que d'en
   * écrire treize sur quatorze). Ici le lot reste écrit, parce que les autres lignes sont
   * parfaitement valides et que ce geste n'est pas destructeur ; mais le nombre est dit.
   */
  const introuvables = identifiants.length - cibles.length;

  // Quatre sorts possibles pour une ligne : à écrire, déjà au bon rôle, écartée, ou introuvable —
  // et chacun est **compté**, pour que le message raconte le lot en entier.
  const aEcrire: typeof cibles = [];
  let refuses = 0;
  let dejas = 0;
  for (const cible of cibles) {
    /*
     * **`canEditUser` tient seul la frontière du bureau**, et c'est pour cela qu'il n'y a plus de test
     * `role === "ADMIN"` au-dessus : il refuse une cible `estAdmin` à qui n'a pas `admins.manage`.
     * Le jour où `members.view` se rouvrira à l'encadrement, un instructeur sera donc écarté des
     * comptes du bureau sans qu'une ligne de plus ait à y penser — et l'écran ne lui donne pas de
     * case pour eux (`reglable`, `page.tsx`), parce qu'il pose exactement la même question.
     */
    if (estCompteDeService(cible) || !canEditUser(acteur, cible) || acteur.id === cible.id) {
      refuses += 1;
      continue;
    }
    if (cible.role === role) {
      dejas += 1;
      continue;
    }
    aEcrire.push(cible);
  }

  if (aEcrire.length > 0) {
    // **Une seule écriture groupée** : sept mises à jour dont la quatrième échoue laisseraient un
    // bureau à moitié nommé, et rien à l'écran ne dirait lesquelles sont passées.
    /*
     * **`data: { role }`, et rien de plus : ce lot ne touche jamais `estAdmin`.** C'est la condition à
     * laquelle un administrateur a retrouvé sa case — changer son rôle de base ne lui retire plus le
     * bureau. Ajouter ici le moindre champ qui touche aux droits ferait du geste le plus courant de
     * l'annuaire une destitution de masse sans confirmation ni code.
     */
    await db.$transaction(aEcrire.map((cible) => db.user.update({ where: { id: cible.id }, data: { role } })));
    /*
     * **Une entrée d'audit par personne, et non une pour le lot.** C'est le journal qui tranche un
     * désaccord six mois plus tard : « qui est devenu instructeur, et quand » doit s'y lire nom par
     * nom. Un « 7 comptes modifiés » obligerait à croire une liste dans un champ de détails, et le
     * filtre par cible du journal ne retrouverait plus personne. Les écritures d'audit restent hors
     * de la transaction : elles ne doivent jamais faire échouer le geste qu'elles racontent.
     */
    // `enMasse` comme ses quatre voisins : sans lui, le journal ne distingue pas un rôle changé par
    // lot d'un rôle changé à l'unité.
    for (const cible of aEcrire) await audit(acteur, "membre.role_modifie", cible.id, { ancien: cible.role, nouveau: role, enMasse: true });
    revalidatePath("/admin/membres");
    revalidatePath("/admin/comptes");
  }

  /**
   * **Le message raconte une seule histoire.**
   *
   * « Aucun changement : la sélection était déjà membre. » et « 1 compte écarté (compte du portail,
   * ou toi-même). » se lisaient côte à côte, et les deux ne peuvent pas être vraies ensemble : le
   * compte écarté n'était pas « déjà membre », il n'a pas été regardé du tout. On ne garde donc la
   * phrase qui parle de **la sélection entière**
   * que quand la sélection entière a bien été traitée — rien d'écarté, rien d'introuvable. Sinon on
   * dit sobrement qu'aucun compte n'a bougé, avec le nombre de ceux qui portaient déjà le rôle s'il
   * y en a, et les phrases suivantes disent ce qui est resté dehors.
   */
  const mot = role === "INSTRUCTEUR" ? "instructeur" : "membre";
  const dehors = refuses + introuvables;
  const phrases: string[] = [];
  if (aEcrire.length > 0) {
    phrases.push(`${aEcrire.length} compte${aEcrire.length > 1 ? "s" : ""} passé${aEcrire.length > 1 ? "s" : ""} ${mot}.`);
  } else if (dehors === 0) {
    phrases.push(`Aucun changement : la sélection était déjà ${mot}.`);
  } else if (dejas > 0) {
    phrases.push(`Aucun compte modifié : ${dejas} compte${dejas > 1 ? "s" : ""} ${dejas > 1 ? "étaient" : "était"} déjà ${mot}.`);
  } else {
    phrases.push("Aucun compte modifié.");
  }
  // Les écartés sont annoncés : c'est la différence entre « écarté » et « oublié ».
  if (refuses > 0) phrases.push(`${refuses} compte${refuses > 1 ? "s" : ""} écarté${refuses > 1 ? "s" : ""} (compte du portail, ou toi-même).`);
  // Et les introuvables, avec le geste qui remet l'écran d'accord avec la base.
  if (introuvables > 0) {
    phrases.push(
      introuvables === 1
        ? "1 compte de la sélection est introuvable : il a quitté l'annuaire depuis l'affichage de la liste. Recharge l'écran."
        : `${introuvables} comptes de la sélection sont introuvables : ils ont quitté l'annuaire depuis l'affichage de la liste. Recharge l'écran.`,
    );
  }
  return { succes: phrases.join(" ") };
}

/* ------------------------------------------------------------------ */
/* Désactiver, réactiver, supprimer plusieurs comptes                  */
/* ------------------------------------------------------------------ */

/**
 * **Trois gestes de masse sur les comptes de l'annuaire**.
 *
 * Le bureau cochait déjà des lignes pour nommer sept instructeurs ; il coupe maintenant l'accès d'un
 * groupe (fin de saison d'une section, inscriptions non renouvelées) et efface d'un geste les comptes
 * ouverts par erreur — là où c'étaient trente volets à ouvrir un par un, chacun avec sa confirmation.
 *
 * **Une seule fonction pour les trois, et c'est le point important.** Leurs gardes sont les mêmes à
 * une permission près ; les écrire trois fois, c'est se donner trois occasions d'en oublier une —
 * exactement ce que `CLAUDE.md` appelle « deux chemins d'écriture aux règles différentes ». Ne varient
 * que la permission exigée, l'écriture et le nom de l'action journalisée.
 *
 * **Ses gardes sont celles des gestes unitaires** (`definirActif` et `supprimerMembre`,
 * `src/actions/membres.ts`), et rien de moins :
 * - `members.activate` pour l'accès, `members.delete` pour la suppression — les permissions exactes
 *   des boutons de la ligne, pas un `members.manage` générique qui ouvrirait plus large ;
 * - `canEditUser` sur chaque personne, le **compte de connexion du portail** intouchable (c'est la
 *   porte de secours du club), et **personne n'agit sur son propre compte** (se désactiver, c'est
 *   fermer la porte de l'intérieur, en pleine opération) ;
 * - un **code 2FA récent** (`exigerReauth`), comme à l'unité pour la désactivation et la suppression.
 *   La réactivation en masse le demande **aussi**, là où le bouton d'une ligne s'en passe : rendre
 *   l'accès à trente comptes d'un coup est le geste voisin de `definirActifTous`, qui le demande dans
 *   les deux sens. Être plus strict en masse n'ouvre aucune porte et n'éteint aucune fonctionnalité —
 *   le bouton de la ligne reste là, inchangé.
 *
 * **Un administrateur passe par ici, et la confirmation le nomme.** Il en était exclu — pas de
 * case, lot entier refusé s'il en arrivait un — et le motif tenait à l'ancien modèle de rôles : la
 * sélection servait d'abord à changer un rôle, ce qui l'aurait **rétrogradé en silence**. Le bureau
 * étant devenu un supplément, cette raison est tombée, et ce qui restait n'était plus qu'une règle
 * **plus stricte en masse qu'à l'unité** : la fiche d'un administrateur offre « Désactiver le
 * compte » et « Supprimer définitivement » (mêmes verrous : `canEditUser`, portail, pas soi-même,
 * `exigerReauth`), et le pied de ce même écran propose « Désactiver tous les comptes,
 * administrateurs compris ». `CLAUDE.md` tranche : « deux chemins d'écriture aux règles
 * différentes, c'est une porte dérobée d'un côté ou une fonctionnalité morte de l'autre » — c'était
 * le second cas.
 *
 * Ce qui reste dû au bureau, c'est d'être **dit avant** : la confirmation nomme les comptes du bureau
 * que le lot emporte (`phraseBureau`, `selection-gestes.ts`). Et ce lot-ci, comme celui des rôles,
 * **n'écrit jamais `estAdmin`** : il ne touche qu'`actif`, ou efface la ligne entière.
 *
 * **Tout ou rien.** Une ligne interdite refuse le lot complet — et non « vingt-neuf sur trente en
 * silence ». La différence avec le rôle en masse, qui écrit ce qui est écrivable, est assumée : là-bas
 * une ligne écartée ne fait rien perdre ; ici, un lot à moitié appliqué laisse une moitié de section
 * encore connectée, ou une moitié de comptes effacés sans retour possible. C'est la doctrine de
 * `modifierPresencesEnMasse`.
 *
 * **Aucune notification**, et pas une de plus que les gestes unitaires : ils n'envoient aucun email
 * (la désactivation coupe les sessions, la suppression emporte tout par cascade — ni l'un ni l'autre
 * n'écrit à qui que ce soit). « Cinquante-cinq emails partis d'un clic sont un incident. »
 */
export type ResultatGesteEnMasse = { succes?: string; erreur?: string };

/** Le plafond et la forme d'un identifiant sont ceux des deux autres gestes de masse (voir plus haut). */
const schemaGeste = z.object({
  geste: z.enum(GESTES_MASSE),
  userIds: z.array(identifiantSchema).min(1).max(SELECTION_MAX),
});

/** La permission exacte du bouton de la ligne : l'accès d'un côté, l'existence du compte de l'autre. */
const PERMISSION_GESTE = { desactiver: "members.activate", reactiver: "members.activate", supprimer: "members.delete" } as const;

/**
 * **L'action journalisée est celle du geste unitaire** (`CLAUDE.md` : « un seul filtre du journal doit
 * tout retrouver »). Un `membres.desactives_en_masse` obligerait à connaître deux noms d'action pour
 * répondre à « quand le compte de Chloé a-t-il été coupé ? ».
 */
const ACTION_AUDIT = { desactiver: "membre.desactive", reactiver: "membre.reactive", supprimer: "membre.supprime" } as const;

export async function appliquerGesteEnMasse(entree: unknown): Promise<ResultatGesteEnMasse> {
  /*
   * **Le plancher d'abord, la permission du geste ensuite.** `members.manage` est le droit sans lequel
   * on ne touche à aucun compte de l'annuaire (`canEditUser` l'exige de toute façon) : il se vérifie
   * avant de lire l'entrée, pour qu'un appel anonyme soit refusé sans qu'on ait regardé ce qu'il
   * demande. La permission propre au geste vient après, une fois qu'on sait lequel c'est.
   */
  const acteur = await assertPermission("members.manage");
  const lu = schemaGeste.safeParse(entree);
  // Message unique et sans détail : une sélection invalide vient d'un appel forgé, pas de l'écran.
  if (!lu.success) return { erreur: "Sélection invalide : coche des comptes, puis choisis le geste." };
  const geste: GesteMasse = lu.data.geste;
  await assertPermission(PERMISSION_GESTE[geste]);
  const identifiants = [...new Set(lu.data.userIds)];

  // L'ordre rendu est celui de l'annuaire (« Prénom Nom »), jamais celui des clics : c'est cet ordre
  // que le journal gardera, et le seul qu'on puisse retrouver à l'écran. Voir `definirRolesEnMasse`.
  const cibles = await db.user.findMany({
    where: { id: { in: identifiants } },
    orderBy: [{ prenom: "asc" }, { nom: "asc" }],
    // `estAdmin` est lu avec le reste : voir `definirRolesEnMasse`, un `select` sans lui ferait taire `canEditUser`.
    select: { id: true, prenom: true, nom: true, email: true, role: true, estAdmin: true, actif: true, service: true },
  });

  /*
   * **Tout ou rien, et le message dit lequel.** Chaque ligne interdite est nommée avec sa raison :
   * « le lot est refusé » sans dire laquelle obligerait à décocher au hasard. Les identifiants sans
   * compte en base comptent comme un refus eux aussi — pour un geste destructeur, un écran en retard
   * sur la base n'est pas une base de décision.
   */
  const refuses: string[] = [];
  for (const cible of cibles) {
    const nom = `${cible.prenom} ${cible.nom}`;
    // Pas de test sur le bureau : `canEditUser` (dernière ligne) le tient, et il le tient **mieux**
    // — il regarde `estAdmin`, que `role` ne porte plus depuis la migration.
    if (estCompteDeService(cible)) refuses.push(`${nom} (compte de connexion du portail : il ne se désactive ni ne se supprime)`);
    else if (acteur.id === cible.id) refuses.push(`${nom} (c'est ton propre compte)`);
    else if (!canEditUser(acteur, cible)) refuses.push(`${nom} (tu ne peux pas modifier ce compte)`);
  }
  const introuvables = identifiants.length - cibles.length;
  if (refuses.length > 0 || introuvables > 0) {
    const phrases = ["Rien n'a été écrit : le lot entier est refusé."];
    if (refuses.length > 0) phrases.push(`${refuses.length === 1 ? "Ce compte ne peut pas" : "Ces comptes ne peuvent pas"} être traité${refuses.length > 1 ? "s" : ""} en masse — ${refuses.join(" ; ")}.`);
    if (introuvables > 0) {
      phrases.push(
        introuvables === 1
          ? "1 compte de la sélection est introuvable : il a quitté l'annuaire depuis l'affichage de la liste. Recharge l'écran."
          : `${introuvables} comptes de la sélection sont introuvables : ils ont quitté l'annuaire depuis l'affichage de la liste. Recharge l'écran.`,
      );
    }
    return { erreur: phrases.join(" ") };
  }

  /*
   * **Seules les lignes qui changent vraiment sont écrites, et journalisées.** Redésactiver quelqu'un
   * qui l'est déjà coûterait une écriture et une entrée de journal qui ne tranchent aucun désaccord,
   * et noieraient les vraies. Une suppression, elle, n'a pas de « déjà fait ».
   */
  const aEcrire = geste === "supprimer" ? cibles : cibles.filter((c) => c.actif === (geste === "desactiver"));
  const dejas = cibles.length - aEcrire.length;
  if (aEcrire.length === 0) {
    // Rien à écrire : inutile de réclamer un code pour un enregistrement à blanc.
    return { succes: geste === "desactiver" ? "Aucun changement : la sélection était déjà désactivée." : "Aucun changement : la sélection était déjà active." };
  }

  // Le code récent est redemandé **avant** l'écriture : après, l'accès serait déjà coupé (ou le
  // compte déjà effacé). La suite est la liste des membres, d'où le geste part.
  await exigerReauth(acteur, "/admin/membres");

  const ids = aEcrire.map((c) => c.id);
  /*
   * **Une seule écriture groupée.** Trente mises à jour dont la douzième échoue laisseraient une
   * section à moitié coupée, et rien à l'écran ne dirait laquelle. `updateMany` / `deleteMany` sont
   * déjà atomiques ; la transaction les tient malgré tout, pour que la forme du geste soit la même
   * que celle du rôle en masse et qu'y ajouter une seconde écriture reste sûr.
   */
  if (geste === "supprimer") {
    // La cascade du schéma emporte les présences, les propositions, les liens et les sessions
    // (`onDelete: Cascade`), exactement comme le `db.user.delete` du geste unitaire.
    await db.$transaction([db.user.deleteMany({ where: { id: { in: ids } } })]);
  } else {
    await db.$transaction([db.user.updateMany({ where: { id: { in: ids } }, data: { actif: geste === "reactiver" } })]);
  }

  // Comme à l'unité (`definirActif`) : les sessions ouvertes tombent tout de suite, sinon un compte
  // désactivé reste dedans jusqu'à l'expiration de son cookie. Hors transaction, après le commit —
  // couper des sessions ne doit pas pouvoir annuler la désactivation qu'elle accompagne. Rien de tel
  // pour une suppression : la cascade a déjà effacé les sessions.
  if (geste === "desactiver") for (const id of ids) await revokeAllSessions(id);

  /*
   * **Une entrée d'audit par personne**, portant la **même action** que le geste unitaire, écrite
   * après le commit et hors transaction : `audit()` ne lève jamais, et une désactivation ne doit pas
   * être annulée parce que sa trace a échoué. `enMasse` dit seulement d'où venait le geste — c'est ce
   * que fait déjà `modifierPresencesEnMasse`.
   */
  for (const cible of aEcrire) {
    await audit(acteur, ACTION_AUDIT[geste], cible.id, geste === "supprimer" ? { email: cible.email, enMasse: true } : { enMasse: true });
  }

  revalidatePath("/admin/membres");
  revalidatePath("/admin/periodes");
  revalidatePath("/admin/comptes");

  const n = aEcrire.length;
  const pluriel = n > 1 ? "s" : "";
  const phrases: string[] = [];
  if (geste === "supprimer") phrases.push(`${n} compte${pluriel} supprimé${pluriel} définitivement.`);
  else if (geste === "desactiver") phrases.push(`${n} compte${pluriel} désactivé${pluriel} : ${n > 1 ? "leurs appareils sont déconnectés" : "ses appareils sont déconnectés"}.`);
  else phrases.push(`${n} compte${pluriel} réactivé${pluriel}.`);
  // Ceux qui portaient déjà la valeur visée sont dits à part : le chiffre censé faire hésiter reste juste.
  if (dejas > 0) {
    phrases.push(
      geste === "desactiver"
        ? `${dejas} compte${dejas > 1 ? "s étaient" : " était"} déjà désactivé${dejas > 1 ? "s" : ""}.`
        : `${dejas} compte${dejas > 1 ? "s étaient" : " était"} déjà actif${dejas > 1 ? "s" : ""}.`,
    );
  }
  return { succes: phrases.join(" ") };
}

/* ------------------------------------------------------------------ */
/* Renvoyer le lien personnel à plusieurs personnes                    */
/* ------------------------------------------------------------------ */

/**
 * **Renvoyer son lien personnel à chaque personne cochée**.
 *
 * C'est la rentrée d'un trimestre, une liste d'adresses qu'on vient de corriger, cinq personnes qui
 * « n'ont jamais reçu le lien » : c'étaient cinq volets à ouvrir un par un, chacun avec sa
 * confirmation. Le geste devient : cocher, puis envoyer.
 *
 * **C'est le seul des cinq gestes de masse de cet écran qui part vers les gens**, et il est donc
 * traité différemment des quatre autres :
 *
 * - **la confirmation annonce le nombre d'emails**, pas le nombre de cases cochées
 *   (`texteConfirmationLiens`, `selection-liens.ts`). `CLAUDE.md` : « cinquante-cinq emails partis d'un
 *   clic sont un incident. » Ici l'envoi **est** le geste demandé — ce n'est pas la notification d'une
 *   écriture, multipliée par la taille du lot —, mais le chiffre se dit avant, parce que c'est le seul
 *   qu'on ne rattrape pas ;
 * - **un email par personne, en série**, exactement comme « Renvoyer les liens » d'une période
 *   (`renvoyerTousLesLiens`, `src/actions/periodes.ts`) : c'est la même mécanique d'envoi, et elle passe
 *   par la file (`enqueueEmail`) qui journalise chaque issue.
 *
 * **Ses verrous sont ceux du geste unitaire** (`envoyerLienMembre`, `src/actions/membres.ts`), et un de
 * plus :
 * - `invitations.manage` — « le lien personnel **de quelqu'un d'autre** appartient au bureau » ; ce
 *   n'est pas `members.manage`, qui ouvrirait plus large ;
 * - le **compte de connexion du portail** n'a pas de lien personnel (il entre par mot de passe + 2FA) ;
 * - **`exigerReauth`**, et c'est le verrou qui compte le plus ici : « changer l'adresse de
 *   quelqu'un *et* lui renvoyer son lien » fait arriver chez soi une clé de quatre mois au nom d'un
 *   autre. Le geste unitaire le demande, celui de la période aussi ; un geste de masse plus permissif
 *   que son unitaire est précisément ce que `CLAUDE.md` interdit ;
 * - **`canEditUser` en plus**, que le geste unitaire n'appelle pas : l'écran ne donne de case qu'aux
 *   comptes qu'il sait traiter, et le serveur doit tenir la même frontière plutôt que de s'en remettre à
 *   ce que l'écran affiche. Être plus strict en masse n'éteint aucune fonctionnalité — le bouton de la
 *   ligne reste là, inchangé.
 *
 * **Deux populations, deux traitements, et c'est voulu :**
 * - **ce qui trahit un écran en retard sur la base refuse le lot entier** (compte du portail, compte
 *   qu'on ne peut pas modifier, identifiant introuvable, période close) : des emails partis d'une liste
 *   périmée ne se rappellent pas ;
 * - **ce qui est un état ordinaire de l'annuaire est écarté, nommé, et les autres partent** : une
 *   personne sans adresse email, un compte désactivé. Le bouton de leur ligne n'existe pas non plus, et
 *   échouer en bloc obligerait à décocher au hasard pour trouver laquelle bloque. C'est déjà ce que fait
 *   « Renvoyer les liens » d'une période, qui saute les sans-adresse et les compte.
 *
 * **Une entrée d'audit par personne**, sous la **même action** que le geste unitaire
 * (`invitation.renvoyee`) : c'est un seul filtre du journal qui doit répondre à « quand Chloé a-t-elle
 * reçu son dernier lien ? ». `enMasse` dit seulement d'où venait le geste.
 */
export type ResultatLiensEnMasse = { succes?: string; erreur?: string };

/** Le plafond et la forme d'un identifiant sont ceux des autres gestes de masse (voir plus haut). */
const schemaLiens = z.object({
  periodId: identifiantSchema,
  userIds: z.array(identifiantSchema).min(1).max(SELECTION_MAX),
});

export async function renvoyerLiensEnMasse(entree: unknown): Promise<ResultatLiensEnMasse> {
  const acteur = await assertPermission("invitations.manage");
  const lu = schemaLiens.safeParse(entree);
  // Message unique et sans détail : une sélection invalide vient d'un appel forgé, pas de l'écran.
  if (!lu.success) return { erreur: "Sélection invalide : coche des personnes, puis renvoie leur lien." };
  const { periodId } = lu.data;
  const identifiants = [...new Set(lu.data.userIds)];

  // L'ordre rendu est celui de l'annuaire (« Prénom Nom »), jamais celui des clics : c'est l'ordre que
  // le journal gardera, et le seul qu'on puisse retrouver à l'écran. Voir `definirRolesEnMasse`.
  const cibles = await db.user.findMany({
    where: { id: { in: identifiants } },
    orderBy: [{ prenom: "asc" }, { nom: "asc" }],
    // `estAdmin` est lu avec le reste : voir `definirRolesEnMasse`, un `select` sans lui ferait taire `canEditUser`.
    select: { id: true, prenom: true, nom: true, email: true, role: true, estAdmin: true, actif: true, service: true },
  });

  /*
   * **Ce qui trahit un écran en retard sur la base refuse le lot entier**, et le message nomme la
   * ligne : « le lot est refusé » sans dire laquelle obligerait à décocher au hasard. Un envoi parti
   * ne se rappelle pas, et une liste périmée n'est pas une base de décision pour expédier des clés.
   */
  const refuses: string[] = [];
  for (const cible of cibles) {
    const nom = `${cible.prenom} ${cible.nom}`;
    if (!peutEtreInvite(cible)) refuses.push(`${nom} (compte de connexion du portail : il n'a pas de lien personnel)`);
    else if (!canEditUser(acteur, cible)) refuses.push(`${nom} (tu ne peux pas modifier ce compte)`);
  }
  const introuvables = identifiants.length - cibles.length;
  if (refuses.length > 0 || introuvables > 0) {
    const phrases = ["Aucun email n'est parti : le lot entier est refusé."];
    if (refuses.length > 0) {
      phrases.push(
        `${refuses.length === 1 ? "Ce compte ne peut pas" : "Ces comptes ne peuvent pas"} recevoir de lien — ${refuses.join(" ; ")}.`,
      );
    }
    if (introuvables > 0) {
      phrases.push(
        introuvables === 1
          ? "1 compte de la sélection est introuvable : il a quitté l'annuaire depuis l'affichage de la liste. Recharge l'écran."
          : `${introuvables} comptes de la sélection sont introuvables : ils ont quitté l'annuaire depuis l'affichage de la liste. Recharge l'écran.`,
      );
    }
    return { erreur: phrases.join(" ") };
  }

  // Refus d'abord, code ensuite (`envoyerLienMembre`) : un trimestre clos n'émet plus de lien
  // valable, et faire recopier six chiffres pour s'entendre dire ça est le défaut corrigé.
  const periode = await db.period.findUnique({ where: { id: periodId }, select: { statut: true } });
  if (!periode) return { erreur: "Période introuvable : recharge l'écran." };
  if (periode.statut === "CLOSE") return { erreur: "Période close : les liens ne sont plus valables." };

  /*
   * **Qui peut recevoir**, dans l'ordre des refus du geste unitaire : un compte désactivé d'abord (son
   * lien ne s'ouvrirait pas), une adresse manquante ensuite (il n'y a nulle part où écrire). Les deux
   * sont des états ordinaires de l'annuaire — le bouton de leur ligne n'existe pas non plus —, donc ils
   * sont **écartés et nommés**, et les autres partent.
   */
  const partants = cibles.filter((c) => c.actif && c.email);
  const inactifs = cibles.filter((c) => !c.actif).map((c) => `${c.prenom} ${c.nom}`);
  const sansEmail = cibles.filter((c) => c.actif && !c.email).map((c) => `${c.prenom} ${c.nom}`);
  if (partants.length === 0) {
    // Rien à envoyer : inutile de réclamer un code pour un envoi à blanc (même règle qu'`appliquerGesteEnMasse`).
    const phrases = ["Aucun email n'est parti."];
    if (inactifs.length > 0) phrases.push(`${inactifs.length} compte${inactifs.length > 1 ? "s" : ""} désactivé${inactifs.length > 1 ? "s" : ""} : ${inactifs.join(", ")}.`);
    if (sansEmail.length > 0) phrases.push(`Sans adresse email : ${sansEmail.join(", ")}.`);
    return { erreur: phrases.join(" ") };
  }

  // Le code récent est redemandé **avant** le premier envoi : après, les clés sont parties. La suite est
  // la liste des membres, d'où le geste part.
  await exigerReauth(acteur, "/admin/membres");

  /*
   * **Un envoi par personne, en série, et chacun régénère sa clé** : l'ancien lien meurt et les sessions
   * qu'il a ouvertes avec lui — c'est la promesse du bouton d'une ligne (« L'ancien cessera de
   * fonctionner »), et le bureau doit retrouver la même qu'il agisse sur une personne ou sur trente.
   * `envoyerTousLesLiens` d'une période ne déconnecte pas, mais ce n'est pas le même geste : là-bas on
   * répare des adresses pour tout un trimestre, ici on redonne nommément une clé à des gens qu'on a
   * cochés.
   *
   * **Sauf sur son propre compte** : un administrateur qui se renvoie son lien est devant son écran, le
   * mettre dehors dans la foulée ressemblerait à une panne. Ses *autres* appareils tombent quand même —
   * même règle que le geste unitaire et que « Renvoyer mon lien ».
   */
  const envoyes: typeof partants = [];
  const echecs: string[] = [];
  for (const cible of partants) {
    const parti = await envoyerInvitation(cible.id, periodId, "invitation", {
      deconnecterAppareils: cible.id === acteur.id ? "autres" : "tous",
    });
    if (parti) envoyes.push(cible);
    else echecs.push(`${cible.prenom} ${cible.nom}`);
  }

  /*
   * **Une entrée d'audit par personne**, sous la même action que le geste unitaire et avec la même
   * cible (la période) : un seul filtre du journal doit répondre à « quand Chloé a-t-elle reçu son
   * dernier lien ? ». Hors transaction et après les envois : `audit()` ne lève jamais, et une trace qui
   * échoue ne doit pas faire croire qu'aucun email n'est parti.
   */
  for (const cible of envoyes) {
    await audit(acteur, "invitation.renvoyee", periodId, { userId: cible.id, appareilsDeconnectes: true, enMasse: true });
  }

  revalidatePath("/admin/membres");
  revalidatePath("/admin/periodes");

  const n = envoyes.length;
  const phrases = [n === 1 ? "1 email parti : son lien précédent ne fonctionne plus." : `${n} emails partis : les liens précédents ne fonctionnent plus.`];
  // Les écartés sont dits, nom par nom : c'est la différence entre « écarté » et « oublié ».
  if (inactifs.length > 0) {
    phrases.push(
      `${inactifs.length} compte${inactifs.length > 1 ? "s" : ""} désactivé${inactifs.length > 1 ? "s" : ""} — rien ne leur a été envoyé : ${inactifs.join(", ")}.`,
    );
  }
  if (sansEmail.length > 0) {
    phrases.push(
      `${sansEmail.length === 1 ? "1 personne n'a pas d'adresse email" : `${sansEmail.length} personnes n'ont pas d'adresse email`} — renseigne-la pour leur envoyer leur lien : ${sansEmail.join(", ")}.`,
    );
  }
  // Un envoi que la file refuse (adresse effacée entre-temps) est dit lui aussi : « il n'a rien reçu »
  // se tranche sur l'écran des derniers emails, pas sur un silence.
  if (echecs.length > 0) phrases.push(`${echecs.length} envoi${echecs.length > 1 ? "s" : ""} n'${echecs.length > 1 ? "ont" : "a"} pas pu partir : ${echecs.join(", ")}.`);
  return { succes: phrases.join(" ") };
}
