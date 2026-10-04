import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CANAUX,
  CANAUX_PAR_NOTIFICATION,
  COUPLES_EMIS,
  DESCRIPTIONS,
  NOTIFICATIONS_TOUJOURS_ENVOYEES,
  TYPES_NOTIFICATION,
  RAISON_API_EXCLUE,
  canalActifDans,
  destinataireRetenu,
  estCanalExposition,
  lirePreferences,
  notificationActiveDans,
  preferencesDefaut,
  serialiserPreferences,
} from "@/lib/notifications/preferences";
import { HORIZON_ALERTE_EFFECTIF } from "@/lib/notifications/planification";
import { ERREUR_WHATSAPP_NON_CONFIGURE, envoyerWhatsApp, lienPartageWhatsApp, whatsappConfigure } from "@/lib/notifications/whatsapp";

/**
 * Panneau « Notifications » (Gestion → Réglages) : le réglage est une seule clé JSON de la table
 * Setting, relue par des fonctions pures (aucune base ici). On vérifie surtout qu'une valeur
 * absente ou abîmée ne coupe jamais ce qui partait avant, et qu'un canal coupé coupe tout son canal.
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("valeurs par défaut", () => {
  it("sont utilisées quand la clé est absente, vide ou illisible", () => {
    const defaut = preferencesDefaut();
    for (const brut of [null, undefined, "", "pas du json", "[]", '"texte"', "{}", '{"canaux":42}']) {
      expect(lirePreferences(brut)).toEqual(defaut);
    }
  });

  it("laissent partir ce qui part aujourd'hui : annulation et effectif faible par email", () => {
    const prefs = lirePreferences(null);
    expect(notificationActiveDans(prefs, "seance_annulee", "email")).toBe(true);
    expect(notificationActiveDans(prefs, "effectif_faible", "email")).toBe(true);
  });

  it("laissent WhatsApp éteint tant qu'aucun service d'envoi n'est branché", () => {
    const prefs = lirePreferences(null);
    expect(canalActifDans(prefs, "whatsapp")).toBe(false);
    for (const type of TYPES_NOTIFICATION) expect(notificationActiveDans(prefs, type, "whatsapp")).toBe(false);
  });

  it("ignorent les clés inconnues et les types inattendus, sans perdre le reste", () => {
    const prefs = lirePreferences(
      JSON.stringify({
        canaux: { email: false, inconnu: true, discord: "oui" },
        notifications: { seance_annulee: { email: false, pigeon: true }, inexistante: { email: true } },
      }),
    );
    expect(prefs.canaux.email).toBe(false);
    expect(prefs.canaux.discord).toBe(true); // "oui" n'est pas un booléen : valeur par défaut conservée
    expect(prefs.notifications.seance_annulee.email).toBe(false);
    expect(prefs.notifications.effectif_faible.email).toBe(true);
    expect(Object.keys(prefs.canaux).sort()).toEqual([...CANAUX].sort());
  });

  it("n'écrivent en base que les canaux et les couples qui ont un sens", () => {
    const ecrit = JSON.parse(serialiserPreferences(preferencesDefaut())) as {
      canaux: Record<string, boolean>;
      notifications: Record<string, Record<string, boolean>>;
    };
    expect(Object.keys(ecrit.notifications).sort()).toEqual([...TYPES_NOTIFICATION].sort());
    for (const type of TYPES_NOTIFICATION) {
      expect(Object.keys(ecrit.notifications[type]).sort()).toEqual([...CANAUX_PAR_NOTIFICATION[type]].sort());
    }
  });
});

describe("interrupteur de canal", () => {
  it("coupe tout ce qui passe par ce canal, même si les cases restent cochées", () => {
    const prefs = lirePreferences(JSON.stringify({ canaux: { email: false } }));
    expect(prefs.notifications.seance_annulee.email).toBe(true); // la case est conservée…
    for (const type of TYPES_NOTIFICATION) expect(notificationActiveDans(prefs, type, "email")).toBe(false); // … mais rien ne part
    expect(canalActifDans(prefs, "email")).toBe(false);
  });

  it("rallumer le canal fait repartir les notifications restées cochées", () => {
    const prefs = lirePreferences(JSON.stringify({ canaux: { email: true } }));
    expect(notificationActiveDans(prefs, "seance_annulee", "email")).toBe(true);
  });
});

describe("matrice notification × canal", () => {
  it("coupe une notification sur un canal sans toucher à l'autre", () => {
    const prefs = lirePreferences(
      JSON.stringify({ canaux: { email: true, discord: true }, notifications: { recap_veille: { email: false, discord: true } } }),
    );
    expect(notificationActiveDans(prefs, "recap_veille", "email")).toBe(false);
    expect(notificationActiveDans(prefs, "recap_veille", "discord")).toBe(true);
    // les autres lignes ne bougent pas
    expect(notificationActiveDans(prefs, "seance_annulee", "email")).toBe(true);
  });

  it("refuse un couple qui n'a pas de sens, même coché de force", () => {
    // Les messages personnels (réponse à une proposition d'atelier) restent l'email seul :
    // le salon Discord et le groupe WhatsApp sont publics.
    const prefs = lirePreferences(JSON.stringify({ canaux: { discord: true }, notifications: { atelier_statut: { discord: true } } }));
    expect(CANAUX_PAR_NOTIFICATION.atelier_statut).not.toContain("discord");
    expect(notificationActiveDans(prefs, "atelier_statut", "discord")).toBe(false);
  });
});

/**
 * **Aucune notification automatique ne doit exister par email seul.**
 *
 * L'email et le téléphone sont les deux canaux *personnels* : ils s'adressent aux mêmes gens, pour
 * le même message. Ajouter une notification en ne la branchant que sur l'email est l'oubli naturel
 * (l'email est le chemin le plus ancien, et il se teste plus vite) ; ces deux gardes le rendent
 * visible au moment où il est commis plutôt qu'à la première question d'un membre.
 */
describe("email et téléphone vont de pair", () => {
  const lireCode = (fichier: string) =>
    readFileSync(path.join(process.cwd(), fichier), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");

  it("ouvre les deux canaux personnels à chaque notification, et les allume par défaut", () => {
    const defaut = preferencesDefaut();
    for (const type of TYPES_NOTIFICATION) {
      expect(CANAUX_PAR_NOTIFICATION[type]).toContain("email");
      expect(CANAUX_PAR_NOTIFICATION[type]).toContain("push");
      // Le couple n'est pas seulement réglable : il est réellement émis par le code.
      expect(COUPLES_EMIS[type]).toContain("email");
      expect(COUPLES_EMIS[type]).toContain("push");
      expect(notificationActiveDans(defaut, type, "email")).toBe(true);
      expect(notificationActiveDans(defaut, type, "push")).toBe(true);
    }
  });

  /**
   * **La liste des modules d'envoi se DÉCOUVRE, elle ne se recopie pas**.
   *
   * Elle était écrite à la main — six noms — et il y en avait sept : `periode-non-activee.ts`, ajouté
   * le 28/09, n'y figurait pas. Il se trouve qu'il respectait la règle, mais personne ne le vérifiait :
   * le garde-fou censé attraper « un email automatique part sans notification sur le téléphone »
   * regardait à côté du module le plus récent, c'est-à-dire exactement celui pour lequel il existe. Une
   * liste à tenir à jour est une liste qu'on oublie de tenir à jour, et le prochain module aurait glissé
   * de la même façon.
   *
   * Le balayage lit donc le dossier : **tout module de `src/lib/notifications/` qui appelle
   * `enqueueEmail` doit doubler sur le téléphone**, derrière la garde de canal du club. Et il refuse de
   * passer si le dossier n'en rend aucun — un balayage qui ne balaie rien est vert pour la mauvaise
   * raison.
   */
  it("pose la notification sur le téléphone partout où un email automatique part", () => {
    const dossier = path.join(process.cwd(), "src/lib/notifications");
    const modules = readdirSync(dossier)
      .filter((f) => f.endsWith(".ts"))
      .map((f) => `src/lib/notifications/${f}`)
      .filter((f) => lireCode(f).includes("enqueueEmail("))
      .sort();
    // Sept : récap de la veille, rappels sans réponse, annulation et alerte « peu de monde »,
    // nouvel événement, période suivante à créer, période non activée, réponse à un atelier.
    expect(modules.length, "aucun module d'envoi trouvé : le balayage regarde au mauvais endroit").toBeGreaterThanOrEqual(7);
    for (const fichier of modules) {
      const code = lireCode(fichier);
      expect(code, `${fichier} : email attendu`).toMatch(/enqueueEmail\(/);
      // Même envoi, même journal, même idempotence : tout passe par `notifierParPush`.
      expect(code, `${fichier} : téléphone manquant`).toMatch(/notifierParPush\(/);
      // Et derrière la garde de canal du club, jamais en dur.
      expect(code, `${fichier} : garde de canal manquante`).toMatch(/pushPossible\(/);
    }
  });

  /**
   * Les **messages de sécurité** (alerte aux administrateurs, nouvelle connexion) sont doublés sur
   * le téléphone eux aussi, mais ils vivent **hors matrice** : on leur a ajouté un canal, pas un
   * interrupteur. Le garde-fou ci-dessus ne peut donc pas les réclamer dans sa liste de modules —
   * celui-ci vérifie l'inverse, et qu'aucun réglage ne s'est glissé dans leur chemin.
   */
  it("double les messages de sécurité sans jamais leur donner d'interrupteur", () => {
    const code = lireCode("src/lib/notifications/securite.ts");
    expect(code).toMatch(/notifierParPush\(/);
    expect(code).not.toMatch(/pushPossible|notificationActive|canalActif|destinataireRetenu/);
    for (const type of TYPES_NOTIFICATION) expect(code).not.toContain(`"${type}"`);
  });
});

describe("réponse à une proposition d'atelier", () => {
  const lire = (f: string) => {
    const source = readFileSync(path.join(process.cwd(), f), "utf8");
    return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  };

  it("part par défaut : le comportement d'avant le réglage est conservé", () => {
    expect(notificationActiveDans(lirePreferences(null), "atelier_statut", "email")).toBe(true);
    // La réponse à une proposition est **personnelle** : email et téléphone, jamais le salon.
    expect(CANAUX_PAR_NOTIFICATION.atelier_statut).toEqual(["email", "push"]);
  });

  it("est réglable : décochée, plus aucun email de décision ne part", () => {
    const prefs = lirePreferences(JSON.stringify({ notifications: { atelier_statut: { email: false } } }));
    expect(notificationActiveDans(prefs, "atelier_statut", "email")).toBe(false);
    expect(notificationActiveDans(prefs, "seance_annulee", "email")).toBe(true); // les autres lignes ne bougent pas
  });

  it("suit l'interrupteur du canal email", () => {
    const prefs = lirePreferences(JSON.stringify({ canaux: { email: false } }));
    expect(notificationActiveDans(prefs, "atelier_statut", "email")).toBe(false);
  });

  it("ne dépend pas de la case « rappel la veille » du profil (ce n'est pas un rappel)", () => {
    expect(destinataireRetenu(preferencesDefaut(), "atelier_statut", "email", { actif: true, rappelEmail: false })).toBe(true);
    expect(destinataireRetenu(preferencesDefaut(), "atelier_statut", "email", { actif: false, rappelEmail: true })).toBe(false);
  });

  it("n'est plus annoncée comme toujours envoyée", () => {
    expect(NOTIFICATIONS_TOUJOURS_ENVOYEES.map((n) => n.titre)).not.toContain("Réponse à une proposition d'atelier");
    expect([...TYPES_NOTIFICATION]).toContain("atelier_statut");
  });

  /**
   * **Un seul chemin, et les deux écrans le prennent.** Les deux actions recopiaient le même bloc
   * d'envoi — et les deux copies avaient dérivé de la règle du dossier : `envoiPossible` contourné,
   * rien au journal, une clé de push qui bloquait un second refus. Le bloc vit désormais dans
   * `src/lib/notifications/ateliers.ts`, et les actions ne font plus que l'appeler.
   */
  it("passe par le point de passage unique dans les deux chemins de décision", () => {
    for (const fichier of ["src/actions/ateliers.ts", "src/actions/planning.ts"]) {
      const code = lire(fichier);
      // Aucun envoi recopié dans l'action : ni email, ni push, ni lecture de réglages.
      expect(code, `${fichier} : email recopié`).not.toMatch(/enqueueEmail\(/);
      expect(code, `${fichier} : push recopié`).not.toMatch(/notifierParPush\(/);
      expect(code, `${fichier} : réglages relus sur place`).not.toMatch(/getPreferencesNotifications\(/);
      // …seulement l'appel au module qui les tient tous.
      expect(code, `${fichier} : point de passage manquant`).toMatch(/notifierDecisionAtelier\(\{/);
    }

    const envoi = lire("src/lib/notifications/ateliers.ts");
    // L'état réel du canal **et** le réglage du club : c'est `envoiPossible` qui compose les deux.
    expect(envoi).toMatch(/envoiPossible\("atelier_statut", "email"\)/);
    // Le club **et** le choix personnel : c'est `destinataireRetenu` qui compose les deux.
    // Les réglages sont lus une seule fois (`prefs`) et servent aux deux canaux.
    expect(envoi).toMatch(/const prefs = await getPreferencesNotifications\(\);/);
    expect(envoi).toMatch(/destinataireRetenu\(prefs, "atelier_statut", "email"/);
    expect(envoi).toMatch(/destinataireRetenu\(prefs, "atelier_statut", "push"/);
    // Un seul envoi d'email dans le module, et il est journalisé avant de partir.
    expect(envoi.match(/enqueueEmail\(/g)).toHaveLength(1);
    expect(envoi.indexOf("journaliser({")).toBeGreaterThan(-1);
    expect(envoi.indexOf("enqueueEmail(")).toBeGreaterThan(envoi.indexOf("journaliser({"));
    // Le push ne part que derrière sa propre garde de canal, posée avant l'envoi.
    const garde = envoi.indexOf('pushPossible("atelier_statut")');
    const envoiPush = envoi.indexOf("notifierParPush({");
    expect(garde).toBeGreaterThan(-1);
    expect(envoiPush).toBeGreaterThan(garde);
  });
});

describe("emails d'accès et de sécurité", () => {
  it("restent obligatoires : les couper enfermerait les gens dehors", () => {
    const titres = NOTIFICATIONS_TOUJOURS_ENVOYEES.map((n) => n.titre);
    expect(titres).toContain("Lien d'accès personnel");
    expect(titres).toContain("Nouvel appareil");
    expect(titres).toContain("Mot de passe oublié");
    for (const titre of titres) expect([...TYPES_NOTIFICATION]).not.toContain(titre);
  });

  it("ne consultent jamais les préférences (src/actions/auth.ts, src/lib/invitations.ts)", () => {
    for (const fichier of ["src/actions/auth.ts", "src/lib/invitations.ts"]) {
      const source = readFileSync(path.join(process.cwd(), fichier), "utf8");
      const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(code).not.toMatch(/notificationActive|canalActif|notifications\/preferences/);
    }
  });
});

describe("alertes de sécurité", () => {
  it("ne sont pas réglables : absentes de la matrice, listées comme toujours envoyées", () => {
    expect([...TYPES_NOTIFICATION]).not.toContain("alerte_securite");
    expect(NOTIFICATIONS_TOUJOURS_ENVOYEES.map((n) => n.titre)).toContain("Alertes de sécurité");
  });

  it("partent quoi qu'il arrive : src/lib/alertes.ts ne consulte jamais les préférences", () => {
    const source = readFileSync(path.join(process.cwd(), "src/lib/alertes.ts"), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/notificationActive|canalActif|notifications\/preferences/);
  });

  /**
   * Depuis elles partent aussi sur le téléphone des administrateurs — **sous le même unique
   * interrupteur** (`alertesSecurite`, paramètres techniques), qui décide pour les deux canaux à la
   * fois. Un second interrupteur, par canal, est exactement ce qu'on ne veut pas ici.
   */
  it("prennent le téléphone sous le même interrupteur, pas sous un nouveau", () => {
    const source = readFileSync(path.join(process.cwd(), "src/lib/alertes.ts"), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).toMatch(/alerterAdminsParPush\(/);
    // La décision est prise une fois, en tête de l'envoi, avant l'email comme avant la notification.
    expect(code.match(/await alertesActivees\(\)/g)).toHaveLength(1);
    expect(code.indexOf("await alertesActivees()")).toBeLessThan(code.indexOf("alerterAdminsParPush("));
  });
});

describe("préférence individuelle (case du profil)", () => {
  const prefs = preferencesDefaut();

  it("prime sur le réglage global : rappels coupés, rien ne part à cette personne", () => {
    expect(notificationActiveDans(prefs, "recap_veille", "email")).toBe(true);
    expect(destinataireRetenu(prefs, "recap_veille", "email", { actif: true, rappelEmail: false })).toBe(false);
    expect(destinataireRetenu(prefs, "rappel_sans_reponse", "email", { actif: true, rappelEmail: false })).toBe(false);
  });

  it("laisse passer la personne qui a gardé ses rappels", () => {
    expect(destinataireRetenu(prefs, "recap_veille", "email", { actif: true, rappelEmail: true })).toBe(true);
  });

  it("ne coupe pas les messages qui ne sont pas des rappels (annulation, effectif)", () => {
    expect(destinataireRetenu(prefs, "seance_annulee", "email", { actif: true, rappelEmail: false })).toBe(true);
    expect(destinataireRetenu(prefs, "effectif_faible", "email", { actif: true, rappelEmail: false })).toBe(true);
  });

  it("ne retient jamais un compte désactivé", () => {
    expect(destinataireRetenu(prefs, "seance_annulee", "email", { actif: false, rappelEmail: true })).toBe(false);
  });

  it("ne sert à rien si le canal est coupé", () => {
    const coupe = lirePreferences(JSON.stringify({ canaux: { email: false } }));
    expect(destinataireRetenu(coupe, "recap_veille", "email", { actif: true, rappelEmail: true })).toBe(false);
  });
});

describe("canal WhatsApp (préparé, pas branché)", () => {
  it("se déclare non configuré tant que WHATSAPP_API_URL est absente", async () => {
    vi.stubEnv("WHATSAPP_API_URL", "");
    expect(whatsappConfigure()).toBe(false);
    await expect(envoyerWhatsApp({ texte: "Cours demain" })).rejects.toThrow(ERREUR_WHATSAPP_NON_CONFIGURE);
    expect(ERREUR_WHATSAPP_NON_CONFIGURE).toContain("Canal WhatsApp non configuré");
  });

  it("garde le partage manuel disponible (lien wa.me, texte encodé)", () => {
    expect(lienPartageWhatsApp("Cours demain 19h30 — Messer & dague")).toBe(
      "https://wa.me/?text=Cours%20demain%2019h30%20%E2%80%94%20Messer%20%26%20dague",
    );
  });
});

/**
 * **Les phrases du panneau n'écrivent aucun nombre de personnes.**
 *
 * `effectif_faible` annonçait « dans les 3 jours qui précèdent un cours comptant moins de **4**
 * présents » : le 4 du vieux réglage en nombre absolu, laissé en dur dans un texte livré alors que le
 * seuil se **calcule** depuis la part réglée par le club et l'effectif invité de la période
 * (`seuilEnPersonnes`). Le bureau d'un club de 80 réglait sa part sur l'écran Club, qui lui disait
 * « 20 % de 80 invités, soit **16** personnes — jamais moins de 4 », puis lisait deux onglets plus
 * loin « moins de **4** présents ».
 *
 * Et cette phrase n'est pas confinée à un écran d'expert : elle s'affiche sur `/admin/notifications`,
 * `/admin/notifications/email`, `/admin/notifications/push`, la fiche membre, **et le profil de chaque
 * instructeur** (`lignesNotificationsMembre`). C'est le seuil lu par le plus de monde dans
 * l'application — celui qui avait le plus de raisons d'être juste.
 *
 * Ces phrases étant des constantes (aucune base, aucun club sous la main), elles ne peuvent pas
 * afficher le nombre du club : elles disent donc la **règle**, et le nombre se lit là où il a un sens
 * — l'écran Club, et le pied de l'alerte, qui le calcule.
 */
describe("phrases du panneau : la règle, jamais un nombre de personnes", () => {
  it("dit la règle de l'alerte « peu de monde » sans recopier de seuil en personnes", () => {
    const quand = DESCRIPTIONS.effectif_faible.quand;
    // La règle, à la lettre : c'est bien la part réglée par le club qui décide.
    expect(quand).toContain("part minimale réglée par le club");
    // Et elle dit sur quoi elle porte — l'effectif attendu, pas les seuls confirmés (`palierEffectif`).
    expect(quand).toContain("effectif attendu");
    // Où lire le nombre, puisque cette phrase ne peut pas le connaître.
    expect(quand).toContain("écran Club");
    // Le plus important : plus aucun décompte de présents.
    expect(quand).not.toMatch(/\d+\s*présent/);
    expect(quand).not.toContain("moins de 4");
  });

  /**
   * La fenêtre, elle, est un nombre de **jours** : il ne dépend d'aucun réglage de club, mais il n'a
   * pas à être recopié à côté de sa constante. Le seul autre nombre toléré dans cette phrase est
   * l'heure du balayage du matin.
   */
  it("compose sa fenêtre depuis `HORIZON_ALERTE_EFFECTIF`, et ne porte aucun autre nombre", () => {
    const quand = DESCRIPTIONS.effectif_faible.quand;
    expect(quand).toContain(`${HORIZON_ALERTE_EFFECTIF} jours`);
    // 7 = l'heure du balayage du matin ; l'horizon = la fenêtre. Rien d'autre.
    expect([...quand.matchAll(/\d+/g)].map((m) => m[0])).toEqual(["7", String(HORIZON_ALERTE_EFFECTIF)]);
  });

  /**
   * Le balayage : ce qui est arrivé une fois à cette phrase-là peut arriver aux autres, et le défaut
   * ne se voit pas en relisant le code — il se voit sur l'écran d'un club qui n'est pas le nôtre.
   */
  it("ne laisse aucune phrase du panneau annoncer un nombre de présents", () => {
    const fautives = TYPES_NOTIFICATION.filter((type) => /\d+\s*présent/.test(DESCRIPTIONS[type].quand));
    expect(fautives).toEqual([]);
    const obligatoires = NOTIFICATIONS_TOUJOURS_ENVOYEES.filter((l) => /\d+\s*présent/.test(l.quand));
    expect(obligatoires).toEqual([]);
  });
});

/**
 * **Canal « Site du club » (`api`) : une exposition, pas un envoi**.
 *
 * Demande de Delta : « donne la possibilitée d'exposer les notifications concernant les cours aussi
 * via api (comme pour la selection discord telegram etc) pour publier les infos si besoins sur un
 * site ». C'est un canal de plus dans la matrice — mais le premier dont **rien ne part**.
 *
 * Ce que ces tests tiennent, chacun avec sa contre-épreuve :
 *
 * 1. **fermé par défaut** : aucune case cochée dans une base neuve ;
 * 2. **il ne s'envoie pas** : `destinataireRetenu` le refuse, et aucun module d'envoi ne le nomme ;
 * 3. **la colonne est étroite exprès** : trois notifications, et une raison écrite pour chaque absence.
 */
describe("canal « Site du club » (exposition, jamais un envoi)", () => {
  const lireSource = (fichier: string) =>
    readFileSync(path.join(process.cwd(), fichier), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");

  it("ne publie rien dans une base neuve : aucune case cochée", () => {
    const prefs = lirePreferences(null);
    for (const type of TYPES_NOTIFICATION) expect(notificationActiveDans(prefs, type, "api"), type).toBe(false);
    // Contre-épreuve : cocher une case suffit à l'allumer — le réglage existe bel et bien.
    const coche = lirePreferences(JSON.stringify({ notifications: { recap_veille: { api: true } } }));
    expect(notificationActiveDans(coche, "recap_veille", "api")).toBe(true);
    // Et l'interrupteur du canal continue de tout couper d'un coup, comme pour les autres.
    const canalCoupe = lirePreferences(JSON.stringify({ canaux: { api: false }, notifications: { recap_veille: { api: true } } }));
    expect(notificationActiveDans(canalCoupe, "recap_veille", "api")).toBe(false);
  });

  it("n'a de case que pour les trois annonces publiques, avec une raison écrite pour chaque absence", () => {
    expect(TYPES_NOTIFICATION.filter((t) => CANAUX_PAR_NOTIFICATION[t].includes("api"))).toEqual([
      "recap_veille",
      "seance_annulee",
      "evenement_nouveau",
    ]);
    // Contre-épreuve : l'alerte « peu de monde » n'en a pas, et la raison est affichable telle quelle.
    expect(CANAUX_PAR_NOTIFICATION.effectif_faible).not.toContain("api");
    expect(RAISON_API_EXCLUE.effectif_faible).toContain("alerte aux instructeurs");
    for (const type of TYPES_NOTIFICATION) {
      const aSaCase = CANAUX_PAR_NOTIFICATION[type].includes("api");
      expect(Boolean(RAISON_API_EXCLUE[type]), `${type} : une case OU une raison, jamais les deux ni aucune`).toBe(!aSaCase);
    }
  });

  it("est bien un canal d'exposition, et n'a donc aucun destinataire à retenir", () => {
    expect(estCanalExposition("api")).toBe(true);
    const prefs = lirePreferences(JSON.stringify({ notifications: { recap_veille: { api: true, discord: true } } }));
    const personne = { actif: true, email: "chloe@club.test", rappelEmail: true };
    // La case est cochée, la personne est active : et pourtant rien ne lui part par ce canal.
    expect(destinataireRetenu(prefs, "recap_veille", "api", personne)).toBe(false);
    // Contre-épreuve : sur un vrai canal, la même situation retient bien la personne.
    expect(estCanalExposition("discord")).toBe(false);
    expect(destinataireRetenu(prefs, "recap_veille", "discord", personne)).toBe(true);
  });

  /**
   * **Le garde-fou qui compte.** Tout le reste du dossier suppose qu'un canal s'envoie : file
   * d'attente, `journaliser`, `marquerEchec`, clés de déduplication. Le jour où quelqu'un branchera
   * « Site du club » dans une de ces boucles, il n'y aura aucune destination — et ce test le dira
   * avant que le récap du soir ne tombe en erreur.
   */
  it("n'est nommé par aucun module d'envoi", () => {
    /*
     * **Les deux seuls modules du dossier qui ont le droit de le nommer, et leur raison**. Le
     * balayage lisait une liste de neuf noms écrite à la main : il suffisait d'ajouter un module
     * pour sortir de son champ sans que rien ne le dise. Il lit maintenant le dossier entier, et ce
     * sont les **exceptions** qui se déclarent — avec leur raison, jamais comme une simple liste de
     * noms (doctrine de `CLAUDE.md`, reprise du balayage des gardes serveur).
     */
    const NOMME_LEGITIMEMENT: Record<string, string> = {
      "preferences.ts": "c'est là que le canal est déclaré, avec sa colonne et ses raisons d'exclusion",
      "canaux.ts": "c'est le module qui répond à « ce type est-il exposé ? » (`expositionPossible`), pour les trois écrans qui le demandent",
    };
    const modules = readdirSync(path.join(process.cwd(), "src/lib/notifications"))
      .filter((f) => f.endsWith(".ts") && !(f in NOMME_LEGITIMEMENT))
      .map((f) => `src/lib/notifications/${f}`)
      .sort();
    // Le dossier en compte une vingtaine : si le compte s'effondre, le balayage regarde à côté.
    expect(modules.length, "aucun module trouvé : le balayage regarde au mauvais endroit").toBeGreaterThanOrEqual(15);
    for (const fichier of modules) {
      const code = lireSource(fichier);
      expect(code, `${fichier} : un module d'envoi ne connaît pas le canal d'exposition`).not.toContain('"api"');
      expect(code, `${fichier} : l'exposition ne se décide pas dans un module d'envoi`).not.toContain("expositionPossible");
    }
    // Contre-épreuve : c'est bien la route publique qui s'en occupe, et elle seule.
    const route = lireSource("src/app/api/public/annonces/route.ts");
    expect(route).toContain("expositionPossible");
    expect(route).not.toMatch(/enqueueEmail\(|notifierParPush\(|journaliser\(|posterDiscord\(/);
  });
});
