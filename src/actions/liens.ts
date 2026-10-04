"use server";

import { z } from "zod";
import { AccesRefuse, assertPermission } from "@/lib/auth/current-user";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { autoriserImageApercu, ErreurApercu, recupererApercu, recupererImage, URL_MAX_LONGUEUR, type ApercuLien } from "@/lib/lien-apercu";

/**
 * Aperçu d'un lien collé (publication Facebook, Instagram, site du club, billetterie…) pour
 * pré-remplir la fiche d'un événement. Toute la sécurité (SSRF, plafonds, redirections) est dans
 * src/lib/lien-apercu.ts : cette action ne fait que contrôler le droit, le débit, et traduire.
 */

export type ResultatApercuLien = { ok: true; apercu: ApercuLien } | { ok: false; erreur: string };

const schema = z.string().trim().min(1, "Colle d'abord un lien.").max(URL_MAX_LONGUEUR, "Ce lien est trop long.");

/**
 * Récupère titre, description, image et nom du site d'un lien public.
 * Ne lève jamais : renvoie toujours `{ ok: true, apercu }` ou `{ ok: false, erreur }` (en français).
 */
export async function apercuDeLien(url: string): Promise<ResultatApercuLien> {
  let utilisateurId: string;
  try {
    // Seuls les instructeurs et les administrateurs déclenchent une requête sortante.
    utilisateurId = (await assertPermission("evenements.edit")).id;
  } catch (e) {
    if (e instanceof AccesRefuse) return { ok: false, erreur: "Seuls les instructeurs et les administrateurs peuvent récupérer l'aperçu d'un lien." };
    return { ok: false, erreur: "Impossible de vérifier tes droits : reconnecte-toi." };
  }

  const saisie = schema.safeParse(url);
  if (!saisie.success) return { ok: false, erreur: saisie.error.issues[0]?.message ?? "Ce lien n'est pas valide." };

  // Une requête sortante par aperçu : on borne ce qu'une seule personne peut déclencher.
  if (!(await checkRateLimit("apercu_lien_user", utilisateurId))) {
    return { ok: false, erreur: "Trop d'aperçus demandés d'un coup. Réessaie dans quelques minutes." };
  }

  try {
    return { ok: true, apercu: await recupererApercu(saisie.data) };
  } catch (e) {
    if (e instanceof ErreurApercu) return { ok: false, erreur: e.message };
    // Jamais d'exception brute ni de détail réseau côté écran : le détail reste dans les journaux serveur.
    console.error("[apercuDeLien] échec inattendu", e);
    return { ok: false, erreur: "L'aperçu de ce lien a échoué. Saisis les informations à la main." };
  }
}

export type ResultatImageCollee = { ok: true } | { ok: false; erreur: string };

/**
 * **Vérifie une adresse d'image tapée ou glissée à la main, et la rend affichable.**
 *
 * Pourquoi cette action existe. Depuis, `/api/image` ne rapatrie plus que des adresses que le
 * serveur connaît déjà — l'affiche d'un événement **enregistré**, ou l'illustration qu'un aperçu de
 * lien vient de proposer. C'était nécessaire (la route était un relais ouvert : n'importe quel
 * membre pouvait faire sonder n'importe quel hôte public depuis l'adresse IP du club), mais ça a
 * emporté au passage un chemin légitime que le champ d'affiche annonce noir sur blanc : « ou coller
 * l'adresse d'une image ». Une adresse collée n'est dans aucune des deux sources, donc son aperçu
 * ne s'affichait plus — et le message d'échec accusait le lien (« cette adresse n'affiche pas
 * d'image ») alors qu'il était parfaitement bon.
 *
 * Ce que fait cette action, et c'est le point : **le serveur va lire l'image de ses propres yeux**,
 * avec les mêmes protections que l'aperçu d'un lien (schéma, refus de toute adresse interne
 * revérifié à chaque redirection, délai, taille plafonnée, type image exigé, SVG exclu). S'il l'a
 * vraiment lue, il la retient une heure ; sinon il refuse, et le refus est alors **vrai**.
 *
 * Elle n'ouvre aucune porte que `apercuDeLien` n'ouvrait déjà : mêmes droits (`evenements.edit` —
 * donc jamais un simple membre, ce qui était tout le défaut de la route), **même seau de débit**, et
 * une requête sortante par appel. C'est justement pour ça qu'elle vit ici, à côté d'elle, et pas dans
 * la route.
 */
export async function verifierImageCollee(url: string): Promise<ResultatImageCollee> {
  let utilisateurId: string;
  try {
    utilisateurId = (await assertPermission("evenements.edit")).id;
  } catch (e) {
    if (e instanceof AccesRefuse) return { ok: false, erreur: "Seuls les instructeurs et les administrateurs peuvent ajouter une affiche." };
    return { ok: false, erreur: "Impossible de vérifier tes droits : reconnecte-toi." };
  }

  const saisie = schema.safeParse(url);
  if (!saisie.success) return { ok: false, erreur: saisie.error.issues[0]?.message ?? "Cette adresse n'est pas valide." };

  // **Le même seau que l'aperçu d'un lien**, et non un second : les deux gestes déclenchent la même
  // requête sortante depuis la même personne, et deux budgets séparés en feraient deux fois plus.
  if (!(await checkRateLimit("apercu_lien_user", utilisateurId))) {
    return { ok: false, erreur: "Trop d'images vérifiées d'un coup. Réessaie dans quelques minutes." };
  }

  try {
    await recupererImage(saisie.data);
    // Lue pour de bon : elle entre au registre, et `/api/image` la servira à l'écran de saisie.
    autoriserImageApercu(saisie.data);
    return { ok: true };
  } catch (e) {
    // Ici, contrairement à `/api/image`, le message précis a sa place : il s'affiche à l'instructeur
    // qui vient de coller l'adresse, c'est lui qui peut la corriger, et il l'a saisie lui-même — il
    // n'apprend donc rien qu'il ne sache déjà sur l'hôte visé.
    if (e instanceof ErreurApercu) return { ok: false, erreur: e.message };
    console.error("[verifierImageCollee] échec inattendu", e);
    return { ok: false, erreur: "Cette adresse n'a pas pu être vérifiée. Dépose plutôt un fichier." };
  }
}
