import { Fragment } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/current-user";
import { db } from "@/lib/db";
import { ROLE_LABELS, type Role } from "@/lib/constants";
import { can, canEditUser, estCompteDeService, peutNommerAdmin } from "@/lib/permissions";
import { creerMembre, definirActif, definirActifTous, definirEmailMembre, envoyerLienMembre } from "@/actions/membres";
import { periodeDuLien } from "@/lib/membres";
import { Carte } from "@/components/ui/Carte";
import { Pastille, PastillePersonne } from "@/components/ui/Pastille";
import { Champ } from "@/components/ui/Champ";
import { BoutonAction } from "@/components/ui/BoutonAction";
import { renvoyerTousLesLiens } from "@/actions/periodes";
import { Select } from "@/components/ui/Select";
import { FormulaireAction } from "@/components/ui/FormulaireAction";
import { Volet } from "@/components/ui/Volet";
import { LienBouton } from "@/components/ui/Bouton";
import { Icone } from "@/components/ui/Icone";
import { Cellule, Ligne, Tableau, type PalierTableau } from "@/components/ui/Tableau";
import { etatDuLien } from "./etat-lien";
import { libelleAfficher, libelleCompteur, LIBELLE_REPLIER, LIGNES_VISIBLES } from "@/components/seances/listes";
import { ImportCsv } from "./ImportCsv";
import { SelecteurRole } from "./SelecteurRole";
import { SelecteurBureau } from "./SelecteurBureau";
import { LIBELLE_BUREAU } from "./bureau";
import { CaseMembre, ZoneSelection } from "./SelectionRoles";

export const metadata: Metadata = { title: "Membres" };

/**
 * **Combien de comptes partent avec la page.**
 *
 * C'est la taille de page **déjà retenue pour les autres longues listes de l'espace admin** (journal
 * d'audit, sessions de connexion) : cinquante. Le plafond des listes *repliables*
 * (`LIGNES_VISIBLES`, vingt lignes) ne convient pas ici, et pour une raison de fond — là-bas,
 * déplier ne coûte rien, tout est déjà dans la page ; ici, la coupe est une vraie requête, et chaque
 * « voir la suite » est un aller-retour serveur. Couper à vingt ferait payer ce trajet à **un club
 * de vingt-deux**, qui n'a aucun problème de longueur : deux de ses membres disparaîtraient derrière
 * un chargement.
 *
 * Cinquante laisse donc un club ordinaire intact — aucune différence, c'est la règle — et empêche
 * malgré tout l'annuaire d'un grand club de partir entier, avec les périodes et les liens de chaque
 * compte. Au-delà, on ne parcourt plus l'annuaire : on y cherche quelqu'un, et `?q=` est là pour ça.
 */
const PAR_PAGE = 50;

/**
 * **À partir de quelle largeur l'annuaire se déplie en vrai tableau : 1 024 px**.
 *
 * Le `Tableau` du dépôt bascule par défaut à 768 px, et c'est le bon seuil pour ses cinq autres
 * écrans — leurs pages restent dans la colonne de lecture, un tableau de 520 px y tient. **Ici non.**
 * Cet écran est déclaré large (`ECRANS_LARGES`, `admin/layout.tsx`), et la constante
 * d'élargissement de l'espace admin (`src/components/ui/pleine-largeur.ts`) ne s'applique qu'**à
 * partir de 1 024 px** : entre 768 et 1 023 px, la page vaut encore 48 rem, soit 736 px pour
 * cinq colonnes dont **deux portent des adresses email**. Mesurée, une adresse du club en fait 280 —
 * deux d'entre elles et il ne reste rien pour le nom, l'état du lien et le bouton.
 *
 * Le tableau attend donc **le pixel exact où la page s'élargit** : en dessous, la pile de fiches de
 * `Tableau` montre tout sans rien serrer (c'est l'écran d'aujourd'hui, à la ligne près) ; au-dessus,
 * la page fait au moins 976 px et les cinq colonnes respirent. Deux seuils qui se suivent au lieu de
 * se croiser : c'est ce qui évite la tablette où une colonne de lecture porte un tableau trop large,
 * défaut que le dépôt a déjà payé (« `lg:` mesure la FENÊTRE, pas le conteneur », `CLAUDE.md`).
 */
const PALIER_TABLEAU: PalierTableau = "lg";

/**
 * **La lettre de rangement d'une personne**, accents retirés : « Élodie » se range à E, entre
 * « Eliot » et « Emma », et non dans un ailleurs typographique où personne ne la cherche.
 */
function initiale(personne: { prenom: string; nom: string }): string {
  const texte = (personne.prenom || personne.nom).normalize("NFD").replace(/\p{Diacritic}/gu, "");
  return (texte.charAt(0) || "?").toUpperCase();
}

type Props = { searchParams: Promise<{ q?: string; inactifs?: string; tout?: string }> };

export default async function PageMembres({ searchParams }: Props) {
  const acteur = await requirePermission("members.view");
  const { q = "", inactifs, tout } = await searchParams;
  /*
   * **Ces tests ne discriminent plus personne aujourd'hui.** L'écran a déménagé sous `/admin` : il
   * est gardé par `members.view`, réservée au seul ADMIN et exigeant en plus une session forte.
   * Quiconque lit cette page a donc déjà tous les droits testés ci-dessous — ils sont vrais à coup
   * sûr.
   *
   * On les garde quand même : `members.view` est volontairement **distincte** des gestes d'écriture
   * (voir `src/lib/permissions.ts`), précisément pour qu'on puisse rouvrir la consultation de
   * l'annuaire à l'encadrement sans rouvrir les gestes. Le jour où cette ligne bougera, l'écran
   * saura déjà quoi cacher ; les effacer reviendrait à refaire ce travail sous la pression.
   */
  /*
   * **Renommé** : la variable s'appelait `estAdmin`, et ce mot est devenu le nom d'une colonne de
   * la base (`User.estAdmin`, « du bureau, en supplément »). Deux sens pour un mot sur le même
   * écran, dont l'un parle de l'acteur et l'autre de chaque ligne, est exactement le genre de
   * confusion qui fait écrire la mauvaise garde. Ici il s'agit de **ce que l'acteur a le droit de
   * faire** : la désactivation de tout le club est réservée au bureau (et épargne le portail et
   * l'acteur lui-même : même filtre qu'en base).
   */
  const peutGererLesAdmins = can(acteur, "admins.manage");
  const perimetreMasse = { service: false, id: { not: acteur.id } };
  const filtre = {
    // Le compte de connexion du portail n'est pas une personne du club : il vit dans Administration → Comptes
    service: false,
    ...(inactifs ? {} : { actif: true }),
    ...(q ? { OR: [{ prenom: { contains: q } }, { nom: { contains: q } }, { email: { contains: q } }] } : {}),
  };
  /*
   * **La coupe se fait en base, pas à l'affichage.** L'annuaire d'un club de quatre-vingts partait
   * entier à chaque ouverture — avec, pour chaque compte, ses périodes, puis deux agrégats sur les
   * liens : replier n'y aurait rien changé, un `<details>` fermé garde tout son contenu dans la
   * page. Cinquante comptes suffisent à voir qu'on est au bon endroit ; au-delà, on cherche quelqu'un, et
   * la recherche `?q=` est déjà là pour ça.
   *
   * « Afficher les N autres comptes » est un **lien**, pas un bouton : l'écran reste un composant
   * serveur, et le retour du navigateur ramène la liste courte.
   *
   * **Ce n'est donc pas le dévoilement par tranches des autres listes**, et ce lien n'en prend pas
   * les mots (« les 20 suivantes ») : là-bas, les lignes cachées sont déjà dans la page et l'appui
   * n'est qu'un geste d'affichage ; ici, chaque appui est une requête. Un « suivantes » qui déclenche
   * un aller-retour serveur mentirait sur ce qu'il coûte. Ce que l'annuaire emprunte, en revanche,
   * c'est **le compteur** (`libelleCompteur`, « 50 sur 80 ») : « où j'en suis dans cette liste » doit
   * se lire de la même façon partout, que la suite vienne du navigateur ou du serveur.
   *
   * **Le classement est celui de la ligne affichée : « Prénom Nom ».** Trié par nom de famille, un
   * annuaire de quatre-vingts lignes n'a plus aucune progression visible dans sa colonne de gauche —
   * il a l'air non trié, et on ne peut plus sauter à une lettre. C'est aussi le classement des
   * listes de séance (`/admin/periodes/[id]`) : deux ordres selon l'écran, c'est chercher quelqu'un
   * au mauvais endroit.
   */
  const [membres, total, periodesOuvertes, aDesactiver, aReactiver] = await Promise.all([
    db.user.findMany({
      where: filtre,
      orderBy: [{ prenom: "asc" }, { nom: "asc" }],
      ...(tout ? {} : { take: PAR_PAGE }),
      include: {
        periodes: { include: { period: { select: { nom: true, statut: true } } } },
        /*
         * **Ce qu'une suppression détruit, compté dès le rendu de la liste.** La confirmation d'une
         * suppression en masse doit annoncer les réponses de présence perdues **personne par
         * personne** (`CLAUDE.md` : « la confirmation annonce ce qui sera écrasé ») ; elle se joue
         * dans le navigateur, avant le premier appel au serveur, et ne peut donc compter que ce que
         * la page lui a donné. Un agrégat par ligne affichée (cinquante au plus, voir `PAR_PAGE`),
         * pas une lecture des réponses elles-mêmes.
         */
        _count: { select: { attendances: true } },
      },
    }),
    db.user.count({ where: filtre }),
    db.period.findMany({ where: { statut: { not: "CLOSE" } }, orderBy: { dateDebut: "desc" }, select: { id: true, nom: true, statut: true } }),
    peutGererLesAdmins ? db.user.count({ where: { ...perimetreMasse, actif: true } }) : Promise.resolve(0),
    peutGererLesAdmins ? db.user.count({ where: { ...perimetreMasse, actif: false } }) : Promise.resolve(0),
  ]);
  // Le lien de l'écran, tel qu'on doit y revenir après une action : la recherche, les inactifs et
  // l'étendue de la liste sont tous dans l'URL, et aucun ne doit se perdre en chemin.
  const lien = (voirTout: boolean) => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (inactifs) p.set("inactifs", "1");
    if (voirTout) p.set("tout", "1");
    const suite = p.toString();
    return `/admin/membres${suite ? `?${suite}` : ""}`;
  };
  const restants = total - membres.length;
  const retour = lien(Boolean(tout));
  const periodeLien = periodeDuLien(periodesOuvertes);
  /*
   * État des liens personnels (libellé du bouton d'envoi, colonne « État du lien ») : trois agrégats
   * sur les seuls membres affichés, au lieu de rapatrier tous les liens de tout le monde.
   *
   * **`expiresAt` fait partie de la question, et son absence a fait mentir la colonne** : l'agrégat
   * ne filtrait que la révocation, si bien qu'un lien échu depuis cinq mois comptait comme « en
   * cours ». L'annuaire affichait donc « Lien en cours » — en gris, parmi les gens qui vont bien —
   * pour quelqu'un que `checkInvitation` refuse (`raison: "expiree"`), c'est-à-dire exactement
   * quelqu'un qui n'arrive pas à entrer. Le défaut dormait depuis longtemps, où il ne décidait que
   * du verbe d'un bouton (« Renvoyer » plutôt que « Envoyer ») ; la colonne en a fait une
   * **affirmation**. Les liens vivant quatre mois, le cas tombe à chaque charnière de trimestre.
   *
   * **Le troisième agrégat distingue « aucun lien » de « lien jamais ouvert »** : deux situations qui
   * demandent deux gestes opposés — cliquer sur « Envoyer », ou appeler la personne.
   */
  const idsAffiches = membres.map((m) => m.id);
  const maintenant = new Date();
  const [dejaOuverts, liensEnCours, liensDeLaPeriode] = await Promise.all([
    db.invitation.groupBy({ by: ["userId"], where: { userId: { in: idsAffiches }, usedAt: { not: null } } }),
    periodeLien
      ? db.invitation.groupBy({
          by: ["userId"],
          where: { userId: { in: idsAffiches }, periodId: periodeLien.id, revokedAt: null, expiresAt: { gt: maintenant } },
        })
      : Promise.resolve([] as Array<{ userId: string }>),
    periodeLien
      ? db.invitation.groupBy({ by: ["userId"], where: { userId: { in: idsAffiches }, periodId: periodeLien.id } })
      : Promise.resolve([] as Array<{ userId: string }>),
  ]);
  const aDejaOuvertUnLien = new Set(dejaOuverts.map((g) => g.userId));
  const aUnLienEnCours = new Set(liensEnCours.map((g) => g.userId));
  const aRecuUnLien = new Set(liensDeLaPeriode.map((g) => g.userId));
  // Les trois tests qui suivent sont ceux du rappel en tête de fonction : toujours vrais ici, gardés
  // pour le jour où `members.view` se rouvrira à l'encadrement.
  // Couper l'accès de quelqu'un est une décision du bureau : les instructeurs ne verraient pas ces boutons
  const peutActiver = can(acteur, "members.activate");
  // Ouvrir un compte (formulaire ou import CSV) est réservé au bureau : inutile d'afficher un formulaire qui sera refusé
  const peutCreer = can(acteur, "members.create");
  // Le lien personnel **de quelqu'un d'autre** appartient au bureau : un instructeur consulterait
  // l'annuaire, il ne régénère plus les accès. Afficher les boutons quand même donnerait une liste
  // de gestes qui échouent tous — pire qu'une liste sans boutons.
  const peutEnvoyerLien = can(acteur, "invitations.manage");
  // Effacer un compte est le geste le plus définitif de l'annuaire : sa permission est distincte de
  // la désactivation, et la barre de masse n'en propose le bouton que si elle est accordée.
  const peutSupprimer = can(acteur, "members.delete");
  /**
   * **Les repères alphabétiques n'existent qu'au-delà du seuil partagé** (`LIGNES_VISIBLES`, 20) —
   * comme le repli, la recherche et le tri partout ailleurs. Un club de douze retrouve donc sa liste
   * telle qu'elle était, sans lettre de rangement : à douze noms on ne saute pas à une lettre, on
   * lit.
   *
   * **La sélection multiple, elle, n'a pas de seuil** — le même choix que la correction des
   * présences en masse, et pour la même raison : un seuil ferait apparaître une mécanique **le jour
   * où le club franchit vingt comptes**, une fois, sans prévenir. Elle ne coûte qu'une case par
   * ligne, et sa barre d'action reste invisible tant que rien n'est coché. Voir
   * `SelectionRoles.tsx`.
   */
  const listeLongue = membres.length > LIGNES_VISIBLES;
  /**
   * **Ce que la sélection peut atteindre : les comptes affichés que la ligne sait traiter.** Le reste
   * (le portail, soi-même, un compte du bureau qu'on ne peut pas modifier) n'a pas de case du tout —
   * plutôt qu'une case qui échouerait à l'usage —, et l'écran dit pourquoi (`texteSansCase`).
   *
   * **Le test `m.role !== "ADMIN"` a disparu, et pour deux raisons qui se cumulent** :
   *
   * 1. il ne lève **plus jamais** — `role` ne vaut plus `"ADMIN"` depuis la migration
   *    `role_de_base_et_admin_en_supplement` : la garde était devenue muette, et une garde muette qui
   *    refuse tout ou rien sans le dire est pire que pas de garde ;
   * 2. ce qu'elle protégeait n'existe plus. Un administrateur n'avait pas de case parce que changer
   *    son rôle l'aurait **rétrogradé en silence**, les trois rôles étant exclusifs. Le bureau est
   *    maintenant un supplément : les cinq gestes de masse n'écrivent jamais `estAdmin` (voir
   *    `actions.ts`), ils ne lui retirent donc rien. Il retrouve sa case, et la confirmation d'une
   *    désactivation ou d'une suppression le **nomme** (`phraseBureau`).
   *
   * **La frontière du bureau, elle, reste tenue — par `canEditUser`**, qui lit `estAdmin` et refuse
   * une cible du bureau à qui n'a pas `admins.manage`. C'est elle qui vaudra le jour où `members.view`
   * se rouvrira à l'encadrement, et le serveur pose exactement la même question.
   */
  const reglable = (m: (typeof membres)[number]) => canEditUser(acteur, m) && acteur.id !== m.id && !estCompteDeService(m);
  /**
   * **Le rôle de base se règle aussi sur sa propre ligne**. Le refus datait du temps où un rôle
   * donnait des droits ; le bureau étant devenu un supplément, le rôle de base n'ouvre plus rien —
   * et seul un administrateur peut le changer, donc quelqu'un qui a déjà tout.
   *
   * **La case à cocher, elle, reste refusée sur sa propre ligne** (`reglable` ci-dessus) : le lot
   * porte aussi la désactivation et la suppression, et celles-là enferment dehors. Deux questions
   * différentes, donc deux fonctions — les confondre, c'était offrir une case qui promettait un
   * geste que le serveur refuse.
   */
  const roleReglable = (m: (typeof membres)[number]) => canEditUser(acteur, m) && !estCompteDeService(m);
  // `actif` et le nombre de réponses partent avec la ligne : ce sont les deux chiffres dont la
  // confirmation a besoin — ce qui change vraiment, et ce qu'une suppression détruit. `aUnEmail` dit
  // qui peut recevoir son lien, et `estAdmin` de qui le lot coupe les droits du club : **des booléens,
  // jamais l'adresse** — quatre-vingts adresses n'ont rien à faire dans le paquet envoyé au navigateur
  // pour afficher une barre d'action.
  const selectionnables = membres.filter(reglable).map((m) => ({
    id: m.id,
    nom: `${m.prenom} ${m.nom}`,
    role: m.role,
    actif: m.actif,
    reponses: m._count.attendances,
    aUnEmail: Boolean(m.email),
    estAdmin: m.estAdmin,
  }));
  /**
   * **Les lignes affichées sans case, par nature** — parce qu'une case absente sans explication se lit
   * comme un bogue (voir `texteSansCase`).
   *
   * `soiMeme` est le cas courant et le seul qui se voie aujourd'hui : on n'agit jamais sur son propre
   * compte en masse. `bureau` compte les comptes du bureau que l'acteur ne peut pas modifier — zéro
   * tant que l'annuaire est réservé au bureau, et c'est précisément pourquoi il se calcule ici plutôt
   * que de se supposer : le jour où `members.view` se rouvrira à l'encadrement, la phrase sera déjà
   * juste.
   */
  const sansCase = {
    soiMeme: membres.some((m) => m.id === acteur.id),
    bureau: membres.filter((m) => m.estAdmin && !reglable(m) && m.id !== acteur.id).length,
  };
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-3xl">Membres</h1>
        {/* Le total, pas le nombre de lignes affichées : c'est la réponse à « combien sommes-nous ? » */}
        <p className="text-texte-secondaire">
          {total} compte{total > 1 ? "s" : ""} {inactifs ? "(actifs et inactifs)" : "actifs"}
        </p>
      </div>

      {/*
        **La recherche vient en premier, juste sous le titre.** Elle tombait auparavant sous le bloc
        des gestes de masse : sur téléphone, le seul outil utilisable dans une liste de quatre-vingts
        comptes demandait de faire défiler pour être atteint, et il arrivait pile sous la barre
        d'onglets. Ce qui servait rarement (désactiver tout le club) est descendu en pied d'écran.
      */}
      <Carte>
        <form className="flex flex-wrap items-end gap-3" method="get">
          <div className="min-w-56 flex-1">
            <Champ label="Rechercher" name="q" type="search" defaultValue={q} placeholder="Nom, prénom ou email" />
          </div>
          {inactifs && <input type="hidden" name="inactifs" value="1" />}
          <button type="submit" className="min-h-13 rounded-xl border-2 border-bordure bg-surface px-5 font-semibold">
            Filtrer
          </button>
          <Link href={inactifs ? "/admin/membres" : "/admin/membres?inactifs=1"} className="min-h-13 self-center text-sm">
            {inactifs ? "Masquer les inactifs" : "Afficher les inactifs"}
          </Link>
        </form>

        <ZoneSelection
          selectionnables={selectionnables}
          sansCase={sansCase}
          restants={restants}
          recherche={Boolean(q)}
          active={can(acteur, "members.manage")}
          peutActiver={peutActiver}
          peutSupprimer={peutSupprimer}
          /* Exactement les conditions du bouton « Renvoyer le lien » d'une ligne : la permission du
             bureau et une période vers laquelle envoyer. Sans les deux, pas de bouton — il échouerait. */
          peutRenvoyerLien={peutEnvoyerLien && periodeLien !== null}
          periodeLienId={periodeLien?.id ?? null}
        >
          {/*
            **Douze personnes prenaient 2 565 px de haut** : chacune
            occupait deux lignes — son nom avec ses pastilles, puis son adresse en dessous — et son
            bouton « Gérer » se retrouvait seul à 1 000 px du nom qu'il concerne. En tableau, les douze
            lignes tiennent sur un écran, et surtout **l'état du lien devient une colonne** : qui n'est
            jamais entré se repère en balayant une colonne, au lieu d'ouvrir douze volets l'un après
            l'autre.

            **Une seule mise en page, deux affichages** — c'est le `Tableau` du dépôt, donc le **même
            arbre** : une fiche par personne sur téléphone, chaque valeur précédée de son intitulé, et
            un vrai tableau à partir de `PALIER_TABLEAU`. Rien n'est dupliqué puis caché en CSS, et sur
            390 px l'écran garde ce qu'il était : une personne par fiche, rien de tronqué, aucun
            défilement horizontal.
          */}
          <div className="mt-4">
            <Tableau
              palier={PALIER_TABLEAU}
              entetes={[
                // La colonne des cases n'a pas d'intitulé à montrer — la case maîtresse, au-dessus,
                // nomme déjà ce qu'elle emporte. Mais un lecteur d'écran annonce les colonnes : elle
                // porte donc son nom, invisible.
                <span key="selection" className="sr-only">
                  Sélection
                </span>,
                "Nom",
                "Email",
                "État du lien",
                <span key="actions" className="sr-only">
                  Actions
                </span>,
              ]}
              vide={membres.length === 0 && <p className="p-4 text-texte-secondaire">Aucun membre trouvé.</p>}
            >
              {membres.map((m, rang) => {
                const jamaisOuvert = !aDejaOuvertUnLien.has(m.id);
                // Un lien encore valable existe-t-il pour la période active ? (détermine « Envoyer » ou « Renvoyer »)
                const lienEnCours = aUnLienEnCours.has(m.id);
                const aUnEmail = Boolean(m.email);
                // Envoyer un lien à un compte désactivé, au compte du portail ou à quelqu'un sans adresse
                // n'aurait aucun sens : pas de bouton d'envoi (on propose de saisir l'adresse à la place)
                const peutRecevoirLien = peutEnvoyerLien && periodeLien !== null && m.actif && !estCompteDeService(m) && aUnEmail;
                const peutModifierEmail = canEditUser(acteur, m) && !estCompteDeService(m);
                const peutChangerActivation = peutActiver && canEditUser(acteur, m) && acteur.id !== m.id;
                // Le rôle de base se règle ici, y compris sur sa propre ligne (voir `roleReglable`) ;
                // seul le compte du portail en est exclu. La **case à cocher**, elle, suit `reglable`,
                // qui refuse en plus son propre compte : les gestes de masse portent exactement sur les
                // comptes que la ligne sait traiter, sinon une case promettrait un geste refusé.
                const peutChangerRole = roleReglable(m);
                /*
                 * **Nommer ou retirer un administrateur depuis l'annuaire**. Les verrous ne bougent
                 * pas d'un cran : ce sont ceux de l'écran « Comptes admin » — `admins.manage`
                 * (`peutNommerAdmin`), le compte du portail intouchable, et personne ne se retire
                 * son propre bureau. Le bouton n'est rendu qu'à qui peut aboutir : « un bouton qui
                 * ne peut que refuser est pire que pas de bouton » (`CLAUDE.md`). Le code 2FA, lui,
                 * est redemandé par l'action, comme partout ailleurs.
                 */
                const peutDonnerLeBureau = peutNommerAdmin(acteur) && canEditUser(acteur, m) && acteur.id !== m.id && !estCompteDeService(m);
                const aDesGestes = peutRecevoirLien || peutChangerActivation || peutModifierEmail || peutChangerRole || peutDonnerLeBureau;
                const periodesEnCours = m.periodes.filter((p) => p.period.statut !== "CLOSE");
                /**
                 * **L'état du lien personnel, qui devient une colonne**. Les cinq booléens sont
                 * ceux que la ligne connaît déjà — deux agrégats sur les seules lignes affichées,
                 * et le mot de passe qui dit si « jamais ouvert » est un problème. La règle vit
                 * dans `etat-lien.ts`, hors du JSX : la colonne et son infobulle disent la même
                 * chose que le bouton d'envoi de la même ligne, et ça se teste.
                 */
                const etatLien = etatDuLien({
                  actif: m.actif,
                  aUnEmail,
                  aUnMotDePasse: Boolean(m.passwordHash),
                  dejaOuvert: !jamaisOuvert,
                  lienEnCours,
                  lienEnvoye: aRecuUnLien.has(m.id),
                  periodeDeLien: periodeLien !== null,
                });
                // Une lettre de rangement quand elle change : c'est ce qui permet de sauter à « M »
                // dans une liste de cinquante lignes sans la lire en entier.
                const lettre = listeLongue && (rang === 0 || initiale(membres[rang - 1]) !== initiale(m)) ? initiale(m) : null;
                return (
                  <Fragment key={m.id}>
                    {lettre && (
                      <Ligne palier={PALIER_TABLEAU} className="bg-surface-douce">
                        <Cellule palier={PALIER_TABLEAU} colSpan={5} className="px-4 py-1 text-sm font-bold tracking-wide text-texte-secondaire">
                          {/* Repère visuel seulement : les noms qui suivent se lisent déjà à voix
                              haute, une lettre isolée n'apprendrait rien à un lecteur d'écran. */}
                          <span aria-hidden>{lettre}</span>
                        </Cellule>
                      </Ligne>
                    )}
                    {/*
                      **Une ligne, deux niveaux : ce qu'on lit, puis ce qu'on déplie.** Chaque personne
                      était un pavé d'environ 250 px — nom, rôle, « Modifier l'email », « Renvoyer le
                      lien », « Désactiver », l'adresse et les périodes — soit près de 16 000 px de
                      défilement sur téléphone avant le bouton « Afficher les autres ». Ne reste sur la
                      ligne que ce qu'on vient y lire : le nom, ce qui cloche (désactivé), l'adresse,
                      **l'état du lien** et le volet des gestes.
                    */}
                    {/* **La fiche de téléphone est une grille de trois lignes, le tableau garde ses
                        cinq colonnes — et c'est le même arbre**.

                        `Tableau` empile ses cellules en mode fiche : cinq cellules, donc cinq
                        lignes, et la fiche d'une personne passait de 88 à 180 px (mesuré : la page
                        de 390 px gagnait 1 092 px, l'inverse de ce qu'on vient faire). Cette grille
                        remet chaque cellule **là où elle était** : la case et le nom sur la
                        première ligne avec « Gérer » au bout, l'adresse en dessous, et l'état du
                        lien — la seule information nouvelle — sur sa propre ligne. Trois lignes,
                        aucune cellule dupliquée, aucun affichage masqué.

                        `grid` et `block` règlent tous deux `display` : c'est `grid` qui gagne
                        (Tailwind émet les classes dans cet ordre), et `lg:table-row` gagne sur les
                        deux, étant dans une requête de média. À partir de 1 024 px, les propriétés
                        de grille des cellules ne veulent plus rien dire pour un `table-cell` : rien
                        à défaire.

                        **Deux réglages posés sur la ligne, et non sur ses cinq cellules** — une
                        décision de densité se lit d'un endroit. Ils passent par `[&>td]:…` parce
                        que **deux utilitaires de la même propriété ne se départagent pas par
                        l'ordre dans l'attribut `class`** mais par l'ordre dans la feuille engendrée
                        : un `px-0` passé en `className` à une cellule qui porte déjà `px-3` **ne
                        gagne pas** (mesuré : la colonne de la case faisait 72 px au lieu de 48, et
                        le nom s'en trouvait replié sur deux lignes à 390 px). Un sélecteur
                        d'enfant, lui, est plus spécifique et tranche à coup sûr.

                        - **`[&>td]:px-0 lg:[&>td]:px-3`** : en mode fiche, l'écart entre colonnes
                        est donné par la grille (`gap-x-2`), pas par le rembourrage des cellules.
                        Les 24 px que chaque cellule ajoutait de son côté étaient pris sur la
                        largeur du nom — le seul endroit de la fiche où il n'y a pas de place à
                        perdre ; - **`lg:[&>td]:py-1`** : les cellules de `Tableau` portent 10 px de
                        haut et de bas, ce qui convient à un tableau de texte. Ici chaque ligne
                        porte déjà **deux cibles tactiles de 48 px** (la case, le nom), qui donnent
                        à elles seules sa hauteur : ces 10 px s'ajoutaient à du blanc déjà payé — 68
                        px par personne au lieu de 56, soit 144 px de défilement pour douze
                        personnes, et c'est exactement le reproche de Delta (« 227 px par personne,
                        dont la moitié de blanc »).

                        **L'adresse et l'état du lien prennent les trois colonnes** en mode fiche,
                        comme l'adresse le faisait hier (`basis-full`, au bord gauche de la fiche) :
                        rangés sous le seul nom, ils perdaient 76 px au profit de la colonne du
                        bouton, et l'adresse revenait à la ligne — une information de plus affichée
                        sur deux lignes au lieu d'une. */}
                    <Ligne
                      palier={PALIER_TABLEAU}
                      className={`grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 [&>td]:px-0 lg:[&>td]:px-3 lg:[&>td]:py-1 ${
                        m.actif ? "" : "text-texte-secondaire"
                      }`}
                    >
                      {/* Première case de la grille, et première colonne du tableau : le carré de
                          48 px reste collé au nom qu'il désigne, sur téléphone comme sur PC. */}
                      <Cellule palier={PALIER_TABLEAU} className="col-start-1 row-start-1">
                        {/* `reglable` et non `roleReglable` : le lot porte aussi la désactivation et la
                            suppression, et celles-là enferment dehors — on n'agit pas sur son propre
                            compte. Le commentaire de `roleReglable` l'annonçait depuis le 01/10, le
                            code rendait la case (relecture adverse du 02/10). Inatteignable
                            aujourd'hui — seul le compte du portail peut s'élever, et il est hors de
                            l'annuaire —, mais le jour où un second administrateur se donne un mot de
                            passe, sa propre ligne recevait une case que `lotCoche` filtre ensuite :
                            le lot partait **silencieusement raccourci**. */}
                        {reglable(m) && <CaseMembre id={m.id} nom={`${m.prenom} ${m.nom}`} />}
                      </Cellule>
                      <Cellule palier={PALIER_TABLEAU} className="col-start-2 row-start-1 font-semibold">
                        {/* Le nom et ses pastilles sur une même ligne, qui se replie si besoin : ce
                            sont deux lectures d'une seule chose (« qui », et « à quel titre »). */}
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <Link href={`/admin/membres/${m.id}`} className="inline-flex min-h-12 min-w-0 items-center gap-2">
                            <PastillePersonne id={m.id} couleur={m.couleur} />
                            {/* **Plus de coupe par trois points** : le nom a sa colonne maintenant, et
                                un nom coupé est une information perdue (`CLAUDE.md`). Il revient à la
                                ligne s'il le faut. */}
                            <span>
                              {m.prenom} {m.nom}
                            </span>
                          </Link>
                          {/*
                            **Deux pastilles plutôt qu'une**. Il n'y en avait qu'une, et elle
                            ne pouvait pas dire ce que le nouveau modèle rend possible : une personne est
                            **instructeur ET du bureau** — le cas le plus courant dans une petite
                            association, et toute la raison du changement. L'ancienne écriture
                            (`m.role === "ADMIN" ? … : …`) aurait d'ailleurs cessé de dire quoi que ce soit
                            du bureau : `role` ne vaut plus jamais `"ADMIN"`, un administrateur se serait
                            donc affiché « Membre », sans un mot de ses droits.

                            L'ordre suit celui des deux questions : le rôle de base d'abord (ce que la
                            personne fait au club), le bureau ensuite (ce qu'elle administre). Le bureau
                            garde le bleu de la charte — c'est le droit le plus large —, le rôle garde son
                            ocre, et un membre sans rien n'a aucune pastille : la ligne reste lisible.
                          */}
                          {m.role !== "MEMBRE" && <Pastille ton="ocre">{ROLE_LABELS[m.role as Role]}</Pastille>}
                          {m.estAdmin && <Pastille ton="primaire">{LIBELLE_BUREAU}</Pastille>}
                          {!m.actif && <Pastille ton="rouge">désactivé</Pastille>}
                          {/* **La pastille du lien n'est plus ici** : elle est devenue la colonne
                              « État du lien », avec les trois autres états que seul le volet
                              disait. Une même information à deux endroits finit par en dire deux
                              choses différentes. */}
                        </span>
                      </Cellule>
                      {/*
                        **L'intitulé est là, mais il ne prend pas de place.** En mode fiche, `Tableau`
                        écrit l'intitulé devant la valeur (`label`) : « Email » et « État du lien »
                        pousseraient l'adresse à la ligne sur 390 px, et cette fiche n'en portait pas
                        hier. Ils sont donc posés **dans** la valeur, en `sr-only` : un lecteur d'écran
                        n'a pas l'en-tête de colonne sous les yeux, lui, et l'écran reste celui
                        d'avant. `lg:hidden` les retire dès que l'en-tête du tableau existe — sans quoi
                        la cellule serait annoncée deux fois.

                        Et ils sont dans la valeur plutôt que dans `label` pour une seconde raison : une
                        cellule de `Tableau` est un `flex justify-between`, donc **un seul enfant se
                        range à gauche** quand deux se repoussent aux deux bords. C'est ce qui garde
                        l'adresse et la pastille alignées sur le nom, comme hier.
                      */}
                      <Cellule palier={PALIER_TABLEAU} className="col-span-3 col-start-1 row-start-2 text-sm text-texte-secondaire">
                        <span className="sr-only lg:hidden">Email : </span>
                        {/* `break-all` : une adresse coupée par trois points ne se recopie pas, et
                            c'est l'adresse qu'on vient vérifier ici. Elle revient à la ligne. */}
                        {m.email ? <span className="break-all">{m.email}</span> : "sans email"}
                      </Cellule>
                      {/*
                        **L'état du lien, en colonne** (« l'état du lien devient une
                        colonne, donc comparable d'un coup d'œil »). Un seul des cinq états porte une
                        couleur — « Jamais ouvert » sans mot de passe —, parce que c'est celui qu'on
                        balaie la colonne pour trouver. L'infobulle porte la phrase entière : le mot
                        court tient dans la colonne, il ne dit pas tout (`etat-lien.ts`).
                      */}
                      <Cellule palier={PALIER_TABLEAU} title={etatLien.detail} className="col-span-3 col-start-1 row-start-3 text-sm lg:whitespace-nowrap">
                        <span className="sr-only lg:hidden">État du lien : </span>
                        <Pastille ton={etatLien.ton}>{etatLien.libelle}</Pastille>
                      </Cellule>
                      {/* « Gérer » retrouve le bout de la première ligne, là où le bureau l'a appris
                          (il y était en `ml-auto` avant le tableau), et la dernière colonne sur PC. */}
                      <Cellule palier={PALIER_TABLEAU} className="col-start-3 row-start-1">
                        {aDesGestes && (
                          <div className="flex lg:justify-end">
                            {/* Repli natif (<details>) : accessible au clavier, ouvrable sans script, et
                                un seul ouvert à la fois dans la liste (attribut `name`). */}
                            <Volet libelle="Gérer" libelleOuvert="Fermer" titre={`${m.prenom} ${m.nom}`} largeur="sm:w-80" groupe="membre">
                              <div className="flex flex-col gap-3">
                                <p className="text-sm text-texte-secondaire">
                                  {m.email ? <span className="break-all">{m.email}</span> : "Sans adresse email"}
                                  {periodesEnCours.length > 0 && <> · {periodesEnCours.map((p) => p.period.nom).join(", ")}</>}
                                  {/* **L'état du lien n'est plus répété ici** : il a sa colonne, et
                                      le volet s'ouvre depuis la ligne qui la porte. Sur téléphone,
                                      où le panneau couvre la ligne, l'adresse et les périodes
                                      restent — ce sont elles qui disparaissent derrière le rideau. */}
                                </p>
                                {/* **Deux listes déroulantes, deux questions**. Celle-ci porte le
                                    **rôle de base** — membre ↔ instructeur, en un geste, et elle
                                    enregistre au choix : son pire effet se défait du même geste.
                                    « Administrateur » n'y figure pas parce que ce n'est plus un
                                    rôle. */}
                                {peutChangerRole && <SelecteurRole userId={m.id} role={m.role} nom={`${m.prenom} ${m.nom}`} />}
                                {/* Et celle-là porte le **bureau, en supplément** : `----------` ou
                                    « admin ». Elle n'enregistre **pas** au choix — elle demande une
                                    confirmation et un code 2FA récent, parce que le geste donne ou retire
                                    tous les droits du club. Voir `SelecteurBureau`. */}
                                {peutDonnerLeBureau && <SelecteurBureau userId={m.id} nom={`${m.prenom} ${m.nom}`} estAdmin={m.estAdmin} retour="/admin/membres" />}
                                {peutModifierEmail && (
                                  <FormulaireAction
                                    action={definirEmailMembre.bind(null, m.id, retour)}
                                    bouton={aUnEmail ? "Enregistrer l'email" : "Ajouter son email"}
                                    variante="secondaire"
                                    enCours="Enregistrement…"
                                  >
                                    <Champ
                                      label={`Email de ${m.prenom} ${m.nom}`}
                                      name="email"
                                      id={`email-${m.id}`}
                                      type="email"
                                      defaultValue={m.email ?? ""}
                                      autoComplete="off"
                                      placeholder="prenom@exemple.fr"
                                      aide="Sans adresse : aucun lien personnel, l'équipe coche sa présence à sa place."
                                    />
                                  </FormulaireAction>
                                )}
                                {peutRecevoirLien && periodeLien && (
                                  <BoutonAction
                                    action={envoyerLienMembre.bind(null, m.id, periodeLien.id, retour)}
                                    variante="secondaire"
                                    taille="petite"
                                    pleineLargeur
                                    enCours="Envoi…"
                                    confirmation={
                                      lienEnCours
                                        ? `Générer un nouveau lien pour ${m.prenom} ${m.nom} et le lui envoyer ? L'ancien cessera de fonctionner.`
                                        : undefined
                                    }
                                  >
                                    {lienEnCours ? "Renvoyer le lien" : "Envoyer le lien"}
                                  </BoutonAction>
                                )}
                                {peutChangerActivation &&
                                  (m.actif ? (
                                    <BoutonAction
                                      action={definirActif.bind(null, m.id, false, retour)}
                                      variante="secondaire"
                                      taille="petite"
                                      pleineLargeur
                                      confirmation={`Désactiver le compte de ${m.prenom} ${m.nom} ? Son lien personnel cessera de fonctionner et il ne recevra plus d'email.`}
                                    >
                                      Désactiver
                                    </BoutonAction>
                                  ) : (
                                    <BoutonAction action={definirActif.bind(null, m.id, true, retour)} variante="succes" taille="petite" pleineLargeur>
                                      Réactiver
                                    </BoutonAction>
                                  ))}
                                {peutModifierEmail && aUnEmail && (
                                  <FormulaireAction
                                    action={definirEmailMembre.bind(null, m.id, retour)}
                                    bouton="Retirer l'adresse"
                                    variante="danger"
                                    enCours="Retrait…"
                                    confirmation={`Retirer l'adresse de ${m.prenom} ${m.nom} ? Plus aucun lien personnel ne pourra lui être envoyé : l'équipe cochera sa présence à sa place.`}
                                  >
                                    <input type="hidden" name="email" value="" />
                                  </FormulaireAction>
                                )}
                                <LienBouton href={`/admin/membres/${m.id}`} variante="discret" taille="petite" pleineLargeur enCours>
                                  Ouvrir la fiche
                                </LienBouton>
                              </div>
                            </Volet>
                          </div>
                        )}
                      </Cellule>
                    </Ligne>
                  </Fragment>
                );
              })}
              {/* Pas de lien ni de compteur tant que tout tient : un club de douze voit sa liste
                  entière, comme avant. Au-delà, le compteur dit où l'on en est dans la même grammaire
                  que les listes dévoilées par tranches — mais sans `aria-live` : ici l'appui **change
                  de page**, et un lecteur d'écran annonce l'écran qui arrive. */}
              {total > PAR_PAGE && (
                <Ligne palier={PALIER_TABLEAU}>
                  <Cellule palier={PALIER_TABLEAU} colSpan={5} className="p-3">
                    {/* Le pied tient toute la largeur (`colSpan`) : ce n'est pas une personne, c'est
                        l'état de la liste. En mode fiche, c'est déjà le cas sans rien demander. */}
                    <span className="flex flex-wrap items-center gap-2">
                  {restants > 0 && (
                    <LienBouton href={lien(true)} variante="secondaire" taille="petite" className="min-h-12 flex-1 basis-48" enCours scroll={false}>
                      <Icone nom="chevronBas" />
                      {libelleAfficher(restants, "autres comptes")}
                    </LienBouton>
                  )}
                  {tout && (
                    <LienBouton href={lien(false)} variante="secondaire" taille="petite" className="min-h-12 flex-1 basis-32" enCours scroll={false}>
                      <Icone nom="chevronHaut" />
                      {LIBELLE_REPLIER}
                    </LienBouton>
                  )}
                  <p className="basis-full text-center text-sm tabular-nums text-texte-secondaire">{libelleCompteur(membres.length, total)}</p>
                    </span>
                  </Cellule>
                </Ligne>
              )}
            </Tableau>
          </div>
        </ZoneSelection>
      </Carte>

      {peutCreer && (
        <div className="grid gap-5 lg:grid-cols-2">
          {/* **« Ajouter un membre »**. Le bouton suit le titre — un formulaire qui s'appelle
              « Ajouter un membre » et dont le bouton dit « Ajouter la personne » fait douter qu'ils
              parlent de la même chose. Le mot « personne » n'est pas remplacé ailleurs pour autant
              : il garde son sens partout où il désigne un être humain par opposition à un compte
              (« Sélectionner les 7 personnes », « agir sur plusieurs personnes à la fois »). */}
          <Carte titre="Ajouter un membre" className="scroll-mt-20">
            <div id="ajouter" />
            <FormulaireAction action={creerMembre} bouton="Ajouter le membre" enCours="Ajout…">
              <div className="grid gap-4 sm:grid-cols-2">
                <Champ label="Prénom" name="prenom" required maxLength={60} autoComplete="off" />
                <Champ label="Nom" name="nom" required maxLength={60} autoComplete="off" />
              </div>
              <Champ
                label="Email (facultatif)"
                name="email"
                type="email"
                autoComplete="off"
                aide="Sans adresse, ce membre n'aura pas de lien personnel : l'équipe cochera sa présence pour lui."
              />
              <Select label="Rôle" name="role" defaultValue="MEMBRE">
                <option value="MEMBRE">Membre</option>
                <option value="INSTRUCTEUR">Instructeur</option>
                {/* Pas d'« Administrateur » ici : un compte d'administration se crée (ou se nomme
                    parmi les personnes déjà là) dans l'onglet « Comptes admin », avec ce qu'il faut
                    sous les yeux — qui les a, leur double authentification, le journal. */}
              </Select>
              <fieldset>
                <legend className="mb-1 font-semibold">Inscrire aux périodes</legend>
                {periodesOuvertes.length === 0 ? (
                  <p className="text-sm text-texte-secondaire">Aucune période ouverte : le lien partira à l&apos;activation d&apos;une période.</p>
                ) : (
                  periodesOuvertes.map((p) => (
                    <label key={p.id} className="flex min-h-11 cursor-pointer items-center gap-3">
                      <input key={`periode-${p.id}-${p.statut}`} type="checkbox" name="periodIds" value={p.id} defaultChecked={p.statut === "ACTIVE"} className="size-6 accent-primaire" />
                      {p.nom} <span className="text-sm text-texte-secondaire">{p.statut === "ACTIVE" ? "(active : lien envoyé tout de suite, si la personne a une adresse)" : "(brouillon)"}</span>
                    </label>
                  ))
                )}
              </fieldset>
            </FormulaireAction>
          </Carte>
          <Carte titre="Importer un fichier CSV">
            <ImportCsv periodes={periodesOuvertes} />
          </Carte>
        </div>
      )}

      {/*
        **Les gestes qui portent sur tout le club, en pied d'écran.** « Désactiver tous les comptes »
        trônait en rouge au-dessus de la liste, juste au-dessus du champ de recherche : un geste de
        fin de saison posé sur le chemin du geste quotidien, à un doigt d'écart. Il garde sa
        confirmation chiffrée ; il ne garde pas sa place.
      */}
      {(peutEnvoyerLien || peutGererLesAdmins) && (aDesactiver > 0 || aReactiver > 0 || periodesOuvertes.some((p) => p.statut === "ACTIVE")) && (
        <Carte titre="Gestes sur tout le club">
          <div className="flex flex-wrap items-center gap-2">
            {peutEnvoyerLien &&
              periodesOuvertes
                .filter((p) => p.statut === "ACTIVE")
                .map((p) => (
                  <BoutonAction
                    key={p.id}
                    action={renvoyerTousLesLiens.bind(null, p.id)}
                    variante="secondaire"
                    taille="petite"
                    enCours="Envoi…"
                    confirmation={`Renvoyer son lien à chaque membre de « ${p.nom} » ? Chaque lien est régénéré : les anciens cesseront de fonctionner.`}
                  >
                    Renvoyer les liens ({p.nom})
                  </BoutonAction>
                ))}
            {peutGererLesAdmins && aDesactiver > 0 && (
              <BoutonAction
                action={definirActifTous.bind(null, false, retour)}
                variante="danger"
                taille="petite"
                enCours="Désactivation…"
                confirmation={`Désactiver ${aDesactiver} compte${aDesactiver > 1 ? "s" : ""}, administrateurs compris ? Le vôtre et le compte de connexion du portail restent actifs. Chacun perdra l'accès immédiatement et son lien personnel cessera de fonctionner.`}
              >
                Désactiver tous les comptes
              </BoutonAction>
            )}
            {peutGererLesAdmins && aReactiver > 0 && (
              <BoutonAction
                action={definirActifTous.bind(null, true, retour)}
                variante="succes"
                taille="petite"
                enCours="Réactivation…"
                confirmation={`Réactiver ${aReactiver} compte${aReactiver > 1 ? "s" : ""} ? Chacun retrouvera l'accès et son lien personnel fonctionnera de nouveau.`}
              >
                Réactiver tous les comptes
              </BoutonAction>
            )}
          </div>
          {peutGererLesAdmins && (aDesactiver > 0 || aReactiver > 0) && (
            <p className="mt-2 max-w-prose text-sm text-texte-secondaire">
              Fin de saison ou incident : coupe l&apos;accès de tout le monde d&apos;un coup, puis le rend quand c&apos;est réglé. Ton compte et
              celui du portail restent actifs.
            </p>
          )}
        </Carte>
      )}
    </div>
  );
}
