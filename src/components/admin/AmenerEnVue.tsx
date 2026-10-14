"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Amène son contenu dans la vue à son apparition, et y pose le focus (annoncé par un lecteur d'écran).
 * Sert l'encart des codes d'activation : il naît en tête de page, alors que le bouton qui l'a fait
 * naître est souvent plus bas — sans ce geste, le code s'afficherait hors de l'écran du téléphone.
 */
export function AmenerEnVue({ children, className = "" }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    ref.current?.focus({ preventScroll: true });
  }, []);
  return (
    <div ref={ref} tabIndex={-1} className={`scroll-mt-24 outline-none ${className}`}>
      {children}
    </div>
  );
}
