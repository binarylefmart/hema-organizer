import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/current-user";
import { accesAdminRegle, CHEMIN_ACTIVATION_ADMIN, compteAcces, peutOuvrirSessionForte } from "@/lib/auth/acces-admin";
import { cheminSuiteSur } from "@/lib/validation/auth";
import { PageAuth } from "@/components/layout/PageAuth";
import { FormulaireAdmin } from "./FormulaireAdmin";

export const metadata: Metadata = { title: "Connexion administrateur" };

type Props = { searchParams: Promise<{ suite?: string }> };

/**
 * **L'élévation** : prendre l'espace admin depuis une session déjà ouverte.
 *
 * C'est ici qu'atterrit « Se connecter en tant qu'administrateur », et c'est ici que `requirePermission`
 * envoie un administrateur qui demande un écran de réglages sans être élevé. On ne se reconnecte pas :
 * la session reste la sienne, on y ajoute le second facteur.
 *
 * Trois portes fermées avant d'afficher quoi que ce soit :
 *  - **le rôle** — `peutOuvrirSessionForte`, c'est-à-dire ADMIN et personne d'autre. Un instructeur
 *    équipé d'un mot de passe et d'une double authentification n'a rien à faire sur cet écran ;
 *  - **le réglage terminé** — sans mot de passe ni 2FA, il n'y a rien à vérifier : direction le
 *    parcours obligatoire `/admin/activer` ;
 *  - **l'élévation déjà prise** — on ne redemande pas ce qui vient d'être donné.
 */
export default async function PageConnexionAdmin({ searchParams }: Props) {
  const user = await requireUser();
  const suite = cheminSuiteSur((await searchParams).suite);
  if (!peutOuvrirSessionForte(user)) redirect("/?acces=refuse");
  if (user.sessionForte) redirect(suite === "/" ? "/admin" : suite);
  const compte = await compteAcces(user.id);
  if (!compte || !accesAdminRegle(compte)) redirect(CHEMIN_ACTIVATION_ADMIN);
  return (
    <PageAuth
      titre="Se connecter en tant qu'administrateur"
      sousTitre="Tu es déjà connecté(e) : il ne manque que la preuve que c'est bien toi. Cet accès se referme dès que tu quittes l'application."
    >
      <FormulaireAdmin suite={suite} />
    </PageAuth>
  );
}
