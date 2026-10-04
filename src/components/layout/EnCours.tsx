"use client";

import { useLinkStatus } from "next/link";

/**
 * Témoin « c'est parti » d'un lien, à poser **à l'intérieur** d'un `<Link>`.
 *
 * `useLinkStatus` (Next 15.3+) n'est vrai que pendant la navigation déclenchée par le lien qui
 * l'entoure : un anneau discret apparaît au doigt levé et disparaît quand l'écran suivant se pose.
 * Sans lui, un nom de membre ou une date de séance ne répond rien pendant que le serveur travaille —
 * et sur téléphone on retape, croyant avoir manqué la cible.
 *
 * C'est un tout petit composant client posé dans un écran serveur : rien d'autre ne bascule côté
 * navigateur, la page reste rendue sur le serveur.
 *
 * L'anneau ne tourne qu'en `motion-safe` ; qui a demandé moins d'animations voit une pulsation douce.
 */
export function EnCours({ taille = 16, className = "" }: { taille?: number; className?: string }) {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span
      role="status"
      aria-label="Ouverture en cours"
      style={{ width: taille, height: taille }}
      className={`inline-block shrink-0 rounded-full border-2 border-current border-r-transparent opacity-70 motion-safe:animate-spin motion-reduce:animate-pulse ${className}`}
    />
  );
}
