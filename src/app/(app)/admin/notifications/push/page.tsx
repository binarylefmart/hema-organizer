import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/current-user";
import { db } from "@/lib/db";
import { etatCanal } from "@/lib/notifications/canaux";
import { COUPLES_EMIS, DESCRIPTIONS, TYPES_NOTIFICATION } from "@/lib/notifications/preferences";
import { Alerte } from "@/components/ui/Alerte";
import { Carte } from "@/components/ui/Carte";
import { EnTeteCanal } from "../EnTeteCanal";

export const metadata: Metadata = { title: "Canal Téléphone" };

/**
 * Configuration du **canal Téléphone** (Web Push) — la page la plus courte des quatre, et c'est
 * volontaire : il n'y a **rien à configurer côté serveur**. La paire de clés VAPID se crée toute
 * seule au premier besoin et vit chiffrée en base (`src/lib/notifications/push.ts`), donc aucune
 * variable à ajouter dans Portainer et rien à regénérer à la main.
 *
 * Ce qui peut manquer, ce ne sont pas des réglages mais des **appareils abonnés** : chacun active
 * les notifications depuis « Mon profil », appareil par appareil. La page montre donc l'état du
 * canal, le nombre d'appareils qui recevraient un envoi aujourd'hui, et ce qui part par ce canal.
 *
 * Droits : comme les autres pages de canal, elle vit dans l'espace admin et demande une session
 * forte (`settings.technical`).
 */
export default async function PageCanalPush() {
  await requirePermission("settings.technical");
  const [etat, appareils] = await Promise.all([etatCanal("push"), db.pushAbonnement.count()]);
  const surPush = TYPES_NOTIFICATION.filter((t) => COUPLES_EMIS[t].includes("push"));
  return (
    <div className="flex flex-col gap-5">
      <EnTeteCanal etat={etat} titre="Canal Téléphone" />
      <Carte titre="Appareils abonnés">
        <p className="text-3xl font-bold">
          {appareils}
          <span className="ml-2 text-base font-normal text-texte-secondaire">
            appareil{appareils > 1 ? "s" : ""} recevrait{appareils > 1 ? "ent" : ""} un envoi aujourd&apos;hui
          </span>
        </p>
        <p className="mt-3">
          Un même membre peut en compter plusieurs (son téléphone, sa tablette, son ordinateur) : le compte porte sur les appareils, pas sur les personnes.
          Un appareil réinstallé, ou dont la personne a coupé les notifications, disparaît tout seul de la liste au premier envoi refusé.
        </p>
        {appareils === 0 && (
          <div className="mt-4">
            <Alerte type="attention" titre="Personne n'est encore abonné">
              Le canal est prêt côté serveur, mais aucun appareil n&apos;écoute : les envois partiront dans le vide tant que personne n&apos;a activé les
              notifications. Commence par toi, depuis{" "}
              <Link href="/profil" className="font-semibold text-lien">
                Mon profil
              </Link>
              , pour vérifier que tout fonctionne.
            </Alerte>
          </div>
        )}
      </Carte>
      <Carte titre="Rien à configurer côté serveur">
        <p>
          Contrairement à l&apos;email (serveur SMTP) ou à Discord (URL de webhook), ce canal ne demande <span className="font-semibold">aucun réglage</span>{" "}
          et aucune variable dans Portainer. Les clés d&apos;envoi — la paire dite « VAPID » — sont engendrées automatiquement au premier besoin et rangées
          chiffrées en base, dans le volume de données : elles survivent aux mises à jour de l&apos;image, et ne doivent jamais être remplacées (tous les
          appareils abonnés devraient se réabonner).
        </p>
        <p className="mt-3">
          Le serveur du club ne parle d&apos;ailleurs jamais au téléphone directement : il dépose un message chiffré chez le service de push du navigateur
          (Apple, Mozilla, Google), qui le remet à l&apos;appareil, même application fermée. Ce service ne peut pas lire le message.
        </p>
      </Carte>
      <Carte titre="Comment un membre s'abonne">
        <ol className="flex list-decimal flex-col gap-2 pl-5">
          <li>
            Il ouvre <span className="font-semibold">Mon profil</span> et active les notifications sur l&apos;appareil qu&apos;il a en main. Le navigateur
            demande son accord : sans ce « oui », rien ne peut partir.
          </li>
          <li>
            <span className="font-semibold">Sur iPhone et iPad</span>, il faut d&apos;abord ajouter l&apos;application à l&apos;écran d&apos;accueil (bouton
            Partager → « Sur l&apos;écran d&apos;accueil »), avec iOS 16.4 ou plus récent : en dehors de l&apos;application installée, Safari ne propose même
            pas les notifications.
          </li>
          <li>Il recommence sur chaque appareil où il veut être prévenu : l&apos;abonnement vaut pour un appareil, pas pour un compte.</li>
        </ol>
        <p className="mt-3 text-sm text-texte-secondaire">
          Rien de tout cela ne se fait depuis l&apos;administration : personne ne peut abonner quelqu&apos;un d&apos;autre, c&apos;est le navigateur qui tient
          l&apos;autorisation.
        </p>
      </Carte>
      <Carte titre="Ce qui part sur le téléphone">
        <ul className="flex flex-col gap-2">
          {surPush.map((type) => (
            <li key={type}>
              <span className="font-semibold">{DESCRIPTIONS[type].titre}</span> — {DESCRIPTIONS[type].quand}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-texte-secondaire">
          Chaque case s&apos;active ou se coupe dans l&apos;écran Notifications, et chaque membre garde ses propres choix dans son profil : le club décide de
          ce qu&apos;il envoie, la personne peut seulement en retrancher.
        </p>
      </Carte>
    </div>
  );
}
