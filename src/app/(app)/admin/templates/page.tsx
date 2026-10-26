import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/current-user";
import { db } from "@/lib/db";
import { formatHeure } from "@/lib/dates";
import { getLieux, natureLue } from "@/lib/planning";
import { horaireHabituel } from "@/lib/horaire-habituel";
import { creerTemplate } from "@/actions/templates";
import { Carte } from "@/components/ui/Carte";
import { Icone } from "@/components/ui/Icone";
import { LienBouton } from "@/components/ui/Bouton";
import { FormulaireTemplate } from "./FormulaireTemplate";
import { resumeProgramme } from "./programme-template";

export const metadata: Metadata = { title: "Templates de cours" };

/**
 * **Les templates de cours** (espace admin) : la liste, et la création d'un nouveau.
 *
 * Un template, c'est une séance type — horaire, lieu et programme — qu'on pose ensuite sur des dates
 * d'une période (`/admin/templates/appliquer`). Cet écran-ci ne fait que **les ranger** : chaque
 * carte dit ce que le template posera (horaire, lieu, programme résumé partie par partie) et mène à
 * ses deux gestes, le modifier ou l'appliquer.
 *
 * **Réservé au bureau, derrière l'élévation** (`templates.manage`) : appliquer un template crée des
 * séances en nombre, c'est un geste de construction de trimestre, pas d'organisation courante.
 *
 * **Une seule colonne, celle de lecture.** Des cartes de phrases courtes et un petit formulaire : rien
 * ici ne gagne à s'étirer (« un tableau s'élargit, une carte non », CLAUDE.md). La page n'est donc pas
 * dans `largeurs.ts`.
 */
export default async function PageTemplates() {
  await requirePermission("templates.manage");
  const [templates, lieux, horaire] = await Promise.all([
    db.coursTemplate.findMany({
      orderBy: { nom: "asc" },
      include: { elements: { orderBy: [{ bloc: "asc" }, { ordre: "asc" }], select: { bloc: true, nature: true, theme: true } } },
    }),
    getLieux(),
    horaireHabituel(),
  ]);
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl">Templates de cours</h1>
        <p className="text-texte-secondaire">
          Un template, c&apos;est l&apos;horaire, le lieu et le programme d&apos;un cours type. On l&apos;applique ensuite à des dates d&apos;une
          période : la séance est créée, ou son programme rempli s&apos;il est encore vide — rien de ce qui est déjà réglé n&apos;est écrasé.
        </p>
      </div>
      {/* Le geste principal de l'onglet, en tête : on vient ici d'abord pour poser des cours. Lien
          seulement — c'est l'écran d'application qui fait choisir le template, la période et les dates. */}
      <LienBouton href="/admin/templates/appliquer" className="self-start" enCours>
        <Icone nom="calendrier" />
        Appliquer un template
      </LienBouton>

      {templates.length === 0 ? (
        <Carte>
          <p>
            Aucun template pour l&apos;instant. Crée le premier juste en dessous : un nom, un horaire et un lieu suffisent, le programme se
            compose ensuite.
          </p>
        </Carte>
      ) : (
        <ul className="flex flex-col gap-4" aria-label="Templates de cours">
          {templates.map((t) => {
            const lignes = resumeProgramme(t.elements.map((e) => ({ bloc: e.bloc, nature: natureLue(e.nature), theme: e.theme })));
            return (
              <li key={t.id}>
                <Carte>
                  <div className="flex flex-col gap-3">
                    <h2 className="text-xl font-bold break-words">{t.nom}</h2>
                    {/* Chaque information porte son pictogramme : l'horaire et le lieu se repèrent sans lire. */}
                    <p className="flex flex-wrap items-center gap-x-4 gap-y-1">
                      <span className="inline-flex items-center gap-1.5">
                        <Icone nom="horloge" titre="Horaire" />
                        {formatHeure(t.heureDebut)}–{formatHeure(t.heureFin)}
                      </span>
                      <span className="inline-flex min-w-0 items-center gap-1.5 break-words">
                        <Icone nom="lieu" titre="Lieu" />
                        {t.lieu}
                      </span>
                    </p>
                    {lignes.length > 0 ? (
                      <ul className="flex flex-col gap-1 text-texte-secondaire" aria-label={`Programme de « ${t.nom} »`}>
                        {lignes.map((ligne, i) => (
                          <li key={i} className="break-words">
                            {ligne}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-texte-secondaire">Programme vide : il faut au moins un élément pour l&apos;appliquer.</p>
                    )}
                    {/* Deux gestes, deux boutons pleine taille : « Modifier » en neutre, « Appliquer » en
                        principal — c'est lui qui fait avancer le trimestre. Le nom du template est dans
                        le nom accessible : une liste de « Modifier » identiques ne se distingue pas au
                        lecteur d'écran. */}
                    <div className="flex flex-wrap gap-2">
                      <LienBouton href={`/admin/templates/${t.id}`} variante="secondaire" taille="petite" aria-label={`Modifier « ${t.nom} »`} enCours>
                        Modifier
                      </LienBouton>
                      <LienBouton
                        href={`/admin/templates/appliquer?template=${encodeURIComponent(t.id)}`}
                        taille="petite"
                        aria-label={`Appliquer « ${t.nom} »`}
                        enCours
                      >
                        Appliquer
                      </LienBouton>
                    </div>
                  </div>
                </Carte>
              </li>
            );
          })}
        </ul>
      )}

      <Carte titre="Nouveau template">
        <div className="flex flex-col gap-4">
          <p className="text-texte-secondaire">
            Le template naît avec un seul cours dans son programme ; tu composes le reste (échauffement, options, encadrants) sur
            l&apos;écran qui s&apos;ouvre ensuite.
          </p>
          {/* L'horaire proposé est celui des dernières séances du club, jamais une heure écrite en dur
              (`horaireHabituel`) ; le lieu, la première salle du club s'il y en a. */}
          <FormulaireTemplate
            action={creerTemplate}
            bouton="Créer le template"
            prefixe="nouveau-template-"
            lieux={lieux}
            valeurs={{ nom: "", heureDebut: horaire.heureDebut, heureFin: horaire.heureFin, lieu: "", adresse: "" }}
          />
        </div>
      </Carte>
      <p className="text-sm text-texte-secondaire">
        Les salles proposées se règlent dans <Link href="/admin/themes">Thèmes et lieux</Link>.
      </p>
    </div>
  );
}
