"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { marquerEvenementsVus } from "@/actions/evenements";
import { ECU_LIVRE } from "@/lib/constants";
import { QUANDS, QUAND_LABELS, type Quand } from "@/components/filtres/temps";
import { Icone } from "@/components/ui/Icone";
import { dateEvenement, horaireEvenement, sourceImage, type EvenementAffiche } from "./libelles";

/** Ce que le panneau affiche d'un événement : de quoi le reconnaître, rien de plus. */
export type ApercuEvenement = Pick<EvenementAffiche, "id" | "nom" | "dateDebut" | "dateFin" | "heureDebut" | "heureFin" | "lieu" | "organisateur" | "imageUrl" | "publie">;

type Props = {
  aVenir: ApercuEvenement[];
  passes: ApercuEvenement[];
  /** Le bureau peut ouvrir une annonce : le panneau lui tend le lien, même quand il est vide */
  peutCreer: boolean;
  /** Annonces parues depuis le dernier passage (pastille sur l'icône) */
  nouveautes: number;
  /**
   * Écu du club, pour les aperçus sans affiche. Il arrive en propriété parce que ce panneau est un
   * composant client : l'écu se lit en base (`identite()`), et c'est l'en-tête, côté serveur, qui
   * fait cette lecture. Absent, l'écu livré avec le code — une vignette décorative ne vaut pas que
   * le volet des événements disparaisse.
   */
  ecu?: string;
};

/**
 * Les événements du club, en panneau plutôt qu'en onglet.
 *
 * Une annonce se consulte de temps en temps — elle n'a pas la place qu'ont le planning ou les
 * présences dans la semaine d'un membre. Elle prend donc la forme d'un centre de notifications :
 * une icône dans l'en-tête, un volet qui s'ouvre dessous (feuille pleine largeur sur téléphone,
 * menu ancré à droite sur grand écran), et la liste des aperçus. Un aperçu mène à sa page.
 *
 * Le volet se ferme par Échap, par un clic au dehors, ou par un second appui sur l'icône ; le
 * focus entre dedans à l'ouverture et revient sur l'icône à la fermeture. La bascule
 * « À venir / Passé » y est un **état local** : on regarde, on revient, sans changer d'adresse —
 * d'où cette variante des pilules de `BasculeTemps`, dont elle reprend les mots et l'allure.
 */
export function PanneauEvenements({ aVenir, passes, peutCreer, nouveautes, ecu }: Props) {
  const [ouvert, setOuvert] = useState(false);
  const [quand, setQuand] = useState<Quand>("avenir");
  // Ce que l'on a déjà regardé. On retient le **compte** vu, pas un simple « vu » : si le serveur
  // en annonce un autre plus tard (une annonce publiée entre-temps), la pastille revient d'elle-même.
  const [vuPour, setVuPour] = useState<number | null>(null);
  const bouton = useRef<HTMLButtonElement>(null);
  const panneau = useRef<HTMLDivElement>(null);
  const enveloppe = useRef<HTMLSpanElement>(null);
  const id = useId();
  const pathname = usePathname();
  const actif = pathname.startsWith("/evenements");

  /**
   * Ouvrir, c'est aussi « avoir vu ». La pastille s'éteint tout de suite, sans attendre le serveur :
   * sinon le clic paraîtrait sans effet. L'enregistrement suit, et son échec éventuel ne fait que
   * ramener la pastille au prochain chargement — jamais un message d'erreur pour si peu.
   */
  const ouvrir = useCallback(() => {
    setOuvert(true);
    setVuPour(nouveautes);
    if (nouveautes > 0) void marquerEvenementsVus().catch(() => {});
  }, [nouveautes]);

  const fermer = useCallback((rendreLeFocus = true) => {
    setOuvert(false);
    if (rendreLeFocus) bouton.current?.focus();
  }, []);

  // Le focus entre dans le volet dès qu'il s'ouvre : au clavier comme au lecteur d'écran, on est
  // porté là où l'on vient de demander à aller.
  useEffect(() => {
    if (ouvert) panneau.current?.focus();
  }, [ouvert]);

  useEffect(() => {
    if (!ouvert) return;
    const auClavier = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        fermer();
      }
    };
    // `pointerdown` plutôt que `click` : le volet se referme dès l'appui, avant que le clic
    // n'atteigne ce qu'il visait — c'est ce qu'on attend d'un menu.
    const auDehors = (e: PointerEvent) => {
      if (!enveloppe.current?.contains(e.target as Node)) fermer(false);
    };
    document.addEventListener("keydown", auClavier);
    document.addEventListener("pointerdown", auDehors);
    return () => {
      document.removeEventListener("keydown", auClavier);
      document.removeEventListener("pointerdown", auDehors);
    };
  }, [ouvert, fermer]);

  const liste = quand === "passe" ? passes : aVenir;
  const pastille = vuPour === nouveautes ? 0 : nouveautes;

  return (
    <span ref={enveloppe} className="relative flex">
      <button
        ref={bouton}
        type="button"
        onClick={() => (ouvert ? fermer() : ouvrir())}
        aria-expanded={ouvert}
        aria-controls={id}
        // Le nom accessible porte la nouveauté : une pastille ne dit rien à un lecteur d'écran.
        aria-label={pastille > 0 ? `Événements, ${pastille} ${pastille > 1 ? "nouveautés" : "nouveauté"}` : "Événements"}
        title="Événements"
        className={`relative flex min-h-12 w-12 items-center justify-center rounded-full text-encre-texte hover:bg-white/10 ${
          ouvert || actif ? "bg-white/15 text-marque ring-1 ring-marque/50" : ""
        }`}
      >
        <Icone nom="etendard" taille={22} />
        {pastille > 0 && (
          <span
            aria-hidden
            className="pointer-events-none absolute right-0 top-1 flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-full bg-primaire px-1 text-[0.6875rem] font-bold leading-none text-primaire-texte ring-2 ring-encre"
          >
            {pastille > 9 ? "9+" : pastille}
          </span>
        )}
      </button>

      {ouvert && (
        <div
          id={id}
          ref={panneau}
          tabIndex={-1}
          role="dialog"
          aria-label="Événements"
          // Téléphone : feuille pleine largeur accrochée sous l'en-tête (h-20). Grand écran : volet
          // ancré à droite de l'icône. Hauteur bornée dans les deux cas, la liste défile dedans.
          className="fixed inset-x-0 top-20 z-20 flex max-h-[calc(100dvh-6.5rem)] flex-col overflow-hidden border-b border-bordure bg-surface text-texte shadow-carte sm:absolute sm:inset-x-auto sm:right-0 sm:top-[calc(100%+0.5rem)] sm:max-h-[30rem] sm:w-[22rem] sm:rounded-2xl sm:border"
        >
          <div className="flex items-center justify-between gap-2 border-b border-bordure/60 px-4 py-3">
            <h2 className="text-lg font-bold">Événements</h2>
            <BasculeLocale quand={quand} choisir={setQuand} />
          </div>

          {liste.length === 0 ? (
            <p className="px-4 py-6 text-texte-secondaire">
              {quand === "passe" ? "Aucun événement passé." : "Aucun événement à venir pour le moment."}
            </p>
          ) : (
            <ul className="min-h-0 flex-1 divide-y divide-bordure/60 overflow-y-auto overscroll-contain">
              {liste.map((e) => (
                <li key={e.id}>
                  <Apercu evenement={e} ecu={ecu} fermer={() => fermer(false)} />
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-bordure/60 px-4 py-3">
            <Link href="/evenements" onClick={() => fermer(false)} className="min-h-12 content-center">
              Voir tout le fil
            </Link>
            {peutCreer && (
              <Link href="/evenements/nouveau" onClick={() => fermer(false)} className="min-h-12 content-center font-semibold">
                Nouvel événement
              </Link>
            )}
          </div>
        </div>
      )}
    </span>
  );
}

/**
 * Les mêmes pilules que `BasculeTemps`, en boutons : ici le sens du temps ne quitte pas le volet,
 * il n'a donc rien à faire dans l'adresse de la page. Deux boutons qui pressent vraiment quelque
 * chose : `aria-pressed` est cette fois le mot juste, là où la bascule de page a des liens.
 */
function BasculeLocale({ quand, choisir }: { quand: Quand; choisir: (q: Quand) => void }) {
  return (
    <span className="flex rounded-full border border-bordure bg-fond p-0.5 text-sm font-semibold">
      {QUANDS.map((q) => (
        <button
          key={q}
          type="button"
          onClick={() => choisir(q)}
          aria-pressed={q === quand}
          // 36 px, c'était la plus petite cible de toute l'application — et elle est sur l'en-tête,
          // donc sur toutes les pages et pour tout le monde. 48 px comme les autres bascules
          // (l'accueil, les onglets de `/seances`),.
          className={`flex min-h-12 items-center rounded-full px-3 ${q === quand ? "bg-primaire text-primaire-texte" : "text-texte-secondaire"}`}
        >
          {QUAND_LABELS[q]}
        </button>
      ))}
    </span>
  );
}

/** Une ligne du volet : vignette, nom, date et horaire, lieu, organisateur. */
function Apercu({ evenement: e, ecu, fermer }: { evenement: ApercuEvenement; ecu?: string; fermer: () => void }) {
  const horaire = horaireEvenement(e.heureDebut, e.heureFin);
  return (
    <Link href={`/evenements/${e.id}`} onClick={fermer} className="flex gap-3 px-4 py-3 text-texte no-underline hover:bg-surface-douce">
      <span className="flex h-14 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-douce">
        {/* eslint-disable-next-line @next/next/no-img-element -- affiche servie par le relais /api/image (voir BandeauEvenement) */}
        <img
          src={e.imageUrl ? sourceImage(e.imageUrl) : (ecu ?? ECU_LIVRE)}
          alt=""
          aria-hidden
          loading="lazy"
          decoding="async"
          className={e.imageUrl ? "h-full w-full object-cover" : "h-8 w-auto opacity-55"}
        />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-x-2 font-semibold">
          <span className="min-w-0">{e.nom}</span>
          {e.publie === false && <span className="rounded-md bg-ocre-doux px-1.5 text-sm font-semibold text-ocre">Brouillon</span>}
        </span>
        <span className="text-sm text-texte-secondaire">
          {dateEvenement(e.dateDebut, e.dateFin)}
          {horaire && ` · ${horaire}`}
        </span>
        {(e.lieu || e.organisateur) && (
          <span className="truncate text-sm text-texte-secondaire">{[e.lieu, e.organisateur].filter(Boolean).join(" · ")}</span>
        )}
      </span>
    </Link>
  );
}
