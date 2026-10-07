import type { Metadata } from "next";
import { Fragment } from "react";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/current-user";
import { db } from "@/lib/db";
import { saisonDe } from "@/lib/periodes";
import { formatDateCourte } from "@/lib/dates";
import { Carte } from "@/components/ui/Carte";
import { LienBouton } from "@/components/ui/Bouton";
import { Cellule, Ligne, Tableau, type PalierTableau } from "@/components/ui/Tableau";
import { Alerte } from "@/components/ui/Alerte";
import { Pastille } from "@/components/ui/Pastille";
import { GroupeListe, LigneLien } from "@/components/ui/ListeGroupee";

export const metadata: Metadata = { title: "Périodes" };

const TON = { BROUILLON: "neutre", ACTIVE: "vert", CLOSE: "ocre" } as const;
const LABEL = { BROUILLON: "Brouillon", ACTIVE: "Active", CLOSE: "Close" } as const;

type Props = { searchParams: Promise<{ supprimee?: string }> };

/**
 * **Le palier du vrai tableau suit la largeur de la page** — même valeur, même raison et même forme
 * que l'annuaire : une seule écriture dans le fichier, pour qu'on ne puisse pas en déplier une moitié.
 */
const PALIER_TABLEAU: PalierTableau = "lg";

/** « 1 sept. » : le jour et le mois, sans le jour de la semaine — la ligne du téléphone est courte. */
function jourMois(iso: string): string {
  return new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", day: "numeric", month: "short" }).format(new Date(`${iso}T12:00:00Z`));
}

/** Les périodes rangées par saison, dans l'ordre reçu (les plus récentes d'abord). */
function parSaison<P extends { dateDebut: string }>(periodes: readonly P[]): [string, P[]][] {
  const groupes: [string, P[]][] = [];
  for (const p of periodes) {
    const saison = saisonDe(p.dateDebut);
    const dernier = groupes.at(-1);
    if (dernier && dernier[0] === saison) dernier[1].push(p);
    else groupes.push([saison, [p]]);
  }
  return groupes;
}

export default async function PagePeriodes({ searchParams }: Props) {
  await requirePermission("periods.manage");
  const { supprimee } = await searchParams;
  const periodes = await db.period.findMany({
    orderBy: { dateDebut: "desc" },
    include: { _count: { select: { membres: { where: { user: { service: false } } }, sessions: true } }, invitations: { where: { revokedAt: null }, select: { usedAt: true } } },
  });
  return (
    <div className="flex flex-col gap-5">
      {supprimee && <Alerte type="succes">La période « {supprimee} » a été supprimée.</Alerte>}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl">Périodes</h1>
        </div>
        <LienBouton href="/admin/periodes/nouvelle">Nouvelle période</LienBouton>
      </div>
      {/*
       * **Sur téléphone, une ligne par période** : son nom, ses dates et ses séances,
       * l'état en pastille à droite ; toucher la ligne ouvre la période, où tout se gère (séances,
       * activer, clore). Le reste des colonnes — invités, liens activés — vit sur cette page-là.
       * La bascule est en CSS : le serveur rend les deux, la fenêtre choisit, et il n'y a aucun
       * champ de formulaire à ne pas doubler. Sur ordinateur, rien ne change.
       */}
      {periodes.length === 0 ? (
        <p className="text-texte-secondaire ordi:hidden">Aucune période pour l&apos;instant.</p>
      ) : (
        <div className="flex flex-col gap-5 ordi:hidden" data-liste-periodes>
          {parSaison(periodes).map(([saison, liste]) => (
            <GroupeListe key={saison} titre={`Saison ${saison}`}>
              {liste.map((p) => (
                <LigneLien
                  key={p.id}
                  href={`/admin/periodes/${p.id}`}
                  titre={p.nom}
                  detail={`${jourMois(p.dateDebut)} → ${jourMois(p.dateFin)}\u00a0· ${p._count.sessions}\u00a0${p._count.sessions > 1 ? "séances" : "séance"}`}
                  resume={<Pastille ton={TON[p.statut as keyof typeof TON] ?? "neutre"}>{LABEL[p.statut as keyof typeof LABEL] ?? p.statut}</Pastille>}
                />
              ))}
            </GroupeListe>
          ))}
        </div>
      )}
      <Carte className="hidden ordi:block">
        {/*
         * **Le tableau attend le pixel où la page s'élargit**.
         *
         * Cet écran est entré dans la liste des écrans larges (`largeurs.ts`) : il reçoit 1 440 px à
         * partir de 1 024 px de fenêtre. Au palier `md` (768 px) qu'il portait par défaut, ses six
         * colonnes se dépliaient **une résolution trop tôt**, dans une colonne de lecture de 736 px :
         * mesuré sur une fenêtre de 900 px, « Rentrée 2026 » recevait **89 px** et se pliait en deux
         * lignes (ligne de 72 px au lieu de 65), pendant que 164 px de marge restaient vides à droite.
         * C'est exactement le cas que `PalierTableau` décrit pour l'annuaire : entre 768 et 1 023 px, la
         * pile de fiches rend l'information **entière**, le tableau la serre. Le tableau se déplie donc
         * au même pixel que la page s'élargit, et les deux décisions ne peuvent plus diverger.
         *
         * **Entre 768 et 1 023 px**, en dessous des deux paliers, chaque ligne est une fiche où
         * chaque valeur porte son intitulé. Sous 768 px, c'est la liste du dessus qui parle.
         *
         * Pas de `whitespace-nowrap` sur le nom, et c'est volontaire : le palier `lg` n'a **pas** de
         * défilement intérieur (voir `PalierTableau`), donc un nom long — le champ en accepte 60
         * caractères — ne pourrait que déborder la page elle-même. Mesuré après coup : à 976 px, la
         * colonne « Période » reçoit 155 px pour un nom de 105, et plus rien ne se plie.
         */}
        <Tableau palier={PALIER_TABLEAU} entetes={["Période", "Dates", "Statut", "Invités", "Séances", "Liens activés"]} vide={periodes.length === 0 && <p className="p-4 text-texte-secondaire">Aucune période pour l&apos;instant.</p>}>
          {periodes.map((p, i) => {
            const actives = p.invitations.filter((i) => i.usedAt).length;
            const saison = saisonDe(p.dateDebut);
            const nouvelleSaison = i === 0 || saisonDe(periodes[i - 1].dateDebut) !== saison;
            return (
              <Fragment key={p.id}>
              {nouvelleSaison && (
                <tr className="block lg:table-row">
                  <th colSpan={6} scope="colgroup" className="block bg-surface-douce/70 px-3 py-1.5 text-left font-titre text-base font-normal lg:table-cell">
                    Saison {saison}
                  </th>
                </tr>
              )}
              <Ligne palier={PALIER_TABLEAU} className="hover:bg-surface-douce/50">
                <Cellule palier={PALIER_TABLEAU}>
                  <Link href={`/admin/periodes/${p.id}`} className="inline-flex min-h-11 items-center font-semibold">
                    {p.nom}
                  </Link>
                </Cellule>
                <Cellule palier={PALIER_TABLEAU} label="Dates" className="whitespace-nowrap">
                  {formatDateCourte(p.dateDebut)} → {formatDateCourte(p.dateFin)}
                </Cellule>
                <Cellule palier={PALIER_TABLEAU} label="Statut">
                  <Pastille ton={TON[p.statut as keyof typeof TON] ?? "neutre"}>{LABEL[p.statut as keyof typeof LABEL] ?? p.statut}</Pastille>
                </Cellule>
                <Cellule palier={PALIER_TABLEAU} label="Invités">{p._count.membres}</Cellule>
                <Cellule palier={PALIER_TABLEAU} label="Séances">{p._count.sessions}</Cellule>
                <Cellule palier={PALIER_TABLEAU} label="Liens activés">{p.statut === "BROUILLON" ? "—" : `${actives} / ${p.invitations.length}`}</Cellule>
              </Ligne>
              </Fragment>
            );
          })}
        </Tableau>
      </Carte>
    </div>
  );
}
