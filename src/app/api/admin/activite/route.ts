import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getCurrentUser } from "@/lib/auth/current-user";
import { toucherElevation } from "@/lib/auth/elevation";
import { baseUrl } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * **On travaille dans l'espace admin sans changer de page** — cocher des lignes, faire défiler la
 * liste, remplir un formulaire. Le serveur ne voyait passer aucune requête, et les dix minutes
 * d'inactivité refermaient l'espace admin en plein travail. La page appelle donc cette route quand
 * elle voit un geste réel (`SortirApresInactivite`, au plus une fois toutes les 30 s), et l'échéance
 * est repoussée comme par une page de l'espace admin.
 *
 * **Ne donne aucun droit** : sans élévation ouverte, rien ne se passe ; une élévation déjà retombée
 * ne se rouvre pas (`getCurrentUser` l'a refermée avant qu'on arrive ici). Même vérification
 * d'origine que `/api/admin/quitter` : une requête forgée tiendrait l'espace admin de quelqu'un
 * ouvert plus longtemps.
 */
export async function POST() {
  const entetes = await headers();
  const site = entetes.get("sec-fetch-site");
  const origine = entetes.get("origin");
  const memeSite = site ? site === "same-origin" : origine === baseUrl();
  if (!memeSite) return new NextResponse(null, { status: 403 });
  const user = await getCurrentUser();
  if (user?.sessionForte) await toucherElevation(user.sessionId);
  return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
