import Link from "next/link";
import { Carte } from "@/components/ui/Carte";
import { LienBouton } from "@/components/ui/Bouton";
import { Icone, type NomIcone } from "@/components/ui/Icone";
import { EnCours } from "@/components/layout/EnCours";

type Props = {
  ateliersEnAttente: number;
  /** Réponses encore manquantes, toutes personnes confondues, sur les prochains cours affichés. */
  invitesSansReponse: number;
};

function Signal({ href, icone, children }: { href: string; icone: NomIcone; children: React.ReactNode }) {
  return (
    <li>
      <Link href={href} className="flex min-h-11 items-center gap-2.5 no-underline hover:underline">
        <Icone nom={icone} taille={20} className="text-primaire" />
        <span className="min-w-0 flex-1">{children}</span>
        <EnCours />
        <Icone nom="fleche" taille={18} className="text-texte-secondaire" />
      </Link>
    </li>
  );
}

/**
 * Le travail qui attend l'encadrement, dans la vue Admin : ce qui appelle un geste, et rien d'autre.
 *
 * Deux lignes, deux gestes différents — trancher des propositions d'atelier, relancer les
 * silencieux du prochain cours. Chacune mène directement à l'endroit où le geste se fait, parce
 * qu'un signal qui ne dit pas où agir se lit comme un reproche.
 *
 * Le nombre de réponses manquantes est revenu ici après avoir séjourné dans la bande visible de
 * tout le club : relancer les gens est un travail d'organisation, il se range avec les autres. Le
 * club, lui, voit déjà nom par nom qui vient sur chaque carte de séance — il ne perd donc aucune
 * information au passage.
 *
 * **Partage avec la bande de la vue Admin, juste au-dessus : là-haut on mesure, ici on agit.** La
 * bande dit *combien* de personnes se sont prononcées et combien n'ont rien dit du tout ; ces deux
 * lignes-ci mènent à l'écran où l'on tranche et où l'on relance. C'est le même travail vu de deux
 * façons, pas deux fois le même chiffre : « 7 réponses manquantes » se compte par réponse, les
 * silencieux se comptent par personne.
 *
 * Quand il n'y a rien à signaler, on ne fabrique pas une carte pour annoncer des zéros : il ne
 * reste que le raccourci discret vers l'espace instructeur.
 */
export function BlocEquipe({ ateliersEnAttente, invitesSansReponse }: Props) {
  const raccourcis = (
    <div className="flex flex-wrap gap-2">
      <LienBouton href="/gestion" variante="secondaire" taille="petite" enCours>
        <Icone nom="bouclier" taille={18} />
        Espace instructeur
      </LienBouton>
    </div>
  );
  if (ateliersEnAttente === 0 && invitesSansReponse === 0) return raccourcis;
  return (
    <Carte titre="Pour l'encadrement">
      <ul className="flex flex-col gap-1">
        {ateliersEnAttente > 0 && (
          <Signal href="/gestion/ateliers" icone="outil">
            <strong>{ateliersEnAttente}</strong> atelier{ateliersEnAttente > 1 ? "s" : ""} en attente de décision
          </Signal>
        )}
        {/* Les réponses manquantes se lisent sur la liste des cours, pas dans la gestion : c'est
            là qu'on voit qui n'a pas répondu, séance par séance. */}
        {invitesSansReponse > 0 && (
          <Signal href="/seances" icone="epee">
            <strong>{invitesSansReponse}</strong> réponse{invitesSansReponse > 1 ? "s" : ""} manquante{invitesSansReponse > 1 ? "s" : ""} sur les prochains cours
          </Signal>
        )}
      </ul>
      <div className="mt-3">{raccourcis}</div>
    </Carte>
  );
}
