"use client";

import { useState } from "react";
import Link from "next/link";
import { Bouton, LienBouton } from "@/components/ui/Bouton";
import { EntreeVolet } from "@/components/ui/GestesVolet";
import { GroupeListe } from "@/components/ui/ListeGroupee";
import { Icone } from "@/components/ui/Icone";
import { Pastille } from "@/components/ui/Pastille";
import { VoletBas } from "@/components/ui/VoletBas";
import { varianteGeste } from "@/components/ui/choix-geste";
import { gestesEvenement, type GesteEvenementOffert } from "./gestes-evenement";
import { blocDate, groupesParEtat } from "./groupes-gestion";
import { dateEvenementCourte, horaireEvenementCourt, type EvenementAffiche } from "./libelles";
import { useGesteEvenement } from "./useGesteEvenement";

/** Ce que la ligne affiche d'une annonce : de quoi la reconnaître et savoir où elle en est. */
export type LigneEvenement = Pick<EvenementAffiche, "id" | "nom" | "dateDebut" | "dateFin" | "heureDebut" | "heureFin" | "lieu"> & { publie: boolean };

/**
 * **La liste de gestion des événements, version téléphone** — l'envers du tableau de l'ordinateur,
 * qui ne change pas.
 *
 * - **Rangée par état** (`groupesParEtat`) : « À publier » en tête, puis « Publiés » — ce qui attend
 *   un geste passe devant, chaque groupe dans l'ordre des dates.
 * - **Une ligne d'agenda par annonce** : le jour en bloc à gauche, le titre (lien vers la fiche), la
 *   ligne courte « date · horaire · lieu » de la carte du fil, et la pastille d'état.
 * - **Les gestes courants en boutons directs**, comme les ateliers (`DecisionAtelier`) : « Modifier »,
 *   puis le geste du moment en bouton plein — « Publier » pour un brouillon, « Voir » pour une annonce
 *   publiée —, et « ⋯ » qui range le reste dans le volet du bas, en toutes lettres (`GestesVolet`) :
 *   dépublier, supprimer, voir comme un membre.
 *
 * Les gestes sont ceux de « Que veux-tu faire ? » (`gestesEvenement`, mêmes droits) et partent par la
 * même écriture (`useGesteEvenement`) : mêmes confirmations, mêmes actions serveur. Un seul volet et un
 * seul message pour toute la liste : une annonce publiée change de groupe, donc de place, et un
 * message posé sur sa ligne disparaîtrait avec elle.
 */
export function ListeEvenementsTelephone({
  evenements,
  modifier,
  supprimer,
  aujourdHui,
}: {
  evenements: LigneEvenement[];
  /** `evenements.edit` : modifier, publier, dépublier. */
  modifier: boolean;
  /** `evenements.creer_supprimer` : supprimer. */
  supprimer: boolean;
  aujourdHui: string;
}) {
  const droits = { modifier, supprimer };
  const { lancer, enCours, message, setMessage } = useGesteEvenement();
  // L'annonce dont le geste est en cours : seul son bouton dit « Un instant… ».
  const [cible, setCible] = useState<string | null>(null);
  const [ouvert, setOuvert] = useState<string | null>(null);

  const fermer = () => {
    setOuvert(null);
  };
  const lancerSur = (id: string, offert: GesteEvenementOffert) => {
    setCible(id);
    lancer(id, offert, { apres: fermer });
  };

  // Une annonce supprimée ailleurs entre-temps : le volet se referme de lui-même, faute de sujet.
  const enVolet = evenements.find((e) => e.id === ouvert) ?? null;
  // Le volet range ce que la ligne ne montre pas : ni « Modifier » ni « Publier », déjà en boutons.
  const gestesVolet = enVolet
    ? gestesEvenement(enVolet, droits)
        .filter((g) => g.geste !== "modifier" && g.geste !== "publier")
        // « … » : le geste demande encore une confirmation avant de partir.
        .map((g) => ({
          ...g,
          libelle: g.confirmation ? `${g.libelle}…` : g.libelle,
        }))
    : [];

  return (
    <div className="flex flex-col gap-4">
      {/* Région vivante montée en permanence : créée avec son texte, elle ne serait pas annoncée. */}
      <p className="text-base empty:hidden" aria-live="polite">
        {message ? <span className={message.type === "ok" ? "font-semibold text-vert" : "font-semibold text-rouge"}>{message.texte}</span> : null}
      </p>

      {groupesParEtat(evenements).map((groupe) => (
        <GroupeListe key={groupe.cle} titre={groupe.titre}>
          {groupe.evenements.map((e) => {
            const gestes = gestesEvenement(e, droits);
            const publier = gestes.find((g) => g.geste === "publier");
            const { semaine, jour } = blocDate(e.dateDebut);
            const ligne = [dateEvenementCourte(e.dateDebut, e.dateFin, aujourdHui), horaireEvenementCourt(e.heureDebut, e.heureFin), e.lieu]
              .filter(Boolean)
              .join(" · ");
            return (
              <div key={e.id} className="flex flex-col gap-3 px-4 py-3" data-ligne-evenement={e.id}>
                <div className="flex items-center gap-3">
                  {/* Le bloc date est un repère pour l'œil : la ligne de texte dit la date en entier. */}
                  <span aria-hidden className="flex w-12 shrink-0 flex-col items-center border-r border-bordure/60 pr-3 leading-tight">
                    <span className="text-sm uppercase text-texte-secondaire">{semaine}</span>
                    <span className="text-2xl font-bold">{jour}</span>
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <Link href={`/evenements/${e.id}`} className="font-semibold text-texte no-underline">
                      {e.nom}
                    </Link>
                    {/* La pastille sous le titre, et non à droite : à droite, elle prenait la place de
                        la ligne « date · horaire · lieu », qui se pliait sur trois lignes. */}
                    <span className="self-start">{e.publie ? <Pastille ton="vert">Publié</Pastille> : <Pastille ton="ocre">Brouillon</Pastille>}</span>
                    {ligne && <span className="text-base text-texte-secondaire">{ligne}</span>}
                  </span>
                </div>

                <div className="flex gap-2">
                  {modifier && (
                    <LienBouton href={`/evenements/${e.id}/modifier`} variante="secondaire" taille="petite" className="flex-1">
                      Modifier
                    </LienBouton>
                  )}
                  {publier ? (
                    <Bouton
                      taille="petite"
                      className="flex-1"
                      disabled={enCours}
                      aria-busy={enCours && cible === e.id}
                      onClick={() => {
                        setMessage(null);
                        lancerSur(e.id, publier);
                      }}
                    >
                      {enCours && cible === e.id ? "Un instant…" : "Publier"}
                    </Bouton>
                  ) : (
                    <LienBouton href={`/evenements/${e.id}`} taille="petite" className="flex-1">
                      Voir
                    </LienBouton>
                  )}
                  <Bouton
                    variante="secondaire"
                    taille="petite"
                    className="shrink-0"
                    aria-label="Autres gestes"
                    aria-haspopup="dialog"
                    disabled={enCours}
                    onClick={() => {
                      setMessage(null);
                      setOuvert(e.id);
                    }}
                  >
                    <Icone nom="points" taille={24} strokeWidth={3} />
                  </Bouton>
                </div>
              </div>
            );
          })}
        </GroupeListe>
      ))}

      <VoletBas
        ouvert={Boolean(enVolet)}
        titre={enVolet?.nom ?? ""}
        // Pendant l'envoi, le volet reste ouvert : le fermer laisserait croire que rien ne part.
        onFermer={() => !enCours && fermer()}
      >
        {enVolet && (
          <>
            {/* **Chaque geste part d'un toucher**, avec sa confirmation (celle du geste offert) : plus
                d'étape d'explication avant le bouton, demandée en trop pour deux gestes que leur
                libellé et leur confirmation disent déjà. */}
            {message?.type === "erreur" && <p className="font-semibold text-rouge" role="alert">{message.texte}</p>}
            <div className="flex flex-col gap-2">
              {gestesVolet.map((offert) => (
                <EntreeVolet
                  key={offert.geste}
                  libelle={offert.libelle}
                  rouge={varianteGeste(offert.definitif, offert.bouton) === "danger"}
                  onClick={() => !enCours && lancerSur(enVolet.id, offert)}
                />
              ))}
            </div>
            {/* Ce qui n'écrit rien reste un lien : la fiche telle que le club la lit. */}
              <Link
                href={`/evenements/${enVolet.id}`}
                className="flex min-h-14 w-full items-center gap-3 rounded-xl border-2 border-bordure/70 bg-surface px-4 py-2 text-base font-semibold text-texte no-underline shadow-carte"
              >
                <span className="min-w-0 flex-1">Voir comme un membre</span>
                <Icone nom="chevronBas" taille={22} className="shrink-0 -rotate-90" />
              </Link>
          </>
        )}
      </VoletBas>
    </div>
  );
}
