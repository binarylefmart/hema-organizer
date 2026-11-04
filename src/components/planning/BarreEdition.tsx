"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { annoncerModificationsAppliquees, enregistrerCases, oublierModificationsNonAppliquees } from "@/actions/planning";
import { Bouton } from "@/components/ui/Bouton";
import { Icone } from "@/components/ui/Icone";
import { useBrouillon } from "./ContexteBrouillon";
import { casesAEnvoyer, texteEcartees } from "./brouillon";

/**
 * **La sortie du mode modification du planning : ✕ et « Appliquer », rien d'autre.** Posée en tête
 * de la sélection, comme
 * « Terminé » dans l'onglet Séances — plus de barre collante en bas, plus de titre ni de « i ».
 *
 * - **✕** referme sans écrire. S'il reste des cases modifiées, une confirmation le dit d'abord
 *   (et rappelle ce qui, lui, est déjà enregistré) ; sinon on sort tout de suite.
 * - **« Appliquer »** écrit le brouillon d'un coup (`enregistrerCases`) et referme. S'il y a des cases
 *   modifiées, une confirmation annonce combien ; sans rien à écrire, il referme simplement.
 *
 * **Le mode vit dans l'URL** (`?modifier=1`) : ✕ ne défait rien en base — le brouillon n'y a jamais
 * touché, il n'y a qu'à l'oublier (`vider()` d'abord, pour désarmer la garde de fermeture).
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
  /** Ce qu'« Appliquer » a écarté, dit sous les boutons (`texteEcartees`). */
  const [avis, setAvis] = useState<string | null>(null);
  const nb = brouillon?.modifiees.size ?? 0;
  /*
   * Les suppressions s'écrivent tout de suite, mais ne s'annoncent aux instructeurs qu'à
   * l'application : sans case à écrire, « Appliquer » le dit au serveur ; « Annuler » les fait oublier.
   * Sans attente ni erreur affichée — l'annonce ne doit jamais retenir l'écran.
   */
  const annoncer = () => void annoncerModificationsAppliquees().catch(() => {});

  const enregistrer = () => {
    if (!brouillon || nb === 0) {
      annoncer();
      router.push(lienLecture);
      return;
    }
    // La confirmation d'avant d'écrire : combien de cases partent, et que ça se voit tout de suite.
    if (!window.confirm(`Appliquer ${nb} modification${nb > 1 ? "s" : ""} ? ${nb > 1 ? "Elles sont enregistrées" : "Elle est enregistrée"} pour tout le club.`)) return;
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
      annoncer();
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
    void oublierModificationsNonAppliquees().catch(() => {});
    router.push(lienLecture);
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        {/* ✕ : sortir sans appliquer — inerte pendant l'écriture, un lot parti ne s'arrête pas. */}
        <button
          type="button"
          onClick={annuler}
          disabled={enCours}
          aria-label="Annuler les modifications"
          title="Annuler les modifications"
          className="inline-flex size-12 items-center justify-center rounded-xl border-2 border-bordure bg-surface text-texte transition hover:bg-surface-douce disabled:opacity-60"
        >
          <Icone nom="croix" taille={22} />
        </button>
        <Bouton type="button" taille="petite" onClick={enregistrer} disabled={enCours} aria-busy={enCours}>
          <Icone nom="check" taille={18} />
          {enCours ? "Application…" : "Appliquer"}
        </Bouton>
      </div>
      {nb > 0 && !enCours && (
        <p className="text-sm text-texte-secondaire" aria-live="polite">
          {nb} modification{nb > 1 ? "s" : ""} non appliquée{nb > 1 ? "s" : ""}
        </p>
      )}
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
    </div>
  );
}
