import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/current-user";
import { db } from "@/lib/db";
import { formatDateHeure } from "@/lib/dates";
import { retirerDroitsAdmin } from "@/actions/membres";
import { genererCodeActivationCompte, reinitialiserDeuxFaCompte, retirerDeuxFaMembre } from "@/actions/admin";
import { codeActivationEnCours } from "@/lib/auth/code-activation";
import { EncartCodesActivation } from "@/components/admin/EncartCodesActivation";
import { lireDemandesEnAttente } from "@/lib/auth/demande-deux-fa";
import { NB_CODES_SECOURS, nombreCodesRestants } from "@/lib/auth/codes-secours";
import { FormulaireMaDeuxFa } from "./FormulaireMaDeuxFa";
import { BoutonAction } from "@/components/ui/BoutonAction";
import { Carte } from "@/components/ui/Carte";
import { Cellule, Ligne, Tableau, type PalierTableau } from "@/components/ui/Tableau";
import { AdresseEmail } from "@/components/ui/AdresseEmail";
import { Pastille } from "@/components/ui/Pastille";
import { ROLE_LABELS, type Role } from "@/lib/constants";
import { SelectionNomination } from "./SelectionNomination";
import { Icone } from "@/components/ui/Icone";

export const metadata: Metadata = { title: "Comptes administrateurs" };

/**
 * **Le palier du vrai tableau suit la largeur de la page** (1 024 px), comme l'annuaire et la liste
 * des périodes : déplié à 768 px dans une colonne de lecture de 736, ce tableau de six colonnes
 * donnait 103 px à l'email. Une seule écriture dans le fichier, pour qu'on ne puisse pas en déplier
 * une moitié.
 */
const PALIER_TABLEAU: PalierTableau = "lg";

/** Ce que la réinitialisation de la 2FA d'un autre entraîne, dit avant d'agir. */
function confirmationReinitialisation(nom: string): string {
  return [
    `Réinitialiser la double authentification de ${nom} ?`,
    "",
    "• Son application de codes et ses codes de secours ne servent plus.",
    "• Toutes ses sessions sont fermées, sur tous ses appareils.",
    "• À sa connexion suivante, il faudra scanner un nouveau QR code et noter de nouveaux codes de secours avant de continuer.",
    "• Un code d'activation va s'afficher ici, une seule fois : transmets-le-lui de vive voix ou en main propre, jamais par email. Sans lui, sa double authentification ne se réactive pas.",
    "",
    "Vérifie d'abord avec la personne, de vive voix, que la demande vient bien d'elle.",
  ].join("\n");
}

/** Ce que « Générer un code d'activation » entraîne, dit avant d'agir. */
function confirmationCodeActivation(nom: string): string {
  return [
    `Générer un code d'activation pour ${nom} ?`,
    "",
    "• Le code précédent, s'il y en a un, cesse de valoir.",
    "• Le nouveau s'affiche ici une seule fois, valable 48 heures et pour un seul usage.",
    "• Transmets-le de vive voix ou en main propre, jamais par email ni par message.",
  ].join("\n");
}

export default async function PageComptesAdmin() {
  const acteur = await requirePermission("admins.manage");
  /*
   * **Les trois requêtes de cet écran se posent sur `estAdmin`, plus sur le rôle**. Le bureau est
   * devenu un supplément et `role` ne vaut plus jamais « ADMIN » : le tableau du haut se serait
   * vidé — plus un seul administrateur, donc plus aucun bouton « Retirer » —, et la liste des
   * personnes nommables aurait proposé **tout le club, bureau compris**, invitant à nommer des gens
   * qui le sont déjà. Un écran vide se remarque ; une liste trop longue, non.
   */
  const [admins, candidats, desactives, demandes, horsBureau, moi, mesCodes] = await Promise.all([
    db.user.findMany({ where: { estAdmin: true }, orderBy: [{ prenom: "asc" }, { nom: "asc" }], include: { authSessions: { orderBy: { lastSeenAt: "desc" }, take: 1 } } }),
    // Personnes déjà dans l'annuaire que l'on peut nommer : le bureau ne se donne pas depuis leur
    // fiche, il se donne ici. Leur **rôle de base**, lui, ne regarde pas cet écran : on ajoute un
    // supplément, on ne remplace rien.
    db.user.findMany({ where: { estAdmin: false, actif: true, service: false }, orderBy: [{ prenom: "asc" }, { nom: "asc" }], select: { id: true, prenom: true, nom: true, email: true } }),
    // **Ce qui reste dehors est compté et dit** : les comptes désactivés n'ont pas de case, et la
    // carte explique pourquoi plutôt que de les faire disparaître sans un mot (le serveur les refuse
    // de toute façon — « réactive-le d'abord »).
    db.user.count({ where: { estAdmin: false, actif: false, service: false } }),
    // **Les demandes de réinitialisation en attente**, lues au journal d'audit : la dernière demande
    // d'une personne, postérieure à la dernière remise à zéro de son second facteur. Pas de colonne :
    // le journal sait déjà tout, et une colonne de plus serait un second état à tenir juste.
    lireDemandesEnAttente(),
    // Membres et instructeurs qui gardent une double authentification d'avant : elle ne sert plus à
    // rien, le bureau peut la retirer d'ici.
    db.user.findMany({
      where: { estAdmin: false, service: false, totpActiveAt: { not: null }, totpSecret: { not: null } },
      orderBy: [{ prenom: "asc" }, { nom: "asc" }],
      select: { id: true, prenom: true, nom: true, email: true, role: true },
    }),
    db.user.findUniqueOrThrow({ where: { id: acteur.id }, select: { totpActiveAt: true, totpSecret: true } }),
    nombreCodesRestants(acteur.id),
  ]);
  const maDeuxFa = !!moi.totpActiveAt && !!moi.totpSecret;
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-3xl">Comptes administrateurs</h1>
        <p className="text-texte-secondaire">
          Les comptes marqués « compte du portail » servent à se connecter à l&apos;administration : ce ne sont pas des personnes du club.
        </p>
      </div>
      <EncartCodesActivation acteurId={acteur.id} />
      {/* **Sa propre double authentification se gère ici**, derrière la même élévation que celle des
          autres : codes de secours, nouveau téléphone. « Mon profil » n'en garde que l'état et le
          bouton qui demande au bureau de la réinitialiser — la porte de qui n'entre plus ici. */}
      <Carte id="ma-deux-fa" titre="Ma double authentification">
        <p className="mb-4 flex flex-wrap items-center gap-2">
          {maDeuxFa ? <Pastille ton="vert">active</Pastille> : <Pastille ton="ocre">à régler</Pastille>}
          {maDeuxFa && moi.totpActiveAt && <span className="text-texte-secondaire">depuis le {formatDateHeure(moi.totpActiveAt)}</span>}
          {maDeuxFa && (
            <Pastille ton={mesCodes > 0 ? "neutre" : "rouge"}>
              {mesCodes}&nbsp;sur {NB_CODES_SECOURS}&nbsp;codes de secours
            </Pastille>
          )}
        </p>
        {maDeuxFa ? (
          <FormulaireMaDeuxFa codesRestants={mesCodes} />
        ) : (
          <p className="text-texte-secondaire">
            Elle se règle sur{" "}
            <Link href="/admin/activer" className="underline">
              la page de réglage de ton accès
            </Link>
            .
          </p>
        )}
      </Carte>
      <Carte>
        <Tableau palier={PALIER_TABLEAU} entetes={["Nom", "Email", "État", "Double authentification", "Dernière activité", "Droits admin"]}>
          {admins.map((a) => (
            <Ligne palier={PALIER_TABLEAU} key={a.id}>
              <Cellule palier={PALIER_TABLEAU}>
                <Link href={`/admin/membres/${a.id}`} className="inline-flex min-h-11 items-center font-semibold">
                  {a.prenom} {a.nom}
                </Link>
                {/* Compte de connexion du portail : ce n'est pas une personne du club */}
                {a.service && (
                  <div className="mt-1">
                    <Pastille ton="neutre">compte du portail</Pastille>
                  </div>
                )}
              </Cellule>
              <Cellule palier={PALIER_TABLEAU} label="Email">{a.email ? <AdresseEmail email={a.email} /> : <span className="text-texte-secondaire">sans adresse email</span>}</Cellule>
              <Cellule palier={PALIER_TABLEAU} label="État">{a.actif ? <Pastille ton="vert">actif</Pastille> : <Pastille ton="rouge">désactivé</Pastille>}</Cellule>
              {/* **Le compte permanent n'a pas ce bouton**. Le serveur refusait déjà les deux
                  gestes — `reinitialiserDeuxFaCompte` et `reinitialiserAccesMembre` —, mais cette
                  cellule rendait quand même « Réinitialiser » sur sa ligne : un bouton qui ne peut
                  que refuser est pire que pas de bouton, et celui-là laissait croire qu'un
                  administrateur peut remettre à zéro le second facteur du compte qui ouvre
                  l'administration. La fiche d'un membre, elle, masquait déjà sa carte « Remettre
                  l'accès à zéro » (`peutReinitialiser`). */}
              <Cellule palier={PALIER_TABLEAU} label="2FA" className="text-sm">
                {/* **La demande en attente se lit sur la ligne qu'elle concerne** : c'est là que se
                    trouve le bouton qui y répond, et l'email du bureau y mène. Elle s'éteint d'elle-même
                    à la réinitialisation. */}
                {demandes.has(a.id) && a.totpActiveAt && (
                  <div className="mb-2">
                    <Pastille ton="ocre">réinitialisation demandée le {formatDateHeure(demandes.get(a.id)!)}</Pastille>
                  </div>
                )}
                {!(a.totpActiveAt && a.totpSecret) ? (
                  a.service ? (
                    <span className="flex flex-wrap items-center gap-2">
                      <Pastille ton="ocre">Réglage à faire</Pastille>
                      <span className="text-texte-secondaire">lui seul la règle, sans code d&apos;activation</span>
                    </span>
                  ) : (
                    /* **Réglage à faire : où en est son code d'activation.** Sans code valable, la
                       personne ne peut pas finir son réglage — l'écran le dit et porte le bouton qui
                       débloque. Le code lui-même ne se relit jamais ici : seule l'échéance est gardée. */
                    <span className="flex flex-col items-start gap-2">
                      <Pastille ton="ocre">Réglage à faire</Pastille>
                      {(() => {
                        const echeance = codeActivationEnCours(a);
                        return echeance ? (
                          <span className="text-texte-secondaire">code d&apos;activation valable jusqu&apos;au {formatDateHeure(echeance)}</span>
                        ) : (
                          <span className="font-semibold">aucun code valable</span>
                        );
                      })()}
                      {a.id !== acteur.id && a.actif && (
                        <BoutonAction
                          action={genererCodeActivationCompte.bind(null, a.id)}
                          variante="secondaire"
                          taille="petite"
                          aria-label={`Générer un code d'activation pour ${a.prenom} ${a.nom}`}
                          confirmation={confirmationCodeActivation(`${a.prenom} ${a.nom}`)}
                        >
                          <Icone nom="bouclier" taille={18} />
                          Générer un code d&apos;activation
                        </BoutonAction>
                      )}
                    </span>
                  )
                ) : a.id === acteur.id ? (
                  <span className="flex flex-wrap items-center gap-2">
                    <Pastille ton="vert">activée</Pastille>
                    <Link href="#ma-deux-fa" className="text-texte-secondaire underline">
                      la tienne se gère ci-dessus
                    </Link>
                  </span>
                ) : a.service ? (
                  <span className="flex flex-wrap items-center gap-2">
                    <Pastille ton="vert">activée</Pastille>
                    {/* Sa voie de secours n'est pas un bouton d'ici : c'est lui-même, depuis cet
                        écran (« Ma double authentification »), et à défaut la commande
                        `npm run admin:reset-2fa` sur le serveur. */}
                    <span className="text-texte-secondaire">lui seul la réinitialise</span>
                  </span>
                ) : (
                  <span className="flex flex-wrap items-center gap-2">
                    <Pastille ton="vert">activée</Pastille>
                    <BoutonAction action={reinitialiserDeuxFaCompte.bind(null, a.id)} variante="danger" taille="petite" confirmation={confirmationReinitialisation(`${a.prenom} ${a.nom}`)}>
                      <Icone nom="alerte" taille={18} />
                      Réinitialiser
                    </BoutonAction>
                  </span>
                )}
              </Cellule>
              <Cellule palier={PALIER_TABLEAU} label="Dernière activité" className="text-sm">{a.authSessions[0] ? formatDateHeure(a.authSessions[0].lastSeenAt) : "jamais connecté"}</Cellule>
              {/* Retirer les droits ne supprime rien et ne change pas le rôle de la personne : elle
                  garde celui qu'elle a — membre ou instructeur — avec son historique, et c'est le
                  supplément « bureau » qui s'en va.
                  Deux comptes n'ont pas ce bouton, et c'est le serveur qui le tient :
                  le compte du portail (sans lui, plus personne n'ouvre l'administration) et le sien
                  (fermer la porte de l'intérieur). */}
              <Cellule palier={PALIER_TABLEAU} label="Droits admin" className="text-sm">
                {a.service ? (
                  <span className="text-texte-secondaire">administrateur permanent</span>
                ) : a.id === acteur.id ? (
                  <span className="text-texte-secondaire">c&apos;est toi</span>
                ) : (
                  <BoutonAction
                    action={retirerDroitsAdmin.bind(null, a.id)}
                    // Rouge, comme tout ce qui retire quelque chose : le compte reste, avec son rôle et
                    // son historique, mais les droits partis sont à redonner.
                    variante="danger"
                    taille="petite"
                    // Le libellé tient en un mot dans la colonne « Droits admin » — la phrase
                    // entière est dans le nom accessible et dans la confirmation, qui dit ce que
                    // le geste fait *et* ce qu'il ne fait pas.
                    aria-label={`Retirer les droits d'administrateur de ${a.prenom} ${a.nom}`}
                    title="Retirer les droits d'administrateur"
                    // La phrase ne promet plus « redevient un membre du club » : la personne n'a
                    // jamais cessé d'en être un, et elle garde son rôle de base — le geste ne
                    // retire que le bureau. L'annoncer autrement ferait craindre une
                    // rétrogradation.
                    confirmation={`Retirer les droits d'administrateur de ${a.prenom} ${a.nom} ? Le compte reste, avec ses présences et son rôle de ${ROLE_LABELS[a.role as Role].toLowerCase()} : ${a.prenom} n'ouvre simplement plus l'administration.`}
                  >
                    <Icone nom="alerte" taille={18} />
                    Retirer
                  </BoutonAction>
                )}
              </Cellule>
            </Ligne>
          ))}
        </Tableau>
      </Carte>
      {/* Une seule porte vers l'administration : on **nomme** quelqu'un que l'annuaire connaît
          déjà. Ouvrir un compte depuis cet onglet faisait un doublon du formulaire de l'annuaire,
          avec le risque d'un second compte pour une personne déjà inscrite — et un compte neuf sans
          période, sans lien, sans historique. Pour un nouveau venu : l'ajouter d'abord dans
          « Membres », puis le nommer ici. */}
      {/* **Les doubles authentifications hors du bureau** : celles que des membres ou des
          instructeurs avaient activées quand elle était proposée à tous. Elles ne servent plus à
          rien (la connexion ne la demande pas) ; la carte n'existe que s'il en reste. */}
      {horsBureau.length > 0 && (
        <Carte titre="Double authentification hors du bureau">
          <p className="mb-3 text-texte-secondaire">
            Ces comptes gardent une double authentification d&apos;avant : elle n&apos;a aucun effet sur leur connexion. La retirer remet leur compte au propre, sans les déconnecter.
          </p>
          <ul className="flex flex-col divide-y divide-bordure/60">
            {horsBureau.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="flex flex-col">
                  <Link href={`/admin/membres/${m.id}`} className="inline-flex min-h-11 items-center font-semibold">
                    {m.prenom} {m.nom}
                  </Link>
                  <span className="text-sm text-texte-secondaire">{ROLE_LABELS[m.role as Role]}</span>
                  {demandes.has(m.id) && (
                    <span className="mt-1">
                      <Pastille ton="ocre">retrait demandé le {formatDateHeure(demandes.get(m.id)!)}</Pastille>
                    </span>
                  )}
                </span>
                <BoutonAction
                  action={retirerDeuxFaMembre.bind(null, m.id)}
                  variante="danger"
                  taille="petite"
                  aria-label={`Retirer la double authentification de ${m.prenom} ${m.nom}`}
                  confirmation={`Retirer la double authentification de ${m.prenom} ${m.nom} ? Elle n'a aucun effet sur sa connexion, qui ne change pas.`}
                >
                  <Icone nom="alerte" taille={18} />
                  Retirer
                </BoutonAction>
              </li>
            ))}
          </ul>
        </Carte>
      )}
      <Carte titre="Nommer un administrateur">
        {candidats.length === 0 ? (
          <p className="text-texte-secondaire">Tout le monde est déjà administrateur, ou il n&apos;y a personne d&apos;autre dans l&apos;annuaire.</p>
        ) : (
          /* **Plusieurs personnes d'un coup** : un bureau se renouvelle en bloc à l'assemblée, et
              c'étaient autant de passages dans la liste déroulante que de noms, chacun suivi de son
              propre code à six chiffres. Les verrous, eux, n'ont pas bougé d'un cran — voir
              `actions.ts`. */
          <SelectionNomination candidats={candidats} />
        )}
        {/* **Qui n'est pas dans la liste, et pourquoi.** Les administrateurs actuels (compte du portail
            compris) sont dans le tableau du haut ; les comptes désactivés sont comptés ici. Sans ces
            deux phrases, une absence se lit comme une panne — on cherche un nom qu'on sait inscrit. */}
        <div className="mt-4 flex flex-col gap-1 text-sm text-texte-secondaire">
          <p>
            Les {admins.length} administrateurs actuels n&apos;y sont pas : ils ont déjà les droits, et le compte du portail les garde à demeure. Ils sont dans le
            tableau ci-dessus, avec le bouton pour les leur retirer.
          </p>
          {desactives > 0 && (
            <p>
              {desactives === 1
                ? "1 compte désactivé n'y est pas non plus : réactive-le d'abord, un rôle sans accès ne sert à rien."
                : `${desactives} comptes désactivés n'y sont pas non plus : réactive-les d'abord, un rôle sans accès ne sert à rien.`}
            </p>
          )}
          <p>
            La personne n&apos;est pas encore dans l&apos;annuaire ? Ajoute-la d&apos;abord dans{" "}
            <Link href="/admin/membres#ajouter" className="underline">
              Membres
            </Link>
            , puis nomme-la ici.
          </p>
        </div>
      </Carte>
    </div>
  );
}
