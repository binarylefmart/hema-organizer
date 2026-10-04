import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/current-user";
import { etatCanal } from "@/lib/notifications/canaux";
import { getTelegramReglage } from "@/lib/notifications/telegram";
import { chercherSalonsTelegram, enregistrerTelegram, retirerTelegram, testerTelegram } from "@/actions/admin";
import { BoutonAction } from "@/components/ui/BoutonAction";
import { Carte } from "@/components/ui/Carte";
import { Champ } from "@/components/ui/Champ";
import { FormulaireAction } from "@/components/ui/FormulaireAction";
import { Icone } from "@/components/ui/Icone";
import { EnTeteCanal } from "../EnTeteCanal";

export const metadata: Metadata = { title: "Canal Telegram" };

/**
 * Configuration du **canal Telegram** : un bot, un salon, et les messages collectifs du club y
 * tombent — le récap de la veille, les annulations, l'alerte « peu de monde », les événements.
 *
 * **Pourquoi ce canal existe à côté de Discord.** Tous les clubs ne vivent pas sur Discord ;
 * beaucoup tiennent un groupe Telegram, que tout le monde a déjà sur son téléphone. C'est donc un
 * second débouché du **même** contenu, pas une fonctionnalité parallèle : ce qui est écrit une fois
 * part sur les deux, et une correction se voit sur les deux.
 *
 * **Deux valeurs, et une seule difficulté.** Le jeton s'obtient en trois messages à `@BotFather`.
 * L'identifiant du salon, lui, ne s'affiche nulle part dans Telegram : la marche à suivre habituelle
 * consiste à ouvrir une URL d'API dans son navigateur et à y lire du JSON, ce qu'on ne demande pas au
 * bureau d'un club. D'où le bouton « Chercher mes salons », qui fait ce relevé et affiche les noms.
 *
 * Droits : espace admin, donc **administrateur en session forte**, et l'enregistrement demande en
 * plus un code 2FA récent. Le jeton est un secret porteur — qui le détient écrit au nom du club et
 * lit ce que le bot voit : il est rangé chiffré et **jamais réaffiché**.
 */
export default async function PageCanalTelegram() {
  await requirePermission("settings.technical");
  const [etat, reglage] = await Promise.all([etatCanal("telegram"), getTelegramReglage()]);
  return (
    <div className="flex flex-col gap-5">
      <EnTeteCanal etat={etat} titre="Canal Telegram" />

      <Carte titre="Le salon du club">
        <FormulaireAction action={enregistrerTelegram} bouton={etat.configure ? "Mettre à jour" : "Brancher ce salon"}>
          <Champ
            label="Jeton du bot"
            name="token"
            type="password"
            placeholder={etat.configure ? "•••••••••  (laisser vide pour conserver)" : "123456789:AA…"}
            autoComplete="off"
            aide={
              etat.configure
                ? "Enregistré chiffré, jamais réaffiché. Laisse ce champ vide pour garder le jeton actuel et ne changer que le salon."
                : "Donné par @BotFather sur Telegram. Il est enregistré chiffré côté serveur et n'est jamais réaffiché."
            }
          />
          <Champ
            label="Identifiant du salon"
            name="chatId"
            defaultValue={reglage.chatId}
            placeholder="-1001234567890  ou  @mon_canal"
            autoComplete="off"
            aide="Un groupe a un identifiant négatif ; un canal public peut se désigner par son @nom. Le bouton ci-dessous le trouve pour toi."
          />
        </FormulaireAction>

        {/* Débrancher est un geste à part : une croix le dit sans détour, là où un champ vidé
            laisserait se demander si l'on efface ou si l'on ne change rien. */}
        {etat.configure && (
          <div className="mt-2">
            <BoutonAction action={retirerTelegram} variante="danger" taille="petite" confirmation="Débrancher le canal Telegram ?">
              <Icone nom="croix" taille={18} />
              Débrancher ce canal
            </BoutonAction>
          </div>
        )}

        <div className="mt-4">
          <FormulaireAction action={testerTelegram} bouton="Envoyer un message de test" variante="secondaire" enCours="Envoi…">
            <p className="text-sm text-texte-secondaire">
              Un court message part sur le salon branché, signé de ton prénom. C&apos;est la vérification à faire juste après avoir collé le jeton.
            </p>
          </FormulaireAction>
        </div>
      </Carte>

      <Carte titre="Trouver l'identifiant du salon">
        <ol className="mb-4 flex list-decimal flex-col gap-2 pl-5">
          <li>
            Dans Telegram, écris à <span className="font-semibold">@BotFather</span>, envoie <code>/newbot</code>, choisis un nom : il répond avec le jeton.
          </li>
          <li>Ajoute le bot au groupe (ou au canal) du club, comme un membre ordinaire.</li>
          <li>
            Écris <span className="font-semibold">n&apos;importe quel message</span> dans ce groupe : c&apos;est ce qui rend le salon visible au bot.
          </li>
          <li>Colle le jeton ci-dessous et appuie sur « Chercher mes salons ».</li>
        </ol>
        <FormulaireAction action={chercherSalonsTelegram} bouton="Chercher mes salons" variante="secondaire" enCours="Recherche…">
          <Champ
            label="Jeton du bot (si tu ne l'as pas encore enregistré)"
            name="token"
            type="password"
            placeholder={etat.configure ? "laisser vide : le jeton enregistré sera utilisé" : "123456789:AA…"}
            autoComplete="off"
            aide="Telegram ne garde ces messages que 24 h : si la liste revient vide, réécris un message dans le groupe et recommence."
          />
        </FormulaireAction>
      </Carte>

      <Carte titre="Ce qui part sur Telegram">
        <p className="mb-3">
          Les messages <span className="font-semibold">collectifs</span>, ceux qui ne nomment personne : le récap de la veille, les annulations de cours,
          l&apos;alerte « peu de monde » et les annonces d&apos;événements. Chaque message se coche ou se décoche ligne par ligne dans l&apos;écran{" "}
          <span className="font-semibold">Notifications</span>.
        </p>
        <p className="text-sm text-texte-secondaire">
          Les messages <span className="font-semibold">personnels</span> — le rappel à qui n&apos;a pas répondu, la réponse à une proposition d&apos;atelier —
          ne partent jamais ici : ils nomment quelqu&apos;un, et un groupe est public. Ceux-là restent l&apos;email et la notification sur le téléphone.
        </p>
        <p className="mt-3 text-sm text-texte-secondaire">
          Une annonce d&apos;événement est publiée <span className="font-semibold">une fois</span> sur Telegram ; corrigée ensuite, elle n&apos;est pas
          réécrite dans le groupe (c&apos;est le salon Discord qui, lui, tient son message à jour).
        </p>
      </Carte>
    </div>
  );
}
