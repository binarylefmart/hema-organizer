import { ECU_LIVRE, LOGO_LIVRE } from "@/lib/constants";
// `import type` : ce composant est rendu depuis des composants client, et le type disparaît à la
// compilation — importer une valeur de `identite.ts` y entraînerait `node:crypto`.
import type { Identite } from "@/lib/identite";

/** Ce que le logo a besoin de savoir de l'identité : son image, et le nom qu'il annonce. */
export type LogoIdentite = Pick<Identite, "logo" | "ecu" | "nomClub">;

type Props = {
  /** L'identité du club (`identite()` côté serveur). Absente : les images livrées avec le code. */
  identite?: LogoIdentite;
  taille?: number;
  className?: string;
  variante?: "complet" | "ecu";
  /** Plaque claire derrière le logo (un logo avec du texte noir est illisible sur fond sombre).
   *  "sombre" = seulement en mode sombre. */
  plaque?: "toujours" | "sombre" | "jamais";
};

/**
 * **Le logo du club** : celui qui a été déposé dans *Identité*, à défaut celui livré avec le code.
 * `ecu` = la version carrée, compacte, pour les petits écrans et les vignettes.
 *
 * **Pourquoi une balise `<img>` et non `next/image`.** Le logo n'est plus un fichier connu à la
 * compilation : c'est une image déposée, servie par `/api/affiche/<sha256>.<ext>`, dont on ne
 * connaît ni les dimensions ni le poids avant l'exécution. `width`/`height` ne sont donc qu'un
 * **indice de proportion** destiné à éviter que la page saute pendant le chargement ; tous les
 * appels passent un `className` avec `h-auto`, qui a le dernier mot sur la taille réelle. C'est
 * déjà ainsi que sont affichées les affiches d'événements déposées.
 */
export function Logo({ identite, taille = 160, className = "", variante = "complet", plaque = "jamais" }: Props) {
  const src = variante === "ecu" ? (identite?.ecu ?? ECU_LIVRE) : (identite?.logo ?? LOGO_LIVRE);
  // Proportion des images livrées ; une image déposée est supposée carrée, le temps du chargement.
  const livre = src === LOGO_LIVRE || src === ECU_LIVRE;
  const ratio = livre ? (variante === "ecu" ? 570 / 496 : 899 / 895) : 1;
  const img = (
    // eslint-disable-next-line @next/next/no-img-element -- image déposée : dimensions inconnues à la compilation
    <img
      src={src}
      alt={identite?.nomClub ?? ""}
      width={taille}
      height={Math.round(taille * ratio)}
      className={className}
      decoding="async"
    />
  );
  if (plaque === "jamais") return img;
  const fond = plaque === "toujours" ? "bg-white" : "dark:bg-white";
  return <span className={`inline-block rounded-2xl p-2 ${fond}`}>{img}</span>;
}
