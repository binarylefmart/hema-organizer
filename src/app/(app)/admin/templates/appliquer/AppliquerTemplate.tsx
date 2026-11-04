"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
/*
 * **Ce que ce composant importe, et ce qu'il n'importe surtout pas.** `@/lib/templates` est pur
 * (Zod, dates, constantes) : c'est la même `planApplication` que celle du serveur, et c'est tout
 * l'intérêt. `@/lib/db`, `@/lib/planning` ou quoi que ce soit qui touche la base tirerait Prisma et
 * `node:crypto` dans le paquet du navigateur, et le build tomberait. L'action, elle, s'importe : un
 * module `"use server"` ne voyage vers le client que sous forme de référence d'appel.
 */
import { appliquerTemplate } from "@/actions/templates";
import { bilanApplication, DATES_APPLICATION_MAX, planApplication, type EtapeApplication, type SeanceExistante } from "@/lib/templates";
import { capitale, formatDateCourte, formatDateLongue, formatHoraire } from "@/lib/dates";
import { Alerte } from "@/components/ui/Alerte";
import { Bouton, LienBouton } from "@/components/ui/Bouton";
import { Carte } from "@/components/ui/Carte";
import { Champ } from "@/components/ui/Champ";
import { ChampListe } from "@/components/ui/ChampListe";
import { Icone } from "@/components/ui/Icone";
import { Pastille } from "@/components/ui/Pastille";
import { SansReponse, useAttenteSurveillee } from "@/components/ui/attente-surveillee";
import {
  ajouterDates,
  datesDuJour,
  jourParDefaut,
  joursProposes,
  lienAppliquer,
  lienPlanningPeriode,
  nomJour,
  premierJourOuvert,
  refusDate,
} from "./dates-application";

/** Ce que l'écran sait d'un template : de quoi le reconnaître dans la liste, et son heure de début. */
export type TemplateResume = { id: string; nom: string; heureDebut: string; heureFin: string; lieu: string; elements: number };
/** Une période ouverte (brouillon ou active). */
export type PeriodeOuverte = { id: string; nom: string; statut: string; dateDebut: string; dateFin: string };

type Props = {
  templates: TemplateResume[];
  /** Le template présélectionné (URL, sinon le premier). */
  templateInitial: string;
  periodes: PeriodeOuverte[];
  periodeId: string;
  /** Les séances de la période, avec `commencee` et `programmeVide` calculés comme l'action. */
  seances: SeanceExistante[];
  /** Aujourd'hui dans le fuseau du club, lu par le serveur (voir `dates-application.ts`). */
  aujourdHui: string;
};

/** Le mot et la couleur d'une étape du plan — un seul endroit, pour l'aperçu comme pour le bilan. */
function libelleEtape(e: EtapeApplication): { texte: string; ton: "vert" | "primaire" | "neutre" } {
  if (e.action === "creer") return { texte: "Séance créée", ton: "vert" };
  if (e.action === "remplir") return { texte: "Programme rempli", ton: "primaire" };
  return { texte: `Écartée — ${e.raison}`, ton: "neutre" };
}

/**
 * **Le plan, date par date.** Le même rendu pour l'aperçu (ce qui *sera* fait) et pour le résultat
 * (ce que le serveur *a* fait) : deux listes qui se ressemblent se comparent d'un coup d'œil, et c'est
 * justement ce qu'on fait quand le serveur a écarté une date que l'aperçu annonçait.
 */
function ListePlan({ plan, titre }: { plan: readonly EtapeApplication[]; titre: string }) {
  return (
    <ul aria-label={titre} className="flex flex-col divide-y divide-bordure/60">
      {plan.map((e) => {
        const { texte, ton } = libelleEtape(e);
        return (
          <li key={e.date} className="flex min-h-12 flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2">
            <span className="font-semibold">{formatDateLongue(e.date)}</span>
            <Pastille ton={ton}>{texte}</Pastille>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * **L'écran « Appliquer un template »** : un template, une période, des dates — et, sous la sélection,
 * ce qui arrivera à chacune, calculé par `planApplication` exactement comme le fera le serveur.
 *
 * Le composant est remonté à chaque changement de période (`key` posée par la page) : la sélection de
 * dates repart donc de zéro, et les séances sont celles de la nouvelle période.
 */
export function AppliquerTemplate({ templates, templateInitial, periodes, periodeId, seances, aujourdHui }: Props) {
  const router = useRouter();
  const periode = periodes.find((p) => p.id === periodeId)!;

  /*
   * **Le template choisi est un état semé par le serveur** (l'URL `?template=`), donc il suit la
   * doctrine du miroir (`vuDuServeur`, CLAUDE.md « Ce que l'écran promet ») : un lien qui rouvre cet
   * écran sur un autre template, dans la même période, ne remonte pas le composant — sans miroir,
   * la liste resterait sur l'ancien choix alors que l'URL en nomme un autre.
   */
  const [templateId, setTemplateId] = useState(templateInitial);
  const [vuDuServeur, setVuDuServeur] = useState(templateInitial);
  if (vuDuServeur !== templateInitial) {
    setVuDuServeur(templateInitial);
    setTemplateId(templateInitial);
  }
  const template = templates.find((t) => t.id === templateId) ?? templates[0];

  const [dates, setDates] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const jours = useMemo(() => joursProposes(periode, aujourdHui), [periode, aujourdHui]);
  /*
   * **Le jour du raccourci et la date précise ne sont pas semés par le serveur** : tant qu'on n'y a
   * pas touché, ils se **déduisent** des séances reçues (`null` = « pas encore choisi »). Un état
   * semé (`useState(jourParDefaut(...))`) garderait le jour du premier rendu même après un
   * `router.refresh()` qui apporte d'autres séances.
   */
  const [jourChoisi, setJour] = useState<number | null>(null);
  const jour = jourChoisi ?? jourParDefaut(periode, aujourdHui, seances);
  const premier = premierJourOuvert(periode, aujourdHui);
  const [dateTapee, setDatePrecise] = useState<string | null>(null);
  const datePrecise = dateTapee ?? premier ?? "";

  const [changement, demarrer] = useTransition();
  const [enVol, setEnVol] = useState(false);
  const silence = useAttenteSurveillee(enVol);
  const [erreur, setErreur] = useState<string | null>(null);
  // `annonce` : ce que l'aperçu promettait au moment de l'appui (créées + remplies). On le garde avec
  // le résultat, car après `router.refresh()` l'aperçu recalculé ne promet plus rien — les séances
  // viennent d'être remplies.
  const [resultat, setResultat] = useState<{ bilan: string; plan: EtapeApplication[]; annonce: number } | null>(null);

  // **L'aperçu : la fonction du serveur, sur les faits du serveur.** Rien n'est réécrit ici.
  const plan = useMemo(
    () => planApplication({ dates, aujourdHui, periode, heureDebut: template.heureDebut, seances }),
    [dates, aujourdHui, periode, template.heureDebut, seances],
  );
  const aFaire = plan.filter((e) => e.action !== "ignorer").length;
  const sansProgramme = template.elements === 0;

  /** Ajoute des dates sous le plafond, et dit ce qui n'a pas trouvé place ou était déjà là. */
  function ajouter(nouvelles: string[]) {
    const r = ajouterDates(dates, nouvelles, DATES_APPLICATION_MAX);
    setDates(r.dates);
    const morceaux: string[] = [];
    if (r.ajoutees) morceaux.push(`${r.ajoutees} date${r.ajoutees > 1 ? "s" : ""} ajoutée${r.ajoutees > 1 ? "s" : ""}`);
    if (r.deja) morceaux.push(`${r.deja} déjà choisie${r.deja > 1 ? "s" : ""}`);
    if (r.refusees) morceaux.push(`${r.refusees} non ajoutée${r.refusees > 1 ? "s" : ""} : pas plus de ${DATES_APPLICATION_MAX} dates à la fois`);
    setMessage(morceaux.length ? `${capitale(morceaux.join(" · "))}.` : null);
  }

  function changerTemplate(id: string) {
    setTemplateId(id);
    /*
     * L'URL suit le choix, **sans aller-retour serveur** (rien de ce que la page charge ne dépend du
     * template) : un rechargement ou un changement de période retrouvent le même template.
     * Next 15 synchronise `history.replaceState` avec son routeur.
     */
    window.history.replaceState(null, "", lienAppliquer({ template: id, periode: periodeId }));
  }

  function changerPeriode(id: string) {
    if (id === periodeId) return;
    // Les séances dépendent de la période : la page serveur les recharge. Le template voyage dans l'URL.
    demarrer(() => router.push(lienAppliquer({ template: templateId, periode: id }), { scroll: false }));
  }

  async function appliquer() {
    const confirmation = [
      `Appliquer « ${template.nom} » à « ${periode.nom} » ?`,
      "",
      `Ce qui va être fait : ${bilanApplication(plan)}.`,
      "Rien n'est écrasé, et aucune notification n'est envoyée aux membres.",
    ].join("\n");
    if (!window.confirm(confirmation)) return;
    setErreur(null);
    setEnVol(true);
    try {
      const res = await appliquerTemplate({ templateId: template.id, periodId: periodeId, dates });
      if ("erreur" in res) setErreur(res.erreur);
      else {
        setResultat({ ...res, annonce: aFaire });
        // Les séances de la page ont changé : on les relit, pour qu'un second passage parte du vrai.
        router.refresh();
      }
    } catch {
      setErreur("L'application n'a pas abouti. Vérifie ta connexion, puis recharge la page avant de réessayer.");
    } finally {
      setEnVol(false);
    }
  }

  /*
   * **Le résultat : le plan RETOURNÉ par le serveur, pas l'aperçu.** Entre l'affichage et l'appui,
   * quelqu'un a pu remplir une séance ou en commencer une : le serveur l'a écartée plutôt
   * qu'écrasée, et c'est ce qu'il a réellement fait qu'on montre.
   */
  if (resultat) {
    const ecart = resultat.plan.filter((e) => e.action !== "ignorer").length !== resultat.annonce;
    return (
      <div className="flex flex-col gap-5">
        <Alerte type="succes" titre={`« ${template.nom} » appliqué à « ${periode.nom} »`}>
          <p>{resultat.bilan}.</p>
        </Alerte>
        {ecart && (
          <Alerte type="attention">
            <p>Le programme a changé entre l&apos;aperçu et ta validation : certaines dates ont été écartées pour ne rien écraser.</p>
          </Alerte>
        )}
        <Carte titre="Ce qui a été fait">
          <ListePlan plan={resultat.plan} titre="Ce qui a été fait, date par date" />
        </Carte>
        <div className="flex flex-wrap gap-3">
          <LienBouton href={lienPlanningPeriode(periodeId)} enCours>
            Voir le programme
          </LienBouton>
          <LienBouton href="/admin/templates" variante="secondaire" enCours>
            Retour aux templates
          </LienBouton>
          <Bouton
            type="button"
            variante="discret"
            onClick={() => {
              setResultat(null);
              setDates([]);
              setMessage(null);
            }}
          >
            Appliquer à d&apos;autres dates
          </Bouton>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <Carte titre="1. Le template et la période">
        <div className="flex flex-col gap-4">
          <ChampListe
            label="Template"
            id="choix-template"
            valeur={template.id}
            entrees={templates.map((t) => ({ valeur: t.id, libelle: t.nom }))}
            onChange={changerTemplate}
            aide={`Horaire : ${formatHoraire(template.heureDebut, template.heureFin)} · Lieu : ${template.lieu} · Programme : ${template.elements} élément${template.elements > 1 ? "s" : ""}`}
          />
          {sansProgramme && (
            <Alerte type="attention">
              <p>Ce template n&apos;a encore aucun élément dans son programme : complète-le avant de l&apos;appliquer.</p>
            </Alerte>
          )}
          <ChampListe
            label="Période"
            id="choix-periode"
            valeur={periodeId}
            entrees={periodes.map((p) => ({ valeur: p.id, libelle: p.statut === "BROUILLON" ? `${p.nom} (en préparation)` : p.nom }))}
            onChange={changerPeriode}
            disabled={changement}
            aide={
              changement
                ? "Chargement des séances de la période…"
                : `Du ${formatDateLongue(periode.dateDebut)} au ${formatDateLongue(periode.dateFin)}. Les périodes closes ne sont pas proposées.`
            }
          />
        </div>
      </Carte>

      <Carte titre="2. Les dates">
        {!premier ? (
          <p>Cette période est terminée : il n&apos;y reste aucune date à venir.</p>
        ) : (
          <div className="flex flex-col gap-5">
            {jour !== null && jours.length > 0 && (
              <div className="flex flex-col gap-3">
                <ChampListe
                  label="Jour de la semaine"
                  id="choix-jour"
                  valeur={String(jour)}
                  entrees={jours.map((j) => ({ valeur: String(j.jour), libelle: `${capitale(nomJour(j.jour))} — ${j.nombre} date${j.nombre > 1 ? "s" : ""}` }))}
                  onChange={(v) => setJour(Number(v))}
                  aide={`À partir du ${formatDateLongue(premier)}, jusqu'à la fin de la période.`}
                />
                <Bouton type="button" variante="secondaire" className="self-start" onClick={() => ajouter(datesDuJour(periode, aujourdHui, jour))}>
                  <Icone nom="plus" taille={20} />
                  Tous les {nomJour(jour)}s de la période
                </Bouton>
              </div>
            )}

            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                const refus = refusDate(datePrecise, periode, aujourdHui);
                if (refus) setMessage(refus);
                else ajouter([datePrecise]);
              }}
            >
              <Champ
                label="Une date précise"
                name="date"
                type="date"
                value={datePrecise}
                min={premier}
                max={periode.dateFin}
                onChange={(e) => setDatePrecise(e.target.value)}
              />
              <Bouton type="submit" variante="secondaire" className="self-start">
                <Icone nom="plus" taille={20} />
                Ajouter cette date
              </Bouton>
            </form>

            {/* Région vivante rendue en permanence : un message qui naît avec son conteneur n'est pas toujours lu. */}
            <p role="status" className="font-semibold empty:hidden">
              {message ?? ""}
            </p>

            <div className="flex flex-col gap-2">
              <h3 className="font-semibold">
                {dates.length === 0 ? "Aucune date choisie" : `${dates.length} date${dates.length > 1 ? "s" : ""} choisie${dates.length > 1 ? "s" : ""}`}
                <span className="font-normal text-texte-secondaire"> (au plus {DATES_APPLICATION_MAX})</span>
              </h3>
              {dates.length > 0 && (
                <>
                  <ul className="flex flex-wrap gap-2" aria-label="Dates choisies">
                    {dates.map((d) => (
                      <li key={d}>
                        <button
                          type="button"
                          onClick={() => setDates(dates.filter((x) => x !== d))}
                          className="inline-flex min-h-12 items-center gap-2 rounded-full border-2 border-bordure bg-surface-douce pr-3 pl-4 font-semibold hover:border-rouge"
                        >
                          {formatDateCourte(d)}
                          <Icone nom="croix" taille={18} />
                          <span className="sr-only">(retirer cette date)</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  <Bouton
                    type="button"
                    variante="discret"
                    taille="petite"
                    className="self-start"
                    onClick={() => {
                      setDates([]);
                      setMessage(null);
                    }}
                  >
                    <Icone nom="croix" taille={18} />
                    Annuler la sélection
                  </Bouton>
                </>
              )}
            </div>
          </div>
        )}
      </Carte>

      {dates.length > 0 && (
        <Carte titre="3. Ce qui sera fait">
          <div className="flex flex-col gap-4">
            <p className="font-semibold">{bilanApplication(plan)}</p>
            <ListePlan plan={plan} titre="Ce qui sera fait, date par date" />
            <p className="text-sm text-texte-secondaire">
              Une séance créée reçoit l&apos;horaire, le lieu et le programme du template ; une séance existante ne reçoit que le programme. Aucune
              notification n&apos;est envoyée.
            </p>
          </div>
        </Carte>
      )}

      <div className="flex flex-col gap-2">
        <Bouton type="button" taille="grande" className="self-start" disabled={enVol || changement || aFaire === 0 || sansProgramme} aria-busy={enVol} onClick={appliquer}>
          <Icone nom="copie" taille={22} />
          {enVol ? "Application en cours…" : "Appliquer le template"}
        </Bouton>
        {!enVol && aFaire === 0 && !sansProgramme && (
          <p className="text-sm text-texte-secondaire">
            {dates.length === 0 ? "Choisis au moins une date." : "Aucune des dates choisies ne peut recevoir ce template."}
          </p>
        )}
        {silence && <SansReponse />}
        {erreur && (
          <Alerte type="erreur">
            <p>{erreur}</p>
          </Alerte>
        )}
      </div>
    </div>
  );
}
