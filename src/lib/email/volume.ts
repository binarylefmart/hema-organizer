import { db } from "@/lib/db";
import { addDays, todayIso } from "@/lib/dates";
import {
  DESCRIPTIONS,
  TYPES_ROUTABLES,
  modeEnvoiDans,
  type ModeEnvoi,
  type PreferencesNotifications,
  type TypeNotification,
} from "@/lib/notifications/preferences";

/**
 * **Combien d'emails ce club envoie-t-il, et son serveur en accepte-t-il autant ?**
 *
 * C'est la moitié de la valeur du réglage « chacun le sien / la liste » : aujourd'hui, un gros club
 * découvre le mur quand ses membres ne reçoivent plus rien. Le SMTP gratuit a coupé au milieu de la
 * liste, personne n'a rien vu, et le seul indice est un cours à moitié vide.
 *
 * L'écran des notifications annonce donc, en clair :
 * « 42 envois par récap × 2 cours par semaine = 84 envois par semaine pour le seul récap », puis le
 * total régulier qui y ajoute les deux vagues de rappel (252), le quota déclaré, et une alerte quand
 * le prévu le dépasse.
 *
 * **Le produit affiché doit être refaisable de tête.** L'écran a longtemps écrit « 42 membres × 2
 * cours = 252 envois » : 42 × 2 font 84, et 252 est le total récap + rappels. Un chiffre qu'on ne
 * peut pas vérifier soi-même est un chiffre qu'on cesse de croire — et c'est précisément celui sur
 * lequel un bureau décide de passer ou non sur la liste. D'où {@link EstimationEnvois.recapParSemaine},
 * qui est exactement le produit des deux nombres montrés, dans les deux modes d'envoi.
 *
 * **Le modèle est volontairement pessimiste** sur un point : le « pire jour » suppose qu'un récap et
 * les deux vagues de rappel (J-7, J-2) tombent le même jour. C'est possible dès trois cours par
 * semaine, et un quota se compare à un pic, pas à une moyenne — une alarme qui se déclenche un peu
 * trop tôt rend service, une alarme qui se tait la veille du mur ne sert à rien.
 *
 * Ce que le modèle **ne compte pas** dans le volume régulier : les annulations, les alertes
 * « peu de monde » et les annonces d'événement. Elles sont occasionnelles — les inscrire dans un
 * total hebdomadaire ferait un chiffre faux dans les deux sens. Elles ont leur ligne, avec leur coût
 * unitaire, et c'est ce qu'on veut savoir : « si j'annule un cours, ce sont 42 emails de plus ».
 */

/** Ce que coûte une notification, ligne par ligne, telle que l'écran l'affiche. */
export type LigneVolume = {
  type: TypeNotification;
  titre: string;
  mode: ModeEnvoi;
  /** Nombre d'emails pour **un** déclenchement (un cours, une annulation, un événement). */
  parEnvoi: number;
  /** Nombre d'emails par semaine, ou `null` si la notification est occasionnelle. */
  parSemaine: number | null;
  /** Quand elle part, en quelques mots — pour que le chiffre se comprenne sans calcul. */
  cadence: string;
};

export type EstimationEnvois = {
  membresAvecEmail: number;
  coursParSemaine: number;
  /** Nombre d'instructeurs joignables : c'est l'assiette de l'alerte « peu de monde ». */
  instructeurs: number;
  /** Emails du seul récap, un soir de cours : le chiffre qui parle au bureau. */
  recapParSoirDeCours: number;
  /** Le produit affiché à l'écran : `recapParSoirDeCours × coursParSemaine`, et rien d'autre. */
  recapParSemaine: number;
  /** Total hebdomadaire régulier (récap + les deux vagues de rappel). */
  parSemaine: number;
  /** Le pire jour possible : un récap et les deux vagues de rappel tombant ensemble. */
  pireJour: number;
  quotaJour: number | null;
  depasseQuota: boolean;
  lignes: LigneVolume[];
};

/** Ce qu'il faut savoir du club pour estimer — compté en base par {@link chiffresDuClub}. */
export type AssietteEnvois = {
  membresAvecEmail: number;
  coursParSemaine: number;
  instructeurs: number;
  prefs: PreferencesNotifications;
};

/** Le coût d'un envoi : le nombre de destinataires, ou **un** message si la notification passe par la liste. */
function coutUnitaire(mode: ModeEnvoi, destinataires: number): number {
  return mode === "liste" ? 1 : destinataires;
}

/** Estimation complète (fonction pure : aucune base, tout arrive en argument). */
export function estimerEnvois({ membresAvecEmail, coursParSemaine, instructeurs, prefs }: AssietteEnvois): EstimationEnvois {
  const mode = (type: TypeNotification) => modeEnvoiDans(prefs, type);
  const recap = coutUnitaire(mode("recap_veille"), membresAvecEmail);
  const rappel = coutUnitaire(mode("rappel_sans_reponse"), membresAvecEmail);
  const annulation = coutUnitaire(mode("seance_annulee"), membresAvecEmail);
  const effectif = coutUnitaire(mode("effectif_faible"), instructeurs);
  const evenement = coutUnitaire(mode("evenement_nouveau"), membresAvecEmail);
  // Un récap par cours, et deux rappels par cours (J-7 puis J-2) : c'est tout le régulier.
  const parSemaine = coursParSemaine * (recap + 2 * rappel);
  const pireJour = recap + 2 * rappel;
  const lignes: LigneVolume[] = [
    { type: "recap_veille", titre: DESCRIPTIONS.recap_veille.titre, mode: mode("recap_veille"), parEnvoi: recap, parSemaine: coursParSemaine * recap, cadence: "la veille de chaque cours" },
    {
      type: "rappel_sans_reponse",
      titre: DESCRIPTIONS.rappel_sans_reponse.titre,
      mode: mode("rappel_sans_reponse"),
      parEnvoi: rappel,
      parSemaine: coursParSemaine * 2 * rappel,
      cadence: "deux fois par cours (une semaine puis deux jours avant)",
    },
    { type: "seance_annulee", titre: DESCRIPTIONS.seance_annulee.titre, mode: mode("seance_annulee"), parEnvoi: annulation, parSemaine: null, cadence: "à chaque annulation" },
    { type: "effectif_faible", titre: DESCRIPTIONS.effectif_faible.titre, mode: mode("effectif_faible"), parEnvoi: effectif, parSemaine: null, cadence: "au plus une fois par cours menacé" },
    { type: "evenement_nouveau", titre: DESCRIPTIONS.evenement_nouveau.titre, mode: mode("evenement_nouveau"), parEnvoi: evenement, parSemaine: null, cadence: "à chaque événement publié" },
  ];
  // Ceinture : l'ordre et le contenu des lignes suivent la constante, pour qu'une notification
  // devenue routable demain ne soit pas oubliée ici en silence.
  const manquantes = TYPES_ROUTABLES.filter((t) => !lignes.some((l) => l.type === t));
  for (const type of manquantes) {
    lignes.push({ type, titre: DESCRIPTIONS[type].titre, mode: mode(type), parEnvoi: coutUnitaire(mode(type), membresAvecEmail), parSemaine: null, cadence: "occasionnel" });
  }
  return {
    membresAvecEmail,
    coursParSemaine,
    instructeurs,
    recapParSoirDeCours: recap,
    recapParSemaine: coursParSemaine * recap,
    parSemaine,
    pireJour,
    quotaJour: prefs.quotaJour,
    // Quota non déclaré : on ne crie pas. Un chiffre inventé ferait plus de mal qu'une case vide.
    depasseQuota: prefs.quotaJour !== null && pireJour > prefs.quotaJour,
    lignes,
  };
}

/**
 * Les chiffres du club, comptés en base.
 *
 * **Le rythme des cours se mesure sur quatre semaines**, pas sur les sept jours qui viennent :
 * une semaine de vacances scolaires afficherait « 0 cours par semaine », donc « 0 envoi », juste
 * avant la reprise. On garde le plus grand des deux — la semaine qui vient si elle est chargée, la
 * moyenne du mois sinon.
 */
export async function chiffresDuClub(now = new Date()): Promise<Omit<AssietteEnvois, "prefs">> {
  const aujourdHui = todayIso(now);
  const [membresAvecEmail, instructeurs, seances7, seances28] = await Promise.all([
    db.user.count({ where: { actif: true, service: false, email: { not: null }, periodes: { some: { period: { statut: "ACTIVE" } } } } }),
    // **L'encadrement, c'est les instructeurs *et* le bureau — donc un `OR`**. « Admin » n'est plus
    // une valeur de `role` mais un supplément (`estAdmin`) : un `role: { in: [...] }` n'aurait plus
    // retenu que les instructeurs, et l'assiette annoncée par l'écran Email aurait rétréci toute
    // seule à chaque nomination au bureau.
    db.user.count({ where: { actif: true, service: false, email: { not: null }, OR: [{ role: "INSTRUCTEUR" }, { estAdmin: true }] } }),
    db.session.count({ where: { annulee: false, period: { statut: "ACTIVE" }, date: { gte: aujourdHui, lte: addDays(aujourdHui, 6) } } }),
    db.session.count({ where: { annulee: false, period: { statut: "ACTIVE" }, date: { gte: aujourdHui, lte: addDays(aujourdHui, 27) } } }),
  ]);
  return { membresAvecEmail, instructeurs, coursParSemaine: Math.max(seances7, Math.round(seances28 / 4)) };
}
