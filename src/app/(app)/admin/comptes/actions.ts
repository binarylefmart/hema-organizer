"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { assertPermission, exigerReauth } from "@/lib/auth/current-user";
import { canEditUser, estCompteDeService } from "@/lib/permissions";
import { identifiantSchema, SELECTION_MAX } from "@/lib/validation/presences";

/**
 * **Nommer plusieurs administrateurs d'un coup**, depuis « Comptes admin ».
 *
 * Le bureau se renouvelle en bloc : trois personnes à nommer après une assemblée, c'étaient trois
 * passages dans la même liste déroulante, chacun avec son propre code à six chiffres à recopier.
 *
 * **Pourquoi ici et non dans `src/actions/membres.ts`** : cette action ne sert qu'à cet écran, et le
 * dépôt a déjà ce patron pour ses gestes de masse (`src/app/(app)/admin/membres/actions.ts`,
 * `src/app/(public)/desinscription/actions.ts`). Elle reste malgré tout une **route appelable de
 * l'extérieur**, comme toute fonction exportée d'un fichier `"use server"` : ses gardes sont écrites
 * ici en entier, jamais déléguées à ce que l'écran affiche.
 *
 * **Ses gardes sont exactement celles du geste unitaire** (`nommerAdministrateur`,
 * `src/actions/membres.ts`), reprises une par une et dans le même ordre :
 * - permission **`admins.manage`**, en première ligne, avant de regarder ce que l'appel demande ;
 * - un compte **déjà administrateur** est refusé — lu sur `estAdmin`, le rôle ne valant plus jamais
 *   « ADMIN » — et c'est aussi ce qui empêche quiconque de **se** nommer : il faut déjà être
 *   administrateur pour tenir `admins.manage`, donc l'acteur tombe sur ce refus-là. La règle n'est
 *   pas réécrite ici, elle est héritée du même test ;
 * - un compte **désactivé** est refusé (« réactive-le d'abord ») : le rôle sans l'accès ne sert à rien ;
 * - **`canEditUser`** sur chaque personne ;
 * - **`exigerReauth`** avec `/admin/comptes` pour suite, **après tous les refus et avant
 *   l'écriture** — l'ordre du geste unitaire, celui que la relecture a imposé partout : on ne renvoie
 *   personne chercher six chiffres pour un geste voué à être refusé.
 *
 * **Un verrou de plus, et il n'ouvre rien** : le **compte de connexion du portail** est nommé
 * explicitement. À l'unité il était couvert par ricochet (il est déjà administrateur, donc refusé
 * plus haut) ; l'écrire en clair ne retire aucune fonctionnalité — un compte de service non
 * administrateur n'existe pas — et met le mot « portail » dans le refus plutôt que dans un
 * raisonnement à reconstituer.
 *
 * **Tout ou rien, et le message nomme qui bloque.** Une ligne refusée refuse le lot entier : nommer
 * deux administrateurs sur trois « en silence » laisserait un bureau à moitié constitué, et c'est la
 * doctrine des gestes sensibles du dépôt (`appliquerGesteEnMasse`, `modifierPresencesEnMasse`).
 *
 * **Aucune notification**, pas plus qu'à l'unité : le geste unitaire n'écrit à personne (la personne
 * nommée découvre l'espace admin à sa prochaine connexion, après mot de passe et 2FA).
 */

/** Le plafond et la forme d'un identifiant sont ceux des autres gestes de masse — une seule valeur à corriger. */
const schema = z.object({
  userIds: z.array(identifiantSchema).min(1).max(SELECTION_MAX),
});

export type ResultatNomination = { succes?: string; erreur?: string };

/** Le compte de connexion du portail n'est pas une personne du club : il est déjà administrateur, à demeure. */
const ERREUR_PORTAIL = "compte de connexion du portail : il est administrateur à demeure";

export async function nommerAdministrateurs(entree: unknown): Promise<ResultatNomination> {
  const acteur = await assertPermission("admins.manage");
  const lu = schema.safeParse(entree);
  // Message unique et sans détail : une sélection invalide vient d'un appel forgé, pas de l'écran.
  if (!lu.success) return { erreur: "Sélection invalide : coche au moins une personne à nommer." };
  const identifiants = [...new Set(lu.data.userIds)];

  /*
   * **L'ordre rendu est celui de la carte** (« Prénom Nom »), jamais celui des clics : c'est l'ordre
   * que le journal gardera, et le seul qu'on puisse retrouver à l'écran. On ne se fie pas à l'ordre
   * des identifiants reçus — il vient du réseau. Mêmes champs lus qu'à l'unité.
   */
  const cibles = await db.user.findMany({
    where: { id: { in: identifiants } },
    orderBy: [{ prenom: "asc" }, { nom: "asc" }],
    // `estAdmin` compris : c'est le champ qui dit « déjà administrateur » (le rôle ne vaut plus jamais
    // « ADMIN ») et celui que `canEditUser` lit — un objet sans lui passe pour un compte ordinaire.
    select: { id: true, prenom: true, nom: true, email: true, role: true, estAdmin: true, actif: true, service: true },
  });

  /*
   * **Chaque refus est nommé.** « Le lot est refusé » sans dire par qui obligerait à décocher au
   * hasard. Les phrases sont celles du geste unitaire, mises au nom de la personne.
   */
  const refuses: string[] = [];
  for (const cible of cibles) {
    const nom = `${cible.prenom} ${cible.nom}`;
    if (cible.estAdmin) refuses.push(`${nom} est déjà administrateur`);
    else if (estCompteDeService(cible)) refuses.push(`${nom} (${ERREUR_PORTAIL})`);
    else if (!cible.actif) refuses.push(`${nom} (ce compte est désactivé : réactive-le d'abord)`);
    else if (!canEditUser(acteur, cible)) refuses.push(`${nom} (tu ne peux pas modifier ce compte)`);
  }
  /*
   * **Un identifiant sans compte en base refuse le lot lui aussi.** Pour le geste le plus sensible de
   * l'application, un écran en retard sur la base n'est pas une base de décision : quelqu'un a quitté
   * l'annuaire pendant que la carte était ouverte, et on ne devine pas lequel des noms cochés c'était.
   */
  const introuvables = identifiants.length - cibles.length;
  if (refuses.length > 0 || introuvables > 0) {
    const phrases = ["Rien n'a été écrit : le lot entier est refusé."];
    if (refuses.length > 0) phrases.push(`${refuses.join(" ; ")}.`);
    if (introuvables > 0) {
      phrases.push(
        introuvables === 1
          ? "1 personne de la sélection est introuvable : elle a quitté l'annuaire depuis l'affichage de la liste. Recharge l'écran."
          : `${introuvables} personnes de la sélection sont introuvables : elles ont quitté l'annuaire depuis l'affichage de la liste. Recharge l'écran.`,
      );
    }
    return { erreur: phrases.join(" ") };
  }

  // Aucune ligne écartée possible à ce stade : tout ce qui reste n'est pas du bureau, donc tout ce qui
  // reste reçoit vraiment `estAdmin`. Le code récent est redemandé **avant** l'écriture, et la suite
  // ramène à l'écran du clic — comme à l'unité.
  await exigerReauth(acteur, "/admin/comptes");

  /*
   * **Une seule écriture groupée** : trois mises à jour dont la deuxième échoue laisseraient un bureau
   * à moitié nommé, et rien à l'écran ne dirait lesquelles sont passées.
   */
  // **Le bureau s'AJOUTE au rôle de base**, comme à l'unité : chacun garde le sien, et un
  // instructeur nommé au bureau continue d'enseigner. `role: "ADMIN"` le lui retirait en silence —
  // et, depuis la migration, ne lui donnait plus **aucun** droit par la matrice.
  await db.$transaction(cibles.map((cible) => db.user.update({ where: { id: cible.id }, data: { estAdmin: true } })));

  /*
   * **Une entrée d'audit par personne, portant la même action que le geste unitaire**
   * (`admin.droits_donnes`) : c'est un seul filtre du journal qui doit retrouver « qui a reçu les
   * clés, et quand », nom par nom. Écrites après le commit et hors transaction — `audit()` ne doit
   * jamais faire échouer le geste qu'il raconte.
   *
   * `enMasse` n'est posé qu'à partir de deux personnes : nommer quelqu'un seul laisse dans le journal
   * exactement l'entrée qu'il y laissait avant cet écran, au détail près.
   */
  const enMasse = cibles.length > 1;
  for (const cible of cibles) {
    // `roleDeBase` et non `ancienRole` : le rôle n'est pas remplacé, la personne le garde.
    await audit(acteur, "admin.droits_donnes", cible.id, { email: cible.email, roleDeBase: cible.role, ...(enMasse ? { enMasse: true } : {}) });
  }

  // Les trois chemins que `rafraichir()` revalide à l'unité : le rôle se lit aussi dans l'annuaire et
  // dans les listes d'une période.
  revalidatePath("/admin/membres");
  revalidatePath("/admin/periodes");
  revalidatePath("/admin/comptes");

  // **La phrase d'une seule personne est mot pour mot celle d'avant** : c'est le cas le plus fréquent,
  // il ne doit pas changer d'allure parce que la carte sait maintenant en faire trois.
  const noms = cibles.map((c) => `${c.prenom} ${c.nom}`);
  const rappel = "Mot de passe et double authentification";
  return {
    succes:
      noms.length === 1
        ? `${noms[0]} est administrateur. ${rappel} lui seront demandés avant que l'administration s'ouvre.`
        : `${noms.length} comptes sont administrateurs : ${noms.join(", ")}. ${rappel} leur seront demandés avant que l'administration s'ouvre.`,
  };
}
