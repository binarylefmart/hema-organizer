import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { hashToken, isValidTokenFormat } from "@/lib/auth/tokens";
import { PageAuth } from "@/components/layout/PageAuth";
import { Alerte } from "@/components/ui/Alerte";
import { FormulaireNouveauMotDePasse } from "@/components/auth/FormulaireNouveauMotDePasse";
import { reinitialiserMotDePasse } from "@/actions/auth";

export const metadata: Metadata = { title: "Nouveau mot de passe" };

type Props = { params: Promise<{ token: string }> };

export default async function PageReinitialiser({ params }: Props) {
  const { token } = await params;
  let valide = false;
  if (isValidTokenFormat(token)) {
    const reset = await db.passwordResetToken.findUnique({ where: { tokenHash: hashToken(token) } });
    valide = !!reset && !reset.usedAt && reset.expiresAt.getTime() > Date.now();
  }
  if (!valide) {
    return (
      <PageAuth titre="Lien expiré">
        <div className="flex flex-col gap-5">
          <Alerte type="erreur">Ce lien a expiré ou a déjà été utilisé. Les liens sont valables 30 minutes.</Alerte>
          <Link href="/mot-de-passe-oublie" className="-ml-2 inline-flex min-h-11 items-center justify-center self-start px-2">
            Refaire une demande
          </Link>
        </div>
      </PageAuth>
    );
  }
  const action = reinitialiserMotDePasse.bind(null, token);
  return (
    <PageAuth titre="Nouveau mot de passe" sousTitre="Choisis un mot de passe d'au moins 10 caractères.">
      <FormulaireNouveauMotDePasse action={action} libelle="Enregistrer et me connecter" />
    </PageAuth>
  );
}
