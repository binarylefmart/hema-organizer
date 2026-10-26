import { Champ } from "@/components/ui/Champ";
import { FormulaireAction } from "@/components/ui/FormulaireAction";
import { SelecteurLieu } from "@/components/gestion/SelecteurLieu";
import type { FormState } from "@/lib/form";
import type { Lieu } from "@/lib/lieux";
import { NOM_TEMPLATE_MAX } from "@/lib/templates";

export type ValeursTemplate = { nom: string; heureDebut: string; heureFin: string; lieu: string; adresse: string };

/**
 * **Le formulaire d'un template** : son nom, son horaire et son lieu — création et modification.
 * Le programme ne s'y saisit pas : il a son propre éditeur, sur l'écran du template, parce qu'il se
 * compose élément par élément et s'enregistre d'un bloc (`EditeurProgramme`).
 *
 * **Le lieu est celui du formulaire de séance, au composant près** (`SelecteurLieu`) : la liste des
 * salles du club (*Thèmes et lieux*), « Autre lieu… » pour une salle de passage, et deux champs
 * libres seulement tant que le club n'a réglé aucune salle. Un template devient une séance : il doit
 * se remplir avec les mêmes gestes, et poser le même couple `lieu` + `adresse` dans le formulaire.
 *
 * **Le sélecteur de lieu est remonté quand le serveur renvoie un autre lieu** (`key`) : son état est
 * semé au montage (`SelecteurLieu`), et c'est ainsi qu'il suit la valeur fraîche après
 * « Enregistrer » — la même doctrine que `cleValeurServeur` pour les champs nus (CLAUDE.md, « Ce que
 * l'écran promet, le code doit le tenir »). Les trois `Champ` portent leur clé eux-mêmes.
 *
 * Pas de `"use client"` : comme `FormulaireSeance`, c'est un assemblage de briques client posé par la
 * page serveur, qui lui passe l'action déjà liée au template (`modifierTemplate.bind(null, id)`).
 */
export function FormulaireTemplate({
  action,
  valeurs,
  lieux,
  bouton,
  prefixe,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  valeurs: ValeursTemplate;
  /** Les salles habituelles du club (`getLieux()`), lues par la page serveur. */
  lieux: Lieu[];
  bouton: string;
  /** Préfixe des identifiants de champ : deux formulaires de template ne doivent pas se voler leurs `id`. */
  prefixe: string;
}) {
  return (
    // L'action invalide l'écran du template (`rafraichir`) : la réponse porte déjà la valeur fraîche,
    // le second aller-retour du refresh ne servirait à rien.
    <FormulaireAction action={action} bouton={bouton} enCours="Enregistrement…" rafraichirApresSucces={false}>
      <Champ
        label="Nom du template"
        name="nom"
        id={`${prefixe}nom`}
        defaultValue={valeurs.nom}
        required
        maxLength={NOM_TEMPLATE_MAX}
        placeholder="ex. Mardi soir — épée longue"
        aide="Pour le reconnaître dans la liste : il ne s'affiche pas aux membres."
      />
      {/* Deux heures côte à côte dès 640 px : elles se lisent ensemble, « de 19h30 à 21h30 ». */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Champ label="Début" name="heureDebut" id={`${prefixe}heureDebut`} type="time" defaultValue={valeurs.heureDebut} required />
        <Champ label="Fin" name="heureFin" id={`${prefixe}heureFin`} type="time" defaultValue={valeurs.heureFin} required />
      </div>
      <SelecteurLieu key={`${valeurs.lieu}|${valeurs.adresse}`} lieux={lieux} lieu={valeurs.lieu} adresse={valeurs.adresse} prefixe={prefixe} />
    </FormulaireAction>
  );
}
