"use client";

import { useState, useTransition } from "react";
import { nommerAdministrateur, retirerDroitsAdmin } from "@/actions/membres";
import { Bouton } from "@/components/ui/Bouton";
import { ListeDeroulante } from "@/components/ui/ListeDeroulante";
import { ENTREES_BUREAU, texteConfirmationBureau, valeurBureau, VALEUR_BUREAU } from "./bureau";

/**
 * **Le bureau d'une personne, en supplément de son rôle de base**.
 *
 * C'est **le second menu déroulant**, celui qui vit à côté de {@link SelecteurRole} : l'un porte le
 * rôle de base (membre ou instructeur, pour tout le monde), celui-ci porte `User.estAdmin`. Ils sont
 * séparés parce que ce sont deux questions, et non deux valeurs de la même : depuis que le bureau
 * s'ajoute au rôle au lieu de le remplacer, une personne peut être instructeur **et** du bureau — ce
 * qu'une liste unique ne saurait pas dire.
 *
 * **Il n'enregistre pas au `change`, et c'est la seule différence de forme avec son voisin.** Le
 * sélecteur de rôle, lui, écrit au choix : son pire effet est de passer quelqu'un de membre à
 * instructeur, ce qui se défait du même geste. Ici, le geste **donne ou retire tous les droits du
 * club** — les comptes, les accès, la technique, le journal. Il suit donc la doctrine du dépôt pour
 * tout ce qui porte à conséquence, celle de la liste déroulante du rôle **en masse** : la liste
 * **choisit**, le bouton **écrit**, et la confirmation reste entre les deux. Une molette sur un
 * téléphone ne nomme pas un administrateur.
 *
 * **Les verrous ne bougent pas d'un cran, parce que ce composant n'écrit rien lui-même** : il appelle
 * les deux actions qui portaient déjà ce geste depuis l'écran « Comptes admin »
 * (`nommerAdministrateur`, `retirerDroitsAdmin`, `src/actions/membres.ts`). Elles exigent toutes les
 * deux `admins.manage`, un code 2FA récent (`exigerReauth`), refusent le compte du portail et
 * refusent qu'on se retire son propre bureau, et écrivent une entrée d'audit nominative. **Un second
 * chemin d'écriture avec ses propres règles serait une porte dérobée** : c'est la raison pour
 * laquelle ce fichier n'a pas d'action à lui.
 *
 * Comme le sélecteur de rôle, il **ne dit rien quand tout va bien** — la liste montre l'état, c'est
 * elle la confirmation — et ne parle que pour un refus ou une réussite qui mérite une phrase (« mot
 * de passe et double authentification lui seront demandés »).
 */
/**
 * `retour` : l'écran d'où part le geste. Nommer ou retirer le bureau redemande un code récent
 * (`exigerReauth`), qui **quitte la page** ; sans cette adresse, on revenait sur « Comptes admin »
 * après avoir réglé une fiche, et le geste demandé était perdu en route.
 */
export function SelecteurBureau({ userId, nom, estAdmin, retour }: { userId: string; nom: string; estAdmin: boolean; retour: string }) {
  /** L'état du serveur, traduit en valeur de liste : c'est lui qui fait foi. */
  const duServeur = valeurBureau(estAdmin);
  const [choix, setChoix] = useState(valeurBureau(estAdmin));
  const [message, setMessage] = useState<{ type: "ok" | "erreur"; texte: string } | null>(null);
  const [enCours, demarrer] = useTransition();
  /**
   * **Le miroir de la valeur du serveur** — même parade que `SelecteurRole` et que les cases du
   * planning (`vuDuServeur`, dans `CaseEditeur`), et pour un défaut de la même famille.
   *
   * Un `useState(props.valeur)` n'est semé qu'**au montage**. Cette liste-ci vit dans une ligne de
   * l'annuaire, dont l'identité ne bouge pas (`key={m.id}`) : rien ne la remonte. Qu'une nomination
   * se fasse ailleurs — depuis l'écran « Comptes admin », depuis la fiche de la personne, ou par un
   * autre membre du bureau pendant que l'écran est ouvert — et la liste continuerait d'afficher
   * l'état du chargement de la page. On en conclurait que le geste n'a pas pris, et le réflexe
   * suivant serait de le refaire : cette fois sur un `----------` qui **retire vraiment** le bureau
   * qu'on croyait donner. C'est exactement le scénario sur le rôle, où le forçage rétrogradait un
   * instructeur.
   *
   * La clé de remontage (`cleValeurServeur`) ne convient pas : c'est un contrôle **piloté**, dont
   * l'état fait foi entre deux rendus, et la règle qui accompagne la clé l'exclut explicitement. Le
   * miroir joue le même rôle sans lui arracher son état.
   */
  const [vuDuServeur, setVuDuServeur] = useState(valeurBureau(estAdmin));
  if (vuDuServeur !== duServeur) {
    setVuDuServeur(duServeur);
    setChoix(duServeur);
    // Le message qui parlait de l'état d'avant n'a plus d'objet : le serveur en annonce un autre.
    setMessage(null);
  }

  /** Rien n'est à écrire tant que la liste montre ce que le serveur dit déjà : le bouton reste inerte. */
  const aEcrire = choix !== duServeur;
  const versBureau = choix === VALEUR_BUREAU;

  const appliquer = () => {
    if (!aEcrire) return;
    if (!window.confirm(texteConfirmationBureau(nom, versBureau))) return;
    demarrer(async () => {
      try {
        if (versBureau) {
          /*
           * `nommerAdministrateur` est une action de formulaire (`useActionState`) : elle lit
           * l'identifiant dans un `FormData`. On le lui donne tel quel plutôt que d'écrire une
           * seconde action — ses verrous sont ceux qu'il faut, et deux chemins d'écriture aux règles
           * différentes, c'est une porte dérobée d'un côté ou une fonctionnalité morte de l'autre.
           */
          const fd = new FormData();
          fd.set("userId", userId);
          fd.set("retour", retour);
          const res = await nommerAdministrateur({}, fd);
          if (res.erreur) {
            setMessage({ type: "erreur", texte: res.erreur });
            setChoix(duServeur);
            return;
          }
          // La réussite se dit ici : elle apprend quelque chose de plus que la liste (le parcours
          // mot de passe + double authentification qui attend la personne).
          setMessage({ type: "ok", texte: res.succes ?? "" });
          return;
        }
        // Le retrait, lui, **lève** en cas de refus : c'est l'action de l'écran « Comptes admin »,
        // où un refus emporte l'écran. Ici on l'attrape et on le dit sous la liste.
        await retirerDroitsAdmin(userId, retour);
        setMessage({ type: "ok", texte: `${nom} n'est plus administrateur. Son compte et son historique sont intacts.` });
      } catch (e) {
        /*
         * **Une action qui redirige lève ici comme une erreur**, et il ne faut surtout pas la
         * traduire en panne : `exigerReauth` renvoie vers `/connexion/verifier` pour redemander le
         * code, et dire « vérifie ta connexion » ferait croire que le geste a échoué alors qu'il
         * attend une preuve. Même précaution que `BoutonAction` et que la barre des gestes de masse.
         */
        const texte = e instanceof Error ? e.message : "";
        if (texte.includes("NEXT_REDIRECT")) return;
        setMessage({ type: "erreur", texte: texte || "Changement impossible — vérifie ta connexion." });
        setChoix(duServeur);
      }
    });
  };

  return (
    <div className="flex flex-col gap-1">
      <label id={`bureau-${userId}-libelle`} htmlFor={`bureau-${userId}`} className="text-base text-texte-secondaire">
        Bureau (administrateur)
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <ListeDeroulante
          id={`bureau-${userId}`}
          libelleId={`bureau-${userId}-libelle`}
          libelle={`Bureau de ${nom}`}
          valeur={choix}
          entrees={ENTREES_BUREAU}
          onChoisir={(v) => {
            setChoix(v);
            setMessage(null);
          }}
          /* La même allure que la liste déroulante du rôle, juste au-dessus : deux réglages voisins
             d'une même ligne ne peuvent pas avoir deux hauteurs ni deux tailles de texte. */
          className="min-h-12 flex-1 basis-32 rounded-xl border-2 border-bordure/70 bg-surface px-3 text-base font-semibold text-texte shadow-carte"
        />
        {/* Inerte tant que la liste montre l'état du serveur : « Enregistrer » sans objet ferait
            partir une demande de code 2FA pour un enregistrement à blanc. */}
        <Bouton
          type="button"
          variante="secondaire"
          taille="petite"
          disabled={enCours || !aEcrire}
          className="flex-1 basis-32"
          onClick={appliquer}
        >
          {/* Le bouton nomme **ce qu'il va faire**, pas « Enregistrer » : donner les droits du club
              et les retirer ne sont pas le même geste, et un verbe neutre au-dessus d'une liste à
              deux entrées laisserait deviner lequel des deux est en train de partir. */}
          {versBureau ? "Nommer administrateur" : aEcrire ? "Retirer les droits" : "Enregistrer"}
        </Bouton>
      </div>
      {/* Région vivante **montée en permanence** : une région créée en même temps que son texte n'est
          jamais annoncée, et c'est le premier message — celui qui compte le plus — qui serait muet.
          `empty:hidden` pour ne pas creuser la ligne quand tout va bien, et `text-base` parce qu'un
          refus de ce geste-là ne s'écrit pas en 12 px. */}
      <span
        className={`text-base font-semibold empty:hidden ${message?.type === "erreur" ? "text-rouge" : "text-vert"}`}
        aria-live="polite"
      >
        {message?.texte ?? ""}
      </span>
    </div>
  );
}
