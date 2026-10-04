import type { Explication } from "./choix-geste";

/**
 * **L'encadré qui dit ce que le geste choisi va faire**, avant qu'on appuie : une phrase titre (à qui),
 * puis les précisions (ce qui arrive, qui reste de côté et pourquoi, emails, effacement). Le texte vient
 * de `choix-geste.ts`, où il se teste.
 *
 * **La région existe toujours, même vide** : une région `aria-live` créée en même temps que son
 * contenu n'est pas annoncée, et c'est justement le premier choix qu'un lecteur d'écran doit entendre.
 * Vide, elle reste dans le document sans prendre de place (`sr-only`, hors du flux de la barre).
 */
export function ExplicationGeste({ explication }: { explication: Explication | null }) {
  return (
    <div aria-live="polite" className={explication ? "flex flex-col gap-1 rounded-xl bg-surface-douce px-3 py-2 text-base" : "sr-only"}>
      {explication && (
        <>
          <p className="font-semibold">{explication.titre}</p>
          {explication.phrases.map((phrase) => (
            <p key={phrase}>{phrase}</p>
          ))}
        </>
      )}
    </div>
  );
}
