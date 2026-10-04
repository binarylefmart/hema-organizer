import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { todayIso } from "@/lib/dates";
import { creerSeance } from "@/actions/seances";
import { Carte } from "@/components/ui/Carte";
import { Alerte } from "@/components/ui/Alerte";
import { FormulaireSeance } from "@/components/gestion/FormulaireSeance";
import { getLieux } from "@/lib/planning";

export const metadata: Metadata = { title: "Nouvelle séance" };

type Props = { searchParams: Promise<{ periode?: string }> };

export default async function PageNouvelleSeance({ searchParams }: Props) {
  const user = await requirePermission("sessions.manage");
  const { periode } = await searchParams;
  const periodes = await db.period.findMany({ where: { statut: { not: "CLOSE" } }, orderBy: { dateDebut: "desc" }, include: { creneaux: true } });
  const lieux = await getLieux();
  const p = periodes.find((x) => x.id === periode) ?? periodes[0];
  if (!p) {
    // On ne demande pas un geste qu'on n'a pas le droit de faire :, ouvrir un trimestre appartient
    // au bureau. À un instructeur, on dit donc à qui s'adresser — sans quoi l'écran le laisse
    // devant une impasse polie.
    //
    // Et au bureau, on dit **où mène le lien** : ouvrir un trimestre vit dans l'espace admin, donc
    // un administrateur entré par son lien personnel passera d'abord par `/connexion/admin`. Le
    // lien l'annonce avant le clic, comme « Se connecter en tant qu'administrateur » sur le profil.
    return (
      <Alerte type="attention" titre="Aucune période ouverte">
        {can(user, "periods.manage") ? (
          <>
            Une séance se rattache à un trimestre :{" "}
            <Link href="/admin/periodes/nouvelle" title="Espace admin : mot de passe administrateur demandé">
              ouvre-en un d&apos;abord
            </Link>{" "}
            <span className="text-texte-secondaire">(mot de passe admin)</span>.
          </>
        ) : (
          "Une séance se rattache à un trimestre, et aucun n'est ouvert. Demande au bureau d'en ouvrir un : les séances pourront alors s'y ajouter."
        )}
      </Alerte>
    );
  }
  const c = p.creneaux[0];
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-3xl">Nouvelle séance</h1>
      </div>
      <Carte>
        <FormulaireSeance
          action={creerSeance}
          bouton="Créer la séance"
          creation
          periodes={periodes.map((x) => ({ id: x.id, nom: x.nom }))}
          lieux={lieux}
          valeurs={{
            periodId: p.id,
            date: todayIso(),
            heureDebut: c?.heureDebut ?? "19:00",
            heureFin: c?.heureFin ?? "21:00",
            lieu: c?.lieu ?? "",
            adresse: c?.adresse ?? "",
            theme: "",
            alternative: "",
          }}
        />
      </Carte>
    </div>
  );
}
