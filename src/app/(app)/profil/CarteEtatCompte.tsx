import { Pastille } from "@/components/ui/Pastille";
import { lignesEtatCompte } from "./etat-compte";
import type { EtatLienPersonnel } from "@/lib/invitations";

/**
 * **« État de mon compte » — ce que le sommaire est devenu quand la page a eu de la place**.
 *
 * Elle se lit **au-dessus du sommaire**, dans sa colonne (`PageAvecSommaire`, propriété `enTete`), et
 * elle disparaît avec lui en dessous de 1 536 px. C'est ce qui l'autorise à exister : **elle ne dit
 * rien que la page ne dise déjà** plus bas, dans ses cartes de réglage — exactement la deuxième des
 * trois règles qui tiennent le sommaire honnête. Ce qu'elle apporte, c'est de le dire **en un coup
 * d'œil et au même endroit** : jusqu'ici, savoir si l'on avait un mot de passe, jusqu'à quand le lien
 * tenait et combien d'appareils étaient branchés demandait de traverser trois écrans de défilement.
 *
 * **Un état, pas un réglage.** Aucun bouton, aucun formulaire, aucun lien : les gestes sont dans les
 * cartes, et les liens qui y mènent sont dans le sommaire juste en dessous — les redoubler ici
 * ferait deux chemins vers la même chose à dix pixels l'un de l'autre. Et aucune requête de plus : la
 * page a déjà tout calculé pour ses cartes (voir `etat-compte.ts`).
 *
 * **Chaque valeur porte son intitulé, et un champ vide ne s'affiche pas du tout** — les deux règles
 * de lecture du dépôt. L'intitulé est posé **au-dessus** de sa valeur et non à côté : la colonne
 * fait 20 rem, dont ~18 de contenu, et une échéance (« valable jusqu'au jeudi à 07:00 ») n'y tient
 * pas en vis-à-vis d'un libellé sans se couper en escalier.
 */
export function CarteEtatCompte({
  lien,
  aDejaUnMotDePasse,
  deuxFa,
  admin,
  totpActiveAt,
  codesRestants,
  codesTotal,
  appareils,
}: {
  lien: EtatLienPersonnel;
  aDejaUnMotDePasse: boolean;
  deuxFa: boolean;
  admin: boolean;
  totpActiveAt: Date | null;
  codesRestants: number;
  codesTotal: number;
  appareils: number;
}) {
  const lignes = lignesEtatCompte({ lien, aDejaUnMotDePasse, deuxFa, admin, totpActiveAt, codesRestants, codesTotal, appareils });
  return (
    /*
     * Pas d'`id` : une ancre qui n'existe qu'au-delà de 1 536 px serait un lien mort pour tout le
     * monde en dessous — et cette carte n'est pas une section de la page, elle en est le résumé.
     *
     * **Et pas de `titre` non plus, donc pas de `<h2>`** : la colonne du sommaire se lit **avant**
     * la page dans le DOM — c'est elle qui l'annonce —, si bien qu'un titre de carte ici passait
     * **devant le seul `<h1>` de l'écran** : qui navigue par titres rencontrait « État de mon
     * compte » (niveau 2) avant « Mon profil » (niveau 1). Le libellé prend donc la même forme que
     * celui du sommaire juste en dessous — une étiquette, pas un titre —, ce qui dit aussi la
     * vérité sur ce qu'ils sont tous les deux : du mobilier de colonne, pas des sections de la
     * page.
     */
    <section className="rounded-2xl border border-bordure/60 bg-surface p-3 shadow-carte">
      <p className="px-2 pb-1 text-sm font-semibold uppercase tracking-wide text-texte-secondaire">État de mon compte</p>
      <dl className="flex flex-col gap-3 px-2 pb-1">
        {lignes.map((ligne) => (
          <div key={ligne.intitule} className="flex flex-col gap-1">
            <dt className="text-sm text-texte-secondaire">{ligne.intitule}</dt>
            <dd className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Pastille ton={ligne.ton}>{ligne.valeur}</Pastille>
              {ligne.precision && <span className="text-sm text-texte-secondaire">{ligne.precision}</span>}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
