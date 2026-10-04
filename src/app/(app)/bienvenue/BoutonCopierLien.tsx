"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Bouton } from "@/components/ui/Bouton";
import { Icone } from "@/components/ui/Icone";

/**
 * **Copier son lien personnel**, au seul moment où l'application le connaît en clair.
 *
 * À quoi ça sert : sur iPhone, l'application installée a un stockage séparé de Safari. Un lien
 * touché dans Mail ouvre Safari et n'entrera jamais dans l'icône posée sur l'écran d'accueil. Le
 * seul passage est de coller le lien dans le champ prévu sur la page de connexion de l'application.
 *
 * Même mécanique de copie que `components/partage/BoutonPartager` — presse-papiers, et, s'il est
 * refusé, le lien affiché déjà sélectionné —, mais sans le partage natif ni WhatsApp : un lien
 * personnel ne se transmet à personne, l'offrir au partage serait inviter à la faute.
 *
 * La copie réussie enchaîne sur `/connexion?lien=copie`, où le champ de collage attend, en
 * évidence : le geste utile n'est pas « copier », c'est « copier **puis** coller dans
 * l'application ». Montrer tout de suite où coller rend la suite évidente. Si le presse-papiers
 * est refusé, on ne bouge pas : envoyer quelqu'un coller un lien qu'il n'a pas copié n'aiderait
 * personne. Et jamais le lien ni le jeton dans l'adresse de destination : un jeton n'a rien à
 * faire dans une barre d'adresse ni dans le journal d'un serveur.
 */

/** La confirmation s'efface d'elle-même : une copie réussie n'a pas à rester à l'écran. */
const DUREE_CONFIRMATION = 3000;

/** Le champ de collage de la page de connexion, mis en évidence — sans rien dire du lien lui-même. */
const OU_COLLER = "/connexion?lien=copie";

type Props = {
  lien: string;
  /** Où l'on va après une copie réussie (défaut : le champ de collage de la page de connexion). */
  destination?: string;
  /**
   * Naviguer **même si** le presse-papiers a été refusé. Pour « Continuer avec mon lien », dont
   * l'objet est d'entrer dans l'application : la copie est un service rendu au passage, pas la
   * condition du geste. Pour « Copier mon lien », au contraire, on reste sur place — envoyer
   * quelqu'un coller un lien qu'il n'a pas copié n'aiderait personne.
   */
  toujoursNaviguer?: boolean;
  titre?: string;
  description?: string;
  libelle?: string;
  variante?: "primaire" | "secondaire";
};

export function BoutonCopierLien({ lien, destination = OU_COLLER, toujoursNaviguer = false, titre, description, libelle, variante = "secondaire" }: Props) {
  const router = useRouter();
  const [copie, setCopie] = useState(false);
  const [repli, setRepli] = useState(false);
  const champRepli = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!copie) return;
    const t = setTimeout(() => setCopie(false), DUREE_CONFIRMATION);
    return () => clearTimeout(t);
  }, [copie]);

  // Le champ de repli n'a de sens que prêt à être copié : on le sélectionne dès qu'il paraît
  useEffect(() => {
    if (repli) champRepli.current?.select();
  }, [repli]);

  const copier = async () => {
    try {
      await navigator.clipboard.writeText(lien);
      setRepli(false);
      setCopie(true);
      router.push(destination);
    } catch {
      // Presse-papiers refusé (contexte non sécurisé, permission bloquée) : le lien s'offre à la main
      setCopie(false);
      setRepli(true);
      if (toujoursNaviguer) router.push(destination);
    }
  };

  return (
    <section className="rounded-2xl border border-bordure/60 bg-surface p-5 shadow-carte">
      <h2 className="flex items-center gap-2 text-xl font-bold">
        <Icone nom="copie" className="text-primaire" /> {titre ?? "Garde ton lien sous la main"}
      </h2>
      <p className="mt-2">
        {description ??
          "Une fois l'application installée sur un iPhone, elle ne reçoit pas les liens ouverts depuis Mail : pour y entrer, il faut lui donner ton lien à la main. Copie-le ici, ouvre l'application depuis ton écran d'accueil, et colle-le dans le champ prévu sur sa page de connexion."}
      </p>
      <Bouton type="button" variante={variante} taille="grande" pleineLargeur className="mt-4" onClick={copier}>
        <Icone nom={copie ? "check" : "copie"} taille={20} />
        {copie ? "Lien copié" : (libelle ?? "Copier mon lien")}
      </Bouton>
      {/* Une seule zone d'annonce : ce que le lecteur d'écran entend est ce qui s'affiche */}
      <p aria-live="polite" className="sr-only">
        {copie ? "Lien copié" : ""}
      </p>
      {repli && (
        <label className="mt-3 flex flex-col gap-1 text-sm text-texte-secondaire">
          Ton navigateur refuse le presse-papiers : le lien est sélectionné, copie-le à la main.
          <input
            ref={champRepli}
            type="text"
            readOnly
            value={lien}
            onFocus={(e) => e.currentTarget.select()}
            className="min-h-11 w-full rounded-xl border-2 border-bordure bg-surface px-3 text-[0.9375rem] text-texte"
          />
        </label>
      )}
    </section>
  );
}
