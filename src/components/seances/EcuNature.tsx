import { useId } from "react";
import type { NatureElement } from "@/lib/constants";
import { FOND_PIECE_NATURE, PIECES_NATURE, TRACE_ECU } from "./ecu-nature";

/**
 * Le petit écu d'une nature, posé devant le nom dans son étiquette (voir `ecu-nature.ts`).
 * Décoratif : le nom écrit à côté dit déjà la nature.
 */
export function EcuNature({ nature, taille = 18 }: { nature: NatureElement; taille?: number }) {
  // Un identifiant par écu : plusieurs `clipPath` de même id sur une page se volent la découpe
  const decoupe = `ecu-${useId().replace(/:/g, "")}`;
  const piece = PIECES_NATURE[nature] ?? PIECES_NATURE.COURS;
  const fond = FOND_PIECE_NATURE[nature] ?? FOND_PIECE_NATURE.COURS;
  return (
    <svg viewBox="0 0 24 24" width={taille} height={taille} aria-hidden="true" focusable="false" className="shrink-0">
      <defs>
        <clipPath id={decoupe}>
          <path d={TRACE_ECU} />
        </clipPath>
      </defs>
      <path d={TRACE_ECU} fill="currentColor" />
      <path d={piece} className={fond} clipPath={`url(#${decoupe})`} />
      <path d={TRACE_ECU} fill="none" stroke="currentColor" strokeWidth={1.4} />
    </svg>
  );
}
