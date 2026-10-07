"use client";

import { useActionState, useEffect, useRef, useState, useTransition, type FormEvent, type ReactNode, type RefObject } from "react";
import { Alerte } from "@/components/ui/Alerte";
import { Bouton } from "@/components/ui/Bouton";
import { Champ } from "@/components/ui/Champ";
import { ChampListe } from "@/components/ui/ChampListe";
import { ZoneTexte } from "@/components/ui/ZoneTexte";
import { SansReponse, useAttenteSurveillee } from "@/components/ui/attente-surveillee";
import { formatDateCourte, formatHeure } from "@/lib/dates";
import { LIBELLE_VIDE } from "@/lib/constants";
import { FORM_INITIAL, type FormState } from "@/lib/form";
import {
  erreursAffichees,
  erreursEtape,
  ETAPES_ATELIER,
  libelleProgression,
  NB_ETAPES_ATELIER,
  PLAFONDS_ATELIER,
  premiereEtapeFautive,
  premiereEtapeIncomplete,
  type ChampAtelier,
  type SaisieAtelier,
} from "./assistant-atelier";

type Seance = { id: string; date: string; heureDebut: string; lieu: string };
type Personne = { id: string; prenom: string; nom: string };

const nomComplet = (p: Personne) => `${p.prenom} ${p.nom}`.trim();

/**
 * **Proposer un atelier, une question par écran** — la forme téléphone de `FormulaireAtelier`.
 *
 * Un seul `<form>`, les mêmes champs, la même action : les quatre étapes sont quatre `<fieldset>`
 * dont un seul est montré, les autres restent dans le DOM avec leurs valeurs. Les champs sont
 * **pilotés** (aucune valeur ne vient du serveur : c'est une proposition neuve), et l'envoi passe par
 * `onSubmit` plutôt que par `action=` : React n'a donc aucun formulaire à réinitialiser derrière
 * nous, et une étape refusée par le serveur se retrouve telle qu'on l'avait laissée.
 *
 * « Qui anime » est un choix en **vrais boutons radio** portant le nom du champ : c'est la case cochée
 * qui part dans le `FormData`, comme partait la liste du formulaire d'ordinateur. Le second animateur
 * et la séance souhaitée passent par la liste du dépôt.
 */
export function AssistantAtelier({
  action,
  seances,
  animateurs,
  moi,
  onQuitter,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  seances: Seance[];
  /** Tous les comptes actifs du club, triés par prénom (`animateursPossibles`). */
  animateurs: Personne[];
  /** La personne qui propose : le premier choix de « Qui anime ? ». */
  moi: Personne;
  /** « ‹ Retour » à la première étape : on revient à « Mes propositions ». */
  onQuitter: () => void;
}) {
  const [etat, envoyer, envoiEnCours] = useActionState(action, FORM_INITIAL);
  const [, demarrer] = useTransition();
  const [etape, setEtape] = useState(1);
  const [saisie, setSaisie] = useState<SaisieAtelier>({
    titre: "",
    description: "",
    animateurId: moi.id,
    animateurSecondId: "",
    materiel: "",
    sessionId: "",
  });
  // « Moi » ou « Quelqu'un d'autre… », et la personne retenue dans ce second cas : revenir à « Moi »
  // ne l'oublie pas.
  const [animePar, setAnimePar] = useState<"moi" | "autre">("moi");
  const [autre, setAutre] = useState("");
  const [erreursLocales, setErreursLocales] = useState<Partial<Record<ChampAtelier, string>>>({});
  // Les champs retouchés depuis la dernière réponse du serveur : son refus ne s'y lit plus (`erreursAffichees`).
  const [corriges, setCorriges] = useState<ReadonlySet<ChampAtelier>>(() => new Set());
  const corriger = (...champs: ChampAtelier[]) =>
    setCorriges((avant) => (champs.every((c) => avant.has(c)) ? avant : new Set([...avant, ...champs])));
  const silence = useAttenteSurveillee(envoiEnCours);

  /*
   * **Un refus du serveur ramène à l'étape du champ fautif.** Même patron que le miroir de
   * `ChampListe` : l'état suit la dernière réponse reçue, au rendu, sans effet en cascade. Une erreur
   * sans champ (une panne, un refus général) laisse l'assistant là où il est, sur la dernière étape.
   */
  const [etatVu, setEtatVu] = useState(etat);
  if (etatVu !== etat) {
    setEtatVu(etat);
    setCorriges(new Set());
    const fautive = premiereEtapeFautive(etat.erreurs);
    if (fautive) setEtape(fautive);
  }
  const erreurs = erreursAffichees(etat.erreurs, erreursLocales, corriges);

  // Chaque étape s'annonce : le focus va sur sa question, et l'écran remonte en haut.
  const question = useRef<HTMLLegendElement | null>(null);
  const premierRendu = useRef(true);
  useEffect(() => {
    if (premierRendu.current) {
      premierRendu.current = false;
      return;
    }
    question.current?.focus();
    question.current?.scrollIntoView({ block: "center" });
  }, [etape]);

  const changer = (champ: ChampAtelier, valeur: string) => {
    setSaisie((s) => ({ ...s, [champ]: valeur }));
    corriger(champ);
    if (erreursLocales[champ]) setErreursLocales((e) => ({ ...e, [champ]: undefined }));
  };

  /** Qui anime change : le second ne peut pas être la même personne, il revient à « Personne ». */
  const changerAnimateur = (id: string) => {
    setSaisie((s) => ({ ...s, animateurId: id, animateurSecondId: s.animateurSecondId === id ? "" : s.animateurSecondId }));
    // Les deux vont ensemble : un refus « le second doit être une autre personne » se corrige aussi ici.
    corriger("animateurId", "animateurSecondId");
  };

  const suivant = () => {
    const refus = erreursEtape(etape, saisie);
    setErreursLocales(refus);
    if (Object.keys(refus).length === 0) setEtape((e) => Math.min(NB_ETAPES_ATELIER, e + 1));
  };

  const retour = () => {
    setErreursLocales({});
    if (etape === 1) onQuitter();
    else setEtape((e) => e - 1);
  };

  const soumettre = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (envoiEnCours) return;
    // Entrée dans un champ d'une étape intermédiaire : c'est « Suivant », pas l'envoi.
    if (etape < NB_ETAPES_ATELIER) return suivant();
    const incomplete = premiereEtapeIncomplete(saisie);
    if (incomplete) {
      setErreursLocales(erreursEtape(incomplete, saisie));
      setEtape(incomplete);
      return;
    }
    const fd = new FormData(e.currentTarget);
    demarrer(() => envoyer(fd));
  };

  const personnes = animateurs.map((p) => ({ valeur: p.id, libelle: nomComplet(p) }));
  const autres = personnes.filter((p) => p.valeur !== moi.id);
  const seconds = [{ valeur: "", libelle: "Personne" }, ...personnes.filter((p) => p.valeur !== saisie.animateurId)];
  const choixSeances = [
    { valeur: "", libelle: "Pas de préférence" },
    ...seances.map((s) => ({ valeur: s.id, libelle: `${formatDateCourte(s.date)}\u00a0· ${formatHeure(s.heureDebut)}\u00a0· ${s.lieu}` })),
  ];
  const derniere = etape === NB_ETAPES_ATELIER;

  return (
    <form onSubmit={soumettre} noValidate className="flex flex-col gap-5" aria-label="Proposer un atelier" data-assistant-atelier>
      <div className="flex flex-col gap-2">
        <p className="text-base font-semibold text-texte-secondaire" aria-live="polite">
          {libelleProgression(etape)}
        </p>
        {/* La barre dit la même chose que la phrase au-dessus : décorative pour un lecteur d'écran. */}
        <div className="flex gap-1.5" aria-hidden="true">
          {ETAPES_ATELIER.map((e, i) => (
            <span key={e.titre} className={`h-2 flex-1 rounded-full ${i < etape ? "bg-primaire" : "bg-bordure"}`} />
          ))}
        </div>
      </div>

      {etat.erreur && <Alerte type="erreur">{etat.erreur}</Alerte>}

      <Etape numero={1} courante={etape} question={question}>
        <Champ
          label="Titre"
          name="titre"
          id="assistant-titre"
          value={saisie.titre}
          onChange={(e) => changer("titre", e.target.value)}
          maxLength={PLAFONDS_ATELIER.titre}
          placeholder="ex. Échauffement à la corde"
          erreur={erreurs.titre}
        />
        <ZoneTexte
          label="En quelques mots"
          name="description"
          id="assistant-description"
          value={saisie.description}
          onChange={(e) => changer("description", e.target.value)}
          maxLength={PLAFONDS_ATELIER.description}
          rows={4}
          placeholder="Ce que tu proposes, comment ça se passe…"
          aide="Un titre ou quelques mots suffisent."
          erreur={erreurs.description}
        />
      </Etape>

      <Etape numero={2} courante={etape} question={question}>
        <div role="radiogroup" aria-label="Qui anime ?" className="flex flex-col gap-2">
          <GrosChoix name="animateurId" value={moi.id} checked={animePar === "moi"} onChange={() => {
              setAnimePar("moi");
              changerAnimateur(moi.id);
            }}>
            Moi ({nomComplet(moi)})
          </GrosChoix>
          {/* La valeur de ce bouton est la personne choisie dans la liste : c'est lui qui part, coché. */}
          <GrosChoix name="animateurId" value={autre} checked={animePar === "autre"} onChange={() => {
              setAnimePar("autre");
              changerAnimateur(autre);
            }}>
            Quelqu&apos;un d&apos;autre…
          </GrosChoix>
        </div>
        {animePar === "autre" && (
          <ChampListe
            label="Qui anime ?"
            id="assistant-animateur-autre"
            valeur={autre}
            entrees={[{ valeur: "", libelle: LIBELLE_VIDE }, ...autres]}
            onChange={(v) => {
              setAutre(v);
              changerAnimateur(v);
              if (erreursLocales.animateurId) setErreursLocales((e) => ({ ...e, animateurId: undefined }));
            }}
            erreur={erreurs.animateurId}
          />
        )}
        {animePar === "moi" && erreurs.animateurId && <p className="text-base font-semibold text-rouge" role="alert">{erreurs.animateurId}</p>}

        {/* **Les personnes se choisissent dans la liste, jamais en puces** : tout l'annuaire en boutons
            remplissait l'écran du téléphone pour un champ facultatif. Les puces restent pour les
            choix courts (la séance souhaitée). */}
        <ChampListe
          label="Second animateur (facultatif)"
          name="animateurSecondId"
          id="assistant-second"
          valeur={saisie.animateurSecondId}
          entrees={[{ valeur: "", libelle: LIBELLE_VIDE }, ...seconds.slice(1)]}
          onChange={(v) => changer("animateurSecondId", v)}
          erreur={erreurs.animateurSecondId}
        />
      </Etape>

      <Etape numero={3} courante={etape} question={question}>
        <Champ
          label="Équipement nécessaire (facultatif)"
          name="materiel"
          id="assistant-materiel"
          value={saisie.materiel}
          onChange={(e) => changer("materiel", e.target.value)}
          maxLength={PLAFONDS_ATELIER.materiel}
          placeholder="ex. masques, gants, cordes à sauter"
          aide="Laisse vide s'il ne faut rien de particulier."
          erreur={erreurs.materiel}
        />
      </Etape>

      <Etape numero={4} courante={etape} question={question}>
        {/* **La séance souhaitée se choisit dans la liste**, comme les personnes : une rangée de
            dates en puces remplissait l'écran pour un choix facultatif. */}
        <ChampListe
          label="Séance souhaitée (facultatif)"
          name="sessionId"
          id="assistant-seance"
          valeur={saisie.sessionId}
          entrees={choixSeances}
          onChange={(v) => changer("sessionId", v)}
          erreur={erreurs.sessionId}
        />
      </Etape>

      <div className="flex gap-3">
        <Bouton type="button" variante="secondaire" className="flex-1" onClick={retour} disabled={envoiEnCours}>
          ‹ Retour
        </Bouton>
        {/* « Envoyer » seul à l'écran, « Envoyer ma proposition » pour le lecteur d'écran : le libellé
            entier passait sur deux lignes à 390 px, à côté de « ‹ Retour ». Le nom accessible
            commence par le mot affiché, la commande vocale le retrouve. */}
        <Bouton
          type="submit"
          className="flex-[2] whitespace-nowrap"
          disabled={envoiEnCours}
          aria-busy={envoiEnCours}
          aria-label={derniere && !envoiEnCours ? "Envoyer ma proposition" : undefined}
        >
          {envoiEnCours ? "Envoi…" : derniere ? "Envoyer" : "Suivant"}
        </Bouton>
      </div>
      {silence && <SansReponse />}
      {!derniere && (
        <p className="text-base text-texte-secondaire">
          Ensuite : {ETAPES_ATELIER.slice(etape).map((e) => e.titre.replace(/ \?$/, "").toLowerCase()).join(", ")}.
        </p>
      )}
    </form>
  );
}

/**
 * Une étape : un `<fieldset>` dont la légende est la question. **Caché, il reste dans le formulaire**
 * (`hidden` ne retire rien du `FormData`) : c'est ce qui permet un seul envoi pour quatre écrans.
 */
function Etape({
  numero,
  courante,
  question,
  children,
}: {
  numero: number;
  courante: number;
  question: RefObject<HTMLLegendElement | null>;
  children: ReactNode;
}) {
  const active = numero === courante;
  return (
    <fieldset hidden={!active} className="flex min-w-0 flex-col gap-4" data-etape={numero}>
      <legend ref={active ? question : undefined} tabIndex={-1} className="mb-4 font-titre text-2xl">
        {ETAPES_ATELIER[numero - 1].question}
      </legend>
      {children}
    </fieldset>
  );
}

/** Un gros choix exclusif : un vrai bouton radio, habillé en carte de toute la largeur. */
function GrosChoix({ name, value, checked, onChange, children }: { name: string; value: string; checked: boolean; onChange: () => void; children: ReactNode }) {
  return (
    <label className="flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border-2 border-bordure bg-surface px-4 text-[1.0625rem] font-semibold text-texte shadow-carte has-[:checked]:border-primaire has-[:checked]:bg-primaire-doux">
      <input type="radio" name={name} value={value} checked={checked} onChange={onChange} className="size-5 shrink-0 accent-primaire" />
      <span>{children}</span>
    </label>
  );
}
