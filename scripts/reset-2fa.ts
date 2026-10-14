/**
 * Secours : réinitialise la double authentification d'un compte (téléphone perdu, plus aucun admin
 * joignable, ou **secret devenu illisible** après une rotation de `SESSION_SECRET` — c'est la sortie que
 * nomment `/admin/activer` et l'écran de connexion dans ce cas).
 *
 * Usage : npm run admin:reset-2fa -- admin@exemple.fr            ← montre ce qui serait fait, n'écrit rien
 *         npm run admin:reset-2fa -- admin@exemple.fr --confirmer ← écrit
 *
 * Un nouveau QR code lui sera proposé à l'ouverture de l'espace admin. Ses sessions sont fermées.
 *
 * **Membre du bureau nominatif** : le script affiche aussi son **code d'activation** (48 h, usage
 * unique), sans lequel l'étape 2 de `/admin/activer` refuse — à lui remettre de vive voix ou en main
 * propre, jamais par email. Il faut pour cela `SESSION_SECRET` dans l'environnement (celui de
 * l'application : l'empreinte du code en dépend). Le compte du portail n'en a pas besoin.
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
import { DUREE_CODE_ACTIVATION_MS, empreinteCodeActivation, exigeCodeActivation, formaterCodeActivation, genererCodeActivation } from "../src/lib/auth/code-activation";

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
      console.info(
        `Ce qui serait fait : secret et codes de secours effacés, toutes ses sessions fermées${exigeCodeActivation(user) ? ", et un code d'activation affiché ici (à lui remettre de vive voix)" : ""}.`,
      );
      console.info("Rien n'a été écrit. Relance avec --confirmer si c'est bien ce compte.");
      return;
    }
    // Le code d'activation du membre du bureau nominatif : sans `SESSION_SECRET`, impossible d'en
    // calculer l'empreinte — on le dit, et on n'écrit rien plutôt que de laisser la personne bloquée.
    const secretSession = process.env.SESSION_SECRET;
    const avecCode = exigeCodeActivation(user);
    if (avecCode && (!secretSession || secretSession.length < 32)) {
      console.error("SESSION_SECRET est absent : impossible de générer le code d'activation de ce membre du bureau. Rien n'a été écrit.");
      process.exit(1);
    }
    const code = avecCode ? genererCodeActivation() : null;
    const expireLe = new Date(Date.now() + DUREE_CODE_ACTIVATION_MS);
    await db.$transaction([
      db.user.update({
        where: { id: user.id },
        data: {
          totpSecret: null,
          totpActiveAt: null,
          codesSecours: null,
          ...(code ? { codeActivationHash: empreinteCodeActivation(user.id, code, secretSession!), codeActivationExpireLe: expireLe } : {}),
        },
      }),
      db.authSession.deleteMany({ where: { userId: user.id } }),
      db.auditLog.create({ data: { acteurEmail: "cli", action: "deux_fa.reinitialisee", cible: user.id, details: JSON.stringify({ email, via: "scripts/reset-2fa.ts" }) } }),
      ...(code
        ? [db.auditLog.create({ data: { acteurEmail: "cli", action: "deux_fa.code_activation_genere", cible: user.id, details: JSON.stringify({ echeance: expireLe.toISOString(), origine: "cli" }) } })]
        : []),
    ]);
    console.info(`Double authentification réinitialisée pour ${email}.`);
    if (code) {
      console.info(`Code d'activation : ${formaterCodeActivation(code)} — valable jusqu'au ${expireLe.toLocaleString("fr-FR")}, une seule fois.`);
      console.info("À lui remettre de vive voix ou en main propre, jamais par email.");
    }
  } finally {
    // Une erreur ne doit pas laisser la connexion ouverte : le script sert en situation d'urgence.
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
