/**
 * Secours : réinitialise la double authentification d'un compte (téléphone perdu, plus aucun admin
 * joignable, ou **secret devenu illisible** après une rotation de `SESSION_SECRET` — c'est la sortie que
 * nomment `/admin/activer` et l'écran de connexion dans ce cas).
 *
 * Usage : npm run admin:reset-2fa -- admin@exemple.fr            ← montre ce qui serait fait, n'écrit rien
 *         npm run admin:reset-2fa -- admin@exemple.fr --confirmer ← écrit
 *
 * À la prochaine connexion, un nouveau QR code lui sera proposé. Ses sessions sont fermées.
 *
 * **Il n'écrit rien sans `--confirmer`**. Il désarme le second facteur d'un compte à partir d'une
 * adresse tapée à la main, sans rien demander et sans rien montrer : une faute de frappe sur une
 * adresse voisine ouvrait le compte de quelqu'un d'autre au seul mot de passe, en silence. Un
 * affichage d'abord — qui, quel rôle, ce qu'il perd —, l'écriture ensuite. Le drapeau plutôt qu'une
 * question au clavier : le script tourne aussi dans un `docker exec` sans terminal.
 *
 * Son en-tête disait « d'un administrateur » alors qu'il agit sur **n'importe quel compte**. Le rôle n'est
 * pas restreint, et c'est volontaire : un membre qui a activé la double authentification de lui-même et
 * perdu son téléphone a besoin de la même sortie. Mais le texte le dit, maintenant.
 *
 * Tout le corps tient dans `main()` : `tsx` compile les scripts de ce dossier en CommonJS (le projet
 * n'est pas un module ES), et un `await` de haut niveau y empêchait le script de démarrer — c'est-à-dire
 * le jour précis où l'on en a besoin. Les autres scripts de `scripts/` suivent déjà ce moule.
 */
import { PrismaClient } from "@prisma/client";

async function main(): Promise<void> {
  const arguments_ = process.argv.slice(2);
  const confirme = arguments_.includes("--confirmer");
  const email = arguments_.find((a) => !a.startsWith("--"))?.toLowerCase();
  if (!email) {
    console.error("Usage : npm run admin:reset-2fa -- <email> [--confirmer]");
    process.exit(1);
  }
  const db = new PrismaClient();
  try {
    const user = await db.user.findUnique({ where: { email } });
    if (!user) {
      console.error(`Aucun compte pour ${email}`);
      process.exit(1);
    }
    if (!confirme) {
      console.info(`Compte visé  : ${user.prenom} ${user.nom} <${user.email}> — rôle ${user.role}${user.actif ? "" : " (désactivé)"}`);
      console.info(`Double auth. : ${user.totpSecret ? "configurée" : "absente"}${user.codesSecours ? ", codes de secours posés" : ""}`);
      console.info("Ce qui serait fait : secret et codes de secours effacés, toutes ses sessions fermées.");
      console.info("Rien n'a été écrit. Relance avec --confirmer si c'est bien ce compte.");
      return;
    }
    await db.$transaction([
      db.user.update({ where: { id: user.id }, data: { totpSecret: null, totpActiveAt: null, codesSecours: null } }),
      db.authSession.deleteMany({ where: { userId: user.id } }),
      db.auditLog.create({ data: { acteurEmail: "cli", action: "deux_fa.reinitialisee", cible: user.id, details: JSON.stringify({ email, via: "scripts/reset-2fa.ts" }) } }),
    ]);
    console.info(`Double authentification réinitialisée pour ${email}.`);
  } finally {
    // Une erreur ne doit pas laisser la connexion ouverte : le script sert en situation d'urgence.
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
