import { cache } from "react";
import type { CurrentUser } from "@/lib/auth/current-user";
import { accesAdminRegle, compteAcces, peutReglerSonAcces } from "@/lib/auth/acces-admin";
import { can, isStaff } from "@/lib/permissions";
import { evenementsAVenir, evenementsPasses, nombreEvenementsNouveaux } from "@/lib/evenements";
import { identite } from "@/lib/identite";
import { PanneauEvenements, type ApercuEvenement } from "@/components/evenements/PanneauEvenements";
import { LienAccueil } from "./LienAccueil";
import { NavBas, NavEntete, type Onglet } from "./Navigation";

export type AccesAdmin = {
  /** Administrateur nommé (Delta, Echo…), par opposition au compte de service du portail */
  nominatif: boolean;
  aMotDePasse: boolean;
  totpActiveAt: Date | null;
  /** Réglage terminé (mot de passe + 2FA) : le compte se connecte seul sur /connexion */
  regle: boolean;
};

const AUCUN: AccesAdmin = { nominatif: false, aMotDePasse: false, totpActiveAt: null, regle: false };

/**
 * Où en est l'accès administrateur de la personne connectée (une seule lecture par requête),
 * d'après les règles de src/lib/auth/acces-admin.ts — celles-là mêmes que suit /admin/activer.
 * Les points d'entrée vers /admin/activer — accueil, en-tête, profil — ne s'adressent qu'aux
 * administrateurs nommés : ni les membres, ni les instructeurs, ni le compte de service du portail
 * (lui a déjà mot de passe et 2FA) ne doivent en voir la moindre trace.
 */
export const accesAdmin = cache(async (user: CurrentUser): Promise<AccesAdmin> => {
  if (!can(user, "settings.technical")) return AUCUN;
  const compte = await compteAcces(user.id);
  if (!compte) return AUCUN;
  return { nominatif: peutReglerSonAcces(compte), aMotDePasse: !!compte.passwordHash, totpActiveAt: compte.totpActiveAt, regle: accesAdminRegle(compte) };
});

/** Au-delà, on ne remplit plus un volet : on va voir le fil complet (/evenements). */
const APERCUS_MAX = 20;

/** Seuls les champs que le volet affiche traversent la frontière serveur → client. */
function apercus(liste: readonly ApercuEvenement[]): ApercuEvenement[] {
  return liste.slice(0, APERCUS_MAX).map((e) => ({
    id: e.id,
    nom: e.nom,
    dateDebut: e.dateDebut,
    dateFin: e.dateFin,
    heureDebut: e.heureDebut,
    heureFin: e.heureFin,
    lieu: e.lieu,
    organisateur: e.organisateur,
    imageUrl: e.imageUrl,
    publie: e.publie,
  }));
}

/**
 * Ce que le volet « Événements » a besoin de savoir.
 *
 * **Le volet est rendu même quand il n'y a rien à lire**. Il s'effaçait pour un membre tant
 * qu'aucune annonce n'existait, à venir comme passée — au motif qu'une barre de navigation ne doit
 * pas promettre un écran vide. Mais c'était la seule porte vers `/evenements` : aucun onglet, aucun
 * lien ailleurs. L'écran devenait proprement inatteignable, et il le redevenait à chaque fois que
 * le club n'avait rien d'annoncé. Un volet qui dit « Aucun événement à venir pour le moment » est
 * une réponse ; une icône absente est une impasse. Le panneau sait déjà tenir vide — il le faisait
 * pour l'équipe —, et les deux requêtes étaient de toute façon déjà faites ici.
 *
 * Les brouillons sont écartés de la requête pour qui n'a pas le droit d'écrire
 * (src/lib/evenements.ts).
 *
 * Les deux listes sont lues ici, dans l'en-tête, parce que le volet est un composant client sans
 * chargement différé : deux requêtes indexées bornées à vingt lignes chacune, dont on ne garde que
 * les champs affichés — le texte des annonces, lui, reste sur le serveur.
 */
const voletEvenements = cache(async (user: CurrentUser) => {
  const [aVenir, passes, nouveautes] = await Promise.all([evenementsAVenir(user), evenementsPasses(user), nombreEvenementsNouveaux(user)]);
  return { aVenir: apercus(aVenir), passes: apercus(passes), peutCreer: can(user, "evenements.creer_supprimer"), nouveautes };
});

/**
 * En-tête encre compact et navigation : à gauche, l'écu, le nom du club et le mot « Accueil »
 * dans un seul lien (`LienAccueil`) ; au centre-droit, trois onglets (Planning, Séances, Atelier)
 * en bas sur téléphone et dans l'en-tête sur ordinateur ; les événements (volet déroulant), l'espace
 * instructeur et le profil en icônes dans l'en-tête, sur toutes les tailles d'écran.
 * Les libellés des onglets restent en icône + mot (≥ 16 px) ; l'en-tête garde la largeur du contenu (max-w-3xl),
 * les entrées secondaires sont donc en icônes pour que la barre tienne sans débordement jusqu'à 1280 px.
 * La déconnexion est dans « Mon profil ».
 */
export async function Entete({ user }: { user: CurrentUser }) {
  const club = await identite();
  const acces = await accesAdmin(user);
  // Administrateur nommé qui n'a pas encore son mot de passe et sa 2FA : une pastille sur l'icône,
  // et le libellé (infobulle et nom accessible) dit ce qui reste à faire. Rien de plus dans la barre.
  const activationAFaire = acces.nominatif && !acces.regle;
  // Trois onglets principaux ; les entrées secondaires sont en icônes dans l'en-tête
  const onglets: Onglet[] = [
    { href: "/planning", label: "Planning", icone: "calendrier" },
    { href: "/seances", label: "Séances", icone: "epee" },
    { href: "/ateliers", label: "Atelier", icone: "outil" },
  ];
  // Les événements ne sont pas un onglet mais un volet, à la manière d'un centre de notifications.
  // Il est toujours là : c'est la seule porte vers `/evenements` (voir `voletEvenements`).
  const volet = await voletEvenements(user);
  // Cet onglet, c'est **l'organisation** : séances, planning, membres, ateliers. Il s'appelle donc
  // « Espace instructeur » pour tout le monde, administrateurs compris — l'administration technique
  // n'y a plus d'entrée. Elle se rejoint uniquement depuis « Mon profil », parce qu'elle tient à la
  // personne (son mot de passe, sa double authentification, sa session forte) et non à la fonction
  // d'encadrement : un admin qui organise un cours n'a pas à passer devant la porte des réglages.
  const equipe: Onglet | null = isStaff(user) ? { href: "/gestion", label: "Espace instructeur", icone: "bouclier" } : null;
  const profil: Onglet = { href: "/profil", label: "Profil", icone: "personne" };
  // L'espace admin : sa roue crantée à lui, distincte de l'écu de l'espace instructeur. L'entrée
  // n'existe que pendant l'élévation — c'est son existence, et non sa couleur, qui dit qu'on est
  // connecté en tant qu'administrateur.
  const admin: Onglet = { href: "/admin", label: "Admin", icone: "engrenage" };
  return (
    <>
      <header className="sticky top-0 z-10 bg-encre text-encre-texte shadow-entete">
        {/* 80 px (56 à l'origine, 64 un temps) : le lien de l'accueil est devenu un bouton — écu,
            nom du club et mot, sur deux lignes — et son liseré doré frôlait le bord de la barre. Le
            bouton lui-même grandit (écu de 40 px, 56 px de haut) et garde 12 px d'air au-dessus et
            en dessous : la barre se lit comme une enseigne, le bouton comme un bouton. Les deux
            éléments calés sous l'en-tête suivent : l'en-tête collant du planning et le volet des
            événements sur téléphone. */}
        <div className="mx-auto flex h-20 max-w-3xl items-center gap-3 px-4 tel:max-w-[40rem]">
          {/* L'écu, le nom du club et le mot « Accueil » : un seul lien, qui s'allume quand on
              y est (voir `LienAccueil`). C'est la porte de l'accueil — elle existait déjà, elle se
              nomme désormais. */}
          <LienAccueil sigle={user.sessionForte} identite={club} />
          <nav className="ml-auto flex items-center gap-1" aria-label="Menu">
            {/* Onglets principaux : dans l'en-tête sur ordinateur, en bas d'écran en version téléphone */}
            <span className="hidden items-center gap-1 ordi:flex">
              <NavEntete onglets={onglets} />
              <span className="mx-1 h-6 w-px bg-encre-texte/30" aria-hidden />
            </span>
            <PanneauEvenements aVenir={volet.aVenir} passes={volet.passes} peutCreer={volet.peutCreer} nouveautes={volet.nouveautes} ecu={club.ecu} />
            {equipe && <NavEntete onglets={[equipe]} iconesSeules />}
            {/* **L'espace admin, quand il est ouvert** : son entrée à lui, avec son icône à lui.
                La roue crantée dit « réglages » sans rien à apprendre, et surtout elle ne se
                confond pas avec l'écu de l'espace instructeur juste à côté — deux écus côte à
                côte ne disaient plus lequel menait où.
                L'entrée n'existe que pendant l'élévation : elle est donc, du même coup, le
                témoin qu'on est connecté en tant qu'administrateur sur cet appareil. D'où le mot
                « Admin » à côté de la roue — une icône dit *où l'on va*, pas *qui l'on est* — et
                le fond coloré, qui la détache des onglets ordinaires. */}
            {/* Une entrée comme les autres : même composant, donc même comportement — elle ne
                s'allume que sur les écrans de l'espace admin, et reste discrète ailleurs. Elle
                portait un fond permanent pour signaler l'élévation ; c'était un faux signal, on la
                lisait comme « tu es ici » alors qu'on était sur le planning. Ce qui dit
                l'élévation, c'est **qu'elle existe** : elle n'apparaît que pendant celle-ci. */}
            {user.sessionForte && <NavEntete onglets={[admin]} />}
            {/* La pastille d'activation suit la porte : l'accès administrateur se règle dans le
                profil, c'est donc l'onglet Profil qui signale qu'il reste une étape à faire. */}
            <span className="relative flex">
              <NavEntete onglets={[profil]} iconesSeules />
              {activationAFaire && <span aria-hidden className="pointer-events-none absolute right-0.5 top-1 h-2.5 w-2.5 rounded-full bg-marque ring-2 ring-encre" />}
            </span>
          </nav>
        </div>
      </header>
      <NavBas onglets={onglets} />
    </>
  );
}
