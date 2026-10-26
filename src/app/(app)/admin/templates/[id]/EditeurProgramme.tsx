"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { libelleChoixNiveau, LIBELLE_VIDE, NIVEAUX, NOMS_NATURE, nomElement, nomPartie, PARTIE_DESCRIPTION_MAX, partiesNommees, THEME_MAX, type Niveau } from "@/lib/constants";
import { couleurPersonne } from "@/lib/couleurs";
import { NATURES_TEMPLATE, type ElementTemplate, type NatureTemplate } from "@/lib/templates";
import { enregistrerElementsTemplate } from "@/actions/templates";
import { AUTRE, reglagesVides, themesDeNature } from "@/components/planning/options";
import { grouperParPartie, pasVoisins, type PasVoisin } from "@/components/planning/parties-carte";
import { placesDansPartie } from "@/components/planning/rangement";
import { classesPartie, teintesProgramme, type Teinte } from "@/components/seances/teintes";
import { couleurNature } from "@/components/seances/programme-cours";
import { EcuNature } from "@/components/seances/EcuNature";
import { ListeDeroulante, type EntreeListe } from "@/components/ui/ListeDeroulante";
import { Alerte } from "@/components/ui/Alerte";
import { Bouton } from "@/components/ui/Bouton";
import { Icone } from "@/components/ui/Icone";
import { ZoneTexte } from "@/components/ui/ZoneTexte";
import {
  ajouterElement,
  deplacerLigne,
  lignesDepuis,
  memeProgramme,
  modifierLigne,
  nombreParties,
  programmePlein,
  retirerLigne,
  versElements,
  type LigneProgramme,
} from "../programme-template";

/** Une personne qu'on peut choisir pour encadrer — lue par la page serveur (`personnesPlanning`). */
export type EncadrantTemplate = {
  id: string;
  prenom: string;
  nom: string;
  couleur: number | null;
  /** Compte désactivé encore nommé dans le template : affiché pour qu'on le voie, refusé à l'enregistrement. */
  inactif?: boolean;
};

/**
 * **L'éditeur du programme d'un template.**
 *
 * Il ressemble à l'éditeur du planning (`ListeParties`, `CaseEditeur`) — parties bordées de leur
 * teinte quand il y en a plusieurs, étiquette de nature avec son écu, ↑ ↓ Retirer, un menu d'ajout
 * sous chaque partie — **sans le réutiliser**, et pour une raison de fond : le planning écrit chaque
 * geste sur une séance réelle, avec ses identifiants, sa file d'envoi et ses verrous de période. Un
 * template se **compose** dans le navigateur et s'enregistre **d'un bloc** (« Enregistrer le
 * programme », `enregistrerElementsTemplate`) : la mécanique vit dans `programme-template.ts`, pure et
 * testée ; ce composant ne garde que l'état et le dessin.
 *
 * **Ce que le planning a décidé, et qu'on garde à l'identique** :
 *  - la nature se choisit **à l'ajout** et ne change plus après (pour changer d'avis : retirer, ajouter
 *    l'autre) — l'étiquette la montre, comme la lira un membre ;
 *  - `----------` en tête de chaque liste (`LIBELLE_VIDE`) ; la liste de thèmes suit la nature
 *    (`themesDeNature`), avec « Autre… » pour un thème libre ;
 *  - le second instructeur attend le premier, le niveau et la description attendent le thème ;
 *  - les intitulés « Partie N » ne s'affichent que s'il y a plusieurs parties (`partiesNommees`).
 *
 * **L'état est semé par le serveur et le suit** : après l'enregistrement, la page revient avec le
 * programme remis d'accord (parties renumérotées, second en double effacé) et l'éditeur le reprend
 * (`vuDuServeur`, la doctrine de CLAUDE.md pour un composant piloté). La comparaison se fait sur le
 * **contenu** : enregistrer la carte « Informations » re-rend la page sans changer le programme, et ne
 * doit pas effacer ce qu'on est en train d'y composer.
 */
export function EditeurProgramme({
  templateId,
  elements,
  personnes,
  themes,
  themesEchauffement,
}: {
  templateId: string;
  /** Le programme enregistré, dans l'ordre de lecture (bloc, puis ordre). */
  elements: ElementTemplate[];
  personnes: EncadrantTemplate[];
  /** « Thèmes de cours et options » (réglage du club). */
  themes: string[];
  /** « Thèmes d'échauffement » (réglage du club). */
  themesEchauffement: string[];
}) {
  const cleServeur = JSON.stringify(elements);
  const [lignes, setLignes] = useState<LigneProgramme[]>(() => lignesDepuis(elements));
  const [vuDuServeur, setVuDuServeur] = useState(cleServeur);
  if (vuDuServeur !== cleServeur) {
    setVuDuServeur(cleServeur);
    setLignes(lignesDepuis(elements));
  }
  /** Les lignes dont le thème se saisit librement (« Autre… » choisi). */
  const [libres, setLibres] = useState<ReadonlySet<string>>(new Set());
  const [enVol, demarrer] = useTransition();
  const [message, setMessage] = useState<{ type: "succes" | "erreur"; texte: string } | null>(null);
  // Les clés des lignes ajoutées ici ne doivent jamais croiser celles venues du serveur (`l0`, `l1`…).
  const compteur = useRef(0);
  const nouvelleCle = () => `n${++compteur.current}`;

  const aEnregistrer = versElements(lignes);
  const modifie = !memeProgramme(aEnregistrer, elements);

  /*
   * **Prévenir avant de fermer l'onglet, seulement s'il y a quelque chose à perdre** — la règle de
   * `garde-fermeture.ts` : une question posée à chaque fermeture finit cliquée sans être lue. Le
   * texte appartient au navigateur. La navigation interne (routeur de Next) n'est pas retenue : c'est
   * la barre d'état sous l'éditeur qui dit, en toutes lettres, que rien n'est encore enregistré.
   */
  useEffect(() => {
    if (!modifie) return;
    const garde = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", garde);
    return () => window.removeEventListener("beforeunload", garde);
  }, [modifie]);

  const changer = (suivantes: LigneProgramme[]) => {
    setLignes(suivantes);
    // Un succès affiché au-dessus d'une liste qu'on vient de retoucher mentirait.
    setMessage(null);
  };

  const enregistrer = () => {
    setMessage(null);
    demarrer(async () => {
      try {
        const res = await enregistrerElementsTemplate(templateId, aEnregistrer);
        if ("erreur" in res) setMessage({ type: "erreur", texte: res.erreur });
        else {
          setLibres(new Set());
          setMessage({ type: "succes", texte: "Programme enregistré." });
        }
      } catch {
        // Une promesse qui rejette (réseau coupé, session tombée) ne doit pas laisser l'écran muet.
        setMessage({ type: "erreur", texte: "L'enregistrement n'a pas abouti. Vérifie ta connexion et réessaie." });
      }
    });
  };

  const nbParties = nombreParties(lignes);
  const intitules = partiesNommees(nbParties);
  const places = placesDansPartie(lignes);
  // Les teintes que l'application écrira : mêmes identifiants que `partiesDepuisTemplate`.
  const teintes = teintesProgramme(
    lignes.map((l, i) => ({ id: String(i).padStart(4, "0"), bloc: l.bloc, nature: l.nature, theme: l.theme })),
    themes,
  ).elements;
  const infos = new Map(lignes.map((l, i) => [l.cle, { place: places[i], teinte: teintes[i] }]));
  const plein = programmePlein(lignes);
  const reperes = lignes.map((l) => ({ id: l.cle, bloc: l.bloc }));

  return (
    <div className="flex flex-col gap-4">
      {grouperParPartie(lignes).map((groupe) => {
        const couleur = classesPartie(groupe.bloc);
        const idTitre = `template-partie-${groupe.bloc}`;
        return (
          // Même forme que la carte d'une séance : sans intitulé, la partie n'est pas une région nommée.
          <section
            key={groupe.bloc}
            aria-labelledby={intitules ? idTitre : undefined}
            className={`flex min-w-0 flex-col gap-3 ${intitules ? `${couleur.bande} pl-3` : ""}`}
          >
            {intitules && (
              <h3 id={idTitre} className={`font-titre text-base font-semibold ${couleur.titre}`}>
                {nomPartie(groupe.bloc)}
              </h3>
            )}
            <ul className="flex flex-col gap-3">
              {groupe.elements.map((ligne) => {
                const info = infos.get(ligne.cle)!;
                const nom = nomElement(ligne.nature, info.place.rang, info.place.nombre);
                const libelle = intitules ? `${nomPartie(ligne.bloc)} · ${nom}` : nom;
                return (
                  <li key={ligne.cle} className="flex min-w-0 flex-col gap-2 rounded-xl border border-bordure/60 bg-surface-douce/40 p-3">
                    <EnteteLigne
                      ligne={ligne}
                      nom={nom}
                      libelle={libelle}
                      teinte={info.teinte}
                      voisins={pasVoisins({ id: ligne.cle, bloc: ligne.bloc }, reperes)}
                      seule={lignes.length <= 1}
                      onDeplacer={(pas) => changer(deplacerLigne(lignes, ligne.cle, pas))}
                      onRetirer={() => {
                        changer(retirerLigne(lignes, ligne.cle));
                        setLibres((s) => sansCle(s, ligne.cle));
                      }}
                    />
                    <ReglagesLigne
                      ligne={ligne}
                      libelle={libelle}
                      personnes={personnes}
                      themesListe={themesDeNature({ themes, themesEchauffement }, ligne.nature)}
                      libre={libres.has(ligne.cle)}
                      onLibre={(oui) => setLibres((s) => (oui ? new Set([...s, ligne.cle]) : sansCle(s, ligne.cle)))}
                      onChanger={(changement, effacerDetails) => changer(modifierLigne(lignes, ligne.cle, changement, effacerDetails))}
                    />
                  </li>
                );
              })}
            </ul>
            <AjoutDansPartie
              bloc={groupe.bloc}
              nommee={intitules}
              desactive={plein}
              onAjouter={(nature) => changer(ajouterElement(lignes, groupe.bloc, nature, nouvelleCle()))}
            />
          </section>
        );
      })}

      {/* Une partie de plus naît avec un cours vide, comme au planning : une partie n'existe que par
          ses éléments. Pas d'icône « plus » dans le jeu : la croix tournée d'un quart de tour. */}
      <Bouton
        variante="secondaire"
        taille="petite"
        className="w-full min-[390px]:w-auto min-[390px]:self-start"
        disabled={plein}
        title={plein ? "Le programme est complet." : undefined}
        onClick={() => changer(ajouterElement(lignes, nbParties + 1, "COURS", nouvelleCle()))}
      >
        <Icone nom="croix" taille={18} className="rotate-45" />
        Ajouter une partie
      </Bouton>

      {/* **Un seul bouton pour tout le programme**, et l'état dit à côté de lui : ce qui n'est pas
          enregistré se voit avant qu'on ne quitte l'écran. Région vivante rendue en permanence — une
          région créée en même temps que son texte n'est pas toujours lue. */}
      <div className="flex flex-col gap-3 border-t border-bordure/60 pt-4">
        <p className="font-semibold text-ocre empty:hidden" aria-live="polite">
          {modifie && !enVol ? "Modifications non enregistrées." : ""}
        </p>
        {message && <Alerte type={message.type}>{message.texte}</Alerte>}
        <Bouton className="w-full min-[390px]:w-auto min-[390px]:self-start" disabled={enVol} aria-busy={enVol} onClick={enregistrer}>
          {enVol ? "Enregistrement…" : "Enregistrer le programme"}
        </Bouton>
      </div>
    </div>
  );
}

function sansCle(s: ReadonlySet<string>, cle: string): ReadonlySet<string> {
  const copie = new Set(s);
  copie.delete(cle);
  return copie;
}

/**
 * La ligne de titre d'un élément : son étiquette (nature, écu, teinte), puis ↑ ↓ et « Retirer » —
 * séparé des flèches par un écart et porteur de son mot dès 640 px, comme au planning : en ratant la
 * descente d'un cheveu, on ne doit pas retirer l'élément.
 */
function EnteteLigne({
  ligne,
  nom,
  libelle,
  teinte,
  voisins,
  seule,
  onDeplacer,
  onRetirer,
}: {
  ligne: LigneProgramme;
  nom: string;
  libelle: string;
  teinte: Teinte | null;
  voisins: { haut: PasVoisin | null; bas: PasVoisin | null };
  seule: boolean;
  onDeplacer: (pas: PasVoisin) => void;
  onRetirer: () => void;
}) {
  const classe =
    "inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-bordure/70 bg-surface text-texte shadow-carte hover:bg-surface-douce disabled:opacity-40";
  const titreHaut = voisins.haut?.titre ?? "Déjà en tête du programme";
  const titreBas = voisins.bas?.titre ?? "Déjà seul dans la dernière partie";
  const titreRetrait = seule ? "Un template garde au moins un élément" : "Retirer cet élément";
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className={`inline-flex min-h-12 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold ${couleurNature(ligne.nature, teinte)}`}>
        <EcuNature nature={ligne.nature} teinte={teinte} taille={20} />
        {nom}
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-1">
        <button type="button" className={classe} disabled={!voisins.haut} title={titreHaut} onClick={() => voisins.haut && onDeplacer(voisins.haut)}>
          <Icone nom="chevronHaut" titre={`${titreHaut} : « ${libelle} »`} />
        </button>
        <button type="button" className={classe} disabled={!voisins.bas} title={titreBas} onClick={() => voisins.bas && onDeplacer(voisins.bas)}>
          <Icone nom="chevronBas" titre={`${titreBas} : « ${libelle} »`} />
        </button>
        <button
          type="button"
          className={`${classe.replace("text-texte", "text-rouge")} ml-3 gap-1.5 hover:bg-rouge-doux sm:w-auto sm:px-3`}
          disabled={seule}
          title={titreRetrait}
          aria-label={`Retirer « ${libelle} »`}
          onClick={() => {
            // Une ligne vide part sans question ; une ligne remplie perd ce qu'on y a réglé.
            const vide = reglagesVides({ instructeur: ligne.instructeurId, instructeurSecond: ligne.instructeurSecondId, theme: ligne.theme, description: ligne.description, niveau: ligne.niveau });
            if (!vide && !window.confirm(`Retirer « ${libelle} » du programme ? Ce qui y est réglé sera perdu une fois le programme enregistré.`)) return;
            onRetirer();
          }}
        >
          <Icone nom="alerte" />
          <span className="hidden sm:inline">Retirer</span>
        </button>
      </span>
    </div>
  );
}

/** L'intitulé visible d'un champ ; le nom complet (« Thème — Partie 1 · Cours ») est porté par le `<label>` masqué. */
function Intitule({ children }: { children: string }) {
  return (
    <span aria-hidden="true" className="text-sm font-semibold leading-tight text-texte-secondaire">
      {children}
    </span>
  );
}

const CLASSE_CHAMP = "min-h-12 w-full rounded-lg border border-bordure bg-surface px-2 text-base text-texte shadow-champ focus:border-primaire";
/** Le second instructeur, d'un cran en retrait — même grammaire que la case du planning. */
const CLASSE_CHAMP_SECOND = "min-h-12 w-full rounded-lg border border-dashed border-bordure/70 bg-transparent px-2 text-base text-texte-secondaire focus:border-primaire";

/** Une liste déroulante de la ligne, avec son intitulé visible et son nom complet pour les lecteurs d'écran. */
function ListeLigne({
  id,
  intitule,
  libelle,
  valeur,
  entrees,
  onChoisir,
  second = false,
  lisere,
}: {
  id: string;
  intitule: string;
  libelle: string;
  valeur: string;
  entrees: EntreeListe[];
  onChoisir: (v: string) => void;
  second?: boolean;
  /** Couleur d'identification de la personne choisie, en lisere (comme au planning). */
  lisere?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label className="sr-only" id={`${id}-libelle`} htmlFor={id}>
        {intitule} — {libelle}
      </label>
      <Intitule>{intitule}</Intitule>
      <ListeDeroulante
        id={id}
        libelleId={`${id}-libelle`}
        libelle={`${intitule} — ${libelle}`}
        className={second ? CLASSE_CHAMP_SECOND : CLASSE_CHAMP}
        style={lisere ? { borderLeftWidth: 4, borderLeftColor: lisere } : undefined}
        valeur={valeur}
        entrees={entrees}
        onChoisir={onChoisir}
      />
    </div>
  );
}

/**
 * Les réglages d'un élément : instructeur, second, thème, niveau, description. Quatre listes deux par
 * deux dès 640 px (la colonne de lecture n'en loge pas quatre de front), la description sur toute la
 * largeur en dessous : c'est une phrase, pas un choix.
 */
function ReglagesLigne({
  ligne,
  libelle,
  personnes,
  themesListe,
  libre,
  onLibre,
  onChanger,
}: {
  ligne: LigneProgramme;
  libelle: string;
  personnes: EncadrantTemplate[];
  themesListe: string[];
  libre: boolean;
  onLibre: (oui: boolean) => void;
  onChanger: (changement: Partial<Omit<ElementTemplate, "bloc" | "nature">>, effacerDetails?: boolean) => void;
}) {
  const id = `template-${ligne.cle}`;
  const nomComplet = (p: EncadrantTemplate) => `${p.prenom} ${p.nom}${p.inactif ? " (compte désactivé)" : ""}`;
  const instructeurId = ligne.instructeurId ?? "";
  const secondId = ligne.instructeurSecondId ?? "";
  const entreesInstructeur: EntreeListe[] = [
    { valeur: "", libelle: LIBELLE_VIDE },
    ...personnes.map((p) => ({ valeur: p.id, libelle: nomComplet(p), couleur: couleurPersonne(p.id, p.couleur) })),
  ];
  // Le second : les mêmes, moins la personne déjà choisie — on ne s'assiste pas soi-même.
  const entreesSecond: EntreeListe[] = [
    { valeur: "", libelle: LIBELLE_VIDE },
    ...personnes.filter((p) => p.id !== instructeurId).map((p) => ({ valeur: p.id, libelle: nomComplet(p), couleur: couleurPersonne(p.id, p.couleur) })),
  ];
  const themeConnu = themesListe.includes(ligne.theme);
  const entreesTheme: EntreeListe[] = [
    { valeur: "", libelle: LIBELLE_VIDE },
    ...themesListe.map((t) => ({ valeur: t, libelle: t })),
    // Un thème libre déjà enregistré, ou retiré depuis de la liste du club : il se montre à part.
    ...(!libre && ligne.theme && !themeConnu ? [{ valeur: ligne.theme, libelle: ligne.theme }] : []),
    { valeur: AUTRE, libelle: "Autre…" },
  ];
  const entreesNiveau: EntreeListe[] = NIVEAUX.map((n) => ({ valeur: n, libelle: libelleChoixNiveau(n) }));
  const choisi = personnes.find((p) => p.id === instructeurId);
  const details = ligne.theme.trim() !== "";
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <ListeLigne
          id={`${id}-instructeur`}
          intitule="Instructeur"
          libelle={libelle}
          valeur={instructeurId}
          entrees={entreesInstructeur}
          lisere={choisi ? couleurPersonne(choisi.id, choisi.couleur) : undefined}
          onChoisir={(v) => onChanger({ instructeurId: v || null })}
        />
        {/* Le second ne s'affiche qu'une fois le premier choisi : un second sans premier n'assiste personne. */}
        {instructeurId ? (
          <ListeLigne
            id={`${id}-second`}
            intitule="Second instructeur"
            libelle={libelle}
            valeur={secondId}
            entrees={entreesSecond}
            second
            onChoisir={(v) => onChanger({ instructeurSecondId: v || null })}
          />
        ) : (
          <div className="hidden sm:block" aria-hidden="true" />
        )}
        <div className="flex min-w-0 flex-col gap-1.5">
          <ListeLigne
            id={`${id}-theme`}
            intitule="Thème"
            libelle={libelle}
            valeur={libre ? AUTRE : ligne.theme}
            entrees={entreesTheme}
            onChoisir={(v) => {
              if (v === AUTRE) {
                onLibre(true);
                onChanger({ theme: "" }, false);
                return;
              }
              onLibre(false);
              onChanger({ theme: v });
            }}
          />
          {libre && (
            // Champ piloté (`value=`) : il n'a pas de clé de remontage, son état fait foi.
            <input
              type="text"
              aria-label={`Thème libre — ${libelle}`}
              className={CLASSE_CHAMP}
              value={ligne.theme}
              maxLength={THEME_MAX}
              placeholder="Thème libre"
              autoFocus
              onChange={(e) => onChanger({ theme: e.target.value }, false)}
              onBlur={(e) => onChanger({ theme: e.target.value.trim() })}
            />
          )}
        </div>
        {/* Le niveau attend le thème, comme au planning : sans thème il ne précise rien. */}
        {details && (
          <ListeLigne
            id={`${id}-niveau`}
            intitule="Niveau"
            libelle={libelle}
            valeur={ligne.niveau}
            entrees={entreesNiveau}
            second
            onChoisir={(v) => onChanger({ niveau: (NIVEAUX as readonly string[]).includes(v) ? (v as Niveau) : ligne.niveau })}
          />
        )}
      </div>
      {details && (
        <ZoneTexte
          label="Description (facultative)"
          name={`${id}-description`}
          id={`${id}-description`}
          rows={2}
          value={ligne.description}
          maxLength={PARTIE_DESCRIPTION_MAX}
          placeholder="Ce qu'on fera dans cette partie"
          onChange={(e) => onChanger({ description: e.target.value })}
          // Ce qui est publié doit être annoncé à qui le saisit (CLAUDE.md) : le thème et la
          // description partent avec la séance une fois le template appliqué.
          aide={`Recopiée dans la séance quand le template est appliqué, et publiée avec elle (pages de partage et, si le club l'a ouverte, API publique). ${PARTIE_DESCRIPTION_MAX} signes au plus. Les noms des instructeurs, eux, ne sortent jamais.`}
        />
      )}
    </div>
  );
}

/**
 * « Ajouter un élément… » sous chaque partie : un menu qui **commande** et ne mémorise rien (sa valeur
 * reste l'entrée de tête), comme « Ajouter dans la partie N… » au planning. Il propose un
 * échauffement, un cours, une option — pas d'atelier : c'est la proposition d'un membre, elle ne se
 * répète pas d'une séance à l'autre (`NATURES_TEMPLATE`).
 */
function AjoutDansPartie({ bloc, nommee, desactive, onAjouter }: { bloc: number; nommee: boolean; desactive: boolean; onAjouter: (nature: NatureTemplate) => void }) {
  const id = `template-ajout-${bloc}`;
  const libelle = nommee ? `Ajouter un élément dans la partie ${bloc}` : "Ajouter un élément";
  return (
    <div className="flex flex-col gap-1">
      <label id={`${id}-libelle`} htmlFor={id} className="sr-only">
        {libelle}
      </label>
      <ListeDeroulante
        id={id}
        libelleId={`${id}-libelle`}
        libelle={libelle}
        valeur=""
        disabled={desactive}
        entrees={[{ valeur: "", libelle: `${libelle}…` }, ...NATURES_TEMPLATE.map((n) => ({ valeur: n, libelle: NOMS_NATURE[n] }))]}
        onChoisir={(v) => {
          const nature = NATURES_TEMPLATE.find((n) => n === v);
          if (nature) onAjouter(nature);
        }}
        className="min-h-12 w-full rounded-xl border-2 border-dashed border-bordure/70 bg-transparent px-3 text-base font-semibold text-texte sm:w-auto sm:min-w-64"
      />
    </div>
  );
}
