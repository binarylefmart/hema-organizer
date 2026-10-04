"use client";

import { useId, useState } from "react";
import { formatDateFrise } from "@/lib/dates";
import { effectifAttendu, palierEffectif, PALIER_LABELS, seuilEnPersonnes, type Compteurs } from "@/lib/presences";
import { detailDesReponses, hauteurDuSeuil, nombresDeLaColonne, partDesInvites } from "@/lib/frise";
import { FriseDetail, TEXTE_SEGMENT, type DetailsCours } from "@/components/accueil/FriseDetail";

/**
 * Une colonne de la frise. `details` est **facultatif** : sans lui la colonne n'est pas cliquable
 * et la frise se comporte exactement comme avant le dépliage — c'est le cas de la frise du mois de
 * la vue Admin, dont les données ne portent pas les noms.
 */
export type CoursFrise = { id: string; date: string; annulee: boolean; compteurs: Compteurs; details?: DetailsCours };

/**
 * La date d'une colonne dense, en deux lignes : « ven. » puis « 25 sept. ».
 *
 * Le mois entier compte une quinzaine de colonnes, et le jour seul (« 25 ») n'y disait plus de quel
 * cours il s'agissait —. Deux lignes plutôt qu'une : « ven. 25 sept. » sur un seul rang forcerait
 * des colonnes deux fois plus larges, ou une taille de police illisible.
 */
function dateEnDeuxLignes(iso: string): [string, string] {
  const complet = formatDateFrise(iso); // « ven. 25 sept » — l'abréviation du jour porte déjà son point
  const [jour, ...reste] = complet.split(" ");
  return [jour.endsWith(".") ? jour : `${jour}.`, reste.join(" ")];
}

/**
 * **La frise de fréquentation** — un seul coup d'œil pour savoir où ça se remplit et où ça se vide.
 *
 * **Le dessin est celui de la « capacité »** : chaque colonne fait **la hauteur du club entier**,
 * et se remplit des présents (vert) puis des peut-être (ocre). Ce qui reste en clair au-dessus,
 * c'est exactement le nombre de personnes qu'il reste à convaincre.
 *
 * Pourquoi celui-là, après deux autres :
 * - l'**empilement** additionnait ce qui ne s'additionne pas, et on ne savait pas si un cours se
 *   remplissait ou se vidait ;
 * - le **dos à dos** tirait les absents vers le bas, ce qui se lisait comme un déficit — et surtout
 *   la vue Club n'affiche que **quatre cours** : à quatre colonnes, tout histogramme vertical à
 *   hauteur libre devient un mur de blocs ;
 * - la **capacité**, elle, donne à toutes les colonnes la même hauteur. On ne compare plus les
 *   cours entre eux, on lit **ce qui reste à remplir**, et quatre colonnes de même hauteur ne
 *   forment plus un mur mais une série de jauges.
 *
 * Les autres partis pris :
 * - **deux nombres, et deux seulement, à la couleur de leur statut** : les présents en vert, les
 *   peut-être en ocre, au-dessus de la colonne, le premier plus gros que l'autre. Un zéro ne
 *   s'écrit pas (des zéros alignés seraient du bruit) et il n'y a plus de « + » devant les
 *   peut-être : la couleur suffit à les séparer.
 *
 * **Il y en avait trois, le dernier disait les absents en rouille** — il est parti, quand Delta a
 * précisé : « je ne veux pas voir apparaître les absents, le schéma de couleurs était juste pour
 * l'info ». En nommant « présents en vert, peut-être en jaune, absents en rouge », il fixait la
 * **convention de couleurs** de l'application, il ne demandait pas un affichage de plus. **Et c'est
 * la bonne lecture :** la frise dit **qui vient**, elle ne montre pas du doigt ceux qui ne viennent
 * pas. Le nombre d'absents n'aide en rien à préparer un cours — le vert, l'ocre et le vide
 * au-dessus disent déjà tout — mais écrit en gros sous une colonne, il désignait des gens. Ce n'est
 * le rôle ni d'une frise, ni d'un club. Le compte complet reste accessible à qui le demande :
 * infobulle et lecteur d'écran (`detailDesReponses`).
 *
 *   **Conséquence assumée : le nombre de présents ne porte plus la couleur du palier**
 *   (`TEXTE_PALIER`). Ce n'est pas une perte de sens, c'est un retour à la règle générale de
 *   l'application — *sur un statut, la couleur dit lequel ; sur un effectif, elle dit si le cours
 *   se remplit* (voir le commentaire de `TEXTE_PALIER` dans `RepartitionPresences.tsx`). Ces deux
 *   nombres sont des statuts, pas un effectif : ils doivent donc dire *lequel*. Et le palier reste
 *   parfaitement lisible sur la frise, mieux qu'un chiffre coloré ne le disait :
 *   **une colonne dont le vert n'atteint pas le trait du seuil est un cours en danger**. C'est
 *   précisément ce que le dessin « capacité » montre, et il le montre sur toutes les colonnes à la
 *   fois. Le mot du palier, lui, reste dans l'infobulle et pour le lecteur d'écran ;
 * - **les dates sont écrites en toutes lettres**, jusque sur le mois entier (deux lignes en mode
 *   dense) : un numéro de jour nu ne dit pas de quel cours il s'agit ;
 * - **la ligne du seuil** traverse la frise. Elle prend enfin tout son sens : l'échelle étant
 *   désormais absolue — l'effectif invité —, le trait est au même endroit sur toutes les colonnes
 *   **d'un même trimestre**. Il suit l'effectif de chaque colonne dès que la frise en mêle deux (deux
 *   périodes peuvent être ACTIVE en même temps, et les prochains cours viennent de toutes), et il ne
 *   se trace pas du tout sur un trimestre trop petit pour que le seuil veuille dire quelque chose —
 *   la garde `invites > seuil` de `BarreTaux` et de `palierEffectif` ;
 * - **les couleurs sont celles des statuts** (vert Présent, ocre Peut-être), doublées d'une
 *   légende ; jamais une couleur nue ne porte seule l'information. La rouille d'« Absent » reste
 *   la couleur du statut partout ailleurs dans l'application — simplement, la frise ne la dessine
 *   nulle part ;
 * - **une séance annulée garde sa colonne**, vide et marquée : la sauter décalerait les autres et
 *   ferait croire à un cours de moins. Elle ne se déplie pas non plus : elle n'a ni effectif ni
 *   liste qui vaille.
 *
 * **Pourquoi ce composant est devenu client** : c'est un invariant documenté et testé qui tombe — «
 * composant serveur sans état, sans JavaScript client ». Il tombe en connaissance de cause. Quelle
 * colonne est ouverte est un état **purement local et éphémère** : le faire côté serveur
 * demanderait un aller-retour par page, donc un rechargement complet pour ouvrir un panneau —
 * impensable pour un geste qu'on répète quatre fois de suite. Et **aucune donnée de plus ne part au
 * navigateur** : les listes nominatives sont déjà envoyées à la frise avec le reste de l'accueil,
 * elles sont ouvertes à tout le club depuis l'étape 3. Le coût se résume à `useState` et à quelques
 * octets de JavaScript.
 *
 * En mode `dense` (le mois entier, vue Admin), les colonnes gardent une largeur minimale et la
 * frise défile horizontalement si l'écran est trop étroit : des dates lisibles valent mieux qu'une
 * frise entière illisible.
 */
export function Frise({
  cours,
  partEffectifMin,
  titre = "Fréquentation",
  dense = false,
}: {
  cours: readonly CoursFrise[];
  /**
   * La part minimale d'effectif du club (`Identite.partEffectifMin`), en % des invités : le trait en
   * pointillé de chaque colonne, le palier écrit dans l'infobulle et le seuil en personnes annoncé
   * par la légende. Le seuil s'en déduit avec l'effectif invité du trimestre
   * (`seuilEnPersonnes`) — plancher de quatre compris, c'est lui qui commande dans un petit club.
   *
   * Elle arrive en **propriété** depuis l'accueil, qui est un composant serveur : la frise est un
   * composant client, et importer `src/lib/identite.ts` d'ici entraînerait `node:crypto` dans le
   * bundle du navigateur (voir `src/lib/constants.ts`).
   */
  partEffectifMin: number;
  titre?: string;
  dense?: boolean;
}) {
  // Une colonne ne se déplie que si elle a de quoi remplir le panneau et si le cours a lieu.
  const depliable = (c: CoursFrise) => c.details !== undefined && !c.annulee;
  // Les crochets sont appelés avant toute sortie anticipée : React exige un ordre d'appel stable,
  // et une frise vide reste un rendu comme un autre.
  const idBase = useId();
  // **Le prochain cours arrive déplié**. La première colonne dépliable est, par construction, le
  // prochain cours qui aura vraiment lieu — ni annulé, ni dépourvu de détails —, et c'est
  // exactement celui dont on vient lire le détail en arrivant : le faire ouvrir à la main, c'était
  // un appui demandé à tout le monde pour la même colonne. Si aucune n'est dépliable (frise du mois
  // de la vue Admin, trimestre sans détail), rien ne s'ouvre et la frise est exactement celle
  // d'avant le dépliage.
  const [ouvert, setOuvert] = useState<string | null>(() => cours.find(depliable)?.id ?? null);
  // Vrai dès le premier appui sur une colonne. L'ouverture du premier rendu ne s'anime pas — le
  // panneau est déjà là au chargement, il n'a pas à se déplier sous les yeux —, celles qu'on
  // déclenche ensuite, si (voir `anime` dans `FriseDetail`).
  const [appuye, setAppuye] = useState(false);
  if (cours.length === 0) return null;
  /*
   * **Chaque colonne a l'échelle de SON trimestre**.
   *
   * L'effectif invité était pris une fois pour toutes, au maximum des colonnes — vrai tant que la
   * frise ne montrait qu'une période, faux dès qu'elle en montre deux. Or elle en montre deux : les
   * prochains cours de l'accueil viennent de **toutes** les périodes ACTIVE où la personne est
   * invitée (`prochainesSeances`), et un club qui tient un trimestre « Adultes » (60 invités) et un
   * trimestre « Enfants » (10) en a deux ouverts en même temps. Une colonne « Enfants » à 8 présents
   * sur 10 se dessinait alors à 8/60 — 13 % de hauteur, sous le trait du seuil — avec l'étiquette
   * « Bien rempli » et l'infobulle « 8 présents sur 60 invités ». Le palier, lui, était déjà calculé
   * par colonne : le dessin contredisait le mot écrit à côté.
   *
   * `invitesDe` est donc l'effectif de la colonne, jamais 0 — sans invité il n'y a pas d'échelle, et
   * une division par zéro n'est pas un dessin.
   */
  const invitesDe = (c: CoursFrise) => Math.max(1, c.compteurs.invites);
  /*
   * L'effectif que la **légende** annonce : celui de toutes les colonnes quand elles le partagent (le
   * cas ordinaire, un seul trimestre ouvert), `null` quand elles n'ont pas le même. Un nombre unique
   * écrit sous une frise qui mêle deux trimestres serait faux pour l'un des deux ; on nomme alors le
   * cadre sans le chiffrer, plutôt que d'annoncer un effectif que la moitié des colonnes démentent.
   */
  const effectifs = new Set(cours.map(invitesDe));
  const invites = effectifs.size === 1 ? [...effectifs][0] : null;
  // Le seuil en personnes du trimestre : la part réglée appliquée à l'effectif invité, jamais moins
  // que le plancher. C'est ce nombre-là que la légende annonce, et c'est celui du trait de chaque
  // colonne — calculé là aussi sur l'effectif de la colonne (voir `hauteurDuSeuil` plus bas).
  const seuil = invites === null ? null : seuilEnPersonnes(partEffectifMin, invites);
  const ecart = dense ? "gap-1" : "gap-3";
  const indexOuvert = cours.findIndex((c) => c.id === ouvert && depliable(c));
  const coursOuvert = indexOuvert >= 0 ? cours[indexOuvert] : null;
  // Le centre de la colonne ouverte, en pourcentage de la largeur : les colonnes se partagent la
  // largeur à parts égales (`flex-1`), la pointe tombe donc au milieu de la sienne.
  const pointe = ((indexOuvert + 0.5) / cours.length) * 100;
  return (
    <section aria-label="Fréquentation des prochains cours" className="rounded-2xl border border-bordure/60 bg-surface p-3 shadow-carte sm:p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="font-semibold">{titre}</h2>
        {/* La légende nomme les deux couleurs et le cadre : sans elle, la partie claire du haut
            pourrait se lire comme un manque plutôt que comme les invités qui restent à convaincre,
            et les deux nombres colorés comme une hiérarchie plutôt que comme deux statuts. Elle ne
            nomme pas les absents : ils ne sont dessinés nulle part, une légende pour eux
            annoncerait une couleur qui n'existe plus sur la frise. */}
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-texte-secondaire">
          <span className="flex items-center gap-1">
            <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm bg-vert" />
            présents
          </span>
          <span className="flex items-center gap-1">
            <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm bg-ocre" />
            peut-être
          </span>
          <span className="flex items-center gap-1">
            <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm border border-bordure bg-surface-douce" />
            {invites === null ? "invités" : `${invites} invités`}
          </span>
        </p>
      </div>
      {/* En mode dense, la frise défile plutôt que de rétrécir ses colonnes sous la largeur d'une
          date : c'est la lisibilité des dates qui commande, pas le nombre de colonnes à l'écran. */}
      <div className={dense ? "-mx-1 overflow-x-auto px-1" : ""}>
        <div className={`flex items-end ${ecart} ${dense ? "min-w-full" : ""}`}>
          {cours.map((c) => {
            const presents = c.annulee ? 0 : c.compteurs.presents;
            const peutEtre = c.annulee ? 0 : c.compteurs.peutEtre;
            const attendus = c.annulee ? 0 : effectifAttendu(c.compteurs);
            // L'échelle de cette colonne : l'effectif invité de **son** trimestre, et lui seul.
            const invitesColonne = invitesDe(c);
            // Une séance annulée n'a pas de palier : elle n'est ni pleine ni vide, elle n'a pas lieu.
            const palier = palierEffectif(c.compteurs, partEffectifMin);
            const mot = PALIER_LABELS[palier];
            // L'infobulle et le lecteur d'écran donnent le compte **complet**, absents compris :
            // c'est du détail à la demande — on va le chercher —, pas un affichage qu'on subit.
            const detail = c.annulee
              ? "Séance annulée"
              : `${detailDesReponses(c.compteurs)} — ~${attendus} attendus sur ${invitesColonne} invités${mot ? ` (${mot.toLowerCase()})` : ""}`;
            const [jour, reste] = dateEnDeuxLignes(c.date);
            const nombres = nombresDeLaColonne(c.compteurs, c.annulee);
            const estOuvert = coursOuvert?.id === c.id;
            const contenu = (
              <>
                {/* **Les deux nombres, à la couleur de leur statut.** Le premier — les présents —
                    est le plus gros : c'est celui qu'on vient lire, et c'est l'effectif sur lequel
                    on prépare vraiment le cours. Le second reste en retrait d'un cran, parce qu'il
                    complète la lecture sans la commander. La hauteur minimale du rang est réservée
                    par la taille du texte : un cours sans aucune réponse n'écrit rien du tout, et
                    les colonnes voisines ne doivent pas se décaler pour autant. */}
                <span className={`flex min-h-[1.2em] items-baseline justify-center gap-1.5 ${dense ? "text-lg" : "text-2xl"}`}>
                  {c.annulee ? (
                    <span className="font-bold tabular-nums text-texte-secondaire">—</span>
                  ) : (
                    nombres.map(({ cle, nombre }) => (
                      <span
                        key={cle}
                        className={`tabular-nums ${TEXTE_SEGMENT[cle]} ${
                          cle === "presents" ? "font-bold" : `font-semibold ${dense ? "text-xs" : "text-base"}`
                        }`}
                      >
                        {nombre}
                      </span>
                    ))
                  )}
                </span>
                {/* Le cadre : la hauteur du club entier. C'est le vide au-dessus qu'on vient lire.
                    Tout le contenu d'une colonne est en `span` : une colonne dépliable est un
                    `<button>`, et un bouton n'admet pas de contenu de type bloc. Les classes de
                    disposition (`flex`, `block`, `absolute`) donnent l'affichage voulu, le balisage
                    reste valide. */}
                <span
                  className="relative flex w-full flex-col justify-end overflow-hidden rounded-md border border-bordure bg-surface-douce"
                  style={{ height: dense ? "5.5rem" : "7rem" }}
                >
                  {/* **La ligne du seuil, à la hauteur du seuil de CETTE colonne.** Elle est au même
                      endroit sur toutes les colonnes d'un même trimestre — l'échelle y est absolue,
                      c'est l'effectif invité — et elle suit l'effectif quand la frise mêle deux
                      trimestres ouverts en même temps.

                      **Et elle ne se trace pas quand il n'y a rien à dépasser** : sur un trimestre de
                      trois invités, le seuil (plancher de quatre) est au-dessus de l'effectif, donc
                      le trait se posait à 100 % pendant qu'aucune colonne ne pouvait l'atteindre ni
                      recevoir de couleur de palier. C'est la garde de `BarreTaux` (`invites > seuil`),
                      qui est aussi celle de `palierEffectif` (« indéterminé ») : au-dessous, l'échelle
                      ne veut rien dire et on ne dessine pas un seuil auquel personne ne répond.
                      **On lit la fonction plutôt que de recopier sa condition** :
                      `palierEffectif` a gagné une seconde borne dégénérée — un groupe trop petit pour
                      que « bien » soit atteignable —, et la condition recopiée ici a aussitôt cessé de
                      dire la même chose qu'elle. La promesse du commentaire était donc fausse pendant
                      quelques heures. */}
                  {palier !== "indetermine" && (
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-x-0 border-t border-dashed border-texte-secondaire/50"
                      style={{ bottom: `${hauteurDuSeuil(partEffectifMin, invitesColonne)}%` }}
                    />
                  )}
                  {!c.annulee && (
                    <>
                      {/* Les peut-être coiffent le vert, séparés de lui par deux pixels de fond :
                          deux couleurs qui se touchent se lisent comme une seule barre. */}
                      {peutEtre > 0 && (
                        <span className="mb-[2px] block w-full bg-ocre" style={{ height: `${partDesInvites(peutEtre, invitesColonne)}%` }} />
                      )}
                      {presents > 0 && <span className="block w-full bg-vert" style={{ height: `${partDesInvites(presents, invitesColonne)}%` }} />}
                    </>
                  )}
                </span>
                <span className={`flex flex-col items-center text-center leading-tight ${dense ? "text-[0.625rem]" : "text-xs"} ${c.annulee ? "text-texte-secondaire line-through" : "text-texte-secondaire"}`}>
                  {dense ? (
                    <>
                      <span>{jour}</span>
                      <span>{reste}</span>
                    </>
                  ) : (
                    <span>{formatDateFrise(c.date)}</span>
                  )}
                </span>
              </>
            );
            // Le même gabarit pour les deux formes, afin qu'une frise sans dépliage garde
            // exactement les dimensions de l'autre : c'est la bordure transparente qui réserve la
            // place du cadre de la colonne ouverte.
            const gabarit = `flex min-w-0 flex-1 flex-col items-center gap-1.5 rounded-lg border p-1 ${dense ? "min-w-[2.75rem]" : ""} ${
              coursOuvert && !estOuvert ? "opacity-60" : ""
            }`;
            if (!depliable(c)) {
              return (
                <div key={c.id} title={detail} aria-label={detail} className={`${gabarit} border-transparent`}>
                  {contenu}
                </div>
              );
            }
            // Un vrai bouton, et non un `div` cliquable : on gagne d'un coup le focus au clavier,
            // l'activation à Entrée **et** à Espace, le rôle annoncé au lecteur d'écran et le
            // contour de focus de la charte. `aria-expanded` dit l'état, `aria-controls` désigne
            // le panneau qui s'ouvre plus bas.
            return (
              <button
                key={c.id}
                type="button"
                title={detail}
                aria-label={detail}
                aria-expanded={estOuvert}
                aria-controls={`${idBase}-${c.id}`}
                onClick={() => {
                  setAppuye(true);
                  setOuvert(estOuvert ? null : c.id);
                }}
                className={`${gabarit} transition-colors motion-reduce:transition-none ${
                  estOuvert ? "border-texte-secondaire/60 bg-surface-douce/60" : "border-transparent hover:border-bordure"
                }`}
              >
                {contenu}
              </button>
            );
          })}
        </div>
      </div>
      {/* Une seule colonne ouverte à la fois, et le panneau vit **sous la frise entière**, pas dans
          la colonne : une bande pleine largeur a la place d'écrire, une colonne non. La clé le
          remonte quand on change de cours, ce qui rejoue l'ouverture. */}
      {coursOuvert?.details && (
        <FriseDetail
          key={coursOuvert.id}
          id={`${idBase}-${coursOuvert.id}`}
          date={coursOuvert.date}
          details={coursOuvert.details}
          compteurs={coursOuvert.compteurs}
          pointe={pointe}
          anime={appuye}
        />
      )}
      {/* La note de pied chiffre le seuil et l'effectif **quand toutes les colonnes partagent le même
          trimestre** — le cas ordinaire. Sur une frise qui en mêle deux (un club qui tient un
          trimestre « Adultes » et un trimestre « Enfants » en même temps), elle dit la règle sans
          l'appliquer à un effectif : chaque colonne a le sien, et un nombre unique en démentirait la
          moitié. */}
      <p className="mt-2 text-xs text-texte-secondaire">
        Au-dessus de chaque colonne : les présents en vert, les peut-être en ocre. La colonne, elle, empile les présents puis
        les peut-être ;{" "}
        {invites === null
          ? `le trait en pointillé marque le seuil d'effectif (${partEffectifMin} % des invités) et le haut de la colonne les invités du trimestre de ce cours-là — les cours affichés ne sont pas tous du même trimestre.`
          : `le trait en pointillé marque le seuil de ${seuil} personnes (${partEffectifMin} % des invités), et le haut de la colonne les ${invites} invités du trimestre.`}
        {cours.some(depliable) && " Appuie sur une colonne pour ouvrir ou refermer son détail."}
      </p>
    </section>
  );
}
