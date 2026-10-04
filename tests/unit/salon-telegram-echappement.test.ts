import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **`content` échappe-t-il à l'échappement Telegram ?**
 *
 * `publierSurTelegram` envoie son message en `parse_mode: "HTML"`. Tout ce qui vient de l'embed est
 * échappé par `texteTelegram` (titre, description, champs, pied) — mais le texte hors embed
 * (`content`) était concaténé **brut** devant, et un seul `<` ou `&` suffit pour que Telegram refuse
 * **tout** le message par un `400` : la notification est alors perdue, pas dégradée.
 *
 * Rien n'était atteignable (aucun des six appelants ne passe `content`), et c'est exactement
 * pourquoi ce test existe : le commentaire du code invite à y poser « une mention ou une phrase
 * d'accroche », et le premier motif d'annulation recopié là (« salle Villebourg & Vouvray », « niveau
 * <débutant> ») partirait sans garde. L'échappement se vérifie **au point de sortie**, une fois,
 * pas dans la discipline de chaque appelant.
 */

const faux = vi.hoisted(() => ({ envoyes: [] as string[], echecs: [] as string[] }));

vi.mock("@/lib/notifications/canaux", () => ({
  canalOperationnel: vi.fn(async () => true),
}));

vi.mock("@/lib/notifications/journal", () => ({
  clesDejaEnvoyees: vi.fn(async () => new Set<string>()),
  journaliser: vi.fn(async () => true),
  marquerEchec: vi.fn(async (cle: string) => {
    faux.echecs.push(cle);
  }),
}));

vi.mock("@/lib/notifications/webhooks", () => ({
  salonPour: vi.fn(async () => ({ url: null })),
}));

// `texteTelegram` et `echapperTelegram` restent les vrais : c'est la mise en forme qu'on éprouve.
vi.mock("@/lib/notifications/telegram", async (original) => {
  const vrai = await original<typeof import("@/lib/notifications/telegram")>();
  return {
    ...vrai,
    envoyerTelegram: vi.fn(async (texte: string) => {
      faux.envoyes.push(texte);
    }),
  };
});

const { publierSurTelegram } = await import("@/lib/notifications/salon");

const EMBED = { title: "Cours de demain", fields: [{ name: "Lieu", value: "Gymnase municipal" }] };

async function publier(content?: string) {
  faux.envoyes = [];
  await publierSurTelegram({ type: "RECAP", notification: "recap_veille", dedupKey: "recap_telegram_1", embed: EMBED, content });
  return faux.envoyes[0] ?? "";
}

beforeEach(() => {
  faux.envoyes = [];
  faux.echecs = [];
});

describe("le texte hors embed part échappé", () => {
  it("les trois caractères que Telegram interprète sont neutralisés dans `content`", async () => {
    const texte = await publier("Salle Villebourg & Vouvray — niveau <débutant>");
    expect(texte.startsWith("Salle Villebourg &amp; Vouvray — niveau &lt;débutant&gt;")).toBe(true);
    // Aucune balise inventée : ce qui n'était pas du HTML n'en devient pas.
    expect(texte).not.toContain("<débutant>");
    expect(texte).not.toContain("Vouvray &—");
  });

  it("aucune balise ouverte, aucun lien, ne peut venir de `content`", async () => {
    const texte = await publier('<b>attention</b> <a href="https://exemple.fr">ici</a>');
    expect(texte).toContain("&lt;b&gt;attention&lt;/b&gt;");
    // Un `<a href=…>` glissé là serait un lien cliquable posté au nom du club dans le groupe.
    expect(texte).not.toMatch(/<a\s/);
    // Les seules balises restantes sont celles que `texteTelegram` a posées lui-même : le titre et
    // le nom du champ, deux paires de `<b>`.
    expect([...texte.matchAll(/<\/?([a-z]+)/g)].map((m) => m[1])).toEqual(["b", "b", "b", "b"]);
  });

  it("le contenu de l'embed reste échappé, et la ligne vide de séparation est conservée", async () => {
    const texte = await publier("Coucou");
    expect(texte).toBe("Coucou\n\n<b>Cours de demain</b>\n\n<b>Lieu</b> — Gymnase municipal");
  });

  it("sans `content`, le message ne change pas d'un iota (pas de ligne vide en tête)", async () => {
    const texte = await publier(undefined);
    expect(texte).toBe("<b>Cours de demain</b>\n\n<b>Lieu</b> — Gymnase municipal");
    expect(await publier("")).toBe(texte);
  });
});
