import type { Metadata } from "next";
import { cache } from "react";
import { descriptionEvenement, evenementPartage, tronquer } from "@/lib/partage";
import { Cadre, Impasse } from "../../Cadre";
import { gardeInconnu, gardePartage, metadonneesPartage, TROP_DE_DEMANDES } from "../../meta";
import { ResumeEvenement } from "../../Resume";

/**
 * **Partage public d'un événement** — `/partage/evenement/<id>` (stage, tournoi, démonstration).
 *
 * Même contrat que les deux autres pages de partage : ouverte sans connexion, sans indexation,
 * derrière le limiteur par IP, et strictement non nominative — le nom de la personne qui a saisi
 * l'annonce n'apparaît nulle part.
 *
 * **Seule une annonce publiée est partageable.** Un brouillon donne « Ce partage n'existe pas »,
 * exactement comme un identifiant inventé : c'est `evenementPartage` qui le garantit, en
 * interrogeant la règle de l'application en lecteur anonyme.
 *
 * L'illustration distante (`imageUrl`) n'est volontairement pas affichée : le relais `/api/image`
 * exige une session, et faire partir une requête vers un domaine tiers sur simple ouverture d'une
 * page publique reviendrait à offrir un canal sortant à n'importe quel inconnu.
 */

const charger = cache(evenementPartage);

// Comme la lecture, la garde de débit ne compte qu'une fois par requête (métadonnées + page).
const garde = cache(gardePartage);

/** Le `<head>` ne dit rien de l'annonce tant que la garde n'est pas franchie (voir la page séance). */
const META_SANS_CONTENU: Metadata = { title: "Un instant", robots: { index: false, follow: false } };

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  if (!(await garde())) return META_SANS_CONTENU;
  const e = await charger(id);
  if (!e) return { title: "Partage introuvable", robots: { index: false, follow: false } };
  return metadonneesPartage({
    titre: tronquer(e.nom, 90),
    description: descriptionEvenement(e),
    chemin: `/partage/evenement/${e.id}`,
  });
}

export default async function PagePartageEvenement({ params }: Props) {
  const { id } = await params;

  if (!(await garde())) {
    return <Impasse titre="Un instant">{TROP_DE_DEMANDES}</Impasse>;
  }

  const evenement = await charger(id);
  if (!evenement) {
    // Identifiant inconnu **ou brouillon** : même réponse, rien ne distingue les deux cas. Le
    // compteur dédié au balayage arrête la visite dès qu'il est plein.
    if (!(await gardeInconnu())) return <Impasse titre="Un instant">{TROP_DE_DEMANDES}</Impasse>;
    return (
      <Impasse titre="Ce partage n'existe pas">
        Le lien est incomplet, ou l&apos;annonce n&apos;est plus publiée. Demande un nouveau lien à la personne qui te l&apos;a envoyé.
      </Impasse>
    );
  }

  return (
    <Cadre sousTitre="Événement" varianteApp="secondaire">
      <ResumeEvenement evenement={evenement} />
    </Cadre>
  );
}
