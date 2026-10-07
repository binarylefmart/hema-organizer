import { redirect } from "next/navigation";
import { cheminCourant, requireUser } from "@/lib/auth/current-user";
import { db } from "@/lib/db";
import { Entete } from "@/components/layout/Entete";
import { FermerEnQuittant } from "@/components/admin/FermerEnQuittant";

/** Espace connecté : en-tête + contenu centré (largeur max confortable sur PC). */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Ce layout est rendu avant sa page : c'est lui qui redirige quand la session manque.
  // Il emporte donc la page demandée (« suite »), sinon un lien d'email perdrait sa destination.
  const user = await requireUser(await cheminCourant());
  // Mot de passe provisoire (compte d'administration, première connexion) : rien d'autre n'est accessible
  const compte = await db.user.findUnique({ where: { id: user.id }, select: { doitChangerMotDePasse: true } });
  if (compte?.doitChangerMotDePasse) redirect("/nouveau-mot-de-passe");
  return (
    <>
      {/* Pendant l'élévation seulement : quitter l'application referme l'espace admin (le composant
          ne rend rien, il prévient le serveur quand la page passe en arrière-plan). */}
      {user.sessionForte && <FermerEnQuittant ouverteLe={user.elevationOuverteLe?.getTime() ?? null} />}
      <Entete user={user} />
      {/* **La réserve du bas suit la barre d'onglets, zone système comprise.** La barre mesure
          5,3 rem **plus** `env(safe-area-inset-bottom)` (`NavBas`) ; un `pb-28` fixe ne laissait que
          27 px de jeu, et la zone système d'un téléphone récent (34 px sur iPhone, autant sur un
          Android plein écran) le dépasse : la fin de chaque page — dernière carte, barre
          « Appliquer les modifications » arrivée en bout de course — passait sous les onglets.
          **En version téléphone, la colonne passe à 40 rem** : sans effet sur un téléphone, plus étroit
          qu'elle, elle garde une tablette couchée dans la géométrie d'un téléphone posée au milieu,
          au lieu de cartes étirées sur 1 300 px. C'est la seule largeur à poser : les paliers larges
          (`lg:` et au-delà, donc `PLEINE_LARGEUR`) sont réservés à l'ordinateur (`globals.css`). */}
      <main className="mx-auto w-full max-w-3xl px-4 py-6 pb-[calc(env(safe-area-inset-bottom,0px)+7rem)] tel:max-w-[40rem] ordi:pb-8">{children}</main>
    </>
  );
}
