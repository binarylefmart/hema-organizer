import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { identite } from "@/lib/identite";
import { db } from "@/lib/db";
import { formatDateLongue, formatHoraire, seanceCommencee, todayIso } from "@/lib/dates";
import { participantsAPlat, seanceCarte } from "@/lib/seances";
import { ATELIER_LABELS } from "@/lib/ateliers";
import type { AtelierStatut } from "@/lib/constants";
import { modifierSeance } from "@/actions/seances";
import { Carte } from "@/components/ui/Carte";
import { LienBouton } from "@/components/ui/Bouton";
import { GestesSeance } from "@/components/seances/GestesSeance";
import { lienPlanning, modeEditionDemande } from "@/components/planning/mode-edition";
import { BarreTaux } from "@/components/seances/BarreTaux";
import { ListeParticipants } from "@/components/seances/ListeParticipants";
import { FormulaireSeance } from "@/components/gestion/FormulaireSeance";
import { getLieux } from "@/lib/planning";
import { PresencesEquipe } from "@/components/gestion/PresencesEquipe";
import { trierParActionnabilite } from "@/components/seances/listes";
import { BoutonPartager } from "@/components/partage/BoutonPartager";
import { partageSeance } from "@/components/partage/contenu";
import { ProgrammeCases } from "@/components/planning/GrillePlanning";
import { chargerPlanning } from "@/lib/planning";
import { Pastille } from "@/components/ui/Pastille";
import { PLEINE_LARGEUR } from "@/components/ui/pleine-largeur";
import { Icone } from "@/components/ui/Icone";

export const metadata: Metadata = { title: "Séance" };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ modifier?: string }> };

export default async function PageSeance({ params, searchParams }: Props) {
  const user = await requirePermission("sessions.manage");
  const { id } = await params;
  /*
   * **La fiche s'ouvre en lecture seule, comme le planning et la liste des séances** (`?modifier=1`).
   * Administrateurs compris : le bureau est un supplément, il ne change pas la vue. « Modifier la
   * séance » ouvre le formulaire (date, horaire, lieu), la correction des présences et
   * « Que veux-tu faire ? » (annuler, rétablir, supprimer). Tout s'y enregistre tout de suite :
   * « Terminer les modifications » ne fait que refermer.
   *
   * **Le programme ne se modifie pas ici** : en modification, la
   * carte « Programme » mène au planning, filtré sur le jour de la séance et déjà en modification —
   * un seul endroit où l'on règle les parties, avec son brouillon et ses deux boutons.
   */
  const enEdition = modeEditionDemande((await searchParams).modifier);
  const [carte, brut, periodes, lieux, club] = await Promise.all([
    seanceCarte(id, user),
    db.session.findUnique({ where: { id }, include: { ateliers: { include: { proposePar: true } } } }),
    db.period.findMany({ orderBy: { dateDebut: "desc" }, select: { id: true, nom: true } }),
    getLieux(),
    // La part minimale d'effectif du club, pour la jauge : `BarreTaux` est un composant client et ne
    // peut pas la lire lui-même (voir `src/lib/constants.ts`). Lecture mise en cache pour la durée
    // de la requête.
    identite(),
  ]);
  if (!carte || !brut) notFound();
  const planning = await chargerPlanning(carte.periodId, user);
  const colonne = planning?.colonnes.find((c) => c.id === id);
  const commencee = seanceCommencee(carte.date, carte.heureDebut);
  return (
    /*
     * **L'élargissement, comme `/seances` et le planning** (`PLEINE_LARGEUR`, posé une seule fois sur
     * l'écran entier). Il manquait ici, et c'était le trou du raisonnement de la carte « Programme »
     * juste dessous : celle-ci justifie l'empilement des deux cartes par « pleine largeur, les mêmes
     * champs se rangent en quatre colonnes ». Or `CaseEditeur` déclenche ses quatre colonnes sur la
     * largeur de la **fenêtre** (`xl:`, 1280 px), pas sur celle de son conteneur — sur un écran de
     * 1440 px, la page restait dans la colonne de lecture et rangeait quatre champs dans ~700 px
     * utiles : les noms d'instructeurs se retronquaient, exactement ce que l'empilement voulait
     * éviter. Une promesse d'écran se tient dans le code, ou elle ne s'écrit pas.
     */
    <div className={`flex flex-col gap-5 ${PLEINE_LARGEUR}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-texte-secondaire">
            <Link href={`/seances?periode=${carte.periodId}`}>Séances</Link> / {carte.periodNom}
          </p>
          <h1 className="text-3xl">{formatDateLongue(carte.date)}</h1>
          <p className="text-texte-secondaire">
            {formatHoraire(carte.heureDebut, carte.heureFin)} · {carte.lieu}
            {carte.annulee && (
              <>
                {" "}
                <Pastille ton="rouge">Annulée</Pastille>
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Le résumé public, à côté des actions de la séance : l'accès à cet écran fait déjà le tri,
              et le lien ne montre de toute façon ni nom ni liste de participants. */}
          <BoutonPartager
            partage={partageSeance({ ...carte, disciplines: carte.disciplines.join(", "), compteurs: carte.compteurs }, todayIso())}
            libelle="Partager la séance"
          />
          {!enEdition && (
            // **Visible sans chercher** : bouton plein, à côté du partage — la seule porte vers la saisie.
            <LienBouton href={`/seances/${id}?modifier=1`}>
              <Icone nom="livre" taille={20} />
              Modifier la séance
            </LienBouton>
          )}
        </div>
      </div>

      {enEdition && (
        // Le mode se dit, et sa sortie est à la place de l'entrée : on ne se demande jamais où l'on est.
        <div role="status" className="flex flex-col gap-3 rounded-xl border-2 border-primaire bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-semibold">Mode modification : chaque changement s&apos;enregistre tout de suite.</p>
          <LienBouton href={`/seances/${id}`} className="w-full sm:w-auto">
            Terminer les modifications
          </LienBouton>
        </div>
      )}

      {/*
       * **Programme et Présences l'un au-dessus de l'autre, et c'est ce qui raccourcit la page**
       * (Delta, — « pour pas avoir une page trop longue (c'est logique) »).
       *
       * En deux colonnes, le programme héritait d'une demi-largeur : les quatre champs d'une partie
       * (instructeur, second, thème, niveau) retombaient les uns sous les autres, si bien qu'une
       * séance de quatre parties faisait seize lignes de formulaire. À côté, la colonne des
       * présences tenait en dix centimètres et laissait le reste en blanc — la page était aussi
       * longue que la plus longue des deux colonnes, la moitié droite vide.
       *
       * Pleine largeur, les mêmes champs se rangent en quatre colonnes (`CaseEditeur`) : une partie
       * tient sur une ligne, la séance entière sur quatre. Empiler rend donc l'écran **plus court**,
       * pas plus long — et c'est le même agencement que le planning, qui montre déjà ces parties.
       *
       * « Pleine largeur » n'était vrai qu'à moitié quand cette phrase a été écrite : la page ne
       * portait pas `PLEINE_LARGEUR`, et les quatre colonnes de `CaseEditeur` se déclenchent sur la
       * fenêtre (`xl:`), pas sur le conteneur. Elle le porte maintenant — voir le commentaire de
       * l'élargissement, plus haut.
       */}
      <div className="flex flex-col gap-5">
        <Carte titre="Programme" actions={<Link href={`/planning?periode=${carte.periodId}`} className="inline-flex min-h-12 items-center text-sm">Voir tout le planning</Link>}>
          <div className="flex flex-col gap-4">
            {enEdition ? (
              <div className="flex flex-col gap-2">
                <LienBouton href={`${lienPlanning({ periode: carte.periodId, date: carte.date }, true)}#seance-${id}`} className="w-full sm:w-auto sm:self-start">
                  <Icone nom="livre" taille={20} />
                  Modifier le programme dans le planning
                </LienBouton>
              </div>
            ) : planning && colonne ? (
              <ProgrammeCases
                sessionId={id}
                // Les parties de cette séance, déjà triées : la carte du planning et cet écran
                // montrent exactement la même liste, par le même composant.
                parties={colonne.parties}
                options={{ personnes: planning.personnes, themes: planning.themes, ateliersDisponibles: planning.ateliersDisponibles, modifiable: false, peutProgrammer: false }}
              />
            ) : (
              <p className="text-texte-secondaire">Programme indisponible.</p>
            )}
          </div>
        </Carte>
        <Carte titre="Présences">
          {carte.annulee ? (
            <p className="text-texte-secondaire">Séance annulée : {carte.motifAnnulation}</p>
          ) : (
            <div className="flex flex-col gap-3">
              <BarreTaux compteurs={carte.compteurs} partEffectifMin={club.partEffectifMin} detail />
              {/* La liste change de bord avec la séance, comme son titre : avant le cours on relance
                  les silencieux, après on relit qui était là. */}
              <ListeParticipants liste={carte.participants} titre={commencee ? "Qui était là ?" : "Qui vient ?"} passee={commencee} />
              {/*
                Seul l'ADMIN corrige la réponse d'autrui : les instructeurs gardent la liste en
                lecture seule.

                **Et il lui faut l'espace admin ouvert**. Le registre engage le club,
                et une relecture a mesuré qu'un appel forgé depuis une session ouverte par le seul
                lien personnel d'un administrateur ramenait une séance de onze réponses à zéro. Le
                verrou vit dans l'action (`attendances.autrui` a quitté `SANS_SESSION_FORTE`) ; ici
                on ne fait que **ne pas montrer un registre qui ne pourrait que refuser** — le
                dossier s'interdit « un bouton qui ne peut que refuser », il est pire que pas de
                bouton. À la place, la phrase dit le geste qui manque et y mène, avec le retour
                préparé : un aller-retour, et on corrige. Cocher repousse ensuite l'élévation
                elle-même (`toucherElevation`), donc on n'est pas interrompu au milieu de la liste. */}
              {enEdition &&
                can(user, "attendances.autrui") &&
                (user.sessionForte ? (
                  <PresencesEquipe sessionId={id} participants={trierParActionnabilite(participantsAPlat(carte.participants))} />
                ) : (
                  <p className="text-sm text-texte-secondaire">
                    Pour corriger la réponse de quelqu&apos;un,{" "}
                    <Link href={`/connexion/admin?suite=${encodeURIComponent(`/seances/${id}`)}`}>ouvre l&apos;espace admin</Link> — ton mot de
                    passe et ton code. Tu reviendras sur cette séance.
                  </p>
                ))}
              <p className="text-sm text-texte-secondaire">
                Le lien de partage, en haut de page, ne montre aucun nom : seulement la date, le lieu, le thème et les chiffres.
              </p>
            </div>
          )}
        </Carte>
      </div>

      {brut.ateliers.length > 0 && (
        <Carte titre="Ateliers rattachés">
          <ul className="flex flex-col gap-2">
            {brut.ateliers.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <strong>{a.titre}</strong> — {a.proposePar.prenom} {a.proposePar.nom}
                </span>
                <Pastille ton={a.statut === "PLANIFIE" ? "vert" : a.statut === "REFUSE" ? "rouge" : "ocre"}>{ATELIER_LABELS[a.statut as AtelierStatut]}</Pastille>
              </li>
            ))}
          </ul>
          <Link href="/gestion/ateliers" className="mt-3 inline-flex min-h-12 items-center text-sm">
            Gérer les ateliers
          </Link>
        </Carte>
      )}

      {enEdition && (
        <Carte titre="Annuler, rétablir ou supprimer">
          {/* **Supprimer appartient au bureau, espace admin ouvert** : `supprimerSeance` exige
              `periods.manage` et l'élévation, comme son jumeau sur l'écran de la période. Le geste
              n'est proposé qu'à qui peut aboutir — un geste qui ne peut que refuser est pire que pas
              de geste. */}
          <GestesSeance id={id} annulee={carte.annulee} passee={commencee} supprimer={can(user, "periods.manage") && user.sessionForte} />
        </Carte>
      )}

      {enEdition && (
        <Carte titre="Date, horaire et lieu">
        <FormulaireSeance
          action={modifierSeance.bind(null, id)}
          bouton="Enregistrer"
          periodes={periodes}
          lieux={lieux}
          valeurs={{
            periodId: carte.periodId,
            date: carte.date,
            heureDebut: carte.heureDebut,
            heureFin: carte.heureFin,
            lieu: carte.lieu,
            adresse: carte.adresse,
          }}
        />
        </Carte>
      )}
    </div>
  );
}
