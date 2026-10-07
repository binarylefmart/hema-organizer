"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { enregistrerCases } from "@/actions/planning";
import { Bouton } from "@/components/ui/Bouton";
import { Icone } from "@/components/ui/Icone";
import { useBrouillon } from "./ContexteBrouillon";
import { casesAEnvoyer, texteEcartees } from "./brouillon";
import { VARIABLE_HAUTEUR_BARRE_EDITION } from "@/components/ui/barre-selection";

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
/** Ce que les deux boutons ne couvrent pas : dit derrière le « i » et dans la confirmation d'« Annuler ». */
const CE_QUI_PART = "Parties ajoutées, retirées, déplacées et ateliers programmés sont enregistrés tout de suite. Seules les cases attendent.";

export function BarreEdition({
  lienLecture,
  partiesAffichees,
}: {
  lienLecture: string;
  /** Les éléments que la page montre : un réglage qui vise autre chose n'est pas envoyé (`casesAEnvoyer`). */
  partiesAffichees: readonly string[];
}) {
  const brouillon = useBrouillon();
  const router = useRouter();
  const [enCours, start] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  const [aide, setAide] = useState(false);
  /** Ce qu'« Appliquer » a écarté, dit sous les boutons (`texteEcartees`). */
  const [avis, setAvis] = useState<string | null>(null);
  const nb = brouillon?.modifiees.size ?? 0;
  const racine = useRef<HTMLDivElement>(null);

  /*
   * **La hauteur réelle de la barre, publiée pour la barre de sélection** posée au-dessus d'elle
   * (`BarreSelection`, `auDessus`). Celle-ci se posait à une hauteur fixe, calculée pour une barre
   * d'une ligne ; l'aide « i » ouverte ou un message d'erreur la font grandir, et les deux barres se
   * chevauchaient alors — « Appliquer » passait sous « Que faire sur ces 3 séances ? ».
   */
  useEffect(() => {
    const el = racine.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const racineDoc = document.documentElement;
    const publier = () => racineDoc.style.setProperty(VARIABLE_HAUTEUR_BARRE_EDITION, `${el.offsetHeight}px`);
    publier();
    const observateur = new ResizeObserver(publier);
    observateur.observe(el);
    const arreter = () => {
      observateur.disconnect();
      racineDoc.style.removeProperty(VARIABLE_HAUTEUR_BARRE_EDITION);
    };
    return arreter;
  }, []);

  const enregistrer = () => {
    if (!brouillon || nb === 0) {
      router.push(lienLecture);
      return;
    }
    setErreur(null);
    setAvis(null);
    /*
     * **Seulement les éléments encore affichés.** Le retrait d'un élément oublie son réglage, mais un
     * identifiant resté dans le brouillon faisait refuser **tout** le lot par le serveur, sans autre
     * issue qu'« Annuler ». On l'écarte, et on le dit.
     */
    const { cases, ecartees } = casesAEnvoyer(brouillon.modifiees, partiesAffichees);
    for (const id of ecartees) brouillon.oublier(id);
    const ecarte = ecartees.length > 0 ? texteEcartees(ecartees.length) : null;
    if (cases.length === 0) {
      setAvis(ecarte);
      return;
    }
    start(async () => {
      /*
       * **Un seul appel pour tout le lot**, et le `catch` qui va avec : une promesse qui rejette sans
       * réponse (réseau coupé dans le gymnase, session expirée, déploiement entre-temps) laisserait
       * sinon la barre sur « Enregistrement… » pour toujours, avec un brouillon qu'on croirait
       * parti. C'est la règle du dossier : on suit la **promesse** de l'action, jamais `pending`.
       */
      try {
        const res = await enregistrerCases({ cases });
        if (res.erreur) {
          setErreur(res.erreur);
          setAvis(ecarte);
          return;
        }
        // Le brouillon n'est vidé qu'après un succès : sur refus, rien n'est perdu et on peut corriger.
        brouillon.vider();
        // Quelque chose a été écarté : on reste en modification le temps de le lire (« Appliquer »,
        // sur un brouillon vide, ramène ensuite à la lecture).
        if (ecarte) {
          setAvis(`Le reste est appliqué. ${ecarte}`);
          return;
        }
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
   * qu'on apprend à fermer sans lire ne vaut plus rien le jour où il compte. (Le démontage du
   * brouillon finit par les retirer aussi ; on ne confie pas à un effet de démontage ce que le geste
   * sait. Celui des cases, lui, n'y touche pas : le brouillon survit à une case repliée.)
   */
  const annuler = () => {
    const perte = `${nb} case${nb > 1 ? "s" : ""} modifiée${nb > 1 ? "s" : ""} ne ${nb > 1 ? "seront" : "sera"} pas appliquée${nb > 1 ? "s" : ""}.`;
    if (nb > 0 && !window.confirm(`${perte} ${CE_QUI_PART}\n\nAnnuler les modifications ?`)) return;
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
     * barre d'onglets du bas (`NavBas`, `fixed bottom-0 z-10`, cachée sur ordinateur) : à `z-index`
     * égal c'est le dernier peint qui gagne, et celle-ci est rendue après. Elle recouvrait donc «
     * Accueil / Séances / Profil » **en entier**, et son propre bas passait sous la zone système de
     * l'écran — d'où le sentiment d'une fenêtre coupée. Le décalage reprend la hauteur de la barre
     * d'onglets, `env(safe-area-inset-bottom)` comprise, exactement comme elle ; sur ordinateur la
     * barre d'onglets n'existe plus et celle-ci retrouve ses 8 px du bas.
     *
     * **C'est la seconde fois** : `PresencesEquipe` a eu le même défaut le 30/09, pour la même raison.
     * Une barre collante en bas ne se mesure pas à la fenêtre, elle se mesure à ce qui occupe déjà le
     * bas de l'écran — et un test l'exige maintenant de toute barre de ce dépôt.
     */
    <div
      ref={racine}
      data-barre-basse="edition"
      className="sticky bottom-[calc(env(safe-area-inset-bottom,0px)+5.5rem)] z-10 -mx-1 flex flex-col gap-2 rounded-2xl border-2 border-primaire/40 bg-surface/95 p-3 shadow-carte backdrop-blur tel:p-2 ordi:bottom-2">
      <div className="flex flex-wrap items-center justify-between gap-3 tel:gap-1.5">
        {/* Sur téléphone, deux lignes : le titre (« Modification des séances », et le compte dès
            qu'une case attend) avec le « i » au bout, puis les deux boutons sur toute la largeur.
            Sur une seule ligne, le titre se tronquait en « Modif… », ou disparaissait. */}
        <div className="flex min-w-0 items-center gap-1 tel:w-full tel:justify-between">
          <p className="flex min-w-0 items-center gap-2 font-semibold tel:text-base">
            <Icone nom="livre" taille={18} className="shrink-0 text-primaire" />
            <span className="tel:hidden">
              {nb === 0 ? "Modification des séances" : `${nb} case${nb > 1 ? "s" : ""} modifiée${nb > 1 ? "s" : ""}, pas encore appliquée${nb > 1 ? "s" : ""}`}
            </span>
            <span className="min-w-0 ordi:hidden">
              Modification des séances
              {nb > 0 && <span className="whitespace-nowrap font-normal text-texte-secondaire">{`\u00a0· ${nb}\u00a0modifiée${nb > 1 ? "s" : ""}`}</span>}
            </span>
          </p>
          {/* **Ce qui part sans attendre, derrière un « i »** : la phrase vivait sous les boutons et
              grandissait la barre de trois lignes sur un téléphone. Elle reste à un tap, et la
              confirmation d'« Annuler » la redit au moment où elle compte. */}
          <button
            type="button"
            aria-label="Ce qui s'enregistre tout de suite"
            aria-expanded={aide}
            aria-controls="barre-edition-aide"
            className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-lg text-texte-secondaire hover:bg-surface-douce"
            onClick={() => setAide((a) => !a)}
          >
            <Icone nom="info" taille={20} />
          </button>
        </div>
        <div className="flex flex-1 items-center justify-end gap-2 tel:[&>*]:flex-1">
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
          <Bouton type="button" onClick={enregistrer} disabled={enCours} aria-busy={enCours} aria-label={enCours ? "Application…" : "Appliquer les modifications"}>
            {enCours ? (
              "Application…"
            ) : (
              <>
                <span className="tel:hidden">Appliquer les modifications</span>
                <span className="ordi:hidden">Appliquer</span>
              </>
            )}
          </Bouton>
        </div>
      </div>
      {erreur && (
        <p role="alert" className="font-semibold text-rouge">
          {erreur}
        </p>
      )}
      {avis && (
        <p role="status" className="font-semibold text-ocre">
          {avis}
        </p>
      )}
      {/*
        **Ce que les deux boutons ne couvrent pas, dit ici.** Ajouter, retirer ou déplacer une partie,
        et programmer un atelier, s'enregistrent tout de suite : ce sont des décisions à part, déjà
        confirmées, et une partie provisoire n'aurait pas d'identifiant à donner au reste du dossier.
        Le dire est la seule façon honnête de garder « Annuler » : une promesse qu'on ne tient qu'à
        moitié vaut moins qu'une phrase.
      */}
      {aide && (
        <p id="barre-edition-aide" className="text-base text-texte-secondaire">
          {CE_QUI_PART}
        </p>
      )}
    </div>
  );
}
