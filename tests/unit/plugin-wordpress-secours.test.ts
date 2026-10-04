import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * **Fermer la publication doit éteindre la vitrine, pas seulement le serveur.**
 *
 * `docs/SECURITE.md` promet deux choses de l'API publique : « Fermée : `503` tant que *Publier les
 * prochains cours* n'est pas cochée », et « refermer la première coupe tout d'un coup ». Les deux
 * étaient vraies **du serveur** et fausses **du plugin que ce dépôt livre lui-même** : le plugin ne
 * distinguait pas un refus d'une panne (`200 !== code` et rien d'autre), retombait sur son transient
 * `_secours` de **sept jours**, et le site du club continuait d'afficher les cinq prochains cours —
 * adresses de salle et motifs d'annulation compris — une semaine entière après que le bureau avait
 * décoché la case.
 *
 * Le plugin est du PHP, qu'aucun test de ce dépôt ne peut exécuter (pas d'interpréteur dans
 * l'environnement de développement ni dans le workflow). Ce fichier fait donc ce que font déjà
 * `publication-cours.test.ts` et `canal-site-du-club.test.ts` pour du code qu'ils ne peuvent
 * qu'inspecter : il **lit la source** et vérifie la structure du chemin de décision. C'est moins
 * qu'une exécution, et bien plus que rien — la régression qu'on répare ici est une régression de
 * structure, pas de calcul.
 *
 * Et le README du plugin est vérifié avec : c'est lui qui décrit le secours aux administrateurs du
 * site, et une documentation qui promet l'ancien comportement vaut un bogue.
 */

const RACINE = process.cwd();
const PLUGIN = "wordpress-plugin/hema-prochains-cours/hema-prochains-cours.php";
const README = "wordpress-plugin/hema-prochains-cours/README.md";
const source = (p: string) => readFileSync(path.join(RACINE, p), "utf8");

/** Le corps de `hema_pc_cours`, la seule fonction qui décide d'ouvrir le secours ou non. */
function corpsLecture(): string {
  const code = source(PLUGIN);
  const debut = code.indexOf("function hema_pc_cours(");
  expect(debut).toBeGreaterThan(0);
  const fin = code.indexOf("\n}", debut);
  expect(fin).toBeGreaterThan(debut);
  return code.slice(debut, fin);
}

describe("le cache de secours du plugin ne survit pas à la fermeture de l'interrupteur", () => {
  it("le secours ne se lit QUE dans la branche `is_wp_error` : une panne, jamais un refus", () => {
    const corps = corpsLecture();
    const lecture = corps.indexOf("get_transient( $cle . '_secours' )");
    expect(lecture).toBeGreaterThan(0);
    const garde = corps.lastIndexOf("is_wp_error( $reponse )", lecture);
    expect(garde).toBeGreaterThan(0);
    // Rien entre la garde et la lecture : pas de `else`, pas de second chemin qui y mènerait.
    const entre = corps.slice(garde, lecture);
    expect(entre).not.toContain("wp_remote_retrieve_response_code");
    expect(entre.split("\n").length).toBeLessThan(6);
    // Et une seule lecture du secours dans toute la fonction.
    expect(corps.split("get_transient( $cle . '_secours' )").length - 1).toBe(1);
  });

  it("un refus efface les DEUX caches : celui de quinze minutes et celui de sept jours", () => {
    const corps = corpsLecture();
    expect(corps).toContain("delete_transient( $cle )");
    expect(corps).toContain("delete_transient( $cle . '_secours' )");
    // Les effacements tombent après le contrôle du code HTTP, c'est-à-dire sur le chemin du refus.
    const codeHttp = corps.indexOf("wp_remote_retrieve_response_code");
    expect(corps.indexOf("delete_transient( $cle . '_secours' )")).toBeGreaterThan(codeHttp);
  });

  it("le `503` de la publication refermée n'est pas traité à part : toute réponse non conforme est un refus", () => {
    const corps = corpsLecture();
    /*
     * Volontairement **aucune liste de codes** dans le plugin. Un `in_array( $code, array( 403, 503 ) )`
     * laisserait passer le prochain code que l'application choisira, et un refus oublié redeviendrait
     * une semaine d'affichage. La question posée est « l'application a-t-elle rendu un planning ? »,
     * et tout le reste est un non.
     */
    expect(corps).not.toMatch(/\b503\b/);
    expect(corps).not.toMatch(/\b403\b/);
    // Le seul code cité est celui du succès.
    expect(corps).toContain("200 === (int) wp_remote_retrieve_response_code( $reponse )");
  });

  it("le `null` rendu ferme l'affichage : le shortcode n'a pas de second chemin vers les cartes", () => {
    const code = source(PLUGIN);
    const shortcode = code.slice(code.indexOf("function hema_pc_shortcode("));
    // Un seul appel à la lecture, et un `null` qui rend court.
    expect(shortcode.split("hema_pc_cours(").length - 1).toBe(1);
    expect(shortcode).toContain("if ( null === $data )");
  });
});

describe("le README du plugin dit ce que le code fait", () => {
  it("il réserve le secours aux pannes et annonce que le refus s'applique tout de suite", () => {
    const texte = source(README);
    expect(texte).toMatch(/secours[\s\S]*?7 jours[\s\S]*?panne/i);
    // La phrase qui manquait : décocher la case retire le planning du site, sans délai.
    expect(texte.toLowerCase()).toContain("publier les prochains cours");
    expect(texte).toMatch(/vidés|vide les caches|immédiatement/i);
  });

  it("il ne décrit plus le secours comme le filet d'« une mise à jour, une coupure » sans réserve", () => {
    const texte = source(README);
    const secours = texte.slice(texte.indexOf("cache de secours"));
    // La promesse d'origine (« si l'application ne répond pas, la page continue d'afficher ») est
    // désormais **bornée** : elle ne doit pas se lire à deux lignes du mot « décochée » sans nuance.
    expect(secours).toMatch(/réservé aux \*\*pannes\*\*|réservé aux pannes/i);
  });
});
