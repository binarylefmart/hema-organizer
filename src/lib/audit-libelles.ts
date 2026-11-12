import { formatDateCourte, formatHeure } from "@/lib/dates";
import { libelleDelaiDesistement } from "@/lib/constants";
import { libelleAvantCours } from "@/lib/historique-reponses";

/**
 * **Le journal d'audit, dit en français** (demande de Delta : « revois la page des logs pour que ce soit
 * plus ergonomique »). L'écran montrait le code de l'action (`connexion.succes`) et ses détails en JSON
 * brut : lisible par un développeur, pas par un bénévole du bureau. Ici, une phrase par action connue et
 * des détails rendus en clair ; le code reste affiché en petit (c'est lui que l'on filtre et qu'exporte
 * le CSV). Une action inconnue n'est jamais perdue : elle s'affiche par son code, rendu lisible.
 */

export type TonAudit = "neutre" | "vert" | "rouge" | "ocre" | "primaire";

const ACTIONS: Record<string, string> = {
  "connexion.succes": "s'est connecté(e)",
  "connexion.echec": "connexion refusée",
  "connexion.mot_de_passe_ok": "mot de passe accepté",
  "connexion.code_2fa_echec": "code à usage unique refusé",
  "connexion.code_secours_utilise": "a utilisé un code de secours",
  deconnexion: "s'est déconnecté(e)",
  "invitation.connexion": "entré(e) par son lien personnel",
  "invitation.premier_acces": "premier passage par son lien",
  "invitation.lien_inconnu": "lien personnel inconnu ou expiré",
  "invitation.envoyee": "lien personnel envoyé",
  "invitation.renvoyee": "lien personnel renvoyé",
  "invitation.revoquee": "lien personnel révoqué",
  "invitations.renvoyees_toutes": "liens renvoyés à toute la période",
  "admin.espace_ouvert": "a ouvert l'espace admin",
  "admin.espace_quitte": "a quitté l'espace admin",
  "admin.elevation_echec": "ouverture de l'espace admin refusée",
  "admin.droits_donnes": "a nommé au bureau",
  "admin.droits_retires": "a retiré du bureau",
  "admin.deux_fa_activee": "double authentification activée (bureau)",
  "admin.deux_fa_echec": "code de double authentification refusé (bureau)",
  "admin.codes_secours_generes": "codes de secours créés (bureau)",
  "admin.mot_de_passe_defini": "mot de passe défini (bureau)",
  "deux_fa.activee": "double authentification activée",
  "deux_fa.reinitialisee": "double authentification réinitialisée",
  "deux_fa.codes_generes": "codes de secours créés",
  "deux_fa.codes_regeneres": "codes de secours recréés",
  "deux_fa.code_activation_genere": "code d'activation créé",
  "deux_fa.code_activation_utilise": "code d'activation utilisé",
  "mot_de_passe.demande_reset": "a demandé un nouveau mot de passe",
  "mot_de_passe.reinitialise": "mot de passe réinitialisé",
  "mot_de_passe.premier_choix": "a choisi son mot de passe",
  "mot_de_passe.change": "a changé son mot de passe",
  "presence.reponse": "a changé sa réponse",
  "presence.desistement": "s'est désisté(e)",
  "presence.desistement_anticipe": "désistement anticipé (avant le délai d'alerte, non compté)",
  "presence.desistement_derniere_minute": "désistement de dernière minute",
  "presence.desistement_non_signale": "a noté un désistement non signalé (inscrit Présent, pas venu)",
  "presence.desistement_non_signale_retire": "a retiré un désistement non signalé",
  "notification.desistement": "alerte « désistement » envoyée aux instructeurs",
  "notification.desistement_echec": "alerte « désistement » non remise",
  "notification.desistement_derniere_minute": "alerte « désistement de dernière minute » envoyée aux instructeurs",
  "notification.desistement_derniere_minute_echec": "alerte « désistement de dernière minute » non remise",
  "presence.modifiee_par_admin": "a corrigé une réponse",
  "rappels.desinscrit": "s'est désinscrit(e) des rappels",
  "rappels.reactives": "a réactivé les rappels",
  "membre.cree": "a créé un compte",
  "membre.modifie": "a modifié un compte",
  "membre.supprime": "a supprimé un compte",
  "membre.desactive": "a désactivé un compte",
  "membre.role_modifie": "a changé un rôle",
  "membre.acces_reinitialise": "a réinitialisé un accès",
  "membre.import_csv": "a importé des membres (CSV)",
  "membre.notifications_reglees": "a réglé les notifications d'un membre",
  "seance.creee": "a créé une séance",
  "seance.modifiee": "a modifié une séance",
  "seance.annulee": "a annulé une séance",
  "seance.retablie": "a rétabli une séance",
  "seance.supprimee": "a supprimé une séance",
  "seance.theme": "a changé le thème d'une séance",
  "seance.annulation_motif": "a changé le motif d'annulation",
  "planning.case": "a modifié le programme",
  "planning.partie.ajout": "a ajouté une partie au programme",
  "planning.partie.retrait": "a retiré une partie du programme",
  "planning.partie.ordre": "a réordonné le programme",
  "planning.partie.nature": "a changé la nature d'un élément",
  "periode.creee": "a créé une période",
  "periode.modifiee": "a modifié une période",
  "periode.activee": "a activé une période",
  "periode.close": "a clos une période",
  "periode.reactivee": "a réactivé une période",
  "periode.supprimee": "a supprimé une période",
  "periode.seances_generees": "a généré les séances d'une période",
  "periode.seances_supprimees": "a supprimé des séances d'une période",
  "periode.membres_ajoutes": "a ajouté des membres à une période",
  "periode.membre_retire": "a retiré un membre d'une période",
  "periode.instructeurs": "a changé les instructeurs d'une période",
  "periode.dates_reproposees": "a reproposé des dates",
  "periode.creneau_ajoute": "a ajouté un créneau",
  "periode.creneau_supprime": "a supprimé un créneau",
  "atelier.propose": "a proposé un atelier",
  "atelier.decision": "a statué sur un atelier",
  "atelier.modifie": "a modifié un atelier",
  "atelier.supprime": "a supprimé un atelier",
  "evenement.cree": "a créé un événement",
  "evenement.modifie": "a modifié un événement",
  "evenement.publie": "a publié un événement",
  "evenement.supprime": "a supprimé un événement",
  "evenement.affiche_televersee": "a téléversé une affiche",
  "notifications.reglees": "a réglé les notifications du club",
  "parametres.recap_hour": "a changé l'heure du récap",
  "parametres.rappels_jalons": "a changé les délais des rappels",
  "parametres.delai_desistement": "a changé le délai des désistements",
  "parametres.delai_derniere_minute": "a changé le délai des désistements de dernière minute",
  "parametres.publication_cours": "a réglé la publication des cours",
  "parametres.alertes_securite": "a réglé les alertes de sécurité",
  "parametres.retention_audit": "a changé la durée du journal",
  "export.csv": "a exporté les présences (CSV)",
  "export.audit": "a exporté le journal (CSV)",
};

/** La phrase d'une action, ou son code rendu lisible (`foo.bar_baz` → « foo · bar baz »). */
export function libelleAction(action: string): string {
  return ACTIONS[action] ?? action.replace(/_/g, " ").replace(/\./g, " · ");
}

/** La couleur d'une action : refus en rouge, désistement en ocre, gestes du bureau en primaire. */
export function tonAction(action: string): TonAudit {
  if (/echec|refus|inconnu/.test(action)) return "rouge";
  if (action.startsWith("presence.desistement")) return "ocre";
  if (action.startsWith("notification.desistement")) return "ocre";
  // Ouvrir ou quitter l'espace admin revient sans cesse : en couleur, il noierait ce qui compte.
  if (action === "admin.espace_ouvert" || action === "admin.espace_quitte") return "neutre";
  if (action.startsWith("admin.") || action.startsWith("parametres.") || action.endsWith("supprime") || action.endsWith("supprimee")) return "primaire";
  return "neutre";
}

const STATUTS: Record<string, string> = { PRESENT: "Présent", ABSENT: "Absent", PEUT_ETRE: "Peut-être" };
const statut = (v: unknown) => (v === null || v === undefined ? "sans réponse" : (STATUTS[String(v)] ?? String(v)));

/** Clés connues : on les traduit ; les identifiants techniques ne s'affichent pas (ils restent au CSV). */
const CLES: Record<string, string> = {
  resterConnecte: "rester connecté",
  deuxFa: "double authentification",
  codeSecours: "code de secours",
  enMasse: "correction en lot",
  lignes: "lignes",
  minutes: "minutes",
  jalons: "jours avant",
  role: "rôle",
  motif: "motif",
  email: "email",
  raison: "raison",
  emails: "emails",
  telephones: "téléphones",
  canal: "canal",
  destinataire: "destinataire",
  erreur: "erreur",
};
const MASQUEES = new Set(["sessionId", "seance", "avant", "apres", "derniereMinute", "signale", "avantCoursMin", "periodId", "userId", "id", "nouvelleReponse", "delaiMin", "ancienDelaiMin"]);

function valeur(v: unknown): string {
  if (v === true) return "oui";
  if (v === false) return "non";
  if (v === null || v === undefined || v === "") return "—";
  if (Array.isArray(v)) return v.map(valeur).join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return formatDateCourte(v);
  return String(v);
}

/**
 * **Les détails en clair** : une liste de petits morceaux (« Présent → Absent », « 1 h 35 avant le cours »,
 * « rester connecté : oui »). `seances` donne la date des séances citées par identifiant. Un texte qui
 * n'est pas du JSON est rendu tel quel.
 */
export function detailsLisibles(details: string | null, seances: ReadonlyMap<string, { date: string; heureDebut: string }> = new Map()): string[] {
  if (!details) return [];
  let d: unknown;
  try {
    d = JSON.parse(details);
  } catch {
    return [details];
  }
  if (!d || typeof d !== "object" || Array.isArray(d)) return [valeur(d)];
  const o = d as Record<string, unknown>;
  const morceaux: string[] = [];
  const s = typeof o.sessionId === "string" ? seances.get(o.sessionId) : undefined;
  const brute = typeof o.seance === "string" ? /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})$/.exec(o.seance) : null;
  if (s) morceaux.push(`séance du ${formatDateCourte(s.date)} à ${formatHeure(s.heureDebut)}`);
  else if (brute) morceaux.push(`séance du ${formatDateCourte(brute[1])} à ${formatHeure(brute[2])}`);
  if ("avant" in o || "apres" in o) morceaux.push(`${statut(o.avant)} → ${statut(o.apres)}`);
  if (typeof o.avantCoursMin === "number") morceaux.push(libelleAvantCours(o.avantCoursMin));
  if (o.derniereMinute === true) morceaux.push("désistement de dernière minute");
  else if (o.signale === true) morceaux.push("instructeurs prévenus");
  // Une alerte envoyée : la réponse qui l'a déclenchée (le statut seul, sans « avant »).
  if (typeof o.nouvelleReponse === "string") morceaux.push(`nouvelle réponse : ${statut(o.nouvelleReponse)}`);
  // Un délai changé : l'ancien et le nouveau, en clair (« 2 heures → 3 jours ») ; un délai seul, en clair aussi.
  if (typeof o.delaiMin === "number") {
    const change = typeof o.ancienDelaiMin === "number" && o.ancienDelaiMin !== o.delaiMin;
    morceaux.push(change ? `${libelleDelaiDesistement(o.ancienDelaiMin as number)} → ${libelleDelaiDesistement(o.delaiMin)}` : `délai : ${libelleDelaiDesistement(o.delaiMin)}`);
  }
  // Une alerte allumée ou éteinte avec son délai : « activé → désactivé », ou l'état seul s'il n'a pas bougé.
  const bascule = typeof o.ancienActif === "boolean" && typeof o.actif === "boolean";
  if (bascule) morceaux.push(o.ancienActif === o.actif ? (o.actif ? "activé" : "désactivé") : `${o.ancienActif ? "activé" : "désactivé"} → ${o.actif ? "activé" : "désactivé"}`);
  for (const [k, v] of Object.entries(o)) {
    if (bascule && (k === "actif" || k === "ancienActif")) continue;
    // Les champs vides n'apprennent rien : on les tait (le CSV les garde).
    if (MASQUEES.has(k) || v === null || v === undefined || v === "") continue;
    morceaux.push(`${CLES[k] ?? k} : ${valeur(v)}`);
  }
  return morceaux;
}
