import { describe, expect, it, vi } from "vitest";

/**
 * L'identité du club vit en base ; ici on n'en veut que la valeur, pas la lecture — le transport
 * l'interroge à chaque envoi (nom affiché du webhook, avatar), et ce test n'a ni base ni réglages.
 */
const CLUB = { nomClub: "Cercle d'escrime ancienne", ecu: "/logo-ecu.png" };
vi.mock("@/lib/identite", () => ({ identite: async () => CLUB }));

const { LIMITES_DISCORD, embedBorne, nomDuFil, payloadDiscord, payloadEditionDiscord, posterDiscord, tronquerDiscord } = await import("@/lib/notifications/discord");

/**
 * **Salons de type forum.** Un forum n'est pas une suite de messages, c'est une liste de
 * discussions : un webhook qui y poste doit dire quel fil ouvrir (`thread_name`). Rien dans l'URL
 * d'un webhook ne dit le type du salon — on ne peut donc pas le deviner en le branchant. Mais
 * Discord, lui, le dit en refusant (code 220001) : on rejoue une fois en ouvrant un fil.
 *
 * C'est le bug remonté par.
 */
describe("salon de type forum", () => {
  const EMBED = { title: "🗡️ Cours de demain", description: "…", color: 0x074d95 };
  const URL_WEBHOOK = "https://discord.com/api/webhooks/123/abc";
  const REFUS_FORUM = {
    ok: false,
    status: 400,
    json: async () => ({ code: 220001, message: "Webhooks posted to forum channels must have a thread_name or thread_id" }),
    text: async () => JSON.stringify({ message: "Webhooks posted to forum channels must have a thread_name or thread_id", code: 220001 }),
    headers: new Headers(),
  } as unknown as Response;
  const ACCEPTE = { ok: true, status: 200, json: async () => ({ id: "m-1" }), text: async () => "", headers: new Headers() } as unknown as Response;

  it("rejoue en ouvrant un fil nommé d'après le titre du message", async () => {
    const appels: { thread_name?: string; username?: string }[] = [];
    const faux = vi.fn(async (_url: string, init?: RequestInit) => {
      appels.push(JSON.parse(String(init?.body)) as { thread_name?: string; username?: string });
      return appels.length === 1 ? REFUS_FORUM : ACCEPTE;
    });
    vi.stubGlobal("fetch", faux);
    try {
      await posterDiscord(URL_WEBHOOK, EMBED);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(appels).toHaveLength(2);
    // Le premier essai est le message ordinaire : on n'impose pas un fil aux salons qui n'en veulent pas
    expect(appels[0].thread_name).toBeUndefined();
    expect(appels[1].thread_name).toBe("🗡️ Cours de demain");
    // Le message est signé du nom du club, lu dans l'identité et non écrit dans le code.
    expect(appels[0].username).toBe(CLUB.nomClub);
  });

  it("n'insiste pas sur un refus qui n'est pas celui-là", async () => {
    const autreRefus = {
      ok: false,
      status: 400,
      json: async () => ({ code: 50035 }),
      text: async () => JSON.stringify({ message: "Invalid Form Body", code: 50035 }),
      headers: new Headers(),
    } as unknown as Response;
    const faux = vi.fn(async () => autreRefus);
    vi.stubGlobal("fetch", faux);
    try {
      await expect(posterDiscord(URL_WEBHOOK, EMBED)).rejects.toThrow("réponse 400");
    } finally {
      vi.unstubAllGlobals();
    }
    expect(faux).toHaveBeenCalledTimes(1);
  });

  it("borne le nom du fil à ce que Discord accepte, et retombe sur le nom du club", () => {
    expect(nomDuFil({ title: "x".repeat(150) }, CLUB.nomClub)).toHaveLength(100);
    expect(nomDuFil({ description: "sans titre" }, CLUB.nomClub)).toBe("Cercle d'escrime ancienne");
  });
});

/**
 * **Un embed trop long fait taire le salon, sans un mot.**
 *
 * Discord refuse tout le message (400) dès qu'un morceau dépasse : 1024 caractères pour la valeur
 * d'un champ, 256 pour un titre ou un nom de champ, 4096 pour la description, 6000 pour l'embed
 * entier. Or `appelerDiscord` renonce immédiatement sur une 4xx — à juste titre, un webhook
 * supprimé ne réapparaîtra pas — et l'appelant journalise un échec. Résultat : **le récap de la
 * veille n'est jamais publié**, et rien à l'écran ne dit pourquoi.
 *
 * Ce n'était pas atteignable tant que le programme d'une séance tenait dans une liste figée de
 * parties. Il est désormais libre : vers huit parties au libellé bavard, le champ « 📖 Programme »
 * passe les 1024 caractères et le club perd son annonce.
 */
describe("bornes de Discord (un message coupé vaut mieux qu'un salon muet)", () => {
  const CHAMP_ENORME = Array.from({ length: 40 }, (_, i) => `• Cours ${i + 1} — un thème au libellé vraiment très bavard (Avancé, atelier)`).join("\n");

  it("tronque la valeur d'un champ à 1024 caractères, en le disant par des points de suspension", () => {
    const borne = embedBorne({ fields: [{ name: "📖 Programme", value: CHAMP_ENORME }] });
    expect(CHAMP_ENORME.length).toBeGreaterThan(LIMITES_DISCORD.valeurChamp);
    expect(borne.fields?.[0].value.length).toBeLessThanOrEqual(LIMITES_DISCORD.valeurChamp);
    expect(borne.fields?.[0].value.endsWith("…")).toBe(true);
    // La coupe se fait sur une ligne entière quand c'est possible : une liste ne finit pas au milieu d'un mot
    expect(borne.fields?.[0].value).toContain("• Cours 1");
  });

  it("borne aussi le titre, les noms de champ, la description et le pied de page", () => {
    const borne = embedBorne({
      title: "t".repeat(400),
      description: "d".repeat(5000),
      fields: [{ name: "n".repeat(400), value: "v" }],
      footer: { text: "p".repeat(1000) },
    });
    expect(borne.title?.length).toBeLessThanOrEqual(LIMITES_DISCORD.titre);
    expect(borne.description?.length).toBeLessThanOrEqual(LIMITES_DISCORD.description);
    expect(borne.fields?.[0].name.length).toBeLessThanOrEqual(LIMITES_DISCORD.nomChamp);
    expect(borne.footer?.text.length).toBeLessThanOrEqual(LIMITES_DISCORD.piedDePage);
  });

  it("rabote la description en dernier recours, quand même sans champs le total dépasse", () => {
    // Titre et pied de page sont courts et portent l'essentiel (« Cours de demain », le nom du
    // club) : c'est le texte suivi qui cède, et il le dit par des points de suspension.
    const borne = embedBorne({ title: "🗡️ Cours de demain", description: "d".repeat(4096), footer: { text: "p".repeat(2000) } });
    const taille = borne.title!.length + borne.description!.length + borne.footer!.text.length;
    expect(taille).toBeLessThanOrEqual(LIMITES_DISCORD.embed);
    expect(borne.title).toBe("🗡️ Cours de demain");
  });

  it("tient le plafond global de 6000, que vingt-cinq champs valides franchissent à eux seuls", () => {
    const champs = Array.from({ length: 30 }, (_, i) => ({ name: `Champ ${i}`, value: "x".repeat(900) }));
    const borne = embedBorne({ title: "Récap", fields: champs });
    expect(borne.fields!.length).toBeLessThanOrEqual(LIMITES_DISCORD.champs);
    const taille = (borne.title?.length ?? 0) + borne.fields!.reduce((n, c) => n + c.name.length + c.value.length, 0);
    expect(taille).toBeLessThanOrEqual(LIMITES_DISCORD.embed);
    // On coupe par la fin : les premiers champs portent les réponses et l'effectif, ce qu'on vient lire
    expect(borne.fields?.[0].name).toBe("Champ 0");
  });

  it("ne touche à rien quand tout tient : un récap ordinaire part mot pour mot", () => {
    const embed = { title: "🗡️ Cours de demain", description: "📅 Jeudi\n📍 Villebourg", fields: [{ name: "Réponses", value: "✅ 13" }], footer: { text: "HEMA" } };
    expect(embedBorne(embed)).toEqual(embed);
    expect(tronquerDiscord("court", 100)).toBe("court");
  });

  it("borne ce qui part réellement, à l'envoi comme à la correction d'un message déjà posté", () => {
    const embed = { title: "🗡️ Cours de demain", fields: [{ name: "📖 Programme", value: CHAMP_ENORME }] };
    const envoi = payloadDiscord(embed, CLUB);
    const edition = payloadEditionDiscord(embed);
    expect(envoi.embeds[0].fields?.[0].value.length).toBeLessThanOrEqual(LIMITES_DISCORD.valeurChamp);
    expect(edition.embeds[0].fields?.[0].value.length).toBeLessThanOrEqual(LIMITES_DISCORD.valeurChamp);
  });
});
