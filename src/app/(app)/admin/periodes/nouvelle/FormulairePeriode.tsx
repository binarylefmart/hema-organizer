"use client";

import { Fragment, useActionState, useState } from "react";
import { creerPeriode } from "@/actions/periodes";
import { FORM_INITIAL } from "@/lib/form";
import {
  bimestreCourant,
  bimestresChoix,
  datesBimestre,
  datesTrimestre,
  DECALAGES_BIMESTRE,
  estBimestre,
  estTrimestre,
  libelleSaison,
  lireSaison,
  SAISON_MAX,
  SAISON_MIN,
  saisonCourante,
  saisonsChoix,
  TRIMESTRES,
  trimestreCourant,
  type Bimestre,
  type DecalageBimestre,
  type Trimestre,
} from "@/lib/periodes";
import { addDays, formatDateLongue, minuscule, todayIso } from "@/lib/dates";
import { Alerte } from "@/components/ui/Alerte";
import { BoutonEnvoi } from "@/components/ui/BoutonEnvoi";
import { Champ } from "@/components/ui/Champ";
import { Select } from "@/components/ui/Select";

type Type = "trimestre" | "bimestre" | "personnalisee";

/** « Vendredi 1 janvier 2027 » → « vendredi 1er janvier 2027 » (au fil d'une phrase). */
function dateDansPhrase(iso: string): string {
  const s = formatDateLongue(iso);
  return minuscule(s).replace(/ 1 /, " 1er ");
}

/**
 * Nouvelle période, trois manières de la poser :
 *
 * - un **trimestre de la saison** (T1 septembre→décembre, T2 janvier→mars, T3 avril→juin, ou la
 *   période estivale juillet→août) ;
 * - un **bimestre** : six cycles de deux mois par saison, pour un club qui travaille plus court que
 *   le trimestre sans vouloir retaper deux dates à chaque fois — avec un **calage pair ou impair**
 *   (même jour), qui décale toute la grille d'un mois ;
 * - une **période personnalisée** (un stage, un cycle hors saison).
 *
 * Dans les trois cas, le nom et les dates restent modifiables avant création : les deux premiers
 * modes ne font que **proposer** ce que le calendrier dit, et « Rétablir » ramène la proposition.
 */
export function FormulairePeriode({
  saisonInitiale,
  trimestreInitial,
  bimestreInitial,
  decalageInitial = 0,
}: { saisonInitiale?: number; trimestreInitial?: Trimestre; bimestreInitial?: Bimestre; decalageInitial?: DecalageBimestre } = {}) {
  const [state, action] = useActionState(creerPeriode, FORM_INITIAL);
  const aujourdHui = todayIso();
  const saisons = saisonsChoix(aujourdHui);

  // Un lien qui porte un bimestre ouvre l'onglet des bimestres (rappel de fin de période).
  const [type, setType] = useState<Type>(bimestreInitial ? "bimestre" : "trimestre");
  const [saison, setSaison] = useState(() => saisonInitiale ?? saisonCourante(aujourdHui));
  // Le champ garde ce qui est tapé (« 20 », « 202 »…) ; la saison, elle, ne change que sur une année valable
  const [saisonTexte, setSaisonTexte] = useState(() => String(saisonInitiale ?? saisonCourante(aujourdHui)));
  const [trimestre, setTrimestre] = useState<Trimestre>(() => trimestreInitial ?? trimestreCourant(aujourdHui));
  const [decalage, setDecalage] = useState<DecalageBimestre>(decalageInitial);
  const [bimestre, setBimestre] = useState<Bimestre>(() => bimestreInitial ?? bimestreCourant(aujourdHui, decalageInitial).bimestre);
  // Nom et dates proposés par le cycle choisi, mais toujours modifiables (« ajusté » = on ne les écrase plus)
  const propose = type === "bimestre" ? datesBimestre(saison, bimestre, decalage) : datesTrimestre(saison, trimestre);
  const [ajuste, setAjuste] = useState<{ nom: string; dateDebut: string; dateFin: string } | null>(null);
  const valeurs = ajuste ?? propose;
  const finAvantDebut = valeurs.dateFin < valeurs.dateDebut;

  const choisirTrimestre = (s: number, t: Trimestre) => {
    setSaison(s);
    setSaisonTexte(String(s));
    setTrimestre(t);
    setAjuste(null);
  };
  const choisirBimestre = (s: number, b: Bimestre) => {
    setSaison(s);
    setSaisonTexte(String(s));
    setBimestre(b);
    setAjuste(null);
  };
  /* Changer de calage garde le **rang** du cycle et décale ses deux mois : on tenait le deuxième
     cycle de la saison, on le tient encore, il commence simplement un mois plus tard. */
  const choisirDecalage = (d: DecalageBimestre) => {
    setDecalage(d);
    setAjuste(null);
  };
  /* Changer d'onglet reprend la proposition du calendrier : ce qu'on avait retouché pour un
     trimestre n'a plus de sens sur un cycle de deux mois. */
  const choisirType = (t: Type) => {
    setType(t);
    setAjuste(null);
  };
  // Année tapée à la main : n'importe quelle saison, de SAISON_MIN à SAISON_MAX
  const saisirSaison = (texte: string) => {
    setSaisonTexte(texte);
    const n = lireSaison(texte);
    if (n !== null) choisirTrimestre(n, trimestre);
  };
  const saisonHorsPlage = lireSaison(saisonTexte) === null;
  const modifier = (champ: "nom" | "dateDebut" | "dateFin", valeur: string) => setAjuste({ ...valeurs, [champ]: valeur });

  const onglet = (t: Type, label: string) => (
    <button
      type="button"
      onClick={() => choisirType(t)}
      aria-pressed={type === t}
      className={`min-h-12 rounded-full border-2 px-5 font-semibold ${type === t ? "border-primaire bg-primaire text-primaire-texte shadow-bouton" : "border-bordure bg-surface text-texte"}`}
    >
      {label}
    </button>
  );

  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      {state.erreur && <Alerte type="erreur">{state.erreur}</Alerte>}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Type de période">
        {onglet("trimestre", "Trimestre")}
        {onglet("bimestre", "Bimestre")}
        {onglet("personnalisee", "Période personnalisée")}
      </div>

      {/* La clé force le remontage des champs d'un mode à l'autre (contrôlés d'un côté, libres de l'autre). */}
      {type !== "personnalisee" ? (
        <Fragment key="cycle">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              {/* L'année se tape directement (2029 pour la saison 2029-2030) : aucune liste à dérouler */}
              <Champ
                label="Saison (année de départ)"
                name="saison"
                type="number"
                inputMode="numeric"
                min={SAISON_MIN}
                max={SAISON_MAX}
                value={saisonTexte}
                onChange={(e) => saisirSaison(e.target.value)}
                required
                aide={`La saison sportive démarre le 1er septembre : ${libelleSaison(saison)} va de septembre ${saison} à août ${saison + 1}.`}
                erreur={state.erreurs?.saison ?? (saisonHorsPlage ? `Tape une année entre ${SAISON_MIN} et ${SAISON_MAX}.` : undefined)}
              />
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Saisons proches">
                {saisons.map((a) => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => (type === "bimestre" ? choisirBimestre(a, bimestre) : choisirTrimestre(a, trimestre))}
                    aria-pressed={a === saison}
                    className={`flex min-h-11 items-center rounded-full border-2 px-3 text-sm font-semibold ${
                      a === saison ? "border-primaire bg-primaire text-primaire-texte shadow-bouton" : "border-bordure bg-surface text-texte"
                    }`}
                  >
                    {libelleSaison(a)}
                  </button>
                ))}
              </div>
            </div>
            {type === "bimestre" ? (
              <div className="flex flex-col gap-1.5">
                <Select
                  label="Bimestre"
                  name="bimestre"
                  value={bimestre}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (estBimestre(n)) choisirBimestre(saison, n);
                  }}
                >
                  {bimestresChoix(decalage).map((b) => (
                    <option key={b.n} value={b.n}>
                      {b.label}
                    </option>
                  ))}
                </Select>
                {/* Le calage de la grille, demandé : un club dont la saison démarre en octobre veut
                    octobre-novembre, décembre-janvier… et non le découpage calé sur septembre. Les
                    deux mois sont écrits sur les boutons — « pair » et « impair » ne disent rien à
                    qui ouvre l'écran pour la première fois. */}
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Calage des cycles">
                  {DECALAGES_BIMESTRE.map(({ d, label }) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => choisirDecalage(d)}
                      aria-pressed={d === decalage}
                      className={`flex min-h-11 items-center rounded-full border-2 px-3 text-sm font-semibold ${
                        d === decalage ? "border-primaire bg-primaire text-primaire-texte shadow-bouton" : "border-bordure bg-surface text-texte"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="text-sm text-texte-secondaire">Décale les six cycles d&apos;un mois, pour une saison qui démarre en octobre.</p>
              </div>
            ) : (
              <Select
                label="Trimestre"
                name="trimestre"
                value={trimestre}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (estTrimestre(n)) choisirTrimestre(saison, n);
                }}
              >
                {TRIMESTRES.map((t) => (
                  <option key={t.n} value={t.n}>
                    {t.label}
                  </option>
                ))}
              </Select>
            )}
          </div>
          <div className="flex flex-col items-start rounded-xl bg-surface-douce px-4 py-3">
            <p aria-live="polite">
              <span className="font-semibold">{valeurs.nom}</span> · du {dateDansPhrase(valeurs.dateDebut)} au {dateDansPhrase(valeurs.dateFin)}
            </p>
            {ajuste && (
              <button type="button" onClick={() => setAjuste(null)} className="mt-1 min-h-12 font-semibold text-primaire underline underline-offset-4">
                Rétablir le nom et les dates {type === "bimestre" ? "du bimestre" : "du trimestre"}
              </button>
            )}
          </div>
          <Champ label="Nom" name="nom" value={valeurs.nom} onChange={(e) => modifier("nom", e.target.value)} required maxLength={60} erreur={state.erreurs?.nom} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Champ label="Début" name="dateDebut" type="date" value={valeurs.dateDebut} onChange={(e) => modifier("dateDebut", e.target.value)} required erreur={state.erreurs?.dateDebut} />
            <Champ
              label="Fin"
              name="dateFin"
              type="date"
              value={valeurs.dateFin}
              onChange={(e) => modifier("dateFin", e.target.value)}
              required
              erreur={state.erreurs?.dateFin ?? (finAvantDebut ? "La date de fin doit suivre la date de début." : undefined)}
            />
          </div>
        </Fragment>
      ) : (
        <Fragment key="personnalisee">
          <Champ label="Nom" name="nom" placeholder="ex. Stage de Pâques" required maxLength={60} erreur={state.erreurs?.nom} aide="Un stage, un cycle court… tout ce qui n'entre ni dans un trimestre ni dans un bimestre." />
          <div className="grid gap-4 sm:grid-cols-2">
            <Champ label="Début" name="dateDebut" type="date" defaultValue={aujourdHui} required erreur={state.erreurs?.dateDebut} />
            <Champ label="Fin" name="dateFin" type="date" defaultValue={addDays(aujourdHui, 30)} required erreur={state.erreurs?.dateFin} />
          </div>
        </Fragment>
      )}

      <BoutonEnvoi enCours="Création…">Créer la période</BoutonEnvoi>
    </form>
  );
}
