import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { formatDateLongue, formatHoraire } from "@/lib/dates";
import { porteurJetonAnnulation } from "@/lib/notifications/seances";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { clientIp } from "@/lib/request-info";
import { annulerDepuisEmail } from "@/actions/seances";
import { PageAuth } from "@/components/layout/PageAuth";
import { Alerte } from "@/components/ui/Alerte";
import { BoutonEnvoi } from "@/components/ui/BoutonEnvoi";
import { Champ } from "@/components/ui/Champ";

export const metadata: Metadata = { title: "Annuler la séance" };

type Props = { params: Promise<{ token: string }>; searchParams: Promise<{ fait?: string; erreur?: string }> };

/**
 * Confirmation d'annulation depuis l'email « peu de monde » (lien signé, valable une semaine).
 *
 * Page en lecture seule : elle vérifie le lien et montre la séance, c'est le bouton qui envoie le
 * POST (`annulerDepuisEmail`). Le jeton est nominatif : il n'ouvre cet écran qu'au compte auquel
 * l'email est parti, et seulement s'il est toujours actif et habilité à annuler une séance.
 */
export default async function PageAnnuler({ params, searchParams }: Props) {
  const { token } = await params;
  const { fait, erreur } = await searchParams;

  // Page publique ouverte depuis un email : on borne les ouvertures par adresse, comme /invitation
  if (!(await checkRateLimit("annulation_ip", await clientIp()))) {
    return (
      <PageAuth titre="Un instant">
        <Alerte type="attention">Trop de tentatives. Réessaie dans quelques minutes.</Alerte>
      </PageAuth>
    );
  }

  const porteur = await porteurJetonAnnulation(token);
  const seance = porteur ? await db.session.findUnique({ where: { id: porteur.sessionId }, select: { date: true, heureDebut: true, heureFin: true, lieu: true, annulee: true, motifAnnulation: true, annulationLienUtiliseLe: true } }) : null;

  if (!seance) {
    return (
      <PageAuth titre="Lien non valide">
        <Alerte type="erreur">Ce lien d&apos;annulation a expiré ou n&apos;est plus valide. Ouvre l&apos;application pour annuler la séance.</Alerte>
      </PageAuth>
    );
  }
  if (fait === "ok" || seance.annulee) {
    return (
      <PageAuth titre="Séance annulée" sousTitre={formatDateLongue(seance.date)}>
        <div className="flex flex-col gap-4">
          <Alerte type="succes">Les membres invités ont été prévenus par email{seance.motifAnnulation ? ` — motif : ${seance.motifAnnulation}` : ""}.</Alerte>
          <Link href="/planning" className="-ml-2 inline-flex min-h-11 items-center justify-center self-start px-2">
            Voir le planning
          </Link>
        </div>
      </PageAuth>
    );
  }

  // Lien déjà consommé alors que la séance est de nouveau debout : elle a été rétablie, puis
  // réannulée depuis l'application, ou l'inverse. Le lien, lui, a fait son office une fois pour
  // toutes — on le dit plutôt que de proposer un bouton qui refuserait.
  if (seance.annulationLienUtiliseLe) {
    return (
      <PageAuth titre="Lien déjà utilisé" sousTitre={formatDateLongue(seance.date)}>
        <div className="flex flex-col gap-4">
          <Alerte type="attention">Ce lien d&apos;annulation a déjà servi une fois. Ouvre l&apos;application pour annuler cette séance.</Alerte>
          <Link href="/planning" className="-ml-2 inline-flex min-h-11 items-center justify-center self-start px-2">
            Voir le planning
          </Link>
        </div>
      </PageAuth>
    );
  }

  const action = annulerDepuisEmail.bind(null, token);
  return (
    <PageAuth titre="Annuler cette séance ?" sousTitre={`${formatDateLongue(seance.date)} · ${formatHoraire(seance.heureDebut, seance.heureFin)} · ${seance.lieu}`}>
      <form action={action} className="flex flex-col gap-5">
        {erreur === "deja" && <Alerte type="erreur">Ce lien d&apos;annulation a déjà servi. Ouvre l&apos;application pour annuler la séance.</Alerte>}
        {erreur === "trop" && <Alerte type="erreur">Trop d&apos;annulations depuis ce lien en peu de temps. Réessaie plus tard, ou annule depuis l&apos;application.</Alerte>}
        <Alerte type="attention">Les membres invités recevront aussitôt un email leur annonçant l&apos;annulation.</Alerte>
        {/* L'étiquette disait « envoyé aux membres » : c'était trompeur, et à l'endroit précis où
            l'on est le moins sur ses gardes — cet écran s'ouvre depuis un email, sans connexion.
            Ce motif part aussi sur le salon Discord, sur la page de partage et sur le site du club.
            Même avertissement, mot pour mot, que sur l'écran interne d'une séance. */}
        <Champ
          label="Motif — rendu public"
          name="motif"
          defaultValue="Trop peu de participants"
          required
          maxLength={200}
          aide="Ce motif est visible par tous : les membres par email, le salon Discord, et le site du club. Évite les noms."
        />
        <BoutonEnvoi variante="danger" taille="grande" pleineLargeur enCours="Annulation…">
          Confirmer l&apos;annulation
        </BoutonEnvoi>
        <p className="text-center text-sm">
          <Link href="/planning" className="inline-flex min-h-11 items-center justify-center px-2">
            Non, garder la séance
          </Link>
        </p>
      </form>
    </PageAuth>
  );
}
