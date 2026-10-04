"use client";

import { useActionState, useEffect, useState } from "react";
import { ouvrirParLienColle } from "@/actions/auth";
import { FORM_INITIAL } from "@/lib/form";
import { apercuLien, lireLienMemorise, memoriserLien, oublierLienMemorise } from "@/lib/lien-memorise";
import { Alerte } from "@/components/ui/Alerte";
import { Bouton } from "@/components/ui/Bouton";
import { BoutonEnvoi } from "@/components/ui/BoutonEnvoi";
import { Champ } from "@/components/ui/Champ";

/**
 * « J'ai reçu un lien par email — colle-le ici », **et l'application s'en souvient**.
 *
 * La porte des gens qui n'ont pas de mot de passe et qui ont installé l'application sur leur écran
 * d'accueil : sur iPhone, cette application a un stockage séparé de Safari, et un lien cliqué dans
 * Mail ouvre Safari — jamais l'icône. Une PWA n'ayant pas de barre d'adresse, ce champ est le seul
 * endroit où leur lien peut encore servir.
 *
 * Depuis une session dure 12 h : ce champ servirait donc tous les jours. Il ne le fait plus qu'une
 * fois — le lien collé reste sur l'appareil, et l'écran le propose d'un bouton (voir
 * `src/lib/lien-memorise.ts`). Deux états, donc :
 *  - **un lien est mémorisé** : le bloc est **visible d'emblée**, dit qu'une clé est gardée sur cet
 *    appareil, en montre la fin, grisée, et porte « Me connecter avec ce lien ». Le champ
 *    n'apparaît pas — il n'y a rien à taper ;
 *  - **rien en mémoire** (ou « Modifier ») : le bloc se replie derrière « J'ai reçu un lien par
 *    email », parce qu'il ne concerne alors que qui arrive avec un lien à la main.
 *
 * **C'est le composant qui porte son propre repli**. La page de connexion l'enfermait dans un
 * `<details>` toujours replié : sur un appareil qui gardait une clé de quatre mois — la tablette du
 * club, l'iPad familial —, l'écran n'en disait rien et « Oublier » dormait derrière un pli, alors
 * que se déconnecter dépose précisément ici. Le serveur ne peut pas décider à sa place : la mémoire
 * ne se lit que dans le navigateur.
 *
 * **Une seule clé par appareil, donc jamais « ton » lien.** Le lien gardé est celui qui a été collé
 * en dernier : si Bob a collé le sien après Alice, c'est celui de Bob, et l'aperçu (huit caractères
 * de fin) ne suffit pas à trancher pour qui hésite. L'écran dit donc ce qu'il sait — « un lien est
 * gardé sur cet appareil » — et nomme le geste qui va avec : « Oublier ».
 *
 * **Premier rendu neutre, toujours.** La mémoire ne se lit que dans le navigateur : afficher
 * d'emblée la version « colle ton lien » puis la remplacer ferait clignoter l'écran à chaque
 * ouverture. On attend donc de savoir (`charge`) avant de choisir quoi montrer.
 */
export function FormulaireLienColle({ enEvidence = false }: { enEvidence?: boolean }) {
  const [state, action] = useActionState(ouvrirParLienColle, FORM_INITIAL);
  const [memorise, setMemorise] = useState<string | null>(null);
  const [charge, setCharge] = useState(false);
  // « Je veux coller un autre lien » : ouvre le champ alors même qu'un lien est en mémoire.
  const [modifie, setModifie] = useState(false);

  useEffect(() => {
    setMemorise(lireLienMemorise());
    setCharge(true);
  }, []);

  // Un lien refusé (expiré, révoqué, trimestre clos) ne vaut plus la peine d'être gardé : on
  // l'oublie et on rouvre le champ, plutôt que de laisser un bouton qui échouera à chaque appui.
  // Un lien **expiré renouvelé** (`succes`) ne vaut pas mieux : celui qui arrive par email le remplace.
  useEffect(() => {
    if (!(state.erreur || state.succes) || !memorise) return;
    oublierLienMemorise();
    setMemorise(null);
    setModifie(true);
  }, [state.erreur, state.succes, memorise]);

  // « Ce n'est pas mon appareil » : on efface la clé et on rouvre le champ, sans rien demander de
  // plus — il n'y a pas de quoi ouvrir une fenêtre de confirmation pour un geste qui ne détruit
  // rien d'irréversible (le lien reste dans la boîte mail, et l'équipe sait en renvoyer un).
  const oublier = () => {
    oublierLienMemorise();
    setMemorise(null);
    setModifie(true);
  };

  const collerEtMemoriser = (fd: FormData) => {
    const lien = String(fd.get("lien") ?? "").trim();
    if (lien) memoriserLien(lien);
    return action(fd);
  };

  /** Les messages de l'action : un refus, ou le renouvellement d'un lien arrivé à terme. */
  const messages = (
    <>
      {state.erreur && <Alerte type="erreur">{state.erreur}</Alerte>}
      {state.succes && <Alerte type="succes">{state.succes}</Alerte>}
    </>
  );

  const avecLienGarde = charge && memorise && !modifie;

  const corps = avecLienGarde ? (
    <form action={collerEtMemoriser} className="flex flex-col gap-4" noValidate>
      {messages}
      {/* Le lien voyage caché : il part au serveur sans jamais s'afficher en entier ni traîner
          dans un champ modifiable. Ce qu'on montre à côté, c'est sa fin, pour le reconnaître. */}
      <input type="hidden" name="lien" value={memorise} />
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-bordure bg-surface-douce px-3 py-2">
        <span className="min-w-0 truncate text-sm text-texte-secondaire">
          Lien gardé : <code className="font-mono">{apercuLien(memorise)}</code>
        </span>
        <span className="flex shrink-0 gap-1">
          <Bouton type="button" variante="discret" taille="petite" onClick={() => setModifie(true)}>
            Modifier
          </Bouton>
          {/* **Le geste du téléphone prêté, nommé et à sa place**. « Se déconnecter » effaçait le
              lien de lui-même ; il ne le fait plus, parce qu'on se déconnecte de son propre
              appareil cent fois pour une fois qu'on rend celui d'un autre, et que chacune de ces
              fois renvoyait chercher son email. Se déconnecter dépose ici : l'effacement est donc à
              une tape, au moment exact où l'on rend l'appareil. */}
          <Bouton type="button" variante="discret" taille="petite" onClick={oublier}>
            Oublier
          </Bouton>
        </span>
      </div>
      <BoutonEnvoi variante="secondaire" pleineLargeur enCours="Ouverture…">
        Me connecter avec ce lien
      </BoutonEnvoi>
    </form>
  ) : (
    <form action={collerEtMemoriser} className="flex flex-col gap-4" noValidate>
      {messages}
      <Champ
        label="Colle ton lien ici"
        autoFocus={enEvidence || modifie}
        name="lien"
        type="text"
        inputMode="url"
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        required
        aide="Le lien entier (https://…) ou seulement la suite de lettres qui le termine. Il sera gardé sur cet appareil : la prochaine fois, un bouton suffira."
        erreur={state.erreurs?.lien}
      />
      <BoutonEnvoi variante="secondaire" pleineLargeur enCours="Ouverture…">
        Ouvrir avec ce lien
      </BoutonEnvoi>
    </form>
  );

  // Tant qu'on ne sait pas s'il y a une clé sur cet appareil, on ne montre rien du tout : choisir
  // trop tôt ferait clignoter l'écran à chaque ouverture. Vaut pour les deux emplacements.
  if (!charge) return <div className="min-h-24" aria-hidden />;

  // Arrivée par « Copier mon lien » : la page fournit déjà la carte et le titre, et le champ doit
  // être devant les yeux. Pas de repli ici.
  if (enEvidence) return corps;

  if (avecLienGarde) {
    return (
      <section className="rounded-xl border border-bordure/60 bg-surface-douce p-4">
        <h2 className="text-lg font-bold">Un lien est gardé sur cet appareil</h2>
        {/* Ce que ça vaut, dit franchement, et **sans affirmer à qui il est** : une seule clé est
            mémorisée par appareil, c'est celle qui a été collée en dernier. */}
        <p className="mb-4 mt-2 text-sm text-texte-secondaire">
          Un lien personnel est une clé : il ouvre un compte sans mot de passe et reste valable jusqu&apos;à 4 mois. Vérifie que c&apos;est bien le tien avant
          d&apos;entrer, et choisis <strong>Oublier</strong> si tu rends cet appareil à quelqu&apos;un d&apos;autre.
        </p>
        {corps}
      </section>
    );
  }

  return (
    <details className="rounded-xl border border-bordure/60 bg-surface-douce p-4">
      <summary className="min-h-11 cursor-pointer font-semibold">J&apos;ai reçu un lien par email</summary>
      <p className="mb-4 mt-2 text-sm text-texte-secondaire">
        Colle-le ici pour entrer sans mot de passe. C&apos;est la solution quand l&apos;application est installée sur ton écran d&apos;accueil : le lien reçu par email
        s&apos;ouvre dans le navigateur, jamais dans l&apos;application.
      </p>
      {corps}
    </details>
  );
}
