import type { AttendanceStatut } from "@/lib/constants";
import { formatDateCourte, formatHoraire, lienCarte } from "@/lib/dates";
import {
  calculerTaux,
  effectifAttendu,
  palierEffectif,
  PALIER_LABELS,
  seuilEnPersonnes,
  STATUT_LABELS,
  type Compteurs,
  type Palier,
} from "@/lib/presences";
import type { Participant, SeanceCarte } from "@/lib/seances";
import { Icone, type NomIcone } from "@/components/ui/Icone";
import { ListeParticipants } from "@/components/seances/ListeParticipants";
import { ProgrammeCours } from "@/components/seances/ProgrammeCours";
import { Pastille } from "@/components/ui/Pastille";

/**
 * Le mot du palier, en pastille **bordée** : la même échelle que partout ailleurs
 * (`palierEffectif`), mais dessinée en contour plutôt qu'en aplat.
 *
 * Pourquoi un contour ici : la fiche porte déjà une jauge en aplats de vert et d'ocre juste en
 * dessous. Une troisième surface pleine de la même famille de couleurs, à deux centimètres, se
 * serait lue comme un segment de plus. Le contour dit la même chose sans ajouter de masse
 * colorée. La règle de la charte tient : **jamais une couleur nue** — le mot du palier est
 * toujours écrit à côté d'elle, et `indetermine` (groupe invité plus petit que le seuil)
 * n'affiche rien du tout.
 *
 * **Ne sert plus que la variante non personnelle** : le palier est l'échelle du seuil sous une
 * autre forme, donc un jugement sur le remplissage du cours. Il appartient à la vue Club et à
 * l'encadrement, pas à l'accueil d'un membre (voir `FichesProchains`).
 */
const CONTOUR_PALIER: Record<Palier, string> = {
  indetermine: "border-bordure text-texte-secondaire",
  danger: "border-rouge/60 text-rouge",
  juste: "border-ocre/60 text-ocre",
  bien: "border-vert/60 text-vert",
};

/** « présents » / « présent » — accord au pluriel, sans jamais écrire « présent(s) ». */
function motAccorde(n: number, singulier: string, pluriel = `${singulier}s`): string {
  return n > 1 ? pluriel : singulier;
}

/** « 8 présents » / « 1 présent » — le nombre et son mot accordé, d'un bloc. */
function accorde(n: number, singulier: string, pluriel = `${singulier}s`): string {
  return `${n} ${motAccorde(n, singulier, pluriel)}`;
}

/**
 * **La jauge des invités, segmentée** — qui vient, qui hésite, et ce que pèse le reste du club,
 * sur une seule ligne à l'échelle de l'effectif invité.
 *
 * Pourquoi pas `BarreTaux` : sa jauge est d'une seule pièce (le taux de présents, à l'or de
 * l'écu) et elle traîne avec elle un grand chiffre et une étiquette dont la fiche n'a pas besoin.
 * Ici on veut voir **la composition** de la réponse — trois « Peut-être » qui peuvent encore
 * basculer ne se distinguent pas d'un taux de 40 % sur une barre unique.
 *
 * Les segments sont dimensionnés par `flex-grow` proportionnel au nombre de personnes, et séparés
 * par 2 px de fond : deux couleurs voisines qui se touchent donnent une bordure fantôme qui se lit
 * comme un groupe de plus. Un groupe vide n'est pas dessiné du tout, sinon il laisserait un écart
 * sans segment. Un cadre pointillé n'est pas un aplat : ce qui n'est pas une réponse n'en mérite
 * pas un.
 *
 * **Deux découpages, selon `personnel`** :
 * - variante **personnelle** : vert, ocre, et **un seul segment neutre en pointillé** pour tout le
 *   reste du club. Pas de rouille, pas d'aplat d'absents. Un membre qui ouvre son accueil n'a pas
 *   à y lire un décompte de ceux qui ne viennent pas : ce serait un reproche adressé aux autres,
 *   posé au milieu de sa propre soirée ;
 * - variante **non personnelle** (vue Club, onglet Séances) : les quatre groupes, absents compris.
 *   Là, savoir combien de refus une séance récolte fait partie du travail.
 */
function JaugeInvites({ compteurs: c, personnel = false }: { compteurs: Compteurs; personnel?: boolean }) {
  const neutre = "border border-dashed border-bordure";
  const segments: Array<{ cle: string; n: number; classes: string }> = personnel
    ? [
        { cle: "presents", n: c.presents, classes: "bg-vert" },
        { cle: "peutEtre", n: c.peutEtre, classes: "bg-ocre" },
        { cle: "reste", n: c.invites - c.presents - c.peutEtre, classes: neutre },
      ]
    : [
        { cle: "presents", n: c.presents, classes: "bg-vert" },
        { cle: "peutEtre", n: c.peutEtre, classes: "bg-ocre" },
        { cle: "absents", n: c.absents, classes: "bg-rouge" },
        { cle: "enAttente", n: c.enAttente, classes: neutre },
      ];
  // L'étiquette lue à voix haute dit exactement ce que la barre montre, ni plus ni moins : en
  // variante personnelle, énumérer les absents à la synthèse vocale reviendrait à réintroduire par
  // l'oreille ce qu'on vient de retirer de l'œil.
  const etiquette = personnel
    ? `Sur ${c.invites} invités : ${accorde(c.presents, "présent")}, ${c.peutEtre} peut-être`
    : `Sur ${c.invites} invités : ${accorde(c.presents, "présent")}, ${c.peutEtre} peut-être, ${accorde(c.absents, "absent")}, ${c.enAttente} sans réponse`;
  return (
    <div role="img" aria-label={etiquette} className="flex h-2.5 w-full items-stretch gap-0.5">
      {segments
        .filter((s) => s.n > 0)
        .map((s) => (
          <span key={s.cle} style={{ flex: `${s.n} 1 0%` }} className={`rounded-full ${s.classes}`} />
        ))}
    </div>
  );
}

/** Un petit indicateur de la fiche : sa valeur en gras, sa légende en petit, rien de cliquable. */
function Indicateur({ valeur, legende, ton, large = false }: { valeur: string; legende: string; ton: string; large?: boolean }) {
  return (
    // `large` : l'indicateur prend sa propre ligne dans la rangée (`basis-full`) au lieu de se
    // serrer à côté de son voisin — c'est ce qu'il faut à une liste de noms.
    <div className={large ? "basis-full" : ""}>
      <p className={`font-bold tabular-nums ${ton}`}>{valeur}</p>
      <p className="text-xs leading-tight text-texte-secondaire">{legende}</p>
    </div>
  );
}

/**
 * « Amélie Roy, Jean Petit et 2 autres » — au plus trois noms, le reste compté.
 *
 * **Ne sert plus que la variante non personnelle** : c'est la seule chose de la fiche qui désigne
 * des gens par leur nom, et l'accueil d'un membre ne nomme personne d'autre que lui.
 */
function manquants(liste: Participant[]): string {
  if (liste.length === 0) return "personne";
  const noms = liste.slice(0, 3).map((p) => `${p.prenom} ${p.nom}`);
  const reste = liste.length - noms.length;
  if (reste === 0) return noms.join(", ");
  return `${noms.join(", ")} et ${reste} autre${reste > 1 ? "s" : ""}`;
}

/**
 * Ma réponse, aux couleurs de statut de l'application : les mêmes appariements que sur la carte
 * d'une séance et dans la liste nominative — vert/check pour « Présent », rouge/croix pour
 * « Absent », ocre/question pour « Peut-être ». Deux tables de couleurs qui divergeraient seraient
 * le début des ennuis.
 */
const MA_REPONSE: Record<AttendanceStatut, { ton: "vert" | "rouge" | "ocre"; icone: NomIcone }> = {
  PRESENT: { ton: "vert", icone: "check" },
  ABSENT: { ton: "rouge", icone: "croix" },
  PEUT_ETRE: { ton: "ocre", icone: "question" },
};

/**
 * **Ce que j'ai répondu pour ce cours-là** — le bloc propre à la variante personnelle de la fiche.
 *
 * Il est posé **en tête du corps de la fiche**, juste sous la date et le lieu : dans la vue
 * « Personnel », sa propre réponse prime sur les chiffres du cours, qu'on ne lit qu'ensuite. C'est
 * aussi la seule information que la frise, elle, ne montre pas — elle compte le groupe, jamais la
 * personne.
 *
 * Trois cas, et trois seulement :
 * - **répondu** : la réponse en pastille, avec son mot. Jamais une couleur nue : un aplat vert sans
 *   « Présent » écrit à côté ne se lit pas, et pas du tout pour qui distingue mal le rouge du vert ;
 * - **pas encore répondu, et invité** : une ligne ocre, nette, la seule chose de la fiche qui
 *   appelle un geste. **Sans bouton** : `BoutonPresences` est déjà en haut de la vue, et l'accueil
 *   reste un compte rendu — deux chemins vers le même écran, dont l'un répété quatre fois, feraient
 *   de cette page un formulaire ;
 * - **non invité sur la période** (un instructeur venu observer, une recrue arrivée après l'envoi
 *   des invitations) : **rien du tout**. Il n'a pas de réponse à donner, une relance lui
 *   réclamerait quelque chose d'impossible et une pastille « Sans réponse » lui reprocherait un
 *   silence qui n'en est pas un.
 */
function MaReponse({ seance: s }: { seance: SeanceCarte }) {
  if (!s.inscrit) return null;
  const reponse = s.monStatut ? MA_REPONSE[s.monStatut as AttendanceStatut] : null;
  if (!reponse) {
    return (
      <p className="flex items-center gap-2 rounded-lg bg-ocre-doux px-3 py-2 text-sm font-semibold text-ocre">
        <Icone nom="alerte" taille={18} />
        Tu n&apos;as pas encore répondu
      </p>
    );
  }
  return (
    <p className="flex flex-wrap items-center gap-2 text-sm text-texte-secondaire">
      Ma réponse
      <Pastille ton={reponse.ton}>
        <Icone nom={reponse.icone} taille={16} strokeWidth={2.5} />
        {STATUT_LABELS[s.monStatut as AttendanceStatut]}
      </Pastille>
    </p>
  );
}

/**
 * **Les quatre prochains cours, un par un** — l'accueil en fiches compactes.
 *
 * Nées pour la vue « Club », elles n'y sont plus. Elles servent depuis la **vue « Personnel »**, où
 * `personnel` ne décide plus seulement de ce qui s'ajoute, mais de **ce que la fiche a le droit de
 * dire**.
 *
 * Ce ne sont **pas** les anciennes cartes de cours : celles-là redisaient en dix lignes ce que la
 * frise montre d'un coup d'œil juste au-dessus.
 *
 * ## Le principe qui gouverne la variante `personnel`
 *
 * **Rien sur l'accueil d'un membre ne doit sonner comme un reproche, ni envers lui, ni envers les
 * autres.** Tout le reste en découle : les chiffres qui aident à s'organiser restent, ceux qui
 * désignent quelqu'un ou constatent un échec s'en vont ou changent de ton.
 *
 * ## Ce que la fiche personnelle porte
 *
 * Dans l'ordre où on se les demande :
 * 1. **quand et où** — la date, l'horaire, le lieu ;
 * 2. **ce que j'ai répondu** — « Ma réponse » en pastille, ou la relance ocre (voir `MaReponse`) ;
 * 3. **ce que je vais travailler** — le programme du cours en quelques lignes : le thème de chaque
 *    partie, les options, qui encadre, les ateliers placés ;
 * 4. **on sera combien** — **les deux nombres réels**, écrits comme la frise les écrit : les
 *    présents en vert et nettement plus gros, les peut-être en ocre juste derrière, chacun avec
 *    son mot. Delta range explicitement le remplissage du cours dans ce qui l'intéresse : c'est
 *    la question « on sera combien mardi », pas un renseignement sur quelqu'un ;
 * 5. **la composition** de cette réponse, en jauge — vert, ocre, et un seul segment neutre pour le
 *    reste du club (voir `JaugeInvites`) ;
 * 6. **un chiffre** : la part d'invités qui se sont prononcés, en ton neutre.
 *
 * ## Ce qu'elle a cessé de porter, et pourquoi
 *
 * Deux choses **nommaient des gens** et sont parties : l'indicateur « qui manque à l'appel » et le
 * volet « Voir qui a répondu ». Ce sont des outils de relance, c'est-à-dire du travail
 * d'encadrement : ils disent qui aller chercher. Sur l'accueil d'un membre, ils transformaient une
 * page qui parle de lui en liste de comptes à rendre par d'autres. Ils n'ont rien perdu : ils
 * vivent dans la vue Club et dans l'onglet Séances, où ils sont à leur place et où la liste
 * nominative est ouverte à tout le club depuis l'étape 2 (même choix que sur Cally).
 *
 * Trois autres sont parties le même jour, à — « enlève les moyennes et fais présents (en plus gros)
 * + peut-être ; enlève ce qui touche au seuil » —, et elles répondaient toutes à la même question,
 * qui n'est pas celle d'un membre :
 * - le grand **« ~N attendus sur N invités »**, une **estimation** (les peut-être comptés pour
 *   moitié). C'est le chiffre sur lequel on prépare du matériel ; ce n'est pas un chiffre qu'on
 *   *connaît*. À qui vient au cours, on doit les nombres réels — 7 viennent, 2 hésitent — et non
 *   une moyenne dont il faut d'abord comprendre la recette ;
 * - la **marge au seuil** (« +2 de marge au-dessus du seuil ») ;
 * - la **pastille du palier** (« Effectif juste », « Bien rempli », « Peu de monde ») : c'est
 *   l'échelle du seuil sous une autre forme, et donc un verdict sur le cours.
 *
 * **Pourquoi ces trois-là ensemble :** l'accueil d'un membre répond à « je viens, et on sera
 * combien », pas à « ce cours est-il en danger ». La seconde question est réelle, mais c'est une
 * question d'encadrement — on y répond en déplaçant une séance, en relançant le club, en fusionnant
 * deux cours —, et rien de tout cela n'est à la portée de qui lit son accueil. Lui poser la
 * question sans lui donner les moyens d'y répondre ne fait qu'une chose : mettre sur son cours du
 * mardi soir un jugement dont il n'a rien à faire. Le seuil vit dans la vue Club, dans l'onglet
 * Séances et sur la frise, où il commande des décisions.
 *
 * Deux choses ont été **gardées mais désarmées**, plutôt que retirées — elles servent à
 * s'organiser, c'est leur tonalité qui posait problème : la jauge perd son rouge, et le taux de
 * réponse reste neutre quel que soit le pourcentage (voir `ChiffresDuCours`).
 *
 * ## Le programme du cours, revenu — un revirement assumé
 *
 * « Ajoute aussi les thèmes et options dans les séances de la page d'accueil user. » La veille, le
 * programme quittait les tuiles de l'onglet Séances ; le lendemain, il entre sur l'accueil, vue
 * « Personnel ». Ce n'est pas la même décision prise deux fois en sens contraire : les deux écrans
 * ne posent pas la même question.
 *
 * Sur une tuile de `/seances`, le programme repoussait les trois boutons de réponse sous la ligne
 * de flottaison — là, **répondre** est l'affaire de la page, et douze cartes allongées de quatre
 * lignes faisaient un mur de texte où l'on cherchait la date. Sur l'accueil, la réponse est déjà
 * donnée ou se donne ailleurs (`BoutonPresences`, en haut de la vue) : la fiche **rend compte**, et
 * « qu'est-ce qu'on travaille mardi ? » est précisément une des choses dont on vient rendre compte.
 * Le programme arrive donc à sa place naturelle, **juste après « ce que j'ai répondu » et avant les
 * chiffres** : d'abord ce que j'ai à faire, puis ce que je vais faire, puis combien on sera.
 *
 * Ce qui entre avec lui : les **thèmes** des deux parties, les **options**,
 * **qui encadre** chacune et les **ateliers placés**. Les instructeurs reviennent ainsi eux aussi,
 * mais **dans le programme**, accrochés à la partie qu'ils mènent — et non en liste de noms posée
 * en tête de fiche, où ils ne disaient rien de plus que la carte de l'onglet Séances.
 *
 * Tout cela tient dans une fiche parce que c'est `ProgrammeCours` en variante `compact` qui
 * l'écrit : quelques lignes, rien de cliquable, et **rien du tout** quand la séance n'a pas encore
 * de programme — pas de « programme à venir », pas de bloc vide. Une fiche reste une fiche. Le
 * composant se tait de lui-même, c'est pourquoi il est posé ici sans condition.
 *
 * ## Variante non personnelle — inchangée
 *
 * Elle garde tout, au trait près : la pastille du palier, le grand « ~N attendus », les quatre
 * segments de la jauge, le détail des absents, le « −2 » rouge sous le seuil, l'indicateur
 * nominatif et le volet replié. **Et elle reste sans programme** : ne l'a pas touchée. Elle sert la
 * vue Club et l'encadrement, qui lisent le programme là où il se travaille, dans la grille du
 * planning, et n'ont rien à gagner à le relire dans une demi-fiche.
 *
 * ## Dans les deux
 *
 * Une **séance annulée** s'arrête à sa date barrée et à son motif : ni effectif, ni lieu, ni
 * relance — tous ces mots parleraient d'une soirée qui n'existe pas.
 *
 * Ce qui n'y est **pas**, dans aucune des deux : un bloc d'instructeurs à part. Une liste de noms
 * alignée en tête de fiche n'apprend rien ; ces mêmes noms ont un sens accrochés à la partie que
 * chacun mène, et c'est le programme qui les écrit ainsi — donc sur l'accueil personnel, et nulle
 * part ailleurs sur ces fiches.
 *
 * Rien n'y est cliquable : l'accueil est un compte rendu, l'action vit sur `/seances`.
 */
export function FichesProchains({
  seances,
  partEffectifMin,
  personnel = false,
}: {
  seances: SeanceCarte[];
  /**
   * La part minimale d'effectif du club (`Identite.partEffectifMin`), en % des invités : le palier de
   * la pastille et la marge au seuil. Le seuil en personnes s'en déduit pour chaque cours avec son
   * effectif invité (`seuilEnPersonnes`, plancher de quatre compris) — aucune fiche n'a de nombre à
   * recopier. Elle arrive en **propriété** depuis l'accueil, qui est un composant serveur — ces
   * fiches sont un composant client, et importer `src/lib/identite.ts` d'ici entraînerait
   * `node:crypto` dans le bundle du navigateur (voir `src/lib/constants.ts`).
   */
  partEffectifMin: number;
  personnel?: boolean;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xl">{seances.length > 1 ? "Les prochains cours" : "Le prochain cours"}</h2>
      {/* **Une fiche par ligne, pleine largeur**. En deux colonnes, la fiche d'une séance annulée —
          une date barrée et un motif, 90 px — voisinait avec une séance à sept parties qui en
          faisait 600 : la colonne courte laissait un demi-écran de blanc, et c'est le trou qu'on
          voyait avant les cours. Empilées, toutes les fiches partagent les mêmes bords gauche et
          droit ; seule la hauteur varie, et c'est assumé — une séance à sept parties *est* plus
          longue qu'une séance annulée. C'est aussi ce qui rend la largeur utile : les lignes du
          programme ont enfin la place d'écrire un nom d'instructeur en entier. */}
      <ul className="flex flex-col gap-3">
        {seances.map((s) => (
          <FicheSeance key={s.id} seance={s} partEffectifMin={partEffectifMin} personnel={personnel} />
        ))}
      </ul>
    </section>
  );
}

function FicheSeance({ seance: s, partEffectifMin, personnel }: { seance: SeanceCarte; partEffectifMin: number; personnel: boolean }) {
  const c = s.compteurs;
  const attendus = effectifAttendu(c);
  const palier = palierEffectif(c, partEffectifMin);
  const motDuPalier = PALIER_LABELS[palier];
  // Le seuil en personnes de *ce* cours, pour l'infobulle : la part réglée par le club appliquée à
  // son effectif invité, jamais moins que le plancher.
  const seuil = seuilEnPersonnes(partEffectifMin, c.invites);
  return (
    <li className={`flex flex-col gap-3 rounded-2xl border bg-surface p-3 shadow-carte sm:p-4 ${s.annulee ? "border-rouge/30" : "border-bordure/60"}`}>
      {/* **Les deux bouts de la ligne sont tenus** : la date à gauche, ce qui complète à droite —
          le lieu sur l'accueil d'un membre, la pastille du palier ou « Annulée » ailleurs. C'est la
          même grammaire que les tuiles de la bande, et c'est elle qui évite qu'une bande de
          1 200 px se lise comme une ligne vide avec une date perdue à gauche. Sur un téléphone,
          `flex-wrap` remet simplement le second bloc sous le premier, comme avant. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <p className="min-w-0">
          <span className={`font-semibold ${s.annulee ? "text-texte-secondaire line-through" : ""}`}>{formatDateCourte(s.date)}</span>
          <span className="text-texte-secondaire">
            {"\u00a0· "}
            {formatHoraire(s.heureDebut, s.heureFin)}
          </span>
        </p>
        {/* **Le lieu, variante personnelle seulement**, au bout de la ligne de la date : « quand »
            et « où » sont une seule question, et la largeur gagnée est exactement ce qu'il faut
            pour les écrire côte à côte. Le lieu ne dit rien de personne — il manquait, il entre.
            Une séance annulée n'en montre rien : elle s'arrête à la date barrée et au motif.

            **Et c'est un lien vers la carte**, comme sur la carte de séance : on lit cet écran
            sur un téléphone, souvent en partant au cours, et « où est-ce ? » finit toujours dans
            une application de carte — recopier l'adresse à la main est le seul geste que
            l'application peut éviter. `lienCarte` sait déjà se passer d'une adresse vide.
            La ligne prend `min-h-11` pour rester une cible confortable au doigt. */}
        {personnel && !s.annulee && (
          <span className="flex min-h-11 min-w-0 items-center text-sm text-texte-secondaire">
            <a
              href={lienCarte(s.lieu, s.adresse)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-w-0 items-center gap-1.5 underline decoration-bordure hover:text-lien hover:decoration-lien"
              title={s.adresse ? `${s.adresse} — ouvrir la carte` : "Ouvrir la carte"}
            >
              <Icone nom="lieu" taille={16} />
              <span className="truncate">{s.lieu}</span>
            </a>
          </span>
        )}
        {/* **Pas de pastille de palier dans la variante personnelle** : c'est un verdict sur le
            remplissage du cours, donc le seuil sous un autre mot (voir `FichesProchains`). Le bout
            droit de la ligne n'y reste pas vide pour autant — c'est le lieu qui l'occupe. */}
        {s.annulee ? (
          <Pastille ton="rouge">
            <Icone nom="interdit" taille={16} />
            Annulée
          </Pastille>
        ) : (
          !personnel &&
          motDuPalier && (
            <span
              title={`Effectif attendu : ~${attendus} — seuil : ${seuil} personnes (${partEffectifMin} % des invités)`}
              className={`rounded-md border px-2 py-0.5 text-sm font-semibold ${CONTOUR_PALIER[palier]}`}
            >
              {motDuPalier}
            </span>
          )
        )}
      </div>
      {/* Un cours qui n'a pas lieu n'a ni effectif attendu, ni marge au seuil, ni taux de réponse :
          tous ces chiffres parleraient d'une soirée qui n'existe pas. La fiche s'arrête au motif. */}
      {s.annulee ? (
        <p className="text-sm text-texte-secondaire">Motif : {s.motifAnnulation || "non précisé"}</p>
      ) : (
        <>
          {/* Ma réponse avant les chiffres du cours : dans la vue « Personnel », c'est elle qu'on
              vient vérifier. Une séance annulée n'en montre rien — elle est dans la branche d'à
              côté : il n'y a plus rien à répondre à un cours qui n'a pas lieu, et une relance ocre
              y serait une faute. */}
          {personnel && <MaReponse seance={s} />}
          {/* **Ce que je vais travailler**, entre ma réponse et les chiffres. L'ordre de la fiche
              raconte la soirée dans l'ordre où on se la demande : ce que j'ai à faire, ce qu'on va
              faire, combien on sera. Le programme ne passe pas devant la réponse — elle reste la
              seule chose de l'écran qui appelle un geste — et ne repousse rien sous la ligne de
              flottaison d'un téléphone de 390 px : la variante `compact` tient en quelques lignes.
              **Posé sans condition** : `ProgrammeCours` ne rend rien de lui-même quand la séance
              n'a pas de programme, et une séance annulée est dans la branche d'à côté — ce qu'on
              aurait travaillé à un cours qui n'a pas lieu ne se lit pas. **Variante personnelle
              seulement** : la vue Club garde exactement le balisage qu'elle avait (voir
              `FichesProchains`). */}
          {personnel && <ProgrammeCours programme={s.programme} theme={s.theme} alternative={s.alternative} compact />}
          {/* **Les nombres et la jauge sur une même ligne** : ce sont deux façons de dire la même
              chose — combien on sera —, et la largeur gagnée sert exactement à les mettre côte à
              côte plutôt que d'empiler deux blocs dont le second n'est haut que de 10 px. */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            {personnel ? (
              /* **Les deux nombres réels, comme la frise les écrit** (). Les présents en vert, à
                  la taille qu'occupait l'estimation ; les peut-être en ocre, un cran plus petit,
                  parce qu'ils complètent la lecture sans la commander. Les couleurs sont celles des
                  statuts, ici comme sur la frise et sur les boutons de réponse. **Chaque nombre
                  porte son mot** : jamais une couleur nue — un « 2 » ocre seul ne se lit pas, et
                  pas du tout pour qui distingue mal l'ocre du vert. **Un zéro ne s'écrit pas**,
                  même règle que la frise : sans peut-être, le second nombre et son mot
                  disparaissent plutôt que d'aligner un « 0 peut-être » qui n'apprend rien. Les
                  présents, eux, s'écrivent toujours : ils sont la réponse à la question, et « 0
                  présents » est une information. */
              <p className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <span className="flex items-baseline gap-2">
                  <strong className="text-4xl font-bold leading-none tabular-nums text-vert">{c.presents}</strong>
                  <span className="text-texte-secondaire">{motAccorde(c.presents, "présent")}</span>
                </span>
                {c.peutEtre > 0 && (
                  <span className="flex items-baseline gap-1.5">
                    <strong className="text-2xl font-semibold leading-none tabular-nums text-ocre">{c.peutEtre}</strong>
                    <span className="text-sm text-texte-secondaire">peut-être</span>
                  </span>
                )}
              </p>
            ) : (
              <div>
                <p className="flex items-baseline gap-2">
                  {/* Le tilde dit que c'est un ordre de grandeur (les « Peut-être » comptent pour
                      moitié, voir `effectifAttendu`) : c'est là-dessus qu'on prépare le matériel.
                      **Vue Club et onglet Séances seulement** : préparer une séance est un travail
                      d'encadrement, et c'est là que l'estimation sert. */}
                  <strong className="text-4xl font-bold leading-none tabular-nums text-vert">~{attendus}</strong>
                  {/* L'effectif invité se relit dans le taux de réponse juste en dessous, et la
                      ligne reste courte. */}
                  <span className="text-texte-secondaire">attendus</span>
                </p>
                {/* Les réponses sont toujours écrites, même à zéro : les fiches se comparent deux par
                    deux, et un détail dont la forme change d'une fiche à l'autre ne se compare plus. */}
                <p className="mt-1 text-sm text-texte-secondaire">
                  {accorde(c.presents, "présent")}, {c.peutEtre} peut-être, {accorde(c.absents, "absent")}
                </p>
              </div>
            )}
            {/* La jauge prend tout ce qui reste à droite des nombres, et rien de plus : c'est une
                barre, elle se lit à n'importe quelle largeur. Sur un téléphone, `flex-wrap` la
                remet sous les nombres — l'ordre de lecture de la fiche ne change pas d'un écran à
                l'autre. `min-w-40` l'empêche de se réduire à un trait de quelques pixels avant de
                passer à la ligne. */}
            <div className="min-w-40 flex-1">
              <JaugeInvites compteurs={c} personnel={personnel} />
            </div>
          </div>
          <ChiffresDuCours seance={s} attendus={attendus} partEffectifMin={partEffectifMin} personnel={personnel} />
        </>
      )}
    </li>
  );
}

/**
 * **Les chiffres avec lesquels on s'organise** — le bas de la fiche.
 *
 * Un seul dans la variante personnelle (le taux de réponse), quatre ailleurs : s'y ajoutent la
 * marge au seuil, l'indicateur nominatif « qui manque à l'appel » et le volet « Voir qui a
 * répondu ». **Pourquoi aucun des trois n'est sur l'accueil d'un membre** : les deux derniers sont
 * des outils de relance et le premier un état du remplissage — dans les deux cas du travail
 * d'encadrement, qui se fait dans la vue Club et dans l'onglet Séances.
 *
 * Celui qui reste a été **gardé mais désarmé** — voir le détail du ton sous lui.
 */
function ChiffresDuCours({
  seance: s,
  attendus,
  partEffectifMin,
  personnel,
}: {
  seance: SeanceCarte;
  attendus: number;
  partEffectifMin: number;
  personnel: boolean;
}) {
  const c = s.compteurs;
  // **La marge au seuil, vue Club et onglet Séances seulement**. C'est la question qu'on se pose
  // vraiment quand on tient un cours : combien de désistements supporte-t-il encore ? Un « +1 » se
  // lit tout de suite comme « il ne tient qu'à un fil », et « −2 sous le seuil » en rouge montre
  // d'un coup d'œil quelles séances sont en difficulté — c'est exactement ce que le rouge doit
  // faire ici. Le vrai signe moins (U+2212) et non un trait d'union : sur un chiffre, le tiret du
  // clavier est trop court et se lit comme une puce de liste. Le seuil se recalcule ici pour *ce*
  // cours : c'est une part de son effectif invité, pas un nombre fixe. Soustraire la part elle-même
  // donnerait « +9 de marge » sur un club de quatre-vingts dont le seuil vaut 16 personnes.
  const seuilCours = seuilEnPersonnes(partEffectifMin, s.compteurs.invites);
  const palier = palierEffectif(c, partEffectifMin);
  const marge = attendus - seuilCours;
  const sousLeSeuil = marge < 0;
  const margeTexte = sousLeSeuil ? `−${-marge}` : marge > 0 ? `+${marge}` : "0";
  const margeLegende = sousLeSeuil ? "sous le seuil" : "de marge au-dessus du seuil";
  // **L'ocre suit l'échelle, il ne garde pas un nombre figé**. Il se déclenchait sur `marge <= 2`,
  // c'est-à-dire l'ancien « seuil + 3 » d'un temps où le seuil était un nombre de personnes. Depuis
  // que le seuil est une part de l'effectif, le confort aussi (`seuilConfort`) : sur un club de
  // quatre-vingts réglé à 20 %, le vert commençait à 19 attendus alors que tous les autres écrans
  // n'annoncent « Bien rempli » qu'à 24. La couleur d'ici disait donc l'inverse du mot affiché à
  // côté. Elle lit désormais la même fonction que `palierEffectif`.
  /*
   * **La couleur vient du palier, pas d'un calcul parallèle**.
   *
   * Elle se déduisait de `seuilCours` et `seuilConfort` à la main — les mêmes ingrédients que
   * `palierEffectif`, mais pas la même fonction. Le commentaire ci-dessus l'affirmait déjà (« elle lit
   * désormais la même fonction ») sans que ce soit vrai, et le jour où `palierEffectif` a gagné une
   * seconde borne dégénérée, cette ligne a continué de peindre : sur un club de six invités, la fiche
   * affichait « −2 » en **rouge** avec la légende « sous le seuil » et **aucun mot à côté** — la couleur
   * nue que le dossier interdit nommément (« une couleur de palier est toujours doublée du mot »).
   */
  const tonMarge = palier === "indetermine" ? "text-texte-secondaire" : palier === "danger" ? "text-rouge" : palier === "juste" ? "text-ocre" : "text-vert";
  const repondu = c.invites - c.enAttente;
  const tauxReponse = calculerTaux(repondu, c.invites);
  const sansReponse = s.participants.sansReponse;
  return (
    <>
      {/* **Une rangée souple, plus une grille à deux colonnes** : sur une fiche pleine largeur, une
          demi-colonne valait 600 px pour écrire « 92 % — de réponses — 11 sur 12 ». Les indicateurs
          se suivent donc de gauche à droite et passent à la ligne quand la place manque ; celui qui
          porte des noms (« qui manque à l'appel ») garde sa ligne à lui, trois noms complets ne
          tenant pas à côté d'autre chose sur un téléphone. */}
      <div className="flex flex-wrap gap-x-10 gap-y-2">
        {!personnel && <Indicateur valeur={margeTexte} legende={margeLegende} ton={tonMarge} />}
        {/* Le taux de réponse est **neutre en toutes circonstances**, dans les deux variantes : ni
            vert, ni ocre, ni rouge, quel que soit le pourcentage. C'est un état — où en est le
            club de ses réponses —, pas un jugement, et surtout pas sur la personne qui lit. */}
        <Indicateur valeur={`${tauxReponse} %`} legende={`de réponses — ${repondu} sur ${c.invites}`} ton="text-texte" />
        {/* Sur sa propre ligne : trois noms complets ne tiennent pas à côté d'un autre indicateur
            sur un téléphone, et c'est la ligne qui déclenche une relance. */}
        {!personnel && (
          <Indicateur
            valeur={manquants(sansReponse)}
            legende={sansReponse.length > 1 ? "n'ont pas encore répondu" : sansReponse.length === 1 ? "n'a pas encore répondu" : "ne manque à l'appel"}
            ton={sansReponse.length > 0 ? "text-texte" : "text-vert"}
            large
          />
        )}
      </div>
      {/* **Qui a répondu quoi**, replié. Même composant, mêmes couleurs de statut et même ordre
          que sur la carte d'une séance et sur la ligne de l'accueil : deux listes nominatives
          qui divergeraient seraient le début des ennuis. Fermée par défaut — les fiches se
          comparent l'une sous l'autre, et doivent le rester sans qu'on ait rien à déplier.
          L'indicateur « qui manque à l'appel » reste au-dessus : il nomme ceux qu'on relance,
          ce n'est pas la même information que « qui a répondu quoi ».
          Rien de cliquable au-delà du volet : l'accueil rend compte, il n'agit pas. */}
      {!personnel && <ListeParticipants liste={s.participants} titre="Voir qui a répondu" compact />}
    </>
  );
}
