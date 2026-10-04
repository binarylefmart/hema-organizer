"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { AFFICHE_TAILLE_MAX, AFFICHE_TAILLE_MAX_LIBELLE, enregistrerAffiche, retirerMetadonnees, typeDepuisOctets } from "@/lib/affiches";
import { AccesRefuse, assertPermission, getCurrentUser, type CurrentUser } from "@/lib/auth/current-user";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { touchSession } from "@/lib/auth/session";
import { caseCochee, champ, zodToFormState, type FormState } from "@/lib/form";
import { evenementSchema } from "@/lib/validation/evenements";
import { notifierNouvelEvenement, retirerAnnonceDiscord, synchroniserAnnonceDiscord } from "@/lib/notifications/evenements";
import { validerUrlSaisie } from "@/lib/lien-apercu";
import { afficheAVerifier, MESSAGE_AFFICHE_ADRESSE_REFUSEE } from "@/lib/validation/evenements";

/**
 * Événements du club (stages, tournois, démonstrations).
 *
 * Les droits se partagent en deux, et chaque action garde le sien :
 * - `evenements.edit` (ADMIN + INSTRUCTEUR) : tenir une annonce à jour — modifier, publier, dépublier ;
 * - `evenements.creer_supprimer` (ADMIN) : ouvrir une annonce au nom du club, ou l'effacer.
 * Les membres, eux, lisent seulement (la lecture n'a pas de permission dédiée — voir src/lib/evenements.ts).
 * Chaque geste est journalisé dans l'AuditLog.
 *
 * Pas de ré-authentification 2FA ici : supprimer un événement efface une annonce, jamais une
 * donnée appartenant à un membre (contrairement à un compte ou à une période).
 * La confirmation avant suppression se fait côté interface.
 */

/**
 * Une annonce touchée ne se voit pas qu'à un seul endroit : le fil `/evenements`, la liste
 * `/gestion/evenements`, la fiche de l'annonce, et surtout le **volet de l'en-tête**, présent sur
 * *toutes* les pages. Ne rafraîchir que `/evenements` laissait les autres sur leur version
 * précédente : on créait une annonce au 7 octobre alors qu'une au 10 existait déjà, et la liste
 * consultée juste après montrait encore l'ancien état — d'où l'impression d'un classement par date
 * de création. Le tri, lui, a toujours été chronologique (`trierEvenements`).
 *
 * D'où la revalidation de la **mise en page racine** : elle couvre l'en-tête et toutes les pages
 * qui listent des annonces, d'un seul geste. Le coût est sans importance ici — on ouvre une annonce
 * quelques fois par saison, pas à chaque clic.
 */
function rafraichir(id?: string) {
  revalidatePath("/", "layout");
  if (id) revalidatePath(`/evenements/${id}`);
}

/**
 * État de publication envoyé par le formulaire : **la case « Publié », et rien d'autre**.
 *
 * Ce qu'il y avait avant, et pourquoi c'était grave : une case non cochée **n'est pas envoyée du
 * tout** par le navigateur. L'ancienne lecture tombait donc, pour toute case décochée, sur une
 * seconde branche qui testait un champ `brouillon` — un champ qui n'a jamais existé dans aucun
 * formulaire du dépôt. `!false` valait `true` : **décocher « Publié » publiait l'annonce**, et la
 * faisait partir à tout le club par email, Discord, Telegram et téléphone. Dans l'autre sens, on ne
 * pouvait pas dépublier depuis le formulaire — seul le bouton « Dépublier » de la liste y
 * parvenait, parce qu'il passe un booléen explicite.
 *
 * Le champ absent vaut désormais **brouillon**, jamais publication : entre les deux erreurs
 * possibles, garder une annonce pour soi se rattrape, l'envoyer à tout le club non.
 */
function lirePublication(fd: FormData): boolean {
  return caseCochee(fd, "publie");
}

/**
 * Date de publication effective. Elle ne bouge qu'au moment où l'annonce devient visible :
 * une correction de faute de frappe sur une annonce déjà publiée ne la fait pas remonter en
 * « nouveauté », et dépublier garde la date d'avant (l'annonce ne compte plus, elle est cachée).
 */
function datePublication(avant: { publie: boolean; publieAt: Date | null }, publie: boolean): Date | null {
  if (!publie) return avant.publieAt;
  return avant.publie && avant.publieAt ? avant.publieAt : new Date();
}

/**
 * **L'annonce vient-elle d'être publiée ?** C'est la seule question qui autorise une notification.
 *
 * Bug vu en production : « si je modifie un événement déjà présent, je reçois une notif *nouvel
 * événement* alors qu'il est déjà présent. » Chaque enregistrement rappelait
 * `notifierNouvelEvenement`, en comptant sur la déduplication par identifiant pour n'annoncer
 * qu'une fois. Or cette déduplication ne protège qu'un canal **qui existait déjà à la
 * publication** : un événement publié avant l'arrivée de Telegram (v0.51) n'avait aucune clé
 * `evenement_telegram_<id>`, et la première modification l'annonçait comme neuf au groupe. Même
 * chose sur Discord dès que `discordMessageId` était nul.
 *
 * La règle tient donc à l'état d'avant, pas à une clé : **une modification ne vaut jamais première
 * annonce**, quel que soit le canal et quel que soit son âge. Ce qui suit une simple écriture, c'est
 * la synchronisation du salon (message édité, jamais posté).
 */
function vientDEtrePublie(avant: { publie: boolean }, apres: { publie: boolean }): boolean {
  return apres.publie && !avant.publie;
}

function lireEvenement(fd: FormData) {
  return evenementSchema.safeParse({
    nom: champ(fd, "nom"),
    description: champ(fd, "description"),
    dateDebut: champ(fd, "dateDebut"),
    heureDebut: champ(fd, "heureDebut"),
    dateFin: champ(fd, "dateFin"),
    heureFin: champ(fd, "heureFin"),
    lieu: champ(fd, "lieu"),
    adresse: champ(fd, "adresse"),
    organisateur: champ(fd, "organisateur"),
    prix: champ(fd, "prix"),
    prixAdherent: champ(fd, "prixAdherent"),
    dureeNombre: champ(fd, "dureeNombre"),
    dureeUnite: champ(fd, "dureeUnite"),
    lienInscription: champ(fd, "lienInscription"),
    lienSource: champ(fd, "lienSource"),
    imageUrl: champ(fd, "imageUrl"),
    publie: lirePublication(fd),
  });
}

/**
 * **L'adresse d'une affiche est éprouvée comme adresse avant d'entrer en base**. Voir
 * `MESSAGE_AFFICHE_ADRESSE_REFUSEE` (src/lib/validation/evenements.ts), qui porte le pourquoi : la
 * base est la liste blanche de `/api/image`, et y écrire une adresse interne faisait du relais un
 * sondeur d'hôtes parti de l'IP du club. La vérification vit ici — et pas dans le schéma — parce
 * que `validerUrlSaisie` traîne `node:dns` derrière elle, qui n'a rien à faire dans un module lu du
 * navigateur.
 */
function afficheRefusee(valeur: string): FormState | null {
  if (!afficheAVerifier(valeur) || validerUrlSaisie(valeur).ok) return null;
  return { erreur: MESSAGE_AFFICHE_ADRESSE_REFUSEE, erreurs: { imageUrl: MESSAGE_AFFICHE_ADRESSE_REFUSEE } };
}

/** Ouvrir une annonce : geste du bureau (administrateurs). */
export async function creerEvenement(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await assertPermission("evenements.creer_supprimer");
  const parsed = lireEvenement(fd);
  if (!parsed.success) return zodToFormState(parsed.error);
  const refusAffiche = afficheRefusee(parsed.data.imageUrl);
  if (refusAffiche) return refusAffiche;
  // Une annonce créée déjà publiée l'est à cet instant ; un brouillon attendra sa publication.
  const evenement = await db.evenement.create({
    data: { ...parsed.data, creeParId: user.id, publieAt: parsed.data.publie ? new Date() : null },
  });
  await audit(user, "evenement.cree", evenement.id, { nom: evenement.nom, dateDebut: evenement.dateDebut, publie: evenement.publie });
  // Annonce publiée : on prévient (dédoublonné — republier plus tard ne renotifie personne).
  if (evenement.publie) await notifierNouvelEvenement(evenement.id);
  rafraichir(evenement.id);
  /*
   * **On part vers l'annonce créée, comme `creerSeance`**. Rester ici rendait un écran incohérent :
   * React réinitialise le formulaire quand l'action rend la main, mais seuls les champs non
   * contrôlés repartent à vide — dates, horaires, lieu, tarifs — pendant que le nom, la description
   * et l'affiche, qui sont des états, restaient affichés. On lisait donc « Événement créé. »
   * au-dessus d'un formulaire à moitié rempli, sur une page toujours intitulée « Nouvel
   * événement », et le réflexe de réappuyer renvoyait une erreur de validation sur une annonce déjà
   * publiée. `redirect` lève : il doit rester **après** la notification et le journal.
   */
  redirect(`/evenements/${evenement.id}`);
}

/** Tenir l'annonce à jour : geste de l'encadrement (instructeurs et administrateurs). */
export async function modifierEvenement(evenementId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const user = await assertPermission("evenements.edit");
  const parsed = lireEvenement(fd);
  if (!parsed.success) return zodToFormState(parsed.error);
  const refusAffiche = afficheRefusee(parsed.data.imageUrl);
  if (refusAffiche) return refusAffiche;
  const avant = await db.evenement.findUniqueOrThrow({ where: { id: evenementId }, select: { publie: true, publieAt: true } });
  // `creeParId` n'est jamais réécrit : il garde la trace de qui a ouvert l'annonce.
  const apres = await db.evenement.update({ where: { id: evenementId }, data: { ...parsed.data, publieAt: datePublication(avant, parsed.data.publie) } });
  await audit(user, "evenement.modifie", evenementId, { nom: parsed.data.nom, dateDebut: parsed.data.dateDebut });
  // Le formulaire peut faire passer un brouillon en publié : **c'est le seul cas** où l'on annonce.
  // Toute autre écriture ne fait que tenir le salon à jour : le message est corrigé s'il existe,
  // barré si l'annonce repasse en brouillon, et jamais posté (voir notifications/evenements.ts).
  if (vientDEtrePublie(avant, apres)) await notifierNouvelEvenement(apres.id);
  else await synchroniserAnnonceDiscord(apres.id);
  rafraichir(evenementId);
  return { succes: "Événement enregistré." };
}

/** Suppression définitive, réservée au bureau (la confirmation est demandée par l'interface). */
export async function supprimerEvenement(evenementId: string): Promise<void> {
  const user = await assertPermission("evenements.creer_supprimer");
  const evenement = await db.evenement.delete({ where: { id: evenementId } });
  await audit(user, "evenement.supprime", evenementId, { nom: evenement.nom, dateDebut: evenement.dateDebut });
  // La ligne n'existe plus : on passe au salon ce que la suppression vient de rendre, pour que le
  // message cesse d'annoncer un événement qui n'est plus au programme.
  await retirerAnnonceDiscord(evenement);
  rafraichir();
}

/**
 * Publier un brouillon, ou retirer un événement de la vue des membres sans l'effacer.
 * `publie` vaut `true` par défaut : un bouton « Publier maintenant » n'a rien à passer.
 */
export async function publierEvenement(evenementId: string, publie: boolean = true): Promise<void> {
  const user = await assertPermission("evenements.edit");
  const avant = await db.evenement.findUniqueOrThrow({ where: { id: evenementId }, select: { publie: true, publieAt: true } });
  const evenement = await db.evenement.update({
    where: { id: evenementId },
    data: { publie: publie === true, publieAt: datePublication(avant, publie === true) },
  });
  await audit(user, "evenement.publie", evenementId, { nom: evenement.nom, publie: evenement.publie });
  // Dépublier n'est pas un simple masquage côté app : le message déjà posté sur le salon doit
  // cesser d'annoncer l'événement, sans quoi il continuerait d'inviter tout le monde.
  // Republier un brouillon annonce ; « publier » ce qui est déjà publié ne fait que synchroniser.
  if (vientDEtrePublie(avant, evenement)) await notifierNouvelEvenement(evenementId);
  else await synchroniserAnnonceDiscord(evenementId);
  rafraichir(evenementId);
}

/**
 * « J'ai vu les événements » : appelée par l'écran à l'ouverture du panneau, elle ne fait que poser
 * l'horodatage de la personne connectée — de quoi éteindre la pastille « du nouveau ».
 *
 * Geste de lecture, donc : aucune permission particulière (il suffit d'être connecté), rien dans le
 * journal d'audit, aucune redirection, et aucune erreur renvoyée à l'écran — au pire la pastille
 * reste allumée. Idempotente : la rappeler ne fait que réécrire la même minute.
 *
 * Pas de `revalidatePath` volontairement : la pastille s'éteint côté écran, et on ne veut pas
 * rafraîchir le panneau sous les doigts de la personne au moment où elle l'ouvre.
 */
export async function marquerEvenementsVus(): Promise<void> {
  try {
    const user = await getCurrentUser();
    if (!user) return;
    await db.user.update({ where: { id: user.id }, data: { evenementsVusAt: new Date() } });
  } catch (e) {
    console.error("[evenements] impossible de mémoriser la dernière visite", e);
  }
}

/**
 * Dépôt de l'affiche d'un événement (glisser-déposer dans le formulaire), en remplacement du
 * collage d'une URL : l'image est enregistrée chez nous et l'action renvoie l'URL à mettre dans
 * `imageUrl`. Rien n'est écrit en base ici — c'est l'enregistrement du formulaire qui décide.
 *
 * Doctrine de sécurité, la même que /api/image : on ne croit **ni** au `type` annoncé par le
 * navigateur **ni** au nom du fichier — les deux viennent du client et se falsifient. Le type est
 * déduit des octets de tête (`typeDepuisOctets`), et le SVG reste refusé (un SVG servi depuis
 * notre origine peut porter du script). Les métadonnées (EXIF, GPS) sont retirées avant écriture :
 * une affiche photographiée au téléphone trimballe sinon les coordonnées de la salle.
 */
export async function televerserAffiche(formData: FormData): Promise<{ ok: true; url: string } | { ok: false; erreur: string }> {
  let user: CurrentUser;
  try {
    // La matrice décide seule, session forte comprise : un `can()` recopié ici aurait continué
    // d'ouvrir la porte le jour où `evenements.edit` cesserait d'être multi-rôle.
    user = await assertPermission("evenements.edit");
  } catch (e) {
    if (e instanceof AccesRefuse) return { ok: false, erreur: "Seuls les instructeurs et les administrateurs peuvent déposer une affiche." };
    return { ok: false, erreur: "Impossible de vérifier tes droits : reconnecte-toi." };
  }
  // Un dépôt d'image coûte du disque : on borne ce qu'une seule personne peut y poser.
  if (!(await checkRateLimit("affiche_televersement_user", user.id))) {
    return { ok: false, erreur: "Trop d'affiches déposées d'un coup. Réessaie dans quelques minutes." };
  }

  const fichier = formData.get("fichier");
  if (!(fichier instanceof File) || fichier.size === 0) return { ok: false, erreur: "Aucune affiche reçue." };
  // Taille vérifiée avant lecture : inutile de charger 50 Mo en mémoire pour les refuser ensuite.
  if (fichier.size > AFFICHE_TAILLE_MAX) return { ok: false, erreur: `L'affiche dépasse ${AFFICHE_TAILLE_MAX_LIBELLE}.` };

  const octets = new Uint8Array(await fichier.arrayBuffer());
  const type = typeDepuisOctets(octets);
  if (!type) return { ok: false, erreur: "Format non reconnu : dépose une image JPEG, PNG ou WebP." };

  try {
    const propre = retirerMetadonnees(octets, type);
    const url = await enregistrerAffiche(propre, type);
    await audit(user, "evenement.affiche_televersee", null, { octets: propre.byteLength, type });
    await touchSession();
    return { ok: true, url };
  } catch (e) {
    // Jamais de détail disque côté écran : il reste dans les journaux serveur.
    console.error("[televerserAffiche] échec de l'enregistrement", e);
    return { ok: false, erreur: "L'enregistrement de l'affiche a échoué. Réessaie, ou colle une URL d'image." };
  }
}
