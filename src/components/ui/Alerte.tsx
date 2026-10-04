import type { ReactNode } from "react";
import { Icone, type NomIcone } from "./Icone";

type Type = "info" | "succes" | "erreur" | "attention";
/** `className` : la place de l'alerte dans la mise en page qui l'accueille, jamais son style. */
type Props = { type?: Type; children: ReactNode; titre?: string; className?: string };

const STYLES: Record<Type, { boite: string; icone: NomIcone }> = {
  info: { boite: "border-primaire/30 bg-primaire-doux text-texte", icone: "info" },
  succes: { boite: "border-vert/40 bg-vert-doux text-texte", icone: "check" },
  erreur: { boite: "border-rouge/40 bg-rouge-doux text-texte", icone: "alerte" },
  attention: { boite: "border-ocre/50 bg-ocre-doux text-texte", icone: "alerte" },
};
const COULEUR_ICONE: Record<Type, string> = { info: "text-primaire", succes: "text-vert", erreur: "text-rouge", attention: "text-texte" };

/** Message d'état visible et annoncé aux lecteurs d'écran. */
export function Alerte({ type = "info", titre, children, className = "" }: Props) {
  return (
    <div role={type === "erreur" ? "alert" : "status"} className={`flex gap-3 rounded-xl border p-4 shadow-carte ${STYLES[type].boite} ${className}`}>
      <Icone nom={STYLES[type].icone} taille={22} className={`mt-0.5 ${COULEUR_ICONE[type]}`} />
      <div className="min-w-0">
        {titre && <p className="font-semibold">{titre}</p>}
        <div>{children}</div>
      </div>
    </div>
  );
}
