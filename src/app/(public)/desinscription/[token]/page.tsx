import type { Metadata } from "next";
import Link from "next/link";
import { apercuDesinscription, PHRASE_DESINSCRIPTION } from "@/lib/notifications/desinscription";
import { PageAuth } from "@/components/layout/PageAuth";
import { Alerte } from "@/components/ui/Alerte";
import { BoutonEnvoi } from "@/components/ui/BoutonEnvoi";
import { confirmerDesinscription, reactiverRappels } from "../actions";

export const metadata: Metadata = { title: "Rappels" };

type Props = { params: Promise<{ token: string }>; searchParams: Promise<{ etat?: string }> };

/** Le lien n'ouvre aucune session : il ne sait rien faire d'autre que basculer `rappelEmail`. */
function LienRetour({ libelle = "Revenir à l'application" }: { libelle?: string }) {
  return (
    <p className="text-center text-sm">
      <Link href="/" className="inline-flex min-h-11 items-center justify-center px-2">
        {libelle}
      </Link>
    </p>
  );
}

function LienInvalide() {
  return (
    <PageAuth titre="Lien non valide">
      <div className="flex flex-col gap-5">
        <Alerte type="erreur">
          Ce lien de désinscription a expiré ou n&apos;est plus valide. Tu peux régler les rappels depuis « Mon profil », dans l&apos;application.
        </Alerte>
        <LienRetour />
      </div>
    </PageAuth>
  );
}

/**
 * Désinscription des rappels par email, depuis le pied des emails (lien signé, valable un an).
 *
 * Aucune connexion n'est demandée — c'est le principe d'un lien de désinscription — mais **ouvrir
 * la page n'écrit rien** : elle demande confirmation, et c'est le bouton (POST,
 * `confirmerDesinscription`) qui coupe les rappels.
 *
 * **Pourquoi un bouton, et pas une coupure à l'ouverture.** Les messageries préchargent les liens
 * des emails (Outlook Safe Links, antivirus, générateurs d'aperçu) : tant que le GET écrivait, il
 * suffisait qu'un robot passe sur le lien pour désinscrire quelqu'un qui n'avait rien cliqué — sans
 * qu'il le sache, et pour un an, puisque le jeton vaut un an et se rejoue. Même découpage que
 * `/invitation/[token]`, qui l'explique en détail, et que le bouton « Réactiver » d'ici.
 *
 * Trois écrans, un seul appui chacun : la question, « c'est fait » (`?etat=inactif`), et le retour
 * en arrière (`?etat=actif`).
 */
export default async function PageDesinscription({ params, searchParams }: Props) {
  const { token } = await params;
  const { etat } = await searchParams;

  // Lecture seule, dans tous les cas : on regarde qui est derrière le jeton, on n'écrit jamais ici
  const res = await apercuDesinscription(token);
  if (!res.ok) return <LienInvalide />;

  // Retour du bouton « Réactiver »
  if (etat === "actif") {
    return (
      <PageAuth titre="Rappels réactivés">
        <form action={confirmerDesinscription.bind(null, token)} className="flex flex-col gap-5">
          <Alerte type="succes">Tu recevras de nouveau le rappel la veille de chaque cours, par email et sur ton téléphone.</Alerte>
          <p className="text-sm text-texte-secondaire">Changé d&apos;avis ?</p>
          <BoutonEnvoi variante="secondaire" taille="grande" pleineLargeur enCours="Un instant…">
            Me désinscrire à nouveau
          </BoutonEnvoi>
          <LienRetour />
        </form>
      </PageAuth>
    );
  }

  // Retour du bouton « Ne plus recevoir » : c'est fait, et on propose l'inverse
  if (etat === "inactif") {
    return (
      <PageAuth titre={res.prenom ? `C'est fait, ${res.prenom}` : "C'est fait"}>
        <form action={reactiverRappels.bind(null, token)} className="flex flex-col gap-5">
          <Alerte type="succes">Tu ne recevras plus les rappels.</Alerte>
          <p className="text-texte-secondaire">
            {PHRASE_DESINSCRIPTION} Les messages indispensables — ton lien d&apos;accès, l&apos;annulation d&apos;un cours — continuent de partir.
          </p>
          <p className="text-texte-secondaire">Ta présence aux cours se répond comme avant, depuis l&apos;application.</p>
          <BoutonEnvoi variante="secondaire" taille="grande" pleineLargeur enCours="Un instant…">
            Réactiver les rappels
          </BoutonEnvoi>
          <LienRetour />
        </form>
      </PageAuth>
    );
  }

  // Écran d'arrivée : la question, et rien d'autre
  return (
    <PageAuth titre={res.prenom ? `Ne plus recevoir les rappels, ${res.prenom} ?` : "Ne plus recevoir les rappels ?"}>
      <form action={confirmerDesinscription.bind(null, token)} className="flex flex-col gap-5">
        <p className="text-texte-secondaire">
          {PHRASE_DESINSCRIPTION} Les messages indispensables — ton lien d&apos;accès, l&apos;annulation d&apos;un cours — continuent de partir.
        </p>
        <p className="text-texte-secondaire">Ta présence aux cours se répond comme avant, depuis l&apos;application.</p>
        <BoutonEnvoi variante="danger" taille="grande" pleineLargeur enCours="Un instant…">
          Ne plus recevoir les rappels
        </BoutonEnvoi>
        <LienRetour libelle="Non, garder les rappels" />
      </form>
    </PageAuth>
  );
}
