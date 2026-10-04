import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **Faire tourner `SESSION_SECRET` réarmait la double authentification de tout le club.**
 *
 * La clé qui chiffre les secrets en base est dérivée de `SESSION_SECRET` (`src/lib/crypto.ts`), et
 * `docs/SECURITE.md` recommande lui-même de faire tourner ce secret. Le jour où on le fait,
 * `dechiffrer` rend `null` pour tous les secrets TOTP — et `null` était confondu avec « ce compte
 * n'a pas de 2FA ». Enchaînement, vérifié ligne à ligne lors de la relecture :
 *
 *  1. la connexion concluait « pas de 2FA » et engendrait un **secret provisoire neuf** ;
 *  2. l'écran affichait un QR code sous le titre « Première connexion : protège ton accès » — et
 *     comme la colonne `totpSecret` est non nulle, `deuxFaActive` disait « en place », donc même pas
 *     de bouton « Plus tard » : la réinscription était **imposée** ;
 *  3. la vérification du code **écrasait** `totpSecret` et **remplaçait** les codes de secours ;
 *  4. au même instant les codes de secours cessaient d'être acceptés, donc la seule porte restante
 *     était le QR code neuf.
 *
 * Conséquence : **le premier à arriver avec le mot de passe d'un administrateur inscrivait son propre
 * téléphone**, puis ouvrait l'espace admin. Rien ne cassait et rien ne prévenait — les sessions
 * survivent à la rotation (leur jeton est haché en SHA-256 pur) et `/api/health` répondait 200. Le
 * remède que proposait la documentation (« remettre l'ancienne valeur ») bouclait : le nouveau secret
 * était chiffré avec la nouvelle clé.
 *
 * Deux réglages se détruisaient par la même cause : les **clés VAPID** (une paire neuve rend inertes
 * tous les téléphones déjà abonnés) et la **table des salons Discord** (lire-modifier-écrire par-dessus
 * une table vide : le prochain salon réglé effaçait les autres).
 *
 * La règle tirée de tout ça : **« jamais chiffré » et « chiffré illisible » ne se traitent pas pareil.**
 * Le premier se remplace, le second se garde et se dit.
 */

const secret = { valeur: "secret-de-test-numero-un-assez-long-pour-passer" };
const reglages = new Map<string, string | null>();

vi.mock("@/lib/env", () => ({
  env: () => ({ SESSION_SECRET: secret.valeur }),
  baseUrl: () => "https://exemple.fr",
}));

const faux = vi.hoisted(() => ({ totpSecret: null as string | null }));
vi.mock("@/lib/db", () => ({
  db: { user: { findUnique: vi.fn(async () => ({ totpSecret: faux.totpSecret })) } },
}));

vi.mock("@/lib/settings", () => ({
  CLES: { vapid: "vapid", discordWebhooks: "discordWebhooks", discordWebhookUrl: "discordWebhookUrl" },
  getSetting: vi.fn(async (c: string) => reglages.get(c) ?? null),
  setSetting: vi.fn(async (c: string, v: string | null) => {
    reglages.set(c, v);
  }),
}));

const { chiffrer, dechiffrer, estChiffre } = await import("@/lib/crypto");
const { etatSecretTotp } = await import("@/lib/auth/deux-fa");
const { secretTotpIllisible } = await import("@/lib/auth/acces-admin");
const { clesVapid } = await import("@/lib/notifications/push");
const { salonsDiscord, setSalonDiscord } = await import("@/lib/notifications/webhooks");

const AVANT = "secret-de-test-numero-un-assez-long-pour-passer";
const APRES = "secret-de-test-numero-deux-aussi-long-quil-faut";

/** Chiffre avec la clé d'avant, puis fait tourner le secret du serveur. */
function rotation(clair: string): string {
  secret.valeur = AVANT;
  const chiffre = chiffrer(clair);
  secret.valeur = APRES;
  return chiffre;
}

beforeEach(() => {
  secret.valeur = AVANT;
  reglages.clear();
  faux.totpSecret = null;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("la forme d'un chiffré se reconnaît sans la clé", () => {
  it("sépare « jamais chiffré » de « chiffré illisible »", () => {
    const chiffre = rotation("peu importe");
    // Illisible, mais c'est bien un chiffré : il ne faut pas l'écraser.
    expect(dechiffrer(chiffre)).toBeNull();
    expect(estChiffre(chiffre)).toBe(true);
    // Ceux-là n'ont jamais été chiffrés : rien ne dépend d'eux.
    for (const dechet of ["n'importe quoi", "", "v2.a.b.c", "v1.a.b"]) expect(estChiffre(dechet)).toBe(false);
  });
});

describe("un secret TOTP illisible n'est pas « pas de secret »", () => {
  it("se distingue de l'absence, et se dit", async () => {
    faux.totpSecret = null;
    expect(await etatSecretTotp("u-1")).toEqual({ etat: "absent" });

    faux.totpSecret = rotation("JBSWY3DPEHPK3PXP");
    expect(await etatSecretTotp("u-1")).toEqual({ etat: "illisible" });
    // L'incident était parfaitement muet : c'était tout le problème.
    expect(console.error).toHaveBeenCalled();
  });

  it("reste lisible tant que la clé ne bouge pas", async () => {
    faux.totpSecret = chiffrer("JBSWY3DPEHPK3PXP");
    expect(await etatSecretTotp("u-1")).toEqual({ etat: "actif", secret: "JBSWY3DPEHPK3PXP" });
  });

  /** F3 : la page censée réparer se déclarait « terminée ». */
  it("l'écran de réglage ne peut plus féliciter un compte illisible", () => {
    const compte = { totpSecret: chiffrer("JBSWY3DPEHPK3PXP"), totpActiveAt: new Date(), passwordHash: "x", doitChangerMotDePasse: false } as never;
    expect(secretTotpIllisible(compte)).toBe(false);
    const casse = { totpSecret: rotation("JBSWY3DPEHPK3PXP"), totpActiveAt: new Date(), passwordHash: "x", doitChangerMotDePasse: false } as never;
    expect(secretTotpIllisible(casse)).toBe(true);
    // Un compte sans secret du tout n'est pas « illisible » : il est au début du parcours.
    expect(secretTotpIllisible({ totpSecret: null } as never)).toBe(false);
  });
});

describe("les cinq portes refusent, aucune ne remplace", () => {
  /**
   * Un balayage, et il dit ce qu'il prouve : que **chaque** lecture du secret dans les actions
   * d'authentification traite le cas « illisible ». Il ne prouve pas ce que fait l'action ensuite —
   * c'est l'affaire des cas ci-dessus et des tests de connexion. Mais c'est lui qui attrape la
   * sixième porte que quelqu'un ajoutera, et c'est exactement par là que le défaut est arrivé.
   */
  it("aucune lecture du secret ne passe à côté du cas « illisible »", async () => {
    const { readFileSync } = await import("node:fs");
    const code = readFileSync("src/actions/auth.ts", "utf8");
    const lectures = code.match(/etatSecretTotp\(/g) ?? [];
    expect(lectures.length, "cinq portes lisent le secret : connexion, code, élévation, ré-auth, sortie du reset").toBeGreaterThanOrEqual(5);
    expect(code.match(/etat === "illisible"/g) ?? []).toHaveLength(lectures.length);
    // Et `secretTotpActif`, qui confondait les deux états, n'existe plus — pas même dans un appel oublié.
    expect(code).not.toContain("secretTotpActif(");
  });
});

describe("un réglage chiffré illisible se garde, il ne s'écrase pas", () => {
  it("les clés VAPID ne sont pas remplacées : tous les abonnements en dépendent", async () => {
    const stocke = rotation(JSON.stringify({ publicKey: "pub-du-club", privateKey: "priv-du-club" }));
    reglages.set("vapid", stocke);
    await expect(clesVapid()).rejects.toThrow(/illisibles/i);
    // Et surtout : la valeur en base n'a pas bougé. C'est elle qui redeviendra lisible.
    expect(reglages.get("vapid")).toBe(stocke);
  });

  it("mais une valeur qui n'a jamais été chiffrée est bien remplacée", async () => {
    reglages.set("vapid", "n'importe quoi");
    const cles = await clesVapid();
    expect(cles.publicKey).toBeTruthy();
    expect(reglages.get("vapid")).not.toBe("n'importe quoi");
  });

  /**
   * Ici le refus est posé sur l'**écriture** seule, et c'est un choix : une lecture qui lèverait ferait
   * échouer tous les envois Discord, alors que le repli sur le salon du club (dont l'URL peut venir de la
   * variable d'environnement, donc rester lisible) les laisse partir. On ne casse pas ce qui marche
   * encore ; on empêche ce qui détruit — `setSalonDiscord` étant un lire-modifier-écrire, le prochain
   * salon réglé écrasait la table avec un seul élément.
   */
  it("la table des salons Discord se lit en dégradé, mais ne s'écrase pas", async () => {
    const stocke = rotation(JSON.stringify({ recap_veille: "https://discord.com/api/webhooks/1/aaa" }));
    reglages.set("discordWebhooks", stocke);
    // En lecture : table vide, donc repli sur le salon du club — et une trace dans le journal du serveur.
    expect(await salonsDiscord()).toEqual({});
    expect(console.error).toHaveBeenCalled();
    // En écriture : refus, et la valeur en base n'a pas bougé.
    await expect(setSalonDiscord("recap_veille", "https://discord.com/api/webhooks/2/bbb")).rejects.toThrow(/illisible/i);
    expect(reglages.get("discordWebhooks")).toBe(stocke);
  });
});
