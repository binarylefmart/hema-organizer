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
import { SelecteurBureau } from "../SelecteurBureau";
import { LIBELLE_BUREAU } from "../bureau";
import { gestesFiche, type GesteFiche } from "../gestes-fiche";
import { Icone } from "@/components/ui/Icone";

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
  /**
   * **Les deux seuls cas où le rôle de base ne se règle pas ici.** Elle commandait aussi un champ
   * caché qui doublait la liste grisée, et devait donc rester identique au `disabled` ; ce doublon
   * est tombé avec `ChampListe`, qui poste sa valeur même désactivée (voir sous la liste).
   */
  /*
   * **Sa propre fiche laisse régler son rôle de base** : il n'ouvre aucun droit, et seul un
   * administrateur peut le changer. Restent verrouillés le compte du portail et une fiche qu'on n'a
   * pas le droit de modifier.
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
   * **Nommer ou retirer un administrateur depuis la fiche**. Les verrous ne bougent pas d'un cran :
   * ce sont ceux de l'écran « Comptes admin », qui portait déjà ce geste — `admins.manage`
   * (`peutNommerAdmin`), le compte du portail intouchable, et personne ne se retire son propre
   * bureau. Le réglage n'est rendu qu'à qui peut aboutir : « un bouton qui ne peut que refuser est
   * pire que pas de bouton » (`CLAUDE.md`). Le code 2FA récent, lui, est redemandé par l'action
   * elle-même, comme pour tous les gestes qui touchent un compte.
   */
  const peutDonnerLeBureau = peutNommerAdmin(acteur) && modifiable && !portail && !soiMeme;
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
        <p className="text-texte-secondaire">
          {portail
            ? `${m.email ?? "sans adresse email"} · compte de connexion du portail`
            : `${m.email ?? "sans adresse email"} · ${m._count.invitations > 0 || m.passwordHash ? "a déjà ouvert l'application" : aUnEmail ? "n'a encore jamais ouvert son lien" : "pas de lien personnel"} · ${m._count.attendances} réponses · ${m._count.ateliers} ateliers`}
        </p>
      </div>

      {!modifiable && <Alerte type="info">Seul un administrateur peut modifier un compte administrateur.</Alerte>}

      <div className="grid gap-5 @4xl:grid-cols-2">
        <Carte titre="Identité et rôle">
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

                Il reste deux cas verrouillés, et ce sont les deux seuls : **son propre compte** (on
                ne change pas son propre rôle, règle de tout le dépôt) et le **compte du portail**,
                qui doit rester administrateur — sans lui, plus personne n'ouvre l'administration
                technique. */}
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
                    ? "Tu ne peux pas changer ton propre rôle."
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
          {/*
            **Le bureau, à part du formulaire — et c'est le point de la demande** (« pour
            la sélection des rôles où admin est présent, fais un menu déroulant à part avec au choix
            `----------` ou `admin` »).

            **Pourquoi hors du formulaire, littéralement :** « Enregistrer » au-dessus écrit un nom,
            une adresse et un rôle, et se reprend d'un geste. Donner ou retirer les droits du club ne
            se glisse pas dans ce lot-là — ni dans son bouton, ni dans son journal : le geste a sa
            propre confirmation, sa propre entrée d'audit (`admin.droits_donnes` /
            `admin.droits_retires`) et son propre code 2FA. Un seul « Enregistrer » pour les deux
            aurait fait d'un changement d'adresse l'occasion de nommer un administrateur par
            inadvertance.

            Le trait de séparation n'est donc pas décoratif : il dit que ce qui suit ne part pas avec
            le bouton d'au-dessus.
          */}
          {peutDonnerLeBureau && (
            <div className="mt-4 border-t border-bordure/60 pt-4">
              <SelecteurBureau userId={m.id} nom={`${m.prenom} ${m.nom}`} estAdmin={duBureau} retour={`/admin/membres/${m.id}`} />
              <p className="mt-2 max-w-prose text-sm text-texte-secondaire">
                {/* « son rôle d'instructeur », jamais « de instructeur » : la phrase se lit à voix
                    haute, comme « les choix d'Bravo » plus bas sur cette même fiche. */}
                Le bureau s&apos;ajoute au rôle : {m.prenom} garde son rôle {m.role === "INSTRUCTEUR" ? "d'instructeur" : "de membre"} quoi qu&apos;il
                arrive ici.
                Mot de passe et double authentification sont obligatoires pour un administrateur, et lui seront demandés avant que
                l&apos;administration s&apos;ouvre. Le changement est inscrit au journal d&apos;audit.
              </p>
            </div>
          )}
          {/* Et quand le geste n'est pas offert, on dit où il vit : une fiche qui ne montre ni le
              réglage ni son emplacement laisse chercher. Les deux cas sont le compte du portail (qui
              reste administrateur par construction) et sa propre fiche — personne ne se retire son
              propre bureau, c'est fermer la porte de l'intérieur. */}
          {!peutDonnerLeBureau && duBureau && (
            <p className="mt-4 max-w-prose border-t border-bordure/60 pt-4 text-sm text-texte-secondaire">
              {portail
                ? "Le compte de connexion du portail reste administrateur : sans lui, plus personne n'ouvrirait l'administration technique."
                : soiMeme
                  ? "Tu ne peux pas te retirer tes propres droits d'administrateur : demande-le à un autre membre du bureau, depuis « Comptes admin » ou depuis cette fiche."
                  : "Seul un administrateur donne ou retire les droits d'administrateur."}
            </p>
          )}
        </Carte>

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
                            ? (inv.usedAt ? ` · lien ouvert ${inv.ouvertures} fois (dernière : ${formatDateHeure(inv.derniereOuverture ?? inv.usedAt)})` : ` · lien envoyé le ${formatDateHeure(inv.createdAt)}, jamais ouvert`) +
                              ` · expire le ${formatDateHeure(inv.expiresAt)}${lienARenouveler(inv.expiresAt) ? " (renouvellement automatique en cours)" : ""}`
                            : aUnEmail
                              ? " · aucun lien actif"
                              : " · aucun lien : pas d'adresse email"}
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
        )}
      </div>

      {gestes.length > 0 && (
        <Carte titre="Accès et compte">
          <GestesProposes id={`geste-fiche-${m.id}`} gestes={gestes} />
        </Carte>
      )}

      {notifications && (
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
      )}

    </div>
  );
}
