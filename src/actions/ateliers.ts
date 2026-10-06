"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { assertPermission } from "@/lib/auth/current-user";
import { membrePeutModifier, transitionAutorisee } from "@/lib/ateliers";
import { ecritureFermee } from "@/lib/constants";
import { todayIso } from "@/lib/dates";
import { notifierDecisionAtelier } from "@/lib/notifications/ateliers";
import { champ, zodToFormState, type FormState } from "@/lib/form";
import { atelierSchema, decisionAtelierSchema } from "@/lib/validation/gestion";
import { placerAtelier, retirerAtelier } from "@/lib/planning";

function rafraichir() {
  revalidatePath("/seances");
  revalidatePath("/");
  revalidatePath("/planning");
  revalidatePath("/ateliers");
  revalidatePath("/gestion/ateliers");
  revalidatePath("/gestion");
}

function lireAtelier(fd: FormData) {
  return atelierSchema.safeParse({
    titre: champ(fd, "titre"),
    description: champ(fd, "description"),
    materiel: champ(fd, "materiel"),
    sessionId: champ(fd, "sessionId"),
    animateurId: champ(fd, "animateurId"),
    animateurSecondId: champ(fd, "animateurSecondId"),
  });
}

/**
 * **Les deux animateurs doivent être des comptes actifs du club** — membres et instructeurs, bureau
 * compris, jamais le compte de service du portail : la liste du formulaire (`animateursPossibles`)
 * n'en propose pas d'autres, une requête forgée ne doit pas en écrire d'autres. `retenus` : ceux déjà
 * enregistrés sur la proposition modifiée, gardés même désactivés depuis (la liste les montre).
 *
 * Le schéma a déjà refusé « second sans animateur » et « second = animateur ».
 */
async function animateursRefuses(
  animateurId: string,
  animateurSecondId: string | null,
  retenus: readonly (string | null)[] = [],
): Promise<FormState | null> {
  const ids = [animateurId, animateurSecondId].filter((id): id is string => !!id);
  const gardes = retenus.filter((id): id is string => !!id);
  const trouves = await db.user.findMany({
    where: { id: { in: ids }, service: false, OR: [{ actif: true }, ...(gardes.length ? [{ id: { in: gardes } }] : [])] },
    select: { id: true },
  });
  const connus = new Set(trouves.map((u) => u.id));
  const erreurs: Record<string, string> = {};
  if (!connus.has(animateurId)) erreurs.animateurId = "Choisis un membre actif du club.";
  if (animateurSecondId && !connus.has(animateurSecondId)) erreurs.animateurSecondId = "Choisis un membre actif du club.";
  return Object.keys(erreurs).length ? { erreur: "Vérifie les champs en rouge.", erreurs } : null;
}

/** Sans titre, on prend le début de la description (ou « Atelier de Prénom »). */
function titreParDefaut(titre: string, description: string, prenom: string): string {
  if (titre) return titre;
  const debut = description.split(/[.!?\n]/)[0].trim();
  return debut ? debut.slice(0, 60) : `Atelier de ${prenom}`;
}

/** La séance souhaitée doit être à venir et non annulée (sinon ignorée). */
async function seanceValide(sessionId: string | undefined): Promise<string | null> {
  if (!sessionId) return null;
  const s = await db.session.findUnique({ where: { id: sessionId } });
  return s && !s.annulee && s.date >= todayIso() ? s.id : null;
}

/**
 * **La période de la séance est-elle encore ouverte ?** — le verrou que `deciderAtelier` oubliait.
 *
 * Placer un atelier **écrit dans le planning** (`placerAtelier` : la case reçoit l'animateur, le
 * titre en thème, et une option de plus est créée s'il n'y a pas la place). Or les deux portes qui
 * mènent à cette écriture n'avaient pas la même serrure : celle de la grille passe par
 * `partiePourEcriture` (`src/actions/planning.ts`), qui refuse une période `CLOSE` ; celle de la file
 * des propositions ne vérifiait que « à venir et non annulée ». Une période close **peut** porter des
 * séances à venir — on clôt un trimestre sans attendre son dernier cours —, et le planning y était
 * donc encore modifiable par cette porte-là. Même question, même refus, mêmes mots.
 */
async function periodeOuverte(sessionId: string): Promise<boolean> {
  const s = await db.session.findUnique({ where: { id: sessionId }, select: { period: { select: { statut: true } } } });
  // Même question que le planning et que la séance, et elle s'écrit une seule fois (`constants.ts`).
  return !!s && !ecritureFermee(s.period.statut);
}

export async function proposerAtelier(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await assertPermission("ateliers.propose");
  const parsed = lireAtelier(fd);
  if (!parsed.success) return zodToFormState(parsed.error);
  const { sessionId, titre, description, materiel } = parsed.data;
  // Qui anime : la personne qui propose, à moins d'en avoir choisi une autre.
  const animateurId = parsed.data.animateurId ?? user.id;
  const animateurSecondId = parsed.data.animateurSecondId ?? null;
  const refus = await animateursRefuses(animateurId, animateurSecondId);
  if (refus) return refus;
  const atelier = await db.atelier.create({
    data: {
      titre: titreParDefaut(titre, description, user.prenom),
      description,
      materiel: materiel || null,
      proposeParId: user.id,
      animateurId,
      animateurSecondId,
      sessionId: await seanceValide(sessionId),
    },
  });
  await audit(user, "atelier.propose", atelier.id, { titre: atelier.titre });
  rafraichir();
  redirect("/ateliers?propose=ok");
}

export async function modifierAtelier(atelierId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const user = await assertPermission("ateliers.propose");
  const atelier = await db.atelier.findUniqueOrThrow({ where: { id: atelierId } });
  if (atelier.proposeParId !== user.id || !membrePeutModifier(atelier.statut)) {
    return { erreur: "Cette proposition ne peut plus être modifiée." };
  }
  const parsed = lireAtelier(fd);
  if (!parsed.success) return zodToFormState(parsed.error);
  const { sessionId, titre, description, materiel } = parsed.data;
  const animateurId = parsed.data.animateurId ?? atelier.proposeParId;
  const animateurSecondId = parsed.data.animateurSecondId ?? null;
  const refus = await animateursRefuses(animateurId, animateurSecondId, [atelier.animateurId, atelier.animateurSecondId]);
  if (refus) return refus;
  const modifie = await db.atelier.update({
    where: { id: atelierId },
    data: {
      titre: titreParDefaut(titre, description, user.prenom),
      description,
      materiel: materiel || null,
      animateurId,
      animateurSecondId,
      sessionId: await seanceValide(sessionId),
    },
  });
  // Écriture de contenu comme les autres : la proposition et la décision laissent une trace, la
  // retouche aussi — sinon un titre change entre deux lectures sans que rien ne dise quand.
  await audit(user, "atelier.modifie", atelierId, { titre: modifie.titre, ancienTitre: atelier.titre });
  rafraichir();
  // La fiche de la proposition, que `rafraichir()` ne couvre pas : sans elle, l'écran d'où l'on vient
  // d'enregistrer se relit dans son état d'avant.
  revalidatePath(`/ateliers/${atelierId}`);
  return { succes: "Proposition mise à jour." };
}

export async function supprimerAtelier(atelierId: string): Promise<void> {
  const user = await assertPermission("ateliers.propose");
  const atelier = await db.atelier.findUniqueOrThrow({ where: { id: atelierId } });
  if (atelier.proposeParId !== user.id || !membrePeutModifier(atelier.statut)) throw new Error("Suppression impossible.");
  await db.atelier.delete({ where: { id: atelierId } });
  // Journalisé avant la redirection (qui lève) : une proposition effacée ne laisse plus rien
  // derrière elle, la trace est tout ce qui reste.
  await audit(user, "atelier.supprime", atelierId, { titre: atelier.titre });
  rafraichir();
  redirect("/ateliers");
}

/**
 * **Effacer une proposition, sans y répondre**.
 *
 * Ce n'est pas un troisième verdict, c'est le contraire d'un verdict : la ligne disparaît, **aucun
 * email ne part**, et la file n'en garde rien. C'est ce qu'on veut pour un doublon, un brouillon
 * envoyé par erreur, un message qui n'était pas une proposition — répondre « refusé » à ces
 * choses-là serait un contresens, et les laisser en attente encombre la file de tout le monde.
 *
 * Trois précautions, et ce sont elles qui rendent le geste acceptable :
 *  - **le bureau seul** (`ateliers.supprimer`) : faire disparaître l'écrit de quelqu'un en silence
 *    engage le club, comme désactiver un compte ;
 *  - **le journal d'audit garde le titre, l'auteur et le statut d'alors** — effacée, la proposition
 *    ne laisse plus rien d'autre derrière elle ;
 *  - **la case du planning est libérée d'abord** si l'atelier y était placé. Le lien de la base
 *    passerait bien à `null` tout seul (`onDelete: SetNull`), mais la case resterait là, avec son
 *    titre et plus rien derrière : c'est exactement le geste que fait déjà « Refuser » sur un
 *    atelier planifié.
 *
 * Le membre, lui, garde le droit d'effacer **la sienne** tant qu'elle est en attente
 * (`supprimerAtelier`) : les deux gestes ne se ressemblent que de loin.
 */
export async function effacerProposition(atelierId: string): Promise<void> {
  const user = await assertPermission("ateliers.supprimer");
  const atelier = await db.atelier.findUniqueOrThrow({
    where: { id: atelierId },
    include: { proposePar: { select: { prenom: true, nom: true } } },
  });
  if (atelier.statut === "PLANIFIE") await retirerAtelier(atelierId);
  await db.atelier.delete({ where: { id: atelierId } });
  await audit(user, "atelier.efface_sans_reponse", atelierId, {
    titre: atelier.titre,
    statut: atelier.statut,
    proposePar: `${atelier.proposePar.prenom} ${atelier.proposePar.nom}`,
  });
  rafraichir();
}

/** Décision de l'équipe en un geste : placer dans le planning (séance choisie) / refuser / retirer ou réexaminer. Email automatique au membre. */
export async function deciderAtelier(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await assertPermission("ateliers.moderate");
  const parsed = decisionAtelierSchema.safeParse({
    atelierId: champ(fd, "atelierId"),
    statut: champ(fd, "statut"),
    commentaire: champ(fd, "commentaire"),
    sessionId: champ(fd, "sessionId"),
  });
  if (!parsed.success) return zodToFormState(parsed.error);
  const { atelierId, statut, commentaire, sessionId } = parsed.data;
  const atelier = await db.atelier.findUniqueOrThrow({ where: { id: atelierId }, include: { proposePar: true } });
  if (!transitionAutorisee(atelier.statut, statut)) return { erreur: `Passage ${atelier.statut} → ${statut} impossible.` };
  let seance: { date: string; heureDebut: string; lieu: string } | null = null;
  // L'atelier **après** la décision : c'est son `updatedAt` qui date le message (voir
  // `notifierDecisionAtelier`), et qui distingue un second refus du premier.
  let decide;
  if (statut === "PLANIFIE") {
    const id = await seanceValide(sessionId);
    if (!id) return { erreur: "Choisis une séance à venir pour placer l'atelier.", erreurs: { sessionId: "Séance requise." } };
    if (!(await periodeOuverte(id))) {
      return { erreur: "Cette période est close : le planning n'est plus modifiable.", erreurs: { sessionId: "Période close." } };
    }
    seance = await db.session.findUniqueOrThrow({ where: { id }, select: { date: true, heureDebut: true, lieu: true } });
    decide = await db.atelier.update({ where: { id: atelierId }, data: { statut, sessionId: id, commentaireInstructeur: commentaire || atelier.commentaireInstructeur } });
    // L'atelier prend un élément Atelier vide, sinon la première **option** libre de la séance — et
    // si rien n'est libre, un élément Atelier naît dans la dernière partie (voir `placerAtelier`) :
    // un atelier que l'équipe vient d'accepter ne doit pas rester invisible faute de case libre.
    await placerAtelier(atelierId, id, user.id);
  } else {
    decide = await db.atelier.update({
      where: { id: atelierId },
      data: { statut, commentaireInstructeur: commentaire || atelier.commentaireInstructeur, ...(statut === "REFUSE" ? { sessionId: null } : {}) },
    });
    if (atelier.statut === "PLANIFIE") await retirerAtelier(atelierId);
  }
  // Retirer du planning ou réexaminer ne dit rien au membre : seuls « placé » et « refusé » comptent.
  // Tout le reste (état réel du canal, réglage du club, choix personnel, journal, reprise après échec)
  // est dans `notifierDecisionAtelier` — un seul chemin pour les deux écrans qui répondent.
  const prevenir =
    statut !== "PROPOSE" &&
    (await notifierDecisionAtelier({ atelier: decide, proposePar: atelier.proposePar, statut, commentaire, seance }));
  await audit(user, "atelier.decision", atelierId, { statut, sessionId: sessionId ?? null });
  rafraichir();
  const prevenu = prevenir ? " — le membre est prévenu par email." : ".";
  return {
    succes: statut === "PLANIFIE" ? `Atelier placé dans le planning${prevenu}` : statut === "REFUSE" ? `Atelier refusé${prevenu}` : "Atelier remis en attente.",
  };
}
