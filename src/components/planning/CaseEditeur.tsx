"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { enregistrerCase, programmerAtelierDansCase } from "@/actions/planning";
import { libelleChoixNiveau, LIBELLE_VIDE, NIVEAU_DEFAUT, NIVEAUX, PARTIE_DESCRIPTION_MAX, THEME_MAX, type Niveau } from "@/lib/constants";
import { formatDateHeure } from "@/lib/dates";
import type { CasePlanning } from "@/lib/planning";
import { Icone } from "@/components/ui/Icone";
import { couleurPersonne } from "@/lib/couleurs";
import { PastillePersonne } from "@/components/ui/Pastille";
import { ListeDeroulante } from "@/components/ui/ListeDeroulante";
import type { EntreeListe } from "@/components/ui/liste-deroulante";
import { useListesCompletes, useOptionsCase } from "./ContexteOptions";
import { useBrouillon } from "./ContexteBrouillon";
import { abreger, AUTRE, champsLus, personnesRendues, reglagesVides, themesRendus } from "./options";
import { auRepos, fileInitiale, pairesEgales, poser, retour, suivreServeur, type Envoi, type FileEnvoi, type Paire } from "./file-envoi";
import { brancherGardeFermeture, marquerEnAttente } from "./garde-fermeture";
import { paireImposee } from "./brouillon";

/**
 * Au-delà de ce délai, un enregistrement qui n'est toujours pas revenu cesse d'être passé sous
 * silence. Dix secondes : bien plus que l'aller-retour habituel (moins d'une seconde,
 * `revalidatePath` compris), et assez court pour qu'on ne règle pas dix cases sur un serveur muet.
 */
const ATTENTE_ANORMALE_MS = 10_000;

/**
 * **L'intitulé visible d'un champ de réglage** — « Instructeur », « Thème »…
 *
 * Demandé par. La **vue membre** avait été traitée (le `<dl>` plus bas, chaque valeur sous son
 * nom), l'écran de réglage non : ses quatre listes déroulantes s'empilaient sans rien devant, et on
 * lisait « Damien Rochebrune / personne en second / Autre… / Intermédiaire » sans pouvoir dire
 * lequel était quoi. Les intitulés existaient, mais en `sr-only` : audibles, invisibles.
 *
 * **Pourquoi un `<span aria-hidden>` et non un `<label>` visible.** Le `<label>` du champ doit garder
 * pour texte **exactement** `Instructeur — {libellé de la partie}` : c'est par cette chaîne que la
 * campagne de bout en bout retrouve une case (`label:text-is("Thème — …")`), le libellé de la partie
 * étant écrit à la main et donc le seul repère lisible. Y glisser un second mot casserait cette
 * prise. L'intitulé visible est donc un élément à côté, retiré de l'arbre d'accessibilité : le nom
 * accessible continue de venir du `<label>`, et la synthèse vocale n'annonce pas deux fois la même
 * chose.
 *
 * **Il ne disparaît jamais**, même quand le champ vaut `----------` : côté encadrement, c'est
 * justement là qu'on remplit. C'est la vue membre qui masque le couple intitulé + valeur quand il n'y
 * a rien à lire, pas celle-ci.
 */
function Intitule({ children }: { children: string }) {
  // `leading-tight` et une taille relative : sur téléphone les quatre champs s'empilent, et ces
  // quatre lignes de plus se paient en hauteur sur l'écran qu'on tient au bord du tapis.
  return (
    <span aria-hidden="true" className="text-[0.85em] font-semibold leading-tight text-texte-secondaire">
      {children}
    </span>
  );
}

const paireServeur = (v: CasePlanning): Paire => ({
  instructeurId: v.instructeurId ?? "",
  instructeurSecondId: v.instructeurSecondId ?? "",
  theme: v.theme,
  description: v.description,
  niveau: v.niveau,
});

/**
 * Une case du planning : instructeur, second instructeur, thème et niveau en listes déroulantes, plus
 * une **description** libre et facultative sous la rangée ; enregistrement immédiat. Une case occupée par un atelier programmé est affichée en lecture seule.
 * `compact` = affichage resserré (fiche de séance) ; sinon la densité ordinaire du planning.
 *
 * **Elle ne connaît que sa partie.** Depuis que chaque séance porte ses propres parties, la case est
 * désignée par `valeur.id` — plus par un couple séance + rang : c'est cet identifiant qui nomme ses
 * champs, qui la classe dans la garde de fermeture, et que l'action serveur reçoit. Le libellé, lui,
 * est **calculé** depuis le rang de la partie et s'écrit au-dessus de la case (voir `ListeParties`) :
 * la case n'en fait que deux usages, nommer ses champs pour les lecteurs d'écran et se laisser
 * retrouver par les tests.
 *
 * Les listes (personnes, thèmes, ateliers) viennent du contexte : elles sont communes à toute la
 * grille et ne sont envoyées qu'une fois. Leurs entrées ne sont écrites dans le HTML qu'au premier
 * contact avec la liste déroulante (`deplier`) : fermée, une liste ne montre que sa valeur courante.
 *
 * **La case ne dit rien quand tout va bien** : ni « Enregistrement… », ni « Enregistré ». Le
 * réglage choisi est dans la liste déroulante, et c'est lui la confirmation ; elle ne prend la
 * parole que pour un échec ou un envoi qui traîne (voir `demarrer`).
 *
 * **La case reste réglable pendant l'enregistrement.** Chaque changement envoie le contenu complet
 * (les deux instructeurs, le thème, la description et le niveau), et rien n'oblige donc à bloquer les listes en
 * attendant la réponse. Les bloquer revenait à figer la case pendant tout l'aller-retour — or
 * celui-ci comprend le `revalidatePath` de l'action, c'est-à-dire le re-rendu de **tout** le
 * planning : on remplissait une partie et on ne pouvait plus toucher ni au thème ni à l'instructeur.
 *
 * **Un seul envoi en vol par case, et le dernier réglage fait foi** (`file-envoi.ts`). Ce qui était
 * faux avant : on partait à chaque geste, en comptant sur l'ordre d'arrivée, et on se contentait
 * d'ignorer les *réponses* dépassées. Trois réglages plus rapides que l'aller-retour laissaient donc
 * deux requêtes de trop en chemin, dont une porteuse d'un état déjà quitté ; et la case s'annonçait
 * « enregistrée » dès la première revenue, alors que la dernière n'était même pas partie — un
 * rechargement au mauvais moment (ou une fenêtre fermée) emportait le geste le plus récent sans que
 * rien ne l'ait laissé paraître. Désormais l'attente ne garde que l'état **final** voulu, et
 * `data-enregistrement` ne passe à `ok` qu'une fois la case au repos.
 */
export function CaseEditeur({
  sessionId,
  valeur,
  compact = false,
  discret = false,
}: {
  /** Séance à laquelle la partie appartient — sert seulement à reconnaître un atelier souhaité ici */
  sessionId: string;
  valeur: CasePlanning;
  compact?: boolean;
  discret?: boolean;
}) {
  const options = useOptionsCase();
  // Monté par la grille en mode modification : la case accumule au lieu d'envoyer (voir `ContexteBrouillon`).
  const brouillon = useBrouillon();
  // Listes complétées en arrière-plan une fois la page prête (voir ContexteOptions)
  const completes = useListesCompletes();
  /*
   * **Une case qui se monte sur un brouillon en cours en part**, pas de la valeur du serveur : une
   * carte repliée puis dépliée remonte ses cases, et elles doivent montrer ce que la barre compte
   * encore comme « modifié », réglé à la main ou par la sélection multiple.
   */
  const depart = brouillon?.modifiees.get(valeur.id) ?? paireServeur(valeur);
  const [instructeurId, setInstructeurId] = useState(depart.instructeurId);
  const [instructeurSecondId, setInstructeurSecondId] = useState(depart.instructeurSecondId);
  const [theme, setTheme] = useState(depart.theme);
  const [description, setDescription] = useState(depart.description);
  /**
   * La description est-elle en cours de saisie ? C'est ce qui décide d'afficher l'avertissement de
   * publication, comme le champ du nom d'une partie le faisait avant de disparaître : l'écrire en
   * permanence sous chacune des parties de chacune des séances noierait la carte.
   */
  const [descriptionEnSaisie, setDescriptionEnSaisie] = useState(false);
  const [niveau, setNiveau] = useState<Niveau>(depart.niveau);
  const [autre, setAutre] = useState(!depart.theme ? false : !options.themes.includes(depart.theme));
  /**
   * « Autre… » vient-il d'être choisi **ici** ? La saisie libre ne prend le curseur que dans ce
   * cas-là. Un thème libre déjà enregistré (les ateliers du planning en portent) ouvre la même
   * saisie au chargement de la page : avec un `autoFocus` inconditionnel, la dernière case de la
   * grille happait le curseur — clavier déplié sur téléphone, page ramenée sur elle — et le premier
   * clic ailleurs valait un `onBlur`, donc un enregistrement que personne n'avait demandé.
   */
  const [autreDemande, setAutreDemande] = useState(false);
  const [etat, setEtat] = useState<"idle" | "ok" | "erreur">("idle");
  const [message, setMessage] = useState<string | null>(null);
  // Listes déroulantes déjà approchées : leurs entrées sont alors toutes rendues (voir `personnesRendues`)
  const [ouvertes, setOuvertes] = useState({ personnes: false, seconds: false, themes: false, niveaux: false });
  const [, start] = useTransition();
  // Un envoi qui s'éternise : voir `lent` plus bas — le seul cas, avec l'échec, où la case parle.
  const [lent, setLent] = useState(false);
  const minuteur = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ce que le serveur disait de la case la dernière fois qu'on l'a regardé, et la file d'envoi de la
  // case : de quoi reconnaître un changement venu d'ailleurs sans écraser une saisie en cours.
  const [vuDuServeur, setVuDuServeur] = useState(() => paireServeur(valeur));
  const file = useRef<FileEnvoi>(fileInitiale(paireServeur(valeur)));
  const partieId = valeur.id;
  const label = valeur.libelle;
  /**
   * Clé de cette case dans le registre de la garde de fermeture : **l'identifiant de la partie**.
   * Il désigne la case, pas son rendu — la même partie montrée à deux endroits (le planning et
   * l'écran de sa séance) ne doit pas s'y compter deux fois.
   */
  const cle = partieId;
  /**
   * Le seul endroit qui écrit la file. Le registre de la garde le suit à chaque mouvement : tant
   * qu'il reste un envoi en vol ou en attente, fermer l'onglet ferait perdre le réglage, et le
   * navigateur pose la question (`garde-fermeture.ts`).
   */
  const majFile = (nouvelle: FileEnvoi): void => {
    file.current = nouvelle;
    marquerEnAttente(cle, !auRepos(nouvelle));
  };

  /* La garde vit tant qu'une case est à l'écran ; au démontage, cette case-là n'a plus rien à perdre. */
  useEffect(() => {
    const debrancher = brancherGardeFermeture();
    return () => {
      marquerEnAttente(cle, false);
      debrancher();
    };
  }, [cle]);
  const texte = compact ? "text-sm" : "text-base";
  const hauteur = compact ? "min-h-9" : "min-h-12";
  // Emplacement d'en-tête (« Cours » / « Atelier », vide sinon), puis le contenu : toutes les parties
  // d'une même carte partagent la même ossature, elles se lisent donc en colonne sans décalage.
  const hauteurEntete = compact ? "min-h-5 text-xs" : "min-h-6 text-sm";
  const hauteurContenu = options.modifiable ? hauteur : compact ? "min-h-6" : "min-h-7";
  const boite = `flex flex-col gap-1 rounded-lg px-1.5 ${compact ? "py-1" : "py-1.5"}`;
  // Une option est volontairement plus discrète que le cours : bordure pointillée, pas d'ombre
  const classeChamp = `${hauteur} w-full rounded-lg border px-2 ${texte} text-texte focus:border-primaire ${
    discret ? "border-dashed border-bordure/80 bg-transparent" : "border-bordure bg-surface shadow-champ"
  }`;
  /**
   * Le champ du second instructeur, d'un cran en retrait : c'est lui qui **assiste**, et la case doit
   * le dire sans l'écrire. Fond transparent, trait pointillé et texte secondaire — la même grammaire
   * que les options. Il reste un champ plein format : « secondaire » qualifie le rôle,
   * pas la cible tactile, qui tient les 48 px comme les autres.
   */
  const classeChampSecond = `${hauteur} w-full rounded-lg border border-dashed border-bordure/70 bg-transparent px-2 ${texte} text-texte-secondaire focus:border-primaire`;
  /**
   * **Le niveau et la description attendent le thème**, comme le second attend le premier : ils
   * précisent ce qu'on travaille, et sans thème ils ne précisent rien. Même retrait visuel que le
   * second (`classeChampSecond`). Une case qui porte déjà l'un des deux sans thème les montre
   * quand même : une valeur cachée qu'on ne pourrait plus relire serait pire qu'un champ en trop.
   */
  const detailsVisibles = theme.trim() !== "" || description.trim() !== "" || niveau !== NIVEAU_DEFAUT;

  /**
   * La case suit le serveur quand il dit autre chose qu'elle — atelier programmé entre-temps,
   * changement fait par quelqu'un d'autre, ou enregistrement refusé. C'est une mise à jour ciblée,
   * pas un rechargement : elle n'a lieu que si rien n'est en vol **et** que rien n'a été saisi
   * depuis le dernier envoi, pour ne jamais écraser ce que la personne est en train de régler.
   */
  const duServeur = paireServeur(valeur);
  if (!pairesEgales(vuDuServeur, duServeur)) {
    setVuDuServeur(duServeur);
    if (auRepos(file.current) && pairesEgales({ instructeurId, instructeurSecondId, theme, description, niveau }, file.current.applique)) {
      majFile(suivreServeur(file.current, duServeur));
      setInstructeurId(duServeur.instructeurId);
      setInstructeurSecondId(duServeur.instructeurSecondId);
      setTheme(duServeur.theme);
      // Une description tapée ailleurs reprend la main — mais seulement au repos, donc jamais
      // pendant qu'on écrit dans celle-ci (même règle que les quatre autres champs).
      setDescription(duServeur.description);
      setNiveau(duServeur.niveau);
      setAutre(!duServeur.theme ? false : !options.themes.includes(duServeur.theme));
    }
  }

  /**
   * **La case reprend ce qu'on lui impose d'ailleurs** — la sélection multiple du planning (« Régler
   * une partie » sur plusieurs séances) écrit dans le même brouillon, et la case doit le **montrer** :
   * sans ce retour, la barre compterait la case modifiée pendant que ses listes afficheraient l'ancien
   * contenu, et le premier réglage fait ensuite à la main renverrait cet ancien contenu par-dessus
   * (la case pousse toujours son état entier). Le numéro de tour dit si l'imposition est neuve : voir
   * `brouillon.ts`, qui explique pourquoi on ne compare pas simplement les valeurs.
   */
  const imposee = brouillon?.imposees.get(partieId) ?? null;
  // Au montage, ce qui a déjà été imposé est déjà dans `depart` : on ne le reprend pas une seconde fois.
  const [tourVu, setTourVu] = useState(imposee?.tour ?? 0);
  const aReprendre = paireImposee(imposee, tourVu);
  if (imposee && aReprendre) {
    setTourVu(imposee.tour);
    setInstructeurId(aReprendre.instructeurId);
    setInstructeurSecondId(aReprendre.instructeurSecondId);
    setTheme(aReprendre.theme);
    setDescription(aReprendre.description);
    setNiveau(aReprendre.niveau);
    setAutre(!aReprendre.theme ? false : !options.themes.includes(aReprendre.theme));
    setAutreDemande(false);
  }

  /**
   * Fait partir un envoi et attend sa réponse — **un seul à la fois par case** (`file-envoi.ts`) :
   * la réponse revenue, c'est l'état en attente, s'il y en a un, qui prend la place. Un échec
   * **réseau ou serveur** (session expirée, déploiement entre-temps, coupure) fait rejeter l'action :
   * sans ce `catch`, React relance l'erreur au rendu suivant et, faute de frontière d'erreur, c'est
   * toute la page qui disparaît — d'où le « tout est figé jusqu'à ce que je recharge ». Ici l'échec
   * se dit dans la case, et la case reste réglable.
   */
  const demarrer = (envoi: Envoi): void => {
    /*
     * **Silence quand tout va bien, parole quand ça va mal.**
     *
     * Rien ne s'affiche ni pendant l'envoi ni après : le réglage est déjà dans la liste déroulante,
     * c'est lui la confirmation. Un mot d'attente accroché à `pending` avait de surcroît le défaut
     * de ne jamais partir — la transition ne retombe qu'après le re-rendu de tout le planning
     * déclenché par `revalidatePath`, et si la réponse n'arrive jamais (coupure réseau, serveur
     * redémarré, déploiement au mauvais moment), la case restait sur « Enregistrement… » jusqu'au
     * rechargement de la page.
     *
     * Restent deux cas où le silence serait un mensonge : l'échec, dit tout de suite, et l'envoi
     * toujours pas revenu au bout de `ATTENTE_ANORMALE_MS`. Ce minuteur suit la **promesse**
     * elle-même, pas la transition : il s'arrête quand la case retrouve le repos, quoi que fasse le
     * re-rendu. La case reste réglable pendant tout ce temps.
     */
    if (minuteur.current) clearTimeout(minuteur.current);
    setLent(false);
    minuteur.current = setTimeout(() => setLent(true), ATTENTE_ANORMALE_MS);
    start(async () => {
      let echec: string | null = null;
      try {
        const res =
          envoi.type === "case"
            ? await enregistrerCase({ partieId, ...envoi.paire })
            : await programmerAtelierDansCase({ partieId, atelierId: envoi.atelierId });
        echec = res.erreur ?? null;
      } catch {
        echec = "Enregistrement impossible — vérifie ta connexion et recommence.";
      }
      const { file: apres, partir } = retour(file.current, !echec);
      majFile(apres);
      if (echec) {
        setEtat("erreur");
        setMessage(echec);
      } else if (partir) {
        // Réussi, mais un réglage plus récent reste à écrire : la case n'est pas enregistrée, elle se tait
        setEtat("idle");
        setMessage(null);
      } else setEtat("ok");
      if (partir) demarrer(partir);
      else {
        if (minuteur.current) clearTimeout(minuteur.current);
        setLent(false);
      }
    });
  };

  /**
   * Un réglage de plus. Il part tout de suite si la case est libre, sinon il attend son tour — et
   * remplace alors l'attente précédente, qui décrit un état déjà quitté. Un réglage qui rend
   * exactement ce que le serveur a déjà ne part pas du tout : la case n'a alors rien à annoncer.
   */
  const lancer = (envoi: Envoi) => {
    const { file: apres, partir } = poser(file.current, envoi);
    if (!partir && auRepos(apres)) return;
    majFile(apres);
    setEtat("idle");
    setMessage(null);
    if (partir) demarrer(partir);
  };

  /**
   * **Le seul entonnoir du contenu d'une case** — les cinq réglages passent par lui, et c'est ce
   * qui permet au mode modification du planning de n'avoir qu'un point de branchement.
   *
   * Avec un brouillon : on **pose** l'état voulu, rien ne part, et c'est « Enregistrer » qui écrira
   * tout d'un coup (`enregistrerCases`). Sans brouillon — la fiche d'une séance, où l'on règle une
   * seule séance — l'enregistrement immédiat reste le bon comportement, avec sa file d'envoi.
   *
   * Ce qui ne passe **pas** par ici, et continue donc de partir tout seul : programmer un atelier
   * dans la case (`{ type: "atelier" }`, plus bas). C'est une décision à part, refusée quand la case
   * n'est pas libre, et la barre d'édition l'écrit.
   */
  const sauver = (v: Paire) => {
    if (brouillon) {
      /*
       * **Une case revenue à ce que le serveur porte sort du brouillon.** Sans ça, régler puis
       * dérégler laisserait « 1 case modifiée » au compteur, retiendrait la fermeture de l'onglet pour
       * rien, et ferait partir une écriture sans objet — que le serveur refuserait poliment (« rien à
       * changer »), mais après avoir fait croire à l'écran qu'il enregistrait quelque chose. C'est
       * **ici** que la comparaison se fait : la case est la seule à connaître la valeur du serveur.
       */
      if (pairesEgales(v, vuDuServeur)) brouillon.oublier(partieId);
      else brouillon.poser(partieId, v);
      return;
    }
    lancer({ type: "case", paire: v });
  };
  /** Cette case porte-t-elle une modification pas encore enregistrée ? */
  const enAttente = brouillon?.modifiees.has(partieId) ?? false;

  const choisirTheme = (v: string) => {
    if (v.startsWith("atelier:")) {
      lancer({ type: "atelier", atelierId: v.slice("atelier:".length) });
      return;
    }
    if (v === AUTRE) {
      setAutre(true);
      setAutreDemande(true);
      setTheme("");
      return;
    }
    setAutre(false);
    setTheme(v);
    sauverTheme(v);
  };
  /** Le thème qui s'efface emporte le niveau et la description — le serveur fait de même. */
  const sauverTheme = (t: string) => {
    const d = t ? description : "";
    const n = t ? niveau : NIVEAU_DEFAUT;
    setDescription(d);
    setNiveau(n);
    sauver({ instructeurId, instructeurSecondId, theme: t, description: d, niveau: n });
  };

  if (valeur.atelier) {
    return (
      <div
        className={`${boite} bg-vert-doux ${texte}`}
        title={`Atelier « ${valeur.atelier.titre} »${valeur.instructeur ? ` — ${valeur.instructeur}` : ""}${valeur.atelier.materiel ? ` · équipement : ${valeur.atelier.materiel}` : ""}`}
      >
        <span className={`flex min-w-0 items-center gap-1 font-semibold text-vert ${hauteurEntete}`}>
          <Icone nom="outil" taille={compact ? 14 : 16} />
          Atelier
        </span>
        {/* Hors affichage resserré, le titre se met à la ligne : un atelier ne doit jamais être lu à moitié */}
        <span className={`flex items-center font-semibold ${hauteurContenu} ${compact ? "truncate" : ""}`}>{valeur.atelier.titre}</span>
        <span className={`flex min-w-0 flex-wrap items-center gap-1 ${hauteurContenu}`}>
          {valeur.instructeur && (
            <>
              {/* Même règle que les cases ordinaires (`champsLus`) : la valeur porte son intitulé */}
              <span className="shrink-0 text-[0.85em] text-texte-secondaire">Instructeur</span>
              {valeur.instructeurId && <PastillePersonne id={valeur.instructeurId} taille={8} />}
              <span className={compact ? "truncate" : "break-words"}>{compact ? abreger(valeur.instructeur) : valeur.instructeur}</span>
              {valeur.instructeurSecond && <Second nom={valeur.instructeurSecond} id={valeur.instructeurSecondId} compact={compact} />}
            </>
          )}
        </span>
      </div>
    );
  }

  /**
   * **La case telle qu'un membre la lit** : les valeurs renseignées, chacune sous son nom, et rien
   * d'autre.
   *
   * Ce qu'on voyait avant : quatre valeurs empilées sans intitulé — deux noms, un thème, un
   * niveau —, et des tirets à la place de ce qui n'était pas rempli. Impossible de savoir, en
   * lisant, lequel des deux noms encadre ni ce que le troisième mot désigne ; et les tirets
   * occupaient la carte à annoncer des cases vides. Les deux règles sont tenues ailleurs, une fois
   * (`champsLus`) : l'intitulé devant chaque valeur, et **rien du tout** pour un champ laissé à
   * `----------`.
   *
   * Les champs s'écrivent en rangée qui se replie : sur un téléphone ils s'empilent, sur la carte
   * pleine largeur ils tiennent sur une ligne. Aucun n'est tronqué — c'est précisément ce que la
   * pleine largeur est venue offrir.
   */
  if (!options.modifiable) {
    const champs = champsLus(valeur);
    // Une case qui n'a plus rien à dire ne rend rien : les parties vides sont déjà écartées en
    // amont (`partiesVisibles`), mais une case peut se vider pendant qu'on la regarde.
    if (champs.length === 0) return null;
    // La pastille de couleur identifie la personne d'un coup d'œil — seuls les deux champs qui en
    // nomment une en portent une.
    const pastille: Record<string, string | null> = { Instructeur: valeur.instructeurId, "Second instructeur": valeur.instructeurSecondId };
    return (
      <div className={`${boite} ${texte}`}>
        <dl className="flex flex-wrap gap-x-6 gap-y-0.5">
          {champs.map((c) => (
            /* La description prend sa propre ligne (`basis-full`) : c'est une phrase, et la mêler aux
               quatre valeurs courtes de la rangée les renverrait toutes à la ligne. */
            <div key={c.intitule} className={`flex min-w-0 items-baseline gap-1.5 ${c.intitule === "Description" ? "basis-full" : ""}`}>
              <dt className="shrink-0 text-[0.85em] text-texte-secondaire">{c.intitule}</dt>
              <dd className="flex min-w-0 items-baseline gap-1 break-words font-semibold">
                {pastille[c.intitule] && <PastillePersonne id={pastille[c.intitule]!} taille={8} className="self-center" />}
                {c.valeur}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    );
  }

  const themeConnu = options.themes.includes(theme);
  const modif = valeur.modifiePar && valeur.modifieLe ? `Modifié par ${valeur.modifiePar} le ${formatDateHeure(new Date(valeur.modifieLe))}` : undefined;
  // Le premier contact précède l'ouverture du panneau (pointeur) comme la navigation au clavier (focus) :
  // les entrées sont en place avant d'être regardées. L'appui qui ouvre la liste arrive après le
  // `pointerdown`, donc après ce rendu — on n'ouvre jamais sur une liste encore réduite à sa valeur.
  const deplier = (liste: "personnes" | "seconds" | "themes" | "niveaux") =>
    completes || ouvertes[liste] ? undefined : { onPointerDown: () => setOuvertes((o) => ({ ...o, [liste]: true })), onFocus: () => setOuvertes((o) => ({ ...o, [liste]: true })) };
  const deployee = {
    personnes: completes || ouvertes.personnes,
    seconds: completes || ouvertes.seconds,
    themes: completes || ouvertes.themes,
    niveaux: completes || ouvertes.niveaux,
  };

  const nomComplet = (p: { prenom: string; nom: string }) => (compact ? `${p.prenom} ${p.nom.charAt(0)}.` : `${p.prenom} ${p.nom}`);
  // Les entrées des listes, dans l'ordre où elles s'affichent. Ce sont exactement celles que la liste
  // native écrivait : même première entrée « aucun », même « Autre… », même groupe d'ateliers.
  const entreesInstructeur: EntreeListe[] = [
    // `----------` en tête : c'est la valeur par défaut, et le même signe pour les quatre réglages
    { valeur: "", libelle: LIBELLE_VIDE },
    ...personnesRendues(options.personnes, deployee.personnes, instructeurId).map((p) => ({
      valeur: p.id,
      libelle: nomComplet(p),
      couleur: couleurPersonne(p.id, p.couleur),
    })),
  ];
  /*
   * La liste du second : la même que celle du premier, **moins la personne déjà choisie** — encadrer
   * à deux suppose deux personnes, et se voir proposer son propre nom en second n'a aucun sens.
   * L'entrée vide y est `----------` comme partout ailleurs : « personne en second » disait la même
   * absence avec d'autres mots, et se faisait tronquer en « personne en sec… » dans la colonne.
   */
  const entreesSecond: EntreeListe[] = [
    { valeur: "", libelle: LIBELLE_VIDE },
    ...personnesRendues(options.personnes, deployee.seconds, instructeurSecondId)
      .filter((p) => p.id !== instructeurId)
      .map((p) => ({ valeur: p.id, libelle: nomComplet(p), couleur: couleurPersonne(p.id, p.couleur) })),
  ];
  const entreesTheme: EntreeListe[] = [
    { valeur: "", libelle: LIBELLE_VIDE },
    ...themesRendus(options.themes, deployee.themes, theme, autre).map((t) => ({ valeur: t, libelle: t })),
    // Un thème libre déjà enregistré : il n'est dans aucune liste commune, il se rend à part
    ...(!autre && theme && !themeConnu ? [{ valeur: theme, libelle: theme }] : []),
    ...(deployee.themes || autre ? [{ valeur: AUTRE, libelle: "Autre…" }] : []),
    /*
     * **Les ateliers ne se proposent que dans une case vide**.
     *
     * Programmer un atelier **remplace** tout le contenu de la case (instructeur, second, thème,
     * description, niveau : voir `placerAtelier`). Le groupe vivait au bas de cette liste pour
     * *toute* case modifiable : on ouvrait « Thème » pour corriger un mot sur un cours déjà réglé,
     * on descendait, on cliquait un atelier — et les cinq champs disparaissaient, sans confirmation.
     *
     * Le serveur refuse maintenant une case remplie (`programmerAtelierDansCase`) ; l'écran ne
     * l'offre donc plus, parce qu'un geste proposé pour être refusé fait peur pour rien. La case se
     * vide d'abord — geste explicite, journalisé avant/après —, et les ateliers réapparaissent.
     * `reglagesVides` est la **même** règle que celle du serveur, écrite une seule fois.
     */
    ...(deployee.themes && options.peutProgrammer && reglagesVides({ instructeur: instructeurId, instructeurSecond: instructeurSecondId, theme, description, niveau })
      ? options.ateliersDisponibles.map((a) => ({
          valeur: `atelier:${a.id}`,
          libelle: `${a.titre} — ${a.proposePar}${a.sessionId === sessionId ? " (souhaité ici)" : ""}`,
          // « validé » ne correspondait à aucun statut : la liste ne contient que les ateliers **en
          // attente de décision** (`PROPOSE`), et les placer dans une case est justement la
          // décision. Repéré en écrivant le guide de l'instructeur.
          groupe: "Programmer un atelier en attente",
        }))
      : []),
  ];

  /*
   * Les quatre niveaux, écrits comme les autres listes : fermée, la liste ne porte que sa valeur
   * courante. Quatre entrées paraissent peu — mais elles seraient répétées une fois par partie, soit
   * plusieurs centaines de fois sur un trimestre affiché en entier.
   */
  const entreesNiveau: EntreeListe[] = (deployee.niveaux ? NIVEAUX : [niveau]).map((n) => ({ valeur: n, libelle: libelleChoixNiveau(n) }));

  // Une case remplie se lit comme un bloc « Cours » (rouille), pendant qu'un atelier se lit en vert : même mise en forme
  const remplie = !!instructeurId || !!theme;
  return (
    // `data-enregistrement` ne se voit pas : c'est la prise des tests e2e, qui ont besoin de savoir
    // que le serveur a répondu là où l'écran, lui, ne dit plus rien.
    <div className={`${boite} ${remplie ? "bg-primaire-doux/50" : ""}`} title={modif} data-enregistrement={etat}>
      <span className={`flex items-center gap-1 font-semibold text-primaire ${hauteurEntete}`}>
        {remplie && (
          <>
            <Icone nom="epee" taille={compact ? 14 : 16} />
            Cours
          </>
        )}
      </span>
      {/* **Quatre réglages, quatre cases de la grille** : empilés sur téléphone, deux par deux dès
          640 px, et sur une seule rangée au-delà de 1280 px.

          Le `xl:grid-cols-4` était déjà là, mais la grille ne portait que **deux** enfants — les
          instructeurs d'un côté, le thème et le niveau de l'autre —, chacun empilant ses deux champs
          en colonne. Résultat : quatre colonnes déclarées, deux occupées, chaque champ réduit au
          quart de la carte et tous les noms tronqués (« Damien Roc… », « personne en sec… »), alors
          que la carte prend désormais toute la largeur. Les quatre champs sont maintenant des
          enfants directs, et la rangée existe vraiment. */}
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 xl:grid-cols-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <label className="sr-only" id={`${partieId}-instructeur-libelle`} htmlFor={`${partieId}-instructeur`}>
            Instructeur — {label}
          </label>
          <Intitule>Instructeur</Intitule>
          <ListeDeroulante
            id={`${partieId}-instructeur`}
            libelleId={`${partieId}-instructeur-libelle`}
            libelle={`Instructeur — ${label}`}
            className={classeChamp}
            // Liseré de la couleur d'identification de la personne choisie
            style={instructeurId ? { borderLeftWidth: 4, borderLeftColor: couleurPersonne(instructeurId, options.personnes.find((p) => p.id === instructeurId)?.couleur) } : undefined}
            valeur={instructeurId}
            entrees={entreesInstructeur}
            {...deplier("personnes")}
            onChoisir={(v) => {
              setInstructeurId(v);
              // Le premier qui s'efface emporte le second : il n'assiste plus personne. Et le
              // premier qui devient le second ferait doublon — on libère la place.
              const second = !v || v === instructeurSecondId ? "" : instructeurSecondId;
              setInstructeurSecondId(second);
              sauver({ instructeurId: v, instructeurSecondId: second, theme, description, niveau });
            }}
          />
        </div>
        {/* Le second ne s'affiche qu'une fois le premier choisi : un « second » sans premier ne veut
            rien dire. `empty:hidden` pour que la case de grille ne coûte pas un intervalle de vide
            tant qu'elle n'a rien à montrer. */}
        <div className="flex min-w-0 flex-col gap-1.5 empty:hidden">
          {instructeurId && (
            <>
              <label className="sr-only" id={`${partieId}-instructeur-second-libelle`} htmlFor={`${partieId}-instructeur-second`}>
                Second instructeur — {label}
              </label>
              <Intitule>Second instructeur</Intitule>
              <ListeDeroulante
                id={`${partieId}-instructeur-second`}
                libelleId={`${partieId}-instructeur-second-libelle`}
                libelle={`Second instructeur — ${label}`}
                className={classeChampSecond}
                valeur={instructeurSecondId}
                entrees={entreesSecond}
                {...deplier("seconds")}
                onChoisir={(v) => {
                  setInstructeurSecondId(v);
                  sauver({ instructeurId, instructeurSecondId: v, theme, description, niveau });
                }}
              />
            </>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <label className="sr-only" id={`${partieId}-theme-libelle`} htmlFor={`${partieId}-theme`}>
            Thème — {label}
          </label>
          <Intitule>Thème</Intitule>
          <ListeDeroulante
            id={`${partieId}-theme`}
            libelleId={`${partieId}-theme-libelle`}
            libelle={`Thème — ${label}`}
            className={classeChamp}
            valeur={autre ? AUTRE : theme}
            entrees={entreesTheme}
            {...deplier("themes")}
            onChoisir={choisirTheme}
          />
          {autre && (
            <input
              type="text"
              aria-label={`Thème libre — ${label}`}
              className={classeChamp}
              value={theme}
              maxLength={THEME_MAX}
              placeholder="Thème libre"
              autoFocus={autreDemande}
              onChange={(e) => setTheme(e.target.value)}
              onBlur={() => {
                const t = theme.trim();
                if (t !== theme) setTheme(t);
                sauverTheme(t);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
            />
          )}
        </div>
        {/* Le niveau vient en dernier : on choisit qui encadre et ce qu'on travaille avant de dire à qui ça s'adresse */}
        <div className="flex min-w-0 flex-col gap-1.5 empty:hidden">
          {detailsVisibles && (
            <>
              <label className="sr-only" id={`${partieId}-niveau-libelle`} htmlFor={`${partieId}-niveau`}>
                Niveau — {label}
              </label>
              <Intitule>Niveau</Intitule>
              <ListeDeroulante
                id={`${partieId}-niveau`}
                libelleId={`${partieId}-niveau-libelle`}
                libelle={`Niveau — ${label}`}
                className={classeChampSecond}
                valeur={niveau}
                entrees={entreesNiveau}
                {...deplier("niveaux")}
                onChoisir={(v) => {
                  const n = (NIVEAUX as readonly string[]).includes(v) ? (v as Niveau) : NIVEAU_DEFAUT;
                  setNiveau(n);
                  sauver({ instructeurId, instructeurSecondId, theme, description, niveau: n });
                }}
              />
            </>
          )}
        </div>
      </div>
      {/* **La description, sur toute la largeur et sous les autres réglages.**

          Elle n'entre pas dans la rangée des quatre listes, et pour une raison de forme : les quatre
          autres champs sont des *choix* de deux ou trois mots, celui-ci est une *phrase*. Réduit au
          quart de la carte, il aurait donné une zone de texte de trois mots de large à côté de listes
          déroulantes — et la description est le seul champ qu'on relit en entier avant d'enregistrer.

          Facultative : une case sans description ne montre rien du tout au club (`champsLus`), et
          l'immense majorité des parties s'en passent — le thème et le niveau suffisent. */}
      {detailsVisibles && (
        <div className="flex min-w-0 flex-col gap-1.5">
          <label className="sr-only" htmlFor={`${partieId}-description`}>
            Description — {label}
          </label>
          <Intitule>Description</Intitule>
          <textarea
            id={`${partieId}-description`}
            rows={compact ? 2 : 3}
            value={description}
            maxLength={PARTIE_DESCRIPTION_MAX}
            aria-describedby={`${partieId}-description-avertissement`}
            placeholder="Ce qu'on fera dans cette partie (facultatif)"
            className={`w-full resize-y rounded-lg border border-dashed border-bordure/70 bg-transparent px-2 py-1.5 ${texte} text-texte-secondaire focus:border-primaire`}
            onFocus={() => setDescriptionEnSaisie(true)}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={() => {
              setDescriptionEnSaisie(false);
              /* Même règle que le thème libre : on enregistre en quittant le champ, sur la valeur
                 nettoyée. Pas à la frappe — une phrase de trois lignes partirait cinquante fois, et la
                 file d'envoi n'a qu'une place d'attente par case. Pas sur Entrée non plus : dans une
                 zone de texte, Entrée est un retour à la ligne, et le voler serait un piège. */
              const d = description.trim();
              if (d !== description) setDescription(d);
              sauver({ instructeurId, instructeurSecondId, theme, description: d, niveau });
            }}
          />
          {/* **L'avertissement de publication** — la règle « ce qui est publié doit être annoncé à qui le
              saisit », dans les mêmes mots que portait le champ du nom d'une partie avant de disparaître.
              Toujours dans la page pour les lecteurs d'écran (`aria-describedby`), visible dès qu'on entre
              dans le champ. `text-base` et non `text-xs` : ce texte-là dit qu'un texte **sort du club**,
              et le cahier des charges ne connaît qu'un plancher de 16 px — il vaut d'abord pour ce qui
              prévient. */}
          <p id={`${partieId}-description-avertissement`} className={descriptionEnSaisie ? "text-base text-texte-secondaire" : "sr-only"}>
            Cette description est publiée sur les pages de partage et, si le club l&apos;a ouverte, par l&apos;API publique — visibles hors du club.{" "}
            {PARTIE_DESCRIPTION_MAX} signes au plus. Les noms des instructeurs, eux, ne sortent jamais.
          </p>
        </div>
      )}
      {/* **Un message d'erreur ne s'écrit pas en 12 px** : c'est la seule chose qui dise qu'un
          réglage du planning n'est **pas** enregistré, et elle était la plus petite de la case.
          `min-h-6` suit la nouvelle interligne, pour que l'apparition du message ne pousse pas la
          case qu'on est en train de remplir. */}
      <p className={`text-base font-semibold text-rouge ${compact ? "empty:hidden" : "min-h-6"}`} aria-live="polite">
        {etat === "erreur" ? message : lent ? "Toujours en cours — vérifie ta connexion et recommence." : ""}
      </p>
      {/* **La case dit qu'elle attend, et c'est indispensable en mode modification** : rien ne
          partant plus tout seul, le silence habituel voudrait dire « enregistré » alors que la
          valeur n'est que dans le navigateur. Le compte, lui, est dans la barre du bas ; ici on
          marque **laquelle**, pour qu'on retrouve ce qu'on a touché dans un trimestre entier. */}
      {enAttente && (
        <p className="text-sm font-semibold text-ocre" aria-live="polite">
          Modifié — pas encore appliqué
        </p>
      )}
    </div>
  );
}

/**
 * Celui qui **assiste**, en lecture : jamais seul, jamais sur sa propre ligne, toujours introduit
 * par « avec ». C'est ce petit mot qui dit lequel des deux mène — une virgule entre deux noms les
 * mettrait à égalité, ce qu'ils ne sont pas.
 */
function Second({ nom, id, compact }: { nom: string; id: string | null; compact: boolean }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1 text-texte-secondaire">
      <span className="text-[0.85em] font-normal">avec</span>
      {id && <PastillePersonne id={id} taille={6} />}
      <span className={`text-[0.9em] font-normal ${compact ? "truncate" : ""}`}>{compact ? abreger(nom) : nom}</span>
    </span>
  );
}
