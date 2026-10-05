"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import {
  grouperParSaison,
  periodePertinente,
  saisonDePeriode,
  situationPeriode,
  suffixeStatut,
  SITUATION_LABELS,
  type PeriodeOption,
} from "./saisons";
import { ListeDeroulante, type EntreeListe } from "@/components/ui/ListeDeroulante";
import { Pastille } from "@/components/ui/Pastille";

export type { PeriodeOption };

type Props = {
  periodes: PeriodeOption[];
  /** Identifiant de la période affichée */
  valeur: string;
  /** Page à rouvrir au changement (un composant client ne peut pas recevoir de fonction depuis le serveur) */
  base: string;
  /** Autres filtres de la page à conserver dans l'URL (fenêtre de temps, séances passées…) */
  params?: Record<string, string>;
  /** Aujourd'hui au format ISO (calculé côté serveur pour éviter tout décalage) */
  aujourdHui: string;
  /** La personne a le droit de créer une période (`periods.manage`, calculé côté serveur) :
   *  les entrées « Nouvelle saison… » et « Nouvelle période… » n'apparaissent que dans ce cas. */
  peutCreer?: boolean;
};

/** Valeurs sentinelles des entrées de création : elles déclenchent une navigation, jamais une sélection. */
const CREER_SAISON = "__nouvelle-saison";
const CREER_PERIODE = "__nouvelle-periode";
const CREATION = "/admin/periodes/nouvelle";
/**
 * Ouvrir un trimestre vit dans **l'espace admin** : `periods.manage` ne suffit pas, il y faut une
 * session forte. Un administrateur entré par son lien personnel a bien le droit, mais il sera
 * d'abord envoyé sur `/connexion/admin` — d'où cette mention dans le libellé. Un lien qui rebondit
 * doit le dire avant le clic ; c'est déjà ce que fait « Se connecter en tant qu'administrateur »
 * sur « Mon profil ». Une entrée de liste ne pouvant porter ni icône ni infobulle, la mention est
 * dans le texte, en toutes lettres.
 */
const MENTION_ADMIN = " (mot de passe admin)";

const CLASSE_LISTE =
  "min-h-12 w-full rounded-xl border-2 border-bordure bg-surface px-3 text-[1.0625rem] text-texte shadow-champ focus:border-primaire disabled:opacity-60";

/**
 * Choix de ce qu'on regarde, en deux temps : d'abord **la saison** (l'année sportive, du 1er septembre
 * au 31 août), puis **la période** dans cette saison — T1, T2, T3, la période estivale ou une période
 * personnalisée. Changer de saison ouvre sa période la plus pertinente (celle en cours, sinon la
 * première à venir, sinon la dernière). La mention « En cours / À venir / Passée » rappelle où l'on est.
 *
 * Complète la fenêtre de temps (Toute la période · 2 mois · 1 mois · 2 semaines · 1 semaine · Prochain cours),
 * qui, elle, resserre l'affichage : la saison et la période disent *quoi* regarder, la fenêtre *jusqu'où*.
 */
export function SelecteurPeriode({ periodes, valeur, base, params, aujourdHui, peutCreer = false }: Props) {
  const router = useRouter();
  const [pending, demarrer] = useTransition();

  const lien = (periodeId: string) => {
    const q = new URLSearchParams({ periode: periodeId, ...params });
    return `${base}?${q.toString()}`;
  };
  const ouvrir = (periodeId: string) => demarrer(() => router.push(lien(periodeId)));

  const saisons = grouperParSaison(periodes);
  if (saisons.length === 0) return null;

  const courante = periodes.find((p) => p.id === valeur);
  const groupe = saisons.find((s) => s.saison === (courante ? saisonDePeriode(courante) : Number.NaN)) ?? saisons[0];
  const choisie = courante ?? groupe.periodes[0];
  const situation = situationPeriode(choisie, aujourdHui);

  const changerSaison = (valeurSaison: string) => {
    const cible = saisons.find((s) => String(s.saison) === valeurSaison);
    const pertinente = cible && periodePertinente(cible.periodes, aujourdHui);
    if (pertinente && pertinente.id !== choisie.id) ouvrir(pertinente.id);
  };
  // La saison suivant la plus récente déjà en base : c'est celle qu'on vient créer
  const saisonSuivante = saisons[0].saison + 1;

  /*
   * **Les listes du dépôt (`ListeDeroulante`), pilotées par l'URL.** Ce sélecteur n'a jamais marché
   * sans JavaScript — choisir appelait déjà `router.push` —, rien ne retenait donc la liste native.
   * La valeur affichée vient des props (la période de la page) et ne bouge qu'à la navigation : une
   * entrée d'action (« Nouvelle saison… ») n'a plus à remettre la liste sur la valeur affichée, elle
   * n'en a jamais changé. Les `<optgroup label="Ajouter">` deviennent le champ `groupe` des entrées.
   */
  const entreesSaison: EntreeListe[] = [
    ...saisons.map((s) => ({ valeur: String(s.saison), libelle: s.libelle })),
    ...(peutCreer ? [{ valeur: CREER_SAISON, libelle: `Nouvelle saison…${MENTION_ADMIN}`, groupe: "Ajouter" }] : []),
  ];
  const entreesPeriode: EntreeListe[] = [
    ...groupe.periodes.map((p) => ({ valeur: p.id, libelle: `${p.nom}${suffixeStatut(p)}` })),
    ...(peutCreer ? [{ valeur: CREER_PERIODE, libelle: `Nouvelle période…${MENTION_ADMIN}`, groupe: "Ajouter" }] : []),
  ];

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex min-w-32 flex-1 flex-col gap-1.5 sm:max-w-44">
        <label id="selecteur-saison-libelle" htmlFor="selecteur-saison" className="font-semibold">
          Saison
        </label>
        <ListeDeroulante
          id="selecteur-saison"
          libelleId="selecteur-saison-libelle"
          libelle="Saison"
          valeur={String(groupe.saison)}
          entrees={entreesSaison}
          disabled={pending}
          onChoisir={(v) => {
            // Entrée d'action, pas une valeur : on part créer, la liste garde la saison affichée
            if (v === CREER_SAISON) demarrer(() => router.push(`${CREATION}?saison=${saisonSuivante}&trimestre=1`));
            else changerSaison(v);
          }}
          className={CLASSE_LISTE}
        />
      </div>
      <div className="flex min-w-48 flex-1 flex-col gap-1.5 sm:max-w-72">
        <div className="flex flex-wrap items-center gap-2">
          <label id="selecteur-periode-libelle" htmlFor="selecteur-periode" className="font-semibold">
            Période
          </label>
          <Pastille ton={situation === "en-cours" ? "vert" : situation === "a-venir" ? "primaire" : "neutre"}>{SITUATION_LABELS[situation]}</Pastille>
        </div>
        <ListeDeroulante
          id="selecteur-periode"
          libelleId="selecteur-periode-libelle"
          libelle="Période"
          valeur={choisie.id}
          entrees={entreesPeriode}
          disabled={pending}
          onChoisir={(v) => {
            // Entrée d'action, pas une valeur : on part créer, la liste garde la période affichée
            if (v === CREER_PERIODE) demarrer(() => router.push(`${CREATION}?saison=${groupe.saison}`));
            else if (v !== choisie.id) ouvrir(v);
          }}
          className={CLASSE_LISTE}
        />
      </div>
    </div>
  );
}
