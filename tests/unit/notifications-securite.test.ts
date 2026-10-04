import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **Les messages de sécurité sur le téléphone** (`src/lib/notifications/securite.ts`) : le doublon
 * des emails d'alerte, et rien de plus.
 *
 * Ce qui se vérifie ici tient au support : une notification s'affiche écran verrouillé, sous les
 * yeux de qui passe. Elle dit **qu'il s'est passé quelque chose et où regarder** — jamais qui,
 * jamais depuis où. C'est le point qui compte, et c'est ce que ces tests verrouillent, avec :
 * - une clé de journal **distincte de celle de l'email**, pour que les deux canaux se rejouent seuls ;
 * - l'idempotence (`NotificationLog.dedupKey`) : la même connexion ne prévient qu'une fois ;
 * - un service de push en panne qui ne fait jamais échouer ce qui l'a déclenché.
 *
 * L'alerte aux administrateurs, elle, est vérifiée de bout en bout (avec son email) dans
 * `email-facultatif.test.ts`, qui porte déjà le harnais de `alerterLienRevoque`.
 */

type LigneLog = { type: string; canal: string; userId: string | null; dedupKey: string; statut: string };

const faux = vi.hoisted(() => ({
  logs: [] as Array<Record<string, unknown>>,
  push: [] as Array<{ userId: string; titre: string; corps: string; url: string; tag?: string }>,
  pushEchoue: false,
}));

vi.mock("@/lib/db", () => ({
  db: {
    notificationLog: {
      findMany: vi.fn(async (args: { where: { dedupKey: { in: string[] } } }) =>
        faux.logs.filter((l) => args.where.dedupKey.in.includes(l.dedupKey as string)).map((l) => ({ dedupKey: l.dedupKey })),
      ),
      create: vi.fn(async ({ data }: { data: LigneLog }) => {
        if (faux.logs.some((l) => l.dedupKey === data.dedupKey)) throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
        faux.logs.push({ ...data });
        return data;
      }),
    },
  },
}));

vi.mock("@/lib/notifications/push", () => ({
  notifierPersonnes: vi.fn(async (userIds: readonly string[], charge: (id: string) => { titre: string; corps: string; url: string; tag?: string }) => {
    if (faux.pushEchoue) throw new Error("service de push injoignable");
    // Deux nombres : « appareils inscrits » et « appareils atteints ». C'est ce qui permet à
    // `notifierParPush` de distinguer « personne n'a branché de téléphone » (rien à reprendre) de «
    // les téléphones étaient là et l'envoi a échoué » (la clé se libère).
    const atteints = new Map<string, { appareils: number; atteints: number }>();
    for (const userId of userIds) {
      faux.push.push({ userId, ...charge(userId) });
      atteints.set(userId, { appareils: 1, atteints: 1 });
    }
    return atteints;
  }),
}));

const { chargeAlerteSecuritePush, chargeNouvelAppareilPush, alerterAdminsParPush, prevenirNouvelAppareilParPush } = await import(
  "@/lib/notifications/securite"
);

beforeEach(() => {
  faux.logs = [];
  faux.push = [];
  faux.pushEchoue = false;
});

describe("ce qui s'affiche sur un écran verrouillé", () => {
  it("dit ce qui s'est passé et où regarder, pour une alerte de sécurité", () => {
    const charge = chargeAlerteSecuritePush("Un lien d'accès a été révoqué automatiquement. Ouvre le journal d'audit.");
    expect(charge.titre).toBe("Alerte de sécurité");
    expect(charge.corps).toBe("Un lien d'accès a été révoqué automatiquement. Ouvre le journal d'audit.");
    expect(charge.url).toBe("/admin/audit");
    // Aucun regroupement : deux incidents distincts ne doivent pas s'effacer l'un l'autre à l'écran.
    expect(charge.tag).toBeUndefined();
  });

  it("dit la même chose à la personne pour une nouvelle connexion, sans nommer l'appareil", () => {
    const charge = chargeNouvelAppareilPush();
    expect(charge.titre).toBe("Nouvelle connexion à ton compte");
    expect(charge.corps).toBe("Un nouvel appareil vient d'ouvrir ta session. Si ce n'est pas toi, préviens le bureau.");
    expect(charge.url).toBe("/profil");
    expect(charge.tag).toBeUndefined();
  });

  /**
   * Le garde-fou de contenu : ces textes sont **fixes**. Une interpolation y ferait entrer, un jour,
   * le nom de l'appareil ou l'adresse IP que l'email est seul à avoir le droit de porter.
   */
  it("ne porte ni nom, ni adresse IP, ni appareil, ni jeton — et rien d'interpolé", () => {
    const textes = [chargeAlerteSecuritePush("Des liens d'accès inconnus ont été essayés en nombre. Ouvre le journal d'audit."), chargeNouvelAppareilPush()];
    for (const charge of textes) {
      const affiche = `${charge.titre} ${charge.corps}`;
      expect(affiche).not.toMatch(/\d+\.\d+\.\d+\.\d+/); // adresse IP
      expect(affiche).not.toMatch(/Chrome|Safari|Firefox|iPhone|Android|Windows/); // appareil
      expect(affiche).not.toMatch(/@/); // adresse email
    }
    const source = readFileSync(path.join(process.cwd(), "src/lib/notifications/securite.ts"), "utf8");
    const corpsNouvelAppareil = source.slice(source.indexOf("export function chargeNouvelAppareilPush"));
    expect(corpsNouvelAppareil.slice(0, corpsNouvelAppareil.indexOf("\n}"))).not.toContain("${");
  });
});

describe("nouvelle connexion, sur les autres appareils de la personne", () => {
  const CLE = "nouvel_appareil_push_i-1_2_u-chloe";

  it("part une fois, avec sa propre clé de journal", async () => {
    expect(await prevenirNouvelAppareilParPush("u-chloe", CLE)).toBe(1);
    expect(faux.push).toEqual([
      {
        userId: "u-chloe",
        titre: "Nouvelle connexion à ton compte",
        corps: "Un nouvel appareil vient d'ouvrir ta session. Si ce n'est pas toi, préviens le bureau.",
        url: "/profil",
      },
    ]);
    expect(faux.logs).toEqual([{ type: "NOUVEL_APPAREIL", canal: "PUSH", sessionId: null, userId: "u-chloe", dedupKey: CLE, statut: "ENVOYE", erreur: null }]);
  });

  it("ne prévient pas deux fois pour la même ouverture, mais bien pour la suivante", async () => {
    await prevenirNouvelAppareilParPush("u-chloe", CLE);
    expect(await prevenirNouvelAppareilParPush("u-chloe", CLE)).toBe(0);
    expect(faux.push).toHaveLength(1);
    // Un appareil de plus le lendemain : rang différent, donc clé différente, donc elle repart.
    await prevenirNouvelAppareilParPush("u-chloe", "nouvel_appareil_push_i-1_3_u-chloe");
    expect(faux.push).toHaveLength(2);
  });

  it("ne remonte rien quand le service de push est en panne", async () => {
    faux.pushEchoue = true;
    // Elle ne lève pas : elle rend 0 et écrit dans les journaux du serveur. La connexion qui l'a
    // déclenchée ne doit jamais tomber parce qu'un service de push est indisponible.
    await expect(prevenirNouvelAppareilParPush("u-chloe", CLE)).resolves.toBe(0);
    expect(faux.push).toHaveLength(0);
  });
});

describe("alerte aux administrateurs", () => {
  it("pose une clé par personne, dérivée de celle de l'email sans jamais s'y confondre", async () => {
    const admins = [{ id: "u-admin" }, { id: "u-echo" }];
    await alerterAdminsParPush(admins, "alerte_lien_i-9", "Un lien d'accès a été révoqué automatiquement. Ouvre le journal d'audit.");
    expect(faux.logs.map((l) => l.dedupKey)).toEqual(["alerte_lien_i-9_push_u-admin", "alerte_lien_i-9_push_u-echo"]);
    expect(faux.logs.map((l) => l.dedupKey)).not.toContain("alerte_lien_i-9");
    expect(faux.logs.every((l) => l.canal === "PUSH")).toBe(true);
  });

  it("reprend un administrateur qui branche son téléphone entre deux incidents", async () => {
    await alerterAdminsParPush([{ id: "u-admin" }], "alerte_lien_i-9", "Un lien d'accès a été révoqué automatiquement. Ouvre le journal d'audit.");
    faux.push = [];
    // Même alerte, l'équipe a grandi : seul le nouveau venu est prévenu.
    await alerterAdminsParPush([{ id: "u-admin" }, { id: "u-echo" }], "alerte_lien_i-9", "Un lien d'accès a été révoqué automatiquement. Ouvre le journal d'audit.");
    expect(faux.push.map((p) => p.userId)).toEqual(["u-echo"]);
  });
});

/**
 * **Les deux messages qui n'auront jamais de version téléphone**. Le test est là pour que personne
 * ne « complète » un jour ces chemins par symétrie avec les autres messages de sécurité : un lien
 * de connexion n'a rien à faire sur un écran verrouillé, et qui a perdu son mot de passe n'a par
 * définition aucun appareil abonné qui l'attende.
 */
describe("email seul, volontairement", () => {
  const lire = (fichier: string) => readFileSync(path.join(process.cwd(), fichier), "utf8");

  it("le lien d'accès personnel ne part jamais sur le téléphone", () => {
    const code = lire("src/lib/invitations.ts").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).toMatch(/enqueueEmail\(/);
    expect(code).not.toMatch(/notifierParPush|notifications\/securite/);
  });

  it("le mot de passe oublié non plus", () => {
    const source = lire("src/actions/auth.ts");
    const depuis = source.slice(source.indexOf("export async function demanderReinitialisation"));
    const fonction = depuis.slice(0, depuis.indexOf("\n}\n"));
    expect(fonction).toMatch(/enqueueEmail\(/);
    expect(fonction).not.toMatch(/Push|push/);
  });

  /** …alors que la nouvelle connexion, elle, est bien doublée, et sans dépendre de l'adresse email. */
  it("mais la nouvelle connexion l'est, même pour un compte sans adresse", () => {
    const source = lire("src/actions/auth.ts");
    const depuis = source.slice(source.indexOf("export async function connexionParInvitation"));
    const fonction = depuis.slice(0, depuis.indexOf("\n}\n"));
    expect(fonction).toMatch(/await prevenirNouvelAppareilParPush\(user\.id, `nouvel_appareil_push_/);
    // L'email reste sous sa garde d'adresse ; la notification, elle, est en dehors.
    const gardeEmail = fonction.indexOf("if (user.email) {");
    const envoiPush = fonction.indexOf("prevenirNouvelAppareilParPush");
    expect(gardeEmail).toBeGreaterThan(-1);
    expect(envoiPush).toBeGreaterThan(fonction.indexOf("}", gardeEmail));
  });
});
