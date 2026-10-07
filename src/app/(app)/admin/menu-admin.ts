/**
 * **Les rubriques de l'espace admin, et ce que chacun peut en ouvrir** — un module pur, lu par le
 * layout (la barre d'onglets de l'ordinateur) et par l'accueil `/admin` (le menu en liste du
 * téléphone).
 *
 * Une seule liste pour les deux, et c'est tout l'intérêt de l'avoir sortie du layout : un onglet
 * ajouté ici apparaît dans les deux navigations à la fois, dans le même ordre et sous le même nom.
 * Deux listes recopiées finiraient par ne plus dire la même chose — une rubrique visible sur
 * l'ordinateur et introuvable sur le téléphone, ou l'inverse.
 *
 * **L'ordre est celui des onglets**, et les trois groupes du menu en sont des **coupures**, jamais un
 * tri : sur l'ordinateur on lit les dix onglets d'affilée, sur le téléphone les mêmes dix lignes,
 * rangées sous trois titres.
 */
import type { NomIcone } from "@/components/ui/Icone";
import { can, type Permission, type UserLike } from "@/lib/permissions";

/** Une rubrique : son adresse, son nom, son icône dans le menu, et la permission que sa page exige. */
export type RubriqueAdmin = {
  href: string;
  label: string;
  icone: NomIcone;
  /** **Celle que la page elle-même demande** (`requirePermission` en tête de son `page.tsx`). */
  permission: Permission;
};

export type GroupeAdmin = { titre: string; rubriques: readonly RubriqueAdmin[] };

/**
 * **Les trois groupes du menu, dans l'ordre des onglets.** Le quotidien d'abord — c'est pour lui
 * qu'on ouvre l'espace admin un soir de cours —, puis ce qui se règle une fois, puis ce qu'on
 * consulte quand quelque chose cloche.
 */
export const GROUPES_ADMIN: readonly GroupeAdmin[] = [
  {
    titre: "Le club au quotidien",
    rubriques: [
      // Le trimestre en tête : c'est par lui que commence une saison, et c'est le seul de
      // ces écrans qui parle d'organisation plutôt que de technique.
      { href: "/admin/periodes", label: "Périodes", icone: "calendrier", permission: "periods.manage" },
      { href: "/admin/membres", label: "Membres", icone: "groupe", permission: "members.view" },
      // Le registre d'un soir de cours : la séance, puis la réponse de chacun
      { href: "/admin/presences", label: "Présences", icone: "check", permission: "attendances.autrui" },
      // Les thèmes du planning : la liste déroulante des cases, décidée une fois pour tout le club
      { href: "/admin/themes", label: "Thèmes et lieux", icone: "lieu", permission: "themes.manage" },
    ],
  },
  {
    titre: "Réglages",
    rubriques: [
      // Le club lui-même : son nom, son sigle, ses couleurs, son logo. Réglé une fois à
      // l'installation et revu rarement, mais c'est ce qui donne son visage à l'application.
      { href: "/admin/identite", label: "Club", icone: "etendard", permission: "settings.technical" },
      { href: "/admin/notifications", label: "Notifications", icone: "partage", permission: "settings.technical" },
      { href: "/admin/comptes", label: "Comptes admin", icone: "bouclier", permission: "admins.manage" },
    ],
  },
  {
    titre: "Sécurité",
    rubriques: [
      { href: "/admin/sessions", label: "Sessions", icone: "personne", permission: "auth_sessions.revoke" },
      // Le journal d'audit — qui a fait quoi — puis « À propos », qui dit ce que cette
      // installation est et ce qu'elle contient. Ce qui *part* (emails, salons, téléphone,
      // API publique) se règle dans Notifications, et nulle part ailleurs.
      { href: "/admin/audit", label: "Journal d'audit", icone: "livre", permission: "audit.view" },
      { href: "/admin/apropos", label: "À propos", icone: "info", permission: "settings.technical" },
    ],
  },
];

/** Ce que la navigation sait de la personne : ses droits, et si l'espace admin est ouvert. */
export type VisiteurAdmin = UserLike & { sessionForte: boolean };

/**
 * **Les groupes qu'une personne voit**, rubriques filtrées par leurs droits, groupes vides retirés.
 *
 * **Sans élévation, rien** : c'est la règle des onglets, et pour la même raison — chacun de ces
 * liens ne mènerait qu'à un renvoi vers le parcours de réglage. Avec elle, une rubrique n'est
 * montrée que si sa page l'ouvrirait : un lien qui mène à un refus fait douter de tous les autres.
 * Aujourd'hui toutes ces permissions appartiennent au bureau, donc un administrateur voit les dix ;
 * le filtre est là pour le jour où l'une d'elles s'ouvrira ou se refermera.
 */
export function groupesVisibles(visiteur: VisiteurAdmin): GroupeAdmin[] {
  if (!visiteur.sessionForte) return [];
  return GROUPES_ADMIN.map((g) => ({ titre: g.titre, rubriques: g.rubriques.filter((r) => can(visiteur, r.permission)) })).filter(
    (g) => g.rubriques.length > 0,
  );
}

/** Les mêmes rubriques à plat, dans le même ordre : les onglets de l'ordinateur. */
export function rubriquesVisibles(visiteur: VisiteurAdmin): RubriqueAdmin[] {
  return groupesVisibles(visiteur).flatMap((g) => g.rubriques);
}

/**
 * **Où ramène le « ‹ » du téléphone** : au menu depuis une rubrique, **à la rubrique** depuis une de ses
 * pages (la fiche d'un membre ramène à « Membres », une période à « Périodes », un canal à
 * « Notifications ») — on revient d'où l'on vient, pas deux crans plus haut. `null` sur le menu lui-même.
 */
export function retourAdmin(chemin: string): { href: string; label: string } | null {
  if (chemin === "/admin") return null;
  const rubrique = GROUPES_ADMIN.flatMap((g) => g.rubriques).find((r) => chemin.startsWith(`${r.href}/`));
  return rubrique ? { href: rubrique.href, label: rubrique.label } : { href: "/admin", label: "Admin" };
}
