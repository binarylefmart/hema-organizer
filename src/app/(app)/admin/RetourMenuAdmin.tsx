"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icone } from "@/components/ui/Icone";

/**
 * **« ‹ Admin » : le retour au menu de l'espace admin, sur le téléphone seulement.**
 *
 * Il remplace les dix onglets en version téléphone : de n'importe quelle page de l'administration, on revient
 * au menu en liste (`/admin`) et l'on repart de là. Au-dessus, les onglets sont visibles et ce lien
 * n'a pas lieu d'être.
 *
 * Un composant client pour une seule raison : il se tait **sur le menu lui-même**, et le layout qui
 * le monte n'est pas re-rendu d'une page sœur à l'autre — seul `usePathname()` suit la navigation
 * (c'est le défaut raconté dans `LargeurEspaceAdmin`). Il ne reçoit rien de la session : le layout ne
 * le monte que pendant l'élévation.
 */
export function RetourMenuAdmin() {
  const chemin = usePathname();
  if (chemin === "/admin") return null;
  return (
    <Link
      href="/admin"
      className="-ml-1 inline-flex min-h-12 items-center gap-1 self-start pr-3 font-semibold no-underline ordi:hidden"
    >
      <Icone nom="chevronBas" taille={20} className="rotate-90" />
      {/* Le nom entendu dit où mène le lien ; l'œil, lui, a le chevron. */}
      <span className="sr-only">Retour au menu </span>
      Admin
    </Link>
  );
}
