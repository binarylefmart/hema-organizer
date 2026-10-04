import { headers } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { assertPermission, type CurrentUser } from "@/lib/auth/current-user";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { HORIZON_LABELS_PASSE, lireHorizon } from "@/lib/horizon";
import { csvPresences, statsPeriode } from "@/lib/tableau-de-bord";
import { baseUrl } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Nom de fichier sûr : on ne laisse passer que lettres, chiffres et tirets.
 *
 * Le nom d'une période est saisi par le bureau, et il arrive ici dans un en-tête HTTP — un guillemet
 * ou un retour à la ligne y couperait l'en-tête en deux. Même règle qu'avant, appliquée au nom entier
 * plutôt qu'au seul nom de période, puisque la fenêtre de temps s'y ajoute désormais.
 */
function assainir(nom: string): string {
  return nom.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "");
}

/** Export CSV des présences d'une période (INSTRUCTEUR + ADMIN). */
/*
 * **Un GET qui écrit au journal d'audit demande la même garde d'origine qu'un POST**.
 *
 * Cette route journalise l'export (`audit(...)`) — une écriture — et les cookies sont en `SameSite=Lax`,
 * donc une **navigation de premier niveau** depuis un site tiers emporte la session *et* l'élévation. Un
 * administrateur élevé qui ouvre un lien piégé signait ainsi un export qu'il n'a pas fait : le journal
 * porte « export par lui » à une heure où il n'a rien exporté, et le fichier atterrit dans ses
 * téléchargements. Le tiers ne lit rien (aucun en-tête CORS, un CSV n'est pas lisible en JS
 * cross-origin) : l'atteinte porte sur **l'intégrité du récit du journal**, qui est précisément ce que ce
 * journal existe pour tenir.
 *
 * Même garde, même forme que `/api/admin/quitter` : `Sec-Fetch-Site` est un en-tête interdit côté script,
 * un site tiers ne peut donc pas le forger dans un navigateur ; à défaut, on compare l'`Origin`.
 */
function memeSite(entetes: Headers): boolean {
  const site = entetes.get("sec-fetch-site");
  const origine = entetes.get("origin");
  return site ? site === "same-origin" : origine === baseUrl();
}

export async function GET(req: NextRequest) {
  if (!memeSite(await headers())) return new NextResponse(null, { status: 403 });
  // `assertPermission` et non un `can()` recopié : la matrice est seule à décider, session forte
  // comprise (même raison qu'en tête de /api/export/audit).
  let user: CurrentUser;
  try {
    user = await assertPermission("exports.csv");
  } catch {
    return new NextResponse("Accès refusé", { status: 403 });
  }
  const periodId = req.nextUrl.searchParams.get("periode") ?? "";
  /*
   * **La fenêtre de temps voyage avec l'export**, comme la période.
   *
   * Le bouton n'envoyait que l'identifiant de la période : l'écran pouvait montrer « 1 mois » pendant
   * que le fichier téléchargé couvrait le trimestre entier. On clique sur « Exporter » en regardant
   * douze lignes, on ouvre un fichier qui en compte quarante, et on cherche l'erreur dans les
   * chiffres. `lireHorizon` retombe sur « toute la période » pour tout paramètre inconnu — l'export
   * garde donc son comportement d'avant quand rien n'est transmis.
   */
  const horizon = lireHorizon(req.nextUrl.searchParams.get("h") ?? undefined);
  // Les deux lectures sont indépendantes : le tableau de bord donne les colonnes, les lignes et les
  // taux (agrégats), la lecture brute donne la case « qui était là à cette séance » que seul le CSV
  // détaille. Rien à mutualiser de plus sans réécrire `statsPeriode`, mais rien n'oblige à attendre
  // la première pour lancer la seconde.
  //
  // **Cette lecture-ci n'a aucune borne de date, et elle n'en veut aucune** : une cellule du
  // fichier dit ce qui a été saisi pour ce cours-là, réponse cochée après coup comprise (le bureau
  // corrige depuis `/admin/presences`). C'est la règle tranchée — le remplissage d'une séance est
  // un fait, le taux d'une personne s'arrête à son arrivée, et c'est la colonne « Arrivée » qui
  // relie les deux (voir `csvPresences`). `csvPresences` décide seul quelles colonnes existent :
  // les séances déjà données, et elles seules.
  const [stats, brut] = await Promise.all([
    statsPeriode(periodId, new Date(), horizon),
    db.attendance.findMany({ where: { session: { periodId } }, select: { sessionId: true, userId: true, statut: true } }),
  ]);
  if (!stats) return new NextResponse("Période inconnue", { status: 404 });
  const parSeance = new Map<string, Map<string, string>>();
  for (const a of brut) {
    if (!parSeance.has(a.sessionId)) parSeance.set(a.sessionId, new Map());
    parSeance.get(a.sessionId)!.set(a.userId, a.statut);
  }
  await audit(user, "export.csv", periodId);
  const csv = "﻿" + csvPresences(stats, parSeance);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      // Le nom du fichier dit la fenêtre quand elle n'est pas le trimestre entier : deux exports de
      // la même période n'ont pas à s'appeler pareil et à se recouvrir dans le dossier des
      // téléchargements — le second passerait pour une copie du premier.
      "Content-Disposition": `attachment; filename="${assainir(`presences-${stats.period.nom}${horizon === "periode" ? "" : `-${HORIZON_LABELS_PASSE[horizon]}`}`)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
