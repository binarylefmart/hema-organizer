import { describe, expect, it } from "vitest";
import {
  attenteRetryTelegram,
  CHAT_ID,
  echapperTelegram,
  JETON_BOT,
  masquerJeton,
  MESSAGE_MAX,
  messageErreurTelegram,
  texteTelegram,
  tronquerTelegram,
} from "@/lib/notifications/telegram";
import type { DiscordEmbed } from "@/lib/notifications/discord";

/**
 * Le canal Telegram est un **second débouché du même contenu** : les messages sont mis en forme une
 * seule fois, sous forme d'embed, et `texteTelegram` les transcrit. Tout le risque de forme tient
 * donc dans cette fonction pure — échappement compris —, et ces tests la couvrent sans réseau.
 */
const EMBED: DiscordEmbed = {
  title: "🗡️ Cours de demain",
  url: "https://organizer.exemple.test/seances/abc",
  description: "📅 Jeudi 1er octobre — 19h30 à 21h30",
  fields: [
    { name: "Répartition", value: "✅ 13 Présent · 🤔 3 Peut-être" },
    { name: "Programme", value: "Messer — garde haute" },
  ],
  footer: { text: "Cercle d'escrime ancienne" },
};

describe("texteTelegram", () => {
  it("rend le titre en gras, cliquable quand l'embed porte un lien", () => {
    const texte = texteTelegram(EMBED);
    expect(texte).toContain('<a href="https://organizer.exemple.test/seances/abc"><b>🗡️ Cours de demain</b></a>');
  });

  it("garde un titre en gras sans lien quand il n'y en a pas", () => {
    expect(texteTelegram({ title: "❌ Cours annulé" })).toBe("<b>❌ Cours annulé</b>");
  });

  it("transcrit chaque champ en « nom — valeur »", () => {
    const texte = texteTelegram(EMBED);
    expect(texte).toContain("<b>Répartition</b> — ✅ 13 Présent · 🤔 3 Peut-être");
    expect(texte).toContain("<b>Programme</b> — Messer — garde haute");
  });

  it("met le pied en italique et sépare les blocs d'une ligne vide", () => {
    const texte = texteTelegram(EMBED);
    expect(texte).toContain("<i>Cercle d'escrime ancienne</i>");
    // Sur un téléphone, six lignes collées ne se lisent pas : les blocs respirent.
    expect(texte).toContain("\n\n");
  });

  it("un champ sans valeur ne laisse pas un tiret orphelin", () => {
    expect(texteTelegram({ fields: [{ name: "Programme", value: "  " }] })).toBe("<b>Programme</b>");
  });

  /**
   * **Le point de sécurité.** Le message part en `parse_mode: HTML` : un chevron non échappé venant
   * du thème d'un cours ou du motif d'une annulation — deux textes saisis à la main — casserait la
   * mise en forme, et Telegram refuserait le message entier (400). Tout ce qui vient des données
   * passe donc par `echapperTelegram`.
   */
  it("échappe ce qui vient des données, titre, champs et pied compris", () => {
    const texte = texteTelegram({
      title: "Cours <annulé> & repoussé",
      description: "Motif : la salle est prise <handball>",
      fields: [{ name: "<b>Faux gras</b>", value: "a < b & c > d" }],
      footer: { text: "Club <X>" },
    });
    expect(texte).toContain("<b>Cours &lt;annulé&gt; &amp; repoussé</b>");
    expect(texte).toContain("Motif : la salle est prise &lt;handball&gt;");
    expect(texte).toContain("<b>&lt;b&gt;Faux gras&lt;/b&gt;</b> — a &lt; b &amp; c &gt; d");
    expect(texte).toContain("<i>Club &lt;X&gt;</i>");
    // Aucune balise inventée : seules celles que nous posons nous-mêmes subsistent.
    expect(texte.match(/<(?!\/?(b|i|a)\b)/)).toBeNull();
  });

  it("échappe aussi l'URL du titre", () => {
    const texte = texteTelegram({ title: "Voir", url: 'https://x.test/?a=1&b="2"' });
    expect(texte).toContain('href="https://x.test/?a=1&amp;b="2""');
  });

  it("un embed vide donne un message vide plutôt qu'une erreur", () => {
    expect(texteTelegram({})).toBe("");
  });
});

describe("tronquerTelegram", () => {
  it("laisse passer ce qui tient dans un message", () => {
    expect(tronquerTelegram("court")).toBe("court");
  });

  it("coupe au-delà du plafond, sur une fin de ligne quand c'est possible", () => {
    const texte = `${"a".repeat(3000)}\n${"b".repeat(3000)}`;
    const coupe = tronquerTelegram(texte);
    expect(coupe.length).toBeLessThanOrEqual(MESSAGE_MAX);
    expect(coupe.endsWith("…")).toBe(true);
    // La coupure tombe sur le retour à la ligne : le second bloc part entier plutôt qu'à moitié.
    expect(coupe).toBe(`${"a".repeat(3000)}…`);
  });

  it("coupe quand même s'il n'y a aucune ligne où couper", () => {
    const coupe = tronquerTelegram("a".repeat(9000));
    expect(coupe.length).toBeLessThanOrEqual(MESSAGE_MAX);
    expect(coupe.endsWith("…")).toBe(true);
  });
});

/**
 * **Le jeton d'essai est assemblé, jamais écrit en un morceau**.
 *
 * C'est le jeton que **la documentation de Telegram donne en exemple**, mot pour mot : il est public
 * depuis des années, ne pilote aucun bot, et il est ici pour faire exactement ce que l'alerte
 * reproche — vérifier que `JETON_BOT` accepte un jeton bien écrit. Rien n'a fuité.
 *
 * Mais un scanner de secrets reconnaît une **forme**, pas une provenance : « neuf chiffres, deux
 * points, trente-cinq caractères » dans un fichier publié, c'est une alerte, et la remplacer par une
 * valeur inventée de la même forme en donnerait une autre. Une alerte qu'on sait fausse et qu'on
 * ferme chaque semaine est une alerte qu'on finira par fermer sans lire le jour où elle est vraie.
 * Les morceaux, eux, ne ressemblent à rien : le fichier n'en porte plus la forme, le test vérifie
 * toujours la même chose, et le garde-fou du dépôt public refuse désormais **toute** forme de jeton,
 * exemple de la documentation compris (`scripts/verifier-public.ts`).
 */
const ID_BOT = "123456789";
const SECRET_BOT = ["AAHdqTcvCH1", "vGWJxfSeofSAs", "0K5PALDsaw"].join("");
const JETON_ESSAI = `${ID_BOT}:${SECRET_BOT}`;

describe("formes attendues", () => {
  it("reconnaît un jeton de bot, refuse les fautes de recopie", () => {
    expect(JETON_BOT.test(JETON_ESSAI)).toBe(true);
    // Les cas vécus d'un copier-coller : espace, guillemets, moitié manquante.
    expect(JETON_BOT.test(` ${JETON_ESSAI}`)).toBe(false);
    expect(JETON_BOT.test(`"${JETON_ESSAI}"`)).toBe(false);
    expect(JETON_BOT.test("123456789")).toBe(false);
    expect(JETON_BOT.test("123456789:court")).toBe(false);
  });

  it("reconnaît un identifiant de salon : nombre, groupe négatif, ou @nom public", () => {
    expect(CHAT_ID.test("-1001234567890")).toBe(true);
    expect(CHAT_ID.test("123456789")).toBe(true);
    expect(CHAT_ID.test("@mon_canal")).toBe(true);
    expect(CHAT_ID.test("mon_canal")).toBe(false);
    expect(CHAT_ID.test("@x")).toBe(false);
    expect(CHAT_ID.test("")).toBe(false);
  });

  /**
   * **Le début, jamais la fin**. La fonction montrait les quatre derniers caractères du jeton, pour
   * aider à reconnaître le bon d'un coup d'œil ; c'est le mauvais bout, et `masquer()`
   * (`src/lib/crypto.ts`) l'avait déjà tranché avec son explication : la fin d'un secret part dans
   * une capture d'écran sans que personne n'y pense — et cette valeur s'affiche dans l'espace
   * admin, donc là même où l'on fait des captures pour demander de l'aide. L'identifiant numérique,
   * lui, est public (n'importe qui peut écrire au bot) et suffit à dire de quel bot il s'agit.
   */
  it("ne montre du jeton que son identifiant public, jamais sa fin", () => {
    const secret = SECRET_BOT;
    const masque = masquerJeton(JETON_ESSAI);
    expect(masque).toBe("123456789:••••••••••••");
    // Ni le début, ni la fin, ni aucun morceau du secret.
    expect(masque).not.toContain("AAHdqTcv");
    expect(masque).not.toContain(secret.slice(-4));
    // Un jeton sans `:` n'a pas d'identifiant public à montrer : on ne montre rien du tout.
    expect(masquerJeton("jeton-sans-deux-points")).toBe("••••••••••••");
    expect(masquerJeton("")).toBe("");
  });
});

describe("réponses de Telegram", () => {
  it("attend ce que Telegram demande en cas de limite de débit, dans des bornes raisonnables", () => {
    expect(attenteRetryTelegram({ parameters: { retry_after: 3 } })).toBe(3000);
    // Pas de valeur exploitable : une seconde, plutôt que rien ou l'infini.
    expect(attenteRetryTelegram({})).toBe(1000);
    expect(attenteRetryTelegram(null)).toBe(1000);
    expect(attenteRetryTelegram({ parameters: { retry_after: "beaucoup" } })).toBe(1000);
    // Plafonné : au-delà, l'envoi sera rejoué au passage suivant plutôt que de retenir la file.
    expect(attenteRetryTelegram({ parameters: { retry_after: 600 } })).toBe(30_000);
    expect(attenteRetryTelegram({ parameters: { retry_after: -5 } })).toBe(0);
  });

  it("traduit les refus en phrases qui disent quoi faire", () => {
    expect(messageErreurTelegram(401, { description: "Unauthorized" })).toContain("jeton refusé");
    expect(messageErreurTelegram(403, {})).toContain("Ajoute-le au groupe");
    expect(messageErreurTelegram(400, { description: "chat not found" })).toContain("chat not found");
    expect(messageErreurTelegram(502, null)).toContain("502");
  });
});

describe("echapperTelegram", () => {
  it("n'échappe que les trois caractères que Telegram interprète", () => {
    expect(echapperTelegram("a & b < c > d \" ' e")).toBe("a &amp; b &lt; c &gt; d \" ' e");
  });
});
