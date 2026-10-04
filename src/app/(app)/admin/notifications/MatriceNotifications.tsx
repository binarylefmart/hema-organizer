import Link from "next/link";
import type { EstimationEnvois } from "@/lib/email/volume";
import { raisonCanalIndisponible, type EtatCanal, type EtatsCanaux } from "@/lib/notifications/canaux";
import {
  CANAUX,
  CANAUX_PAR_NOTIFICATION,
  COUPLES_EMIS,
  DESCRIPTIONS,
  LIBELLES_CANAUX,
  LIBELLES_MODE,
  MODES_ENVOI,
  RAISON_ROUTAGE_FIXE,
  TYPES_NOTIFICATION,
  champMode,
  champNotification,
  estRoutable,
  type Canal,
  type PreferencesNotifications,
  type TypeNotification,
} from "@/lib/notifications/preferences";
import { CLASSES_CONTROLE } from "@/components/ui/Champ";
import { cleValeurServeur } from "@/components/ui/valeur-serveur";
import { Icone } from "@/components/ui/Icone";
import { lienCanal } from "./liens";
import { RAISON_NON_EMIS, raisonSansObjet } from "./raisons";

/**
 * **La matrice notification × canal : un vrai tableau**.
 *
 * C'étaient **huit cartes de trois colonnes** — une carte par notification, les six canaux rangés
 * trois par ligne dedans —, soit 5 664 px de haut mesurés à 1 920 px (4 632 px après l'arrivée du
 * sommaire). Pour répondre à « qu'est-ce qui part sur Telegram ? », il fallait parcourir les huit
 * cartes et retrouver, dans chacune, la case au même endroit. C'est la définition d'un tableau : une
 * ligne par notification, une colonne par canal, et la réponse se lit **en descendant une colonne**.
 * Le dépôt a une doctrine pour ça — « un tableau s'élargit, une carte non » —, et c'est elle qui a
 * mis cet écran dans `ECRANS_LARGES` (`admin/layout.tsx`) : la largeur vient de la mise en page, ce
 * fichier ne porte aucune largeur de page.
 *
 * **Une seule mise en page, deux affichages** (patron de `src/components/ui/Tableau.tsx`) : le même
 * arbre est une **pile de fiches** en dessous du palier (`block`) et un **vrai tableau** au-delà
 * (`lg:table`, `thead` en `hidden lg:table-header-group`, `tr` en `block lg:table-row`, cellules en
 * `block lg:table-cell`). Aucun arbre jumeau masqué en CSS : le navigateur range, le serveur ne
 * devine pas la largeur de l'écran.
 *
 * **Le palier est `lg` (1 024 px), celui de la page elle-même** — pas le `md` de `Tableau` : sept
 * colonnes (la notification et ses six canaux) dans la colonne de lecture seraient pires que les
 * fiches, et `lg:` ne mesure que la **fenêtre**, jamais le conteneur (la leçon du 30/09, cf.
 * `bandes-pleine-largeur.test.ts`). Ici c'est légitime : au-delà de 1 024 px la page *est* large,
 * puisque c'est le palier de `PLEINE_LARGEUR`.
 *
 * **Ce que le passage au tableau ne devait rien coûter, et n'a rien coûté** : les cases `disabled`
 * d'un canal non configuré avec leur raison en infobulle, les cellules « sans objet » avec la leur,
 * le lien « Configurer <canal> » sous une case indisponible, le choix « Envoi par email » des quatre
 * types routables avec sa phrase chiffrée, et le texte des non routables. Le **contrat serveur** ne
 * bouge pas d'un caractère : mêmes `name` (`champNotification`, `champMode`), mêmes `id`
 * (`#<type>-<canal>`), et surtout mêmes classes `cellule-<canal>`, dont dépend la règle `:has()` qui
 * grise la colonne d'un canal décoché (elle est écrite dans la page, avec les cases des canaux).
 *
 * **Où l'information a changé de place, et pourquoi** :
 *
 * - le **nom du canal** était écrit dans chacune des 48 cellules ; au-delà du palier, c'est l'en-tête
 *   de colonne qui le porte, donc il passe en `lg:sr-only` — il reste dans le **nom accessible** de la
 *   case (`sr-only` déplace, il ne supprime pas), et un lecteur d'écran annonce de toute façon
 *   l'en-tête de colonne et celui de ligne ;
 * - « **non configuré** » est une propriété de **colonne**, pas de cellule : il monte dans l'en-tête,
 *   une fois, au lieu d'être répété huit fois sous les yeux. L'infobulle de chaque case garde sa
 *   raison complète, et la case reste `disabled` ;
 * - « **prévu** » était une propriété de **couple** (`COUPLES_EMIS`), affichée en pastille dans la
 *   cellule. **Elle n'existe plus**. Deux mots côte à côte dans un tableau de 48 cellules demandaient
 *   d'apprendre un vocabulaire avant de lire la grille, alors que **la forme de la cellule dit déjà
 *   tout** : une case grisée se réglera quand le service sera branché, une cellule vide ne se réglera
 *   jamais. Les deux raisons restent en infobulle — elles expliquent, elles ne sont plus à décoder.
 */

/**
 * **La case d'un couple (notification × canal).**
 *
 * Elle n'emploie pas la brique `Case` du dépôt pour une seule raison, et elle est structurelle : le
 * `label` de `Case` est une **chaîne**, or ici l'étiquette a trois morceaux qui ne se traitent pas
 * pareil au-delà du palier — le nom du canal (que l'en-tête de colonne reprend, donc `lg:sr-only`),
 * la pastille « prévu » (propre au couple, donc toujours visible) et l'état « non configuré » (propre
 * à la colonne, donc remonté dans l'en-tête). Ce qui fait la valeur de `Case`, en revanche, est repris
 * **mot pour mot** : la clé de remontage posée sur le contrôle à partir de la valeur du serveur
 * (`cleValeurServeur`), sans quoi un second « Enregistrer » renverrait la valeur du chargement de la
 * page (voir `src/components/ui/valeur-serveur.ts`).
 *
 * L'infobulle est portée par le `<label>`, et non par l'`<input>` comme avant : un contrôle
 * `disabled` n'affiche pas toujours la sienne, alors que son étiquette — qui occupe toute la cellule —
 * l'affiche toujours. C'est la même phrase (`raisonCanalIndisponible`), au même endroit sous le doigt.
 */
function CaseCouple({ type, canal, coche, etat }: { type: TypeNotification; canal: Canal; coche: boolean; etat: EtatCanal }) {
  const indisponible = !etat.operationnel;
  /*
   * **Un couple que le code n'émet pas est grisé lui aussi**, et plus annoncé par une pastille.
   * Aujourd'hui ce sont les couples WhatsApp : le canal attend un service d'envoi, donc ils sont
   * déjà grisés par `indisponible` — mais le jour où ce service arrive sans que `COUPLES_EMIS` le
   * suive, la case redeviendrait cochable **sans que rien ne parte**. La règle tient donc au
   * couple, pas à l'état du canal, et le serveur la tient aussi (`figerCanauxIndisponibles`) : une
   * case grisée n'exprime aucune décision, dans les deux sens.
   */
  const emis = COUPLES_EMIS[type].includes(canal);
  const figee = indisponible || !emis;
  return (
    <label
      htmlFor={`${type}-${canal}`}
      title={indisponible ? raisonCanalIndisponible(etat) : emis ? undefined : RAISON_NON_EMIS}
      // 48 px de haut au doigt (la cible tactile du dépôt), rien d'imposé au-delà du palier où la
      // cellule n'a plus qu'une case à centrer.
      className="flex min-h-12 cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 py-3 lg:min-h-0 lg:justify-center lg:gap-x-2 lg:py-0"
    >
      <input
        key={cleValeurServeur({ defaultChecked: coche })}
        id={`${type}-${canal}`}
        name={champNotification(type, canal)}
        type="checkbox"
        defaultChecked={coche}
        disabled={figee}
        className="size-6 shrink-0 accent-primaire"
      />
      {/* Le nom du canal : visible au doigt, repris par l'en-tête de colonne au-delà du palier — il
          reste dans le nom accessible de la case, d'où `sr-only` et non `hidden`. */}
      <span className="lg:sr-only">{LIBELLES_CANAUX[canal]}</span>
      {/* Les espaces entre les morceaux sont écrits : un texte sans eux donne « Discordprévu— non
          configuré » au lecteur d'écran, qui concatène les éléments en ligne sans rien ajouter. Une
          suite d'espaces n'est pas rendue dans un conteneur `flex`, l'écart reste celui du `gap`. */}
      {indisponible && <span className="text-sm text-texte-secondaire lg:sr-only">{" — non configuré"}</span>}
    </label>
  );
}

/** Le tableau des couples, et le choix d'envoi de chaque notification. */
export function MatriceNotifications({ prefs, etats, volume }: { prefs: PreferencesNotifications; etats: EtatsCanaux; volume: EstimationEnvois }) {
  return (
    <table className="block w-full border-collapse break-words text-left lg:table lg:table-fixed">
      <caption className="sr-only">Ce que le club envoie ou publie, notification par notification et canal par canal</caption>
      <thead className="hidden lg:table-header-group">
        <tr>
          <th scope="col" className="w-72 px-2 pb-2 align-bottom text-sm font-semibold uppercase tracking-wide text-texte-secondaire">
            Notification
          </th>
          {CANAUX.map((canal) => (
            /* `cellule-<canal>` jusque dans l'en-tête : un canal décoché grise alors **sa colonne
               entière**, titre compris, au lieu de laisser un en-tête net au-dessus de cases
               éteintes. C'est la même règle `:has()`, aucune classe de plus. */
            <th
              key={canal}
              scope="col"
              className={`cellule-${canal} ${etats[canal].operationnel ? "" : "canal-non-configure"} px-2 pb-2 align-bottom text-center text-sm`}
            >
              <span className="block font-semibold uppercase tracking-wide text-texte-secondaire">{LIBELLES_CANAUX[canal]}</span>
              {!etats[canal].operationnel && <span className="block font-semibold text-ocre">non configuré</span>}
            </th>
          ))}
        </tr>
      </thead>
      {TYPES_NOTIFICATION.map((type) => (
        /*
         * **Un `tbody` par notification, et c'est lui qui fait la fiche.** La ligne des cases et la
         * ligne « Envoi par email » appartiennent à la même notification : groupées, elles se
         * séparent des voisines d'un seul filet (le `divide-y` des fiches d'avant), au doigt comme
         * au-delà du palier.
         */
        <tbody
          key={type}
          /* `first-of-type` et non `first` : les enfants du tableau sont `caption, thead,
              tbody×8`, donc le premier `tbody` n'est **pas** `:first-child` — les deux classes ne
              s'appliquaient jamais. `last:` fonctionnait, lui : le dernier `tbody` est bien le
              dernier enfant. */
          className="block border-t border-bordure/60 py-3 first-of-type:border-t-0 first-of-type:pt-0 last:pb-0 lg:table-row-group lg:py-0"
        >
          <tr className="block lg:table-row">
            {/*
              * **`aria-label` : l'en-tête de rangée ne vaut que le titre**. Un lecteur d'écran
              * annonce le nom de l'en-tête de rangée **avant chacune des six cellules** de la
              * ligne : avec la phrase « quand » dans le même `<th>`, c'étaient jusqu'à **65 mots de
              * préambule, six fois, sur huit lignes** (l'alerte « peu de monde » à elle seule). La
              * matrice en devenait impraticable à l'oreille — et c'est une régression du tableau :
              * en cartes, la phrase était un `<p>`, lu une fois.
              *
              * Le nom se limite donc au titre, et la phrase **reste dans la cellule** : elle n'est
              * plus répétée à chaque case, mais qui parcourt la ligne l'entend toujours. La seule
              * autre façon de faire aurait été de la sortir dans une rangée à elle, ce qui aurait
              * changé l'ordre de lecture sur un téléphone — la phrase décrit la notification, elle
              * se lit avant ses interrupteurs.
              */}
            <th
              scope="row"
              aria-label={DESCRIPTIONS[type].titre}
              className="block text-left align-top font-normal lg:table-cell lg:w-72 lg:py-3 lg:pr-4"
            >
              <span className="block font-semibold">{DESCRIPTIONS[type].titre}</span>
              <span className="block text-sm text-texte-secondaire">{DESCRIPTIONS[type].quand}</span>
            </th>
            {CANAUX.map((canal) => {
              const concerne = CANAUX_PAR_NOTIFICATION[type].includes(canal);
              if (!concerne) {
                /* **« Sans objet » dit toujours pourquoi.** L'infobulle annonçait « message
                   personnel : envoyé par email uniquement » pour *toutes* les cellules vides, ce
                   qui était faux dès la deuxième (« période suivante » n'est pas un message
                   personnel, c'est une affaire de bureau) — et franchement trompeur avec la colonne
                   « Site du club », dont les absences ont chacune leur raison (`RAISON_API_EXCLUE`,
                   affichée telle quelle : un réglage absent sans explication passe pour un oubli, et
                   quelqu'un finit par l'« ajouter »). La raison reste sur la **cellule** : elle est
                   la même pour qui la survole au doigt ou à la souris. */
                return (
                  /* **Pas de `cellule-<canal>` ici, et c'est voulu** : la règle `:has()` qui grise un
                     canal décoché pose aussi `pointer-events: none`, ce qui emporterait l'infobulle
                     avec l'opacité — la raison deviendrait illisible pour la seule raison que le
                     canal est coupé, alors qu'elle n'a rien à voir avec ce réglage (ces couples
                     n'existent pas, quoi qu'on coche). C'était déjà le cas avant le tableau. */
                  /* **Vide, et `hidden` sous le palier** : « sans objet » ne s'écrit plus, et une
                      cellule vide qui garderait son `py-3` laisserait 24 px de blanc par canal
                      absent dans la fiche d'un téléphone — jusqu'à quatre par notification, pour ne
                      rien dire. Au-delà du palier elle reste en place : c'est une colonne de
                      tableau, le vide y est l'information. */
                  <td
                    key={canal}
                    className="hidden lg:table-cell lg:px-2 lg:py-3 lg:text-center lg:align-middle"
                    title={raisonSansObjet(type, canal)}
                  />
                );
              }
              const etat = etats[canal];
              return (
                <td
                  key={canal}
                  /* `canal-non-configure` : la colonne reste grisée, mais garde ses événements —
                     sinon l'infobulle qui dit pourquoi la case est morte et le lien qui la ranime
                     deviennent tous deux inatteignables (voir `CSS_CANAL_COUPE`, côté page). */
                  className={`cellule-${canal} ${etat.operationnel ? "" : "canal-non-configure"} block lg:table-cell lg:px-2 lg:py-3 lg:text-center lg:align-middle`}
                >
                  {/* `coche` dit ce que la **base** porte, sans le masquer quand le canal est
                      débranché : une case décochée à l'écran alors qu'elle est vraie en base, c'est
                      un envoi — ou une publication sur Internet — qui repart dès qu'on branche le
                      canal, sans que personne l'ait voulu. La case reste `disabled` : la montrer
                      juste ne permet rien de plus. */}
                  <CaseCouple type={type} canal={canal} coche={prefs.notifications[type][canal] ?? false} etat={etat} />
                  {!etat.operationnel && (
                    /* Le renvoi reste **sous la case**, là où la question se pose. Au-delà du palier,
                       le nom du canal est déjà en tête de colonne : seul « Configurer » s'affiche,
                       mais le lien garde son libellé entier pour qui l'entend lire. */
                    <Link
                      href={lienCanal(canal)}
                      className="mb-2 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-lien lg:mb-0 lg:min-h-0 lg:py-1"
                    >
                      Configurer <span className="lg:sr-only">{LIBELLES_CANAUX[canal]}</span>
                      <Icone nom="fleche" taille={16} />
                    </Link>
                  )}
                </td>
              );
            })}
          </tr>
          {/*
           * **« Envoi par email » reste SOUS la ligne, et pas dans une septième colonne.** Essayé
           * dans une colonne : la liste déroulante fait 14 rem à elle seule et sa phrase d'aide est
           * une phrase — « Un email par personne — aujourd'hui 12 destinataires à chaque envoi », ou
           * l'adresse de la liste et le lien pour la changer. Dans une colonne de 7 rem, elle
           * repousse les six canaux à la largeur d'une case et fait des lignes de huit lignes de
           * haut : on perdrait exactement ce qu'on vient de gagner. Une cellule qui s'étend sur
           * toute la largeur, en revanche, se lit comme ce qu'elle est — un réglage de la ligne du
           * dessus, à l'intérieur du même `tbody`, avec un fond légèrement appuyé pour qu'on ne la
           * rattache pas à la notification suivante.
           */}
          <tr className="block lg:table-row">
            <td colSpan={CANAUX.length + 1} className="block lg:table-cell lg:rounded-xl lg:bg-surface-douce/50 lg:px-2 lg:py-2">
              {/* **« Par membre » ou « Liste de distribution »** : le réglage qui décide si l'email
                  part en N exemplaires ou en un seul. Il ne concerne que l'email — le téléphone reste
                  personnel dans tous les cas, et les salons ont toujours été collectifs. */}
              {estRoutable(type) ? (
                <div
                  /* `canal-non-configure` ici aussi, et c'est le même défaut une ligne plus bas :
                      en production **sans SMTP**, `#canal-email` est rendu décoché, donc ces quatre
                      lignes devenaient inertes — avec le lien « Enregistrer l'adresse sur la page
                      du canal Email », c'est-à-dire **le geste qui sort de cette situation**.
                      Trouvé par la relecture adverse, à l'endroit que la première correction
                      n'avait pas atteint. */
                  className={`cellule-email ${etats.email.operationnel ? "" : "canal-non-configure"} mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 lg:mt-0`}
                >
                  <label htmlFor={`mode-${type}`} className="font-semibold">
                    Envoi par email :
                  </label>
                  <select
                    // La valeur vient du serveur : la clé la suit, pour que le champ reparte de la
                    // valeur enregistrée après un « Enregistrer » (voir `cleValeurServeur`).
                    key={cleValeurServeur({ defaultValue: prefs.modes[type] })}
                    id={`mode-${type}`}
                    name={champMode(type)}
                    defaultValue={prefs.modes[type]}
                    className={`${CLASSES_CONTROLE} border-bordure px-3`}
                    aria-describedby={`mode-${type}-aide`}
                  >
                    {/* Pas de parenthèse explicative : les deux étiquettes se comprennent seules,
                        et la phrase d'aide juste dessous dit déjà le reste — avec des chiffres, ce
                        qu'une parenthèse figée ne peut pas faire. */}
                    {MODES_ENVOI.map((mode) => (
                      <option key={mode} value={mode}>
                        {LIBELLES_MODE[mode]}
                      </option>
                    ))}
                  </select>
                  {/* **Où se règle l'adresse, dit DANS la ligne**. Le renvoi existait en bas de
                      l'écran, après la liste entière des notifications : on choisit « Liste de
                      distribution » ici, et la seule question qui vient ensuite — *quelle* adresse
                      ? — trouvait sa réponse dix tuiles plus loin. Il est donc **sur la ligne du
                      choix**, et il insiste quand aucune adresse n'est encore enregistrée : ce
                      réglage-là n'enverrait nulle part. */}
                  <p id={`mode-${type}-aide`} className="basis-full text-sm text-texte-secondaire lg:basis-auto">
                    {prefs.modes[type] === "liste" ? (
                      <>
                        {prefs.adresseListe ? (
                          <>Un message à {prefs.adresseListe}.</>
                        ) : (
                          <span className="font-semibold text-ocre">Aucune adresse de liste n&apos;est encore enregistrée : rien ne partira.</span>
                        )}{" "}
                        Les refus individuels ne s&apos;y appliquent plus : c&apos;est le serveur mail du club qui gère les départs.{" "}
                        <Link href={lienCanal("email")} className="font-semibold text-lien">
                          {prefs.adresseListe ? "Changer l'adresse" : "Enregistrer l'adresse"} sur la page du canal Email
                        </Link>
                        .
                      </>
                    ) : (
                      `Un email par personne — aujourd'hui ${volume.lignes.find((l) => l.type === type)?.parEnvoi ?? 0} destinataires à chaque envoi.`
                    )}
                  </p>
                </div>
              ) : (
                <p className="mt-1 text-sm text-texte-secondaire lg:mt-0">
                  <span className="font-semibold">Toujours « {LIBELLES_MODE.individuel} »</span> — {RAISON_ROUTAGE_FIXE[type]}
                </p>
              )}
            </td>
          </tr>
        </tbody>
      ))}
    </table>
  );
}
