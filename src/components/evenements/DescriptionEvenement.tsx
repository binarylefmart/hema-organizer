"use client";

import { useLayoutEffect, useRef, useState } from "react";

/**
 * Le texte d'une annonce, replié à quelques lignes.
 *
 * Une annonce se lit comme un message : quatre lignes (trois sur téléphone) suffisent à savoir si
 * l'on est concerné, et le fil garde son rythme — sinon la carte la plus bavarde pousse toutes les autres hors de l'écran.
 * « Lire la suite » n'apparaît que si le texte dépasse vraiment : on le mesure après le rendu
 * (`scrollHeight` contre `clientHeight`) plutôt que de le deviner au nombre de caractères, qui
 * ignore les retours à la ligne et la largeur de l'écran.
 *
 * Rien n'est caché au lecteur d'écran ni à la recherche du navigateur : le texte est entier dans
 * la page, seul son affichage est tronqué.
 */
export function DescriptionEvenement({ texte }: { texte: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [deborde, setDeborde] = useState(false);
  const [ouvert, setOuvert] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    // Mesure faite replié seulement : déplié, la hauteur visible rejoint la hauteur réelle.
    if (el && !ouvert) setDeborde(el.scrollHeight > el.clientHeight + 1);
  }, [texte, ouvert]);

  return (
    <div className="flex flex-col items-start gap-1">
      {/* Trois lignes sur téléphone (la carte resserrée), quatre au-delà. */}
      <p ref={ref} className={`whitespace-pre-line ${ouvert ? "" : "line-clamp-3 ordi:line-clamp-4"}`}>
        {texte}
      </p>
      {(deborde || ouvert) && (
        <button
          type="button"
          onClick={() => setOuvert((v) => !v)}
          aria-expanded={ouvert}
          className="min-h-12 text-lien underline decoration-lien/40 hover:decoration-lien"
        >
          {ouvert ? "Replier" : "Lire la suite"}
        </button>
      )}
    </div>
  );
}
