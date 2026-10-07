import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/current-user";
import { encadreLeClub } from "@/lib/permissions";
import { compteRendu, type CompteRendu } from "@/lib/accueil";
import { identite } from "@/lib/identite";
import type { SeanceCarte } from "@/lib/seances";
import { Alerte } from "@/components/ui/Alerte";
import { ChiffresDuTrimestre, IndicateursAdmin, IndicateursClub, IndicateursPersonnels } from "@/components/accueil/Indicateurs";
import { BlocProgression } from "@/components/accueil/Blasons";
import { FournisseurVue, VueSeule } from "@/components/accueil/VueAccueil";
import { FichesProchains } from "@/components/accueil/FichesProchains";
import { Frise, type CoursFrise } from "@/components/accueil/Frise";
import { VignetteProchainCours } from "@/components/accueil/VignetteProchainCours";
import { LigneEvenement } from "@/components/accueil/LigneEvenement";
import { BlocEquipe } from "@/components/accueil/BlocEquipe";
import { BoutonPresences, RaccourciCoursPasses, Raccourcis } from "@/components/accueil/Raccourcis";
import { DeuxColonnes, LARGEUR_PAGE } from "@/components/ui/DeuxColonnes";

export const metadata: Metadata = { title: "Accueil" };

type Params = {
  mdp?: string;
  acces?: string;
  admin?: string;
  seance?: string;
  reponse?: string;
  note?: string;
  s?: string;
  vue?: string;
  periode?: string;
  h?: string;
};
type Props = { searchParams: Promise<Params> };

/**
 * Paramètres qui appartiennent à l'onglet Présences : la réponse en un appui venue d'un email
 * (`seance`/`reponse`), sa confirmation (`note`/`s`), et les filtres de la liste (`vue`, `periode`, `h`).
 *
 * Ils ont longtemps été servis par `/`, du temps où l'accueil **était** la liste des présences :
 * des emails partis, des raccourcis posés sur un écran d'accueil et de vieux signets les visent
 * encore. Plutôt que de les perdre en silence, on les réachemine vers l'écran qui sait les lire.
 */
const PARAMS_PRESENCES = ["seance", "reponse", "note", "s", "vue", "periode", "h"] as const;

/** Reconstruit l'URL de `/seances` en gardant **tous** les paramètres reçus (alertes comprises). */
function versPresences(params: Params): string {
  const q = new URLSearchParams();
  for (const [cle, valeur] of Object.entries(params)) if (valeur) q.set(cle, valeur);
  const qs = q.toString();
  return qs ? `/seances?${qs}` : "/seances";
}

/**
 * Une séance de la vue Club en **colonne dépliable** de la frise.
 *
 * `details` porte les trois choses que la frise ne dessine pas — l'horaire, le lieu (avec son
 * adresse, pour que le panneau en fasse un lien vers la carte) et les noms —
 * et c'est tout l'intérêt d'ouvrir une colonne. Rien n'est chargé pour l'occasion : `cr.prochaines`
 * est déjà une liste de `SeanceCarte` complètes, listes nominatives comprises, ouvertes à tout le
 * club depuis l'étape 3.
 */
function colonneDepliable(s: SeanceCarte): CoursFrise {
  return {
    id: s.id,
    date: s.date,
    annulee: s.annulee,
    compteurs: s.compteurs,
    details: { heureDebut: s.heureDebut, heureFin: s.heureFin, lieu: s.lieu, adresse: s.adresse, participants: s.participants },
  };
}

/** Où en est la saison, en une ligne sous le bonjour. Rien à dire hors période : on se tait. */
function sousTitre(cr: CompteRendu): string | null {
  if (!cr.periode) return null;
  if (cr.seancesTotal === 0) return cr.periode.nom;
  if (cr.seancesPassees === 0) return `${cr.periode.nom}\u00a0· ${cr.seancesTotal}\u00a0cours au programme`;
  return `${cr.periode.nom}\u00a0· ${cr.seancesPassees}\u00a0cours sur ${cr.seancesTotal} déjà passés`;
}

/**
 * Accueil : le **compte rendu du club**, en lecture seule, avec une bascule pour le regarder de
 * sa place.
 *
 * **Chacun ouvre sur la vue qui correspond à sa place** : un membre n'a que la sienne et n'a donc
 * aucune bascule ; l'encadrement ouvre sur « Club » et bascule sur « Personnel » ; un
 * administrateur élevé a en plus « Admin », et n'a « Club » que s'il est aussi instructeur (le
 * bureau est un supplément). Voir `vues.ts`.
 *
 * **Le tri se fait sur l'usage du chiffre, pas sur sa nature.** Ce qui aide à s'organiser pour les
 * prochains cours reste ouvert à tout le club ; ce qui appelle une décision de l'équipe ou sert à
 * piloter la période passe derrière une troisième position de bascule.
 * - **Club** : de quoi s'organiser pour les prochains cours, dans cet ordre — la **vignette** du
 *   prochain cours (la question qu'on se pose en ouvrant l'application, écrite en grand), la
 *   **frise** de fréquentation (la forme des quatre prochains cours d'un coup d'œil), la **bande
 *   d'indicateurs** (ce qui reste au calendrier) et le **raccourci vers les cours passés**. **Aucune
 *   carte ni fiche de cours ici**, et c'est le fruit de deux retraits successifs : les cartes, parce
 *   qu'elles redisaient en dix lignes ce que la frise montre au-dessus ; les fiches qui les avaient
 *   remplacées, parce qu'elles redisaient la frise elles aussi — date, présents, peut-être, effectif
 *   attendu et marge au seuil se lisent tous sur la colonne. La liste complète d'un cours reste à un
 *   tap, sur l'onglet Séances. **Ce retrait-là ne vaut que pour cette vue** : les mêmes fiches
 *   servent côté Personnel, où il n'y a pas de frise et où elles portent en plus la réponse de la
 *   personne connectée.
 * - **Personnel** : la même page vue de sa place, dans cet ordre — le **bouton de réponse** (seule
 *   vue à en porter un), sa **bande d'indicateurs** (mon assiduité, ce qu'il me reste à répondre),
 *   puis **les fiches des prochains cours** — chacune portant ma réponse —, et **seulement ensuite**
 *   « Ma progression ». Les deux sont **empilés**, pas côte à côte : l'essai en deux colonnes a été
 *   repris le jour même. Et l'ordre ne se discute plus : on ouvre l'application pour savoir ce qui se
 *   passe mardi, pas pour regarder ses blasons. **« Ma progression »** — une **bande de tuiles** (mon
 *   rang, ma série, mes réponses), suivie de la grille des blasons ; voir `BlocProgression` — et ses
 *   **raccourcis**. Les tuiles « Mon objectif » et « Le club » en sont sorties le jour même, à : la
 *   bande ne porte plus que ce qui est à soi. **Les fiches reviennent ici, à** (« je veux garder les
 *   tuiles présences pour l'accueil user ; je les avais fait enlever seulement pour la vue Club »), à
 *   la place de l'ancienne liste de cours de la vue Club. Elles ont leur place là où elles n'en
 *   avaient pas côté Club pour deux raisons : cette vue **n'affiche pas la frise** — il n'y a donc
 *   rien à redire —, et surtout la fiche y porte en plus **sa propre réponse** (pastille de statut,
 *   ou relance ocre « Tu n'as pas encore répondu » si l'on est invité sans avoir répondu), que la
 *   frise ne montre pas et ne montrera jamais : elle compte le groupe, pas la personne. Voir la prop
 *   `personnel` de `FichesProchains`. Rien n'y est cliquable pour autant : le seul bouton de réponse
 *   de l'écran reste `BoutonPresences`, tout en haut de cette vue. **Pourquoi la progression ne vit
 *   que là :** en vue Club, les blasons de chacun deviendraient un palmarès, et un écu non débloqué
 *   lu par les autres se lirait comme un reproche — le club compte des gens qui travaillent le mardi
 *   soir et viennent un cours sur trois. En vue Admin, elle n'appelle aucune décision d'équipe. Elle
 *   ne parle qu'à la personne qui regarde, ne nomme personne et ne compare rien.
 * - **Admin** : ce qui appelle une action de l'équipe — qui ne s'est pas prononcé, qui ne répond
 *   plus, quel cours va manquer de monde —, puis le trimestre en chiffres (tendance, noyau,
 *   assiduité) et le travail de l'encadrement (ateliers à trancher, invités à relancer),
 *   **uniquement pour un administrateur connecté en tant qu'administrateur** — le rôle ne suffit
 *   pas, il faut l'élévation en cours.
 *   Les autres n'ont pas cette position dans leur bascule, et les chiffres qu'elle montre n'ont
 *   même pas été calculés pour eux (`cr.admin` vaut `null`, voir `src/lib/accueil.ts`).
 *
 * De haut en bas : la bascule, ce qui appartient à la vue choisie, les prochains cours (en fiches
 * compactes, et **en vue Personnel seulement** ; les vues Club et Admin n'en montrent aucun), le
 * prochain événement, puis les autres onglets. Aucun bouton Présent /
 * Absent / Peut-être ici : ils vivent tous sur `/seances`, un seul écran porte l'action — c'est ce
 * qui rend celui-ci lisible d'un coup d'œil.
 */
export default async function PageAccueil({ searchParams }: Props) {
  const params = await searchParams;
  // Réaiguillage avant tout le reste : une réponse venue d'un email n'a rien à faire ici, et
  // surtout elle ne doit pas être avalée. `/seances` porte les mêmes alertes `mdp`/`acces`.
  if (PARAMS_PRESENCES.some((cle) => params[cle])) redirect(versPresences(params));
  const user = await requireUser();
  /*
   * **La part minimale d'effectif du club** (`Identite.partEffectifMin`, en % des invités) se lit
   * **ici**, et descend ensuite partout en argument : dans le compte rendu (qui reste une fonction
   * sans réglage à lire) comme dans la frise et les fiches, qui sont des composants **client** et ne
   * peuvent pas l'aller chercher (voir `src/lib/constants.ts`). La lecture est gratuite —
   * `identite()` est mise en cache pour la durée de la requête, et la mise en page racine l'a déjà
   * demandée pour l'en-tête et le manifeste.
   */
  const { partEffectifMin } = await identite();
  const cr = await compteRendu(user, partEffectifMin);
  // Recrue du jour, compte créé hors saison, personne pas encore invitée : ni cours passé ni cours
  // à venir. Une bascule sur du vide ne dirait rien d'utile — une phrase, si.
  const vide = cr.prochaines.length === 0 && cr.seancesTotal === 0;
  // Le prochain cours qui aura vraiment lieu : la vignette de tête ne montre pas une séance
  // annulée, dont les chiffres ne rassembleront personne.
  const prochainCours = cr.prochaines.find((c) => !c.annulee) ?? null;
  const detail = sousTitre(cr);
  return (
    /*
     * **L'accueil reste dans la colonne de lecture** — retour en arrière, et il vaut la peine
     * d'être raconté en entier, parce qu'il annule une décision de la veille.
     *
     * Le 29 au soir, sur les captures d'un club de quatre-vingts, Delta demandait d'« utiliser tout
     * l'espace du browser » : l'accueil, `/seances` et le planning ont donc débordé jusqu'à 90 rem.
     * Le lendemain, captures en main, il a tranché l'inverse pour ces deux écrans-ci : « pour les
     * tuiles pas besoin de faire la largeur complète si bien agencé » et, sur la carte d'un cours,
     * « je n'aime pas la manière dont il est allongé en grand écran ».
     *
     * **Les deux demandes ne se contredisent pas, elles distinguent deux natures de contenu.** Un
     * tableau a besoin de largeur : le planning range des noms de personnes en colonnes, et les
     * tronquer est une perte d'information — il garde donc `PLEINE_LARGEUR`, comme la fiche d'une
     * séance et sa grille de cases. Une **carte**, non : elle empile des phrases courtes, et
     * l'étirer à 1 440 px n'ajoute aucune information — ça ne fait que coucher une date seule devant
     * 900 px de blanc et poser trois boutons de réponse au bout d'un geste de souris. Ce qui manquait
     * à la décision de la veille, c'est cette distinction ; « utiliser l'espace » l'avait appliquée
     * partout.
     *
     * **Troisième temps, à 18 h** (Delta, capture d'un écran de 3 440 px : « adapte les tuiles au
     * mieux dynamiquement à la longueur de la fenêtre, sur grand écran c'est pas fou (planning est
     * ok) »). Dans la colonne de lecture, l'accueil tenait 768 px au milieu de 3 440 — et le 30, ce
     * qui avait été refusé n'était pas la largeur de la *page*, c'était la **carte étirée** qui la
     * remplissait. Première réponse : une **grille** de tuiles, qui ne les étirait plus mais les
     * multipliait. Elle a tenu deux heures.
     *
     * **Quatrième temps, le même soir à 22 h, et c'est celui qui tient** : « ça fait des trous, et
     * pour séance et atelier c'est toujours pareil ». Une grille aligne ses blocs en **rangées** : la
     * vignette fait 140 px, la frise qui la côtoie 330 — d'où un trou de la hauteur de la différence.
     * La page se lit donc en **deux colonnes indépendantes** (`DeuxColonnes`), qui empilent chacune à
     * leur rythme : la largeur sert à **montrer plus**, jamais à étirer la même chose, et il n'y a
     * plus de rangée à aligner. La largeur, elle, reste posée sur la page (`LARGEUR_PAGE`) : même
     * palier et même plafond que `PLEINE_LARGEUR`, parce que deux largeurs maximales sur le même
     * écran se lisent comme un défaut d'affichage.
     *
     * Ce qui **reste à gauche** : ce pour quoi on ouvre l'application, et ce qui est fait pour la
     * largeur — la vignette qui doit taper à l'œil, les frises dont chaque colonne est un cours, les
     * fiches des cours à venir et les blasons, refusés en demi-largeur le 25/09. Sur un téléphone,
     * tout se rempile dans l'ordre de la source : seul l'affichage large réarrange.
     */
    <div className={`flex flex-col gap-6 ${LARGEUR_PAGE}`}>
      {/* Les deux alertes qui atterrissent vraiment sur l'accueil (mot de passe changé, accès refusé) */}
      {params.mdp === "ok" && <Alerte type="succes">Ton mot de passe a bien été changé. Tu es connecté(e).</Alerte>}
      {params.acces === "refuse" && <Alerte type="erreur">Tu n&apos;as pas accès à cette page.</Alerte>}
      {/* L'espace admin s'est refermé tout seul et nous a déposés ici (voir `SortirApresInactivite`).
          Sans cette ligne, l'écran aurait changé sous les yeux de quelqu'un sans rien expliquer — et
          c'est le genre de silence qui fait croire à une panne. On dit ce qui s'est passé, ce qui
          n'a pas bougé, et où retrouver l'espace admin. */}
      {params.admin === "expire" && (
        <Alerte type="info">
          L&apos;espace admin s&apos;est refermé après un moment sans activité. Tout le reste est
          intact : pour y retourner, passe par « Mon profil ».
        </Alerte>
      )}

      <header className="flex flex-col gap-1">
        <h1 className="text-[1.375rem] sm:text-3xl">Bonjour {user.prenom}</h1>
        {detail && <p className="text-texte-secondaire">{detail}</p>}
      </header>

      {vide ? (
        <>
        <Alerte type="info" titre="Rien à faire pour l'instant">
          <p>
            Ton compte est prêt. Dès qu&apos;un trimestre sera ouvert et que tu y seras invité(e), tes cours apparaîtront ici
            et tu recevras un email — rien à surveiller d&apos;ici là.
          </p>
          <p className="mt-2">En attendant, le planning du club est ouvert : va voir ce qui s&apos;y prépare.</p>
        </Alerte>
        {/* Un compte sans trimestre n'a pas de colonnes à lire, mais il a le droit de voir le stage
            du mois prochain : l'annonce est rendue ici, et dans la colonne de droite dans l'autre
            branche — jamais les deux à la fois. */}
        {cr.evenement && <LigneEvenement evenement={cr.evenement} />}
        </>
      ) : (
        // La bascule commande des morceaux d'écran qui ne se touchent pas dans l'arbre : les
        // trois bandes d'indicateurs, le bouton de réponse, le bloc de l'encadrement et la
        // pastille de chaque ligne de cours. D'où le fournisseur qui les englobe — il ne pose
        // aucune balise, l'espacement de la colonne est conservé. `admin` ne vaut vrai que si le
        // serveur a vérifié la permission.
        <FournisseurVue admin={cr.admin !== null} encadre={encadreLeClub(user)}>
          {/*
            * **Deux colonnes dès 1 280 px : ce qu'on vient faire à gauche, ce qui l'accompagne à
            * droite**.
            *
            * La grille essayée une heure plus tôt alignait les blocs en **rangées** : la vignette
            * fait 140 px, la frise qui la côtoie 330 — d'où un trou de la hauteur de la différence,
            * qui se lit comme un affichage cassé. Deux colonnes indépendantes n'ont pas ce défaut :
            * chacune empile à son rythme (voir `DeuxColonnes`).
            *
            * **À gauche, ce pour quoi on ouvre l'application** : combien on sera au prochain cours,
            * la fréquentation, le bouton de réponse, les fiches des cours à venir, le pilotage du
            * bureau. **À droite, ce qui accompagne** : un compteur, un raccourci vers le passé,
            * l'annonce du prochain événement. Les blasons restent à gauche — en demi-largeur ils se
            * rognaient, ce que Delta avait déjà refusé le 25/09.
            */}
          <DeuxColonnes
            principal={
              <>
                {/* **La vignette ouvre la vue Club**. Combien on sera au prochain cours est la
                    question qu'on se pose en ouvrant l'application. Elle prend le fond encre de
                    l'en-tête pour se détacher du parchemin — elle doit rester la **seule** carte
                    sombre de l'écran. Sur le prochain cours **non annulé** : un cours qui n'a pas
                    lieu ne rassemblera personne. */}
                {prochainCours && (
                  <VueSeule vue="club">
                    <VignetteProchainCours seance={prochainCours} />
                  </VueSeule>
                )}
                {/* La frise parle de la fréquentation du **club**, pas de soi : elle n'a rien à
                    répondre là où l'on vient voir sa propre situation. Elle ne coûte aucune requête
                    de plus — ses chiffres sont ceux des séances déjà chargées pour la liste. */}
                {cr.prochaines.length > 0 && (
                  <VueSeule vue="club">
                    <Frise cours={cr.prochaines.map(colonneDepliable)} partEffectifMin={partEffectifMin} titre="Fréquentation des prochains cours" />
                  </VueSeule>
                )}
                {/* Le bureau regarde le **mois entier, passé compris** : un mardi à trois après
                    quatre mardis à dix, ça ne se voit que côte à côte. Mêmes données, aucune lecture
                    de plus, et ses colonnes ne se déplient pas (`frequentationDuMois` ne porte que
                    des compteurs — les charger pour un mois coûterait une requête par séance). */}
                {cr.admin && cr.admin.frequentationDuMois.length > 0 && (
                  <VueSeule vue="admin">
                    <Frise cours={cr.admin.frequentationDuMois} partEffectifMin={partEffectifMin} titre="Fréquentation du mois" dense />
                  </VueSeule>
                )}
                {/* Le seul bouton d'action de l'écran, et seulement là où l'on parle de soi. Il passe
                    **avant** la bande d'indicateurs de sa vue : ainsi il reste collé sous la bascule,
                    donc visible sans faire défiler sur un écran de 390 px — « Présent » tient
                    toujours en deux appuis. */}
                <VueSeule vue="personnel">
                  <BoutonPresences />
                </VueSeule>
                {/* `cr.admin` est `null` sans élévation : pour tout le monde d'autre — y compris un
                    administrateur entré par son lien —, ce bloc n'est pas caché, il **n'existe
                    pas** : ni ses chiffres, ni son balisage ne partent au navigateur. */}
                {cr.admin && (
                  <VueSeule vue="admin">
                    <IndicateursAdmin admin={cr.admin} seancesPassees={cr.seancesPassees} aVenir={cr.aVenir} />
                    {/* Deux bandes, deux registres : au-dessus ce qui appelle un geste d'ici le
                        prochain cours, ici ce qui dit où en est le trimestre et se décide en
                        réunion. La seconde porte son propre titre — sans lui, les chiffres de bilan
                        se lisaient comme autant d'alertes de plus. */}
                    <ChiffresDuTrimestre admin={cr.admin} seancesPassees={cr.seancesPassees} />
                    <BlocEquipe ateliersEnAttente={cr.admin.ateliersEnAttente} invitesSansReponse={cr.admin.invitesSansReponse} />
                  </VueSeule>
                )}
                {/* **Empilées, les fiches de cours**. Une fiche porte une liste nominative, une
                    jauge et trois réponses : en demi-largeur, une séance annulée de 90 px
                    laisserait un demi-écran de blanc à côté d'une séance à sept parties. Et l'ordre
                    ne se discute plus : **on ouvre l'application pour savoir ce qui se passe
                    mardi**, pas pour regarder ses blasons. */}
                {cr.prochaines.length > 0 && (
                  <VueSeule vue="personnel">
                    <FichesProchains seances={cr.prochaines} partEffectifMin={partEffectifMin} personnel />
                  </VueSeule>
                )}
                {/* Les blasons restent dans la colonne large : en demi-largeur ils se rognaient. */}
                <VueSeule vue="personnel">
                  <BlocProgression moi={cr.moi} />
                </VueSeule>
              </>
            }
            cote={
              <>
                {/* Les bandes d'indicateurs : un chiffre, son libellé, son détail. Elles passent à
                    une colonne dans la colonne de droite — exactement leur forme sur téléphone. */}
                <VueSeule vue="club">
                  <IndicateursClub aVenir={cr.aVenir} />
                </VueSeule>
                <VueSeule vue="personnel">
                  <IndicateursPersonnels aVenir={cr.aVenir} moi={cr.moi} />
                </VueSeule>
                {/* Chaque vue a son passé : celui du club d'un côté, le sien de l'autre. Les deux
                    restent **dans** le fournisseur de vue — dehors, `VueSeule` lirait la valeur par
                    défaut du contexte et rien ne s'afficherait jamais. */}
                <VueSeule vue="club">
                  <RaccourciCoursPasses />
                </VueSeule>
                <VueSeule vue="personnel">
                  <Raccourcis />
                </VueSeule>
                {/* L'annonce du prochain événement accompagne l'écran, elle ne le commande pas : sa
                    place est ici. Elle est **aussi** rendue dans la branche « rien à faire » plus
                    haut — un compte sans trimestre doit voir le stage du mois prochain. */}
                {cr.evenement && <LigneEvenement evenement={cr.evenement} />}
              </>
            }
          />
        </FournisseurVue>
      )}

    </div>
  );
}
