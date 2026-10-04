"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import { identite } from "@/lib/identite";
import { userAgent } from "@/lib/request-info";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { nommerAppareil, notifierPersonne } from "@/lib/notifications/push";
import type { FormState } from "@/lib/form";

/**
 * **Abonner et désabonner un appareil** aux notifications.
 *
 * L'abonnement est créé par le navigateur, qui en donne l'adresse et les clés ; le serveur ne fait
 * que les ranger au nom de la personne connectée. Deux garde-fous :
 *
 * - l'`endpoint` est **unique en base** : réabonner le même appareil met la ligne à jour au lieu
 *   d'en empiler une seconde (un navigateur redonne la même adresse tant qu'il ne l'a pas révoquée) ;
 * - un abonnement est **toujours rattaché à la personne connectée** — jamais à un identifiant
 *   reçu du client ;
 * - mais une ligne déjà **au nom de quelqu'un d'autre n'est jamais reprise**. L'`endpoint` vient du
 *   navigateur et n'a rien d'un secret : tant qu'on réassignait `userId` à l'appelant, connaître
 *   celui d'un autre suffisait à lui couper ses notifications sans qu'il en sache rien, d'un simple
 *   appel. On refuse donc, plutôt que de supprimer la ligne d'abord — l'effacer aboutirait au même
 *   résultat pour la victime (elle ne reçoit plus rien), avec en prime la trace effacée. Le cas
 *   légitime, un téléphone prêté puis rendu, se règle en retirant l'appareil depuis le profil de
 *   l'autre compte, ou en coupant les notifications côté navigateur (qui redonne alors une adresse
 *   neuve au prochain abonnement).
 */

const abonnementSchema = z.object({
  endpoint: z.string().url().max(1000),
  p256dh: z.string().min(1).max(500),
  auth: z.string().min(1).max(500),
});

export async function enregistrerAbonnementPush(abonnement: unknown): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) return { erreur: "Ta session a expiré. Reconnecte-toi." };
  const lu = abonnementSchema.safeParse(abonnement);
  if (!lu.success) return { erreur: "Cet appareil n'a pas pu être enregistré." };
  // Un navigateur qui boucle sur l'abonnement ne doit pas remplir la table : même ordre de
  // grandeur que les autres gardes personnelles.
  if (!(await checkRateLimit("activation_user", user.id))) return { erreur: "Trop de tentatives. Réessaie dans un quart d'heure." };
  const appareil = nommerAppareil(await userAgent());
  const { endpoint, p256dh, auth } = lu.data;
  const existant = await db.pushAbonnement.findUnique({ where: { endpoint }, select: { userId: true } });
  if (existant && existant.userId !== user.id) {
    return { erreur: "Cet appareil est déjà enregistré pour un autre compte. Retire-le depuis ce compte, puis réessaie." };
  }
  await db.pushAbonnement.upsert({
    where: { endpoint },
    create: { userId: user.id, endpoint, p256dh, auth, appareil },
    // Pas de `userId` ici : la ligne appartient déjà à la personne connectée (vérifié juste au-dessus),
    // et ne pas le réécrire garde l'action incapable de changer un abonnement de propriétaire.
    update: { p256dh, auth, appareil },
  });
  revalidatePath("/profil");
  return { succes: "Cet appareil recevra désormais les notifications." };
}

export async function retirerAbonnementPush(endpoint: string): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) return { erreur: "Ta session a expiré. Reconnecte-toi." };
  // `userId` dans la condition : on ne retire que ses propres appareils, jamais ceux d'un autre.
  await db.pushAbonnement.deleteMany({ where: { endpoint, userId: user.id } });
  revalidatePath("/profil");
  return { succes: "Cet appareil ne recevra plus de notifications." };
}

/** Retire un appareil depuis la liste du profil (bouton « Retirer »), par son identifiant. */
export async function retirerAppareilPush(id: string): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) return { erreur: "Ta session a expiré. Reconnecte-toi." };
  await db.pushAbonnement.deleteMany({ where: { id, userId: user.id } });
  revalidatePath("/profil");
  return { succes: "Appareil retiré." };
}

/**
 * Envoie une notification d'essai à **tous les appareils** de la personne : c'est la seule façon de
 * vérifier que la chaîne complète fonctionne (autorisation du navigateur, service de push, réveil
 * de l'appareil), et elle ne coûte rien à personne d'autre.
 */
export async function testerPush(): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) return { erreur: "Ta session a expiré. Reconnecte-toi." };
  if (!(await checkRateLimit("activation_user", user.id))) return { erreur: "Trop d'essais. Réessaie dans un quart d'heure." };
  // Le titre vient de l'identité du club, jamais d'une constante : c'est le nom que la personne
  // verra sur son écran verrouillé, et c'est le même que celui de l'onglet et du manifeste.
  const club = await identite();
  const atteints = await notifierPersonne(user.id, {
    titre: club.nomCourt,
    corps: "Voilà à quoi ressemblera une notification du club.",
    url: "/seances",
    tag: "essai",
  });
  if (atteints === 0) return { erreur: "Aucun appareil n'a reçu la notification. Vérifie que tu l'as bien activée sur celui-ci." };
  return { succes: `Notification envoyée à ${atteints} appareil${atteints > 1 ? "s" : ""}.` };
}

/*
 * Il y avait ici un `testerAbonnement(id)` « réservé aux essais depuis l'administration » : il
 * n'était appelé de nulle part, et il ne vérifiait ni session, ni droit, ni débit. Or dans un
 * fichier `"use server"`, une fonction exportée est une **route publique** : n'importe qui, même
 * non connecté, pouvait faire sonner le téléphone de quelqu'un d'autre en lui passant un
 * identifiant d'abonnement — et son `true`/`false` disait au passage si l'identifiant existait.
 * Supprimée plutôt que gardée : du code mort n'a pas à rester une porte ouverte. L'essai qui
 * sert vraiment est `testerPush()` ci-dessus, qui notifie **ses propres** appareils, session
 * vérifiée et débit limité.
 */
