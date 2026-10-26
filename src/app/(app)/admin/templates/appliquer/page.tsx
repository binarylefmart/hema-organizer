import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/current-user";
import { db } from "@/lib/db";
import { todayIso } from "@/lib/dates";
import { Alerte } from "@/components/ui/Alerte";
import { LienBouton } from "@/components/ui/Bouton";
import { periodeParDefaut } from "./dates-application";
import { SELECT_SEANCE_APPLICATION, versSeanceExistante } from "./seances-application";
import { AppliquerTemplate, type PeriodeOuverte, type TemplateResume } from "./AppliquerTemplate";

export const metadata: Metadata = { title: "Appliquer un template" };

type Props = { searchParams: Promise<{ template?: string; periode?: string }> };

/**
 * **Appliquer un template** : poser un cours type (horaire, lieu, programme) sur des dates d'une
 * période, en une fois — « tous les mardis du trimestre », ou quelques dates choisies.
 *
 * L'écran **annonce** ce qui va se passer date par date avant l'appui, avec la même fonction que le
 * serveur (`planApplication`, `src/lib/templates.ts`) ; le serveur recalcule au moment de l'appui
 * (`appliquerTemplate`) et c'est **son** plan qui s'affiche ensuite. Ce que la page doit donc fournir
 * au navigateur, ce sont les mêmes faits que ceux que l'action lira : les séances de la période, avec
 * `commencee` et `programmeVide` calculés exactement comme elle (`versSeanceExistante`).
 *
 * `?template=` et `?periode=` présélectionnent (liens depuis la liste et la fiche d'un template) ;
 * changer de période recharge l'URL, puisque les séances à charger en dépendent. Une valeur inconnue
 * — template effacé, période close entre-temps — retombe sur le choix par défaut plutôt que sur une
 * erreur : le premier template, la période active (sinon la brouillon la plus proche).
 *
 * **Seules les périodes ouvertes sont proposées** (brouillon ou active) : une période close refuse
 * toute écriture de séance (`ecritureFermee`), la proposer ne mènerait qu'à un refus.
 */
export default async function PageAppliquerTemplate({ searchParams }: Props) {
  await requirePermission("templates.manage");
  const { template, periode } = await searchParams;
  const now = new Date();
  const aujourdHui = todayIso(now);

  const [templates, periodes] = await Promise.all([
    db.coursTemplate.findMany({
      orderBy: { nom: "asc" },
      select: { id: true, nom: true, heureDebut: true, heureFin: true, lieu: true, _count: { select: { elements: true } } },
    }),
    db.period.findMany({
      where: { statut: { in: ["BROUILLON", "ACTIVE"] } },
      orderBy: { dateDebut: "asc" },
      select: { id: true, nom: true, statut: true, dateDebut: true, dateFin: true },
    }),
  ]);

  const entete = (
    <div>
      <p className="text-sm text-texte-secondaire">
        <Link href="/admin/templates">← Templates</Link>
      </p>
      <h1 className="text-3xl">Appliquer un template</h1>
    </div>
  );

  // Rien à appliquer, ou nulle part où l'appliquer : on le dit, et on mène à l'écran qui le règle.
  if (templates.length === 0) {
    return (
      <div className="flex flex-col gap-5">
        {entete}
        <Alerte titre="Aucun template pour l'instant">
          <p>Un template décrit un cours type : horaire, lieu et programme. Crée-en un, puis reviens ici pour le poser sur des dates.</p>
        </Alerte>
        <LienBouton href="/admin/templates" variante="secondaire" className="self-start" enCours>
          Créer un template
        </LienBouton>
      </div>
    );
  }
  if (periodes.length === 0) {
    return (
      <div className="flex flex-col gap-5">
        {entete}
        <Alerte titre="Aucune période ouverte">
          <p>Un template se pose sur les dates d&apos;une période en préparation ou en cours. Les périodes closes ne se modifient plus.</p>
        </Alerte>
        <LienBouton href="/admin/periodes" variante="secondaire" className="self-start" enCours>
          Voir les périodes
        </LienBouton>
      </div>
    );
  }

  const choisie = periodeParDefaut(periodes, aujourdHui, periode)!;
  const templateChoisi = templates.find((t) => t.id === template) ?? templates[0];
  const seances = await db.session.findMany({
    where: { periodId: choisie.id },
    orderBy: [{ date: "asc" }, { heureDebut: "asc" }],
    select: SELECT_SEANCE_APPLICATION,
  });

  const resumes: TemplateResume[] = templates.map((t) => ({
    id: t.id,
    nom: t.nom,
    heureDebut: t.heureDebut,
    heureFin: t.heureFin,
    lieu: t.lieu,
    elements: t._count.elements,
  }));
  const ouvertes: PeriodeOuverte[] = periodes.map((p) => ({ id: p.id, nom: p.nom, statut: p.statut, dateDebut: p.dateDebut, dateFin: p.dateFin }));

  return (
    <div className="flex flex-col gap-5">
      {entete}
      <p className="text-texte-secondaire">
        Choisis un template et des dates : l&apos;écran montre ce qui sera fait pour chacune avant que tu valides. Rien
        n&apos;est écrasé — une séance au programme déjà réglé, annulée ou commencée est laissée telle quelle.
      </p>
      {/* **Remonté à chaque période** (`key`) : les dates choisies n'ont de sens que dans la période où
          on les a prises, et le template choisi revient par l'URL, qui le porte. */}
      <AppliquerTemplate
        key={choisie.id}
        templates={resumes}
        templateInitial={templateChoisi.id}
        periodes={ouvertes}
        periodeId={choisie.id}
        seances={seances.map((s) => versSeanceExistante(s, now))}
        aujourdHui={aujourdHui}
      />
    </div>
  );
}
