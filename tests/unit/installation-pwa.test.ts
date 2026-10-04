import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { emailInvitation, installationEtLien, type MotifEnvoiLien } from "@/lib/email/templates/auth";
import { renderEmailHtml, renderEmailTexte } from "@/lib/email/templates/layout";

/**
 * Garde-fous des **deux pièges de l'iPhone** (constatés en vrai, septembre 2026) :
 *
 *  1. installer l'application depuis la page du lien (`/invitation/<jeton>`) fabrique une icône qui
 *     rouvre cette adresse — laquelle expire au bout de quatre mois. La mise en garde se dit
 *     désormais **dans le guide d'installation de l'application**, au moment du geste, et non plus
 *     dans l'email : les étapes de chaque système y sont repliées derrière son nom ;
 *  2. l'application installée a un stockage séparé de Safari : un lien touché dans Mail ne l'ouvrira
 *     jamais. Il faut pouvoir **copier** le lien — par appui long dans l'email (un client mail
 *     n'exécute aucun JavaScript, donc aucun bouton « Copier » n'y est possible), et par un vrai
 *     bouton sur l'écran de bienvenue, seul endroit où l'application connaît le lien en clair —
 *     bouton qui enchaîne sur la page de connexion, là où le lien se colle.
 *
 * L'écran de bienvenue s'examine en lisant sa source : la configuration du dépôt garde
 * `jsx: "preserve"` et les tests unitaires ne transforment pas le JSX.
 */

const RACINE = process.cwd();
const lire = (relatif: string) => fs.readFileSync(path.join(RACINE, relatif), "utf8");
const BIENVENUE = "src/app/(app)/bienvenue";

const MOTIFS: MotifEnvoiLien[] = ["invitation", "renouvellement", "securite", "appareils"];
const BASE = { prenom: "Chloé", periodeNom: "T4 2026", url: "https://x.fr/invitation/abc", nomApp: "CEA Organizer" };
/** Le club que le gabarit d'email nomme et dont il montre le logo (voir `ClubEmail`). */
const CLUB = { nomClub: "Cercle d'escrime ancienne", logo: "/logo.png" };

describe("l'email du lien explique comment installer l'application", () => {
  it.each(MOTIFS)("pour le motif « %s »", (motif) => {
    const { contenu } = emailInvitation({ ...BASE, motif });
    const pied = contenu.piedDePage ?? [];
    const texte = pied.join("\n");
    expect(texte).toContain("Installer l'application sur ton téléphone");
    // …mais les gestes eux-mêmes n'y sont plus : ils vivent dans l'application, repliés par
    // système (voir `GuideInstallation`). Les empiler ici faisait sept paragraphes dont cinq
    // parlaient d'un appareil que la personne n'avait pas dans la main.
    expect(texte).not.toContain("Sur l'écran d'accueil");
    expect(texte).not.toContain("trois petits points");
    expect(texte).not.toMatch(/Partager \(le carré avec une flèche/);
    // Et l'email dit où elles sont, plutôt que de les taire
    expect(texte).toMatch(/L'application te montre alors les gestes de ton appareil/);
    // Le piège n° 2 : l'application installée ne reçoit pas les liens de Mail, d'où le collage.
    // Celui-là reste ici : il se joue en dehors de l'application, qui ne peut donc pas le dire.
    expect(texte).toMatch(/colle alors ce lien dans le champ prévu sur la page de connexion/);
  });

  it.each(MOTIFS)("donne le lien en toutes lettres, sur sa propre ligne, pour le motif « %s »", (motif) => {
    const pied = emailInvitation({ ...BASE, motif }).contenu.piedDePage ?? [];
    // Sa propre ligne : c'est ce qui rend l'appui long facile à viser sur un téléphone
    expect(pied).toContain(BASE.url);
    expect(pied.filter((l) => l.includes(BASE.url))).toHaveLength(1);
    const avant = pied[pied.indexOf(BASE.url) - 1];
    expect(avant).toContain("appuie longuement dessus pour le copier");
  });

  it("l'installation vient après le bouton, jamais avant : l'email reste court", () => {
    const { contenu } = emailInvitation(BASE);
    expect(contenu.paragraphes.join("\n")).not.toContain("écran d'accueil");
    expect(contenu.boutons?.[0].url).toBe(BASE.url);
    // Dans le rendu, le pied de mail suit bien les boutons
    const html = renderEmailHtml(contenu, CLUB);
    expect(html.indexOf("Installer l&#39;application sur ton téléphone")).toBeGreaterThan(html.indexOf("Ouvrir l&#39;application"));
  });

  it("ne promet aucun bouton « Copier » dans l'email : un client mail n'exécute pas de JavaScript", () => {
    const html = renderEmailHtml(emailInvitation(BASE).contenu, CLUB);
    expect(html).not.toContain("javascript:");
    expect(html).not.toMatch(/<button/i);
    // Le lien est cliquable (et donc « appuyable longuement ») là où il est écrit en entier
    expect(html).toContain(`<a href="${BASE.url}" style="color:#9A3F26;">${BASE.url}</a>`);
  });

  it("la version texte reste lisible : pas de balise, le lien sur sa ligne", () => {
    const texte = renderEmailTexte(emailInvitation(BASE).contenu, CLUB);
    expect(texte).not.toContain("<");
    expect(texte.split("\n")).toContain(BASE.url);
    expect(texte).toContain("Installer l'application sur ton téléphone");
    // Le bouton est rendu avant le pied de mail, l'installation vient donc ensuite
    expect(texte.indexOf("Installer l'application sur ton téléphone")).toBeGreaterThan(texte.indexOf("Ouvrir l'application : "));
  });

  it("le lien passé est repris tel quel, sans retouche", () => {
    const url = "https://organizer.mon-club.fr/invitation/AbC-_123";
    expect(installationEtLien(url)).toContain(url);
  });
});

describe("les gestes d'installation se déroulent par système, dans l'application", () => {
  const guide = lire(`${BIENVENUE}/GuideInstallation.tsx`);

  it("propose les deux systèmes, chacun dans son volet replié", () => {
    // Un `<details>` par système : on déroule le sien d'un appui, les autres restent fermés
    expect(guide).toContain("<details open={s.cle === plateforme}");
    expect(guide).toContain('nom: "iPhone et iPad"');
    expect(guide).toContain('nom: "Android"');
  });

  it("ouvre celui de l'appareil détecté sans enfermer qui que ce soit dedans", () => {
    // La détection donne la valeur initiale de `open` ; elle ne masque plus les autres systèmes,
    // sans quoi une détection fausse rendait les bonnes instructions introuvables.
    expect(guide).toContain("setPlateforme(detecterPlateforme());");
    expect(guide).toContain("s.cle === plateforme");
    expect(guide).not.toMatch(/plateforme === "iphone" \? \(/);
  });

  it("garde le piège n° 1 là où le geste se fait", () => {
    // Installée depuis l'adresse du lien, l'icône rouvre ce lien — qui expire au bout de 4 mois
    expect(guide).toContain("et non depuis l'adresse de ton lien");
    expect(guide).toContain("qui finit par expirer");
  });
});

describe("l'écran de bienvenue offre un vrai bouton « Copier mon lien »", () => {
  const page = lire(`${BIENVENUE}/page.tsx`);
  const parcours = lire(`${BIENVENUE}/ParcoursAccueil.tsx`);
  const bouton = lire(`${BIENVENUE}/BoutonCopierLien.tsx`);
  const cookie = lire("src/lib/lien-personnel.ts");

  it("n'affiche le bouton que si l'ouverture du lien l'a transmis", () => {
    // Ailleurs, l'application ne connaît que le SHA-256 du jeton : sans lien en clair, pas de
    // bouton Le cookie de passage est rattaché à son propriétaire : la lecture exige donc
    // l'identifiant de qui regarde l'écran (voir `src/lib/lien-personnel.ts`).
    expect(page).toContain("const lienPersonnel = await lienPersonnelDeLOuverture(user.id);");
    expect(page).toContain("lienPersonnel={lienPersonnel}");
    expect(parcours).toContain("{lienPersonnel && (");
    expect(cookie).toContain("isValidTokenFormat(jeton) ? invitationUrl(jeton) : null");
  });

  it("garde l'ordre du parcours : installer, puis consolider, puis entrer", () => {
    const rang = (extrait: string) => {
      const i = parcours.indexOf(extrait);
      expect(i, extrait).toBeGreaterThan(-1);
      return i;
    };
    expect(rang('etape === "installer"')).toBeLessThan(rang('etape === "guide"'));
    expect(rang('etape === "guide"')).toBeLessThan(rang('etape === "consolider"'));
    expect(rang("<GuideInstallation />")).toBeLessThan(rang("<FormulaireMotDePasse"));
    // La double authentification ne vient qu'après un mot de passe posé
    expect(rang('setEtape("deux-fa")')).toBeLessThan(rang("/profil#securite"));
  });

  it("chaque étape peut être déclinée : rien n'est imposé", () => {
    expect(parcours).toContain("Non, continuer dans le navigateur");
    expect(parcours).toContain("Plus tard");
    expect(parcours).toContain("Continuer avec mon lien");
  });

  it("saute la question de l'installation sur ordinateur et dans l'application déjà installée", () => {
    expect(parcours).toContain('window.matchMedia("(display-mode: standalone)").matches');
    expect(parcours).toContain("/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)");
    // Et le premier rendu ne montre aucune des deux versions : pas de clignotement
    expect(parcours).toContain('useState<Etape>("detection")');
  });

  it("copie par le presse-papiers, avec le repli du champ sélectionné (comme BoutonPartager)", () => {
    expect(bouton).toContain("navigator.clipboard.writeText(lien)");
    expect(bouton).toContain("setRepli(true)");
    expect(bouton).toContain("champRepli.current?.select()");
    // Un lien personnel ne se partage pas : ni partage natif, ni WhatsApp ici
    expect(bouton).not.toContain("navigator.share");
    expect(bouton).not.toContain("wa.me");
  });

  it("dit à quoi sert la copie : ouvrir l'application installée et y coller le lien", () => {
    expect(bouton).toContain("Copier mon lien");
    expect(`${bouton}\n${parcours}`).toMatch(/ouvre l'application depuis ton écran d'accueil/);
    expect(`${bouton}\n${parcours}`).toMatch(/page de connexion|où le coller/);
  });

  /**
   * L'enchaînement se lit dans la source : vitest ne transforme pas le JSX (`include` ne prend que
   * `tests/unit/**\/*.test.ts`), donc on interroge l'arbre TypeScript plutôt que le rendu.
   */
  describe("après la copie, la page de connexion prend le relais", () => {
    const source = ts.createSourceFile(`${BIENVENUE}/BoutonCopierLien.tsx`, bouton, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const essai = (() => {
      let trouve: ts.TryStatement | undefined;
      const visiter = (n: ts.Node) => {
        if (!trouve && ts.isTryStatement(n)) trouve = n;
        ts.forEachChild(n, visiter);
      };
      ts.forEachChild(source, visiter);
      if (!trouve) throw new Error("La copie n'est plus entourée d'un try/catch.");
      return trouve;
    })();

    it("mène au champ de collage quand le presse-papiers a accepté", () => {
      expect(essai.tryBlock.getText()).toContain("router.push(destination)");
      expect(bouton).toContain('const OU_COLLER = "/connexion?lien=copie"');
      expect(bouton).toContain("destination = OU_COLLER");
    });

    it("ne mène nulle part quand le presse-papiers refuse, sauf si le geste était d'entrer", () => {
      // Envoyer coller un lien qu'on n'a pas copié ne rendrait service à personne. « Continuer avec
      // mon lien », lui, vise l'application : la copie n'y est qu'un service rendu au passage.
      const rattrapage = essai.catchClause?.block.getText() ?? "";
      expect(rattrapage).toContain("setRepli(true)");
      expect(rattrapage).toContain("if (toujoursNaviguer) router.push(destination)");
      // Le bouton de copie du parcours, lui, ne demande jamais ce rattrapage
      expect(parcours).not.toMatch(/toujoursNaviguer[\s\S]{0,120}titre="Puis donne-lui ton lien"/);
    });

    it("ne met ni le lien ni le jeton dans l'adresse de destination", () => {
      // Un jeton n'a rien à faire dans une barre d'adresse, ni dans le journal d'un serveur
      const destinations = bouton.match(/router\.push\(([^)]*)\)/g) ?? [];
      expect(new Set(destinations)).toEqual(new Set(["router.push(destination)"]));
      expect(bouton).not.toMatch(/push\(`/);
      expect(bouton).not.toMatch(/lien=\$\{/);
      // Les destinations passées par le parcours sont des chemins internes, jamais le lien
      expect(parcours).not.toMatch(/destination=\{lienPersonnel\}/);
    });
  });
});
