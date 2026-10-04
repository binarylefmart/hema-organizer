import Link from "next/link";
import type { EtatCanal } from "@/lib/notifications/canaux";
import { Icone } from "@/components/ui/Icone";
import { Pastille } from "@/components/ui/Pastille";

/**
 * En-tête commun aux trois pages de configuration d'un canal (`/admin/notifications/{canal}`) :
 * retour aux notifications, titre, et l'état du canal tel que le voit le reste de l'application
 * (`src/lib/notifications/canaux.ts` — une seule source de vérité).
 */
export function EnTeteCanal({ etat, titre }: { etat: EtatCanal; titre: string }) {
  return (
    <div className="flex flex-col gap-2">
      <Link href="/admin/notifications" className="inline-flex min-h-11 items-center gap-1 self-start font-semibold text-lien">
        <Icone nom="fleche" taille={18} className="rotate-180" />
        Retour aux notifications
      </Link>
      <h1 className="text-3xl">{titre}</h1>
      <p className="flex flex-wrap items-center gap-2">
        <Pastille ton={etat.operationnel ? "vert" : "ocre"}>{etat.operationnel ? "prêt" : "non configuré"}</Pastille>
        <span className="text-texte-secondaire">{etat.resume}</span>
      </p>
      {etat.detail && <p className="text-sm text-texte-secondaire">{etat.detail}</p>}
    </div>
  );
}
