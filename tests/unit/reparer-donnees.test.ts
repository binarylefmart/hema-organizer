/**
 * Logique de détection du script de réparation (`scripts/reparer-donnees.ts`).
 *
 * **Aucune base n'est ouverte ici, et c'est délibéré** : les fonctions éprouvées sont pures (elles
 * reçoivent des tableaux), et le module ne charge Prisma qu'au moment de s'exécuter en ligne de
 * commande. Un test de détection ne doit pas pouvoir toucher `data/hema.db` ne serait-ce que par
 * accident — c'est la base réelle du club.
 *
 * Ce qui est éprouvé, ce sont les deux risques du script : **rater une ligne fausse** (le contrôle
 * ne sert alors à rien) et surtout **en désigner une saine** (il détruirait de la donnée valable).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const RACINE = process.cwd();
import {
  ArgumentInvalide,
  CONTROLES,
  cleHorodatee,
  cleInvite,
  detecterAteliersOrphelins,
  detecterClesSansCreneau,
  detecterLiensConcurrents,
  detecterNotificationsEnDouble,
  detecterPartiesDetachees,
  detecterPartiesSurnumeraires,
  detecterRangsIncoherents,
  decrirePartieEnTrop,
  detecterReponsesFantomes,
  decrireRang,
  jourLocal,
  lireArguments,
  normaliserCleDeduplication,
  type LigneInvitation,
  type LigneNotification,
  type LignePartieComplete,
  type LignePartieRang,
  type LigneReponse,
} from "../../scripts/reparer-donnees";

const reponse = (p: Partial<LigneReponse> = {}): LigneReponse => ({
  userId: "u1",
  prenom: "Chloé",
  sessionId: "s1",
  date: "2026-09-24",
  lieu: "Villebourg",
  statut: "PRESENT",
  periodId: "p1",
  ...p,
});

describe("1. réponses de membres qui ne sont plus invités", () => {
  it("désigne la réponse d'un membre retiré de la période", () => {
    const fantomes = detecterReponsesFantomes(
      [reponse({ userId: "retire" }), reponse({ userId: "invite" })],
      new Set([cleInvite("p1", "invite")]),
    );
    expect(fantomes.map((r) => r.userId)).toEqual(["retire"]);
  });

  it("ne touche à rien quand tout le monde est invité", () => {
    const invites = new Set([cleInvite("p1", "u1"), cleInvite("p1", "u2")]);
    expect(detecterReponsesFantomes([reponse(), reponse({ userId: "u2" })], invites)).toEqual([]);
  });

  it("l'invitation vaut pour UNE période : la même personne ailleurs ne sauve pas la réponse", () => {
    // Le piège du contrôle : `PeriodMember` est un couple, pas une liste de personnes. Quelqu'un
    // d'invité sur le trimestre suivant n'est pas invité sur celui de la séance.
    const fantomes = detecterReponsesFantomes([reponse({ periodId: "p1" })], new Set([cleInvite("p2", "u1")]));
    expect(fantomes).toHaveLength(1);
  });

  it("réinvité après un retrait : la réponse redevient légitime", () => {
    expect(detecterReponsesFantomes([reponse()], new Set([cleInvite("p1", "u1")]))).toEqual([]);
  });
});

describe("2. ateliers « au planning » d'une séance disparue", () => {
  const atelier = (id: string, statut: string, sessionId: string | null) => ({ id, titre: `A${id}`, statut, sessionId });

  it("désigne un PLANIFIE détaché et un PLANIFIE pointant dans le vide", () => {
    const orphelins = detecterAteliersOrphelins(
      [atelier("a", "PLANIFIE", null), atelier("b", "PLANIFIE", "seance-effacee"), atelier("c", "PLANIFIE", "s1")],
      new Set(["s1"]),
    );
    expect(orphelins.map((a) => a.id)).toEqual(["a", "b"]);
  });

  it("laisse tranquilles les propositions en attente et refusées, même sans séance", () => {
    // Une proposition PROPOSE ou REFUSE n'a aucune raison d'avoir une séance : ce n'est pas une anomalie.
    const orphelins = detecterAteliersOrphelins(
      [atelier("a", "PROPOSE", null), atelier("b", "REFUSE", null), atelier("c", "VALIDE", null)],
      new Set(),
    );
    expect(orphelins).toEqual([]);
  });
});

describe("clés de déduplication", () => {
  it("reconnaît l'horodatage d'exécution et lui seul", () => {
    expect(cleHorodatee("invitation_u1_invitation_1790420718149")).toBe(true);
    expect(cleHorodatee("annulation_push_s1_1790178590895_u1")).toBe(true);
    // Une clé stable sert encore de garde-fou : elle ne doit jamais être vue comme horodatée.
    expect(cleHorodatee("recap_email_s1_u1")).toBe(false);
    expect(cleHorodatee("effectif_s1")).toBe(false);
    // Un identifiant cuid contient des chiffres, sans jamais aligner 13 chiffres d'affilée.
    expect(cleHorodatee("recap_push_cmufp9tlh001gqo3r5zep5ktu_cmuco1kj40003qokg44ye3tog")).toBe(false);
  });

  it("deux passages du même envoi se rejoignent une fois normalisés", () => {
    expect(normaliserCleDeduplication("invitation_u1_invitation_1790420718149")).toBe(
      normaliserCleDeduplication("invitation_u1_invitation_1790420718999"),
    );
    // …mais deux personnes différentes restent deux clés différentes.
    expect(normaliserCleDeduplication("invitation_u1_invitation_1790420718149")).not.toBe(
      normaliserCleDeduplication("invitation_u2_invitation_1790420718149"),
    );
  });
});

describe("3. lignes du journal des notifications écrites deux fois", () => {
  const notif = (p: Partial<LigneNotification> = {}): LigneNotification => ({
    id: "n1",
    type: "ALERTE",
    canal: "EMAIL",
    statut: "ENVOYE",
    sessionId: null,
    userId: "u1",
    dedupKey: "invitation_u1_invitation_1790420718149",
    date: new Date("2026-09-24T10:00:00"),
    ...p,
  });

  it("garde la plus ancienne et ne désigne que les suivantes", () => {
    const doublons = detecterNotificationsEnDouble([
      notif({ id: "tard", date: new Date("2026-09-24T10:00:02"), dedupKey: "invitation_u1_invitation_1790420718999" }),
      notif({ id: "tot", date: new Date("2026-09-24T10:00:00") }),
    ]);
    expect(doublons).toHaveLength(1);
    expect(doublons[0].gardee.id).toBe("tot");
    expect(doublons[0].enTrop.map((l) => l.id)).toEqual(["tard"]);
  });

  it("n'efface JAMAIS une ligne dont la clé sert encore de garde-fou", () => {
    // `recap_email_…` est relue par l'application pour décider de ne pas renvoyer le message :
    // supprimer cette ligne ferait repartir un email. L'unicité interdit d'ailleurs le doublon.
    const doublons = detecterNotificationsEnDouble([
      notif({ id: "a", dedupKey: "recap_email_s1_u1" }),
      notif({ id: "b", dedupKey: "recap_email_s1_u1" }),
    ]);
    expect(doublons).toEqual([]);
  });

  it("laisse les traces d'échec, qui sont des tentatives distinctes", () => {
    const doublons = detecterNotificationsEnDouble([
      notif({ id: "a", statut: "ECHEC", dedupKey: "recap_email_s1_u1_echec_1790420718149" }),
      notif({ id: "b", statut: "ECHEC", dedupKey: "recap_email_s1_u1_echec_1790420719999" }),
    ]);
    expect(doublons).toEqual([]);
  });

  it("deux envois espacés dans la journée ne sont pas un doublon", () => {
    // Le cas vécu : l'équipe renvoie le lien de quelqu'un une seconde fois dans l'après-midi parce
    // qu'il dit n'avoir rien reçu. Les deux lignes sont deux envois réels, et c'est cette trace-là
    // que l'écran « Derniers emails envoyés » montre pour trancher. On n'y touche pas.
    const doublons = detecterNotificationsEnDouble([
      notif({ id: "matin", date: new Date("2026-09-24T09:00:00") }),
      notif({ id: "apres-midi", date: new Date("2026-09-24T15:00:00"), dedupKey: "invitation_u1_invitation_1790420718999" }),
    ]);
    expect(doublons).toEqual([]);
  });

  it("la grappe s'arrête au premier écart : deux courses distinctes restent distinctes", () => {
    const doublons = detecterNotificationsEnDouble([
      notif({ id: "a1", date: new Date("2026-09-24T09:00:00.000") }),
      notif({ id: "a2", date: new Date("2026-09-24T09:00:00.120"), dedupKey: "invitation_u1_invitation_1790420718150" }),
      notif({ id: "b1", date: new Date("2026-09-24T15:00:00.000"), dedupKey: "invitation_u1_invitation_1790420718151" }),
      notif({ id: "b2", date: new Date("2026-09-24T15:00:00.200"), dedupKey: "invitation_u1_invitation_1790420718152" }),
    ]);
    expect(doublons.map((g) => [g.gardee.id, ...g.enTrop.map((l) => l.id)])).toEqual([
      ["a1", "a2"],
      ["b1", "b2"],
    ]);
  });

  it("deux journées différentes ne sont pas un doublon", () => {
    const doublons = detecterNotificationsEnDouble([
      notif({ id: "a", date: new Date("2026-09-24T23:59:00") }),
      notif({ id: "b", date: new Date("2026-09-25T00:01:00"), dedupKey: "invitation_u1_invitation_1790420718999" }),
    ]);
    expect(doublons).toEqual([]);
  });

  it("ne confond ni deux canaux, ni deux destinataires, ni deux issues", () => {
    const base = [
      notif({ id: "a" }),
      notif({ id: "b", canal: "PUSH" }),
      notif({ id: "c", userId: "u2", dedupKey: "invitation_u2_invitation_1790420718149" }),
      notif({ id: "d", statut: "IGNORE" }),
    ];
    expect(detecterNotificationsEnDouble(base)).toEqual([]);
  });

  it("trois lignes pour un même envoi : deux sont en trop", () => {
    const doublons = detecterNotificationsEnDouble([
      notif({ id: "a", date: new Date("2026-09-24T10:00:00") }),
      notif({ id: "b", date: new Date("2026-09-24T10:00:01"), dedupKey: "invitation_u1_invitation_1790420718150" }),
      notif({ id: "c", date: new Date("2026-09-24T10:00:02"), dedupKey: "invitation_u1_invitation_1790420718151" }),
    ]);
    expect(doublons[0].gardee.id).toBe("a");
    expect(doublons[0].enTrop.map((l) => l.id)).toEqual(["b", "c"]);
  });

  it("une base saine ne rend aucun groupe (le script est rejouable)", () => {
    expect(detecterNotificationsEnDouble([notif({ id: "seul" })])).toEqual([]);
  });
});

describe("4. liens personnels concurrents", () => {
  const lien = (p: Partial<LigneInvitation> = {}): LigneInvitation => ({
    id: "i1",
    userId: "u1",
    prenom: "Chloé",
    periodId: "p1",
    createdAt: new Date("2026-09-01T08:00:00"),
    expiresAt: new Date("2027-01-01T08:00:00"),
    revokedAt: null,
    ...p,
  });

  it("garde le lien qui vaut le plus longtemps, révoque les autres", () => {
    // C'est celui-là que la personne a dans sa boîte : se tromper ici l'enferme dehors.
    const doublons = detecterLiensConcurrents([
      lien({ id: "vieux", createdAt: new Date("2026-06-01"), expiresAt: new Date("2026-10-01") }),
      lien({ id: "neuf", createdAt: new Date("2026-09-01"), expiresAt: new Date("2027-01-01") }),
    ]);
    expect(doublons).toHaveLength(1);
    expect(doublons[0].gardee.id).toBe("neuf");
    expect(doublons[0].enTrop.map((i) => i.id)).toEqual(["vieux"]);
  });

  it("les liens déjà révoqués ne comptent pas", () => {
    const doublons = detecterLiensConcurrents([
      lien({ id: "vivant" }),
      lien({ id: "revoque", revokedAt: new Date("2026-09-10") }),
    ]);
    expect(doublons).toEqual([]);
  });

  it("un lien par personne et par période : rien à signaler", () => {
    const doublons = detecterLiensConcurrents([
      lien({ id: "a", userId: "u1", periodId: "p1" }),
      lien({ id: "b", userId: "u2", periodId: "p1" }),
      lien({ id: "c", userId: "u1", periodId: "p2" }),
    ]);
    expect(doublons).toEqual([]);
  });

  it("trois liens vivants : un seul survit", () => {
    const doublons = detecterLiensConcurrents([
      lien({ id: "a", expiresAt: new Date("2026-11-01") }),
      lien({ id: "b", expiresAt: new Date("2026-12-01") }),
      lien({ id: "c", expiresAt: new Date("2027-01-01") }),
    ]);
    expect(doublons[0].gardee.id).toBe("c");
    expect(doublons[0].enTrop.map((i) => i.id).sort()).toEqual(["a", "b"]);
  });
});

describe("5. cases de planning réservées à un atelier qui n'y est plus", () => {
  const partie = (id: string, sessionId: string, atelierId: string | null) => ({ id, sessionId, libelle: "Cours 1", atelierId });
  const ateliers = [
    { id: "ok", titre: "Corde", statut: "PLANIFIE", sessionId: "s1" },
    { id: "retire", titre: "Dague", statut: "PROPOSE", sessionId: null },
    { id: "ailleurs", titre: "Messer", statut: "PLANIFIE", sessionId: "s2" },
  ];

  it("laisse la case dont l'atelier est bien planifié sur cette séance", () => {
    expect(detecterPartiesDetachees([partie("c1", "s1", "ok")], ateliers)).toEqual([]);
  });

  it("désigne l'atelier disparu, celui qui n'est plus planifié et celui d'une autre séance", () => {
    const detachees = detecterPartiesDetachees(
      [partie("c1", "s1", "inconnu"), partie("c2", "s1", "retire"), partie("c3", "s1", "ailleurs")],
      ateliers,
    );
    expect(detachees.map((p) => p.id)).toEqual(["c1", "c2", "c3"]);
  });

  it("une case ordinaire (sans atelier) n'est jamais touchée", () => {
    expect(detecterPartiesDetachees([partie("c1", "s1", null)], ateliers)).toEqual([]);
  });
});

/**
 * **Les deux invariants d'une séance, relevés sur la base** : `ordre` contigu depuis 0, et `libelle`
 * qui redit le rang de la partie dans sa nature.
 *
 * Ce sont les deux maladies que le script ne savait pas voir — il ne regardait les parties que pour
 * y chercher un atelier disparu —, et pourtant les deux ont déjà été fausses en base : la migration
 * a laissé des rangs troués et dupliqués (deux « Opt 2 », aucun rang 0), et la migration de
 * vocabulaire suivante a renommé **par valeur** des libellés que les rangs venaient de décaler.
 *
 * Le risque de ce contrôle-ci n'est pas de rater une ligne, c'est d'en **désigner une saine** : il
 * écrirait alors dans le planning du club pour rien. D'où la contre-épreuve sur une séance juste.
 */
describe("rangs et noms des parties", () => {
  const RANGEE_LE = new Date("2026-09-12T18:30:00.000Z");
  const part = (id: string, sessionId: string, libelle: string, ordre: number, bloc: number, nature: string): LignePartieRang => ({
    id,
    sessionId,
    libelle,
    ordre,
    bloc,
    nature,
    updatedAt: RANGEE_LE,
  });

  /** Une séance saine : trois parties, une option dans la première, rangs et noms d'accord. */
  const saine = (): LignePartieRang[] => [
    part("c0", "s1", "Partie 1 · Cours", 0, 1, "COURS"),
    part("c1", "s1", "Partie 1 · Option", 1, 1, "OPTION"),
    part("c2", "s1", "Partie 2 · Cours", 2, 2, "COURS"),
    part("c3", "s1", "Partie 3 · Cours", 3, 3, "COURS"),
  ];

  it("ne touche à rien sur une séance juste — la règle de rejouabilité", () => {
    expect(detecterRangsIncoherents(saine())).toEqual([]);
  });

  it("ne touche à rien sur une base vide", () => {
    expect(detecterRangsIncoherents([])).toEqual([]);
  });

  it("retasse des rangs troués et dupliqués", () => {
    // Deux options au même rang 1, aucun rang 0 : à rang égal, l'identifiant tranche (l'ordre de
    // naissance), comme dans les migrations.
    // Séance d'une seule partie : les noms ne disent pas « Partie 1 · » (avenant du 06/10).
    const rangs = detecterRangsIncoherents([part("o2", "s1", "Option 2", 1, 1, "OPTION"), part("o1", "s1", "Option 1", 1, 1, "OPTION")]);
    // Seule la première a besoin d'une écriture : la seconde est déjà au rang 1, sous le bon nom.
    expect(rangs.map((r) => [r.id, r.data.ordre, r.data.libelle])).toEqual([["o1", 0, undefined]]);
  });

  it("range de la même façon quel que soit l'ordre dans lequel la base rend les lignes", () => {
    const abimees = [part("o2", "s1", "Partie 1 · Option 2", 1, 1, "OPTION"), part("o1", "s1", "Partie 1 · Option 1", 1, 1, "OPTION")];
    expect(detecterRangsIncoherents(abimees)).toEqual(detecterRangsIncoherents([...abimees].reverse()));
  });

  it("recale un nom qui ne dit plus la place de l'élément", () => {
    const rangs = detecterRangsIncoherents([part("c0", "s1", "Partie 1 · Cours", 0, 1, "COURS"), part("c1", "s1", "Partie 2 · Cours 3", 1, 2, "COURS")]);
    expect(rangs).toHaveLength(1);
    expect(rangs[0]).toMatchObject({ id: "c1", data: { libelle: "Partie 2 · Cours" } });
    // Le rang, lui, était déjà bon : on ne le réécrit pas pour rien.
    expect(rangs[0].data.ordre).toBeUndefined();
  });

  it("referme une partie trouée : la partie 3 d'une séance sans partie 2 devient la partie 2", () => {
    const rangs = detecterRangsIncoherents([part("c0", "s1", "Partie 1 · Cours", 0, 1, "COURS"), part("c1", "s1", "Partie 3 · Cours", 1, 3, "COURS")]);
    expect(rangs).toHaveLength(1);
    expect(rangs[0]).toMatchObject({ id: "c1", data: { bloc: 2, libelle: "Partie 2 · Cours" } });
    expect(rangs[0].data.ordre).toBeUndefined();
  });

  it("range dans une partie l'échauffement, puis les cours, puis les options", () => {
    const rangs = detecterRangsIncoherents([
      part("c0", "s1", "Option", 0, 1, "OPTION"),
      part("c1", "s1", "Cours", 1, 1, "COURS"),
      part("e0", "s1", "Échauffement", 2, 1, "ECHAUFFEMENT"),
    ]);
    // `c1` est déjà au rang 1 : il ne bouge pas.
    expect(rangs.map((r) => [r.id, r.data.ordre, r.data.libelle])).toEqual([
      ["e0", 0, undefined],
      ["c0", 2, undefined],
    ]);
  });

  it("range une nature inconnue comme un cours, comme l'application la lit", () => {
    expect(detecterRangsIncoherents([part("x0", "s1", "Cours", 0, 1, "SPARRING")])).toEqual([]);
  });

  it("juge chaque séance sur elle-même, jamais sur le tas", () => {
    expect(detecterRangsIncoherents([...saine(), ...saine().map((p) => ({ ...p, id: `b${p.id}`, sessionId: "s2" }))])).toEqual([]);
  });

  /**
   * **La réparation ne repeint pas la bulle « Modifié par … le … »** : elle rend à chaque ligne
   * l'horodatage qu'elle portait. Réparer un rang n'est pas une modification du programme par
   * quelqu'un — c'est la règle des migrations qui l'ont fait avant, et celle de `rangerParties`.
   */
  it("rend l'horodatage de la ligne, jamais l'instant de la réparation", () => {
    const rangs = detecterRangsIncoherents([part("o1", "s1", "Option 2", 5, 1, "OPTION")]);
    expect(rangs).toHaveLength(1);
    expect(rangs[0].data.updatedAt).toEqual(RANGEE_LE);
  });

  it("dit dans le rapport ce qu'elle va changer, et seulement ça", () => {
    const [rang] = detecterRangsIncoherents([part("o1", "s1", "Option 2", 5, 2, "OPTION")]);
    expect(decrireRang(rang)).toBe("séance s1, « Option 2 » → « Option » (partie 2 → 1, rang 5 → 0)");
    // Contre-épreuve : quand seul le nom change, le rapport ne raconte pas un déplacement.
    const [nom] = detecterRangsIncoherents([part("c0", "s1", "Partie 1 · Cours", 0, 1, "COURS"), part("c1", "s1", "Partie 2 · Cours 3", 1, 2, "COURS")]);
    expect(decrireRang(nom)).toBe("séance s1, « Partie 2 · Cours 3 » → « Partie 2 · Cours » (rang 1)");
  });

  it("est un contrôle qu'on peut demander seul", () => {
    expect([...CONTROLES]).toContain("rangs");
    expect([...lireArguments(["--seulement=rangs"]).controles]).toEqual(["rangs"]);
  });
});

describe("arguments de la ligne de commande", () => {
  it("vérifie sans rien écrire par défaut", () => {
    const o = lireArguments([]);
    expect(o.reparer).toBe(false);
    expect([...o.controles].sort()).toEqual([...CONTROLES].sort());
  });

  it("réparer se demande explicitement", () => {
    expect(lireArguments(["--reparer"]).reparer).toBe(true);
    expect(lireArguments(["--verifier"]).reparer).toBe(false);
  });

  it("--seulement restreint les contrôles", () => {
    expect([...lireArguments(["--seulement=fantomes,liens"]).controles]).toEqual(["fantomes", "liens"]);
  });

  it("refuse ce qu'il ne comprend pas plutôt que d'en deviner le sens", () => {
    // Sur de vraies données, une option mal tapée qui passerait pour autre chose est un piège.
    expect(() => lireArguments(["--repare"])).toThrow(ArgumentInvalide);
    expect(() => lireArguments(["--seulement=tout"])).toThrow(ArgumentInvalide);
    expect(() => lireArguments(["--seulement="])).toThrow(ArgumentInvalide);
  });
});

describe("journée locale", () => {
  it("rend AAAA-MM-JJ dans le fuseau du serveur", () => {
    expect(jourLocal(new Date(2026, 8, 24, 23, 30))).toBe("2026-09-24");
    expect(jourLocal(new Date(2026, 0, 5, 0, 1))).toBe("2026-01-05");
  });
});

/**
 * **6. Les clés d'avant l'empreinte du créneau** — le contrôle qui ferme la fenêtre de déploiement.
 *
 * Ce qui est éprouvé ici, c'est d'abord ce que le contrôle **ne doit pas** faire : ni toucher une
 * clé déjà au nouveau format (elle garde encore quelque chose), ni inventer un créneau pour une
 * séance disparue, ni écraser une clé cible déjà prise. Une clé réécrite de travers renverrait le
 * récap du lendemain à tout le club — c'est exactement ce que le contrôle est là pour empêcher.
 */
describe("6. clés de déduplication d'avant l'empreinte du créneau", () => {
  const S = "cmufp9tlh001gqo3r5zep5ktu";
  const U = "cmuco1kj40003qokg44ye3tog";
  const seances = new Map([[S, { date: "2026-10-08", heureDebut: "19:30" }]]);
  const CRENEAU = "2026-10-08-1930";

  const notif = (dedupKey: string, p: Partial<LigneNotification> = {}): LigneNotification => ({
    id: `n-${dedupKey}`,
    type: "RECAP",
    canal: "EMAIL",
    statut: "ENVOYE",
    sessionId: S,
    userId: U,
    dedupKey,
    date: new Date("2026-10-07T18:00:00"),
    ...p,
  });

  it("réécrit les six formes anciennes, créneau inséré juste après la séance", () => {
    const anciennes = [
      `recap_email_${S}_${U}`,
      `recap_push_${S}_${U}`,
      `recap_discord_${S}`,
      `recap_telegram_${S}`,
      `rappel_j7_${S}_${U}`,
      `rappel_push_j2_${S}_${U}`,
    ];
    const releve = detecterClesSansCreneau(anciennes.map((c) => notif(c)), seances);
    expect(releve.aReecrire.map((r) => r.nouvelle)).toEqual([
      `recap_email_${S}_${CRENEAU}_${U}`,
      `recap_push_${S}_${CRENEAU}_${U}`,
      `recap_discord_${S}_${CRENEAU}`,
      `recap_telegram_${S}_${CRENEAU}`,
      `rappel_j7_${S}_${CRENEAU}_${U}`,
      `rappel_push_j2_${S}_${CRENEAU}_${U}`,
    ]);
    expect(releve.sansSeance).toEqual([]);
    expect(releve.dejaPrises).toEqual([]);
  });

  it("une clé déjà au nouveau format est reconnue et laissée tranquille", () => {
    const releve = detecterClesSansCreneau(
      [
        notif(`recap_email_${S}_${CRENEAU}_${U}`),
        notif(`recap_discord_${S}_${CRENEAU}`),
        notif(`rappel_j2_${S}_${CRENEAU}_${U}`),
      ],
      seances,
    );
    expect(releve.aReecrire).toEqual([]);
    expect(releve.sansSeance).toEqual([]);
  });

  it("rejouable : le relevé d'une base déjà réparée est vide", () => {
    const lignes = [notif(`recap_email_${S}_${U}`)];
    const premier = detecterClesSansCreneau(lignes, seances);
    // On rejoue sur ce que la réparation aura écrit.
    const apres = lignes.map((l, i) => notif(premier.aReecrire[i].nouvelle));
    expect(detecterClesSansCreneau(apres, seances).aReecrire).toEqual([]);
  });

  it("séance supprimée : on ne réécrit rien, on le dit", () => {
    // `onDelete: SetNull` a effacé la colonne, et l'identifiant resté dans la clé ne désigne plus
    // rien : le créneau est irrécupérable, la ligne reste telle quelle.
    const releve = detecterClesSansCreneau([notif(`recap_email_inconnue_${U}`, { sessionId: null })], seances);
    expect(releve.aReecrire).toEqual([]);
    expect(releve.sansSeance.map((l) => l.dedupKey)).toEqual([`recap_email_inconnue_${U}`]);
  });

  it("colonne sessionId vide : l'identifiant écrit dans la clé sert de recours", () => {
    const releve = detecterClesSansCreneau([notif(`recap_email_${S}_${U}`, { sessionId: null })], seances);
    expect(releve.aReecrire.map((r) => r.nouvelle)).toEqual([`recap_email_${S}_${CRENEAU}_${U}`]);
  });

  it("clé cible déjà prise : on laisse l'ancienne plutôt que d'écraser la nouvelle", () => {
    // Le cas du déploiement fait en deux temps : l'application a déjà écrit la clé neuve.
    const releve = detecterClesSansCreneau(
      [notif(`recap_email_${S}_${U}`), notif(`recap_email_${S}_${CRENEAU}_${U}`)],
      seances,
    );
    expect(releve.aReecrire).toEqual([]);
    expect(releve.dejaPrises.map((r) => r.ancienne)).toEqual([`recap_email_${S}_${U}`]);
  });

  it("ne touche à aucune autre famille de clés", () => {
    // Ces clés-là n'ont jamais porté de créneau : les réécrire ferait repartir des messages.
    const autres = [
      `effectif_${S}`,
      `effectif_push_${S}_${U}`,
      `annulation_${S}_1790178590895`,
      `invitation_${U}_invitation_1790420718149`,
      `atelier_a1_REFUSE_1790420718149_${U}`,
      `nouvel_evenement_e1_${U}`,
    ];
    const releve = detecterClesSansCreneau(autres.map((c) => notif(c)), seances);
    expect(releve).toEqual({ aReecrire: [], sansSeance: [], dejaPrises: [] });
  });

  it("une clé d'échec reste une trace, pas un garde-fou : on n'y touche pas", () => {
    const releve = detecterClesSansCreneau([notif(`recap_email_${S}_${U}_echec_1790420718149`)], seances);
    expect(releve.aReecrire).toEqual([]);
    expect(releve.sansSeance).toEqual([]);
  });

  it("le contrôle fait partie de la liste et peut être lancé seul", () => {
    expect([...CONTROLES]).toContain("creneaux");
    expect([...lireArguments(["--seulement=creneaux"]).controles]).toEqual(["creneaux"]);
  });
});

/**
 * **8. Les parties vides en trop.** Demande de Delta, : « de base je veux dans le planning de base
 * uniquement cours 1 et cours 2 par séance, le reste en ajout si voulu ».
 *
 * Le code le tient depuis le 01/10 (`PARTIES_MODELE` ne porte plus que deux cours), mais les séances
 * créées **avant** gardent les deux options vides que l'ancien modèle posait d'office — un trimestre
 * entier, trente-deux lignes qui ne disent rien. Ce contrôle les retire.
 *
 * Ce que ces tests gardent, et qui ne se voit pas à la lecture du script :
 *
 * 1. **les premiers cours (autant que le modèle en pose) sont protégés, même vides** — ils sont le
 *    modèle, pas un ajout ;
 * 2. **« vide » n'a qu'une définition** : un seul des cinq réglages suffit à sauver une partie, et
 *    un atelier retenu la sauve aussi ;
 * 3. **le rangement des survivantes part avec la suppression**, calculé sur ce qui reste et non sur
 *    l'instantané d'avant — sinon la séance garderait des rangs troués et des noms faux ;
 * 4. **rejouable** : relancé sur une séance déjà propre, il ne trouve rien.
 */
describe("8. parties vides en trop", () => {
  const RANGEE_LE = new Date("2026-09-12T18:30:00.000Z");
  const partie = (id: string, ordre: number, nature: string, p: Partial<LignePartieComplete> = {}): LignePartieComplete => ({
    id,
    sessionId: "s1",
    libelle: `Partie ${ordre + 1} · ${nature === "OPTION" ? "Option" : "Cours"}`,
    ordre,
    bloc: ordre + 1,
    nature,
    updatedAt: RANGEE_LE,
    date: "2026-09-24",
    modifieParId: null,
    atelierId: null,
    instructeurId: null,
    instructeurSecondId: null,
    theme: null,
    description: null,
    niveau: "INDIFFERENT",
    ...p,
  });

  /** Une séance du trimestre d'avant : deux cours remplis, deux options que personne n'a touchées. */
  const ancienModele = (): LignePartieComplete[] => [
    partie("c0", 0, "COURS", { bloc: 1, libelle: "Partie 1 · Cours", instructeurId: "u1", theme: "Épée longue" }),
    partie("c1", 1, "COURS", { bloc: 2, libelle: "Partie 2 · Cours", instructeurId: "u2", theme: "Messer" }),
    partie("o0", 2, "OPTION", { bloc: 2, libelle: "Partie 2 · Option 1" }),
    partie("o1", 3, "OPTION", { bloc: 2, libelle: "Partie 2 · Option 2" }),
  ];

  it("retire les deux options vides d'une séance de l'ancien modèle, et ne touche pas aux cours", () => {
    const { aSupprimer, rangs } = detecterPartiesSurnumeraires(ancienModele());
    expect(aSupprimer.map((p) => p.id)).toEqual(["o0", "o1"]);
    // Les deux cours restent à leur place : rien à ranger derrière eux.
    expect(rangs).toEqual([]);
  });

  it("ne trouve rien sur une séance qui ne porte que son modèle — la règle de rejouabilité", () => {
    // Le modèle (un cours, vide) et deux cours ajoutés puis remplis : rien n'est en trop.
    const seance = [
      partie("c0", 0, "COURS"),
      partie("c1", 1, "COURS", { instructeurId: "u1" }),
      partie("c2", 2, "COURS", { theme: "Dague" }),
    ];
    expect(detecterPartiesSurnumeraires(seance)).toEqual({ aSupprimer: [], rangs: [], seancesVidees: [] });
  });

  it("ne trouve rien sur une base vide", () => {
    expect(detecterPartiesSurnumeraires([])).toEqual({ aSupprimer: [], rangs: [], seancesVidees: [] });
  });

  it("protège le premier cours même entièrement vide : il est le modèle", () => {
    const { aSupprimer } = detecterPartiesSurnumeraires([partie("c0", 0, "COURS")]);
    expect(aSupprimer).toEqual([]);
  });

  it("retire un deuxième cours vide, lui : celui-là a été ajouté puis laissé en blanc", () => {
    const { aSupprimer } = detecterPartiesSurnumeraires([partie("c0", 0, "COURS"), partie("c1", 1, "COURS"), partie("c2", 2, "COURS", { theme: "Dague" })]);
    expect(aSupprimer.map((p) => p.id)).toEqual(["c1"]);
  });

  it("protège le premier cours dans l'ordre de lecture, pas le premier venu", () => {
    const { aSupprimer } = detecterPartiesSurnumeraires([partie("c1", 1, "COURS"), partie("c0", 0, "COURS")]);
    expect(aSupprimer.map((p) => p.id)).toEqual(["c1"]);
  });

  /**
   * Un seul réglage renseigné suffit à sauver un élément, et c'est la définition partagée avec
   * l'écran de saisie (`reglagesVides`) qui tranche — pas une relecture champ par champ écrite ici.
   */
  it.each([
    ["un instructeur", { instructeurId: "u9" }],
    ["un second instructeur seul", { instructeurSecondId: "u9" }],
    ["un thème", { theme: "Lutte" }],
    ["une description", { description: "Trois passes lentes." }],
    ["un niveau affiché", { niveau: "DEBUTANT" }],
    ["un atelier retenu", { atelierId: "a1" }],
  ])("garde une option qui porte %s", (_quoi, champs) => {
    const { aSupprimer } = detecterPartiesSurnumeraires([
      partie("c0", 0, "COURS", { instructeurId: "u1" }),
      partie("c1", 1, "COURS", { instructeurId: "u2" }),
      partie("o0", 2, "OPTION", { bloc: 2, ...(champs as Partial<LignePartieComplete>) }),
    ]);
    expect(aSupprimer).toEqual([]);
  });

  it("range les survivantes sur ce qui RESTE, pas sur l'instantané d'avant", () => {
    // « Option 1 » vide part, « Option 2 » remplie reste — et devient « Option » tout court, rang 2.
    const { aSupprimer, rangs } = detecterPartiesSurnumeraires([
      partie("c0", 0, "COURS", { bloc: 1, libelle: "Partie 1 · Cours", instructeurId: "u1" }),
      partie("c1", 1, "COURS", { bloc: 2, libelle: "Partie 2 · Cours", instructeurId: "u2" }),
      partie("o0", 2, "OPTION", { bloc: 2, libelle: "Partie 2 · Option 1" }),
      partie("o1", 3, "OPTION", { bloc: 2, libelle: "Partie 2 · Option 2", theme: "Sparring" }),
    ]);
    expect(aSupprimer.map((p) => p.id)).toEqual(["o0"]);
    const survivante = rangs.find((r) => r.id === "o1");
    expect(survivante?.data).toMatchObject({ ordre: 2, libelle: "Partie 2 · Option" });
    // Et son `updatedAt` est rendu tel quel : retirer la case d'à côté n'est pas une modification
    // du programme par quelqu'un, et la grille lit ce champ dans sa bulle.
    expect(survivante?.data.updatedAt).toEqual(RANGEE_LE);
  });

  it("ne mélange pas deux séances", () => {
    const autre = partie("x0", 0, "OPTION", { sessionId: "s2", libelle: "Partie 1 · Option" });
    const { aSupprimer } = detecterPartiesSurnumeraires([...ancienModele(), autre]);
    expect(aSupprimer.map((p) => `${p.sessionId}:${p.id}`)).toEqual(["s1:o0", "s1:o1", "s2:x0"]);
  });

  it("se décrit pour le rapport, sans nommer personne", () => {
    expect(decrirePartieEnTrop(partie("o1", 3, "OPTION", { libelle: "Partie 2 · Option 2" }))).toBe("séance du 24/09/2026, « Partie 2 · Option 2 » (rang 3)");
  });

  it("est bien un contrôle déclaré, donc lançable seul", () => {
    expect([...CONTROLES]).toContain("vides");
  });
});

/**
 * **Ce que la relecture adverse a trouvé dans le contrôle `vides`** — le seul de la journée qui
 * **détruise** quelque chose, et qui se lance sur la base du club.
 */
describe("8 bis. le contrôle qui supprime, après relecture adverse", () => {
  const RANGEE_LE = new Date("2026-09-12T18:30:00.000Z");
  const partie = (id: string, ordre: number, nature: string, p: Partial<LignePartieComplete> = {}): LignePartieComplete => ({
    id,
    sessionId: "s1",
    libelle: `Partie ${ordre + 1} · ${nature === "OPTION" ? "Option" : "Cours"}`,
    ordre,
    bloc: ordre + 1,
    nature,
    updatedAt: RANGEE_LE,
    date: "2026-09-24",
    modifieParId: null,
    atelierId: null,
    instructeurId: null,
    instructeurSecondId: null,
    theme: null,
    description: null,
    niveau: "INDIFFERENT",
    ...p,
  });

  /**
   * **Un outil qui supprime a le droit d'être plus prudent que l'écran.** `modifieParId` est la
   * seule chose visible que `reglagesVides` ne regarde pas : la grille en fait une bulle « Modifié
   * par … le … ». Une option remplie **puis vidée exprès** la garde, et la supprimer effacerait la
   * seule trace de ce travail.
   */
  it("garde une partie que quelqu'un a touchée, même vide", () => {
    const { aSupprimer } = detecterPartiesSurnumeraires([
      partie("c0", 0, "COURS", { instructeurId: "u1" }),
      partie("c1", 1, "COURS", { instructeurId: "u2" }),
      partie("o0", 2, "OPTION", { bloc: 2, modifieParId: "u3" }),
    ]);
    expect(aSupprimer).toEqual([]);
  });

  /** Une séance qui n'avait que des options vides finit sans aucune partie : le rapport doit le dire. */
  it("annonce les séances qui se retrouveront sans aucune partie", () => {
    const { aSupprimer, seancesVidees } = detecterPartiesSurnumeraires([
      partie("o0", 0, "OPTION", { bloc: 1, libelle: "Partie 1 · Option 1" }),
      partie("o1", 1, "OPTION", { bloc: 1, libelle: "Partie 1 · Option 2" }),
    ]);
    expect(aSupprimer).toHaveLength(2);
    expect(seancesVidees).toEqual(["séance du 24/09/2026"]);
  });

  it("ne signale rien quand il reste quelque chose à la séance", () => {
    const { seancesVidees } = detecterPartiesSurnumeraires([
      partie("c0", 0, "COURS", { instructeurId: "u1" }),
      partie("c1", 1, "COURS"),
      partie("o0", 2, "OPTION", { bloc: 2 }),
    ]);
    expect(seancesVidees).toEqual([]);
  });

  /**
   * **La suppression revérifie la vacuité dans sa propre requête** : le relevé est lu hors
   * transaction, et la fenêtre mesurée entre les deux est de ~188 ms sur une base de 5,5 Mo —
   * dominée par les deux copies complètes. Un encadrant qui remplit une de ces cases pendant ce
   * temps la voyait disparaître, thème et instructeur compris.
   */
  /**
   * **Tout se rejoue dans la transaction, et le prédicat n'existe qu'une fois.**
   *
   * La première correction de la course dupliquait le prédicat de vacuité dans le `where` du
   * `deleteMany` — et ce second prédicat **divergeait** du premier : `reglagesVides` fait un `trim()`
   * et passe le niveau par `niveauAffiche`, là où le `where` exigeait l'égalité stricte. Une case
   * portant `theme = "   "`, ou un niveau écrit par une autre version, était donc « vide » pour le
   * relevé et **invisible** pour la suppression : le script ne convergeait jamais (reproduit : quatre
   * passes `--reparer` de suite, « 2 parties gardées » à l'identique). Et ce test-là **verrouillait**
   * la divergence, en exigeant littéralement `theme: ""`.
   *
   * Pire : le rangement s'appliquait **sans condition**, sur un plan calculé en excluant la case que
   * la base venait de refuser de supprimer — d'où deux « Option 1 » au même rang dans la séance.
   *
   * La parade tient en trois lectures : on relit les candidates **dans** la transaction, on leur
   * applique la **seule** définition du vide, et on range les survivantes **réelles**.
   */
  it("relit, filtre et range dans la transaction, avec un seul prédicat de vacuité", () => {
    const code = fs.readFileSync(path.join(RACINE, "scripts/reparer-donnees.ts"), "utf8");
    const debut = code.indexOf("const candidates = await tx.sessionPartie.findMany");
    const transaction = code.slice(debut, code.indexOf('if (controles.has("creneaux") &&', debut));
    // La relecture est dans la transaction, et c'est elle qui ferme la course.
    expect(transaction).toContain("await tx.sessionPartie.findMany");
    // Le prédicat du dépôt, importé — et aucun second prédicat écrit à la main dans la requête.
    expect(transaction).toContain("reglagesVides({");
    expect(transaction).not.toContain('theme: ""');
    expect(transaction).not.toContain("NIVEAU_DEFAUT");
    // Le rangement est calculé sur ce que la base contient après la suppression.
    expect(transaction.indexOf("deleteMany")).toBeLessThan(transaction.indexOf("rangementsParties"));
    expect(transaction).toContain("survivantes.filter((p) => p.sessionId === sessionId)");
    // Et rien n'est rangé si rien n'a été retiré : plus de plan périmé.
    expect(transaction).toContain("if (seancesTouchees.length > 0)");
  });

  /** Le journal d'audit nomme ce qui a **disparu**, pas ce que le relevé prévoyait. */
  it("journalise les suppressions réelles, et l'écart avec le plan", () => {
    const code = fs.readFileSync(path.join(RACINE, "scripts/reparer-donnees.ts"), "utf8");
    expect(code).toContain("partiesVidesRetirees: retireesReellement.length");
    expect(code).toContain("partiesVidesPrevues: releve.vides.aSupprimer.length");
    expect(code).toContain("retireesReellement.includes(p.id)");
  });

  /** La liste des suppressions n'est **jamais** abrégée : c'est la seule trace par case. */
  it("n'abrège jamais la liste de ce qu'il supprime", () => {
    const code = fs.readFileSync(path.join(RACINE, "scripts/reparer-donnees.ts"), "utf8");
    expect(code).toContain("detail(aSupprimer.map(decrirePartieEnTrop), true)");
  });
});
