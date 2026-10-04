"use client";

import { useActionState, useState } from "react";
import { FORM_INITIAL, type FormState } from "@/lib/form";
import { formatDateCourte, formatHeure, nomMois } from "@/lib/dates";
import { Alerte } from "@/components/ui/Alerte";
import { BoutonEnvoi } from "@/components/ui/BoutonEnvoi";
import { Bouton } from "@/components/ui/Bouton";

type Candidate = { date: string; heureDebut: string; heureFin: string; lieu: string };

/**
 * Génération des séances : toutes les dates issues des créneaux sont proposées cochées ;
 * on décoche les vacances et les jours fériés, puis on crée.
 *
 * **Décocher n'est pas « pas maintenant », c'est « pas de cours ce soir-là »** :,
 * `genererSeancesPeriode` mémorise les dates décochées en base (`PeriodDateExclue`) et ne les
 * repropose plus. L'écran doit donc l'annoncer **avant** le bouton, avec le décompte : qui ne crée
 * que le premier mois — geste banal quand la salle n'est pas confirmée — écarte sans le savoir les
 * 22 dates suivantes, et ne le découvre qu'à la visite d'après. Le bouton « Reproposer » (juste en
 * dessous, sur la page de la période) est la porte de sortie : on le nomme ici.
 *
 * C'est l'encart **« Reste à créer »** — les dates que les créneaux donnent et que la période n'a
 * pas encore. Son pendant, `SeancesCreees`, montre celles qui existent : ensemble, ils disent d'un
 * coup d'œil ce qui manque et ce qui est là.
 */
export function SelectionDates({ action, candidates }: { action: (prev: FormState, fd: FormData) => Promise<FormState>; candidates: Candidate[] }) {
  const [state, formAction] = useActionState(action, FORM_INITIAL);
  const [cochees, setCochees] = useState<Set<string>>(new Set(candidates.map((c) => `${c.date} ${c.heureDebut}`)));
  /**
   * **Ce que le serveur vient de reproposer arrive coché** — miroir de la valeur du serveur, même
   * patron que `CaseEditeur` et `SelecteurRole`, et pour le même défaut : un `useState` semé par une
   * prop n'est semé qu'**au montage**, et le balayage du JSX ne le voit pas (il ne lit que les
   * `defaultValue`).
   *
   * Le scénario, relevé. Le bureau décoche vingt-deux dates (salle non confirmée) et génère les
   * quatre autres. Plus tard il clique « Reproposer les 22 dates écartées » — la porte de sortie
   * que cet écran documente lui-même. L'action revalide le chemin de la page, donc `candidates`
   * change **sous le composant monté** : les vingt-deux dates reviennent… mais `cochees` ne les
   * connaît pas. Elles s'affichent toutes **barrées**, l'alerte annonce qu'elles vont être
   * écartées, et le bouton propose « Créer 4 séances et écarter 22 dates ». Un clic de plus et on
   * réexclut ce qu'on venait de récupérer. La seule issue était de recocher vingt-deux cases, ou de
   * recharger la page — que rien n'indiquait.
   *
   * Même mécanique après « Ajouter le créneau » : les treize dates du créneau qu'on vient de créer
   * arrivaient décochées, et si l'encart était vide au chargement le bouton restait **désactivé** sur
   * « Créer 0 séance ». On ne pouvait plus générer les séances d'un créneau qu'on venait d'ajouter.
   *
   * La règle appliquée : **une date qui apparaît arrive cochée** (c'est ce que veut dire « proposée »),
   * **une date qui disparaît sort de la sélection** (sans quoi le décompte des décochées passait
   * négatif et le bouton annonçait plus de séances qu'il n'y avait de dates), et **ce que la personne
   * a décoché entre-temps reste décoché** : le serveur reprend la main sur ce qu'il change, pas sur le
   * reste.
   */
  const clesServeur = candidates.map((c) => `${c.date} ${c.heureDebut}`).join("\u0000");
  const [vuDuServeur, setVuDuServeur] = useState(clesServeur);
  if (vuDuServeur !== clesServeur) {
    const avant = new Set(vuDuServeur ? vuDuServeur.split("\u0000") : []);
    const maintenant = candidates.map((c) => `${c.date} ${c.heureDebut}`);
    setVuDuServeur(clesServeur);
    setCochees(new Set(maintenant.filter((cle) => !avant.has(cle) || cochees.has(cle))));
  }
  if (candidates.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        {/* **Le compte rendu de la génération se lit ici, et nulle part ailleurs**. Ce retour
            précoce court-circuitait l'alerte de succès posée plus bas dans le formulaire : on
            cochait les vingt-six dates du trimestre, on cliquait « Créer 26 séances », l'action
            réussissait et renvoyait « 26 séances créées. 4 dates écartées : elles ne seront plus
            proposées. » — la **seule** information irréversible de l'écran —, puis `candidates` se
            vidait, ce paragraphe prenait la place du formulaire, et la phrase disparaissait sans
            avoir été lue. */}
        {state.succes && <Alerte type="succes">{state.succes}</Alerte>}
        {state.erreur && <Alerte type="erreur">{state.erreur}</Alerte>}
        <p className="text-texte-secondaire">Toutes les séances des créneaux sont déjà créées. Ajoute un créneau ou une séance ponctuelle si besoin.</p>
      </div>
    );
  }
  // Regroupement par mois pour la lisibilité
  const parMois = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const mois = c.date.slice(0, 7);
    parMois.set(mois, [...(parMois.get(mois) ?? []), c]);
  }
  const basculer = (cle: string) => {
    const n = new Set(cochees);
    if (n.has(cle)) n.delete(cle);
    else n.add(cle);
    setCochees(n);
  };
  const decochees = candidates.length - cochees.size;
  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <p className="text-sm text-texte-secondaire">
        {candidates.length} date{candidates.length > 1 ? "s" : ""} proposée{candidates.length > 1 ? "s" : ""} d&apos;après les créneaux. Décoche les vacances et jours
        fériés : les dates décochées sont écartées pour de bon des propositions.
      </p>
      {/* type="button" : ces deux boutons cochent/décochent, ils ne soumettent pas le formulaire */}
      <div className="flex flex-wrap gap-2">
        <Bouton type="button" variante="secondaire" taille="petite" onClick={() => setCochees(new Set(candidates.map((c) => `${c.date} ${c.heureDebut}`)))}>
          Tout cocher
        </Bouton>
        <Bouton type="button" variante="secondaire" taille="petite" onClick={() => setCochees(new Set())}>
          Tout décocher
        </Bouton>
      </div>
      <div className="grid gap-4 @md:grid-cols-2 @3xl:grid-cols-3">
        {[...parMois.entries()].map(([mois, liste]) => (
          <fieldset key={mois} className="rounded-xl border border-bordure/60 p-3">
            <legend className="px-1 font-semibold">{nomMois(mois)}</legend>
            <ul className="flex flex-col">
              {liste.map((c) => {
                const cle = `${c.date} ${c.heureDebut}`;
                const actif = cochees.has(cle);
                return (
                  <li key={cle}>
                    <label className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-1 ${actif ? "" : "text-texte-secondaire line-through"}`}>
                      <input type="checkbox" name="dates" value={cle} checked={actif} onChange={() => basculer(cle)} className="size-6 shrink-0 accent-primaire" />
                      <span>
                        {formatDateCourte(c.date)} <span className="text-sm text-texte-secondaire">{formatHeure(c.heureDebut)} · {c.lieu}</span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        ))}
      </div>
      {state.erreur && <Alerte type="erreur">{state.erreur}</Alerte>}
      {state.succes && <Alerte type="succes">{state.succes}</Alerte>}
      {/* L'avertissement se met à jour au fil des cases : c'est le décompte du moment, juste avant le
          bouton, là où la décision se prend. */}
      {decochees > 0 && (
        <Alerte type="attention">
          {decochees === 1 ? (
            <>La date décochée sera retirée du calendrier de la période : elle ne sera plus proposée.</>
          ) : (
            <>Les {decochees} dates décochées seront retirées du calendrier de la période : elles ne seront plus proposées.</>
          )}{" "}
          C&apos;est réversible : le bouton « Reproposer » apparaît juste en dessous et les fait toutes revenir.
        </Alerte>
      )}
      <BoutonEnvoi enCours="Création…" disabled={cochees.size === 0}>
        Créer {cochees.size} séance{cochees.size > 1 ? "s" : ""}
        {decochees > 0 ? ` et écarter ${decochees} date${decochees > 1 ? "s" : ""}` : ""}
      </BoutonEnvoi>
    </form>
  );
}


export type SeanceCreee = { id: string; date: string; heureDebut: string; lieu: string; annulee: boolean; reponses: number };

/**
 * **« Séances déjà créées »** — le miroir de l'encart précédent : les séances de la période,
 * cochées. **Décocher, c'est retirer** ; le bouton ne part qu'avec ce qui a été décoché, et il
 * annonce ce que la suppression emporte (les réponses des membres) avant de demander confirmation.
 *
 * Pourquoi décocher plutôt qu'une croix par ligne : c'est le même geste que dans l'encart d'à côté,
 * dans le même sens (coché = la séance existe ou existera), et il se fait en une fois pour une
 * semaine de vacances oubliée — ce qui est justement le cas où l'on vient ici.
 */
export function SeancesCreees({
  action,
  seances,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  seances: SeanceCreee[];
}) {
  const [state, formAction] = useActionState(action, FORM_INITIAL);
  const [retirees, setRetirees] = useState<Set<string>>(new Set());
  if (seances.length === 0) {
    return <p className="text-texte-secondaire">Aucune séance pour l&apos;instant : coche des dates ci-dessus, puis crée-les.</p>;
  }
  const parMois = new Map<string, SeanceCreee[]>();
  for (const s of seances) {
    const mois = s.date.slice(0, 7);
    parMois.set(mois, [...(parMois.get(mois) ?? []), s]);
  }
  const basculer = (id: string) => {
    const n = new Set(retirees);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setRetirees(n);
  };
  const aRetirer = seances.filter((s) => retirees.has(s.id));
  const reponsesPerdues = aRetirer.reduce((n, s) => n + s.reponses, 0);
  const confirmation =
    `Retirer ${aRetirer.length} séance${aRetirer.length > 1 ? "s" : ""} de la période ?` +
    (reponsesPerdues > 0 ? ` ${reponsesPerdues} réponse${reponsesPerdues > 1 ? "s" : ""} de membres ${reponsesPerdues > 1 ? "seront effacées" : "sera effacée"} avec ${aRetirer.length > 1 ? "elles" : "elle"}.` : "") +
    " Cette action est sans retour.";
  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <p className="text-sm text-texte-secondaire">
        {seances.length} séance{seances.length > 1 ? "s" : ""} dans la période. Décoche celles à retirer complètement.
      </p>
      <div className="grid gap-4 @md:grid-cols-2 @3xl:grid-cols-3">
        {[...parMois.entries()].map(([mois, liste]) => (
          <fieldset key={mois} className="rounded-xl border border-bordure/60 p-3">
            <legend className="px-1 font-semibold">{nomMois(mois)}</legend>
            <ul className="flex flex-col">
              {liste.map((s) => {
                const retiree = retirees.has(s.id);
                return (
                  <li key={s.id}>
                    <label className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-1 ${retiree ? "text-rouge line-through" : ""}`}>
                      {/* La case n'a pas de `name` : ce sont les décochées qui partent, en champs cachés */}
                      <input type="checkbox" checked={!retiree} onChange={() => basculer(s.id)} className="size-6 shrink-0 accent-primaire" />
                      <span>
                        {formatDateCourte(s.date)}{" "}
                        <span className="text-sm text-texte-secondaire">
                          {formatHeure(s.heureDebut)} · {s.lieu}
                          {s.annulee ? " · annulée" : ""}
                          {s.reponses > 0 ? ` · ${s.reponses} réponse${s.reponses > 1 ? "s" : ""}` : ""}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        ))}
      </div>
      {aRetirer.map((s) => (
        <input key={s.id} type="hidden" name="supprimer" value={s.id} />
      ))}
      {state.erreur && <Alerte type="erreur">{state.erreur}</Alerte>}
      {state.succes && <Alerte type="succes">{state.succes}</Alerte>}
      <BoutonEnvoi variante="danger" enCours="Suppression…" confirmation={confirmation} disabled={aRetirer.length === 0}>
        Retirer {aRetirer.length} séance{aRetirer.length > 1 ? "s" : ""}
      </BoutonEnvoi>
    </form>
  );
}
