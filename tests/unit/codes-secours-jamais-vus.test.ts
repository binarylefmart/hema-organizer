import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **On n'engendre pas des codes de secours pour ne pas les montrer**.
 *
 * L'étape 3 du parcours `/admin/activer` affiche huit codes de secours, **une seule fois** : en base
 * ils ne sont gardés que hachés, et rien ne les retrouve. Son cookie d'affichage (`hema_codes`) durait
 * dix minutes — celles de `DUREE_DEUX_FA_MS`, le *défi* de connexion, le temps de recopier un code à
 * six chiffres lu sur son téléphone. Or cet écran-là demande l'inverse : recopier huit codes dans un
 * gestionnaire de mots de passe, ou aller chercher une imprimante. Passé le délai, l'écran rechargé
 * ne dit pas « tes codes ont disparu » : `etapeAcces` rend **« terminé »**, et la carte annonce que
 * « mot de passe, double authentification et codes de secours sont en place » — pour un administrateur
 * qui ne les a jamais lus, alors qu'ils sont sa seule issue s'il perd son téléphone. Le parcours, lui,
 * ne se rejoue pas : c'était un cul-de-sac.
 *
 * (La relecture soupçonnait un croisement entre **deux** échéances de dix minutes, celle du réglage
 * 2FA et celle de l'affichage. Ce n'en est pas un : le réglage dure trente minutes, et les codes sont
 * engendrés et déposés dans le cookie **dans la même requête** — jamais l'un sans l'autre. Le défaut
 * est en aval, et c'est celui que ce fichier verrouille.)
 *
 * Deux verrous, donc :
 * - l'affichage dure le temps du **parcours de réglage**, jamais celui d'un défi de connexion ;
 * - et quand il se referme, l'écran **nomme** le geste qui répare (régénérer ses codes depuis
 *   « Mon profil »), au lieu de féliciter quelqu'un pour des codes qu'il n'a pas.
 */

const faux = vi.hoisted(() => ({ cookies: {} as Record<string, string>, decalage: 0 }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (nom: string) => (nom in faux.cookies ? { name: nom, value: faux.cookies[nom] } : undefined),
    set: (nom: string, valeur: string, options?: { maxAge?: number }) => {
      if (options?.maxAge === 0) delete faux.cookies[nom];
      else faux.cookies[nom] = valeur;
    },
    delete: (nom: string) => {
      delete faux.cookies[nom];
    },
  }),
}));

vi.mock("@/lib/db", () => ({ db: { user: { findUnique: vi.fn(async () => null), update: vi.fn(async () => ({})) } } }));

const { DUREE_AFFICHAGE_CODES_MS, lireAffichageCodes, ouvrirAffichageCodes } = await import("@/lib/auth/deux-fa");
const { DUREE_ACTIVATION_MS, etapeAcces } = await import("@/lib/auth/acces-admin");
const { DUREE_DEUX_FA_MS } = await import("@/lib/constants");

const MINUTE = 60_000;
const CODES = ["AAAA-2222", "BBBB-3333", "CCCC-4444", "DDDD-5555", "EEEE-6666", "FFFF-7777", "GGGG-8888", "HHHH-9999"];
/**
 * L'administrateur au bout de son parcours : mot de passe et 2FA en place.
 *
 * **Le bureau se porte dans `estAdmin`, pas dans `role`** — et le rôle de base est `INSTRUCTEUR`
 * pour décrire le cas que l'ancien modèle rendait impossible : celui qui enseigne *et* siège au
 * bureau. C'est lui qui doit régler mot de passe et double authentification, pas l'autre.
 */
const REGLE = { role: "INSTRUCTEUR", estAdmin: true, actif: true, email: "delta@club.test", passwordHash: "$argon2id$x", totpSecret: "chiffre", totpActiveAt: new Date(), doitChangerMotDePasse: false };

beforeEach(() => {
  faux.cookies = {};
  faux.decalage = 0;
  const reel = Date.now;
  vi.spyOn(Date, "now").mockImplementation(() => reel.call(Date) + faux.decalage);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("le temps d'afficher huit codes", () => {
  it("les garde affichables bien après les dix minutes d'un défi de connexion", async () => {
    await ouvrirAffichageCodes("u-delta", CODES, "/admin");

    // Onze minutes : le temps d'ouvrir son gestionnaire de mots de passe, de répondre au téléphone,
    // de recharger la page. C'est ici que les codes disparaissaient.
    faux.decalage += 11 * MINUTE;
    expect((await lireAffichageCodes("u-delta"))?.codes).toEqual(CODES);
    // …et l'étape 3 est donc toujours l'étape courante, pas un parcours « terminé ».
    expect(etapeAcces(REGLE, !!(await lireAffichageCodes("u-delta")))).toBe("codes-secours");
  });

  it("prend le temps du parcours de réglage, et se referme au bout", () => {
    // Un nom, une valeur, un endroit : l'affichage suit l'échéance du parcours, il n'en invente pas
    // une seconde qui dériverait.
    expect(DUREE_AFFICHAGE_CODES_MS).toBe(DUREE_ACTIVATION_MS);
    expect(DUREE_AFFICHAGE_CODES_MS).toBeGreaterThan(DUREE_DEUX_FA_MS);
  });

  it("finit par se refermer : un cookie qui porte des codes ne vit pas indéfiniment", async () => {
    await ouvrirAffichageCodes("u-delta", CODES, "/admin");
    faux.decalage += DUREE_AFFICHAGE_CODES_MS + MINUTE;
    expect(await lireAffichageCodes("u-delta")).toBeNull();
    // L'écran bascule alors sur « tout est réglé » : c'est lui qui doit nommer la sortie (test suivant).
    expect(etapeAcces(REGLE, false)).toBe("termine");
  });
});

/**
 * L'écran de fin ne peut pas savoir si les codes ont été notés — rien ne l'enregistre, et un drapeau
 * de plus en base ne dirait de toute façon que « le bouton a été cliqué ». Il nomme donc la sortie
 * **dans tous les cas**, avec le libellé exact du bouton qui la réalise : une phrase qui renvoie vers
 * un geste introuvable ne vaut pas mieux qu'un cul-de-sac.
 */
describe("l'écran qui annonce « tout est réglé »", () => {
  const lire = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
  const page = lire("src/app/(app)/admin/activer/page.tsx");
  const profil = lire("src/app/(app)/profil/FormulaireDeuxFa.tsx");

  it("nomme le geste qui réengendre des codes de secours, et le lien qui y mène", () => {
    const fin = page.slice(page.indexOf('etape === "termine" &&'));
    expect(fin).toContain("ANCRE_SECURITE");
    expect(fin).toMatch(/codes de secours/);
    // Le libellé cité est celui du bouton réel : s'il est renommé là-bas, cette phrase mentirait ici.
    const libelle = "Régénérer mes codes de secours";
    expect(profil).toContain(libelle);
    expect(fin).toContain(libelle);
  });
});
