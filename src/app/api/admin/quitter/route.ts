import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getCurrentUser } from "@/lib/auth/current-user";
import { fermerElevation, refermerElevationSortie, signalerRetourElevation, signalerSortieElevation } from "@/lib/auth/elevation";
import { baseUrl } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * **L'application quittée referme l'espace admin**.
 *
 * Le navigateur prévient au moment où la page passe en arrière-plan ou se ferme
 * (`src/components/admin/FermerEnQuittant.tsx`, `navigator.sendBeacon`). On **note** la sortie, on
 * ne ferme pas : le même signal part quand on change simplement de page dans l'application, et
 * fermer sur-le-champ redemandait mot de passe et code au premier clic sur un lien. L'élévation
 * tombe si l'application ne s'est pas manifestée dans les deux minutes (`GRACE_SORTIE_ELEVATION_MS`,
 * tranché dans `getCurrentUser`). La session ordinaire, elle, n'est jamais touchée.
 *
 * **Une route, pas une action serveur** : `sendBeacon` est le seul envoi qu'un navigateur promet de
 * poster alors que la page disparaît, et il ne sait envoyer qu'une requête simple.
 *
 * **Ce qu'on vérifie quand même** : que la requête vient bien de l'application (`Sec-Fetch-Site`,
 * sinon l'`Origin`). Une requête forgée ne donnerait aucun droit — elle ne fait que *fermer* —
 * mais elle refermerait l'espace admin de quelqu'un en plein travail, et ça suffit pour l'exiger.
 */
export async function POST(requete: Request) {
  const entetes = await headers();
  const site = entetes.get("sec-fetch-site");
  const origine = entetes.get("origin");
  const memeSite = site ? site === "same-origin" : origine === baseUrl();
  if (!memeSite) return new NextResponse(null, { status: 403 });

  const user = await getCurrentUser();
  // Rien à noter : on répond quand même 204, une page qui se ferme n'a que faire d'une erreur.
  if (!user?.sessionForte) return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });

  /*
   * **Trois messages sur la même route**, parce que ce sont les trois moments d'une même absence.
   *
   * Sans `parti`, c'est le signal du départ : on **note**, on ne ferme pas (voir plus haut).
   * Avec `parti=1`, c'est l'application qui revient et qui déclare avoir été absente **plus
   * longtemps que la grâce** — ce que le serveur ne peut pas savoir seul : une application
   * installée qu'on rouvre restaure sa page sans rien lui demander, et sur iOS le signal du départ
   * se perd souvent en route. On referme alors pour de bon, côté serveur **et** en effaçant le
   * cookie sur la réponse, pour que rien ne subsiste de l'élévation.
   *
   * **Se déclarer parti ne donne aucun droit** : cette route ne sait que fermer. Au pire, quelqu'un
   * se déconnecte lui-même de l'espace admin — ce qu'un bouton fait déjà.
   */
  const parametres = new URL(requete.url).searchParams;
  const retour = parametres.get("retour");
  if (retour !== null) {
    /*
     * Troisième message : l'application **revient** et dit combien de temps elle a été absente.
     * Sous la grâce, la sortie notée est effacée ; au-delà, elle referme — comme `parti=1`.
     *
     * **Une durée qu'on ne sait pas lire est une longue absence**, et surtout pas un retour
     * immédiat. C'était l'inverse (`Math.max(0, Number(retour) || 0)` rendait zéro pour `NaN`,
     * `"abc"`, une chaîne vide ou une valeur négative) : une valeur illisible effaçait la sortie
     * notée, c'est-à-dire annulait le seul filet qui referme l'espace admin d'une application
     * partie sans pouvoir le dire. Rien d'exploitable là-dedans — cette route est gardée par
     * `Sec-Fetch-Site` / `Origin`, elle ne sait que *fermer*, et les échéances d'inactivité et de
     * durée restent vérifiées en base au-dessus d'elle —, mais le sens était à l'envers : dans le
     * doute on referme, au pire quelqu'un redonne mot de passe et code.
     */
    const texte = retour.trim();
    const absence = texte === "" ? Number.NaN : Number(texte);
    await signalerRetourElevation(user.sessionId, Number.isFinite(absence) && absence >= 0 ? absence : Number.MAX_SAFE_INTEGER);
  } else if (parametres.get("parti") === "1") {
    await refermerElevationSortie(user.sessionId);
    await fermerElevation();
  } else {
    await signalerSortieElevation(user.sessionId);
  }
  return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
