import Link from "next/link";
import { formatDateCourte, lienCarte } from "@/lib/dates";
import { Icone } from "@/components/ui/Icone";
import { EnCours } from "@/components/layout/EnCours";

/**
 * Le prochain événement, en une ligne : l'annonce se lit d'un coup d'œil, le détail est à un appui.
 *
 * **Le lieu est un lien vers la carte**, comme partout ailleurs dans l'application : on lit cet
 * écran sur un téléphone, souvent juste avant de partir, et « où est-ce ? » se termine toujours
 * dans une application de carte — recopier une adresse à la main est le seul geste que
 * l'application peut épargner.
 *
 * Il vit **hors** du `Link` de la carte : deux liens imbriqués ne sont pas du HTML valide, et le
 * navigateur en perdrait un des deux. La ligne du bas est donc posée à côté du grand lien plutôt
 * que dedans, ce qui ne change rien à ce qu'on voit et rend les deux destinations atteignables —
 * l'annonce d'un appui sur le titre, la carte d'un appui sur le lieu.
 */
export function LigneEvenement({ evenement: e }: { evenement: { id: string; nom: string; dateDebut: string; lieu: string; adresse: string } }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xl">Prochain événement</h2>
      <div className="flex min-h-14 items-center gap-3 rounded-2xl border border-bordure/60 bg-surface p-3 shadow-carte sm:p-4">
        <Icone nom="etendard" taille={22} className="shrink-0 text-primaire" />
        <span className="min-w-0 flex-1">
          <Link href={`/evenements/${e.id}`} className="block font-semibold no-underline hover:underline">
            {e.nom}
          </Link>
          <span className="flex min-h-11 flex-wrap items-center gap-x-2 text-sm text-texte-secondaire">
            <span>{formatDateCourte(e.dateDebut)}</span>
            {e.lieu && (
              <a
                href={lienCarte(e.lieu, e.adresse)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-w-0 items-center gap-1.5 underline decoration-bordure hover:text-lien hover:decoration-lien"
                title={e.adresse ? `${e.adresse} — ouvrir la carte` : "Ouvrir la carte"}
              >
                <Icone nom="lieu" taille={16} className="shrink-0" />
                <span className="truncate">{e.lieu}</span>
              </a>
            )}
          </span>
        </span>
        <Link href={`/evenements/${e.id}`} aria-label={`Ouvrir l'annonce « ${e.nom} »`} className="shrink-0 no-underline">
          <EnCours />
          <Icone nom="fleche" taille={20} className="text-texte-secondaire" />
        </Link>
      </div>
    </section>
  );
}
