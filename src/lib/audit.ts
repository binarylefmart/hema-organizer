import { db } from "./db";
import { clientIp } from "./request-info";

/**
 * Acteur d'une action journalisée. L'adresse email est **facultative** (`User.email` est nullable) :
 * le journal retient alors « sans email », jamais une case vide — l'identifiant du compte reste, lui,
 * toujours renseigné.
 */
export type AuditActeur = { id: string; email: string | null } | null;

/**
 * Journalise une action sensible. Ne lève jamais : l'audit ne doit pas bloquer l'app.
 */
export async function audit(
  acteur: AuditActeur,
  action: string,
  cible?: string | null,
  details?: Record<string, unknown> | string | null,
): Promise<void> {
  try {
    const ip = await clientIp().catch(() => null);
    await db.auditLog.create({
      data: {
        acteurId: acteur?.id ?? null,
        acteurEmail: acteur ? (acteur.email ?? "sans email") : "anonyme",
        action,
        cible: cible ?? null,
        details: details == null ? null : typeof details === "string" ? details : JSON.stringify(details),
        ip,
      },
    });
  } catch (e) {
    console.error("[audit] échec d'écriture", e);
  }
}
