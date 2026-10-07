"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { deciderAtelier } from "@/actions/ateliers";
import { FORM_INITIAL } from "@/lib/form";
import { formatDateCourte, formatHeure } from "@/lib/dates";
import { Alerte } from "@/components/ui/Alerte";
import { Bouton } from "@/components/ui/Bouton";
import { ChoixGeste } from "@/components/ui/ChoixGeste";
import { ExplicationGeste } from "@/components/ui/ExplicationGeste";
import { Icone } from "@/components/ui/Icone";
import { ListeDeroulante } from "@/components/ui/ListeDeroulante";
import { ZoneTexte } from "@/components/ui/ZoneTexte";
import { useEcranTelephone } from "@/components/ui/useEcranTelephone";
import { VoletBas } from "@/components/ui/VoletBas";
import { gesteRetenu, varianteGeste } from "@/components/ui/choix-geste";
import { gesteAvecMot, gestesAtelier, ouvrirVolet, STATUT_VISE, type GesteAtelier } from "./gestes-atelier";

type Seance = { id: string; date: string; heureDebut: string; lieu: string };

/**
 * **La décision sur une proposition : « Que veux-tu faire ? »** — la forme commune de
 * l'administration (`ChoixGeste`), avec les gestes que le statut permet (`gestes-atelier.ts`).
 *
 * - Le geste choisi est **expliqué avant d'agir** : la case du planning, l'email au membre ou son
 *   absence, ce qui reste. Un seul bouton, au verbe du geste ; rouge pour le seul effacement.
 * - « Placer » demande sa séance, **pré-remplie** avec le souhait du membre, sinon la prochaine — le
 *   choix se glisse entre la liste et l'explication, à la place que la forme commune réserve aux
 *   réglages d'un geste. Le mot facultatif n'apparaît que pour les deux gestes qui écrivent au membre.
 * - Une carte qui n'a qu'**un** geste (une proposition refusée, pour l'encadrement) garde un bouton
 *   neutre et court : une liste d'une seule entrée serait une question sans choix.
 * - La confirmation de l'effacement est celle que la carte posait déjà ; les décisions n'en avaient pas.
 *
 * La décision passe toujours par `deciderAtelier` (statut visé, séance, mot), l'effacement par
 * `effacerProposition` : gardes, audit et emails inchangés.
 *
 * **Sur téléphone, une proposition en attente porte deux boutons** au lieu de la liste et
 * d'« Appliquer » : « Programmer » (plein) et « Refuser… ». Chacun ouvre, dans le volet du bas
 * (`VoletBas`, le même que partout ailleurs sur téléphone), ce que la liste ouvrait pour lui — la
 * séance pré-remplie, le mot facultatif, l'explication — puis son bouton de confirmation ; « Fermer »
 * le referme sans rien décider. Un tap de moins, et le même `lancer` derrière, donc les mêmes verrous, les mêmes
 * emails, la même confirmation. Le geste rare, « Effacer sans répondre » (bureau seul), vit dans le
 * panneau de « Refuser… », sous la décision : c'est là qu'on se demande si l'on doit répondre. Les
 * autres statuts gardent la liste — ils n'ont qu'un ou deux gestes, et rarement.
 */
export function DecisionAtelier({
  atelierId,
  statut,
  seances,
  sessionId,
  titre,
  prenom,
  seancePlacee,
  effacer,
}: {
  atelierId: string;
  statut: string;
  seances: Seance[];
  sessionId: string | null;
  titre: string;
  prenom: string;
  /** La séance où l'atelier est placé, en toutes lettres — l'explication la nomme. */
  seancePlacee: string | null;
  /** Effacer sans répondre, déjà lié : présent pour le bureau seul (`ateliers.supprimer`). */
  effacer?: () => Promise<unknown>;
}) {
  const [state, decider, decisionEnCours] = useActionState(deciderAtelier, FORM_INITIAL);
  const [effacement, demarrerEffacement] = useTransition();
  const [, demarrer] = useTransition();
  const [erreurEffacement, setErreurEffacement] = useState<string | null>(null);
  const defaut = sessionId && seances.some((s) => s.id === sessionId) ? sessionId : (seances[0]?.id ?? "");
  const [seance, setSeance] = useState(defaut);
  const [mot, setMot] = useState("");
  const [choisi, setChoisi] = useState<GesteAtelier | "">("");
  const telephone = useEcranTelephone();
  const [panneau, setPanneau] = useState<"placer" | "refuser" | null>(null);
  // Le geste dont part la décision en cours ou refusée : son erreur ne se montre que dans son volet.
  const [envoye, setEnvoye] = useState<GesteAtelier | null>(null);
  // Le dernier volet ouvert : rouvrir le même garde le mot tapé (un refus du serveur ne le perd pas).
  const [dernierVolet, setDernierVolet] = useState<"placer" | "refuser" | null>(null);

  const gestes = gestesAtelier({ titre, prenom, statut, seancePlacee }, { effacer: Boolean(effacer), seancesDisponibles: seances.length > 0 });
  const geste = gesteRetenu(choisi, gestes);
  const retenu = gestes.find((g) => g.geste === geste) ?? null;
  // Un seul geste : son bouton suit la même règle que la liste — rouge, avec l'alerte, s'il retire ou efface.
  const seulRouge = gestes.length === 1 && varianteGeste(gestes[0].definitif, gestes[0].bouton) === "danger";
  const enCours = decisionEnCours || effacement;

  // Un statut revenu du serveur où le geste ne s'applique plus : le choix revient au départ.
  useEffect(() => {
    if (geste !== choisi) setChoisi("");
  }, [geste, choisi]);
  // Après une décision réussie, le geste suivant se choisit — il ne se rejoue pas.
  useEffect(() => {
    if (state.succes) {
      setChoisi("");
      setMot("");
      setPanneau(null);
    }
  }, [state]);

  /** Le mot d'un autre geste n'y passe pas (`ouvrirVolet`) ; rouvrir le même volet le garde. */
  const ouvrir = (g: "placer" | "refuser") => {
    const suite = ouvrirVolet(g, dernierVolet === g ? mot : "");
    setMot(suite.mot);
    setPanneau(suite.panneau);
    setDernierVolet(g);
  };

  const lancer = (g: GesteAtelier) => {
    const offert = gestes.find((x) => x.geste === g);
    if (!offert) return;
    if (offert.confirmation && !window.confirm(offert.confirmation)) return;
    if (g === "effacer") {
      if (!effacer) return;
      setErreurEffacement(null);
      demarrerEffacement(async () => {
        try {
          await effacer();
        } catch (e) {
          const texte = e instanceof Error ? e.message : "";
          if (!texte.includes("NEXT_REDIRECT")) setErreurEffacement(texte || "L'effacement n'a pas abouti — vérifie ta connexion.");
        }
      });
      return;
    }
    const fd = new FormData();
    fd.set("atelierId", atelierId);
    fd.set("statut", STATUT_VISE[g]);
    if (g === "placer") fd.set("sessionId", seance);
    if (gesteAvecMot(g) && mot.trim()) fd.set("commentaire", mot.trim());
    setEnvoye(g);
    demarrer(() => decider(fd));
  };

  const idChoix = `geste-atelier-${atelierId}`;
  const idSeance = `seance-atelier-${atelierId}`;

  const placer = gestes.find((g) => g.geste === "placer");
  const refuser = gestes.find((g) => g.geste === "refuser");
  const gesteEffacer = gestes.find((g) => g.geste === "effacer");

  const listeSeances = (
    <div className="flex flex-col gap-1">
      <label id={`${idSeance}-libelle`} htmlFor={idSeance} className="text-base font-semibold">
        Séance
      </label>
      <ListeDeroulante
        id={idSeance}
        libelleId={`${idSeance}-libelle`}
        libelle="Séance"
        valeur={seance}
        entrees={seances.map((s) => ({ valeur: s.id, libelle: `${formatDateCourte(s.date)}\u00a0· ${formatHeure(s.heureDebut)}\u00a0· ${s.lieu}` }))}
        onChoisir={setSeance}
        className="min-h-12 w-full rounded-xl border-2 border-bordure bg-surface px-3 text-base text-texte shadow-champ"
      />
    </div>
  );
  const champMot = (
    <ZoneTexte
      label={`Un mot pour ${prenom} (facultatif)`}
      name="commentaire"
      id={`commentaire-${atelierId}`}
      value={mot}
      onChange={(e) => setMot(e.target.value)}
      maxLength={500}
      rows={2}
      placeholder={panneau === "refuser" ? "ex. Merci ! Le programme est complet ce trimestre, repropose-le au prochain." : "ex. Super idée, on le fait le 12 !"}
      aide="Joint à l'email, et lu sur sa page « Proposer un atelier »."
    />
  );

  if (telephone && statut === "PROPOSE" && refuser) {
    const ouvert = panneau === "placer" ? placer : panneau === "refuser" ? refuser : undefined;
    return (
      <div className="flex flex-col gap-3" data-decision-telephone>
        {state.erreur && <Alerte type="erreur">{state.erreur}</Alerte>}
        {state.succes && <Alerte type="succes">{state.succes}</Alerte>}
        {erreurEffacement && <Alerte type="erreur">{erreurEffacement}</Alerte>}
        {!placer && seances.length === 0 && (
          <p className="text-base text-texte-secondaire">Aucune séance à venir : l&apos;atelier ne peut pas encore être placé dans le planning.</p>
        )}

        {/* Refuser à gauche, Programmer à droite : ce qui valide reste sous le pouce. */}
        <div className="flex gap-2">
          <Bouton variante="secondaire" className="flex-1" aria-haspopup="dialog" disabled={enCours} onClick={() => ouvrir("refuser")}>
            Refuser…
          </Bouton>
          {placer && (
            <Bouton className="flex-1" aria-haspopup="dialog" disabled={enCours} onClick={() => ouvrir("placer")}>
              Programmer
            </Bouton>
          )}
        </div>

        <VoletBas
          ouvert={Boolean(ouvert)}
          titre={ouvert?.geste === "placer" ? `Programmer « ${titre} »` : `Refuser « ${titre} »`}
          // Pendant l'envoi, le volet reste ouvert : le fermer laisserait croire que rien ne part.
          onFermer={() => !enCours && setPanneau(null)}
        >
          {ouvert && (
            <>
              {/* La carte est derrière le voile : l'erreur d'une décision se dit ici aussi. */}
              {state.erreur && envoye === ouvert.geste && <Alerte type="erreur">{state.erreur}</Alerte>}
              {erreurEffacement && <Alerte type="erreur">{erreurEffacement}</Alerte>}
              {ouvert.geste === "placer" && listeSeances}
              {champMot}
              <ExplicationGeste explication={ouvert.explication} />
              <Bouton
                pleineLargeur
                disabled={enCours || (ouvert.geste === "placer" && !seance)}
                aria-busy={decisionEnCours}
                onClick={() => lancer(ouvert.geste)}
              >
                {decisionEnCours ? "Un instant…" : ouvert.geste === "placer" ? "Programmer" : "Refuser"}
              </Bouton>
              {ouvert.geste === "refuser" && gesteEffacer && (
                <div className="mt-2 flex flex-col gap-2 border-t border-bordure pt-3">
                  <p className="text-base text-texte-secondaire">
                    Un doublon, un envoi par erreur ? On peut aussi l&apos;effacer sans répondre : personne n&apos;est prévenu.
                  </p>
                  <Bouton variante="danger" disabled={enCours} aria-busy={effacement} onClick={() => lancer("effacer")}>
                    {!enCours && <Icone nom="alerte" taille={18} />}
                    Effacer sans répondre
                  </Bouton>
                </div>
              )}
            </>
          )}
        </VoletBas>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {state.erreur && <Alerte type="erreur">{state.erreur}</Alerte>}
      {state.succes && <Alerte type="succes">{state.succes}</Alerte>}
      {erreurEffacement && <Alerte type="erreur">{erreurEffacement}</Alerte>}

      {statut === "PROPOSE" && seances.length === 0 && (
        <p className="text-base text-texte-secondaire">Aucune séance à venir : l&apos;atelier ne peut pas encore être placé dans le planning.</p>
      )}

      {gestes.length === 1 ? (
        <Bouton
          variante={varianteGeste(gestes[0].definitif, gestes[0].bouton) === "danger" ? "danger" : "secondaire"}
          taille="petite"
          className="self-start"
          disabled={enCours}
          aria-busy={enCours}
          onClick={() => lancer(gestes[0].geste)}
        >
          {seulRouge && !enCours && <Icone nom="alerte" taille={18} />}
          {enCours ? "Un instant…" : gestes[0].bouton}
        </Bouton>
      ) : (
        <ChoixGeste
          id={idChoix}
          gestes={gestes}
          valeur={geste}
          onChoisir={(v) => setChoisi(gesteRetenu(v as GesteAtelier | "", gestes))}
          explication={retenu?.explication ?? null}
          bouton={retenu?.bouton ?? "Appliquer"}
          variante={varianteGeste(retenu?.definitif, retenu?.bouton)}
          inerte={!retenu || (geste === "placer" && !seance)}
          enCours={enCours}
          onLancer={() => geste && lancer(geste)}
        >
          {geste === "placer" && listeSeances}
          {gesteAvecMot(geste) && champMot}
        </ChoixGeste>
      )}
    </div>
  );
}
