import { PLEINE_LARGEUR } from "@/components/ui/pleine-largeur";
import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { EntreeModification } from "@/components/ui/EntreeModification";
import { requireUser } from "@/lib/auth/current-user";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { chargerPlanning, periodePlanningParDefaut, periodesVisiblesPar, type ColonnePlanning, type Planning } from "@/lib/planning";
import { lienPlanning, lireSeancesChoisies, modeEditionDemande } from "@/components/planning/mode-edition";
import { Alerte } from "@/components/ui/Alerte";
import { LienBouton } from "@/components/ui/Bouton";
import { Icone } from "@/components/ui/Icone";
import { SelecteurHorizon } from "@/components/ui/SelecteurHorizon";
import { SelecteurHorizonSquelette, SelecteurPeriodeSquelette, TableauSquelette } from "@/components/ui/Squelette";
import { HORIZON_LABELS, HORIZON_LABELS_PASSE, lireHorizon, type Horizon } from "@/lib/horizon";
import { formatDateLongue, formatDateSansAnnee, todayIso } from "@/lib/dates";
import { EnCours } from "@/components/layout/EnCours";
import { AllerALAncre } from "@/components/planning/AllerALAncre";
import { GrillePlanning } from "@/components/planning/GrillePlanning";
import { BoutonPartager } from "@/components/partage/BoutonPartager";
import { partagePlanning } from "@/components/partage/contenu";
import { SelecteurPeriode, type PeriodeOption } from "@/components/filtres/SelecteurPeriode";
import { VoletFiltres } from "@/components/filtres/VoletFiltres";
import { BasculeTemps } from "@/components/filtres/BasculeTemps";
import { ChampDate } from "@/components/filtres/ChampDate";
import { lienTemps, lireDateFiltre, lireQuand, seancesDuJour, selectionnerSeances, valeurQuand, type Quand } from "@/components/filtres/temps";

export const metadata: Metadata = { title: "Planning" };

type Props = { searchParams: Promise<{ periode?: string; h?: string; quand?: string; date?: string; modifier?: string; seances?: string }> };

/**
 * Le temps tel qu'il est lu ici : le sens (à venir / passé), la fenêtre, l'instant de référence —
 * et, quand on en cherche une, **la date précise**, qui prend le pas sur les deux premiers.
 */
type Temps = { quand: Quand; horizon: Horizon; date?: string; seances: string[]; maintenant: Date; aujourdHui: string };

/**
 * Séances retenues : d'abord le sens (à venir par défaut, passé sur demande), puis la fenêtre
 * de temps, qui se lit dans ce sens-là. Un cours du jour déjà commencé est du côté « Passé ».
 *
 * Sauf si une date est cherchée : on rend alors **ce jour-là et rien d'autre**. Croiser la date
 * avec le sens du temps et la fenêtre ne pourrait que vider la grille sur un jour qui existe
 * (le cours du 12 est passé, la fenêtre ne fait qu'une semaine…), ce qui se lirait comme une panne.
 */
function colonnesVisibles(planning: Planning | null, t: Temps): ColonnePlanning[] {
  if (!planning) return [];
  // Les séances cochées dans l'onglet Séances (« Modifier le programme ») : elles, et rien d'autre.
  if (t.seances.length > 0) return planning.colonnes.filter((c) => t.seances.includes(c.id));
  if (t.date) return seancesDuJour(planning.colonnes, t.date);
  return selectionnerSeances(planning.colonnes, t.quand, t.horizon, t.maintenant, t.aujourdHui);
}

/**
 * Les liens des filtres : chacun garde la période affichée et les autres filtres en place.
 *
 * **Aucun ne conserve la date**, et c'est délibéré : changer de sens du temps ou de largeur de
 * fenêtre, ce sont deux commandes qui ne veulent plus rien dire sur un jour unique — les garder
 * ensemble laisserait une grille figée sur une colonne pendant qu'on appuie sur des boutons sans
 * effet. Appuyer dessus vaut donc « rends-moi le planning », et la date s'efface. Le seul chemin
 * qui la conserve est le champ de date lui-même (il la remplace) ; le sélecteur de période
 * l'efface aussi, pour la même raison : on y demande un trimestre, pas un jour.
 */
const liens = (periodeId: string | undefined, t: Temps) => ({
  horizon: (x: Horizon) => lienTemps("/planning", { periode: periodeId, h: x === "periode" ? undefined : x, quand: valeurQuand(t.quand) }),
  quand: (q: Quand) => lienTemps("/planning", { periode: periodeId, h: t.horizon === "periode" ? undefined : t.horizon, quand: valeurQuand(q) }),
  /** Retour au planning ordinaire du trimestre : la date tombe, les autres filtres restent. */
  sansDate: () => lienTemps("/planning", { periode: periodeId, h: t.horizon === "periode" ? undefined : t.horizon, quand: valeurQuand(t.quand) }),
});

type IlotPlanning = { planning: Promise<Planning | null>; choisie: Promise<string | undefined>; temps: Temps };

/**
 * **« Je cherche le cours du 12 »**, sous le choix du trimestre : on a une date en tête et on veut
 * ce jour-là, sans avoir à deviner dans quel trimestre il tombe.
 *
 * Les bornes du calendrier couvrent **toutes les périodes visibles**, pas les séances du trimestre
 * affiché : borner au trimestre courant fermerait au doigt les dates des autres trimestres, c'est-à-dire
 * exactement celles que l'ouverture automatique du trimestre sert à atteindre.
 */
function ChampDatePlanning({ liste, id, temps }: { liste: PeriodeOption[]; id?: string; temps: Temps }) {
  const debuts = liste.map((p) => p.dateDebut).sort();
  const fins = liste.map((p) => p.dateFin).sort();
  return (
    <ChampDate
      valeur={temps.date}
      base="/planning"
      // Mêmes filtres conservés que par le sélecteur de période : changer de jour ne doit faire perdre
      // ni le trimestre regardé ni la fenêtre choisie — ils reprennent la main dès la date effacée.
      params={{
        periode: id,
        h: temps.horizon === "periode" ? undefined : temps.horizon,
        quand: valeurQuand(temps.quand),
      }}
      min={debuts[0]}
      max={fins[fins.length - 1]}
    />
  );
}

/**
 * **Tous les filtres dans un volet replié**, comme l'onglet Séances.
 *
 * Ils occupaient quatre rangées de commandes — saison, trimestre, date, sens du temps, fenêtre —
 * avant la première ligne de la grille, soit plus d'un écran de téléphone dépensé pour des réglages
 * qui conviennent tels quels presque tout le temps. Le résumé du volet dit ce qui est appliqué, donc
 * on voit ce qu'on regarde **sans** l'ouvrir ; et il reste ouvert dès qu'un filtre inhabituel est en
 * place, sinon on cacherait à quelqu'un la raison pour laquelle sa grille semble incomplète.
 *
 * Un seul îlot au lieu de trois : le résumé a besoin du nombre de cours, donc du planning chargé.
 * Ce qu'on y perd en affichage progressif, on le regagne en n'affichant plus trois squelettes qui se
 * remplissent l'un après l'autre à des endroits différents de la page.
 */
async function Filtres({ periodes, planning, choisie, temps, peutCreer }: IlotPlanning & { periodes: Promise<PeriodeOption[]>; peutCreer: boolean }) {
  const [liste, p, id] = await Promise.all([periodes, planning, choisie]);
  const nom = liste.find((x) => x.id === id)?.nom ?? p?.periode.nom;
  const compte = p ? colonnesVisibles(p, temps).length : 0;
  const labels = temps.quand === "passe" ? HORIZON_LABELS_PASSE : HORIZON_LABELS;
  // La date prend la place de la fenêtre dans le résumé : sur un jour nommé, la fenêtre ne dit plus rien.
  const quoi = temps.date ? formatDateSansAnnee(temps.date).toLowerCase() : labels[temps.horizon].toLowerCase();
  const resume = [nom, quoi, `${compte} cours`].filter(Boolean).join(" · ");
  return (
    <VoletFiltres resume={resume} ouvert={temps.horizon !== "periode" || temps.quand === "passe" || Boolean(temps.date)}>
      {/* Quoi regarder : la saison, puis le trimestre dedans — les filtres de temps, plus bas, disent jusqu'où */}
      <SelecteurPeriode
        periodes={liste}
        valeur={id ?? ""}
        aujourdHui={temps.aujourdHui}
        base="/planning"
        peutCreer={peutCreer}
        // La date n'est volontairement pas reconduite : choisir un trimestre, c'est demander à le voir
        // en entier, et une date d'un autre trimestre n'y aurait de toute façon aucun cours à montrer.
        params={{
          ...(temps.horizon === "periode" ? {} : { h: temps.horizon }),
          ...(temps.quand === "passe" ? { quand: "passe" } : {}),
        }}
      />
      <ChampDatePlanning liste={liste} id={id} temps={temps} />
      {p && p.colonnes.length > 0 && (
        // Le sens d'abord, la fenêtre ensuite : même rangée dès qu'il y a la place, sinon l'une sous l'autre
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <BasculeTemps quand={temps.quand} href={liens(id, temps).quand} />
          <SelecteurHorizon horizon={temps.horizon} href={liens(id, temps).horizon} passe={temps.quand === "passe"} compte={compte} />
        </div>
      )}
    </VoletFiltres>
  );
}

/**
 * Ce qui reste **hors** du volet : la phrase qui explique une grille courte, et le partage.
 *
 * La phrase d'abord — sans elle, personne ne comprend pourquoi la grille tient sur une seule ligne,
 * et la cacher derrière un volet replié serait précisément la cacher à qui se pose la question. Le
 * partage ensuite : c'est une action, pas un réglage, et il n'a rien à faire parmi les filtres.
 */
async function SousLesFiltres({ planning, temps }: Omit<IlotPlanning, "choisie">) {
  const p = await planning;
  if (!p) return null;
  // Ce que le lien public montrera : les séances d'aujourd'hui et à venir de la période, la plus proche en tête
  const aVenir = p.colonnes.filter((c) => c.date >= temps.aujourdHui);
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {temps.seances.length > 0 && (
        <p className="w-full text-sm text-texte-secondaire">
          <span className="font-semibold text-texte">
            {temps.seances.length === 1 ? "La séance choisie" : `Les ${temps.seances.length} séances choisies`}
          </span>{" "}
          dans l&apos;onglet Séances, et elles seules.{" "}
          <Link href={lienPlanning({ periode: p.periode.id }, false)}>Voir tout le planning</Link>
        </p>
      )}
      {temps.date && temps.seances.length === 0 && (
        <p className="w-full text-sm text-texte-secondaire">
          <span className="font-semibold text-texte">{formatDateLongue(temps.date)}</span> — seul ce jour est affiché.
          Changer le sens du temps ou la fenêtre dans les filtres ramène le planning du trimestre.
        </p>
      )}
      {/* Partager la période affichée : ouvert à tous ceux qui voient le planning — le lien ne montre
          que le résumé public (dates, lieux, thèmes, chiffres globaux), jamais un nom. */}
      <BoutonPartager
        partage={partagePlanning({ periodeId: p.periode.id, periodeNom: p.periode.nom, aVenir: aVenir.length, prochaine: aVenir[0] ?? null })}
        taille="petite"
        libelle="Partager le planning"
      />
    </div>
  );
}

/** « Modifier le planning », pour qui a le droit de remplir les cases — sous le titre, comme partout. */
async function EntreePlanning({ planning, lien }: { planning: Promise<Planning | null>; lien: string }) {
  const p = await planning;
  if (!p?.modifiable) return null;
  return <EntreeModification href={lien}>Modifier le planning</EntreeModification>;
}

/**
 * Rien à montrer de ce côté-ci : on nomme le côté où l'on est et on tend l'autre,
 * plutôt que de laisser la page vide (`GrillePlanning` garde son état « fenêtre trop étroite »).
 */
function EtatVide({ quand, autre }: { quand: Quand; autre: string }) {
  const passe = quand === "passe";
  return (
    <Alerte type="info" titre={passe ? "Aucun cours passé dans cette fenêtre" : "Aucun cours à venir dans cette période"}>
      <p>{passe ? "Élargis la fenêtre de temps au-dessus, ou reviens aux cours à venir." : "Tous les cours de la période ont déjà eu lieu."}</p>
      <p className="mt-3">
        <LienBouton href={autre} variante="secondaire" taille="petite" enCours>
          <Icone nom="calendrier" taille={18} />
          {passe ? "Revenir aux cours à venir" : "Voir les cours passés"}
        </LienBouton>
      </p>
    </Alerte>
  );
}

/** La grille elle-même : c'est la partie lourde (une ligne par séance, quatre cases chacune). */
async function CorpsPlanning({
  planning,
  temps,
  gestion,
  modeEdition,
  lienLecture,
}: Omit<IlotPlanning, "choisie"> & { gestion: boolean; modeEdition: boolean; lienLecture: string }) {
  const p = await planning;
  if (!p)
    return (
      <Alerte type="info" titre="Aucune période">
        Le planning apparaîtra dès qu&apos;une période sera créée.
      </Alerte>
    );
  if (p.colonnes.length === 0)
    return (
      <Alerte type="info" titre="Aucune séance">
        Les séances de « {p.periode.nom} » ne sont pas encore générées.
      </Alerte>
    );
  const colonnes = colonnesVisibles(p, temps);
  // Une date cherchée qui ne tombe sur aucun cours : on le dit, avec la date en toutes lettres.
  // Deux façons d'arriver là, et la phrase vaut pour les deux : un jour sans cours dans ce trimestre,
  // ou une date qu'aucun trimestre visible ne couvre (l'ouverture automatique n'a alors rien trouvé et
  // on est resté sur le trimestre habituel). Dans les deux cas, une grille vide se lirait comme une panne.
  if (temps.date && colonnes.length === 0) {
    return (
      <Alerte type="info" titre={`Aucun cours le ${formatDateLongue(temps.date).toLowerCase()}`}>
        <p>Choisis une autre date, ou efface-la pour revenir au planning du trimestre.</p>
        <p className="mt-3">
          <LienBouton href={liens(p.periode.id, temps).sansDate()} variante="secondaire" taille="petite" enCours>
            <Icone nom="calendrier" taille={18} />
            Revenir au planning
          </LienBouton>
        </p>
      </Alerte>
    );
  }
  // « Aucun cours dans cette fenêtre » (GrillePlanning) ne vaut que si la fenêtre peut encore s'élargir :
  // sur la période entière, c'est le côté du temps qu'il faut changer, pas la fenêtre.
  if (colonnes.length === 0 && (temps.quand === "passe" || temps.horizon === "periode")) {
    const autre = liens(p.periode.id, temps).quand(temps.quand === "passe" ? "avenir" : "passe");
    return <EtatVide quand={temps.quand} autre={autre} />;
  }
  return (
    <>
      <GrillePlanning planning={p} gestion={gestion} colonnes={colonnes} modeEdition={modeEdition} lienLecture={lienLecture} />
      {/* Rendu **avec** la grille, donc monté une fois la ligne visée présente : c'est tout ce qui
          permet de suivre l'ancre `#seance-…` d'un bouton « Programme de la séance ». */}
      <AllerALAncre />
    </>
  );
}

/**
 * Planning de cours : comme la feuille du club, **une ligne par séance**, pleine largeur, et
 * autant de parties que la séance en compte — des cours (« Cours 1 », « Cours 2 »…) et des
 * options (« Option 1 »…), en nombre libre, chacune avec son instructeur, son second, son thème
 * et son niveau.
 * L'équipe (admins, instructeurs) remplit les cases — chaque changement est journalisé ; les membres consultent.
 *
 * Deux filtres de temps, les mêmes que sur les autres écrans : la bascule « À venir / Passé » dit de
 * quel côté d'aujourd'hui on se place (à venir par défaut : les cours écoulés ne se montrent que si
 * on les demande), la fenêtre — « Toute la période » … « Prochain cours » — dit jusqu'où.
 *
 * **Rien n'est attendu ici** au-delà de l'identité de la personne : le titre part avec le premier
 * octet, puis chaque îlot (`<Suspense>`) arrive quand ses données sont là — les sélecteurs d'abord,
 * la grille, plus lourde, ensuite. Chacun montre entre-temps le squelette de sa propre forme.
 */
export default async function PagePlanning({ searchParams }: Props) {
  const user = await requireUser();
  const { periode, h, quand, date, modifier, seances } = await searchParams;
  /*
   * **Le mode modification du planning vit dans l'URL**. Comme le trimestre, la fenêtre de temps et
   * la date cherchée : le retour du navigateur sort du mode, un lien se partage tel qu'on le lit,
   * et « Annuler » n'a alors rien à défaire — il quitte l'adresse, et le brouillon du navigateur
   * part avec elle sans avoir touché la base.
   *
   * Les deux liens se construisent ici, là où les filtres sont connus : entrer en modification ne
   * doit pas faire perdre le trimestre, l'horizon ni la date qu'on regardait.
   */
  const modeEdition = modeEditionDemande(modifier);
  const seancesChoisies = lireSeancesChoisies(seances);
  const lienMode = (edition: boolean) => lienPlanning({ periode, h, quand, date, seances: seancesChoisies.join(",") || undefined }, edition);
  const admin = can(user, "audit.view");
  const maintenant = new Date();
  // Une date illisible (forme fausse, 31 février) vaut date absente : l'écran retombe sur son
  // affichage habituel plutôt que de filtrer sur un jour que personne ne peut atteindre.
  const dateCherchee = lireDateFiltre(date);
  const temps: Temps = { quand: lireQuand(quand), horizon: lireHorizon(h), date: dateCherchee, seances: seancesChoisies, maintenant, aujourdHui: todayIso(maintenant) };
  // Promesses volontairement non attendues : elles sont remises aux îlots ci-dessous.
  // Périodes proposées : uniquement celles où la personne a été invitée (l'équipe les voit toutes),
  // exactement comme l'onglet Séances. Closes comprises : on doit pouvoir revenir sur un trimestre
  // terminé (en lecture seule). Le filtre n'est pas qu'un confort d'affichage — `chargerPlanning`
  // le revérifie, un identifiant forgé dans l'URL ne montre donc rien.
  const periodes: Promise<PeriodeOption[]> = db.period.findMany({
    where: periodesVisiblesPar(user),
    orderBy: { dateDebut: "desc" },
    select: { id: true, nom: true, statut: true, dateDebut: true, dateFin: true },
  });
  const choisie: Promise<string | undefined> = (async () => {
    /*
     * **Le trimestre qui contient la date s'ouvre tout seul, et passe même avant le `?periode=`.**
     *
     * C'est ce qui rend la recherche par date utilisable : chercher le 12 février depuis le
     * trimestre d'automne rendrait sinon une grille vide alors que le cours existe, et rien à
     * l'écran ne dirait qu'il fallait d'abord changer de trimestre.
     *
     * Et il **faut** que ce soit prioritaire : le champ de date reconduit le trimestre regardé dans
     * l'URL (comme tous les filtres de cet écran), si bien qu'un `?periode=` est presque toujours
     * là. Le respecter ferait échouer le cas même que cette fonctionnalité sert — et le texte du
     * champ le promet sans condition. Rien n'est caché : le sélecteur affiche le trimestre retenu,
     * et effacer la date rend l'écran à celui qu'on avait demandé.
     *
     * La liste des périodes est déjà celle où la personne a sa place : l'ouverture automatique
     * n'ouvre donc aucune porte qui lui serait fermée, et `chargerPlanning` le revérifie.
     */
    if (dateCherchee) {
      const contenante = (await periodes).find((p) => p.dateDebut <= dateCherchee && dateCherchee <= p.dateFin);
      if (contenante) return contenante.id;
    }
    // Un trimestre nommé dans l'URL est un choix de la personne : il passe avant le trimestre par défaut.
    if (periode) return periode;
    // Aucun trimestre visible ne couvre ce jour : on reste sur celui qu'on aurait montré de toute
    // façon, et c'est la grille qui dit « aucun cours ce jour-là ».
    return (await periodePlanningParDefaut(user))?.id;
  })();
  const planning: Promise<Planning | null> = choisie.then((id) => (id ? chargerPlanning(id, user) : null));

  return (
    /*
     * **L'élargissement est ici, sur l'écran entier, et une seule fois**.
     *
     * Il vivait dans `GrillePlanning`, c'est-à-dire sur les seules cartes : le titre, le journal
     * des modifications, le volet des filtres et les boutons de partage restaient dans la colonne
     * de lecture pendant que les séances juste dessous faisaient 90 rem. Deux alignements sur la
     * même page — et les trois onglets principaux qui ne commençaient pas au même endroit, alors
     * que la règle demandée était justement d'être « uniforme sur l'horizontalité ». Comme un
     * filtre sans résultat remplace la grille par une alerte, donc par un autre conteneur, la
     * largeur du contenu sautait en plus d'un filtre à l'autre.
     */
    <div className={`flex flex-col gap-5 ${PLEINE_LARGEUR}`}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-3xl">Planning de cours</h1>
        {admin && (
          // Le journal vit dans l'espace admin, derrière l'élévation : un administrateur entré par son
          // lien personnel sera d'abord renvoyé sur /connexion/admin. Le libellé le dit, comme « Mon profil »,
          // plutôt que de laisser la demande de mot de passe arriver en surprise.
          <Link href="/admin/audit?q=planning.case" className="inline-flex items-center gap-2 text-sm">
            Journal des modifications (mot de passe admin)
            <EnCours taille={14} />
          </Link>
        )}
      </div>

      {/* L'entrée en modification, à la place commune à tous les onglets : sous le titre. */}
      {!modeEdition && (
        <Suspense fallback={null}>
          <EntreePlanning planning={planning} lien={lienMode(true)} />
        </Suspense>
      )}

      <Suspense fallback={<SelecteurPeriodeSquelette />}>
        <Filtres periodes={periodes} planning={planning} choisie={choisie} temps={temps} peutCreer={can(user, "periods.manage")} />
      </Suspense>

      <Suspense fallback={<SelecteurHorizonSquelette />}>
        <SousLesFiltres planning={planning} temps={temps} />
      </Suspense>
      <Suspense fallback={<TableauSquelette colonnes={5} lignes={8} />}>
        <CorpsPlanning
          planning={planning}
          temps={temps}
          gestion={can(user, "sessions.manage")}
          modeEdition={modeEdition}
          lienLecture={lienMode(false)}
        />
      </Suspense>
    </div>
  );
}
