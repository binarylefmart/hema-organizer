import { LienBouton } from "@/components/ui/Bouton";
import { Icone } from "@/components/ui/Icone";

/**
 * Le seul bouton d'action de l'accueil : celui qui mène à l'onglet Séances, là où se trouvent les
 * trois boutons Présent / Absent / Peut-être.
 *
 * **Il n'apparaît que dans la vue « Personnel »**, la seule qui parle de soi. Les vues Club et
 * Admin s'en passent volontairement : elles rendent compte, elles ne réclament rien — et l'onglet
 * « Séances » de la barre de navigation y mène de toute façon en un tap. Ne pas le remettre
 * ailleurs « pour aider » : ce serait rendre à ces deux vues le poids qu'on vient de leur ôter.
 *
 * Dans la vue Personnel, il est placé **juste sous la bascule**, donc visible sans faire défiler
 * sur un écran de 390 px : ouvrir l'application, appuyer ici, appuyer sur « Présent » — deux
 * appuis, la règle du cahier des charges tient. Même icône que l'onglet de la barre (l'épée) : on
 * reconnaît d'un coup d'œil où l'on va.
 *
 * Son libellé ne bouge pas : l'accueil ne sait plus — et ne veut plus savoir — où en est la
 * personne qui regarde. Un bouton de navigation dont le texte change d'une visite à l'autre est
 * aussi un message personnel déguisé ; celui-ci dit simplement où il mène.
 */
export function BoutonPresences() {
  return (
    <LienBouton href="/seances" taille="grande" pleineLargeur enCours>
      <Icone nom="epee" taille={22} />
      Indiquer ma présence
    </LienBouton>
  );
}

/**
 * **L'historique des séances**, pour la vue Club : les cours déjà donnés, avec leur fréquentation.
 *
 * Ce n'est pas le même écran que « Mon historique » — et c'est tout l'objet de la distinction. Sur
 * la vue Club, on regarde ce qu'a vécu l'association : combien de monde est venu, quels cours ont
 * fait le plein. Sur la vue Personnel, on regarde ses propres présences. Le même bouton pour les
 * deux aurait envoyé un membre chercher l'assiduité du groupe là où il venait voir la sienne.
 */
export function RaccourciCoursPasses() {
  return (
    <nav aria-label="Aller plus loin" className="flex flex-wrap gap-2">
      <LienBouton href="/seances?quand=passe" variante="secondaire" taille="petite" enCours>
        <Icone nom="horloge" taille={18} />
        Historique des séances
      </LienBouton>
    </nav>
  );
}

/**
 * **Un seul renvoi, et seulement là où il apprend quelque chose** : « Mon historique ».
 *
 * « Le planning » et « Proposer un atelier » ont été retirés : ce sont deux des trois onglets de la
 * barre de navigation, toujours à l'écran, à un tap. Les répéter en bas de l'accueil n'ajoutait
 * pas un chemin, cela ajoutait une rangée de boutons à lire avant de comprendre qu'on connaissait
 * déjà les deux destinations.
 *
 * L'historique, lui, n'est l'onglet de personne : il vit derrière une vue de l'écran Séances, et
 * sans ce bouton il faudrait savoir qu'il existe. Il ne s'affiche qu'en vue **Personnel** — c'est
 * *son* historique, il n'a rien à faire là où l'on rend compte du club.
 */
export function Raccourcis() {
  return (
    <nav aria-label="Aller plus loin" className="flex flex-wrap gap-2">
      <LienBouton href="/seances?vue=historique" variante="secondaire" taille="petite" enCours>
        <Icone nom="livre" taille={18} />
        Mon historique
      </LienBouton>
    </nav>
  );
}
