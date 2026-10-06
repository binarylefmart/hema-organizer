import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ADRESSE_LISTE_MAX,
  CANAUX_PAR_NOTIFICATION,
  MODES_ENVOI,
  NOTIFICATIONS_TOUJOURS_ENVOYEES,
  RAISON_ROUTAGE_FIXE,
  TYPES_NOTIFICATION,
  TYPES_ROUTABLES,
  adresseListeValide,
  champMode,
  estRoutable,
  lirePreferences,
  modeEnvoiDans,
  normaliserPreferences,
  preferencesDefaut,
  serialiserPreferences,
  typesSansAdresseDeListe,
} from "@/lib/notifications/preferences";
import { CHEMINS_PERSONNELS, ERREUR_JETON_PERSONNEL, cheminSansJeton, jetonPersonnelDans, messageCollectif } from "@/lib/email/liste";
import { emailRecapVeille, emailRecapVeilleListe, emailRappelListe, emailRappelSansReponse } from "@/lib/email/templates/recap";
import { emailEffectifFaible, emailSeanceAnnulee, emailSeanceAnnuleeListe } from "@/lib/email/templates/seances";
import { emailInvitation, emailReset } from "@/lib/email/templates/auth";
import { estimerEnvois } from "@/lib/email/volume";
import { cleRecapEmail, cleRecapListe } from "@/lib/notifications/recap";
import { cleRappel, cleRappelListe } from "@/lib/notifications/rappels";

/**
 * **« Chacun le sien » ou « la liste »** — le réglage qui divise par N le nombre d'emails d'un club
 * de 80 membres, et la garde qui empêche qu'un message personnel emprunte ce chemin.
 *
 * Tout est pur ici : aucune base, aucun envoi. Les envois complets restent dans
 * `notifications-envois.test.ts`.
 */

const SEANCE = {
  date: "2026-09-24",
  heureDebut: "19:30",
  heureFin: "21:30",
  lieu: "Gymnase municipal",
  theme: "Messer — garde haute",
  alternative: "",
  disciplines: "Messer",
};
const CHIFFRES = { invites: 18, presents: 13, absents: 1, peutEtre: 3, enAttente: 1, pourcentage: 72 };

const source = (f: string) => readFileSync(path.join(process.cwd(), f), "utf8");

/** Un contenu d'email réduit à une seule URL : de quoi éprouver la garde, et rien d'autre. */
const contenuAvec = (url: string) => ({ titre: "Peu importe", paragraphes: [`Un lien : ${url}`] });

/* ------------------------------------------------------------------ */
/* 1. Un message personnel ne peut JAMAIS emprunter la liste           */
/* ------------------------------------------------------------------ */

describe("garde : les messages d'accès et de sécurité ne sont pas routables", () => {
  it("n'ont aucun type dans la matrice : il n'y a rien à régler pour eux", () => {
    // Ils ne sont décrits que comme du texte en lecture seule (`NOTIFICATIONS_TOUJOURS_ENVOYEES`) :
    // s'ils entraient un jour dans TYPES_NOTIFICATION, ils deviendraient réglables — donc routables.
    expect(NOTIFICATIONS_TOUJOURS_ENVOYEES.length).toBeGreaterThan(0);
    for (const interdit of ["lien_personnel", "lien_renouvele", "reinitialisation", "mot_de_passe_oublie", "alerte_securite", "nouvel_appareil"]) {
      expect(TYPES_NOTIFICATION as readonly string[]).not.toContain(interdit);
    }
  });

  it("ne laisse routables que les quatre notifications d'information décidées", () => {
    expect([...TYPES_ROUTABLES].sort()).toEqual(["evenement_nouveau", "rappel_sans_reponse", "recap_veille", "seance_annulee"]);
    for (const type of TYPES_ROUTABLES) expect(TYPES_NOTIFICATION as readonly string[]).toContain(type);
    // Toute notification routable doit d'abord savoir partir par email.
    for (const type of TYPES_ROUTABLES) expect(CANAUX_PAR_NOTIFICATION[type]).toContain("email");
  });

  /**
   * **L'alerte « peu de monde » ne peut pas passer par la liste du club.** Il n'existe qu'une seule
   * adresse de liste : réglée sur « la liste », l'alerte serait partie sur l'adresse générale — en
   * annonçant à tout le club que le cours se remplit mal, et en signant « envoyé à la liste
   * d'encadrement ». C'est précisément pour cette raison que sa case Discord est décochée par
   * défaut ; un menu déroulant ne doit pas pouvoir défaire ce choix.
   *
   * Le gain était nul : l'alerte vise deux ou trois instructeurs, pas quatre-vingts membres.
   */
  it("ne laisse pas l'alerte « peu de monde » emprunter la liste du club", () => {
    expect(estRoutable("effectif_faible")).toBe(false);
    expect(RAISON_ROUTAGE_FIXE.effectif_faible).toMatch(/encadrement|deux ou trois|publi/i);
    const prefs = lirePreferences(JSON.stringify({ adresseListe: "cours@club.fr", modes: { effectif_faible: "liste" } }));
    expect(modeEnvoiDans(prefs, "effectif_faible")).toBe("individuel");
  });

  it("dit dans le code pourquoi les autres ne le sont pas", () => {
    for (const type of TYPES_NOTIFICATION) {
      if (estRoutable(type)) continue;
      expect(RAISON_ROUTAGE_FIXE[type], `raison manquante pour ${type}`).toBeTruthy();
    }
  });

  it("refuse le mode « liste » sur un type non routable, même si la base le prétend", () => {
    const brut = JSON.stringify({
      adresseListe: "cours@club.fr",
      modes: { atelier_statut: "liste", periode_suivante: "liste", periode_non_activee: "liste", recap_veille: "liste" },
    });
    const prefs = lirePreferences(brut);
    expect(modeEnvoiDans(prefs, "atelier_statut")).toBe("individuel");
    expect(modeEnvoiDans(prefs, "periode_suivante")).toBe("individuel");
    expect(modeEnvoiDans(prefs, "periode_non_activee")).toBe("individuel");
    expect(modeEnvoiDans(prefs, "recap_veille")).toBe("liste");
    // Et ce qui est réécrit en base ne garde pas la trace du mode interdit.
    const ecrit = JSON.parse(serialiserPreferences(prefs)) as { modes: Record<string, string> };
    expect(ecrit.modes.atelier_statut).toBe("individuel");
  });
});

describe("garde : un gabarit portant un jeton personnel ne peut pas être marqué collectif", () => {
  const personnels = [
    ["invitation (lien d'accès)", emailInvitation({ prenom: "Alix", periodeNom: "T4 2026", url: "https://club.fr/invitation/JETON", nomApp: "HEMA" })],
    ["réinitialisation du mot de passe", emailReset({ prenom: "Alix", url: "https://club.fr/reinitialiser/JETON", nomApp: "HEMA" })],
    [
      "récap individuel (lien de désinscription)",
      emailRecapVeille({
        prenom: "Alix",
        seance: SEANCE,
        chiffres: CHIFFRES,
        statut: "PRESENT",
        urlPresent: "https://club.fr/seances?seance=1&reponse=present",
        urlAbsent: "https://club.fr/seances?seance=1&reponse=absent",
        urlDesinscription: "https://club.fr/desinscription/JETON",
      }),
    ],
    [
      "rappel individuel (lien de désinscription)",
      emailRappelSansReponse({ prenom: "Alix", seance: SEANCE, chiffres: CHIFFRES, jours: 7, urlApp: "https://club.fr/seances", urlDesinscription: "https://club.fr/desinscription/JETON" }),
    ],
    [
      "effectif faible (lien d'annulation signé)",
      emailEffectifFaible({ prenom: "Alix", seance: SEANCE, presents: 2, invites: 18, sansReponse: 9, urlAnnulation: "https://club.fr/annuler/JETON" }),
    ],
  ] as const;

  it.each(personnels)("%s : refusé", (_nom, message) => {
    expect(jetonPersonnelDans(message.contenu)).not.toBeNull();
    expect(() => messageCollectif(message)).toThrowError(ERREUR_JETON_PERSONNEL);
  });

  it("laisse passer un message qui ne porte que des liens publics", () => {
    const collectif = emailRecapVeilleListe({ seance: SEANCE, chiffres: CHIFFRES, nomApp: "HEMA" });
    expect(jetonPersonnelDans(collectif.contenu)).toBeNull();
    expect(messageCollectif(collectif).sujet).toBe(collectif.sujet);
  });

  /**
   * **Le message du refus ne recopie pas le lien**. Les quatre appelants de `messageCollectif` sont
   * des tâches planifiées, toutes sous un `catch` qui fait `console.error` : le jour où cette garde
   * se déclenche — c'est-à-dire le jour où un gabarit collectif gagne un lien porteur de jeton,
   * exactement le cas pour lequel elle existe —, l'URL personnelle **complète** partait dans le
   * journal du conteneur, lisible dans Portainer. Or ce jeton vaut quatre mois d'accès direct :
   * c'est ce que `docs/SECURITE.md` interdit au journal de NPM (`access_log off` sur
   * `/invitation/`). Le **chemin** suffit à dire quel gabarit corriger.
   */
  it.each(personnels)("%s : le refus nomme le chemin, jamais le jeton", (_nom, message) => {
    let leve: Error | null = null;
    try {
      messageCollectif(message);
    } catch (e) {
      leve = e as Error;
    }
    expect(leve).not.toBeNull();
    const dit = leve!.message;
    expect(dit).toContain(ERREUR_JETON_PERSONNEL);
    expect(dit).not.toContain("JETON");
    expect(dit).not.toContain("https://");
    // Ce qui reste : le segment qui nomme le gabarit fautif.
    expect(dit).toMatch(/chemin en cause : \/(invitation|desinscription|annuler|reinitialiser)\/…/);
  });

  it("cheminSansJeton retire le dernier segment, même d'une URL que le navigateur refuse", () => {
    expect(cheminSansJeton("https://club.fr/invitation/AbCdEf?x=1#y")).toBe("/invitation/…");
    expect(cheminSansJeton("club.fr/desinscription/AbCdEf.")).toBe("club.fr/desinscription/…");
    expect(cheminSansJeton("AbCdEf")).toBe("…");
  });
});

/* ------------------------------------------------------------------ */
/* 2. Ce que « la liste » change au contenu                            */
/* ------------------------------------------------------------------ */

describe("contenus collectifs", () => {
  it("le récap perd le prénom, la réponse personnelle, les boutons et la désinscription", () => {
    const { contenu } = emailRecapVeilleListe({ seance: SEANCE, chiffres: CHIFFRES, nomApp: "HEMA" });
    const texte = [contenu.titre, ...contenu.paragraphes, ...(contenu.piedDePage ?? [])].join("\n");
    expect(texte).not.toMatch(/Tu es inscrit/);
    expect(texte).not.toMatch(/Bonjour /);
    expect(texte).not.toMatch(/désinscri/i);
    expect(contenu.boutons?.map((b) => b.label)).not.toContain("Je viens");
    expect(contenu.boutons?.map((b) => b.label)).not.toContain("Je ne viens plus");
    // Le contenu commun de la séance reste : c'est tout l'intérêt du message.
    expect(texte).toMatch(/Gymnase municipal/);
  });

  it("le rappel bascule en compteur, sans nommer personne", () => {
    const { sujet, contenu } = emailRappelListe({ seance: SEANCE, chiffres: CHIFFRES, jours: 2, sansReponse: 12, nomApp: "HEMA" });
    const texte = [sujet, contenu.titre, ...contenu.paragraphes].join("\n");
    expect(texte).toMatch(/12 personnes n'ont pas encore répondu/);
    expect(texte).not.toMatch(/tu n'as pas/i);
    expect(texte).not.toMatch(/Bonjour /);
    expect(jetonPersonnelDans(contenu)).toBeNull();
  });

  it("le rappel collectif accorde le singulier", () => {
    const { contenu } = emailRappelListe({ seance: SEANCE, chiffres: CHIFFRES, jours: 7, sansReponse: 1, nomApp: "HEMA" });
    expect(contenu.paragraphes.join("\n")).toMatch(/1 personne n'a pas encore répondu/);
  });

  it("l'annulation collective ne nomme personne et garde le motif", () => {
    const { contenu } = emailSeanceAnnuleeListe({ seance: SEANCE, motif: "salle indisponible", nomApp: "HEMA" });
    expect(contenu.titre).not.toMatch(/Bonjour /);
    expect(contenu.paragraphes.join("\n")).toMatch(/salle indisponible/);
    expect(jetonPersonnelDans(contenu)).toBeNull();
    // Le message personnel, lui, continue de dire bonjour.
    expect(emailSeanceAnnulee({ prenom: "Alix", seance: SEANCE, motif: "salle indisponible", nomApp: "HEMA" }).contenu.titre).toMatch(/Alix/);
  });

  it("l'alerte « peu de monde » n'a plus de gabarit collectif du tout", () => {
    // Le chemin collectif a été retiré avec le routage : laisser le gabarit, ce serait laisser
    // la moitié d'une porte que quelqu'un finirait par rouvrir.
    expect(source("src/lib/email/templates/seances.ts")).not.toContain("emailEffectifFaibleListe");
    expect(source("src/lib/notifications/seances.ts")).not.toContain("alerterListeParEmail");
    // Le gabarit personnel, lui, garde son lien d'annulation signé : c'est tout son intérêt.
    const perso = emailEffectifFaible({ prenom: "Alix", seance: SEANCE, presents: 2, invites: 18, sansReponse: 9, urlAnnulation: "https://club.fr/annuler/JETON" });
    expect(jetonPersonnelDans(perso.contenu)).not.toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* 3. Le réglage : adresse, refus à l'enregistrement                   */
/* ------------------------------------------------------------------ */

describe("réglage de l'adresse de liste", () => {
  it("part vide, et tout est en « chacun le sien » à l'installation", () => {
    const defaut = preferencesDefaut();
    expect(defaut.adresseListe).toBe("");
    expect(defaut.quotaJour).toBeNull();
    for (const type of TYPES_NOTIFICATION) expect(defaut.modes[type]).toBe("individuel");
  });

  it("vérifie l'adresse comme une adresse", () => {
    for (const bonne of ["cours@club.fr", "liste-membres@club.test"]) expect(adresseListeValide(bonne)).toBe(true);
    for (const mauvaise of ["", "  ", "pas une adresse", "a@b", "deux@adresses.fr, trois@adresses.fr", `${"a".repeat(ADRESSE_LISTE_MAX)}@club.fr`]) {
      expect(adresseListeValide(mauvaise), mauvaise).toBe(false);
    }
  });

  it("nomme les notifications réglées sur « la liste » sans adresse : elles sont refusées, pas ignorées", () => {
    const prefs = normaliserPreferences({ ...preferencesDefaut(), adresseListe: "", modes: { ...preferencesDefaut().modes, recap_veille: "liste", seance_annulee: "liste" } });
    expect(typesSansAdresseDeListe(prefs).sort()).toEqual(["recap_veille", "seance_annulee"]);
    const avecAdresse = { ...prefs, adresseListe: "cours@club.fr" };
    expect(typesSansAdresseDeListe(avecAdresse)).toEqual([]);
  });

  it("ne route jamais vers une adresse vide : sans adresse, on retombe sur « chacun le sien »", () => {
    const prefs = lirePreferences(JSON.stringify({ modes: { recap_veille: "liste" } }));
    expect(prefs.modes.recap_veille).toBe("liste"); // le choix est conservé…
    expect(modeEnvoiDans(prefs, "recap_veille")).toBe("individuel"); // … mais rien ne part vers ""
  });

  it("relit sans jamais lever ce qui est abîmé", () => {
    for (const brut of ["{}", '{"modes":42}', '{"modes":{"recap_veille":"pigeon"}}', '{"adresseListe":123}', '{"quotaJour":"beaucoup"}']) {
      const prefs = lirePreferences(brut);
      expect(MODES_ENVOI).toContain(prefs.modes.recap_veille);
      expect(typeof prefs.adresseListe).toBe("string");
    }
    expect(lirePreferences('{"quotaJour":-5}').quotaJour).toBeNull();
    expect(lirePreferences('{"quotaJour":300}').quotaJour).toBe(300);
  });

  it("donne un nom de champ distinct par notification", () => {
    const noms = new Set(TYPES_NOTIFICATION.map(champMode));
    expect(noms.size).toBe(TYPES_NOTIFICATION.length);
  });
});

/* ------------------------------------------------------------------ */
/* 4. Le volume annoncé                                                */
/* ------------------------------------------------------------------ */

describe("volume d'envois annoncé", () => {
  const base = { membresAvecEmail: 42, coursParSemaine: 2, instructeurs: 3 };

  it("annonce « 42 membres × 2 cours par semaine » en mode individuel", () => {
    const e = estimerEnvois({ ...base, prefs: preferencesDefaut() });
    expect(e.membresAvecEmail).toBe(42);
    expect(e.coursParSemaine).toBe(2);
    expect(e.recapParSoirDeCours).toBe(42);
    // Récap (42 × 2) + deux jalons de rappel (42 × 2 × 2) = 252 envois par semaine.
    expect(e.parSemaine).toBe(252);
  });

  /**
   * **L'écran affichait une équation fausse** : « 42 membres × 2 cours par semaine = 252 envois ».
   * 42 × 2 font 84 ; 252, c'est le total régulier, récap **et** les deux vagues de rappel. Un
   * chiffre qu'on ne peut pas refaire de tête est un chiffre qu'on cesse de croire.
   */
  it("expose séparément le produit du récap et le total régulier", () => {
    const e = estimerEnvois({ ...base, prefs: preferencesDefaut() });
    expect(e.recapParSemaine).toBe(e.recapParSoirDeCours * e.coursParSemaine);
    expect(e.recapParSemaine).toBe(84);
    expect(e.parSemaine).toBe(252);
  });

  it("l'équation reste vraie en mode liste", () => {
    const prefs = { ...preferencesDefaut(), adresseListe: "cours@club.fr" };
    for (const type of TYPES_ROUTABLES) prefs.modes[type] = "liste";
    const e = estimerEnvois({ ...base, prefs });
    expect(e.recapParSemaine).toBe(e.recapParSoirDeCours * e.coursParSemaine);
    expect(e.recapParSemaine).toBe(2);
  });

  it("l'écran multiplie ce qu'il affiche, et n'annonce plus un total au bout d'un produit", () => {
    const code = source("src/app/(app)/admin/notifications/email/page.tsx");
    expect(code).toContain("recapParSoirDeCours");
    expect(code).toContain("recapParSemaine");
    // Le membre × cours = total régulier d'avant : le produit ne doit plus sortir sur `parSemaine`.
    expect(code).not.toMatch(/membresAvecEmail[^]{0,400}coursParSemaine[^]{0,120}=[^]{0,120}volume\.parSemaine/);
  });

  it("tombe à un message par cours quand tout passe par la liste", () => {
    const prefs = { ...preferencesDefaut(), adresseListe: "cours@club.fr" };
    for (const type of TYPES_ROUTABLES) prefs.modes[type] = "liste";
    const e = estimerEnvois({ ...base, prefs });
    expect(e.recapParSoirDeCours).toBe(1);
    expect(e.parSemaine).toBe(6); // 2 cours × (1 récap + 2 rappels)
  });

  it("alerte quand le pire jour dépasse le quota déclaré, et se tait sinon", () => {
    const prefs = { ...preferencesDefaut(), quotaJour: 100 };
    const e = estimerEnvois({ ...base, prefs });
    expect(e.quotaJour).toBe(100);
    expect(e.pireJour).toBeGreaterThan(100); // 42 (récap) + 42 + 42 (les deux jalons le même jour)
    expect(e.depasseQuota).toBe(true);
    const sansQuota = estimerEnvois({ ...base, prefs: preferencesDefaut() });
    expect(sansQuota.depasseQuota).toBe(false); // quota non déclaré : on ne crie pas
  });

  it("détaille ligne par ligne ce que coûte chaque notification", () => {
    const e = estimerEnvois({ ...base, prefs: preferencesDefaut() });
    const recap = e.lignes.find((l) => l.type === "recap_veille");
    expect(recap?.mode).toBe("individuel");
    expect(recap?.parEnvoi).toBe(42);
    /*
     * L'écran chiffre ce qui **part par email**, pas ce qui est routable : l'alerte « peu de monde »
     * n'a plus de mode d'envoi, mais elle coûte toujours un email par instructeur, et un bureau qui
     * compare son volume à son quota a besoin de la voir. Toute notification routable, en revanche,
     * doit avoir sa ligne — sans quoi une bascule vers la liste ne se verrait nulle part.
     */
    expect(e.lignes.map((l) => l.type)).toEqual(["recap_veille", "rappel_sans_reponse", "seance_annulee", "effectif_faible", "desistement_tardif", "evenement_nouveau"]);
    for (const type of TYPES_ROUTABLES) expect(e.lignes.map((l) => l.type)).toContain(type);
    expect(e.lignes.find((l) => l.type === "effectif_faible")?.mode).toBe("individuel");
    expect(e.lignes.find((l) => l.type === "effectif_faible")?.parEnvoi).toBe(3);
  });
});

/* ------------------------------------------------------------------ */
/* 5. Déduplication : une ligne de journal, pas N                      */
/* ------------------------------------------------------------------ */

describe("clés de déduplication d'un envoi collectif", () => {
  const s = { id: "sess1", seance: { date: "2026-09-24", heureDebut: "19:30" } };

  it("n'ont pas d'identifiant de personne : une ligne pour toute la notification", () => {
    const cle = cleRecapListe(s);
    expect(cle).not.toMatch(/user1/);
    expect(cle).toContain("liste");
    expect(cle).toContain("sess1");
  });

  it("vivent dans un espace de clés distinct de l'envoi individuel", () => {
    // Bascule « chacun le sien » → « la liste » entre deux passages : les 42 clés individuelles
    // déjà posées ne doivent pas faire taire le message collectif, et réciproquement.
    expect(cleRecapListe(s)).not.toBe(cleRecapEmail(s, "user1"));
    expect(cleRappelListe(s, 7)).not.toBe(cleRappel(s, "user1", 7));
    expect(cleRappelListe(s, 7)).not.toBe(cleRappelListe(s, 2));
  });

  it("portent le créneau, comme les clés individuelles : un cours déplacé est réannoncé", () => {
    const deplace = { id: "sess1", seance: { date: "2026-09-25", heureDebut: "19:30" } };
    expect(cleRecapListe(deplace)).not.toBe(cleRecapListe(s));
  });
});

/* ------------------------------------------------------------------ */
/* 6. La garde compare sur le chemin, et balaie la requête             */
/* ------------------------------------------------------------------ */

/**
 * **Une garde qui ne peut pas correspondre n'est pas une garde.** Deux chemins portaient une barre
 * finale alors que leurs routes n'ont pas de segment de jeton (`/nouveau-mot-de-passe/`,
 * `/mot-de-passe-oublie/`) : ils rassuraient sans rien couvrir.
 *
 * Surtout, la convention « barre finale » supposait que le jeton soit toujours un segment de
 * chemin. Le jour où l'un d'eux passe en paramètre de requête — `/desinscription?token=…` —, la
 * comparaison sur la chaîne entière ne voit plus rien, et le lien part au club.
 */
describe("garde : le chemin analysé, et la chaîne de requête", () => {
  it("ne garde que des chemins qui correspondent à une route à segment de jeton", () => {
    expect([...CHEMINS_PERSONNELS].sort()).toEqual(["/annuler/", "/desinscription/", "/invitation/", "/reinitialiser/"]);
    for (const chemin of CHEMINS_PERSONNELS) {
      expect(existsSync(path.join(process.cwd(), "src/app/(public)", chemin, "[token]")), chemin).toBe(true);
    }
  });

  it("attrape un jeton passé en paramètre de requête, sur la route personnelle comme ailleurs", () => {
    expect(jetonPersonnelDans(contenuAvec("https://club.fr/desinscription?token=JETON"))).not.toBeNull();
    expect(jetonPersonnelDans(contenuAvec("https://club.fr/seances?token=JETON"))).not.toBeNull();
    expect(jetonPersonnelDans(contenuAvec("https://club.fr/seances?jeton=JETON"))).not.toBeNull();
  });

  it("attrape toujours le jeton posé en segment de chemin", () => {
    for (const url of ["https://club.fr/invitation/ABC", "https://club.fr/desinscription/ABC", "https://club.fr/annuler/ABC", "https://club.fr/reinitialiser/ABC"]) {
      expect(jetonPersonnelDans(contenuAvec(url)), url).not.toBeNull();
    }
  });

  it("laisse passer les liens publics des gabarits collectifs", () => {
    for (const url of [
      "https://club.fr/seances",
      "https://club.fr/planning",
      "https://club.fr/seances/abc",
      "https://club.fr/seances?seance=abc&reponse=present",
      "https://club.fr/desinscriptions-du-club",
    ]) {
      expect(jetonPersonnelDans(contenuAvec(url)), url).toBeNull();
    }
  });
});

/* ------------------------------------------------------------------ */
/* 7. La clé de journal se pose APRÈS que le message existe            */
/* ------------------------------------------------------------------ */

/**
 * **`messageCollectif` lève — c'est tout son intérêt.** Poser la clé de déduplication avant de
 * fabriquer le message rendait cette levée fatale : l'exception remonte, et au passage suivant
 * `journaliser` rend `false` (clé prise) et l'on repart sans rien envoyer. La notification est
 * éteinte pour toujours, en silence.
 *
 * L'ordre est donc : fabriquer le message, **puis** poser la clé. La garde redevient ce qu'elle
 * prétend être — un échec bruyant et rejouable.
 */
describe("l'ordre des envois collectifs : le message d'abord, la clé ensuite", () => {
  const SITES: Array<[string, string]> = [
    ["src/lib/notifications/recap.ts", "envoyerRecapListe"],
    ["src/lib/notifications/rappels.ts", "envoyerRappelListe"],
    ["src/lib/notifications/evenements.ts", "annoncerSurListe"],
    ["src/lib/notifications/seances.ts", "notifierAnnulation"],
  ];

  /** Le corps d'une fonction : de sa signature jusqu'à l'accolade fermante en colonne zéro. */
  function corps(fichier: string, nom: string): string {
    const code = source(fichier);
    const debut = code.indexOf(`function ${nom}(`);
    expect(debut, `${nom} introuvable dans ${fichier}`).toBeGreaterThan(-1);
    const fin = code.indexOf("\n}\n", debut);
    return code.slice(debut, fin === -1 ? undefined : fin);
  }

  it.each(SITES)("%s : %s fabrique le message avant de poser la clé", (fichier, nom) => {
    const code = corps(fichier, nom);
    const message = code.indexOf("messageCollectif(");
    const clef = code.indexOf("journaliser(");
    expect(message, "messageCollectif attendu").toBeGreaterThan(-1);
    expect(clef, "journaliser attendu").toBeGreaterThan(-1);
    expect(message).toBeLessThan(clef);
  });
});
