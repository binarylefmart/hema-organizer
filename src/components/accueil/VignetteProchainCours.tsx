import type { SeanceCarte } from "@/lib/seances";
import { formatDateCourte, formatHeure, lienCarte } from "@/lib/dates";
import { effectifAttendu } from "@/lib/presences";
import { Icone } from "@/components/ui/Icone";

/** Ce que la vignette dessine de chaque invité, dans l'ordre présent, peut-être, le reste. */
type Etat = "present" | "peutEtre" | "autre";

/**
 * **Une silhouette par invité du trimestre** : tête et épaules, la forme la plus courte qui se
 * lise encore comme quelqu'un.
 *
 * Les présents et les peut-être sont pleins, à leur couleur ; les autres — ceux qui ont dit non et
 * ceux qui n'ont pas répondu — restent en contour. On ne lit pas un nombre, on compte des gens, et
 * un club de douze se raconte très bien comme ça.
 *
 * **La forme a un plafond assumé** : au-delà d'une trentaine d'invités la ligne déborde et il
 * faudra en changer. Elle tient très largement l'effectif actuel du club.
 */
function Silhouette({ etat }: { etat: Etat }) {
  const plein = etat !== "autre";
  // Les couleurs « sur encre » et non les couleurs de statut brutes : en mode clair, le vert de
  // « Présent » posé sur l'encre ne donne que 2,2:1 et les silhouettes s'effaçaient (voir
  // `--vert-sur-encre` dans globals.css).
  const couleur = etat === "present" ? "fill-vert-sur-encre" : etat === "peutEtre" ? "fill-ocre-sur-encre" : "";
  return (
    <svg viewBox="0 0 20 24" aria-hidden className="h-[1.6rem] w-[1.35rem] shrink-0 sm:h-[1.9rem] sm:w-[1.6rem]">
      <circle cx="10" cy="6" r="4.4" className={plein ? couleur : "fill-none stroke-encre-texte/35 [stroke-width:1.6]"} />
      <path d="M2 24c0-5 3.6-8 8-8s8 3 8 8Z" className={plein ? couleur : "fill-none stroke-encre-texte/35 [stroke-width:1.6]"} />
    </svg>
  );
}

/**
 * Un grand nombre posé sur sa couleur pleine : c'est lui qu'on doit voir en ouvrant l'écran.
 *
 * La pastille prend la couleur **éclaircie** du statut et écrit son nombre en encre, plutôt que
 * l'inverse : posée sur le fond sombre de la vignette, la couleur brute se détachait à peine
 * (2,2:1 en mode clair) et la pastille paraissait sale. Éclaircie, elle se détache à plus de 5:1
 * sur tous les thèmes, et le texte en encre y est lisible d'autant.
 */
function GrosCompte({ nombre, mot, ton }: { nombre: number; mot: string; ton: "present" | "peutEtre" }) {
  return (
    <span
      className={`flex items-center gap-2 rounded-2xl py-2 pl-3 pr-4 text-encre ${
        ton === "present" ? "bg-vert-sur-encre" : "bg-ocre-sur-encre"
      }`}
    >
      <span className="text-[2.75rem] font-extrabold leading-[0.9] tracking-tight tabular-nums sm:text-5xl">{nombre}</span>
      <span className="max-w-[4.5rem] text-sm font-semibold leading-tight">{mot}</span>
    </span>
  );
}

/**
 * **La vignette du prochain cours** — la première chose que voit le club en ouvrant l'application.
 *
 * Demande de Delta, après un aperçu de neuf formes : « il faut que ça tape à l'œil pour qu'on le
 * voie direct ». D'où trois partis pris, qui sont tout le composant :
 *
 * - **deux nombres, trois fois plus gros que le texte courant**, posés sur leur couleur pleine.
 *   Combien on sera mardi est la question que le club se pose en ouvrant l'écran ; elle avait sa
 *   réponse éparpillée dans la frise et les fiches, jamais en grand ;
 * - **un fond encre**, celui de l'en-tête. Sur le parchemin de la page, la carte se détache et
 *   devient l'ancre du regard — elle gagne la bataille de l'attention contre la frise juste en
 *   dessous. C'est aussi pourquoi elle doit rester **la seule** carte sombre de l'écran : deux, et
 *   l'effet tombe ;
 * - **la troupe en soubassement** : une silhouette par invité, qui donne la proportion (cinq sur
 *   douze) sans disputer la vedette aux chiffres. Un nombre seul ne dit pas si cinq, c'est beaucoup.
 *
 * Rien n'y est cliquable **que le lieu** : l'accueil reste un compte rendu, et répondre se fait
 * sur l'onglet Séances. Les couleurs sont celles des statuts, partout ailleurs dans l'application
 * — et chacune est doublée de son mot, jamais seule.
 */
export function VignetteProchainCours({ seance }: { seance: SeanceCarte }) {
  const { presents, peutEtre, invites } = seance.compteurs;
  const attendus = effectifAttendu(seance.compteurs);
  // L'ordre des silhouettes suit celui des pastilles : les confirmés, les indécis, puis le reste.
  const etats: Etat[] = Array.from({ length: invites }, (_, i) =>
    i < presents ? "present" : i < presents + peutEtre ? "peutEtre" : "autre",
  );
  return (
    <section
      aria-label="Le prochain cours"
      className="rounded-2xl border border-encre-texte/15 bg-encre p-4 text-encre-texte shadow-carte"
    >
      <p className="text-xs font-bold uppercase tracking-[0.14em] text-marque">Prochain cours</p>
      <p className="mt-1 text-lg font-bold leading-tight sm:text-xl">
        {formatDateCourte(seance.date)}&nbsp;· {formatHeure(seance.heureDebut)}
      </p>
      {/* **Le lieu mène à la carte**, comme sur la carte de séance : on regarde cet écran sur un
          téléphone, souvent en partant au cours, et « où est-ce ? » finit toujours dans une
          application de carte — recopier l'adresse à la main est le seul geste que l'application
          peut éviter. `lienCarte` sait déjà se passer d'une adresse vide, et la ligne garde
          `min-h-11` pour rester une cible confortable au doigt.

          **Les couleurs de lien de la carte de séance ne valent pas ici** : `text-lien` est une
          rouille pensée pour le parchemin, elle disparaît sur le fond encre. Le lien garde donc la
          couleur du texte de la vignette (`encre-texte/70`, déjà éprouvée sur l'encre des douze
          thèmes) et se signale par son soulignement, discret au repos puis plein au survol, où le
          texte remonte à l'encre-texte pleine. Aucune couleur nouvelle : seules des opacités du
          jeton déjà porté par la vignette. */}
      {seance.lieu && (
        <p className="mt-0.5 flex min-h-11 items-center text-sm">
          <a
            href={lienCarte(seance.lieu, seance.adresse)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-w-0 items-center gap-1.5 text-encre-texte/70 underline decoration-encre-texte/40 hover:text-encre-texte hover:decoration-encre-texte"
            title={seance.adresse ? `${seance.adresse} — ouvrir la carte` : "Ouvrir la carte"}
          >
            <Icone nom="lieu" taille={16} />
            <span className="truncate">{seance.lieu}</span>
          </a>
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-stretch gap-2">
        <GrosCompte nombre={presents} mot="présents" ton="present" />
        <GrosCompte nombre={peutEtre} mot="peut-être" ton="peutEtre" />
        {/* L'effectif attendu passe en petit à côté : c'est une estimation (les peut-être n'y
            comptent que pour moitié), elle n'a pas à peser autant que les réponses réelles. */}
        <span className="basis-full self-center text-sm leading-tight text-encre-texte/75 sm:basis-auto">
          <b className="text-base font-semibold text-encre-texte">~{attendus} attendus</b> sur {invites} invités
        </span>
      </div>
      <div
        className="mt-3 flex flex-wrap items-center gap-x-1 gap-y-0.5"
        role="img"
        aria-label={`${presents} présents, ${peutEtre} peut-être, sur ${invites} invités`}
      >
        {etats.map((etat, i) => (
          <Silhouette key={i} etat={etat} />
        ))}
      </div>
    </section>
  );
}
