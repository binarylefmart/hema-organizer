import path from "node:path";
import type { NextConfig } from "next";

const domain = process.env.DOMAIN ?? "localhost:3000";

const nextConfig: NextConfig = {
  // Image Docker : build autonome (node server.js)
  output: "standalone",
  // Dossier de sortie : `NEXT_DIST_DIR=.next-mesures npm run build` permet de mesurer un build de
  // production sans écraser le `.next` du serveur de développement en cours (routes en 500 sinon).
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  poweredByHeader: false,
  reactStrictMode: true,
  // Pas de badge Next.js en dev (captures d'aperçu propres)
  devIndicators: false,
  // Pas d'optimiseur d'images côté serveur (logo servi tel quel)
  images: { unoptimized: true },
  // node-cron et nodemailer (tâches planifiées, emails) restent des modules Node classiques, non empaquetés
  serverExternalPackages: ["node-cron", "nodemailer", "web-push"],
  webpack: (config, { nextRuntime }) => {
    // instrumentation.ts est aussi compilé pour le runtime edge (middleware) : les tâches planifiées
    // (node-cron, nodemailer → node:child_process) n'y ont pas leur place, on les remplace par un module vide.
    if (nextRuntime === "edge") {
      config.resolve.alias = { ...config.resolve.alias, [path.resolve(__dirname, "src/lib/taches")]: false };
    }
    return config;
  },
  experimental: {
    serverActions: {
      /*
       * **Protection CSRF des server actions : rien à ajouter en production, et c'est voulu.**
       *
       * Next compare déjà l'en-tête `Origin` à l'en-tête `Host` de la requête : une action appelée
       * depuis le domaine qui sert l'application passe, une action appelée depuis ailleurs est
       * refusée. `allowedOrigins` n'est pas cette vérification, c'est une **liste d'origines
       * supplémentaires** — donc un assouplissement.
       *
       * Cette liste contenait le domaine public, lu dans `DOMAIN`. Or cette valeur est figée **à la
       * compilation** : l'image Docker est bâtie avec `DOMAIN=localhost:3000` (valeur factice du
       * Dockerfile), et l'image publiée embarquait donc `["localhost:3000"]` — jamais le domaine de
       * celui qui la déploie, et une origine locale acceptée en plus pour rien. Exactement ce que
       * l'ancien commentaire prétendait éviter.
       *
       * En production, la liste est donc **vide** : la comparaison `Origin`/`Host` suffit, et elle,
       * elle connaît le vrai domaine. `localhost:3000` n'est ajouté que pour un build de
       * développement, où l'on sert en clair depuis la machine.
       */
      allowedOrigins: process.env.NODE_ENV === "production" ? [] : [domain, "localhost:3000"],
      /*
       * **Ce plafond est celui des affiches, avec la marge de l'encodage : il suit
       * `AFFICHE_TAILLE_MAX` (4 Mo, `src/lib/affiches.ts`), il ne se règle pas séparément.**
       *
       * Déposer une affiche ou un logo passe par une **server action** (`televerserAffiche`,
       * `televerserLogo`) : le fichier arrive dans un `FormData`, et Next refuse le corps de la
       * requête **avant** d'entrer dans l'action. Réglé à 1 Mo, il rendait injoignable tout ce que
       * l'application annonce accepter — la promesse rejetait au milieu d'un `useTransition` et
       * l'écran restait figé sur « Envoi de l'affiche… », sans que rien n'explique pourquoi.
       *
       * 5 Mo, et pas 4 : l'encodage multipart ajoute ses frontières et ses en-têtes aux octets du
       * fichier, si bien qu'un fichier de très exactement 4 Mo pèse un peu plus que 4 Mo sur le
       * réseau. Le vrai refus, lui, reste côté serveur (`AFFICHE_TAILLE_MAX`), où il peut être dit
       * en français. Vérifié par `tests/unit/affiches.test.ts`, pour que les deux valeurs ne
       * puissent plus diverger en silence.
       */
      bodySizeLimit: "5mb",
    },
  },
};

export default nextConfig;
