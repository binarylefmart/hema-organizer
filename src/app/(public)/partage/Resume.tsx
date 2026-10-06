import { boutonClasses } from "@/components/ui/Bouton";
import { Icone } from "@/components/ui/Icone";
import { couleurNature, grouperParPartie } from "@/components/seances/programme-cours";
import { PastilleNiveau } from "@/components/ui/Pastille";
import { lienCarte } from "@/lib/dates";
import { LIBELLE_ANNULEE, lignesEvenement, lignesResume, type EvenementPartage, type LigneResume, type SeancePartagee } from "@/lib/partage";

/**
 * Résumé public d'une séance : exactement les lignes du contenu commun des notifications
 * (`src/lib/notifications/contenu.ts`), chaque pictogramme rendu par l'icône SVG correspondante.
 * Aucun nom n'y figure — pas même celui d'un instructeur ou de l'animateur d'un atelier ; le niveau
 * annoncé d'une case, lui, ne désigne personne et s'affiche comme le thème.
 */
export function ResumeSeance({ seance, compact = false }: { seance: SeancePartagee; compact?: boolean }) {
  const [entete, ...lignes] = lignesResume(seance);
  const Titre = compact ? "h2" : "h1";
  return (
    <article
      className={`flex flex-col gap-4 rounded-2xl border bg-surface shadow-carte ${seance.annulee ? "border-rouge/30" : "border-bordure/60"} ${
        compact ? "p-4" : "p-5 sm:p-6"
      }`}
    >
      <header className="flex flex-col gap-2">
        {seance.annulee && (
          <p className="inline-flex items-center gap-1.5 self-start rounded-md bg-rouge-doux px-2 py-0.5 text-sm font-semibold text-rouge">
            <Icone nom="interdit" taille={16} />
            {LIBELLE_ANNULEE}
          </p>
        )}
        <Titre className={`text-balance font-bold ${compact ? "text-lg" : "text-[1.6rem] leading-tight sm:text-3xl"} ${seance.annulee ? "text-texte-secondaire" : ""}`}>
          {entete.texte}
        </Titre>
      </header>

      <ul className="flex flex-col gap-2.5">
        {lignes.map((ligne, i) => (
          <li key={i}>
            <LignePublique ligne={ligne} seance={seance} compact={compact} />
          </li>
        ))}
      </ul>

      {seance.programme.length > 0 && !seance.annulee && (
        /* **Partie par partie**, comme la fiche d'une séance dans l'application (`grouperParPartie`) :
           le titre de la partie, puis ses éléments. Clés par numéro de partie et par rang : cette
           liste est rendue par le serveur et n'est jamais réordonnée à l'écran, et elle ne porte
           volontairement aucun identifiant de ligne (voir `CasePartage`). */
        <ul className="flex flex-col gap-3 border-t border-bordure/50 pt-3" aria-label="Programme">
          {grouperParPartie(seance.programme).map((p) => (
            <li key={p.bloc} className="flex min-w-0 flex-col gap-1">
              {/* Une seule partie affichée (`nom: null`) : ni titre ni filet, le programme se lit
                  comme avant les parties (`partiesNommees`). */}
              {p.nom && <p className="text-xs font-semibold uppercase tracking-wide text-texte-secondaire">{p.nom}</p>}
              <ul aria-label={p.nom ?? undefined} className={`flex min-w-0 flex-col gap-1.5 ${p.nom ? "border-l-2 border-bordure/60 pl-3" : ""}`}>
                {p.elements.map((c, i) => (
                  <li key={i} className="flex flex-col gap-0.5 text-[0.95rem]">
                    <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      {/* Le nom de l'élément — calculé depuis sa nature et son rang — et rien d'autre :
                          aucun nom de personne ne sort d'ici, pas même celui de l'instructeur (voir
                          l'en-tête). À la couleur de sa nature (`couleurNature`), comme sur la fiche
                          d'une séance dans l'application. */}
                      <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${couleurNature(c.nature)}`}>{c.nom}</span>
                      {/* **Un atelier se lit comme un cours** (avenant, « ne mets pas les
                          ateliers en surlignage ») : son titre est le thème de l'élément, écrit comme
                          tous les thèmes — ni vert ni mise en valeur à lui. Sous l'étiquette « Atelier »
                          le mot ne se répète pas ; dans un élément d'une autre nature (donnée ancienne),
                          un simple « Atelier · » dit encore ce que c'est. */}
                      <span className="min-w-0 font-semibold">
                        {c.atelier && c.nature !== "ATELIER" && "Atelier · "}
                        {c.theme}
                      </span>
                      {/* Un niveau n'est pas nominatif : il peut sortir. Indifférent, la pastille ne rend rien */}
                      <PastilleNiveau niveau={c.niveau} compact />
                    </span>
                    {/* **La description, quand il y en a une.** Elle parle du contenu du cours, comme le
                        thème, et c'est justement ce qu'un lecteur du dehors vient chercher — l'écran où
                        on l'écrit annonce qu'elle est publiée (voir `CaseEditeur`). Vide, elle ne rend
                        rien du tout, pas même son intitulé : la même règle que pour les membres. Sur sa
                        propre ligne, parce que c'est une phrase et non une étiquette. */}
                    {c.description && <span className="text-texte-secondaire">{c.description}</span>}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

/** Une ligne du résumé : le lieu ouvre la carte, les chiffres globaux portent la jauge. */
function LignePublique({ ligne, seance, compact }: { ligne: LigneResume; seance: SeancePartagee; compact: boolean }) {
  if (ligne.icone === "groupe") {
    const c = seance.compteurs;
    return (
      <div className="flex flex-col gap-1.5">
        <p className={`flex items-center gap-2 font-semibold ${compact ? "" : "text-xl"}`}>
          <Icone nom="groupe" taille={compact ? 18 : 22} className="text-texte-secondaire" />
          {ligne.texte}
        </p>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={c.pourcentage}
          aria-label={`Taux de présence : ${c.pourcentage} %`}
          className="h-2.5 w-full overflow-hidden rounded-full bg-surface-douce shadow-champ"
        >
          <div className="h-full rounded-full bg-jauge" style={{ width: `${c.pourcentage}%` }} />
        </div>
      </div>
    );
  }

  if (ligne.icone === "lieu") return <LigneCarte ligne={ligne} lieu={seance.lieu} adresse={seance.adresse} />;

  return <LigneSimple ligne={ligne} fort={ligne.icone === "livre"} />;
}

/** Ligne « lieu » : elle ouvre la carte, comme dans l'application. */
function LigneCarte({ ligne, lieu, adresse }: { ligne: LigneResume; lieu: string; adresse: string }) {
  return (
    <a
      href={lienCarte(lieu, adresse)}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-h-11 items-center gap-2 text-lien underline decoration-lien/40 hover:decoration-lien"
      title="Ouvrir la carte"
    >
      <Icone nom="lieu" taille={20} />
      {ligne.texte}
    </a>
  );
}

/** Ligne ordinaire : icône du jeu de l'application + texte. */
function LigneSimple({ ligne, fort = false }: { ligne: LigneResume; fort?: boolean }) {
  return (
    <p className="flex items-start gap-2">
      <Icone nom={ligne.icone} taille={20} className={`mt-0.5 ${ligne.icone === "interdit" ? "text-rouge" : "text-texte-secondaire"}`} />
      <span className={fort ? "font-semibold" : ""}>{ligne.texte}</span>
    </p>
  );
}

/**
 * Résumé public d'un événement (stage, tournoi, démonstration) : nom, dates, lieu, organisateur,
 * annonce et lien d'inscription. Aucun nom de personne — surtout pas celui de qui a saisi
 * l'annonce — et aucune image distante : voir le commentaire de la page.
 */
export function ResumeEvenement({ evenement: e }: { evenement: EvenementPartage }) {
  return (
    <article className="flex flex-col gap-4 rounded-2xl border border-bordure/60 bg-surface p-5 shadow-carte sm:p-6">
      <header className="flex flex-col gap-2">
        {e.termine && (
          <p className="inline-flex items-center gap-1.5 self-start rounded-md bg-surface-douce px-2 py-0.5 text-sm font-semibold text-texte-secondaire">
            <Icone nom="horloge" taille={16} />
            Événement passé
          </p>
        )}
        <h1 className="text-balance text-[1.6rem] leading-tight sm:text-3xl">{e.nom}</h1>
      </header>

      <ul className="flex flex-col gap-2.5">
        {lignesEvenement(e).map((ligne, i) => (
          <li key={i}>{ligne.icone === "lieu" ? <LigneCarte ligne={ligne} lieu={e.lieu} adresse={e.adresse} /> : <LigneSimple ligne={ligne} />}</li>
        ))}
      </ul>

      {/* Annonce en texte brut : React échappe le contenu, les retours à la ligne sont conservés */}
      {e.description.trim() && <p className="whitespace-pre-line break-words border-t border-bordure/50 pt-3">{e.description.trim()}</p>}

      {e.lienInscription && (
        <a href={e.lienInscription} target="_blank" rel="noopener noreferrer" className={boutonClasses("primaire", "grande", true)}>
          S&apos;inscrire
          <Icone nom="sortie" taille={20} />
        </a>
      )}
    </article>
  );
}
