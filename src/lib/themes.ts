/**
 * Catalogue des thèmes de couleurs proposés aux membres dans « Mon profil ».
 *
 * Chaque thème existe en clair et en sombre : le mode continue de suivre le système,
 * le thème ne fait que changer la palette. Les couleurs elles-mêmes sont définies dans
 * `src/app/globals.css`, sous forme de blocs `[data-theme="<id>"]` ; l'identifiant choisi
 * est posé en attribut `data-theme` sur la balise <html>.
 *
 * Dans tous les thèmes, le sens des couleurs ne bouge pas : vert = « Présent »,
 * rouge = « Absent » (et annulations, erreurs), ocre = « Peut-être ».
 */

export type ThemeId =
  | "parchemin"
  | "dracula"
  | "encre"
  | "foret"
  | "ocean"
  | "bourgogne"
  | "ardoise"
  | "sakura"
  | "solarise"
  | "agrume"
  | "lavande"
  | "nordique";

/**
 * Thème livré avec le code, employé tant que **ni le membre ni le club** n'ont choisi.
 *
 * Le club, lui, choisit le sien dans *Identité* (voir `src/lib/identite.ts`) : c'est ce que voit
 * un membre qui n'a rien réglé. Ce défaut-ci n'est donc que le dernier repli — « parchemin », le
 * plus sobre des douze, celui qui ne présume d'aucune couleur de club.
 */
export const THEME_DEFAUT: ThemeId = "parchemin";

/**
 * Les trois pastilles montrées à côté de la description, dans les deux modes : `apercu` pour le clair,
 * `apercuSombre` pour le sombre. Deux jeux sont nécessaires parce que le mode suit le système — montrer
 * les couleurs claires sur une page sombre annoncerait une palette que le thème ne donnera pas.
 * Les valeurs recopient celles de `src/app/globals.css` (un test vérifie qu'elles ne divergent pas).
 */
export type Theme = {
  id: ThemeId;
  nom: string;
  description: string;
  apercu: { fond: string; primaire: string; texte: string };
  apercuSombre: { fond: string; primaire: string; texte: string };
};

export const THEMES: readonly Theme[] = [
  {
    id: "parchemin",
    nom: "Parchemin",
    description: "Papier ancien et rouille — la palette d'origine de l'outil.",
    apercu: { fond: "#f4f0ee", primaire: "#a5472c", texte: "#282828" },
    apercuSombre: { fond: "#2c2622", primaire: "#e29b86", texte: "#f4ede3" },
  },
  {
    id: "dracula",
    nom: "Dracula",
    description: "Violet profond, façon éditeur de code.",
    apercu: { fond: "#f7f4fd", primaire: "#5b3aa6", texte: "#221f2e" },
    apercuSombre: { fond: "#282a36", primaire: "#bd93f9", texte: "#f8f8f2" },
  },
  {
    id: "encre",
    nom: "Encre de nuit",
    description: "Bleu nuit et reflets de laiton.",
    apercu: { fond: "#f5f6f7", primaire: "#234d95", texte: "#1c212c" },
    apercuSombre: { fond: "#1c1f26", primaire: "#90addf", texte: "#eeeff2" },
  },
  {
    id: "foret",
    nom: "Forêt",
    description: "Verts de sous-bois et lumière filtrée.",
    apercu: { fond: "#f6f7f5", primaire: "#35825c", texte: "#21291e" },
    apercuSombre: { fond: "#1f251d", primaire: "#9dd3b8", texte: "#eff1ee" },
  },
  {
    id: "ocean",
    nom: "Océan",
    description: "Bleu profond et écume claire.",
    apercu: { fond: "#f5f7f7", primaire: "#237695", texte: "#1b272c" },
    apercuSombre: { fond: "#1c2327", primaire: "#90cadf", texte: "#eef1f2" },
  },
  {
    id: "bourgogne",
    nom: "Bourgogne",
    description: "Rouge de vin vieilli et vieux rose.",
    apercu: { fond: "#f7f5f5", primaire: "#883046", texte: "#2a1d1f" },
    apercuSombre: { fond: "#251d1e", primaire: "#d699a8", texte: "#f1eeef" },
  },
  {
    id: "ardoise",
    nom: "Ardoise",
    description: "Gris froids, comme l'acier poli d'une lame.",
    apercu: { fond: "#f6f6f7", primaire: "#445c74", texte: "#202327" },
    apercuSombre: { fond: "#1f2123", primaire: "#a7b8c8", texte: "#eff0f1" },
  },
  {
    id: "sakura",
    nom: "Sakura",
    description: "Rose tendre des cerisiers en fleur.",
    apercu: { fond: "#f8f5f6", primaire: "#8c2c55", texte: "#2d1a21" },
    apercuSombre: { fond: "#291a1f", primaire: "#d996b3", texte: "#f2eeef" },
  },
  {
    id: "solarise",
    nom: "Solarisé",
    description: "Beige chaud le jour, sarcelle la nuit.",
    apercu: { fond: "#f8f7f4", primaire: "#1f6698", texte: "#2d281a" },
    apercuSombre: { fond: "#18272a", primaire: "#8dbfe2", texte: "#eef1f2" },
  },
  {
    id: "agrume",
    nom: "Agrume",
    description: "Orange sanguine et mandarine.",
    apercu: { fond: "#f8f6f4", primaire: "#a04518", texte: "#2d231a" },
    apercuSombre: { fond: "#2b2117", primaire: "#e7a888", texte: "#f2f0ee" },
  },
  {
    id: "lavande",
    nom: "Lavande",
    description: "Mauve doux et gris parme.",
    apercu: { fond: "#f6f5f8", primaire: "#5c3286", texte: "#221a2d" },
    apercuSombre: { fond: "#201a28", primaire: "#b89ad5", texte: "#efeef2" },
  },
  {
    id: "nordique",
    nom: "Nordique",
    description: "Bleus givrés et gris polaires.",
    apercu: { fond: "#f5f6f7", primaire: "#337384", texte: "#1d222a" },
    apercuSombre: { fond: "#1d2025", primaire: "#9bc8d4", texte: "#eeeff1" },
  },
] as const;

const IDS: ReadonlySet<string> = new Set(THEMES.map((theme) => theme.id));

/** Vrai si la valeur est l'identifiant d'un thème du catalogue. */
export function estThemeConnu(valeur: unknown): valeur is ThemeId {
  return typeof valeur === "string" && IDS.has(valeur);
}

/**
 * Identifiant de thème utilisable : toute valeur inconnue retombe sur `defaut`, et à défaut sur le
 * thème livré.
 *
 * Le second argument est **le thème du club** : un membre qui n'a jamais ouvert « Mon profil »
 * (c'est-à-dire presque tout le monde) voit les couleurs de son club, pas celles du club pour
 * lequel l'outil a été écrit.
 */
export function themeOuDefaut(valeur: string | null | undefined, defaut?: string | null): ThemeId {
  if (estThemeConnu(valeur)) return valeur;
  return estThemeConnu(defaut) ? defaut : THEME_DEFAUT;
}
