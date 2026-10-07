"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, type PointerEvent as EvenementPointeur, type ReactNode } from "react";
import { deplacerElement, retirerPartie } from "@/actions/planning";
import { enParallele, nomElement, nomPartie, partiesNommees } from "@/lib/constants";
import type { CasePlanning } from "@/lib/planning";
import { Bouton } from "@/components/ui/Bouton";
import { Icone } from "@/components/ui/Icone";
import { couleurNature } from "@/components/seances/programme-cours";
import { EcuNature } from "@/components/seances/EcuNature";
import { classesPartie } from "@/components/seances/teintes";
import { CaseEditeur } from "./CaseEditeur";
import { useBrouillon } from "./ContexteBrouillon";
import { useOptionsCase } from "./ContexteOptions";
import { DemoGestes } from "./DemoGestes";
import { confirmationRetrait, grouperParPartie, nombreDeParties } from "./parties-carte";
import { useActionPartie } from "./useActionPartie";
import {
  abonnerMeneuse,
  basUtileEcran,
  cibleDepot,
  clicApresGlisse,
  CLE_DEMO_GESTES,
  decalageGlisse,
  demoAMontrer,
  depotSansEffet,
  directionGeste,
  inscrireListe,
  LARGEUR_RETIRER_PX,
  lireCompteurDemo,
  listeMeneuse,
  prendreEntreeDemo,
  resteRevelee,
  resumeLigne,
  vitesseDefilement,
  type CibleDepot,
  type LigneMesuree,
} from "./gestes-liste";

/** La hauteur de la barre d'onglets du bas du téléphone (`NavBas`), qui couvre le bas de l'écran. */
const HAUTEUR_ONGLETS_PX = 88;

/** Ce qu'un déplacement en cours montre à l'écran : la ligne tenue, son décalage, où elle tombera. */
type Deplacement = { id: string; dy: number; cible: CibleDepot | null; indicateur: number | null };

/** Ce que la poignée retient entre deux mouvements du doigt — hors de React, lu à chaque image. */
type Prise = { id: string; pointeur: number; departY: number; dernierY: number; doigtDansLigne: number; actif: boolean };

/**
 * **Le programme d'une séance en modification, sur un téléphone : une liste qui se règle par gestes.**
 *
 * Sur l'ordinateur, chaque élément montre ses quatre listes déroulantes et ses ↑ ↓ Retirer
 * (`ListeParties`). Sur un téléphone, c'est une page de contrôles à faire défiler pour trouver la
 * ligne qu'on vient corriger. Ici, chaque élément est **une ligne compacte** — son nom, et dessous
 * « Instructeur · Thème » — et trois gestes la font bouger :
 *
 * 1. **toucher la ligne** déplie ses réglages juste en dessous (la même `CaseEditeur`, donc le même
 *    brouillon) ; une seule ligne dépliée à la fois ;
 * 2. **la glisser vers la gauche** révèle « Retirer », qu'il faut **toucher** : un glissé seul
 *    n'efface rien, et le retrait garde sa confirmation et ses refus (`retirerPartie`) ;
 * 3. **tenir la poignée ⋮⋮ et glisser** la déplace, dans sa partie ou dans une autre, ou dans une
 *    nouvelle partie au bas de la carte (`deplacerElement`). Seule la poignée attrape : le reste de la
 *    ligne laisse défiler la page (`touch-action: pan-y`).
 *
 * La démonstration des gestes et « Revoir les gestes » ne sont portés que par **une** carte, la
 * première du planning (`listeMeneuse`) : cinq bulles empilées n'expliqueraient rien de plus.
 *
 * Comme sur l'ordinateur, ajouter, retirer et déplacer partent **sans attendre** « Appliquer les
 * modifications » ; seul le contenu des cases passe par le brouillon.
 */
export function ListePartiesTelephone({
  sessionId,
  parties,
  compact,
  ajout,
  pied,
}: {
  sessionId: string;
  parties: CasePlanning[];
  compact: boolean;
  /** Le menu « Ajouter dans la partie N… », le même que sur l'ordinateur */
  ajout: (bloc: number) => ReactNode;
  /** « Ajouter une partie », le même que sur l'ordinateur */
  pied: ReactNode;
}) {
  const nbParties = nombreDeParties(parties);
  const groupes = grouperParPartie(parties);
  const intitules = partiesNommees(nbParties);

  const [ouverte, setOuverte] = useState<string | null>(null);
  const [revelee, setRevelee] = useState<string | null>(null);
  const [deplacement, setDeplacement] = useState<Deplacement | null>(null);
  const [enAttente, setEnAttente] = useState<string | null>(null);
  const [, lancerDeplacement, erreurDeplacement] = useActionPartie();
  const conteneur = useRef<HTMLDivElement>(null);
  const prise = useRef<Prise | null>(null);
  const derniereCible = useRef<CibleDepot | null>(null);
  const image = useRef<number | null>(null);

  /* ---------------------------------------------------------------- */
  /* La démonstration, portée par la première carte seulement          */
  /* ---------------------------------------------------------------- */

  useEffect(() => inscrireListe(sessionId), [sessionId]);
  const meneuse = useSyncExternalStore(
    abonnerMeneuse,
    () => listeMeneuse() === sessionId,
    () => false,
  );
  const [demo, setDemo] = useState<0 | 1 | 2>(0);
  useEffect(() => {
    // Une entrée en modification compte une fois, même si React rejoue l'effet ou si la meneuse
    // change en cours de route : le drapeau est celui du module (`prendreEntreeDemo`).
    if (!meneuse || !prendreEntreeDemo()) return;
    let dejaVue = 0;
    try {
      dejaVue = lireCompteurDemo(window.localStorage.getItem(CLE_DEMO_GESTES));
    } catch {
      // Stockage indisponible (navigation privée, réglages) : on montre, sans rien retenir.
    }
    if (!demoAMontrer(dejaVue)) return;
    try {
      window.localStorage.setItem(CLE_DEMO_GESTES, String(dejaVue + 1));
    } catch {
      // Idem : la démonstration reviendra, ce qui vaut mieux qu'une explication jamais vue.
    }
    setDemo(1);
  }, [meneuse]);

  /* ---------------------------------------------------------------- */
  /* « Retirer » révélé : toucher ailleurs le referme                  */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    if (!revelee) return;
    const ailleurs = (e: PointerEvent) => {
      const cible = e.target instanceof Element ? e.target : null;
      // La ligne elle-même se referme par son propre geste (toucher, ou glisser à droite).
      if (cible?.closest(`[data-ligne-id="${CSS.escape(revelee)}"]`)) return;
      setRevelee(null);
    };
    const echap = (e: KeyboardEvent) => {
      if (e.key === "Escape") setRevelee(null);
    };
    document.addEventListener("pointerdown", ailleurs, true);
    document.addEventListener("keydown", echap);
    return () => {
      document.removeEventListener("pointerdown", ailleurs, true);
      document.removeEventListener("keydown", echap);
    };
  }, [revelee]);

  /* ---------------------------------------------------------------- */
  /* Déplacer avec la poignée                                          */
  /* ---------------------------------------------------------------- */

  /**
   * **Mesurer, puis peindre.** Les lignes sont relues à chaque image : le défilement automatique, le
   * repli d'une ligne dépliée ou l'apparition de la zone « Nouvelle partie » les déplacent, et une
   * mesure prise au départ serait fausse dès la première. On mesure l'élément `li`, qui ne bouge pas :
   * seul son contenu suit le doigt.
   */
  const mesurer = () => {
    const p = prise.current;
    const racine = conteneur.current;
    if (!p || !racine) return;
    const lignes: LigneMesuree[] = [];
    let hautTenue: number | null = null;
    for (const li of racine.querySelectorAll<HTMLElement>("[data-ligne-id]")) {
      const r = li.getBoundingClientRect();
      const id = li.dataset.ligneId ?? "";
      if (id === p.id) hautTenue = r.top;
      lignes.push({ id, bloc: Number(li.dataset.bloc), haut: r.top, bas: r.bottom });
    }
    const zoneEl = racine.querySelector<HTMLElement>("[data-zone-nouvelle]");
    const rz = zoneEl?.getBoundingClientRect();
    const zone = rz ? { bloc: nbParties + 1, haut: rz.top, bas: rz.bottom } : null;
    const cible = cibleDepot(p.dernierY, lignes, p.id, zone);
    derniereCible.current = cible;
    const dy = hautTenue === null ? 0 : p.dernierY - p.doigtDansLigne - hautTenue;
    // L'indicateur se pose dans le conteneur : sa hauteur se compte depuis le haut de celui-ci.
    const indicateur = cible && !cible.nouvelle ? cible.y - racine.getBoundingClientRect().top : null;
    setDeplacement({ id: p.id, dy, cible, indicateur });
  };

  const arreterDefilement = () => {
    if (image.current !== null) cancelAnimationFrame(image.current);
    image.current = null;
  };

  /** Le défilement automatique : tant que le doigt est près d'un bord, la page avance d'elle-même. */
  const defiler = () => {
    const p = prise.current;
    if (!p?.actif) return;
    const entete = document.querySelector("header.sticky")?.getBoundingClientRect().bottom ?? 0;
    // Le bas utile s'arrête à la plus haute des barres collées en bas (édition, sélection), pas aux onglets.
    const barres = [...document.querySelectorAll<HTMLElement>("[data-barre-basse]")].map((b) => b.getBoundingClientRect().top);
    const v = vitesseDefilement(p.dernierY, Math.max(0, entete), basUtileEcran(window.innerHeight, HAUTEUR_ONGLETS_PX, barres));
    if (v !== 0) {
      window.scrollBy(0, v);
      mesurer();
    }
    image.current = requestAnimationFrame(defiler);
  };

  /** Fin d'un déplacement, lâché ou abandonné : tout revient à sa place. */
  const terminer = () => {
    arreterDefilement();
    prise.current = null;
    derniereCible.current = null;
    setDeplacement(null);
  };

  const prendre = (e: EvenementPointeur<HTMLElement>, partie: CasePlanning) => {
    if (enAttente || prise.current || (e.pointerType === "mouse" && e.button !== 0)) return;
    // Rien ne remonte à la ligne : la poignée ne glisse pas vers « Retirer », elle déplace.
    e.stopPropagation();
    e.preventDefault();
    const li = e.currentTarget.closest<HTMLElement>("[data-ligne-id]");
    if (!li) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    prise.current = {
      id: partie.id,
      pointeur: e.pointerId,
      departY: e.clientY,
      dernierY: e.clientY,
      doigtDansLigne: e.clientY - li.getBoundingClientRect().top,
      actif: false,
    };
  };

  const bouger = (e: EvenementPointeur<HTMLElement>) => {
    const p = prise.current;
    if (!p || p.pointeur !== e.pointerId) return;
    p.dernierY = e.clientY;
    if (!p.actif) {
      if (Math.abs(e.clientY - p.departY) < 4) return;
      p.actif = true;
      setOuverte(null);
      setRevelee(null);
      image.current = requestAnimationFrame(defiler);
    }
    mesurer();
  };

  const lacher = (e: EvenementPointeur<HTMLElement>) => {
    const p = prise.current;
    if (!p || p.pointeur !== e.pointerId) return;
    const cible = p.actif ? derniereCible.current : null;
    const element = parties.find((x) => x.id === p.id);
    terminer();
    if (!cible || !element || depotSansEffet(cible, element, parties)) return;
    setEnAttente(element.id);
    lancerDeplacement(
      () => deplacerElement({ partieId: element.id, versBloc: cible.bloc, avantId: cible.avantId }),
      () => setEnAttente(null),
    );
  };

  const abandonner = (e: EvenementPointeur<HTMLElement>) => {
    if (prise.current?.pointeur === e.pointerId) terminer();
  };

  // Échap abandonne un déplacement en cours ; et rien ne doit survivre au démontage.
  const enDeplacement = deplacement !== null;
  useEffect(() => {
    if (!enDeplacement) return;
    const echap = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      arreterDefilement();
      prise.current = null;
      derniereCible.current = null;
      setDeplacement(null);
    };
    document.addEventListener("keydown", echap);
    return () => document.removeEventListener("keydown", echap);
  }, [enDeplacement]);
  useEffect(
    () => () => {
      // Démontée en plein geste : la boucle de défilement s'arrête d'elle-même sans prise.
      prise.current = null;
    },
    [],
  );

  const cible = deplacement?.cible ?? null;
  const premiere = parties[0]?.id ?? null;

  return (
    <div className="flex flex-col gap-3">
      {meneuse && (
        <div className="flex flex-col gap-2">
          {demo !== 0 && <DemoGestes etape={demo} onSuivant={() => setDemo(2)} onCompris={() => setDemo(0)} />}
          <div className="flex flex-wrap items-center justify-between gap-x-3">
            <p className="text-base text-texte-secondaire">Touche une ligne pour la régler.</p>
            {demo === 0 && (
              /* `-mx-[18px]` rend au texte la marge et la bordure du bouton (16 + 2 px), des deux côtés :
                 passé à la ligne, il s'aligne sur la phrase du dessus ; sur la même ligne, il touche
                 le bord droit. */
              <Bouton type="button" variante="discret" taille="petite" className="-mx-[18px] underline" onClick={() => setDemo(1)}>
                Revoir les gestes
              </Bouton>
            )}
          </div>
        </div>
      )}
      <p className="text-base font-semibold text-rouge empty:hidden" aria-live="polite">
        {erreurDeplacement}
      </p>
      <div ref={conteneur} className="relative flex flex-col gap-3">
        {groupes.map((groupe) => {
          const idTitre = `${sessionId}-partie-tel-${groupe.bloc}`;
          const couleur = classesPartie(groupe.bloc);
          return (
            // Avec plusieurs parties, chacune prend sa teinte (`classesPartie`) : titre et bande à
            // gauche du bloc entier, sans fond — la même lecture que sur l'ordinateur.
            <section key={groupe.bloc} aria-labelledby={intitules ? idTitre : undefined} className={`flex min-w-0 flex-col gap-2 ${intitules ? `${couleur.bande} pl-2` : ""}`}>
              {intitules && (
                <h3 id={idTitre} className={`font-titre text-base font-semibold ${couleur.titre}`}>
                  {nomPartie(groupe.bloc)}
                </h3>
              )}
              <ul className="flex flex-col gap-2">
                {groupe.elements.map((partie) => (
                  <LigneElement
                    key={partie.id}
                    sessionId={sessionId}
                    partie={partie}
                    compact={compact}
                    ouverte={ouverte === partie.id}
                    onBasculer={() => setOuverte((o) => (o === partie.id ? null : partie.id))}
                    revelee={revelee === partie.id}
                    onReveler={(oui) => setRevelee(oui ? partie.id : null)}
                    tenue={deplacement?.id === partie.id ? deplacement.dy : null}
                    enAttente={enAttente === partie.id}
                    demo={meneuse && partie.id === premiere ? demo : 0}
                    poignee={{ onPointerDown: (e) => prendre(e, partie), onPointerMove: bouger, onPointerUp: lacher, onPointerCancel: abandonner }}
                  />
                ))}
              </ul>
              {ajout(groupe.bloc)}
            </section>
          );
        })}
        {/* Pendant un déplacement seulement : la place d'une partie qui n'existe pas encore. */}
        {enDeplacement && (
          <div
            data-zone-nouvelle
            className={`flex min-h-14 items-center justify-center rounded-xl border-2 border-dashed px-3 text-base font-semibold ${
              cible?.nouvelle ? "border-primaire bg-primaire-doux text-texte" : "border-bordure text-texte-secondaire"
            }`}
          >
            Nouvelle partie {nbParties + 1}
          </div>
        )}
        {/* L'indicateur de dépôt : un trait en pointillés entre deux lignes, là où l'élément tombera. */}
        {deplacement?.indicateur != null && (
          <div aria-hidden className="pointer-events-none absolute inset-x-0 z-20 border-t-4 border-dashed border-primaire" style={{ top: deplacement.indicateur - 2 }} />
        )}
      </div>
      {pied}
    </div>
  );
}

/**
 * **Une ligne de la liste** : sa poignée, son nom et son résumé, le bouton « Retirer » caché
 * dessous, et ses réglages quand elle est dépliée.
 */
function LigneElement({
  sessionId,
  partie,
  compact,
  ouverte,
  onBasculer,
  revelee,
  onReveler,
  tenue,
  enAttente,
  demo,
  poignee,
}: {
  sessionId: string;
  partie: CasePlanning;
  compact: boolean;
  ouverte: boolean;
  onBasculer: () => void;
  revelee: boolean;
  onReveler: (oui: boolean) => void;
  /** Décalage vertical de la ligne tenue par la poignée, `null` quand elle est à sa place */
  tenue: number | null;
  /** Un déplacement de cette ligne est parti au serveur */
  enAttente: boolean;
  /** L'étape de la démonstration à jouer sur cette ligne (0 : aucune) */
  demo: 0 | 1 | 2;
  poignee: {
    onPointerDown: (e: EvenementPointeur<HTMLElement>) => void;
    onPointerMove: (e: EvenementPointeur<HTMLElement>) => void;
    onPointerUp: (e: EvenementPointeur<HTMLElement>) => void;
    onPointerCancel: (e: EvenementPointeur<HTMLElement>) => void;
  };
}) {
  const [retrait, lancerRetrait, erreurRetrait] = useActionPartie();
  const brouillon = useBrouillon();
  const [glisse, setGlisse] = useState<number | null>(null);
  const doigt = useRef<{ pointeur: number; x: number; y: number; sens: "horizontal" | "vertical" | null; decalage: number } | null>(null);
  /**
   * Un glissé se termine sur la ligne : le « clic » qui le suit ne doit pas la déplier. On retient
   * **quand** il a fini (`clicApresGlisse`), pas un drapeau : un glissé n'émet pas toujours ce clic, et
   * le drapeau resté levé avalait alors le toucher suivant.
   */
  const finGlisse = useRef<number | null>(null);
  const boutonLigne = useRef<HTMLButtonElement>(null);
  const idPanneau = `reglages-${useId().replace(/:/g, "")}`;
  const resume = useResume(partie);

  const commencer = (e: EvenementPointeur<HTMLDivElement>) => {
    if (enAttente || tenue !== null) return;
    // Un nouveau doigt posé : ce qui suivra n'est plus l'écho du glissé d'avant.
    finGlisse.current = null;
    doigt.current = { pointeur: e.pointerId, x: e.clientX, y: e.clientY, sens: null, decalage: revelee ? -LARGEUR_RETIRER_PX : 0 };
  };
  const suivre = (e: EvenementPointeur<HTMLDivElement>) => {
    const d = doigt.current;
    if (!d || d.pointeur !== e.pointerId) return;
    const dx = e.clientX - d.x;
    if (d.sens === null) {
      d.sens = directionGeste(dx, e.clientY - d.y);
      // Un défilement : la page s'en occupe (`pan-y`), la ligne ne bouge pas.
      if (d.sens === "vertical") {
        doigt.current = null;
        return;
      }
      if (d.sens === "horizontal") e.currentTarget.setPointerCapture(e.pointerId);
    }
    if (d.sens !== "horizontal") return;
    d.decalage = decalageGlisse(dx, revelee);
    setGlisse(d.decalage);
  };
  const finir = (e: EvenementPointeur<HTMLDivElement>) => {
    const d = doigt.current;
    if (!d || d.pointeur !== e.pointerId) return;
    doigt.current = null;
    if (d.sens !== "horizontal") return;
    finGlisse.current = e.timeStamp;
    setGlisse(null);
    onReveler(resteRevelee(d.decalage));
  };
  const annuler = () => {
    doigt.current = null;
    setGlisse(null);
  };

  const retirer = () => {
    /* Le même geste que le bouton de l'ordinateur (`BoutonsElement`) : la même question, et le
       serveur garde ses refus (élément occupé, séance close). Un atelier repart dans les propositions. */
    if (!window.confirm(confirmationRetrait(partie.libelle, partie.atelier))) return;
    lancerRetrait(
      () => retirerPartie({ partieId: partie.id }),
      (ok) => {
        if (!ok) return;
        onReveler(false);
        // Un élément retiré n'a plus de réglage à appliquer : laissé au brouillon, il ferait refuser
        // tout le lot par le serveur (« Cette partie n'existe plus »).
        brouillon?.oublier(partie.id);
      },
    );
  };

  // Caché sous la ligne tant qu'elle est en place : ses coins arrondis laisseraient sinon dépasser du rouge.
  const visibleRetirer = revelee || glisse !== null || demo === 1;
  const decalageX = glisse ?? (revelee ? -LARGEUR_RETIRER_PX : 0);
  const souleve = tenue !== null;
  const occupe = enAttente || retrait;
  // Pendant le doigt, pas de transition : la ligne suit sans retard. Au lâcher, elle se pose.
  const transition = glisse === null && !souleve ? "motion-safe:transition-transform motion-safe:duration-200" : "";
  const animation = demo === 1 && !revelee && glisse === null ? "motion-safe:animate-[demo-glisse_2.6s_ease-in-out_infinite]" : "";

  return (
    <li data-ligne-id={partie.id} data-bloc={partie.bloc} className="flex min-w-0 flex-col gap-1">
      <div className={`relative ${souleve ? "z-30" : ""}`}>
        {/* Le bouton « Retirer », sous la ligne : il n'apparaît qu'une fois la ligne glissée. Il reste
            atteignable au clavier et au lecteur d'écran — prendre le focus ouvre la ligne. */}
        <div
          className={`absolute inset-y-0 right-0 flex overflow-hidden rounded-xl ${souleve ? "invisible" : ""} ${visibleRetirer ? "" : "opacity-0 focus-within:opacity-100"}`}
          style={{ width: LARGEUR_RETIRER_PX }}
        >
          <button
            type="button"
            data-retirer
            className="flex min-h-12 w-full flex-col items-center justify-center gap-0.5 bg-rouge text-base font-semibold text-primaire-texte disabled:opacity-60"
            disabled={occupe}
            aria-label={`Retirer « ${partie.libelle} »`}
            onFocus={() => onReveler(true)}
            onClick={retirer}
          >
            <Icone nom="alerte" />
            Retirer
          </button>
        </div>
        <div
          className={`relative flex min-w-0 items-stretch rounded-xl border bg-surface ${souleve ? "border-primaire shadow-carte-survol" : "border-bordure/70 shadow-carte"} ${
            occupe ? "opacity-60" : ""
          } ${transition} ${animation}`}
          style={{ touchAction: "pan-y", transform: souleve ? `translate3d(0, ${tenue}px, 0) scale(1.02)` : `translateX(${decalageX}px)` }}
          aria-busy={occupe || undefined}
          onPointerDown={commencer}
          onPointerMove={suivre}
          onPointerUp={finir}
          onPointerCancel={annuler}
        >
          {/* La poignée : la seule partie de la ligne qui attrape (`touch-action: none`). Sans
              équivalent au clavier, elle est cachée aux lecteurs d'écran ; le menu d'ajout et le
              retrait, eux, restent atteignables. */}
          {/* `data-sans-cocher` : avec la sélection multiple allumée, toucher la poignée ne coche pas
              la séance (`ZoneCochable` ne voit pas son `pointerdown`, que `prendre` arrête). */}
          <span
            aria-hidden
            data-sans-cocher
            title="Tenir puis glisser pour déplacer"
            className={`flex w-12 shrink-0 cursor-grab items-center justify-center rounded-l-xl text-texte-secondaire ${demo === 2 ? "bg-primaire-doux text-primaire ring-2 ring-primaire ring-inset" : ""}`}
            style={{ touchAction: "none" }}
            {...poignee}
          >
            <Icone nom="poignee" taille={22} strokeWidth={3.5} />
          </span>
          <button
            ref={boutonLigne}
            type="button"
            aria-expanded={ouverte}
            aria-controls={idPanneau}
            className="flex min-h-12 min-w-0 flex-1 items-center gap-2 py-2 pr-3 text-left text-texte"
            onClick={(e) => {
              const echo = clicApresGlisse(finGlisse.current, e.timeStamp);
              finGlisse.current = null;
              if (echo) return;
              if (revelee) {
                onReveler(false);
                return;
              }
              onBasculer();
            }}
          >
            <span className="flex min-w-0 flex-1 flex-col items-start gap-1">
              <span className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-0.5 text-base font-semibold ${couleurNature(partie.nature, partie.teinte)}`}>
                <EcuNature nature={partie.nature} teinte={partie.teinte} />
                {nomElement(partie.nature, partie.rang, partie.nombre)}
              </span>
              <span className="block max-w-full break-words text-base text-texte-secondaire">
                {enAttente ? "Déplacement…" : retrait ? "Retrait…" : (resume.texte ?? <span className="italic">À régler</span>)}
                {resume.modifie && !enAttente && !retrait && <span className="font-semibold text-ocre">&nbsp;· modifié</span>}
              </span>
            </span>
            <Icone nom={ouverte ? "chevronHaut" : "chevronBas"} className="text-texte-secondaire" />
          </button>
        </div>
      </div>
      <p className="text-base font-semibold text-rouge empty:hidden" aria-live="polite">
        {erreurRetrait}
      </p>
      {ouverte && (
        <div id={idPanneau} className="flex flex-col gap-1 rounded-xl border border-bordure/60 bg-surface-douce/40 p-2">
          <CaseEditeur sessionId={sessionId} valeur={partie} compact={compact} discret={enParallele(partie.nature)} />
          {/* **« Valider », un vrai bouton en bas des réglages** : un lien « Fermer » discret ne disait
              pas que le réglage était gardé, et se cherchait. Valider replie la ligne ; le réglage
              reste dans le brouillon (« · modifié » sur la ligne) jusqu'à « Appliquer ». */}
          <Bouton
            type="button"
            className="w-full gap-2"
            onClick={() => {
              onBasculer();
              boutonLigne.current?.focus();
            }}
          >
            <Icone nom="check" />
            Valider
          </Bouton>
        </div>
      )}
    </li>
  );
}

/**
 * **Le résumé d'une ligne repliée** : l'instructeur et le thème **voulus** — ceux du brouillon s'il y
 * en a, sinon ceux du serveur. Une ligne qui annoncerait l'ancien instructeur juste après qu'on l'a
 * changé ferait croire que le réglage n'a pas pris. Le thème d'un atelier est son titre.
 */
function useResume(partie: CasePlanning): { texte: string | null; modifie: boolean } {
  const brouillon = useBrouillon();
  const { personnes } = useOptionsCase();
  const voulue = brouillon?.modifiees.get(partie.id);
  if (!voulue) return { texte: resumeLigne(partie.instructeur, partie.atelier?.titre ?? partie.theme), modifie: false };
  const p = personnes.find((x) => x.id === voulue.instructeurId);
  const instructeur = voulue.instructeurId ? (p ? `${p.prenom} ${p.nom}` : partie.instructeur) : null;
  return { texte: resumeLigne(instructeur, partie.atelier?.titre ?? voulue.theme), modifie: true };
}
