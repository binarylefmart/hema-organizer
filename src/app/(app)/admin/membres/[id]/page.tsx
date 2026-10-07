import { Fragment } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/current-user";
import { db } from "@/lib/db";
import { ROLE_LABELS, type Role } from "@/lib/constants";
import { formatDateHeure } from "@/lib/dates";
import { dateDAdhesion, libelleNumeroSaison, libelleSaison, numeroDeSaison, saisonEnregistree, saisonsProposees } from "@/lib/blasons";
import { can, canEditUser, estCompteDeService, peutNommerAdmin } from "@/lib/permissions";
import { revoquerInvitation } from "@/actions/periodes";
import { lienARenouveler } from "@/lib/invitations";
import {
  definirActif,
  definirNotificationsMembre,
  envoyerInvitationMembre,
  envoyerLienMembre,
  modifierMembre,
  reinitialiserAccesMembre,
  supprimerMembre,
} from "@/actions/membres";
import { lignesNotificationsMembre } from "@/lib/notifications/membre";
import { aDejaUnAcces, periodeDuLien } from "@/lib/membres";
import { Carte } from "@/components/ui/Carte";
import { Case, Champ } from "@/components/ui/Champ";
import { ChampListe } from "@/components/ui/ChampListe";
import { FormulaireAction } from "@/components/ui/FormulaireAction";
import { BoutonAction } from "@/components/ui/BoutonAction";
import { GestesProposes, type GestePret } from "@/components/ui/GestesProposes";
import { Alerte } from "@/components/ui/Alerte";
import { Pastille } from "@/components/ui/Pastille";
import { LIBELLE_BUREAU } from "../bureau";
import { gestesFiche, type GesteFiche } from "../gestes-fiche";
import { Icone } from "@/components/ui/Icone";
import { etatDuLien } from "../etat-lien";
import { SelecteurRole } from "../SelecteurRole";
import { HorsTelephone, RubriquesVolet, type Rubrique } from "../RubriquesVolet";
// La liste groupée de « Mon profil », reprise telle quelle : la fiche d'une personne range ses cartes
// de la même façon au téléphone.
import { GroupeListe, LigneDepliable, ListeGroupee } from "@/components/ui/ListeGroupee";
import { AdresseEmail } from "@/components/ui/AdresseEmail";

export const metadata: Metadata = { title: "Membre" };

type Props = { params: Promise<{ id: string }> };

export default async function PageMembre({ params }: Props) {
  const acteur = await requirePermission("members.view");
  const { id } = await params;
  const m = await db.user.findUnique({
    where: { id },
    include: {
      periodes: { include: { period: true }, orderBy: { period: { dateDebut: "desc" } } },
      invitations: { where: { revokedAt: null }, orderBy: { createdAt: "desc" } },
      _count: { select: { attendances: true, ateliers: true, authSessions: true, invitations: { where: { usedAt: { not: null } } } } },
    },
  });
  if (!m) notFound();
  // Compte de connexion du portail : ce n'est pas une personne du club (ni lien personnel, ni présence)
  const portail = estCompteDeService(m);
  const modifiable = canEditUser(acteur, m);
  // L'adresse email est facultative : sans elle, aucun lien personnel ne peut partir (la présence est cochée par l'équipe)
  const aUnEmail = Boolean(m.email);
  const soiMeme = acteur.id === m.id;
  /*
   * **Les deux seuls cas où le rôle de base ne se règle pas ici** : le compte du portail et une fiche
   * qu'on n'a pas le droit de modifier. **Sa propre fiche, elle, laisse régler son rôle de base** —
   * il n'ouvre aucun droit, seul un administrateur peut le changer, et le serveur l'accepte
   * volontairement (`modifierMembre`). Elle commandait aussi un champ caché qui doublait la liste
   * grisée ; ce doublon est tombé avec `ChampListe`, qui poste sa valeur même désactivée.
   */
  const roleVerrouille = !modifiable || portail;
  /*
   * **Du bureau se lit sur `estAdmin`, plus sur le rôle**. La ligne disait `m.role === "ADMIN"`, et
   * `role` ne vaut plus jamais cette valeur depuis la migration
   * `role_de_base_et_admin_en_supplement` : le test était devenu muet. Il commandait le
   * verrouillage de la liste des rôles, l'entrée « Administrateur » qu'elle ajoutait et la couleur
   * de la pastille du titre — la fiche d'un administrateur aurait donc affiché « Membre », sans un
   * mot de ses droits, sous un sélecteur de rôle redevenu libre.
   */
  const duBureau = m.estAdmin;
  /*
   * **Les `can(acteur, …)` de cette fiche ne discriminent plus personne aujourd'hui.** L'écran a
   * déménagé sous `/admin` : `members.view` est réservée au seul ADMIN et exige en plus une session
   * forte, donc qui arrive ici a déjà tous les droits testés — désactiver, supprimer, régler les
   * notifications d'autrui, attribuer le rôle ADMIN.
   *
   * On les garde : `members.view` reste volontairement distincte des gestes d'écriture (voir
   * `src/lib/permissions.ts`) pour qu'on puisse rouvrir la **consultation** de l'annuaire à
   * l'encadrement sans rouvrir les gestes. Ce jour-là, la fiche saura déjà quoi masquer.
   */
  // Couper (ou rendre) l'accès de quelqu'un est une décision du bureau : bouton caché aux instructeurs
  const peutActiver = can(acteur, "members.activate");
  // Effacer la personne et tout son historique est irréversible : bouton caché aux instructeurs
  const peutSupprimer = can(acteur, "members.delete");
  // Remettre l'accès à zéro (mot de passe, 2FA, liens, appareils) : même droit que le reste de la
  // fiche. Le bouton n'a de sens que pour qui est **déjà entré** — c'est la garde même de l'action
  // (`aDejaUnAcces`, src/lib/membres.ts) : à quelqu'un qui ne l'est jamais, on envoie l'invitation.
  const aQuelqueChoseAEffacer = aDejaUnAcces({
    aOuvertUnLien: m._count.invitations > 0,
    aUnMotDePasse: Boolean(m.passwordHash),
    aLaDeuxFa: Boolean(m.totpActiveAt),
    aUneSession: m._count.authSessions > 0,
  });
  const peutReinitialiser = modifiable && !portail && aQuelqueChoseAEffacer;
  /*
   * **« Que veux-tu faire ? » : les gestes qui s'appliquent à cette personne, et à eux seuls.** Les
   * deux cartes de boutons du pied de fiche (« Remettre l'accès à zéro », « Compte ») deviennent une
   * seule question, sur la forme commune de l'administration (`GestesProposes`) : l'invitation à qui
   * n'est jamais entré, la remise à zéro à qui l'est, désactiver *ou* réactiver, supprimer — chacun
   * expliqué, un seul bouton, rouge pour ce qui révoque, réinitialise ou supprime, et **les
   * confirmations d'avant**.
   *
   * Les verrous sont ceux des boutons qu'ils remplacent (et des gardes serveur) : la remise à zéro
   * suit `peutReinitialiser`, le compte suit `modifiable && !soiMeme && !portail`, l'invitation suit
   * `invitations.manage` et la période active du club — celle d'où l'annuaire envoie la sienne.
   */
  const gereLeCompte = modifiable && !soiMeme && !portail;
  const periodeLien = periodeDuLien(await db.period.findMany({ where: { statut: "ACTIVE" }, select: { id: true, nom: true, statut: true }, orderBy: { dateDebut: "desc" } }));
  const actionsFiche: Partial<Record<GesteFiche, () => Promise<unknown>>> = {
    inviter: envoyerInvitationMembre.bind(null, m.id, periodeLien?.id ?? "", `/admin/membres/${m.id}`),
    reinitialiser: reinitialiserAccesMembre.bind(null, m.id),
    desactiver: definirActif.bind(null, m.id, false),
    reactiver: definirActif.bind(null, m.id, true),
    supprimer: supprimerMembre.bind(null, m.id),
  };
  const gestes: GestePret[] = gestesFiche(
    {
      prenom: m.prenom,
      nom: m.nom,
      actif: m.actif,
      aUnEmail,
      dejaEntre: aQuelqueChoseAEffacer,
      recoitInvitation: m.actif && aUnEmail && m.periodes.some((p) => p.period.statut === "ACTIVE"),
      estAdmin: m.estAdmin,
      reponses: m._count.attendances,
      aEffacer: [m.passwordHash && "le mot de passe", m.totpActiveAt && "la double authentification et les codes de secours", m.invitations.length > 0 && "les liens en cours"].filter(
        (x): x is string => Boolean(x),
      ),
      periodeLien,
    },
    {
      inviter: can(acteur, "invitations.manage") && modifiable && !portail,
      reinitialiser: peutReinitialiser,
      activer: peutActiver && gereLeCompte,
      supprimer: peutSupprimer && gereLeCompte,
    },
  ).flatMap((g) => {
    const action = actionsFiche[g.geste];
    return action ? [{ ...g, action }] : [];
  });
  /*
   * **Le bureau ne se donne ni ne se retire depuis la fiche** : c'est un geste de « Comptes admin »
   * et de nulle part ailleurs. La fiche montre l'état (pastille « admin ») et dit où le geste vit —
   * le lien seulement à qui peut ouvrir cette page (`peutNommerAdmin`, soit `admins.manage`).
   */
  const ouvreComptesAdmin = peutNommerAdmin(acteur);
  // Régler les notifications de quelqu'un d'autre est réservé au bureau : la carte n'existe pas pour
  // un instructeur. Le compte du portail, lui, ne reçoit que les alertes de sécurité : rien à régler.
  const peutReglerNotifications = can(acteur, "notifications.autrui") && !portail;
  // Les mêmes lignes que « Mes notifications » sur le profil de la personne : même ordre, mêmes
  // phrases, même état — c'est la fonction du profil qui les prépare (aucune logique recopiée ici).
  const notifications = peutReglerNotifications ? await lignesNotificationsMembre({ id: m.id }) : null;
  // « les choix d'Bravo », pas « de Bravo » : le prénom est écrit par le club, on lit la phrase à voix haute
  const dePrenom = /^[aeiouyàâäéèêëîïôöùûü]/i.test(m.prenom) ? `d'${m.prenom}` : `de ${m.prenom}`;
  // Une case par message sur cet écran (le réglage canal par canal est dans le profil de la
  // personne) : un message est « reçu » dès que l'un de ses canaux personnels lui parvient encore.
  const recoit = (l: { choix: { email: boolean; push: boolean } }) => l.choix.email || l.choix.push;
  const envoye = (l: { club: { email: boolean; push: boolean } }) => l.club.email || l.club.push;
  const refusables = notifications?.lignes.filter(envoye) ?? [];
  const coupeesParLeClub = notifications?.lignes.filter((l) => !envoye(l)) ?? [];
  /*
   * **« Au club depuis »** : le bureau choisit la **saison d'arrivée** (« 2024-2025 »), la base garde
   * son 1er septembre, et l'ancienneté grandit ensuite toute seule, d'une saison à chaque rentrée. Les
   * conversions vivent dans src/lib/blasons.ts, à côté du calcul du rang.
   *
   * La liste démarre sur « Je ne sais pas » tant que personne n'a rien choisi : une saison
   * présélectionnée ressemblerait à une réponse, alors que le club ne sait pas encore.
   */
  const saisonAuClub = saisonEnregistree(m.auClubDepuis);
  const saisons = saisonsProposees();
  // Ce que le rang lit aujourd'hui : la saison choisie si elle existe, celle de la création du
  // compte sinon. Écrit sous le champ pour voir tout de suite l'effet du choix.
  const adhesion = dateDAdhesion(m);
  const derniereInvitation = (periodId: string) => m.invitations.find((i) => i.periodId === periodId);
  /*
   * **L'état du lien, dans les mots de la colonne de l'annuaire** (`etat-lien.ts`) : la tête de fiche
   * au téléphone le montre sous l'adresse, et la ligne qu'on vient de toucher disait la même chose.
   * Mêmes entrées que la liste — la période du lien, un lien encore valable, un lien déjà envoyé
   * (révoqué compris : la liste compte de même), un lien déjà ouvert, un mot de passe.
   */
  const maintenant = new Date();
  const lienPeriode = periodeLien ? derniereInvitation(periodeLien.id) : undefined;
  const lienEnvoye = periodeLien ? (await db.invitation.count({ where: { userId: m.id, periodId: periodeLien.id } })) > 0 : false;
  const etatLien = etatDuLien({
    actif: m.actif,
    aUnEmail,
    aUnMotDePasse: Boolean(m.passwordHash),
    dejaOuvert: m._count.invitations > 0,
    lienEnCours: Boolean(lienPeriode && lienPeriode.expiresAt > maintenant),
    lienEnvoye,
    periodeDeLien: periodeLien !== null,
  });
  /*
   * **« Renvoyer le lien », en bouton visible au téléphone** : le bouton de la ligne de la période
   * active dans « Périodes et liens d'accès » — même action, même confirmation, même libellé selon
   * qu'un lien existe ou non —, sorti de la carte. Il n'est rendu qu'à qui peut aboutir : la
   * permission du bureau, une fiche modifiable, une adresse, un compte actif inscrit à la période.
   */
  const peutRenvoyerLien =
    can(acteur, "invitations.manage") &&
    modifiable &&
    !portail &&
    m.actif &&
    aUnEmail &&
    periodeLien !== null &&
    m.periodes.some((p) => p.period.id === periodeLien.id);
  /*
   * **Le formulaire d'identité et le réglage du bureau, écrits une fois** : dans la carte « Identité
   * et rôle » sur ordinateur, dans le volet « ⋯ » au téléphone. Un seul exemplaire dans la page à la
   * fois (`HorsTelephone`, et le volet qui ne se rend qu'ouvert) : leurs champs portent des `id`.
   */
  const formulaireIdentite = (
    <FormulaireAction action={modifierMembre.bind(null, m.id)} bouton="Enregistrer">
      <div className="grid gap-4 @md:grid-cols-2">
        <Champ label="Prénom" name="prenom" defaultValue={m.prenom} required maxLength={60} disabled={!modifiable} />
        <Champ label="Nom" name="nom" defaultValue={m.nom} required maxLength={60} disabled={!modifiable} />
      </div>
      <Champ
        label="Email (facultatif)"
        name="email"
        type="email"
        defaultValue={m.email ?? ""}
        disabled={!modifiable}
        aide={
          aUnEmail
            ? "Vider ce champ puis enregistrer retire l'adresse : plus de lien personnel, l'équipe cochera sa présence à sa place."
            : "Aucune adresse pour l'instant : l'équipe coche sa présence à sa place. Saisis-la ici dès que tu l'as, puis envoie-lui son lien."
        }
      />
      {/* **Le rôle de base, et lui seul : « Administrateur » a disparu de cette liste**.
          L'entrée y était ajoutée *pour un administrateur* — sinon sa fiche affichait
          « Membre » à la place de son rôle réel — et le select était verrouillé pour lui. Les
          deux béquilles tombent ensemble : un administrateur porte désormais un rôle de base
          comme tout le monde, la liste le montre donc juste, et son rôle **se règle** ici
          puisque le changer ne lui retire plus le bureau. Le bureau, lui, a sa propre liste
          déroulante en dessous.

          Il reste deux cas verrouillés (`roleVerrouille`) : une fiche qu'on n'a pas le droit de
          modifier, et le **compte du portail**, qui doit rester administrateur — sans lui, plus
          personne n'ouvre l'administration technique. **Sa propre fiche n'en est pas** : le rôle de
          base n'ouvre aucun droit, et le serveur laisse chacun régler le sien. L'aide le dit, au
          lieu d'annoncer un verrou que les boutons démentent. */}
      <ChampListe
        label="Rôle"
        name="role"
        valeur={m.role}
        entrees={[
          { valeur: "MEMBRE", libelle: "Membre" },
          { valeur: "INSTRUCTEUR", libelle: "Instructeur" },
        ]}
        disabled={roleVerrouille}
        aide={
          portail
            ? "Le compte de connexion du portail reste administrateur."
            : soiMeme
              ? "Ton propre rôle se règle aussi : membre ou instructeur, il n'ouvre aucun droit. Tes droits d'administrateur, eux, ne se retirent pas d'ici."
              : "Membre ou instructeur. Les droits d'administrateur se règlent juste en dessous, à part."
        }
      />
      {/* **Au club depuis** — la seule entrée du rang (voir `ECHELLE`, src/lib/blasons.ts).
          Une saison plutôt qu'une date ou une durée : personne n'a noté le jour d'arrivée de
          personne, alors que « il est arrivé la saison 2023-2024 » se retrouve de mémoire, et
          se relit exactement comme on l'a choisi. */}
      {!portail && (
        <div className="flex flex-col gap-1.5">
          {/* Plus de `key` de remontage : `ChampListe` suit la valeur du serveur par son miroir
              (`vuDuServeur`), ce que la clé faisait pour la liste native. Désactivée (fiche
              qu'on ne peut pas modifier), elle poste sa valeur — le serveur refuse de toute
              façon le formulaire entier (`canEditUser`), avant de lire le moindre champ. */}
          <ChampListe
            label="Arrivé(e) au club la saison"
            name="saisonArrivee"
            valeur={saisonAuClub === null ? "" : String(saisonAuClub)}
            entrees={[
              { valeur: "", libelle: "Je ne sais pas" },
              ...saisons.map((an, i) => ({
                valeur: String(an),
                libelle: `${libelleSaison(an)} — ${i === 0 ? "cette saison" : `${libelleNumeroSaison(i + 1)} aujourd'hui`}`,
              })),
              // Une saison plus ancienne que la liste (saisie d'avant) reste affichée telle quelle.
              ...(saisonAuClub !== null && !saisons.includes(saisonAuClub) ? [{ valeur: String(saisonAuClub), libelle: libelleSaison(saisonAuClub) }] : []),
            ]}
            disabled={!modifiable}
            aide="Sert à calculer son rang. « Je ne sais pas » : la saison de création du compte fera foi."
          />
          <p className="text-sm text-texte-secondaire">
            Aujourd&apos;hui : <strong className="font-semibold text-texte">{libelleNumeroSaison(numeroDeSaison(adhesion))} au club</strong>{" "}
            {m.auClubDepuis ? `— arrivée la saison ${libelleSaison(saisonEnregistree(adhesion)!)}.` : "— d'après la création du compte, faute de saison choisie."}{" "}
            Tout le club prend une saison à la rentrée, le 1er septembre.
          </p>
        </div>
      )}
      {/* **Le rôle verrouillé est toujours envoyé, et par la liste elle-même.** Un `<select
          disabled>` ne postait rien : un champ caché le doublait, sous **exactement** la
          condition du `disabled` (`roleVerrouille`) — sans quoi sa propre fiche aurait envoyé
          un formulaire **sans rôle du tout**, que `membreSchema` refuse sur un champ qu'on ne
          peut même pas remplir. `ChampListe` poste sa valeur grisée ou non : le doublon est
          tombé, et avec lui la condition qu'il fallait garder identique à celle du `disabled`.
          Le serveur réaffirme le rôle et refuse qu'il change sur le portail. */}
    </FormulaireAction>
  );
  /*
   * **Où vivent les droits d'administrateur**, à la place de l'ancien réglage : une phrase, et le
   * lien vers « Comptes admin » pour qui peut l'ouvrir. Le compte du portail et sa propre fiche n'ont
   * plus de cas à part — la phrase vaut pour tout le monde, et c'est « Comptes admin » qui dit ce
   * qui s'y refuse.
   */
  const noteBureau = ouvreComptesAdmin ? (
    <p className="max-w-prose text-sm text-texte-secondaire">
      Les droits d&apos;administrateur se donnent et se retirent dans{" "}
      <Link href="/admin/comptes" className="font-semibold">
        Comptes admin
      </Link>
      .
    </p>
  ) : duBureau ? (
    <p className="max-w-prose text-sm text-texte-secondaire">Seul un administrateur donne ou retire les droits d&apos;administrateur.</p>
  ) : null;
  /*
   * **Les rubriques du volet « ⋯ » au téléphone** : les gestes rares, rangés derrière un bouton.
   * L'identité (nom, adresse, saison d'arrivée) et le bureau, puis « Que veux-tu faire ? » (`gestes`,
   * présentés en volet : mêmes actions et mêmes confirmations que la carte « Accès et compte »).
   */
  const rubriquesAutres: Rubrique[] = [
    // Une clé sur chaque contenu : ils voyagent dans un tableau jusqu'au composant client.
    { cle: "identite", libelle: "Modifier le nom ou l'email", contenu: <Fragment key="identite">{formulaireIdentite}</Fragment> },
    ...(noteBureau ? [{ cle: "bureau", libelle: "Droits d'administrateur", contenu: <div key="bureau">{noteBureau}</div> }] : []),
  ];
  const resumeNotifications = notifications && refusables.length > 0 ? `${refusables.filter(recoit).length} sur ${refusables.length}` : undefined;
  return (
    /*
     * **`@container` : ici, c'est le conteneur qu'il faut mesurer, pas la fenêtre**. Cette fiche
     * est un **formulaire**, donc elle reste dans la colonne de lecture (736 px) alors que
     * l'annuaire d'où l'on vient fait 1 440 — c'est la doctrine du dépôt, un formulaire large n'est
     * pas plus facile à remplir. Mais ses découpes internes mesuraient la **fenêtre** : sur un
     * écran de 1 920 px, `lg:grid-cols-2` posait deux cartes de 358 px côte à côte dans un
     * conteneur de 736, et `sm:grid-cols-2` y recoupait les champs en deux — soit « Prénom » et «
     * Nom » à **150 px sur un écran de 1 920, contre 324 px sur un téléphone de 390**.
     * Littéralement le piège que `CLAUDE.md` nomme, et dans sa forme la plus nette : plus l'écran
     * est grand, plus les champs sont étroits.
     *
     * Les paliers sont donc des paliers de **conteneur** (`@md` = 28 rem, `@4xl` = 56 rem) : deux
     * cartes côte à côte seulement s'il y a 56 rem pour elles, deux champs côte à côte seulement
     * s'il y a 28 rem dans la carte. Dans 736 px, la fiche devient une colonne de cartes larges aux
     * champs de ~340 px ; si la page s'élargissait un jour, les deux colonnes reviendraient d'elles-mêmes.
     */
    <div className="@container flex flex-col gap-5">
      {/* **Au téléphone, les cartes en liste groupée** (`ListeGroupee`, celle de « Mon profil ») :
          chaque carte devient une ligne qui la déplie, une seule à la fois. Sur ordinateur, les
          groupes s'effacent (`ordi:contents`) et la fiche est celle d'hier. */}
      <ListeGroupee>
        <div>
          <p className="text-sm text-texte-secondaire">
            {/* Le compte du portail ne figure pas dans la liste des membres : on renvoie vers Administration → Comptes */}
            {portail ? <Link href="/admin/comptes">Comptes administrateurs</Link> : <Link href="/admin/membres">Membres</Link>} / {m.prenom} {m.nom}
          </p>
          <h1 className="text-3xl">
            {m.prenom} {m.nom}{" "}
            {/* **Deux pastilles, parce qu'il y a deux choses à dire** : le rôle de base que tout le
                monde porte, et le bureau **en supplément**. Une personne peut être instructeur ET du
                bureau — c'est le cas le plus courant dans une association, et toute la raison
                de ce changement de modèle. Le rôle de base s'affiche toujours, « Membre » compris :
                sur la fiche de quelqu'un, c'est une information qu'on vient chercher, là où la
                **liste** la tait pour ne pas répéter quatre-vingts fois le cas ordinaire. */}
            <Pastille ton={m.role === "INSTRUCTEUR" ? "ocre" : "neutre"}>{ROLE_LABELS[m.role as Role]}</Pastille>{" "}
            {duBureau && <Pastille ton="primaire">{LIBELLE_BUREAU}</Pastille>}{" "}
            {portail && <Pastille ton="neutre">compte du portail</Pastille>}{" "}
            {!m.actif && <Pastille ton="rouge">désactivé</Pastille>}
          </h1>
          <p className="text-texte-secondaire tel:hidden">
            {portail
              ? `${m.email ?? "sans adresse email"}\u00a0· compte de connexion du portail`
              : `${m.email ?? "sans adresse email"}\u00a0· ${m._count.invitations > 0 || m.passwordHash ? "a déjà ouvert l'application" : aUnEmail ? "n'a encore jamais ouvert son lien" : "pas de lien personnel"}\u00a0· ${m._count.attendances}\u00a0réponses\u00a0· ${m._count.ateliers}\u00a0ateliers`}
          </p>
          {/* **Au téléphone, sous le nom : l'adresse, puis l'état du lien** — ce que la ligne de
              l'annuaire ne montre plus. Les chiffres de la personne suivent, en plus petit. */}
          <div className="mt-1 flex flex-col gap-1 ordi:hidden">
            <p className="text-texte-secondaire">{m.email ? <AdresseEmail email={m.email} /> : "sans adresse email"}</p>
            {portail ? (
              <p className="text-texte-secondaire">Compte de connexion du portail</p>
            ) : (
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <Pastille ton={etatLien.ton}>{etatLien.libelle}</Pastille>
                <span className="text-texte-secondaire">
                  {m._count.attendances}&nbsp;réponse{m._count.attendances > 1 ? "s" : ""}&nbsp;· {m._count.ateliers}&nbsp;atelier{m._count.ateliers > 1 ? "s" : ""}
                </span>
              </p>
            )}
          </div>
        </div>

        {/*
          **Au téléphone, les gestes courants en tête de fiche** : le rôle de base en curseur
          à deux positions (`SelecteurRole`, même action que la liste de l'annuaire), « Renvoyer le lien » en
          bouton visible, et « ⋯ » pour le reste — l'identité, le bureau, et « Que veux-tu faire ? ».
        */}
        <div className="flex flex-col gap-3 ordi:hidden">
          {!roleVerrouille && (
            <div className="flex flex-col gap-1">
              <span className="font-semibold">Rôle</span>
              <SelecteurRole userId={m.id} role={m.role} nom={`${m.prenom} ${m.nom}`} presentation="curseur" />
            </div>
          )}
          <div className="flex gap-2">
            {peutRenvoyerLien && periodeLien && (
              <BoutonAction
                action={envoyerLienMembre.bind(null, m.id, periodeLien.id, `/admin/membres/${m.id}`)}
                enCours="Envoi…"
                confirmation={lienPeriode ? "Générer un nouveau lien et l'envoyer par email ? L'ancien lien cessera de fonctionner." : undefined}
                pleineLargeur
              >
                {lienPeriode ? "Renvoyer le lien" : "Envoyer le lien"}
              </BoutonAction>
            )}
            <RubriquesVolet
              libelle="Autres gestes"
              libelleAccessible="Autres gestes"
              icone="points"
              iconeSeule
              variante="secondaire"
              titre={`${m.prenom} ${m.nom}`}
              rubriques={rubriquesAutres}
              gestes={gestes}
              idGestes={`geste-fiche-telephone-${m.id}`}
              enTeteGestes={<h3 key="que-faire" className="pt-3 text-lg font-bold">Que veux-tu faire ?</h3>}
              className={peutRenvoyerLien ? "" : "ml-auto"}
            />
          </div>
        </div>

        {!modifiable && <Alerte type="info">Seul un administrateur peut modifier un compte administrateur.</Alerte>}

        <div className="grid gap-5 @4xl:grid-cols-2">
          {/* Sur téléphone, cette carte vit dans le volet « ⋯ » (en tête de fiche). */}
          <HorsTelephone>
            <Carte titre="Identité et rôle">
              {formulaireIdentite}
              {/* Le bureau ne se règle pas ici : la fiche dit seulement où le geste vit. Le trait
                  de séparation dit que ce qui suit ne part pas avec « Enregistrer ». */}
              {noteBureau && <div className="mt-4 border-t border-bordure/60 pt-4">{noteBureau}</div>}
            </Carte>
          </HorsTelephone>

          {portail ? (
            <Alerte type="info" titre="Compte de connexion du portail">
              <p>
                Il sert uniquement à ouvrir l&apos;administration du portail : ce n&apos;est pas une personne du club. Il n&apos;a donc ni lien d&apos;accès personnel, ni
                période, ni présence, et il ne peut être ni désactivé ni supprimé.
              </p>
              <p className="mt-2">
                <Link href="/admin/comptes" className="font-semibold">
                  Voir les comptes administrateurs
                </Link>
              </p>
            </Alerte>
          ) : (
            <GroupeListe fonduSurOrdinateur titre="Accès">
              <LigneDepliable ancre="liens" titre="Périodes et liens d'accès" resume={etatLien.libelle}>
                <Carte titre="Périodes et liens d'accès">
                  {!aUnEmail && (
                    <div className="mb-4">
                      <Alerte type="attention" titre="Aucun lien ne peut partir">
                        {m.prenom} n&apos;a pas d&apos;adresse email : il n&apos;y a personne à qui envoyer le lien personnel. {m.prenom} reste inscrit(e)
                        aux périodes, compte dans les taux de présence, et l&apos;équipe coche sa présence à sa place. Saisis son adresse dans « Identité
                        et rôle », puis envoie-lui son lien d&apos;ici.
                      </Alerte>
                    </div>
                  )}
                  {m.periodes.length === 0 ? (
                    <p className="text-texte-secondaire">Inscrit à aucune période. Ajoute-le depuis la page d&apos;une période.</p>
                  ) : (
                    <ul className="flex flex-col divide-y divide-bordure/60">
                      {m.periodes.map(({ period: p }) => {
                        const inv = derniereInvitation(p.id);
                        return (
                          <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                            <span>
                              <Link href={`/admin/periodes/${p.id}`} className="font-semibold">
                                {p.nom}
                              </Link>{" "}
                              <span className="text-sm text-texte-secondaire">
                                {p.statut === "ACTIVE" ? "active" : p.statut === "CLOSE" ? "close" : "brouillon"}
                                {inv
                                  ? (inv.usedAt ? `\u00a0· lien ouvert ${inv.ouvertures}\u00a0fois (dernière : ${formatDateHeure(inv.derniereOuverture ?? inv.usedAt)})` : `\u00a0· lien envoyé le ${formatDateHeure(inv.createdAt)}, jamais ouvert`) +
                                    `\u00a0· expire le ${formatDateHeure(inv.expiresAt)}${lienARenouveler(inv.expiresAt) ? " (renouvellement automatique en cours)" : ""}`
                                  : aUnEmail
                                    ? "\u00a0· aucun lien actif"
                                    : "\u00a0· aucun lien : pas d'adresse email"}
                              </span>
                            </span>
                            {p.statut !== "CLOSE" && (aUnEmail || inv) && (
                              <span className="flex flex-wrap gap-2">
                                {aUnEmail && (
                                  <BoutonAction
                                    action={envoyerLienMembre.bind(null, m.id, p.id, `/admin/membres/${m.id}`)}
                                    variante="secondaire"
                                    enCours="Envoi…"
                                    confirmation={inv ? "Générer un nouveau lien et l'envoyer par email ? L'ancien lien cessera de fonctionner." : undefined}
                                  >
                                    {inv ? "Régénérer et renvoyer" : "Envoyer le lien"}
                                  </BoutonAction>
                                )}
                                {inv && (
                                  <BoutonAction action={revoquerInvitation.bind(null, inv.id, `/admin/membres/${m.id}`)} variante="danger" confirmation={`Révoquer le lien de ${m.prenom} pour « ${p.nom} » ? Il ne pourra plus s'en servir tant qu'un nouveau ne lui est pas envoyé.`}>
                                    <Icone nom="alerte" taille={18} />
                                    Révoquer
                                  </BoutonAction>
                                )}
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </Carte>
              </LigneDepliable>
            </GroupeListe>
          )}
        </div>

        {/* Sur téléphone, ces gestes vivent dans le volet « ⋯ » (en tête de fiche). */}
        {gestes.length > 0 && (
          <div className="tel:hidden">
            <Carte titre="Accès et compte">
              <GestesProposes id={`geste-fiche-${m.id}`} gestes={gestes} />
            </Carte>
          </div>
        )}

        {notifications && (
          <GroupeListe fonduSurOrdinateur titre="Notifications">
            <LigneDepliable ancre="notifications" titre="Notifications de cette personne" resume={resumeNotifications}>
              <Carte titre="Notifications de cette personne">
                <p className="-mt-2 mb-4 text-texte-secondaire">
                  Tu modifies les choix {dePrenom}, pas les tiens. {m.prenom} peut les revoir à tout moment depuis « Mon profil » : c&apos;est le même
                  réglage, au même endroit.
                </p>
                {!aUnEmail && (
                  <div className="mb-4">
                    <Alerte type="info">
                      {m.prenom} n&apos;a pas d&apos;adresse email : aucun de ces messages ne part aujourd&apos;hui, quoi que disent les cases. Le réglage reste
                      enregistré et s&apos;appliquera dès qu&apos;une adresse sera renseignée.
                    </Alerte>
                  </div>
                )}
                {refusables.length === 0 ? (
                  <p className="text-texte-secondaire">Le club n&apos;envoie plus aucun de ces messages : il n&apos;y a rien à régler pour {m.prenom}.</p>
                ) : (
                  <FormulaireAction action={definirNotificationsMembre.bind(null, m.id)} bouton="Enregistrer les notifications" enCours="Enregistrement…">
                    <ul className="flex flex-col divide-y divide-bordure/60">
                      {refusables.map((l) => (
                        // Sur téléphone, l'état passe sous le libellé : une pastille à droite écraserait le titre sur trois lignes
                        <li key={l.type} className="py-1 first:pt-0 last:pb-0 sm:flex sm:flex-wrap sm:items-start sm:justify-between sm:gap-x-3">
                          <div className="min-w-0 sm:flex-1">
                            <Case name={l.type} label={l.titre} defaultChecked={recoit(l)} aria-describedby={`${l.type}-quand`} />
                            <p id={`${l.type}-quand`} className="-mt-2 pb-2 pl-9 text-sm text-texte-secondaire">
                              {l.quand}
                            </p>
                          </div>
                          <span className="mb-3 block pl-9 sm:mb-0 sm:shrink-0 sm:pl-0 sm:pt-4">
                            <Pastille ton={recoit(l) ? "vert" : "neutre"}>{recoit(l) ? "reçoit" : "ne reçoit plus"}</Pastille>
                          </span>
                        </li>
                      ))}
                    </ul>
                    <p className="text-sm text-texte-secondaire">
                      Une case décochée coupe ce message pour {m.prenom} seulement — les autres membres continuent de le recevoir. Rien n&apos;est enregistré
                      tant que tu n&apos;as pas appuyé sur le bouton, et le changement est inscrit au journal d&apos;audit (qui a changé quoi, avant et après).
                    </p>
                  </FormulaireAction>
                )}
                {coupeesParLeClub.length > 0 && (
                  <div className="mt-4 rounded-xl border border-bordure/60 bg-surface-douce/40 p-3">
                    <p className="font-semibold">Ce que le club n&apos;envoie plus</p>
                    <p className="mt-0.5 text-sm text-texte-secondaire">
                      Rien à régler ici : le bureau a coupé ces messages pour tout le monde, sur l&apos;écran « Notifications » de l&apos;administration.
                    </p>
                    <ul className="mt-1 flex flex-col divide-y divide-bordure/60">
                      {coupeesParLeClub.map((l) => (
                        <li key={l.type} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 py-2">
                          <span className="min-w-0 flex-1">
                            <span className="block font-semibold text-texte-secondaire">{l.titre}</span>
                            <span className="mt-0.5 block text-sm text-texte-secondaire">{l.quand}</span>
                          </span>
                          <Pastille ton="neutre">désactivé par le club</Pastille>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {notifications.obligatoires.length > 0 && (
                  <div className="mt-4 rounded-xl border border-bordure/60 bg-surface-douce/40 p-3">
                    <p className="flex flex-wrap items-center gap-2 font-semibold">
                      Ce qui lui est envoyé dans tous les cas <Pastille ton="primaire">toujours</Pastille>
                    </p>
                    <ul className="mt-2 flex flex-col gap-2 text-sm">
                      {notifications.obligatoires.map((n) => (
                        <li key={n.titre}>
                          <span className="font-semibold">{n.titre}</span> — <span className="text-texte-secondaire">{n.quand}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 text-sm text-texte-secondaire">
                      Ces messages ne se coupent ni ici, ni depuis son profil : sans eux, {m.prenom} ne pourrait plus entrer dans l&apos;application, ni être
                      prévenu(e) qu&apos;un accès à son compte a été volé.
                    </p>
                  </div>
                )}
              </Carte>
            </LigneDepliable>
          </GroupeListe>
        )}

      </ListeGroupee>
    </div>
  );
}
