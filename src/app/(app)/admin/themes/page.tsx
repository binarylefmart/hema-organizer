import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/current-user";
import { getLieux, getThemes, getThemesEchauffement } from "@/lib/planning";
import { lieuxEnTexte } from "@/lib/lieux";
import { enregistrerLieux, enregistrerThemes, enregistrerThemesEchauffement } from "@/actions/planning";
import { Carte } from "@/components/ui/Carte";
import { DeuxPiles } from "@/components/ui/DeuxPiles";
import { FormulaireAction } from "@/components/ui/FormulaireAction";
import { ZoneTexte } from "@/components/ui/ZoneTexte";

export const metadata: Metadata = { title: "Thèmes et lieux" };

/**
 * **Les thèmes du planning** : la liste déroulante proposée dans chaque case de la grille — **deux
 * listes** (Delta : « thèmes échauffements, thèmes cours et options, à la place
 * de l'ancien thème »). Une case d'échauffement lit « Thèmes d'échauffement » (`themesEchauffement`),
 * un cours ou une option lit « Thèmes de cours et options » (la clé `themes` d'avant, valeurs gardées).
 * Un atelier n'en lit aucune : son thème est son titre.
 *
 * Elle vivait au pied de la file des ateliers, ouverte à tout l'encadrement ; elle a rejoint
 * l'espace admin. Ce n'est pas un geste d'organisation courante mais le **vocabulaire commun** du
 * club : retirer une ligne ici change ce que tout le monde peut choisir dans toutes les cases à
 * venir. `themes.manage` est donc passée au bureau seul — et, comme toute permission réservée à
 * ADMIN, elle exige l'élévation (voir `exigeSessionForte`).
 *
 * Ce qui a déjà été choisi sur une séance ne bouge pas : un thème retiré de la liste reste affiché
 * là où il a servi, et la case qui le porte continue de le proposer.
 */
export default async function PageThemesAdmin() {
  await requirePermission("themes.manage");
  const [themesEchauffement, themes, lieux] = await Promise.all([getThemesEchauffement(), getThemes(), getLieux()]);
  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-3xl">Thèmes et lieux</h1>
      {/*
        **Deux piles indépendantes à partir de 1 536 px** (Delta : « idem dans le panel
        admin pour … thèmes et lieux »), et c'est l'écran où la raison se voit le mieux : les deux
        listes n'ont **rien** à se dire. Un thème ne se déduit pas d'une salle, enregistrer l'une ne
        touche pas l'autre (deux formulaires, deux actions), et rien ne se lit en vis-à-vis d'une
        carte à l'autre. Mesuré à 1 920 px avant le partage : **1 279 px de haut** pour 1 440 px de
        contenu, dont la seconde carte n'occupait que 340 — la page défilait pour une zone de texte
        posée sous une autre, avec un demi-écran de vide à côté.

        **Ce que la largeur sert à faire : monter la seconde carte à côté de la première, pas étirer
        les deux** (`DeuxPiles`, et la doctrine « un tableau s'élargit, une carte non » de
        `CLAUDE.md`). Deux colonnes `flex` indépendantes, jamais une grille : une grille alignerait
        ses blocs en rangées et laisserait, sous « Lieux des cours », un trou de la hauteur de la
        différence entre les deux.

        **Une zone de texte, elle, se nourrit de la largeur** — à la différence d'un champ de
        formulaire : une ligne « Nom de la salle | Adresse complète » tient d'un coup d'œil dans
        700 px alors qu'elle se replie dans 324. C'est pourquoi rien n'est plafonné ici, et pourquoi
        l'écran n'avait pas de découpe interne à convertir en requête de conteneur.

        **En dessous du palier, l'ordre est exactement celui d'avant** : les thèmes (échauffement, puis
        cours et options), puis les lieux —
        une seule pile, et sur un téléphone de 390 px pas un pixel ne bouge.
      */}
      <DeuxPiles
        gauche={
          /* **Les deux listes de thèmes ensemble, à gauche** : elles se saisissent pareil et se
             relisent l'une contre l'autre (un thème rangé dans la mauvaise liste se voit ici). Les
             lieux restent seuls à droite — trois cartes, deux piles, à peu près la même hauteur dès
             que la liste des cours est longue. Deux formulaires : enregistrer l'une ne touche pas
             l'autre. L'échauffement d'abord, comme dans l'ordre par défaut d'une partie. */
          <>
            <Carte titre="Thèmes d'échauffement">
              <FormulaireAction
                action={enregistrerThemesEchauffement}
                bouton="Enregistrer les thèmes d'échauffement"
                variante="secondaire"
              >
                <ZoneTexte
                  label="Thèmes proposés dans les échauffements du planning (un par ligne)"
                  name="texte"
                  rows={Math.min(12, themesEchauffement.length + 3)}
                  defaultValue={themesEchauffement.join("\n")}
                  placeholder={"Mobilité articulaire\nJeu de jambes"}
                  aide="L'ordre est conservé. Laissée vide, la liste disparaît et l'échauffement se décrit librement. Un thème déjà choisi sur une séance reste affiché même s'il est retiré de la liste."
                />
              </FormulaireAction>
            </Carte>
            <Carte titre="Thèmes de cours et options">
              <FormulaireAction action={enregistrerThemes} bouton="Enregistrer les thèmes de cours et options" variante="secondaire">
                <ZoneTexte
                  label="Thèmes proposés dans les cours et les options du planning (un par ligne)"
                  name="texte"
                  rows={Math.min(16, themes.length + 2)}
                  defaultValue={themes.join("\n")}
                  aide="Épée longue, Messer, Dague… L'ordre est conservé. Un thème déjà choisi sur une séance reste affiché même s'il est retiré de la liste."
                />
              </FormulaireAction>
            </Carte>
          </>
        }
        droite={
          /* **Les salles du club, au même endroit et pour la même raison que les thèmes** : c'est du
             vocabulaire commun, décidé une fois pour tout le monde, et qui change ce que proposent tous
             les formulaires de séance à venir. Ces deux listes étaient écrites dans le code — adresses
             postales comprises — ce qui rendait l'outil ininstallable par un autre club. */
          <Carte titre="Lieux des cours">
            <FormulaireAction action={enregistrerLieux} bouton="Enregistrer les lieux" variante="secondaire">
              <ZoneTexte
                label="Salles habituelles (une par ligne, « Nom | Adresse »)"
                name="texte"
                rows={Math.min(10, lieux.length + 3)}
                defaultValue={lieuxEnTexte(lieux)}
                placeholder={"Nom de la salle | Adresse complète\nAutre salle | Adresse complète"}
                aide="Elles remplissent la liste déroulante du formulaire de séance ; l'adresse sert au lien vers la carte et reste facultative. Laissée vide, la liste disparaît et le lieu se saisit à chaque séance. Une salle retirée d'ici reste affichée sur les séances qui la portent."
              />
            </FormulaireAction>
          </Carte>
        }
      />
    </div>
  );
}
