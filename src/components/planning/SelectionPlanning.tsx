"use client";

import { createContext, useContext, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ajouterPartiesEnMasse } from "@/actions/planning";
import { libelleChoixNiveau, NIVEAUX, PARTIE_DESCRIPTION_MAX, THEME_MAX, type Niveau } from "@/lib/constants";
import { couleurPersonne } from "@/lib/couleurs";
import { Bouton } from "@/components/ui/Bouton";
import { Champ } from "@/components/ui/Champ";
import { ChoixGeste } from "@/components/ui/ChoixGeste";
import { Icone } from "@/components/ui/Icone";
import { InterrupteurSelection } from "@/components/ui/InterrupteurSelection";
import { ListeDeroulante } from "@/components/ui/ListeDeroulante";
import { ZoneTexte } from "@/components/ui/ZoneTexte";
import type { EntreeListe } from "@/components/ui/liste-deroulante";
import { gesteRetenu, varianteGeste } from "@/components/ui/choix-geste";
import {
  ajouter,
  barreDeMasseVisible,
  basculer,
  basculerJour,
  CHOIX_JOUR_VIDE,
  compterHorsAffichage,
  entreesJours,
  etatToutCocher,
  joursProposes,
  LIBELLE_PAR_JOUR,
  lignesSelectionnees,
  restreindre,
  retirer,
  selectionApresInterrupteur,
  texteHorsAffichage,
  texteRepliees,
} from "@/components/ui/selection";
import { useBrouillon } from "./ContexteBrouillon";
import { useOptionsCase } from "./ContexteOptions";
import { AUTRE } from "./options";
import { SeancesRepliees } from "./SeancesRepliees";
import {
  compteurPlanning,
  confirmationPlanning,
  ENTREES_TETE,
  expliquerGestePlanning,
  gestesPlanningApplicables,
  INVITE_PLANNING,
  libelleAfficherEtSelectionnerPlanning,
  libelleBoutonPlanning,
  libellePartieProposee,
  libelleToutesSeancesPlanning,
  lireChoix,
  MOTS_PLANNING,
  NE_PAS_CHANGER,
  partiesProposees,
  planReglage,
  reglageVide,
  texteSansCasePlanning,
  type GestePlanning,
  type LignePlanning,
  type ReglagePartie,
} from "./selection-planning";

/**
 * **Cocher plusieurs séances du planning, puis agir une seule fois** — le planning en mode modification.
 *
 * C'est le geste de l'onglet Séances (`SelectionSeances`), de l'annuaire et des présences : même
 * interrupteur « Sélection multiple » (`InterrupteurSelection`), même case maîtresse qui nomme sa
 * portée, même phrase d'invite, même barre « Que veux-tu faire ? » (`ChoixGeste`) — **cadre, compteur,
 * « Annuler la sélection » et collage sous l'en-tête compris** — visible seulement avec une sélection.
 * La mécanique vient de `src/components/ui/selection.ts` ; les mots du planning de
 * `selection-planning.ts`.
 *
 * **Ce que le planning ajoute : « Sélectionner par jour ».** Une liste dépliante à côté de la case
 * maîtresse, une entrée par jour de la semaine présent parmi les cartes affichées (« Tous les mardis
 * (6) », « Tous les vendredis (5) »). La choisir ajoute ces séances au lot, puis la liste revient à
 * « Choisir un jour… » ; quand elles y sont toutes, l'entrée devient « Retirer les mardis (6) ».
 *
 * **« Régler une partie » n'écrit rien** : il pose les cases dans le brouillon du mode modification
 * (`poserPlusieurs`), exactement comme si on les avait réglées à la main — et c'est la barre du bas,
 * « Appliquer les modifications », qui les enregistre avec tous ses verrous. **Ajouter un cours ou une
 * option** s'enregistre tout de suite, comme les boutons de la carte (`ajouterPartiesEnMasse`).
 *
 * **La sélection ne porte que sur ce qui est affiché** : les cartes visibles, et les repliées une fois
 * dépliées. Le repli du planning est donc tenu **ici** (et rendu par `SeancesRepliees`, piloté) : la
 * case maîtresse doit savoir ce qui est déplié. Une séance annulée n'a pas de case — son programme est
 * verrouillé —, et un trimestre clos n'ouvre pas le mode modification du tout.
 */

type Contexte = { actif: boolean; selection: ReadonlySet<string>; basculer: (id: string) => void };

const Selection = createContext<Contexte | null>(null);

/** L'entrée « écrire une description » de la liste du même nom (les deux autres sont communes). */
const ECRIRE = "__ecrire__";

export function SelectionPlanning({
  lignes,
  visibles,
  cachees,
  restantes,
  nbVisibles,
}: {
  /** Une entrée par carte de séance, dans l'ordre de la grille — `null` pour une séance annulée. */
  lignes: (LignePlanning | null)[];
  /** Les blocs rendus par le serveur au-dessus du repli (cartes et intertitres de mois). */
  visibles: ReactNode[];
  /** Les blocs repliés derrière « Afficher les N autres séances ». */
  cachees: ReactNode[];
  restantes: number;
  /** Combien de **cartes** (pas de blocs) sont visibles avant le repli. */
  nbVisibles: number;
}) {
  const router = useRouter();
  const brouillon = useBrouillon();
  const options = useOptionsCase();
  const [actif, setActif] = useState(false);
  const [deplie, setDeplie] = useState(false);
  const [brute, setSelection] = useState<ReadonlySet<string>>(() => new Set());
  const [gesteChoisi, setGesteChoisi] = useState<GestePlanning | "">("");
  const [partieChoisie, setPartieChoisie] = useState("");
  const [instructeur, setInstructeur] = useState(NE_PAS_CHANGER);
  const [second, setSecond] = useState(NE_PAS_CHANGER);
  const [themeChoix, setThemeChoix] = useState(NE_PAS_CHANGER);
  const [themeLibre, setThemeLibre] = useState("");
  const [niveau, setNiveau] = useState(NE_PAS_CHANGER);
  const [descriptionChoix, setDescriptionChoix] = useState(NE_PAS_CHANGER);
  const [descriptionTexte, setDescriptionTexte] = useState("");
  const [message, setMessage] = useState<{ type: "ok" | "erreur"; texte: string } | null>(null);
  const [enCours, demarrer] = useTransition();
  const caseMaitresse = useRef<HTMLInputElement>(null);

  const selectionnables = lignes.filter((l): l is LignePlanning => l !== null);
  // Une séance qui a quitté la grille (filtre, annulation entre-temps) quitte aussi le lot.
  const selection = restreindre(brute, selectionnables);
  const toutesAffichees = deplie || cachees.length === 0;
  const affichees = (toutesAffichees ? lignes : lignes.slice(0, nbVisibles)).filter((l): l is LignePlanning => l !== null);
  const repliees = toutesAffichees ? [] : lignes.slice(nbVisibles).filter((l): l is LignePlanning => l !== null);
  const idsAffiches = affichees.map((l) => l.id);
  const etatCases = etatToutCocher(affichees, selection);
  const jours = joursProposes(affichees, selection);
  const lot = lignesSelectionnees(selectionnables, selection);

  useEffect(() => {
    if (caseMaitresse.current) caseMaitresse.current.indeterminate = etatCases === "partielle";
  }, [etatCases]);

  const applicables = gestesPlanningApplicables(lot);
  const geste = gesteRetenu(gesteChoisi, applicables);
  useEffect(() => {
    if (geste !== gesteChoisi) setGesteChoisi("");
  }, [geste, gesteChoisi]);

  const parties = partiesProposees(lot);
  // Une partie qui n'existe plus dans le lot (séance décochée) n'est plus choisie.
  const partie = parties.some((p) => p.libelle === partieChoisie) ? partieChoisie : "";

  const reglage: ReglagePartie = {
    instructeurId: lireChoix(instructeur),
    instructeurSecondId: lireChoix(second),
    theme: themeChoix === AUTRE ? themeLibre.trim() || undefined : lireChoix(themeChoix),
    niveau: lireChoix(niveau) as Niveau | undefined,
    description: descriptionChoix === ECRIRE ? descriptionTexte.trim() || undefined : lireChoix(descriptionChoix),
  };
  const plan = geste === "regler" && partie && !reglageVide(reglage) ? planReglage(lot, partie, reglage, brouillon?.modifiees ?? new Map()) : null;
  const inerte = geste === "" || (geste === "regler" && (!plan || plan.ecritures.length === 0));
  const nombreBouton = geste === "regler" ? (plan?.ecritures.length ?? 0) : lot.length;

  const remettreReglage = () => {
    setInstructeur(NE_PAS_CHANGER);
    setSecond(NE_PAS_CHANGER);
    setThemeChoix(NE_PAS_CHANGER);
    setThemeLibre("");
    setNiveau(NE_PAS_CHANGER);
    setDescriptionChoix(NE_PAS_CHANGER);
    setDescriptionTexte("");
  };
  const remettreAZero = () => {
    setGesteChoisi("");
    setPartieChoisie("");
    remettreReglage();
  };

  const lancer = () => {
    if (geste === "" || inerte) return;
    if (geste === "regler") {
      if (!plan || !brouillon) return;
      // Rien ne part : les cases entrent dans le brouillon, la barre du bas les enregistrera.
      brouillon.poserPlusieurs(plan.ecritures);
      const n = plan.ecritures.length;
      setMessage({
        type: "ok",
        texte: `« ${partie} » réglé sur ${n === 1 ? "1 séance" : `${n} séances`}, pas encore appliqué : « Appliquer les modifications » l'enregistre.`,
      });
      remettreReglage();
      return;
    }
    if (!window.confirm(confirmationPlanning(geste, lot.length))) return;
    const sessionIds = lot.map((l) => l.id);
    setMessage(null);
    demarrer(async () => {
      try {
        const res = await ajouterPartiesEnMasse({ sessionIds, estOption: geste === "ajouterOption" });
        if (res.erreur) {
          setMessage({ type: "erreur", texte: res.erreur });
          return;
        }
        setMessage({ type: "ok", texte: res.succes ?? "C'est fait." });
        remettreAZero();
        router.refresh();
      } catch {
        setMessage({ type: "erreur", texte: "L'ajout n'a pas abouti — vérifie ta connexion. Rien n'a été ajouté." });
      }
    });
  };

  /* ---- Les listes du réglage : les personnes et les thèmes du planning (`OptionsCase`). ---- */
  const personnes = (exclu?: string): EntreeListe[] =>
    options.personnes
      .filter((p) => p.id !== exclu)
      .map((p) => ({ valeur: p.id, libelle: `${p.prenom} ${p.nom}`, couleur: couleurPersonne(p.id, p.couleur) }));
  const choixInstructeur = lireChoix(instructeur);
  const entreesInstructeur: EntreeListe[] = [...ENTREES_TETE, ...personnes()];
  // Le second ne se propose pas la personne choisie pour mener : on ne s'assiste pas soi-même.
  const entreesSecond: EntreeListe[] = [...ENTREES_TETE, ...personnes(choixInstructeur || undefined)];
  const entreesTheme: EntreeListe[] = [...ENTREES_TETE, ...options.themes.map((t) => ({ valeur: t, libelle: t })), { valeur: AUTRE, libelle: "Autre…" }];
  const entreesNiveau: EntreeListe[] = [ENTREES_TETE[0], ...NIVEAUX.map((n) => ({ valeur: n, libelle: libelleChoixNiveau(n) }))];
  const entreesDescription: EntreeListe[] = [...ENTREES_TETE, { valeur: ECRIRE, libelle: "Écrire une description…" }];

  const compteurAnnonce = compteurPlanning(selection.size);
  const horsAffichage = texteHorsAffichage(compterHorsAffichage(selection, affichees), MOTS_PLANNING);
  const sansCase = texteSansCasePlanning(lignes.length - selectionnables.length);
  const montrerBarre = actif && barreDeMasseVisible(selection);

  return (
    <Selection.Provider value={{ actif, selection, basculer: (id) => setSelection((s) => basculer(s, id)) }}>
      <div className="flex flex-col gap-1">
        {/* L'interrupteur commun : éteint, ni case ni barre ; l'éteindre vide le lot. */}
        <InterrupteurSelection
          actif={actif}
          disabled={selectionnables.length === 0}
          onChange={(suite) => {
            setActif(suite);
            setSelection((s) => selectionApresInterrupteur(s, suite));
            if (!suite) remettreAZero();
            setMessage(null);
          }}
        />

        {actif && (
          <>
            <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
              {/* La case maîtresse : 48 px et une case de 24 px, comme sur les autres écrans de masse. */}
              <label className="inline-flex min-h-12 w-fit cursor-pointer items-center gap-2 font-semibold">
                <input
                  ref={caseMaitresse}
                  type="checkbox"
                  checked={etatCases === "toutes"}
                  disabled={affichees.length === 0}
                  onChange={() => setSelection((s) => (etatCases === "toutes" ? retirer(s, idsAffiches) : ajouter(s, idsAffiches)))}
                  className="size-6 accent-primaire"
                />
                {libelleToutesSeancesPlanning(affichees.length)}
              </label>
              {/* **Sélectionner par jour** : une entrée par jour de la semaine présent parmi les cartes
                  affichées, jamais deux jours groupés. Choisir ajoute (ou retire, si tout y est), puis la
                  liste revient d'elle-même à « Choisir un jour… » — elle commande, elle ne mémorise rien. */}
              {jours.length > 0 && (
                <div className="flex min-w-56 flex-col gap-1">
                  <label id="jours-planning-libelle" htmlFor="jours-planning" className="text-base font-semibold">
                    {LIBELLE_PAR_JOUR}
                  </label>
                  <ListeDeroulante
                    id="jours-planning"
                    libelleId="jours-planning-libelle"
                    libelle={LIBELLE_PAR_JOUR}
                    valeur={CHOIX_JOUR_VIDE.valeur}
                    entrees={entreesJours(jours)}
                    onChoisir={(v) => {
                      const jour = jours.find((j) => String(j.jour) === v);
                      if (jour) setSelection((s) => basculerJour(s, jour));
                    }}
                    className="min-h-12 w-full rounded-xl border-2 border-bordure/70 bg-surface px-3 text-base font-semibold text-texte shadow-carte"
                  />
                </div>
              )}
            </div>
            {(repliees.length > 0 || sansCase) && (
              <p className="text-base text-texte-secondaire">{[texteRepliees(repliees, selection), sansCase].filter(Boolean).join(" ")}</p>
            )}
            {repliees.length > 0 && (
              <Bouton
                type="button"
                variante="secondaire"
                taille="petite"
                className="w-full sm:w-auto sm:self-start"
                disabled={enCours}
                onClick={() => {
                  setDeplie(true);
                  setSelection((s) => ajouter(s, selectionnables.map((l) => l.id)));
                }}
              >
                <Icone nom="chevronBas" />
                {libelleAfficherEtSelectionnerPlanning(selectionnables.length)}
              </Bouton>
            )}
            {!montrerBarre && <p className="text-base text-texte-secondaire">{INVITE_PLANNING}</p>}
          </>
        )}
      </div>

      {/* La barre n'existe qu'avec une sélection — celle de l'onglet Séances, classe pour classe.
          **Elle n'est pas collante** : dépliée sur « Régler une partie » (cinq listes), elle dépassait
          la hauteur d'un écran, et la barre « Appliquer les modifications », collée en bas, en
          recouvrait la fin sans qu'on puisse la faire défiler. Une seule barre collée par écran. */}
      {montrerBarre && (
        <div
          role="group"
          aria-label="Agir sur plusieurs séances à la fois"
          className="relative z-[2] mt-2 flex flex-col gap-2 rounded-xl border-2 border-primaire bg-surface px-3 py-2 shadow-carte"
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-semibold">{compteurAnnonce}</span>
            <Bouton variante="discret" taille="petite" disabled={enCours} onClick={() => setSelection(new Set())} className="ml-auto">
              <Icone nom="croix" taille={16} />
              Annuler la sélection
            </Bouton>
          </div>
          {horsAffichage ? <p className="text-sm text-texte-secondaire">{horsAffichage}</p> : null}

          <ChoixGeste
            id="geste-planning-en-masse"
            gestes={applicables}
            valeur={geste}
            onChoisir={(v) => {
              setGesteChoisi(gesteRetenu(v as GestePlanning | "", applicables));
              setMessage(null);
            }}
            explication={geste === "" ? null : expliquerGestePlanning(geste, lot, plan, partie)}
            bouton={geste === "" ? "Appliquer" : libelleBoutonPlanning(geste, nombreBouton, partie)}
            variante={varianteGeste(false)}
            inerte={inerte}
            enCours={enCours}
            onLancer={lancer}
          >
            {geste === "regler" && (
              <div className="flex flex-col gap-3">
                <Liste
                  id="partie-planning-en-masse"
                  libelle="Partie à régler"
                  valeur={partie}
                  entrees={[{ valeur: "", libelle: "Choisir une partie…" }, ...parties.map((p) => ({ valeur: p.libelle, libelle: libellePartieProposee(p) }))]}
                  onChoisir={(v) => {
                    setPartieChoisie(v);
                    setMessage(null);
                  }}
                />
                {partie && (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Liste
                      id="instructeur-planning-en-masse"
                      libelle="Instructeur"
                      valeur={instructeur}
                      entrees={entreesInstructeur}
                      onChoisir={(v) => {
                        setInstructeur(v);
                        // Le second ne peut pas être la personne qui mène : on libère la place.
                        if (v !== NE_PAS_CHANGER && v === second) setSecond(NE_PAS_CHANGER);
                      }}
                    />
                    <Liste id="second-planning-en-masse" libelle="Second instructeur" valeur={second} entrees={entreesSecond} onChoisir={setSecond} />
                    <div className="flex flex-col gap-2">
                      <Liste
                        id="theme-planning-en-masse"
                        libelle="Thème"
                        valeur={themeChoix}
                        entrees={entreesTheme}
                        onChoisir={setThemeChoix}
                        aide="Le thème est publié sur les pages de partage et, si le club l'a ouverte, par l'API publique."
                      />
                      {themeChoix === AUTRE && (
                        <Champ
                          label="Thème libre"
                          name="themeLibre"
                          id="theme-libre-planning-en-masse"
                          value={themeLibre}
                          maxLength={THEME_MAX}
                          onChange={(e) => setThemeLibre(e.target.value)}
                        />
                      )}
                    </div>
                    <Liste id="niveau-planning-en-masse" libelle="Niveau" valeur={niveau} entrees={entreesNiveau} onChoisir={setNiveau} />
                    <div className="flex flex-col gap-2 sm:col-span-2">
                      <Liste id="description-planning-en-masse" libelle="Description" valeur={descriptionChoix} entrees={entreesDescription} onChoisir={setDescriptionChoix} />
                      {descriptionChoix === ECRIRE && (
                        <ZoneTexte
                          label="Nouvelle description"
                          name="description"
                          id="description-texte-planning-en-masse"
                          value={descriptionTexte}
                          maxLength={PARTIE_DESCRIPTION_MAX}
                          onChange={(e) => setDescriptionTexte(e.target.value)}
                          aide={`La même pour chaque séance. Elle est publiée sur les pages de partage et, si le club l'a ouverte, par l'API publique — visibles hors du club. ${PARTIE_DESCRIPTION_MAX} signes au plus.`}
                        />
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </ChoixGeste>
        </div>
      )}

      {/* Région vivante permanente : montée avant le premier appui, sans quoi elle serait muette. */}
      <p className="sr-only" aria-live="polite">
        {actif ? [compteurAnnonce, horsAffichage].filter(Boolean).join(" ") : ""}
      </p>
      <p className="min-h-6 text-base" aria-live="polite">
        {message ? <span className={message.type === "ok" ? "font-semibold text-vert" : "font-semibold text-rouge"}>{message.texte}</span> : null}
      </p>

      <div className="grid grid-cols-1 items-start gap-3">
        {visibles}
        <SeancesRepliees cachees={cachees} restantes={restantes} tout={deplie} onBasculer={setDeplie} />
      </div>
    </Selection.Provider>
  );
}

/** Une liste du réglage : son intitulé visible au-dessus, et la liste déroulante du dépôt. */
function Liste({ id, libelle, valeur, entrees, onChoisir, aide }: { id: string; libelle: string; valeur: string; entrees: EntreeListe[]; onChoisir: (v: string) => void; aide?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label id={`${id}-libelle`} htmlFor={id} className="text-base font-semibold">
        {libelle}
      </label>
      <ListeDeroulante
        id={id}
        libelleId={`${id}-libelle`}
        libelle={libelle}
        valeur={valeur}
        entrees={entrees}
        onChoisir={onChoisir}
        decritPar={aide ? `${id}-aide` : undefined}
        className="min-h-12 w-full rounded-xl border-2 border-bordure/70 bg-surface px-3 text-base font-semibold text-texte shadow-carte"
      />
      {aide && (
        <p id={`${id}-aide`} className="text-sm text-texte-secondaire">
          {aide}
        </p>
      )}
    </div>
  );
}

/**
 * La case d'une carte du planning. Elle ne se rend que dans une `SelectionPlanning` dont
 * l'interrupteur est allumé : ailleurs — lecture seule, ou modification sans sélection multiple —, la
 * carte garde exactement son allure. 48 × 48 px de cible et une case de 24 px.
 */
export function CaseSeancePlanning({ id, jour }: { id: string; jour: string }) {
  const contexte = useContext(Selection);
  if (!contexte || !contexte.actif) return null;
  return (
    <label className="-my-2 -ml-2 inline-flex min-h-12 min-w-12 shrink-0 cursor-pointer items-center justify-center">
      <span className="sr-only">Sélectionner la séance du {jour}</span>
      <input type="checkbox" checked={contexte.selection.has(id)} onChange={() => contexte.basculer(id)} className="size-6 accent-primaire" />
    </label>
  );
}
