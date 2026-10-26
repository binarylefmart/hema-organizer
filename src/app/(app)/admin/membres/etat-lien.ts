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
 * **Le ton est un code couleur, et il a une règle** (demande de Delta) — une couleur
 * par conséquence pour le bureau, jamais par cause, pour qu'un balayage de la colonne suffise :
 *
 * - **vert** : la personne entre — son lien a servi et vaut encore, ou elle a activé son compte
 *   (mot de passe créé), lien utilisé ou non. Rien à faire ;
 * - **ocre** : en attente — un lien valable lui a été envoyé, elle ne l'a pas encore ouvert. Le
 *   geste, s'il en faut un, est de l'appeler ;
 * - **rouge** : bloquée — aucun lien envoyé, ou un lien qui n'est plus valable, et pas de mot de
 *   passe pour compenser. Elle ne peut pas entrer aujourd'hui : « Envoyer le lien » ;
 * - **neutre** : hors jeu — compte désactivé (décision du bureau, pas un incident), sans adresse
 *   (ajouter une adresse est un geste de la fiche), ou aucune période n'envoie de lien.
 *
 * **Le libellé dit la situation entière** (« Compte activé · lien jamais utilisé », « Lien envoyé ·
 * jamais ouvert »), parce que la couleur seule ne se lit pas pour tout le monde ; l'infobulle porte
 * la phrase complète et le geste.
 */

/** Les tons de `Pastille` que cette colonne emploie : voir l'en-tête du module. */
export type TonLien = "vert" | "ocre" | "rouge" | "neutre";

/** La légende du code couleur, affichée au-dessus de l'annuaire : les mêmes mots que l'en-tête. */
export const LEGENDE_LIEN: ReadonlyArray<{ ton: TonLien; texte: string }> = [
  { ton: "vert", texte: "entre sans souci" },
  { ton: "ocre", texte: "lien envoyé, pas encore ouvert" },
  { ton: "rouge", texte: "ne peut pas entrer : lien à envoyer" },
  { ton: "neutre", texte: "hors jeu (désactivé, sans adresse…)" },
];

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
 * 1. **le compte est-il actif ?** Désactivé, son lien a été révoqué : parler de son lien serait faux ;
 * 2. **y a-t-il une adresse ?** Sans elle, aucun lien ne peut partir : la colonne dit l'empêchement ;
 * 3. **le lien a-t-il déjà servi ?** Non : aucun lien envoyé, un lien envoyé et encore valable, ou un
 *    lien envoyé qui ne vaut plus — trois situations, trois gestes (envoyer, appeler, renvoyer) ;
 * 4. **sinon, le lien de la période vaut-il encore ?** Sans période vers laquelle envoyer, on
 *    n'invente pas un manque.
 *
 * À chaque étape, **un mot de passe change la conséquence, pas la cause** : la personne a activé son
 * compte et entre par la page de connexion, la pastille passe au vert et le dit (« Compte activé · … »).
 */
export function etatDuLien(ligne: LigneEtatLien): EtatLien {
  if (!ligne.actif) {
    return { libelle: "Compte désactivé", ton: "neutre", detail: "Compte désactivé : son lien personnel a été révoqué et ne connecte plus." };
  }
  if (!ligne.aUnEmail) {
    return {
      libelle: "Sans adresse email",
      ton: "neutre",
      detail: "Sans adresse email, aucun lien personnel ne peut partir : l'équipe coche sa présence à sa place.",
    };
  }
  const active = ligne.aUnMotDePasse;
  const parMotDePasse = "Elle a activé son compte (mot de passe créé) : elle entre par la page de connexion.";
  if (!ligne.dejaOuvert) {
    if (ligne.periodeDeLien && !ligne.lienEnvoye) {
      return active
        ? { libelle: "Compte activé · aucun lien envoyé", ton: "vert", detail: `Aucun lien personnel ne lui a été envoyé pour la période en cours. ${parMotDePasse}` }
        : {
            libelle: "Aucun lien envoyé",
            ton: "rouge",
            detail: "Aucun lien personnel ne lui a été envoyé, et elle n'a pas de mot de passe : elle ne peut pas entrer. Le bouton « Envoyer le lien » est dans son volet.",
          };
    }
    if (ligne.periodeDeLien && !ligne.lienEnCours) {
      return active
        ? { libelle: "Compte activé · lien jamais utilisé", ton: "vert", detail: `Son lien personnel n'a jamais servi et n'est plus valable (échu ou révoqué). ${parMotDePasse}` }
        : {
            libelle: "Lien expiré sans avoir servi",
            ton: "rouge",
            detail: "Son lien personnel lui a été envoyé, n'a jamais été ouvert et n'est plus valable (échu ou révoqué) ; elle n'a pas de mot de passe : elle n'est jamais entrée. Renvoyer le lien.",
          };
    }
    return active
      ? { libelle: "Compte activé · lien jamais utilisé", ton: "vert", detail: `Son lien personnel n'a jamais servi. ${parMotDePasse}` }
      : ligne.periodeDeLien
        ? {
            libelle: "Lien envoyé · jamais ouvert",
            ton: "ocre",
            detail: "Son lien personnel lui a été envoyé, il est valable, mais elle ne l'a jamais ouvert et n'a pas de mot de passe : elle n'est jamais entrée. L'appeler.",
          }
        : { libelle: "Lien jamais utilisé", ton: "neutre", detail: "Son lien personnel n'a jamais servi. Aucune période n'envoie de lien en ce moment." };
  }
  if (!ligne.periodeDeLien) {
    return { libelle: "Lien utilisé · hors période", ton: "neutre", detail: "Son lien personnel a déjà servi. Aucune période n'envoie de lien en ce moment." };
  }
  if (ligne.lienEnCours) {
    return { libelle: "Lien en cours · utilisé", ton: "vert", detail: "Son lien personnel a déjà servi et un lien valable existe pour la période en cours." };
  }
  return active
    ? {
        libelle: "Compte activé · lien expiré",
        ton: "vert",
        detail: `Son lien personnel a déjà servi, mais aucun lien valable n'existe pour la période en cours. ${parMotDePasse}`,
      }
    : {
        libelle: "Lien expiré",
        ton: "rouge",
        detail: "Son lien personnel a déjà servi, mais il n'est plus valable (échu ou remplacé) et elle n'a pas de mot de passe : elle ne peut plus entrer. Renvoyer le lien.",
      };
}
