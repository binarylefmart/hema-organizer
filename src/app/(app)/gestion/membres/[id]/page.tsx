import { redirect } from "next/navigation";

/** Fossile : l'ancienne adresse d'une fiche mène à la nouvelle (voir `../page.tsx`). */
export default async function PageAncienneFiche({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/admin/membres/${id}`);
}
