import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { surveillerLiensInconnus } from "@/lib/alertes";
import { checkInvitation, entrerMalgreLienInvalide, RAISONS_INVITATION } from "@/lib/invitations";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { masquerEmail } from "@/lib/membres";
import { clientIp } from "@/lib/request-info";
import { getCurrentUser } from "@/lib/auth/current-user";
import { PageAuth } from "@/components/layout/PageAuth";
import { Alerte } from "@/components/ui/Alerte";
import { BoutonEnvoi } from "@/components/ui/BoutonEnvoi";
import { cheminSuiteSur } from "@/lib/validation/auth";
import { connexionParInvitation } from "@/actions/auth";
import { RenvoyerLienExpire } from "./RenvoyerLienExpire";

export const metadata: Metadata = { title: "Ton lien d'accès" };

type Props = { params: Promise<{ token: string }>; searchParams: Promise<{ suite?: string }> };

/**
 * Lien d'accès personnel : pas de mot de passe. Un appui ouvre l'application et rattache la
 * personne à la période. Premier accès → écran de bienvenue.
 *
 * **Pourquoi un bouton, et pas une ouverture automatique.** Cette page est un GET : elle *vérifie*
 * le lien sans rien consommer. C'est l'appui sur le bouton qui envoie un POST
 * (`connexionParInvitation`) et qui, lui, pose la session, marque `usedAt`, compte l'appareil et
 * envoie l'email « nouvel appareil ».
 *
 * Ce découpage n'est pas un excès de prudence : les **messageries préchargent les liens des
 * emails** (Outlook Safe Links, antivirus, générateurs d'aperçu). Si un GET suffisait à entrer,
 * chaque invitation serait « ouverte » par un robot avant même d'arriver : `usedAt` posé, un email
 * « nouvel appareil » envoyé à quelqu'un qui n'a rien fait, et — le lien étant compté comme ouvert
 * sur un appareil de plus — le lien **révoqué automatiquement** au-delà de trois appareils : on
 * casserait l'accès de gens qui n'ont rien demandé. Un robot qui ne fait que lire ne déclenche
 * rien ; il faut une action humaine.
 *
 * Donc : **ne pas remplacer ce bouton par une redirection automatique** « pour simplifier ». Le
 * second écran, lui, n'apparaît qu'au tout premier accès (`apresInvitation`) : aux accès suivants,
 * un seul appui mène directement à l'accueil, et l'adresse finale ne porte jamais le jeton.
 */
export default async function PageInvitation({ params, searchParams }: Props) {
  const { token } = await params;
  // Page demandée au départ (bouton d'un email de rappel) : transmise à l'action, qui y ramène
  // une fois la session ouverte. À défaut, l'action retrouve la destination gardée par le middleware.
  const suite = cheminSuiteSur((await searchParams).suite);

  if (!(await checkRateLimit("invitation_ip", await clientIp()))) {
    return (
      <PageAuth titre="Un instant">
        <Alerte type="attention">Trop de tentatives. Réessaie dans quelques minutes.</Alerte>
      </PageAuth>
    );
  }

  const check = await checkInvitation(token);
  if (!check.ok) {
    const ip = await clientIp();
    // Lien inconnu ou invalide : on compte par IP (recherche de jetons par un robot) et on journalise.
    // **Avant** de regarder s'il y a une session : sinon, un compte valide offrirait un angle mort à
    // qui teste des jetons depuis son navigateur connecté.
    if (check.raison === "format" || check.raison === "inconnue") {
      const encoreAdmis = await checkRateLimit("invitation_inconnue_ip", ip);
      await audit(null, "invitation.lien_inconnu", null, { ip, bloque: !encoreAdmis });
      await surveillerLiensInconnus();
      if (!encoreAdmis) {
        return (
          <PageAuth titre="Un instant">
            <Alerte type="attention">Trop de liens invalides depuis ta connexion. Réessaie dans une heure, ou demande ton lien à l&apos;administrateur.</Alerte>
          </PageAuth>
        );
      }
    }

    /*
     * **Déjà connecté(e) : on entre, sans rien renvoyer.**
     *
     * Le cas réel : l'application a été installée sur l'écran d'accueil depuis *cette* page, et
     * selon la version d'iOS l'icône rouvre cette adresse plutôt que `start_url`. Des mois plus
     * tard le jeton a expiré — mais la session, elle, peut très bien être ouverte (cookie de 12 h
     * glissantes, indépendant du lien : ouverte ce matin, elle tient jusqu'au soir). Répondre
     * « regarde ta boîte mail » à quelqu'un qui voulait juste ouvrir son application, et lui
     * renvoyer un lien dont il n'a pas besoin, n'a aucun sens.
     *
     * Le jeton, lui, **n'ouvre rien** : on ne crée aucune session, on ne consomme aucune invitation,
     * on constate seulement qu'une session existe déjà. Un lien révoqué pour raison de sécurité fait
     * exception : celui-là doit se dire, même à quelqu'un qui est dedans (`revocationDeSecurite`).
     */
    const connecte = await getCurrentUser();
    if (entrerMalgreLienInvalide(check, !!connecte) && connecte) {
      await audit({ id: connecte.id, email: connecte.email }, "invitation.lien_perime_deja_connecte", null, { raison: check.raison });
      redirect(suite);
    }

    /*
     * Lien expiré (4 mois) : on en renvoie un nouveau à la personne, au plus une fois par jour.
     *
     * **L'écran dit ce qui s'est réellement produit**. Il s'intitulait « Lien renouvelé » et
     * annonçait « un nouveau lien vient de partir » dans tous les cas, y compris quand rien ne
     * pouvait partir — période close, ou fiche sans adresse email. On envoyait alors quelqu'un
     * attendre devant une boîte mail où rien n'arriverait jamais, alors que le booléen d'issue
     * était déjà là, sous la main.
     */
    if (check.raison === "expiree" && check.invitation) {
      /*
       * **On ne renvoie rien au rendu : on le propose, et on attend l'appui**.
       *
       * Cette branche appelait `renouvelerLien` ici même, c'est-à-dire **pendant le rendu d'un GET**.
       * Or les messageries préchargent les liens d'un email : le vieil email de janvier suffisait à
       * déclencher un renouvellement que personne n'avait demandé. Quatrième occurrence de cette
       * famille dans le dossier, après l'ouverture d'un lien, la désinscription et la réponse de
       * présence — et la doctrine était déjà écrite : « au prochain lien d'email qui écrit, découper
       * d'emblée ».
       *
       * L'écran garde donc le patron de la page voisine : il dit ce qui va se passer, et le bouton
       * (POST, `renvoyerLienExpire`) le fait. Les contrôles ne bougent pas — période non close, adresse
       * renseignée, un renouvellement par jour et par personne.
       *
       * On ne peut pas savoir d'ici si l'envoi est **possible** sans écrire : on ne le promet donc pas.
       * L'écran propose, et c'est la réponse de l'action qui dit ce qui s'est réellement produit.
       */
      return (
        <PageAuth titre="Lien expiré" sousTitre="Les liens d'accès sont valables 4 mois.">
          <RenvoyerLienExpire token={token} />
        </PageAuth>
      );
    }
    return (
      <PageAuth titre="Lien non valide">
        <div className="flex flex-col gap-5">
          <Alerte type="erreur">{RAISONS_INVITATION[check.raison]}</Alerte>
          <p className="text-sm text-texte-secondaire">
            Les liens sont personnels et générés par l&apos;équipe : l&apos;administrateur peut t&apos;en renvoyer un.
          </p>
          <Link href="/connexion" className="-ml-2 inline-flex min-h-11 items-center justify-center self-start px-2 text-sm">
            Accès administrateur
          </Link>
        </div>
      </PageAuth>
    );
  }

  const [user, period] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: check.invitation.userId } }),
    db.period.findUniqueOrThrow({ where: { id: check.invitation.periodId } }),
  ]);
  const premiereFois = !check.invitation.usedAt;
  const action = connexionParInvitation.bind(null, token);
  return (
    <PageAuth
      titre={premiereFois ? `Bienvenue ${user.prenom} !` : `Bonjour ${user.prenom} !`}
      sousTitre={`Tu es invité(e) aux cours de la période « ${period.nom} ».`}
    >
      <form action={action} className="flex flex-col gap-5">
        <input type="hidden" name="suite" value={suite} />
        <p>
          {premiereFois
            ? "Pas de mot de passe à créer : ce lien est ta clé. Appuie sur le bouton pour ouvrir ton espace."
            : "Appuie sur le bouton pour ouvrir l'application sur cet appareil."}
        </p>
        {/* Adresse **masquée** : cet écran s'ouvre sur un simple GET, donc aussi pour un robot de
            messagerie ou pour qui retrouve l'URL dans un historique. Le début, la fin et le domaine
            suffisent à se reconnaître ; l'adresse entière n'a pas à s'afficher pour ça. */}
        <p className="text-sm text-texte-secondaire">
          Compte : <span className="break-words font-semibold text-texte">{masquerEmail(user.email)}</span>
        </p>
        {/* Une phrase, pas un détour : le lien reste la porte, le mot de passe est une option qu'on
            trouve ensuite dans son profil (l'ancre y mène directement). */}
        <p className="text-sm text-texte-secondaire">
          Une fois entré(e), tu peux aussi te définir un mot de passe pour te connecter depuis un appareil où tu n&apos;as pas ton lien — c&apos;est facultatif, dans{" "}
          <Link href="/profil#securite" className="font-semibold">
            Mon profil → Sécuriser mon compte
          </Link>
          .
        </p>
        <BoutonEnvoi taille="grande" pleineLargeur enCours="Ouverture…">
          Ouvrir l&apos;application
        </BoutonEnvoi>
      </form>
    </PageAuth>
  );
}
