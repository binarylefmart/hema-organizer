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
      <main className="mx-auto w-full max-w-3xl px-4 py-6 pb-28 md:pb-8">{children}</main>
    </>
  );
}
