import { redirect } from "next/navigation";

/** Fossile : l'ancienne adresse d'un trimestre mène à la nouvelle (voir `../page.tsx`). */
export default async function PageAncienPeriode({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/admin/periodes/${id}`);
}
