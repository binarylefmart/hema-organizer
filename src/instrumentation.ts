/** Point d'entrée Next.js exécuté une fois au démarrage du serveur : lance les tâches planifiées. */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { demarrerTaches } = await import("./lib/taches");
  await demarrerTaches();
}
