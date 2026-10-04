import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/current-user";
import { estBimestre, estDecalageBimestre, estTrimestre, lireSaison } from "@/lib/periodes";
import { Carte } from "@/components/ui/Carte";
import { FormulairePeriode } from "./FormulairePeriode";

export const metadata: Metadata = { title: "Nouvelle période" };

type Props = { searchParams: Promise<{ saison?: string; trimestre?: string; bimestre?: string; decalage?: string }> };

/**
 * `saison` et `trimestre` (ou `bimestre`, avec son `decalage`) dans l'URL pré-remplissent le
 * formulaire : entrées « Nouvelle saison… » du sélecteur, et lien du rappel de fin de période, qui
 * ouvre l'onglet du découpage attendu, **dans le calage de la période qui s'achève**
 * (`cheminNouvellePeriode`).
 */
export default async function PageNouvellePeriode({ searchParams }: Props) {
  await requirePermission("periods.manage");
  const { saison, trimestre, bimestre, decalage } = await searchParams;
  const saisonInitiale = lireSaison(saison) ?? undefined;
  const n = Number(trimestre);
  const trimestreInitial = estTrimestre(n) ? n : undefined;
  const b = Number(bimestre);
  const bimestreInitial = estBimestre(b) ? b : undefined;
  const d = Number(decalage);
  const decalageInitial = estDecalageBimestre(d) ? d : undefined;
  return (
    <div className="flex flex-col gap-5">
      <div>
        {/* Le même fil d'Ariane que la fiche d'une période : sans lui, l'écran n'avait aucune
            sortie — on ne pouvait revenir à la liste qu'avec le bouton « précédent » du navigateur. */}
        <p className="text-sm text-texte-secondaire">
          <Link href="/admin/periodes">← Périodes</Link>
        </p>
        <h1 className="text-3xl">Nouvelle période</h1>
      </div>
      <Carte>
        <FormulairePeriode
          saisonInitiale={saisonInitiale}
          trimestreInitial={trimestreInitial}
          bimestreInitial={bimestreInitial}
          decalageInitial={decalageInitial}
        />
      </Carte>
    </div>
  );
}
