import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/current-user";
import { etatCanal } from "@/lib/notifications/canaux";
import { testerWhatsApp } from "@/actions/admin";
import { Alerte } from "@/components/ui/Alerte";
import { Carte } from "@/components/ui/Carte";
import { Champ } from "@/components/ui/Champ";
import { FormulaireAction } from "@/components/ui/FormulaireAction";
import { EnTeteCanal } from "../EnTeteCanal";

export const metadata: Metadata = { title: "Canal WhatsApp" };

/**
 * Configuration du **canal WhatsApp** — pas encore disponible, et la page le dit franchement.
 *
 * L'envoi automatique demande un numéro dédié et un service auto-hébergé (conteneur WAHA ou Baileys)
 * à côté de l'application : tant que ce n'est pas branché, `envoyerWhatsApp` lève son erreur explicite
 * et aucune case WhatsApp n'est cochable dans l'écran Notifications. Le formulaire ci-dessous est là pour
 * montrer ce qu'il faudra renseigner : il est inerte (les valeurs viendront de la stack), et le bouton
 * de test ne fait **aucun appel réseau** — il affiche l'erreur du canal non configuré.
 */
export default async function PageCanalWhatsApp() {
  await requirePermission("settings.technical");
  const etat = await etatCanal("whatsapp");
  return (
    <div className="flex flex-col gap-5">
      <EnTeteCanal etat={etat} titre="Canal WhatsApp" />
      <Carte titre="Ce qu'il manque">
        <Alerte type="attention" titre="Canal pas encore disponible">
          L&apos;envoi automatique sur WhatsApp demande deux choses que le club n&apos;a pas encore : un{" "}
          <span className="font-semibold">numéro de téléphone dédié</span> et un{" "}
          <span className="font-semibold">service d&apos;envoi auto-hébergé</span> (un conteneur WAHA ou Baileys, sur le réseau Docker de la stack, jamais
          exposé publiquement). Tant que ce n&apos;est pas en place, rien ne peut partir, et les cases WhatsApp de l&apos;écran Notifications restent grisées.
        </Alerte>
        <p className="mt-4">
          En attendant, le <span className="font-semibold">partage manuel en un geste</span> reste disponible : sur chaque séance à venir, le bouton
          « Partager sur WhatsApp » ouvre WhatsApp avec le message déjà écrit (chiffres à jour) et l&apos;équipe choisit le groupe.
        </p>
      </Carte>
      <Carte titre="Réglages attendus (aperçu)">
        <p className="mb-3">
          Ces valeurs viendront des variables d&apos;environnement de la stack (Portainer), comme pour l&apos;email. Le formulaire est montré ici pour savoir
          quoi préparer : il n&apos;est pas encore actif.
        </p>
        <fieldset disabled className="flex flex-col gap-4 opacity-60">
          <legend className="sr-only">Réglages WhatsApp (à venir)</legend>
          <Champ
            label="URL de l'API d'envoi"
            name="whatsappApiUrl"
            type="url"
            placeholder="http://waha:3000/api/sendText"
            aide="Variable WHATSAPP_API_URL — l'adresse interne du conteneur d'envoi."
          />
          <Champ label="Jeton d'authentification" name="whatsappApiToken" type="password" placeholder="•••••••••" aide="Variable WHATSAPP_API_TOKEN — facultatif selon le service." />
          <Champ
            label="Identifiant du groupe destinataire"
            name="whatsappDestinataire"
            placeholder="1203…@g.us"
            aide="Variable WHATSAPP_DESTINATAIRE — le groupe (ou le numéro) qui reçoit les messages du club."
          />
        </fieldset>
        <div className="mt-4">
          <FormulaireAction action={testerWhatsApp} bouton="Envoyer un message de test" variante="secondaire" enCours="Envoi…">
            <p className="text-sm text-texte-secondaire">
              Le test dira exactement ce qui manque : tant qu&apos;aucun service n&apos;est branché, aucun appel n&apos;est tenté.
            </p>
          </FormulaireAction>
        </div>
      </Carte>
      <Carte titre="Le jour où un numéro est disponible">
        <ol className="flex list-decimal flex-col gap-2 pl-5">
          <li>Ajouter le conteneur d&apos;envoi (WAHA ou Baileys) à la stack, sur le réseau interne, et y rattacher le numéro dédié.</li>
          <li>
            Renseigner <code>WHATSAPP_API_URL</code>, <code>WHATSAPP_API_TOKEN</code> et <code>WHATSAPP_DESTINATAIRE</code> dans les variables de la stack.
          </li>
          <li>Écrire l&apos;envoi dans l&apos;application (même forme que Discord : POST JSON, trois tentatives, journal des envois).</li>
          <li>Les cases WhatsApp de l&apos;écran Notifications redeviennent alors cochables, notification par notification.</li>
        </ol>
      </Carte>
    </div>
  );
}
