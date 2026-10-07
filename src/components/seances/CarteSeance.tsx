import type { ReactNode } from "react";
import Link from "next/link";
import { formatDateLongue, formatDateSansAnnee, formatHoraire, joursAvant, lienCarte } from "@/lib/dates";
import type { SeanceCarte } from "@/lib/seances";
import { Icone } from "@/components/ui/Icone";
import { LienBouton } from "@/components/ui/Bouton";
import { BoutonPartager } from "@/components/partage/BoutonPartager";
import { partageSeance } from "@/components/partage/contenu";
import { BarreTaux, LigneTaux } from "./BarreTaux";
import { RepartitionPresences } from "./RepartitionPresences";
import { BoutonsPresence } from "./BoutonsPresence";
import { ListeParticipants } from "./ListeParticipants";

/**
 * Carte d'une séance : infos, jauge et boutons de réponse.
 *
 * `actions` est le pied de carte réservé à l'encadrement (modifier, annuler, rétablir) : la carte
 * ne sait pas ce qu'il contient ni qui y a droit — c'est l'écran qui décide, après avoir vérifié
 * la permission côté serveur. Sans lui, la carte est exactement celle que voit un membre.
 *
 * **En version téléphone (au doigt, ou fenêtre de moins de 768 px), la carte est resserrée** : une ligne de
 * chiffres au lieu du grand chiffre et des trois tuiles, et « Qui vient ? » / « Programme » en deux
 * liens courts côte à côte. Une carte faisait un écran entier de téléphone ; elle en fait la moitié.
 * Au-dessus, rien ne change. Tout se joue en CSS (`ordi:` / `tel:`), pour que la page reste rendue
 * côté serveur sans clignoter au chargement — et ici la variante parle bien de l'**appareil** (son
 * pointeur et sa fenêtre), pas de la carte. Seuls deux morceaux existent en double, et
 * aucun n'a d'`id` ni de région vivante : la ligne de chiffres (affichage seul) et le lien du
 * programme. Le masqué est en `display: none`, donc hors de l'arbre d'accessibilité et du parcours au
 * clavier. Les boutons de réponse et la liste nominative, eux, ne sont rendus qu'une fois.
 */
/**
 * **Cochée dans la sélection multiple, au téléphone** : fond doux et bordure pleine de la couleur
 * principale. L'état est lu sur la case elle-même (`:has`), pour que la carte, rendue côté serveur,
 * ne dépende d'aucun état du navigateur — et que la case reste l'unique source de vérité.
 */
const CARTE_COCHEE = "tel:has-[[data-case-selection]:checked]:border-primaire tel:has-[[data-case-selection]:checked]:bg-primaire-doux";

export function CarteSeance({
  seance: s,
  aujourdHui,
  partEffectifMin,
  actions,
  selection,
}: {
  seance: SeanceCarte;
  aujourdHui: string;
  /**
   * La part minimale d'effectif du club (`Identite.partEffectifMin`, en % des invités), qui traverse
   * la carte jusqu'à la jauge (`BarreTaux`) : c'est elle qui en déduit le seuil en personnes.
   */
  partEffectifMin: number;
  actions?: ReactNode;
  /**
   * La case de la sélection multiple (`CaseSeance`), en mode modification seulement : posée **devant
   * la date**, là où l'œil commence la carte, et non au pied, où elle se perdrait au milieu des gestes
   * de la séance seule. Elle ne se rend que si l'interrupteur « Sélection multiple » est ouvert.
   */
  selection?: ReactNode;
}) {
  const dans = joursAvant(aujourdHui, s.date);
  /*
   * **Une carte peut être celle d'un cours passé** depuis la recherche par date : on tape « 8
   * septembre » et la liste rend ce jour-là, qu'il soit devant ou derrière. `dans` est alors
   * **négatif**, et sans ce garde-fou la carte annonçait « Dans -17 jours » et se parait de la
   * bordure des cours imminents — vu sur le premier aperçu de la fonctionnalité. Tant que la liste
   * ne montrait que l'avenir, le cas n'existait pas.
   */
  const passe = dans < 0;
  const quand = passe ? null : dans === 0 ? "Aujourd'hui" : dans === 1 ? "Demain" : dans < 7 ? `Dans ${dans} jours` : null;
  // Aujourd'hui ou demain : c'est le cours sur lequel il faut se prononcer maintenant, la carte le dit d'un coup d'œil
  const imminent = !s.annulee && !passe && dans <= 1;

  return (
    <article
      aria-label={`Séance du ${formatDateLongue(s.date)}`}
      className={`flex flex-col gap-4 rounded-2xl border bg-surface p-4 tel:gap-3 shadow-carte transition-shadow hover:shadow-carte-survol sm:p-5 ${CARTE_COCHEE} ${
        s.annulee ? "border-rouge/30" : imminent ? "border-primaire/50" : "border-bordure/60"
      }`}
    >
      {/* Quand, puis où. La date perd son année (un cours à venir se situe tout seul) et la
          pastille ne s'affiche que lorsqu'elle apprend quelque chose — « Aujourd'hui » et
          « Demain » valent d'être dites, « Dans 5 jours » se lit déjà dans la date. **La date, puis
          le créneau et le lieu à sa suite** : les deux bouts étaient tenus (`justify-between`) le
          temps où la carte allait d'un bord à l'autre de l'écran — il fallait bien meubler 900 px.
          Depuis que la carte est revenue dans la colonne de lecture (voir
          `src/app/(app)/page.tsx`), écarter la date du créneau les fait lire comme deux
          informations sans rapport, alors que c'est la même question. */}
      {/* Sur téléphone, la date seule sur sa ligne, puis « 20h00 à 22h00 · lieu » dessous. */}
      <header className="flex flex-wrap items-center gap-x-4 gap-y-1 tel:gap-y-0">
        {selection}
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          {/* Une séance annulée se barre sur téléphone, où la carte resserrée se parcourt plus
              vite : la date barrée le dit d'un coup d'œil. L'étiquette « Annulée » et le motif
              restent, eux, à toutes les largeurs. */}
          <h2 className={`text-lg font-bold sm:text-xl ${s.annulee ? "text-texte-secondaire tel:line-through" : ""}`}>
            {formatDateSansAnnee(s.date)}
          </h2>
          {s.annulee ? (
            <span className="rounded-md bg-rouge-doux px-2 py-0.5 text-sm font-semibold text-rouge">Annulée</span>
          ) : (
            imminent && quand && <span className="rounded-md bg-primaire px-2 py-0.5 text-sm font-semibold text-primaire-texte">{quand}</span>
          )}
        </div>
        {/* L'horaire et le lieu restent collés l'un à l'autre : ce sont les deux mêmes questions
            (« quand exactement, et où »). */}
        <p className="flex min-h-12 flex-wrap items-center gap-x-2 text-texte-secondaire tel:basis-full">
          <span>{formatHoraire(s.heureDebut, s.heureFin)}</span>
          {/* Pas de séparateur, au téléphone non plus : sur 390 px le lieu passe à la ligne et le
              point restait seul en bout de ligne. L'espacement du conteneur et le pictogramme du lieu
              suffisent à séparer les deux. */}
          {/* La hauteur est portée par le **lien**, et pas seulement par le paragraphe qui
              l'entoure : le `<p>` faisait déjà sa hauteur, mais la zone cliquable, elle, n'avait
              que celle de sa ligne de texte (~27 px). Le lieu est un lien qu'on ouvre en partant au
              cours, une main sur son sac — la cible doit être celle du reste du projet, soit **48
              px**. */}
          <a
            href={lienCarte(s.lieu, s.adresse)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-12 items-center gap-1.5 underline decoration-bordure hover:text-lien hover:decoration-lien"
            title={s.adresse ? `${s.adresse} — ouvrir la carte` : "Ouvrir la carte"}
          >
            <Icone nom="lieu" taille={18} />
            {s.lieu}
          </a>
        </p>
      </header>

      {s.annulee ? (
        <p className="rounded-xl bg-rouge-doux p-3 text-texte">
          <span className="font-semibold">Motif : </span>
          {s.motifAnnulation || "non précisé"}
        </p>
      ) : (
        <>
          {/* **Pas de programme ici**. Une tuile de cette liste sert à **répondre** ; le programme,
              lui, tient trois à quatre lignes par carte — thèmes, options, instructeurs —,
              repoussait les boutons sous la ligne de flottaison et faisait d'une liste de douze
              cours un mur de texte où l'on cherchait la date. Il n'est pas perdu pour autant : la
              séance elle-même porte sa carte « Programme », avec les cases du planning, et c'est
              l'endroit où l'on vient quand on veut savoir ce qu'on va travailler — pas quand on
              veut dire si on vient. */}
          {/* **Répondre, puis les chiffres — empilés, à toutes les largeurs**. La carte a passé une
              journée découpée en deux colonnes au-delà de 1024 px : répondre à gauche, la jauge et
              les pastilles à droite. Delta a tranché sur capture (« je n'aime pas la manière dont
              il est allongé en grand écran ») et la carte est revenue dans la colonne de lecture —
              la découpe devenait alors nuisible, parce que `lg:` mesure la **fenêtre** et non la
              carte : sur un écran de 1 440 px, les trois boutons de réponse se seraient serrés dans
              une demi-colonne de 22 rem, soit plus étroits qu'ils ne l'ont jamais été sur
              téléphone. La réponse reste en premier : c'est la seule action de la carte, elle ne
              doit pas passer sous la ligne de flottaison. **Une seule mise en page**, comme avant :
              les mêmes nœuds dans le même ordre, rien n'est rendu deux fois. */}
          <div className="flex flex-col gap-4">
            <div className="min-w-0">
              {s.inscrit ? (
                <BoutonsPresence sessionId={s.id} statut={s.monStatut} verrouille={s.commencee} />
              ) : (
                <p className="rounded-xl bg-surface-douce px-3 py-2 text-texte-secondaire">
                  Tu n&apos;es pas inscrit(e) à la période « {s.periodNom} » : consultation seule.
                </p>
              )}
            </div>
            {/* Le grand chiffre (coloré par le palier de remplissage), puis la répartition des trois
                réponses : « on est combien » d'abord, « est-ce que ça peut encore bouger » ensuite.
                Les pastilles restent à l'intérieur de la branche « non annulée » : une séance annulée
                n'appelle aucune réponse, elle n'affiche que son motif. */}
            <div className="flex min-w-0 flex-col gap-4 tel:hidden">
              <BarreTaux compteurs={s.compteurs} partEffectifMin={partEffectifMin} />
              <RepartitionPresences compteurs={s.compteurs} />
            </div>
            {/* Sur téléphone : une seule ligne de chiffres et la jauge fine (`LigneTaux`). */}
            <div className="min-w-0 ordi:hidden">
              <LigneTaux compteurs={s.compteurs} partEffectifMin={partEffectifMin} />
            </div>
          </div>
          {/* **Un cours passé ouvre sur « qui était là », pas sur « qui vient ? »** — la séance sait
              si elle a commencé (`s.commencee`, déjà lu deux lignes plus haut pour verrouiller les
              boutons de réponse), et c'est tout ce que `ListeParticipants` demande pour retourner
              l'ordre de ses colonnes. Sans ces deux mots, l'onglet « Passé » ouvrait la liste d'un
              cours de février sur ses quarante-six sans-réponse, c'est-à-dire sur la seule chose que
              plus personne ne peut changer — pendant que la fiche du même cours et l'historique, eux,
              montraient les présents. Trois écrans, la même liste, deux réponses différentes. */}
          {/* Sur téléphone, « Qui vient ? › » et « Programme › » se partagent une ligne. Le lien
              du programme est posé **en absolu** dans le coin du repli, et non dans une ligne à côté
              de lui : le `<details>` porte à la fois son résumé et la liste qu'il déplie, et une
              ligne flexible aurait déplié les noms dans une demi-colonne. Ainsi la liste s'ouvre
              sous les deux liens, sur toute la largeur de la carte. */}
          <div className="relative">
            <ListeParticipants liste={s.participants} titre={s.commencee ? "Qui était là ?" : "Qui vient ?"} passee={s.commencee} resserre />
            {/* Un lien Next, comme le bouton d'ordinateur : une balise nue rechargeait toute l'application. */}
            <Link
              href={`/planning?periode=${s.periodId}${s.commencee ? "&quand=passe" : ""}#seance-${s.id}`}
              className="absolute right-0 top-0 inline-flex min-h-12 items-center gap-1 font-semibold text-lien underline decoration-bordure underline-offset-4 hover:decoration-lien ordi:hidden"
            >
              Programme
              <Icone nom="chevronBas" taille={18} className="-rotate-90" />
            </Link>
          </div>
          {/* **Le programme est parti de la carte, ce bouton dit où il est allé.** Sans lui, retirer
              les thèmes des tuiles aurait été une perte sèche : on ouvre le planning sur la bonne
              période, à la bonne séance (l'ancre `#seance-…`), là où le programme se lit en entier —
              les deux moitiés du cours, les options, et qui encadre.
              **Un vrai bouton, et coloré** : c'est la seconde
              chose qu'on vient chercher sur une séance après « est-ce que je viens ? », et un lien
              discret dans le pied de carte se confondait avec « Partager ». Il ne vole rien aux
              trois boutons de réponse : ceux-ci portent leurs propres couleurs — vert, rouille,
              ocre — et sont posés bien plus haut, juste sous la date. Le bouton du programme, lui,
              ferme la carte.
              `quand=passe` pour un cours déjà commencé : le planning montre l'avenir par défaut, et
              sans ce mot la séance cherchée ne serait pas dans la fenêtre — on arriverait sur une
              grille où l'ancre ne désigne rien. */}
          {/* **Pleine largeur, à toutes les tailles**. Il était bridé à `sm:max-w-sm` et collé à
              gauche, au motif qu'un bouton de 1 400 px ne se lit plus comme un bouton — c'est le
              bouton **court** qui se lisait comme un reste de mise en page. L'objection est
              d'ailleurs tombée d'elle-même le soir même : la carte est revenue dans la colonne de
              lecture, et « toute la largeur » y vaut au plus 44 rem. Il ferme la carte : il en
              prend la largeur. */}
          <div className="tel:hidden">
            <LienBouton
              href={`/planning?periode=${s.periodId}${s.commencee ? "&quand=passe" : ""}#seance-${s.id}`}
              variante="primaire"
              pleineLargeur
            >
              <Icone nom="calendrier" taille={20} />
              Programme de la séance
            </LienBouton>
          </div>
        </>
      )}

      {/* Actions secondaires : le partage est ouvert à tous (c'est le résumé public, sans aucun nom),
          mais il reste en retrait — répondre à l'appel, au-dessus, demeure la seule action qui compte. */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-bordure/50 pt-2">
        <BoutonPartager
          partage={partageSeance(
            { ...s, disciplines: s.disciplines.join(", "), compteurs: s.compteurs },
            aujourdHui,
          )}
          taille="petite"
          variante="discret"
          libelle="Partager"
        />
        {actions}
      </div>
    </article>
  );
}
