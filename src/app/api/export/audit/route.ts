import { headers } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { assertPermission, type CurrentUser } from "@/lib/auth/current-user";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { csvAudit } from "@/lib/alertes";
import { lireFiltresAudit, orderByAudit, whereAudit } from "@/lib/audit-filtres";
import { baseUrl } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Export CSV du journal d'audit (ADMIN, session forte) : filtre texte `q`, bornes `du` / `au` (AAAA-MM-JJ), 50 000 lignes max. */
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
  /*
   * `assertPermission` et non un contrôle recopié à la main. Il refaisait exactement le même
   * raisonnement — rôle, puis session forte — mais depuis un second endroit : le jour où la liste
   * des exceptions (`SANS_SESSION_FORTE`) bougerait, la matrice changerait d'avis et cette route,
   * non. Une seule tête décide.
   */
  let user: CurrentUser;
  try {
    user = await assertPermission("audit.view");
  } catch {
    return new NextResponse("Accès refusé", { status: 403 });
  }
  const p = req.nextUrl.searchParams;
  // Le même lecteur que l'écran : raccourcis, personne, dates et tri compris.
  const f = lireFiltresAudit({ q: p.get("q"), du: p.get("du"), au: p.get("au"), personne: p.get("personne"), tri: p.get("tri") });
  const lignes = await db.auditLog.findMany({ where: whereAudit(f), orderBy: orderByAudit(f.tri), take: 50_000 });
  await audit(user, "export.audit", null, { ...f, lignes: lignes.length });
  return new NextResponse("﻿" + csvAudit(lignes), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="audit-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
