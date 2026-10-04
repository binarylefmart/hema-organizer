import { describe, expect, it } from "vitest";
import { PART_EFFECTIF_LIVREE } from "@/lib/constants";
import {
  calculerTaux,
  compterPresences,
  effectifAttendu,
  formatTaux,
  palierEffectif,
  PALIER_LABELS,
  PALIERS,
  MARGE_CONFORT,
  SEUIL_PLANCHER,
  seuilConfort,
  seuilEnPersonnes,
  tauxPersonnel,
} from "@/lib/presences";

describe("calcul du taux de présence", () => {
  it("taux = présents / invités × 100, arrondi à l'entier", () => {
    expect(calculerTaux(13, 18)).toBe(72);
    expect(calculerTaux(1, 3)).toBe(33);
    expect(calculerTaux(2, 3)).toBe(67);
    expect(calculerTaux(18, 18)).toBe(100);
    expect(calculerTaux(0, 18)).toBe(0);
  });

  /**
   * **Ceinture de sécurité.** Le dénominateur est le nombre d'invités de la période ; le numérateur
   * se compte sur les lignes de présence. Les deux se sont déjà désaccordés — une réponse laissée
   * par quelqu'un retiré de la période —, et l'écran annonçait « 106 % ». La cause se corrige là où
   * l'on compte (les agrégats sont filtrés sur les membres), mais un taux reste un taux : au-delà
   * de 100 %, il n'informe plus, il inquiète. On le borne, et la donnée brute (« 19/18 ») reste
   * visible à côté pour qui doit comprendre.
   */
  it("ne dépasse jamais 100 %, même si le numérateur a débordé", () => {
    expect(calculerTaux(19, 18)).toBe(100);
    expect(calculerTaux(36, 18)).toBe(100);
    const c = compterPresences(Array(19).fill("PRESENT"), 18);
    expect(c.pourcentage).toBe(100);
    expect(c.presents).toBe(19); // le chiffre brut, lui, n'est pas maquillé
    expect(c.enAttente).toBe(0);
  });

  it("ne divise pas par zéro", () => {
    expect(calculerTaux(0, 0)).toBe(0);
    expect(calculerTaux(5, 0)).toBe(0);
  });

  it("compte présents, absents, peut-être et réponses en attente", () => {
    const statuts = [...Array(13).fill("PRESENT"), "ABSENT", "ABSENT", "PEUT_ETRE"];
    const c = compterPresences(statuts, 18);
    expect(c).toEqual({ invites: 18, presents: 13, absents: 2, peutEtre: 1, enAttente: 2, pourcentage: 72 });
    expect(formatTaux(c)).toBe("72 % — 13/18");
  });

  it("le dénominateur est le nombre d'invités, pas le nombre de réponses", () => {
    expect(compterPresences(["PRESENT", "PRESENT"], 10).pourcentage).toBe(20);
  });

  it("ignore les statuts inconnus et ne renvoie jamais d'attente négative", () => {
    const c = compterPresences(["PRESENT", "BIDON", "PRESENT", "PRESENT"], 2);
    expect(c.presents).toBe(3);
    expect(c.enAttente).toBe(0);
  });

  it("taux personnel = présences / séances passées non annulées", () => {
    expect(tauxPersonnel(["PRESENT", "ABSENT", null, "PRESENT"])).toEqual({ presences: 2, seances: 4, pourcentage: 50 });
    expect(tauxPersonnel([])).toEqual({ presences: 0, seances: 0, pourcentage: 0 });
  });
});

describe("effectif attendu à un cours", () => {
  it("compte les présents, plus la moitié des peut-être", () => {
    expect(effectifAttendu({ presents: 5, peutEtre: 4 })).toBe(7);
    expect(effectifAttendu({ presents: 5, peutEtre: 0 })).toBe(5);
    expect(effectifAttendu({ presents: 0, peutEtre: 0 })).toBe(0);
  });

  it("arrondit au plus proche, sans jamais rendre un demi-participant", () => {
    expect(effectifAttendu({ presents: 3, peutEtre: 1 })).toBe(4);
    expect(effectifAttendu({ presents: 3, peutEtre: 3 })).toBe(5);
    expect(Number.isInteger(effectifAttendu({ presents: 2, peutEtre: 7 }))).toBe(true);
  });

  it("ne descend jamais en dessous du nombre de présents déjà confirmés", () => {
    // C'est ce qui rend l'estimation utilisable pour préparer une salle : elle ne promet jamais
    // moins que ce qui est déjà acquis.
    for (const peutEtre of [0, 1, 2, 5, 12]) {
      expect(effectifAttendu({ presents: 4, peutEtre })).toBeGreaterThanOrEqual(4);
    }
  });
});

describe("le seuil, en part de l'effectif invité", () => {
  /**
   * **Le seuil n'est plus un nombre de personnes, c'est une part de l'effectif invité**, avec un
   * **plancher de 4 personnes** sous lequel il ne descend jamais.
   *
   * Un nombre fixe ne pouvait pas servir deux clubs : réglé à 4, il ne s'éteignait jamais dans un
   * club de 80 — le trait de la jauge restait collé en bas et l'alerte « peu de monde » ne serait
   * jamais partie. Réglé à 16 pour ce club-là, il aurait éteint tous les cours d'un club de douze.
   */
  it("prend la part de l'effectif quand elle dépasse le plancher", () => {
    expect(seuilEnPersonnes(20, 80)).toBe(16);
    expect(seuilEnPersonnes(20, 100)).toBe(20);
  });

  it("garde le plancher de quatre personnes dans un petit club", () => {
    // 20 % de 12 font 2,4 : sous quatre personnes, il n'y a pas de cours — pas de binômes, rien à
    // faire tourner. Le plancher est une constante livrée, pas un second réglage à remplir.
    expect(SEUIL_PLANCHER).toBe(4);
    expect(seuilEnPersonnes(20, 12)).toBe(SEUIL_PLANCHER);
    expect(seuilEnPersonnes(20, 8)).toBe(SEUIL_PLANCHER);
    // La bascule se fait à vingt invités : les deux règles y donnent le même nombre.
    expect(seuilEnPersonnes(20, 20)).toBe(4);
    expect(seuilEnPersonnes(20, 25)).toBe(5);
  });

  it("arrondit au supérieur, pour que « en danger » veuille dire « moins que la part réglée »", () => {
    // 20 % de 82 font 16,4. Arrondi à 16, un cours à 16 présents (19,5 % de l'effectif) passerait
    // pour suffisant alors qu'il est **sous** la part réglée. Arrondi au supérieur, « en danger »
    // veut dire exactement « strictement moins de 20 % des invités », à la personne près.
    expect(seuilEnPersonnes(20, 82)).toBe(17);
    expect(seuilEnPersonnes(15, 41)).toBe(7); // 6,15 → 7
    expect(seuilEnPersonnes(50, 30)).toBe(15); // pile 15 : rien à arrondir
  });

  it("ne divise pas par zéro sur une période sans invité", () => {
    expect(seuilEnPersonnes(20, 0)).toBe(SEUIL_PLANCHER);
  });

  it("reprend l'existant sans rien convertir : un club de douze ne voit aucun changement", () => {
    // Le réglage livré valait 4 personnes. Avec 20 % et le plancher, un club de douze invités
    // retombe sur 4 : c'est ce qui permet de repartir de 20 % sans convertir le réglage d'hier,
    // qui n'a jamais su à quel effectif il s'appliquait.
    expect(seuilEnPersonnes(PART_EFFECTIF_LIVREE, 12)).toBe(4);
    expect(seuilEnPersonnes(PART_EFFECTIF_LIVREE, 18)).toBe(4);
  });
});

describe("paliers de remplissage d'un cours", () => {
  /** Compteurs minimaux : seuls `presents`, `peutEtre` et `invites` entrent dans l'échelle. */
  const seance = (presents: number, peutEtre: number, invites = 18) => ({ presents, peutEtre, invites });

  /** La part livrée, tant que personne n'a réglé la sienne. */
  const PART = PART_EFFECTIF_LIVREE;

  it("accroche toute l'échelle à la part réglée, jamais à un nombre recopié", () => {
    expect(PART_EFFECTIF_LIVREE).toBe(20);
    // La marge de confort suit le seuil : trois personnes au minimum, et la moitié du seuil
    // au-delà — sans quoi « Bien rempli » se décrocherait du pourcentage dans un grand club.
    expect(seuilConfort(4)).toBe(4 + MARGE_CONFORT);
    expect(seuilConfort(16)).toBe(24);
  });

  it("passe « en danger » sous la part réglée, et pas avant", () => {
    // Club de douze : le plancher tient, le seuil vaut 4 — le comportement livré, à la lettre.
    expect(palierEffectif(seance(0, 0, 12), PART)).toBe("danger");
    expect(palierEffectif(seance(3, 0, 12), PART)).toBe("danger");
    expect(palierEffectif(seance(4, 0, 12), PART)).toBe("juste");
    // Club de quatre-vingts : le seuil vaut 16, et 15 présents ne suffisent plus.
    expect(palierEffectif(seance(15, 0, 80), PART)).toBe("danger");
    expect(palierEffectif(seance(16, 0, 80), PART)).toBe("juste");
  });

  /**
   * **Le cas qui a déclenché la demande** : « 19 présents sur 80 · 24 % » portait le badge « Bien
   * rempli ». Le pourcentage et son commentaire ne racontaient pas la même histoire — la marge de
   * confort valait trois personnes quel que soit le club, donc 19 dépassait 16 + 3.
   */
  it("ne dit plus « Bien rempli » d'un cours à 24 % dans un club de quatre-vingts", () => {
    expect(palierEffectif(seance(19, 0, 80), PART)).toBe("juste");
    expect(PALIER_LABELS[palierEffectif(seance(19, 0, 80), PART)]).toBe("Effectif juste");
    // « Bien rempli » commence à 30 % de l'effectif (16 × 1,5), soit 24 personnes sur 80.
    expect(palierEffectif(seance(23, 0, 80), PART)).toBe("juste");
    expect(palierEffectif(seance(24, 0, 80), PART)).toBe("bien");
  });

  it("garde « juste » jusqu'à la marge de confort exclue", () => {
    const seuil = seuilEnPersonnes(PART, 18);
    expect(palierEffectif(seance(seuilConfort(seuil) - 1, 0), PART)).toBe("juste");
    expect(palierEffectif(seance(seuilConfort(seuil), 0), PART)).toBe("bien");
    expect(palierEffectif(seance(12, 0), PART)).toBe("bien");
  });

  /**
   * **L'échelle s'adapte d'elle-même à chaque effectif** : c'est tout l'objet du changement. Le même
   * cours — 8 confirmés — est « bien rempli » dans un club de douze et « en danger » dans un club de
   * soixante, sans que personne ait à toucher un réglage.
   */
  it("suit l'effectif invité sans qu'on règle quoi que ce soit", () => {
    expect(palierEffectif(seance(8, 0, 12), PART)).toBe("bien");
    expect(palierEffectif(seance(8, 0, 30), PART)).toBe("juste");
    expect(palierEffectif(seance(8, 0, 60), PART)).toBe("danger");
  });

  it("déplace toute l'échelle quand le club change sa part", () => {
    const cours = seance(8, 0, 60);
    expect(palierEffectif(cours, 5)).toBe("bien"); // seuil 4 (plancher), confort 7
    expect(palierEffectif(cours, 13)).toBe("juste"); // seuil 8, confort 12
    expect(palierEffectif(cours, 20)).toBe("danger"); // seuil 12
  });

  it("juge sur l'effectif attendu, pas sur les seuls confirmés", () => {
    // 3 confirmés et 6 indécis, c'est ~6 attendus : le cours n'est pas en danger, il est juste.
    expect(effectifAttendu(seance(3, 6))).toBe(6);
    expect(palierEffectif(seance(3, 6), PART)).toBe("juste");
    // Les mêmes 3 confirmés, personne d'autre : là, il l'est.
    expect(palierEffectif(seance(3, 0), PART)).toBe("danger");
  });

  it("ne note pas un groupe plus petit que le seuil lui-même", () => {
    // Avec quatre invités, aucun cours n'atteindra jamais cinq personnes : le peindre en rouge
    // reprocherait à la séance ce qui tient à la taille de la période (même règle que le trait du
    // seuil, qui ne se dessine que s'il tombe dans la jauge).
    expect(palierEffectif(seance(3, 0, 3), PART)).toBe("indetermine");
    expect(palierEffectif(seance(0, 0, 0), PART)).toBe("indetermine");
    expect(palierEffectif(seance(4, 0, 4), PART)).toBe("indetermine");
  });

  /**
   * **La seconde borne dégénérée : un groupe trop petit pour atteindre le confort**.
   *
   * Avec les valeurs livrées, le confort vaut sept. Un club de cinq ou six invités ne pouvait donc
   * **jamais** lire « Bien rempli », même avec tout le monde présent : la carte affichait « 6 présents /
   * 6 — 100 % » et, juste à côté, « Effectif juste ». Le mot contredisait le pourcentage affiché à côté
   * de lui, ce que le dossier interdit nommément — et aucun réglage ne le rattrapait, le plancher de
   * quatre fixant le confort à sept quelle que soit la part choisie.
   *
   * On ne note donc pas non plus ces groupes-là : le taux se lit seul, sans jugement, jusqu'à ce que le
   * club grandisse. La ligne du dessus garde l'autre moitié — à sept invités, l'échelle reprend, et
   * « bien » redevient atteignable.
   */
  it("ne note pas non plus un groupe trop petit pour que « bien » soit atteignable", () => {
    for (const invites of [5, 6]) {
      // Tout le monde présent : c'est le meilleur cas possible pour ce groupe.
      expect(palierEffectif(seance(invites, 0, invites), PART), `${invites} invités`).toBe("indetermine");
    }
    // Sept invités : le confort est atteignable, l'échelle a de nouveau un sens.
    expect(palierEffectif(seance(7, 0, 7), PART)).toBe("bien");
    expect(palierEffectif(seance(4, 0, 7), PART)).toBe("juste");
    expect(palierEffectif(seance(2, 0, 7), PART)).toBe("danger");
  });

  it("ne rend jamais autre chose qu'un palier du catalogue", () => {
    for (const part of [5, PART, 35, 50]) {
      for (const invites of [0, 3, 4, 5, 18, 80]) {
        for (let presents = 0; presents <= invites; presents++) {
          for (const peutEtre of [0, 1, 3]) {
            expect(PALIERS).toContain(palierEffectif(seance(presents, peutEtre, invites), part));
          }
        }
      }
    }
  });

  it("écrit en toutes lettres ce que dit la couleur, sauf quand elle ne dit rien", () => {
    // Le mot est le garde-fou de l'écran : c'est lui qui empêche de lire un effectif en rouge
    // comme un nombre d'absents. Un palier gradé sans libellé laisserait passer une couleur nue.
    expect(PALIER_LABELS.indetermine).toBeNull();
    for (const palier of PALIERS.filter((p) => p !== "indetermine")) {
      expect(PALIER_LABELS[palier], palier).toBeTruthy();
    }
    expect(PALIER_LABELS.danger).toBe("Peu de monde");
  });
});
