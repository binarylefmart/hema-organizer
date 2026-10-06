import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { ATELIER_LABELS, libelleAnimation } from "@/lib/ateliers";
import { ATELIER_STATUTS, type AtelierStatut } from "@/lib/constants";
import { formatDateCourte, formatHeure, toIsoDate } from "@/lib/dates";
import { seancesAVenir } from "@/lib/ateliers-queries";
import { Carte } from "@/components/ui/Carte";
import { Alerte } from "@/components/ui/Alerte";
import { DecisionAtelier } from "./DecisionAtelier";
import { effacerProposition } from "@/actions/ateliers";
import { Pastille } from "@/components/ui/Pastille";

export const metadata: Metadata = { title: "Ateliers" };

const TON: Record<
  AtelierStatut,
  "neutre" | "vert" | "rouge" | "ocre" | "primaire"
> = { PROPOSE: "ocre", REFUSE: "rouge", PLANIFIE: "vert" };

type Props = { searchParams: Promise<{ statut?: string }> };

/**
 * **Ce qu'on enseigne** : la file des propositions d'ateliers. Chaque carte pose « Que veux-tu
 * faire ? » (`DecisionAtelier`) avec les seuls gestes que son statut permet — placer dans le
 * planning (séance choisie), refuser, retirer du planning, remettre en attente — et, pour le bureau
 * seul, **effacer sans répondre** la proposition qui n'attendait pas de réponse : un doublon, un
 * envoi par erreur (voir `effacerProposition`, et `ateliers.supprimer` pour la frontière).
 *
 * La file relève de l'équipe, instructeurs compris (`ateliers.moderate`). Les **thèmes du
 * planning**, eux, ont quitté le pied de cet écran pour l'espace admin (`/admin/themes`) : ils
 * valent pour tout le club et pour toutes les séances à venir, là où un atelier ne concerne qu'une
 * proposition et une date.
 */
export default async function PageGestionAteliers({ searchParams }: Props) {
  const user = await requirePermission("ateliers.moderate");
  const { statut = "PROPOSE" } = await searchParams;
  const filtre = (ATELIER_STATUTS as readonly string[]).includes(statut)
    ? statut
    : "PROPOSE";
  const [ateliers, compteurs, seances] = await Promise.all([
    db.atelier.findMany({
      where: { statut: filtre },
      orderBy: { createdAt: filtre === "PROPOSE" ? "asc" : "desc" },
      include: {
        proposePar: { select: { prenom: true, nom: true } },
        animateur: { select: { prenom: true, nom: true } },
        animateurSecond: { select: { prenom: true, nom: true } },
        session: { select: { date: true, heureDebut: true, lieu: true } },
      },
    }),
    db.atelier.groupBy({ by: ["statut"], _count: { _all: true } }),
    seancesAVenir(user),
  ]);
  const nb = (s: string) =>
    compteurs.find((c) => c.statut === s)?._count._all ?? 0;
  // Effacer sans répondre est un geste de bureau (voir `effacerProposition`) : l'encadrement décide,
  // il ne fait pas disparaître l'écrit de quelqu'un.
  const peutEffacer = can(user, "ateliers.supprimer");
  return (
    /*
     * **La page s'élargit, les cartes non**. Une proposition d'atelier est une **file de décision**
     * — un titre, deux lignes de description, « Que veux-tu faire ? » et un bouton : l'étirer à 1
     * 400 px coucherait sa description sur une seule ligne, ce que Delta a refusé deux fois (30/09
     * et 01/10). La place se gagne donc **autrement**, en rangeant deux propositions par ligne.
     *
     * La largeur est posée **ici, sur la page**, et pas sur la grille en dessous : un élargissement
     * posé sur un morceau de page laisserait le titre et les puces de filtre dans la colonne étroite
     * au-dessus d'un contenu large — deux alignements sur le même écran.
     */
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-3xl">Ateliers</h1>
      </div>
      <div className="flex flex-wrap gap-2">
        {ATELIER_STATUTS.map((s) => (
          <Link
            key={s}
            href={`/gestion/ateliers?statut=${s}`}
            className={`flex min-h-12 items-center rounded-full border-2 px-4 text-sm font-semibold no-underline ${s === filtre ? "border-primaire bg-primaire text-primaire-texte shadow-bouton" : "border-bordure bg-surface text-texte"}`}
          >
            {ATELIER_LABELS[s]} ({nb(s)})
          </Link>
        ))}
      </div>
      {ateliers.length === 0 ? (
        <Alerte type="info">
          Aucun atelier «{" "}
          {ATELIER_LABELS[filtre as AtelierStatut].toLowerCase()} ».
        </Alerte>
      ) : (
        /*
         * **Deux colonnes au pixel où la page s'élargit** (1 024 px), et pas un palier plus tard.
         * Posée d'abord à `xl`, la bascule laissait une bande de 256 px (1 024 → 1 279) où la page
         * était large et la grille n'avait qu'une colonne : une carte **étirée à 976 px**, puis à
         * 1 231 — la carte allongée que Delta a refusée deux fois. Au même palier que la page, les
         * cartes font **478 px à 1 024** et **710 px à 1 920** ; 478 px, c'est plus large que la
         * carte d'un téléphone, et le formulaire interne y repasse en boutons pleine largeur tout
         * seul, parce qu'il mesure son conteneur et non la fenêtre (voir `DecisionAtelier`).
         *
         * **Pas de troisième colonne** : chaque carte porte un formulaire (la séance à choisir, le
         * mot facultatif), et un formulaire dans 470 px redevient le resserrement qu'on corrige
         * ailleurs — c'est la limite, pas un palier de plus à prendre.
         *
         * **Une grille, pas deux piles** — et sans `items-start` : les cartes d'une même rangée
         * gardent la même hauteur, sinon la file se lit comme un affichage cassé. C'est possible
         * ici, là où ça ne l'était pas pour les tuiles de l'accueil, parce que deux propositions se
         * ressemblent : même gabarit, même question, et une description bornée à quelques
         * lignes. Les boutons restent **en bas** de carte (`mt-auto` plus bas), donc alignés d'une
         * carte à l'autre.
         */
        <div className="grid gap-5 lg:grid-cols-2">
          {ateliers.map((a) => (
            <Carte key={a.id} className="flex flex-col">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="text-xl font-bold">{a.titre}</h2>
                  <p className="text-sm text-texte-secondaire">
                    Par {a.proposePar.prenom} {a.proposePar.nom} · le{" "}
                    {formatDateCourte(toIsoDate(a.createdAt))}
                  </p>
                </div>
                <Pastille ton={TON[a.statut as AtelierStatut]}>
                  {ATELIER_LABELS[a.statut as AtelierStatut]}
                </Pastille>
              </div>
              {a.description && (
                <p className="mt-3 whitespace-pre-line">{a.description}</p>
              )}
              {libelleAnimation(a.animateur, a.animateurSecond) && (
                <p className="mt-2 text-sm">{libelleAnimation(a.animateur, a.animateurSecond)}</p>
              )}
              {a.materiel && (
                <p className="mt-2 text-sm">
                  <span className="font-semibold">Équipement : </span>
                  {a.materiel}
                </p>
              )}
              {a.session && (
                <p className="mt-2 text-sm">
                  {a.statut === "PLANIFIE"
                    ? "Dans le planning le"
                    : "Séance souhaitée :"}{" "}
                  {formatDateCourte(a.session.date)} à{" "}
                  {formatHeure(a.session.heureDebut)} — {a.session.lieu}
                </p>
              )}
              {a.commentaireInstructeur && (
                <p className="mt-2 text-sm text-texte-secondaire">
                  Dernier commentaire : {a.commentaireInstructeur}
                </p>
              )}
              {/* `mt-auto` : dans une rangée de deux cartes de hauteurs différentes, la décision
                  reste collée au bas de la carte, à la même hauteur que celle de la voisine.
                  « Effacer sans répondre » n'est plus un bouton à part au pied de la carte : c'est
                  le dernier geste de la liste, pour le bureau seul, rouge parce qu'il ne se reprend
                  pas, et l'explication dit les deux choses qui comptent — personne n'est prévenu,
                  et « Refuser » existe pour dire non. */}
              <div className="mt-auto pt-4">
                <DecisionAtelier
                  atelierId={a.id}
                  statut={a.statut}
                  seances={seances}
                  sessionId={a.sessionId}
                  titre={a.titre}
                  prenom={a.proposePar.prenom}
                  seancePlacee={
                    a.statut === "PLANIFIE" && a.session
                      ? `${formatDateCourte(a.session.date)} à ${formatHeure(a.session.heureDebut)}`
                      : null
                  }
                  effacer={peutEffacer ? effacerProposition.bind(null, a.id) : undefined}
                />
              </div>
            </Carte>
          ))}
        </div>
      )}
    </div>
  );
}
