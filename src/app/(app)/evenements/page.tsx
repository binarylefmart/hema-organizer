import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/current-user";
import { todayIso } from "@/lib/dates";
import { evenementsAVenir, evenementsPasses } from "@/lib/evenements";
import { can } from "@/lib/permissions";
import { BasculeTemps } from "@/components/filtres/BasculeTemps";
import { lienTemps, lireQuand, valeurQuand, type Quand } from "@/components/filtres/temps";
import { CarteEvenement } from "@/components/evenements/CarteEvenement";
import { Alerte } from "@/components/ui/Alerte";
import { LienBouton } from "@/components/ui/Bouton";
import { Icone } from "@/components/ui/Icone";
import { PLEINE_LARGEUR } from "@/components/ui/pleine-largeur";

export const metadata: Metadata = { title: "Événements" };

type Props = { searchParams: Promise<{ quand?: string }> };

/** Le bouton de création : en tête de page et dans l'état vide, toujours le même libellé. */
function BoutonCreer() {
  return (
    <LienBouton href="/evenements/nouveau" enCours>
      <Icone nom="etendard" taille={18} />
      Nouvel événement
    </LienBouton>
  );
}

/**
 * Fil d'actualité des événements : stages, tournois, démonstrations — les annonces du club et de
 * celles qu'il relaie, la plus proche en haut.
 *
 * La bascule « À venir / Passé » est celle du planning, au mot près (`?quand=passe`) : « à venir »
 * par défaut, le passé ne s'affiche que si on le demande.
 *
 * Le fil est hors navigation : on y arrive par le volet de l'en-tête (« Voir tout le fil ») ou par
 * son adresse. Chaque carte mène à la page de son événement, où l'encadrement trouve les gestes
 * d'écriture ; ici, seul « Nouvel événement » — ouvert à tout l'encadrement, instructeurs compris —
 * s'ajoute au titre.
 *
 * Un brouillon (case « Publié » décochée) n'existe que pour l'encadrement : `evenementsAVenir` /
 * `evenementsPasses` l'écartent de la requête pour qui n'a pas le droit d'écrire.
 */
export default async function PageEvenements({ searchParams }: Props) {
  const user = await requireUser();
  const { quand: param } = await searchParams;
  const quand: Quand = lireQuand(param);
  // Ouvrir une annonce est un geste de l'encadrement — admins **et** instructeurs ; le reste de
  // l'écriture (corriger, publier, effacer) se fait depuis la page de l'événement, qui revérifie
  // ses propres droits.
  const peutCreerSupprimer = can(user, "evenements.creer_supprimer");
  const aujourdHui = todayIso();
  const passe = quand === "passe";
  // Les brouillons sont écartés par la requête elle-même (src/lib/evenements.ts) : l'écran n'a pas
  // à les filtrer, et un oubli d'affichage ne pourrait pas en laisser fuiter un.
  const liste = await (passe ? evenementsPasses(user) : evenementsAVenir(user));

  return (
    /*
     * **Le fil prend la largeur de la fenêtre, et il l'occupe en rangeant deux annonces par
     * ligne**.
     *
     * Les deux moitiés de la décision vont ensemble, et au **même palier** : la largeur se pose sur
     * la page (`PLEINE_LARGEUR`, 1 024 px) et la grille se partage en deux au même moment. Les
     * séparer donnerait, entre 1 024 et 1 280 px, **une seule carte de 976 px** — donc une affiche
     * en 16/9 de **549 px de haut** —, soit très exactement la carte étirée que Delta a refusée
     * deux fois (« je n'aime pas la manière dont il est allongé en grand écran »). Ici, la carte ne
     * grandit jamais : 480 px à 1 024, 608 px à 1 280, 712 px à 1 920 — toujours sous les 736 px de
     * la colonne de lecture d'aujourd'hui.
     *
     * **Pas d'`items-start` sur la grille** : le défaut d'alignement (`stretch`) donne aux cartes
     * d'une même rangée la même hauteur, et c'est ce qu'on veut — « ne fais pas de trous ».
     */
    <div className={`flex flex-col gap-5 ${PLEINE_LARGEUR}`}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-3xl">Événements</h1>
        {peutCreerSupprimer && <BoutonCreer />}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <BasculeTemps quand={quand} href={(q) => lienTemps("/evenements", { quand: valeurQuand(q) })} />
        {liste.length > 0 && (
          <p className="text-texte-secondaire">
            {liste.length} {liste.length > 1 ? "annonces" : "annonce"}
          </p>
        )}
      </div>

      {liste.length === 0 ? (
        <Alerte type="info" titre={passe ? "Aucun événement passé" : "Aucun événement à venir"}>
          {passe ? (
            <>
              <p>Les événements déjà terminés se rangent ici.</p>
              <p className="mt-3">
                <LienBouton href="/evenements" variante="secondaire" taille="petite" enCours>
                  <Icone nom="etendard" taille={18} />
                  Revenir aux événements à venir
                </LienBouton>
              </p>
            </>
          ) : peutCreerSupprimer ? (
            <>
              <p>Rien n&apos;est annoncé pour l&apos;instant. Ajoute un stage, un tournoi ou une démonstration.</p>
              <p className="mt-3">
                <BoutonCreer />
              </p>
            </>
          ) : (
            <p>Rien n&apos;est annoncé pour l&apos;instant. Les stages, tournois et démonstrations apparaîtront ici.</p>
          )}
        </Alerte>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {liste.map((e) => (
            <CarteEvenement
              key={e.id}
              evenement={e}
              aujourdHui={aujourdHui}
              passe={passe}
            />
          ))}
        </div>
      )}
    </div>
  );
}
