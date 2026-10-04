import { describe, expect, it } from "vitest";
import { baseUrl } from "@/lib/env";
import { texteSeance, TITRE_ANNULATION, TITRE_RECAP } from "@/lib/notifications/contenu";
import {
  partagePlanning,
  partageSeance,
  titrePartageSeance,
  TITRE_AUJOURDHUI,
  TITRE_COURS,
  TITRE_PLANNING,
  type SeanceAPartager,
} from "@/components/partage/contenu";

/**
 * **Boutons de partage** (`src/components/partage/`) : ce qui part réellement quand on appuie.
 *
 * Trois promesses sont vérifiées ici :
 * 1. le message n'est pas réécrit : c'est le **contenu commun** des notifications
 *    (`src/lib/notifications/contenu.ts`), celui de l'email de récap et de l'embed Discord ;
 * 2. le lien `wa.me` est bien formé — une fois **décodé**, il rend exactement le message suivi du
 *    lien public, celui qui ouvre `/partage/seance/<id>` sans connexion ;
 * 3. **rien de nominatif** ne s'y glisse : le partage ne reçoit que les chiffres globaux, jamais la
 *    liste des participants ni un instructeur.
 */

const SEANCE: SeanceAPartager = {
  id: "seance-42",
  date: "2026-09-24",
  heureDebut: "19:30",
  heureFin: "21:30",
  lieu: "Gymnase municipal",
  theme: "Messer — garde haute",
  alternative: "",
  disciplines: "Messer, Épée longue",
  annulee: false,
  motifAnnulation: null,
  compteurs: { presents: 13, invites: 18 },
};

/** Le texte tel que WhatsApp le recevra : `wa.me/?text=…` décodé. */
function texteDuLien(whatsapp: string): string {
  const url = new URL(whatsapp);
  expect(url.origin + url.pathname).toBe("https://wa.me/");
  return url.searchParams.get("text") ?? "";
}

describe("partage d'une séance", () => {
  it("reprend mot pour mot le contenu commun des notifications", () => {
    const p = partageSeance(SEANCE, "2026-09-23");
    expect(p.texte).toBe(texteSeance(SEANCE, SEANCE.compteurs, TITRE_RECAP));
    expect(p.texte).toContain("📅 Jeudi 24 septembre 2026 — 19h30 à 21h30");
    expect(p.texte).toContain("📍 Gymnase municipal");
    expect(p.texte).toContain("📖 Messer — garde haute");
    expect(p.texte).toContain("✅ 13 présents / 18 — 72 %");
  });

  it("pointe la page publique de la séance", () => {
    const p = partageSeance(SEANCE, "2026-09-23");
    expect(p.url).toBe(`${baseUrl()}/partage/seance/seance-42`);
  });

  it("construit un lien wa.me qui porte le message puis le lien", () => {
    const p = partageSeance(SEANCE, "2026-09-23");
    expect(texteDuLien(p.whatsapp)).toBe(`${p.texte}\n${p.url}`);
    // Encodage : ni espace ni retour à la ligne bruts dans l'URL
    expect(p.whatsapp).not.toMatch(/[ \n]/);
    expect(p.whatsapp).toContain("%0A");
  });

  it("titre le message selon la proximité du cours", () => {
    expect(titrePartageSeance(SEANCE, "2026-09-24")).toBe(TITRE_AUJOURDHUI);
    expect(titrePartageSeance(SEANCE, "2026-09-23")).toBe(TITRE_RECAP);
    expect(titrePartageSeance(SEANCE, "2026-09-01")).toBe(TITRE_COURS);
    expect(titrePartageSeance({ ...SEANCE, annulee: true }, "2026-09-23")).toBe(TITRE_ANNULATION);
  });

  it("remplace les chiffres par le motif quand la séance est annulée", () => {
    const p = partageSeance({ ...SEANCE, annulee: true, motifAnnulation: "Salle indisponible" }, "2026-09-23");
    expect(p.texte.startsWith(TITRE_ANNULATION)).toBe(true);
    expect(p.texte).toContain("💬 Salle indisponible");
    expect(p.texte).not.toContain("présents");
    expect(p.texte).toContain("📅 Jeudi 24 septembre 2026 — 19h30 à 21h30");
  });

  it("annonce un motif absent plutôt que de laisser un blanc", () => {
    const p = partageSeance({ ...SEANCE, annulee: true, motifAnnulation: "   " }, "2026-09-23");
    expect(p.texte).toContain("💬 motif non précisé");
  });

  it("se rabat sur les disciplines du planning quand aucun thème n'est saisi", () => {
    const p = partageSeance({ ...SEANCE, theme: "" }, "2026-09-23");
    expect(p.texte).toContain("📖 Messer · Épée longue");
  });

  it("ne laisse passer aucun nom de personne", () => {
    // Le type même du partage n'a pas de place pour un nom : on le vérifie sur le texte produit,
    // en glissant des champs nominatifs qu'une régression pourrait recopier par mégarde.
    const p = partageSeance({ ...SEANCE, ...({ instructeurs: ["Charlie 03"], participants: ["Alice Dupont"] } as object) }, "2026-09-23");
    expect(p.texte).not.toContain("Charlie");
    expect(p.texte).not.toContain("Alice");
    expect(texteDuLien(p.whatsapp)).not.toContain("03");
  });
});

describe("partage d'un planning", () => {
  const PERIODE = { periodeId: "periode-1", periodeNom: "T1 2026-2027", aVenir: 8, prochaine: SEANCE };

  it("pointe la page publique de la période et annonce ce qui reste", () => {
    const p = partagePlanning(PERIODE);
    expect(p.url).toBe(`${baseUrl()}/partage/planning/periode-1`);
    expect(p.titre).toBe(TITRE_PLANNING);
    expect(p.texte).toContain("📅 Période « T1 2026-2027 » — 8 séances à venir");
    expect(p.texte).toContain("👉 Prochaine : Jeudi 24 septembre 2026 — 19h30 à 21h30");
    expect(p.texte).toContain("📍 Gymnase municipal");
    expect(texteDuLien(p.whatsapp)).toBe(`${p.texte}\n${p.url}`);
  });

  it("accorde le singulier et tait la prochaine séance quand il n'y en a pas", () => {
    expect(partagePlanning({ ...PERIODE, aVenir: 1 }).texte).toContain("— 1 séance à venir");
    const vide = partagePlanning({ ...PERIODE, aVenir: 0, prochaine: null });
    expect(vide.texte).toContain("aucune séance à venir");
    expect(vide.texte).not.toContain("Prochaine");
  });
});
