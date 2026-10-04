import { describe, expect, it } from "vitest";

/**
 * **Le parcours d'entrée** : quand il se montre, et quand il se tait.
 *
 * La règle, décidée par Delta : on ne repropose pas le parcours à chaque connexion — ce serait un
 * péage. Le marqueur est porté par l'**invitation** (`Invitation.parcoursVuLe`) et non par la
 * personne.
 *
 * **Précisé** : un lien neuf ne le rejoue plus systématiquement. « Régénérer et envoyer » renvoie
 * un lien, rien de plus ; seule la **remise à zéro de l'accès** — qui efface mot de passe et double
 * authentification — relance le parcours entier. C'est décidé à la création du lien
 * (`OptionsEnvoi.parcours`, voir `parcours-lien-renvoye.test.ts`) ; ce fichier-ci ne juge que ce
 * qu'on fait du marqueur une fois le lien ouvert.
 */

/**
 * La règle est importée **depuis `src/lib/`** et non depuis `src/actions/auth.ts` : dans un fichier
 * `"use server"`, tout `export async function` est une route appelable de l'extérieur — y exposer
 * une fonction « pour les tests » revenait à livrer du code de test en production.
 */
const { apresInvitation } = await import("@/lib/auth/apres-invitation");

const DEJA_VU = new Date("2026-09-01T10:00:00Z");

describe("où mène l'ouverture d'un lien", () => {
  it("montre le parcours quand ce lien-ci ne l'a pas encore montré", () => {
    expect(apresInvitation(null, "/")).toBe("/bienvenue");
  });

  it("emporte la destination demandée au passage (bouton d'un email de rappel)", () => {
    expect(apresInvitation(null, "/seances")).toBe("/bienvenue?suite=%2Fseances");
  });

  /** Le point d'attention : revenir ne doit **pas** coûter un clic de plus. */
  it("mène droit à l'accueil quand le parcours a déjà été vu pour ce lien", () => {
    expect(apresInvitation(DEJA_VU, "/")).toBe("/");
    expect(apresInvitation(DEJA_VU, "/planning")).toBe("/planning");
  });

  it("ne laisse jamais sortir du site, parcours vu ou non", () => {
    expect(apresInvitation(DEJA_VU, "https://evil.tld")).toBe("/");
    expect(apresInvitation(null, "//evil.tld")).toBe("/bienvenue");
  });
});

/**
 * **Le régime strict des administrateurs** : mot de passe et double authentification sont
 * facultatifs pour un membre ou un instructeur, **obligatoires pour un ADMIN** — l'espace admin
 * n'ouvre qu'avec les deux. Son lien personnel le connecte quand même, comme tout le monde ; c'est
 * la destination qui change.
 */
describe("un administrateur non réglé est déposé sur son réglage", () => {
  it("remplace la page demandée par /admin/activer", () => {
    expect(apresInvitation(DEJA_VU, "/planning", true)).toBe("/admin/activer");
    expect(apresInvitation(DEJA_VU, "/", true)).toBe("/admin/activer");
  });

  it("garde le parcours d'accueil devant, en lui portant le réglage", () => {
    // La question de l'installation parle de son téléphone, pas de ses droits : on ne la lui prend
    // pas. Elle passe d'abord, et dépose sur le réglage en sortant.
    expect(apresInvitation(null, "/planning", true)).toBe("/bienvenue?suite=%2Fadmin%2Factiver");
  });

  it("ne change rien pour qui n'est pas concerné", () => {
    expect(apresInvitation(DEJA_VU, "/planning", false)).toBe("/planning");
    expect(apresInvitation(DEJA_VU, "/planning")).toBe("/planning");
  });
});

describe("l'écran de bienvenue ne propose pas à un administrateur ce qui lui est imposé", () => {
  it("saute l'étape « consolider » quand le réglage admin est dû", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const parcours = fs.readFileSync(path.join(process.cwd(), "src/app/(app)/bienvenue/ParcoursAccueil.tsx"), "utf8");
    // Sinon il réglerait deux fois la même chose, la première fois sous le mot « facultatif »
    expect(parcours).toContain("const consolidationDue = aUnEmail && !aDejaUnMotDePasse && !reglageAdminDu;");
  });

  it("calcule ce réglage côté serveur, sur le compte et non sur un paramètre", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const page = fs.readFileSync(path.join(process.cwd(), "src/app/(app)/bienvenue/page.tsx"), "utf8");
    expect(page).toContain("peutReglerSonAcces(compte)");
    expect(page).toContain("accesAdminRegle(compte)");
  });
});

describe("le marqueur est sur l'invitation, pas sur la personne", () => {
  it("se pose à l'ouverture du lien, avant que le parcours soit suivi", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const action = fs.readFileSync(path.join(process.cwd(), "src/actions/auth.ts"), "utf8");
    const bloc = action.slice(action.indexOf("export async function connexionParInvitation"));
    const corps = bloc.slice(0, bloc.indexOf("\n}\n"));
    // Posé dès que le parcours est montré : quelqu'un qui l'abandonne en route ne le revoit pas
    expect(corps).toContain("if (!parcoursVuLe) {");
    expect(corps).toContain("await marquerParcoursVu(id);");
    // …et c'est bien le marqueur de l'invitation qui décide de la destination
    expect(corps).toContain("redirect(apresInvitation(parcoursVuLe, destination, reglageAdminDu));");
    // L'ancien déclencheur (« premier accès de la personne ») ne doit plus servir à router
    expect(corps).not.toContain("apresInvitation(usedAt");
  });

  it("écrit sur la ligne du lien, jamais sur le compte", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const lib = fs.readFileSync(path.join(process.cwd(), "src/lib/invitations.ts"), "utf8");
    const depuis = lib.slice(lib.indexOf("export async function marquerParcoursVu"));
    const fonction = depuis.slice(0, depuis.indexOf("\n}\n"));
    expect(fonction).toContain("db.invitation.update({ where: { id: invitationId }");
    expect(fonction).not.toContain("db.user.update");
    // L'échec d'écriture ne remonte toujours pas à la personne — elle entre — mais il ne s'évapore
    // plus : sans le marqueur, le parcours se remontre à chaque ouverture du même lien, et il faut
    // une trace pour le comprendre (même traitement que `renouvelerLiensExpirants`).
    expect(fonction).toContain("console.error(");
    expect(fonction).not.toContain(".catch(() => {})");
  });
});
