/**
 * **L'état du lien personnel, en une colonne comparable**.
 *
 * Avant, cette information était répartie à trois endroits : une pastille « lien jamais ouvert » à
 * côté du nom (et seulement pour un compte actif sans mot de passe), une phrase « lien en cours » /
 * « aucun lien en cours » **dans le volet** de la personne, et rien du tout pour qui n'a pas
 * d'adresse. Savoir qui n'était jamais entré demandait donc d'ouvrir chaque volet, un par un.
 *
 * Ce module ne dépend de rien et ne lit aucune base : il **traduit en mots** cinq booléens déjà
 * calculés par la page (deux agrégats sur les invitations des seules lignes affichées). C'est tout
 * l'intérêt de le sortir du JSX — la règle se teste, et la colonne ne peut pas raconter autre chose
 * que ce que le bouton d'envoi de la même ligne fait.
 *
 * **Le ton n'est pas décoratif, et il a une règle** : l'ocre dit « **cette personne ne peut pas
 * entrer aujourd'hui, et il y a un geste à faire** ». Rien d'autre n'est coloré — une colonne de
 * douze pastilles colorées ne distingue plus rien. Trois états la portent donc, et ils ont tous la
 * même conséquence pour le bureau, pas la même cause : aucun lien ne lui a été envoyé, son lien
 * n'a jamais été ouvert, ou son lien n'est plus valable — à chaque fois **sans mot de passe pour
 * compenser**. Avec un mot de passe, la personne entre par la page de connexion : son lien dormant
 * n'est pas un problème à régler, et la pastille redevient neutre.
 *
 * Restent neutres, et c'est voulu : un compte **désactivé** (c'est une décision du bureau, pas un
 * incident) et un compte **sans adresse** (la colonne dit l'empêchement ; ajouter une adresse est un
 * geste de la fiche, pas de la colonne).
 */

/** Les tons de `Pastille` que cette colonne emploie. Deux, pas cinq : voir l'en-tête du module. */
export type TonLien = "neutre" | "ocre";

export type EtatLien = {
  /** Le mot de la colonne, court parce qu'il se lit en balayant douze lignes. */
  libelle: string;
  ton: TonLien;
  /** La phrase entière, portée par l'infobulle de la cellule : le mot court ne dit pas tout. */
  detail: string;
};

/**
 * Ce que la page sait d'une ligne, et qui suffit à dire où en est son lien. **Des booléens, jamais
 * une adresse ni un jeton** : ce type traverse la frontière du navigateur avec la ligne.
 */
export type LigneEtatLien = {
  /** Le compte est actif. Désactivé, son lien ne connecte plus personne : rien d'autre à dire. */
  actif: boolean;
  /** Une adresse email existe : sans elle, aucun lien ne peut partir. */
  aUnEmail: boolean;
  /** Un mot de passe existe : la personne entre sans son lien, « jamais ouvert » n'est plus une alerte. */
  aUnMotDePasse: boolean;
  /** Un lien de cette personne a déjà servi, au moins une fois, toutes périodes confondues. */
  dejaOuvert: boolean;
  /** Un lien encore valable existe pour la période dont les liens partent (ni révoqué, ni échu). */
  lienEnCours: boolean;
  /**
   * Un lien **existe** pour cette période, valable ou non. C'est ce qui distingue « on lui a envoyé
   * son lien et il ne s'en sert pas » de « on ne lui a jamais rien envoyé » — deux situations que
   * la colonne confondait sous le même ocre, et qui demandent deux gestes opposés : appeler la
   * personne, ou cliquer sur « Envoyer ».
   */
  lienEnvoye: boolean;
  /** Une période vers laquelle envoyer existe : sans elle, « aucun lien en cours » ne veut rien dire. */
  periodeDeLien: boolean;
};

/**
 * **L'ordre des questions est l'ordre des causes**, et il n'est pas interchangeable :
 *
 * 1. **le compte est-il actif ?** Désactivé, son lien a été révoqué : parler de « lien en cours »
 *    serait faux, et parler de « jamais ouvert » accuserait quelqu'un à qui on a coupé l'accès ;
 * 2. **y a-t-il une adresse ?** Sans elle, il n'y a pas de lien du tout et il n'y en aura pas : la
 *    colonne dit l'empêchement, pas un état d'attente. C'est aussi ce que la page dit déjà ailleurs
 *    (« l'équipe coche sa présence à sa place ») ;
 * 3. **le lien a-t-il déjà servi ?** C'est la question de la colonne. Non, et alors deux cas que la
 *    première version confondait : si **aucun lien ne lui a été envoyé**, la colonne dit « Aucun lien
 *    envoyé » — dire « son lien personnel n'a jamais été ouvert » de quelqu'un qui n'en a pas est un
 *    mensonge, et le geste n'est pas le même ; sinon « Jamais ouvert ». Les deux en **ocre seulement
 *    si la personne n'a pas de mot de passe** : avec un mot de passe elle entre déjà. C'est exactement
 *    la condition de l'ancienne pastille (`!m.passwordHash && jamaisOuvert && m.actif`), reprise sans
 *    la perdre ;
 * 4. **sinon, où en est le lien de la période courante ?** « Lien en cours » ou « Aucun lien en
 *    cours » — ce dernier en **ocre sans mot de passe** : un lien révoqué ou échu, c'est quelqu'un
 *    qui ne peut plus entrer, et c'est précisément ce que la colonne sert à repérer. Et s'il
 *    n'existe aucune période vers laquelle envoyer, on n'invente pas un manque : la colonne dit
 *    seulement « Déjà ouvert ».
 */
export function etatDuLien(ligne: LigneEtatLien): EtatLien {
  if (!ligne.actif) {
    return {
      libelle: "Sans accès",
      ton: "neutre",
      detail: "Compte désactivé : son lien personnel a été révoqué et ne connecte plus.",
    };
  }
  if (!ligne.aUnEmail) {
    return {
      libelle: "Sans adresse",
      ton: "neutre",
      detail: "Sans adresse email, aucun lien personnel ne peut partir : l'équipe coche sa présence à sa place.",
    };
  }
  if (!ligne.dejaOuvert) {
    if (ligne.periodeDeLien && !ligne.lienEnvoye) {
      return ligne.aUnMotDePasse
        ? {
            libelle: "Aucun lien envoyé",
            ton: "neutre",
            detail: "Aucun lien personnel ne lui a été envoyé pour la période en cours, mais elle s'est donné un mot de passe : elle entre par la page de connexion.",
          }
        : {
            libelle: "Aucun lien envoyé",
            ton: "ocre",
            detail: "Aucun lien personnel ne lui a été envoyé, et elle n'a pas de mot de passe : elle ne peut pas entrer. Le bouton « Envoyer le lien » est dans son volet.",
          };
    }
    return ligne.aUnMotDePasse
      ? {
          libelle: "Jamais ouvert",
          ton: "neutre",
          detail: "Son lien personnel n'a jamais servi, mais elle s'est donné un mot de passe : elle entre par la page de connexion.",
        }
      : {
          libelle: "Jamais ouvert",
          ton: "ocre",
          detail: "Son lien personnel lui a été envoyé et n'a jamais été ouvert, et elle n'a pas de mot de passe : elle n'est jamais entrée.",
        };
  }
  if (!ligne.periodeDeLien) {
    return { libelle: "Déjà ouvert", ton: "neutre", detail: "Son lien personnel a déjà servi. Aucune période n'envoie de lien en ce moment." };
  }
  if (ligne.lienEnCours) {
    return { libelle: "Lien en cours", ton: "neutre", detail: "Son lien personnel a déjà servi et un lien valable existe pour la période en cours." };
  }
  return ligne.aUnMotDePasse
    ? {
        libelle: "Aucun lien en cours",
        ton: "neutre",
        detail:
          "Son lien personnel a déjà servi, mais aucun lien valable n'existe pour la période en cours — elle entre par son mot de passe en attendant.",
      }
    : {
        libelle: "Aucun lien en cours",
        ton: "ocre",
        detail:
          "Son lien personnel a déjà servi, mais il n'est plus valable (échu ou remplacé) et elle n'a pas de mot de passe : elle ne peut plus entrer.",
      };
}
