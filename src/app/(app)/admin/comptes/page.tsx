import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/current-user";
import { db } from "@/lib/db";
import { formatDateHeure } from "@/lib/dates";
import { retirerDroitsAdmin } from "@/actions/membres";
import { reinitialiserDeuxFaCompte } from "@/actions/admin";
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

export default async function PageComptesAdmin() {
  const acteur = await requirePermission("admins.manage");
  /*
   * **Les trois requêtes de cet écran se posent sur `estAdmin`, plus sur le rôle**. Le bureau est
   * devenu un supplément et `role` ne vaut plus jamais « ADMIN » : le tableau du haut se serait
   * vidé — plus un seul administrateur, donc plus aucun bouton « Retirer » —, et la liste des
   * personnes nommables aurait proposé **tout le club, bureau compris**, invitant à nommer des gens
   * qui le sont déjà. Un écran vide se remarque ; une liste trop longue, non.
   */
  const [admins, candidats, desactives] = await Promise.all([
    db.user.findMany({ where: { estAdmin: true }, orderBy: [{ prenom: "asc" }, { nom: "asc" }], include: { authSessions: { orderBy: { lastSeenAt: "desc" }, take: 1 } } }),
    // Personnes déjà dans l'annuaire que l'on peut nommer : le bureau ne se donne pas depuis leur
    // fiche, il se donne ici. Leur **rôle de base**, lui, ne regarde pas cet écran : on ajoute un
    // supplément, on ne remplace rien.
    db.user.findMany({ where: { estAdmin: false, actif: true, service: false }, orderBy: [{ prenom: "asc" }, { nom: "asc" }], select: { id: true, prenom: true, nom: true, email: true } }),
    // **Ce qui reste dehors est compté et dit** : les comptes désactivés n'ont pas de case, et la
    // carte explique pourquoi plutôt que de les faire disparaître sans un mot (le serveur les refuse
    // de toute façon — « réactive-le d'abord »).
    db.user.count({ where: { estAdmin: false, actif: false, service: false } }),
  ]);
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-3xl">Comptes administrateurs</h1>
        <p className="text-texte-secondaire">
          Les comptes marqués « compte du portail » servent à se connecter à l&apos;administration : ce ne sont pas des personnes du club.
        </p>
      </div>
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
                {!a.totpActiveAt ? (
                  <Pastille ton="ocre">à configurer à la 1ère connexion</Pastille>
                ) : a.service ? (
                  <span className="flex flex-wrap items-center gap-2">
                    <Pastille ton="vert">activée</Pastille>
                    {/* Sa voie de secours n'est pas un bouton d'ici : c'est sa propre boîte email
                        (lien de réinitialisation) et, à défaut, le redéploiement. */}
                    <span className="text-texte-secondaire">lui seul la réinitialise</span>
                  </span>
                ) : (
                  <span className="flex flex-wrap items-center gap-2">
                    <Pastille ton="vert">activée</Pastille>
                    <BoutonAction action={reinitialiserDeuxFaCompte.bind(null, a.id)} variante="danger" taille="petite" confirmation={`Réinitialiser la double authentification de ${a.prenom} ? Ses sessions seront fermées et un nouveau QR code lui sera proposé à sa prochaine connexion.`}>
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
