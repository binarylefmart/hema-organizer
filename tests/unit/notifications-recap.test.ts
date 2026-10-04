import { describe, expect, it } from "vitest";
import { emailRappelSansReponse, emailRecapVeille } from "@/lib/email/templates/recap";
import {
  embedSeance,
  ligneChiffres,
  ligneEffectif,
  ligneRepartition,
  lignesProgramme,
  lignesSeance,
  programmeSeance,
  texteSeance,
  themeSeance,
  TITRE_RECAP,
} from "@/lib/notifications/contenu";
import { COULEUR_BLEU } from "@/lib/notifications/discord";
import { LIBELLE_LIEN_DESINSCRIPTION, lireJetonDesinscription, PHRASE_DESINSCRIPTION, urlDesinscription } from "@/lib/notifications/desinscription";
import {
  dansHorizonAlerteEffectif,
  dateRecap,
  datesJalons,
  derniereDateAlerteEffectif,
  empreinteCreneau,
  estHeureRecap,
  estPassageEnvois,
  FENETRE_RATTRAPAGE_MIN,
  heureParis,
  HORIZON_ALERTE_EFFECTIF,
  jalonPour,
  JALONS,
  PAS_RATTRAPAGE_MIN,
} from "@/lib/notifications/planification";

/**
 * Récap de la veille et rappels aux personnes sans réponse (étape « Notifications »).
 *
 * Ici, les fonctions **pures** : contenu commun, calendrier des jalons, lien de désinscription et
 * mise en forme des deux emails. Le choix des destinataires, l'idempotence et le respect des
 * réglages sont vérifiés sur un envoi complet dans `notifications-envois.test.ts`.
 */

const SEANCE = { date: "2026-09-24", heureDebut: "19:30", heureFin: "21:30", lieu: "Gymnase municipal", theme: "Messer — garde haute", alternative: "", disciplines: "Messer" };

/** Le nom du club, passé en argument aux mises en forme : elles restent pures (voir `contenu.ts`). */
const NOM_CLUB = "Mon club d'AMHE";
/** Le seuil d'effectif du club, tel qu'il est livré : il arrive en argument, jamais lu au fond du code. */
/** La part livrée : 20 % des invités, soit 4 personnes sur les 18 invités de ces exemples. */
const PART = 20;

/** Répartition complète d'une séance bien remplie : 13 présents, 3 indécis, 1 absent, 1 sans réponse. */
const REPARTITION = { invites: 18, presents: 13, absents: 1, peutEtre: 3, enAttente: 1, pourcentage: 72 };

/* ------------------------------------------------------------------ */
/* Contenu commun                                                      */
/* ------------------------------------------------------------------ */

describe("contenu commun des notifications de séance", () => {
  it("donne la date en toutes lettres, l'horaire, le lieu, le thème et les chiffres", () => {
    expect(lignesSeance(SEANCE, { presents: 13, invites: 18 })).toEqual([
      "📅 Jeudi 24 septembre 2026 — 19h30 à 21h30",
      "📍 Gymnase municipal",
      "📖 Messer — garde haute",
      "✅ 13 présents / 18 — 72 %",
    ]);
  });

  it("ne nomme jamais personne et accorde le singulier", () => {
    const texte = texteSeance(SEANCE, { presents: 1, invites: 18 });
    expect(texte.startsWith(TITRE_RECAP)).toBe(true);
    expect(texte).toContain("✅ 1 présent / 18 — 6 %");
    expect(texte).not.toContain("Chloé");
  });

  it("gère l'absence de thème et le taux nul", () => {
    const sans = { ...SEANCE, theme: "", disciplines: "" };
    expect(lignesSeance(sans, { presents: 0, invites: 0 })).toEqual(["📅 Jeudi 24 septembre 2026 — 19h30 à 21h30", "📍 Gymnase municipal", "✅ 0 présent / 0 — 0 %"]);
    expect(ligneChiffres({ presents: 0, invites: 12 })).toBe("✅ 0 présent / 12 — 0 %");
  });

  it("retombe sur les disciplines du planning, et mentionne l'alternative", () => {
    expect(themeSeance({ ...SEANCE, theme: "" })).toBe("Messer");
    expect(themeSeance({ ...SEANCE, disciplines: "Messer,Dague", theme: "" })).toBe("Messer · Dague");
    expect(themeSeance({ ...SEANCE, alternative: "Lutte" })).toBe("Messer — garde haute (ou Lutte)");
  });

  it("produit un embed Discord aux couleurs du club", () => {
    const embed = embedSeance(SEANCE, REPARTITION, NOM_CLUB, PART);
    expect(embed.title).toBe("🗡️ Cours de demain");
    expect(embed.color).toBe(COULEUR_BLEU);
    expect(embed.description).toContain("✅ 13 présents / 18 — 72 %");
    expect(embed.description).toContain("https://organizer.mon-club.fr");
    // Le pied de l'embed nomme le club : il vient de l'identité réglée, jamais d'une constante.
    expect(embed.footer?.text).toBe(NOM_CLUB);
  });
});

/* ------------------------------------------------------------------ */
/* Ce que le salon Discord porte en plus                               */
/* ------------------------------------------------------------------ */

describe("statut de la séance sur le salon Discord", () => {
  it("donne la répartition complète des réponses, en nombres et jamais en noms", () => {
    expect(ligneRepartition(REPARTITION)).toBe("✅ 13 Présent · 🤔 3 Peut-être · ❌ 1 Absent · ⏳ 1 sans réponse");
    expect(ligneRepartition(REPARTITION, "\n").split("\n")).toHaveLength(4);
  });

  it("annonce l'effectif attendu comme une estimation, et le palier en toutes lettres", () => {
    // 13 confirmés + la moitié de 3 indécis (arrondie) = ~15 : bien au-dessus du seuil de confort.
    expect(ligneEffectif(REPARTITION, PART)).toBe("~15 attendus\n**Bien rempli**");
    expect(ligneEffectif({ invites: 18, presents: 4, absents: 2, peutEtre: 1, enAttente: 11, pourcentage: 22 }, PART)).toBe("~5 attendus\n**Effectif juste**");
    expect(ligneEffectif({ invites: 18, presents: 2, absents: 2, peutEtre: 0, enAttente: 14, pourcentage: 11 }, PART)).toBe("~2 attendus\n**Peu de monde**");
    // Période de quatre invités ou moins : aucun effectif n'y atteindra le seuil, aucun palier n'est affiché.
    expect(ligneEffectif({ invites: 3, presents: 1, absents: 0, peutEtre: 0, enAttente: 2, pourcentage: 33 }, PART)).toBe("~1 attendus");
  });

  /**
   * Le salon dit **le même** palier que les écrans et que l'email de l'équipe : la part qui le décide
   * est celle réglée par le club, et elle arrive en argument jusqu'ici (`recap.ts` la lit par
   * `identite()`).
   */
  it("suit l'effectif du club, à part réglée identique", () => {
    // ~15 attendus, la même part (20 %), trois clubs : « bien rempli » à dix-huit invités (seuil 4),
    // « effectif juste » à soixante (seuil 12, confort 18) et « peu de monde » à quatre-vingts
    // (seuil 16). Le même effectif, trois verdicts — et pas un réglage à toucher.
    const memeCours = (invites: number) => ({ invites, presents: 13, absents: 1, peutEtre: 3, enAttente: invites - 17 });
    expect(ligneEffectif({ ...memeCours(18), pourcentage: 72 }, PART)).toBe("~15 attendus\n**Bien rempli**");
    expect(ligneEffectif({ ...memeCours(60), pourcentage: 22 }, PART)).toBe("~15 attendus\n**Effectif juste**");
    expect(ligneEffectif({ ...memeCours(80), pourcentage: 16 }, PART)).toBe("~15 attendus\n**Peu de monde**");
  });

  it("reprend l'ordre du planning et le titre de l'atelier, cases vides écartées", () => {
    const cases = programmeSeance([
      { libelle: "Option 1", ordre: 2, theme: "ignoré", atelier: { titre: "Nœuds de corde" } },
      { libelle: "Cours 1", ordre: 0, theme: "Messer", atelier: null },
      { libelle: "Cours 2", ordre: 1, theme: "   ", atelier: null },
    ]);
    expect(lignesProgramme(cases)).toEqual(["• Cours 1 — Messer", "• Option 1 — Nœuds de corde (atelier)"]);
  });

  it("met la répartition, l'effectif et le programme dans les champs de l'embed, sans toucher au texte commun", () => {
    const programme = programmeSeance([{ libelle: "Cours 1", ordre: 0, theme: "Messer", atelier: null }]);
    const embed = embedSeance(SEANCE, REPARTITION, NOM_CLUB, PART, { programme });
    expect(embed.fields?.map((c) => c.name)).toEqual(["Réponses", "Effectif attendu", "📖 Programme"]);
    expect(embed.fields?.[2].value).toBe("• Cours 1 — Messer");
    // Le contenu commun, lui, est mot pour mot celui des emails et des pages de partage.
    expect(embed.description?.startsWith(lignesSeance(SEANCE, REPARTITION).join("\n"))).toBe(true);
    expect(JSON.stringify(embed)).not.toContain("Chloé");
  });
});

/* ------------------------------------------------------------------ */
/* Calendrier des envois                                               */
/* ------------------------------------------------------------------ */

describe("calendrier des envois", () => {
  it("vise les séances du lendemain pour le récap", () => {
    expect(dateRecap("2026-09-23")).toBe("2026-09-24");
    expect(dateRecap("2026-12-31")).toBe("2027-01-01");
  });

  it("calcule les jalons J-7 et J-2 au bon jour", () => {
    expect([...JALONS]).toEqual([7, 2]);
    expect(datesJalons("2026-09-24")).toEqual(["2026-10-01", "2026-09-26"]);
    expect(jalonPour("2026-10-01", "2026-09-24")).toBe(7);
    expect(jalonPour("2026-09-26", "2026-09-24")).toBe(2);
    // ni la veille, ni J-3, ni J-8, ni une séance passée
    for (const date of ["2026-09-25", "2026-09-27", "2026-10-02", "2026-09-23"]) {
      expect(jalonPour(date, "2026-09-24")).toBeNull();
    }
  });

  it("traverse un changement d'heure sans décaler les jalons", () => {
    // passage à l'heure d'hiver dans la nuit du 24
    expect(datesJalons("2026-10-23")).toEqual(["2026-10-30", "2026-10-25"]);
    expect(jalonPour("2026-10-30", "2026-10-23")).toBe(7);
  });

  /**
   * L'alerte « peu de monde » regardait les deux prochaines séances quelles que soient leurs
   * dates :, Delta l'a reçue le matin pour les cours du 6 **et**. Elle ne part plus que dans les
   * trois jours qui précèdent le cours concerné.
   */
  it("ne signale un effectif faible que dans les 3 jours avant le cours", () => {
    expect(HORIZON_ALERTE_EFFECTIF).toBe(3);
    expect(derniereDateAlerteEffectif("2026-09-29")).toBe("2026-10-02");
    // le jour même, et les trois jours qui le précèdent
    for (const date of ["2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"]) {
      expect(dansHorizonAlerteEffectif(date, "2026-09-29")).toBe(true);
    }
    // les deux cours du cas vécu, et une séance déjà passée
    for (const date of ["2026-10-03", "2026-10-06", "2026-10-12", "2026-09-28"]) {
      expect(dansHorizonAlerteEffectif(date, "2026-09-29")).toBe(false);
    }
  });

  it("garde la fenêtre de l'alerte au changement d'heure et au passage d'année", () => {
    expect(derniereDateAlerteEffectif("2026-10-23")).toBe("2026-10-26");
    expect(dansHorizonAlerteEffectif("2026-10-25", "2026-10-23")).toBe(true);
    expect(derniereDateAlerteEffectif("2026-12-30")).toBe("2027-01-02");
    expect(dansHorizonAlerteEffectif("2027-01-02", "2026-12-30")).toBe(true);
  });

  it("ne déclenche qu'à la minute réglée, en heure de Paris", () => {
    const aDixHuit = new Date("2026-09-23T16:00:00Z"); // 18:00 à Paris (heure d'été)
    expect(heureParis(aDixHuit)).toBe("18:00");
    expect(estHeureRecap("18:00", aDixHuit)).toBe(true);
    expect(estHeureRecap("18:00", new Date("2026-09-23T16:01:00Z"))).toBe(false);
    expect(estHeureRecap("19:30", new Date("2026-09-23T17:30:00Z"))).toBe(true);
    // même heure locale en hiver : le décalage change, pas le réglage
    expect(estHeureRecap("18:00", new Date("2026-12-23T17:00:00Z"))).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Rattrapage des envois du soir                                       */
/* ------------------------------------------------------------------ */

/**
 * **La minute réglée n'était qu'une minute**, et rien ne la rattrapait : un serveur redémarré à
 * 18:00, un cron en retard sous charge ou une heure avalée par le changement d'horaire coûtaient la
 * journée entière de récap. Pire, la reprise après échec promise par `journal.ts` n'avait jamais lieu
 * ici : une clé libérée par `marquerEchec` n'était rejouée que le lendemain — donc jamais, pour un
 * cours du lendemain. D'où quelques repassages derrière l'heure réglée, gratuits puisque tout est
 * idempotent.
 */
describe("fenêtre de rattrapage des envois du soir", () => {
  /** 18:00 à Paris le 23 septembre 2026, puis les minutes qui suivent. */
  const aParis = (minute: number) => new Date(Date.UTC(2026, 8, 23, 16, minute));

  it("part à l'heure réglée, comme avant", () => {
    expect(estPassageEnvois("18:00", aParis(0))).toBe(true);
  });

  it("repasse à intervalles réguliers, et rattrape donc une minute manquée", () => {
    expect(estPassageEnvois("18:00", aParis(PAS_RATTRAPAGE_MIN))).toBe(true);
    expect(estPassageEnvois("18:00", aParis(2 * PAS_RATTRAPAGE_MIN))).toBe(true);
    expect(estPassageEnvois("18:00", aParis(FENETRE_RATTRAPAGE_MIN))).toBe(true);
  });

  it("ne repasse pas toutes les minutes : le cron tourne 1440 fois par jour", () => {
    expect(estPassageEnvois("18:00", aParis(1))).toBe(false);
    expect(estPassageEnvois("18:00", aParis(PAS_RATTRAPAGE_MIN - 1))).toBe(false);
  });

  it("s'arrête au bout de la fenêtre, et ne part jamais avant l'heure", () => {
    expect(estPassageEnvois("18:00", aParis(FENETRE_RATTRAPAGE_MIN + PAS_RATTRAPAGE_MIN))).toBe(false);
    expect(estPassageEnvois("18:15", aParis(0))).toBe(false);
  });

  it("ne déborde pas sur le lendemain, même pour une heure réglée tard le soir", () => {
    // 23:30 réglé : 00:00 n'est pas « trente minutes après », c'est un autre jour et un autre récap.
    expect(estPassageEnvois("23:30", new Date(Date.UTC(2026, 8, 23, 22, 0)))).toBe(false);
    expect(estPassageEnvois("23:30", new Date(Date.UTC(2026, 8, 23, 21, 30)))).toBe(true);
  });

  it("ignore une heure réglée illisible plutôt que d'envoyer n'importe quand", () => {
    expect(estPassageEnvois("", aParis(0))).toBe(false);
    expect(estPassageEnvois("25:00", aParis(0))).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Empreinte du créneau (clés de déduplication)                        */
/* ------------------------------------------------------------------ */

/**
 * Une séance **déplacée** garde son identifiant : c'est pour cela que les clés de déduplication du
 * récap et des rappels portent aussi son créneau. Sans lui, l'annonce partie pour l'ancienne date
 * interdisait celle de la nouvelle, et les membres n'étaient jamais prévenus du bon jour.
 */
describe("empreinte du créneau d'une séance", () => {
  it("change dès que la date ou l'heure bouge", () => {
    expect(empreinteCreneau({ date: "2026-10-08", heureDebut: "19:30" })).toBe("2026-10-08-1930");
    expect(empreinteCreneau({ date: "2026-10-15", heureDebut: "19:30" })).toBe("2026-10-15-1930");
    expect(empreinteCreneau({ date: "2026-10-08", heureDebut: "20:00" })).toBe("2026-10-08-2000");
  });

  it("ne bouge pas pour deux lectures du même créneau (sinon, un doublon à chaque passage)", () => {
    expect(empreinteCreneau({ date: "2026-10-08", heureDebut: "19:30" })).toBe(empreinteCreneau({ date: "2026-10-08", heureDebut: "19:30" }));
  });
});

/* ------------------------------------------------------------------ */
/* Lien de désinscription                                              */
/* ------------------------------------------------------------------ */

describe("lien de désinscription", () => {
  /**
   * Le lien coupe **les deux canaux** — c'est le choix retenu, et il faut donc que le texte le
   * dise. Il annonçait « ces rappels par email » alors que le clic coupait aussi les notifications
   * sur le téléphone : la promesse ne valait que la moitié de ce qu'elle faisait, et on ne s'en
   * apercevait qu'en ratant un cours.
   */
  it("nomme les deux canaux, jamais l'email seul", () => {
    expect(LIBELLE_LIEN_DESINSCRIPTION).toContain("email");
    expect(LIBELLE_LIEN_DESINSCRIPTION).toContain("téléphone");
    expect(PHRASE_DESINSCRIPTION).toContain("email");
    expect(PHRASE_DESINSCRIPTION).toContain("téléphone");
    // La formule d'avant, qui ne parlait que de la boîte mail, ne doit pas revenir.
    expect(LIBELLE_LIEN_DESINSCRIPTION).not.toBe("Ne plus recevoir ces rappels par email");
  });

  it("se relit, refuse un jeton trafiqué et expire au bout d'un an", () => {
    const url = urlDesinscription("membre-1");
    const jeton = url.split("/desinscription/")[1];
    expect(url.startsWith("https://organizer.mon-club.fr/desinscription/")).toBe(true);
    expect(lireJetonDesinscription(jeton)).toBe("membre-1");
    expect(lireJetonDesinscription(`${jeton}x`)).toBeNull();
    expect(lireJetonDesinscription("n'importe.quoi")).toBeNull();
    const dansTreizeMois = new Date(Date.now() + 400 * 24 * 60 * 60 * 1000);
    expect(lireJetonDesinscription(jeton, dansTreizeMois)).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Emails                                                              */
/* ------------------------------------------------------------------ */

describe("email du récap de la veille", () => {
  const mail = emailRecapVeille({
    prenom: "Chloé",
    seance: SEANCE,
    chiffres: { presents: 13, invites: 18 },
    statut: "PRESENT",
    urlPresent: "https://x.fr/?seance=s1&reponse=present",
    urlAbsent: "https://x.fr/?seance=s1&reponse=absent",
    urlDesinscription: "https://x.fr/desinscription/jeton",
  });

  it("annonce le cours du lendemain dans l'objet, sans le rallonger de l'alternative", () => {
    expect(mail.sujet).toBe("🗡️ Rappel : cours demain à 19h30 — Messer — garde haute");
    const avecAlternative = emailRecapVeille({ prenom: "Chloé", seance: { ...SEANCE, alternative: "Lutte" }, chiffres: { presents: 1, invites: 2 }, statut: "PRESENT", urlPresent: "u", urlAbsent: "u", urlDesinscription: "u" });
    expect(avecAlternative.sujet).toBe("🗡️ Rappel : cours demain à 19h30 — Messer — garde haute");
    expect(avecAlternative.contenu.paragraphes[1]).toContain("(ou Lutte)"); // l'alternative reste dans le corps
    const sansTheme = emailRecapVeille({ prenom: "Chloé", seance: { ...SEANCE, theme: "", disciplines: "" }, chiffres: { presents: 1, invites: 2 }, statut: "PRESENT", urlPresent: "u", urlAbsent: "u", urlDesinscription: "u" });
    expect(sansTheme.sujet).toBe("🗡️ Rappel : cours demain à 19h30");
  });

  it("reprend le contenu commun et rappelle la réponse du membre", () => {
    expect(mail.contenu.paragraphes[1]).toBe(lignesSeance(SEANCE, { presents: 13, invites: 18 }).join("\n"));
    expect(mail.contenu.paragraphes[2]).toBe("Tu es inscrit(e) : Présent.");
    const peutEtre = emailRecapVeille({ prenom: "Chloé", seance: SEANCE, chiffres: { presents: 13, invites: 18 }, statut: "PEUT_ETRE", urlPresent: "u", urlAbsent: "u", urlDesinscription: "u" });
    expect(peutEtre.contenu.paragraphes[2]).toBe("Tu es inscrit(e) : Peut-être.");
  });

  it("propose les deux boutons et le lien de désinscription en pied", () => {
    expect(mail.contenu.boutons).toEqual([
      { label: "Je viens", url: "https://x.fr/?seance=s1&reponse=present", couleur: "vert" },
      { label: "Je ne viens plus", url: "https://x.fr/?seance=s1&reponse=absent", couleur: "rouge" },
    ]);
    const pied = mail.contenu.piedDePage?.at(-1) ?? "";
    expect(pied).toContain("https://x.fr/desinscription/jeton");
    // Le pied dit ce que le clic fait vraiment : il coupe l'email **et** le téléphone.
    expect(pied).toContain(LIBELLE_LIEN_DESINSCRIPTION);
    expect(pied).toContain("téléphone");
  });
});

describe("email de rappel aux personnes sans réponse", () => {
  const args = { prenom: "Juliett", seance: SEANCE, chiffres: { presents: 4, invites: 18 }, urlApp: "https://x.fr", urlDesinscription: "https://x.fr/desinscription/j" };

  it("dit le délai restant dans l'objet, à J-7 comme à J-2", () => {
    expect(emailRappelSansReponse({ ...args, jours: 7 }).sujet).toBe("🗡️ Cours dans une semaine (jeudi 24 sept.) — tu viens ?");
    expect(emailRappelSansReponse({ ...args, jours: 2 }).sujet).toBe("🗡️ Cours dans deux jours (jeudi 24 sept.) — tu viens ?");
  });

  it("reprend le contenu commun, invite à répondre et porte la désinscription", () => {
    const { contenu } = emailRappelSansReponse({ ...args, jours: 2 });
    expect(contenu.paragraphes[0]).toBe("Il reste deux jours avant le cours, et tu n'as pas encore dit si tu venais.");
    expect(contenu.paragraphes[1]).toContain("✅ 4 présents / 18 — 22 %");
    expect(contenu.boutons).toEqual([{ label: "Répondre en un appui", url: "https://x.fr" }]);
    const pied = contenu.piedDePage?.at(-1) ?? "";
    expect(pied).toContain("https://x.fr/desinscription/j");
    expect(pied).toContain("téléphone");
  });
});
