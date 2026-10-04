import { redirect } from "next/navigation";

/** Ancienne adresse : le formulaire est désormais en haut de l'onglet Atelier. */
export default function PageProposer() {
  redirect("/ateliers");
}
