import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";
import { Icone } from "@/components/ui/Icone";
import { descriptionSeance, LIBELLE_ANNULEE, seancePartagee, titreResume } from "@/lib/partage";
import { Cadre, Impasse } from "../../Cadre";
import { gardeInconnu, gardePartage, metadonneesPartage, TROP_DE_DEMANDES } from "../../meta";
import { ResumeSeance } from "../../Resume";

/**
 * **Partage public d'une séance** — `/partage/seance/<id>`.
 *
 * Page ouverte, sans connexion : le lien se colle dans WhatsApp, Signal ou Discord. Elle ne montre
 * que ce que montrent déjà les notifications du club — date, horaire, lieu, thème et chiffres
 * globaux — et jamais un nom. Une séance d'une période close reste consultable : un lien partagé
 * n'a pas de date de péremption.
 */

// La séance est lue une fois par requête et partagée entre les métadonnées et la page
const charger = cache(seancePartagee);

// La garde de débit, elle aussi, ne compte qu'une fois par requête : les métadonnées et la page
// sont rendues ensemble, et une visite ne doit pas consommer deux jetons du limiteur.
const garde = cache(gardePartage);

/**
 * Métadonnées d'une page à laquelle on n'a pas accès. Le `<head>` est servi avant tout affichage :
 * sans cette porte, il livrait date, lieu, thème et taux à qui balaye les identifiants, pendant que
 * la page, elle, répondait « Un instant ».
 */
const META_SANS_CONTENU: Metadata = { title: "Un instant", robots: { index: false, follow: false } };

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  if (!(await garde())) return META_SANS_CONTENU;
  const s = await charger(id);
  if (!s) return { title: "Partage introuvable", robots: { index: false, follow: false } };
  return metadonneesPartage({
    titre: s.annulee ? `${LIBELLE_ANNULEE} — ${titreResume(s)}` : titreResume(s),
    description: descriptionSeance(s),
    chemin: `/partage/seance/${s.id}`,
  });
}

export default async function PagePartageSeance({ params }: Props) {
  const { id } = await params;

  if (!(await garde())) {
    return <Impasse titre="Un instant">{TROP_DE_DEMANDES}</Impasse>;
  }

  const seance = await charger(id);
  if (!seance) {
    // Identifiant inconnu : compté à part (balayage par un robot), jamais une erreur 500. Passé le
    // quota, la page s'arrête ici — sans ça, le compteur se remplissait sans rien arrêter.
    if (!(await gardeInconnu())) return <Impasse titre="Un instant">{TROP_DE_DEMANDES}</Impasse>;
    return (
      <Impasse titre="Ce partage n'existe pas">
        Le lien est incomplet, ou la séance a été supprimée. Demande un nouveau lien à la personne qui te l&apos;a envoyé.
      </Impasse>
    );
  }

  return (
    <Cadre sousTitre={`Période « ${seance.periode.nom} »`}>
      <ResumeSeance seance={seance} />
      <p>
        <Link href={`/partage/planning/${seance.periode.id}`} className="inline-flex min-h-11 items-center gap-2 text-lien">
          <Icone nom="calendrier" taille={18} />
          Voir les prochaines séances de la période
        </Link>
      </p>
    </Cadre>
  );
}
