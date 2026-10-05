import { AFFICHE_TAILLE_MAX_LIBELLE } from "@/lib/constants";
import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/current-user";
import { PART_EFFECTIF_MAX, PART_EFFECTIF_MIN, identite } from "@/lib/identite";
import { SEUIL_PLANCHER, seuilEnPersonnes } from "@/lib/presences";
import { db } from "@/lib/db";
import { THEMES } from "@/lib/themes";
import { enregistrerApparenceClub, enregistrerFuseauClub, enregistrerNomsClub, enregistrerPartEffectifClub } from "@/actions/identite";
import { decalageMinutes, entreesFuseaux, libelleDecalage } from "@/lib/fuseau";
import { ChampLogo } from "@/components/admin/ChampLogo";
import { Carte } from "@/components/ui/Carte";
import { Case, Champ } from "@/components/ui/Champ";
import { DeuxPiles } from "@/components/ui/DeuxPiles";
import { FormulaireAction } from "@/components/ui/FormulaireAction";
import { ChampListe } from "@/components/ui/ChampListe";

export const metadata: Metadata = { title: "Le club" };

/**
 * **L'effectif invité du trimestre en cours**, uniquement pour montrer au bureau ce que sa part
 * donne en personnes. Les comptes de service n'y sont pas : ils ne viennent à aucun cours et ne
 * comptent dans aucun taux (même filtre que l'alerte « peu de monde »).
 *
 * `null` quand aucun trimestre n'est ouvert — l'écran dit alors ce qu'il sait, plutôt que de
 * calculer « 20 % de 0 ».
 */
async function effectifInvite(): Promise<number | null> {
  const periode = await db.period.findFirst({ where: { statut: "ACTIVE" }, orderBy: { dateDebut: "desc" }, select: { id: true } });
  if (!periode) return null;
  return db.periodMember.count({ where: { periodId: periode.id, user: { service: false } } });
}

/**
 * **L'identité du club** : son nom, son sigle, ses couleurs, son logo.
 *
 * **Pourquoi cet écran existe.** L'outil a été écrit pour un club, et son nom était dans le code :
 * un second club ne pouvait l'installer qu'en repassant sur vingt fichiers. Tout ce qui nomme et
 * habille l'application se règle désormais ici — et se voit tout de suite partout, parce que ces
 * valeurs sont lues à chaque page : l'en-tête, le titre de l'onglet, le manifeste de l'application
 * installée sur les téléphones, l'en-tête des emails, l'avatar des annonces Discord et les images
 * des pages de partage.
 *
 * C'est aussi pourquoi l'écran est réservé au bureau (`settings.technical`, élévation exigée) :
 * changer le nom ou le logo, c'est changer ce que voient **tous** les membres et ce qui part dans
 * leur boîte mail. Le journal d'audit garde chaque modification.
 */
/** « 23 h 12 » dans le fuseau donné. */
function heureAuClub(fuseau: string): string {
  return new Intl.DateTimeFormat("fr-FR", { timeZone: fuseau, hour: "2-digit", minute: "2-digit" }).format(new Date()).replace(":", " h ");
}

export default async function PageIdentite() {
  await requirePermission("settings.technical");
  const [club, invites] = await Promise.all([identite(), effectifInvite()]);
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-3xl">Le club</h1>
        <p className="mt-1 text-texte-secondaire">
          Le nom, les couleurs et le logo de cette installation. Tout se voit immédiatement dans l&apos;application, dans les emails
          et sur les téléphones où elle est installée.
        </p>
      </div>

      {/* **Deux piles indépendantes à partir de 1 536 px** (). Mesuré avant le partage, sur une
          fenêtre de 1 920 px : **2 054 px de haut**, 1 440 px de contenu — et des champs de **1 398
          px** pour un nom de club et un sigle de trois lettres, soit très exactement ce que la
          doctrine du dépôt refuse (« un formulaire ne s'élargit pas », `CLAUDE.md`). La largeur
          sert donc à **monter les cartes suivantes à côté de la première**, pas à étirer leurs
          champs.

          **La coupure est enfin celle qu'on aurait dessinée**. Le premier partage avait dû suivre
          les formulaires plutôt que le sens : le nom, le sigle, le thème et la couleur étaient **un
          seul `<form>`** enregistré par une seule action, et deux colonnes ne peuvent pas se
          partager un `<form>` — d'où une carte intitulée « Nom » qui portait aussi le thème et la
          couleur, et deux logos rangés loin du thème avec lequel ils vont. L'action a donc été
          scindée (`enregistrerNomsClub`, `enregistrerApparenceClub`, avec les mêmes verrous et deux
          entrées d'audit distinctes — voir `src/actions/identite.ts`), et la page se range comme
          elle se lit :

          - **à gauche, ce que le club *est*** : son nom entier, son sigle. Puis la **part
          d'effectif**, qui n'est ni ce qu'il est ni comment il se montre — c'est une décision
          d'organisation, elle a son propre formulaire et sa propre action — et qui équilibre la
          paire ; - **à droite, comment il *se montre*** : son thème, sa couleur de marque, ses deux
          logos.

          À 708 px de colonne, mesure en main : 425 px à gauche pour le nom et le sigle, 487 pour
          l'effectif ; 491 px à droite pour l'apparence, 590 pour les logos. Soit **936 contre 1
          105**, et c'est la paire la mieux équilibrée que ce découpage permette — l'autre coupure
          possible (apparence à gauche, effectif à droite) donne 940 contre 1 101, à quatre pixels
          près la même chose, et range les logos loin du thème.

          **Et la page n'y gagne pas un pixel : 1 486 px contre 1 482 à 1 920.** Un second
          formulaire coûte un en-tête de carte et un bouton — environ 125 px —, et ce coût se paie à
          toutes les largeurs : 2 009 px contre 1 851 à 1 280, 3 222 contre 3 072 sur un téléphone
          de 390. Ce partage-ci ne s'achète donc **pas** en hauteur, il s'achète en lecture : une
          carte dit ce qu'elle porte, les deux logos sont avec le thème dont ils dépendent, et
          chaque bouton nomme ce qu'il enregistre. La hauteur, c'est le partage en deux piles qui
          l'avait prise le matin même (2 054 → 1 482).

          **L'ordre du téléphone, et la seule chose qu'on n'a pas pu lui donner.** `DeuxPiles` rend
          la pile de gauche puis celle de droite : en dessous du palier, le flux est donc *nom et
          sigle, effectif, apparence, logos*. L'ordre « nom, apparence, effectif, logos » qu'on
          aurait voulu lire est un **zigzag** entre les deux piles (haut-gauche, haut-droite,
          bas-gauche, bas-droite) et ne s'obtient qu'en réordonnant en CSS — ce que `DeuxPiles`
          s'interdit explicitement, parce qu'un lecteur d'écran lirait alors un autre ordre que
          l'œil. Entre les deux, on garde le sens des colonnes (la part d'effectif à gauche, les
          logos avec le thème) et un seul flux dans l'ordre de la source. Les deux premières cartes
          du téléphone restent celles d'avant.

          Les découpes internes et les plafonds de champ ci-dessous sont des paliers de
          **conteneur** (`@md`, `@2xl`), qui ne s'appliquent pas dans une carte de 326 px : à 390
          px, rien n'est découpé en colonnes. */}
      <DeuxPiles
        gauche={
          <>
            <Carte titre="Nom et sigle">
              <FormulaireAction action={enregistrerNomsClub} bouton="Enregistrer le nom" className="@container">
                {/* **Les deux champs se rangent côte à côte quand la CARTE en a la place — pas
                    quand la fenêtre l'a**. C'est le piège que `CLAUDE.md` nomme : `lg:` mesure la
                    fenêtre, et dans une pile de 700 px une découpe en `lg:grid-cols-2` aurait posé
                    ici des champs de ~320 px sur un écran de 1 920, soit plus étroits que les 324
                    px d'un téléphone. Les paliers sont donc ceux du **conteneur** : `@2xl` = 42
                    rem, la largeur en dessous de laquelle deux champs côte à côte seraient plus
                    serrés que sur un téléphone. Résultat mesuré : 324 px à 390, 587 px à 1 280
                    (deux colonnes dans une page encore d'une seule pile), 666 px à 1 920 (une
                    colonne dans la pile de gauche) — plus jamais 1 398.

                    **`grid-cols-1` est écrit, et ce n'est pas une redondance** : sans lui, la
                    colonne implicite d'une grille est une piste `auto`, qui grossit jusqu'au
                    `max-content` de son contenu — ici la ligne d'aide dépliée. Mesuré avant de
                    l'ajouter : des champs de **564 px dans une carte de 326**, et 207 px de
                    débordement horizontal sur un téléphone de 390. `grid-cols-1` vaut `minmax(0,
                    1fr)`, donc la largeur de la carte, comme le `flex flex-col` qu'il remplace. */}
                <div className="grid grid-cols-1 gap-4 @2xl:grid-cols-2">
                  <Champ
                    label="Nom du club, en entier"
                    name="club"
                    defaultValue={club.club}
                    maxLength={80}
                    placeholder="Le nom entier de votre association"
                    autoComplete="off"
                    aide="Il apparaît en entier dans les emails, sur les pages publiques de partage et dans les annonces Discord. Laissé vide, l'application ne parle que de son propre nom."
                  />
                  {/* Douze signes au maximum : le champ se plafonne dès que la carte est plus large
                      qu'un téléphone (`@md` = 28 rem), et garde sa pleine largeur en dessous. */}
                  <Champ
                    label="Sigle"
                    name="sigle"
                    defaultValue={club.sigle}
                    maxLength={12}
                    placeholder="Trois ou quatre lettres"
                    autoComplete="off"
                    className="@md:max-w-48"
                    aide={`C'est lui qui change d'un club à l'autre : l'application s'appelle « ${club.nomCourt} ». Sur un téléphone étroit, « ${club.suffixe} » s'efface et le sigle reste seul.`}
                  />
                </div>
              </FormulaireAction>
            </Carte>

            <Carte titre="Effectif">
              <FormulaireAction action={enregistrerPartEffectifClub} bouton="Enregistrer la part">
                <Champ
                  label="Part minimale de l'effectif (%)"
                  name="partEffectifMin"
                  type="number"
                  defaultValue={String(club.partEffectifMin)}
                  min={PART_EFFECTIF_MIN}
                  max={PART_EFFECTIF_MAX}
                  step={1}
                  inputMode="numeric"
                  className="w-28"
                  aide={`En dessous de cette part des invités du trimestre, un cours ne vaut guère la peine d'ouvrir la salle. C'est le repère de l'alerte « peu de monde » envoyée à l'encadrement, le trait en pointillé de la frise de l'accueil, le repère des jauges et le mot écrit sur chaque carte de cours (« Peu de monde », « Effectif juste », « Bien rempli »). Entre ${PART_EFFECTIF_MIN} et ${PART_EFFECTIF_MAX} %.`}
                />
                {/* **Le résultat, pas seulement le pourcentage** : un chiffre en pour cent ne se vérifie
                    pas d'un coup d'œil, et c'est en personnes que le bureau décide d'ouvrir la salle.
                    L'effectif affiché est celui du trimestre en cours, donc ce que la part vaut vraiment
                    ce soir. */}
                <p className="rounded-xl bg-surface-douce px-4 py-3 text-[1.0625rem]">
                  {invites === null ? (
                    <>
                      Aucun trimestre ouvert pour l&apos;instant : la part s&apos;appliquera à l&apos;effectif invité de chaque trimestre.
                      Elle ne descend <strong>jamais sous {SEUIL_PLANCHER} personnes</strong>.
                    </>
                  ) : (
                    <>
                      <strong>
                        {club.partEffectifMin} % de {invites} invités, soit {seuilEnPersonnes(club.partEffectifMin, invites)} personnes
                      </strong>{" "}
                      — jamais moins de {SEUIL_PLANCHER}. En dessous, l&apos;encadrement est prévenu et le cours est marqué « Peu de monde ».
                    </>
                  )}
                </p>
                <p className="text-sm text-texte-secondaire">
                  Ce réglage s&apos;exprime en <em>part de l&apos;effectif</em>, et non en nombre de présents : un même nombre ne
                  pourrait pas servir un club de douze et un club de quatre-vingts. Une part suit l&apos;effectif toute seule, et le plancher de{" "}
                  {SEUIL_PLANCHER} personnes garde son sens aux petits clubs — il n&apos;y a plus rien à ajuster quand le club grandit.
                </p>
              </FormulaireAction>
            </Carte>

            <Carte titre="Fuseau horaire">
              <FormulaireAction action={enregistrerFuseauClub} bouton="Enregistrer le fuseau">
                {/* La liste du dépôt, non pilotée : plus de vingt entrées, donc une recherche (« Montréal »,
                    « Bruxelles »). Les fuseaux courants d'un club francophone sont en tête. */}
                <ChampListe
                  label="Fuseau du club"
                  name="fuseau"
                  id="fuseau"
                  valeur={club.fuseau}
                  entrees={entreesFuseaux(club.fuseau)}
                  aide="Les heures des séances, la date du jour, l'heure du récap du soir et les tâches du matin s'entendent dans ce fuseau. Les séances déjà créées gardent leurs heures."
                />
                {/* **L'heure qu'il est au club**, calculée par le serveur dans le fuseau réglé : c'est la
                    vérification qu'on fait d'instinct, et elle évite de deviner un décalage. */}
                <p className="rounded-xl bg-surface-douce px-4 py-3 text-[1.0625rem]">
                  Il est <strong>{heureAuClub(club.fuseau)}</strong> au club ({libelleDecalage(decalageMinutes(club.fuseau))}).
                </p>
              </FormulaireAction>
            </Carte>
          </>
        }
        droite={
          <>
            <Carte titre="Apparence">
              {/* Le thème affichait de nouveau « Parchemin » après « Enregistrer » alors qu'il
                  était bel et bien enregistré — c'est ce champ-ci qui a fait découvrir le défaut.
                  Chaque champ repart désormais de la valeur du serveur tout seul : la clé de
                  remontage est portée par les briques de saisie elles-mêmes (voir
                  `cleValeurServeur`) — pour la liste du thème, par le miroir du serveur de
                  `ChampListe` —, et le message « Apparence enregistrée » survit parce que ce
                  rattrapage vit dans le champ et non sur le formulaire. */}
              <FormulaireAction action={enregistrerApparenceClub} bouton="Enregistrer l'apparence" className="@container">
                {/* Même grille de conteneur que la carte du nom, et pour la même raison : deux
                    colonnes dès que la carte dépasse 42 rem, jamais sur la foi de la fenêtre. */}
                <div className="grid grid-cols-1 gap-4 @2xl:grid-cols-2">
                  {/* Non pilotée, mais **miroir du serveur** : `ChampListe` reprend la valeur fraîche
                      quand la page revient avec un autre `club.theme` (le rôle qu'avait la clé de
                      remontage de l'ancienne liste native), et son champ caché `theme` porte le choix. */}
                  <ChampListe
                    label="Thème du club"
                    name="theme"
                    valeur={club.theme}
                    entrees={THEMES.map((t) => ({ valeur: t.id, libelle: `${t.nom} — ${t.description}` }))}
                    aide="Les couleurs que voit un membre qui n'a rien choisi dans son profil — c'est-à-dire presque tout le monde. Chacun garde le droit de préférer une autre palette."
                  />
                  {/* La **couleur** reste collée à sa case à cocher dans une seule cellule : c'est une
                      information, pas deux, et la case décide de ce que le sélecteur veut dire. */}
                  <div className="flex flex-col gap-4">
                    <Case
                      label="Couleur de marque personnalisée (sinon : celle du thème)"
                      name="marquePersonnalisee"
                      defaultChecked={club.marque !== null}
                    />
                    <Champ
                      label="Couleur de marque"
                      name="marque"
                      type="color"
                      defaultValue={club.marque ?? "#e6c977"}
                      className="h-13 w-28 px-1.5"
                      aide="Le nom du club dans l'en-tête, et les liserés qui l'accompagnent. Décoche la case au-dessus pour revenir à la couleur du thème."
                    />
                  </div>
                </div>
              </FormulaireAction>
            </Carte>

            <Carte titre="Logo">
              <div className="flex flex-col gap-6">
                <ChampLogo
                  emplacement="ecu"
                  titre="Icône carrée"
                  source={club.ecu}
                  deposee={club.ecuDepose}
                  apercuSombre
                  aide="Le petit logo de l'en-tête, l'icône de l'application installée sur les téléphones et la vignette des pages de partage. Une image carrée d'au moins 512 px, sur fond transparent de préférence. Elle est posée sur le fond sombre de l'en-tête : c'est ce que montre l'aperçu."
                />
                <hr className="border-bordure/60" />
                <ChampLogo
                  emplacement="logo"
                  titre="Logo complet"
                  source={club.logo}
                  deposee={club.logoDepose}
                  aide="Le grand logo de la page de connexion et de l'en-tête des emails. Il est toujours posé sur une plaque claire : un logo à texte noir y reste lisible."
                />
                <p className="text-sm text-texte-secondaire">
                  JPEG, PNG ou WebP, {AFFICHE_TAILLE_MAX_LIBELLE} au maximum. Les données cachées de l&apos;image (position GPS, modèle d&apos;appareil) sont
                  retirées à l&apos;enregistrement — un logo finit sur des pages publiques.
                </p>
              </div>
            </Carte>
          </>
        }
      />
    </div>
  );
}
