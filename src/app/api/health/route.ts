import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Sonde de santé (healthcheck Docker) : 200 si l'application **peut servir** et si la base est
 * accessible.
 *
 * **Deux conditions, parce qu'une seule mentait**. La sonde ne regardait que la base : un conteneur
 * dont la configuration est refusée par `env()` — `DOMAIN` local avec `NODE_ENV=production`,
 * `SESSION_SECRET` trop court — démarrait, répondait `{"ok":true}` toutes les 30 secondes, et
 * jetait une erreur de configuration à la première requête qui a besoin du domaine ou du secret :
 * c'est-à-dire dès la pose du cookie de session, donc personne ne pouvait entrer. Docker et
 * Portainer affichaient *healthy* sur une pile bonne à rien — c'est le `docker-compose.yml` de
 * développement qui s'est cassé là-dessus. Un contrôle de santé qui ne peut rien dire de la
 * configuration ne protège que de la moitié des pannes.
 *
 * **Ni bavarde, ni fragile.** La réponse reste un booléen et un mot : `configuration` ou `base`,
 * jamais un nom de variable ni une valeur — le détail part au journal du conteneur, que
 * l'administrateur lit déjà (`docker logs`). Et `env()` est une validation **pure et mise en cache**,
 * sans disque ni réseau : elle rend le même verdict à la première seconde qu'à la millième, donc la
 * sonde reste verte au démarrage comme en régime. Ce qu'elle ne fait pas : essayer d'envoyer un
 * email, joindre Discord ou compter des lignes — une dépendance facultative en panne n'a jamais eu
 * le droit de faire redémarrer le club.
 *
 * **Volontairement sans limiteur de débit**, contrairement aux autres routes publiques. Deux
 * raisons qui vont dans le même sens : le limiteur du projet est **persistant en base** (table
 * `RateLimit`, un `upsert` par appel), donc le poser ici rendrait la sonde *plus* coûteuse que le
 * `SELECT 1` qu'elle exécute — on paierait une écriture pour protéger une lecture ; et cette route
 * est appelée toutes les 30 s par Docker depuis `127.0.0.1`, un quota mal réglé ferait redémarrer
 * le conteneur en boucle. Ce qu'elle expose est un booléen : pas de fuite, du débit. La borne, s'il
 * en faut une, va dans le `limit_req` du proxy (voir `docs/SECURITE.md`).
 */
export async function GET() {
  try {
    env();
  } catch (e) {
    console.error("[health] configuration refusée — l'application ne peut pas servir", e);
    return NextResponse.json({ ok: false, erreur: "configuration" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  try {
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[health] base inaccessible", e);
    return NextResponse.json({ ok: false, erreur: "base" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
