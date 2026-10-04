"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { vuesDisponibles, type Vue } from "./vues";

/** Les points de vue de l'accueil. Le type et la règle qui les ouvre vivent dans `vues.ts`. */
export type { Vue };

const LIBELLES: Record<Vue, string> = { club: "Club", personnel: "Personnel", admin: "Admin" };

/** Valeur par défaut hors fournisseur : « personnel », la vue que tout le monde possède. */
const Contexte = createContext<Vue>("personnel");

/**
 * L'état de la bascule, partagé par les lignes de cours et les blocs réservés à une vue.
 *
 * **On ouvre sur la vue qui correspond à sa place dans le club**, et c'est ce qui décide aussi des
 * positions offertes :
 *
 * - **un membre** n'a qu'une vue, la sienne : « Personnel ». Pas de bascule du tout — la faire
 *   apparaître avec une seule position serait un bouton qui ne commande rien. La vie du club, il
 *   la lit sur les onglets Planning et Séances, qui sont faits pour ça ;
 * - **un instructeur** ouvre sur « Club » : il vient voir où ça se remplit et ce qu'il y a à
 *   préparer, pas sa propre assiduité. Il bascule sur « Personnel » quand il répond pour lui ;
 * - **un administrateur élevé** ouvre sur « Club » lui aussi, avec une troisième position — **à
 *   condition d'être instructeur**. Du bureau mais membre, il n'a pas « Club » : il pilote le club
 *   sans l'encadrer. La règle et ses quatre cas vivent dans `vues.ts`.
 *
 * **Le choix n'est pas mémorisé** — ni `localStorage`, ni cookie, ni URL : on rouvre l'application,
 * on retombe sur sa vue de départ. C'est une demande explicite ; merci de ne pas ajouter
 * « utilement » une mémorisation ici, ce serait défaire la décision.
 *
 * **La position « Admin » n'existe que si `admin` est vrai**, et ce booléen n'est vrai que pour un
 * administrateur **connecté en tant qu'administrateur** (rôle *et* élévation, vérifiés côté
 * serveur). Pour tout le monde d'autre elle n'est pas cachée : elle n'est pas dans le balisage, et
 * les chiffres qu'elle montrerait n'ont même pas été calculés (voir `BlocAdmin`, `src/lib/accueil.ts`).
 *
 * Le fournisseur ne pose aucune balise : ses enfants restent enfants directs de la colonne de la
 * page, et gardent donc l'espacement de l'écran.
 */
export function FournisseurVue({ admin = false, encadre = false, children }: { admin?: boolean; encadre?: boolean; children: ReactNode }) {
  // La règle est dans `vues.ts`, avec ses cas : elle se vérifie sans navigateur.
  const vues = vuesDisponibles({ encadre, admin });
  const [vue, setVue] = useState<Vue>(vues[0]);
  return (
    <Contexte.Provider value={vue}>
      {/* Une seule vue possible : pas de bascule. Un groupe de boutons à une position occuperait
          une ligne pour ne rien proposer. */}
      {/* **La bascule garde sa rangée, au-dessus des deux colonnes** : elle commande des morceaux
          des *deux* — les bandes d'indicateurs à gauche, les compteurs à droite. Posée dans la
          colonne de côté de 22 rem, elle se retrouverait **à côté** de la vignette qu'elle
          commande. Ce qui commande l'écran entier se lit avant lui, pas à côté de lui. */}
      {vues.length > 1 && (
        <div className="w-fit">
          <Bascule vues={vues} vue={vue} choisir={setVue} />
        </div>
      )}
      {children}
    </Contexte.Provider>
  );
}

/**
 * La bascule elle-même : la pilule de l'application (celle de « À venir / Passé »), à un détail
 * près — celle-ci commande vraiment quelque chose.
 *
 * `BasculeTemps` est faite de `<Link>` marqués `aria-current` parce que ce sont des
 * **navigations**. Ici rien ne navigue : ce sont des boutons qui restent enfoncés, donc
 * `aria-pressed` dans un groupe nommé — la sémantique juste, et au clavier chaque position
 * s'atteint par Tab et s'active par Entrée ou Espace, sans gestion de flèches à réinventer.
 *
 * `px-4` plutôt que davantage sur téléphone : à trois positions, la pilule doit encore tenir sur
 * une ligne de 390 px sans rogner la hauteur tapable, qui reste celle du projet — **48 px**.
 */
function Bascule({ vues, vue, choisir }: { vues: Vue[]; vue: Vue; choisir: (v: Vue) => void }) {
  return (
    <div role="group" aria-label="Ce que montre l'accueil" className="flex self-start rounded-full border border-bordure bg-surface p-0.5 text-sm font-semibold">
      {vues.map((v) => {
        const actif = v === vue;
        return (
          <button
            key={v}
            type="button"
            aria-pressed={actif}
            onClick={() => choisir(v)}
            className={`flex min-h-12 items-center rounded-full px-4 motion-safe:transition-colors sm:px-6 ${
              actif ? "bg-primaire text-primaire-texte" : "text-texte-secondaire"
            }`}
          >
            {LIBELLES[v]}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Un bloc qui n'appartient qu'à une vue : la bande du club, le bouton de réponse et la bande
 * personnelle, le pilotage et la file de l'encadrement.
 *
 * Rendu par un fragment, donc **sans balise** : ses enfants restent enfants directs de la colonne
 * de la page et gardent son espacement. Hors de leur vue, ils ne sont pas rendus du tout — ni
 * hauteur réservée, ni élément focalisable au clavier, ni lecture par un lecteur d'écran.
 *
 * **On ne superpose plus les bandes**, contrairement à la version à deux vues : les trois ne
 * montrent plus la même chose au même endroit (deux tuiles d'un côté, un tableau de bord et une
 * carte de l'autre). Réserver partout la hauteur de la plus grande creuserait un vide sous la vue
 * Club, exactement ce que cette refonte cherchait à supprimer — et la bascule est un geste
 * délibéré, pas un survol : la page a le droit de changer de taille quand on la demande.
 */
export function VueSeule({ vue, children }: { vue: Vue | readonly Vue[]; children: ReactNode }) {
  const courante = useContext(Contexte);
  // Un bloc peut appartenir à **plusieurs** vues : la frise de fréquentation, par exemple, parle du
  // club et sert donc aussi au bureau, mais n'a rien à faire dans la vue « Personnel », qui ne
  // parle que de soi.
  const vues = Array.isArray(vue) ? vue : [vue as Vue];
  return vues.includes(courante) ? <>{children}</> : null;
}
