import { describe, expect, it } from "vitest";
import { emailEffectifFaible, emailSeanceAnnulee, piedAlerteEffectif } from "@/lib/email/templates/seances";
import { chargeEffectifFaiblePush, lireJetonAnnulation, PART_EFFECTIF_LIVREE, urlAnnulation } from "@/lib/notifications/seances";
import { SEUIL_PLANCHER, seuilEnPersonnes } from "@/lib/presences";
import { signPayload } from "@/lib/auth/tokens";

const SEANCE = { date: "2026-09-25", heureDebut: "19:00", heureFin: "21:00", lieu: "Gymnase municipal, Villebourg" };

describe("alerte d'effectif faible", () => {
  it("se déclenche en dessous de la part de l'effectif réglée par le club — 20 % à l'installation", () => {
    // Ce n'est qu'une valeur de départ : la part qui décide vraiment de l'alerte est réglée dans
    // l'espace admin (`Identite.partEffectifMin`) et lue à chaque passage d'`alerterEffectifFaible`,
    // qui la convertit en personnes sur l'effectif invité de la période de chaque séance.
    expect(PART_EFFECTIF_LIVREE).toBe(20);
  });
  it("annonce le nombre de présents, d'invités et de sans-réponse", () => {
    const { sujet, contenu } = emailEffectifFaible({ prenom: "Charlie", seance: SEANCE, presents: 2, invites: 12, sansReponse: 5, urlAnnulation: "https://x.fr/annuler/abc" });
    expect(sujet).toContain("2 présents");
    expect(contenu.paragraphes[0]).toContain("2 personnes ont répondu");
    expect(contenu.paragraphes[1]).toBe("12 invités au total, dont 5 sans réponse.");
    expect(contenu.boutons?.[0]).toEqual({ label: "Annuler cette séance", url: "https://x.fr/annuler/abc", couleur: "rouge" });
  });
  it("tourne la phrase au singulier quand personne n'a répondu", () => {
    const { contenu } = emailEffectifFaible({ prenom: "Charlie", seance: SEANCE, presents: 0, invites: 12, sansReponse: 12, urlAnnulation: "https://x.fr/a" });
    expect(contenu.paragraphes[0]).toContain("personne n'a répondu");
  });
});

/**
 * **Le plafond annoncé et son équivalent technique, reliés par un test** — l'exigence de `CLAUDE.md`
 * appliquée au pied de cette alerte.
 *
 * Il annonçait « moins de 4 présents » : le 4 du vieux réglage en nombre absolu, resté écrit en dur
 * dans un texte livré. Un club de 80 invités réglé à 20 % lit sur l'écran Club « 20 % de 80 invités,
 * soit **16** personnes », puis recevait « ⚠️ Peu de monde — 15 présents » avec, juste sous le bouton
 * « Annuler cette séance », une phrase disant que l'alerte part sous 4 : **l'email se contredisait
 * lui-même**, sur le message qui sert à décider d'ouvrir la salle.
 *
 * Ce qui est relié ici, ce n'est pas une valeur mais un **calcul** : le nombre du pied doit être celui
 * que `seuilEnPersonnes` rend pour la part réglée et l'effectif invité de cette séance-là — le calcul
 * même qui a décidé de l'envoi.
 */
describe("pied de l'alerte d'effectif : le seuil se calcule, il ne se recopie pas", () => {
  it("annonce exactement le seuil de `seuilEnPersonnes`, jamais un nombre en dur", () => {
    // Le club de 80 réglé à 20 % : 16 personnes, et surtout pas les 4 du plancher.
    expect(seuilEnPersonnes(20, 80)).toBe(16);
    const pied = piedAlerteEffectif(80, 20);
    expect(pied).toContain(`sous ${seuilEnPersonnes(20, 80)} personnes`);
    expect(pied).not.toContain(`sous ${SEUIL_PLANCHER} personnes`);
  });

  it("suit la part quand le bureau la change, et l'effectif quand le club grandit", () => {
    // Même club, part doublée : le pied doit suivre sans qu'une ligne du gabarit ne change.
    expect(piedAlerteEffectif(80, 40)).toContain(`sous ${seuilEnPersonnes(40, 80)} personnes`);
    // Petit club : c'est le plancher livré qui commande, et le pied dit ce plancher-là.
    expect(piedAlerteEffectif(12, 20)).toContain(`sous ${SEUIL_PLANCHER} personnes`);
  });

  it("énonce la règle sans chiffre quand aucune part n'est connue (aperçus, envois de test)", () => {
    // Un aperçu ou un email de test n'a pas de club en base : inventer un nombre serait pire que
    // n'en donner aucun — c'est le nombre inventé qui a fait tout le dégât.
    const pied = piedAlerteEffectif(80);
    expect(pied).toContain("la part minimale d'effectif réglée par le club");
    expect(pied).not.toMatch(/\d/);
  });

  it("parle bien de l'effectif attendu, comme le palier qui décide de l'envoi", () => {
    // Le pied ne doit pas promettre un décompte de confirmés là où `palierEffectif` juge les
    // confirmés plus la moitié des « peut-être » : c'était l'autre moitié de la même contradiction.
    expect(piedAlerteEffectif(80, 20)).toContain("l'effectif attendu");
  });
});

/**
 * Le même message sur l'appareil. Ce qui se vérifie ici tient au support : deux lignes sur un écran
 * verrouillé, et **jamais le lien d'annulation signé** — il vaut signature, il reste dans l'email.
 */
describe("alerte d'effectif faible sur le téléphone", () => {
  const SEANCE_CREUSE = { id: "s2", date: "2026-09-25", heureDebut: "19:00", period: { membres: [{ userId: "u1" }, { userId: "u2" }, { userId: "u3" }] } };

  it("dit le chiffre qui inquiète et mène à la fiche de la séance", () => {
    const charge = chargeEffectifFaiblePush(SEANCE_CREUSE, 2);
    expect(charge.titre).toBe("Peu de monde au prochain cours");
    expect(charge.corps).toBe("Vendredi 25 sept. à 19h00 : 2 présents sur 3 invités.");
    expect(charge.url).toBe("/seances/s2");
    // Un seul rappel par séance à l'écran : la nouvelle alerte remplace la précédente.
    expect(charge.tag).toBe("effectif-s2");
  });

  it("accorde le singulier, et ne porte jamais le lien d'annulation", () => {
    const charge = chargeEffectifFaiblePush(SEANCE_CREUSE, 1);
    expect(charge.corps).toContain("1 présent sur");
    expect(JSON.stringify(charge)).not.toContain("/annuler/");
  });
});

describe("email d'annulation", () => {
  it("donne la date, le lieu et le motif", () => {
    const { sujet, contenu } = emailSeanceAnnulee({ prenom: "Juliett", seance: SEANCE, motif: "Trop peu de participants", nomApp: "Compagnons Organizer" });
    expect(sujet).toContain("Cours annulé");
    expect(contenu.paragraphes[0]).toContain("Vendredi 25 septembre 2026 à 19h00 (Gymnase municipal, Villebourg)");
    expect(contenu.paragraphes[1]).toBe("Motif : Trop peu de participants");
    // Le nom de l'application est celui du club qui a installé l'outil, pas une constante du code.
    expect(contenu.piedDePage).toEqual(["Message automatique de Compagnons Organizer."]);
  });
});

describe("lien d'annulation signé", () => {
  it("porte la séance **et** le destinataire, et refuse un jeton trafiqué", () => {
    const url = urlAnnulation("session-123", "u-charlie");
    const jeton = url.split("/annuler/")[1];
    expect(lireJetonAnnulation(jeton)).toEqual({ sessionId: "session-123", userId: "u-charlie" });
    expect(lireJetonAnnulation(`${jeton}x`)).toBeNull();
    expect(lireJetonAnnulation("n'importe.quoi")).toBeNull();
  });

  // Les liens d' n'avaient pas de porteur : anonymes, ils ne sont plus acceptés
  it("refuse un jeton sans compte destinataire", () => {
    const ancien = signPayload({ sid: "session-123", exp: Date.now() + 60_000 }, process.env.SESSION_SECRET!, "annulation-seance");
    expect(lireJetonAnnulation(ancien)).toBeNull();
  });
});
