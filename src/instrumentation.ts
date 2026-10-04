/** Point d'entrée Next.js exécuté une fois au démarrage du serveur : règle la base, puis lance les tâches planifiées. */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { activerJournalWal } = await import("./lib/db");
  await activerJournalWal();
  const { demarrerTaches } = await import("./lib/taches");
  await demarrerTaches();
}
