import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/current-user";
import { COOKIE_ECRAN, lireFormatEcran } from "@/components/ui/ecran";
import { GroupeListe, LigneLien } from "@/components/ui/ListeGroupee";
import { groupesVisibles } from "./menu-admin";
import { VersRubriqueSurOrdinateur } from "./VersRubriqueSurOrdinateur";

/**
 * **`/admin` : le menu de l'espace admin sur le téléphone, la première rubrique sur l'ordinateur.**
 *
 * Sur l'ordinateur, la section s'ouvre toujours sur les périodes : les onglets du layout sont la
 * navigation, et un menu au-dessus d'eux les répéterait. Sur le téléphone, ces dix onglets passaient
 * sur quatre lignes ; ils y sont remplacés par cette liste groupée (`ListeGroupee`) — une ligne de 56 px par rubrique,
 * façon réglages du téléphone — et chaque page de l'admin n'y garde qu'un lien « ‹ Admin » qui ramène
 * ici (`RetourMenuAdmin`).
 *
 * La permission est vérifiée **avant** tout rendu, comme sur `/gestion` (même règle, voir le
 * commentaire là-bas) : `/admin` est une entrée annoncée — l'en-tête la montre pendant l'élévation,
 * et l'adresse circule. Sans ce contrôle, un instructeur qui la tape recevait un renvoi vers un écran
 * chargé de lui dire non : un refus emprunté, et un aller-retour pour rien.
 */
export default async function PageAdmin() {
  const user = await requirePermission("settings.technical");
  // Un ordinateur déjà venu le dit par son cookie : il repart vers la rubrique sans passer par le menu.
  // Sans cookie (première visite), c'est le navigateur qui tranche au montage.
  if (lireFormatEcran((await cookies()).get(COOKIE_ECRAN)?.value) === "ordi") redirect("/admin/periodes");
  const groupes = groupesVisibles(user);
  return (
    <>
      <VersRubriqueSurOrdinateur vers="/admin/periodes" />
      {/* Masqué sur ordinateur : le temps que l'ordinateur reparte vers la rubrique, il ne
          montre rien plutôt qu'un menu qui disparaîtrait sous les yeux. */}
      <div className="flex flex-col gap-5 ordi:hidden">
        <h1 className="text-3xl">Espace admin</h1>
        {groupes.map((groupe) => (
          <GroupeListe key={groupe.titre} titre={groupe.titre}>
            {groupe.rubriques.map((r) => (
              <LigneLien key={r.href} href={r.href} icone={r.icone} titre={r.label} />
            ))}
          </GroupeListe>
        ))}
      </div>
    </>
  );
}
