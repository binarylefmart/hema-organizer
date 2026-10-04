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
  | "nordique"
  | "catppuccin-mocha"
  | "catppuccin-green"
  | "catppuccin-lavender"
  | "catppuccin-macchiato"
  | "catppuccin-teal"
  | "catppuccin-peach"
  | "catppuccin-frappe"
  | "catppuccin-sapphire"
  | "catppuccin-flamingo";

/**
 * Thème livré avec le code, employé tant que **ni le membre ni le club** n'ont choisi.
 *
 * Le club, lui, choisit le sien dans *Identité* (voir `src/lib/identite.ts`) : c'est ce que voit
 * un membre qui n'a rien réglé. Ce défaut-ci n'est donc que le dernier repli — « parchemin », le
 * plus sobre du catalogue, celui qui ne présume d'aucune couleur de club.
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
  /** Nom du thème, et celui de sa version sombre quand le membre la choisit. */
  nom: string;
  /** Nom de sa version claire, quand elle en porte un autre (Catppuccin : Latte le jour). */
  nomClair?: string;
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
  {
    id: "catppuccin-mocha",
    nom: "Catppuccin Mocha · Mauve",
    nomClair: "Catppuccin Latte · Mauve",
    description: "Pastels Catppuccin, accent mauve ; Mocha la nuit, la plus sombre.",
    apercu: { fond: "#eff1f5", primaire: "#8534ef", texte: "#4c4f69" },
    apercuSombre: { fond: "#181825", primaire: "#cba6f7", texte: "#cdd6f4" },
  },
  {
    id: "catppuccin-green",
    nom: "Catppuccin Mocha · Green",
    nomClair: "Catppuccin Latte · Green",
    description: "Pastels Catppuccin, accent vert sauge ; Mocha la nuit.",
    apercu: { fond: "#eff1f5", primaire: "#255c19", texte: "#4c4f69" },
    apercuSombre: { fond: "#181825", primaire: "#a6e3a1", texte: "#cdd6f4" },
  },
  {
    id: "catppuccin-lavender",
    nom: "Catppuccin Mocha · Lavender",
    nomClair: "Catppuccin Latte · Lavender",
    description: "Pastels Catppuccin, accent lavande ; Mocha la nuit.",
    apercu: { fond: "#eff1f5", primaire: "#3352fc", texte: "#4c4f69" },
    apercuSombre: { fond: "#181825", primaire: "#b4befe", texte: "#cdd6f4" },
  },
  {
    id: "catppuccin-macchiato",
    nom: "Catppuccin Macchiato · Blue",
    nomClair: "Catppuccin Latte · Blue",
    description: "Pastels Catppuccin, accent bleu ; Macchiato la nuit.",
    apercu: { fond: "#eff1f5", primaire: "#0b59f4", texte: "#4c4f69" },
    apercuSombre: { fond: "#1e2030", primaire: "#8aadf4", texte: "#cad3f5" },
  },
  {
    id: "catppuccin-teal",
    nom: "Catppuccin Macchiato · Teal",
    nomClair: "Catppuccin Latte · Teal",
    description: "Pastels Catppuccin, accent vert d'eau ; Macchiato la nuit.",
    apercu: { fond: "#eff1f5", primaire: "#127278", texte: "#4c4f69" },
    apercuSombre: { fond: "#1e2030", primaire: "#8bd5ca", texte: "#cad3f5" },
  },
  {
    id: "catppuccin-peach",
    nom: "Catppuccin Macchiato · Peach",
    nomClair: "Catppuccin Latte · Peach",
    description: "Pastels Catppuccin, accent pêche ; Macchiato la nuit.",
    apercu: { fond: "#eff1f5", primaire: "#b44201", texte: "#4c4f69" },
    apercuSombre: { fond: "#1e2030", primaire: "#f5a97f", texte: "#cad3f5" },
  },
  {
    id: "catppuccin-frappe",
    nom: "Catppuccin Frappé · Pink",
    nomClair: "Catppuccin Latte · Pink",
    description: "Pastels Catppuccin, accent rose ; Frappé la nuit, la plus douce.",
    apercu: { fond: "#eff1f5", primaire: "#bc1d91", texte: "#4c4f69" },
    apercuSombre: { fond: "#292c3c", primaire: "#f4b8e4", texte: "#c6d0f5" },
  },
  {
    id: "catppuccin-sapphire",
    nom: "Catppuccin Frappé · Sapphire",
    nomClair: "Catppuccin Latte · Sapphire",
    description: "Pastels Catppuccin, accent saphir ; Frappé la nuit.",
    apercu: { fond: "#eff1f5", primaire: "#177181", texte: "#4c4f69" },
    apercuSombre: { fond: "#292c3c", primaire: "#85c1dc", texte: "#c6d0f5" },
  },
  {
    id: "catppuccin-flamingo",
    nom: "Catppuccin Frappé · Flamingo",
    nomClair: "Catppuccin Latte · Flamingo",
    description: "Pastels Catppuccin, accent flamant ; Frappé la nuit.",
    apercu: { fond: "#eff1f5", primaire: "#982626", texte: "#4c4f69" },
    apercuSombre: { fond: "#292c3c", primaire: "#eebebe", texte: "#c6d0f5" },
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

/**
 * **Un thème choisi par le membre est clair ou sombre**, et s'impose jour et nuit : c'est ce que dit
 * l'attribut `data-mode` posé sur <html> (voir l'en-tête de `globals.css`). Sans choix — c'est-à-dire
 * le thème du club, ou un choix fait avant que la liste ne sépare les deux —, le mode reste celui de
 * l'appareil.
 *
 * En base, un choix s'écrit `<thème>:<mode>` (« dracula:sombre ») ; un identifiant seul est un thème
 * qui suit l'appareil.
 */
export type ModeTheme = "clair" | "sombre";
export type ChoixTheme = { id: ThemeId; mode: ModeTheme | null };

const MODES: readonly ModeTheme[] = ["clair", "sombre"];

/** Le choix lu tel qu'il est écrit, ou null s'il ne désigne rien du catalogue. */
export function lireChoixTheme(valeur: unknown): ChoixTheme | null {
  if (typeof valeur !== "string") return null;
  const [id, mode, ...reste] = valeur.split(":");
  if (reste.length || !estThemeConnu(id)) return null;
  if (mode === undefined) return { id, mode: null };
  return (MODES as readonly string[]).includes(mode) ? { id, mode: mode as ModeTheme } : null;
}

/** Vrai si la valeur est un choix enregistrable : un thème du catalogue, avec ou sans mode. */
export function estChoixThemeConnu(valeur: unknown): valeur is string {
  return lireChoixTheme(valeur) !== null;
}

export function valeurDuChoix(choix: ChoixTheme): string {
  return choix.mode ? `${choix.id}:${choix.mode}` : choix.id;
}

/** Choix du membre s'il est valable, sinon le thème du club (qui suit l'appareil), sinon le thème livré. */
export function choixOuDefaut(valeur: string | null | undefined, defaut?: string | null): ChoixTheme {
  return lireChoixTheme(valeur) ?? { id: themeOuDefaut(null, defaut), mode: null };
}

/** Le nom d'un thème dans un mode : « Catppuccin Latte · Mauve », « Forêt clair », « Dracula sombre »… */
export function nomDuChoix(theme: Theme, mode: ModeTheme): string {
  if (theme.nomClair) return mode === "clair" ? theme.nomClair : theme.nom;
  return `${theme.nom} ${mode}`;
}

/**
 * **La liste du profil : les thèmes clairs, puis les sombres**, chacun trié par nom. Chaque palette
 * y figure deux fois, une par groupe.
 */
export const GROUPES_THEMES: readonly { mode: ModeTheme; libelle: string; choix: readonly { valeur: string; nom: string; theme: Theme }[] }[] = MODES.map(
  (mode) => ({
    mode,
    libelle: mode === "clair" ? "Thèmes clairs" : "Thèmes sombres",
    choix: THEMES.map((theme) => ({ valeur: valeurDuChoix({ id: theme.id, mode }), nom: nomDuChoix(theme, mode), theme })).sort((a, b) =>
      a.nom.localeCompare(b.nom, "fr"),
    ),
  }),
);
