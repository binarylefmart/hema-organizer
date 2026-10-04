import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/current-user";
import { cheminSuiteSur } from "@/lib/validation/auth";
import { reverifierCode2fa } from "@/actions/auth";
import { PageAuth } from "@/components/layout/PageAuth";
import { FormulaireCode } from "@/components/auth/FormulaireCode";

export const metadata: Metadata = { title: "Vérification" };

type Props = { searchParams: Promise<{ suite?: string }> };

/** Ré-authentification : une action sensible demande le code 2FA si la dernière vérification date de plus de 10 min. */
export default async function PageVerifier({ searchParams }: Props) {
  const user = await requireUser();
  const { suite } = await searchParams;
  const retour = cheminSuiteSur(suite);
  // Le bureau se lit sur `estAdmin` — même garde que `reverifierCode2fa`, qui reçoit le formulaire
  // de cet écran : les deux doivent dire la même chose, sinon l'une affiche ce que l'autre refuse.
  // Sur `role`, elle ne laissait plus passer personne.
  if (!user.estAdmin || !user.sessionForte) redirect(`/connexion?erreur=admin&suite=${encodeURIComponent(retour)}`);
  return (
    <PageAuth titre="Vérification" sousTitre="Cette action est sensible : confirme avec le code de ton application d'authentification.">
      <FormulaireCode configuration={false} action={reverifierCode2fa.bind(null, retour)} libelle="Confirmer" />
      <p className="mt-4 text-center text-sm">
        <Link href={retour} className="inline-flex min-h-11 items-center justify-center px-2">
          Annuler
        </Link>
      </p>
    </PageAuth>
  );
}
