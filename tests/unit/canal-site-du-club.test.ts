import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  figerCanauxIndisponibles,
  lirePreferences,
  preferencesDefaut,
  RAISON_API_EXCLUE,
  type Canal,
  type PreferencesNotifications,
} from "@/lib/notifications/preferences";
import { versSeancePublique } from "@/lib/api-publique";
import type { SeancePartagee } from "@/lib/partage";
import { compterPresences } from "@/lib/presences";

/**
 * **L'administration du canal « Site du club »** — ce que l'écran promet, et ce que le code tient.
 *
 * Trois défauts relevés, chacun avec sa contre-épreuve :
 *
 * 1. **la page du canal ne regardait qu'une des deux portes** : elle lisait
 *    `prefs.notifications[type].api` en direct, sans l'**interrupteur du canal** qu'exige
 *    `notificationActiveDans`. Publication ouverte, case cochée, interrupteur décoché : la route
 *    rendait `annonces: []` pendant que la page affichait « 1 annonce republiée » ;
 * 2. **fermer la publication puis enregistrer la matrice effaçait les cases** que la page promet de
 *    conserver : rendues `disabled`, elles ne sont pas envoyées par le navigateur, et
 *    l'enregistrement reconstruisant tout depuis le formulaire écrivait `false` en base ;
 * 3. **la matrice était la seule écriture de cet écran sans `exigerReauth`**, alors qu'elle décide
 *    désormais de ce que le club publie sur Internet.
 *
 * Plus deux points de finition : les deux portes ne se lisent plus qu'une fois par appel, et le
 * message de refus lit sa raison là où elle est écrite (`raisonCanalIndisponible`).
 */

const RACINE = process.cwd();
const lire = (relatif: string) => readFileSync(path.join(RACINE, relatif), "utf8");
/**
 * Le code **sans ses commentaires** : ce qu'on interdit ici, c'est un appel ou une phrase affichée,
 * pas le récit d'un défaut corrigé — ces fichiers expliquent longuement ce qu'ils ne font plus, et
 * une interdiction portée sur le texte brut se retournerait contre sa propre explication. Même
 * procédé que `notifications-preferences.test.ts`.
 */
const lireCode = (relatif: string) =>
  lire(relatif)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
const PAGE_CANAL = "src/app/(app)/admin/notifications/api/page.tsx";
const PAGE_MATRICE = "src/app/(app)/admin/notifications/page.tsx";
const ACTIONS = "src/actions/admin.ts";
const ROUTE = "src/app/api/public/annonces/route.ts";

/** Le corps d'une server action, pour n'affirmer quelque chose que sur elle. */
function corpsDe(code: string, nom: string): string {
  const debut = code.indexOf(`export async function ${nom}`);
  expect(debut, `${nom} : introuvable`).toBeGreaterThan(-1);
  const reste = code.slice(debut);
  return reste.slice(0, reste.indexOf("\n}\n"));
}

/** Tous les canaux opérationnels, sauf ceux qu'on nomme : la table qu'attend la fonction pure. */
function operationnelsSauf(...eteints: Canal[]): Record<Canal, boolean> {
  const table = { email: true, push: true, discord: true, telegram: true, whatsapp: true, api: true };
  for (const canal of eteints) table[canal] = false;
  return table;
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * 2. Enregistrer la matrice n'efface pas les cases d'un canal qu'on n'a pas pu toucher
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

describe("les cases d'un canal non opérationnel sont figées, pas effacées", () => {
  /** Ce que le club a décidé : deux annonces republiées sur le site. */
  function avantAvecDeuxCases() {
    const avant = preferencesDefaut();
    avant.notifications.recap_veille.api = true;
    avant.notifications.seance_annulee.api = true;
    return avant;
  }

  /**
   * Le scénario exact du défaut : on ferme la publication (carte du bas), puis on enregistre la
   * matrice. Les trois cellules `api` sont `disabled`, donc absentes du formulaire — l'objet `apres`
   * reconstruit depuis lui porte `false` partout, et l'interrupteur du canal avec.
   */
  it("publication fermée : enregistrer la matrice conserve les cases cochées", () => {
    const avant = avantAvecDeuxCases();
    const apres = preferencesDefaut();
    apres.canaux.api = false;
    apres.notifications.recap_veille.api = false;
    apres.notifications.seance_annulee.api = false;
    const { prefs, figes } = figerCanauxIndisponibles(avant, apres, operationnelsSauf("api"));
    expect(prefs.notifications.recap_veille.api).toBe(true);
    expect(prefs.notifications.seance_annulee.api).toBe(true);
    expect(prefs.notifications.evenement_nouveau.api).toBe(false); // celle-là n'était pas cochée
    expect(prefs.canaux.api).toBe(true);
    // Il y a quelque chose à dire à l'écran : des cases cochées qui ne peuvent rien faire.
    expect(figes).toEqual(["api"]);
  });

  /**
   * **Contre-épreuve.** Publication ouverte, les mêmes cellules sont tapables : c'est alors le
   * formulaire qui décide, décocher décoche vraiment — sans quoi le réglage serait mort.
   */
  it("publication ouverte : décocher une case l'efface bel et bien", () => {
    const avant = avantAvecDeuxCases();
    const apres = preferencesDefaut();
    apres.notifications.recap_veille.api = true;
    apres.notifications.seance_annulee.api = false; // l'administrateur vient de la décocher
    const { prefs, figes } = figerCanauxIndisponibles(avant, apres, operationnelsSauf());
    expect(prefs.notifications.recap_veille.api).toBe(true);
    expect(prefs.notifications.seance_annulee.api).toBe(false);
    expect(figes).toEqual([]);
  });

  /**
   * L'autre moitié de la garde d'origine, qui doit rester vraie : une case grisée **cochée de force**
   * par un client bricolé n'allume rien. Elle l'est maintenant par construction — la valeur retenue
   * ne vient pas du formulaire, mais de la base.
   */
  it("une case grisée cochée de force n'allume rien", () => {
    const avant = preferencesDefaut(); // aucune case « Site du club » cochée
    const apres = preferencesDefaut();
    apres.notifications.recap_veille.api = true;
    apres.notifications.evenement_nouveau.api = true;
    const { prefs, figes } = figerCanauxIndisponibles(avant, apres, operationnelsSauf("api"));
    expect(prefs.notifications.recap_veille.api).toBe(false);
    expect(prefs.notifications.evenement_nouveau.api).toBe(false);
    // Rien de coché, donc rien à signaler : le message ne parle que de ce qui attend quelque chose.
    expect(figes).toEqual([]);
  });

  it("la promesse est écrite sur l'écran du canal, et l'écran de la matrice dit la même chose", () => {
    expect(lire(PAGE_CANAL)).toMatch(/elles reprennent effet si la publication est\s+réouverte/);
    // Les deux façons de griser une cellule ont désormais la même conséquence, et l'écran le dit.
    expect(lire(PAGE_MATRICE)).toMatch(/ni être coché ni être vidé ici/);
  });
});

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * 3 et 6. Ce que l'action exige, et ce qu'elle répond
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

describe("enregistrer la matrice est une écriture comme les autres de cet écran", () => {
  it("redemande mot de passe et code, comme les huit autres actions de l'écran", () => {
    const code = lire(ACTIONS);
    const matrice = corpsDe(code, "enregistrerNotifications");
    expect(matrice).toContain('assertPermission("settings.technical")');
    expect(matrice).toContain('exigerReauth(user, "/admin/notifications")');
    // Contre-épreuve : c'est bien la même porte que celle qui ouvre la publication.
    expect(corpsDe(code, "enregistrerPublicationCours")).toContain('exigerReauth(user, "/admin/notifications")');
  });

  it("dit pourquoi un canal est laissé de côté avec la phrase du canal, pas une phrase écrite en dur", () => {
    const matrice = corpsDe(lireCode(ACTIONS), "enregistrerNotifications");
    expect(matrice).toContain("raisonCanalIndisponible");
    expect(matrice).not.toContain("canal non configuré");
  });

  it("enregistrer la matrice fait relire la page du canal, qui n'affiche que ça", () => {
    const matrice = corpsDe(lire(ACTIONS), "enregistrerNotifications");
    expect(matrice).toContain('revalidatePath("/admin/notifications/api")');
    expect(corpsDe(lire(ACTIONS), "enregistrerPublicationCours")).toContain('revalidatePath("/admin/notifications/api")');
  });
});

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * L'observation tranchée : la raison écrite pour `effectif_faible` doit dire vrai
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

describe("pourquoi « peu de monde » n'a pas de case", () => {
  it("la raison ne prétend pas cacher un taux qui sort déjà, et nomme ce qu'elle protège vraiment", () => {
    const raison = RAISON_API_EXCLUE.effectif_faible ?? "";
    expect(raison).toContain("alerte aux instructeurs");
    expect(raison).toContain("lien d'annulation");
    // Le taux du cours **sort déjà** par le récap de la veille : prétendre que publier l'alerte
    // révélerait « qu'un cours se remplit mal » était faux, et une raison fausse finit par servir
    // d'argument à quelqu'un.
    expect(raison).not.toMatch(/se remplit mal/);
    // Contre-épreuve, celle qui rendait l'argument faux : le taux est bien dans ce qui est publié.
    const seance: SeancePartagee = {
      id: "s1",
      date: "2026-10-13",
      heureDebut: "19:30",
      heureFin: "21:30",
      lieu: "Gymnase",
      adresse: "1 rue des Lices",
      theme: "Messer",
      alternative: "",
      disciplines: "Messer",
      annulee: false,
      motifAnnulation: null,
      compteurs: compterPresences(["PRESENT", "PRESENT", "PRESENT"], 18),
      programme: [],
      periode: { id: "p1", nom: "Rentrée 2026", statut: "ACTIVE" },
    };
    expect(versSeancePublique(seance).taux).toBe(17); // 3 présents sur 18 invités

  });
});

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * 1 et 5. Les deux portes : composées au même endroit, lues une seule fois
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

const faux = vi.hoisted(() => ({ prefs: null as string | null, publicationOuverte: false }));

vi.mock("@/lib/db", () => ({ db: { pushAbonnement: { count: vi.fn(async () => 0) } } }));

// Le téléphone n'a rien à brancher : ses clés se créent toutes seules. On ne les fabrique pas ici.
vi.mock("@/lib/notifications/push", () => ({ pushConfigure: vi.fn(async () => true) }));

vi.mock("@/lib/settings", () => ({
  CLES: { notifications: "notifications", discordWebhookUrl: "discordWebhookUrl", discordWebhooks: "discordWebhooks", telegram: "telegram" },
  getSetting: vi.fn(async (cle: string) => (cle === "notifications" ? faux.prefs : null)),
  setSetting: vi.fn(async () => {}),
  getDiscordWebhookUrl: vi.fn(async () => ({ url: "", source: "aucune" as const })),
  isPublicApiEnabled: vi.fn(async () => faux.publicationOuverte),
}));

const { expositionPossible, portesExposition, raisonCanalIndisponible, etatCanal } = await import("@/lib/notifications/canaux");
const reglages = await import("@/lib/settings");

/** Les préférences du club, telles qu'elles sont rangées en base. */
function enBase(patch: { canalApi?: boolean; recap?: boolean }) {
  faux.prefs = JSON.stringify({
    canaux: { api: patch.canalApi ?? true },
    notifications: { recap_veille: { api: patch.recap ?? true } },
  });
}

describe("les deux portes du site du club", () => {
  it("l'interrupteur du canal compte autant que la publication", async () => {
    faux.publicationOuverte = true;
    enBase({ canalApi: true, recap: true });
    // Contre-épreuve d'abord : les trois conditions réunies, l'annonce sort.
    expect(await expositionPossible("recap_veille")).toBe(true);
    // Le défaut : l'interrupteur du canal décoché coupe la colonne, publication ouverte ou non.
    enBase({ canalApi: false, recap: true });
    expect(await expositionPossible("recap_veille")).toBe(false);
    // Et la publication fermée coupe tout, interrupteur coché ou non.
    enBase({ canalApi: true, recap: true });
    faux.publicationOuverte = false;
    expect(await expositionPossible("recap_veille")).toBe(false);
  });

  it("une notification sans case ne sort jamais, même tout ouvert", async () => {
    faux.publicationOuverte = true;
    enBase({ canalApi: true, recap: true });
    expect(await expositionPossible("effectif_faible")).toBe(false);
    expect(await expositionPossible("atelier_statut")).toBe(false);
  });

  /**
   * **Une lecture, pas sept.** `getSetting` n'est pas mémoïsé : demander les trois types un par un
   * relisait les préférences **et** l'interrupteur à chaque fois. Sans conséquence fonctionnelle sur
   * une route plafonnée, mais c'est quatre à sept requêtes pour une réponse qui ne change pas.
   */
  it("ne lit les réglages qu'une fois pour toute la route", async () => {
    faux.publicationOuverte = true;
    enBase({ canalApi: true, recap: true });
    const types = ["recap_veille", "seance_annulee", "evenement_nouveau"] as const;
    vi.mocked(reglages.getSetting).mockClear();
    vi.mocked(reglages.isPublicApiEnabled).mockClear();
    const portes = await portesExposition();
    await Promise.all(types.map((type) => expositionPossible(type, portes)));
    expect(vi.mocked(reglages.getSetting).mock.calls).toHaveLength(1);
    expect(vi.mocked(reglages.isPublicApiEnabled).mock.calls).toHaveLength(1);
    // Contre-épreuve : sans les portes en main, chaque appel relit les deux réglages pour lui.
    vi.mocked(reglages.getSetting).mockClear();
    vi.mocked(reglages.isPublicApiEnabled).mockClear();
    await Promise.all(types.map((type) => expositionPossible(type)));
    expect(vi.mocked(reglages.getSetting).mock.calls).toHaveLength(types.length);
    expect(vi.mocked(reglages.isPublicApiEnabled).mock.calls).toHaveLength(types.length);
  });

  it("la phrase du canal nomme la décision qui manque, pas un réglage inexistant", async () => {
    faux.publicationOuverte = false;
    const api = await etatCanal("api");
    expect(raisonCanalIndisponible(api)).toContain("Publication des cours sur le site du club");
    // Contre-épreuve : un canal qui, lui, se configure vraiment garde l'autre phrase.
    expect(raisonCanalIndisponible(await etatCanal("discord"))).toContain("n'est pas configuré");
  });
});

describe("la page du canal dit ce que la route rend", () => {
  it("passe par la fonction partagée, et ne lit plus la matrice en direct", () => {
    const code = lireCode(PAGE_CANAL);
    expect(code).toContain("portesExposition");
    expect(code).toContain("expositionPossible(type, portes)");
    // Le défaut lui-même : une lecture directe de la colonne, qui oublie l'interrupteur du canal.
    expect(code).not.toMatch(/prefs\.notifications\[/);
    // Elle nomme les trois portes, dans l'ordre où le code les compose.
    expect(code).toMatch(/Publier les\s+prochains cours/);
    expect(code).toMatch(/interrupteur du canal est décoché/);
  });

  it("la route compose les mêmes portes, au même endroit", () => {
    const code = lireCode(ROUTE);
    expect(code).toContain("portesExposition");
    expect(code).toContain("expositionPossible(type, portes)");
    expect(code).not.toMatch(/prefs\.notifications\[/);
  });
});

/** Les préférences relues depuis rien : utile pour vérifier que le jeu d'essai ne ment pas. */
it("une base neuve ne publie rien : ni case cochée, ni publication ouverte", () => {
  const neuves = lirePreferences(null);
  for (const type of ["recap_veille", "seance_annulee", "evenement_nouveau"] as const) {
    expect(neuves.notifications[type].api).toBe(false);
  }
  // L'interrupteur du canal, lui, est coché d'avance : c'est un geste de moins, et il ne publie rien
  // tout seul (contre-épreuve du réglage par défaut, `preferencesDefaut`).
  expect(neuves.canaux.api).toBe(true);
});

/**
 * **Le gel se décide sur ce que l'écran a RENDU, pas sur l'état du moment**.
 *
 * Le défaut : on ouvre « Notifications » **publication fermée** — les cases « Site du club » sont
 * alors inertes, donc absentes de l'envoi —, quelqu'un d'autre (ou soi-même dans un autre onglet)
 * **ouvre la publication**, et l'enregistrement de la matrice **efface les trois cases** et
 * l'interrupteur du canal. En silence : le message de succès ne dit rien, puisque le canal est
 * opérationnel au moment de l'écriture. Aucun forgeage n'était nécessaire — un onglet laissé ouvert
 * suffisait —, et c'est la jumelle exacte du défaut du 30/09, dans l'autre sens.
 *
 * `figerCanauxIndisponibles` reçoit donc les canaux que **le formulaire déclare réglables** (ses
 * témoins cachés), et non l'état du moment.
 */
describe("le gel suit les témoins du formulaire", () => {
  /** L'état de la base après une fermeture de la publication : les cases « Site du club » survivent. */
  const arme = (): PreferencesNotifications => {
    const p = preferencesDefaut();
    p.canaux.email = true;
    p.canaux.push = true;
    p.canaux.api = true;
    p.notifications.recap_veille.email = true;
    p.notifications.recap_veille.api = true;
    p.notifications.seance_annulee.api = true;
    return p;
  };
  /**
   * Ce qu'un écran rendu publication fermée renvoie : **aucune** case `api`, et pas de témoin. Les
   * défauts du dépôt cochent `canaux.api` (voir `preferencesDefaut`), il faut donc le remettre à faux
   * à la main pour décrire un envoi — c'est tout l'objet du gel que de distinguer ce « faux » d'un
   * « faux » décidé par quelqu'un.
   */
  const envoiSansApi = (): PreferencesNotifications => {
    const p = preferencesDefaut();
    p.canaux.email = true;
    p.canaux.push = true;
    p.canaux.api = false;
    p.notifications.recap_veille.email = true;
    p.notifications.recap_veille.api = false;
    p.notifications.seance_annulee.api = false;
    return p;
  };

  it("garde les cases d'un canal que l'écran n'a pas rendu réglable, même s'il est opérationnel maintenant", () => {
    const avant = arme();
    // L'envoi d'un écran rendu quand « Site du club » était fermé : aucune case `api`, aucun témoin.
    const apres = envoiSansApi();
    const { prefs, figes } = figerCanauxIndisponibles(avant, apres, { email: true, push: true });
    expect(prefs.canaux.api, "l'interrupteur du canal est conservé").toBe(true);
    expect(prefs.notifications.recap_veille.api).toBe(true);
    expect(prefs.notifications.seance_annulee.api).toBe(true);
    expect(figes, "et le canal est annoncé comme figé").toContain("api");
  });

  it("laisse décocher pour de bon quand l'écran DIT avoir rendu le canal réglable", () => {
    const avant = arme();
    const apres = envoiSansApi();
    // Témoin présent : l'absence des cases est alors une vraie décision.
    const { prefs } = figerCanauxIndisponibles(avant, apres, { email: true, push: true, api: true });
    expect(prefs.canaux.api).toBe(false);
    expect(prefs.notifications.recap_veille.api).toBe(false);
  });
});
