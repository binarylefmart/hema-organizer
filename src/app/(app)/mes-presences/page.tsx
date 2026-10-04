import { redirect } from "next/navigation";

/** Ancienne adresse de l'historique : désormais un volet de l'onglet Présences. */
export default function PageMesPresences() {
  redirect("/seances?vue=historique");
}
