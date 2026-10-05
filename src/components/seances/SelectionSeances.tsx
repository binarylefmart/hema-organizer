"use client";

import { createContext, useContext, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { appliquerGesteSeancesEnMasse } from "@/actions/seances";
import type { Lieu } from "@/lib/lieux";
import { Bouton } from "@/components/ui/Bouton";
import { Champ } from "@/components/ui/Champ";
import { ChoixGeste } from "@/components/ui/ChoixGeste";
import { Icone } from "@/components/ui/Icone";
import { ListeDeroulante } from "@/components/ui/ListeDeroulante";
import { gesteRetenu, varianteGeste } from "@/components/ui/choix-geste";
import {
  ajouter,
  barreDeMasseVisible,
  basculer,
  compterHorsAffichage,
  etatToutCocher,
  lignesSelectionnees,
  restreindre,
  retirer,
  selectionApresInterrupteur,
  texteHorsAffichage,
  texteRepliees,
} from "@/components/ui/selection";
import { InterrupteurSelection } from "@/components/ui/InterrupteurSelection";
import { CartesDevoilees } from "./ListeSeances";
import { useDevoilement } from "./ListeRepliee";
import { SEANCES_VISIBLES } from "./listes";
import {
  ciblesGeste,
  compteurSeances,
  confirmationSeances,
  expliquerGesteSeances,
  gesteSeancesDefinitif,
  gestesSeancesApplicables,
  INVITE_SEANCES,
  libelleAfficherEtSelectionner,
  libelleBoutonSeances,
  libelleToutesSeances,
  MOTS_SEANCES,
  reglageManquant,
  seancesQuiChangent,
  texteSansCaseSeances,
  type GesteSeances,
  type LigneSeance,
  type ReglageSeances,
} from "./selection-seances";

/**
 * **Cocher plusieurs séances, puis agir une seule fois** — l'onglet Séances en mode modification.
 *
 * C'est le geste de l'annuaire (`ZoneSelection`, `/admin/membres`) et des présences
 * (`PresencesEquipe`) : la mécanique vient du module partagé (`src/components/ui/selection.ts` —
 * cocher, case maîtresse à trois états, `barreDeMasseVisible`, `texteInviteMasse`), la forme de la
 * question de `ChoixGeste`, et **la barre est celle de l'annuaire, au pixel près** (même cadre, même
 * compteur, même « Annuler la sélection », collante sous l'en-tête à partir de 640 px). Un bureau qui a
 * appris le geste sur un écran le retrouve ici.
 *
 * **Un interrupteur « Sélection multiple » ouvre les cases** (`InterrupteurSelection`, commun aux
 * trois écrans de masse). Sans lui, les cartes restent ce qu'elles
 * sont en mode modification — chacune son « Que veux-tu faire ? » au pied. Une case par carte posée
 * d'office ajouterait un contrôle de plus devant la date de chaque cours, pour un geste qu'on fait
 * rarement ; l'interrupteur la montre quand on la demande, et la referme (sélection comprise) quand on
 * a fini.
 *
 * **La sélection ne porte que sur ce qui est affiché** : les cartes dépliées du trimestre et de la
 * fenêtre choisis. La case maîtresse le dit (« Sélectionner les 5 séances affichées »), un second
 * bouton déplie et sélectionne le reste, et ce qui est coché puis replié est compté et dit. Une séance
 * qui a quitté la liste (filtre changé, séance effacée) quitte aussi le lot (`restreindre`) : l'écran ne
 * sait plus rien d'elle, il ne peut donc ni l'annoncer ni la compter honnêtement.
 *
 * Le dévoilement (cinq cartes, puis cinq de plus) est tenu **ici** et rendu par `CartesDevoilees` :
 * la case maîtresse doit savoir ce qui est déplié, et deux états pour un même repli se
 * contrediraient.
 */

type Contexte = { actif: boolean; selection: ReadonlySet<string>; basculer: (id: string) => void };

const Selection = createContext<Contexte | null>(null);

/** L'entrée vide des lieux : rien n'est choisi, le bouton reste inerte. */
const LIEU_VIDE = "";
const LIEU_AUTRE = "autre";

export function SelectionSeances({
  cartes,
  lignes,
  lieux,
  peutSupprimer,
}: {
  /** Les cartes rendues par le serveur, dans l'ordre de la liste. */
  cartes: ReactNode[];
  /**
   * La ligne cochable de chaque carte, **dans le même ordre** — `null` pour une séance d'un trimestre
   * clos, qui n'a pas de case (`texteSansCaseSeances`).
   */
  lignes: (LigneSeance | null)[];
  /** Les lieux habituels du club (`getLieux`), pour « Changer le lieu ». */
  lieux: Lieu[];
  /** `periods.manage` et session forte : sans les deux, « Supprimer » n'est pas proposé. */
  peutSupprimer: boolean;
}) {
  const router = useRouter();
  const devoilement = useDevoilement(cartes.length, { tranche: SEANCES_VISIBLES, debut: SEANCES_VISIBLES });
  const [actif, setActif] = useState(false);
  const [brute, setSelection] = useState<ReadonlySet<string>>(() => new Set());
  const [gesteChoisi, setGesteChoisi] = useState<GesteSeances | "">("");
  const [motif, setMotif] = useState("");
  const [choixLieu, setChoixLieu] = useState(lieux.length > 0 ? LIEU_VIDE : LIEU_AUTRE);
  const [lieuLibre, setLieuLibre] = useState({ lieu: "", adresse: "" });
  const [horaire, setHoraire] = useState({ heureDebut: "", heureFin: "" });
  const [message, setMessage] = useState<{ type: "ok" | "erreur"; texte: string } | null>(null);
  const [enCours, demarrer] = useTransition();
  const caseMaitresse = useRef<HTMLInputElement>(null);

  const selectionnables = lignes.filter((l): l is LigneSeance => l !== null);
  // Ce qui a quitté la liste quitte le lot : voir l'en-tête.
  const selection = restreindre(brute, selectionnables);
  const affichees = lignes.slice(0, devoilement.affichees).filter((l): l is LigneSeance => l !== null);
  const repliees = lignes.slice(devoilement.affichees).filter((l): l is LigneSeance => l !== null);
  const idsAffiches = affichees.map((l) => l.id);
  const etatCases = etatToutCocher(affichees, selection);
  const lot = lignesSelectionnees(selectionnables, selection);

  useEffect(() => {
    if (caseMaitresse.current) caseMaitresse.current.indeterminate = etatCases === "partielle";
  }, [etatCases]);

  const applicables = gestesSeancesApplicables(lot, { supprimer: peutSupprimer });
  const geste = gesteRetenu(gesteChoisi, applicables);
  useEffect(() => {
    if (geste !== gesteChoisi) setGesteChoisi("");
  }, [geste, gesteChoisi]);

  const lieuChoisi = lieux.find((l) => l.cle === choixLieu);
  const reglage: ReglageSeances = {
    motif,
    lieu: lieuChoisi ? lieuChoisi.lieu : choixLieu === LIEU_AUTRE ? lieuLibre.lieu.trim() : "",
    adresse: lieuChoisi ? lieuChoisi.adresse : choixLieu === LIEU_AUTRE ? lieuLibre.adresse.trim() : "",
    heureDebut: horaire.heureDebut,
    heureFin: horaire.heureFin,
  };
  const touchees = geste === "" ? [] : seancesQuiChangent(geste, lot, reglage);
  const inerte = geste === "" || reglageManquant(geste, lot, reglage);

  const remettreAZero = () => {
    setGesteChoisi("");
    setMotif("");
    setChoixLieu(lieux.length > 0 ? LIEU_VIDE : LIEU_AUTRE);
    setLieuLibre({ lieu: "", adresse: "" });
    setHoraire({ heureDebut: "", heureFin: "" });
  };

  const lancer = () => {
    if (geste === "" || inerte) return;
    if (!window.confirm(confirmationSeances(geste, lot, reglage))) return;
    // Les séances que le geste touche, et elles seules : une séance déjà annulée du lot n'est pas
    // envoyée à l'annulation. Le serveur refait le tri de son côté, avec ses propres gardes.
    const sessionIds = ciblesGeste(geste, lot).map((l) => l.id);
    const entree =
      geste === "annuler"
        ? { geste, sessionIds, motif: motif.trim() }
        : geste === "lieu"
          ? { geste, sessionIds, lieu: reglage.lieu, adresse: reglage.adresse }
          : geste === "horaire"
            ? { geste, sessionIds, heureDebut: horaire.heureDebut, heureFin: horaire.heureFin }
            : { geste, sessionIds };
    setMessage(null);
    demarrer(async () => {
      try {
        const res = await appliquerGesteSeancesEnMasse(entree);
        if (res.erreur) {
          setMessage({ type: "erreur", texte: res.erreur });
          return;
        }
        setMessage({ type: "ok", texte: res.succes ?? "C'est fait." });
        setSelection(new Set());
        remettreAZero();
        router.refresh();
      } catch (e) {
        const texte = e instanceof Error ? e.message : "";
        // `exigerReauth` redirige vers la vérification du code : la redirection lève ici, et le
        // routeur s'en charge — même précaution que l'annuaire.
        if (texte.includes("NEXT_REDIRECT")) return;
        setMessage({ type: "erreur", texte: texte || "Le geste n'a pas abouti — vérifie ta connexion." });
      }
    });
  };

  const compteurAnnonce = compteurSeances(selection.size);
  const horsAffichage = texteHorsAffichage(compterHorsAffichage(selection, affichees), MOTS_SEANCES);
  const sansCase = texteSansCaseSeances(lignes.length - selectionnables.length);
  const montrerBarre = actif && barreDeMasseVisible(selection);

  return (
    <Selection.Provider value={{ actif, selection, basculer: (id) => setSelection((s) => basculer(s, id)) }}>
      <div className="flex flex-col gap-1">
        {/* **L'interrupteur « Sélection multiple »**, commun aux écrans de masse : éteint, ni case
            ni barre ; l'éteindre vide le lot (`selectionApresInterrupteur`). */}
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
            {/* La case maîtresse : 48 px et une case de 24 px, comme à l'annuaire et aux présences. */}
            <label className="inline-flex min-h-12 w-fit cursor-pointer items-center gap-2 font-semibold">
              <input
                ref={caseMaitresse}
                type="checkbox"
                checked={etatCases === "toutes"}
                disabled={affichees.length === 0}
                onChange={() => setSelection((s) => (etatCases === "toutes" ? retirer(s, idsAffiches) : ajouter(s, idsAffiches)))}
                className="size-6 accent-primaire"
              />
              {/* Le libellé **nomme ce sur quoi la case agit**, jamais « Tout ». */}
              {libelleToutesSeances(affichees.length)}
            </label>
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
                  devoilement.toutDevoiler();
                  setSelection((s) => ajouter(s, selectionnables.map((l) => l.id)));
                }}
              >
                <Icone nom="chevronBas" />
                {libelleAfficherEtSelectionner(selectionnables.length)}
              </Bouton>
            )}
            {/* **Ce que les cases permettent, en une ligne à côté d'elles** — même place et même
                forme qu'à l'annuaire (`texteInviteMasse`). Elle s'efface dès qu'une case est cochée. */}
            {!montrerBarre && <p className="text-base text-texte-secondaire">{INVITE_SEANCES}</p>}
          </>
        )}
      </div>

      {/* **La barre n'existe qu'avec une sélection** (`barreDeMasseVisible`, partagée avec l'annuaire
          et les présences) — et c'est **celle de l'annuaire**, classe pour classe : collante sous
          l'en-tête à partir de 640 px seulement (en dessous, elle recouvrirait les cartes qu'on coche). */}
      {montrerBarre && (
        <div
          role="group"
          aria-label="Agir sur plusieurs séances à la fois"
          className="relative z-[2] mt-2 flex flex-col gap-2 rounded-xl border-2 border-primaire bg-surface px-3 py-2 shadow-carte sm:sticky sm:top-20"
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
            id="geste-seances-en-masse"
            gestes={applicables}
            valeur={geste}
            onChoisir={(v) => {
              setGesteChoisi(gesteRetenu(v as GesteSeances | "", applicables));
              setMessage(null);
            }}
            explication={geste === "" ? null : expliquerGesteSeances(geste, lot, reglage)}
            bouton={geste === "" ? "Appliquer" : libelleBoutonSeances(geste, touchees.length)}
            variante={geste === "" ? "primaire" : varianteGeste(gesteSeancesDefinitif(geste))}
            inerte={inerte}
            enCours={enCours}
            onLancer={lancer}
          >
            {geste === "annuler" && (
              <Champ
                label="Motif (envoyé aux membres)"
                name="motif"
                id="motif-seances-en-masse"
                value={motif}
                onChange={(e) => setMotif(e.target.value)}
                required
                maxLength={200}
                placeholder="ex. Salle indisponible"
                aide="Le même motif pour chaque séance. Il est visible par tous, y compris sur le lien de partage : évite les noms."
              />
            )}
            {geste === "lieu" && (
              <div className="flex flex-col gap-3">
                {lieux.length > 0 && (
                  <div className="flex flex-col gap-1">
                    <label id="lieu-seances-en-masse-libelle" htmlFor="lieu-seances-en-masse" className="text-base font-semibold">
                      Nouveau lieu
                    </label>
                    <ListeDeroulante
                      id="lieu-seances-en-masse"
                      libelleId="lieu-seances-en-masse-libelle"
                      libelle="Nouveau lieu"
                      valeur={choixLieu}
                      entrees={[
                        { valeur: LIEU_VIDE, libelle: "Choisir un lieu…" },
                        ...lieux.map((l) => ({ valeur: l.cle, libelle: l.lieu })),
                        { valeur: LIEU_AUTRE, libelle: "Autre lieu…" },
                      ]}
                      onChoisir={setChoixLieu}
                      className="min-h-12 w-full rounded-xl border-2 border-bordure/70 bg-surface px-3 text-base font-semibold text-texte shadow-carte"
                    />
                    {lieuChoisi && <p className="text-sm text-texte-secondaire">{lieuChoisi.adresse}</p>}
                  </div>
                )}
                {choixLieu === LIEU_AUTRE && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Champ
                      label="Nom du lieu"
                      name="lieu"
                      id="lieu-libre-seances-en-masse"
                      value={lieuLibre.lieu}
                      onChange={(e) => setLieuLibre({ ...lieuLibre, lieu: e.target.value })}
                      required
                      maxLength={120}
                      placeholder="ex. Gymnase municipal"
                    />
                    <Champ
                      label="Adresse (pour la carte)"
                      name="adresse"
                      id="adresse-libre-seances-en-masse"
                      value={lieuLibre.adresse}
                      onChange={(e) => setLieuLibre({ ...lieuLibre, adresse: e.target.value })}
                      maxLength={200}
                      placeholder="ex. 1 rue du Stade, code postal et ville"
                    />
                  </div>
                )}
              </div>
            )}
            {geste === "horaire" && (
              <div className="grid grid-cols-2 gap-3">
                <Champ
                  label="Début"
                  name="heureDebut"
                  id="debut-seances-en-masse"
                  type="time"
                  value={horaire.heureDebut}
                  onChange={(e) => setHoraire({ ...horaire, heureDebut: e.target.value })}
                  required
                />
                <Champ
                  label="Fin"
                  name="heureFin"
                  id="fin-seances-en-masse"
                  type="time"
                  value={horaire.heureFin}
                  onChange={(e) => setHoraire({ ...horaire, heureFin: e.target.value })}
                  required
                  erreur={horaire.heureDebut && horaire.heureFin && horaire.heureFin <= horaire.heureDebut ? "La fin doit suivre le début." : undefined}
                />
              </div>
            )}
          </ChoixGeste>
        </div>
      )}

      {/* Région vivante permanente : montée avant le premier appui, sans quoi il serait muet. */}
      <p className="sr-only" aria-live="polite">
        {actif ? [compteurAnnonce, horsAffichage].filter(Boolean).join(" ") : ""}
      </p>
      <p className="min-h-6 text-base" aria-live="polite">
        {message ? <span className={message.type === "ok" ? "font-semibold text-vert" : "font-semibold text-rouge"}>{message.texte}</span> : null}
      </p>

      <CartesDevoilees cartes={cartes} visibles={SEANCES_VISIBLES} devoilement={devoilement} />
    </Selection.Provider>
  );
}

/**
 * La case d'une carte. Elle ne se rend que dans une `SelectionSeances` dont l'interrupteur est
 * ouvert : ailleurs — lecture seule, ou mode modification sans sélection multiple —, la carte garde
 * exactement son allure.
 *
 * 48 × 48 px de cible et une case de 24 px, comme les cases de l'annuaire (`CaseMembre`) : la rater
 * de trois millimètres ne doit pas ouvrir autre chose.
 */
export function CaseSeance({ id, jour }: { id: string; jour: string }) {
  const contexte = useContext(Selection);
  if (!contexte || !contexte.actif) return null;
  return (
    <label className="-my-2 -ml-2 inline-flex min-h-12 min-w-12 shrink-0 cursor-pointer items-center justify-center">
      <span className="sr-only">Sélectionner la séance du {jour}</span>
      <input type="checkbox" checked={contexte.selection.has(id)} onChange={() => contexte.basculer(id)} className="size-6 accent-primaire" />
    </label>
  );
}
