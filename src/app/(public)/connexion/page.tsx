import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { accesAdminRegle, CHEMIN_ACTIVATION_ADMIN, compteAcces, peutReglerSonAcces } from "@/lib/auth/acces-admin";
import { cheminSuiteSur } from "@/lib/validation/auth";
import { PageAuth } from "@/components/layout/PageAuth";
import { Alerte } from "@/components/ui/Alerte";
import { FormulaireConnexion } from "./FormulaireConnexion";
import { FormulaireLienColle } from "./FormulaireLienColle";

export const metadata: Metadata = { title: "Connexion" };

type Props = { searchParams: Promise<{ suite?: string; erreur?: string; lien?: string }> };

/**
 * **Chaque issue a son message, et aucun ne promet un email qui n'est pas parti**.
 *
 * Les deux gardes du lien personnel (`signalerOuverture`, `verifierAppareils`) révoquent puis
 * *tentent* un envoi, qui n'a pas lieu quand la fiche n'a pas d'adresse email — un état normal — ou
 * quand la période est close. Les écrans, eux, affirmaient dans tous les cas qu'« un nouveau lien
 * vient d'être envoyé par email » : on envoyait attendre devant une boîte mail où rien n'arriverait
 * jamais quelqu'un dont la seule porte restante était le mot de passe, ou l'équipe. L'action porte
 * donc l'issue jusqu'ici (`IssueGardeLien`, src/lib/invitations.ts) et il y a **un message par cas**.
 */
const ERREURS_URL: Record<string, string> = {
  /*
   * **La clé de chiffrement du serveur a changé**. Les secrets TOTP sont chiffrés avec une clé
   * dérivée de `SESSION_SECRET` : s'il tourne, ils deviennent illisibles. L'application traitait ce
   * cas comme « cette personne n'a pas de 2FA » et proposait d'en inscrire une neuve — donc le
   * premier venu avec le mot de passe d'un administrateur y inscrivait son téléphone. Elle refuse
   * désormais, et cet écran dit pourquoi, sans faire croire à une erreur de saisie.
   */
  "2fa-illisible":
    "La double authentification de ce compte ne peut pas être lue : la clé de chiffrement du serveur a changé. Par sécurité, elle n'est pas remplacée automatiquement — demande à un administrateur de la remettre à zéro.",
  invitation: "Ce lien personnel n'est plus valide. Demande un nouveau lien à l'administrateur.",
  tentatives: "Trop de tentatives. Réessaie dans quelques minutes.",
  suspect:
    "Ce lien a été ouvert un nombre anormal de fois : par sécurité il est désactivé et un nouveau lien vient d'être envoyé à son propriétaire par email. Tous ses appareils ont été déconnectés : il faut ouvrir ce nouveau lien pour revenir — ou se connecter ci-dessous avec son mot de passe, si on s'en est défini un.",
  "suspect-sans-email":
    "Ce lien a été ouvert un nombre anormal de fois : par sécurité il est désactivé et tous les appareils qu'il avait connectés ont été déconnectés. Aucun lien de remplacement n'a pu partir par email. Pour revenir : se connecter ci-dessous avec son mot de passe, si on s'en est défini un, sinon demander un nouveau lien à l'administrateur.",
  // « déjà servi sur 3 appareils » décrivait l'ancienne règle, qui comptait les **reconnexions** :
  // un membre à un seul téléphone finissait par lire ce message. On compte désormais les sessions
  // ouvertes par le lien, et le texte dit ce qui s'est réellement passé.
  appareils:
    "Ce lien était déjà ouvert sur 3 appareils : par sécurité il est remplacé, et le nouveau lien vient d'être envoyé par email à son propriétaire. Tous les appareils connectés avec l'ancien lien ont été déconnectés : il faut ouvrir ce nouveau lien pour revenir — ou se connecter ci-dessous avec son mot de passe, si on s'en est défini un.",
  // Ce cas-là n'arrive qu'à un compte **qui a un mot de passe** : sans adresse ni mot de passe, le
  // plafond ne révoque rien du tout (voir `verifierAppareils`). La phrase peut donc nommer la porte.
  "appareils-sans-email":
    "Ce lien était déjà ouvert sur 3 appareils : par sécurité il est désactivé et tous les appareils qu'il avait connectés ont été déconnectés. Aucun lien de remplacement n'a pu partir par email : la connexion ci-dessous, avec l'adresse et le mot de passe, est la porte à utiliser.",
  session: "Ta session a expiré. Rouvre l'application depuis ton lien personnel (email), ou reconnecte-toi ci-dessous si tu as défini un mot de passe.",
};

/**
 * Seule page de connexion du site. Depuis elle est ouverte à **qui s'est donné un mot de passe**
 * depuis « Mon profil » — membres et instructeurs compris. Le code de double authentification est
 * demandé ensuite à un administrateur (toujours) et à qui l'a activé lui-même. Se connecter ici
 * n'ouvre aucun droit de plus : l'administration technique continue d'exiger le rôle ADMIN **et**
 * une session forte (voir `peutOuvrirSessionForte`, src/lib/auth/acces-admin.ts). Qui n'a pas de
 * mot de passe entre par son lien personnel, comme avant : rien n'y oblige.
 *
 * L'écran d'arrivée n'affiche pas de titre de carte (le logo et le nom de l'association le disent déjà,
 * et le formulaire se comprend seul) : le titre reste là pour les lecteurs d'écran (`titreMasque`).
 */
export default async function PageConnexion({ searchParams }: Props) {
  const { suite, erreur, lien } = await searchParams;
  const user = await getCurrentUser();
  const elevation = erreur === "admin"; // déjà connecté par lien, mais l'administration veut une session forte
  /*
   * **On arrive du bouton « Copier mon lien »** (écran de bienvenue) : le lien est dans le
   * presse-papiers, il ne reste qu'à le coller. Ce cas court-circuite la redirection habituelle
   * « déjà connecté(e) → l'accueil » : la personne *est* connectée, dans Safari, et c'est
   * justement pour cela qu'elle est là — elle doit maintenant ouvrir l'application installée sur
   * son écran d'accueil et coller son lien **là-bas**. L'envoyer sur l'accueil sans un mot
   * d'explication la laisserait sans comprendre ce qu'elle était venue faire.
   */
  const lienCopie = lien === "copie";
  if (user && !elevation && !lienCopie) redirect(cheminSuiteSur(suite));
  const message = erreur && !elevation ? ERREURS_URL[erreur] : undefined;
  // Administrateur nominatif entré par lien : son accès est-il déjà réglé, ou reste-t-il à mettre en place ?
  const compte = elevation && user ? await compteAcces(user.id) : null;
  const aRegler = !!compte && peutReglerSonAcces(compte) && !accesAdminRegle(compte);
  return (
    <PageAuth titre="Connexion" titreMasque>
      <div className="flex flex-col gap-5">
        {elevation && (
          <Alerte type="info">
            Tu es entré(e) par ton lien personnel{user ? ` (${user.email})` : ""}. L&apos;administration demande une connexion complète : adresse, mot de passe et code de
            double authentification.
            {aRegler && (
              <>
                {" "}
                Pas encore de mot de passe ?{" "}
                <Link href={CHEMIN_ACTIVATION_ADMIN} className="font-semibold">
                  Règle ton accès administrateur
                </Link>{" "}
                (une seule fois, quelques minutes).
              </>
            )}
          </Alerte>
        )}
        {message && <Alerte type={erreur === "tentatives" ? "attention" : "erreur"}>{message}</Alerte>}
        {/* On ne dit plus « le champ ci-dessous » : quand l'appareil a déjà gardé un lien, il n'y a
            pas de champ — il y a un bouton. La phrase nomme donc l'endroit (« juste en dessous »)
            et non la forme qu'il prend. */}
        {lienCopie && (
          <Alerte type="succes" titre="Ton lien est copié">
            {user
              ? "Ouvre maintenant l'application depuis ton écran d'accueil, puis colle ton lien juste en dessous. Sur iPhone, l'application installée et Safari ne partagent pas leurs comptes : c'est ce collage qui fait le pont."
              : "Colle-le juste en dessous pour ouvrir ton espace. Il restera sur cet appareil : la prochaine fois, un bouton suffira."}
          </Alerte>
        )}
        {/* La porte des gens sans mot de passe qui ont installé l'application : leur lien ne se colle
            nulle part ailleurs (une PWA n'a pas de barre d'adresse). Elle passe donc devant le
            formulaire mot de passe quand on arrive tout exprès pour coller. */}
        {lienCopie && (
          <section className="rounded-xl border border-bordure/60 bg-surface-douce p-4">
            <h2 className="mb-3 text-lg font-bold">J&apos;ai reçu un lien par email</h2>
            <FormulaireLienColle enEvidence />
          </section>
        )}
        <FormulaireConnexion suite={cheminSuiteSur(suite)} />
        {elevation ? (
          <p className="text-center text-sm">
            <Link href="/" className="inline-flex min-h-11 items-center justify-center px-2">
              Revenir à l&apos;application
            </Link>
          </p>
        ) : (
          <>
            {/* **Le repli appartient au formulaire, pas à cette page**. Il était ici, dans un
                `<details>` toujours replié intitulé « J'ai reçu un lien par email » : quand
                l'appareil gardait une clé de 4 mois, rien ne le disait et le bouton « Oublier » se
                trouvait derrière un pli — alors que « Se déconnecter » dépose précisément ici. Or
                seul le navigateur sait s'il y a une clé (`localStorage`) : c'est donc au composant
                client de choisir entre le pli et le bloc visible. */}
            {!lienCopie && <FormulaireLienColle />}
            <p className="rounded-xl bg-surface-douce p-3 text-sm text-texte-secondaire">
              <strong>Pas de mot de passe ?</strong> C&apos;est normal : il est facultatif. Ouvre simplement le <strong>lien personnel</strong> reçu par email — lien perdu ?
            Demande à l&apos;administrateur de te le renvoyer. Une fois entré(e), tu peux t&apos;en définir un dans{" "}
            <Link href="/profil#securite" className="font-semibold">
              Mon profil → Sécuriser mon compte
            </Link>
              , pour revenir ici depuis n&apos;importe quel appareil.
            </p>
          </>
        )}
      </div>
    </PageAuth>
  );
}
