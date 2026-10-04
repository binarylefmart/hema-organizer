import type { Metadata } from "next";
import { cache } from "react";
import { descriptionPlanning, MAX_SEANCES_PLANNING, planningPartage } from "@/lib/partage";
import { Cadre, Impasse } from "../../Cadre";
import { gardeInconnu, gardePartage, metadonneesPartage, TROP_DE_DEMANDES } from "../../meta";
import { ResumeSeance } from "../../Resume";

/**
 * **Partage public du planning d'une période** — `/partage/planning/<periodId>`.
 *
 * Le même résumé que pour une séance, répété sur les séances à venir : de quoi coller un seul lien
 * dans le groupe du club au début d'un trimestre. Aucune donnée nominative, aucune séance passée.
 */

const charger = cache(planningPartage);

// Comme la lecture, la garde de débit ne compte qu'une fois par requête (métadonnées + page).
const garde = cache(gardePartage);

/** Le `<head>` ne dit rien du planning tant que la garde n'est pas franchie (voir la page séance). */
const META_SANS_CONTENU: Metadata = { title: "Un instant", robots: { index: false, follow: false } };

type Props = { params: Promise<{ periodId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { periodId } = await params;
  if (!(await garde())) return META_SANS_CONTENU;
  const p = await charger(periodId);
  if (!p) return { title: "Partage introuvable", robots: { index: false, follow: false } };
  return metadonneesPartage({
    titre: `Prochaines séances — ${p.periode.nom}`,
    description: descriptionPlanning(p),
    chemin: `/partage/planning/${p.periode.id}`,
  });
}

export default async function PagePartagePlanning({ params }: Props) {
  const { periodId } = await params;

  if (!(await garde())) {
    return <Impasse titre="Un instant">{TROP_DE_DEMANDES}</Impasse>;
  }

  const planning = await charger(periodId);
  if (!planning) {
    // Identifiant inconnu (ou trimestre pas encore ouvert) : compté à part, et le quota arrête bien
    // le balayage au lieu de se contenter de le compter.
    if (!(await gardeInconnu())) return <Impasse titre="Un instant">{TROP_DE_DEMANDES}</Impasse>;
    return (
      <Impasse titre="Ce partage n'existe pas">
        Le lien est incomplet, ou la période a été supprimée. Demande un nouveau lien à la personne qui te l&apos;a envoyé.
      </Impasse>
    );
  }

  const { seances, total } = planning;
  const reste = total - seances.length;
  return (
    <Cadre sousTitre={`Période « ${planning.periode.nom} »`}>
      <section className="flex flex-col gap-1 rounded-2xl border border-bordure/60 bg-surface p-5 shadow-carte">
        <h1 className="text-[1.6rem] leading-tight sm:text-3xl">Prochaines séances</h1>
        <p className="text-texte-secondaire">
          {total === 0 ? "Aucune séance à venir pour cette période." : `${total} séance${total > 1 ? "s" : ""} à venir, la plus proche en premier.`}
        </p>
      </section>

      {seances.length > 0 && (
        <ul className="flex flex-col gap-4">
          {seances.map((s) => (
            <li key={s.id}>
              <ResumeSeance seance={s} compact />
            </li>
          ))}
        </ul>
      )}

      {reste > 0 && (
        <p className="text-center text-texte-secondaire">
          … et {reste} autre{reste > 1 ? "s" : ""} séance{reste > 1 ? "s" : ""} jusqu&apos;au terme de la période (les {MAX_SEANCES_PLANNING} plus proches sont
          affichées).
        </p>
      )}
    </Cadre>
  );
}
