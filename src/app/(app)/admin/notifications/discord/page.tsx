import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/current-user";
import { masquer } from "@/lib/crypto";
import { etatCanal } from "@/lib/notifications/canaux";
import { salonsParNotification } from "@/lib/notifications/webhooks";
import { enregistrerSalonDiscord, enregistrerSalonNotification, retirerSalonDiscord, retirerSalonNotification, testerSalonDiscord, testerSalonNotification } from "@/actions/admin";
import { Carte } from "@/components/ui/Carte";
import { Champ } from "@/components/ui/Champ";
import { FormulaireAction } from "@/components/ui/FormulaireAction";
import { BoutonAction } from "@/components/ui/BoutonAction";
import { Icone } from "@/components/ui/Icone";
import { EnTeteCanal } from "../EnTeteCanal";

export const metadata: Metadata = { title: "Canal Discord" };

/**
 * Configuration du **canal Discord** : brancher le salon principal du club (URL de webhook, stockée
 * chiffrée et jamais réaffichée en clair), le débrancher, envoyer un message de test — et, en
 * dessous, **un salon par notification** : une ligne par message qui part sur Discord, avec son
 * propre champ d'URL et son propre bouton d'essai. C'est le bouton par ligne qui permet de vérifier
 * chaque salon séparément ; un seul bouton global ne dirait rien des autres.
 *
 * Droits : la page vit dans l'espace admin, elle est donc réservée aux **administrateurs** en session
 * forte (mot de passe + code à usage unique), et le geste d'écriture demande en plus un code 2FA
 * récent. L'URL d'un webhook est un secret porteur : qui la détient écrit dans le salon au nom du
 * club. C'est le même réglage que Espace admin → Paramètres techniques, pas un doublon.
 */
export default async function PageCanalDiscord() {
  await requirePermission("settings.technical");
  const [etat, salons] = await Promise.all([etatCanal("discord"), salonsParNotification()]);
  return (
    <div className="flex flex-col gap-5">
      <EnTeteCanal etat={etat} titre="Canal Discord" />
      <Carte titre="Le salon du club">
        <FormulaireAction action={enregistrerSalonDiscord} bouton={etat.configure ? "Changer le salon" : "Brancher ce salon"}>
          <Champ
            label="URL du webhook Discord"
            name="discordWebhookUrl"
            type="url"
            placeholder="https://discord.com/api/webhooks/…"
            autoComplete="off"
            aide="Elle est enregistrée chiffrée côté serveur et n'est jamais réaffichée en clair. Elle remplace la variable DISCORD_WEBHOOK_URL de la stack."
          />
        </FormulaireAction>
        {/* Retirer une URL est un geste à part entière : une croix le dit sans détour, là où une
            case à cocher suivie d'un formulaire vide laisse toujours se demander si le champ vide
            va effacer le salon ou ne rien faire. */}
        {etat.configure && (
          <div className="mt-2">
            <BoutonAction action={retirerSalonDiscord} variante="danger" taille="petite" confirmation="Débrancher le salon principal ?">
              <Icone nom="alerte" taille={18} />
              Débrancher ce salon
            </BoutonAction>
          </div>
        )}
        <div className="mt-4">
          <FormulaireAction action={testerSalonDiscord} bouton="Envoyer un message de test" variante="secondaire" enCours="Envoi…">
            <p className="text-sm text-texte-secondaire">
              Un court message part sur le salon branché, signé de ton prénom. Rien n&apos;est modifié : c&apos;est la vérification à faire juste après avoir
              collé l&apos;URL.
            </p>
          </FormulaireAction>
        </div>
      </Carte>
      <Carte titre="Un salon par notification (facultatif)">
        <p className="mb-4 text-sm text-texte-secondaire">
          Chaque message peut partir dans son propre salon. Laissé vide, il part sur le salon du club ci-dessus : un club à salon unique n&apos;a rien à
          régler ici. Les URLs sont enregistrées chiffrées et ne sont jamais réaffichées en clair.
        </p>
        <ul className="flex flex-col gap-5">
          {salons.map((salon) => (
            <li key={salon.type} className="border-t border-bordure/60 pt-5 first:border-t-0 first:pt-0">
              <h3 className="font-semibold">{salon.titre}</h3>
              <p className="mt-1 text-sm text-texte-secondaire">{salon.quand}</p>
              <p className="mt-1 text-sm text-texte-secondaire">
                {salon.source === "dedie" ? (
                  <>
                    Salon dédié : <code>{masquer(salon.url, 28)}</code>
                  </>
                ) : salon.source === "herite" ? (
                  "Salon principal (aucun salon dédié)"
                ) : (
                  "Aucun salon branché, ni ici ni au-dessus : rien ne peut partir"
                )}
              </p>
              <div className="mt-3">
                <FormulaireAction action={enregistrerSalonNotification} bouton={salon.source === "dedie" ? "Changer le salon" : "Brancher un salon"}>
                  <input type="hidden" name="notification" value={salon.type} />
                  <Champ
                    label="URL du webhook Discord"
                    id={`salon-${salon.type}`}
                    name="url"
                    type="url"
                    placeholder="https://discord.com/api/webhooks/…"
                    autoComplete="off"
                  />
                </FormulaireAction>
              </div>
              {salon.source === "dedie" && (
                <div className="mt-2">
                  <BoutonAction
                    action={retirerSalonNotification.bind(null, salon.type)}
                    variante="danger"
                    taille="petite"
                    confirmation={`Retirer le salon dédié de « ${salon.titre} » ? Cette notification repartira sur le salon principal.`}
                  >
                    <Icone nom="alerte" taille={18} />
                    Retirer ce salon
                  </BoutonAction>
                </div>
              )}
              <div className="mt-3">
                <FormulaireAction action={testerSalonNotification} bouton="Envoyer un message de test" variante="secondaire" enCours="Envoi…">
                  <input type="hidden" name="notification" value={salon.type} />
                </FormulaireAction>
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-texte-secondaire">
          Les annonces d&apos;événements y sont <span className="font-semibold">tenues à jour</span> : un seul message par annonce, modifié sur place quand la
          date, le lieu, le prix ou l&apos;affiche changent, et barré « Annulé » si l&apos;annonce est retirée.
        </p>
      </Carte>
      <Carte titre="Créer le webhook, en trois gestes">
        <ol className="flex list-decimal flex-col gap-2 pl-5">
          <li>Dans Discord, ouvre les paramètres du salon qui doit recevoir les messages (la roue dentée à côté de son nom).</li>
          <li>
            Va dans <span className="font-semibold">Intégrations</span> → <span className="font-semibold">Webhooks</span> →{" "}
            <span className="font-semibold">Nouveau webhook</span>. Donne-lui le nom du club et, si tu veux, le logo.
          </li>
          <li>
            Clique sur <span className="font-semibold">Copier l&apos;URL du webhook</span>, puis colle-la ci-dessus et enregistre.
          </li>
        </ol>
        <p className="mt-3 text-sm text-texte-secondaire">
          L&apos;URL ressemble à <code>https://discord.com/api/webhooks/123…/AbC…</code>. Elle se révoque à tout moment depuis Discord (bouton
          « Supprimer » du webhook) : les envois s&apos;arrêtent alors d&apos;eux-mêmes, sans casser l&apos;application.
        </p>
      </Carte>
      <Carte titre="Ce qui n'est jamais publié">
        <p>
          <span className="font-semibold">Aucun nom de membre</span>, sur aucun de ces salons. Le récap de la veille donne la date, l&apos;horaire, le lieu,
          le thème, le programme du cours, la répartition des réponses (Présent, Peut-être, Absent, sans réponse), l&apos;effectif attendu et le mot du
          palier — des nombres, jamais des personnes. Les listes nominatives restent dans l&apos;application, derrière une connexion.
        </p>
        <p className="mt-3 text-sm text-texte-secondaire">
          Chaque message s&apos;active ou se coupe dans l&apos;écran Notifications, et n&apos;est envoyé qu&apos;une fois.
        </p>
      </Carte>
      <Carte titre="Côté serveur (Portainer)">
        <p>
          À défaut d&apos;URL collée ici, l&apos;application utilise la variable d&apos;environnement <code>DISCORD_WEBHOOK_URL</code> de la stack. Les deux
          désignent le même réglage : la valeur enregistrée dans l&apos;application a la priorité, et la débrancher fait revenir à la variable.
        </p>
      </Carte>
    </div>
  );
}
