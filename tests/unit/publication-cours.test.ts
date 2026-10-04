import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { alertesSecuriteSchema, publicationCoursSchema } from "@/lib/validation/gestion";

/**
 * **Publier les cours du club sur Internet est une décision à elle seule.**
 *
 * Décision de Delta, : « n'active pas l'API par défaut si une notification est active, mets une
 * coche dédiée pour l'activer ou non et explique que c'est pour la publication des cours. »
 *
 * Le réglage existait déjà et la porte était déjà fermée par défaut — mais la case partageait sa
 * carte et son bouton « Enregistrer » avec les alertes de sécurité, sous un titre (« Partage et
 * alertes ») qui ne disait ni l'un ni l'autre, au milieu de l'écran des notifications. Rien ne
 * l'ouvrait toute seule ; il suffisait de la lire de travers en réglant autre chose.
 *
 * Ce fichier garde les trois choses qui, ensemble, empêchent une ouverture par inadvertance.
 */

const RACINE = process.cwd();
const source = (p: string) => readFileSync(path.join(RACINE, p), "utf8");
const ACTIONS = "src/actions/admin.ts";
const ECRAN = "src/app/(app)/admin/notifications/page.tsx";

describe("la publication des cours ne s'ouvre que pour elle-même", () => {
  /**
   * Le point dur, et la raison pour laquelle il fallait **deux schémas** et non un seul partagé :
   * une case absente d'un envoi vaut « décochée » (c'est ainsi que les cases HTML fonctionnent).
   * Deux formulaires qui partageraient un schéma à deux champs éteindraient donc l'autre réglage à
   * chaque enregistrement, en silence — l'inverse exact du défaut qu'on répare.
   */
  it("chaque formulaire ne connaît que son propre réglage", () => {
    expect(Object.keys(publicationCoursSchema.shape)).toEqual(["publicApiEnabled"]);
    expect(Object.keys(alertesSecuriteSchema.shape)).toEqual(["alertesSecurite"]);
  });

  it("deux actions séparées, et celle des alertes ne touche pas à la publication", () => {
    const code = source(ACTIONS);
    const publication = code.slice(code.indexOf("export async function enregistrerPublicationCours"));
    const corpsPublication = publication.slice(0, publication.indexOf("\n}\n"));
    const alertes = code.slice(code.indexOf("export async function enregistrerAlertesSecurite"));
    const corpsAlertes = alertes.slice(0, alertes.indexOf("\n}\n"));

    expect(corpsPublication).toContain("CLES.publicApiEnabled");
    expect(corpsPublication).not.toContain("setAlertesActivees");
    expect(corpsAlertes).toContain("setAlertesActivees");
    expect(corpsAlertes).not.toContain("publicApiEnabled");
    // Les deux restent derrière la même porte que le reste de l'espace admin.
    for (const corps of [corpsPublication, corpsAlertes]) {
      expect(corps).toContain('assertPermission("settings.technical")');
      expect(corps).toContain("exigerReauth");
    }
  });

  /**
   * **Aucun autre réglage de l'écran n'écrit cette clé.** C'est la lecture littérale de la demande :
   * régler ses notifications — la matrice, l'heure du récap, un salon — ne doit rien publier.
   */
  it("aucune autre action de l'écran n'écrit la clé de publication", () => {
    const code = source(ACTIONS);
    const ecritures = [...code.matchAll(/export async function (\w+)[\s\S]*?(?=\nexport |$)/g)].filter(([bloc]) =>
      bloc.includes("CLES.publicApiEnabled"),
    );
    expect(ecritures.map((m) => m[1])).toEqual(["enregistrerPublicationCours"]);
  });

  /** L'écran doit dire **à quoi ça sert** avant de dire ce que ça expose. */
  it("la carte dit d'abord qu'il s'agit de publier les cours, et que rien ne l'ouvre à sa place", () => {
    const code = source(ECRAN);
    // `id` : la carte est une entrée du sommaire de l'écran.
    expect(code).toContain('<Carte id="publication" titre="Publication des cours sur le site du club">');
    expect(code).toContain("Publier les prochains cours");
    expect(code).toMatch(/aucune notification ne l&apos;ouvre à votre place/);
    // Ce qui sort est dit en entier, noms compris — c'est-à-dire leur absence.
    expect(code).toMatch(/aucun nom/i);
    expect(code).toMatch(/adresse de la salle/);
    // …et les alertes de sécurité ont leur propre carte, donc leur propre bouton.
    expect(code).toContain('<Carte id="alertes" titre="Alertes de sécurité">');
    expect(code).toContain("enregistrerAlertesSecurite");
  });
});
