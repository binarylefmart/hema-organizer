import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * **Le désistement non signalé** : une case du registre, cochée à la main par le bureau. Ses verrous,
 * relus dans la source de l'action (les autres tests du dossier font de même pour les envois).
 */
const source = readFileSync(path.join(process.cwd(), "src/actions/presences.ts"), "utf8");
const action = source.slice(source.indexOf("export async function noterDesistementNonSignale("));

describe("noterDesistementNonSignale", () => {
  it("exige la permission du registre (donc l'espace admin ouvert)", () => {
    expect(action).toMatch(/assertPermission\("attendances\.autrui"\)/);
  });
  it("ne se coche qu'une fois le cours commencé, et pour une personne inscrite Présent", () => {
    expect(action).toMatch(/seanceCommencee\(session\.date, session\.heureDebut\)/);
    expect(action).toMatch(/statut !== "PRESENT"/);
  });
  it("ne touche pas à la réponse de la personne", () => {
    expect(action).not.toMatch(/db\.attendance\.(upsert|update|delete)/);
  });
  it("laisse une trace au journal, dans les deux sens", () => {
    expect(action).toContain('"presence.desistement_non_signale"');
    expect(action).toContain('"presence.desistement_non_signale_retire"');
  });
});

describe("le registre", () => {
  const registre = readFileSync(path.join(process.cwd(), "src/components/gestion/PresencesEquipe.tsx"), "utf8");
  it("propose « Pas venu » sur une ligne Présent seulement : un bouton en toutes lettres, à l'écart des réponses", () => {
    expect(registre).toMatch(/nonSignales\?\.possible && \(statut === "PRESENT"/);
    expect(registre).toMatch(/aria-pressed=\{pasVenus\.has\(p\.id\)\}/);
    expect(registre).toMatch(/border-l-2 border-bordure pl-3/);
    expect(registre).toMatch(/>\s*Pas venu\s*<\/button>/);
  });
});
