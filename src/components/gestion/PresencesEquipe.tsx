"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  modifierPresenceMembre,
  modifierPresencesEnMasse,
} from "@/actions/presences";
import { ATTENDANCE_STATUTS, type AttendanceStatut } from "@/lib/constants";
import { STATUT_LABELS } from "@/lib/presences";
import type { ParticipantStatut } from "@/lib/seances";
import { Icone } from "@/components/ui/Icone";
import { PastillePersonne } from "@/components/ui/Pastille";
import { Bouton } from "@/components/ui/Bouton";
import { ListeDeroulante, type EntreeListe } from "@/components/ui/ListeDeroulante";
import {
  LIBELLE_REPLIER,
  libelleAfficher,
  libelleCompteur,
  LIGNES_VISIBLES,
  selonOrdreFige,
} from "@/components/seances/listes";
import { useDevoilement } from "@/components/seances/ListeRepliee";
import { InterrupteurSelection } from "@/components/ui/InterrupteurSelection";
import { selectionApresInterrupteur } from "@/components/ui/selection";
import {
  ajouter,
  barreDeMasseVisible,
  basculer,
  ciblesUtiles,
  compterHorsAffichage,
  etatToutCocher,
  INVITE_SELECTION,
  libelleDeplierEtSelectionner,
  libelleToutSelectionner,
  lignesSelectionnees,
  MOTS_PERSONNES,
  oublierCorrectionsArrivees,
  reponseAffichee,
  restreindre,
  resumeEcrasement,
  retirer,
  texteApresCoup,
  texteConfirmation,
  texteHorsAffichage,
  texteRepliees,
} from "./selection-presences";

type Props = {
  sessionId: string;
  /**
   * **Les invités, dans l'ordre où le serveur veut les montrer** — celui de l'actionnabilité, les
   * sans-réponse d'abord (`trierParActionnabilite`, appliqué par l'écran qui monte ce composant).
   *
   * **Le piège :** cet ordre est juste à l'ouverture et faux ensuite. On corrige les réponses une
   * par une ; chaque correction fait changer de groupe la ligne qu'on vient de toucher, donc la
   * fait sauter hors de l'écran en poussant la suivante à sa place — et l'appui d'après corrige
   * quelqu'un au hasard.
   *
   * Le recalculer depuis l'état local serait la faute évidente, et ce composant ne le fait pas.
   * Mais **le serveur le fait pour lui** : `modifierPresenceMembre` revalide `/seances/<id>`
   * (`src/actions/presences.ts`), et l'arbre revient retrié à chaque correction. Le désagrément
   * rentrait donc par la porte du serveur, sur l'écran même où l'on corrige le plus.
   *
   * D'où le figeage ci-dessous : l'ordre reçu à la **première** ouverture est celui qui reste, quoi
   * que renvoie le serveur ensuite. Il ne se remet à jour qu'au rechargement complet de la page —
   * c'est-à-dire quand plus aucun doigt n'est posé sur une ligne.
   */
  participants: ParticipantStatut[];
  /** Déjà dépliée : c'est le cas du panneau de l'annuaire, où corriger est la raison d'être de l'écran. */
  ouvert?: boolean;
  /** Le rappel du cadre légal du geste ; l'annuaire, qui l'a déjà écrit au-dessus, le coupe. */
  avertissement?: boolean;
};

/**
 * Couleur de chaque statut, portée par la bordure **et** le texte de la liste déroulante. Le libellé
 * (« Présent », « Absent »…) reste écrit en toutes lettres : la couleur souligne, elle n'informe jamais seule.
 */
const COULEURS: Record<AttendanceStatut, string> = {
  PRESENT: "border-vert text-vert",
  ABSENT: "border-rouge text-rouge",
  PEUT_ETRE: "border-ocre text-ocre",
};

const SANS_REPONSE = "border-bordure text-texte-secondaire";

/**
 * Les réponses qu'on peut donner à quelqu'un, puis l'absence de réponse — l'ordre de l'ancienne liste
 * native. « Sans réponse » porte la valeur vide, l'écriture du vide de `ListeDeroulante` : choisir
 * cette entrée efface la réponse (`changer` la traduit en `null`).
 */
const ENTREES_REPONSE: EntreeListe[] = [
  ...ATTENDANCE_STATUTS.map((v) => ({ valeur: v, libelle: STATUT_LABELS[v] })),
  { valeur: "", libelle: "Sans réponse" },
];

function couleur(statut: string | null): string {
  return statut && statut in COULEURS
    ? COULEURS[statut as AttendanceStatut]
    : SANS_REPONSE;
}

/**
 * **Le vocabulaire visuel des trois grands boutons du membre** (`BoutonsPresence`), dans leur état
 * « non choisi » : fond neutre, libellé coloré, bordure qui prend la couleur au survol. Le même
 * geste doit se reconnaître, qu'on réponde pour soi ou qu'on corrige pour cinquante.
 *
 * Écrit en classes explicites plutôt qu'avec la variante « secondaire » de `Bouton` : celle-ci
 * porte déjà `border-bordure/70` **et** `text-texte`, et deux utilitaires Tailwind de même
 * propriété ne se départagent pas par l'ordre des classes dans l'attribut. C'est exactement ce que
 * fait `BoutonsPresence`, pour la même raison.
 *
 * Le mot reste écrit en toutes lettres dans le bouton : la couleur souligne, elle n'informe jamais
 * seule.
 */
const TEINTES_EN_MASSE: Record<AttendanceStatut | "SANS_REPONSE", string> = {
  PRESENT: "text-vert hover:border-vert",
  ABSENT: "text-rouge hover:border-rouge",
  PEUT_ETRE: "text-ocre hover:border-ocre",
  SANS_REPONSE: "text-texte-secondaire hover:border-texte-secondaire",
};

/**
 * Réservé aux administrateurs : corriger la réponse de n'importe quelle personne invitée
 * (le registre reste juste même quand quelqu'un oublie de répondre ou se trompe).
 * Mise à jour optimiste ligne par ligne — seule la ligne en cours est figée.
 *
 * **La correction en masse** s'ajoute sans rien retirer : une case à cocher par ligne, une case
 * maîtresse qui ne porte que sur **ce qui est affiché**, et une barre d'action qui n'apparaît
 * qu'avec une sélection. Les règles et les mots sont dans `selection-presences.ts`, seul endroit
 * testable ; ici il n'y a que du branchement.
 *
 * **Elle est là dès douze personnes, sans seuil.** Un club de douze n'en a pas besoin, mais elle ne
 * lui coûte qu'une case par ligne et une ligne d'en-tête : aucun bouton de plus, aucune étape de
 * plus, et la barre d'action reste invisible tant que rien n'est coché. L'accrocher à
 * `LIGNES_VISIBLES` aurait fait apparaître la fonctionnalité **le jour où le club grandit** — donc
 * une fois, sans prévenir, devant quelqu'un qui ne l'a jamais vue —, et la douleur des listes
 * déroulantes une par une commence bien avant vingt personnes.
 */
export function PresencesEquipe({
  sessionId,
  participants,
  ouvert = false,
  avertissement = true,
}: Props) {
  /**
   * **Réponses modifiées ici** : elles priment sur celles reçues du serveur **le temps de
   * l'aller-retour**, et pas une seconde de plus (voir `oublierCorrectionsArrivees` et l'effet de
   * purge plus bas). Ce dictionnaire était en écriture seule, et ce « le temps de » devenait « pour
   * toujours » : les corrections de la séance de mardi s'affichaient sur le registre de jeudi, et la
   * confirmation d'écrasement du lot annonçait « 1 y est déjà » là où une réponse réelle allait être
   * effacée.
   */
  const [modifs, setModifs] = useState<Record<string, string | null>>({});
  /**
   * **Les lignes dont une écriture est en vol** — l'état pour l'affichage (`disabled`), la ref pour
   * l'effet de purge. Les deux disent la même chose ; la ref existe parce qu'un effet qui ne dépend
   * que de `participants` ne peut pas lire un état sans le prendre en dépendance, et purger à chaque
   * fin de requête ferait clignoter la valeur qu'on vient de saisir.
   */
  const [enCours, setEnCours] = useState<string[]>([]);
  const enVol = useRef<ReadonlySet<string>>(new Set());
  const ouvrirVol = (ids: readonly string[]) => {
    enVol.current = ajouter(enVol.current, ids);
    setEnCours((e) => [...e, ...ids]);
  };
  const fermerVol = (ids: readonly string[]) => {
    enVol.current = retirer(enVol.current, ids);
    setEnCours((e) => e.filter((id) => !ids.includes(id)));
  };
  const [message, setMessage] = useState<{
    type: "ok" | "erreur";
    texte: string;
  } | null>(null);
  const [, startTransition] = useTransition();
  // Ce qu'on cherche. Combien de lignes sont montrées, lui, est au crochet de dévoilement ci-dessous.
  const [filtre, setFiltre] = useState("");
  /**
   * **Les lignes cochées** pour la correction en masse. Un `Set` d'identifiants, et jamais un
   * drapeau porté par les lignes : l'identité d'une personne tient à son identifiant, et la liste
   * affichée est retriée par le serveur à chaque correction.
   *
   * La sélection **survit à un changement de recherche** — on peut cocher trois « Delta », effacer
   * le filtre, chercher « Dupuis » et en cocher deux : le lot en compte cinq. C'est le seul moyen de
   * composer un lot à partir de deux recherches, et la barre d'action annonce toujours le total.
   */
  const [selection, setSelection] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  /** Un lot est parti au serveur : les quatre boutons se ferment le temps qu'il revienne. */
  const [lotEnVol, setLotEnVol] = useState(false);
  /**
   * **L'interrupteur « Sélection multiple »** (`InterrupteurSelection`, commun aux écrans de masse).
   * Le geste ordinaire de cet écran est la liste déroulante d'**une** ligne ; le lot est l'exception
   * d'un soir de cours. Éteint, ni case, ni case maîtresse, ni barre : la ligne garde le nom entier et
   * sa liste. L'éteindre vide le lot (`selectionApresInterrupteur`).
   */
  const [interrupteur, setInterrupteur] = useState(false);
  const masseVisible = interrupteur && barreDeMasseVisible(selection);

  /**
   * **La recherche se fait ici, dans le navigateur.** Les invités sont déjà tous chargés — le
   * serveur les envoie avec la séance —, il n'y a donc rien à redemander : le filtre répond frappe
   * par frappe, sans aller-retour. C'est le même champ que « Ajouter des membres existants »
   * (`AjoutMembresPeriode`), et pour la même raison.
   *
   * Elle n'apparaît que si la liste déborde : à douze, on lit la liste, on ne la fouille pas.
   */
  const longue = participants.length > LIGNES_VISIBLES;

  /**
   * **L'ordre de la première ouverture**, retenu tel quel. Le serveur revalide cet écran à chaque
   * correction et renvoie la liste retriée ; sans ce repère, les lignes sauteraient sous le doigt
   * (voir `selonOrdreFige` et le commentaire de `participants` ci-dessus).
   *
   * Un `ref` et non un `state` : cette valeur ne déclenche aucun rendu, elle ne fait que survivre
   * aux suivants. Elle est posée au premier rendu et n'est plus jamais réécrite — c'est exactement
   * ce qu'on veut dire par « figé ».
   */
  const ordreOuverture = useRef<readonly string[] | null>(null);
  if (ordreOuverture.current === null)
    ordreOuverture.current = participants.map((p) => p.id);
  const ordre = ordreOuverture.current;
  const stables = useMemo(
    () => selonOrdreFige(ordre, participants),
    [ordre, participants],
  );

  const trouves = useMemo(() => {
    const q = filtre.trim().toLowerCase();
    if (!q) return stables;
    return stables.filter((p) =>
      `${p.prenom} ${p.nom}`.toLowerCase().includes(q),
    );
  }, [stables, filtre]);
  /**
   * **La liste se découvre vingt par vingt**, comme partout ailleurs dans l'application. C'était le
   * dernier écran qui dépliait **tout d'un coup** : « Afficher les 60 suivantes » montrait bel et
   * bien soixante lignes, et l'on perdait l'endroit où l'on cochait.
   *
   * Le calcul n'est pas réécrit ici : c'est le crochet partagé (`useDevoilement`, qui s'appuie sur
   * `devoilement`), le même que les listes de noms et l'historique — et il porte déjà `toutDevoiler`
   * pour le seul geste qui demande explicitement les quatre-vingts lignes (voir plus bas).
   *
   * Le repli s'applique à **ce qui est affiché** : chercher « mar » dans quatre-vingts noms montre
   * les quatre Delta d'un coup, sans bouton — `devoilement` borne déjà le compte par le total filtré.
   */
  const {
    affichees,
    restantes,
    prochaine,
    auDebut,
    suivante,
    revenir,
    toutDevoiler,
  } = useDevoilement(trouves.length);
  const montres = trouves.slice(0, affichees);

  /**
   * **Le piège du repli, traité de front.** Vingt lignes montrées, soixante derrière un bouton : une
   * case « Tout sélectionner » mentirait dans un sens ou dans l'autre. La case maîtresse ne porte
   * donc que sur `montres` et le **dit** dans son libellé, et un second bouton propose de déplier
   * *et* de sélectionner les résultats entiers — le geste que le bureau vient faire.
   */
  const replie = restantes > 0;
  const recherche = filtre.trim().length > 0;
  const etatCases = etatToutCocher(montres, selection);
  const caseMaitresse = useRef<HTMLInputElement>(null);
  /**
   * **Ce que la sélection annonce, écrit une fois et lu à deux endroits** : en clair dans la barre
   * d'action, et dans la région vivante permanente posée au-dessus de la liste.
   *
   * Pourquoi deux endroits plutôt qu'un `aria-live` sur le texte visible : la barre d'action **n'existe
   * pas** tant que rien n'est coché. La région naissait donc en même temps que sa première phrase, et
   * une région `aria-live` créée avec son contenu n'est pas annoncée — la **première** case cochée ne
   * disait rien, précisément celle qui apprend qu'un mode de sélection vient de s'ouvrir. La région
   * permanente est vide quand rien n'est coché, exactement comme le message de résultat de cet écran.
   */
  const compteurAnnonce =
    selection.size > 0
      ? `${selection.size} personne${selection.size > 1 ? "s" : ""} sélectionnée${selection.size > 1 ? "s" : ""}`
      : "";
  /**
   * **Ce que le lot emporte en dehors de ce qu'on voit.**
   *
   * On cherche « mar », on coche trois personnes, on tape autre chose : l'écran affiche « Aucun nom
   * ne correspond à cette recherche » et, juste en dessous, une barre qui écrit en base sur trois
   * personnes dont aucun nom n'est à l'écran. `texteRepliees` ne couvrait que le **repli** — et
   * disparaissait entièrement avec le bloc de la case maîtresse dès que rien ne correspondait, c'est-à-dire
   * exactement quand il fallait parler. `CLAUDE.md` : ce qui reste dehors est **compté et
   * dit**. La phrase est donc rendue dans la barre d'action, qui ne dépend que de la sélection.
   */
  const horsAffichage = texteHorsAffichage(
    compterHorsAffichage(selection, montres),
    MOTS_PERSONNES,
  );

  useEffect(() => {
    if (message?.type !== "ok") return;
    const t = setTimeout(() => setMessage(null), 3000);
    return () => clearTimeout(t);
  }, [message]);

  // « Certaines, pas toutes » ne s'écrit pas en JSX : `indeterminate` est une propriété du nœud.
  useEffect(() => {
    if (caseMaitresse.current)
      caseMaitresse.current.indeterminate = etatCases === "partielle";
  }, [etatCases]);

  /**
   * **Le serveur a parlé : on oublie ce qui traînait**, sans jamais rouvrir l'ordre figé.
   *
   * Deux nettoyages, et un seul déclencheur — l'arrivée de données fraîches (`participants`) :
   *
   * - **la sélection** oublie qui a quitté la liste (`restreindre`) : une case cochée dans le vide
   *   ferait annoncer à la barre un nombre que l'écran ne montre plus, et l'action refuserait le lot ;
   * - **les corrections affichées** oublient tout ce qui n'est plus en vol
   *   (`oublierCorrectionsArrivees`). C'est le cœur du correctif : sans cette purge, une correction
   *   de mardi masquait indéfiniment la réponse que la personne a donnée mercredi de son téléphone —
   *   le registre se lisait faux, la ligne devenait impossible à corriger (la liste déroulante
   *   affichait déjà la valeur, et le geste unitaire s'arrêtait sur « rien n'a changé »), et la
   *   confirmation du lot annonçait « 1 y est déjà » au moment d'effacer une réponse réelle.
   *
   * La dépendance est `participants` et non `stables` : on ne touche ni au repère d'ordre posé au
   * premier rendu, ni à quoi que ce soit d'autre. Et chaque valeur n'est remplacée que si elle a
   * vraiment changé — sinon chaque revalidation du serveur coûterait un rendu de plus pour rien.
   *
   * **Elle suppose que l'action revalide l'écran d'où part la correction** : c'est le rôle de
   * `rafraichirApresCorrection`, qui liste `/admin/presences` avec les autres. Purger sans données
   * fraîches afficherait les réponses d'avant.
   */
  useEffect(() => {
    setSelection((s) => {
      if (s.size === 0) return s;
      const propre = restreindre(s, participants);
      return propre.size === s.size ? s : propre;
    });
    setModifs((m) => oublierCorrectionsArrivees(m, enVol.current));
  }, [participants]);

  const changer = (p: ParticipantStatut, valeur: string) => {
    // La **même** lecture que le résumé d'écrasement du lot (`reponseAffichee`) : deux chemins
    // d'écriture qui liraient deux valeurs différentes, c'est un chemin qui s'abstient là où l'autre
    // écrase — ce que `CLAUDE.md` interdit.
    const precedent = reponseAffichee(modifs, p);
    const nouveau = valeur === "" ? null : valeur;
    if (nouveau === precedent) return;
    const nom = `${p.prenom} ${p.nom}`;
    setModifs((m) => ({ ...m, [p.id]: nouveau }));
    ouvrirVol([p.id]);
    startTransition(async () => {
      /*
       * **Un `catch`, et la valeur optimiste rendue**. Sans lui, une promesse qui rejette sans
       * réponse — réseau coupé dans le gymnase, 500, ou élévation admin tombée pendant qu'on
       * cochait, auquel cas `assertPermission` lève — laissait la ligne `disabled` à vie **en
       * affichant la réponse qu'on venait de choisir**. L'écran montrait donc un registre que la
       * base n'avait pas, sans rien dire, jusqu'au rechargement. C'est la doctrine du dossier : on
       * suit la **promesse** de l'action, jamais `pending`, et on l'entoure d'un `catch`.
       */
      try {
        const res = await modifierPresenceMembre({
          sessionId,
          userId: p.id,
          statut: nouveau,
        });
        if (res.ok) {
          setModifs((m) => ({ ...m, [p.id]: res.statut }));
          setMessage({ type: "ok", texte: `Réponse de ${nom} enregistrée.` });
        } else {
          setModifs((m) => ({ ...m, [p.id]: precedent }));
          setMessage({ type: "erreur", texte: `${nom} : ${res.erreur}` });
        }
      } catch {
        setModifs((m) => ({ ...m, [p.id]: precedent }));
        setMessage({
          type: "erreur",
          texte: `${nom} : l'enregistrement n'a pas abouti. Vérifie ta connexion, puis réessaie.`,
        });
      } finally {
        fermerVol([p.id]);
      }
    });
  };

  /**
   * La réponse qu'une ligne porte **à l'écran** : la correction en cours si elle existe, sinon celle
   * du serveur. La règle vit dans `selection-presences.ts` (`reponseAffichee`) parce que le verrou du
   * geste unitaire et le résumé d'écrasement du lot doivent lire **exactement** la même valeur.
   */
  const statutAffiche = (p: ParticipantStatut): AttendanceStatut | null =>
    reponseAffichee(modifs, p);

  /**
   * **Le lot part d'un seul appel** (`modifierPresencesEnMasse`), jamais d'une boucle sur la
   * correction unitaire : cinquante-cinq allers-retours, cinquante-cinq revalidations, et un lot à
   * moitié écrit si l'un échoue.
   *
   * La confirmation est posée **avant** toute écriture optimiste, et elle annonce ce qui sera écrasé
   * (`texteConfirmation`) : c'est le patron de `SeancesCreees`, qui dit combien de réponses une
   * suppression de séances emporte.
   */
  const appliquerEnMasse = (cible: AttendanceStatut | null) => {
    const lignes = lignesSelectionnees(stables, selection);
    if (lignes.length === 0) return;
    const resume = resumeEcrasement(
      lignes.map((p) => ({ id: p.id, statut: statutAffiche(p) })),
      cible,
    );
    if (!window.confirm(texteConfirmation(resume, cible))) return;
    const ids = lignes.map((p) => p.id);
    // Ce qu'on remettra en place si le serveur refuse : l'écran ne doit pas garder une réponse qui
    // n'a jamais été écrite.
    const avant = Object.fromEntries(
      lignes.map((p) => [p.id, statutAffiche(p)]),
    );
    setModifs((m) => ({
      ...m,
      ...Object.fromEntries(ids.map((id) => [id, cible])),
    }));
    ouvrirVol(ids);
    setLotEnVol(true);
    startTransition(async () => {
      /*
       * **Même `catch` que le geste unitaire, et il compte davantage ici** : quarante lignes portent la
       * valeur optimiste, et `lotEnVol` verrouille la barre **et toutes les cases de la liste**. Sans
       * lui, une requête qui n'aboutit pas laissait l'écran sur « Enregistrement… », inerte, en
       * affichant quarante réponses que la base n'avait pas.
       */
      try {
        const res = await modifierPresencesEnMasse({
          sessionId,
          userIds: ids,
          statut: cible,
        });
        if (res.ok) {
          /*
           * **Le focus rentre à la case maîtresse avant que la barre ne disparaisse.** Les quatre
           * boutons sont `disabled` le temps du vol : le navigateur retire donc déjà le focus du
           * bouton qu'on vient d'appuyer, et la barre qui le portait est démontée à l'arrivée de la
           * réponse. Le focus retombait sur `<body>` — la tabulation suivante repartait du premier
           * lien de la page, à cinquante lignes de la personne qu'on corrigeait. La case maîtresse,
           * elle, ne dépend pas de la sélection : c'est l'ancre stable de cet écran, et c'est aussi
           * de là qu'on repart pour composer le lot suivant. Même correctif qu'à `ListeDeroulante`.
           */
          caseMaitresse.current?.focus();
          // La sélection se vide : le lot est passé, et laisser les cases cochées invite à recliquer.
          setSelection(new Set());
          setMessage({
            type: "ok",
            texte: texteApresCoup(res.modifiees, res.inchangees),
          });
        } else {
          setModifs((m) => ({ ...m, ...avant }));
          setMessage({ type: "erreur", texte: res.erreur });
        }
      } catch {
        setModifs((m) => ({ ...m, ...avant }));
        setMessage({
          type: "erreur",
          texte:
            "L'enregistrement du lot n'a pas abouti. Vérifie ta connexion, puis réessaie — rien n'a été écrit.",
        });
      } finally {
        fermerVol(ids);
        setLotEnVol(false);
      }
    });
  };

  return (
    <details
      open={ouvert}
      className="group rounded-xl border border-bordure/60 bg-surface-douce/60"
    >
      {/* 48 px : c'est la poignée qui ouvre tout l'écran, elle ne peut pas être la plus petite cible de la page. */}
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 px-4 font-semibold [&::-webkit-details-marker]:hidden">
        <span className="inline-flex items-center gap-2">
          <Icone nom="personne" taille={18} />
          Modifier les réponses ({participants.length})
        </span>
        <Icone
          nom="chevronBas"
          taille={18}
          className="transition-transform group-open:rotate-180"
        />
      </summary>
      {/* `@container` : c'est **cette** boîte que les paliers intérieurs du registre mesurent (la
          liste en deux colonnes, plus bas). La même carte vit dans une page large de 1 440 px et dans
          une colonne de lecture de 736 : une mesure de fenêtre répondrait ici à côté de la question. */}
      <div className="@container flex flex-col gap-3 border-t border-bordure/60 px-4 py-3">
        {avertissement ? (
          <p className="text-sm text-texte-secondaire">
            Tu peux corriger la réponse de n&apos;importe quelle personne
            invitée, y compris après le début du cours, pour tenir le registre à
            jour. Chaque changement est enregistré dans le journal.
          </p>
        ) : null}

        {participants.length === 0 ? (
          <p className="text-texte-secondaire">
            Personne n&apos;est invité sur cette période.
          </p>
        ) : null}

        {longue ? (
          <div>
            <label className="sr-only" htmlFor={`recherche-${sessionId}`}>
              Chercher une personne
            </label>
            <input
              id={`recherche-${sessionId}`}
              type="search"
              value={filtre}
              onChange={(e) => setFiltre(e.target.value)}
              placeholder="Chercher un nom"
              autoComplete="off"
              className="min-h-12 w-full rounded-xl border-2 border-bordure bg-surface px-4 text-base shadow-champ focus:border-primaire"
            />
            <p
              className="mt-1 text-sm text-texte-secondaire"
              aria-live="polite"
            >
              {filtre.trim()
                ? `${trouves.length} personne${trouves.length > 1 ? "s" : ""} sur ${participants.length}`
                : "Les personnes sans réponse sont en haut de la liste."}
            </p>
          </div>
        ) : null}

        {longue && trouves.length === 0 ? (
          <p className="text-texte-secondaire">
            Aucun nom ne correspond à cette recherche.
          </p>
        ) : null}

        {/* **La case maîtresse.** Son libellé nomme ce qu'elle prend — « Sélectionner les 12
            résultats », jamais « Tout » : le mot serait faux dès qu'une recherche filtre la liste ou
            qu'un repli en cache la fin, et c'est justement là qu'on s'en sert. La décocher ne relâche
            que ces mêmes lignes, et laisse ce qui a été coché sous une recherche précédente. */}
        {stables.length > 0 ? (
          <InterrupteurSelection
            actif={interrupteur}
            disabled={lotEnVol}
            onChange={(suite) => {
              setInterrupteur(suite);
              setSelection((s) => selectionApresInterrupteur(s, suite));
            }}
          />
        ) : null}
        {interrupteur && montres.length > 0 ? (
          <div className="flex flex-col gap-1 rounded-xl border border-bordure/60 bg-surface px-3 py-1">
            <label className="flex min-h-12 cursor-pointer items-center gap-3">
              <input
                ref={caseMaitresse}
                type="checkbox"
                checked={etatCases === "toutes"}
                disabled={lotEnVol}
                onChange={() => {
                  const ids = montres.map((p) => p.id);
                  setSelection((s) =>
                    etatToutCocher(montres, s) === "toutes"
                      ? retirer(s, ids)
                      : ajouter(s, ids),
                  );
                }}
                className="size-6 shrink-0 accent-primaire"
              />
              <span className="font-semibold">
                {libelleToutSelectionner(montres.length, { recherche, replie })}
              </span>
            </label>
            {/* **Ce que les cases permettent, dit en une ligne à côté d'elles**. La tuile de masse
                ne se montre plus tant que rien n'est coché (« rends cette tuile visible uniquement
                si quelqu'un est coché ») : la phrase qui nommait le geste d'entrée descend donc
                ici, là où l'œil est déjà, au lieu de disparaître avec la tuile. Elle s'efface dès
                qu'une case est cochée : le geste est fait, la tuile a pris le relais. Même forme et
                même place qu'à l'annuaire (`texteInviteMasse`), avec les mots de cet écran. */}
            {!masseVisible ? (
              <p className="text-sm text-texte-secondaire">{INVITE_SELECTION}</p>
            ) : null}
            {replie ? (
              <>
                {/* **Les lignes repliées, avec ce qu'elles portent déjà de coché.** `montres` est
                    le **début** de `trouves` (`trouves.slice(0, LIGNES_VISIBLES)`), donc le repli est
                    exactement `trouves.slice(montres.length)` — et on lui passe la sélection, pas un
                    décompte : Chloé cochée sous la recherche « du » est toujours cochée après un
                    changement de recherche, et se retrouve alors dans ce repli. Dire « elles ne sont
                    pas sélectionnées » serait faux juste au-dessus du bouton qui écrit en base. */}
                <p className="text-sm text-texte-secondaire">
                  {texteRepliees(trouves.slice(montres.length), selection)}
                </p>
                {/* La sortie du piège : déplier **et** sélectionner d'un geste, plutôt que de laisser
                    croire qu'une case a pris quatre-vingts lignes quand elle en a pris vingt. */}
                <Bouton
                  type="button"
                  variante="secondaire"
                  taille="petite"
                  pleineLargeur
                  disabled={lotEnVol}
                  onClick={() => {
                    // Le seul geste qui sort du pas de vingt : son libellé annonce les quatre-vingts
                    // lignes, et le faire quatre fois de suite pour composer un lot serait absurde.
                    toutDevoiler();
                    setSelection((s) =>
                      ajouter(
                        s,
                        trouves.map((p) => p.id),
                      ),
                    );
                  }}
                >
                  <Icone nom="chevronBas" />
                  {libelleDeplierEtSelectionner(trouves.length, recherche)}
                </Bouton>
              </>
            ) : null}
          </div>
        ) : null}

        {/* La phrase « hors affichage » est annoncée avec le compteur : une sélection dont une partie
            n'est plus à l'écran est précisément ce qu'un lecteur d'écran ne peut pas deviner. */}
        <p className="sr-only" aria-live="polite">
          {[compteurAnnonce, horsAffichage].filter(Boolean).join(" ")}
        </p>

        {/* Une seule colonne, et jamais de nom tronqué : le club compte deux Foxtrot et deux Golf —
            « Foxtrot … » en face d'une liste déroulante, c'est corriger la réponse de quelqu'un au hasard.
            Le nom passe à la ligne s'il le faut, la liste déroulante garde sa largeur. */}
        {/* `pb-48` tant qu'une sélection est active : la barre d'action flotte 88 px au-dessus du bas
            de l'écran et fait ~200 px de haut sur un téléphone de 390 px. Sans cette réserve, les
            dernières lignes de la liste — et les boutons de dévoilement qui les suivent — ne sortent
            de dessous la barre qu'au tout dernier pixel de défilement de la page, alors que ce sont
            justement celles qu'on vient de cocher. Dès 768 px la barre d'onglets disparaît, la barre
            d'action redescend, et la réserve n'a plus d'objet. */}
        {/*
          **Deux colonnes de lignes quand le registre a la place, et la ligne plafonnée** (
          après la mesure). `/admin/presences` et la fiche d'une séance sont larges : la carte reçoit
          1 440 px. La ligne étant `flex` avec le nom en `flex-1`, la liste déroulante partait se
          coller au **bord droit — ~1 150 px après le nom**. C'est, mot pour mot, le défaut que
          `CLAUDE.md` reproche à une carte étirée : « ça pose les boutons de réponse au bout d'un geste
          de souris », et ici c'est le geste qu'on répète cinquante fois un soir de cours.
          Deux corrections, et une seule aurait manqué son but : **plafonner** la ligne (sans quoi
          deux colonnes laissent encore 600 px entre le nom et sa liste) et **remplir** la largeur
          libérée par une seconde colonne (sans quoi la page large n'aurait plus rien à montrer, et il
          aurait fallu la rendre étroite).
          **Le palier mesure le CONTENEUR** (`@4xl` = 896 px), jamais la fenêtre : la même carte vit
          dans une page large et dans une pile. En dessous de 896 px de conteneur — téléphone,
          tablette, page de lecture — **rien ne change d'un pixel** : une colonne, ligne pleine
          largeur, exactement comme avant.
          L'ordre du DOM ne bouge pas (donc l'ordre lu à l'oreille non plus) et reste celui du
          serveur : les sans-réponse d'abord. Le remplissage étant par rangées, deux voisins
          alphabétiques sont côte à côte — la liste se lit de gauche à droite, comme un listing. */}
        <ul
          className={`flex flex-col gap-1 @4xl:grid @4xl:grid-cols-2 @4xl:gap-x-8 ${masseVisible ? "pb-48 md:pb-0" : ""}`}
        >
          {montres.map((p) => {
            const statut = statutAffiche(p);
            const teinte = couleur(statut);
            const occupe = enCours.includes(p.id);
            return (
              <li
                key={p.id}
                className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 border-b border-bordure/40 py-1.5 last:border-b-0 @4xl:max-w-xl"
              >
                {/* La case et le nom dans un même libellé : la cible tactile fait toute la largeur du
                    nom, on coche en visant la ligne et non une case de 24 px. Pas d'imbrication avec
                    le libellé de la liste déroulante, qui reste un frère (un `label` dans un `label`
                    n'a pas d'accessible name fiable).
                    Pas d'icône de statut ici : la liste déroulante dit « Présent » / « Absent » en
                    toutes lettres, l'information ne repose donc jamais sur la seule couleur — et les
                    ~30 px gagnés reviennent au nom, qui doit rester entier. */}
                <label className="flex min-h-12 min-w-0 flex-1 cursor-pointer items-center gap-3">
                  {interrupteur ? (
                    <input
                      type="checkbox"
                      checked={selection.has(p.id)}
                      disabled={occupe || lotEnVol}
                      onChange={() => setSelection((s) => basculer(s, p.id))}
                      className="size-6 shrink-0 accent-primaire"
                    />
                  ) : null}
                  <PastillePersonne id={p.id} couleur={p.couleur} taille={10} />
                  <span className="min-w-0">
                    {p.prenom} {p.nom}
                  </span>
                </label>
                <label id={`presence-${p.id}-libelle`} className="sr-only" htmlFor={`presence-${p.id}`}>
                  Réponse de {p.prenom} {p.nom}
                </label>
                {/* La liste du dépôt, jamais un `<select>` nu : au pied d'un registre de quatre-vingts
                    lignes, la liste native s'ouvrait vers le haut. Elle enregistre au choix comme le
                    `<select>` au `change` ; rechoisir la réponse affichée ne part pas au serveur,
                    `changer` s'arrête de lui-même quand rien ne change. L'enveloppe `shrink-0` tient
                    la place de la liste dans la ligne `flex` : c'est elle, et non plus le déclencheur,
                    qui est l'enfant de la ligne. */}
                <div className="shrink-0">
                  <ListeDeroulante
                    id={`presence-${p.id}`}
                    libelleId={`presence-${p.id}-libelle`}
                    libelle={`Réponse de ${p.prenom} ${p.nom}`}
                    valeur={statut ?? ""}
                    entrees={ENTREES_REPONSE}
                    disabled={occupe}
                    onChoisir={(v) => changer(p, v)}
                    className={[
                      // 48 px et non 44 : c'est **la** cible de cet écran, celle qu'on vise cinquante
                      // fois de suite un soir de cours, et le cahier des charges ne connaît qu'un chiffre.
                      "min-h-12 w-36 rounded-xl border-2 bg-surface px-2 text-base font-semibold shadow-champ",
                      "focus:border-primaire disabled:cursor-wait disabled:opacity-60",
                      teinte,
                    ].join(" ")}
                  />
                </div>
              </li>
            );
          })}
          {/* Pas un bouton tant que tout tient : un club de douze retrouve sa liste entière, sans
              repli ni compteur — c'est l'invariant du dossier des listes longues.
              Deux boutons et non un seul : « Afficher les N suivantes » annonce **ce qu'il va
              montrer** (vingt, puis sept sur la dernière tranche), et « Replier » ne paraît qu'après
              le premier appui, pour ramener à la première tranche. C'est le patron de
              `ListeRepliee` ; il n'est pas monté ici parce que ces lignes-là portent une case à
              cocher et vivent dans le `<ul>` de ce composant. */}
          {trouves.length > LIGNES_VISIBLES ? (
            <li className="list-none pt-1">
              <div className="flex flex-wrap items-center gap-2">
                {restantes > 0 && (
                  <Bouton
                    variante="secondaire"
                    taille="petite"
                    className="flex-1 basis-48"
                    disabled={lotEnVol}
                    onClick={suivante}
                  >
                    <Icone nom="chevronBas" />
                    {libelleAfficher(prochaine)}
                  </Bouton>
                )}
                {!auDebut && (
                  <Bouton
                    variante="secondaire"
                    taille="petite"
                    className="flex-1 basis-32"
                    disabled={lotEnVol}
                    onClick={revenir}
                  >
                    <Icone nom="chevronHaut" />
                    {LIBELLE_REPLIER}
                  </Bouton>
                )}
                {/* **Le compteur est monté avec les boutons, avant le premier appui.** Une région
                    `aria-live` créée en même temps que son contenu n'est pas annoncée : elle serait
                    donc muette exactement à l'appui qui compte le plus, le premier. Il vit ici, au
                    bas de la **liste**, et non dans la barre d'action collante — dévoiler et
                    corriger ne sont pas le même geste. */}
                <p
                  aria-live="polite"
                  className="basis-full text-center text-sm tabular-nums text-texte-secondaire"
                >
                  {libelleCompteur(affichees, trouves.length)}
                </p>
              </div>
            </li>
          ) : null}
        </ul>

        {/* **La barre d'action n'existe qu'avec une sélection** (sur les deux écrans de masse :
            « pour presence (admin) pareil, rends cette tuile visible uniquement si quelqu'un est
            coché »).

            C'est l'inverse de la décision, qui la montait toujours — sobre, inerte, avec la phrase
            qui nomme le geste d'entrée — parce qu'« une fonctionnalité qui n'apparaît qu'une fois
            qu'on a deviné son geste d'entrée n'existe pas pour qui ne l'a pas deviné ». Le problème
            que cette décision-là résolvait reste entier ; ce qui change, c'est **où** il se résout
            : la phrase vit maintenant **à côté des cases** (`INVITE_SELECTION`, sous la case
            maîtresse), en une ligne. Ce que la tuile inerte coûtait, c'était deux cents pixels en
            bas d'un écran de 390 px — trois lignes de la liste qu'on vient lire — pour quatre
            boutons incapables d'écrire. La condition d'affichage est **partagée avec l'annuaire**
            (`barreDeMasseVisible`) : les deux écrans doivent apparaître au même moment.

            Elle reste collante : on coche en descendant une liste de quatre-vingts noms, et les
            quatre réponses doivent rester sous le pouce. « Sans réponse » y figure au même titre
            que les trois autres — remettre à zéro quelqu'un coché par erreur est une correction
            comme une autre.

            **Elle se pose AU-DESSUS de la barre d'onglets du téléphone**. Elle était à `bottom-2`,
            et la barre d'onglets du bas (`NavBas`, `fixed bottom-0 z-10`, cachée à partir de 768
            px) fait 84 px avec sa marge de sécurité : à `z-index` égal, c'est le dernier peint qui
            gagne, et la barre de sélection est rendue après. Sur 390 px, ses quatre boutons en deux
            colonnes font ~200 px de haut : elle recouvrait la barre d'onglets **entière** — plus
            deux ou trois lignes de la liste qu'on est en train de cocher. Tant qu'une sélection
            était active, « Accueil / Séances / Profil » n'était plus tapable, sur l'écran même où
            l'on passe le plus de temps. Le décalage reprend la hauteur de la barre d'onglets
            (`env(safe-area- inset-bottom)` comprise, comme elle) ; dès 768 px la barre d'onglets
            n'existe plus, et la barre d'action retrouve ses 8 px du bas. */}
        {masseVisible ? (
          <div
            role="group"
            aria-label="Modifier la réponse de plusieurs personnes à la fois"
            className="sticky bottom-[calc(env(safe-area-inset-bottom,0px)+5.5rem)] z-10 flex flex-col gap-2 rounded-xl border-2 border-primaire/50 bg-surface p-3 shadow-carte md:bottom-2"
          >
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              {/* Sans `aria-live` : l'annonce est portée par la région permanente posée plus haut
                  (voir `compteurAnnonce`), **qui reste montée en permanence même maintenant que la
                  barre va et vient** — sans quoi la première case cochée créerait la région avec son
                  texte, et ne dirait rien. */}
              <p className="font-semibold">{compteurAnnonce}</p>
              <Bouton type="button" variante="discret" taille="petite" disabled={lotEnVol} onClick={() => setSelection(new Set())}>
                Annuler la sélection
              </Bouton>
            </div>
            {/* **Ce qui reste dehors, compté et dit.** Sans `aria-live` : la phrase est annoncée avec
                le compteur par la région permanente posée plus haut. Elle vit ici et non sous la case
                maîtresse, dont tout le bloc disparaît dès que la recherche ne trouve plus rien —
                c'est-à-dire au moment précis où le lot ne montre plus aucun des noms qu'il emporte. */}
            {horsAffichage ? <p className="text-sm text-texte-secondaire">{horsAffichage}</p> : null}
            {/* Cinquante-cinq lignes écrites d'un coup prennent un instant : le dire ici évite qu'on
                reclique sur un bouton dont on croit qu'il n'a rien fait. */}
            <p className="text-sm text-texte-secondaire" aria-live="polite">
              {lotEnVol ? "Enregistrement…" : "Mettre leur réponse à :"}
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {/* **Seulement les réponses qui changeraient quelqu'un** (`ciblesUtiles`) : quatre
                  « Présent » cochés ne se voient pas offrir « Présent ». Les boutons restent neutres,
                  le mot coloré : c'est la même réponse que le membre donne lui-même. */}
              {ciblesUtiles(lignesSelectionnees(stables, selection).map((p) => ({ id: p.id, statut: statutAffiche(p) }))).map((cible) => (
                <button
                  key={cible ?? "sans-reponse"}
                  type="button"
                  disabled={lotEnVol}
                  aria-busy={lotEnVol}
                  onClick={() => appliquerEnMasse(cible)}
                  className={[
                    "inline-flex min-h-12 w-full items-center justify-center rounded-xl border-2 border-bordure bg-surface",
                    // La barre n'existe plus sans sélection : le seul `disabled` qui reste est
                    // l'attente d'un lot parti, et `cursor-wait` est alors la vérité.
                    "px-3 text-base font-semibold shadow-champ transition active:scale-[0.98] disabled:cursor-wait disabled:opacity-60",
                    TEINTES_EN_MASSE[cible ?? "SANS_REPONSE"],
                  ].join(" ")}
                >
                  {cible ? STATUT_LABELS[cible] : "Sans réponse"}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <p className="min-h-6 text-sm" aria-live="polite">
          {message ? (
            <span
              className={
                message.type === "ok"
                  ? "font-semibold text-vert"
                  : "font-semibold text-rouge"
              }
            >
              {message.texte}
            </span>
          ) : null}
        </p>
      </div>
    </details>
  );
}
