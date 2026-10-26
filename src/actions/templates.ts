"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { assertPermission } from "@/lib/auth/current-user";
import { champ, zodToFormState, type FormState } from "@/lib/form";
import { todayIso } from "@/lib/dates";
import { ecritureFermee, PARTIES_MODELE, REFUS_PERIODE_CLOSE } from "@/lib/constants";
import { getThemes, synchroniserSeance } from "@/lib/planning";
import { SELECT_SEANCE_APPLICATION, versSeanceExistante } from "@/app/(app)/admin/templates/appliquer/seances-application";
import {
  applicationSchema,
  bilanApplication,
  elementsTemplateSchema,
  normaliserElements,
  partiesDepuisTemplate,
  planApplication,
  templateSchema,
  type EtapeApplication,
  type NatureTemplate,
} from "@/lib/templates";

/**
 * **Les gestes des templates de cours** — tous réservés au bureau (`templates.manage`, donc derrière
 * l'élévation), comme la construction d'un trimestre. Voir `src/lib/templates.ts` pour les règles.
 */

function rafraichir(templateId?: string) {
  revalidatePath("/admin/templates");
  if (templateId) revalidatePath(`/admin/templates/${templateId}`);
}

function lireTemplate(fd: FormData) {
  return templateSchema.safeParse({
    nom: champ(fd, "nom"),
    heureDebut: champ(fd, "heureDebut"),
    heureFin: champ(fd, "heureFin"),
    lieu: champ(fd, "lieu"),
    adresse: champ(fd, "adresse"),
  });
}

/** Crée un template avec le programme du modèle d'une séance neuve (une partie, un cours), puis ouvre son écran. */
export async function creerTemplate(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await assertPermission("templates.manage");
  const parsed = lireTemplate(fd);
  if (!parsed.success) return zodToFormState(parsed.error);
  const template = await db.coursTemplate.create({
    data: {
      ...parsed.data,
      elements: { create: PARTIES_MODELE.map((p, ordre) => ({ bloc: p.bloc, nature: p.nature, ordre })) },
    },
  });
  await audit(user, "template.cree", template.id, { nom: template.nom });
  rafraichir();
  redirect(`/admin/templates/${template.id}`);
}

/** Nom, horaire et lieu. Les séances déjà remplies par ce template ne bougent pas : il n'en garde aucun lien. */
export async function modifierTemplate(templateId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const user = await assertPermission("templates.manage");
  const parsed = lireTemplate(fd);
  if (!parsed.success) return zodToFormState(parsed.error);
  const existe = await db.coursTemplate.findUnique({ where: { id: templateId }, select: { id: true } });
  if (!existe) return { erreur: "Ce template n'existe plus." };
  await db.coursTemplate.update({ where: { id: templateId }, data: parsed.data });
  await audit(user, "template.modifie", templateId, { nom: parsed.data.nom });
  rafraichir(templateId);
  return { succes: "Template enregistré." };
}

export type ResultatElements = { ok: true } | { erreur: string };

/**
 * **Le programme du template, enregistré d'un bloc** : l'écran envoie la liste entière, le serveur la
 * remet d'accord (`normaliserElements`) et remplace l'ancienne dans une transaction. Les encadrants
 * doivent être des comptes actifs : un identifiant forgé ne s'enregistre pas.
 */
export async function enregistrerElementsTemplate(templateId: string, entree: unknown): Promise<ResultatElements> {
  const user = await assertPermission("templates.manage");
  const parsed = elementsTemplateSchema.safeParse(entree);
  if (!parsed.success) return { erreur: parsed.error.issues[0]?.message ?? "Programme invalide." };
  const existe = await db.coursTemplate.findUnique({ where: { id: templateId }, select: { id: true } });
  if (!existe) return { erreur: "Ce template n'existe plus." };
  const elements = normaliserElements(parsed.data.map((e) => ({ ...e, nature: e.nature as NatureTemplate })));
  const ids = [...new Set(elements.flatMap((e) => [e.instructeurId, e.instructeurSecondId]).filter((id): id is string => !!id))];
  if (ids.length) {
    const connus = await db.user.count({ where: { id: { in: ids }, actif: true, service: false } });
    if (connus !== ids.length) return { erreur: "Un encadrant choisi n'existe plus ou n'est plus actif : recharge la page." };
  }
  await db.$transaction([
    db.coursTemplateElement.deleteMany({ where: { templateId } }),
    db.coursTemplateElement.createMany({ data: elements.map((e, ordre) => ({ ...e, templateId, ordre })) }),
    // Le template a changé : sa date de mise à jour le dit dans la liste.
    db.coursTemplate.update({ where: { id: templateId }, data: { updatedAt: new Date() } }),
  ]);
  await audit(user, "template.programme", templateId, { elements: elements.length });
  rafraichir(templateId);
  return { ok: true };
}

/** Efface le template. Les séances qu'il a remplies gardent leur programme : elles n'en dépendent pas. */
export async function supprimerTemplate(templateId: string): Promise<void> {
  const user = await assertPermission("templates.manage");
  const template = await db.coursTemplate.findUnique({ where: { id: templateId }, select: { nom: true } });
  if (template) {
    await db.coursTemplate.delete({ where: { id: templateId } });
    await audit(user, "template.supprime", templateId, { nom: template.nom });
  }
  rafraichir();
  redirect("/admin/templates");
}

export type ResultatApplication = { erreur: string } | { bilan: string; plan: EtapeApplication[] };

/**
 * **Appliquer un template à des dates d'une période.**
 *
 * Le plan est recalculé ici (`planApplication`), sur l'état de la base au moment de l'appui : l'écran
 * l'a annoncé, le serveur le tient — et si quelqu'un a rempli une séance entre-temps, elle est
 * écartée plutôt qu'écrasée. Une séance créée reçoit l'horaire, le lieu et le programme du template ;
 * une séance existante ne reçoit que le programme. Une entrée de journal par séance touchée
 * (`template.applique`). **Aucune notification** : c'est un geste de masse, et un planning posé
 * d'avance n'est pas une modification à annoncer.
 */
export async function appliquerTemplate(entree: unknown): Promise<ResultatApplication> {
  const user = await assertPermission("templates.manage");
  const parsed = applicationSchema.safeParse(entree);
  if (!parsed.success) return { erreur: parsed.error.issues[0]?.message ?? "Demande invalide." };
  const { templateId, periodId, dates } = parsed.data;
  const [template, periode] = await Promise.all([
    db.coursTemplate.findUnique({ where: { id: templateId }, include: { elements: { orderBy: [{ bloc: "asc" }, { ordre: "asc" }] } } }),
    db.period.findUnique({ where: { id: periodId }, select: { id: true, statut: true, dateDebut: true, dateFin: true } }),
  ]);
  if (!template) return { erreur: "Ce template n'existe plus." };
  if (!periode) return { erreur: "Cette période n'existe plus." };
  if (ecritureFermee(periode.statut)) return { erreur: REFUS_PERIODE_CLOSE.seances };
  if (template.elements.length === 0) return { erreur: "Ce template n'a aucun élément dans son programme." };

  const now = new Date();
  const seances = await db.session.findMany({
    where: { periodId, date: { in: [...new Set(dates)] } },
    select: SELECT_SEANCE_APPLICATION,
  });
  // **Les mêmes faits que l'écran** : `versSeanceExistante` est la fonction dont la page d'application
  // se sert pour annoncer le plan — une seule écriture de « commencée » et de « programme vide ».
  const plan = planApplication({
    dates,
    aujourdHui: todayIso(now),
    periode,
    heureDebut: template.heureDebut,
    seances: seances.map((s) => versSeanceExistante(s, now)),
  });

  const parties = partiesDepuisTemplate(
    template.elements.map((e) => ({ ...e, nature: e.nature as NatureTemplate })),
    await getThemes(),
  );
  for (const etape of plan) {
    if (etape.action === "creer") {
      const session = await db.session.create({
        data: {
          periodId,
          date: etape.date,
          heureDebut: template.heureDebut,
          heureFin: template.heureFin,
          lieu: template.lieu,
          adresse: template.adresse,
          parties: { create: parties.map((p) => ({ ...p, modifieParId: user.id })) },
        },
      });
      await synchroniserSeance(session.id);
      await audit(user, "template.applique", session.id, { templateId, nom: template.nom, date: etape.date, mode: "creee" });
    } else if (etape.action === "remplir") {
      await db.$transaction([
        db.sessionPartie.deleteMany({ where: { sessionId: etape.sessionId } }),
        db.sessionPartie.createMany({ data: parties.map((p) => ({ ...p, sessionId: etape.sessionId, modifieParId: user.id })) }),
      ]);
      await synchroniserSeance(etape.sessionId);
      await audit(user, "template.applique", etape.sessionId, { templateId, nom: template.nom, date: etape.date, mode: "remplie" });
    }
  }
  revalidatePath("/planning");
  revalidatePath("/seances");
  revalidatePath("/");
  revalidatePath(`/admin/periodes/${periodId}`);
  return { bilan: bilanApplication(plan), plan };
}
