"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { CLASSE_LIGNE, ContenuLigne } from "@/components/ui/ListeGroupee";
import { idsRangeesNotification, resumeCanaux } from "./ligne-notification";

/**
 * **La matrice au téléphone : une ligne par notification** (version téléphone seulement ; sur ordinateur, la
 * fiche et le tableau d'hier, au pixel près).
 *
 * Replié, le `tbody` d'une notification ne montre qu'un bouton — son nom, et à droite le résumé de
 * ses canaux cochés (« Email · Discord », « 4 canaux », « Tous », « Aucun »). Toucher le bouton déplie, juste en
 * dessous, **les rangées de la matrice elles-mêmes** : mêmes cases, mêmes cases grisées avec leur
 * raison, même « Envoi par email », dans le même formulaire.
 *
 * **Le formulaire ne voit aucune différence, et c'est tout l'objet de ce composant** : les rangées
 * repliées sont **cachées, jamais démontées** — une règle CSS (`STYLE_LIGNES_NOTIFICATION`, `ligne-notification.ts`) leur
 * retire l'affichage en version téléphone tant que le `tbody` porte `data-replie`. Leurs cases restent dans
 * le DOM et partent à l'enregistrement exactement comme avant ; les grisées restent `disabled`,
 * donc absentes, et `figerCanauxIndisponibles` les fige côté serveur comme avant. Aucun champ n'est
 * rendu deux fois : il n'y a qu'un seul arbre, le bouton n'a pas de `name`.
 *
 * Le résumé suit les cases **au fil de la saisie** : il est relu dans le DOM à chaque changement
 * (et après chaque rendu, pour reprendre la valeur du serveur après un enregistrement). Le premier
 * rendu, côté serveur, reçoit le même résumé calculé depuis la base.
 *
 * **Pas de `ListeGroupee` ici** : ses lignes sont des `<div>`, et une notification est un `tbody`
 * dans le `<table>` du formulaire unique. La ligne en reprend tout le reste — classes, hauteur,
 * titre, résumé et chevron (`CLASSE_LIGNE`, `ContenuLigne`) —, sans marge latérale : elle est déjà
 * dans la carte.
 */

type Props = {
  type: string;
  titre: string;
  /** Les canaux de la notification, dans l'ordre des colonnes : l'identifiant de la case et son nom. */
  canaux: ReadonlyArray<{ id: string; libelle: string }>;
  /** Le résumé du rendu serveur, depuis la base. */
  resume: string;
  className: string;
  children: ReactNode;
};

export function LigneNotification({ type, titre, canaux, resume, className, children }: Props) {
  const [ouvert, setOuvert] = useState(false);
  // Le résumé relu dans les cases ; `null` tant qu'on n'a rien relu (premier rendu : celui du serveur).
  const [relu, setRelu] = useState<string | null>(null);
  const ref = useRef<HTMLTableSectionElement>(null);

  const relire = () => {
    const corps = ref.current;
    if (!corps) return;
    const coches = canaux.filter((c) => corps.querySelector<HTMLInputElement>(`#${CSS.escape(c.id)}`)?.checked).map((c) => c.libelle);
    const texte = resumeCanaux(coches, canaux.length);
    setRelu((avant) => (avant === texte ? avant : texte));
  };

  // Après chaque rendu : un enregistrement remonte les cases sur la valeur du serveur (clé de
  // remontage), et le résumé doit la reprendre. Ne réécrit l'état que si le texte change.
  useEffect(relire);

  // Les deux rangées que le bouton déplie (cases, puis « Envoi par email ») : un `tbody` ne peut
  // pas les envelopper, `aria-controls` les nomme donc toutes deux (`idsRangeesNotification`).
  const [idCases, idMode] = idsRangeesNotification(type);
  return (
    <tbody ref={ref} className={className} data-notification={type} data-replie={ouvert ? undefined : ""} onChange={relire}>
      <tr className="block ordi:hidden">
        <td className="block">
          <button
            type="button"
            data-deplier-notification
            aria-expanded={ouvert}
            aria-controls={`${idCases} ${idMode}`}
            onClick={() => setOuvert((o) => !o)}
            className={CLASSE_LIGNE}
          >
            <ContenuLigne titre={titre} resume={relu ?? resume} sens="deplier" ouvert={ouvert} />
          </button>
        </td>
      </tr>
      {children}
    </tbody>
  );
}
