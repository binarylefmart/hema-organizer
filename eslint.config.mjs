import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      // Tout dossier de build annexe : `.next-mesures`, `.next-grand-club`, `.next-e2e`… On en monte
      // un par chantier parallèle (mesures de performance, club de démonstration à 80, suite e2e) et
      // chacun contient des types engendrés par Next, que le linter compte par milliers. Un motif,
      // pas une liste : la liste se retrouve toujours en retard d'un dossier, et c'est alors le
      // travail en cours qui rend `npm run lint` illisible — donc inutile.
      ".next-*/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
    ],
  },
];

export default eslintConfig;
