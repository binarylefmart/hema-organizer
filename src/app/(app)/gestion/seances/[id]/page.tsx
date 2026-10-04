import { redirect } from "next/navigation";

/** La fiche d'une séance a suivi la liste : elle vit désormais sous `/seances/<id>`. */
export default async function PageGestionSeance({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/seances/${id}`);
}
