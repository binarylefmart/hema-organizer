"use client";

import { createContext, useContext, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { Bouton } from "@/components/ui/Bouton";
import { Icone } from "@/components/ui/Icone";
import { ListeDeroulante, type EntreeListe } from "@/components/ui/ListeDeroulante";
import {
  ajouter,
  barreDeMasseVisible,
  basculer,
  compterHorsAffichage,
  etatToutCocher,
  libelleToutSelectionner,
  lignesSelectionnees,
  memoriserLignes,
  retirer,
  texteHorsAffichage,
} from "@/components/gestion/selection-presences";
import {
  appliquerGesteEnMasse,
  definirRolesEnMasse,
  renvoyerLiensEnMasse,
  type ResultatGesteEnMasse,
  type ResultatLiensEnMasse,
  type ResultatRolesEnMasse,
} from "./actions";
import { resumeRoles, texteConfirmationRoles, texteHorsPage, texteSansCase, type LigneRole } from "./selection-roles";
import { INVITE_SELECTION, libelleGeste, resumeGeste, texteConfirmationGeste, type GesteMasse, type LigneGeste } from "./selection-gestes";
import { resumeLiens, texteConfirmationLiens, texteRienAEnvoyer, type LigneLien } from "./selection-liens";

/**
 * **Cocher plusieurs comptes, puis agir une seule fois**.
 *
 * Cinq gestes de masse partagent cette zone : **changer le rôle** (membre ↔ instructeur, le geste
 * d'origine), puis —, « ajoute une possible selection avec possibilité de desactiver reactiver ou
 * suprimer (comme en bulk action) » — **désactiver**, **réactiver** et **supprimer**, et enfin
 * **renvoyer le lien personnel**.
 *
 * **Le cinquième n'est pas comme les quatre autres : il part vers les gens.** Les quatre premiers
 * écrivent en base et n'envoient rien ; celui-ci expédie un email par personne cochée. Sa confirmation
 * annonce donc **le nombre d'emails** et non le nombre de cases (`selection-liens.ts`), et ses verrous
 * sont ceux du bouton d'une ligne, code 2FA compris (voir `renvoyerLiensEnMasse`, `actions.ts`).
 *
 * **Une seule zone, une seule sélection, une seule barre.** Cocher trente lignes pour choisir ensuite
 * quoi en faire est *un* geste ; deux barres superposées, chacune avec son compteur et sa case
 * maîtresse, en feraient deux — et poseraient la question de savoir laquelle regarde quelle sélection.
 *
 * **C'est exactement le geste de `/admin/presences`** (corriger les réponses en masse) : les
 * mécaniques d'ensemble et le libellé de la case maîtresse sont **importés** de
 * `selection-presences.ts`, ils ne sont pas réécrits. Un bureau qui apprend à cocher des lignes sur
 * un écran doit retrouver le même geste sur l'autre — même case maîtresse à trois états, même façon
 * de nommer ce sur quoi elle agit.
 *
 * Trois règles, et elles sont le cœur du composant :
 *
 * - **la sélection ne porte que sur ce qui est à l'écran** — le résultat de la recherche en cours et
 *   la page affichée (l'annuaire coupe à cinquante). La case maîtresse dit **combien** elle prend,
 *   jamais « Tout » : le mot serait faux dès qu'une recherche filtre ou qu'une page en cache la
 *   suite, et c'est précisément là qu'on s'en sert ;
 * - **un administrateur a une case comme les autres** : il n'en avait pas, et le motif a cessé
 *   d'exister — les trois rôles étaient exclusifs, donc écrire un rôle à un administrateur l'aurait
 *   **rétrogradé en silence**. Le bureau est devenu un supplément (`User.estAdmin`), les cinq gestes
 *   de cette barre n'écrivent **jamais** `estAdmin`, et aucun d'eux ne lui retire donc quoi que ce
 *   soit par surprise. Ce qui reste dû au bureau est **dit avant** : la confirmation d'une
 *   désactivation ou d'une suppression le nomme (`phraseBureau`, `selection-gestes.ts`). Ce qui n'a
 *   pas de case, c'est **sa propre ligne** — on n'agit pas sur son propre compte — et l'écran le dit
 *   maintenant (`texteSansCase`) ;
 * - **la barre n'existe qu'avec une sélection**. C'est l'inverse de la décision de la veille, qui
 *   la montait toujours, grisée, avec la phrase qui dit quoi faire — parce que Delta ne l'avait pas
 *   trouvée sur l'écran voisin, où elle n'apparaissait qu'à la première case cochée. **Le motif de
 *   cette décision-là tient toujours** : des cases à cocher ne disent rien de ce qu'elles permettent.
 *   Ce qui change, c'est **où** on le dit — la phrase descend sous la case maîtresse, en une ligne
 *   (`INVITE_SELECTION`), là où l'œil est déjà, au lieu d'occuper une barre de deux cents pixels
 *   incapable d'écrire. La condition d'affichage est **partagée avec les présences**
 *   (`barreDeMasseVisible`) : les deux écrans doivent apparaître au même moment.
 *
 * **Pas de seuil, et c'est le même choix qu'aux présences** : la sélection est là dès douze comptes.
 * Elle ne coûte qu'une case par ligne et une ligne d'en-tête ; l'accrocher à `LIGNES_VISIBLES`
 * ferait **apparaître une mécanique le jour où le club franchit vingt comptes** — une fois, sans
 * prévenir, devant quelqu'un qui ne l'a jamais vue. Ce qui reste derrière le seuil, c'est ce qui ne
 * fait que **raccourcir** l'écran : les repères alphabétiques (voir `page.tsx`).
 *
 * La barre est **collante sous l'en-tête de l'application** (`top-20`) : on coche des gens répartis
 * sur toute la hauteur d'une liste de cinquante, et un bouton resté en haut de page obligerait à
 * remonter pour valider — c'est-à-dire à perdre de vue ce qu'on vient de cocher.
 */

type Contexte = { selection: ReadonlySet<string>; basculer: (id: string) => void };

const Selection = createContext<Contexte | null>(null);

/**
 * **Les mots de cet écran** : on y coche des *comptes*, et le mot est masculin. C'est tout ce que la
 * phrase partagée (`texteHorsAffichage`) attend de lui — « ce qui se duplique, ce sont les mots,
 * jamais la mécanique » (`CLAUDE.md`).
 */
const MOTS_COMPTES = { singulier: "compte", pluriel: "comptes", accord: "m" } as const;

/**
 * Le nom du geste **en sujet de phrase**, pour l'unique message que l'écran écrit de lui-même : « La
 * suppression n'a pas abouti ». Le libellé du bouton est un impératif (« Supprimer ») et ne se recycle
 * pas en sujet — c'est le genre de phrase bancale qu'on lit justement dans un moment d'inquiétude.
 */
const SUJETS_GESTES: Record<GesteMasse, string> = {
  desactiver: "La désactivation",
  reactiver: "La réactivation",
  supprimer: "La suppression",
};

/**
 * **Les rôles de la liste déroulante**.
 *
 * C'étaient deux boutons côte à côte, « Instructeur » et « Membre ». Une liste déroulante les range et
 * laisse la place aux cinq autres gestes, mais elle change la nature du geste : un bouton, c'était un
 * clic ; une liste, c'est **choisir puis valider**. Voir `appliquerRole` — le rôle n'est pas appliqué au
 * choix.
 *
 * **« Administrateur » n'y figure pas, et ce n'est pas un oubli** : ce n'est plus un rôle. Tout le
 * monde porte un **rôle de base** — membre ou instructeur (`ROLES_DE_BASE`) — et le bureau s'ajoute
 * par-dessus, dans sa **propre** liste déroulante (`SelecteurBureau`), à l'unité et derrière une
 * confirmation. Cette liste-ci est donc exactement `ROLES_DE_BASE`, et le serveur le tient aussi :
 * `definirRolesEnMasse` valide le rôle reçu contre la même constante.
 *
 * **La première entrée est l'absence de choix** (valeur vide, l'écriture du vide de `ListeDeroulante`).
 * Sans elle, la liste porterait un rôle dès l'ouverture de la barre, et « Appliquer » écrirait ce rôle
 * que personne n'a choisi — sur douze personnes. Tant qu'elle est là, le bouton d'application reste
 * inerte.
 */
const ENTREES_ROLES: EntreeListe[] = [
  { valeur: "", libelle: "Choisir un rôle…" },
  { valeur: "INSTRUCTEUR", libelle: "Instructeur" },
  { valeur: "MEMBRE", libelle: "Membre" },
];

/** Le libellé d'un rôle attribuable, pour la confirmation (« Passer 2 comptes en « Membre » ? »). */
const libelleRole = (valeur: string) => ENTREES_ROLES.find((e) => e.valeur === valeur)?.libelle ?? valeur;

/**
 * Une ligne cochable de l'annuaire : son rôle (pour le geste du rôle), son accès (pour les trois
 * suivants) et le fait qu'elle ait une adresse email (pour le renvoi du lien). **Jamais l'adresse
 * elle-même** : un booléen suffit à l'écran, et quatre-vingts adresses n'ont rien à faire dans le
 * paquet du navigateur.
 */
export type LigneMembre = LigneRole & LigneGeste & LigneLien;

export function ZoneSelection({
  selectionnables,
  sansCase,
  restants,
  recherche,
  active,
  peutActiver,
  peutSupprimer,
  peutRenvoyerLien,
  periodeLienId,
  children,
}: {
  /** Les comptes affichés **sur lesquels ces gestes portent** : ni administrateur, ni portail, ni soi-même. */
  selectionnables: LigneMembre[];
  /**
   * Les lignes **affichées sans case à cocher**, par nature : il faut dire pourquoi. `soiMeme` est le
   * cas courant (on n'agit pas sur son propre compte) ; `bureau` compte les comptes du bureau que
   * l'acteur ne peut pas modifier — impossible tant que l'annuaire est réservé au bureau, prévu pour
   * le jour où `members.view` se rouvrira. Voir `texteSansCase`.
   */
  sansCase: { soiMeme: boolean; bureau: number };
  /** Combien de comptes restent sur la page suivante : ils ne sont pas dans la sélection. */
  restants: number;
  /** Une recherche est en cours : ce sont des « résultats », pas « les personnes ». */
  recherche: boolean;
  /** Faux quand l'acteur ne règle aucun rôle : la liste s'affiche alors exactement comme avant. */
  active: boolean;
  /** `members.activate` : sans elle, pas de boutons « Désactiver » / « Réactiver » — ils échoueraient. */
  peutActiver: boolean;
  /** `members.delete` : même règle pour « Supprimer ». */
  peutSupprimer: boolean;
  /**
   * `invitations.manage` **et** une période vers laquelle envoyer : sans les deux, pas de bouton
   * « Renvoyer le lien ». Ce sont exactement les conditions du bouton d'une ligne (`page.tsx`) — un
   * bouton qui échouerait à l'usage est pire qu'un bouton absent.
   */
  peutRenvoyerLien: boolean;
  /** La période dont les liens partent (la période active) : `null` quand il n'y en a aucune. */
  periodeLienId: string | null;
  children: ReactNode;
}) {
  const [selection, setSelection] = useState<ReadonlySet<string>>(() => new Set());
  /**
   * **Le rôle choisi dans la liste, tant qu'il n'est pas appliqué.**
   *
   * Il vit ici et non dans la liste déroulante : c'est le bouton d'à côté qui écrit, il doit donc
   * savoir ce qui a été choisi. `ListeDeroulante` est un contrôle **piloté** (`valeur=` / `onChoisir`),
   * et la règle de `cleValeurServeur` l'exclut explicitement des champs à remonter — il n'y a d'ailleurs
   * rien à remonter, cette valeur ne vient pas du serveur : elle naît du clic et meurt avec le lot.
   */
  const [roleChoisi, setRoleChoisi] = useState("");
  const [message, setMessage] = useState<{ type: "ok" | "erreur"; texte: string } | null>(null);
  const [enCours, demarrer] = useTransition();
  const caseMaitresse = useRef<HTMLInputElement>(null);

  const affiches = selectionnables.map((s) => s.id);
  const etatCases = etatToutCocher(selectionnables, selection);
  /**
   * **Ce que la sélection annonce**, écrit une fois et lu à deux endroits — en clair dans la barre,
   * et dans la région vivante permanente posée sous elle.
   *
   * La région `aria-live` est **séparée de la barre** : une région créée en même temps que son contenu
   * n'est pas annoncée, et c'est le premier appui — celui qui compte le plus — qui serait muet. C'est
   * le motif de sa jumelle des présences (`PresencesEquipe`), qui avait le même défaut.
   */
  const compteurAnnonce = selection.size > 0 ? `${selection.size} compte${selection.size > 1 ? "s" : ""} sélectionné${selection.size > 1 ? "s" : ""}` : "";

  // « Certaines, pas toutes » ne s'écrit pas en JSX : `indeterminate` est une propriété du nœud.
  useEffect(() => {
    if (caseMaitresse.current) caseMaitresse.current.indeterminate = etatCases === "partielle";
  }, [etatCases]);

  /**
   * **La sélection survit au changement d'affichage — comme aux présences**.
   *
   * Cet écran faisait l'inverse de sa jumelle : il rabotait la sélection sur la seule page affichée
   * (`restreindre`), si bien qu'une recherche ou un « Replier » **effaçait des cases sans un mot**.
   * Des deux comportements possibles, c'était le pire : perdre en silence sept instructeurs qu'on
   * vient de cocher. La règle retenue est donc celle des présences — la sélection survit, et ce qui
   * reste hors de l'affichage est **compté et dit** (`CLAUDE.md`).
   *
   * **La différence entre les deux écrans est réelle et tient ici** : aux présences, tous les invités
   * sont dans la page ; ici la coupe est une vraie requête, et une case cochée sur la page précédente
   * désignerait quelqu'un dont l'écran ne sait plus ni le nom, ni le rôle, ni combien de réponses de
   * présence une suppression lui coûterait. D'où cette mémoire des lignes déjà vues
   * (`memoriserLignes`) : le lot **et sa confirmation** se composent sur elle, pas sur la seule page
   * affichée, sinon les cases d'hier tomberaient en silence — le défaut qu'on répare.
   *
   * Une ref et non un état : elle ne déclenche aucun rendu, elle ne fait que survivre aux suivants.
   * Qui a vraiment quitté l'annuaire est compté et dit par le serveur (« introuvables », voir
   * `actions.ts`), pas deviné ici.
   */
  const connues = useRef<ReadonlyMap<string, LigneMembre>>(new Map());
  useEffect(() => {
    connues.current = memoriserLignes(connues.current, selectionnables);
  }, [selectionnables]);

  useEffect(() => {
    if (message?.type !== "ok") return;
    const t = setTimeout(() => setMessage(null), 6000);
    return () => clearTimeout(t);
  }, [message]);

  if (!active) return <>{children}</>;

  /**
   * **Tout ce qui est coché**, et pas seulement la page sous les yeux : une case cochée sur la page
   * précédente part avec le lot, et la confirmation la compte. L'ordre est celui des pages affichées,
   * jamais celui des clics (voir `lignesSelectionnees`).
   */
  const lotCoche = () => lignesSelectionnees([...connues.current.values()], selection);

  /**
   * **Le retour d'un lot, traité une seule fois pour les quatre gestes.**
   *
   * Un `catch` qui avale tout dirait « vérifie ta connexion » là où le serveur vient simplement de
   * **redemander le code 2FA** : `exigerReauth` redirige, et une redirection lève ici comme une
   * erreur. On la laisse passer, le routeur s'en occupe — même précaution que `BoutonAction`.
   */
  const terminer = (res: { succes?: string; erreur?: string }) => {
    if (res.erreur) {
      setMessage({ type: "erreur", texte: res.erreur });
      return;
    }
    setMessage({ type: "ok", texte: res.succes ?? "" });
    /*
     * **Le focus rentre à la case maîtresse avant que les boutons ne redeviennent actifs.** Ils sont
     * `disabled` le temps de l'écriture : le focus retombait sur `<body>`, si bien que la tabulation
     * suivante repartait du premier lien de la page — à quatre-vingts lignes de l'annuaire qu'on était
     * en train de traiter. La case maîtresse est l'ancre stable de l'écran, et l'endroit d'où l'on
     * repart pour composer le prochain lot.
     */
    caseMaitresse.current?.focus();
    // La liste revient du serveur à jour : garder les cases cochées laisserait croire qu'il reste
    // quelque chose à faire — et, après une suppression, désignerait des comptes qui n'existent plus.
    setSelection(new Set());
  };

  const panne = (e: unknown, sujet: string) => {
    const texte = e instanceof Error ? e.message : "";
    // Une action qui redirige (code 2FA redemandé) lève ici aussi : rien à dire à l'écran, le routeur
    // emmène vers `/connexion/verifier`. La confondre avec une panne de réseau ferait croire que le
    // geste a échoué alors qu'il attend une preuve.
    if (texte.includes("NEXT_REDIRECT")) return;
    setMessage({ type: "erreur", texte: `${sujet} n'a pas abouti — vérifie ta connexion.` });
  };

  /**
   * **Choisir, puis valider — et surtout pas appliquer au choix**.
   *
   * C'étaient deux boutons, donc un geste par rôle ; c'est maintenant une liste déroulante, donc deux
   * gestes. La tentation est d'écrire dès le `change` pour retrouver le clic unique : ce serait le pire
   * des deux mondes. Un rôle effleuré à la molette, ou choisi avant de relire qui est coché, écrirait
   * sur douze personnes — et un rôle changé par mégarde sur douze personnes ne se rattrape pas ligne
   * par ligne. La liste **choisit**, le bouton **écrit**, et la confirmation reste entre les deux.
   *
   * C'est aussi la différence assumée avec la liste déroulante d'une ligne (`SelecteurRole`), qui
   * enregistre au choix : elle porte sur **une** personne, nommée, sous les yeux.
   */
  const appliquerRole = () => {
    const lignes = lotCoche();
    if (lignes.length === 0 || roleChoisi === "") return;
    // La confirmation dit **ce qui sera écrit** : combien changent, combien ne bougeront pas.
    if (!window.confirm(texteConfirmationRoles(resumeRoles(lignes, roleChoisi), libelleRole(roleChoisi)))) return;
    demarrer(async () => {
      try {
        const res: ResultatRolesEnMasse = await definirRolesEnMasse({ role: roleChoisi, userIds: lignes.map((l) => l.id) });
        terminer(res);
      } catch (e) {
        panne(e, "Le changement de rôle");
      }
    });
  };

  /**
   * **Renvoyer leur lien personnel — le seul geste de cette barre qui part vers les gens.**
   *
   * Deux précautions qui n'existent pour aucun des quatre autres :
   *
   * - **la confirmation annonce le nombre d'emails**, pas le nombre de cases cochées : les deux
   *   diffèrent dès qu'une personne du lot n'a pas d'adresse, et c'est le premier chiffre qu'on ne
   *   rattrape pas une fois parti ;
   * - **quand aucun email ne peut partir, on ne demande rien** — ni à la personne (une fenêtre
   *   « Envoyer 0 email ? » est un piège), ni au serveur (qui redemanderait un code 2FA pour un envoi
   *   à blanc). L'écran dit ce qui manque, nom par nom, et rien ne bouge.
   */
  const appliquerLiens = () => {
    const lignes = lotCoche();
    if (lignes.length === 0 || !periodeLienId) return;
    const resume = resumeLiens(lignes);
    if (resume.emails === 0) {
      setMessage({ type: "erreur", texte: texteRienAEnvoyer(resume) });
      return;
    }
    if (!window.confirm(texteConfirmationLiens(resume))) return;
    demarrer(async () => {
      try {
        const res: ResultatLiensEnMasse = await renvoyerLiensEnMasse({ periodId: periodeLienId, userIds: lignes.map((l) => l.id) });
        terminer(res);
      } catch (e) {
        panne(e, "L'envoi des liens");
      }
    });
  };

  const appliquerGeste = (geste: GesteMasse) => {
    const lignes = lotCoche();
    if (lignes.length === 0) return;
    // La confirmation annonce **ce qui sera écrasé** : ceux qui portent déjà la valeur visée à part, et
    // pour une suppression les réponses de présence perdues, personne par personne.
    if (!window.confirm(texteConfirmationGeste(resumeGeste(lignes, geste), geste))) return;
    demarrer(async () => {
      try {
        const res: ResultatGesteEnMasse = await appliquerGesteEnMasse({ geste, userIds: lignes.map((l) => l.id) });
        terminer(res);
      } catch (e) {
        panne(e, SUJETS_GESTES[geste]);
      }
    });
  };

  /**
   * **Ce qui reste dehors, compté et dit.**
   *
   * `texteHorsPage` affirme « ils ne sont pas sélectionnés » **sans regarder la sélection** : c'était
   * vrai par accident, tant que l'écran rabotait la sélection sur la page affichée. Maintenant qu'elle
   * survit, la phrase ne tient plus dès qu'une case est cochée — on la garde donc pour ce qu'elle dit
   * bien (la page suivante existe et n'est pas dans le lot), c'est-à-dire tant que rien n'est coché, et
   * la phrase partagée avec les présences prend le relais ensuite en comptant **ce que le lot emporte
   * hors de l'écran**.
   */
  const horsAffichage = texteHorsAffichage(compterHorsAffichage(selection, selectionnables), MOTS_COMPTES);
  const horsPage = texteHorsPage(restants, selection.size) ?? horsAffichage;
  const texteCasesAbsentes = texteSansCase(sansCase);
  /**
   * **La barre n'existe qu'avec une sélection**, et c'est la fonction partagée avec les présences
   * qui le dit : les deux écrans de masse doivent apparaître au même moment, et une condition
   * recopiée de chaque côté aurait deux endroits où diverger.
   */
  const montrerBarre = barreDeMasseVisible(selection);
  /** Les boutons ne restent inertes que le temps d'une écriture : sans sélection, la barre n'est plus là. */
  const bloque = enCours;
  /** Les trois gestes d'accès, dans l'ordre du moins au plus définitif — et chacun derrière sa permission. */
  const GESTES: { geste: GesteMasse; variante: "secondaire" | "succes" | "danger"; visible: boolean }[] = [
    { geste: "desactiver", variante: "secondaire", visible: peutActiver },
    { geste: "reactiver", variante: "succes", visible: peutActiver },
    { geste: "supprimer", variante: "danger", visible: peutSupprimer },
  ];

  return (
    <Selection.Provider value={{ selection, basculer: (id) => setSelection((s) => basculer(s, id)) }}>
      <div className="mt-4 flex flex-col gap-1">
        {/* 48 px et une case de 24 px, comme la case maîtresse des présences : les deux écrans
            portent le même geste, ils ne peuvent pas avoir deux cibles différentes. */}
        <label className="inline-flex min-h-12 w-fit cursor-pointer items-center gap-2 font-semibold">
          <input
            ref={caseMaitresse}
            type="checkbox"
            checked={etatCases === "toutes"}
            disabled={selectionnables.length === 0}
            onChange={() => setSelection((s) => (etatCases === "toutes" ? retirer(s, affiches) : ajouter(s, affiches)))}
            className="size-6 accent-primaire"
          />
          {/* Le libellé **nomme ce sur quoi la case agit** — « les 12 résultats », « les 50 lignes
              affichées » —, jamais « Tout » : voir `libelleToutSelectionner`. */}
          {libelleToutSelectionner(selectionnables.length, { recherche, replie: restants > 0 })}
        </label>
        {(horsPage || texteCasesAbsentes) && <p className="text-base text-texte-secondaire">{[horsPage, texteCasesAbsentes].filter(Boolean).join(" ")}</p>}
        {/* **Ce que les cases permettent, dit en une ligne à côté d'elles**. La barre ne se monte
            plus tant que rien n'est coché (« n'affiche cette section que si des users sont
            sélectionnés ») : la phrase qui nommait le geste d'entrée descend donc ici, là où l'œil
            est déjà, plutôt que de disparaître avec la barre. Elle s'efface dès qu'une case est
            cochée — le geste est fait, la barre a pris le relais. Même forme qu'aux présences
            (`texteInviteMasse`). */}
        {!montrerBarre && <p className="text-base text-texte-secondaire">{INVITE_SELECTION}</p>}
      </div>

      {/* **La barre n'existe qu'avec une sélection**. C'est l'inverse de la veille, qui la montait
          toujours, grisée, avec la phrase qui dit quoi faire — et ce qu'elle résolvait ne disparaît
          pas pour autant : la phrase vit maintenant sous la case maîtresse (`INVITE_SELECTION`), en
          une ligne. La condition est partagée avec les présences (`barreDeMasseVisible`).

          **Collante à partir de 640 px seulement** : sur un écran de 390 px, cette barre fait
          **~350 px de haut** — compteur, liste de rôle et son bouton, trois gestes d'accès, renvoi
          de lien, chacun sur sa ligne. Collante, elle **recouvre la moitié haute de la liste**, et
          comme la bande couverte suit le défilement, une ligne qui passe dessous ne peut plus être
          cochée du tout. Mesure : la case d'un compte, amenée au milieu d'un écran de 844 px (y =
          410), avait un bouton de la barre à son point de clic. C'est la campagne de captures qui
          l'a trouvé — soixante secondes d'essais sur un clic impossible. En dessous de 640 px, elle
          reste donc **dans le flux** : elle se lit au-dessus de la liste, et on y revient en
          remontant. Au-dessus, la place existe (trois colonnes, ~150 px) et le collant reprend tout
          son sens.

          **Et elle se cale sous l'en-tête de l'application** : elle se cale sous l'en-tête de
          l'application, à l'opposé de la barre d'onglets du bas du téléphone. Elle n'a donc pas le
          défaut qu'avait celle des présences, qui recouvrait le menu — rien à décaler ici.

          Les boutons ne sont `disabled` que le temps d'une écriture : sans sélection, il n'y a plus
          de barre du tout. */}
      {montrerBarre && (
        <div
          role="group"
          /* Le nom dit ce que la barre fait, pas ce qu'elle regarde : elle n'apparaît qu'avec une
             sélection, mais « les comptes sélectionnés » n'apprendrait rien de plus que le compteur
             qu'elle porte déjà en clair. Même nom que la barre des présences. */
          aria-label="Agir sur plusieurs comptes à la fois"
          className="relative z-[2] mt-2 flex flex-col gap-2 rounded-xl border-2 border-primaire bg-surface px-3 py-2 shadow-carte sm:sticky sm:top-20"
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {/* Sans `aria-live` : l'annonce est portée par la région permanente posée plus bas, sans
                quoi la même phrase serait dite deux fois. */}
            <span className="font-semibold">{compteurAnnonce}</span>
            <Bouton variante="discret" taille="petite" disabled={enCours} onClick={() => setSelection(new Set())} className="ml-auto">
              <Icone nom="croix" taille={16} />
              Annuler la sélection
            </Bouton>
          </div>

          {/* **Le rôle : une liste déroulante et un bouton**. C'étaient deux boutons — un clic, un
              rôle. Une liste demande deux gestes, et c'est précisément pour cela qu'elle ne
              s'applique **pas** au choix : voir `appliquerRole`. Le composant est celui du dépôt
              (`ListeDeroulante`) et non un `<select>` nu — il s'ouvre toujours vers le bas, y
              compris au pied d'une liste de cinquante lignes. */}
          <div className="flex flex-wrap items-center gap-2">
            <label id="role-en-masse-libelle" htmlFor="role-en-masse" className="text-base text-texte-secondaire">
              Changer le rôle en :
            </label>
            <ListeDeroulante
              id="role-en-masse"
              libelleId="role-en-masse-libelle"
              libelle="Changer le rôle en"
              valeur={roleChoisi}
              entrees={ENTREES_ROLES}
              onChoisir={setRoleChoisi}
              className="min-h-12 flex-1 basis-40 rounded-xl border-2 border-bordure/70 bg-surface px-3 text-base font-semibold text-texte shadow-carte"
            />
            {/* Inerte tant qu'aucun rôle n'est choisi : « Appliquer » sans objet écrirait un rôle que
                personne n'a désigné, sur tout le lot. */}
            <Bouton variante="secondaire" taille="petite" disabled={bloque || roleChoisi === ""} className="flex-1 basis-32" onClick={appliquerRole}>
              Appliquer le rôle
            </Bouton>
          </div>

          {GESTES.some((g) => g.visible) && (
            <div className="flex flex-wrap items-center gap-2">
              {/* « Leur accès » plutôt qu'« Actions » : le mot dit ce que les trois boutons touchent —
                  et la suppression, qui emporte l'accès avec le reste, est au bout de la même ligne. */}
              <span className="text-base text-texte-secondaire">Agir sur leur accès :</span>
              {GESTES.filter((g) => g.visible).map(({ geste, variante }) => (
                <Bouton key={geste} variante={variante} taille="petite" disabled={bloque} className="flex-1 basis-32" onClick={() => appliquerGeste(geste)}>
                  {/* « Supprimer » tout seul ne disait pas ce qu'il détruit (`libelleGeste`), et le
                      libellé s'accorde avec le lot : jamais « l'utilisateur » devant douze cases. */}
                  {libelleGeste(geste, selection.size)}
                </Bouton>
              ))}
            </div>
          )}

          {/* **Le seul geste de cette barre qui part vers les gens.** Il est sur sa propre ligne et non
              dans « leur accès » : renvoyer un lien ne coupe ni ne rend un accès, il expédie un email à
              chaque personne cochée. Le bouton porte le même mot que celui d'une ligne (« Renvoyer le
              lien »), parce que c'est le même geste — et ses verrous sont les mêmes, code 2FA compris. */}
          {peutRenvoyerLien && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-base text-texte-secondaire">Leur lien personnel :</span>
              <Bouton variante="secondaire" taille="petite" disabled={bloque} className="flex-1 basis-32" onClick={appliquerLiens}>
                Renvoyer le lien
              </Bouton>
            </div>
          )}
        </div>
      )}

      {/* La phrase « hors affichage » est annoncée avec le compteur, comme aux présences : une
          sélection dont une partie n'est plus à l'écran est précisément ce qu'un lecteur d'écran ne
          peut pas deviner. */}
      <p className="sr-only" aria-live="polite">
        {[compteurAnnonce, horsAffichage].filter(Boolean).join(" ")}
      </p>

      <p className="min-h-6 text-base" aria-live="polite">
        {message ? <span className={message.type === "ok" ? "font-semibold text-vert" : "font-semibold text-rouge"}>{message.texte}</span> : null}
      </p>

      {children}
    </Selection.Provider>
  );
}

/**
 * La case d'une ligne. Elle ne se rend que si une `ZoneSelection` l'entoure : là où l'acteur n'a
 * aucun de ces gestes, il n'y a pas de fournisseur, et la ligne retrouve exactement son allure.
 */
export function CaseMembre({ id, nom }: { id: string; nom: string }) {
  const contexte = useContext(Selection);
  if (!contexte) return null;
  /*
   * **La cible faisait 20 × 44 px**. Le libellé était `inline-flex min-h-11` et ne contenait qu'un
   * texte `sr-only` et une case de 20 px : il n'était donc large que de sa case — une bande de 20
   * px, à 12 px du lien qui ouvre la fiche du membre. Rater la case de trois millimètres n'était
   * pas anodin : cela **ouvrait la fiche**, donc quittait l'écran, donc perdait la sélection en
   * cours — sept instructeurs cochés à refaire. Et l'écran est fait pour des gens dont une partie
   * est très peu à l'aise avec l'informatique.
   *
   * `min-h-12 min-w-12` donne le carré de 48 px du cahier des charges, `justify-center` centre la
   * case dedans (sans quoi la zone gagnée serait à droite du doigt), et `size-6` rend la case
   * elle-même visible — c'est la même que la case maîtresse et que celles des présences.
   */
  return (
    <label className="inline-flex min-h-12 min-w-12 shrink-0 cursor-pointer items-center justify-center">
      <span className="sr-only">Sélectionner {nom}</span>
      <input type="checkbox" checked={contexte.selection.has(id)} onChange={() => contexte.basculer(id)} className="size-6 accent-primaire" />
    </label>
  );
}
