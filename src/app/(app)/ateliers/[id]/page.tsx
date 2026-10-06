import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/current-user";
import { db } from "@/lib/db";
import { membrePeutModifier } from "@/lib/ateliers";
import { animateursPossibles, seancesAVenir } from "@/lib/ateliers-queries";
import { modifierAtelier } from "@/actions/ateliers";
import { Carte } from "@/components/ui/Carte";
import { FormulaireAtelier } from "@/components/ateliers/FormulaireAtelier";

export const metadata: Metadata = { title: "Modifier mon atelier" };

type Props = { params: Promise<{ id: string }> };

export default async function PageModifierAtelier({ params }: Props) {
  const user = await requireUser();
  const { id } = await params;
  const a = await db.atelier.findUnique({ where: { id } });
  if (!a || a.proposeParId !== user.id) notFound();
  if (!membrePeutModifier(a.statut)) redirect("/ateliers");
  const [seances, animateurs] = await Promise.all([seancesAVenir(user), animateursPossibles([a.animateurId, a.animateurSecondId])]);
  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-3xl">Modifier ma proposition</h1>
      <Carte>
        <FormulaireAtelier action={modifierAtelier.bind(null, a.id)} seances={seances} animateurs={animateurs} animateurParDefaut={a.proposeParId} bouton="Enregistrer" valeurs={a} />
      </Carte>
    </div>
  );
}
