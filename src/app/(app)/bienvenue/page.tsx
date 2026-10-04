import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/current-user";
import { cheminSuiteSur } from "@/lib/validation/auth";
import { accesAdminRegle, compteAcces, peutReglerSonAcces } from "@/lib/auth/acces-admin";
import { ParcoursAccueil } from "./ParcoursAccueil";
import { lienPersonnelDeLOuverture } from "@/lib/lien-personnel";

export const metadata: Metadata = { title: "Bienvenue" };

type Props = { searchParams: Promise<{ suite?: string }> };

/**
 * **Le parcours d'entrée**, montré une fois par lien personnel : installer l'application, puis
 * consolider son compte. Ce sont deux propositions, jamais deux obligations — chacune se décline.
 *
 * On n'arrive ici que si `Invitation.parcoursVuLe` était vide au moment d'ouvrir le lien (voir
 * `apresInvitation`, src/actions/auth.ts) : quelqu'un qui revient n'y repasse pas, mais **un
 * nouveau lien** le remet une fois — c'est précisément quand la question redevient utile.
 *
 * Le détail du parcours est côté client (`ParcoursAccueil`) : savoir si l'on est sur un téléphone,
 * ou déjà dans l'application installée, ne se sait que dans le navigateur.
 */
export default async function PageBienvenue({ searchParams }: Props) {
  const user = await requireUser();
  const suite = cheminSuiteSur((await searchParams).suite);
  // Présent seulement si l'ouverture du lien vient de le transmettre **à cette personne-là** : le
  // cookie de passage est signé à son nom, pour qu'un appareil partagé ne tende pas la clé du
  // précédent visiteur au suivant (voir `src/lib/lien-personnel.ts`).
  const lienPersonnel = await lienPersonnelDeLOuverture(user.id);
  const compte = await compteAcces(user.id);
  // Un administrateur nominatif à qui il manque le mot de passe ou la double authentification ne
  // voit pas l'étape « consolider » : pour lui ce n'est pas une proposition mais une obligation, et
  // elle se règle d'un seul tenant sur `/admin/activer` — où `suite` le dépose en sortant d'ici.
  const reglageAdminDu = peutReglerSonAcces(compte) && !!compte && !accesAdminRegle(compte);
  return (
    <ParcoursAccueil
      prenom={user.prenom}
      lienPersonnel={lienPersonnel}
      suite={suite}
      aDejaUnMotDePasse={!!compte?.passwordHash}
      aUnEmail={!!user.email}
      reglageAdminDu={reglageAdminDu}
    />
  );
}
