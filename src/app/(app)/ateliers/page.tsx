import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/current-user";
import { db } from "@/lib/db";
import { ATELIER_LABELS, libelleAnimation, membrePeutModifier } from "@/lib/ateliers";
import type { AtelierStatut } from "@/lib/constants";
import { formatDateCourte, formatHeure, toIsoDate } from "@/lib/dates";
import { animateursPossibles, seancesAVenir } from "@/lib/ateliers-queries";
import { proposerAtelier, supprimerAtelier } from "@/actions/ateliers";
import { Alerte } from "@/components/ui/Alerte";
import { LienBouton } from "@/components/ui/Bouton";
import { Icone } from "@/components/ui/Icone";
import { BoutonAction } from "@/components/ui/BoutonAction";
import { Carte } from "@/components/ui/Carte";
import { FormulaireAtelier } from "@/components/ateliers/FormulaireAtelier";
import { Pastille } from "@/components/ui/Pastille";
import { DeuxColonnes, LARGEUR_PAGE } from "@/components/ui/DeuxColonnes";
import { BasculeAteliers } from "./BasculeAteliers";

export const metadata: Metadata = { title: "Proposer un atelier" };

const TON: Record<
  AtelierStatut,
  "neutre" | "vert" | "rouge" | "ocre" | "primaire"
> = { PROPOSE: "ocre", REFUSE: "rouge", PLANIFIE: "vert" };

type Props = { searchParams: Promise<{ propose?: string }> };

/**
 * Onglet Atelier : « Mes propositions » d'abord (statut, commentaire de l'instructeur, modification
 * tant que « en attente ») puis le formulaire, pour qu'un membre qui revient voie tout de suite ses
 * propositions sans faire défiler. Tant qu'il n'a rien proposé, le formulaire reste en haut de page.
 * Un atelier programmé apparaît dans une case du planning et sur la carte de la séance.
 */
export default async function PageAteliers({ searchParams }: Props) {
  const user = await requireUser();
  const { propose } = await searchParams;
  const [ateliers, seances, animateurs] = await Promise.all([
    db.atelier.findMany({
      where: { proposeParId: user.id },
      orderBy: { createdAt: "desc" },
      include: {
        session: { select: { date: true, heureDebut: true, lieu: true } },
        animateur: { select: { prenom: true, nom: true } },
        animateurSecond: { select: { prenom: true, nom: true } },
      },
    }),
    seancesAVenir(user),
    animateursPossibles(),
  ]);
  const aDesPropositions = ateliers.length > 0;
  /*
   * Le formulaire, toujours présent et déplié. **Il n'a plus qu'une place** : la colonne de gauche.
   * Il changeait de position — en haut tant qu'il n'y avait rien à suivre, sous la liste ensuite —,
   * ce qui était la meilleure réponse possible dans une colonne unique : avec trois propositions
   * suivies, il fallait défiler pour en proposer une quatrième. Les deux colonnes suppriment le
   * dilemme ; son titre, lui, continue de dire s'il en vient une **autre**.
   */
  const formulaire = (
    <Carte titre={aDesPropositions ? "Proposer un autre atelier" : undefined}>
      <FormulaireAtelier
        action={proposerAtelier}
        seances={seances}
        animateurs={animateurs}
        animateurParDefaut={user.id}
        bouton="Envoyer ma proposition"
      />
    </Carte>
  );
  /*
   * « Mes propositions » : la colonne de droite sur ordinateur, et tout l'écran sur téléphone, où
   * l'assistant de proposition s'ouvre par-dessus (`BasculeAteliers`).
   */
  const propositions = (
    <>
            <h2 className="text-2xl font-bold">Mes propositions</h2>
            {!aDesPropositions && (
              <Alerte type="info">Tu n&apos;as encore rien proposé.</Alerte>
            )}
            {/* Le raccourci vers le planning accompagne l'écran : sa place est ici, et non flottant en
                bas de page — où la largeur de 90 rem le laissait seul, loin de tout. */}
            <LienBouton href="/planning" variante="secondaire" taille="petite" className="w-full sm:w-auto">
              <Icone nom="calendrier" taille={18} />
              Voir le planning
            </LienBouton>
            {ateliers.map((a) => (
        <Carte key={a.id}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-xl font-bold">{a.titre}</h2>
              <p className="text-sm text-texte-secondaire">
                Proposé le {formatDateCourte(toIsoDate(a.createdAt))}
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
            <p className="mt-3 rounded-xl bg-surface-douce p-3">
              <span className="font-semibold">
                Réponse de l&apos;instructeur :{" "}
              </span>
              {a.commentaireInstructeur}
            </p>
          )}
          {membrePeutModifier(a.statut) && (
            // Actions groupées : côte à côte sur téléphone, alignées à droite de la carte sur PC
            <div className="mt-4 flex flex-wrap items-center gap-2 sm:justify-end">
              <LienBouton
                href={`/ateliers/${a.id}`}
                variante="secondaire"
                taille="petite"
              >
                <Icone nom="outil" taille={18} />
                Modifier
              </LienBouton>
              <BoutonAction
                action={supprimerAtelier.bind(null, a.id)}
                variante="danger"
                taille="petite"
                confirmation="Retirer cette proposition ?"
              >
                <Icone nom="alerte" taille={18} />
                Retirer
              </BoutonAction>
            </div>
          )}
        </Carte>
            ))}
    </>
  );
  return (
    <div className={`flex flex-col gap-5 ${LARGEUR_PAGE}`}>
      <div>
        <h1 className="text-3xl">Proposer un atelier</h1>
      </div>
      {propose === "ok" && (
        <Alerte type="succes">
          Proposition envoyée. Les instructeurs te répondront par email.
        </Alerte>
      )}
      {/*
        * **Deux colonnes dès 1 280 px : la proposition à gauche, les siennes à droite**. Sur un
        * grand écran, cet écran tenait 768 px au milieu de rien, et le formulaire était suivi de
        * deux lignes de suivi.
        *
        * Le formulaire reste **à gauche et toujours déplié** : c'est le geste pour lequel on ouvre la
        * page. Ses propositions passent à droite, où elles se lisent d'un coup d'œil — statut compris
        * — sans pousser le formulaire hors de l'écran, ce qui était le défaut de l'empilement : avec
        * trois propositions suivies, il fallait défiler pour en proposer une quatrième.
        *
        * Sur téléphone, la page s'ouvre sur ses propositions et le formulaire devient un assistant
        * en quatre questions (`BasculeAteliers`). Une proposition envoyée (un identifiant neuf dans
        * la liste) remonte les formulaires, et l'écran repart sur la liste, message de succès en
        * tête ; en retirer une ne touche pas au brouillon en cours.
        */}
      <BasculeAteliers
        idsPropositions={ateliers.map((a) => a.id)}
        ordinateur={<DeuxColonnes principal={formulaire} cote={propositions} />}
        propositions={propositions}
        action={proposerAtelier}
        seances={seances}
        animateurs={animateurs}
        moi={{ id: user.id, prenom: user.prenom, nom: user.nom }}
      />
    </div>
  );
}

