"use client";

import { Fragment, useCallback, useEffect, useRef, useState, type CSSProperties, type FocusEventHandler, type KeyboardEvent, type PointerEventHandler } from "react";
import { Icone } from "@/components/ui/Icone";
import { entreesRecherchees, estEntreeVide, grouper, hauteurListeRem, indexActifRecherche, indexApresTouche, indexDeValeur, indexParFrappe, listeCherchable, type EntreeListe } from "./liste-deroulante";

export type { EntreeListe };

/**
 * **Pourquoi ce composant existe, et pourquoi le `<select>` natif ne pouvait pas rester.**
 *
 * Le sens d'ouverture du menu d'un `<select>` appartient au navigateur : il le retourne vers le
 * haut dès que la place manque en dessous, et **aucune CSS ne le lui interdit**. Dans le planning,
 * les cases du bas de page ouvraient donc leur liste vers le haut — et une liste de vingt thèmes
 * retournée depuis le bas de l'écran a son **sommet hors de la fenêtre** : ses premières entrées
 * n'étaient tout simplement pas atteignables.
 *
 * D'où cette liste maîtrisée, qui tient sur une règle : **elle s'ouvre toujours vers le bas**. Le
 * panneau est posé sous le déclencheur (`top-full`), plafonné à 18 rem et il défile. S'il n'y a pas
 * la place dans la fenêtre, on ne retourne pas la liste : **on fait monter la page** juste ce qu'il
 * faut pour que la place existe (voir l'effet de placement). Une liste qui change de sens selon
 * l'endroit de la page est précisément ce qu'on voulait supprimer — même à la 35e séance d'un
 * trimestre, le premier thème est au même endroit.
 *
 * Le reste suit le motif ARIA d'une liste déroulante à choix unique : le focus **ne quitte jamais
 * le déclencheur**, qui porte `aria-expanded` et l'option active ; le panneau est un `listbox` dont
 * chaque entrée est une `option`. Garder le focus sur le bouton fait que la tabulation continue de
 * fonctionner toute seule, et qu'Échap n'a rien à restaurer.
 *
 * **Au-delà de vingt entrées, le panneau reçoit un champ de recherche** : dans un club de
 * quatre-vingts, la liste des instructeurs *est* l'annuaire, et on n'y parcourt pas, on y cherche
 * un nom. C'est le patron d'`AjoutMembresPeriode` — filtrer une liste déjà chargée —, pas un
 * troisième patron. Le focus quitte alors le déclencheur pour le champ, mais **seulement si la
 * liste a été ouverte au clavier** : voir `focusChamp`.
 */

/** Le champ de recherche posé au-dessus de la liste, quand il existe (cible tactile + ses marges). */
const RECHERCHE_REM = 3.75;

/** Un peu d'air sous le panneau, pour qu'il ne colle pas au bord de la fenêtre. */
const MARGE_REM = 1;

/**
 * **Le rem en pixels, lu sur le document — jamais une constante.**
 *
 * `max-h-72` vaut 288 px tant que personne n'a grossi les caractères de son navigateur. Écrite en
 * dur, la hauteur mentait dès qu'on y touchait : on dégageait 288 px pour un panneau qui en prenait
 * 400, et sa fin repassait sous le bord de la fenêtre — exactement le défaut que ce composant
 * existe pour corriger. Les tailles de l'application sont relatives ; le calcul doit l'être aussi.
 */
function remEnPixels(): number {
  const taille = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
  return Number.isFinite(taille) && taille > 0 ? taille : 16;
}

/** Au-delà, la frappe en cours est oubliée et la suivante recommence un mot (comme une liste native). */
const OUBLI_FRAPPE_MS = 800;

type Props = {
  /** Identifiant du déclencheur : c'est lui que vise le `htmlFor` du libellé existant. */
  id: string;
  /** Identifiant du `<label>` qui nomme le champ — repris tel quel, rien n'est réécrit ici. */
  libelleId: string;
  /** Le même libellé en texte, pour nommer le panneau (un `listbox` sans nom n'est qu'une liste). */
  libelle: string;
  valeur: string;
  entrees: EntreeListe[];
  onChoisir: (valeur: string) => void;
  /** Classes du déclencheur : il doit ressembler au champ qu'il remplace, c'est l'appelant qui sait. */
  className?: string;
  /** Style du déclencheur (planning : le liseré gauche à la couleur de la personne choisie). */
  style?: CSSProperties;
  /** Premier contact : le planning s'en sert pour écrire les entrées avant qu'on ne les regarde. */
  onPointerDown?: PointerEventHandler<HTMLButtonElement>;
  onFocus?: FocusEventHandler<HTMLButtonElement>;
  /** Liste inerte : elle montre sa valeur, ne s'ouvre pas, et le dit (`disabled`). */
  disabled?: boolean;
  /** Identifiants des phrases qui décrivent le champ (aide, erreur), comme sur un `<input>`. */
  decritPar?: string;
};

export function ListeDeroulante({ id, libelleId, libelle, valeur, entrees, onChoisir, className = "", style, onPointerDown, onFocus, disabled = false, decritPar }: Props) {
  const [ouverte, setOuverte] = useState(false);
  const [actif, setActif] = useState(-1);
  const [recherche, setRecherche] = useState("");
  const enveloppe = useRef<HTMLDivElement>(null);
  const declencheur = useRef<HTMLButtonElement>(null);
  const panneau = useRef<HTMLUListElement>(null);
  const champ = useRef<HTMLInputElement>(null);
  /**
   * **Le curseur va-t-il au champ de recherche à l'ouverture ?** Seulement si la liste a été
   * ouverte au clavier. Sur un téléphone, donner le focus à une zone de saisie déplie le clavier du
   * système, qui mange la moitié basse de l'écran — c'est-à-dire l'endroit exact où l'on vient de
   * faire de la place pour le panneau. Au doigt, on ouvre pour *regarder* la liste : le champ reste
   * là, à portée d'appui, et ne se met en travers que de qui le demande.
   */
  const focusChamp = useRef(false);
  const frappe = useRef<{ texte: string; minuteur: ReturnType<typeof setTimeout> | null }>({ texte: "", minuteur: null });
  const idListe = `${id}-liste`;
  const idRecherche = `${id}-recherche`;
  const idOption = (index: number) => `${id}-option-${index}`;
  const cherchable = listeCherchable(entrees);
  /**
   * Les entrées réellement montrées : toutes, ou celles que la recherche retient — **plus
   * `----------`, que `entreesRecherchees` garde en tête** même quand le filtre l'écarterait (elle
   * n'a pas de libellé qu'on puisse chercher, et sans elle on ne pourrait plus vider une case sans
   * effacer sa frappe). C'est bien la liste rendue : celle que `grouper` découpe, celle que les
   * flèches parcourent, celle que `aria-activedescendant` numérote.
   */
  const visibles = cherchable ? entreesRecherchees(entrees, recherche) : entrees;
  const groupes = grouper(visibles);
  /**
   * **Rien ne correspond — et `----------` ne compte pas pour un résultat.**
   *
   * Le message tenait à `visibles.length === 0`, ce qui a cessé d'être vrai le jour où l'écriture du
   * vide est restée épinglée : chercher « zzz » laissait un panneau avec une entrée dedans et
   * **aucun mot pour dire que la recherche n'avait rien trouvé**. On compte donc les vrais résultats.
   * La recherche doit être non vide : une liste qui n'a qu'une entrée de vidage (liste des thèmes
   * repliée sur une case sans thème) n'annonce rien du tout, comme avant.
   */
  const aucunResultat = visibles.length === 0 || (recherche.trim() !== "" && visibles.every(estEntreeVide));
  // Une valeur absente de la liste reste affichée telle quelle : mieux vaut un thème brut qu'une case vide.
  const affiche = entrees.find((e) => e.valeur === valeur)?.libelle ?? valeur;

  const ouvrir = (index: number, parClavier = false) => {
    focusChamp.current = parClavier;
    setActif(index);
    setOuverte(true);
  };

  /**
   * **Le seul chemin de fermeture**, et le seul endroit du fichier où `setOuverte(false)` est écrit.
   *
   * Ce n'était pas le cas, et voici ce que cela donnait. Case « Instructeur » portant « Chloé
   * Durand » : on ouvre, on tape `charlie`, on se ravise, on clique ailleurs — le gestionnaire « clic
   * ailleurs » se contentait alors de `setOuverte(false)`. La recherche restait donc en mémoire, et
   * rouvrir montrait le panneau **encore filtré sur charlie** : `indexDeValeur` n'y trouvait plus
   * Chloé, l'option active retombait sur 0, c'est-à-dire sur Charlie, et comme le focus n'a jamais
   * quitté le déclencheur, **Entrée choisissait Charlie**. Le planning enregistre à chaque choix : la
   * mauvaise personne partait en base et dans le journal, sans confirmation.
   *
   * D'où `useCallback` et une seule écriture : tout ce qui referme la liste passe par ici, y compris
   * l'écouteur « clic ailleurs », qui a besoin d'une fonction stable pour ne pas se réabonner à
   * chaque mouvement de souris dans le panneau.
   */
  const fermer = useCallback(() => {
    setOuverte(false);
    frappe.current.texte = "";
    // La recherche ne survit pas à la fermeture : rouvrir doit montrer la liste entière, sans quoi
    // on se retrouverait devant trois noms sans comprendre où sont passés les autres.
    setRecherche("");
  }, []);

  const choisir = (index: number) => {
    const entree = visibles[index];
    fermer();
    // Le focus revient au déclencheur avant l'appel : celui-ci peut faire disparaître la case
    // (programmer un atelier la rend en lecture seule) et le focus serait alors perdu dans le vide.
    declencheur.current?.focus();
    if (entree) onChoisir(entree.valeur);
  };

  /**
   * **L'entrée active pour une frappe donnée** — `indexActifRecherche` en est la seule règle, et
   * c'est elle qui empêche `----------` d'être ce qu'Entrée choisit (voir le module).
   */
  const actifPourFrappe = (texte: string) => indexActifRecherche(entreesRecherchees(entrees, texte), texte, valeur);

  /** Ce qui est tapé dans le champ : le premier **vrai** résultat devient l'entrée active. */
  const chercher = (texte: string) => {
    setRecherche(texte);
    setActif(actifPourFrappe(texte));
  };

  /**
   * **Faire exister la place plutôt que retourner la liste.**
   *
   * `scrollIntoView` ne suffit pas seul : il ne bouge rien tant que le déclencheur est visible,
   * même collé au bas de la fenêtre. On amène donc d'abord la case dans la vue, puis on fait monter
   * la page du manque exact. Quand la page est déjà au bout (dernière ligne du planning), le
   * panneau dépasse le bas du document, qui s'allonge d'autant : il reste atteignable au défilement.
   */
  useEffect(() => {
    if (!ouverte) return;
    const bouton = declencheur.current;
    if (!bouton) return;
    bouton.scrollIntoView({ block: "nearest" });
    const rect = bouton.getBoundingClientRect();
    // La place demandée est celle que le panneau prendra vraiment (`hauteurListeRem`), et non le
    // plafond : réserver 18 rem pour une liste de quatre niveaux faisait monter la page de 288 px
    // pour un panneau qui en occupe 150, et la case visée n'était plus sous le doigt.
    const hauteur = (hauteurListeRem(entrees.length) + (cherchable ? RECHERCHE_REM : 0) + MARGE_REM) * remEnPixels();
    const manque = hauteur - (window.innerHeight - rect.bottom);
    if (manque > 0) window.scrollBy(0, manque);
    // `entrees.length` et non `visibles.length` : la recherche est vide à l'ouverture, et la place ne
    // doit pas se recalculer à chaque lettre — la page sauterait pendant qu'on cherche un nom.
  }, [ouverte, cherchable, entrees.length]);

  /** Ouverte au clavier, la liste donne le curseur au champ de recherche (voir `focusChamp`). */
  useEffect(() => {
    if (!ouverte || !cherchable || !focusChamp.current) return;
    focusChamp.current = false;
    champ.current?.focus();
  }, [ouverte, cherchable]);

  /**
   * Un clic ailleurs referme — y compris sur une autre case de la grille, qui s'ouvrira ensuite.
   *
   * **Par `fermer()`, jamais par `setOuverte(false)`** : c'est `fermer` qui remet la recherche à
   * zéro, et une recherche abandonnée qui survit à la fermeture fait choisir quelqu'un d'autre à la
   * réouverture (le scénario est raconté en entier au-dessus de `fermer`).
   */
  useEffect(() => {
    if (!ouverte) return;
    const dehors = (e: PointerEvent) => {
      if (!enveloppe.current?.contains(e.target as Node)) fermer();
    };
    document.addEventListener("pointerdown", dehors);
    return () => document.removeEventListener("pointerdown", dehors);
  }, [ouverte, fermer]);

  /** L'option active reste sous les yeux : sans cela, les flèches la poussent hors du panneau. */
  useEffect(() => {
    if (!ouverte) return;
    panneau.current?.querySelector<HTMLElement>('[data-actif="oui"]')?.scrollIntoView({ block: "nearest" });
  }, [ouverte, actif, recherche]);

  useEffect(() => () => void (frappe.current.minuteur && clearTimeout(frappe.current.minuteur)), []);

  const auClavier = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "Escape") {
      // Le focus est déjà sur le déclencheur (il ne l'a jamais quitté) : il n'y a rien à restaurer.
      if (ouverte) e.preventDefault();
      fermer();
      return;
    }
    // Tabulation : on referme sans `preventDefault`, pour que le focus parte où il allait.
    if (e.key === "Tab") {
      fermer();
      return;
    }
    if (!ouverte) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        ouvrir(indexActifRecherche(visibles, recherche, valeur), true);
        return;
      }
    } else {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        choisir(actif);
        return;
      }
      const suivant = indexApresTouche(e.key, actif, visibles.length);
      if (suivant !== null) {
        e.preventDefault();
        setActif(suivant);
        return;
      }
    }
    if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    /*
     * Liste longue : la lettre tapée **ouvre le panneau et amorce la recherche** au lieu de sauter
     * d'entrée en entrée. Deux mécanismes de frappe pour un même champ se contrediraient, et c'est
     * la recherche qui gagne : elle porte sur tout le libellé, là où la frappe native ne vise que
     * le début — sur quatre-vingts noms, la différence est celle d'un nom qu'on trouve et d'un nom
     * qu'on ne trouve pas.
     */
    if (cherchable) {
      const texte = (ouverte ? recherche : "") + e.key;
      chercher(texte);
      // Panneau déjà ouvert (on l'avait ouvert au doigt) : la lettre rejoint le champ, et le
      // curseur avec elle — sinon la touche ne ferait rien du tout, ce qui se lit comme une panne.
      if (ouverte) champ.current?.focus();
      else ouvrir(actifPourFrappe(texte), true);
      return;
    }
    const texte = frappe.current.texte + e.key;
    frappe.current.texte = texte;
    if (frappe.current.minuteur) clearTimeout(frappe.current.minuteur);
    frappe.current.minuteur = setTimeout(() => {
      frappe.current.texte = "";
    }, OUBLI_FRAPPE_MS);
    const trouve = indexParFrappe(entrees, texte, ouverte ? actif : indexDeValeur(entrees, valeur));
    if (trouve === null) return;
    // Liste fermée, on **ouvre** sur l'entrée trouvée au lieu de l'enregistrer : le planning sauve
    // à chaque changement, une frappe malheureuse ne doit pas partir au serveur sans qu'on l'ait vue.
    if (ouverte) setActif(trouve);
    else ouvrir(trouve, true);
  };

  /**
   * Le clavier dans le champ de recherche. Il ne reprend que ce qui navigue dans la liste : Début,
   * Fin et la barre d'espace restent au texte, où elles déplacent le curseur et écrivent un mot.
   */
  const auClavierRecherche = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape" || e.key === "Enter") {
      e.preventDefault();
      if (e.key === "Enter") choisir(actif);
      else {
        fermer();
        declencheur.current?.focus();
      }
      return;
    }
    if (e.key === "Tab") {
      /*
       * **On rend le focus au déclencheur avant de fermer.** Fermer démonte l'`<input>` qui a le
       * focus, et un élément démonté ne transmet rien : le focus retombait sur `<body>` et la
       * tabulation suivante repartait du premier lien de la page, à des dizaines de cases du planning
       * de celle qu'on venait de régler. Le `Tab` du navigateur n'est pas empêché : il continue sa
       * route depuis le déclencheur, c'est-à-dire exactement là où il serait parti si le panneau
       * n'avait jamais été ouvert.
       */
      declencheur.current?.focus();
      fermer();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const suivant = indexApresTouche(e.key, actif, visibles.length);
    if (suivant !== null) {
      e.preventDefault();
      setActif(suivant);
    }
  };

  return (
    <div className="relative" ref={enveloppe}>
      <button
        type="button"
        id={id}
        ref={declencheur}
        // Le libellé existant nomme le champ, et le bouton se nomme aussi lui-même : sans son
        // propre id dans `aria-labelledby`, son contenu — la valeur choisie — ne serait pas annoncé.
        aria-labelledby={`${libelleId} ${id}`}
        aria-describedby={decritPar || undefined}
        /*
         * **Le motif « combobox à choix unique » se porte sur l'élément focalisé, et c'est celui-ci.**
         *
         * `aria-activedescendant` ne vaut que sur l'élément qui a le focus : posé sur le `<ul>`,
         * que personne ne focalise jamais, il était **inerte**. Or le focus ne quitte le
         * déclencheur que sur les listes cherchables, au-delà de vingt entrées. Sous le seuil —
         * donc pour les quatre listes de chaque case du planning d'un club de douze, celui qui a
         * commandé l'outil — la synthèse vocale n'annonçait **aucune option** pendant qu'on navigue
         * aux flèches, et Entrée enregistrait une valeur qui n'avait jamais été dite.
         */
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={ouverte}
        aria-controls={ouverte ? idListe : undefined}
        aria-activedescendant={ouverte && visibles[actif] ? idOption(actif) : undefined}
        className={`flex items-center justify-between gap-1 text-left ${className}`}
        style={style}
        onPointerDown={onPointerDown}
        onFocus={onFocus}
        disabled={disabled}
        onClick={() => (ouverte ? fermer() : ouvrir(indexActifRecherche(visibles, recherche, valeur)))}
        onKeyDown={auClavier}
      >
        {/* **`w-0 flex-1`, et pas seulement `truncate`** : un texte tronqué garde sa largeur entière comme
            largeur minimale, et une piste de grille `auto` (la liste des ateliers, deux colonnes sur grand
            écran) s'élargissait à la longueur du nom de séance le plus long — la carte sortait de l'écran
            d'un téléphone et la page défilait de côté. Une largeur de base nulle rend la liste aussi
            étroite que sa place, et c'est la troncature qui fait le reste. */}
        <span className="w-0 min-w-0 flex-1 truncate">{affiche}</span>
        <Icone nom="chevronBas" taille={16} className="text-texte-secondaire" />
      </button>
      {ouverte && !disabled && (
        // `top-full` : sous le déclencheur, toujours. Largeur = celle du déclencheur, jamais plus :
        // un panneau plus large déborderait de l'écran sur la dernière colonne de la grille.
        <div className="absolute inset-x-0 top-full z-20 mt-1 rounded-xl border border-bordure bg-surface text-texte shadow-carte">
          {cherchable && (
            <div className="border-b border-bordure/60 p-1.5">
              <input
                id={idRecherche}
                ref={champ}
                type="text"
                role="combobox"
                aria-expanded
                aria-controls={idListe}
                aria-autocomplete="list"
                aria-activedescendant={visibles[actif] ? idOption(actif) : undefined}
                aria-label={`Rechercher — ${libelle}`}
                autoComplete="off"
                // Le nombre annoncé dans l'invite : savoir qu'on a quatre-vingts entrées devant soi,
                // c'est savoir qu'il vaut mieux taper trois lettres que faire défiler.
                placeholder={`Rechercher parmi ${entrees.length}…`}
                value={recherche}
                onChange={(e) => chercher(e.target.value)}
                onKeyDown={auClavierRecherche}
                // 48 px comme les entrées qu'il filtre (`min-h-12` plus bas) : c'est le champ d'un
                // panneau qu'on ouvre au doigt, et il n'a aucune raison d'être la plus petite cible.
                className="min-h-12 w-full rounded-lg border border-bordure bg-surface px-2 text-base text-texte focus:border-primaire"
              />
            </div>
          )}
          {/* **Une recherche qui ne ramène rien doit se dire, pas seulement se voir.** Le message
              vivait dans le `<ul>`, en `role="presentation"` : à l'œil il était là, à la synthèse
              vocale il n'existait pas — on tapait trois lettres de trop et le panneau devenait
              silencieux sans qu'un mot l'explique. C'est une région annoncée, posée hors de la
              `listbox` (qui ne contient que des options) et rendue en permanence : une région qui
              apparaît en même temps que son texte n'est pas toujours lue. */}
          <p role="status" aria-live="polite" className="px-2 py-3 text-texte-secondaire empty:hidden">
            {aucunResultat ? "Aucun résultat" : ""}
          </p>
          <ul
            id={idListe}
            ref={panneau}
            role="listbox"
            aria-label={libelle}
            // `max-h-72` = `PANNEAU_MAX_REM` (18 rem) : le plafond du calcul de placement et celui de
            // la CSS sont la même valeur, sans quoi la place dégagée mentirait.
            className="max-h-72 overflow-y-auto overscroll-contain py-1"
          >
            {groupes.map((groupe) => {
              const entrees = groupe.entrees.map(({ entree, index }) => (
                <li
                  key={entree.valeur || `vide-${index}`}
                  id={idOption(index)}
                  role="option"
                  aria-selected={entree.valeur === valeur}
                  data-actif={index === actif ? "oui" : undefined}
                  // `min-h-12` : 48 px de haut, la cible tactile du projet — on règle le planning au doigt.
                  className={`flex min-h-12 cursor-pointer items-center gap-2 break-words px-2 py-2 ${index === actif ? "bg-primaire-doux" : ""} ${
                    entree.valeur === valeur ? "font-semibold" : ""
                  }`}
                  // À la souris, l'entrée survolée devient l'entrée active : une seule mise en avant à
                  // l'écran. Au doigt, non : un glissement pour faire défiler le panneau déplacerait
                  // l'option active, que l'effet ci-dessus ramènerait aussitôt dans la vue — on se
                  // battrait avec le défilement de la personne.
                  onPointerMove={(e) => e.pointerType === "mouse" && setActif(index)}
                  onClick={() => choisir(index)}
                >
                  {/* **La couleur de la personne sur une pastille, jamais sur le nom**. Elle
                      teintait le texte de l'entrée : calculée contre `--surface` (4,7:1), elle
                      tombait à 3,80:1 en clair et 3,91:1 en sombre sur `--primaire-doux`, le fond
                      de l'option **active** — donc sous AA pour la moitié de la palette, sur la
                      ligne même qu'on est en train de choisir aux flèches. Le nom reprend la
                      couleur du texte courant, qui tient sur les deux fonds ; la pastille, elle,
                      n'est qu'un élément graphique (3:1 suffit) et reste le repère d'identification
                      qu'elle est partout ailleurs dans le projet. */}
                  {entree.couleur && <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: entree.couleur }} />}
                  <span className="min-w-0 flex-1">{entree.libelle}</span>
                  {entree.valeur === valeur && <Icone nom="check" taille={16} />}
                </li>
              ));
              /*
               * **Un intitulé de groupe devient un vrai `group`**. C'était un `<li
               * role="presentation">` posé au milieu de la `listbox`, qui n'admet pourtant que des
               * `option` et des `group` : l'intitulé s'y invitait comme un enfant sans rôle, et les
               * entrées qu'il coiffe n'étaient rattachées à rien. Ici le `<li>` porte
               * `role="group"` et son nom, ses options vivent dans une liste transparente
               * (`role="presentation"`, qui laisse passer ses enfants), et le titre visible est
               * `aria-hidden` puisque le groupe le dit déjà. La liste à plat des index ne change
               * pas d'un signe : c'est elle que suivent les flèches et `aria-activedescendant`.
               *
               * `text-base` et plus de capitales espacées : à 12 px en `uppercase tracking-wide`,
               * « PROGRAMMER UN ATELIER EN ATTENTE » était le texte le moins lisible du panneau.
               */
              if (!groupe.intitule) return <Fragment key="sans-groupe">{entrees}</Fragment>;
              return (
                <li key={groupe.intitule} role="group" aria-label={groupe.intitule}>
                  <span aria-hidden className="block px-2 pb-1 pt-2 text-base font-semibold text-texte-secondaire">
                    {groupe.intitule}
                  </span>
                  <ul role="presentation">{entrees}</ul>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
