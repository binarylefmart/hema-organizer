"use client";

import { useState, useTransition, type ReactNode } from "react";
import { apercuDeLien } from "@/actions/liens";
import type { FormState } from "@/lib/form";
import { Bouton } from "@/components/ui/Bouton";
import { Case, Champ, CLASSES_CONTROLE } from "@/components/ui/Champ";
import { FormulaireAction } from "@/components/ui/FormulaireAction";
import { Icone } from "@/components/ui/Icone";
import { ZoneTexte } from "@/components/ui/ZoneTexte";
import { ChampAffiche } from "./ChampAffiche";
import { UNITES_DUREE_CHOIX, type EvenementAffiche } from "./libelles";

/**
 * Longueur maximale de la description. Une annonce doit se lire comme un message : au-delà, c'est
 * la publication d'origine qui prend le relais (« Voir la publication » sur la carte).
 */
const DESCRIPTION_MAX = 600;

type Props = {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  valeurs?: EvenementAffiche;
  bouton: string;
  /** Rendu à côté du bouton d'envoi (« Annuler ») */
  apres?: ReactNode;
};

/**
 * Saisie d'un événement — le même formulaire pour la création et la modification.
 *
 * Le chemin le plus court part du **lien d'origine** : on colle l'adresse de la publication
 * (page Facebook, billetterie, site de l'organisateur), on demande « Récupérer les infos du lien »
 * et le nom, le texte et l'affiche se remplissent seuls. Tout reste ensuite modifiable : l'aperçu
 * est une aide à la saisie, jamais une source verrouillée.
 *
 * La case « Publié » en bas garde la main sur ce que le club voit : décochée, l'annonce reste un
 * brouillon visible de la seule équipe.
 */
export function FormulaireEvenement({ action, valeurs, bouton, apres }: Props) {
  const [nom, setNom] = useState(valeurs?.nom ?? "");
  const [description, setDescription] = useState(valeurs?.description ?? "");
  const [imageUrl, setImageUrl] = useState(valeurs?.imageUrl ?? "");
  const [lienSource, setLienSource] = useState(valeurs?.lienSource ?? "");
  const [apercu, setApercu] = useState<{ message: string; ton: "info" | "erreur" } | null>(null);
  const restants = DESCRIPTION_MAX - description.length;
  const [enCours, demarrer] = useTransition();

  function recupererLesInfos() {
    const url = lienSource.trim();
    if (!url) {
      setApercu({ message: "Colle d'abord l'adresse de la publication.", ton: "erreur" });
      return;
    }
    setApercu(null);
    demarrer(async () => {
      const res = await apercuDeLien(url);
      if (!res.ok) {
        setApercu({ message: res.erreur, ton: "erreur" });
        return;
      }
      // On ne remplit que les cases que la page renseigne : ce qui est déjà saisi n'est pas effacé
      // par une page avare en balises, et rien n'est jamais verrouillé.
      const { titre, description: texte, image } = res.apercu;
      const remplis: string[] = [];
      if (titre) {
        setNom(titre);
        remplis.push("le nom");
      }
      if (texte) {
        setDescription(texte.slice(0, DESCRIPTION_MAX));
        remplis.push("la description");
      }
      if (image) {
        setImageUrl(image);
        remplis.push("l'affiche");
      }
      setApercu(
        remplis.length > 0
          ? { message: `Récupéré : ${remplis.join(", ")}. Relis et corrige si besoin.`, ton: "info" }
          : { message: "Cette page ne donne ni titre, ni texte, ni image : à saisir à la main.", ton: "erreur" },
      );
    });
  }

  return (
    <FormulaireAction action={action} bouton={bouton} enCours="Enregistrement…" apres={apres} className="@container">
      {/* **Deux colonnes de champs, et c'est le FORMULAIRE qu'on mesure, jamais la fenêtre**.

          Un formulaire ne s'élargit pas — un champ de 1 400 px est exactement ce que la doctrine du
          dépôt refuse. Mais **deux colonnes de ~690 px ne sont pas un élargissement** : c'est la
          géométrie d'un téléphone, posée deux fois. D'où `@container` sur le `<form>` et la grille
          sur un **enfant** : un élément qui *est* le conteneur ne peut pas interroger sa propre
          largeur, son `@3xl:` irait chercher le conteneur du dessus — donc la page — et répondrait
          sur la foi d'autre chose que ce qu'il croit mesurer.

          `grid-cols-1` est écrit en clair, et ce n'est pas une politesse : une grille sans colonne
          déclarée laisse une piste `auto` qui grossit jusqu'au `max-content` de la plus longue de
          ses aides — c'est ainsi qu'un formulaire voisin a débordé de 207 px sur un téléphone. */}
      <div className="grid grid-cols-1 gap-4 @3xl:grid-cols-2 @3xl:gap-x-6">
        {/* Le lien d'origine en premier : c'est lui qui remplit le reste. Il reste **une cellule**,
            et pas un bloc pleine ligne : mesuré, son bouton « Récupérer les infos » et le compte rendu
            qui le suit tiennent dans 687 px à la même hauteur que dans 1 398 (166 px dans les deux
            cas), et il s'apparie alors avec le nom au lieu de s'offrir une ligne à lui. */}
        <div className="flex flex-col gap-2">
          <Champ
            label="Lien de la publication d'origine"
            name="lienSource"
            type="url"
            inputMode="url"
            value={lienSource}
            onChange={(ev) => setLienSource(ev.target.value)}
            maxLength={500}
            placeholder="https://…"
            aide="Facultatif. La page de l'organisateur, l'annonce Facebook, l'article…"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Bouton type="button" variante="secondaire" taille="petite" onClick={recupererLesInfos} disabled={enCours} aria-busy={enCours}>
              <Icone nom="telecharger" taille={18} />
              {enCours ? "Lecture de la page…" : "Récupérer les infos du lien"}
            </Bouton>
            {apercu && (
              <p role="status" className={`text-sm font-semibold ${apercu.ton === "erreur" ? "text-rouge" : "text-texte-secondaire"}`}>
                {apercu.message}
              </p>
            )}
          </div>
        </div>

        <Champ label="Nom de l'événement" name="nom" value={nom} onChange={(ev) => setNom(ev.target.value)} maxLength={150} required placeholder="ex. Tournoi d'épée longue" />

        {/* **Chaque cellule qui range une sous-grille est elle-même un conteneur**, et c'est le
            seul vrai piège de ce chantier : la cellule fait ~690 px alors que le conteneur le plus
            proche — le `<form>` — en fait 1 398. Sans ce `@container`, le `@md:` ci-dessous
            mesurerait le formulaire en croyant mesurer sa cellule, et couperait en deux des champs
            qui n'ont la place que d'une colonne. `@md` = 28 rem : vrai dans 690 px, faux dans 324. */}
        <div className="@container">
          <div className="grid grid-cols-1 gap-4 @md:grid-cols-2">
            <Champ label="Date de début" name="dateDebut" type="date" defaultValue={valeurs?.dateDebut ?? ""} required />
            <Champ label="Date de fin" name="dateFin" type="date" defaultValue={valeurs?.dateFin ?? ""} aide="À remplir seulement si l'événement dure plusieurs jours." />
            <Champ label="Heure de début" name="heureDebut" type="time" defaultValue={valeurs?.heureDebut ?? ""} aide="Facultative." />
            <Champ label="Heure de fin" name="heureFin" type="time" defaultValue={valeurs?.heureFin ?? ""} aide="Facultative." />
          </div>
        </div>

        {/* Durée et prix juste après les dates : ce sont les deux questions qui suivent « c'est quand ? »
            quand on se demande si l'on y va. Au fond du formulaire, elles seraient oubliées à la saisie. */}
        <div className="@container">
          <div className="grid grid-cols-1 gap-4 @md:grid-cols-2">
            <ChampDuree nombre={valeurs?.dureeNombre} unite={valeurs?.dureeUnite} />
            {/* Les deux tarifs l'un sous l'autre dans la même colonne : c'est la même question posée
                deux fois, et les mettre côte à côte de la durée laisserait un trou sur grand écran.
                Vide, le tarif adhérent ne s'affichera nulle part — contrairement au prix, dont le vide
                se lit « Gratuit ». Les deux règles sont opposées, et c'est `libellePrix` qui les tient. */}
            <div className="flex flex-col gap-4">
              <Champ label="Prix" name="prix" defaultValue={valeurs?.prix ?? ""} maxLength={60} placeholder="ex. 45 €" aide="Laisse vide si c'est gratuit." />
              <Champ
                label="Prix adhérent"
                name="prixAdherent"
                defaultValue={valeurs?.prixAdherent ?? ""}
                maxLength={60}
                placeholder="ex. 35 €"
                aide="Laisse vide s'il n'y a pas de tarif réduit."
              />
            </div>
          </div>
        </div>

        <div className="@container">
          <div className="grid grid-cols-1 gap-4 @md:grid-cols-2">
            <Champ label="Lieu" name="lieu" defaultValue={valeurs?.lieu ?? ""} maxLength={120} placeholder="ex. Gymnase municipal" />
            <Champ
              label="Adresse (pour la carte)"
              name="adresse"
              defaultValue={valeurs?.adresse ?? ""}
              maxLength={200}
              placeholder="ex. 1 rue du Stade, code postal et ville"
              aide="Sans adresse, le lieu s'affiche sans lien vers le plan."
            />
          </div>
        </div>

        <Champ
          label="Organisateur"
          name="organisateur"
          defaultValue={valeurs?.organisateur ?? ""}
          maxLength={120}
          placeholder="ex. le nom de votre club"
          aide="Facultatif. Le club ou l'association qui organise, si ce n'est pas le nôtre."
        />

        <Champ
          label="Lien d'inscription"
          name="lienInscription"
          type="url"
          inputMode="url"
          defaultValue={valeurs?.lienInscription ?? ""}
          maxLength={500}
          placeholder="https://…"
          aide="Facultatif. C'est le bouton « S'inscrire » de la carte."
        />

        {/* L'affiche se dépose, se colle ou se choisit dans la galerie — l'adresse reste un repli,
            c'est elle que « Récupérer les infos du lien » remplit.

            Elle reste une cellule, et c'est **elle** qui remplit la ligne du lien d'inscription : la
            zone de dépôt fait 355 px de haut contre 110 pour un champ, et 687 px de large sont la
            largeur qu'elle a toujours eue. Lui donner la ligne entière rendait la grille plus haute
            de 126 px et laissait une cellule vide à côté du lien d'inscription. */}
        <ChampAffiche valeur={imageUrl} onChange={setImageUrl} />

        <div className="@3xl:col-span-2">
          {/* **Un texte courant ne s'étire pas**, pas plus en écriture qu'en lecture : 65 caractères
              de large au plus, là où la ligne entière du formulaire en ferait 180. */}
          <ZoneTexte
            label="Description"
            name="description"
            value={description}
            onChange={(ev) => setDescription(ev.target.value.slice(0, DESCRIPTION_MAX))}
            rows={4}
            maxLength={DESCRIPTION_MAX}
            placeholder="De quoi s'agit-il, pour qui, ce qu'il faut prévoir…"
            aide={restants > 0 ? `${restants} caractères restants sur ${DESCRIPTION_MAX} — une annonce se lit comme un message, va à l'essentiel.` : "Limite atteinte : raccourcis pour en dire plus ailleurs."}
            className="@3xl:max-w-prose"
          />
        </div>

        {/* La case et son avertissement sont un seul geste : ils prennent la ligne entière, juste
            au-dessus du bouton d'envoi. Le `gap-4` du conteneur reproduit exactement l'écart que le
            `<form>` leur donnait, `-mt-2` compris. */}
        <div className="flex flex-col gap-4 @3xl:col-span-2">
          <Case label="Publié — visible par tous les membres (sinon, brouillon connu de la seule équipe)" name="publie" defaultChecked={valeurs?.publie !== false} />
          {/* **Ce qui est publié doit être annoncé à qui le saisit** (règle du dossier). Depuis,
              une annonce publiée peut sortir du club : le site peut la republier si le bureau a
              coché « Nouvel événement » dans la colonne « Site du club » de la matrice des
              notifications. Le texte le dit ici, au moment où on coche « Publié », et il dit aussi
              ce qui ne sort jamais — le nom de qui a saisi l'annonce.

              **L'énumération doit être exhaustive** : elle oubliait les horaires et la durée, qui
              partent pourtant dans l'embed comme le reste (`src/lib/notifications/evenements.ts`),
              et une liste introduite par « en sortent » se lit comme complète — c'est même tout son
              intérêt. Plutôt que de laisser la prochaine colonne du formulaire retomber dans le
              même trou, la phrase dit maintenant la règle : **tout ce que ce formulaire demande**
              sort, sauf le nom de qui saisit. Un champ ajouté ici sans sortir devra donc s'écrire
              comme exception. */}
          <p className="-mt-2 text-base text-texte-secondaire @3xl:max-w-prose">
            Une annonce publiée peut être <strong>republiée sur le site du club</strong>, donc lisible hors du club, si le bureau l&apos;a autorisé
            (Notifications → « Nouvel événement », colonne « Site du club »). En sortent le nom, la description, les dates et les horaires, la durée,
            le lieu et son adresse, l&apos;organisateur, les tarifs et le lien d&apos;inscription — <strong>tout ce que ce formulaire demande</strong>.
            <strong>Pas votre nom</strong> : qui a saisi l&apos;annonce ne sort jamais.
          </p>
        </div>
      </div>
    </FormulaireAction>
  );
}

/**
 * **Durée** : un nombre, puis une unité — « 2 jours », « 1 demi-journée », « 3 semaines ».
 *
 * Deux contrôles pour une seule information : d'où le `role="group"` et son libellé commun, qui
 * les rassemblent pour un lecteur d'écran (un `fieldset` aurait fait l'affaire, mais sa `legend`
 * se plie mal à la mise en page des autres champs). Chacun garde ensuite son propre nom accessible,
 * sans quoi on entendrait « Durée » deux fois sans savoir lequel est lequel.
 *
 * L'ensemble reste **facultatif** : laisser le nombre vide, c'est ne pas préciser la durée — et
 * l'unité seule n'annonce alors rien. L'accord (« 1 jour » / « 2 jours ») n'est pas saisi, il se
 * décide à l'affichage (`libelleDuree`).
 */
function ChampDuree({ nombre, unite }: { nombre?: number | null; unite?: string | null }) {
  const libelleId = "duree-libelle";
  return (
    <div role="group" aria-labelledby={libelleId} className="flex flex-col gap-1.5">
      <span id={libelleId} className="font-semibold">
        Durée
      </span>
      {/* Le nombre reste étroit (deux chiffres suffisent), l'unité prend le reste : sur un
          téléphone de 390 px les deux tiennent sur une ligne sans se tasser. */}
      <div className="flex items-start gap-2">
        <input
          key={`duree-nombre-${nombre ?? ""}`}
          type="number"
          name="dureeNombre"
          defaultValue={nombre ?? ""}
          min={1}
          max={99}
          step={1}
          inputMode="numeric"
          placeholder="ex. 2"
          aria-label="Durée : nombre"
          className={`${CLASSES_CONTROLE} w-24 shrink-0 border-bordure px-3`}
        />
        <select
          key={`duree-unite-${unite ?? "jour"}`}
          name="dureeUnite"
          defaultValue={unite ?? "jour"}
          aria-label="Durée : unité"
          className={`${CLASSES_CONTROLE} min-w-0 flex-1 border-bordure px-3`}
        >
          {UNITES_DUREE_CHOIX.map((u) => (
            <option key={u.valeur} value={u.valeur}>
              {u.libelle}
            </option>
          ))}
        </select>
      </div>
      <p className="text-sm text-texte-secondaire">Facultative. Laisse le nombre vide pour ne pas la préciser.</p>
    </div>
  );
}
