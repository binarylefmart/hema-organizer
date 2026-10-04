import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

/**
 * **« Accès actif » : la condition pour recevoir une notification personnelle.**
 *
 * Une personne saisie dans l'annuaire mais jamais invitée, ou dont l'accès a été coupé, ne reçoit
 * plus rien : ni récap, ni rappel, ni annonce. Lui écrire, c'était l'inviter à cliquer sur
 * « Je viens » dans une application où elle ne peut pas entrer — et, pour qui n'a jamais été
 * invité, faire partir des emails du club avant que l'équipe ait décidé de lui ouvrir la porte.
 *
 * La règle :
 *
 * - le compte est **actif** et **n'est pas un compte de service** (sauf demande explicite, voir
 *   {@link OptionsAccesActif}) ;
 * - **et** il a au moins une porte d'entrée ouverte :
 *   1. un **lien vivant** — une invitation ni révoquée, ni expirée ;
 *   2. un **mot de passe** ;
 *   3. une **session ouverte** non expirée.
 *
 * Elle est écrite **une fois**, sous deux formes qui disent la même chose :
 * {@link aUnAccesActif} (fonction pure, sur un compte déjà lu) et {@link accesActifWhere} (fragment
 * `where` Prisma sur `User`, pour trier en base). Un test fait tourner les deux sur une vraie base
 * SQLite et vérifie qu'elles rendent le même verdict, cas par cas.
 *
 * **Ce qui n'est PAS filtré par cette règle** : les messages d'accès et de sécurité eux-mêmes
 * (invitation, renouvellement de lien, nouvel appareil, mot de passe oublié, alertes de sécurité) —
 * ce sont eux qui ouvrent la porte —, et les canaux collectifs (salons, liste de diffusion), qui ne
 * s'adressent à personne nommément.
 *
 * **Voisine, mais différente, de `aDejaUnAcces`** (src/lib/membres.ts, « déjà entré ») : celle-ci
 * répond à « quel geste proposer, invitation ou réinitialisation ? », et compte donc **l'histoire**
 * — un lien déjà ouvert, même révoqué depuis, une double authentification, n'importe quelle session
 * encore en table. Ici on demande « peut-elle entrer **aujourd'hui** ? » : un lien révoqué ou expiré
 * ne compte plus, une session expirée non plus, et un lien jamais ouvert mais vivant compte (c'est
 * le cas de toute personne invitée qui n'a pas encore cliqué). Les deux questions ne se recouvrent
 * pas : les fusionner changerait les boutons de l'annuaire ou laisserait partir des messages.
 */

/** Ce qu'il faut lire d'un compte pour trancher, sans autre secret que la présence d'un mot de passe. */
export type CompteAcces = {
  actif: boolean;
  service: boolean;
  passwordHash: string | null;
  invitations: readonly { revokedAt: Date | null; expiresAt: Date }[];
  authSessions: readonly { expiresAt: Date }[];
};

export type OptionsAccesActif = {
  /**
   * Garder les comptes de service. Seuls les pense-bêtes d'organisation adressés au bureau
   * (période suivante à créer, période non activée) s'en servent : le compte de service y est la
   * boîte de l'association, et ces messages sont exactement son affaire. Il doit tout de même avoir
   * un accès actif, comme tout le monde.
   */
  compteDeService?: boolean;
};

/** Une invitation est vivante si personne ne l'a révoquée et qu'elle n'a pas expiré. */
export function lienVivant(invitation: { revokedAt: Date | null; expiresAt: Date }, now: Date): boolean {
  return invitation.revokedAt === null && invitation.expiresAt.getTime() > now.getTime();
}

/** La règle, sur un compte déjà lu (fonction pure). */
export function aUnAccesActif(compte: CompteAcces, now: Date, options: OptionsAccesActif = {}): boolean {
  if (!compte.actif) return false;
  if (compte.service && !options.compteDeService) return false;
  return (
    compte.invitations.some((i) => lienVivant(i, now)) ||
    compte.passwordHash !== null ||
    compte.authSessions.some((s) => s.expiresAt.getTime() > now.getTime())
  );
}

/**
 * La même règle en fragment `where` Prisma sur `User`.
 *
 * Il porte son propre `OR` : pour le combiner à un autre filtre qui en a un aussi, le ranger dans un
 * `AND` (`{ AND: [autreFiltre, accesActifWhere(now)] }`) plutôt que de l'étaler, sans quoi l'un des
 * deux `OR` écraserait l'autre.
 */
export function accesActifWhere(now: Date, options: OptionsAccesActif = {}): Prisma.UserWhereInput {
  return {
    actif: true,
    ...(options.compteDeService ? {} : { service: false }),
    OR: [
      { invitations: { some: { revokedAt: null, expiresAt: { gt: now } } } },
      { passwordHash: { not: null } },
      { authSessions: { some: { expiresAt: { gt: now } } } },
    ],
  };
}

/**
 * **Le tri des destinataires**, au moment où un envoi les a chargés : ne garde que les personnes qui
 * ont un accès actif, dans l'ordre reçu. Une seule requête, quel que soit le nombre de personnes.
 *
 * C'est le point de passage des notifications personnelles (`src/lib/notifications/**`). Il ne
 * touche à **aucun comptage** : l'effectif, le taux et l'alerte « peu de monde » se calculent sur les
 * inscrits ; on ne décide ici que de qui reçoit un message.
 */
export async function filtrerAccesActif<T extends { id: string }>(personnes: readonly T[], now: Date, options: OptionsAccesActif = {}): Promise<T[]> {
  if (personnes.length === 0) return [];
  const ids = await idsAvecAccesActif(
    personnes.map((p) => p.id),
    now,
    options,
  );
  return personnes.filter((p) => ids.has(p.id));
}

/** Les identifiants, parmi ceux donnés, qui ont un accès actif. */
export async function idsAvecAccesActif(ids: readonly string[], now: Date, options: OptionsAccesActif = {}): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const lignes = await db.user.findMany({
    where: { AND: [{ id: { in: [...new Set(ids)] } }, accesActifWhere(now, options)] },
    select: { id: true },
  });
  return new Set(lignes.map((l) => l.id));
}
