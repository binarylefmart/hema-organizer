import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * L'accueil se nomme.
 *
 * Il n'était atteignable qu'en cliquant l'écu — l'usage du web, que rien à l'écran n'annonce, dans
 * un club où beaucoup ne sont pas à l'aise avec l'informatique. Cinq placements ont été maquettés
 * et mesurés (icône maison seule, entrée libellée, quatrième onglet, « Tableau de bord », et
 * celui-ci) ; Delta a retenu **d'apprendre la porte qui existe déjà** plutôt que d'en ouvrir une
 * seconde : l'écu, le nom du club, et le mot « Accueil » juste en dessous, sur toutes les tailles
 * d'écran — avec l'état actif des onglets pour dire « tu y es ».
 *
 * Ce que ces cas tiennent : le mot est écrit et le lien mène à « / » ; l'état actif se décide sur
 * le chemin exact ; la navigation n'a pas gagné d'entrée ; et la barre tient dans la largeur du
 * contenu aux quatre états, mesurés à 320, 390, 768 et 1280 px.
 */

const RACINE = process.cwd();
const lire = (relatif: string) => fs.readFileSync(path.join(RACINE, relatif), "utf8");

const LIEN = "src/components/layout/LienAccueil.tsx";
const ENTETE = "src/components/layout/Entete.tsx";
const NAVIGATION = "src/components/layout/Navigation.tsx";

describe("l'écu porte le mot « Accueil »", () => {
  it("le mot est écrit sous le nom du club, dans le lien vers « / »", () => {
    const code = lire(LIEN);
    expect(code).toContain('<Link');
    expect(code).toContain('href="/"');
    expect(code).toContain("Accueil\n        </span>");
    // Le nom accessible reste « Accueil » : l'écu annonce déjà le club
    expect(code).toContain('aria-label="Accueil"');
  });

  it("il s'allume sur l'accueil, et nulle part ailleurs", () => {
    const code = lire(LIEN);
    expect(code).toContain('const actif = usePathname() === "/";');
    expect(code).toContain('aria-current={actif ? "page" : undefined}');
    // Même pastille que les onglets : c'est elle qui apprend que la zone est un bouton
    expect(code).toContain('actif ? "bg-white/15 ring-1 ring-marque/50" : ""');
  });

  it("l'en-tête le pose, et lui dit quand passer au sigle", () => {
    const code = lire(ENTETE);
    expect(code).toContain("<LienAccueil sigle={user.sessionForte} identite={club} />");
  });

  it("la navigation n'a pas gagné d'entrée : toujours trois onglets", () => {
    const code = lire(ENTETE);
    expect(code).toContain('{ href: "/planning", label: "Planning", icone: "calendrier" }');
    expect(code).toContain('{ href: "/seances", label: "Séances", icone: "epee" }');
    expect(code).toContain('{ href: "/ateliers", label: "Atelier", icone: "outil" }');
    expect(code).not.toContain('icone: "maison"');
    // Le garde-fou reste : « / » est le préfixe de tous les chemins
    expect(lire(NAVIGATION)).toContain('return href === "/" ? pathname === "/" : pathname.startsWith(href);');
  });
});

describe("la barre tient dans la largeur du contenu", () => {
  it("pendant l'élévation, le titre passe au sigle — et sous 360 px l'écu reste seul", () => {
    // Mesuré : 629 px sur 736 pour un membre, 677 pour l'encadrement, 702 en espace admin ouvert.
    // Sur un téléphone de 320 px (288 utiles), l'élévation ajoute la roue de l'admin : le bloc se
    // réduit alors à l'écu (246 px occupés), seul cas où le mot n'est pas écrit.
    const code = lire(LIEN);
    expect(code).toContain('sigle ? "hidden min-[360px]:grid" : ""');
  });

  it("sous 768 px, le mot « Admin » s'efface, mais pas le nom accessible", () => {
    // Seule entrée libellée de l'en-tête à ces largeurs (les onglets sont dans la barre du bas) :
    // sans cela, il ne restait pas la place d'écrire « Accueil » sur un téléphone de 390.
    const code = lire(NAVIGATION);
    expect(code).toContain('{!iconesSeules && <span className="hidden md:inline">{o.label}</span>}');
    expect(code).toContain("aria-label={o.label}");
  });
});
