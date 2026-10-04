import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **Une adresse d'image collée à la main redevient affichable — mais seulement après que le serveur
 * l'a lue.**
 *
 * La fermeture du relais `/api/image` a emporté un chemin que le champ d'affiche annonce lui-même :
 * « ou coller l'adresse d'une image ». Une adresse tapée n'est dans aucune des deux sources —
 * l'aperçu du formulaire ne s'affichait plus, et l'écran accusait le lien (« cette adresse
 * n'affiche pas d'image ») alors qu'il était parfaitement bon.
 *
 * `verifierImageCollee` referme l'écart **sans rouvrir le relais**, et c'est tout l'objet de ce
 * fichier. Trois choses s'y vérifient, dans cet ordre d'importance :
 *
 *  1. **rien n'entre au registre sans lecture réussie** — c'est l'invariant qui empêche le registre de
 *     redevenir la porte ouverte que la liste blanche vient de fermer : on n'autorise que ce que le
 *     serveur a lu de ses propres yeux ;
 *  2. **elle n'ouvre aucune porte que l'aperçu d'un lien n'ouvrait déjà** — mêmes droits
 *     (`evenements.edit`, donc jamais un simple membre, ce qui était tout le défaut de la route) et
 *     **le même seau de débit**, pas un second ;
 *  3. le refus dit **la vraie raison**, parce qu'ici elle s'affiche à la personne qui vient de taper
 *     l'adresse : elle n'apprend rien qu'elle ne sache déjà sur l'hôte qu'elle a elle-même nommé. Le
 *     message unique de `/api/image`, lui, reste unique — c'est là qu'il protégeait quelque chose.
 */

const faux = vi.hoisted(() => ({
  /** Le droit que `assertPermission` accorde (ou refuse en levant). */
  permis: true,
  /** Les seaux consommés, dans l'ordre. */
  seaux: [] as string[],
  /** Les seaux qui refusent. */
  satures: new Set<string>(),
  /** Les adresses réellement demandées au réseau. */
  lues: [] as string[],
  /** Erreur à lever au lieu de rendre les octets. */
  echec: null as Error | null,
}));

class FauxAccesRefuse extends Error {}

vi.mock("@/lib/auth/current-user", () => ({
  AccesRefuse: FauxAccesRefuse,
  assertPermission: vi.fn(async () => {
    if (!faux.permis) throw new FauxAccesRefuse("non");
    return { id: "u-charlie" };
  }),
}));

vi.mock("@/lib/auth/rate-limit", () => ({
  checkRateLimit: vi.fn(async (seau: string) => {
    faux.seaux.push(seau);
    return !faux.satures.has(seau);
  }),
}));

// Le registre et `ErreurApercu` restent les vrais : c'est ce qui y entre qu'on éprouve.
vi.mock("@/lib/lien-apercu", async (original) => {
  const vrai = await original<typeof import("@/lib/lien-apercu")>();
  return {
    ...vrai,
    recupererImage: vi.fn(async (url: string) => {
      faux.lues.push(url);
      if (faux.echec) throw faux.echec;
      return { octets: new Uint8Array([1]), typeContenu: "image/png" };
    }),
  };
});

const { verifierImageCollee } = await import("@/actions/liens");
const { ErreurApercu, imageApercuAutorisee, oublierImagesApercu } = await import("@/lib/lien-apercu");

const AFFICHE = "https://exemple.test/affiche.png";

beforeEach(() => {
  faux.permis = true;
  faux.seaux = [];
  faux.satures = new Set();
  faux.lues = [];
  faux.echec = null;
  oublierImagesApercu();
});

describe("vérifier une adresse d'image collée", () => {
  it("la retient une fois que le serveur l'a vraiment lue", async () => {
    expect(imageApercuAutorisee(AFFICHE)).toBe(false);
    expect(await verifierImageCollee(AFFICHE)).toEqual({ ok: true });
    expect(faux.lues).toEqual([AFFICHE]);
    expect(imageApercuAutorisee(AFFICHE)).toBe(true);
  });

  /** L'invariant du registre : une lecture qui échoue n'autorise rien du tout. */
  it("n'y met rien quand la lecture échoue, et rend la vraie raison", async () => {
    faux.echec = new ErreurApercu("Ce lien ne mène pas à une image acceptée.");
    expect(await verifierImageCollee(AFFICHE)).toEqual({ ok: false, erreur: "Ce lien ne mène pas à une image acceptée." });
    expect(imageApercuAutorisee(AFFICHE)).toBe(false);
  });

  /** Une exception inattendue ne doit ni sortir, ni autoriser, ni raconter sa pile à l'écran. */
  it("n'y met rien non plus quand la lecture explose, et ne remonte pas l'exception", async () => {
    faux.echec = new TypeError("fetch failed: https://interne.local:22/");
    const res = await verifierImageCollee(AFFICHE);
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.erreur).toBe("Cette adresse n'a pas pu être vérifiée. Dépose plutôt un fichier.");
    expect(res.ok === false && res.erreur).not.toContain("interne.local");
    expect(imageApercuAutorisee(AFFICHE)).toBe(false);
  });

  /**
   * **Le défaut de la route était qu'un simple membre pouvait déclencher la requête sortante.** Cette
   * action ne doit pas le rouvrir : le droit se vérifie **avant** le seau et avant le réseau.
   */
  it("refuse un simple membre sans rien demander au réseau ni au limiteur", async () => {
    faux.permis = false;
    expect(await verifierImageCollee(AFFICHE)).toEqual({
      ok: false,
      erreur: "Seuls les instructeurs et les administrateurs peuvent ajouter une affiche.",
    });
    expect(faux.seaux).toEqual([]);
    expect(faux.lues).toEqual([]);
    expect(imageApercuAutorisee(AFFICHE)).toBe(false);
  });

  /**
   * **Le même seau que l'aperçu d'un lien, pas un second.** Les deux gestes déclenchent la même
   * requête sortante depuis la même personne ; deux budgets séparés en autoriseraient deux fois plus,
   * et le plafond annoncé ne voudrait plus rien dire.
   */
  it("tire sur le seau de l'aperçu de lien, et s'arrête quand il est vide", async () => {
    await verifierImageCollee(AFFICHE);
    expect(faux.seaux).toEqual(["apercu_lien_user"]);

    faux.satures.add("apercu_lien_user");
    faux.lues = [];
    const res = await verifierImageCollee("https://exemple.test/autre.png");
    expect(res.ok).toBe(false);
    expect(faux.lues).toEqual([]);
    expect(imageApercuAutorisee("https://exemple.test/autre.png")).toBe(false);
  });

  it("refuse une saisie vide ou démesurée avant toute requête", async () => {
    expect((await verifierImageCollee("   ")).ok).toBe(false);
    expect((await verifierImageCollee(`https://exemple.test/${"a".repeat(3000)}.png`)).ok).toBe(false);
    expect(faux.lues).toEqual([]);
  });
});
