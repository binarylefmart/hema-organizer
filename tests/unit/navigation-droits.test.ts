import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Suites de l'audit des droits et des liens. Cinq garde-fous, tous lus dans les sources — ce qui
 * doit tenir ici, c'est l'endroit où l'on garde et ce que les libellés annoncent, pas le rendu :
 *
 *  1. une **entrée annoncée** qui redirige vérifie la permission avant de rediriger (`/admin`,
 *     `/gestion`) ; une **adresse fossile** ne vérifie rien, sa destination s'en charge ;
 *  2. un lien qui va rebondir sur `/connexion/admin` le **dit avant le clic** ;
 *  3. la pagination du journal d'audit ne fabrique plus d'URL à rallonge vide ;
 *  4. l'écran de création d'une période a une sortie ;
 *  5. le volet des événements est toujours rendu : c'est la seule porte vers `/evenements`.
 */

const RACINE = process.cwd();
const lire = (relatif: string) => fs.readFileSync(path.join(RACINE, relatif), "utf8");

const PAGE_ADMIN = "src/app/(app)/admin/page.tsx";
const PAGE_GESTION = "src/app/(app)/gestion/page.tsx";
const RELAIS = [
  "src/app/(app)/gestion/membres/page.tsx",
  "src/app/(app)/gestion/membres/[id]/page.tsx",
  "src/app/(app)/gestion/periodes/page.tsx",
  "src/app/(app)/gestion/periodes/[id]/page.tsx",
  "src/app/(app)/gestion/seances/page.tsx",
  "src/app/(app)/gestion/seances/[id]/page.tsx",
];

describe("une page qui redirige garde, ou assume de ne pas garder", () => {
  it("les deux entrées annoncées vérifient la permission avant le redirect", () => {
    // Sans ce contrôle, un instructeur recevait une 307 vers un écran chargé de lui dire non
    const admin = lire(PAGE_ADMIN);
    expect(admin).toContain('requirePermission("settings.technical")');
    expect(admin.indexOf("requirePermission")).toBeLessThan(admin.indexOf('redirect("/admin/periodes")'));
    const gestion = lire(PAGE_GESTION);
    expect(gestion).toContain('requirePermission("sessions.manage")');
    expect(gestion.indexOf("requirePermission")).toBeLessThan(gestion.indexOf('redirect("/gestion/ateliers")'));
  });

  it("les six relais d'anciennes adresses ne gardent rien : la destination s'en charge", () => {
    for (const relais of RELAIS) {
      const code = lire(relais);
      expect(code, relais).not.toContain("requirePermission");
      expect(code, relais).toContain("redirect(");
    }
  });
});

describe("un lien qui rebondit sur /connexion/admin le dit", () => {
  it("les entrées « Nouvelle saison / période » du sélecteur annoncent le mot de passe admin", () => {
    const code = lire("src/components/filtres/SelecteurPeriode.tsx");
    expect(code).toContain('const MENTION_ADMIN = " (mot de passe admin)";');
    expect(code).toContain("<option value={CREER_SAISON}>Nouvelle saison…{MENTION_ADMIN}</option>");
    expect(code).toContain("<option value={CREER_PERIODE}>Nouvelle période…{MENTION_ADMIN}</option>");
  });

  it("« ouvre-en un d'abord » (séance sans trimestre) aussi", () => {
    const code = lire("src/app/(app)/seances/nouvelle/page.tsx");
    expect(code).toContain('href="/admin/periodes/nouvelle"');
    expect(code).toContain("(mot de passe admin)");
  });
});

describe("journal d'audit : des adresses propres", () => {
  const code = lire("src/app/(app)/admin/audit/page.tsx");

  it("ne concatène les filtres que s'il y en a", () => {
    // `?page=2&` (ou un `q=&du=&au=` sans objet) au bout de chaque lien de pagination
    expect(code).not.toContain("&${params}");
    expect(code).toContain("params ?");
    expect(code).toContain("avecFiltres(");
  });

  it("n'emporte que les filtres remplis", () => {
    expect(code).toMatch(/new URLSearchParams\(Object\.entries\(\{ q, du, au \}\)\.filter/);
  });
});

describe("chaque écran a une sortie", () => {
  it("la création d'une période ramène à la liste", () => {
    expect(lire("src/app/(app)/admin/periodes/nouvelle/page.tsx")).toContain('<Link href="/admin/periodes">← Périodes</Link>');
  });

  it("le lien qui quitte l'espace admin le dit dans son libellé", () => {
    expect(lire("src/app/(app)/admin/periodes/[id]/page.tsx")).toContain("Voir les séances (hors espace admin)");
  });

  it("le volet des événements est toujours rendu : sans lui, /evenements est inatteignable", () => {
    const entete = lire("src/components/layout/Entete.tsx");
    expect(entete).toContain("<PanneauEvenements aVenir={volet.aVenir}");
    expect(entete).not.toContain("{volet && <PanneauEvenements");
    // Plus de sortie anticipée : le volet vide dit « Aucun événement à venir pour le moment »
    expect(entete).not.toMatch(/if \(!equipe && aVenir\.length === 0/);
  });
});
