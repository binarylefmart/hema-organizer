import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/current-user";
import { lireAffichageCodes } from "@/lib/auth/deux-fa";
import { confirmerCodesSecours } from "@/actions/auth";
import { PageAuth } from "@/components/layout/PageAuth";
import { Alerte } from "@/components/ui/Alerte";
import { BoutonEnvoi } from "@/components/ui/BoutonEnvoi";

export const metadata: Metadata = { title: "Codes de secours" };

/** Affichés une seule fois, juste après l'activation (ou la régénération) de la double authentification. */
export default async function PageCodesSecours() {
  const user = await requireUser();
  const affichage = await lireAffichageCodes(user.id);
  /*
   * **On ne referme pas en silence**. Ce `redirect` était nu : quelqu'un qui revenait sur l'onglet
   * après le délai d'affichage se retrouvait sur son profil, où la carte annonce que tout est en
   * place — alors qu'il n'avait jamais lu ses codes, qui sont hachés en base et donc illisibles
   * pour toujours. Le geste qui répare existait, sans être nommé : on le nomme.
   */
  if (!affichage) redirect("/profil?erreur=codes-expires#securite");
  const action = confirmerCodesSecours.bind(null, affichage.suite);
  return (
    <PageAuth titre="Codes de secours" sousTitre="Si tu perds ton téléphone, l'un de ces codes remplace le code de l'application. Chaque code ne sert qu'une fois.">
      <form action={action} className="flex flex-col gap-5">
        <Alerte type="attention" titre="À noter maintenant">
          Ces codes ne seront plus jamais affichés. Range-les dans ton gestionnaire de mots de passe ou imprime-les.
        </Alerte>
        <ol className="grid grid-cols-2 gap-2 rounded-xl bg-surface-douce p-4 font-mono text-lg tracking-wider" aria-label="Codes de secours">
          {affichage.codes.map((c) => (
            <li key={c} className="select-all rounded-lg bg-surface px-3 py-2 text-center">
              {c}
            </li>
          ))}
        </ol>
        <BoutonEnvoi taille="grande" pleineLargeur enCours="Un instant…">
          J&apos;ai noté mes codes
        </BoutonEnvoi>
      </form>
    </PageAuth>
  );
}
