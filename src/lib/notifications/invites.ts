import { idsAvecAccesActif } from "@/lib/acces-actif";
import { db } from "@/lib/db";
import { personnesDuClub } from "@/lib/permissions";
import { compterPresences, type Compteurs } from "@/lib/presences";
import { programmeSeance, type CaseProgramme, type SeanceResume } from "./contenu";

/**
 * Chargement commun au récap de la veille et aux rappels sans réponse : les séances d'un ou plusieurs
 * jours donnés, avec leurs invités (membres de la période) et la réponse de chacun.
 *
 * Règles reprises de l'existant :
 * - seules les périodes ACTIVE et les séances non annulées comptent ;
 * - le compte de connexion du portail n'est pas une personne du club : il n'est ni invité, ni compté,
 *   ni destinataire (`service = false` dans la requête, `personnesDuClub` en ceinture et bretelles) ;
 * - une personne **sans adresse email** est bien invitée et bien comptée dans le dénominateur : seule
 *   la liste des destinataires l'écarte, au moment de l'envoi (`destinataireRetenu`) ;
 * - les **choix personnels de notifications** (`preferencesNotifications`, à défaut `rappelEmail`) sont
 *   chargés avec les invités pour que `destinataireRetenu` puisse trancher sans nouvelle requête ;
 * - l'**accès actif** de chacun (`accesActif`, src/lib/acces-actif.ts) est lu en une requête de plus :
 *   une personne sans accès reste invitée et comptée, elle n'est simplement destinataire de rien ;
 * - le dénominateur du taux reste le nombre d'invités de la période (`src/lib/presences.ts`) ;
 * - le **programme** (cases du planning) est chargé pour le récap Discord — et la requête ne
 *   sélectionne **ni l'instructeur, ni l'animateur de l'atelier** : ce qui n'est pas lu en base ne
 *   peut pas fuir un jour dans une mise en forme, et aucun nom ne doit paraître sur le salon.
 */
export type MembreSeance = {
  id: string;
  prenom: string;
  /**
   * Adresse facultative : une personne sans email reste **invitée** (elle compte dans `chiffres.invites`
   * et dans le taux de présence), mais `destinataireRetenu` l'écarte de tout envoi.
   */
  email: string | null;
  actif: boolean;
  /** Case historique « rappel la veille » : valeur par défaut des types de rappel */
  rappelEmail: boolean;
  /** Choix personnels de notifications (JSON), null si la personne n'a rien réglé */
  preferencesNotifications?: string | null;
  /** Réponse du membre pour cette séance, ou null s'il n'a pas répondu */
  statut: string | null;
  /**
   * La personne a-t-elle un accès actif (lien vivant, mot de passe ou session ouverte) ? Sans lui,
   * elle reste invitée et comptée, mais aucun message personnel ne lui part.
   */
  accesActif: boolean;
};

export type SeanceAvecInvites = {
  id: string;
  seance: SeanceResume;
  /**
   * La **répartition complète** (présents, absents, peut-être, sans réponse, taux), et pas seulement
   * « présents / invités » : le récap Discord l'affiche en entier, et les autres canaux n'y lisent
   * que les deux champs qu'ils lisaient déjà.
   */
  chiffres: Compteurs;
  /** Programme du cours, sans aucun nom (voir l'en-tête du module). */
  programme: CaseProgramme[];
  membres: MembreSeance[];
};

/** Séances non annulées d'une liste de dates ("AAAA-MM-JJ"), avec invités et réponses. */
export async function seancesAvecInvites(dates: readonly string[], now = new Date()): Promise<SeanceAvecInvites[]> {
  if (dates.length === 0) return [];
  const seances = await db.session.findMany({
    where: { date: { in: [...dates] }, annulee: false, period: { statut: "ACTIVE" } },
    orderBy: [{ date: "asc" }, { heureDebut: "asc" }],
    include: {
      attendances: { select: { userId: true, statut: true } },
      // Volontairement limité au thème, au niveau et au titre de l'atelier : pas d'instructeur, pas d'animateur.
      // La partie, la nature et le thème, **jamais un nom** : le récap du soir ne publie pas qui encadre.
      parties: { select: { ordre: true, bloc: true, nature: true, theme: true, niveau: true, atelier: { select: { titre: true } } }, orderBy: { ordre: "asc" } },
      period: {
        include: {
          membres: {
            where: { user: { service: false } },
            include: {
              user: { select: { id: true, prenom: true, email: true, actif: true, rappelEmail: true, preferencesNotifications: true, service: true } },
            },
          },
        },
      },
    },
  });
  // Une seule requête pour toutes les séances du passage : qui, parmi les invités, peut encore entrer.
  const avecAcces = await idsAvecAccesActif(
    seances.flatMap((s) => s.period.membres.map((m) => m.user.id)),
    now,
  );
  return seances.map((s) => {
    const reponses = new Map(s.attendances.map((a) => [a.userId, a.statut]));
    const invites = personnesDuClub(s.period.membres.map((m) => m.user));
    const membres: MembreSeance[] = invites.map((u) => ({
      id: u.id,
      prenom: u.prenom,
      email: u.email,
      actif: u.actif,
      rappelEmail: u.rappelEmail,
      preferencesNotifications: u.preferencesNotifications ?? null,
      statut: reponses.get(u.id) ?? null,
      accesActif: avecAcces.has(u.id),
    }));
    return {
      id: s.id,
      seance: { date: s.date, heureDebut: s.heureDebut, heureFin: s.heureFin, lieu: s.lieu, theme: s.theme, alternative: s.alternative, disciplines: s.disciplines },
      chiffres: compterPresences(
        membres.map((m) => m.statut ?? ""),
        membres.length,
      ),
      programme: programmeSeance(s.parties),
      membres,
    };
  });
}
