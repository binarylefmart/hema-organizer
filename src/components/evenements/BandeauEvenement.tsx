"use client";

import { useState } from "react";
import { ECU_LIVRE } from "@/lib/constants";
import { sourceImage } from "./libelles";

/**
 * Bandeau d'une carte d'événement : l'affiche s'il y en a une, sinon l'écu sur un aplat parchemin.
 *
 * Le repli sert deux cas, et c'est pour ça que le bandeau est *client* : l'événement sans image
 * (le plus courant — une annonce saisie à la main), et l'image qui ne se charge pas (lien mort,
 * hébergeur disparu, relais qui refuse la cible). Dans les deux cas la carte garde une tête, là où
 * un `<img>` cassé laisserait une icône grise et un trou.
 *
 * Le repli est volontairement plus bas que l'affiche : un aplat de 16/9 vide ferait une carte
 * creuse, alors qu'une rangée d'écu marque la carte sans manger l'écran du téléphone.
 *
 * L'écu arrive **en propriété** : c'est celui du club, qui se lit en base (`identite()`), et une
 * lecture de base n'a pas sa place dans un composant client — c'est l'appelant, côté serveur, qui
 * la fait. Sans propriété, l'écu livré avec le code : un bandeau décoratif ne vaut pas qu'une carte
 * disparaisse.
 *
 * `resserre` : la carte du fil en version téléphone réduit l'affiche à un bandeau de 80 px,
 * recadré, et le repli à 64 px — l'annonce entière doit tenir sur un écran avec sa voisine. La
 * fiche ne le passe pas : elle garde son affiche entière.
 */
export function BandeauEvenement({
  src,
  nom,
  ecu,
  resserre = false,
}: {
  src?: string | null;
  nom: string;
  ecu?: string;
  resserre?: boolean;
}) {
  const [casse, setCasse] = useState(false);
  if (src && !casse) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- affiche servie par le relais /api/image : l'optimiseur est désactivé (next.config.ts) et next/image imposerait de déclarer chaque hébergeur
      <img
        src={sourceImage(src)}
        alt={nom}
        loading="lazy"
        decoding="async"
        onError={() => setCasse(true)}
        className={`w-full bg-surface-douce object-cover ${resserre ? "h-20 ordi:aspect-[16/9] ordi:h-auto" : "aspect-[16/9]"}`}
      />
    );
  }
  return (
    // `@sm:` et non `sm:` : la hauteur du repli est une question sur la **carte** (358 à 712 px
    // selon la fenêtre), pas sur l'écran. Les deux seuls appelants — la carte du fil et la fiche —
    // déclarent `@container` sur leur `<article>`.
    <div
      className={`flex w-full items-center justify-center border-b border-bordure/50 bg-surface-douce ${
        resserre ? "h-16 ordi:h-24 ordi:@sm:h-28" : "h-24 @sm:h-28"
      }`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- écu déposé : dimensions inconnues à la compilation (voir `Logo`) */}
      <img src={ecu ?? ECU_LIVRE} alt="" aria-hidden width={44} height={51} loading="lazy" decoding="async" className={`h-auto opacity-55 ${resserre ? "w-9 ordi:w-11" : "w-11"}`} />
    </div>
  );
}
