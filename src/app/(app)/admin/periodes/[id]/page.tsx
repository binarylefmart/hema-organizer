import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/current-user";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { formatDateHeure, formatHeure } from "@/lib/dates";
import { JOURS_SEMAINE } from "@/lib/periodes";
import {
  activerPeriode,
  ajouterCreneau,
  clorePeriode,
  genererSeancesPeriode,
  modifierPeriode,
  reactiverPeriode,
  renvoyerInvitation,
  renvoyerTousLesLiens,
  reproposerDatesExclues,
  revoquerInvitation,
  retirerMembrePeriode,
  supprimerCreneau,
  supprimerPeriode,
  supprimerSeancesPeriode,
} from "@/actions/periodes";
import { Carte } from "@/components/ui/Carte";
import { DeuxPiles } from "@/components/ui/DeuxPiles";
import { Champ } from "@/components/ui/Champ";
import { SelecteurLieu } from "@/components/gestion/SelecteurLieu";
import { ChampListe } from "@/components/ui/ChampListe";
import { FormulaireAction } from "@/components/ui/FormulaireAction";
import { BoutonAction } from "@/components/ui/BoutonAction";
import { Alerte } from "@/components/ui/Alerte";
import { AjoutMembresPeriode, InstructeursPeriode } from "./Formulaires";
import { SeancesCreees, SelectionDates } from "./SelectionDates";
import { genererSeances } from "@/lib/periodes";
import { Pastille } from "@/components/ui/Pastille";
import { getLieux } from "@/lib/planning";
import { Icone } from "@/components/ui/Icone";
import { horaireHabituel } from "@/lib/horaire-habituel";

export const metadata: Metadata = { title: "Période" };

type Props = { params: Promise<{ id: string }> };

export default async function PagePeriode({ params }: Props) {
  const moi = await requirePermission("periods.manage");
  const { id } = await params;
  const p = await db.period.findUnique({
    where: { id },
    include: {
      creneaux: { orderBy: [{ jourSemaine: "asc" }, { heureDebut: "asc" }] },
      // Le nom, et pas seulement l'identifiant : la carte « Instructeurs habituels » doit pouvoir
      // **nommer** un instructeur qui n'a plus de case à cocher (rétrogradé ou désactivé depuis).
      instructeurs: {
        select: {
          userId: true,
          user: {
            select: { prenom: true, nom: true, actif: true, role: true },
          },
        },
      },
      membres: {
        where: { user: { service: false } },
        include: { user: true },
        orderBy: { user: { prenom: "asc" } },
      },
      invitations: {
        where: { revokedAt: null },
        orderBy: { createdAt: "desc" },
      },
      // Les dates que le bureau a décochées : elles ne sont plus proposées, et c'est en base que
      // ça se souvient — sans quoi elles revenaient cochées au rechargement de l'écran.
      datesExclues: { select: { cle: true } },
      sessions: {
        // Ce que l'encart « Séances déjà créées » affiche, et ce que leur suppression emporterait
        select: {
          id: true,
          date: true,
          heureDebut: true,
          lieu: true,
          annulee: true,
          _count: { select: { attendances: true } },
        },
        orderBy: [{ date: "asc" }, { heureDebut: "asc" }],
      },
    },
  });
  if (!p) notFound();
  const candidates = genererSeances(
    p.dateDebut,
    p.dateFin,
    p.creneaux,
    p.datesExclues.map((d) => d.cle),
    p.sessions.map((s) => `${s.date} ${s.heureDebut}`),
  );
  const [staff, tous, reponsesBrutes, lieux] = await Promise.all([
    db.user.findMany({
      // **Un `OR`, et non un `role: { in: [...] }`** : « admin » n'est plus une valeur de `role`
      // mais un supplément (`estAdmin`). La forme d'avant ne retenait plus que les instructeurs, et
      // un membre du bureau qui encadre disparaissait des cases à cocher sans un mot — pire, il
      // basculait dans `sansCase` plus bas, comme s'il avait été rétrogradé.
      where: {
        actif: true,
        service: false,
        OR: [{ role: "INSTRUCTEUR" }, { estAdmin: true }],
      },
      orderBy: { prenom: "asc" },
    }),
    db.user.findMany({
      where: { actif: true, service: false },
      orderBy: [{ prenom: "asc" }, { nom: "asc" }],
    }),
    // Ce que les membres ont réellement saisi : le total est annoncé avant la suppression de la
    // période, et le détail par personne avant de retirer quelqu'un — `retirerMembrePeriode` efface
    // ses réponses (correctif des « 12 présents sur 11 »). Une seule requête pour les deux :
    // l'identifiant suffit, le décompte se fait ici.
    db.attendance.findMany({
      where: { session: { periodId: id } },
      select: { userId: true },
    }),
    // Les salles habituelles, pour la liste déroulante du créneau à ajouter
    getLieux(),
  ]);
  const reponses = reponsesBrutes.length;
  const reponsesParMembre = new Map<string, number>();
  for (const { userId } of reponsesBrutes)
    reponsesParMembre.set(userId, (reponsesParMembre.get(userId) ?? 0) + 1);
  const dejaInvites = new Set(p.membres.map((m) => m.userId));
  const candidats = tous.filter((u) => !dejaInvites.has(u.id));
  const invitationParUser = new Map(p.invitations.map((i) => [i.userId, i]));
  const modifierAction = modifierPeriode.bind(null, p.id);
  const creneauAction = ajouterCreneau.bind(null, p.id);
  // Pré-remplissage du créneau à ajouter : le dernier créneau de la période, sinon l'horaire de la
  // dernière séance du club (`horaireHabituel`) — jamais une heure écrite en dur.
  const dernierCreneau = p.creneaux[p.creneaux.length - 1];
  const horaire = dernierCreneau ? { heureDebut: dernierCreneau.heureDebut, heureFin: dernierCreneau.heureFin } : await horaireHabituel();
  const genererAction = genererSeancesPeriode.bind(null, p.id);
  const retirerSeancesAction = supprimerSeancesPeriode.bind(null, p.id);
  // Effacer une période est une décision du bureau : le bouton n'existe que pour un administrateur
  const peutSupprimer = can(moi, "periods.delete");
  const nbSeances = p.sessions.length;
  // L'email est facultatif : un envoi groupé ne touche que les personnes qui ont une adresse
  const avecEmail = p.membres.filter(({ user }) => user.email).length;
  const sansEmail = p.membres.length - avecEmail;
  const libelleRenvoi =
    sansEmail > 0
      ? `Renvoyer son lien aux ${avecEmail} personne${avecEmail > 1 ? "s" : ""} qui ${avecEmail > 1 ? "ont" : "a"} une adresse`
      : "Renvoyer tous les liens";
  // Activer n'envoie plus rien : c'est le balayage du matin qui expédie les liens, trois jours
  // avant le premier cours. La confirmation doit le dire, sinon on attend des emails qui ne
  // partiront que des semaines plus tard — et on finit par cliquer deux fois.
  const confirmationActivation =
    `Activer « ${p.nom} » ? Le trimestre s'ouvre à l'équipe : séances et planning deviennent modifiables. ` +
    `Trois jours avant le premier cours, le lien du trimestre partira tout seul à qui a déjà un lien en service ; ` +
    `les personnes jamais invitées (ou dont le lien a été révoqué) s'invitent depuis la liste des membres` +
    (sansEmail > 0
      ? `. ${sansEmail} personne(s) sans adresse email ne recevront rien : l'équipe cochera leur présence.`
      : ".");
  const confirmationRenvoi =
    `Renvoyer son lien à ${avecEmail} personne${avecEmail > 1 ? "s" : ""} ? Chaque lien est régénéré : les anciens cesseront de fonctionner.` +
    (sansEmail > 0
      ? ` ${sansEmail} personne${sansEmail > 1 ? "s" : ""} sans adresse email ne ${sansEmail > 1 ? "recevront" : "recevra"} rien.`
      : "");
  /*
   * **Retirer quelqu'un efface ses réponses**. Le geste passait pour anodin, collé au bouton «
   * Révoquer », et retirer puis ré-ajouter était une manœuvre courante : il faut donc dire ce qu'il
   * emporte, dans les mêmes termes que l'encart « Séances déjà créées » du même écran — décompte,
   * puis « Cette action est sans retour. »
   */
  const confirmationRetrait = (
    prenom: string,
    reponsesMembre: number,
    lienActif: boolean,
  ) =>
    `Retirer ${prenom} de la période ?` +
    (reponsesMembre > 0
      ? ` ${reponsesMembre} réponse${reponsesMembre > 1 ? "s" : ""} de ${prenom} ${reponsesMembre > 1 ? "seront effacées" : "sera effacée"}.`
      : "") +
    (lienActif ? " Son lien personnel sera révoqué." : "") +
    " Cette action est sans retour.";
  const CLOTURE_DABORD = "Clôture la période avant de la supprimer.";
  const confirmationSuppression =
    `Supprimer « ${p.nom} » ? ${nbSeances} séance${nbSeances > 1 ? "s" : ""} et ${reponses} réponse${reponses > 1 ? "s" : ""} ` +
    "seront effacées définitivement. Cette action est irréversible.";

  return (
    /*
     * **`@container` : ici, c'est le conteneur qu'il faut mesurer, pas la fenêtre**. Cette fiche
     * est un **formulaire**, donc elle reste dans la colonne de lecture (736 px) alors que les
     * écrans larges de l'espace admin font 1 440 — c'est la doctrine du dépôt, un formulaire large
     * n'est pas plus facile à remplir. Mais ses découpes internes mesuraient la **fenêtre** : sur
     * un écran de 1 920 px, `lg:grid-cols-2` posait deux cartes de 358 px côte à côte dans un
     * conteneur de 736, et `sm:grid-cols-2` y recoupait les champs en deux — soit « Prénom » et «
     * Nom » à **150 px sur un écran de 1 920, contre 324 px sur un téléphone de 390**.
     * Littéralement le piège que `CLAUDE.md` nomme, et dans sa forme la plus nette : plus l'écran
     * est grand, plus les champs sont étroits.
     *
     * Les paliers sont donc des paliers de **conteneur** (`@md` = 28 rem, `@4xl` = 56 rem) : deux
     * cartes côte à côte seulement s'il y a 56 rem pour elles, deux champs côte à côte seulement
     * s'il y a 28 rem dans la carte. Dans 736 px, la fiche devient une colonne de cartes larges aux
     * champs de ~340 px ; si la page s'élargissait un jour, les deux colonnes reviendraient d'elles-mêmes.
     */
    <div className="@container flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-texte-secondaire">
            <Link href="/admin/periodes">Périodes</Link> / {p.nom}
          </p>
          <h1 className="text-3xl">
            {p.nom}{" "}
            <Pastille
              ton={
                p.statut === "ACTIVE"
                  ? "vert"
                  : p.statut === "CLOSE"
                    ? "ocre"
                    : "neutre"
              }
            >
              {p.statut === "ACTIVE"
                ? "Active"
                : p.statut === "CLOSE"
                  ? "Close"
                  : "Brouillon"}
            </Pastille>
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {p.statut === "BROUILLON" && (
            <BoutonAction
              action={activerPeriode.bind(null, p.id)}
              confirmation={confirmationActivation}
              // Plein, pas vert : c'est le geste attendu d'un brouillon, pas une réussite à saluer.
              variante="primaire"
            >
              Activer la période
            </BoutonAction>
          )}
          {p.statut === "ACTIVE" && (
            <BoutonAction
              action={clorePeriode.bind(null, p.id)}
              confirmation="Clore la période ? Les liens d'invitation seront désactivés."
              variante="secondaire"
            >
              Clore la période
            </BoutonAction>
          )}
          {/* Le geste inverse de la clôture : il ne fait partir aucun email (voir `reactiverPeriode`). */}
          {p.statut === "CLOSE" && (
            <BoutonAction
              action={reactiverPeriode.bind(null, p.id)}
              confirmation="Rouvrir la période ? Le trimestre redevient modifiable et les liens que la clôture avait fermés refonctionnent, sauf pour qui a reçu un lien plus récent depuis — il garde le sien. Aucun email ne part."
              variante="secondaire"
            >
              Rouvrir la période
            </BoutonAction>
          )}
          {peutSupprimer &&
            (p.statut === "ACTIVE" ? (
              /* **Un bouton qui ne s'applique pas n'apparaît pas** : c'était un « Supprimer » rouge
                 grisé, en permanence, sur la période en cours — le seul rouge de l'écran, pour un
                 geste impossible. Reste la phrase, qui dit comment y arriver. */
              <span className="self-center text-sm text-texte-secondaire">{CLOTURE_DABORD}</span>
            ) : (
              <BoutonAction
                action={supprimerPeriode.bind(null, p.id)}
                confirmation={confirmationSuppression}
                variante="danger"
                taille="petite"
              >
                <Icone nom="alerte" taille={18} />
                Supprimer la période
              </BoutonAction>
            ))}
        </div>
      </div>

      {p.statut === "BROUILLON" && (
        // Le pas 4 disait encore « chacun reçoit son lien personnel par email » : c'est la règle
        // d', et elle contredisait mot pour mot la confirmation du bouton juste en dessous, sur le
        // même écran. Activer n'envoie plus rien.
        <Alerte type="info" titre="Pour démarrer la période">
          1. Vérifie les créneaux et instructeurs&nbsp;· 2. Génère les séances&nbsp;· 3.
          Ajoute les membres&nbsp;· 4. Active : le trimestre s&apos;ouvre au travail
          de l&apos;équipe. Les liens personnels partent tout seuls trois jours
          avant le premier cours.
        </Alerte>
      )}

      {/*
       * **Deux piles indépendantes à partir de 1 536 px**.
       *
       * C'est l'écran le plus long de l'application : **4 050 px de haut** mesurés à 1 920 px (3 754
       * de contenu), et 4 650 px dans la colonne de lecture — près de quatre écrans à faire défiler
       * pour atteindre « Membres invités », qui est justement la carte où le bureau passe ses débuts
       * de trimestre. L'élargissement seul n'y pouvait rien : les cinq cartes s'étiraient sans se
       * raccourcir, et ce n'est pas ce que la largeur sert à faire ici (voir `DeuxPiles`, et
       * `CLAUDE.md` : « un tableau s'élargit, une carte non »). Après : **2 953 px**.
       *
       * **La coupure, et les hauteurs qui la justifient.** Elle se fait sur une *coupure* de la liste
       * des cartes, jamais sur un tri : en dessous du palier, un seul flux dans l'ordre de la source,
       * qui est **exactement** l'ordre d'hier (contrainte dure de `DeuxPiles`). Les cinq cartes
       * mesurent, dans une pile de 708 px : Informations **333**, Instructeurs **430**, Créneaux
       * **573**, Séances **1 169**, Membres invités **1 680**. Il n'y a donc que quatre coupures
       * possibles, et une seule qui équilibre :
       *
       * - après « Informations » …… 333 / 3 932 px
       * - après « Instructeurs » …… 783 / 3 462 px
       * - après « Créneaux » ……… 1 376 / 2 869 px
       * - **après « Séances » …… 2 565 / 1 680 px** ← retenue
       *
       * C'est la seule qui descend la plus haute des deux piles sous les 2 600 px, soit un tiers de
       * la page d'avant. Et elle se lit : à gauche **le trimestre** (son nom et ses dates, qui
       * l'encadre, ses créneaux, ses séances), à droite **les gens** (qui est invité, où en est son
       * lien). Les deux piles sont de même rang, aucune n'accompagne l'autre.
       *
       * **Le titre, les boutons d'état et l'alerte de démarrage restent au-dessus, sur toute la
       * largeur** : activer, clore ou supprimer une période n'est pas un réglage rangé dans une
       * colonne, et une alerte posée dans une pile ne s'adresserait plus qu'à une moitié d'écran.
       *
       * **Chaque pile déclare son propre `@container`**, et c'est la condition pour que le reste de
       * la fiche tienne : les paliers intérieurs (`@4xl` pour deux cartes côte à côte, `@md` et
       * `@xl` pour les champs) mesurent le conteneur, et ce conteneur n'est plus la page mais la
       * pile — 708 px, pas 1 440. Sans ces deux déclarations, `@4xl` aurait continué de lire les
       * 1 440 px de la page et posé deux cartes de 344 px dans une pile de 708 : le piège du
       * 02/10 au matin, en pire.
       */}
      <DeuxPiles
        gauche={<div className="@container flex min-w-0 flex-col gap-5">
            <div className="grid gap-5 @4xl:grid-cols-2">
              <Carte titre="Informations">
                {/* `modifierPeriode` invalide déjà `/admin/periodes/[id]` (helper `rafraichir`) : la réponse
                    porte la charge à jour, un `router.refresh()` de plus referait pour rien le gros
                    `findUnique` de la période, ses quatre requêtes et le calcul des séances. */}
                <FormulaireAction
                  action={modifierAction}
                  bouton="Enregistrer"
                  rafraichirApresSucces={false}
                >
                  <Champ
                    label="Nom"
                    name="nom"
                    defaultValue={p.nom}
                    required
                    maxLength={60}
                  />
                  <div className="grid gap-4 @md:grid-cols-2">
                    <Champ
                      label="Début"
                      name="dateDebut"
                      type="date"
                      defaultValue={p.dateDebut}
                      required
                    />
                    <Champ
                      label="Fin"
                      name="dateFin"
                      type="date"
                      defaultValue={p.dateFin}
                      required
                    />
                  </div>
                </FormulaireAction>
              </Carte>

              <Carte titre="Instructeurs habituels">
                <InstructeursPeriode
                  periodId={p.id}
                  staff={staff.map((u) => ({
                    id: u.id,
                    nom: `${u.prenom} ${u.nom}`,
                  }))}
                  selection={p.instructeurs.map((i) => i.userId)}
                  /*
                   * **Ceux qui sont rattachés à la période mais n'ont plus de case** : un instructeur
                   * rétrogradé en membre, ou un compte désactivé. `staff` ne liste que les comptes actifs
                   * ayant le rôle ; sans cette liste-ci, ils étaient invisibles **et** réécrits en base à
                   * chaque enregistrement (voir `InstructeursPeriode`).
                   */
                  sansCase={p.instructeurs
                    .filter((i) => !staff.some((u) => u.id === i.userId))
                    .map((i) => ({
                      nom: `${i.user.prenom} ${i.user.nom}`,
                      raison: !i.user.actif
                        ? "compte désactivé"
                        : "n'est plus instructeur",
                    }))}
                />
              </Carte>
            </div>

            <Carte titre="Créneaux hebdomadaires">
              {p.creneaux.length === 0 ? (
                <p className="mb-4 text-texte-secondaire">
                  Aucun créneau : ajoute-en au moins un pour générer les séances.
                </p>
              ) : (
                <ul className="mb-4 flex flex-col divide-y divide-bordure/60 rounded-xl border border-bordure/60">
                  {p.creneaux.map((c) => (
                    <li
                      key={c.id}
                      className="flex flex-wrap items-center justify-between gap-2 px-4 py-2"
                    >
                      <span>
                        <strong>{JOURS_SEMAINE[c.jourSemaine]}</strong>{" "}
                        {formatHeure(c.heureDebut)}–{formatHeure(c.heureFin)}&nbsp;·{" "}
                        {c.lieu}
                        {c.adresse && (
                          <span className="text-texte-secondaire">
                            {" "}
                            — {c.adresse}
                          </span>
                        )}
                      </span>
                      <BoutonAction
                        action={supprimerCreneau.bind(null, c.id)}
                        confirmation="Supprimer ce créneau ? (les séances déjà générées sont conservées)"
                        variante="danger"
                        taille="petite"
                      >
                        <Icone nom="alerte" taille={18} />
                        Supprimer
                      </BoutonAction>
                    </li>
                  ))}
                </ul>
              )}
              {/* Même raison : `ajouterCreneau` invalide cette page. */}
              <FormulaireAction
                action={creneauAction}
                bouton="Ajouter le créneau"
                variante="secondaire"
                rafraichirApresSucces={false}
              >
                <div className="grid gap-4 @xl:grid-cols-3">
                  {/* Aucun jour pré-choisi : le formulaire proposait le mardi, qui n'était le jour de
                      cours que d'un seul club. La liste s'ouvre donc sur lundi, et l'on choisit. */}
                  {/* La liste du dépôt, non pilotée : le jour choisi part dans le champ caché
                      `jourSemaine` (1 = lundi … 7 = dimanche), exactement comme l'option native. */}
                  <ChampListe
                    label="Jour"
                    name="jourSemaine"
                    valeur="1"
                    entrees={JOURS_SEMAINE.slice(1).map((j, i) => ({ valeur: String(i + 1), libelle: j }))}
                  />
                  <Champ
                    label="Début"
                    name="heureDebut"
                    type="time"
                    defaultValue={horaire.heureDebut}
                    required
                  />
                  <Champ
                    label="Fin"
                    name="heureFin"
                    type="time"
                    defaultValue={horaire.heureFin}
                    required
                  />
                </div>
                <SelecteurLieu lieux={lieux} prefixe="creneau-" />
              </FormulaireAction>
            </Carte>

            {/* Ce lien **sort de l'espace admin** : la liste des séances est l'onglet commun à tout le club.
                On le dit dans le libellé, plutôt que de laisser croire qu'on reste dans les réglages. */}
            <Carte
              titre={`Séances (${p.sessions.length} créées)`}
              actions={
                <Link
                  href={`/seances?periode=${p.id}`}
                  className="inline-flex min-h-11 items-center"
                >
                  Voir les séances (hors espace admin)
                </Link>
              }
            >
              {/* Deux encarts, dans le sens de la lecture : ce qui manque, puis ce qui est là. Coché veut
                  dire la même chose des deux côtés — la séance existe, ou elle va exister. */}
              <div className="flex flex-col gap-5">
                <section className="flex flex-col gap-3">
                  <h3 className="text-lg font-semibold">Reste à créer</h3>
                  <SelectionDates action={genererAction} candidates={candidates} />
                  {/* La porte de sortie : décocher une date la retire des propositions pour de bon, il
                      faut donc un geste pour les faire revenir — sans lui, une erreur de clic serait
                      définitive. */}
                  {p.datesExclues.length > 0 && (
                    <BoutonAction
                      action={reproposerDatesExclues.bind(null, p.id)}
                      variante="secondaire"
                    >
                      Reproposer{" "}
                      {p.datesExclues.length === 1
                        ? "la date écartée"
                        : `les ${p.datesExclues.length} dates écartées`}
                    </BoutonAction>
                  )}
                </section>
                <section className="flex flex-col gap-3 border-t border-bordure/60 pt-5">
                  <h3 className="text-lg font-semibold">Séances déjà créées</h3>
                  <SeancesCreees
                    action={retirerSeancesAction}
                    seances={p.sessions.map((s) => ({
                      id: s.id,
                      date: s.date,
                      heureDebut: s.heureDebut,
                      lieu: s.lieu,
                      annulee: s.annulee,
                      reponses: s._count.attendances,
                    }))}
                  />
                </section>
              </div>
            </Carte>
        </div>}
        droite={<div className="@container flex min-w-0 flex-col gap-5">
            <Carte
              titre={`Membres invités (${p.membres.length})`}
              actions={
                p.statut !== "BROUILLON" && avecEmail > 0 ? (
                  <BoutonAction
                    action={renvoyerTousLesLiens.bind(null, p.id)}
                    variante="secondaire"
                    enCours="Envoi…"
                    confirmation={confirmationRenvoi}
                  >
                    {libelleRenvoi}
                  </BoutonAction>
                ) : p.statut !== "BROUILLON" && p.membres.length > 0 ? (
                  <span className="text-sm text-texte-secondaire">
                    Aucune adresse email ici : aucun lien à envoyer.
                  </span>
                ) : undefined
              }
            >
              {p.membres.length === 0 ? (
                <p className="text-texte-secondaire">Personne pour l&apos;instant.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-bordure/60 rounded-xl border border-bordure/60">
                  {p.membres.map(({ user: u }) => {
                    const inv = invitationParUser.get(u.id);
                    return (
                      <li
                        key={u.id}
                        /* **`@2xl` et non `sm` : c'est la pile qu'il faut mesurer, pas la
                            fenêtre**. C'était la dernière requête de **média** de cette fiche, et
                            elle devenait fausse le jour où la fiche se partage en deux piles :
                            `sm:` répond « oui » dès 640 px de **fenêtre**, donc y compris dans une
                            pile de 708 px où le nom, l'adresse email et les trois boutons n'ont
                            plus la place de tenir sur une ligne. Le palier de conteneur (42 rem)
                            dit la même chose de la bonne mesure, et rend exactement la même ligne
                            aux trois largeurs mesurées : empilé à 390 px, en ligne à 736 (colonne
                            de lecture) comme à 708 (dans une pile). */
                  className="flex flex-col gap-2 px-4 py-3 @2xl:flex-row @2xl:items-center @2xl:justify-between"
                      >
                        <div className="min-w-0">
                          <Link
                            href={`/admin/membres/${u.id}`}
                            className="inline-flex min-h-11 items-center font-semibold"
                          >
                            {u.prenom} {u.nom}
                          </Link>
                          {/* La mention sous le nom : le **rôle de base**, et « admin » en
                              supplément. Elle se lisait sur le seul `role`, avec « admin » en
                              branche par défaut — or `role` ne vaut plus jamais « ADMIN » : un
                              membre du bureau s'affichait désormais comme un simple membre, et
                              celui qui encadre perdait au contraire la mention du bureau. Les deux
                              s'additionnent maintenant, comme les droits eux-mêmes. */}
                          <span className="ml-2 text-sm text-texte-secondaire">
                            {[u.role === "INSTRUCTEUR" ? "instructeur" : "", u.estAdmin ? "admin" : ""].filter(Boolean).join("\u00a0· ")}
                          </span>
                          {u.email ? (
                            <div className="truncate text-sm text-texte-secondaire">
                              {u.email}
                            </div>
                          ) : (
                            <div className="text-sm text-texte-secondaire">
                              <Pastille ton="neutre">sans email</Pastille>{" "}
                              l&apos;équipe coche sa présence à sa place
                            </div>
                          )}
                          <div className="mt-1">
                            {!u.email ? (
                              <span className="text-sm text-texte-secondaire">
                                Aucun lien ne peut partir.{" "}
                                <Link
                                  href={`/admin/membres/${u.id}`}
                                  className="font-semibold"
                                >
                                  Ajouter son email
                                </Link>
                              </span>
                            ) : p.statut === "BROUILLON" ? (
                              <span className="text-sm text-texte-secondaire">
                                lien envoyé à l&apos;activation
                              </span>
                            ) : !inv ? (
                              <Pastille ton="rouge">aucun lien actif</Pastille>
                            ) : inv.usedAt ? (
                              <Pastille ton="vert">
                                lien activé le {formatDateHeure(inv.usedAt)}
                              </Pastille>
                            ) : (
                              <Pastille ton="ocre">
                                envoyé le {formatDateHeure(inv.createdAt)}, pas encore
                                ouvert
                              </Pastille>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2 @2xl:justify-end">
                          {p.statut !== "BROUILLON" && u.email && (
                            <BoutonAction
                              action={renvoyerInvitation.bind(null, p.id, u.id)}
                              variante="secondaire"
                              taille="petite"
                              enCours="Envoi…"
                            >
                              {inv ? "Renvoyer le lien" : "Envoyer le lien"}
                            </BoutonAction>
                          )}
                          {inv && (
                            <BoutonAction
                              action={revoquerInvitation.bind(null, inv.id)}
                              confirmation="Révoquer ce lien ?"
                              variante="danger"
                              taille="petite"
                            >
                              <Icone nom="alerte" taille={18} />
                              Révoquer
                            </BoutonAction>
                          )}
                          <BoutonAction
                            action={retirerMembrePeriode.bind(null, p.id, u.id)}
                            confirmation={confirmationRetrait(
                              u.prenom,
                              reponsesParMembre.get(u.id) ?? 0,
                              Boolean(inv),
                            )}
                            variante="danger"
                            taille="petite"
                          >
                            <Icone nom="alerte" taille={18} />
                            Retirer
                          </BoutonAction>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
              <div className="mt-4">
                <AjoutMembresPeriode
                  periodId={p.id}
                  candidats={candidats.map((u) => ({
                    id: u.id,
                    nom: `${u.prenom} ${u.nom}`,
                    email: u.email,
                  }))}
                />
              </div>
            </Carte>
        </div>}
      />
    </div>
  );
}
