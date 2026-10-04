import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { repondreDepuisLien } from "@/actions/seances";
import { requireUser, type CurrentUser } from "@/lib/auth/current-user";
import { db } from "@/lib/db";
import { can, isStaff } from "@/lib/permissions";
import { identite } from "@/lib/identite";
import { formatDateLongue, formatDateSansAnnee, formatHoraire, minuscule, seanceCommencee, todayIso } from "@/lib/dates";
import { prochainesSeances, seancesDePeriode, type SeanceCarte } from "@/lib/seances";
import { Alerte } from "@/components/ui/Alerte";
import { LienBouton } from "@/components/ui/Bouton";
import { Carte } from "@/components/ui/Carte";
import { FormulaireAction } from "@/components/ui/FormulaireAction";
import { Icone } from "@/components/ui/Icone";
import { Bloc, CarteSquelette, SelecteurPeriodeSquelette } from "@/components/ui/Squelette";
import { ActionsEquipe } from "@/components/seances/ActionsEquipe";
import { CarteSeance } from "@/components/seances/CarteSeance";
import { ListeSeances } from "@/components/seances/ListeSeances";
import { Historique } from "@/components/presences/Historique";
import { SelecteurHorizon } from "@/components/ui/SelecteurHorizon";
import { SelecteurPeriode, type PeriodeOption } from "@/components/filtres/SelecteurPeriode";
import { ChampDate } from "@/components/filtres/ChampDate";
import { VoletFiltres } from "@/components/filtres/VoletFiltres";
import { periodePertinente } from "@/components/filtres/saisons";
import { lireDateFiltre, lireQuand, seancesDuJour, selectionnerSeances, valeurQuand, type Quand } from "@/components/filtres/temps";
import { HORIZON_LABELS, HORIZON_LABELS_PASSE, lireHorizon, type Horizon } from "@/lib/horizon";
import { DeuxColonnes, LARGEUR_PAGE } from "@/components/ui/DeuxColonnes";

export const metadata: Metadata = { title: "Séances" };

type Props = {
  searchParams: Promise<{
    mdp?: string;
    acces?: string;
    vue?: string;
    quand?: string;
    h?: string;
    date?: string;
    periode?: string;
    seance?: string;
    reponse?: string;
    note?: string;
    s?: string;
    tout?: string;
  }>;
};

/**
 * Ce que l'écran regarde : la vue, le sens du temps, la fenêtre, l'instant de référence — et, quand
 * on cherche un jour précis, `date`, qui prend le pas sur le sens du temps et sur la fenêtre.
 */
type Vue = {
  historique: boolean;
  quand: Quand;
  horizon: Horizon;
  maintenant: Date;
  aujourdHui: string;
  periode?: string;
  /** Jour cherché (`AAAA-MM-JJ`), déjà validé : une date illisible vaut une date absente. */
  date?: string;
};

/** « present » / « absent » des boutons du récap de la veille ; toute autre valeur est ignorée. */
function statutDemande(reponse: string | undefined): "PRESENT" | "ABSENT" | null {
  return reponse === "present" ? "PRESENT" : reponse === "absent" ? "ABSENT" : null;
}

/** « Mardi 29 septembre 2026 » → « mardi 29 septembre » (la confirmation est une phrase). */
function jourSansAnnee(iso: string): string {
  const jour = formatDateLongue(iso).replace(/\s\d{4}$/, "");
  return minuscule(jour);
}

/**
 * La requête lourde de l'écran : les séances à montrer, et la période dont elles viennent.
 *
 * - une date cherchée : **le trimestre qui la contient**, quoi que dise le reste de l'URL ;
 * - une période choisie : toute la période (la bascule et la fenêtre trient ensuite) ;
 * - « Passé » sans période choisie : la période pertinente, sinon il n'y aurait rien à montrer ;
 * - sinon : les prochains cours de la personne, toutes périodes actives confondues.
 *
 * **Pourquoi la date passe devant la période :** les séances ne sont chargées que trimestre par
 * trimestre. Chercher le 12 décembre depuis le T1 ne rendrait donc rien du tout — une liste vide sur
 * une date qui existe, ce qui se lit comme une panne et non comme un filtre. Le champ de date le dit
 * d'ailleurs sans condition (« le trimestre qui contient cette date s'ouvre tout seul ») : il tient
 * parole même quand un `periode=` traîne dans l'URL, hérité du sélecteur juste au-dessus. Rien n'est
 * caché au passage — le sélecteur de période affiche le trimestre retenu, et effacer la date rend
 * l'écran à la période demandée.
 *
 * Aucun trimestre ne contient la date ? On garde le chargement habituel : la liste sera vide, et
 * c'est `Liste` qui le dira en une phrase (`horsPeriode`) plutôt que de laisser un écran muet.
 */
async function chargerSeances(periodes: Promise<PeriodeOption[]>, user: CurrentUser, vue: Vue) {
  const liste = await periodes;
  const demandee = liste.find((p) => p.id === vue.periode) ?? null;
  // Les dates des périodes sont des ISO `AAAA-MM-JJ` : l'ordre alphabétique y est l'ordre du calendrier.
  const contenantDate = vue.date ? (liste.find((p) => p.dateDebut <= vue.date! && vue.date! <= p.dateFin) ?? null) : null;
  const choisie = contenantDate ?? demandee;
  const periodeLue = choisie ?? (vue.quand === "passe" ? (periodePertinente(liste, vue.aujourdHui) ?? null) : null);
  const toutes: SeanceCarte[] = vue.historique ? [] : periodeLue ? await seancesDePeriode(periodeLue.id, user) : await prochainesSeances(user);
  return {
    choisie,
    periodeLue,
    toutes,
    /** Une date est cherchée, mais aucun trimestre visible ne la contient : à dire, pas à taire. */
    horsPeriode: Boolean(vue.date) && !contenantDate,
    // Un jour nommé se suffit : ni le sens du temps ni la fenêtre n'ont plus rien à dire dessus.
    seances: vue.date ? seancesDuJour(toutes, vue.date) : selectionnerSeances(toutes, vue.quand, vue.horizon, vue.maintenant, vue.aujourdHui),
  };
}

type Contenu = Awaited<ReturnType<typeof chargerSeances>>;

/**
 * **L'écran que le lien de l'email ouvre : il montre ce qui sera écrit, et attend un appui.**
 *
 * Cette page **écrivait la réponse pendant son propre rendu**, sur un simple GET
 * (`?seance=…&reponse=present`). C'est la troisième fois que le dépôt rencontre cette famille de
 * défaut — après l'ouverture d'invitation et la désinscription — et l'argument est déjà écrit dans
 * CLAUDE.md : « un GET ne consomme rien ; c'est l'appui qui pose la session. Sans ce découpage, les
 * messageries qui préchargent les liens (Safe Links, antivirus) “ouvriraient” chaque lien ». Ici, ce
 * qu'un antivirus de messagerie ouvrait, c'était **une réponse de présence donnée à la place du
 * membre** : le club comptait un présent qui n'avait pas lu son email, et ce chiffre nourrit ensuite
 * les taux et les bilans.
 *
 * Le découpage est le même que celui de `/invitation/[token]` et de `/desinscription/[token]` : le
 * GET regarde, le POST écrit (`repondreDepuisLien`, src/actions/seances.ts). **Deux taps depuis
 * l'email** — le lien, puis le bouton —, ce que CLAUDE.md exige ; et rien ne change pour quelqu'un
 * déjà connecté, qui arrive directement ici sans repasser par la connexion.
 *
 * La lecture est **cadrée sur la personne** (invitée sur le trimestre de la séance) : on n'affiche
 * pas la date et le lieu d'un cours à quelqu'un qui n'y est pas invité. Ce n'est pas la garde de
 * l'écriture — elle reste entière dans `indiquerPresence`, appelée par le bouton — c'est la portée de
 * ce qu'on met à l'écran. Les trois refus annoncés ici le sont **avant** l'appui, pour ne pas faire
 * miroiter une réponse que le serveur refuserait ensuite.
 */
async function ConfirmationDemande({ sessionId, statut, userId }: { sessionId: string; statut: "PRESENT" | "ABSENT"; userId: string }) {
  const seance = await db.session.findFirst({
    where: { id: sessionId, period: { membres: { some: { userId } } } },
    select: { id: true, date: true, heureDebut: true, heureFin: true, lieu: true, annulee: true },
  });
  const refus = !seance
    ? "Cette séance n'est pas disponible : elle n'existe plus, ou tu n'es pas invité(e) sur son trimestre."
    : seance.annulee
      ? "Cette séance est annulée : il n'y a plus de réponse à donner."
      : seanceCommencee(seance.date, seance.heureDebut)
        ? "Le cours a déjà commencé : la réponse n'est plus modifiable."
        : null;
  const vient = statut === "PRESENT";
  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-[1.375rem] sm:text-3xl">{vient ? "Tu viens ?" : "Tu ne viens plus ?"}</h1>
      {refus || !seance ? (
        <Alerte type="erreur" titre="Réponse impossible">
          <p>{refus}</p>
        </Alerte>
      ) : (
        <Carte titre={formatDateLongue(seance.date)}>
          <FormulaireAction
            action={repondreDepuisLien}
            bouton={vient ? "Oui, je viens" : "Oui, je ne viens plus"}
            variante={vient ? "succes" : "danger"}
            enCours="Un instant…"
            // L'action invalide déjà `/seances` (via `indiquerPresence`) et redirige ensuite :
            // redemander la page par-dessus ne servirait à rien.
            rafraichirApresSucces={false}
          >
            <input type="hidden" name="sessionId" value={seance.id} />
            <input type="hidden" name="statut" value={statut} />
            <p className="text-texte-secondaire">
              {formatHoraire(seance.heureDebut, seance.heureFin)} · {seance.lieu}
            </p>
            <p>
              Un appui, et c&apos;est noté : <strong>{vient ? "tu viens" : "tu ne viens plus"}</strong> à ce cours.
            </p>
            <p className="text-sm text-texte-secondaire">Rien n&apos;est enregistré tant que tu n&apos;as pas appuyé.</p>
          </FormulaireAction>
        </Carte>
      )}
      <p className="text-sm">
        <Link href="/seances" className="inline-flex min-h-12 items-center">
          {refus ? "Voir mes cours" : "Ne rien changer, voir mes cours"}
        </Link>
      </p>
    </div>
  );
}

/** Confirmation de la réponse venue d'un email : relue en base, jamais déduite de l'URL. */
async function Confirmation({ contenu, note, s }: { contenu: Promise<Contenu>; note?: string; s?: string }) {
  const statut = statutDemande(note);
  if (!statut || !s) return null;
  const { toutes } = await contenu;
  const seance = toutes.find((x) => x.id === s && x.monStatut === statut);
  if (!seance) return null;
  return (
    <Alerte type="succes">
      C&apos;est noté : tu {statut === "PRESENT" ? "viens" : "ne viens pas"} {jourSansAnnee(seance.date)}.
    </Alerte>
  );
}

/**
 * L'action d'organisation de cet écran : elle emporte la période affichée, il lui faut donc son
 * identifiant. Pas la date : ce bouton ouvre un **trimestre** — le formulaire d'une nouvelle séance
 * —, jamais un jour. Y glisser la date en douce ferait arriver le formulaire filtré sur un jour
 * qu'on n'a pas redemandé.
 *
 * **Le bouton « Planning » est parti**. Il doublait l'onglet « Planning » de l'en-tête, présent sur
 * tous les écrans et à la même portée de pouce : deux chemins vers la même page, dont l'un occupait
 * la rangée des actions juste sous les filtres. Et depuis que chaque carte porte « Programme de la
 * séance », le planning se rejoint aussi **depuis la séance qu'on regarde**, ce qui est le chemin
 * qu'on emprunte vraiment.
 *
 * Elle n'est montrée qu'à l'encadrement (`sessions.manage`, vérifié côté serveur au rendu), et la
 * page d'arrivée redemande la même permission : un membre qui taperait l'adresse à la main est
 * renvoyé à l'accueil.
 */
async function ActionsOrganisation({ contenu }: { contenu: Promise<Contenu> }) {
  const { periodeLue, toutes } = await contenu;
  const id = periodeLue?.id ?? toutes[0]?.periodId;
  return (
    <LienBouton href={`/seances/nouvelle${id ? `?periode=${id}` : ""}`} taille="petite" enCours>
      Nouvelle séance
    </LienBouton>
  );
}

/**
 * Tous les filtres au même endroit, dans un volet replié : la saison et la période, puis le jour
 * précis, puis la fenêtre de temps. Le résumé du volet dit ce qui est appliqué — période affichée,
 * fenêtre (ou date cherchée), et nombre de cours retenus —, ce qui évite de l'ouvrir pour le savoir.
 */
async function Filtres({
  periodes,
  contenu,
  vue,
  peutCreer,
  lien,
}: {
  periodes: Promise<PeriodeOption[]>;
  contenu: Promise<Contenu>;
  vue: Vue;
  peutCreer: boolean;
  lien: (extra?: Record<string, string | undefined>) => string;
}) {
  const [liste, { choisie, periodeLue, toutes, seances }] = await Promise.all([periodes, contenu]);
  const periodeAffichee = choisie ?? periodeLue ?? liste.find((p) => p.id === toutes[0]?.periodId);
  const labels = vue.quand === "passe" ? HORIZON_LABELS_PASSE : HORIZON_LABELS;
  // Sur un jour unique, annoncer « tout le trimestre » ou « 2 semaines » serait faux : la fenêtre
  // n'a plus cours. Le résumé dit donc la date, en toutes lettres — sans l'année, que le nom du
  // trimestre porte déjà juste à côté, et parce que cette ligne est tronquée sur un téléphone.
  const filtreLisible = vue.date ? formatDateSansAnnee(vue.date).toLowerCase() : labels[vue.horizon].toLowerCase();
  const resume = [periodeAffichee?.nom, filtreLisible, `${seances.length} cours`].filter(Boolean).join(" · ");
  // Bornes du calendrier : le premier et le dernier jour des trimestres visibles par cette personne —
  // exactement ce que l'écran sait ouvrir. Borner sur les dates de séance serait plus serré mais
  // trompeur dans l'autre sens : un jour sans cours *dans* un trimestre se dit en une phrase, alors
  // qu'un jour hors des trimestres ne mène nulle part et n'a rien à faire dans le calendrier.
  const premierJour = liste.reduce<string | undefined>((min, p) => (!min || p.dateDebut < min ? p.dateDebut : min), undefined);
  const dernierJour = liste.reduce<string | undefined>((max, p) => (!max || p.dateFin > max ? p.dateFin : max), undefined);
  // Les filtres que la date emmène avec elle. La période en fait partie : elle reste dans l'URL et
  // reprend la main dès qu'on efface la date — on retrouve alors l'écran qu'on avait quitté —, même
  // si, tant qu'un jour est nommé, c'est le trimestre qui contient ce jour qui s'ouvre.
  const autresFiltres = {
    ...(periodeAffichee ? { periode: periodeAffichee.id } : {}),
    ...(vue.horizon === "periode" ? {} : { h: vue.horizon }),
    ...(vue.quand === "passe" ? { quand: "passe" } : {}),
  };
  return (
    // Volet laissé ouvert dès qu'une date est posée, comme pour une fenêtre inhabituelle : une liste
    // réduite à un seul cours doit montrer sa raison, sinon elle passe pour une panne.
    <VoletFiltres resume={resume} ouvert={vue.horizon !== "periode" || Boolean(vue.date)}>
      <SelecteurPeriode
        periodes={liste}
        valeur={periodeAffichee?.id ?? ""}
        aujourdHui={vue.aujourdHui}
        base="/seances"
        peutCreer={peutCreer}
        // Volontairement sans la date : changer de trimestre à la main, c'est demander à revoir un
        // trimestre entier, pas à retrouver le même jour ailleurs.
        params={{ ...(vue.horizon === "periode" ? {} : { h: vue.horizon }), ...(vue.quand === "passe" ? { quand: "passe" } : {}) }}
      />
      {/* Le jour précis vient juste après la période : les deux disent *quoi* regarder, la fenêtre
          qui suit dit seulement *jusqu'où* — et se retrouve sans objet dès qu'un jour est nommé. */}
      <ChampDate valeur={vue.date} base="/seances" params={autresFiltres} min={premierJour} max={dernierJour} />
      <SelecteurHorizon
        horizon={vue.horizon}
        href={(x) => lien({ h: x === "periode" ? undefined : x, quand: valeurQuand(vue.quand) })}
        passe={vue.quand === "passe"}
      />
    </VoletFiltres>
  );
}

/** La fenêtre de temps et les cartes : tout ce qui dépend de la requête lourde, dans un seul îlot. */
async function Liste({ contenu, vue, equipe, lien }: { contenu: Promise<Contenu>; vue: Vue; equipe: boolean; lien: (extra?: Record<string, string | undefined>) => string }) {
  // La part minimale d'effectif du club, pour la jauge de chaque carte : `BarreTaux` est un
  // composant client et ne peut pas la lire lui-même (voir `src/lib/constants.ts`). Lecture mise en
  // cache pour la durée de la requête, déjà faite par la mise en page racine.
  const { partEffectifMin } = await identite();
  const { choisie, horsPeriode, toutes, seances } = await contenu;
  // Un jour cherché répond d'abord pour lui-même : « il n'y a rien ce jour-là » est une réponse,
  // une page vide n'en est pas une. Ce message passe avant ceux de la période et de la fenêtre, qui
  // parleraient de filtres que la date vient justement de mettre de côté.
  if (vue.date && seances.length === 0) {
    return (
      <Alerte type="info" titre={`Aucun cours le ${jourSansAnnee(vue.date)}`}>
        <p>
          {horsPeriode
            ? "Cette date ne tombe dans aucun trimestre ouvert pour toi : il n'y a rien à afficher ce jour-là."
            : "Ce jour-là ne porte aucun cours. Choisis une autre date au-dessus, ou reviens à la liste complète."}
        </p>
        <p className="mt-3">
          <LienBouton
            href={lien({ quand: valeurQuand(vue.quand), h: vue.horizon === "periode" ? undefined : vue.horizon })}
            variante="secondaire"
            taille="petite"
          >
            <Icone nom="calendrier" taille={18} />
            Revenir à la liste
          </LienBouton>
        </p>
      </Alerte>
    );
  }
  // Une période terminée n'a plus rien « à venir » : plutôt qu'une page vide, la carte d'information
  // renvoie d'un clic sur le passé, là où ses séances se trouvent réellement.
  const passeesDisponibles = vue.quand === "avenir" && toutes.some((x) => seanceCommencee(x.date, x.heureDebut, vue.maintenant));
  if (toutes.length === 0) {
    return choisie ? (
      <Alerte type="info" titre={`Aucun cours dans « ${choisie.nom} »`}>
        <p>Choisis une autre période au-dessus, ou regarde tes cours passés dans « Mon historique ».</p>
        <p className="mt-3">
          <LienBouton href={lien({ vue: "historique" })} variante="secondaire" taille="petite">
            <Icone nom="calendrier" taille={18} />
            Voir mon historique
          </LienBouton>
        </p>
      </Alerte>
    ) : (
      <Alerte type="info" titre="Aucun cours prévu pour l&apos;instant">
        Tu recevras un email dès qu&apos;un nouveau trimestre sera ouvert. Rien à faire d&apos;ici là.
      </Alerte>
    );
  }
  return (
    <>
      {seances.length === 0 ? (
        <Alerte type="info" titre={vue.quand === "passe" ? "Aucun cours passé dans cette fenêtre" : "Aucun cours à venir dans cette fenêtre"}>
          <p>
            {passeesDisponibles
              ? "Ces cours ont déjà eu lieu : regarde du côté de « Passé »."
              : "Choisis « Toute la période » au-dessus pour voir tous les cours de la période."}
          </p>
          <p className="mt-3">
            <LienBouton href={passeesDisponibles ? lien({ quand: "passe" }) : lien({ quand: valeurQuand(vue.quand) })} variante="secondaire" taille="petite">
              <Icone nom="calendrier" taille={18} />
              {passeesDisponibles ? "Voir les cours passés" : "Voir toute la période"}
            </LienBouton>
          </p>
        </Alerte>
      ) : (
        <ListeSeances
          cartes={seances.map((x) => (
            <CarteSeance
              key={x.id}
              seance={x}
              aujourdHui={vue.aujourdHui}
              partEffectifMin={partEffectifMin}
              actions={equipe ? <ActionsEquipe id={x.id} annulee={x.annulee} passee={seanceCommencee(x.date, x.heureDebut, vue.maintenant)} /> : undefined}
            />
          ))}
        />
      )}
    </>
  );
}

/**
 * Même gabarit que l'écran d'attente de la route : la forme des cartes, sans rien inventer.
 *
 * Il ne porte **aucun élargissement** : celui de la page l'englobe déjà (voir `PageSeances`), et en
 * remettre un ici décalerait le squelette de la liste qui le remplace.
 */
function ListeSquelette() {
  return (
    <div className="flex flex-col gap-4">
      {Array.from({ length: 3 }, (_, i) => (
        <CarteSquelette key={i} titre={false}>
          <Bloc className="h-6 w-56" />
          <Bloc className="mt-2 h-4 w-44" />
          <Bloc className="mt-4 h-12 w-full rounded-xl" />
          <Bloc className="mt-3 h-8 w-40" />
          <Bloc className="mt-2 h-3 w-full rounded-full" />
        </CarteSquelette>
      ))}
    </div>
  );
}

/**
 * **Onglet Séances** — l'écran unique des séances, pour tout le monde.
 *
 * Il y avait deux listes des mêmes cours : celle des membres (`/presences`, les trois boutons de
 * réponse) et celle de l'équipe (`/gestion/seances`, modifier et annuler). Deux écrans à tenir à
 * jour, deux endroits où chercher. Il n'y en a plus qu'un : **la carte est la même pour tous**, et
 * l'encadrement y trouve en pied les actions d'organisation. Les deux anciennes adresses ne sont
 * plus que des redirections vers ici — des emails et des favoris les portent encore.
 *
 * La garde est donc la plus large — tout compte connecté entre —, et ce sont les **permissions
 * vérifiées ici, côté serveur**, qui décident de ce qui s'affiche : `sessions.manage` pour les
 * actions d'édition. Rien n'est envoyé au navigateur puis masqué en CSS, et les actions serveur
 * refusent de leur côté : ce qui est caché ici n'est pas seulement invisible, il est interdit.
 *
 * Trois vues, une seule bascule : **À venir** (par défaut), **Passé**, **Mon historique** (le
 * récapitulatif personnel, période par période) — la réunion des deux bascules d'avant.
 *
 * Comme les autres écrans lourds, il n'attend pas ses données : le titre, la bascule et les
 * alertes partent avec le premier octet, les sélecteurs et les cartes suivent dans leurs îlots.
 */
export default async function PageSeances({ searchParams }: Props) {
  const { mdp, acces, vue: vueDemandee, quand, h, date, periode, seance, reponse, note, s, tout } = await searchParams;
  // Réponse en un clic depuis l'email : sans session, on demande à revenir ici après l'accès.
  // (Aujourd'hui c'est le requireUser() de (app)/layout.tsx, rendu avant la page, qui envoie
  // sur /connexion sans « suite » : la réponse s'applique au retour sur ce même lien.)
  const demande = seance ? statutDemande(reponse) : null;
  const user = await requireUser(demande ? `/seances?seance=${encodeURIComponent(seance!)}&reponse=${reponse}` : undefined);
  // **Le lien de l'email n'écrit plus rien en arrivant** : il ouvre l'écran de confirmation, et c'est
  // son bouton (POST) qui enregistre. Voir `ConfirmationDemande` pour le pourquoi.
  if (seance && demande) return <ConfirmationDemande sessionId={seance} statut={demande} userId={user.id} />;
  const equipe = can(user, "sessions.manage");
  const maintenant = new Date();
  const vue: Vue = {
    historique: vueDemandee === "historique",
    quand: lireQuand(quand),
    horizon: lireHorizon(h),
    maintenant,
    aujourdHui: todayIso(maintenant),
    periode,
    // Une date illisible (forme fantaisiste, 31 février) est traitée comme une date absente :
    // l'écran retombe sur ce qu'il montre d'habitude plutôt que de filtrer sur un jour impossible.
    date: lireDateFiltre(date),
  };
  // Périodes proposées dans la liste : uniquement celles où la personne a été invitée (l'équipe
  // voit toutes les périodes). Filtre posé ici, côté serveur : un identifiant forgé dans l'URL ne
  // donne accès à rien. Promesses volontairement non attendues — les îlots s'en chargent.
  const periodes: Promise<PeriodeOption[]> = db.period.findMany({
    where: isStaff(user) ? {} : { membres: { some: { userId: user.id } } },
    orderBy: { dateDebut: "desc" },
    select: { id: true, nom: true, statut: true, dateDebut: true, dateFin: true },
  });
  const contenu = chargerSeances(periodes, user, vue);
  // Liens de la page : la période choisie est conservée d'un filtre à l'autre — la date cherchée,
  // non, et c'est délibéré. Ces liens sont précisément ceux des commandes qu'un jour unique met hors
  // jeu : le sens du temps (À venir / Passé), la fenêtre de temps, l'historique. Si la date leur
  // survivait, y appuyer ne changerait rien à l'écran — le pire des boutons, celui qui a l'air cassé.
  // Les laisser effacer la date leur rend leur sens et offre au passage la sortie la plus naturelle
  // de la recherche : la date ne se conserve que là où elle veut dire quelque chose, dans le champ
  // qui la porte.
  const lien = (extra: Record<string, string | undefined> = {}) => {
    const q = new URLSearchParams();
    if (periode) q.set("periode", periode);
    for (const [cle, valeur] of Object.entries(extra)) if (valeur) q.set(cle, valeur);
    const qs = q.toString();
    return qs ? `/seances?${qs}` : "/seances";
  };
  const vueActive = vue.historique ? "historique" : vue.quand;
  const ongletVue = (v: "avenir" | "passe" | "historique", libelle: string) => (
    <Link
      href={v === "historique" ? lien({ vue: "historique" }) : lien({ quand: valeurQuand(v), h: vue.horizon === "periode" ? undefined : vue.horizon })}
      aria-current={vueActive === v ? "page" : undefined}
      className={`flex min-h-12 items-center rounded-full px-2.5 no-underline motion-safe:transition-colors sm:px-4 ${
        vueActive === v ? "bg-primaire text-primaire-texte" : "text-texte-secondaire"
      }`}
    >
      {libelle}
    </Link>
  );
  return (
    /*
     * **Cet écran ne déborde plus de la colonne de lecture**. Il avait débordé le matin même, et
     * l'élargissement avait d'abord vécu dans `ListeSeances`, sur les seules cartes.
     *
     * Ce que le retour en arrière conserve de cet épisode : l'élargissement, **quand** il a lieu, se
     * pose sur une page et jamais sur un morceau de page (c'est le cas du planning et de la fiche
     * d'une séance, qui rangent tous deux un tableau). Ici il n'a plus lieu du tout : une liste de
     * cartes n'a rien à gagner à faire 90 rem, et un filtre sans résultat rend une alerte à la place
     * de la liste — donc, à l'époque, sans le conteneur élargi, et la largeur du contenu sautait d'un
     * filtre à l'autre sous les yeux de quelqu'un qui n'avait fait que filtrer. Le raisonnement
     * complet est dans `src/app/(app)/page.tsx`.
     */
    <div className={`flex flex-col gap-3 sm:gap-5 ${LARGEUR_PAGE}`}>
      {mdp === "ok" && <Alerte type="succes">Ton mot de passe a bien été changé. Tu es connecté(e).</Alerte>}
      {acces === "refuse" && <Alerte type="erreur">Tu n&apos;as pas accès à cette page.</Alerte>}
      <Suspense fallback={null}>
        <Confirmation contenu={contenu} note={note} s={s} />
      </Suspense>
      {/* Titre et bascule sur la même ligne, et titre plus sobre sur téléphone : le premier cours remonte d'autant */}
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-2 sm:gap-x-3">
        <h1 className="text-[1.375rem] sm:text-3xl">{vue.historique ? "Mon historique" : "Séances"}</h1>
        <nav aria-label="Vue" className="flex rounded-full border border-bordure bg-surface p-0.5 text-sm font-semibold">
          {ongletVue("avenir", "À venir")}
          {ongletVue("passe", "Passé")}
          {ongletVue("historique", "Historique")}
        </nav>
      </div>
      {vue.historique ? (
        <Historique userId={user.id} tout={tout === "1"} />
      ) : (
        /*
         * **Deux colonnes dès 1 280 px : les cours à gauche, ce qui les filtre à droite**. Sur un
         * écran de 3 440 px, cette page tenait 768 px au milieu de rien.
         *
         * Les filtres montent dans la colonne de droite, où ils restent **lisibles sans être
         * dépliés** — un volet replié qu'on ouvre à chaque changement de fenêtre était le prix de la
         * colonne étroite. Les cours, eux, gardent toute la largeur de la colonne principale : une
         * fiche porte une liste nominative, une jauge et trois réponses, et Delta a refusé deux fois
         * de les mettre côte à côte (« sauf pour les séances bien sûr »).
         *
         * `ordre="avant"` : sur un téléphone, les filtres se lisent **au-dessus** de la liste, comme
         * ils l'ont toujours fait. C'est le DOM qui porte cet ordre, et seul l'affichage large le
         * réarrange — ce que voit l'œil et ce que lit un lecteur d'écran ne divergent pas.
         */
        <DeuxColonnes
          ordre="avant"
          principal={
            <Suspense fallback={<ListeSquelette />}>
              <Liste contenu={contenu} vue={vue} equipe={equipe} lien={lien} />
            </Suspense>
          }
          cote={
            <>
              {equipe && (
                <div className="flex flex-wrap gap-2">
                  <Suspense fallback={<Bloc className="h-12 w-36 rounded-xl" />}>
                    <ActionsOrganisation contenu={contenu} />
                  </Suspense>
                </div>
              )}
              <Suspense fallback={<SelecteurPeriodeSquelette />}>
                <Filtres periodes={periodes} contenu={contenu} vue={vue} peutCreer={can(user, "periods.manage")} lien={lien} />
              </Suspense>
            </>
          }
        />
      )}
    </div>
  );
}
