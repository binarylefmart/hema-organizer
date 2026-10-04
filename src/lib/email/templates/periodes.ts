import { formatDateLongue } from "@/lib/dates";
import { cheminNouvellePeriode } from "@/lib/periodes";
import { baseUrl } from "@/lib/env";
import type { EmailContenu } from "./layout";

/**
 * Emails liés aux **périodes** : le rappel aux administrateurs quand un trimestre s'achève sans
 * que le suivant ait été créé.
 *
 * Le ton est celui d'un pense-bête entre gens du bureau, pas d'une alerte : rien n'est cassé, il
 * reste seulement quelque chose à faire, et l'email dit exactement quoi — avec le nom et les dates
 * de la période attendue, déjà calculés, et le lien du formulaire pré-rempli.
 */
export function emailPeriodeSuivante(args: {
  prenom: string;
  /** La période qui se termine */
  periode: { nom: string; dateFin: string };
  /** Ce que le club attend ensuite : nom, dates et paramètres du formulaire */
  attendue: { nom: string; dateDebut: string; dateFin: string; saison: number; trimestre?: number; bimestre?: number; decalage?: number };
  /** Jours restants avant la fin de la période (7 ou 2) */
  jours: number;
}): { sujet: string; contenu: EmailContenu } {
  const { periode, attendue, jours } = args;
  const urgence = jours <= 2 ? "dans deux jours" : "dans une semaine";
  const lien = `${baseUrl()}${cheminNouvellePeriode(attendue)}`;
  return {
    sujet: `📅 ${periode.nom} se termine ${urgence} — ${attendue.nom} reste à créer`,
    contenu: {
      titre: `Bonjour ${args.prenom},`,
      paragraphes: [
        `La période « ${periode.nom} » se termine le ${formatDateLongue(periode.dateFin).replace(/^\w/, (c) => c.toLowerCase())}, et aucune période ne prend la suite pour l'instant.`,
        `La prochaine serait « ${attendue.nom} », du ${formatDateLongue(attendue.dateDebut).replace(/^\w/, (c) => c.toLowerCase())} au ${formatDateLongue(attendue.dateFin).replace(/^\w/, (c) => c.toLowerCase())}.`,
        "Le bouton ci-dessous ouvre le formulaire déjà rempli avec ces valeurs : il reste à générer les séances, puis à activer la période pour que chacun reçoive son lien.",
      ],
      boutons: [
        { label: `Créer « ${attendue.nom} »`, url: lien },
        { label: "Voir les périodes", url: `${baseUrl()}/admin/periodes` },
      ],
      piedDePage: [
        "Si le bouton ne fonctionne pas, copie ce lien dans ton navigateur :",
        lien,
        "Message automatique envoyé aux administrateurs une semaine puis deux jours avant la fin d'une période, tant que la suivante n'existe pas. Il s'arrête dès qu'elle est créée, même en brouillon.",
      ],
    },
  };
}

/**
 * **Le trimestre commence, et il est encore en brouillon.**
 *
 * L'email ne demande pas de créer quelque chose — tout est là — mais d'appuyer sur un bouton. Il dit
 * donc, dans l'ordre : ce qui approche, ce qui ne partira pas si personne ne bouge, et où appuyer.
 * Le ton reste celui d'un pense-bête, mais la conséquence est nommée : sans activation, **aucun lien
 * personnel ne part**, et le premier cours se tient devant une application que personne n'a pu ouvrir.
 */
export function emailPeriodeNonActivee(args: {
  prenom: string;
  periode: { id: string; nom: string };
  /** Date du premier cours (ou du début de la période si aucune séance) */
  premierCours: string;
  /** Jours restants avant ce premier cours (3 ou 1) */
  jours: number;
  /** Nombre de membres inscrits sur la période, qui attendent leur lien */
  membres: number;
}): { sujet: string; contenu: EmailContenu } {
  const { periode, premierCours, jours, membres } = args;
  const quand = jours <= 1 ? "demain" : `dans ${jours} jours`;
  const lien = `${baseUrl()}/admin/periodes/${periode.id}`;
  const jour = formatDateLongue(premierCours).replace(/^\w/, (c) => c.toLowerCase());
  return {
    sujet: `⚠️ ${periode.nom} commence ${quand} et n'est pas activée`,
    contenu: {
      titre: `Bonjour ${args.prenom},`,
      paragraphes: [
        `Le premier cours de « ${periode.nom} » a lieu ${jour}, et la période est encore en brouillon.`,
        membres > 0
          ? `Tant qu'elle n'est pas activée, les ${membres} membres inscrits ne reçoivent pas leur lien personnel : personne ne pourra répondre aux séances.`
          : "Tant qu'elle n'est pas activée, aucun lien personnel ne part — et aucun membre n'y est inscrit pour l'instant.",
        "Le bouton ci-dessous ouvre la période. Vérifie les créneaux, les séances et les membres, puis appuie sur « Activer la période » : les liens partent tout seuls dans la foulée.",
      ],
      boutons: [
        { label: `Ouvrir « ${periode.nom} »`, url: lien },
        { label: "Voir les périodes", url: `${baseUrl()}/admin/periodes` },
      ],
      piedDePage: [
        "Si le bouton ne fonctionne pas, copie ce lien dans ton navigateur :",
        lien,
        "Message automatique envoyé aux administrateurs trois jours puis un jour avant le premier cours d'une période restée en brouillon. Il s'arrête dès qu'elle est activée.",
      ],
    },
  };
}
