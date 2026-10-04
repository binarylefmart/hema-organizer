"use client";

import { useState } from "react";
import { testerNotificationEmail } from "@/actions/profil";
import { testerPush } from "@/actions/push";
import { Alerte } from "@/components/ui/Alerte";
import { Bouton } from "@/components/ui/Bouton";
import { Icone } from "@/components/ui/Icone";

type Props = {
  /** La personne a-t-elle une adresse email ? (elle est facultative dans le club) */
  aUnEmail: boolean;
  /** Au moins un appareil est abonné aux notifications */
  pushBranche: boolean;
};

/**
 * **Tester mes notifications** — un bouton par canal, **indépendants l'un de l'autre**.
 *
 * On ne teste pas « les notifications » en bloc : on veut savoir si l'email arrive *ou* si le
 * téléphone sonne, et souvent l'un des deux seulement (une adresse qui filtre, un appareil qu'on
 * vient de changer). Chaque bouton part donc seul, et rend sa propre réponse.
 *
 * Un canal qui ne peut rien envoyer n'affiche pas un bouton qui échouerait : sans adresse email ou
 * sans appareil abonné, la ligne explique ce qui manque et où le régler. C'est la même règle que
 * partout ailleurs dans l'application — on ne propose pas un geste qui ne peut pas aboutir.
 */
export function TesterNotifications({ aUnEmail, pushBranche }: Props) {
  const [message, setMessage] = useState<{ ton: "succes" | "erreur"; texte: string } | null>(null);
  const [occupe, setOccupe] = useState<"email" | "push" | null>(null);

  async function essayer(canal: "email" | "push") {
    setOccupe(canal);
    setMessage(null);
    const res = canal === "email" ? await testerNotificationEmail() : await testerPush();
    setMessage(res.erreur ? { ton: "erreur", texte: res.erreur } : { ton: "succes", texte: res.succes ?? "C'est parti." });
    setOccupe(null);
  }

  return (
    <div className="mt-5 rounded-xl border border-bordure/60 bg-surface-douce/40 p-3">
      <p className="font-semibold">Tester mes notifications</p>
      <p className="mt-0.5 text-sm text-texte-secondaire">
        Un message d&apos;essai, envoyé à toi seul(e) : de quoi vérifier que tu reçois bien, sans attendre le prochain cours.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Bouton type="button" variante="secondaire" taille="petite" disabled={!aUnEmail || occupe !== null} onClick={() => essayer("email")}>
          <Icone nom="info" taille={18} />
          {occupe === "email" ? "Envoi…" : "Un email de test"}
        </Bouton>
        <Bouton type="button" variante="secondaire" taille="petite" disabled={!pushBranche || occupe !== null} onClick={() => essayer("push")}>
          <Icone nom="info" taille={18} />
          {occupe === "push" ? "Envoi…" : "Une notification de test"}
        </Bouton>
      </div>
      {!aUnEmail && <p className="mt-2 text-sm text-texte-secondaire">Aucune adresse email sur ton compte : demande à un administrateur de l&apos;ajouter.</p>}
      {!pushBranche && <p className="mt-2 text-sm text-texte-secondaire">Aucun appareil activé pour les notifications : c&apos;est la carte juste au-dessus.</p>}
      {message && (
        <div className="mt-3">
          <Alerte type={message.ton === "succes" ? "succes" : "erreur"}>{message.texte}</Alerte>
        </div>
      )}
    </div>
  );
}
