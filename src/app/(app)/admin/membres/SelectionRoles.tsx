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
import { selectionApresInterrupteur } from "@/components/ui/selection";
import { InterrupteurSelection } from "@/components/ui/InterrupteurSelection";
import { BarreSelection, BoutonQueFaire } from "@/components/ui/BarreSelection";
import { GestesVolet } from "@/components/ui/GestesVolet";
import { VoletBas } from "@/components/ui/VoletBas";
import { ZoneCochable } from "@/components/ui/ZoneCochable";
import { questionSelection } from "@/components/ui/barre-selection";
import { useEcranTelephone } from "@/components/ui/useEcranTelephone";
import {
  appliquerGesteEnMasse,
  definirRolesEnMasse,
  envoyerInvitationsEnMasse,
  reinitialiserAccesEnMasse,
  renvoyerLiensEnMasse,
  revoquerLiensEnMasse,
  type ResultatGesteEnMasse,
  type ResultatLiensEnMasse,
  type ResultatRolesEnMasse,
} from "./actions";
import { resumeRoles, texteConfirmationRoles, texteHorsPage, texteSansCase, type LigneRole } from "./selection-roles";
import { INVITE_SELECTION, resumeGeste, texteConfirmationGeste, type GesteMasse, type LigneGeste } from "./selection-gestes";
import {
  expliquerGeste,
  gesteRetenu,
  gestesApplicables,
  libelleBouton,
  libelleBoutonVolet,
  varianteBouton,
  type GesteSelection,
} from "./choix-geste";
import { ChoixGeste } from "@/components/ui/ChoixGeste";
import {
  resumeInvitations,
  resumeLiens,
  resumeReinitialisation,
  resumeRevocation,
  texteConfirmationInvitations,
  texteConfirmationLiens,
  texteConfirmationReinitialisation,
  texteConfirmationRevocation,
  texteRienAEnvoyer,
  texteRienAInviter,
  texteRienAReinitialiser,
  texteRienARevoquer,
  type LigneAcces,
  type LigneLien,
  type LigneRevocation,
} from "./selection-liens";

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
 * **Un seul champ, une explication, un seul bouton.** La barre alignait tous ces gestes côte à côte,
 * quelle que soit la sélection — « Réactiver » en vert devant des comptes actifs, « Envoyer
 * l'invitation » devant des gens déjà entrés, trois boutons rouges dont un seul effaçait. Elle pose
 * maintenant une question, « Que veux-tu faire ? », dont la liste ne propose **que les gestes qui
 * feraient quelque chose** à la sélection, chacun avec le nombre de personnes touchées ; le geste choisi
 * est **expliqué** (à qui, qui reste de côté, emails, effacement) ; et un seul bouton dit le verbe et le
 * nombre. Seule la suppression est en rouge. Toute la logique est pure, dans `choix-geste.ts`.
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

type Contexte = { actif: boolean; selection: ReadonlySet<string>; basculer: (id: string) => void };

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
 * laisse la place aux autres gestes, mais elle change la nature du geste : un bouton, c'était un
 * clic ; une liste, c'est **choisir puis valider**. Voir `appliquerRole` — le rôle n'est pas appliqué au
 * choix.
 *
 * **« Administrateur » n'y figure pas, et ce n'est pas un oubli** : ce n'est plus un rôle. Tout le
 * monde porte un **rôle de base** — membre ou instructeur (`ROLES_DE_BASE`) — et le bureau s'ajoute
 * par-dessus, et il se donne et se retire dans « Comptes admin », jamais depuis l'annuaire.
 * Cette liste-ci est donc exactement `ROLES_DE_BASE`, et le serveur le tient aussi :
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
export type LigneMembre = LigneRole & LigneGeste & LigneLien & LigneRevocation & LigneAcces;

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
   * **L'interrupteur « Sélection multiple »** (`InterrupteurSelection`, commun aux écrans de masse).
   * L'annuaire se consulte bien plus souvent qu'il ne se traite par lots : éteint, chaque ligne
   * retrouve son allure sans case, et la case maîtresse disparaît. L'éteindre vide le lot.
   */
  const [interrupteur, setInterrupteur] = useState(false);
  /**
   * **Le rôle choisi dans la liste, tant qu'il n'est pas appliqué.**
   *
   * Il vit ici et non dans la liste déroulante : c'est le bouton d'à côté qui écrit, il doit donc
   * savoir ce qui a été choisi. `ListeDeroulante` est un contrôle **piloté** (`valeur=` / `onChoisir`),
   * et la règle de `cleValeurServeur` l'exclut explicitement des champs à remonter — il n'y a d'ailleurs
   * rien à remonter, cette valeur ne vient pas du serveur : elle naît du clic et meurt avec le lot.
   */
  const [roleChoisi, setRoleChoisi] = useState("");
  /**
   * **Le geste choisi dans « Que veux-tu faire ? »**, tant qu'il n'est pas lancé. Même règle que le
   * rôle : la liste **choisit**, le bouton **écrit** — un geste effleuré n'agit sur personne.
   */
  const [gesteChoisi, setGesteChoisi] = useState<GesteSelection | "">("");
  const [message, setMessage] = useState<{ type: "ok" | "erreur"; texte: string } | null>(null);
  const [enCours, demarrer] = useTransition();
  const caseMaitresse = useRef<HTMLInputElement>(null);
  /** En version téléphone : la barre sombre du bas et le volet des gestes (`BarreSelection`, `VoletBas`). */
  const telephone = useEcranTelephone();
  const [voletOuvert, setVoletOuvert] = useState(false);

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
  /**
   * La mémoire **telle qu'elle sera après ce rendu** : la page qui vient d'arriver du serveur compte
   * déjà, sans attendre l'effet ci-dessus. Les gestes proposés se calculent dessus — une ligne
   * réactivée à l'instant ne doit plus proposer « Réactiver ».
   */
  const memoire = memoriserLignes(connues.current, selectionnables);
  /**
   * **Tout ce qui est coché**, et pas seulement la page sous les yeux : une case cochée sur la page
   * précédente part avec le lot, et l'explication la compte. L'ordre est celui des pages affichées,
   * jamais celui des clics (voir `lignesSelectionnees`).
   */
  const lotCoche = () => lignesSelectionnees([...memoire.values()], selection);
  const lot = lotCoche();
  const applicables = gestesApplicables(lot, {
    liens: peutRenvoyerLien && periodeLienId !== null,
    activer: peutActiver,
    supprimer: peutSupprimer,
  });
  /**
   * **Un geste qui ne s'applique plus revient à « Choisir une action… »** : une case décochée peut
   * retirer la dernière personne qu'il touchait. Le rendu le lit tout de suite (`geste`), et l'état
   * suit, pour qu'il ne réapparaisse pas tout seul si la case est recochée.
   */
  const geste = gesteRetenu(gesteChoisi, applicables);
  useEffect(() => {
    if (geste !== gesteChoisi) setGesteChoisi("");
  }, [geste, gesteChoisi]);

  if (!active) return <>{children}</>;

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
    /*
     * **Le message reste, le choix repart à zéro.** Le résultat ne s'efface plus tout seul : c'est la
     * seule trace du geste une fois la barre repliée, et il a sa place sous elle. Le choix, lui,
     * revient à « Choisir une action… » — le geste suivant se choisit, il ne se rejoue pas.
     */
    setMessage({ type: "ok", texte: res.succes ?? "" });
    setGesteChoisi("");
    setRoleChoisi("");
    setVoletOuvert(false);
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

  /**
   * **Révoquer leur lien** : le contraire du renvoi, sur la même ligne de la barre. Même précaution
   * que le renvoi — le chiffre annoncé est celui des liens qui meurent, pas celui des cases, et
   * quand personne n'a de lien en cours on ne demande rien (ni à la personne, ni un code au serveur).
   */
  const appliquerRevocation = () => {
    const lignes = lotCoche();
    if (lignes.length === 0 || !periodeLienId) return;
    const resume = resumeRevocation(lignes);
    if (resume.liens === 0) {
      setMessage({ type: "erreur", texte: texteRienARevoquer(resume) });
      return;
    }
    if (!window.confirm(texteConfirmationRevocation(resume))) return;
    demarrer(async () => {
      try {
        terminer(await revoquerLiensEnMasse({ periodId: periodeLienId, userIds: lignes.map((l) => l.id) }));
      } catch (e) {
        panne(e, "La révocation des liens");
      }
    });
  };

  /**
   * **Envoyer l'invitation** aux cochés qui ne sont jamais entrés, et **réinitialiser les accès** de
   * ceux qui le sont : deux gestes qui se partagent la sélection selon `aDejaUnAcces`. Chacun saute
   * l'autre moitié et la compte ; quand il ne reste personne, on ne demande rien (ni confirmation, ni
   * code au serveur).
   */
  const appliquerInvitations = () => {
    const lignes = lotCoche();
    if (lignes.length === 0 || !periodeLienId) return;
    const resume = resumeInvitations(lignes);
    if (resume.emails === 0) {
      setMessage({ type: "erreur", texte: texteRienAInviter(resume) });
      return;
    }
    if (!window.confirm(texteConfirmationInvitations(resume))) return;
    demarrer(async () => {
      try {
        terminer(await envoyerInvitationsEnMasse({ periodId: periodeLienId, userIds: lignes.map((l) => l.id) }));
      } catch (e) {
        panne(e, "L'envoi des invitations");
      }
    });
  };

  const appliquerReinitialisation = () => {
    const lignes = lotCoche();
    if (lignes.length === 0) return;
    const resume = resumeReinitialisation(lignes);
    if (resume.total === 0) {
      setMessage({ type: "erreur", texte: texteRienAReinitialiser(resume) });
      return;
    }
    if (!window.confirm(texteConfirmationReinitialisation(resume))) return;
    demarrer(async () => {
      try {
        terminer(await reinitialiserAccesEnMasse({ userIds: lignes.map((l) => l.id) }));
      } catch (e) {
        panne(e, "La réinitialisation des accès");
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
   * **L'unique bouton de la barre** : il lance le geste choisi, avec **la confirmation qu'il avait
   * déjà**. L'explication dit tout avant l'appui, mais chacun de ces gestes porte sur plusieurs
   * personnes à la fois, et la fenêtre de confirmation est le dernier endroit où l'on relit un nombre
   * avant qu'il parte — on ne la retire pas en simplifiant l'écran.
   */
  const lancer = () => {
    switch (geste) {
      case "inviter":
        return appliquerInvitations();
      case "renvoyer":
        return appliquerLiens();
      case "revoquer":
        return appliquerRevocation();
      case "reinitialiser":
        return appliquerReinitialisation();
      case "desactiver":
      case "reactiver":
      case "supprimer":
        return appliquerGeste(geste);
      case "role":
        return appliquerRole();
    }
  };
  /** Le rôle visé, et combien changent vraiment : le bouton du rôle dit ce nombre-là. */
  const resumeRole = geste === "role" && roleChoisi !== "" ? resumeRoles(lot, roleChoisi) : null;
  const applicable = applicables.find((g) => g.geste === geste);
  const libelleDuBouton =
    geste === "" || !applicable
      ? "Appliquer"
      : libelleBouton(geste, applicable.nombre, resumeRole ? { libelle: libelleRole(roleChoisi), changent: resumeRole.changent } : undefined);
  /** Inerte sans geste, sans rôle choisi, ou quand le rôle choisi ne changerait personne. */
  const boutonInerte = geste === "" || (geste === "role" && (resumeRole === null || resumeRole.changent === 0));
  const explication = geste === "" ? null : expliquerGeste(geste, lot, geste === "role" ? { valeur: roleChoisi, libelle: libelleRole(roleChoisi) } : undefined);

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
  const montrerBarre = interrupteur && barreDeMasseVisible(selection);

  return (
    <Selection.Provider value={{ actif: interrupteur, selection, basculer: (id) => setSelection((s) => basculer(s, id)) }}>
      <div className="mt-4 flex flex-col gap-1">
        <InterrupteurSelection
          actif={interrupteur}
          disabled={selectionnables.length === 0 && selection.size === 0}
          onChange={(suite) => {
            setInterrupteur(suite);
            setSelection((s) => selectionApresInterrupteur(s, suite));
            setGesteChoisi("");
            setRoleChoisi("");
            setMessage(null);
          }}
        />
        {interrupteur && (
          <>
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
          </>
        )}
      </div>

      {/* **La barre n'existe qu'avec une sélection**. C'est l'inverse de la veille, qui la montait
          toujours, grisée, avec la phrase qui dit quoi faire — et ce qu'elle résolvait ne disparaît
          pas pour autant : la phrase vit maintenant sous la case maîtresse (`INVITE_SELECTION`), en
          une ligne. La condition est partagée avec les présences (`barreDeMasseVisible`).

          **Collante à partir de 640 px seulement** : sur un écran de 390 px, la barre faisait
          **~350 px de haut** quand elle alignait tous ses boutons, et l'explication du geste choisi
          lui rend aujourd'hui une hauteur du même ordre. Collante, elle **recouvre la moitié haute de la liste**, et
          comme la bande couverte suit le défilement, une ligne qui passe dessous ne peut plus être
          cochée du tout. Mesure : la case d'un compte, amenée au milieu d'un écran de 844 px (y =
          410), avait un bouton de la barre à son point de clic. C'est la campagne de captures qui
          l'a trouvé — soixante secondes d'essais sur un clic impossible. En dessous de 640 px, elle
          reste donc **dans le flux** : elle se lit au-dessus de la liste, et on y revient en
          remontant. Au-dessus, la place existe et le collant reprend tout son sens.

          **Et elle se cale sous l'en-tête de l'application** : elle se cale sous l'en-tête de
          l'application, à l'opposé de la barre d'onglets du bas du téléphone. Elle n'a donc pas le
          défaut qu'avait celle des présences, qui recouvrait le menu — rien à décaler ici.

          Le bouton est `disabled` tant qu'aucun geste n'est choisi et le temps d'une écriture : sans
          sélection, il n'y a plus de barre du tout. */}
      {montrerBarre && !telephone && (
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

          {/* **Une question, et une seule liste** — la forme commune de l'administration
              (`ChoixGeste`). Elle ne propose que les gestes qui feraient quelque chose à la
              sélection, chacun avec son nombre de personnes (`choix-geste.ts`) ; un geste à zéro n'y
              figure pas. Le bouton est plein, rouge avec l'alerte pour ce qui enlève quelque chose
              — révoquer, réinitialiser, supprimer (`gesteRouge`). */}
          <ChoixGeste
            id="geste-en-masse"
            gestes={applicables}
            valeur={geste}
            onChoisir={(v) => {
              setGesteChoisi(gesteRetenu(v as GesteSelection | "", applicables));
              setRoleChoisi("");
              setMessage(null);
            }}
            explication={explication}
            bouton={libelleDuBouton}
            variante={varianteBouton(geste)}
            inerte={boutonInerte}
            enCours={enCours}
            onLancer={lancer}
          >
            {/* **Le rôle ne se montre que s'il est demandé.** C'est toujours « choisir, puis valider » :
                la liste n'écrit rien au choix (voir `appliquerRole`), et elle ouvre sur « Choisir un
                rôle… » pour que le bouton reste inerte tant que personne n'a désigné de rôle. */}
            {geste === "role" && (
              <div className="flex flex-col gap-1">
                <label id="role-en-masse-libelle" htmlFor="role-en-masse" className="text-base font-semibold">
                  Nouveau rôle
                </label>
                <ListeDeroulante
                  id="role-en-masse"
                  libelleId="role-en-masse-libelle"
                  libelle="Nouveau rôle"
                  valeur={roleChoisi}
                  entrees={ENTREES_ROLES}
                  onChoisir={setRoleChoisi}
                  className="min-h-12 w-full rounded-xl border-2 border-bordure/70 bg-surface px-3 text-base font-semibold text-texte shadow-carte"
                />
              </div>
            )}
          </ChoixGeste>
        </div>
      )}

      {/* La phrase « hors affichage » est annoncée avec le compteur, comme aux présences : une
          sélection dont une partie n'est plus à l'écran est précisément ce qu'un lecteur d'écran ne
          peut pas deviner. */}
      <p className="sr-only" aria-live="polite">
        {[compteurAnnonce, horsAffichage].filter(Boolean).join(" ")}
      </p>

      {/* Vide, la région ne réserve aucune hauteur (`empty:`) : ses 24 px laissaient une bande blanche
          entre « Sélection multiple » et la liste. Elle reste montée, donc annoncée. */}
      <p className="min-h-6 text-base empty:min-h-0" aria-live="polite">
        {message ? <span className={message.type === "ok" ? "font-semibold text-vert" : "font-semibold text-rouge"}>{message.texte}</span> : null}
      </p>

      {/* **Au téléphone, la barre sombre du bas et le volet des gestes** : mêmes gestes, mêmes
          confirmations (`lancer`) ; le rôle s'y choisit en deux boutons plutôt qu'en liste. */}
      {montrerBarre && telephone && (
        <BarreSelection
          nom="Agir sur plusieurs comptes à la fois"
          n={selection.size}
          mots={MOTS_COMPTES}
          affichees={selectionnables.length}
          toutesCochees={etatCases === "toutes"}
          libelleCocherAffichees={libelleToutSelectionner(selectionnables.length, { recherche, replie: restants > 0 })}
          onCocherAffichees={() => setSelection((s) => ajouter(s, affiches))}
          onVider={() => setSelection(new Set())}
          horsAffichage={horsAffichage}
          enCours={enCours}
        >
          <BoutonQueFaire
            libelle={questionSelection(selection.size, MOTS_COMPTES)}
            onClick={() => {
              setGesteChoisi("");
              setRoleChoisi("");
              setMessage(null);
              setVoletOuvert(true);
            }}
          />
        </BarreSelection>
      )}
      <VoletBas ouvert={telephone && montrerBarre && voletOuvert} titre={questionSelection(selection.size, MOTS_COMPTES)} onFermer={() => setVoletOuvert(false)}>
        <GestesVolet
          gestes={applicables}
          valeur={geste}
          onChoisir={(v) => {
            setGesteChoisi(gesteRetenu(v, applicables));
            setRoleChoisi("");
            setMessage(null);
          }}
          rouge={(g) => varianteBouton(g) === "danger"}
          explication={explication}
          bouton={geste === "" || !applicable ? "Appliquer" : libelleBoutonVolet(geste, applicable.nombre, lot, resumeRole ? { libelle: libelleRole(roleChoisi), changent: resumeRole.changent } : undefined)}
          variante={varianteBouton(geste)}
          inerte={boutonInerte}
          enCours={enCours}
          onLancer={lancer}
          message={message}
          note={texteCasesAbsentes ? <p className="text-base text-texte-secondaire">{texteCasesAbsentes}</p> : null}
        >
          {/* Le rôle en deux boutons : un appui choisit, le bouton du bas écrit — jamais au choix. */}
          {geste === "role" && (
            <div role="group" aria-labelledby="role-telephone-libelle" className="flex flex-col gap-1">
              <p id="role-telephone-libelle" className="text-base font-semibold">
                Nouveau rôle
              </p>
              <div className="grid grid-cols-2 gap-2">
                {ENTREES_ROLES.filter((e) => e.valeur !== "").map((e) => {
                  const choisi = roleChoisi === e.valeur;
                  return (
                    <button
                      key={e.valeur}
                      type="button"
                      aria-pressed={choisi}
                      onClick={() => setRoleChoisi(choisi ? "" : e.valeur)}
                      className={`inline-flex min-h-12 items-center justify-center gap-1.5 rounded-xl border-2 px-3 text-base font-semibold transition active:scale-[0.98] ${
                        choisi ? "border-primaire bg-primaire text-primaire-texte" : "border-bordure/70 bg-surface text-texte"
                      }`}
                    >
                      {choisi && <Icone nom="check" taille={18} />}
                      {e.libelle}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </GestesVolet>
      </VoletBas>

      {/* Au téléphone, toucher une ligne la coche (`ZoneCochable`) : le nom reste le lien de la fiche. */}
      <ZoneCochable actif={telephone && interrupteur}>{children}</ZoneCochable>
    </Selection.Provider>
  );
}

/**
 * La case d'une ligne. Elle ne se rend que si une `ZoneSelection` l'entoure : là où l'acteur n'a
 * aucun de ces gestes, il n'y a pas de fournisseur, et la ligne retrouve exactement son allure.
 */
export function CaseMembre({ id, nom }: { id: string; nom: string }) {
  const contexte = useContext(Selection);
  // Interrupteur éteint : la ligne garde son allure, sans case.
  if (!contexte || !contexte.actif) return null;
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
      <input type="checkbox" data-case-selection checked={contexte.selection.has(id)} onChange={() => contexte.basculer(id)} className="size-6 accent-primaire" />
    </label>
  );
}
