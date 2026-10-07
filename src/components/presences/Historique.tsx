import { formatDateCourte, formatHeure } from "@/lib/dates";
import { historiquePresences, type HistoriquePeriode } from "@/lib/seances";
import { STATUT_LABELS } from "@/lib/presences";
import type { AttendanceStatut } from "@/lib/constants";
import { Alerte } from "@/components/ui/Alerte";
import { Icone, type NomIcone } from "@/components/ui/Icone";
import { ListeParticipants } from "@/components/seances/ListeParticipants";
import { ListeRepliee } from "@/components/seances/ListeRepliee";
import { couper, COURS_HISTORIQUE_VISIBLES } from "@/components/seances/listes";
import { Tuile } from "@/components/accueil/Indicateurs";
import Link from "next/link";

const PASTILLES: Record<AttendanceStatut, { icone: NomIcone; classes: string }> = {
  PRESENT: { icone: "check", classes: "bg-vert-doux text-vert" },
  ABSENT: { icone: "croix", classes: "bg-rouge-doux text-rouge" },
  PEUT_ETRE: { icone: "question", classes: "bg-ocre-doux text-ocre" },
};

function Pastille({ statut, annulee }: { statut: string | null; annulee: boolean }) {
  if (annulee) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-surface-douce px-2 py-1 text-sm font-semibold text-texte-secondaire">
        <Icone nom="interdit" taille={16} /> Annulée
      </span>
    );
  }
  if (!statut) return <span className="inline-block shrink-0 rounded-md bg-surface-douce px-2 py-1 text-sm text-texte-secondaire">Sans réponse</span>;
  const p = PASTILLES[statut as AttendanceStatut];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-sm font-semibold ${p.classes}`}>
      <Icone nom={p.icone} taille={16} strokeWidth={2.5} /> {STATUT_LABELS[statut as AttendanceStatut]}
    </span>
  );
}

/**
 * **Une séance de l'historique**, sortie de la boucle pour pouvoir être rendue puis repliée.
 *
 * Elle est rendue par le serveur qu'elle soit visible ou cachée : le contenu déplié est
 * exactement celui qu'on aurait eu sans repli.
 */
function LigneSeance({ s }: { s: HistoriquePeriode["seances"][number] }) {
  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex items-start gap-3">
        <span className="flex min-w-0 flex-1 flex-col">
          <span className={`font-semibold ${s.annulee ? "text-texte-secondaire" : ""}`}>
            {formatDateCourte(s.date)}&nbsp;· {formatHeure(s.heureDebut)}
          </span>
          <span className="text-texte-secondaire">
            {s.annulee
              ? s.motifAnnulation || "Séance annulée"
              : `${[s.disciplines.join("\u00a0· "), s.theme].filter(Boolean).join(" — ") || s.lieu}\u00a0· ${s.compteurs.presents}\u00a0présent${s.compteurs.presents > 1 ? "s" : ""} sur ${s.compteurs.invites}`}
          </span>
        </span>
        <Pastille statut={s.statut} annulee={s.annulee} />
      </div>
      {/* L'historique ne montre que des cours déjà donnés : les présents d'abord, jamais les
          sans-réponse — personne ne relance quelqu'un sur un cours de février. */}
      {!s.annulee && <ListeParticipants liste={s.participants} titre="Qui était là ?" compact passee />}
    </li>
  );
}

/**
 * Historique personnel : toutes les périodes, taux par période, statut par séance passée.
 *
 * **C'est le plus gros DOM de l'application, et c'est un écran de membre.** Il charge toutes les
 * périodes, toutes les séances déjà commencées, et pour chacune la liste complète des invités : à
 * quatre-vingts membres après deux saisons, la page contenait près de cinq mille lignes de noms,
 * sur un téléphone, pour répondre à « combien de fois suis-je venu ? ».
 *
 * On replie donc **les séances d'abord**, avant même les noms : {@link COURS_HISTORIQUE_VISIBLES} cours par
 * période, le reste derrière un bouton. C'est la coupe qui rapporte le plus, parce que chaque séance
 * cachée emporte avec elle sa liste nominative entière. Les noms d'une séance visible, eux, sont
 * coupés à `LIGNES_VISIBLES` par colonne par `ListeParticipants` — **deux plafonds distincts**, l'un
 * compte des cours et l'autre des personnes, et les confondre faisait apparaître le repli chez un
 * club de douze dès le deuxième mois d'un trimestre ordinaire.
 *
 * **La coupe se fait aussi côté serveur.** `historiquePresences` ne rapatrie que les quarante
 * derniers cours de chaque période : chaque séance chargée emporte les réponses de **tout le club**,
 * et à quatre-vingts membres sur deux saisons, cet écran de membre pesait des milliers de lignes. Le
 * taux de chaque période, lui, reste calculé sur **tous** les cours — il est relu à part, en quatre
 * colonnes.
 *
 * **`?tout=1` est la porte de sortie assumée**, et c'est un lien plutôt qu'un bouton : ce qui n'a
 * pas été lu ne peut pas être déplié. Le paramètre ne vise aucune période en particulier — il
 * recharge **tout l'historique, toutes les périodes d'un coup**, y compris les saisons qu'on ne
 * cherchait pas. C'est le prix d'une adresse qu'on peut garder en favori et relire telle quelle ;
 * l'écran n'y arrive que sur un geste explicite, et jamais au premier affichage.
 */
export async function Historique({ userId, tout = false }: { userId: string; tout?: boolean }) {
  const periodes = await historiquePresences(userId, undefined, tout ? undefined : COURS_HISTORIQUE_VISIBLES);
  /*
   * **Au téléphone, « Ma présence ce trimestre » en tête** : le taux de la période en cours, **le
   * chiffre même de son en-tête plus bas** (`historiquePresences`, qui borne déjà à la date
   * d'arrivée) — rien n'est recompté ici, deux calculs finiraient par dire deux choses. La tuile est
   * celle de l'accueil, et elle se retire dans le même cas : aucun cours compté, un taux à 0 % ne
   * voudrait rien dire.
   */
  const enCours = periodes.find((p) => p.statut === "ACTIVE" && p.comptees > 0);
  return (
    <div className="flex flex-col gap-6">
      {enCours && (
        <ul className="ordi:hidden">
          <Tuile valeur={`${enCours.pourcentage} %`} libelle="Ma présence ce trimestre" detail={`${enCours.presences} cours sur ${enCours.comptees}`} />
        </ul>
      )}
      {periodes.length === 0 && (
        <Alerte type="info" titre="Aucun cours passé pour l&apos;instant">
          Ton historique se remplira au fur et à mesure des cours.
        </Alerte>
      )}
      {periodes.map((p) => (
        <section key={p.id} className="overflow-hidden rounded-2xl border border-bordure/60 bg-surface shadow-carte">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-bordure bg-surface-douce px-4 py-3">
            <h2 className="text-lg font-bold">
              {p.nom}
              {p.statut === "ACTIVE" && <span className="ml-2 align-middle rounded-md bg-primaire px-2 py-0.5 text-sm font-semibold text-primaire-texte">en cours</span>}
            </h2>
            {p.comptees > 0 && (
              <p className="text-sm text-texte-secondaire">
                <strong className="text-base text-texte">{p.pourcentage}&nbsp;%</strong>&nbsp;· {p.presences}&nbsp;présence{p.presences > 1 ? "s" : ""} sur {p.comptees}{" "}
                cours
              </p>
            )}
          </header>
          <ListeSeancesPassees seances={p.seances} aPlus={p.aPlus} />
        </section>
      ))}
    </div>
  );
}

/**
 * Les séances d'une période : les plus récentes, puis le reste.
 *
 * Deux cas, et c'est la charge qui les sépare : quand tout est chargé, le reste se déplie sur place ;
 * quand le serveur a coupé (`aPlus`), les cours plus anciens ne sont pas dans la page — il n'y a rien
 * à déplier, seulement un lien qui va les chercher.
 */
function ListeSeancesPassees({ seances, aPlus }: { seances: HistoriquePeriode["seances"]; aPlus: boolean }) {
  // Les séances arrivent de la plus récente à la plus ancienne : ce qu'on garde sous les yeux est
  // donc bien ce qu'on vient de vivre, et ce qui part derrière le bouton, les vieux cours.
  const { montrees, cachees } = couper(seances, COURS_HISTORIQUE_VISIBLES);
  return (
    <ul className="divide-y divide-bordure">
      {montrees.map((s) => (
        <LigneSeance key={s.id} s={s} />
      ))}
      {aPlus ? (
        <li className="px-4 py-3">
          <Link href="/seances?vue=historique&tout=1" className="font-semibold">
            Afficher tous les cours précédents
          </Link>
        </li>
      ) : (
        <ListeRepliee
          cachees={cachees.map((s) => <LigneSeance key={s.id} s={s} />)}
          visibles={montrees.length}
          /* La tranche est celle de la coupe de cet écran : on dévoile des **cours**, et par le même
             pas que celui qui a décidé de la coupe — vingt de plus ici couperait un trimestre en deux. */
          tranche={COURS_HISTORIQUE_VISIBLES}
          quoi="cours précédents"
          unite="cours"
          replier="Replier les cours précédents"
          className="px-4 py-3"
        />
      )}
    </ul>
  );
}
