import { effectifAttendu, palierEffectif, PALIER_LABELS, seuilEnPersonnes, type Compteurs } from "@/lib/presences";
import { BADGE_PALIER } from "./RepartitionPresences";

/**
 * **Combien de personnes seront là** — le chiffre que tout le monde vient chercher, et qui doit se
 * lire d'un coup d'œil, sans être cherché dans une ligne de texte.
 *
 * Le nombre de présents est donc posé **en grand**, à part, avant tout le reste : c'est la première
 * chose que l'œil rencontre sur une carte de séance, sur le compte rendu de l'accueil et sur la
 * fiche d'une séance. Le taux (« 72 % ») et l'effectif invité (« sur 18 ») restent à côté, en
 * appui : ils expliquent le grand chiffre, ils ne le concurrencent pas.
 *
 * Le chiffre était vert (« Présent ») jusqu'ici. Il porte maintenant **le palier de remplissage**,
 * parce que sa couleur servait à dire ce que le mot « présents » disait déjà à côté de lui ; elle
 * sert désormais à dire ce qu'aucun mot ne disait : est-ce que ce cours-là se remplit ?
 *
 * **Le grand chiffre reste vert** — vu à l'aperçu, le peindre à la couleur du palier ne marchait
 * pas : un « 5 » ocre se retrouvait juste au-dessus d'une pastille ocre « 2 Peut-être », et rien
 * ne disait plus lequel des deux ocres parlait de quoi. Le chiffre compte des **présents**, et le
 * vert veut dire « Présent » dans toute l'application : il garde cette couleur.
 *
 * Le palier de remplissage se lit ailleurs, sans ambiguïté possible : l'étiquette qui porte son
 * mot (« Peu de monde », « Effectif juste », « Bien rempli »), le trait du seuil sur la jauge, et
 * les colonnes de la frise sur l'accueil. Une couleur qui juge le remplissage n'apparaît donc
 * jamais sur un nombre, toujours sur un mot ou sur une barre.
 *
 * (Ancienne intention, conservée pour mémoire : le chiffre portait le palier — rouge
 * « peu de monde », ocre « effectif juste », vert « bien rempli ». C'est le second usage des trois
 * couleurs de la charte, et il ne dit pas la même chose que le premier : sur un **statut** la
 * couleur dit *lequel* (vert « Présent »…), sur un **effectif** elle dit *si le cours se remplit*.
 * Pour qu'un « 2 » en rouge ne puisse jamais se lire « 2 absents », deux garde-fous tenus ici :
 * le chiffre garde à côté de lui son libellé « présent(s) sur N », et le palier est **toujours
 * écrit en toutes lettres** dans l'étiquette de droite (« Peu de monde »), le mot de l'alerte que
 * les instructeurs reçoivent déjà par email. La jauge, elle, reste à l'or de l'écu : une barre
 * repeinte en rouge ou en vert ajouterait une troisième lecture de la même couleur sur la même ligne.
 *
 * Quand la période ne compte pas plus d'invités que le seuil, aucun palier n'est affiché : le
 * groupe invité n'étant pas plus grand que le seuil, le noter « en danger » n'apprendrait rien
 * (même règle que le trait du seuil sur la jauge).
 *
 * `partEffectifMin` est la **part minimale d'effectif réglée par le club** (en % des invités) et
 * elle arrive en **propriété**, depuis l'écran serveur qui rend la barre : ce composant est un
 * composant client, et importer `src/lib/identite.ts` d'ici entraînerait `node:crypto` dans le
 * bundle du navigateur (voir `src/lib/constants.ts`). Le seuil en personnes s'en déduit ici avec
 * l'effectif invité du cours (`seuilEnPersonnes`, plancher de quatre compris) : aucun écran n'a de
 * nombre à recopier.
 *
 * `compact` réduit le chiffre d'un cran pour les listes denses (compte rendu de l'accueil) : il
 * reste nettement plus gros que le texte courant, mais n'écrase pas une ligne de trois lignes.
 * `detail` ajoute la ligne « 2 peut-être · 1 sans réponse », réservée aux écrans qui ne montrent
 * pas la liste nominative juste en dessous (la fiche d'une séance, côté équipe).
 */
export function BarreTaux({
  compteurs: c,
  partEffectifMin,
  compact = false,
  detail = false,
}: {
  compteurs: Compteurs;
  /** La part minimale d'effectif du club (`Identite.partEffectifMin`), en % des invités, passée par l'appelant serveur. */
  partEffectifMin: number;
  compact?: boolean;
  detail?: boolean;
}) {
  const attendus = effectifAttendu(c);
  const palier = palierEffectif(c, partEffectifMin);
  const motDuPalier = PALIER_LABELS[palier];
  // Le seuil en personnes de *ce* cours : la part réglée par le club appliquée à son effectif
  // invité, jamais moins que le plancher. C'est lui qui se dit dans les infobulles et qui place le
  // trait — poser le trait à la part elle-même le mettrait ailleurs que là où le seuil commande.
  const seuil = seuilEnPersonnes(partEffectifMin, c.invites);
  const positionSeuil = c.invites > 0 ? (seuil / c.invites) * 100 : 0;
  /*
   * **Le trait ne se dessine que si un mot peut l'accompagner**. La garde était `c.invites >
   * seuil`, recopiée de `palierEffectif` du temps où c'était sa seule borne dégénérée.
   * `palierEffectif` s'est tu depuis sur un groupe trop petit pour que « bien » soit atteignable
   * (cinq ou six invités avec les valeurs livrées) : la jauge traçait donc un seuil et l'annonçait
   * au lecteur d'écran alors qu'aucun mot ne pouvait plus s'afficher à côté. On lit la fonction, on
   * ne recopie plus sa condition — c'est ce que le dossier dit de faire de chaque règle partagée.
   */
  const seuilVisible = palierEffectif(c, partEffectifMin) !== "indetermine";
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="flex items-baseline gap-2">
          {/* Le chiffre, encore grossi d'un cran : c'est *la* réponse à la question qu'on vient
              poser. Sur téléphone il reste à `text-4xl` en pleine taille — à 60 px, « 13 présents
              sur 18 » repassait à la ligne sur 390 px et la carte perdait ce qu'elle gagnait.
              Le compte rendu de l'accueil (`compact`) est monté au même cran que les cartes : c'est
              le chiffre qu'on y vient chercher, il n'avait pas à y être plus discret. */}
          <strong className={`font-bold leading-none tabular-nums text-vert ${compact ? "text-4xl" : "text-4xl sm:text-5xl"}`}>
            {c.presents}
          </strong>
          <span className="text-texte-secondaire">
            présent{c.presents > 1 ? "s" : ""} sur {c.invites}
            {/* L'estimation n'apparaît que si elle apprend quelque chose : sans « Peut-être » en
                attente, elle répéterait le grand chiffre. Le tilde dit que c'est un ordre de
                grandeur — c'est sur lui qu'on prépare le matériel, pas une promesse. */}
            {attendus > c.presents && <span className="ml-1.5 whitespace-nowrap">· ~{attendus} attendus</span>}
          </span>
        </p>
        <span className="flex flex-wrap items-center gap-1.5">
          {/* Le mot du palier : c'est lui qui donne son sens à la couleur du grand chiffre, et qui
              empêche de la lire comme un statut. Son infobulle donne le compte exact et le seuil. */}
          {motDuPalier && (
            <span
              title={`Effectif attendu : ~${attendus} — seuil : ${seuil} personnes (${partEffectifMin} % des invités)`}
              className={`rounded-md px-2 py-0.5 text-sm font-semibold ${BADGE_PALIER[palier]}`}
            >
              {motDuPalier}
            </span>
          )}
          <span className={`rounded-full bg-surface-douce px-2.5 py-0.5 font-bold text-texte ${compact ? "text-sm" : "text-base"}`}>{c.pourcentage}&nbsp;%</span>
        </span>
      </div>
      {/* La jauge, et le trait du seuil : sous le seuil du club, le cours ne vaut guère la peine
          d'ouvrir la salle (c'est le seuil de l'alerte « peu de monde »). Le trait se lit sans
          lire un seul chiffre — la barre est-elle avant ou après ? Il ne s'affiche que si le seuil
          tombe dans la jauge : sur une période de trois invités, il n'aurait aucun sens. */}
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={c.pourcentage}
        aria-label={`${c.presents} présents sur ${c.invites} — ${c.pourcentage} %${seuilVisible ? ` (seuil : ${seuil} personnes)` : ""}`}
        className={`relative w-full overflow-hidden rounded-full bg-surface-douce shadow-champ ${compact ? "h-2.5" : "h-3"}`}
      >
        <div className="h-full rounded-full bg-jauge" style={{ width: `${c.pourcentage}%` }} />
        {seuilVisible && (
          <span
            aria-hidden
            title={`Seuil : ${seuil} personnes — ${partEffectifMin} % des invités`}
            className="absolute inset-y-0 w-0.5 bg-texte/60"
            style={{ left: `${positionSeuil}%` }}
          />
        )}
      </div>
      {/* Le détail des indécis n'apparaît que là où il n'est pas déjà dit : sur une carte, le volet
          « Qui vient ? » juste en dessous les nomme un par un, groupe par groupe. */}
      {detail && (
        <p className="text-sm text-texte-secondaire">
          {c.peutEtre > 0 && `${c.peutEtre} peut-être · `}
          {c.enAttente} sans réponse
        </p>
      )}
    </div>
  );
}
