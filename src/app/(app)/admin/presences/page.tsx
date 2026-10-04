import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/current-user";
import { db } from "@/lib/db";
import { formatDateCourte, formatHeure, seanceCommencee } from "@/lib/dates";
import { participantsAPlat, seanceCarte } from "@/lib/seances";
import { PresencesEquipe } from "@/components/gestion/PresencesEquipe";
import { trierParActionnabilite } from "@/components/seances/listes";
import { Carte } from "@/components/ui/Carte";
import { SelecteurSeance } from "./SelecteurSeance";

export const metadata: Metadata = { title: "Présences" };

type Props = { searchParams: Promise<{ seance?: string }> };

/**
 * **Tenir le registre d'un seul écran**.
 *
 * Corriger la réponse de quelqu'un obligeait à ouvrir Séances, retrouver la bonne date, dérouler la
 * liste — un chemin long pour le geste le plus courant d'un soir de cours (« untel est venu sans
 * répondre »). Ici, une liste déroulante de séances et la liste des invités, rien d'autre.
 *
 * Les séances proposées sont celles des trimestres ouverts, **annulées exclues** : une séance
 * annulée n'a pas de registre, et l'action la refuserait (`modifierPresenceMembre`). Celle qui
 * s'ouvre par défaut est **le dernier cours commencé** — celui qu'on vient de vivre — et, à défaut,
 * le prochain. La séance voyage dans l'URL (`?seance=<id>`) : l'écran reste un composant serveur,
 * il se recharge tel quel et le retour du navigateur ramène la séance précédente.
 *
 * **L'ordre des invités se décide ici, au rendu serveur, et nulle part ailleurs** : d'abord les
 * sans-réponse, puis les peut-être, puis ceux qui ont répondu. C'est l'ordre de l'actionnabilité —
 * dans un club de quatre-vingts, on ouvre cet écran pour une poignée de gens, et ce sont
 * exactement ceux-là. Le composant qui l'affiche ne le recalcule jamais depuis ses propres
 * modifications : les lignes sauteraient sous le doigt à chaque correction (voir `PresencesEquipe`).
 */
export default async function PagePresencesAdmin({ searchParams }: Props) {
  const acteur = await requirePermission("attendances.autrui");
  const { seance } = await searchParams;
  const seances = await db.session.findMany({
    where: { annulee: false, period: { statut: { not: "CLOSE" } } },
    orderBy: [{ date: "asc" }, { heureDebut: "asc" }],
    select: { id: true, date: true, heureDebut: true, lieu: true, period: { select: { nom: true } } },
  });
  const derniereCommencee = seances.filter((s) => seanceCommencee(s.date, s.heureDebut)).at(-1);
  const choisie = seances.find((s) => s.id === seance) ?? derniereCommencee ?? seances[0];
  const registre = choisie ? await seanceCarte(choisie.id, acteur) : null;
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-3xl">Présences</h1>
        <p className="text-texte-secondaire">
          Corrige la réponse de n&apos;importe quelle personne invitée, même après le cours. Chaque changement est enregistré dans le journal.
        </p>
      </div>
      <Carte>
        {choisie && registre ? (
          <div className="flex flex-col gap-4">
            <SelecteurSeance
              valeur={choisie.id}
              options={seances.map((s) => ({
                id: s.id,
                label: `${formatDateCourte(s.date)} · ${formatHeure(s.heureDebut)} — ${s.lieu}`,
                periode: s.period.nom,
              }))}
            />
            {/* Déplié d'emblée : sur cet écran-là, corriger est la seule chose qu'on vient faire.

                **`key={choisie.id}` : changer de séance remonte le panneau, il ne le réutilise pas.**
                `SelecteurSeance` change de séance par `router.push("/admin/presences?seance=<id>")` —
                même route, même position dans l'arbre React : sans clé, React garde **l'instance
                cliente** et tout son état local. Le dictionnaire des corrections en cours est indexé
                par personne, pas par séance : les réponses corrigées sur le cours de mardi
                s'affichaient donc sur le registre de jeudi, la liste déroulante portant déjà la
                valeur n'émettait plus aucun changement, et le résumé d'écrasement du lot annonçait
                « aucune réponse écrasée » juste avant d'en écraser de réelles. La recherche, le
                repli, l'ordre figé à l'ouverture (`ordreOuverture`) et la sélection repartent de zéro
                avec la clé, ce qui est bien ce qu'on veut d'un registre qu'on vient d'ouvrir. */}
            <PresencesEquipe
              key={choisie.id}
              sessionId={choisie.id}
              participants={trierParActionnabilite(participantsAPlat(registre.participants))}
              ouvert
              avertissement={false}
            />
            <Link href={`/seances/${choisie.id}`} className="text-sm">
              Ouvrir la fiche de cette séance
            </Link>
          </div>
        ) : (
          <p className="text-texte-secondaire">Aucune séance dans les trimestres ouverts.</p>
        )}
      </Carte>
    </div>
  );
}
