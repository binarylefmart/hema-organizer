import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **Un redémarrage n'est pas une excuse pour ne jamais réessayer.**
 *
 * La file d'envoi d'emails (`src/lib/email/mailer.ts`) vit en mémoire. Les neuf modules d'envoi
 * posent leur clé de déduplication **avant** d'appeler `enqueueEmail` — c'est la contrainte
 * d'unicité qui tranche entre deux passages simultanés — et comptent sur le rappel
 * `(err) => void marquerEchec(cle, …)` pour la libérer quand l'envoi casse.
 *
 * Jusqu', un arrêt du serveur (mise à jour de l'image, `docker compose restart`, redéploiement dans
 * Portainer) jetait la file **sans appeler un seul de ces rappels**. Les messages en attente
 * disparaissaient, mais leurs clés restaient `ENVOYE` : les repassages faits exactement pour ça
 * (`tickEnvois`, chaque minute) les voyaient et ne faisaient rien. Le récap du soir, le rappel « tu
 * n'as pas répondu », l'alerte de sécurité d'un lien révoqué étaient perdus **définitivement**,
 * avec « envoyé » affiché dans l'espace admin.
 *
 * Ce fichier tient la promesse du dossier (« tout envoi libère sa clé en cas d'échec ») à l'endroit
 * où elle manquait : un message perdu à l'arrêt est un échec d'envoi comme un autre. Trois choses à
 * vérifier, et la troisième compte autant que les deux premières — le facteur est chargé par le
 * runtime Next, qui recharge ses modules, et une écoute de signal posée à chaque rechargement
 * s'empilerait.
 */

const faux = vi.hoisted(() => ({
  /** Un envoi en cours parqué : `sendEmailNow` attend l'identité du club avant d'écrire quoi que ce soit. */
  identitesEnAttente: [] as Array<() => void>,
  fichiersEcrits: [] as string[],
}));

vi.mock("@/lib/identite", () => ({
  // L'identité n'est rendue que sur demande du test : le message en tête de file reste ainsi « en vol »,
  // c'est-à-dire sorti de la file et pas encore abouti — l'état précis que l'arrêt oubliait.
  identite: vi.fn(() => new Promise((resolve) => faux.identitesEnAttente.push(() => resolve({ nomCourt: "HEMA", nomClub: "HEMA", logo: "/logo-hema.png" })))),
}));

// Les gabarits ne sont pas le sujet : seule compte la mécanique de la file.
vi.mock("@/lib/email/templates/layout", () => ({
  renderEmailHtml: () => "<html>message</html>",
  renderEmailTexte: () => "message",
}));

// Mode fichier (pas de SMTP), et le disque neutralisé : un test ne dépose rien dans previews/emails.
vi.mock("@/lib/env", () => ({
  bequilleDevActive: (nom: string) => nom === "EMAIL_MODE_FICHIER",
  env: () => ({ SMTP_HOST: "" }),
  expediteur: () => "HEMA <hema@example.test>",
  isProduction: () => false,
}));
vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(async () => undefined),
  writeFile: vi.fn(async (chemin: string) => {
    faux.fichiersEcrits.push(chemin);
  }),
}));

const contenu = { titre: "Cours de demain", paragraphes: ["Jeudi 1er octobre 2026 — 19h30 à 21h30"] };
const message = (ref: string) => ({ to: `${ref}@example.test`, sujet: "🗡️ Rappel : cours demain", contenu, ref });

/** Une instance neuve du facteur : sa file est vide, comme au démarrage du serveur. */
async function chargerFacteur() {
  vi.resetModules();
  return import("@/lib/email/mailer");
}

/** Les drains inscrits sur `globalThis` — un par instance du module chargée (voir `installerDrainArret`). */
function drainsInscrits(): number {
  return (globalThis as unknown as { brgArretEmails?: { drains: Set<unknown> } }).brgArretEmails?.drains.size ?? 0;
}

beforeEach(() => {
  faux.identitesEnAttente = [];
  faux.fichiersEcrits = [];
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("arrêt du serveur avec des emails en file", () => {
  it("déclare chaque message en attente perdu, une fois et une seule", async () => {
    const facteur = await chargerFacteur();
    const rendus: Array<{ ref: string; erreur: string | null }> = [];
    for (const ref of ["recap_a", "recap_b", "recap_c"]) {
      facteur.enqueueEmail(message(ref), (err) => rendus.push({ ref, erreur: err?.message ?? null }));
    }
    // La file est séquentielle : le premier message est déjà parti vers le serveur, les deux autres attendent.
    expect(faux.identitesEnAttente).toHaveLength(1);
    expect(faux.fichiersEcrits).toHaveLength(0);

    expect(facteur.drainerFileALArret()).toBe(3);
    // Chaque appelant est prévenu, dans l'ordre de la file, avec une erreur qui dit pourquoi : c'est
    // lui, et lui seul, qui libère sa clé de déduplication (`marquerEchec`).
    expect(rendus.map((r) => r.ref)).toEqual(["recap_a", "recap_b", "recap_c"]);
    expect(rendus.map((r) => r.erreur)).toEqual(Array(3).fill(facteur.RAISON_ARRET_EMAIL));
    // Deux signaux de suite (Ctrl+C répété, SIGINT puis SIGTERM) ne doublent pas les comptes rendus.
    expect(facteur.drainerFileALArret()).toBe(0);

    // Le serveur répond quand même pour le message en vol, si le processus vit encore un instant :
    // un second compte rendu appellerait `marquerEchec` sur une clé déjà libérée et reprise ailleurs.
    for (const rendreIdentite of faux.identitesEnAttente) rendreIdentite();
    await vi.waitFor(() => expect(faux.fichiersEcrits.length).toBeGreaterThan(0));
    expect(rendus).toHaveLength(3);
  });

  it("ne rend compte de rien quand la file est vide", async () => {
    const facteur = await chargerFacteur();
    // L'arrêt ordinaire : tout est parti depuis longtemps. Aucun rappel, aucune clé libérée — sans
    // quoi un redémarrage propre renverrait le récap de la veille.
    expect(facteur.drainerFileALArret()).toBe(0);
    expect(faux.identitesEnAttente).toHaveLength(0);
    expect(faux.fichiersEcrits).toHaveLength(0);
  });

  it("n'empile pas d'écoutant de signal quand le module est rechargé", async () => {
    const premier = await chargerFacteur();
    premier.enqueueEmail(message("premier"));
    const ecoutants = { sigterm: process.listenerCount("SIGTERM"), sigint: process.listenerCount("SIGINT") };
    const drains = drainsInscrits();
    expect(drains).toBeGreaterThan(0);

    // Ce que fait le HMR de Next en développement : une seconde instance du module, avec sa propre file.
    const second = await chargerFacteur();
    second.enqueueEmail(message("second"));

    expect(process.listenerCount("SIGTERM")).toBe(ecoutants.sigterm);
    expect(process.listenerCount("SIGINT")).toBe(ecoutants.sigint);
    // Une écoute unique, mais qui connaît la file de chaque instance : sinon elle ne drainerait que
    // celle de la première version chargée, c'est-à-dire plus aucune de celles qui servent.
    expect(drainsInscrits()).toBe(drains + 1);
  });
});
