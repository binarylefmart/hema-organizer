import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/current-user";

/**
 * `/admin` n'a pas d'écran à elle : la section s'ouvre sur les paramètres techniques.
 *
 * La permission est vérifiée **avant** de rediriger, comme sur `/gestion` (même règle, voir le
 * commentaire là-bas) : `/admin` est une entrée annoncée — l'en-tête la montre pendant l'élévation,
 * et l'adresse circule. Sans ce contrôle, un instructeur qui la tape recevait une redirection (307)
 * vers un écran chargé de lui dire non : un refus emprunté, et un aller-retour pour rien.
 */
export default async function PageAdmin() {
  await requirePermission("settings.technical");
  redirect("/admin/periodes");
}
