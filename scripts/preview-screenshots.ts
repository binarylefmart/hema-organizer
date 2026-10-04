/**
 * Captures d'aperçu de l'interface (obligatoires à chaque modification visuelle).
 *
 * Prérequis : serveur démarré (npm run dev ou npm start) avec le seed de démonstration,
 *             npx playwright install chromium
 * Usage     : npm run preview:screenshots [-- --only=connexion,invitation] [--base=http://localhost:3000] [--etape="Étape 2 : séances"]
 *
 * Produit previews/<scene>/<mobile|pc>-<clair|sombre>.jpg et previews/index.html (galerie).
 */
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import path from "node:path";
import { renderEmailHtml } from "../src/lib/email/templates/layout";
import { emailInvitation, emailNouvelAppareil, emailReset } from "../src/lib/email/templates/auth";
import { emailEffectifFaible, emailSeanceAnnulee } from "../src/lib/email/templates/seances";
import { emailRecapVeille, emailRappelSansReponse } from "../src/lib/email/templates/recap";
import { embedSeance, embedAnnulation, embedEffectifFaible } from "../src/lib/notifications/contenu";
import { chargeAnnulationPush, chargeEffectifFaiblePush } from "../src/lib/notifications/seances";
import type { DiscordEmbed } from "../src/lib/notifications/discord";
import type { ChargePush } from "../src/lib/notifications/push";
import { urlAnnulation } from "../src/lib/notifications/seances";
import { jetonDesinscription } from "../src/lib/notifications/desinscription";
import { PrismaClient } from "@prisma/client";
import { emailAtelierStatut } from "../src/lib/email/templates/ateliers";
import { codeTotpFrais, COMPTES, DEMO_MOT_DE_PASSE, DEMO_TOKEN_EXISTANT, DEMO_TOKEN_NOUVEAU, DEMO_TOTP_SECRET, demoLien } from "../prisma/comptes";
import { etatPremiereConnexion, instantaneCompteAdministration, restaurerCompteAdministration, restaurerInstantane, type InstantaneCompte } from "../prisma/compte-administration";
import { dateDemo } from "../prisma/seed-demo";
import { THEMES as THEMES_COULEURS } from "../src/lib/themes";
import { identiteReglee, resoudreIdentite, type Identite } from "../src/lib/identite";
import { hashPassword } from "../src/lib/auth/password";
import { LIEN_PERSO_COOKIE } from "../src/lib/lien-personnel";

/**
 * **L'identité du club, telle que la base la porte** : les maquettes d'email, d'embed Discord et de
 * notification doivent montrer ce que verra vraiment le club, pas un nom de remplacement. Relue au
 * démarrage (`chargerIdentite`), avant la première maquette. `resoudreIdentite(null)` n'est que la
 * valeur de départ, le temps d'atteindre cette lecture.
 */
let CLUB: Identite = resoudreIdentite(null);
let NOM_APP = CLUB.nomCourt;
/** Ce que le gabarit d'email attend : le nom affiché et le chemin du logo. */
let CLUB_EMAIL = { nomClub: CLUB.nomClub, logo: CLUB.logo };

async function chargerIdentite(): Promise<void> {
  CLUB = resoudreIdentite(await identiteReglee());
  NOM_APP = CLUB.nomCourt;
  CLUB_EMAIL = { nomClub: CLUB.nomClub, logo: CLUB.logo };
}
const BASE = arg("base") ?? process.env.PREVIEW_BASE_URL ?? "http://localhost:3000";
const SANS_CAPTURES = process.argv.includes("--sans-captures"); // ne (re)construit que la galerie
const ONLY = arg("only")?.split(",").filter(Boolean);
const ETAPE = arg("etape") ?? "Étape 4 : trois onglets (Planning, Présences, Proposer un atelier)";
const OUT = path.join(process.cwd(), "previews");

/**
 * Route de l'onglet Présences — l'écran qui porte les trois boutons de réponse, sorti de « / »
 * le jour où l'accueil est devenu un compte rendu sans action.
 * ⚠ À CONFIRMER : cette route n'existe pas encore dans src/app/(app)/ au moment où ces scènes
 * ont été écrites. Si l'écran s'appelle autrement, **une seule ligne à changer ici**.
 */
const CHEMIN_SEANCES = "/seances";

/** Le mot de passe du jeu de démonstration, **importé** et non recopié : une valeur en dur ici
 *  se démode en silence, et le garde-fou de `tests/unit/production.test.ts` ne la voyait pas. */
const DEMO_MDP = DEMO_MOT_DE_PASSE;
/** Les jetons fixes du jeu de démonstration, **importés** eux aussi (voir `DEMO_MDP` juste au-dessus). */
const TOKEN_NOUVEAU = DEMO_TOKEN_NOUVEAU;
const TOKEN_EXISTANT = DEMO_TOKEN_EXISTANT;

const FORMATS = {
  mobile: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  pc: { width: 1280, height: 800, isMobile: false, hasTouch: false, deviceScaleFactor: 1 },
} as const;
const THEMES = { clair: "light", sombre: "dark" } as const;

/**
 * **Les quatre images qu'une scène doit produire.** La liste est écrite ici une fois, et c'est elle
 * que la vérification de fin de campagne compare au contenu réel du dossier : une scène qui n'a pas
 * ses quatre fichiers est en échec, **même si elle n'a levé aucune erreur**.
 */
const ATTENDUS: string[] = Object.keys(FORMATS).flatMap((f) => Object.keys(THEMES).map((t) => `${f}-${t}.jpg`));

/**
 * L'instant où la campagne commence. Tout fichier plus ancien n'a **pas** été rafraîchi par cette
 * course : c'est ce qui permet de dire « périmé » sur la galerie au lieu de laisser croire que tout
 * est frais.
 */
const DEBUT = new Date();

/** Ce qu'on sait d'une scène à la fin de la campagne — et ce que le récapitulatif imprime. */
type ResultatScene = {
  nom: string;
  description: string;
  /** Images réellement présentes sur le disque, vérifiées une par une. */
  presentes: string[];
  /** Images attendues et absentes (`ATTENDUS` moins `presentes`). */
  manquantes: string[];
  /** Date de la capture la plus récente du dossier ; `null` si le dossier est vide. */
  date: Date | null;
  /** Message d'échec, s'il y en a eu un (première ligne de l'erreur Playwright). */
  erreur?: string;
  /** Combien de fois la scène a été tentée (1, ou 2 après un nouvel essai). */
  essais: number;
  /** Cette campagne a-t-elle tenté la scène ? (faux en `--sans-captures`) */
  tentee: boolean;
};

/* Le jour d'une date, tel que le club le lit (Europe/Paris) : « ». */
function jour(d: Date): string {
  return d.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" });
}

/**
 * La scène est-elle à jour ?
 *
 * Deux mesures, parce qu'il y a deux situations. Une scène que **cette passe a tentée** doit porter
 * des fichiers plus récents que son démarrage — sinon la capture n'a pas eu lieu. Une scène que la
 * passe n'a **pas** tentée (`--sans-captures`, qui ne fait que reconstruire la galerie) est jugée sur
 * son **jour** : reprocher son âge à une image d'il y a dix minutes n'aurait aucun sens.
 */
function estFraiche(r: ResultatScene): boolean {
  if (r.erreur || r.manquantes.length || !r.date) return false;
  return r.tentee ? r.date >= DEBUT : jour(r.date) === jour(new Date());
}

type Scene = {
  nom: string;
  description: string;
  /** Compte à connecter avant la capture (email) */
  connexion?: string;
  /** Chemin à ouvrir (ou HTML à rendre directement) */
  chemin?: string;
  html?: string;
  /** Actions avant capture (remplir un formulaire, etc.) */
  avant?: (page: Page) => Promise<void>;
  /** Capture pleine page (par défaut : viewport) */
  pleinePage?: boolean;
  /** Remise en état après la capture (jeu de données) */
  apres?: () => Promise<void>;
  /**
   * Agent utilisateur à simuler. Le parcours d'entrée se règle sur l'appareil (« veux-tu installer
   * l'application ? » ne se pose ni sur ordinateur ni dans l'app déjà installée) : sans cet
   * agent-là, ces écrans ne s'afficheraient jamais et on ne pourrait pas les photographier.
   */
  userAgent?: string;
  /**
   * Cookies posés avant l'ouverture. Sert au seul cookie de passage du lien personnel
   * (`hema_lien_perso`) : c'est lui qui donne au parcours son bouton « Copier mon lien ».
   */
  cookies?: { name: string; value: string }[];
};

/** iPhone : le seul appareil où l'application installée ne partage pas le compte du navigateur. */
const UA_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

/** Échappement HTML des maquettes : ces textes viennent des vrais générateurs, pas d'une saisie. */
function echapper(t: string): string {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Le peu de Markdown que Discord rend dans un embed et que nos messages emploient : le gras.
 * Sans ça, la maquette montrerait « **Bien rempli** » là où le salon affiche « Bien rempli » —
 * un aperçu qui ment sur un détail finit par faire douter du reste.
 */
function discordMarkdown(t: string): string {
  return echapper(t)
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/\n/g, "<br>");
}

/**
 * Une séance **déjà donnée** du jeu de démonstration, pour les deux scènes qui montrent la recherche
 * par date. Le seed recale ses dates sur la semaine en cours (`ANCRAGE_DEMO`, `prisma/seed-demo.ts`) :
 * on lui demande donc où est passé ce mardi-là, au lieu de l'écrire une seconde fois ici.
 */
const SEANCE_PASSEE_DEMO = dateDemo("2026-09-09");

/** La séance repère des notifications : celle du jeu de démonstration, à une date lisible. */
const SEANCE_NOTIF ={ date: "2026-09-24", heureDebut: "19:30", heureFin: "21:30", lieu: "Gymnase municipal", theme: "Messer", alternative: "Garde haute" };
const CHIFFRES_NOTIF = { presents: 13, absents: 2, peutEtre: 2, enAttente: 1, invites: 18, pourcentage: 72 };

/**
 * **Maquette fidèle d'un message Discord** (exigée par le cahier des charges : on ne peut pas
 * photographier Discord lui-même). Reproduit ce que Discord affiche vraiment d'un webhook : le nom
 * et l'avatar posés par `payloadDiscord`, le badge « BOT », la barre de couleur à gauche de l'embed,
 * le titre, la description, les champs et le pied — aux dimensions et aux couleurs du client.
 *
 * L'embed vient des **vraies fonctions** (`embedSeance`, `embedAnnulation`…) : si le contenu commun
 * change, cet aperçu change avec lui. Rien n'est réécrit ici, seulement mis en page.
 */
function maquetteDiscord(embeds: DiscordEmbed[], salon: string): string {
  const messages = embeds
    .map((e) => {
      const couleur = `#${(e.color ?? 0x5865f2).toString(16).padStart(6, "0")}`;
      const champs = (e.fields ?? [])
        .map((f) => `<div class="champ${f.inline ? " inline" : ""}"><b>${echapper(f.name)}</b><span>${discordMarkdown(f.value)}</span></div>`)
        .join("");
      return `<article class="msg">
        <img class="avatar" src="${BASE}/logo.png" alt="">
        <div class="corps">
          <p class="auteur">${echapper(CLUB.nomClub)} <span class="bot">BOT</span> <time>Aujourd'hui à 18:00</time></p>
          <div class="embed" style="border-left-color:${couleur}">
            ${e.title ? `<p class="titre">${echapper(e.title)}</p>` : ""}
            ${e.description ? `<p class="desc">${discordMarkdown(e.description)}</p>` : ""}
            ${champs ? `<div class="champs">${champs}</div>` : ""}
            ${e.footer ? `<p class="pied"><img src="${BASE}/logo.png" alt="">${echapper(e.footer.text)}</p>` : ""}
          </div>
        </div>
      </article>`;
    })
    .join("");
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>
    :root { color-scheme: dark }
    body { margin:0; background:#313338; color:#dbdee1; font:16px/1.4 "gg sans","Noto Sans",system-ui,sans-serif }
    .salon { padding:12px 16px; border-bottom:1px solid #26282c; color:#f2f3f5; font-weight:700 }
    .salon span { color:#80848e; margin-right:6px; font-weight:400 }
    .fil { padding:16px }
    .msg { display:flex; gap:16px; padding:8px 0 }
    .avatar { width:40px; height:40px; border-radius:50%; background:#fff; object-fit:contain; flex:none }
    .auteur { margin:0 0 4px; font-weight:600; color:#f2f3f5 }
    .bot { background:#5865f2; color:#fff; font-size:11px; font-weight:600; padding:1px 5px; border-radius:4px; vertical-align:2px; margin-left:2px }
    time { color:#949ba4; font-size:12px; font-weight:400; margin-left:6px }
    .embed { background:#2b2d31; border-left:4px solid; border-radius:4px; padding:12px 16px 14px; max-width:520px }
    .titre { margin:0 0 6px; font-weight:700; color:#f2f3f5; font-size:16px }
    .desc { margin:0; white-space:normal }
    .champs { display:flex; flex-wrap:wrap; gap:12px 24px; margin-top:10px }
    .champ { min-width:150px }
    .champ b { display:block; color:#f2f3f5; font-size:14px }
    .champ span { font-size:14px }
    .pied { display:flex; align-items:center; gap:8px; margin:12px 0 0; color:#949ba4; font-size:12px }
    .pied img { width:20px; height:20px; border-radius:50%; background:#fff; object-fit:contain }
  </style></head><body>
    <p class="salon"><span>#</span>${echapper(salon)}</p>
    <div class="fil">${messages}</div>
  </body></html>`;
}

/**
 * **Maquette d'une notification sur le téléphone** : la bannière telle qu'elle tombe sur l'écran
 * verrouillé, avec l'icône de l'application, son nom et l'heure. Les textes viennent des vraies
 * fonctions de charge (`chargeAnnulationPush`…) — c'est bien ce qui s'affichera.
 */
function maquettePush(charges: ChargePush[]): string {
  const cartes = charges
    .map(
      (c, i) => `<article class="notif">
        <header><img src="${BASE}/icons/icone-192.png" alt=""><span>${NOM_APP}</span><time>il y a ${i === 0 ? "2 min" : `${i * 7 + 5} min`}</time></header>
        <p class="titre">${echapper(c.titre)}</p>
        <p class="corps">${echapper(c.corps)}</p>
      </article>`,
    )
    .join("");
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>
    body { margin:0; min-height:100vh; display:flex; align-items:flex-start; justify-content:center; padding-top:14vh;
           background:linear-gradient(160deg,#0E1A2B,#2B2622 60%,#0b2d52);
           font:16px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif; color:#fff; padding:28px }
    .ecran { width:100%; max-width:420px }
    .heure { text-align:center; font-size:58px; font-weight:300; letter-spacing:-2px; margin:0 }
    .jour { text-align:center; margin:0 0 26px; opacity:.8 }
    .notif { background:rgba(255,255,255,.22); backdrop-filter:blur(14px); border-radius:20px; padding:12px 14px; margin-bottom:10px }
    .notif header { display:flex; align-items:center; gap:8px; font-size:13px; opacity:.9; margin-bottom:4px }
    .notif header img { width:20px; height:20px; border-radius:5px }
    .notif header time { margin-left:auto; font-size:12px; opacity:.8 }
    .titre { margin:0; font-weight:600 }
    .corps { margin:2px 0 0; font-size:15px; opacity:.95 }
  </style></head><body>
    <div class="ecran">
      <p class="heure">18:00</p>
      <p class="jour">mercredi 23 septembre</p>
      ${cartes}
    </div>
  </body></html>`;
}

/** CRC-32 des chunks PNG (l'affiche de démonstration est fabriquée ici, sans dépendance ni fichier à versionner). */
function crc32(octets: Buffer): number {
  let crc = 0xffffffff;
  for (const octet of octets) {
    crc ^= octet;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunkPng(type: string, donnees: Buffer): Buffer {
  const taille = Buffer.alloc(4);
  taille.writeUInt32BE(donnees.length);
  const corps = Buffer.concat([Buffer.from(type, "latin1"), donnees]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(corps));
  return Buffer.concat([taille, corps, crc]);
}

/** Affiche de démonstration : PNG portrait, dégradé encre → terre de Sienne, généré à la volée. */
function affichePngDemo(largeur = 480, hauteur = 640): Buffer {
  const brut = Buffer.alloc((largeur * 3 + 1) * hauteur);
  for (let y = 0; y < hauteur; y++) {
    const ligne = y * (largeur * 3 + 1);
    brut[ligne] = 0; // filtre « aucun »
    const t = y / hauteur;
    for (let x = 0; x < largeur; x++) {
      const p = ligne + 1 + x * 3;
      const u = x / largeur;
      brut[p] = Math.round(43 + t * 132 + u * 20);
      brut[p + 1] = Math.round(38 + t * 75 + u * 14);
      brut[p + 2] = Math.round(34 + t * 47 + u * 10);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largeur, 0);
  ihdr.writeUInt32BE(hauteur, 4);
  ihdr[8] = 8; // profondeur
  ihdr[9] = 2; // couleur RVB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunkPng("IHDR", ihdr),
    chunkPng("IDAT", deflateSync(brut)),
    chunkPng("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * Une scène par thème du catalogue : toujours le même écran (l'accueil, devenu le compte rendu), pour que
 * les douze palettes se comparent d'un coup d'œil. Les scènes sont dérivées de `THEMES_COULEURS` :
 * un thème ajouté à `src/lib/themes.ts` obtient sa scène sans rien toucher ici.
 *
 * Le thème est posé sur <html> côté serveur : on l'écrit en base pour le compte de la scène,
 * puis on recharge — plutôt que de le forcer dans le navigateur, qui ne montrerait pas le vrai rendu.
 * Cadrage à la fenêtre (pas de `pleinePage`) : une capture pleine hauteur peint la barre de
 * navigation fixe au milieu de l'image et rend la comparaison entre thèmes impossible.
 */
const SCENES_THEMES: Scene[] = THEMES_COULEURS.map((theme) => ({
  nom: `theme-${theme.id}`,
  description: `Thème ${theme.nom} — ${theme.description}`,
  connexion: COMPTES.membre,
  chemin: "/",
  avant: async (page) => {
    await definirThemeDemo(theme.id);
    await page.reload({ waitUntil: "networkidle" });
    await page.locator(`html[data-theme="${theme.id}"]`).waitFor({ state: "attached" });
  },
  apres: rendreThemeDemo,
}));

/**
 * **Toutes les scènes**, fabriquées à l'appel et non au chargement du module.
 *
 * C'est indispensable depuis que le nom et le logo du club sont une **donnée** : les maquettes
 * d'email et d'embed Discord les incorporent, et il faut donc que `chargerIdentite()` ait lu la base
 * avant qu'elles soient construites. Un `const SCENES = […]` au niveau du module était évalué à
 * l'import, c'est-à-dire avant toute lecture — et les maquettes montraient le nom livré.
 */
function toutesLesScenes(): Scene[] {
  return [
    { nom: "connexion", description: "organizer.mon-club.fr : accès administrateur seul (les membres passent par leur lien)", chemin: "/connexion" },
    {
      nom: "connexion-admin",
      description: "Connexion administrateur : mauvais mot de passe",
      chemin: "/connexion",
      avant: async (page) => {
        await page.getByLabel("Email", { exact: true }).fill(COMPTES.admin);
        await page.getByLabel("Mot de passe", { exact: true }).fill("mauvais-mot-de-passe");
        await page.getByRole("button", { name: "Se connecter" }).click();
        await page.getByRole("alert").waitFor();
      },
    },
    {
      nom: "connexion-2fa-config",
      description: "Première connexion d'un admin : configuration de la double authentification (QR code)",
      chemin: "/connexion",
      avant: async (page) => {
        await etatPremiereConnexion();
        await page.reload();
        await page.getByLabel("Email", { exact: true }).fill(COMPTES.admin);
        await page.getByLabel("Mot de passe", { exact: true }).fill(DEMO_MDP);
        await page.getByRole("button", { name: "Se connecter" }).click();
        await page.waitForURL("**/connexion/code");
        await page.getByText("Impossible de scanner").click();
      },
      pleinePage: true,
      apres: restaurerCompteAdministration,
    },
    {
      nom: "connexion-2fa-code",
      description: "Connexion admin : saisie du code à 6 chiffres",
      chemin: "/connexion",
      avant: async (page) => {
        await page.getByLabel("Email", { exact: true }).fill(COMPTES.admin);
        await page.getByLabel("Mot de passe", { exact: true }).fill(DEMO_MDP);
        await page.getByRole("button", { name: "Se connecter" }).click();
        await page.waitForURL("**/connexion/code");
      },
    },
    {
      nom: "connexion-codes-secours",
      description: "Après l'activation de la 2FA : les 8 codes de secours, montrés une seule fois",
      chemin: "/connexion",
      avant: async (page) => {
        await etatPremiereConnexion();
        await page.reload();
        await page.getByLabel("Email", { exact: true }).fill(COMPTES.admin);
        await page.getByLabel("Mot de passe", { exact: true }).fill(DEMO_MDP);
        await page.getByRole("button", { name: "Se connecter" }).click();
        await page.waitForURL("**/connexion/code");
        await page.getByText("Impossible de scanner").click();
        const cle = (await page.locator("code").textContent())!.replace(/\s+/g, "");
        await page.getByLabel("Code à 6 chiffres").fill(await codeTotpFrais(cle));
        await page.getByRole("button", { name: "Activer et me connecter" }).click();
        await page.waitForURL("**/connexion/codes-secours");
      },
      pleinePage: true,
      apres: restaurerCompteAdministration,
    },
    {
      nom: "connexion-verifier",
      description: "Ré-authentification : une action sensible redemande le code 2FA après 10 min",
      connexion: COMPTES.admin,
      chemin: "/connexion/verifier?suite=%2Fadmin%2Fcomptes",
    },
    { nom: "mot-de-passe-oublie", description: "Mot de passe oublié (administrateurs)", chemin: "/mot-de-passe-oublie" },
    {
      nom: "invitation-nouveau",
      description: "Lien personnel : premier accès (pas de mot de passe à créer)",
      chemin: `/invitation/${TOKEN_NOUVEAU}`,
    },
    {
      nom: "invitation-existant",
      description: "Lien personnel : membre ayant déjà ouvert l'application",
      chemin: `/invitation/${TOKEN_EXISTANT}`,
    },
    { nom: "invitation-invalide", description: "Invitation : lien non valide", chemin: "/invitation/lien-qui-n-existe-pas-0123456789012345678901234567" },
    // ─── Le parcours d'entrée, tel qu'on le reçoit : email → lien → application ───────────────────
    // Quatre écrans qui s'enchaînent sur le téléphone, plus les deux pages de connexion qu'ils
    // visent. Ils n'existent que sur un appareil mobile (voir `UA_IPHONE`) et n'offrent le bouton
    // « Copier mon lien » que si le cookie de passage porte le jeton : les deux sont donc simulés.
    {
      nom: "parcours-1-installer",
      description: "Parcours d'entrée (1/4) : le lien vient d'ouvrir l'application — veux-tu l'installer ?",
      connexion: COMPTES.membre,
      chemin: "/bienvenue",
      userAgent: UA_IPHONE,
      cookies: [{ name: LIEN_PERSO_COOKIE, value: TOKEN_EXISTANT }],
      avant: async (page) => {
        await page.getByRole("button", { name: "Oui, l'installer" }).waitFor();
      },
      pleinePage: true,
    },
    {
      nom: "parcours-2-guide",
      description: "Parcours d'entrée (2/4) : les gestes d'installation de l'appareil, puis « Copier mon lien »",
      connexion: COMPTES.membre,
      chemin: "/bienvenue",
      userAgent: UA_IPHONE,
      cookies: [{ name: LIEN_PERSO_COOKIE, value: TOKEN_EXISTANT }],
      avant: async (page) => {
        await page.getByRole("button", { name: "Oui, l'installer" }).click();
        await page.getByRole("heading", { name: "Installer l'application", level: 1 }).waitFor();
      },
      pleinePage: true,
    },
    {
      nom: "parcours-3-deja-installee",
      description: "Parcours d'entrée (3/4) : « je l'ai déjà installée » — copier son lien pour le coller dans l'app",
      connexion: COMPTES.membre,
      chemin: "/bienvenue",
      userAgent: UA_IPHONE,
      cookies: [{ name: LIEN_PERSO_COOKIE, value: TOKEN_EXISTANT }],
      avant: async (page) => {
        await page.getByRole("button", { name: "Je l'ai déjà installée" }).click();
        await page.getByRole("heading", { name: "Connecter l'application installée" }).waitFor();
      },
      pleinePage: true,
    },
    {
      nom: "parcours-4-consolider",
      description: "Parcours d'entrée (4/4) : mot de passe facultatif, ou « Continuer avec mon lien »",
      connexion: COMPTES.membre,
      chemin: "/bienvenue",
      cookies: [{ name: LIEN_PERSO_COOKIE, value: TOKEN_EXISTANT }],
      avant: async (page) => {
        // Sur ordinateur la question de l'installation ne se pose pas : on arrive directement ici.
        await page.getByRole("heading", { name: "Consolider ton compte" }).waitFor();
      },
      pleinePage: true,
    },
    {
      nom: "connexion-lien-memorise",
      description: "Page de connexion : un lien est gardé sur cet appareil — un bouton pour entrer, un pour l'oublier",
      // **`/connexion` nu, et pas `?lien=copie`** : ce paramètre est l'arrivée par « Copier mon
      // lien », où le champ de collage doit être devant les yeux — le composant rend alors son
      // corps seul, sans le bloc du lien gardé. La scène visait donc l'écran qu'elle ne voulait pas
      // montrer, et c'est `connexion-coller-lien` qui couvre ce cas-là.
      chemin: "/connexion",
      avant: async (page) => {
        // Ce que l'application a retenu du dernier collage (stockage du navigateur, par appareil) :
        // on le pose comme il y serait, puis on recharge pour voir l'écran tel qu'il s'ouvre vraiment.
        await page.evaluate((jeton) => window.localStorage.setItem("hema_lien_memorise", jeton), `${BASE}/invitation/${TOKEN_EXISTANT}`);
        await page.reload({ waitUntil: "networkidle" });
        // **Le libellé a changé** : « mon lien » est devenu « ce lien », parce qu'une seule clé est
        // mémorisée par appareil et que l'écran ne sait pas à qui elle est. On attend le **titre du
        // bloc**, qui dit la chose plutôt que le geste — il bougera moins.
        await page.getByRole("heading", { name: "Un lien est gardé sur cet appareil" }).waitFor();
      },
      pleinePage: true,
    },
    {
      nom: "connexion-coller-lien",
      description: "Page de connexion, champ de collage en évidence (retour du bouton « Copier mon lien »)",
      chemin: "/connexion?lien=copie",
      pleinePage: true,
    },
    {
      nom: "connexion-2fa-proposee",
      description: "Double authentification **proposée** (membre qui s'est donné un mot de passe) : bouton « Plus tard »",
      chemin: "/connexion",
      avant: async (page) => {
        await donnerMotDePasseDemo();
        await page.reload({ waitUntil: "networkidle" });
        await page.getByLabel("Email", { exact: true }).fill(COMPTES.membre);
        await page.getByLabel("Mot de passe", { exact: true }).fill(DEMO_MDP);
        await page.getByRole("button", { name: "Se connecter" }).click();
        await page.waitForURL("**/connexion/code");
        await page.getByRole("heading", { name: "Protéger mon compte" }).waitFor();
      },
      pleinePage: true,
      apres: retirerMotDePasseDemo,
    },
    { nom: "planning", description: "Planning vu par un membre : tout le trimestre en lecture seule", connexion: COMPTES.membre, chemin: "/planning", pleinePage: true },
    {
      nom: "planning-edition",
      description: "Planning en mode modification : la liste des thèmes dépliée — elle s'ouvre toujours vers le bas",
      connexion: COMPTES.instructeur,
      // `?modifier=1` : le planning s'ouvre **en lecture seule** pour l'encadrement aussi, et
      // aucune case n'est réglable avant d'avoir appuyé sur « Modifier le planning ». Sans ce
      // paramètre, cette scène n'aurait plus de liste déroulante à déplier.
      chemin: "/planning?modifier=1",
      // La scène montre la liste **ouverte**, parce que c'est là qu'était le défaut : un `<select>`
      // natif s'ouvrait vers le haut et son sommet sortait de l'écran. Une capture de la case
      // fermée ne dirait rien de ce qui a changé.
      avant: async (page) => {
        /*
         * La case est trouvée **par son libellé**, pas par son identifiant : depuis que chaque
         * séance porte ses propres parties, un identifiant de champ est celui d'une partie en base
         * (`<id>-theme`) — il change à chaque jeu d'essai regénéré. Le nom accessible du
         * déclencheur, lui, commence toujours par « Thème — », quel que soit le nom donné à la
         * partie : c'est ce que voit la personne, et c'est ce qui doit servir à la viser.
         */
        /*
         * **Visée par l'identifiant du champ, pas par son rôle.** On cherchait `getByRole("button",
         * { name: /^Thème — / })` : depuis que la liste déroulante se cherche, son déclencheur
         * porte `role="combobox"` — le rôle explicite l'emporte, et `button` ne le trouvait plus du
         * tout. Le suffixe `-theme` de l'identifiant, lui, ne dépend ni du rôle ARIA du jour ni du
         * nom de la partie (`<id de partie>-theme`).
         */
        const listes = page.locator('button[id$="-theme"]');
        await listes.first().waitFor();
        /*
         * **Une case basse dans la grille, et pas forcément la troisième.** On visait `nth(2)` en
         * dur : depuis que la case ne montre que ce qui est rempli, une séance peut n'exposer
         * qu'une ou deux listes de thème — et `nth(2)` attendait alors trente secondes un élément
         * qui n'existe pas. C'est ce qui a mis cette scène en échec pendant la campagne. On prend
         * donc la troisième **si elle existe**, la dernière sinon : ce qui compte, c'est que la
         * liste soit assez bas dans la page pour montrer qu'elle s'ouvre malgré tout vers le bas.
         */
        const combien = await listes.count();
        const cible = listes.nth(Math.min(2, combien - 1));
        /*
         * **Amener la case au milieu de la fenêtre avant de cliquer.** C'est la panne :
         * `locator.click: Timeout 30000ms exceeded` sur une case pourtant bien présente. Playwright
         * fait défiler juste ce qu'il faut pour rendre l'élément visible — et sur cet écran, «
         * juste ce qu'il faut » le dépose **sous l'en-tête collant**, qui intercepte alors chaque
         * essai de clic jusqu'à l'expiration. Le sélecteur n'était pas périmé ; c'est le point de
         * clic qui était couvert. On pose donc nous-mêmes le défilement, au milieu de la hauteur
         * utile : la case est dégagée de l'en-tête, et elle reste assez basse pour que la scène
         * montre ce qu'elle promet — la liste qui s'ouvre malgré tout vers le bas.
         */
        await cible.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
        await cible.click();
        await page.getByRole("listbox").waitFor();
      },
    },
    // La recherche par date : les deux écrans montrent le **jour cherché seul**, et le disent —
    // c'est le point qui décide si la fonctionnalité se comprend ou inquiète. **La date se demande
    // au jeu de démonstration** : `dateDemo` la replace là où le seed a posé ses séances (il se
    // recale sur la semaine en cours, voir `ANCRAGE_DEMO`). Écrite en dur, elle désignait un jour
    // sans cours dès le premier recalage, et ces deux scènes montraient le message « aucune séance
    // à cette date » — un écran vide qui ressemble à une capture réussie.
    { nom: "seances-date", description: "Séances : le cours d'une date précise, trouvé sans changer de trimestre ni de fenêtre", connexion: COMPTES.membre, chemin: `/seances?date=${SEANCE_PASSEE_DEMO}`, pleinePage: true },
    { nom: "planning-date", description: "Planning : la date cherchée, et le trimestre qui la contient ouvert tout seul", connexion: COMPTES.instructeur, chemin: `/planning?date=${SEANCE_PASSEE_DEMO}` },
    // Le planning tel que l'encadrement le **trouve** : en lecture seule, comme un membre, avec le
    // seul bouton qui ouvre la saisie. C'est le défaut depuis cette date, et c'est précisément ce
    // que la scène doit montrer — l'écran d'avant était un mur de listes déroulantes.
    { nom: "planning-instructeur", description: "Planning (équipe) : en lecture seule par défaut, avec le bouton « Modifier le planning »", connexion: COMPTES.instructeur, chemin: "/planning" },
    { nom: "planning-semaine", description: "Planning (équipe) : fenêtre resserrée sur les deux prochaines semaines", connexion: COMPTES.instructeur, chemin: "/planning?h=2semaines" },
    {
      nom: "accueil",
      description: "Accueil d'un membre : ses prochains cours, puis sa progression (rang gagné à l'ancienneté, série, blasons)",
      connexion: COMPTES.membre,
      chemin: "/",
      // Pleine page : c'est l'écran le plus ouvert de l'application, et depuis qu'il porte les
      // cours **et** la progression, une capture à la hauteur de la fenêtre n'en montrait que le
      // premier tiers — on y cherchait les fiches de cours sans les trouver.
      pleinePage: true,
    },
    {
      // L'atterrissage quand l'espace admin s'est refermé tout seul (10 min sans rien y faire) : on
      // vérifie surtout que le message est là, et qu'il arrive sur un accueil intact.
      nom: "accueil-admin-referme",
      description: "Accueil après la fermeture automatique de l'espace admin : ce qui s'est passé, et ce qui n'a pas bougé",
      connexion: COMPTES.membre,
      chemin: "/?admin=expire",
    },
    {
      nom: "accueil-admin",
      description: "Accueil, troisième position de la bascule : la vue Admin (pilotage du trimestre et file de l'encadrement)",
      connexion: COMPTES.admin,
      chemin: "/",
      pleinePage: true,
      avant: async (page) => {
        await page.getByRole("heading", { level: 1 }).first().waitFor();
        // La bascule ne montre sa troisième position qu'aux administrateurs : c'est elle, la scène.
        await page.getByRole("button", { name: "Admin" }).click();
        await page.getByText(/Pour l'encadrement|ateliers? en attente/i).first().waitFor();
      },
    },
    {
      nom: "accueil-equipe",
      description: "Accueil vu par un instructeur : le même compte rendu, plus le bloc réservé à l'encadrement",
      connexion: COMPTES.instructeur,
      chemin: "/",
      // Pleine page : le bloc de l'encadrement vient après les prochaines séances, hors fenêtre sur téléphone.
      pleinePage: true,
      avant: async (page) => {
        // Attentes volontairement larges (rôles et textes stables), pas de classe ni d'identifiant :
        // les composants de l'accueil bougent encore, seuls le titre, la carte du prochain cours
        // et le lien vers l'espace instructeur sont des repères sûrs.
        await page.getByRole("heading", { level: 1 }).first().waitFor();
        await page.getByText(/Prochains? cours|Prochaines? séances/i).first().waitFor();
        // Le bloc de l'encadrement renvoie vers la gestion : c'est ce lien qui dit « la vue équipe est peinte ».
        await page.getByRole("link").filter({ hasText: /Ateliers|Séances|Espace instructeur/i }).first().waitFor();
      },
    },
    {
      nom: "seances",
      description: "Séances : répondre en un tap, et le nombre de présents en grand sur chaque carte",
      connexion: COMPTES.membre,
      chemin: CHEMIN_SEANCES,
      avant: async (page) => {
        // Repères stables de l'écran : son titre, et le premier bouton de réponse (le sujet de la scène).
        await page.getByRole("heading", { level: 1 }).first().waitFor();
        await page.getByRole("button", { name: "Présent" }).first().waitFor();
      },
    },
    {
      nom: "accueil-reponse",
      description: "Séances : après un tap sur « Présent » (confirmation)",
      connexion: COMPTES.planifie,
      chemin: CHEMIN_SEANCES,
      avant: async (page) => {
        // Le cours du jour est verrouillé une fois commencé : on répond sur la première carte encore ouverte
        await page.locator("button:not([disabled])").filter({ hasText: "Présent" }).first().click();
        await page.getByText(/C'est noté/).first().waitFor();
      },
    },
    {
      /*
       * **L'écran qui remplace une écriture par un appui**.
       *
       * Les boutons « Je viens » / « Je ne viens plus » du pied des emails de rappel menaient à
       * `/seances?seance=…&reponse=present`, et cette adresse **écrivait au rendu** : un antivirus de
       * messagerie ou un service de liens sûrs qui précharge l'URL répondait donc **à la place du
       * membre**. Le lien n'a pas changé de forme (les emails déjà partis marchent) ; il ouvre
       * maintenant cet écran, qui montre le cours et ce qui sera enregistré, et attend l'appui.
       *
       * L'identifiant vient de la base (`prochaineSeanceDemo`) et non d'un `href` : aucun écran ne le
       * donne à un membre, sa carte de cours menant au planning. Il n'est pas écrit en dur pour autant,
       * le jeu de démonstration se réengendrant.
       */
      nom: "reponse-depuis-email",
      description: "Lien « Je viens » d'un email de rappel : l'écran qui demande l'appui, parce qu'un lien préchargé ne doit jamais répondre à la place du membre",
      connexion: COMPTES.membre,
      chemin: CHEMIN_SEANCES,
      avant: async (page) => {
        await allerA(page, `${BASE}/seances?seance=${await prochaineSeanceDemo()}&reponse=present`);
        await page.getByRole("button", { name: "Oui, je viens" }).waitFor();
      },
    },
    {
      nom: "accueil-participants",
      description: "Séances : liste nominative « Qui vient ? » dépliée",
      connexion: COMPTES.membre,
      chemin: CHEMIN_SEANCES,
      avant: async (page) => {
        await page.getByText(/Qui vient \?/).first().click();
      },
    },
    {
      nom: "mes-presences",
      description: "Séances → Mon historique : taux par période, et « Qui était là ? » sur la première séance",
      connexion: COMPTES.membre,
      chemin: `${CHEMIN_SEANCES}?vue=historique`,
      avant: async (page) => {
        await page.getByText(/Qui était là \?/).first().click();
      },
    },
    { nom: "profil", description: "Mon profil (membre) : rappels, rappel du fonctionnement du lien", connexion: COMPTES.membre, chemin: "/profil", pleinePage: true },
    {
      nom: "profil-theme",
      description: "Mon profil : choisir son thème de couleurs dans la liste",
      connexion: COMPTES.membre,
      chemin: "/profil",
      avant: async (page) => {
        const titre = page.getByRole("heading", { name: /Apparence/i });
        await titre.waitFor();
        // La liste déroulante est le sujet de la scène : on attend qu'elle soit peinte avant de cadrer dessus.
        await page.getByLabel("Thème de couleurs").waitFor();
        await titre.evaluate((el) => el.scrollIntoView({ block: "start" }));
      },
    },
    ...SCENES_THEMES,
    {
      nom: "connexion-elevation",
      description: "Un responsable entré par son lien veut ouvrir l'administration : le compte du bureau est demandé",
      connexion: COMPTES.adminNominatif,
      chemin: "/admin",
      /*
       * **Remise en état : on oublie la session du compte du bureau.**
       *
       * Cette scène photographie un responsable **non élevé** devant la porte de l'administration,
       * et elle est immédiatement suivie de scènes d'administration qui, elles, ont besoin de
       * l'élévation. La campagne de la nuit est morte là, sur la scène d'après
       * (`gestion-membre-liens`, `net::ERR_ABORTED` en ouvrant une fiche membre) : l'état
       * d'administrateur gardé en cache ne valait plus rien et la navigation tombait sur une
       * redirection vers `/connexion/admin`.
       *
       * Jeter l'état ici force `etatConnecte` à repasser la porte (mot de passe + code + élévation)
       * avant la scène suivante. **Une scène ne doit pas laisser le monde dans un état où la suivante
       * ne peut pas travailler** — et c'est plus sûr que de compter sur un ordre de scènes, qu'un
       * ajout au milieu de la liste défait sans prévenir.
       */
      apres: async () => {
        sessions.delete(COMPTES.admin);
      },
    },
    {
      nom: "gestion-membre-liens",
      description: "Fiche membre : régénérer / révoquer le lien personnel",
      connexion: COMPTES.admin,
      chemin: "/admin/membres",
      avant: async (page) => {
        // Sur mobile, la barre d'onglets recouvre le bas de la liste : on ouvre la fiche par son adresse
        const href = await page.getByRole("link", { name: "Foxtrot 08" }).first().getAttribute("href");
        await allerA(page, `${BASE}${href}`);
        await page.getByRole("heading", { name: /Périodes et liens/ }).waitFor();
      },
      pleinePage: true,
    },
    {
      nom: "profil-admin",
      description: "Mon profil (admin) : double authentification et mot de passe",
      connexion: COMPTES.admin,
      chemin: "/profil",
      pleinePage: true,
      avant: async (page) => {
        await page.locator("summary", { hasText: "Double authentification" }).click();
      },
    },
    {
      nom: "admin-elevation",
      description: "Se connecter en tant qu'administrateur : l'élévation, depuis une session déjà ouverte",
      connexion: COMPTES.admin,
      chemin: "/profil",
      avant: async (page) => {
        // L'espace admin vit dans un cookie de session (`hema_admin`) : le retirer du navigateur
        // remet exactement l'état d'un administrateur qui vient de rouvrir son application. Rien
        // n'est touché en base — c'est aussi ce que fait la fermeture de l'app.
        await page.context().clearCookies({ name: "hema_admin" });
        await allerA(page, `${BASE}/connexion/admin`);
        await page.getByLabel("Mon mot de passe").waitFor();
      },
      pleinePage: true,
    },
    {
      nom: "profil-admin-non-eleve",
      description: "Mon profil (admin entré par son lien) : l'espace admin se prend en redonnant mot de passe et code",
      connexion: COMPTES.adminNominatif,
      chemin: "/profil",
      pleinePage: true,
    },
    { nom: "admin-comptes", description: "Administration : comptes admin et état de la double authentification", connexion: COMPTES.admin, chemin: "/admin/comptes", pleinePage: true },
    { nom: "admin-themes", description: "Administration : les thèmes du planning et les lieux habituels des cours", connexion: COMPTES.admin, chemin: "/admin/themes", pleinePage: true },
    {
      nom: "admin-identite",
      description: "Administration → Identité : nom du club, sigle, thème, couleur de marque et dépôt des deux logos",
      connexion: COMPTES.admin,
      chemin: "/admin/identite",
      pleinePage: true,
    },
    {
      /*
       * **La carte « Effectif » de l'onglet Club**. L'onglet est long : sur la capture pleine page,
       * le champ « Part minimale de l'effectif (%) » et la phrase qui le traduit en personnes se
       * perdent tout en bas, illisibles dans un mode d'emploi. On cadre donc la carte elle-même —
       * capture au format de l'écran, carte amenée en haut.
       */
      nom: "admin-club-effectif",
      description: "Administration → Club : la carte Effectif — la part minimale, et ce qu'elle vaut en personnes",
      connexion: COMPTES.admin,
      chemin: "/admin/identite",
      avant: async (page) => {
        await page.getByLabel("Part minimale de l'effectif (%)").waitFor();
        /*
         * **Amener le titre sous l'en-tête, pas dessous.** `scrollIntoView({ block: "start" })` colle
         * le titre au bord haut de la fenêtre — c'est-à-dire **derrière** la barre d'en-tête fixe :
         * le premier essai a rendu une capture où « Effectif » et « Part minimale de l'effectif (%) »
         * étaient masqués, et où il ne restait que la valeur « 20 » sans son intitulé. On retranche
         * donc la hauteur réelle de l'en-tête (elle n'est pas la même sur téléphone et sur PC).
         */
        await page.getByRole("heading", { name: "Effectif", exact: true }).evaluate((el) => {
          const entete = document.querySelector("header");
          const marge = (entete?.getBoundingClientRect().height ?? 0) + 16;
          const y = el.getBoundingClientRect().top + window.scrollY - marge;
          window.scrollTo({ top: Math.max(0, y), behavior: "instant" });
        });
        // Le temps que le défilement soit pris en compte et que les images au-dessus se posent.
        await page.waitForTimeout(400);
      },
    },
    {
      nom: "admin-telegram",
      description: "Administration → Notifications → Telegram : brancher le bot et trouver l'identifiant du salon",
      connexion: COMPTES.admin,
      chemin: "/admin/notifications/telegram",
      pleinePage: true,
    },
    { nom: "ateliers-membre", description: "Proposer un atelier : formulaire sans champ obligatoire, puis mes propositions", connexion: COMPTES.refuse, chemin: "/ateliers", pleinePage: true },
    { nom: "seances-equipe", description: "Séances vues par l'encadrement : le même écran, avec « Modifier » et « Annuler » au pied des cartes", connexion: COMPTES.instructeur, chemin: "/seances" },
    {
      nom: "gestion-seance",
      description: "Gestion : une séance (autosave du thème, présences, annulation, modification)",
      connexion: COMPTES.instructeur,
      chemin: "/seances",
      avant: async (page) => {
        const href = await page.getByRole("link", { name: "Modifier" }).first().getAttribute("href");
        await allerA(page, `${BASE}${href}`);
      },
      pleinePage: true,
    },
    {
      nom: "gestion-seance-presences",
      description: "Gestion d'une séance : le bureau corrige la réponse de n'importe qui, même après le cours",
      connexion: COMPTES.admin,
      // Bascule « Passé » : on ouvre une séance déjà donnée, là où la correction du registre a posteriori prend son sens
      chemin: "/seances?quand=passe",
      avant: async (page) => {
        const href = await page.getByRole("link", { name: "Modifier" }).first().getAttribute("href");
        await allerA(page, `${BASE}${href}`);
        // La liste éditable est repliée par défaut (comme « Qui était là ? ») : on la déplie pour la photographier
        await page.locator("summary", { hasText: "Modifier les réponses" }).click();
        await page.locator('select[id^="presence-"]').first().waitFor();
        // Capture au cadre de la carte « Présences » plutôt qu'en pleine page : c'est elle que la scène montre
        await page.getByRole("heading", { name: "Présences", exact: true }).evaluate((el) => el.scrollIntoView({ block: "start" }));
      },
    },
    { nom: "gestion-periodes", description: "Gestion : périodes, regroupées par saison", connexion: COMPTES.admin, chemin: "/admin/periodes" },
    { nom: "gestion-periode-nouvelle", description: "Nouvelle période : un trimestre de la saison (T1, T2, T3 ou la période estivale), ou des dates libres", connexion: COMPTES.admin, chemin: "/admin/periodes/nouvelle", pleinePage: true },
    {
      nom: "gestion-periode-bimestre",
      description: "Nouvelle période, onglet Bimestre : six cycles de deux mois, calés sur septembre (pair) ou sur octobre (impair)",
      connexion: COMPTES.admin,
      chemin: "/admin/periodes/nouvelle",
      // L'onglet des bimestres ne s'ouvre pas tout seul : c'est le trimestre qui est proposé par défaut
      avant: async (page) => {
        await page.getByRole("button", { name: "Bimestre", exact: true }).click();
        await page.getByRole("group", { name: "Calage des cycles" }).waitFor();
      },
      pleinePage: true,
    },
    {
      nom: "admin-presences",
      description: "Espace admin → Présences : corriger la réponse de n'importe qui sans ouvrir la fiche du cours",
      connexion: COMPTES.admin,
      chemin: "/admin/presences",
      avant: async (page) => {
        // La liste des invités s'ouvre dépliée sur cet écran : on attend qu'elle soit là pour la photographier
        await page.locator('select[id^="presence-"]').first().waitFor();
      },
      pleinePage: true,
    },
    {
      /*
       * **Le geste par lots, montré coché**.
       *
       * À l'origine, la barre d'action **n'existait pas sans sélection** : le mode d'emploi décrivait
       * donc un bouton qu'aucune image ne portait. Elle est montée en permanence depuis le 30/09 au
       * soir (elle était introuvable pour qui n'avait pas deviné qu'il fallait cocher), et la capture
       * de la liste au repos, juste au-dessus, la montre désormais **inerte**. Cette scène-ci garde son
       * utilité : elle montre l'autre état, celui où les quatre réponses sont vraiment cliquables.
       */
      nom: "admin-presences-lot",
      description: "Espace admin → Présences : trois personnes cochées, et la barre qui corrige leur réponse d'un coup",
      connexion: COMPTES.admin,
      chemin: "/admin/presences",
      avant: async (page) => {
        await page.locator('select[id^="presence-"]').first().waitFor();
        // Les cases de ligne sont dans les `<li>` de la liste ; la case maîtresse, elle, est au-dessus
        // dans un `<div>` — on ne la coche pas, sinon la barre annonce « les 12 personnes » et l'image
        // ne montre plus le geste courant (« j'en coche trois »).
        const cases = page.locator('li input[type="checkbox"]');
        const combien = Math.min(3, await cases.count());
        if (combien === 0) throw new Error("aucune case à cocher sur /admin/presences : la sélection par lots a disparu de l'écran");
        for (let i = 0; i < combien; i++) await cases.nth(i).check();
        await page.getByRole("group", { name: "Modifier la réponse de plusieurs personnes à la fois" }).waitFor();
      },
      pleinePage: true,
    },
    {
      nom: "gestion-periode",
      description: "Gestion : une période (créneaux avec lieux au choix, génération, membres et liens)",
      connexion: COMPTES.admin,
      chemin: "/admin/periodes",
      avant: async (page) => {
        const href = await page.getByRole("link", { name: /Rentrée|T[1-4] \d{4}|Saison/ }).first().getAttribute("href");
        await allerA(page, `${BASE}${href}`);
      },
      pleinePage: true,
    },
    { nom: "gestion-membres", description: "Espace admin : l'annuaire du club — fiches, adresses et liens personnels, réservés au bureau", connexion: COMPTES.admin, chemin: "/admin/membres", pleinePage: true },
    {
      /*
       * **Les gestes de masse de l'annuaire, montrés cochés**. Même raison qu'aux présences : la
       * barre est là au repos, mais inerte — cette scène montre l'état où l'on agit vraiment, et
       * elle porte **quatre** gestes (rôle, puis désactiver / réactiver / supprimer). La case d'une
       * ligne se nomme « Sélectionner <prénom nom> » (voir `CaseMembre`), la case maîtresse «
       * Sélectionner les N personnes » — d'où la négation, qui écarte la maîtresse sans dépendre
       * d'un nom du jeu de démonstration.
       */
      nom: "gestion-membres-roles",
      description: "Espace admin → Annuaire : des comptes cochés, et la barre qui change leur rôle en une fois",
      connexion: COMPTES.admin,
      chemin: "/admin/membres",
      avant: async (page) => {
        const cases = page.getByRole("checkbox", { name: /^Sélectionner (?!les |ce |cette )/ });
        await cases.first().waitFor();
        const combien = Math.min(3, await cases.count());
        /*
         * **On attend la barre après la PREMIÈRE case, pas à la fin**.
         *
         * Depuis que la barre ne se monte qu'avec une sélection, le premier clic **insère** deux cents
         * pixels au-dessus de la liste : toutes les lignes descendent d'un coup. En cochant à la
         * chaîne, le clic suivant visait une case que ce décalage venait de faire passer **sous la
         * barre de navigation du bas** (`fixed bottom-0`), qui l'interceptait — soixante secondes
         * d'essais, puis l'échec, sur un écran de 390 px seulement.
         *
         * Cocher d'abord une case, attendre que la barre soit là, puis cocher les autres : la mise en
         * page ne bouge plus qu'une fois, et c'est aussi la façon dont un humain procède — il voit la
         * barre apparaître avant de continuer.
         */
        await cases.first().check();
        await page.getByRole("group", { name: "Agir sur plusieurs comptes à la fois" }).waitFor();
        for (let i = 1; i < combien; i++) {
          /*
           * **Centrer la ligne avant de la cocher**, et c'est la correction qui porte. La barre
           * d'action est `sticky top-20` : un défilement « au plus près » amène la case **sous
           * elle**, où le clic est intercepté — définitivement, puisque la barre ne bouge plus. Le
           * premier essai (cocher une case, attendre la barre, puis les autres) ne suffisait pas :
           * ce n'était pas le décalage qui gênait, c'était la barre elle-même. Au centre, la case
           * échappe aussi bien au sticky du haut qu'à la navigation fixe du bas.
           */
          await cases.nth(i).evaluate((el) => el.scrollIntoView({ block: "center" }));
          await cases.nth(i).check();
        }
      },
      pleinePage: true,
    },
    {
      nom: "gestion-membre",
      description: "Gestion : fiche d'un membre (rôle, liens d'accès, compte)",
      connexion: COMPTES.admin,
      chemin: "/admin/membres",
      avant: async (page) => {
        const href = await page.getByRole("link", { name: "India" }).first().getAttribute("href");
        await allerA(page, `${BASE}${href}`);
      },
      pleinePage: true,
    },
    {
      nom: "gestion-membres-inactif",
      description: "Membres : désactiver ou réactiver un compte en un geste, sans ouvrir la fiche",
      connexion: COMPTES.admin,
      chemin: "/admin/membres?inactifs=1",
      avant: async (page) => {
        await definirActifDemo(false);
        await page.reload({ waitUntil: "networkidle" });
      },
      apres: () => definirActifDemo(true),
      pleinePage: true,
    },
    {
      nom: "evenements-fil",
      description: "Événements : le fil des annonces à venir (tarif, durée, « Gratuit »)",
      connexion: COMPTES.membre,
      chemin: "/evenements",
      avant: async (page) => {
        // Le fil doit montrer les deux cas de tarif côte à côte : le montant tel qu'il a été saisi
        // sur l'annonce payante, et le mot « Gratuit » que l'**affichage** ajoute sur une annonce
        // dont le champ prix est resté vide (la base garde `""`, elle n'écrit jamais « Gratuit »).
        const { payant, gratuit } = await lireEvenementsDemo();
        if (payant) await attendreTexteSiPossible(page, payant.prix, `le fil n'affiche pas le tarif « ${payant.prix} » de l'annonce payante`);
        await attendreTexteSiPossible(page, /Gratuit/, gratuit ? "le fil n'affiche pas « Gratuit » sur l'annonce sans tarif" : "aucune annonce publiée sans tarif dans le jeu de démonstration : le fil ne montrera pas « Gratuit »");
      },
      pleinePage: true,
    },
    {
      nom: "evenement-detail",
      description: "Un événement : détail, tarif et durée, lieu cliquable, inscription et partage",
      connexion: COMPTES.membre,
      chemin: "/evenements",
      avant: async (page) => {
        // On vise l'annonce qui **porte un tarif** (le stage payant du jeu de démonstration) : c'est
        // celle qui montre les champs prix et durée. À défaut, repli sur le stage d'épée longue.
        const { payant } = await lireEvenementsDemo();
        if (payant) {
          await allerA(page, `${BASE}/evenements/${payant.id}`);
          await attendreTexteSiPossible(page, payant.prix, `l'annonce « ${payant.id} » n'affiche pas son tarif « ${payant.prix} »`);
          await attendreTexteSiPossible(page, DUREE_AFFICHEE, `l'annonce « ${payant.id} » n'affiche aucune durée (demi-journée(s), jour(s) ou semaine(s))`);
          return;
        }
        const href = await page.getByRole("link").filter({ hasText: /Stage d.épée longue/ }).first().getAttribute("href");
        await allerA(page, `${BASE}${href}`);
      },
      pleinePage: true,
    },
    {
      nom: "gestion-evenements",
      description: "Gestion des événements (administrateurs) : publier, modifier, supprimer",
      connexion: COMPTES.admin,
      chemin: "/gestion/evenements",
      pleinePage: true,
    },
    {
      nom: "evenement-affiche",
      description: "Nouvelle annonce : l'affiche se dépose d'un glisser, ou se choisit d'un clic",
      connexion: COMPTES.admin,
      chemin: "/evenements/nouveau",
      avant: async (page) => {
        // Dépôt simulé : Playwright pose le fichier sur l'input du champ « Affiche » — le composant
        // réagit comme à un glisser-déposer (téléversement puis aperçu), sans piloter la souris.
        const fichier = page.locator('input[type="file"]').first();
        await fichier.waitFor({ state: "attached" });
        await fichier.setInputFiles({ name: "affiche-tournoi.png", mimeType: "image/png", buffer: affichePngDemo() });
        // Le bouton « Retirer l'affiche » n'existe qu'une fois l'affiche déposée : c'est l'attente qui dit « aperçu prêt ».
        const retirer = page.getByRole("button", { name: /Retirer l'affiche/i });
        await retirer.waitFor();
        // …mais l'aperçu local paraît **avant** la fin du téléversement : sans cette seconde attente,
        // la capture fige un « Envoi… » en cours plutôt que l'état final que l'on veut montrer.
        await page.getByText("Affiche enregistrée.").waitFor();
        await retirer.scrollIntoViewIfNeeded();
      },
    },
    {
      nom: "profil-notifications",
      description: "Mon profil : choisir type par type les messages que l'on reçoit",
      connexion: COMPTES.membre,
      chemin: "/profil",
      pleinePage: true,
    },
    { nom: "gestion-ateliers", description: "Gestion : un geste par proposition — placer dans le planning (séance pré-remplie) ou refuser", connexion: COMPTES.admin, chemin: "/gestion/ateliers", pleinePage: true },
    { nom: "gestion-tableau-de-bord", description: "Tableau de bord : taux par séance et par membre", connexion: COMPTES.instructeur, chemin: "/gestion/tableau-de-bord", pleinePage: true },
    { nom: "gestion-reglages", description: "Espace admin → Notifications : heure du récap et matrice des canaux", connexion: COMPTES.admin, chemin: "/admin/notifications" },
    { nom: "admin-apropos", description: "Administration → À propos : version, contenu de la base, sauvegardes, API publique", connexion: COMPTES.admin, chemin: "/admin/apropos", pleinePage: true },
    { nom: "admin-sessions", description: "Administration : sessions de connexion", connexion: COMPTES.admin, chemin: "/admin/sessions" },
    { nom: "admin-audit", description: "Administration : journal d'audit (filtres, dates, export CSV, raccourcis)", connexion: COMPTES.admin, chemin: "/admin/audit" },
    {
      nom: "email-atelier",
      description: "Email : atelier planifié",
      html: renderEmailHtml(
        emailAtelierStatut({ prenom: "Bravo", titre: "Échauffement à la corde", statut: "PLANIFIE", commentaire: "Parfait pour démarrer la séance.", seance: { date: "2026-09-26", heureDebut: "19:00", lieu: "Gymnase municipal, Villebourg" } }).contenu,
      CLUB_EMAIL),
      pleinePage: true,
    },
    {
      nom: "email-invitation",
      description: "Email d'invitation (premier accès)",
      html: renderEmailHtml(
        emailInvitation({ prenom: "Juliett", periodeNom: "Rentrée 2026", url: `${BASE}/invitation/${TOKEN_NOUVEAU}`, nomApp: NOM_APP }).contenu,
      CLUB_EMAIL),
      pleinePage: true,
    },
    {
      nom: "email-reset",
      description: "Email « mot de passe oublié » (compte d'administration)",
      html: renderEmailHtml(emailReset({ prenom: "Echo", url: `${BASE}/reinitialiser/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`, nomApp: NOM_APP }).contenu, CLUB_EMAIL),
      pleinePage: true,
    },
    {
      nom: "email-renouvellement",
      description: "Email : lien d'accès renouvelé (au bout de 3 mois)",
      html: renderEmailHtml(emailInvitation({ prenom: "Golf", periodeNom: "Rentrée 2026", url: `${BASE}/invitation/${TOKEN_NOUVEAU}`, motif: "renouvellement", nomApp: NOM_APP }).contenu, CLUB_EMAIL),
      pleinePage: true,
    },
    {
      nom: "email-lien-securite",
      description: "Email : lien remplacé par sécurité (ouvertures anormales ou 3 appareils)",
      html: renderEmailHtml(emailInvitation({ prenom: "10", periodeNom: "Rentrée 2026", url: `${BASE}/invitation/${TOKEN_NOUVEAU}`, motif: "securite", nomApp: NOM_APP }).contenu, CLUB_EMAIL),
      pleinePage: true,
    },
    {
      nom: "email-nouvel-appareil",
      description: "Email : nouvel appareil connecté avec le lien personnel",
      html: renderEmailHtml(
        emailNouvelAppareil({ prenom: "Bravo", appareil: "Chrome sur Android", ip: "203.0.113.42", quand: "22/09/2026 à 20:14", nomApp: NOM_APP }).contenu,
      CLUB_EMAIL),
      pleinePage: true,
    },
    {
      nom: "email-effectif-faible",
      description: "Email aux instructeurs : peu de monde sur une séance, avec le bouton d'annulation",
      html: renderEmailHtml(
        emailEffectifFaible({
          prenom: "Charlie",
          seance: { date: "2026-09-26", heureDebut: "19:00", heureFin: "21:00", lieu: "Gymnase municipal, Villebourg" },
          presents: 2,
          invites: 12,
          sansReponse: 5,
          urlAnnulation: `${BASE}/annuler/jeton-signe-exemple`,
        }).contenu,
      CLUB_EMAIL),
      pleinePage: true,
    },
    {
      nom: "email-seance-annulee",
      description: "Email à tous les invités : séance annulée (date, horaire, lieu, motif)",
      html: renderEmailHtml(
        emailSeanceAnnulee({
          prenom: "Juliett",
          seance: { date: "2026-09-26", heureDebut: "19:00", heureFin: "21:00", lieu: "Gymnase municipal, Villebourg" },
          motif: "Trop peu de participants",
          nomApp: NOM_APP,
        }).contenu,
      CLUB_EMAIL),
      pleinePage: true,
    },
    {
      nom: "email-atelier-refuse",
      description: "Email au membre : atelier non retenu",
      html: renderEmailHtml(
        emailAtelierStatut({ prenom: "10", titre: "Initiation au sabre laser", statut: "REFUSE", commentaire: "Hors du cadre AMHE, mais pourquoi pas pour la soirée de fin d'année !", seance: null }).contenu,
      CLUB_EMAIL),
      pleinePage: true,
    },
    {
      nom: "email-rappel-veille",
      description: "Email de la veille aux inscrits : le contenu commun, son propre statut, et deux boutons pour le changer",
      html: renderEmailHtml(
        emailRecapVeille({
          prenom: "Bravo",
          seance: SEANCE_NOTIF,
          chiffres: { presents: CHIFFRES_NOTIF.presents, invites: CHIFFRES_NOTIF.invites },
          statut: "PRESENT",
          urlPresent: `${BASE}/seances?seance=exemple&reponse=PRESENT`,
          urlAbsent: `${BASE}/seances?seance=exemple&reponse=ABSENT`,
          urlDesinscription: `${BASE}/desinscription/jeton-signe-exemple`,
        }).contenu,
      CLUB_EMAIL),
      pleinePage: true,
    },
    {
      nom: "email-rappel-sans-reponse",
      description: "Email de relance (J-7 puis J-2) à qui n'a pas encore répondu",
      html: renderEmailHtml(
        emailRappelSansReponse({
          prenom: "Golf",
          seance: SEANCE_NOTIF,
          chiffres: { presents: CHIFFRES_NOTIF.presents, invites: CHIFFRES_NOTIF.invites },
          jours: 2,
          urlApp: `${BASE}/seances`,
          urlDesinscription: `${BASE}/desinscription/jeton-signe-exemple`,
        }).contenu,
      CLUB_EMAIL),
      pleinePage: true,
    },
    {
      nom: "discord-recap-veille",
      description: "Discord : le récap de la veille tel qu'il tombe dans le salon (maquette fidèle du client)",
      html: maquetteDiscord(
        [
          embedSeance(SEANCE_NOTIF, CHIFFRES_NOTIF, CLUB.nomClub, CLUB.partEffectifMin, {
            programme: [
              { label: "1re partie", theme: "Messer — garde haute", niveau: "DEBUTANT", atelier: false },
              { label: "2de partie", theme: "Jeu de la hache", niveau: "INDIFFERENT", atelier: true },
            ],
          }),
        ],
        "cours-a-venir",
      ),
      pleinePage: true,
    },
    {
      nom: "discord-annulation",
      description: "Discord : annulation d'un cours (message immédiat, rouge de la charte)",
      html: maquetteDiscord([embedAnnulation(SEANCE_NOTIF, "Salle indisponible (match de handball)", CLUB.nomClub)], "annonces"),
      pleinePage: true,
    },
    {
      nom: "discord-effectif-faible",
      description: "Discord : alerte « peu de monde » à l'équipe (or de la charte, aucun nom)",
      html: maquetteDiscord([embedEffectifFaible(SEANCE_NOTIF, { presents: 2, invites: 18 }, 9, CLUB.nomClub)], "equipe-encadrement"),
      pleinePage: true,
    },
    {
      nom: "push-telephone",
      description: "Notifications sur le téléphone (Web Push) : ce qui s'affiche sur l'écran verrouillé",
      html: maquettePush([
        { titre: "Cours dans deux jours", corps: "jeu. 24 sept. à 19h30, Gymnase municipal — tu viens ?", url: "/seances" },
        chargeAnnulationPush({ id: "exemple", date: "2026-09-24", heureDebut: "19:30" }, "Salle indisponible"),
        chargeEffectifFaiblePush({ id: "exemple", date: "2026-09-24", heureDebut: "19:30", period: { membres: Array.from({ length: 18 }, (_, i) => ({ userId: `u${i}` })) } }, 2),
      ]),
    },
    {
      nom: "annuler-confirmation",
      description: "Page ouverte depuis l'email : confirmation avant d'annuler la séance",
      chemin: "/annuler/JETON", // remplacé au lancement par un lien signé sur une vraie séance
      pleinePage: true,
    },
    {
      nom: "desinscription-question",
      description: "Lien de désinscription d'un email : on demande d'abord, on coupe ensuite (un GET ne désinscrit personne)",
      chemin: "/desinscription/JETON", // remplacé au lancement par un jeton signé sur un vrai compte
      pleinePage: true,
    },
    {
      nom: "desinscription-faite",
      description: "Désinscription : c'est fait, avec le bouton « je me suis trompé » pour revenir en arrière",
      chemin: "/desinscription/JETON?etat=inactif",
      pleinePage: true,
    },
    {
      nom: "partage-seance",
      description: "Partage public d'une séance (lien WhatsApp) : aucun nom, et rien d'un trimestre encore en brouillon",
      chemin: "/partage/seance/ID", // remplacé au lancement par une séance à venir
      pleinePage: true,
    },
  ];
}

function arg(name: string): string | undefined {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a?.slice(name.length + 3);
}

/** Une seule connexion par compte (état de session réutilisé, pour ne pas déclencher le limiteur de débit). */
const sessions = new Map<string, { etat: Awaited<ReturnType<BrowserContext["storageState"]>>; ne: number }>();

/**
 * **L'état d'administrateur ne survit pas toujours jusqu'aux scènes d'administration**.
 *
 * Deux raisons, et une seule parade. L'espace admin se referme après **dix minutes sans rien y
 * faire** (`DUREE_INACTIVITE_ELEVATION_MS`), or l'état de session est pris une fois et rejoué pour
 * toutes les scènes : entre la connexion et les écrans d'administration, la galerie passe un long
 * moment sur des écrans de membre, qui ne repoussent pas cette échéance. Et certaines scènes
 * **effacent les sessions du compte d'administration** en rendant ses accès
 * (`restaurerCompteAdministration`), ce qui périme l'état sans rien changer à son âge.
 *
 * Deviner lequel des deux vient d'arriver serait fragile : on **demande à l'application**. Un appel
 * sur un écran d'administration dit en un coup si l'état vaut encore quelque chose — et, quand c'est
 * le cas, il repousse l'échéance d'inactivité par la même occasion.
 */
async function etatAdminEncoreValable(browser: Browser, etat: Awaited<ReturnType<BrowserContext["storageState"]>>): Promise<boolean> {
  const context = await browser.newContext({ baseURL: BASE, storageState: etat });
  context.setDefaultTimeout(ACTION_MS);
  try {
    const reponse = await context.request.get(`${BASE}/admin/comptes`, { maxRedirects: 0 });
    return reponse.status() === 200;
  } catch {
    return false;
  } finally {
    await context.close();
  }
}

async function etatConnecte(browser: Browser, email: string) {
  const existant = sessions.get(email);
  if (existant && email !== COMPTES.admin) return existant.etat;
  if (existant && (await etatAdminEncoreValable(browser, existant.etat))) return existant.etat;
  const context = await browser.newContext({ baseURL: BASE });
  context.setDefaultTimeout(ACTION_MS);
  const page = await context.newPage();
  if (email === COMPTES.admin) {
    // Administrateur : mot de passe puis code de double authentification (secret fixe du seed)
    await page.goto(`${BASE}/connexion`);
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Mot de passe", { exact: true }).fill(DEMO_MDP);
    await page.getByRole("button", { name: "Se connecter" }).click();
    await page.waitForURL("**/connexion/code");
    await page.getByLabel("Code à 6 chiffres").fill(await codeTotpFrais(DEMO_TOTP_SECRET));
    await page.getByRole("button", { name: "Se connecter" }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/connexion"));
    /*
     * **La connexion n'ouvre plus l'espace admin** : les scènes d'administration seraient déposées
     * sur `/connexion/admin`. On passe donc la porte tout de suite, une fois, avec les deux preuves
     * — exactement le geste que fait Delta.
     */
    await page.goto(`${BASE}/connexion/admin`);
    await page.getByLabel("Mon mot de passe").fill(DEMO_MDP);
    await page.getByLabel("Code à 6 chiffres").fill(await codeTotpFrais(DEMO_TOTP_SECRET));
    await page.getByRole("button", { name: "Ouvrir l'espace admin" }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/connexion"));
  } else {
    // Tout le monde d'autre : lien personnel
    await page.goto(`${BASE}/invitation/${demoLien(email)}`);
    await page.getByRole("button", { name: "Ouvrir l'application" }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/invitation"));
  }
  const etat = await context.storageState();
  await context.close();
  sessions.set(email, { etat, ne: Date.now() });
  return etat;
}

/** La première ligne d'une erreur : ce qu'on met dans un récapitulatif, un rapport et une galerie. */
function premiereLigne(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).split("\n")[0].trim();
}

/**
 * **Le témoin de développement de Next** — la pastille « N Issues » en bas de l'écran.
 * `next.config.ts` le coupe déjà (`devIndicators: false`), mais il s'est retrouvé **imprimé dans des
 * PDF de guides** : une capture destinée à un mode d'emploi ne doit pas dépendre d'un réglage de
 * serveur qu'un redémarrage oublié suffit à perdre. Ceinture et bretelles, donc, du côté de la
 * capture elle-même.
 */
const MASQUE_TEMOIN_DEV = "nextjs-portal,[data-nextjs-toast],[data-nextjs-dev-tools-button],#__next-build-watcher{display:none!important}";

/**
 * **Ouvrir une page sans se faire avoir par une redirection.**
 *
 * `waitUntil: "networkidle"` sur une navigation que le serveur solde par une redirection (une
 * session d'administration à repasser, par exemple) rend `net::ERR_ABORTED` — c'est exactement ce
 * qui a tué la campagne de la nuit sur `gestion-membre-liens`, à la 47ᵉ scène. On attend donc le
 * **document**, puis le silence réseau sans en faire une condition, et on réessaie une fois : le
 * second essai part d'un état déjà établi.
 *
 * **Et on laisse à `next dev` le temps de compiler.** Les trente secondes par défaut de Playwright
 * sont un budget d'affichage, pas un budget de compilation : un écran qu'aucune scène n'a encore
 * ouvert est construit à la demande, et il n'y a que dans une campagne complète que les écrans
 * voisins l'ont déjà payé pour lui. Lancée seule (`--only=`), `admin-club-effectif` a ainsi échoué
 * quatre fois de suite sur `page.goto: Timeout 30000ms exceeded` et n'a **rien** produit — un trou
 * dans le guide de l'administrateur —, alors que la même scène passe en sept secondes dès que
 * `/admin/identite` est compilé. Pire : chaque essai abandonné relance l'attente à zéro, si bien
 * que réessayer ne rattrape jamais une première compilation trop lente.
 */
const NAVIGATION_MS = Number(process.env.PREVIEW_NAVIGATION_MS ?? 120_000);

/**
 * **Les trente secondes de Playwright ne sont pas non plus un budget d'attente d'écran**.
 *
 * `NAVIGATION_MS` a appris la leçon pour `goto`, et elle s'arrête là : `locator.click`,
 * `locator.waitFor` et `waitForURL` gardaient le défaut de la bibliothèque. Or un `page.reload()` suivi
 * d'un `waitFor("html[data-theme=…]")` attend exactement la même chose qu'un `goto` — que `next dev`
 * ait fini de reconstruire l'écran. Une campagne complète sur une machine chargée a rendu huit scènes
 * rouges sur ce seul motif (quatre thèmes, deux portes de connexion, un clic d'administration), toutes
 * vertes au second essai : un délai, pas un défaut.
 *
 * Soixante secondes, et non cent-vingt : au-delà, une vraie régression (un sélecteur qui ne désigne
 * plus rien) mettrait deux minutes à se dire, par scène, et la campagne cesserait d'être lisible.
 */
const ACTION_MS = Number(process.env.PREVIEW_ACTION_MS ?? 60_000);

async function allerA(page: Page, url: string): Promise<void> {
  for (let essai = 1; ; essai++) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAVIGATION_MS });
      break;
    } catch (e) {
      if (essai === 2) throw e;
      console.warn(`⟳ ${url} : ${premiereLigne(e)} — nouvel essai.`);
    }
  }
  await page.waitForLoadState("networkidle").catch(() => {});
}

/**
 * **La vérification, faite sur le disque et pas sur la foi du script.** Ce que la campagne croit
 * avoir capturé ne vaut rien : on relit le dossier, fichier par fichier, et on note la date de
 * chacun. C'est cette lecture qui alimente le récapitulatif, la galerie, le rapport et le code de
 * sortie — une scène sans ses quatre images est en échec même si elle n'a levé aucune erreur.
 */
async function verifier(scene: Scene, tentee: boolean, erreur: string | undefined, essais: number): Promise<ResultatScene> {
  const dir = path.join(OUT, scene.nom);
  const presentes: string[] = [];
  let date: Date | null = null;
  for (const nom of ATTENDUS) {
    const info = await stat(path.join(dir, nom)).catch(() => null);
    if (!info || !info.isFile() || info.size === 0) continue;
    presentes.push(nom);
    if (!date || info.mtime > date) date = info.mtime;
  }
  return {
    nom: scene.nom,
    description: scene.description,
    presentes,
    manquantes: ATTENDUS.filter((n) => !presentes.includes(n)),
    date,
    erreur,
    essais,
    tentee,
  };
}

/**
 * **Une scène en échec ne fait plus tomber la campagne.** Une scène qui échoue est une information ;
 * une campagne qui s'arrête au milieu est un piège — elle laisse en place les images de l'avant-veille
 * et la galerie de la veille, et tout a l'air frais. On capture donc les autres, et l'échec est
 * inscrit (console, galerie, `previews/rapport.json`, code de sortie).
 *
 * **Un second essai, et un seul** : la panne vécue venait d'un état de session d'administration
 * devenu caduc au milieu de la course. On jette donc la session en cache du compte avant de réessayer —
 * `etatConnecte` repasse alors la porte (mot de passe + code + élévation) au lieu de rejouer un état
 * périmé. Deux échecs de suite, c'est une vraie panne : on la nomme et on continue.
 */
async function capturerScene(browser: Browser, scene: Scene): Promise<ResultatScene> {
  let erreur: string | undefined;
  let essais = 0;
  while (essais < 2) {
    essais++;
    try {
      await capturer(browser, scene);
      erreur = undefined;
      break;
    } catch (e) {
      erreur = premiereLigne(e);
      if (essais === 1) {
        console.warn(`⟳ ${scene.nom} : ${erreur} — session oubliée, nouvel essai.`);
        // Seule la session du compte de la scène est jetée : vider la table entière ferait
        // reconnecter tout le monde par lien personnel, et le limiteur de débit s'en mêlerait.
        if (scene.connexion) sessions.delete(scene.connexion);
      } else {
        console.error(`✖ ${scene.nom} : ${erreur}`);
        console.error(e);
      }
    }
  }
  return verifier(scene, true, erreur, essais);
}

async function capturer(browser: Browser, scene: Scene): Promise<string[]> {
  const fichiers: string[] = [];
  const dir = path.join(OUT, scene.nom);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  for (const [formatNom, format] of Object.entries(FORMATS)) {
    for (const [themeNom, theme] of Object.entries(THEMES)) {
      const context: BrowserContext = await browser.newContext({
        storageState: scene.connexion ? await etatConnecte(browser, scene.connexion) : undefined,
        viewport: { width: format.width, height: format.height },
        isMobile: format.isMobile,
        hasTouch: format.hasTouch,
        deviceScaleFactor: format.deviceScaleFactor,
        colorScheme: theme,
        locale: "fr-FR",
        timezoneId: "Europe/Paris",
        baseURL: BASE,
        ...(scene.userAgent ? { userAgent: scene.userAgent } : {}),
      });
      context.setDefaultTimeout(ACTION_MS);
      // Posés avant la première ouverture : le cookie du lien personnel est lu au rendu du serveur,
      // le poser après coup n'aurait plus d'effet sur la page déjà construite.
      if (scene.cookies) await context.addCookies(scene.cookies.map((c) => ({ ...c, url: BASE })));
      const page = await context.newPage();
      try {
        if (scene.html) {
          await page.setContent(scene.html, { waitUntil: "networkidle" });
        } else {
          await allerA(page, `${BASE}${scene.chemin}`);
          if (scene.avant) await scene.avant(page);
        }
        // Posé après les gestes de la scène : une navigation en aurait emporté la balise.
        await page.addStyleTag({ content: MASQUE_TEMOIN_DEV }).catch(() => {});
        await page.evaluate(() => document.fonts.ready);
        const fichier = path.join(dir, `${formatNom}-${themeNom}.jpg`);
        await page.screenshot({ path: fichier, fullPage: scene.pleinePage ?? false, type: "jpeg", quality: 82 });
        fichiers.push(fichier);
      } finally {
        await context.close();
        // Une scène qui abîme le jeu de données (ex. première connexion du compte d'administration) le remet en état
        if (scene.apres) await scene.apres();
      }
    }
  }
  return fichiers;
}

/**
 * **L'état d'une scène, en une phrase.** C'est la ligne que la galerie affiche sous le titre et que
 * le récapitulatif imprime : elle dit toujours **la date de la capture**, parce que c'est ce qui a
 * manqué — six écrans du jour et cinq des 27 et 29 septembre se présentaient de la même façon, et
 * l'aperçu publié derrière était à moitié périmé.
 */
function etatScene(r: ResultatScene): { classe: "frais" | "vieux" | "echec"; texte: string } {
  const quand = r.date ? r.date.toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "long", timeStyle: "short" }) : "jamais capturée";
  const compte = `${r.presentes.length}/${ATTENDUS.length} images`;
  if (r.erreur) return { classe: "echec", texte: `ÉCHEC — ${r.erreur} · ${compte} · ${quand}` };
  if (!r.presentes.length) return { classe: "echec", texte: "AUCUNE IMAGE — cette scène n'a rien produit" };
  if (r.manquantes.length) return { classe: "echec", texte: `INCOMPLÈTE — ${compte} (manque ${r.manquantes.join(", ")}) · ${quand}` };
  if (!estFraiche(r)) return { classe: "vieux", texte: `PÉRIMÉE — capture du ${quand}, pas refaite depuis` };
  return { classe: "frais", texte: `capturée le ${quand}${r.tentee ? "" : " (galerie reconstruite sans nouvelles captures)"}` };
}

/**
 * Galerie HTML : previews/index.html — publiée comme aperçu à chaque étape.
 *
 * **Elle est écrite quoi qu'il arrive**, et elle dit ce qu'elle ne montre pas. Avant, elle n'était
 * écrite qu'en fin de course : une campagne interrompue laissait la galerie de la veille en place,
 * datée de la veille, et rien ne disait que cinq scènes sur onze n'avaient pas bougé. Désormais
 * chaque section porte **la date de sa capture** et, s'il y a lieu, un bandeau « ÉCHEC »,
 * « INCOMPLÈTE » ou « PÉRIMÉE » ; l'en-tête compte les scènes fraîches et nomme les fautives.
 */
async function galerie(lignes: ResultatScene[], titreEtape: string): Promise<void> {
  const sections: string[] = [];
  const sommaire: string[] = [];
  for (const r of lignes) {
    const etat = etatScene(r);
    const marque = etat.classe === "echec" ? "✖ " : etat.classe === "vieux" ? "⏳ " : "";
    sommaire.push(`<a class="${etat.classe}" href="#${r.nom}">${marque}${r.nom}</a>`);
    // Images référencées en relatif (publiées comme fichiers annexes de la galerie)
    const figures = r.presentes.map((f) => {
      const [format, theme] = f.replace(".jpg", "").split("-");
      return `<figure class="${format}"><img src="${r.nom}/${f}" alt="${echapper(r.description)} — ${format} ${theme}" loading="lazy"><figcaption><b>${format === "pc" ? "PC 1280×800" : "Mobile 390×844"}</b> · ${theme}</figcaption></figure>`;
    });
    // Une scène sans image garde sa section : un trou nommé se voit, un trou absent se croit comblé.
    const corps = figures.length ? `<div class="grille">${figures.join("")}</div>` : `<p class="rien">Aucune image à montrer pour cette scène.</p>`;
    sections.push(
      `<section id="${r.nom}"><header><h2>${echapper(r.description)}</h2><code>${r.nom}</code></header><p class="etat ${etat.classe}">${echapper(etat.texte)}</p>${corps}</section>`,
    );
  }
  const echecs = lignes.filter((r) => etatScene(r).classe === "echec");
  const vieilles = lignes.filter((r) => etatScene(r).classe === "vieux");
  const fraiches = lignes.length - echecs.length - vieilles.length;
  const date = new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "long", timeStyle: "short" });
  const bandeau = echecs.length || vieilles.length
    ? `<div class="alerte"><b>⚠ Galerie incomplète.</b> ${echecs.length} scène(s) en échec${vieilles.length ? `, ${vieilles.length} périmée(s)` : ""} sur ${lignes.length}.${
        echecs.length ? ` En échec : ${echecs.map((r) => `<code>${r.nom}</code> (${echapper(r.erreur ?? "images manquantes")})`).join(", ")}.` : ""
      }</div>`
    : "";
  const html = `<title>Aperçus ${echapper(CLUB.nomCourt)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IM+Fell+Great+Primer+SC&display=swap">
<style>
:root{--bleu:#AF4B2F;--or:#E6C977;--encre:#2B2622;--fond:#F4F0EE;--surface:#FFFDFA;--texte:#282828;--texte2:#6B6059;--bordure:#D6CBBD;--ombre:0 1px 2px rgba(43,38,34,.06);--rouge:#B3261E;--ocre:#8A5A00;--vert:#2F6B3A}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--fond:#2C2622;--surface:#3A322C;--texte:#F4EDE3;--texte2:#C4B8A9;--bordure:#5A4E43;--ombre:none;--bleu:#D8785C;--rouge:#F2B8B5;--ocre:#E8C07A;--vert:#9BD3A6}}
:root[data-theme="dark"]{--fond:#2C2622;--surface:#3A322C;--texte:#F4EDE3;--texte2:#C4B8A9;--bordure:#5A4E43;--ombre:none;--bleu:#D8785C;--rouge:#F2B8B5;--ocre:#E8C07A;--vert:#9BD3A6}
*{box-sizing:border-box}body{margin:0;background:var(--fond);color:var(--texte);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.entete{background:var(--encre);color:#F1E8D8;padding:20px 16px 16px}.entete h1{font-family:"IM Fell Great Primer SC",Georgia,serif;font-weight:400;font-size:1.6rem;margin:0;color:var(--or);text-wrap:balance}
.entete p{margin:6px 0 0;color:#D9CDB8;font-size:.95rem}
.alerte{margin:12px 16px 0;padding:12px 14px;border:2px solid var(--rouge);border-radius:10px;background:var(--surface);color:var(--texte);font-size:.95rem}
.alerte code{color:var(--rouge)}
nav{position:sticky;top:0;z-index:2;background:var(--surface);border-bottom:1px solid var(--bordure);padding:8px 16px;display:flex;gap:8px;overflow-x:auto;white-space:nowrap;scrollbar-width:none}
nav a{color:var(--bleu);text-decoration:none;font-size:.85rem;font-weight:600;padding:6px 10px;border:1px solid var(--bordure);border-radius:999px;background:var(--surface)}
nav a.echec{color:var(--rouge);border-color:var(--rouge)}nav a.vieux{color:var(--ocre);border-color:var(--ocre)}
main{max-width:1200px;margin:0 auto;padding:16px;display:grid;gap:28px}
section header{display:flex;flex-wrap:wrap;align-items:baseline;gap:10px;margin-bottom:4px}
h2{font-family:"IM Fell Great Primer SC",Georgia,serif;font-size:1.25rem;margin:0;font-weight:400;color:var(--texte)}
:root[data-theme="dark"] h2{color:var(--or)}@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) h2{color:var(--or)}}
code{font-size:.8rem;color:var(--texte2)}
.etat{margin:0 0 10px;font-size:.85rem;font-weight:600}
.etat.frais{color:var(--vert)}.etat.vieux{color:var(--ocre)}.etat.echec{color:var(--rouge)}
.rien{margin:0;padding:14px;border:2px dashed var(--rouge);border-radius:10px;color:var(--rouge);font-weight:600}
.grille{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
figure{margin:0;background:var(--surface);border:1px solid var(--bordure);border-radius:10px;padding:8px;box-shadow:var(--ombre)}
figure.pc{grid-column:1/-1}
img{display:block;width:100%;height:auto;border-radius:6px;border:1px solid var(--bordure)}
figcaption{font-size:.8rem;color:var(--texte2);margin-top:6px;text-align:center}figcaption b{color:var(--texte);font-weight:600}
@media (min-width:900px){.grille{grid-template-columns:repeat(4,minmax(0,1fr))}figure.pc{grid-column:span 2}}
</style>
<div class="entete"><h1>Aperçus — ${echapper(titreEtape)}</h1><p>${lignes.length} écrans · ${fraiches} à jour, ${vieilles.length} périmé(s), ${echecs.length} en échec · mobile &amp; PC · clair &amp; sombre · généré le ${date}</p></div>
${bandeau}
<nav>${sommaire.join("")}</nav>
<main>${sections.join("")}</main>`;
  await writeFile(path.join(OUT, "index.html"), html, "utf8");
}

/**
 * **Le même verdict, lisible par une machine** : `previews/rapport.json`. Un aperçu se publie souvent
 * sans relire la console (la campagne tourne en tâche de fond) ; ce fichier permet de vérifier le
 * compte et les dates d'un coup, sans faire confiance à un journal qu'on n'a pas lu jusqu'au bout.
 */
async function ecrireRapport(lignes: ResultatScene[], titreEtape: string): Promise<void> {
  const rapport = {
    etape: titreEtape,
    debut: DEBUT.toISOString(),
    fin: new Date().toISOString(),
    base: BASE,
    attendues: ATTENDUS.length,
    scenes: lignes.map((r) => ({
      nom: r.nom,
      description: r.description,
      etat: etatScene(r).classe,
      images: r.presentes.length,
      manquantes: r.manquantes,
      date: r.date ? r.date.toISOString() : null,
      essais: r.essais,
      tentee: r.tentee,
      erreur: r.erreur ?? null,
    })),
  };
  await writeFile(path.join(OUT, "rapport.json"), JSON.stringify(rapport, null, 2), "utf8");
}

/**
 * **Le récapitulatif de fin de course** : une ligne par scène, avec son compte d'images et la date
 * de sa capture, puis les échecs nommés avec leur raison. Rendu volontairement bavard : c'est la
 * dernière chose qu'on lit avant de publier un aperçu, et le silence est précisément ce qui a trompé.
 */
function recapituler(lignes: ResultatScene[]): { echecs: ResultatScene[]; vieilles: ResultatScene[] } {
  const largeur = Math.max(4, ...lignes.map((r) => r.nom.length));
  const pluriel = lignes.length > 1 ? "s" : "";
  console.info(`\n── Récapitulatif : ${lignes.length} scène${pluriel}, ${ATTENDUS.length} images attendues par chacune ──`);
  for (const r of lignes) {
    const etat = etatScene(r);
    const marque = etat.classe === "echec" ? "✖" : etat.classe === "vieux" ? "⏳" : "✔";
    const quand = r.date ? r.date.toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "short" }) : "—";
    console.info(`${marque} ${r.nom.padEnd(largeur)}  ${r.presentes.length}/${ATTENDUS.length}  ${quand}${r.erreur ? `  ✖ ${r.erreur}` : ""}`);
  }
  const echecs = lignes.filter((r) => etatScene(r).classe === "echec");
  const vieilles = lignes.filter((r) => etatScene(r).classe === "vieux");
  const bonnes = lignes.length - echecs.length - vieilles.length;
  console.info(`\n${bonnes} scène${bonnes > 1 ? "s" : ""} complète${bonnes > 1 ? "s" : ""} et à jour sur ${lignes.length}.`);
  if (vieilles.length) console.warn(`⏳ Périmées (images d'une campagne précédente) : ${vieilles.map((r) => r.nom).join(", ")}`);
  if (echecs.length) {
    console.error(`\n✖ ${echecs.length} scène(s) en échec :`);
    for (const r of echecs) console.error(`   • ${r.nom} — ${r.erreur ?? `images manquantes : ${r.manquantes.join(", ")}`}`);
    console.error("\n⚠ CAMPAGNE INCOMPLÈTE : cette galerie ne doit pas être publiée comme fraîche.");
  }
  return { echecs, vieilles };
}

/**
 * Les scènes de connexion ont besoin d'accès connus (mot de passe et secret 2FA de démonstration)
 * et les bousculent au passage. On photographie donc les accès réels au lancement, on installe ceux
 * de la démonstration le temps de la campagne, et **on rend les vrais à la fin** : un mot de passe
 * choisi à la main par un administrateur n'est plus perdu par de simples captures.
 */
let accesInitiaux: InstantaneCompte | null = null;
/** Les accès ont-ils déjà été rendus ? (le `finally` et un Ctrl+C peuvent appeler tous les deux) */
let accesRendus = false;

/** Rend les accès réels du compte d'administration. Appelable deux fois, n'écrit qu'une. */
async function rendreAcces(): Promise<void> {
  if (accesRendus || !accesInitiaux) return;
  accesRendus = true;
  await restaurerInstantane(accesInitiaux);
  console.info("↩ accès du compte d'administration rendus tels qu'ils étaient avant les captures.");
}

/*
 * **Un `finally` ne survit pas à un Ctrl+C.** Un signal non intercepté arrête Node sans dérouler la
 * pile : sans ces deux écoutes, interrompre une campagne de 350 captures — ce qui arrive tous les
 * jours, la galerie entière prenant plusieurs minutes — laissait le compte d'administration ouvert au
 * mot de passe publié dans ce dépôt. On rend les accès, puis on sort avec le code d'un signal
 * (128 + n), pour que l'appelant sache que la campagne a été interrompue et non réussie.
 */
for (const [signal, code] of [["SIGINT", 130] as const, ["SIGTERM", 143] as const]) {
  process.once(signal, () => {
    void rendreAcces()
      .catch((e) => console.error("↩ échec de la remise en état du compte d'administration", e))
      .finally(() => process.exit(code));
  });
}

/**
 * Scène « reponse-depuis-email » : l'identifiant du **prochain cours non annulé** auquel le membre de
 * démonstration est invité.
 *
 * Pourquoi la base et pas la page : le lien du pied d'email vise `/seances?seance=<id>&reponse=…`, et
 * **aucun écran ne donne cet identifiant à un membre** — sa carte de cours mène au planning, jamais à
 * `/seances/<id>` (cette adresse-là n'est liée que par les actions de l'encadrement). Le premier essai
 * de cette scène le cherchait dans un `href` et attendait trente secondes pour rien. On ne l'écrit pas
 * en dur pour autant : le jeu de démonstration se réengendre, et un identifiant figé pourrirait la
 * scène au premier `db:seed:demo`.
 */
async function prochaineSeanceDemo(): Promise<string> {
  const db = new PrismaClient();
  try {
    const seance = await db.session.findFirst({
      where: { annulee: false, period: { membres: { some: { user: { email: COMPTES.membre } } } }, date: { gte: new Date().toISOString().slice(0, 10) } },
      orderBy: [{ date: "asc" }, { heureDebut: "asc" }],
      select: { id: true },
    });
    if (!seance) throw new Error("aucun cours à venir pour le membre de démonstration : le lien de réponse n'a rien à viser");
    return seance.id;
  } finally {
    await db.$disconnect();
  }
}

/** Scène « comptes désactivés » : bascule un compte repère le temps de la capture. */
async function definirActifDemo(actif: boolean): Promise<void> {
  const db = new PrismaClient();
  try {
    await db.user.update({ where: { email: COMPTES.lien }, data: { actif } });
  } finally {
    await db.$disconnect();
  }
}

/**
 * Scène « connexion-2fa-proposee » : la double authentification n'est proposée qu'à quelqu'un qui
 * s'est donné un mot de passe. Le compte de démonstration n'en a pas (le lien personnel suffit) :
 * on lui en pose un le temps de la capture, et on le retire aussitôt après — sans quoi toutes les
 * scènes suivantes photographieraient un membre qui n'est plus celui du jeu de données.
 */
async function donnerMotDePasseDemo(): Promise<void> {
  const db = new PrismaClient();
  try {
    await db.user.update({ where: { email: COMPTES.membre }, data: { passwordHash: await hashPassword(DEMO_MDP), deuxFaProposeeLe: null } });
  } finally {
    await db.$disconnect();
  }
}

async function retirerMotDePasseDemo(): Promise<void> {
  const db = new PrismaClient();
  try {
    await db.user.update({ where: { email: COMPTES.membre }, data: { passwordHash: null, deuxFaProposeeLe: null } });
  } finally {
    await db.$disconnect();
  }
}

/**
 * Scènes « theme-<id> » : posent un thème sur le compte de démonstration le temps des captures.
 * Le thème choisi avant la campagne est photographié au premier passage et rendu par `apres`.
 */
let themeInitialDemo: string | null = null;

async function definirThemeDemo(theme: string): Promise<void> {
  const db = new PrismaClient();
  try {
    if (themeInitialDemo === null) {
      const compte = await db.user.findUnique({ where: { email: COMPTES.membre }, select: { theme: true } });
      themeInitialDemo = compte?.theme ?? "parchemin";
    }
    await db.user.update({ where: { email: COMPTES.membre }, data: { theme } });
  } finally {
    await db.$disconnect();
  }
}

async function rendreThemeDemo(): Promise<void> {
  if (themeInitialDemo === null) return;
  const db = new PrismaClient();
  try {
    await db.user.update({ where: { email: COMPTES.membre }, data: { theme: themeInitialDemo } });
  } finally {
    await db.$disconnect();
  }
}

/**
 * Le libellé d'une durée tel que `libelleDuree()` l'écrit : un nombre puis l'unité accordée
 * (« 1 jour », « 2 jours », « 1 demi-journée », « 3 semaines »). Les scènes attendent ce **rendu**,
 * jamais les colonnes `dureeNombre` / `dureeUnite` qui le portent.
 */
const DUREE_AFFICHEE = /\d+\s*(demi-journées?|jours?|semaines?)/i;

/**
 * Annonces repères du jeu de démonstration (prisma/seed-demo.ts) : celle qui porte un **tarif**
 * (avec sa durée) et celle qui n'en porte pas — c'est cette dernière que l'affichage annonce
 * « Gratuit ». Lues en base plutôt qu'écrites en dur ici : le seed peut renommer ses annonces ou
 * changer ses libellés de prix sans casser les scènes.
 */
type EvenementsDemo = { payant: { id: string; prix: string } | null; gratuit: { id: string } | null };
let evenementsDemo: EvenementsDemo | null = null;

async function lireEvenementsDemo(): Promise<EvenementsDemo> {
  if (evenementsDemo) return evenementsDemo;
  const db = new PrismaClient();
  try {
    // On ne lit que `id` et `prix` : la durée est rangée en deux colonnes (`dureeNombre`,
    // `dureeUnite`) et c'est `libelleDuree()` qui l'écrit — la capture attend donc le libellé
    // rendu, pas la donnée, et ces scènes ne dépendent pas de la forme exacte du stockage.
    const publies = await db.evenement.findMany({
      where: { publie: true },
      orderBy: [{ dateDebut: "asc" }],
      select: { id: true, prix: true },
    });
    evenementsDemo = {
      payant: publies.find((e) => e.prix !== "") ?? null,
      gratuit: publies.find((e) => e.prix === "") ?? null,
    };
    return evenementsDemo;
  } finally {
    await db.$disconnect();
  }
}

/**
 * Attente explicite d'un texte à l'écran, **sans faire tomber la campagne** s'il manque : prix et
 * durée sont facultatifs et le jeu de démonstration peut ne pas les porter. Une scène qui échoue
 * interrompt les 50 et quelques autres ; on préfère prévenir dans la console et capturer quand même.
 */
async function attendreTexteSiPossible(page: Page, texte: string | RegExp, note: string): Promise<void> {
  try {
    await page.getByText(texte).first().waitFor({ timeout: 3_000 });
  } catch {
    console.warn(`⚠ ${note}`);
  }
}

/** Lien d'annulation signé d'une séance à venir (scène « annuler-confirmation »). */
async function lienAnnulationDemo(): Promise<string | null> {
  const db = new PrismaClient();
  try {
    const s = await db.session.findFirst({ where: { annulee: false, date: { gte: new Date().toISOString().slice(0, 10) } }, orderBy: [{ date: "asc" }] });
    if (!s) return null;
    // Le jeton est nominatif : il lui faut un porteur habilité, sinon la page répond « lien non
    // valide ». « Habilité » = `can(…, "sessions.manage")`, c'est-à-dire l'encadrement **ou** le
    // bureau — donc un `OR`, le bureau n'étant plus une valeur de `role` mais `estAdmin`. La forme
    // d'avant n'aurait plus trouvé qu'un instructeur, et aucun porteur du tout dans un jeu de
    // démonstration qui n'en compterait pas : l'aperçu serait tombé sur « lien non valide ».
    const porteur = await db.user.findFirst({ where: { actif: true, OR: [{ role: "INSTRUCTEUR" }, { estAdmin: true }] } });
    return porteur ? new URL(urlAnnulation(s.id, porteur.id)).pathname : null;
  } finally {
    await db.$disconnect();
  }
}

/** Jeton de désinscription d'un membre du jeu de démonstration (scènes « desinscription-* »). */
async function jetonDesinscriptionDemo(): Promise<string | null> {
  const db = new PrismaClient();
  try {
    const membre = await db.user.findFirst({ where: { actif: true, service: false, role: "MEMBRE" }, orderBy: { prenom: "asc" } });
    return membre ? jetonDesinscription(membre.id) : null;
  } finally {
    await db.$disconnect();
  }
}

/** Séance publiable pour la page de partage (scène « partage-seance ») : période ouverte, séance à venir. */
async function seancePartageeDemo(): Promise<string | null> {
  const db = new PrismaClient();
  try {
    const s = await db.session.findFirst({
      where: { annulee: false, date: { gte: new Date().toISOString().slice(0, 10) }, period: { statut: { not: "BROUILLON" } } },
      orderBy: [{ date: "asc" }],
    });
    return s?.id ?? null;
  } finally {
    await db.$disconnect();
  }
}

/**
 * **Le verrou d'honnêteté.** Le code de sortie vaut « échec » dès la première ligne de la campagne
 * et ne repasse à zéro qu'à la toute fin, une fois le disque relu et vérifié. Toute sortie
 * prématurée — erreur, processus tué, boucle d'événements vidée sur une promesse qui ne se règle
 * jamais — laisse donc un code non nul : elle ne peut pas se faire passer pour un succès. C'est le
 * cœur du correctif, où la campagne est morte à la 47ᵉ scène et où la commande a rendu 0.
 */
async function main() {
  process.exitCode = 1;
  // L'identité d'abord : les maquettes d'email et d'embed portent le nom et le logo du club.
  await chargerIdentite();
  const toutes = toutesLesScenes();
  const scenes = ONLY ? toutes.filter((s) => ONLY.includes(s.nom)) : toutes;
  const inconnues = (ONLY ?? []).filter((n) => !toutes.some((s) => s.nom === n));
  if (inconnues.length) throw new Error(`Scène(s) inconnue(s) dans --only : ${inconnues.join(", ")}`);
  await mkdir(OUT, { recursive: true });
  // Galerie réduite aux scènes demandées : la galerie entière pèse plus de 70 Mo et 350 images, au-delà
  // de ce qu'un artifact d'aperçu accepte (255 fichiers, 64 Mo). Une passe ciblée publie donc ses seuls
  // écrans — c'est aussi ce qu'on veut relire après une modification précise.
  const affichees = ONLY ? scenes : toutes;
  const resultats = new Map<string, ResultatScene>();
  const lignes: ResultatScene[] = [];
  accesInitiaux = await instantaneCompteAdministration();
  /*
   * **Le `try` commence ici, avant la première écriture, et pas plus loin**.
   *
   * `restaurerCompteAdministration()` pose le mot de passe et le secret 2FA publiés dans ce dépôt ; il
   * vivait **hors** du bloc qui rend les vrais, avec quatre requêtes et un `fetch` entre les deux —
   * dont celui qui vérifie que le serveur répond. Le scénario courant était donc : lancer les captures
   * sans `npm run dev`, voir « Serveur injoignable », et laisser derrière soi un compte
   * d'administration ouvert au mot de passe du dépôt, sans que rien ne le dise. Même chose pour un
   * navigateur qui refuse de démarrer, un disque plein ou une scène inconnue.
   *
   * La fenêtre à couvrir est celle où le mot de passe est modifié : elle s'ouvre à la ligne suivante.
   */
  try {
    await restaurerCompteAdministration();
    /*
     * **Le seau de limitation des connexions se vide avant la campagne**.
     *
     * Cette campagne se connecte des dizaines de fois avec le même compte, depuis la même adresse. Le
     * seau `login_email` / `login_ip` finit donc par se fermer **au milieu**, et la scène qui tombe
     * dessus échoue sur « waiting for navigation » — un message qui ne dit rien. Il faut ouvrir la
     * capture de la page pour y lire « Trop de tentatives ». Pire : la scène qui échoue change d'une
     * exécution à l'autre, puisqu'elle ne dépend que du nombre de connexions déjà faites. On a perdu
     * deux campagnes entières à chercher un défaut dans l'application, avant de regarder la table.
     *
     * C'est exactement la correction que la campagne e2e a reçue le 30/09 (`tests/e2e/global-setup.ts`,
     * qui raconte le même épisode) : **la campagne de captures n'en avait pas hérité**, parce que les
     * deux outils ne partagent pas leur préparation. Un défaut corrigé d'un côté ne dit rien de l'autre.
     *
     * On ne désactive pas le limiteur (`RATE_LIMIT_DISABLED`) : la campagne en capture les écrans, et un
     * limiteur éteint les rendrait faux. On lui rend son budget, c'est tout.
     */
    const { db } = await import("../src/lib/db");
    await db.rateLimit.deleteMany({});
    const lienAnnulation = await lienAnnulationDemo();
    for (const s of scenes) if (s.chemin === "/annuler/JETON" && lienAnnulation) s.chemin = lienAnnulation;
    const jetonDesinscrire = await jetonDesinscriptionDemo();
    if (jetonDesinscrire) for (const s of scenes) if (s.chemin?.startsWith("/desinscription/JETON")) s.chemin = s.chemin.replace("JETON", jetonDesinscrire);
    const seancePartagee = await seancePartageeDemo();
    if (seancePartagee) for (const s of scenes) if (s.chemin === "/partage/seance/ID") s.chemin = `/partage/seance/${seancePartagee}`;
    const sante = await fetch(`${BASE}/api/health`).then((r) => r.ok).catch(() => false);
    if (!sante) throw new Error(`Serveur injoignable sur ${BASE} : lance "npm run dev" (avec le seed de démonstration) avant les captures.`);
    const browser = await chromium.launch();
    try {
      for (const scene of SANS_CAPTURES ? [] : scenes) {
        const r = await capturerScene(browser, scene);
        resultats.set(scene.nom, r);
        if (estFraiche(r)) console.info(`✔ ${scene.nom} (${r.presentes.length} captures)`);
        else console.error(`✖ ${scene.nom} — ${r.erreur ?? `images manquantes : ${r.manquantes.join(", ")}`}`);
      }
    } finally {
      await browser.close().catch(() => {});
    }
  } finally {
    // Les accès réels du compte d'administration sont rendus, quoi qu'il soit arrivé entre-temps
    await rendreAcces();
    /*
     * **Galerie, rapport et récapitulatif sont écrits même en cas de panne**, et c'est le second
     * pilier du correctif : une galerie absente laisse en place celle de la veille, datée de la
     * veille, et tout y a l'air frais. Les scènes que cette course n'a pas tentées sont relues sur
     * le disque pour que leur âge soit dit, pas passé sous silence.
     */
    for (const s of affichees) lignes.push(resultats.get(s.nom) ?? (await verifier(s, false, undefined, 0)));
    await galerie(lignes, ETAPE);
    await ecrireRapport(lignes, ETAPE);
    console.info(`Galerie : ${path.join(OUT, "index.html")}`);
    console.info(`Rapport : ${path.join(OUT, "rapport.json")}`);
  }
  const { echecs, vieilles } = recapituler(lignes);
  if (!echecs.length && !vieilles.length) process.exitCode = 0;
}

main().catch((e) => {
  console.error(e);
  // `process.exitCode` et non `process.exit()` : la sortie immédiate tronque les écritures en cours,
  // et le récapitulatif — la seule chose qui dit ce qui manque — est précisément ce qu'on perdrait.
  process.exitCode = 1;
});
