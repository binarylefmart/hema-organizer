"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { definirRoleMembre } from "@/actions/membres";
import { Icone } from "@/components/ui/Icone";
import { ListeDeroulante, type EntreeListe } from "@/components/ui/ListeDeroulante";

/** Les deux rôles de base, dans l'ordre où la liste les a toujours montrés. */
const ENTREES_ROLE: EntreeListe[] = [
  { valeur: "MEMBRE", libelle: "Membre" },
  { valeur: "INSTRUCTEUR", libelle: "Instructeur" },
];

/**
 * **Le rôle d'une personne, réglable depuis la liste** : membre ou instructeur, en un geste, sans
 * ouvrir sa fiche.
 *
 * **Administrateur n'y figure pas**, et ce n'est pas un oubli : nommer ou destituer un
 * administrateur se fait dans l'onglet « Comptes admin », là où l'on voit qui les a, qui a réglé sa
 * double authentification et ce que dit le journal. Le serveur refuse de toute façon (voir
 * `definirRoleMembre`) : une liste déroulante retouchée dans le navigateur ne donne aucun droit.
 *
 * Comme les cases du planning, il **ne dit rien quand tout va bien** — le rôle choisi est dans la
 * liste, c'est lui la confirmation — et ne parle que pour un refus.
 *
 * `presentation="curseur"` : la fiche d'une personne au téléphone montre le rôle en curseur à deux
 * positions (« Membre » | « Instructeur »), posé d'emblée sur le rôle actuel — même état, même miroir
 * du serveur, même action, mêmes refus ; seul le dessin change. Toucher l'autre côté, ou y glisser le
 * doigt, applique ce rôle. La fiche relit ensuite la page : sa pastille de rôle, en tête, doit suivre.
 */
export function SelecteurRole({
  userId,
  role,
  nom,
  presentation = "liste",
  rafraichir = false,
}: {
  userId: string;
  role: string;
  nom: string;
  presentation?: "liste" | "curseur";
  /** Relire la page après un choix réussi : la fiche d'une personne affiche son rôle en tête. */
  rafraichir?: boolean;
}) {
  const [valeur, setValeur] = useState(role);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, start] = useTransition();
  const router = useRouter();
  const origineGlisse = useRef<number | null>(null);
  const glisseFait = useRef(false);
  /**
   * **Le rôle du serveur reprend la main dès qu'il bouge** — même patron que les cases du planning
   * (`vuDuServeur`, dans `CaseEditeur`), et pour un défaut de la même famille, relevé après
   * l'arrivée du **changement de rôle en masse** :
   *
   * 1. le bureau coche sept personnes et les passe instructeur ; les pastilles de la liste se
   *    mettent à jour, elles sont rendues par le serveur ;
   * 2. mais cette liste déroulante-ci n'est semée qu'**une fois**, au montage — et la ligne garde
   *    son identité (`key={m.id}` sur le `<Fragment>` de `page.tsx`), donc rien ne la remonte. Elle
   *    affiche encore « Membre » ;
   * 3. on en conclut que le lot n'a pas pris, on rouvre le volet et on choisit « Instructeur » :
   *    le serveur s'arrête aussitôt (`definirRoleMembre` : `if (role === cible.role) return {}`) et
   *    ce contrôle ne dit rien quand tout va bien. Rien ne bouge, donc, ce qui confirme le doute ;
   * 4. réflexe suivant : basculer « Membre » puis « Instructeur » pour forcer — et le premier de ces
   *    deux clics **écrit réellement MEMBRE**. Le lot vient d'être défait à la main, ligne par ligne.
   *
   * C'est la doctrine de `cleValeurServeur` (`src/components/ui/valeur-serveur.ts`) appliquée à un
   * état **semé** par le serveur : la valeur affichée doit suivre celle du serveur dès qu'elle
   * change. La clé de remontage, elle, ne convient pas ici — la règle qui l'accompagne exclut
   * justement un contrôle **piloté** par React (`value=`), dont l'état fait foi entre deux rendus.
   * Le miroir ci-dessous joue le même rôle sans lui arracher son état.
   *
   * Pas de garde « saisie en cours » comme sur le libellé d'une partie : un choix dans une liste est
   * instantané et parti au serveur dans la même frappe. Il n'y a rien à protéger, et une valeur du
   * serveur qui bouge est précisément celle qui doit gagner.
   */
  const [vuDuServeur, setVuDuServeur] = useState(role);
  if (vuDuServeur !== role) {
    setVuDuServeur(role);
    setValeur(role);
    // Le refus qui parlait de l'ancien rôle n'a plus d'objet : le serveur en annonce un autre.
    setErreur(null);
  }
  const choisir = (choix: string) => {
    if (choix === valeur) return;
    setValeur(choix);
    setErreur(null);
    start(async () => {
      const res = await definirRoleMembre(userId, choix).catch(() => ({ erreur: "Changement impossible — vérifie ta connexion." }));
      if (res?.erreur) {
        setErreur(res.erreur);
        setValeur(role);
      } else if (presentation === "curseur" || rafraichir) {
        router.refresh();
      }
    });
  };
  const messageErreur = (
    <span className="text-base font-semibold text-rouge empty:hidden" aria-live="polite">
      {erreur ?? ""}
    </span>
  );
  if (presentation === "curseur") {
    const aDroite = valeur === ENTREES_ROLE[1].valeur;
    return (
      <div className="flex flex-col gap-1">
        {/* **Un curseur à deux positions** : le rond glisse sous le rôle choisi. Un appui sur l'autre
            côté — ou un glissé du doigt vers lui — applique ce rôle, comme un choix dans la liste. */}
        <div
          role="radiogroup"
          aria-label={`Rôle de ${nom}`}
          className="relative grid grid-cols-2 rounded-full border-2 border-bordure/70 bg-surface p-1 shadow-carte touch-pan-y"
          onPointerDown={(ev) => {
            origineGlisse.current = ev.clientX;
            glisseFait.current = false;
          }}
          onPointerUp={(ev) => {
            const depart = origineGlisse.current;
            origineGlisse.current = null;
            if (depart === null || enCours) return;
            const ecart = ev.clientX - depart;
            if (Math.abs(ecart) < 24) return;
            // Le `click` qui suit ce relâcher viserait le bouton sous le doigt, peut-être l'autre
            // rôle : il ne doit pas défaire le glissé.
            glisseFait.current = true;
            choisir(ENTREES_ROLE[ecart > 0 ? 1 : 0].valeur);
          }}
        >
          <span
            aria-hidden
            className={`pointer-events-none absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-full bg-primaire shadow-carte transition-transform duration-200 ease-out motion-reduce:transition-none ${
              aDroite ? "translate-x-full" : "translate-x-0"
            }`}
          />
          {ENTREES_ROLE.map((e) => {
            const choisi = valeur === e.valeur;
            return (
              <button
                key={e.valeur}
                type="button"
                role="radio"
                aria-checked={choisi}
                disabled={enCours}
                onClick={() => {
                  if (glisseFait.current) {
                    glisseFait.current = false;
                    return;
                  }
                  choisir(e.valeur);
                }}
                className={`relative z-10 inline-flex min-h-12 items-center justify-center gap-1.5 rounded-full px-3 text-base font-semibold transition-colors disabled:opacity-60 ${
                  choisi ? "text-primaire-texte" : "text-texte"
                }`}
              >
                {choisi && <Icone nom="check" taille={18} />}
                {e.libelle}
              </button>
            );
          })}
        </div>
        {messageErreur}
      </div>
    );
  }
  return (
    // Un `div` et non plus un `span` : `ListeDeroulante` pose son propre `div` (le panneau s'ancre
    // dessus), qui n'a rien à faire dans un élément de texte.
    <div className="inline-flex flex-col gap-1">
      <label id={`role-${userId}-libelle`} className="sr-only" htmlFor={`role-${userId}`}>
        Rôle de {nom}
      </label>
      {/* La liste du dépôt (`ListeDeroulante`), jamais un `<select>` nu : elle a la forme des autres
          listes de l'annuaire et s'ouvre vers le bas même à son pied.
          **Elle enregistre au choix, comme le `<select>` au `change`** — c'est la différence assumée
          avec la liste de la barre de masse, qui attend son bouton. `onChoisir` est appelé même quand
          on rechoisit l'entrée déjà affichée, ce que `change` ne faisait pas : on ne part donc au
          serveur que pour un vrai changement, sans quoi une ouverture-fermeture enverrait une
          écriture à blanc (que le serveur ignorerait, mais qui effacerait le refus affiché). */}
      <ListeDeroulante
        id={`role-${userId}`}
        libelleId={`role-${userId}-libelle`}
        libelle={`Rôle de ${nom}`}
        valeur={valeur}
        entrees={ENTREES_ROLE}
        onChoisir={choisir}
        /* 48 px et 16 px, comme la case à cocher de la même ligne : cette liste déroulante faisait
            44 px avec un texte de 15 px, à côté d'une case qui venait de passer à 48 — deux cibles
            voisines de deux tailles, dans un tableau où l'on descend ligne à ligne. */
        className="min-h-12 rounded-xl border-2 border-bordure/70 bg-surface px-3 text-base font-semibold text-texte shadow-carte focus:border-primaire"
      />
      {/* **Le refus est annoncé, et il ne s'écrit pas en 12 px**. C'est le seul message de ce
          contrôle — la liste retombe sur l'ancien rôle sans autre explication —, et il était rendu
          conditionnellement, donc créé **en même temps que son texte** : une région vivante ajoutée
          avec son contenu n'est jamais annoncée, et qui n'a pas l'écran sous les yeux voyait
          simplement son choix ne pas prendre. Région montée en permanence (même patron que le
          message d'une case du planning, `CaseEditeur`), `empty:hidden` pour ne pas creuser la
          ligne du tableau quand tout va bien, et `text-base` parce que ce texte-là dit qu'un
          changement de rôle n'a **pas** eu lieu. */}
      {messageErreur}
    </div>
  );
}
