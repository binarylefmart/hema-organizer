import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/current-user";
import { evenementsAVenir, evenementsPasses } from "@/lib/evenements";
import { Alerte } from "@/components/ui/Alerte";
import { LienBouton } from "@/components/ui/Bouton";
import { Cellule, Ligne, Tableau } from "@/components/ui/Tableau";
import { BasculeTemps } from "@/components/filtres/BasculeTemps";
import { lienTemps, lireQuand, valeurQuand, type Quand } from "@/components/filtres/temps";
import { dateEvenement, horaireEvenement } from "@/components/evenements/libelles";
import { Pastille } from "@/components/ui/Pastille";
import { GestesEvenement } from "@/components/evenements/GestesEvenement";
import { ListeEvenementsTelephone } from "@/components/evenements/ListeEvenementsTelephone";
import { Icone } from "@/components/ui/Icone";
import { todayIso } from "@/lib/dates";
import { can } from "@/lib/permissions";

export const metadata: Metadata = { title: "Événements" };

type Props = { searchParams: Promise<{ quand?: string }> };

const BASE = "/gestion/evenements";

/**
 * Liste de travail des événements — l'envers du fil.
 *
 * Le fil (`/evenements`) est fait pour être lu : de grandes affiches, une annonce par écran. Ici on
 * en tient plusieurs à jour d'affilée, brouillons compris : une ligne par annonce, ses gestes
 * à portée par « Que veux-tu faire ? » (modifier, publier ou dépublier, supprimer), et rien d'autre à l'écran.
 *
 * **Sur téléphone, une autre liste** (`ListeEvenementsTelephone`) : rangée par état (« À publier »
 * puis « Publiés »), une ligne d'agenda par annonce, « Modifier » et le geste du moment en boutons
 * directs, le reste derrière « ⋯ ». Mêmes gestes, mêmes confirmations. La bascule est en CSS
 * (`tel:` / `ordi:`) : le serveur rend les deux, l'ordinateur garde exactement son tableau.
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
  const peutModifier = can(user, "evenements.edit");

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
        <LienBouton href="/evenements/nouveau" enCours className="tel:hidden">
          Nouvel événement
        </LienBouton>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <BasculeTemps quand={quand} href={(q) => lienTemps(BASE, { quand: valeurQuand(q) })} />
        {/* Sur téléphone, « Nouveau » rejoint la bascule (même ligne, à droite) et le lien vers le
            fil passe dessous, sur sa propre ligne. */}
        <LienBouton href="/evenements/nouveau" enCours className="ordi:hidden tel:ml-auto">
          <Icone nom="plus" taille={20} />
          Nouveau
        </LienBouton>
        <Link href="/evenements" className="tel:basis-full">
          Voir le fil tel que le voient les membres
        </Link>
      </div>

      {liste.length === 0 ? (
        <Alerte type="info" titre={passe ? "Aucun événement passé" : "Aucun événement à venir"}>
          {passe ? (
            "Les annonces terminées se rangent ici."
          ) : (
            <>
              Rien n&apos;est annoncé pour l&apos;instant : ouvre une annonce avec <span className="tel:hidden">« Nouvel événement »</span>
              <span className="ordi:hidden">« Nouveau »</span>.
            </>
          )}
        </Alerte>
      ) : (
        <>
          <div className="ordi:hidden">
            <ListeEvenementsTelephone
              evenements={liste.map((e) => ({ id: e.id, nom: e.nom, dateDebut: e.dateDebut, dateFin: e.dateFin, heureDebut: e.heureDebut, heureFin: e.heureFin, lieu: e.lieu, publie: e.publie }))}
              modifier={peutModifier}
              supprimer
              aujourdHui={todayIso()}
            />
          </div>
          <div className="tel:hidden">
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
                        réclame 450 px, et 450 px + la colonne des gestes + les deux autres colonnes ne tiennent
                        pas dans les 976 px de la page à 1 024 — le tableau se mettait alors à défiler
                        **dans son cadre**, avec « Événement » serré à 144 px, soit moins qu'avant. À
                        1 280 px la page offre 1 232 px, et tout tient. En dessous, la date revient à la
                        ligne : rien ne défile jamais horizontalement. */}
                    <Cellule label="Quand" className="2xl:whitespace-nowrap">
                      {dateEvenement(e.dateDebut, e.dateFin)}
                      {horaire && <span className="block text-sm text-texte-secondaire">{horaire}</span>}
                    </Cellule>
                    <Cellule label="Où">{e.lieu || <span className="text-texte-secondaire">Non précisé</span>}</Cellule>
                    {/* **« Que veux-tu faire ? » par ligne** (`GestesEvenement`), la forme commune : les
                        trois boutons d'avant (modifier, publier ou dépublier, supprimer) deviennent une
                        question, chaque geste expliqué avant d'agir, confirmations gardées. La liste n'est
                        jamais réduite à son contenu : une liste déroulante serrée à la largeur de « Choisir
                        une action… » couperait ses entrées, d'où une largeur fixe dès qu'il y a un tableau
                        (md). Sur téléphone, la cellule prend la largeur de la carte. Les droits sont lus
                        comme sur la page de l'annonce : la page exige déjà `evenements.creer_supprimer`,
                        `evenements.edit` est relue pour ne proposer que ce qui aboutit. */}
                    <Cellule className="md:w-72" pleineLargeur>
                      <GestesEvenement id={e.id} nom={e.nom} publie={e.publie} modifier={peutModifier} supprimer />
                    </Cellule>
                  </Ligne>
                );
              })}
            </Tableau>
          </div>
        </>
      )}
    </div>
  );
}
