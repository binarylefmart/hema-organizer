import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/current-user";
import { db } from "@/lib/db";
import { PageAuth } from "@/components/layout/PageAuth";
import { Alerte } from "@/components/ui/Alerte";
import { FormulaireNouveauMotDePasse } from "@/components/auth/FormulaireNouveauMotDePasse";
import { choisirMotDePasse } from "@/actions/auth";

export const metadata: Metadata = { title: "Choisir un mot de passe" };

/** Première connexion du compte d'administration : le mot de passe provisoire doit être remplacé. */
export default async function PageNouveauMotDePasse() {
  const user = await requireUser();
  const compte = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { doitChangerMotDePasse: true } });
  if (!compte.doitChangerMotDePasse) redirect("/");
  return (
    <PageAuth titre="Choisis ton mot de passe" sousTitre="Le mot de passe provisoire ne sert qu'une fois.">
      <div className="flex flex-col gap-5">
        <Alerte type="info">Garde-le dans ton gestionnaire de mots de passe : il ouvre l&apos;administration, avec ton code de double authentification.</Alerte>
        <FormulaireNouveauMotDePasse action={choisirMotDePasse} libelle="Enregistrer et continuer" email={user.email ?? undefined} />
      </div>
    </PageAuth>
  );
}
