/** Point d'entrée Next.js exécuté une fois au démarrage du serveur : règle la base, pose le fuseau du club, puis lance les tâches planifiées. */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { activerJournalWal } = await import("./lib/db");
  await activerJournalWal();
  // Le fuseau du club est posé par `demarrerTaches`, avant toute planification. Pas d'import direct
  // de `./lib/identite` ici : il faisait échouer `next build` (le fichier est aussi compilé pour le
  // runtime edge, où `node:crypto` n'existe pas), alors que l'import de `./lib/taches` passe.
  const { demarrerTaches } = await import("./lib/taches");
  await demarrerTaches();
}
