import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/current-user";
import { lienCarte } from "@/lib/dates";
import { evenementParId } from "@/lib/evenements";
import { identite } from "@/lib/identite";
import { can } from "@/lib/permissions";
import { Alerte } from "@/components/ui/Alerte";
import { LienBouton } from "@/components/ui/Bouton";
import { Icone } from "@/components/ui/Icone";
import { BoutonPartager } from "@/components/partage/BoutonPartager";
import { BandeauEvenement } from "@/components/evenements/BandeauEvenement";
import { GestesEvenement } from "@/components/evenements/GestesEvenement";
import { dateEvenement, horaireEvenement, libelleDuree, libellePrix } from "@/components/evenements/libelles";
import { partageEvenement } from "@/components/evenements/partage";
import { PLEINE_LARGEUR_2XL } from "@/components/ui/pleine-largeur";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const e = await evenementParId((await params).id);
  return { title: e?.nom ?? "Événement" };
}

/** Une ligne du bloc « quand / où / qui ». */
function Ligne({ icone, children }: { icone: "calendrier" | "lieu" | "groupe" | "sablier" | "etiquette"; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <Icone nom={icone} taille={20} className="mt-0.5 text-texte-secondaire" />
      <span className="min-w-0">{children}</span>
    </li>
  );
}

/**
 * La page d'un événement : tout ce qu'on veut savoir avant de décider d'y aller.
 *
 * On y arrive par le volet de l'en-tête ou par le fil, jamais par un onglet — l'annonce se lit une
 * fois, elle n'a pas à occuper la barre de navigation en permanence. Au bas de la page, les gestes
 * d'écriture sur cette annonce : la corriger et la publier ou la dépublier (`evenements.edit`),
 * l'effacer (`evenements.creer_supprimer`).
 *
 * Un brouillon ne s'ouvre que pour l'équipe : `evenementParId` renvoie `null` aux autres, et la
 * page répond « introuvable » — pas « interdit », qui confirmerait son existence.
 *
 * La description s'y lit **entière** : le repli « Lire la suite » est une politesse du fil, qui
 * empile les annonces ; ici on est venu pour les détails.
 */
export default async function PageEvenement({ params }: Props) {
  const user = await requireUser();
  const { id } = await params;
  const e = await evenementParId(id, user);
  if (!e) notFound();
  const club = await identite();
  const horaire = horaireEvenement(e.heureDebut, e.heureFin);
  // Durée annoncée par l'équipe (un nombre + une unité) : ce n'est **pas** un calcul sur les dates
  // de début et de fin, et rien ne garantit qu'elle s'accorde avec elles (« 2 jours » sur une
  // annonce d'un seul jour reste possible). C'est voulu — on restitue la saisie, on ne déduit rien.
  const duree = libelleDuree(e.dureeNombre, e.dureeUnite);
  const peutModifier = can(user, "evenements.edit");
  const peutCreerSupprimer = can(user, "evenements.creer_supprimer");
  /*
   * **L'affiche décide de la mise en page, et c'est une donnée — pas une largeur d'écran.**
   *
   * Une annonce sur deux n'a pas d'affiche (le jeu d'essai n'en a aucune) : `BandeauEvenement` rend
   * alors une rangée d'écu de 96 px. La ranger quand même dans une colonne de 22 rem laisserait,
   * sous elle, une **colonne vide** sur toute la hauteur de la fiche. L'affiche ne passe donc à
   * gauche que s'il y en a une ; sinon le bandeau de repli garde sa pleine largeur, comme
   * aujourd'hui. Un seul arbre, une classe conditionnelle : le serveur lit la donnée, il ne devine
   * aucune largeur d'écran (`tests/unit/bandes-pleine-largeur.test.ts`).
   */
  const avecAffiche = Boolean(e.imageUrl);

  return (
    /*
     * **Une fiche ne s'élargit qu'à 1 536 px** (`PLEINE_LARGEUR_2XL`), là où un tableau s'élargit
     * dès 1 024 : il faut la place de mettre quelque chose **à côté**, et ici c'est l'affiche.
     * Mesuré : 736 px de contenu et 1 184 px de blanc sur un écran de 1 920.
     */
    <div className={`flex flex-col gap-5 ${PLEINE_LARGEUR_2XL}`}>
      <p>
        <LienBouton href="/evenements" variante="discret" taille="petite" enCours className="-ml-4">
          <Icone nom="fleche" taille={18} className="rotate-180" />
          Tous les événements
        </LienBouton>
      </p>

      {!e.publie && (
        <Alerte type="attention" titre="Brouillon">
          Cette annonce n&apos;est visible que de l&apos;équipe tant qu&apos;elle n&apos;est pas publiée — « Publier l&apos;annonce », dans « Que veux-tu faire ? » au bas de la page.
        </Alerte>
      )}

      {/* **`@container`, et pas `sm:`/`lg:` : ici, c'est la carte qu'il faut mesurer, pas la fenêtre.**
          La fiche vaut 736 px jusqu'à 1 536 px, puis 1 440 — un palier de fenêtre mentirait dans la
          moitié des cas, et c'est le piège que `CLAUDE.md` nomme en toutes lettres. `@3xl` = 48 rem :
          la carte se partage quand elle a 768 px à elle, jamais quand l'écran en a. */}
      <article className="@container overflow-hidden rounded-2xl border border-bordure/60 bg-surface shadow-carte">
        <div className={`flex flex-col ${avecAffiche ? "@3xl:flex-row" : ""}`}>
          {/* L'affiche à gauche, dans 22 rem au plus : en pleine largeur, un 16/9 de 1 440 px ferait
              810 px de haut et repousserait toute l'annonce sous l'écran. */}
          <div className={avecAffiche ? "@3xl:w-88 @3xl:shrink-0 @3xl:self-start" : ""}>
            <BandeauEvenement src={e.imageUrl} nom={e.nom} ecu={club.ecu} />
          </div>
          <div className={`flex min-w-0 flex-col gap-4 p-4 sm:p-6 ${avecAffiche ? "@3xl:flex-1" : ""}`}>
            <h1 className="text-3xl">{e.nom}</h1>

            {/* Cinq faits courts : une colonne tant que la carte est étroite, deux dès qu'elle a 48 rem
                — une `grid` à une colonne se lit comme la pile qu'elle remplace, au pixel près. */}
            <ul className="grid gap-2 @3xl:grid-cols-2">
              <Ligne icone="calendrier">
                <span className="font-semibold">{dateEvenement(e.dateDebut, e.dateFin)}</span>
                {horaire && <span className="block text-texte-secondaire">{horaire}</span>}
              </Ligne>
              {e.lieu && (
                <Ligne icone="lieu">
                  {e.adresse ? (
                    <a
                      href={lienCarte(e.lieu, e.adresse)}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={`${e.adresse} — ouvrir la carte`}
                      className="underline decoration-lien/40 hover:decoration-lien"
                    >
                      {e.lieu}
                    </a>
                  ) : (
                    e.lieu
                  )}
                  {e.adresse && <span className="block text-texte-secondaire">{e.adresse}</span>}
                </Ligne>
              )}
              {e.organisateur && <Ligne icone="groupe">Organisé par {e.organisateur}</Ligne>}
              {duree && <Ligne icone="sablier">{duree}</Ligne>}
              {/* Le tarif est toujours affiché : un champ vide veut dire « gratuit », et c'est une
                  information qu'on vient chercher — pas un silence à laisser interpréter. */}
              <Ligne icone="etiquette">{libellePrix(e.prix, e.prixAdherent)}</Ligne>
            </ul>

            {/* **Un texte courant ne s'étire pas** : 65 caractères de large au plus, même dans une
                colonne de 1 040 px. Au-delà, l'œil perd sa ligne en revenant à la marge. */}
            {e.description && <p className="max-w-prose whitespace-pre-line">{e.description}</p>}

            {(e.lienInscription || e.lienSource) && (
              <div className="flex flex-wrap items-center gap-2">
                {e.lienInscription && (
                  <LienBouton href={e.lienInscription} target="_blank" rel="noopener noreferrer" className="w-full sm:w-auto">
                    S&apos;inscrire
                    <Icone nom="lienExterne" taille={18} />
                  </LienBouton>
                )}
                {e.lienSource && (
                  <LienBouton href={e.lienSource} target="_blank" rel="noopener noreferrer" variante="discret" taille="petite">
                    Voir la publication
                    <Icone nom="lienExterne" taille={16} />
                  </LienBouton>
                )}
              </div>
            )}

            {/* Faire circuler l'annonce : partage natif du téléphone, WhatsApp, ou copie du lien.
                Le lien pointe vers la page publique, ouvrable sans compte. */}
            <div className="border-t border-bordure/50 pt-4">
              <BoutonPartager partage={partageEvenement(e)} libelle="Partager l'événement" />
            </div>
          </div>
        </div>
      </article>

      {/*
        * **Les gestes de l'équipe sur CETTE annonce, et seulement ceux qui s'appliquent** : la
        * corriger, la publier ou la repasser en brouillon, l'effacer — posés par « Que veux-tu
        * faire ? », la forme commune de l'administration (`GestesEvenement`, `gestes-evenement.ts`).
        * Chaque geste est expliqué avant d'agir (la phrase qui vivait sous les boutons est devenue
        * l'explication de « Publier » et de « Dépublier »), rouge et confirmé pour ce qui retire
        * l'annonce. « Nouvel événement » n'est pas ici : ouvrir une autre annonce n'est pas un geste
        * sur celle-ci, et le bouton vit en tête du fil et de la liste de gestion.
        */}
      {(peutModifier || peutCreerSupprimer) && (
        <section aria-label="Gérer l'annonce" className="sm:max-w-md">
          <GestesEvenement id={e.id} nom={e.nom} publie={e.publie} modifier={peutModifier} supprimer={peutCreerSupprimer} apresSuppression="/evenements" />
        </section>
      )}
    </div>
  );
}
