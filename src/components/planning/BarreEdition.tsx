"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { enregistrerCases } from "@/actions/planning";
import { Bouton } from "@/components/ui/Bouton";
import { Icone } from "@/components/ui/Icone";
import { useBrouillon } from "./ContexteBrouillon";

/**
 * **La barre du mode modification du planning**.
 *
 * Le planning est désormais **en lecture seule par défaut** pour l'encadrement, exactement comme un
 * membre le voit : les cases vides ne s'affichent même pas. **Deux boutons encadrent le geste** : «
 * **Modifier le planning** » ouvre la saisie, « **Appliquer les modifications** » la referme en
 * écrivant tout d'un coup.
 *
 * **Et « Annuler » à côté**. C'est un **revirement assumé** du choix, qui n'admettait pas de
 * troisième bouton : la sortie sans écrire était un *lien*, et il n'apparaissait **que** sur un
 * brouillon non vide. Deux raisons de rendre les armes, et la seconde est la vraie :
 *
 * 1. le lien apparaissait **après** le premier réglage, c'est-à-dire qu'il n'était jamais là quand on
 *    le cherchait — entré par erreur, on avait sous les yeux un seul bouton, et il s'appelait
 *    « Appliquer » ;
 * 2. **une sortie se cherche à la même place que l'entrée.** Le geste qui ouvre le mode est un bouton
 *    (« Modifier le planning ») ; celui qui le referme sans écrire doit se présenter de la même façon,
 *    pas en caractères de corps de texte à côté d'un bouton plein.
 *
 * Il est donc **toujours là** (une sortie qui se montre à l'entrée ne se cherche pas), en
 * **secondaire** (le geste qui écrit reste le seul bouton plein), et **à gauche** d'« Appliquer » —
 * on ne met pas ce qui jette sous le pouce qui valide. Il ne demande confirmation **que** s'il y a
 * quelque chose à perdre : sinon elle n'ajouterait qu'un clic à une sortie qui ne coûte rien.
 *
 * **Le mode vit dans l'URL** (`?modifier=1`), comme tous les états de cet écran — le trimestre, la
 * fenêtre de temps, la date cherchée. Trois conséquences qui valent mieux qu'un état de composant :
 * le retour du navigateur sort du mode, un lien se partage tel qu'on le lit, et **« Annuler » ne
 * défait rien en base** — le brouillon n'y a jamais touché, il n'y a qu'à l'oublier.
 */
export function BarreEdition({ lienLecture }: { lienLecture: string }) {
  const brouillon = useBrouillon();
  const router = useRouter();
  const [enCours, start] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  const nb = brouillon?.modifiees.size ?? 0;

  const enregistrer = () => {
    if (!brouillon || nb === 0) {
      router.push(lienLecture);
      return;
    }
    setErreur(null);
    start(async () => {
      /*
       * **Un seul appel pour tout le lot**, et le `catch` qui va avec : une promesse qui rejette sans
       * réponse (réseau coupé dans le gymnase, session expirée, déploiement entre-temps) laisserait
       * sinon la barre sur « Enregistrement… » pour toujours, avec un brouillon qu'on croirait
       * parti. C'est la règle du dossier : on suit la **promesse** de l'action, jamais `pending`.
       */
      try {
        const cases = [...brouillon.modifiees].map(([partieId, paire]) => ({ partieId, ...paire }));
        const res = await enregistrerCases({ cases });
        if (res.erreur) {
          setErreur(res.erreur);
          return;
        }
        // Le brouillon n'est vidé qu'après un succès : sur refus, rien n'est perdu et on peut corriger.
        brouillon.vider();
        router.push(lienLecture);
      } catch {
        setErreur("Impossible d'appliquer les modifications — vérifie ta connexion, puis réessaie. Rien n'a été perdu.");
      }
    });
  };

  /**
   * **Annuler : jeter le brouillon, puis quitter l'adresse du mode.**
   *
   * `vider()` d'abord, et ce n'est pas une politesse : le registre de la garde de fermeture
   * (`garde-fermeture.ts`) porte une clé par case réglée, et c'est `vider()` qui les retire. Sans
   * lui, on quitterait le mode en laissant la garde armée — la question du navigateur se poserait
   * ensuite sur un planning en lecture seule, où il n'y a plus rien à perdre, et un avertissement
   * qu'on apprend à fermer sans lire ne vaut plus rien le jour où il compte. (Le démontage des cases
   * finit par les retirer aussi ; on ne confie pas à un effet de démontage ce que le geste sait.)
   */
  const annuler = () => {
    if (nb > 0 && !window.confirm(`${nb} case${nb > 1 ? "s" : ""} modifiée${nb > 1 ? "s" : ""} ne ${nb > 1 ? "seront" : "sera"} pas appliquée${nb > 1 ? "s" : ""}. Annuler les modifications ?`)) return;
    brouillon?.vider();
    router.push(lienLecture);
  };

  return (
    /*
     * **Collante en bas** : on modifie une case en haut de la grille d'un trimestre de vingt-six
     * séances, et le bouton qui valide ne doit pas être à six écrans de là. Même choix que la barre
     * des gestes de masse de l'annuaire et du registre.
     *
     * **Et posée AU-DESSUS de la barre d'onglets du téléphone**. Elle était à `bottom-0`, comme la
     * barre d'onglets du bas (`NavBas`, `fixed bottom-0 z-10`, cachée dès 768 px) : à `z-index`
     * égal c'est le dernier peint qui gagne, et celle-ci est rendue après. Elle recouvrait donc «
     * Accueil / Séances / Profil » **en entier**, et son propre bas passait sous la zone système de
     * l'écran — d'où le sentiment d'une fenêtre coupée. Le décalage reprend la hauteur de la barre
     * d'onglets, `env(safe-area-inset-bottom)` comprise, exactement comme elle ; dès 768 px la
     * barre d'onglets n'existe plus et celle-ci retrouve ses 8 px du bas.
     *
     * **C'est la seconde fois** : `PresencesEquipe` a eu le même défaut le 30/09, pour la même raison.
     * Une barre collante en bas ne se mesure pas à la fenêtre, elle se mesure à ce qui occupe déjà le
     * bas de l'écran — et un test l'exige maintenant de toute barre de ce dépôt.
     */
    <div className="sticky bottom-[calc(env(safe-area-inset-bottom,0px)+5.5rem)] z-10 -mx-1 flex flex-col gap-2 rounded-2xl border-2 border-primaire/40 bg-surface/95 p-3 shadow-carte backdrop-blur md:bottom-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 font-semibold">
          <Icone nom="livre" taille={18} className="text-primaire" />
          {nb === 0 ? "Modification des séances" : `${nb} case${nb > 1 ? "s" : ""} modifiée${nb > 1 ? "s" : ""}, pas encore appliquée${nb > 1 ? "s" : ""}`}
        </p>
        <div className="flex flex-1 items-center justify-end gap-2">
          {/*
            **Un bouton, et non plus un lien** : il se présente comme l'entrée dans le
            mode, donc on le cherche au même endroit. Il reste `type="button"` et `variante
            secondaire` — ce qui écrit garde le seul bouton plein de la barre. Désactivé pendant
            l'écriture : annuler à mi-chemin d'un lot déjà parti ne l'arrêterait pas, et donnerait à
            croire le contraire.
          */}
          <Bouton type="button" variante="secondaire" taille="petite" onClick={annuler} disabled={enCours}>
            Annuler
          </Bouton>
          {/* Le libellé ne compte pas les cases : il dit le geste, toujours le même, et c'est la
              phrase à gauche qui porte le chiffre. Un bouton dont le texte change de longueur à
              chaque réglage se déplace sous le doigt. */}
          <Bouton type="button" onClick={enregistrer} disabled={enCours} aria-busy={enCours}>
            {enCours ? "Application…" : "Appliquer les modifications"}
          </Bouton>
        </div>
      </div>
      {erreur && (
        <p role="alert" className="font-semibold text-rouge">
          {erreur}
        </p>
      )}
      {/*
        **Ce que les deux boutons ne couvrent pas, dit ici.** Ajouter, retirer ou déplacer une partie,
        et programmer un atelier, s'enregistrent tout de suite : ce sont des décisions à part, déjà
        confirmées, et une partie provisoire n'aurait pas d'identifiant à donner au reste du dossier.
        Le dire est la seule façon honnête de garder « Annuler » : une promesse qu'on ne tient qu'à
        moitié vaut moins qu'une phrase.
      */}
      <p className="text-sm text-texte-secondaire">
        Parties ajoutées, retirées, déplacées et ateliers programmés sont enregistrés tout de suite. Seules les cases attendent.
      </p>
    </div>
  );
}
