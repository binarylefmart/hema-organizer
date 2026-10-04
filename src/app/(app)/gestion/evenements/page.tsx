import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/current-user";
import { evenementsAVenir, evenementsPasses } from "@/lib/evenements";
import { publierEvenement, supprimerEvenement } from "@/actions/evenements";
import { Alerte } from "@/components/ui/Alerte";
import { LienBouton } from "@/components/ui/Bouton";
import { BoutonAction } from "@/components/ui/BoutonAction";
import { Cellule, Ligne, Tableau } from "@/components/ui/Tableau";
import { BasculeTemps } from "@/components/filtres/BasculeTemps";
import { lienTemps, lireQuand, valeurQuand, type Quand } from "@/components/filtres/temps";
import { dateEvenement, horaireEvenement } from "@/components/evenements/libelles";
import { Pastille } from "@/components/ui/Pastille";
import { Icone } from "@/components/ui/Icone";

export const metadata: Metadata = { title: "Événements" };

type Props = { searchParams: Promise<{ quand?: string }> };

const BASE = "/gestion/evenements";

/**
 * Liste de travail des événements — l'envers du fil.
 *
 * Le fil (`/evenements`) est fait pour être lu : de grandes affiches, une annonce par écran. Ici on
 * en tient plusieurs à jour d'affilée, brouillons compris : une ligne par annonce, les trois gestes
 * à portée (modifier, publier ou retirer, supprimer), et rien d'autre à l'écran.
 *
 * Ouvert à **tout l'encadrement** — `evenements.creer_supprimer` vaut pour un INSTRUCTEUR comme
 * pour un ADMIN depuis le retour des annonces à l'encadrement entier. Une annonce se retire d'un
 * clic et n'ouvre aucun accès à personne, contrairement à un trimestre ou à un compte ; le journal
 * d'audit garde qui a publié quoi. L'onglet « Événements » de la sous-navigation de gestion est
 * donc là pour tout le monde, et aucune élévation n'est demandée. `requirePermission` vérifie quand
 * même côté serveur — un onglet, présent ou absent, n'est jamais une garde.
 */
export default async function PageGestionEvenements({ searchParams }: Props) {
  const user = await requirePermission("evenements.creer_supprimer");
  const quand: Quand = lireQuand((await searchParams).quand);
  const passe = quand === "passe";
  const liste = await (passe ? evenementsPasses(user) : evenementsAVenir(user));

  return (
    /*
     * **Un tableau s'élargit** — et celui-ci en avait le plus besoin du dépôt : quatre colonnes de
     * 157 / 118 / 108 / 351 px dans 736 px, avec 1 184 px de blanc à droite sur un écran de 1 920.
     * « Stage d'épée longue avec Fiore » se pliait sur trois lignes, « Du lundi au mardi » sur
     * **cinq**, et chaque ligne faisait ~85 px de haut. Le même défaut que les deux journaux de
     * l'espace admin, corrigé le même jour.
     *
     * La largeur est posée **sur la page**, donc sur un conteneur qui suit la fenêtre : c'est ce qui
     * rend les paliers `lg:` des cellules ci-dessous légitimes ici.
     */
    <div className={`flex flex-col gap-5`}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-3xl">Événements</h1>
        <LienBouton href="/evenements/nouveau" enCours>
          Nouvel événement
        </LienBouton>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <BasculeTemps quand={quand} href={(q) => lienTemps(BASE, { quand: valeurQuand(q) })} />
        <Link href="/evenements">Voir le fil tel que le voient les membres</Link>
      </div>

      {liste.length === 0 ? (
        <Alerte type="info" titre={passe ? "Aucun événement passé" : "Aucun événement à venir"}>
          {passe ? "Les annonces terminées se rangent ici." : "Rien n'est annoncé pour l'instant : ouvre une annonce avec « Nouvel événement »."}
        </Alerte>
      ) : (
        <Tableau entetes={["Événement", "Quand", "Où", "Actions"]}>
          {liste.map((e) => {
            const horaire = horaireEvenement(e.heureDebut, e.heureFin);
            return (
              <Ligne key={e.id} className={e.publie ? "" : "bg-ocre-doux/40"}>
                <Cellule label="Événement">
                  <span className="flex flex-wrap items-center gap-2">
                    <Link href={`/evenements/${e.id}`} className="font-semibold">
                      {e.nom}
                    </Link>
                    {!e.publie && <Pastille ton="ocre">Brouillon</Pastille>}
                  </span>
                  {e.organisateur && <span className="block text-sm text-texte-secondaire">{e.organisateur}</span>}
                </Cellule>
                {/* **La date ne se plie plus une fois la page large** : une plage (« Du lundi
                    16 novembre 2026 au mardi 17 novembre 2026 ») tenait sur cinq lignes dans 118 px,
                    et c'est elle qui donnait aux lignes leurs 85 px de haut. Mesurer la **fenêtre**
                    est juste ici : la largeur est posée sur la page, qui la suit.
                    **Le palier est 1 280 px, pas 1 024** (mesuré) : refusée de plier, cette colonne
                    réclame 450 px, et 450 + 351 px de gestes + les deux autres colonnes ne tiennent
                    pas dans les 976 px de la page à 1 024 — le tableau se mettait alors à défiler
                    **dans son cadre**, avec « Événement » serré à 144 px, soit moins qu'avant. À
                    1 280 px la page offre 1 232 px, et tout tient. En dessous, la date revient à la
                    ligne : rien ne défile jamais horizontalement. */}
                <Cellule label="Quand" className="2xl:whitespace-nowrap">
                  {dateEvenement(e.dateDebut, e.dateFin)}
                  {horaire && <span className="block text-sm text-texte-secondaire">{horaire}</span>}
                </Cellule>
                <Cellule label="Où">{e.lieu || <span className="text-texte-secondaire">Non précisé</span>}</Cellule>
                {/* **La colonne des gestes prend sa largeur de contenu, et pas un pixel de plus** :
                    elle s'en adjugeait 351 des 736 px disponibles — presque la moitié du tableau
                    pour trois boutons — pendant que le nom de l'événement se pliait en trois. Un
                    `w-1` sur une cellule, dans la mise en page automatique d'un tableau, vaut « aussi
                    étroite que son contenu le permet » : le reste de la largeur revient aux trois
                    colonnes de texte, qui sont celles qu'on lit. */}
                <Cellule className="lg:w-1">
                  {/* Les trois gestes restent sur une ligne dès qu'il y a un tableau (md) : empilés, ils
                      étiraient la ligne sur trois hauteurs pour rien. Sur téléphone, ils passent à la ligne. */}
                  <span className="flex flex-wrap gap-2 md:flex-nowrap md:justify-end">
                    <LienBouton href={`/evenements/${e.id}/modifier`} variante="secondaire" taille="petite" enCours>
                      Modifier
                    </LienBouton>
                    <BoutonAction
                      action={publierEvenement.bind(null, e.id, !e.publie)}
                      variante={e.publie ? "danger" : "secondaire"}
                      taille="petite"
                      enCours="Un instant…"
                      confirmation={e.publie ? `Retirer « ${e.nom} » de la vue des membres ? L'annonce redevient un brouillon.` : undefined}
                    >
                      {e.publie && <Icone nom="alerte" taille={18} />}
                      {e.publie ? "Dépublier" : "Publier"}
                    </BoutonAction>
                    {/* Rouge et pictogramme d'alerte : le seul geste de la ligne qui ne se reprend
                        pas — dépublier se refait d'un clic. Même bouton que sur la fiche. */}
                    <BoutonAction
                      action={supprimerEvenement.bind(null, e.id)}
                      variante="danger"
                      taille="petite"
                      enCours="Suppression…"
                      confirmation={`Supprimer « ${e.nom} » ? Cette annonce disparaîtra pour tout le monde.`}
                    >
                      <Icone nom="alerte" taille={18} />
                      Supprimer
                    </BoutonAction>
                  </span>
                </Cellule>
              </Ligne>
            );
          })}
        </Tableau>
      )}
    </div>
  );
}
