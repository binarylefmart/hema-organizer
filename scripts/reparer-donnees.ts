/**
 * Réparation des incohérences déjà inscrites en base.
 *
 * **Pourquoi ce script existe.** Plusieurs défauts corrigés dans le code ont laissé derrière eux des
 * lignes fausses : corriger `retirerMembrePeriode` n'efface pas les réponses qu'il aurait dû
 * effacer, et corriger la suppression d'une séance ne rattache pas les ateliers qu'elle a laissés en
 * l'air. Le code neuf ne réécrit pas le passé — c'est le travail de cet outil, lancé une fois, à la
 * main, sur l'instance du club.
 *
 * **Ce qu'il contrôle** (chaque contrôle est nommé, on peut n'en lancer qu'un avec `--seulement`) :
 *
 * | nom             | incohérence                                                              | réparation                        |
 * |-----------------|--------------------------------------------------------------------------|-----------------------------------|
 * | `fantomes`      | `Attendance` d'une personne qui n'est plus invitée sur la période         | la ligne est supprimée            |
 * | `ateliers`      | `Atelier` PLANIFIE rattaché à une séance disparue                         | repasse « en attente », détaché   |
 * | `notifications` | `NotificationLog` écrit deux fois par un check-then-act (même jour)       | la ligne en trop est supprimée    |
 * | `liens`         | plusieurs `Invitation` vivantes pour la même personne sur la même période | les plus anciennes sont révoquées |
 * | `parties`       | case de planning pointant vers un atelier qui n'y est plus                | la case est détachée              |
 * | `rangs`         | `ordre` troué ou `libelle` qui ne dit plus le rang dans sa nature         | rang et nom remis d'accord         |
 * | `creneaux`      | `dedupKey` de récap ou de rappel d'avant l'empreinte du créneau           | la clé est **renommée**           |
 * | `vides`         | partie **vide en trop** : au-delà des deux cours du modèle                | la partie est supprimée, rangs refaits |
 *
 * Un neuvième relevé, **purement informatif** et jamais réparé, liste les lignes dont la clé
 * étrangère pointe vers un parent disparu (`PRAGMA foreign_key_check`). Une base saine n'en a
 * aucune ; s'il en sort, c'est une corruption d'un autre ordre, qui se règle à la main.
 *
 * **Usage**
 *
 *   npm run db:reparer                      # vérifie et n'écrit RIEN (comportement par défaut)
 *   npm run db:reparer -- --reparer         # sauvegarde la base, puis répare en transaction
 *   npm run db:reparer -- --reparer --seulement=fantomes
 *   npm run db:reparer -- --tout            # n'abrège pas les listes de détail
 *
 * **Règles tenues par ce fichier**, dans l'ordre où elles comptent :
 * 1. sans `--reparer`, aucune écriture — on peut le lancer les yeux fermés ;
 * 2. avec `--reparer`, une sauvegarde part **avant** la moindre modification ;
 * 3. rien n'est supprimé en silence : chaque ligne touchée est affichée avant de l'être ;
 * 4. rejouable : relancé sur une base saine, il ne fait rien et le dit ;
 * 5. la sortie ne nomme personne au-delà du strict nécessaire — un prénom, jamais une adresse.
 */
import path from "node:path";
// Fonction **pure** (ni base ni réseau) : c'est la seule définition de l'empreinte du
// créneau dans le dossier, et la réécriture des clés doit suivre l'application au mot près.
import { empreinteCreneau } from "../src/lib/notifications/planification";
// Même raison, et même exigence : les deux invariants d'une séance (rangs contigus, libellés d'accord
// avec eux) ne se calculent qu'à un seul endroit — celui que l'application appelle à chaque écriture.
// Le module est **sans Prisma**, ce qui permet de garder la règle du fichier : aucun contrôle n'ouvre
// de base.
import { rangementsParties, type RangementPartie } from "../src/components/planning/rangement";
// Même exigence encore : « vide » n'a **qu'une** définition dans le dépôt (`reglagesVides`), celle que
// l'écran de saisie et le serveur partagent déjà. Un contrôle qui la recopierait finirait par
// supprimer ce que l'application considère comme rempli. Les deux modules sont purs.
import { reglagesVides } from "../src/components/planning/options";
import { PARTIES_MODELE } from "../src/lib/constants";

/* ────────────────────────────── Ce que le script sait détecter ──────────────────────────────
 *
 * Toute la détection vit dans des fonctions **pures** : elles reçoivent des tableaux, elles
 * renvoient les lignes fautives, elles ne connaissent ni Prisma ni la console. C'est ce qui permet
 * de les éprouver dans `tests/unit/reparer-donnees.test.ts` sans approcher la moindre base.
 */

/** Nom des contrôles, dans l'ordre où le rapport les présente. */
export const CONTROLES = ["fantomes", "ateliers", "notifications", "liens", "parties", "rangs", "creneaux", "vides"] as const;
export type Controle = (typeof CONTROLES)[number];

export type LigneReponse = {
  userId: string;
  prenom: string;
  sessionId: string;
  date: string;
  lieu: string;
  statut: string;
  periodId: string;
};

export type LigneAtelier = { id: string; titre: string; statut: string; sessionId: string | null };

export type LigneNotification = {
  id: string;
  type: string;
  canal: string;
  statut: string;
  sessionId: string | null;
  userId: string | null;
  dedupKey: string;
  date: Date;
};

export type LigneInvitation = {
  id: string;
  userId: string;
  prenom: string;
  periodId: string;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
};

export type LignePartie = { id: string; sessionId: string; libelle: string; atelierId: string | null };

/** Ce qu'il faut d'une partie pour juger son rang et son nom — exactement l'entrée de `rangementsParties`. */
export type LignePartieRang = { id: string; sessionId: string; libelle: string; ordre: number; estOption: boolean; updatedAt: Date };

/** Une partie à ranger : ce qu'elle porte aujourd'hui, et ce qu'elle doit porter (`updatedAt` compris, inchangé). */
export type RangAReparer = { id: string; sessionId: string; libelle: string; ordre: number; data: RangementPartie["data"] };

/** Un groupe de lignes identiques : une seule est gardée, les autres sont en trop. */
export type GroupeDoublons<T> = { gardee: T; enTrop: T[] };

/**
 * 1. **Réponses fantômes.** `Attendance` ne cascade pas depuis `PeriodMember` : retirer quelqu'un
 * d'une période laissait ses réponses derrière lui. Le numérateur (les présents) les compte encore,
 * le dénominateur (les invités) non — d'où « 12 présents sur 11 » et les taux au-dessus de 100 %.
 *
 * `invites` porte les couples « periodId:userId » de `PeriodMember`.
 */
export function detecterReponsesFantomes(
  reponses: readonly LigneReponse[],
  invites: ReadonlySet<string>,
): LigneReponse[] {
  return reponses.filter((r) => !invites.has(`${r.periodId}:${r.userId}`));
}

/** Couple de clé pour `detecterReponsesFantomes`, au même format des deux côtés. */
export function cleInvite(periodId: string, userId: string): string {
  return `${periodId}:${userId}`;
}

/**
 * 2. **Ateliers `PLANIFIE` orphelins.** Supprimer une séance met `Atelier.sessionId` à null
 * (`onDelete: SetNull`) mais laisse le statut à `PLANIFIE` : la proposition reste « au planning »
 * d'un cours qui n'existe plus, donc invisible et impossible à replacer. `supprimerPeriode` sait
 * déjà quoi faire dans ce cas (`src/actions/periodes.ts`) et c'est sa règle qu'on rejoue ici : la
 * proposition **repasse en attente**, elle n'est jamais supprimée — c'est l'écrit d'un membre.
 *
 * Deux formes, la seconde ne devant pas exister mais coûtant une ligne à couvrir : la séance a
 * été détachée (`sessionId` null) ou l'identifiant pointe dans le vide (clé étrangère non tenue).
 */
export function detecterAteliersOrphelins(
  ateliers: readonly LigneAtelier[],
  seancesExistantes: ReadonlySet<string>,
): LigneAtelier[] {
  return ateliers.filter((a) => a.statut === "PLANIFIE" && (a.sessionId === null || !seancesExistantes.has(a.sessionId)));
}

/**
 * Horodatage d'exécution glissé dans une clé de déduplication : 13 chiffres, soit `Date.now()`
 * jusqu'en l'an 2286. C'est exactement ce qui empêche ces clés-là de dédupliquer quoi que ce soit.
 */
const HORODATAGE = /(?<![0-9])\d{13}(?![0-9])/g;

/** La même clé, son horodatage d'exécution remplacé — deux passages d'un même envoi se rejoignent. */
export function normaliserCleDeduplication(cle: string): string {
  return cle.replace(HORODATAGE, "<horodatage>");
}

/** Vrai si la clé porte un horodatage d'exécution, donc si elle ne peut plus servir de garde-fou. */
export function cleHorodatee(cle: string): boolean {
  return normaliserCleDeduplication(cle) !== cle;
}

/**
 * Écart maximal entre deux lignes du journal pour qu'elles soient le **même** envoi écrit deux fois.
 * Une course entre deux exécutions s'écrit en quelques millisecondes ; un renvoi décidé par un
 * humain se compte en minutes. Voir `detecterNotificationsEnDouble`.
 */
export const FENETRE_DOUBLON_MS = 5_000;

/** Journée locale d'une date (« AAAA-MM-JJ »), fuseau du serveur — TZ vaut Europe/Paris ici. */
export function jourLocal(d: Date): string {
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
}

/**
 * 3. **Doublons du journal des notifications.** `dedupKey` est `@unique` : deux lignes strictement
 * identiques sont impossibles. Le doublon vient d'ailleurs — d'un check-then-act (`alertes.ts` lit
 * puis écrit, sans garde-fou entre les deux) posé sur une clé qui porte un `Date.now()`
 * (`invitation_<user>_<motif>_<horodatage>`, `annulation_push_<seance>_<horodatage>_<user>`). Deux
 * exécutions simultanées produisent alors deux clés différentes pour le même envoi, et l'unicité ne
 * les voit pas passer.
 *
 * **Deux garde-fous, et ils sont le cœur de ce contrôle :**
 *
 * - on n'examine **que** les clés horodatées. Une clé stable (`recap_email_<seance>_<membre>`) est
 *   encore lue par l'application pour décider de ne pas renvoyer un message ; l'effacer ferait
 *   repartir l'envoi. Une clé horodatée, elle, ne sera jamais recalculée à l'identique : elle ne
 *   garde plus rien, on peut l'effacer sans réveiller quoi que ce soit ;
 * - les clés d'échec (`…_echec_<horodatage>`, voir `journal.ts`) sont écartées : elles ne sont pas
 *   un double envoi mais la trace de **tentatives distinctes**, et cette trace est ce qui explique
 *   un « il n'a rien reçu ».
 *
 * Le regroupement suit l'énoncé du défaut — même type, même canal, même issue, même cible, même
 * journée — plus la clé normalisée, pour ne jamais confondre deux messages différents qui se
 * seraient croisés le même jour. La ligne la plus ancienne du groupe est gardée : c'est celle qui
 * correspond à l'envoi réellement parti en premier.
 *
 * **Le troisième garde-fou est le plus important, et il vient de la vraie base.** « Même type, même
 * cible, même journée » ne suffit pas : l'équipe renvoie légitimement le lien de quelqu'un deux fois
 * dans la même journée (« je n'ai rien reçu »), et chacune de ces lignes est la trace d'un envoi
 * réel — c'est elle que l'écran « Derniers emails envoyés » montre pour trancher. Relevé sur la base
 * du club : **171 lignes** répondaient au critère de la journée, et **aucune** n'était un doublon —
 * la plus rapprochée était à 71 secondes de sa voisine, la médiane à 23 minutes. Un doublon né
 * d'une course entre deux exécutions, lui, s'écrit dans le même souffle. D'où la fenêtre : deux
 * lignes ne sont un doublon que si elles ont été écrites **à moins de cinq secondes** l'une de
 * l'autre. Au-delà, ce sont deux envois, et on n'efface pas la mémoire d'un envoi.
 */
export function detecterNotificationsEnDouble(
  lignes: readonly LigneNotification[],
  fenetreMs: number = FENETRE_DOUBLON_MS,
): GroupeDoublons<LigneNotification>[] {
  const groupes = new Map<string, LigneNotification[]>();
  for (const l of lignes) {
    if (!cleHorodatee(l.dedupKey)) continue;
    if (l.dedupKey.includes("_echec_")) continue;
    const cle = [
      l.type,
      l.canal,
      l.statut,
      l.sessionId ?? "-",
      l.userId ?? "-",
      normaliserCleDeduplication(l.dedupKey),
      jourLocal(l.date),
    ].join("\u0000");
    const deja = groupes.get(cle);
    if (deja) deja.push(l);
    else groupes.set(cle, [l]);
  }
  const doublons: GroupeDoublons<LigneNotification>[] = [];
  for (const groupe of groupes.values()) {
    if (groupe.length < 2) continue;
    const trie = [...groupe].sort((a, b) => a.date.getTime() - b.date.getTime() || a.id.localeCompare(b.id));
    // Grappes de lignes écrites coup sur coup : deux envois séparés dans la journée restent
    // deux lignes distinctes, chacune dans sa grappe.
    let grappe: LigneNotification[] = [trie[0]];
    const fermer = () => {
      if (grappe.length > 1) doublons.push({ gardee: grappe[0], enTrop: grappe.slice(1) });
    };
    for (const l of trie.slice(1)) {
      if (l.date.getTime() - grappe[grappe.length - 1].date.getTime() <= fenetreMs) grappe.push(l);
      else {
        fermer();
        grappe = [l];
      }
    }
    fermer();
  }
  return doublons;
}

/**
 * 4. **Liens personnels concurrents.** L'invariant annoncé par `createInvitation` est « un seul lien
 * vivant par personne et par période » : un lien neuf révoque les précédents (motif `REMPLACE`).
 * Rouvrir une période le casse — elle remet en service les liens que la clôture avait révoqués, sans
 * regarder si un lien plus récent est né entre-temps. La personne se retrouve avec deux clés
 * valables, dont une qu'on croyait morte.
 *
 * **On garde celui qui vaut le plus longtemps**, pas le plus récemment créé : c'est celui-là que la
 * personne a dans sa boîte aux lettres, et se tromper ici, c'est enfermer quelqu'un dehors. Les
 * autres sont révoqués comme l'aurait fait `createInvitation`, motif `REMPLACE` — donc l'application
 * proposera d'elle-même un lien neuf à qui ouvrirait l'ancien (`peutRenvoyerLien`).
 */
export function detecterLiensConcurrents(invitations: readonly LigneInvitation[]): GroupeDoublons<LigneInvitation>[] {
  const groupes = new Map<string, LigneInvitation[]>();
  for (const i of invitations) {
    if (i.revokedAt !== null) continue;
    const cle = `${i.periodId}\u0000${i.userId}`;
    const deja = groupes.get(cle);
    if (deja) deja.push(i);
    else groupes.set(cle, [i]);
  }
  const doublons: GroupeDoublons<LigneInvitation>[] = [];
  for (const groupe of groupes.values()) {
    if (groupe.length < 2) continue;
    const trie = [...groupe].sort(
      (a, b) =>
        b.expiresAt.getTime() - a.expiresAt.getTime() ||
        b.createdAt.getTime() - a.createdAt.getTime() ||
        a.id.localeCompare(b.id),
    );
    doublons.push({ gardee: trie[0], enTrop: trie.slice(1) });
  }
  return doublons;
}

/**
 * 5. **Cases de planning détachées.** Une case (`SessionPartie`) qui porte un `atelierId` est une
 * case *réservée* : l'écran du planning refuse de la modifier autrement que par la gestion des
 * ateliers. Elle n'a donc de sens que si l'atelier existe encore, qu'il est toujours `PLANIFIE`, et
 * qu'il est planifié sur **cette** séance — les trois conditions que `placerAtelier` établit et que
 * `retirerAtelier` défait en **vidant** la case (`atelierId`, instructeurs, thème et niveau remis à
 * zéro, `src/lib/planning.ts`). Il ne la **supprime pas** : depuis les parties libres, la partie
 * reste dans la séance, où l'équipe peut la remplir autrement — et c'est bien pourquoi une case
 * détachée est réparable ici plutôt que perdue. Le commentaire disait « supprime la case entière » :
 * c'est la phrase que lira celui qui décide de lancer `--reparer` sur la base du club, il ne doit pas
 * y croire qu'il va perdre une partie.
 *
 * Tout autre état est une case verrouillée pour rien, que plus personne ne peut libérer depuis
 * l'application. La réparation la détache (`atelierId` à null) sans effacer ni le thème ni
 * l'animateur : la case redevient une case ordinaire, modifiable.
 */
export function detecterPartiesDetachees(
  parties: readonly LignePartie[],
  ateliers: readonly LigneAtelier[],
): LignePartie[] {
  const parId = new Map(ateliers.map((a) => [a.id, a]));
  return parties.filter((p) => {
    if (p.atelierId === null) return false;
    const atelier = parId.get(p.atelierId);
    if (!atelier) return true;
    return atelier.statut !== "PLANIFIE" || atelier.sessionId !== p.sessionId;
  });
}

/**
 * 6. **Rangs et noms des parties d'une séance.** Les deux invariants que `rangerParties` tient — et
 *    qu'elle est **seule** à tenir : `ordre` contigu à partir de 0, et `libelle` qui redit le rang de
 *    la partie **dans sa nature** (« Cours 1 », « Option 2 »…).
 *
 * **Pourquoi ce contrôle existe.** Les cinq gestes du planning passent par cette fonction, mais
 * rien ne relisait la base pour dire si elle y est d'accord. Or les deux invariants ont déjà été
 * faux : une migration a laissé des rangs troués et dupliqués (deux « Opt 2 », aucun rang 0), et la
 * migration de vocabulaire suivante a renommé **par valeur** des libellés que les rangs venaient de
 * décaler. Ce sont exactement les deux maladies dont le script ne savait rien : il ne regardait les
 * parties que pour y chercher un atelier disparu.
 *
 * **Ce que ça casse quand c'est faux** : `ordre` décide de l'ordre du programme partout (fiche de la
 * séance, API publique, pages de partage, objet de l'email du soir) — troué puis dupliqué, c'est la
 * base qui tranche, donc l'affichage change d'une lecture à l'autre ; et `libelle` est lu **tel quel**
 * par l'API publique, les emails et les embeds, qui ne recomptent pas le rang : une séance peut
 * afficher deux « Cours 2 » et aucun « Cours 1 ».
 *
 * **La règle n'est pas réécrite ici** : c'est `rangementsParties` (`src/components/planning/rangement.ts`)
 * qui la porte, la même fonction que l'application appelle à chaque écriture — un contrôle qui
 * recalculerait de son côté finirait par valider autre chose que ce que le code tient. Et la
 * réparation rend à chaque ligne son `updatedAt` : réparer un rang n'est pas une modification du
 * programme par quelqu'un, et la bulle « Modifié par … le … » de la grille lit ce champ.
 */
export function detecterRangsIncoherents(parties: readonly LignePartieRang[]): RangAReparer[] {
  const parSeance = new Map<string, LignePartieRang[]>();
  for (const p of parties) {
    const liste = parSeance.get(p.sessionId);
    if (liste) liste.push(p);
    else parSeance.set(p.sessionId, [p]);
  }
  const aReparer: RangAReparer[] = [];
  for (const [sessionId, liste] of parSeance) {
    const parId = new Map(liste.map((p) => [p.id, p]));
    for (const r of rangementsParties(liste)) {
      const avant = parId.get(r.id)!;
      aReparer.push({ id: r.id, sessionId, libelle: avant.libelle, ordre: avant.ordre, data: r.data });
    }
  }
  return aReparer;
}

/** Ce que dit une ligne à réparer, en français, pour le rapport : « séance …, "Cours 2" (rang 3) → "Cours 3" (rang 2) ». */
export function decrireRang(r: RangAReparer): string {
  const nom = r.data.libelle === undefined ? `« ${r.libelle} »` : `« ${r.libelle} » → « ${r.data.libelle} »`;
  const rang = r.data.ordre === undefined ? `rang ${r.ordre}` : `rang ${r.ordre} → ${r.data.ordre}`;
  return `séance ${r.sessionId}, ${nom} (${rang})`;
}

/** Une partie, avec tout ce qu'il faut pour dire si elle est vide **et** où elle se range. */
export type LignePartieComplete = LignePartieRang & {
  /**
   * La date de la séance (`AAAA-MM-JJ`, telle qu'elle est stockée) : un identifiant ne dit pas de
   * quel soir il s'agit, et une date ne nomme personne.
   */
  date: string;
  /**
   * Qui a écrit dans cette case la dernière fois. **La seule chose visible à l'écran que
   * `reglagesVides` ne regarde pas** : la grille du planning en fait une bulle « Modifié par … le
   * … ». Une option remplie **puis vidée exprès** la garde, et la supprimer effacerait la seule
   * trace de ce travail.
   */
  modifieParId: string | null;
  atelierId: string | null;
  instructeurId: string | null;
  instructeurSecondId: string | null;
  theme: string | null;
  description: string | null;
  niveau: string | null;
};

/** Ce que le contrôle `vides` a trouvé : les parties à retirer, et le rangement des survivantes. */
export type SurnumerairesAReparer = {
  aSupprimer: LignePartieComplete[];
  rangs: RangAReparer[];
  /**
   * Les séances qui se retrouveront **sans aucune partie** : celles qui n'avaient que des options
   * vides, donc aucun cours à protéger. L'état est atteignable à la main (`retirerPartie` n'impose
   * aucun minimum) et l'écran le supporte — « Programme à venir. » en lecture, les boutons d'ajout à
   * l'encadrement —, mais il ne s'obtient pas sans le savoir : le rapport le dit.
   */
  seancesVidees: string[];
};

/**
 * 8. **Les parties vides en trop.** Demande de Delta, : « de base je veux dans le planning de base
 *    uniquement cours 1 et cours 2 par séance, le reste en ajout si voulu ».
 *
 * **Le code le fait déjà, et** : `PARTIES_MODELE` ne porte plus que deux cours, donc toute séance
 * **créée depuis** naît avec deux cours et rien d'autre. Ce contrôle existe pour les séances
 * d'**avant** : le modèle en portait quatre — deux cours, deux options —, héritage des quatre cases
 * figées de la grille d'. Un trimestre entier a donc été engendré avec **deux options vides par
 * séance**, que personne n'a remplies et que le code neuf ne réécrit pas. Une case vide ne dit rien
 * d'autre que « il manque quelque chose » : sur seize séances, c'est trente-deux lignes qui
 * mentent, dans le planning, dans la fiche de chaque séance, et dans l'objet des emails du soir.
 *
 * **Ce qui est retiré, et rien d'autre** : une partie qui est à la fois (1) au-delà des deux cours du
 * modèle, (2) **vide** au sens unique du dépôt (`reglagesVides` : ni instructeur, ni second, ni thème,
 * ni description, ni niveau affiché) et (3) sans atelier retenu. Les **deux premiers cours sont
 * protégés même vides** — ils sont le modèle, pas un ajout —, et une option remplie ne bouge pas, où
 * qu'elle soit.
 *
 * **Le rangement suit dans le même geste.** Retirer une ligne troue les rangs et décale les noms de sa
 * série : la liste des survivantes repasse donc par `rangementsParties`, la fonction que l'application
 * appelle à chaque écriture. Les sessions traitées ici sont retirées du contrôle `rangs`, qui juge sur
 * l'instantané d'**avant** la suppression — deux plans concurrents sur la même séance, c'est le second
 * qui réécrit ce que le premier vient de ranger.
 */
export function detecterPartiesSurnumeraires(parties: readonly LignePartieComplete[]): SurnumerairesAReparer {
  const parSeance = new Map<string, LignePartieComplete[]>();
  for (const p of parties) {
    const liste = parSeance.get(p.sessionId);
    if (liste) liste.push(p);
    else parSeance.set(p.sessionId, [p]);
  }
  const aSupprimer: LignePartieComplete[] = [];
  const rangs: RangAReparer[] = [];
  const seancesVidees: string[] = [];
  for (const [sessionId, brut] of parSeance) {
    // L'ordre affiché, et `id` pour trancher deux rangs identiques — une base trouée en a déjà eu.
    const liste = [...brut].sort((x, y) => x.ordre - y.ordre || x.id.localeCompare(y.id));
    // Le modèle d'une séance neuve : ses premiers cours, protégés même vides.
    const protegees = new Set<string>();
    const coursDuModele = PARTIES_MODELE.filter((m) => !m.estOption).length;
    for (const p of liste) {
      if (!p.estOption && protegees.size < coursDuModele) protegees.add(p.id);
    }
    const enTrop = liste.filter(
      (p) =>
        !protegees.has(p.id) &&
        p.atelierId === null &&
        /*
         * **Un outil qui supprime a le droit d'être plus prudent que l'écran.** `reglagesVides` est
         * la définition unique de « vide » et elle ne bouge pas ; mais une case que quelqu'un a
         * **touchée** porte encore son auteur (`modifieParId`), dont la grille fait une bulle
         * « Modifié par … le … ». Une option remplie puis vidée exprès serait donc effacée avec la
         * seule trace de ce travail — alors qu'elle n'a rien coûté à personne là où elle est. Sur la
         * base du club, les options que l'ancien modèle posait d'office n'ont jamais été touchées :
         * ce garde-fou ne retient rien de ce qu'on vient chercher.
         */
        p.modifieParId === null &&
        reglagesVides({
          instructeur: p.instructeurId,
          instructeurSecond: p.instructeurSecondId,
          theme: p.theme,
          description: p.description,
          niveau: p.niveau,
        }),
    );
    if (enTrop.length === 0) continue;
    aSupprimer.push(...enTrop);
    const retires = new Set(enTrop.map((p) => p.id));
    const restantes = liste.filter((p) => !retires.has(p.id));
    if (restantes.length === 0) seancesVidees.push(`séance du ${dateFr(liste[0].date)}`);
    const parId = new Map(restantes.map((p) => [p.id, p]));
    for (const r of rangementsParties(restantes)) {
      const avant = parId.get(r.id)!;
      rangs.push({ id: r.id, sessionId, libelle: avant.libelle, ordre: avant.ordre, data: r.data });
    }
  }
  return { aSupprimer, rangs, seancesVidees };
}

/* « 2026-09-24 » → « », sans dépendance : une date de séance est une chaîne en base. */
const dateFr = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

/**
 * « séance, « Option 2 » (rang 3) » — ce qui part, et d'où.
 *
 * **La date, et pas seulement l'identifiant** : un `cuid` ne dit pas de quel soir il s'agit, et
 * cette ligne est la seule trace par case d'une suppression. La règle « la sortie ne nomme
 * personne » est intacte — une date de cours ne nomme personne.
 */
export function decrirePartieEnTrop(p: LignePartieComplete): string {
  return `séance du ${dateFr(p.date)}, « ${p.libelle} » (rang ${p.ordre})`;
}

/**
 * 7. **Clés de déduplication d'avant l'empreinte du créneau.**
 *
 * **Pourquoi ce contrôle existe.** Depuis, les clés du récap de la veille et des rappels portent le
 * **créneau** de la séance (`empreinteCreneau`, dans `src/lib/notifications/planification.ts`) :
 * `recap_email_<sessionId>_<AAAA-MM-JJ-hhmm>_<userId>` au lieu de
 * `recap_email_<sessionId>_<userId>`. C'était nécessaire — une séance *déplacée* garde son
 * identifiant, et l'ancienne clé interdisait à jamais l'annonce de la bonne date après celle de la
 * mauvaise. Mais les lignes **déjà en base** sont restées à l'ancienne forme, et rien dans
 * l'application ne les réécrit : pour elle, ces envois n'ont jamais eu lieu.
 *
 * **Le danger, très concret.** Les envois du soir repassent toutes les `PAS_RATTRAPAGE_MIN`
 * minutes pendant `FENETRE_RATTRAPAGE_MIN` minutes après l'heure réglée. Déployer à 18 h 20 alors
 * que le récap de 18 h 00 est déjà parti, c'est donc voir le passage de 18 h 30 ne plus reconnaître
 * aucune clé et **renvoyer à tout le club** le récap du lendemain — email, téléphone, Discord,
 * Telegram — plus les rappels de la soirée. Une fois. À tout le monde. Sans moyen de le rattraper.
 *
 * **Quand le lancer : juste après le déploiement, et avant le prochain récap.**
 *
 *     npm run db:reparer -- --seulement=creneaux              (vérifie, n'écrit rien)
 *     npm run db:reparer -- --reparer --seulement=creneaux    (réécrit les clés)
 *
 * Il rend inutile la consigne « ne pas déployer entre l'heure du récap et la fin de la fenêtre de
 * rattrapage » : une fois passé, les clés anciennes sont devenues des clés neuves, et le passage
 * suivant du cron les reconnaît.
 *
 * **Ce qu'il ne fait jamais.**
 *
 * - **Aucune suppression.** On *renomme* (`dedupKey` est `@unique`, la ligne, elle, ne bouge pas) :
 *   effacer une clé, c'est faire repartir l'envoi qu'elle retenait, exactement ce qu'on veut éviter.
 * - **Aucun créneau deviné.** La date et l'heure viennent de la séance, retrouvée par le
 *   `sessionId` de la ligne — et, si la colonne est vide (`onDelete: SetNull` l'efface quand la
 *   séance est supprimée, et les plus vieilles lignes sont antérieures à cette colonne), par
 *   l'identifiant écrit dans la clé elle-même. Séance introuvable : la ligne est **laissée telle
 *   quelle** et signalée dans le rapport. Une clé de séance effacée ne retient plus rien de toute
 *   façon — cette séance ne reviendra pas dans un récap.
 * - **Aucun écrasement.** Si la clé au nouveau format existe déjà (l'application l'a écrite entre
 *   le déploiement et le passage de ce script), la réécriture ferait doublon sur une colonne
 *   `@unique` : on garde l'ancienne, on le dit, et l'envoi reste retenu par la neuve.
 * - **Aucune touche aux clés d'échec** (`…_echec_<horodatage>`, voir `journal.ts`) : ce sont des
 *   traces de tentatives, plus des garde-fous — leur clé nominale a déjà été libérée.
 *
 * Rejouable par construction : une clé qui porte déjà l'empreinte est reconnue et ignorée.
 */

/** L'empreinte d'un créneau telle que `empreinteCreneau` l'écrit : « 2026-10-08-1930 ». */
const EMPREINTE = /^\d{4}-\d{2}-\d{2}-\d{4}$/;

/**
 * Les clés qui doivent porter le créneau, découpées en « préfixe », « identifiant de séance » et
 * « le reste » (`<userId>` pour les envois individuels, rien pour Discord et Telegram).
 *
 * Un identifiant cuid ne contient jamais de `_` : la découpe est sans ambiguïté, et aucune autre
 * famille de clés (`effectif_`, `annulation_`, `invitation_`, `atelier_`…) n'y répond — ce qui est
 * vital, puisque ces clés-là n'ont jamais porté de créneau.
 */
const CLE_A_CRENEAU = /^(recap_(?:email|push|discord|telegram)|rappel_(?:push_)?j\d+)_([^_]+)(?:_(.+))?$/;

/** Une clé à renommer : la ligne, ce qu'elle porte aujourd'hui, ce qu'elle portera. */
export type ReecritureCle = { id: string; ancienne: string; nouvelle: string; sessionId: string };

export type ClesSansCreneau = {
  /** Créneau retrouvé et clé cible libre : ce sont les seules lignes que la réparation touche. */
  aReecrire: ReecritureCle[];
  /** Séance introuvable : le créneau ne se reconstruit pas, on laisse et on le dit. */
  sansSeance: Array<{ id: string; dedupKey: string; sessionId: string }>;
  /** La clé au nouveau format existe déjà : renommer ferait doublon, on garde l'ancienne. */
  dejaPrises: ReecritureCle[];
};

/**
 * Relève les clés à réécrire. `seances` porte le créneau de chaque séance encore existante
 * (`sessionId` → `{ date, heureDebut }`). Fonction **pure** : aucune base, aucun effet.
 */
export function detecterClesSansCreneau(
  lignes: readonly LigneNotification[],
  seances: ReadonlyMap<string, { date: string; heureDebut: string }>,
): ClesSansCreneau {
  // Toutes les clés déjà présentes : c'est ce qui garantit qu'aucune réécriture n'en écrasera une
  // autre. Les cibles retenues y sont ajoutées au fur et à mesure, pour la même raison.
  const existantes = new Set(lignes.map((l) => l.dedupKey));
  const releve: ClesSansCreneau = { aReecrire: [], sansSeance: [], dejaPrises: [] };
  for (const l of lignes) {
    if (l.dedupKey.includes("_echec_")) continue;
    const m = CLE_A_CRENEAU.exec(l.dedupKey);
    if (!m) continue;
    const [, prefixe, idDansLaCle, suite = ""] = m;
    // Déjà au nouveau format : le segment qui suit l'identifiant de séance est une empreinte.
    if (EMPREINTE.test(suite.split("_")[0])) continue;
    // La colonne d'abord (c'est elle qui fait foi), l'identifiant de la clé à défaut.
    const sessionId = l.sessionId ?? idDansLaCle;
    const seance = seances.get(sessionId);
    if (!seance) {
      releve.sansSeance.push({ id: l.id, dedupKey: l.dedupKey, sessionId });
      continue;
    }
    const nouvelle = `${prefixe}_${idDansLaCle}_${empreinteCreneau(seance)}${suite ? `_${suite}` : ""}`;
    const reecriture: ReecritureCle = { id: l.id, ancienne: l.dedupKey, nouvelle, sessionId };
    if (existantes.has(nouvelle)) releve.dejaPrises.push(reecriture);
    else {
      existantes.add(nouvelle);
      releve.aReecrire.push(reecriture);
    }
  }
  return releve;
}

/* ────────────────────────────── Arguments de la ligne de commande ────────────────────────────── */

export type Options = { reparer: boolean; tout: boolean; controles: Set<Controle>; aide: boolean };

export class ArgumentInvalide extends Error {}

/**
 * `--verifier` est le défaut : réparer se demande, ne se subit pas. C'est la seule règle qui rend ce
 * script lançable sans réfléchir, donc lançable tout court.
 */
export function lireArguments(argv: readonly string[]): Options {
  const options: Options = { reparer: false, tout: false, controles: new Set(CONTROLES), aide: false };
  for (const arg of argv) {
    if (arg === "--verifier") continue; // le défaut, accepté pour que l'intention puisse s'écrire
    else if (arg === "--reparer") options.reparer = true;
    else if (arg === "--tout") options.tout = true;
    else if (arg === "--aide" || arg === "-h" || arg === "--help") options.aide = true;
    else if (arg.startsWith("--seulement=")) {
      const noms = arg
        .slice("--seulement=".length)
        .split(",")
        .map((n) => n.trim())
        .filter((n) => n !== "");
      if (noms.length === 0) throw new ArgumentInvalide("--seulement= attend au moins un contrôle.");
      for (const n of noms) {
        if (!(CONTROLES as readonly string[]).includes(n)) {
          throw new ArgumentInvalide(`Contrôle inconnu : « ${n} ». Au choix : ${CONTROLES.join(", ")}.`);
        }
      }
      options.controles = new Set(noms as Controle[]);
    } else throw new ArgumentInvalide(`Option inconnue : « ${arg} ». Lance --aide pour la liste.`);
  }
  return options;
}

const AIDE = `Réparation des incohérences de la base — HEMA Organizer

  npm run db:reparer                          vérifie et n'écrit rien (défaut)
  npm run db:reparer -- --reparer             sauvegarde la base, puis répare
  npm run db:reparer -- --seulement=<a,b>     n'examine que ces contrôles
  npm run db:reparer -- --tout                n'abrège pas les listes de détail
  npm run db:reparer -- --aide                ce message

Contrôles : ${CONTROLES.join(", ")}`;

/* ────────────────────────────── Rapport ────────────────────────────── */

/** Au-delà, la liste de détail est abrégée (sauf `--tout`) : un rapport illisible n'est pas lu. */
const DETAIL_MAX = 15;

function ligne(texte = ""): void {
  console.info(texte);
}

function titre(texte: string): void {
  ligne();
  ligne(texte);
  ligne("─".repeat(Math.min(texte.length, 78)));
}

function pluriel(n: number, singulier: string, plur = `${singulier}s`): string {
  return `${n} ${n > 1 ? plur : singulier}`;
}

/** Affiche les lignes de détail, abrégées si elles sont nombreuses. */
function detail(lignes: readonly string[], tout: boolean): void {
  const montrees = tout ? lignes : lignes.slice(0, DETAIL_MAX);
  for (const l of montrees) ligne(`    • ${l}`);
  if (montrees.length < lignes.length) {
    ligne(`    … et ${pluriel(lignes.length - montrees.length, "autre")} (relance avec --tout pour tout voir).`);
  }
}

/* ────────────────────────────── Relevé, puis réparation ────────────────────────────── */

/**
 * Tout est relevé **avant** toute écriture, sur le même instantané : une réparation ne doit jamais
 * changer ce qu'une autre croit avoir vu (un atelier remis « en attente » ferait par exemple
 * apparaître sa case comme détachée).
 */
type Releve = {
  fantomes: LigneReponse[];
  ateliers: LigneAtelier[];
  notifications: GroupeDoublons<LigneNotification>[];
  liens: GroupeDoublons<LigneInvitation>[];
  parties: LignePartie[];
  rangs: RangAReparer[];
  creneaux: ClesSansCreneau;
  vides: SurnumerairesAReparer;
};

type Base = typeof import("../src/lib/db").db;

async function relever(db: Base, controles: ReadonlySet<Controle>): Promise<Releve> {
  const releve: Releve = {
    fantomes: [],
    ateliers: [],
    notifications: [],
    liens: [],
    parties: [],
    rangs: [],
    creneaux: { aReecrire: [], sansSeance: [], dejaPrises: [] },
    vides: { aSupprimer: [], rangs: [], seancesVidees: [] },
  };

  if (controles.has("fantomes")) {
    const [reponses, invites] = await Promise.all([
      db.attendance.findMany({
        select: {
          userId: true,
          sessionId: true,
          statut: true,
          user: { select: { prenom: true } },
          session: { select: { date: true, lieu: true, periodId: true } },
        },
      }),
      db.periodMember.findMany({ select: { periodId: true, userId: true } }),
    ]);
    releve.fantomes = detecterReponsesFantomes(
      reponses.map((r) => ({
        userId: r.userId,
        prenom: r.user.prenom,
        sessionId: r.sessionId,
        date: r.session.date,
        lieu: r.session.lieu,
        statut: r.statut,
        periodId: r.session.periodId,
      })),
      new Set(invites.map((m) => cleInvite(m.periodId, m.userId))),
    );
  }

  if (controles.has("ateliers") || controles.has("parties")) {
    const [ateliers, seances] = await Promise.all([
      db.atelier.findMany({ select: { id: true, titre: true, statut: true, sessionId: true } }),
      db.session.findMany({ select: { id: true } }),
    ]);
    if (controles.has("ateliers")) {
      releve.ateliers = detecterAteliersOrphelins(ateliers, new Set(seances.map((s) => s.id)));
    }
    if (controles.has("parties")) {
      const parties = await db.sessionPartie.findMany({ select: { id: true, sessionId: true, libelle: true, atelierId: true } });
      releve.parties = detecterPartiesDetachees(parties, ateliers);
    }
  }

  if (controles.has("rangs") || controles.has("vides")) {
    // Les parties **entières** de toutes les séances : le rang et le nom d'une partie se jugent sur
    // sa séance complète, jamais ligne à ligne (le nom dit le rang **dans sa nature**), et « vide »
    // se juge sur les cinq réglages. Une seule lecture pour les deux contrôles.
    const brutes = await db.sessionPartie.findMany({
      select: {
        id: true,
        sessionId: true,
        libelle: true,
        ordre: true,
        estOption: true,
        updatedAt: true,
        atelierId: true,
        modifieParId: true,
        instructeurId: true,
        instructeurSecondId: true,
        theme: true,
        description: true,
        niveau: true,
        session: { select: { date: true } },
      },
    });
    const parties = brutes.map(({ session, ...p }) => ({ ...p, date: session.date }));
    if (controles.has("vides")) {
      /*
       * **Le plan du contrôle `parties` est appliqué à l'instantané avant de juger du vide** —
       * sinon une seule réparation ne converge pas. Dans la même transaction, `parties` **détache**
       * une case dont l'atelier a disparu : elle devient vide, mais `vides` avait été calculé quand
       * son `atelierId` ne l'était pas encore, donc elle survivait — et le script concluait «
       * relance pour vérifier qu'il ne reste rien » alors qu'il restait justement quelque chose.
       * Les deux contrôles voient désormais le même avenir.
       */
      const detachees = new Set(releve.parties.map((p) => p.id));
      releve.vides = detecterPartiesSurnumeraires(
        detachees.size === 0 ? parties : parties.map((p) => (detachees.has(p.id) ? { ...p, atelierId: null } : p)),
      );
    }
    if (controles.has("rangs")) {
      /*
       * **Les séances que `vides` va rafraîchir sortent d'ici.** Les deux contrôles rangent la même
       * chose, mais `rangs` juge l'instantané d'**avant** la suppression : laisser les deux plans
       * s'appliquer, c'est le second qui réécrit ce que le premier vient de ranger — et l'un des deux
       * a forcément tort. `vides` porte son propre rangement, calculé sur les survivantes.
       */
      const rafraichies = new Set(releve.vides.aSupprimer.map((p) => p.sessionId));
      releve.rangs = detecterRangsIncoherents(parties).filter((r) => !rafraichies.has(r.sessionId));
    }
  }

  if (controles.has("notifications") || controles.has("creneaux")) {
    // Une seule lecture du journal pour les deux contrôles qui s'en servent.
    const lignes = await db.notificationLog.findMany({
      select: { id: true, type: true, canal: true, statut: true, sessionId: true, userId: true, dedupKey: true, date: true },
    });
    if (controles.has("notifications")) releve.notifications = detecterNotificationsEnDouble(lignes);
    if (controles.has("creneaux")) {
      // Le créneau de chaque séance **encore existante** : c'est la seule source de la réécriture,
      // et une séance absente d'ici est une clé qu'on ne touchera pas.
      const seances = await db.session.findMany({ select: { id: true, date: true, heureDebut: true } });
      releve.creneaux = detecterClesSansCreneau(lignes, new Map(seances.map((s) => [s.id, { date: s.date, heureDebut: s.heureDebut }])));
    }
  }

  if (controles.has("liens")) {
    const invitations = await db.invitation.findMany({
      where: { revokedAt: null },
      select: {
        id: true,
        userId: true,
        periodId: true,
        createdAt: true,
        expiresAt: true,
        revokedAt: true,
        user: { select: { prenom: true } },
      },
    });
    releve.liens = detecterLiensConcurrents(invitations.map((i) => ({ ...i, prenom: i.user.prenom })));
  }

  return releve;
}

/** Nombre total d'anomalies : c'est lui qui décide si la base est saine. */
function total(releve: Releve): number {
  return (
    releve.fantomes.length +
    releve.ateliers.length +
    releve.notifications.reduce((n, g) => n + g.enTrop.length, 0) +
    releve.liens.reduce((n, g) => n + g.enTrop.length, 0) +
    releve.parties.length +
    releve.rangs.length +
    // Seules les clés réellement réécrites comptent : une séance disparue et une clé cible déjà
    // prise sont signalées, jamais réparées — les annoncer « à corriger » serait mentir.
    releve.creneaux.aReecrire.length +
    // Les parties en trop, et non leurs rangements : ranger les survivantes est la **conséquence**
    // de la suppression, pas une seconde incohérence à compter.
    releve.vides.aSupprimer.length
  );
}

function afficherReleve(releve: Releve, controles: ReadonlySet<Controle>, tout: boolean): void {
  if (controles.has("fantomes")) {
    titre("1. Réponses de personnes qui ne sont plus invitées sur la période");
    if (releve.fantomes.length === 0) ligne("  Aucune. Les présents ne peuvent pas dépasser les invités.");
    else {
      const seances = new Set(releve.fantomes.map((r) => r.sessionId));
      ligne(`  ${pluriel(releve.fantomes.length, "réponse")} sur ${pluriel(seances.size, "séance")} —`);
      ligne("  c'est ce qui fait « 12 présents sur 11 » et les taux au-dessus de 100 %.");
      detail(
        releve.fantomes.map((r) => `${r.date} ${r.lieu} — ${r.prenom} : ${r.statut}`),
        tout,
      );
    }
  }

  if (controles.has("ateliers")) {
    titre("2. Ateliers « au planning » d'une séance qui n'existe plus");
    if (releve.ateliers.length === 0) ligne("  Aucun.");
    else {
      const s = releve.ateliers.length > 1 ? "s" : "";
      ligne(`  ${pluriel(releve.ateliers.length, "proposition")} bloquée${s} : elle${s} n'apparaî${s ? "ssent" : "t"}`);
      ligne(`  plus nulle part et ne peu${s ? "vent" : "t"} plus être replacée${s}.`);
      detail(
        releve.ateliers.map((a) => `« ${a.titre} » (séance ${a.sessionId ?? "effacée"})`),
        tout,
      );
    }
  }

  if (controles.has("notifications")) {
    titre("3. Lignes du journal des notifications écrites deux fois");
    const enTrop = releve.notifications.reduce((n, g) => n + g.enTrop.length, 0);
    if (enTrop === 0) ligne("  Aucune.");
    else {
      ligne(`  ${pluriel(enTrop, "ligne")} en trop, sur ${pluriel(releve.notifications.length, "envoi")} —`);
      ligne("  aucun message n'est reparti pour autant : c'est le journal qui est en double.");
      detail(
        releve.notifications.map(
          (g) =>
            `${jourLocal(g.gardee.date)} ${g.gardee.type}/${g.gardee.canal} — ` +
            `${pluriel(g.enTrop.length + 1, "ligne")}, ${g.enTrop.length} à supprimer`,
        ),
        tout,
      );
    }
  }

  if (controles.has("liens")) {
    titre("4. Personnes ayant plusieurs liens personnels valables sur la même période");
    const enTrop = releve.liens.reduce((n, g) => n + g.enTrop.length, 0);
    if (enTrop === 0) ligne("  Aucune. Un seul lien vivant par personne et par période.");
    else {
      ligne(`  ${pluriel(releve.liens.length, "personne")} concernée${releve.liens.length > 1 ? "s" : ""}, ${pluriel(enTrop, "lien")} de trop.`);
      ligne("  Le lien gardé est celui qui vaut le plus longtemps ; les autres seront révoqués.");
      detail(
        releve.liens.map((g) => `${g.gardee.prenom} — ${pluriel(g.enTrop.length + 1, "lien")} vivant${g.enTrop.length ? "s" : ""}`),
        tout,
      );
    }
  }

  if (controles.has("parties")) {
    titre("5. Cases du planning réservées à un atelier qui n'y est plus");
    if (releve.parties.length === 0) ligne("  Aucune.");
    else {
      ligne(`  ${pluriel(releve.parties.length, "case")} verrouillée${releve.parties.length > 1 ? "s" : ""} que personne ne peut plus libérer.`);
      detail(
        releve.parties.map((p) => `séance ${p.sessionId}, case ${p.libelle}`),
        tout,
      );
    }
  }

  if (controles.has("rangs")) {
    titre("6. Rangs et noms des parties d'une séance");
    if (releve.rangs.length === 0) {
      /*
       * **« Aucun » serait un mensonge quand `vides` a repris les séances fautives**. Les séances
       * qu'il va rafraîchir sortent de ce relevé — c'est juste comme **plan de réparation**,
       * puisque les deux rangeraient la même chose —, mais une section de **relevé** doit dire ce
       * qui va mal, pas ce qu'un autre contrôle a pris en charge.
       */
      const reprises = new Set(releve.vides.rangs.map((r) => r.sessionId));
      if (reprises.size > 0) {
        ligne(`  Rien de plus : ${pluriel(releve.vides.rangs.length, "partie")} sur ${pluriel(reprises.size, "séance")} ${releve.vides.rangs.length > 1 ? "seront rangées" : "sera rangée"}`);
        ligne("  par le contrôle « vides » (section 8), qui les retasse après ses suppressions.");
      } else {
        ligne("  Aucun. Les rangs sont contigus et chaque nom dit le rang de sa partie.");
      }
    }
    else {
      const seances = new Set(releve.rangs.map((r) => r.sessionId));
      ligne(`  ${pluriel(releve.rangs.length, "partie")} à ranger sur ${pluriel(seances.size, "séance")} —`);
      ligne("  un rang troué laisse la base décider de l'ordre du programme, et un nom faux");
      ligne("  part tel quel dans l'API publique, les emails et les embeds.");
      detail(releve.rangs.map(decrireRang), tout);
    }
  }

  if (controles.has("creneaux")) {
    titre("7. Clés de notification d'avant l'empreinte du créneau");
    const { aReecrire, sansSeance, dejaPrises } = releve.creneaux;
    if (aReecrire.length === 0 && sansSeance.length === 0 && dejaPrises.length === 0) {
      ligne("  Aucune. Toutes les clés de récap et de rappel portent déjà le créneau.");
    }
    if (aReecrire.length > 0) {
      ligne(`  ${pluriel(aReecrire.length, "clé")} à renommer — sans quoi le prochain passage du soir`);
      ligne("  ne les reconnaîtra plus et renverra récap et rappels à tout le club.");
      detail(
        aReecrire.map((r) => `${r.ancienne}  →  ${r.nouvelle}`),
        tout,
      );
    }
    if (sansSeance.length > 0) {
      ligne(`  ${pluriel(sansSeance.length, "clé")} dont la séance n'existe plus : créneau irrécupérable,`);
      ligne("  laissée telle quelle (cette séance ne repartira dans aucun récap).");
      detail(
        sansSeance.map((l) => `${l.dedupKey} (séance ${l.sessionId})`),
        tout,
      );
    }
    if (dejaPrises.length > 0) {
      ligne(`  ${pluriel(dejaPrises.length, "clé")} dont la forme neuve existe déjà : rien à renommer,`);
      ligne("  l'envoi est déjà retenu par la clé au nouveau format.");
      detail(
        dejaPrises.map((r) => r.ancienne),
        tout,
      );
    }
  }

  if (controles.has("vides")) {
    titre("8. Parties vides en trop (au-delà des deux cours du modèle)");
    const { aSupprimer, rangs } = releve.vides;
    if (aSupprimer.length === 0) ligne("  Aucune. Chaque séance ne porte que son modèle et ce qu'on y a ajouté.");
    else {
      const seances = new Set(aSupprimer.map((p) => p.sessionId));
      ligne(`  ${pluriel(aSupprimer.length, "partie")} vide${aSupprimer.length > 1 ? "s" : ""} à retirer sur ${pluriel(seances.size, "séance")} —`);
      ligne("  une case vide ne dit rien d'autre que « il manque quelque chose », et elle se répète");
      ligne("  dans le planning, dans la fiche de la séance et dans l'objet des emails du soir.");
      ligne("  Les deux premiers cours de chaque séance sont protégés, même vides, ainsi que toute");
      ligne("  partie qui porte quoi que ce soit — un instructeur, un thème, une description, un");
      ligne("  niveau, un atelier retenu, ou simplement la trace de quelqu'un qui l'a modifiée.");
      if (rangs.length > 0) ligne(`  ${pluriel(rangs.length, "partie")} ${rangs.length > 1 ? "seront rangées" : "sera rangée"} derrière elles.`);
      /*
       * **La liste n'est jamais abrégée, et c'est la règle 3 du fichier qui l'exige** — « rien
       * n'est supprimé en silence ». Elle l'était : sur la forme réelle de la production (seize
       * séances, deux options vides chacune), le rapport nommait quinze lignes et en supprimait
       * trente-deux. C'est le seul contrôle qui **détruit du contenu de planning**, et ce rapport
       * est la seule trace par case qu'un opérateur aura sous les yeux.
       */
      detail(aSupprimer.map(decrirePartieEnTrop), true);
      const videes = releve.vides.seancesVidees.length;
      if (videes > 0) {
        const plusieurs = videes > 1;
        ligne();
        ligne(`  ${pluriel(videes, "séance")} n'${plusieurs ? "avaient" : "avait"} que des options vides, donc aucun cours à protéger :`);
        ligne(`  ${plusieurs ? "elles se retrouveront" : "elle se retrouvera"} sans aucune partie. L'écran le supporte — « Programme à venir. »`);
        ligne("  en lecture, et les boutons d'ajout à l'encadrement —, mais ça ne s'obtient pas sans le savoir.");
        detail(releve.vides.seancesVidees, true);
      }
    }
  }
}

/**
 * Relevé informatif : des lignes dont la clé étrangère pointe vers un parent disparu. Jamais réparé
 * — il n'existe pas de réparation générique, et une base qui en présente demande un examen, pas un
 * script. Le contrôle est bavard seulement s'il trouve quelque chose.
 */
async function verifierClesEtrangeres(db: Base): Promise<void> {
  let lignes: Array<Record<string, unknown>>;
  try {
    lignes = await db.$queryRawUnsafe<Array<Record<string, unknown>>>("PRAGMA foreign_key_check");
  } catch {
    ligne("  (contrôle indisponible sur cette base)");
    return;
  }
  if (lignes.length === 0) {
    ligne("  Aucune ligne orpheline : toutes les clés étrangères pointent vers un parent existant.");
    return;
  }
  ligne(`  ⚠ ${pluriel(lignes.length, "ligne")} orpheline${lignes.length > 1 ? "s" : ""} — ce script ne les répare pas.`);
  const parTable = new Map<string, number>();
  for (const l of lignes) {
    const cle = `${String(l.table ?? "?")} → ${String(l.parent ?? "?")}`;
    parTable.set(cle, (parTable.get(cle) ?? 0) + 1);
  }
  for (const [cle, n] of parTable) ligne(`    • ${cle} : ${pluriel(n, "ligne")}`);
  ligne("  Garde la sauvegarde et demande de l'aide avant de toucher à quoi que ce soit.");
}

/**
 * La sauvegarde **avant** d'écrire, et c'est non négociable : on travaille sur les vraies données du
 * club. On réutilise le module du projet (`src/lib/sauvegarde.ts`, `VACUUM INTO`, rétention 30
 * jours), puis on en fait une copie horodatée à part : la sauvegarde du jour est écrasée à chaque
 * passage, alors que l'état d'avant réparation doit survivre à un second lancement le même jour.
 */
async function sauvegarderAvantReparation(): Promise<string> {
  const { copyFile } = await import("node:fs/promises");
  const { sauvegarderBase, dossierSauvegardes, RETENTION_REPARATION_JOURS } = await import("../src/lib/sauvegarde");
  const maintenant = new Date();
  const { fichier, octets } = await sauvegarderBase(maintenant);
  const horodatage = `${jourLocal(maintenant)}-${String(maintenant.getHours()).padStart(2, "0")}${String(maintenant.getMinutes()).padStart(2, "0")}${String(maintenant.getSeconds()).padStart(2, "0")}`;
  const copie = path.join(dossierSauvegardes(), `avant-reparation-${horodatage}.db`);
  await copyFile(fichier, copie);
  ligne(`  Sauvegarde écrite : ${fichier} (${Math.round(octets / 1024)} Kio)`);
  ligne(`  Copie conservée   : ${copie}`);
  // Elle était « jamais purgée » : une base complète immortelle dans le dossier des sauvegardes, pendant
  // que l'écran *À propos* promettait « conservée 30 jours ». Voir `RETENTION_REPARATION_JOURS`.
  ligne(`  (cette copie est purgée au bout de ${RETENTION_REPARATION_JOURS} jours — efface-la avant si tu es déjà sûr du résultat)`);
  return copie;
}

/** Applique les réparations, en une seule transaction. Renvoie ce qui a été fait, ligne par ligne. */
/**
 * **Ce que la transaction a réellement supprimé**, pour que le journal d'audit ne nomme pas comme
 * détruites des cases encore vivantes. Rempli par le contrôle `vides`, lu par `journaliser`.
 */
let retireesReellement: string[] = [];

async function reparer(db: Base, releve: Releve, controles: ReadonlySet<Controle>): Promise<string[]> {
  const faits: string[] = [];
  const maintenant = new Date();
  await db.$transaction(async (tx) => {
    if (controles.has("fantomes") && releve.fantomes.length > 0) {
      for (const r of releve.fantomes) {
        await tx.attendance.delete({ where: { userId_sessionId: { userId: r.userId, sessionId: r.sessionId } } });
      }
      faits.push(`${pluriel(releve.fantomes.length, "réponse")} fantôme${releve.fantomes.length > 1 ? "s" : ""} supprimée${releve.fantomes.length > 1 ? "s" : ""}`);
    }

    if (controles.has("ateliers") && releve.ateliers.length > 0) {
      // Même geste que `supprimerPeriode` : la proposition revient « en attente », détachée.
      await tx.atelier.updateMany({
        where: { id: { in: releve.ateliers.map((a) => a.id) } },
        data: { statut: "PROPOSE", sessionId: null },
      });
      faits.push(`${pluriel(releve.ateliers.length, "atelier")} remis « en attente »`);
    }

    if (controles.has("notifications")) {
      const ids = releve.notifications.flatMap((g) => g.enTrop.map((l) => l.id));
      if (ids.length > 0) {
        await tx.notificationLog.deleteMany({ where: { id: { in: ids } } });
        faits.push(`${pluriel(ids.length, "ligne")} de journal en double supprimée${ids.length > 1 ? "s" : ""}`);
      }
    }

    if (controles.has("liens")) {
      const ids = releve.liens.flatMap((g) => g.enTrop.map((i) => i.id));
      if (ids.length > 0) {
        await tx.invitation.updateMany({
          where: { id: { in: ids } },
          data: { revokedAt: maintenant, motifRevocation: "REMPLACE" },
        });
        faits.push(`${pluriel(ids.length, "lien")} supplanté${ids.length > 1 ? "s" : ""} révoqué${ids.length > 1 ? "s" : ""}`);
      }
    }

    if (controles.has("parties") && releve.parties.length > 0) {
      await tx.sessionPartie.updateMany({
        where: { id: { in: releve.parties.map((p) => p.id) } },
        data: { atelierId: null },
      });
      faits.push(`${pluriel(releve.parties.length, "case")} de planning détachée${releve.parties.length > 1 ? "s" : ""}`);
    }

    if (controles.has("rangs") && releve.rangs.length > 0) {
      /*
       * Une par une, et **avec l'`updatedAt` que la ligne portait déjà** (`rangementsParties` le
       * rend tel quel) : réparer un rang n'est pas une modification du programme par quelqu'un, et
       * la grille lit ce champ dans la bulle « Modifié par … le … » de chaque case. C'est la règle
       * des migrations qui ont réparé des rangs avant lui, et celle de `rangerParties`.
       */
      for (const r of releve.rangs) {
        await tx.sessionPartie.update({ where: { id: r.id }, data: r.data });
      }
      const n = releve.rangs.length;
      faits.push(`${pluriel(n, "partie")} rangée${n > 1 ? "s" : ""} (rang contigu, nom d'accord avec lui)`);
    }

    if (controles.has("vides") && releve.vides.aSupprimer.length > 0) {
      /*
       * **Tout se rejoue DANS la transaction : la relecture, le prédicat, puis le rangement.**
       * Trois défauts en un seul endroit, et les deux premiers étaient mes correctifs du matin :
       *
       * 1. **le plan de rangement partait même quand la suppression n'avait pas eu lieu.** La
       *    revérification du `deleteMany` protégeait bien une case qu'un encadrant venait de remplir —
       *    mais la boucle de rangement, calculée sur un plan qui l'excluait, s'appliquait quand même :
       *    la séance se retrouvait avec **deux « Option 1 » au rang 2**, et l'opérateur lisait
       *    « Terminé ». C'est très exactement l'état que le contrôle `rangs` existe pour empêcher, et
       *    il sort tel quel dans l'API publique, les emails du soir et les embeds ;
       * 2. **le prédicat du `where` n'était pas celui de la détection.** `reglagesVides` fait un
       *    `trim()` et passe le niveau par `niveauAffiche` ; le `where` exigeait l'égalité stricte
       *    (`theme: ""`, `niveau: INDIFFERENT`). Une case portant `theme = "   "` ou un niveau écrit
       *    par une autre version était donc « vide » pour le relevé et **invisible** pour la
       *    suppression : le script ne convergeait jamais, et la section 6 affirmait « les rangs sont
       *    contigus » pendant que quatre lignes portaient un rang dupliqué ;
       * 3. et le journal d'audit comptait le **plan**, pas les suppressions réelles — il nommait comme
       *    détruites des cases encore vivantes.
       *
       * La parade est la même pour les trois, et elle est plus simple que ce qu'elle remplace : **on
       * relit les candidates dans la transaction**, on leur applique la **seule** définition du vide
       * (`reglagesVides`, importée), on supprime ce qui reste vide, puis on range les **survivantes
       * réelles** des séances touchées. Plus de fenêtre entre la lecture et l'écriture, plus de second
       * prédicat qui puisse diverger, et plus de plan périmé. Le rangement rend à chaque ligne son
       * `updatedAt` (`rangementsParties` le laisse tel quel) : retirer la case vide d'à côté n'est pas
       * une modification du programme par quelqu'un.
       */
      const candidates = await tx.sessionPartie.findMany({
        where: { id: { in: releve.vides.aSupprimer.map((p) => p.id) } },
        select: {
          id: true,
          sessionId: true,
          atelierId: true,
          modifieParId: true,
          instructeurId: true,
          instructeurSecondId: true,
          theme: true,
          description: true,
          niveau: true,
        },
      });
      const aRetirer = candidates.filter(
        (p) =>
          p.atelierId === null &&
          p.modifieParId === null &&
          reglagesVides({
            instructeur: p.instructeurId,
            instructeurSecond: p.instructeurSecondId,
            theme: p.theme,
            description: p.description,
            niveau: p.niveau,
          }),
      );
      if (aRetirer.length > 0) await tx.sessionPartie.deleteMany({ where: { id: { in: aRetirer.map((p) => p.id) } } });
      // Le rangement des survivantes, séance par séance — sur ce que la base contient **maintenant**.
      const seancesTouchees = [...new Set(aRetirer.map((p) => p.sessionId))];
      let ranges = 0;
      if (seancesTouchees.length > 0) {
        const survivantes = await tx.sessionPartie.findMany({
          where: { sessionId: { in: seancesTouchees } },
          select: { id: true, sessionId: true, libelle: true, ordre: true, estOption: true, updatedAt: true },
        });
        for (const sessionId of seancesTouchees) {
          for (const r of rangementsParties(survivantes.filter((p) => p.sessionId === sessionId))) {
            await tx.sessionPartie.update({ where: { id: r.id }, data: r.data });
            ranges += 1;
          }
        }
      }
      retireesReellement = aRetirer.map((p) => p.id);
      const gardees = releve.vides.aSupprimer.length - aRetirer.length;
      faits.push(`${pluriel(aRetirer.length, "partie")} vide${aRetirer.length > 1 ? "s" : ""} retirée${aRetirer.length > 1 ? "s" : ""} du planning`);
      if (gardees > 0) {
        // Quelqu'un a rempli une de ces cases pendant que le script tournait : elle reste, et on le dit.
        faits.push(
          `${pluriel(gardees, "partie")} gardée${gardees > 1 ? "s" : ""} : ${gardees > 1 ? "elles n'étaient plus vides" : "elle n'était plus vide"} à l'instant de l'écriture`,
        );
      }
      if (ranges > 0) faits.push(`${pluriel(ranges, "partie")} rangée${ranges > 1 ? "s" : ""} derrière elles`);
    }

    if (controles.has("creneaux") && releve.creneaux.aReecrire.length > 0) {
      // **On renomme, on ne supprime jamais** : la ligne reste, c'est sa clé qui rejoint la forme
      // que l'application calcule désormais. Une par une, `dedupKey` étant `@unique` — et les
      // cibles ont été vérifiées libres au relevé, sur le même instantané que cette transaction.
      for (const r of releve.creneaux.aReecrire) {
        await tx.notificationLog.update({ where: { id: r.id }, data: { dedupKey: r.nouvelle } });
      }
      const n = releve.creneaux.aReecrire.length;
      faits.push(`${pluriel(n, "clé")} de notification renommée${n > 1 ? "s" : ""} au format « créneau »`);
    }
  });
  return faits;
}

/**
 * Trace de la réparation dans le journal d'audit : hors transaction, volontairement. Une base saine
 * n'écrit rien du tout (règle de rejouabilité), et l'échec d'une écriture d'audit ne doit pas
 * défaire une réparation réussie.
 */
async function journaliser(db: Base, releve: Releve, faits: readonly string[]): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        acteurEmail: "cli",
        action: "donnees.reparees",
        details: JSON.stringify({
          via: "scripts/reparer-donnees.ts",
          reponsesFantomes: releve.fantomes.length,
          ateliersOrphelins: releve.ateliers.length,
          notificationsEnDouble: releve.notifications.reduce((n, g) => n + g.enTrop.length, 0),
          liensConcurrents: releve.liens.reduce((n, g) => n + g.enTrop.length, 0),
          partiesDetachees: releve.parties.length,
          partiesRangees: releve.rangs.length,
          clesRenommees: releve.creneaux.aReecrire.length,
          clesSansSeance: releve.creneaux.sansSeance.length,
          partiesVidesRetirees: retireesReellement.length,
          /** Ce que le relevé prévoyait : l'écart avec la ligne du dessus est ce que la course a sauvé. */
          partiesVidesPrevues: releve.vides.aSupprimer.length,
          /*
           * **Chaque ligne supprimée, nommée dans le journal** : le geste équivalent dans
           * l'application (`retirerPartie`) journalise les cinq champs de la case, avec ce
           * commentaire — « le geste est irréversible, et le journal est la seule chose qui reste
           * après lui ». L'agrégat ne disait que « 18 » : les identifiants n'existaient que sur la
           * sortie standard d'un `docker exec`, qui ne se garde pas. Plafonné, parce qu'une entrée
           * d'audit n'est pas un fichier de journal.
           */
          partiesVides: releve.vides.aSupprimer
            .filter((p) => retireesReellement.includes(p.id))
            .slice(0, 200)
            .map((p) => `${dateFr(p.date)} ${p.libelle}`),
          partiesVidesNonDetaillees: Math.max(0, retireesReellement.length - 200),
          faits,
        }),
      },
    });
  } catch (e) {
    ligne(`  (journal d'audit non écrit : ${e instanceof Error ? e.message : String(e)})`);
  }
}

export async function main(argv: readonly string[]): Promise<number> {
  let options: Options;
  try {
    options = lireArguments(argv);
  } catch (e) {
    console.error(e instanceof ArgumentInvalide ? e.message : e);
    return 1;
  }
  if (options.aide) {
    ligne(AIDE);
    return 0;
  }

  // L'import est différé : ce module doit pouvoir être chargé (et éprouvé) sans ouvrir de base.
  const { db } = await import("../src/lib/db");
  try {
    ligne("Réparation des données — HEMA Organizer");
    ligne(options.reparer ? "Mode : RÉPARATION (la base va être modifiée)" : "Mode : vérification seule (aucune écriture)");
    /*
     * **Le rapport nomme la base sur laquelle il va écrire**. Il ne la nommait pas, et le client
     * Prisma lit `.env` **de lui-même** : un `tsx scripts/reparer-donnees.ts --reparer` lancé sans
     * `DATABASE_URL` s'exécute donc sur la base de développement sans le dire — le relecteur l'a
     * vécu sur lui-même. Dans l'image, le Dockerfile impose `file:/data/hema.db` et il n'y a pas de
     * `.env` ; sur un poste, c'est la seule ligne qui distingue « ma copie d'essai » de « la base
     * du club ».
     *
     * L'import de `db` juste au-dessus a déjà fait charger `.env` : la variable est donc résolue.
     */
    ligne(`Base : ${process.env.DATABASE_URL ?? "(non déclarée)"}`);
    if (options.controles.size < CONTROLES.length) ligne(`Contrôles retenus : ${[...options.controles].join(", ")}`);

    const releve = await relever(db, options.controles);
    afficherReleve(releve, options.controles, options.tout);

    titre("9. Lignes pointant vers un parent disparu (relevé, jamais réparé)");
    await verifierClesEtrangeres(db);

    const anomalies = total(releve);
    titre("Bilan");
    // Relevé mais jamais réparable : à dire ici, sinon le bilan « rien à réparer » sonne faux
    // juste après une section 7 qui vient d'énumérer des clés.
    const laissees = releve.creneaux.sansSeance.length + releve.creneaux.dejaPrises.length;
    if (anomalies === 0) {
      ligne("  Rien à réparer : la base est saine sur tous les contrôles examinés.");
      if (laissees > 0) ligne(`  (${pluriel(laissees, "clé")} de notification signalée${laissees > 1 ? "s" : ""} plus haut, qu'on ne répare pas : voir la section 7.)`);
      if (options.reparer) ligne("  Aucune sauvegarde n'a été faite, aucune ligne n'a été touchée.");
      return 0;
    }

    ligne(`  ${pluriel(anomalies, "ligne")} à corriger.`);
    if (!options.reparer) {
      ligne();
      ligne("  Rien n'a été modifié. Pour réparer :");
      ligne("      npm run db:reparer -- --reparer");
      ligne("  (la base sera sauvegardée avant la moindre écriture)");
      return 0;
    }

    titre("Sauvegarde");
    await sauvegarderAvantReparation();

    titre("Réparation");
    const faits = await reparer(db, releve, options.controles);
    for (const f of faits) ligne(`  ✔ ${f}`);
    await journaliser(db, releve, faits);
    ligne();
    ligne("  Terminé. Relance sans --reparer pour vérifier qu'il ne reste rien.");
    return 0;
  } finally {
    await db.$disconnect();
  }
}

/*
 * Lancé en ligne de commande seulement : importé par les tests, ce module ne fait rien — il
 * n'ouvre donc aucune base. La reconnaissance se fait sur le nom du fichier d'entrée et non sur
 * `import.meta.url` : `tsx` compile ces scripts en CommonJS (le projet n'est pas un module ES),
 * où ni `import.meta` ni le `await` de haut niveau n'existent.
 */
const entree = process.argv[1] ?? "";
// `reparer.cjs` est le nom que porte l'outil **dans l'image Docker**, où il est compilé en un seul
// fichier CommonJS par esbuild (comme `seed.cjs`) : sans lui dans ce motif, la commande lancée sur
// le serveur du club ne faisait rien du tout, en silence — et c'est précisément là que les données
// à réparer se trouvent.
const lanceEnCli = /(^|[\\/])(reparer-donnees|reparer)\.(ts|js|cjs|mts|mjs)$/.test(entree);
if (lanceEnCli) {
  void main(process.argv.slice(2))
    .catch((e) => {
      console.error(e);
      return 1;
    })
    .then((code) => {
      process.exitCode = code;
    });
}
