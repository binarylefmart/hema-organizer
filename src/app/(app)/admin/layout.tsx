import { cheminCourant, requirePermission } from "@/lib/auth/current-user";
import { quitterEspaceAdmin } from "@/actions/auth";
import { SortirApresInactivite } from "@/components/admin/SortirApresInactivite";
import { SousNav } from "@/components/layout/SousNav";
import { Bouton } from "@/components/ui/Bouton";
import { Icone } from "@/components/ui/Icone";
import { LargeurEspaceAdmin } from "./LargeurEspaceAdmin";

/**
 * **Les écrans d'administration qui rangent un tableau, et que la colonne de lecture tronque.**
 *
 * Mesuré sur une fenêtre de 1 920 px, où 1 150 px de marge restaient vides : le journal d'audit
 * demande 1 081 px pour ses six colonnes et n'en reçoit que 692 — **389 px d'information cachés
 * derrière un défilement horizontal**, dans sa propre carte ; les sessions de connexion, 168 px.
 * Qui lit un journal pour savoir qui a fait quoi, et depuis quelle adresse, défile donc de côté
 * ligne par ligne. C'est exactement le cas que la doctrine du dépôt réserve à l'élargissement : «
 * un tableau s'élargit, une carte non » — le planning et la fiche d'une séance le font.
 *
 * **C'est la MISE EN PAGE qui élargit, jamais la page**, et c'est tout l'intérêt de cette liste. Le
 * bandeau « Connecté(e) en tant qu'administrateur » et la barre d'onglets vivent **ici**, donc dans la
 * colonne de lecture : une page qui s'élargirait seule les laisserait étroits au-dessus d'elle, soit
 * deux alignements sur le même écran. Ce défaut a été vécu trois fois en trois jours (`/seances` le
 * 30/09, l'accueil le 01/10, et cette page-ci le 02/10 au matin, 190 px de décalage mesurés sur un
 * écran de 3 440 px). Une page d'administration ne porte donc **aucune** largeur : elle est dans cette
 * liste, ou elle est dans la colonne de lecture.
 *
 * Les écrans de **formulaire** n'y entrent pas : un formulaire large n'est pas plus facile à remplir,
 * il est plus difficile à parcourir. Un écran qui demanderait à s'ajouter doit pouvoir dire **quel
 * tableau il range** — `tests/unit/bandes-pleine-largeur.test.ts` vérifie que chacun d'eux rend bien
 * un `Tableau`.
 */
/**
 * Administration technique (ADMIN uniquement, et **élévation en cours**).
 *
 * Cette sous-navigation ne contient que l'administration : pas de retour vers la gestion. On entre
 * ici par « Mon profil » et par là seulement, et on en sort par les onglets de l'en-tête, présents
 * sur tous les écrans. Mêler les deux ferait de l'organisation courante et des réglages techniques
 * un même lieu, ce qu'ils ne sont pas.
 *
 * **La ligne du haut dit où l'on est, et comment en sortir.** Être administrateur ici n'est pas un
 * état permanent mais une élévation : on l'a prise en redonnant mot de passe et code, elle tombe
 * d'elle-même dès qu'on quitte l'application (et au plus tard après 10 min sans rien faire ici,
 * l'écran repartant alors de lui-même vers l'accueil — voir `SortirApresInactivite`),
 * et ce bouton la rend tout de suite. Le dire ici, en
 * toutes lettres, évite la question qui se pose autrement — « suis-je encore admin sur ce
 * téléphone ? » — et à laquelle on ne peut répondre qu'en essayant.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // La page demandée est passée à la garde : c'est **ce layout** qui s'exécute en premier, donc lui
  // qui fabrique la redirection vers l'élévation. Sans elle, un administrateur qui ouvre un lien
  // direct vers une fiche, redonne mot de passe et code, atterrissait sur « Paramètres techniques/logs »
  // et devait refaire son chemin à la main.
  const chemin = await cheminCourant();
  const user = await requirePermission("settings.technical", chemin);
  return (
    /* **La largeur est lue par un composant client**, et pas ici : ce layout est partagé, App Router
       ne le re-rend pas d'une page sœur à l'autre, et la largeur restait donc figée sur celle de la
       page chargée en dur — un onglet cliqué donnait 736 px au journal d'audit, et 1 440 à un
       formulaire (voir `LargeurEspaceAdmin`, où le défaut est raconté et mesuré). La **décision**,
       elle, ne bouge pas d'un pouce : la liste et ses raisons restent juste au-dessus. */
    <LargeurEspaceAdmin>
      {/* Le minuteur ne vit que pendant l'élévation : sur `/admin/activer`, la seule page d'ici
          qu'on atteint sans elle, il n'y a rien à refermer et rien à quitter. */}
      {user.sessionForte && <SortirApresInactivite />}
      {/* `requirePermission` laisse passer **une** page sans élévation : le parcours de réglage
          `/admin/activer`, qui sert justement à l'obtenir. Y afficher « connecté en tant
          qu'administrateur » serait faux, et proposer d'en sortir n'aurait aucun sens — on n'y est
          pas encore entré. Le bandeau suit donc l'élévation, pas l'URL. */}
      {user.sessionForte && (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-marque/40 bg-marque/10 px-4 py-3">
        <p className="flex items-center gap-2 font-semibold text-texte">
          <Icone nom="bouclier" taille={20} className="text-marque" />
          Connecté(e) en tant qu&apos;administrateur
        </p>
        {/* Pas une déconnexion : on redescend au rang de membre, la session reste ouverte. Le mot
            « quitter » le dit mieux que « se déconnecter », qui ferait craindre de tout perdre. */}
        <form action={quitterEspaceAdmin}>
          <Bouton type="submit" variante="danger" taille="petite">
            <Icone nom="sortie" taille={18} />
            Quitter l&apos;espace admin
          </Bouton>
        </form>
      </div>
      )}
      {/* Même raison pour la sous-navigation : sans élévation, chacun de ces liens ne mènerait
          qu'à un renvoi vers le parcours de réglage. Une barre d'onglets dont aucun n'ouvre rien
          n'informe pas, elle fait douter. */}
      {user.sessionForte && (
        <SousNav
          sujets={[
            // Le trimestre en tête : c'est par lui que commence une saison, et c'est le seul de
            // ces écrans qui parle d'organisation plutôt que de technique.
            { href: "/admin/periodes", label: "Périodes" },
            { href: "/admin/membres", label: "Membres" },
            // Le registre d'un soir de cours : la séance, puis la réponse de chacun
            { href: "/admin/presences", label: "Présences" },
            // Les thèmes du planning : la liste déroulante des cases, décidée une fois pour tout le club
            { href: "/admin/themes", label: "Thèmes et lieux" },
            // Le club lui-même : son nom, son sigle, ses couleurs, son logo. Réglé une fois à
            // l'installation et revu rarement, mais c'est ce qui donne son visage à l'application.
            { href: "/admin/identite", label: "Club" },
            { href: "/admin/notifications", label: "Notifications" },
            { href: "/admin/comptes", label: "Comptes admin" },
            { href: "/admin/sessions", label: "Sessions" },
            // Le journal d'audit — qui a fait quoi — puis « À propos », qui dit ce que cette
            // installation est et ce qu'elle contient. Ce qui *part* (emails, salons, téléphone,
            // API publique) se règle dans Notifications, et nulle part ailleurs.
            { href: "/admin/audit", label: "Journal d'audit" },
            { href: "/admin/apropos", label: "À propos" },
          ]}
        />
      )}
      {children}
    </LargeurEspaceAdmin>
  );
}
