import { Fragment } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/current-user";
import { getRecapHour, isPublicApiEnabled } from "@/lib/settings";
import { definirHeureRecap, enregistrerAlertesSecurite, enregistrerNotifications, enregistrerPublicationCours } from "@/actions/admin";
import { etatsCanaux, raisonCanalIndisponible } from "@/lib/notifications/canaux";
import { alertesActivees } from "@/lib/alertes";
import {
  CANAUX,
  DESCRIPTIONS,
  LIBELLES_CANAUX,
  LIBELLES_MODE,
  NOTIFICATIONS_TOUJOURS_ENVOYEES,
  TYPES_NOTIFICATION,
  champCanal,
  champCanalRendu,
  getPreferencesNotifications,
} from "@/lib/notifications/preferences";
import { chiffresDuClub, estimerEnvois } from "@/lib/email/volume";
import { Alerte } from "@/components/ui/Alerte";
import { Carte } from "@/components/ui/Carte";
import { Case, Champ } from "@/components/ui/Champ";
import { FormulaireAction } from "@/components/ui/FormulaireAction";
import { Icone } from "@/components/ui/Icone";
import { lienCanal } from "./liens";
import { MatriceNotifications } from "./MatriceNotifications";
import { Pastille } from "@/components/ui/Pastille";
import { PageAvecSommaire, type SectionSommaire } from "@/components/ui/SommaireCollant";

export const metadata: Metadata = { title: "Notifications" };

/**
 * Un canal décoché grise (et rend non tapables) ses cases de la matrice, sans les effacer :
 * une simple règle CSS `:has()`, pour ne pas transformer la page en composant client.
 * Le réglage qui fait foi reste vérifié côté serveur (`notificationActive`).
 *
 * Un canal **non configuré** (pas de salon branché, pas de service WhatsApp) est grisé autrement :
 * ses cases sont rendues `disabled` côté serveur, avec l'explication et le lien de configuration.
 * Là encore, le serveur a le dernier mot (`figerCanauxIndisponibles`) — et les deux façons de
 * griser ont **la même conséquence**, la valeur est conservée dans les deux cas. Ce n'était pas
 * vrai : une case `disabled` n'étant pas envoyée par le navigateur, enregistrer effaçait ce qu'elle
 * portait.
 *
 * **« Deux façons de griser » : il n'y en avait qu'une, et elle emportait l'explication avec
 * elle**. Un canal non configuré est rendu **décoché**, donc la règle `:has()` ci-dessous
 * s'appliquait aussi à sa colonne — `pointer-events: none` comprise. Les quatorze cellules d'un
 * canal non branché perdaient ainsi les deux choses qui les rendent utiles : l'infobulle qui dit
 * **pourquoi** la case est morte, et le lien « Configurer » qui est le **remède**, qui n'était plus
 * cliquable du tout. Un bénévole qui veut brancher Telegram appuyait sur un lien inerte, sous une
 * case muette.
 *
 * **D'où deux façons de griser qui, pour de bon, n'ont pas les mêmes effets** — et la première
 * tentative de correction ne l'avait fait qu'à moitié : rendre le lien cliquable en laissant
 * l'opacité sur sa cellule donnait un lien **vivant mais peint comme un élément mort** (mesuré :
 * contraste 2,12 : 1 pour un texte de 14 px, là où AA exige 4,5), et l'opacité ne se rattrape pas
 * depuis un enfant — elle composite tout le sous-arbre. Le bénévole qui voulait brancher Telegram
 * n'aurait pas essayé d'appuyer.
 *
 * La règle ci-dessous ne vaut donc **que pour un canal configuré qu'on a décoché** : là, les cases
 * sont inertes et rien d'autre ne vit dans la colonne. Un canal **non configuré** porte la classe
 * `canal-non-configure` et n'est pas atténué du tout : il se distingue autrement, et mieux — « non
 * configuré » en ocre dans son en-tête, ses cases `disabled` (que le navigateur grise lui-même), et
 * le lien « Configurer » à pleine lisibilité. La colonne qui demande un geste est la dernière qu'il
 * faut éteindre.
 */
const CSS_CANAL_COUPE = CANAUX.map(
  (canal) => `.reglages-notifications:has(#canal-${canal}:not(:checked)) .cellule-${canal}:not(.canal-non-configure)`,
).join(",\n");

/**
 * **Notifications du club** — heure du récap, canaux d'envoi et matrice notification × canal.
 *
 * L'écran vit dans l'espace admin : ces réglages décident de ce qui part au nom du club, ils
 * demandent donc une connexion par mot de passe et code à usage unique (`settings.technical`),
 * comme le reste de `/admin`. Les instructeurs gardent la main sur le contenu des séances.
 */
export default async function PageNotifications() {
  await requirePermission("settings.technical");
  const [recapHour, prefs, etats, apiActive, alertesSecurite, chiffres] = await Promise.all([
    getRecapHour(),
    getPreferencesNotifications(),
    etatsCanaux(),
    isPublicApiEnabled(),
    alertesActivees(),
    chiffresDuClub(),
  ]);
  const volume = estimerEnvois({ ...chiffres, prefs });
  /**
   * **Ce qui est armé derrière la porte fermée** : les annonces dont la case « Site du club » est
   * cochée en base alors que la publication ne l'est pas. Figées et non éteintes (c'est la
   * doctrine), elles repartiraient **toutes ensemble** au moment où quelqu'un ouvre la porte — et
   * rien ne le disait.
   */
  const annoncesArmees = apiActive ? [] : TYPES_NOTIFICATION.filter((t) => prefs.notifications[t].api === true);

  /**
   * **Les cinq sections de l'écran, mot pour mot**. C'est la page la plus longue de l'espace admin
   * — l'heure du récap, le volume d'emails, la matrice six canaux × huit notifications, la
   * publication sur le site du club et les alertes de sécurité —, et la matrice à elle seule fait
   * deux écrans : sans sommaire, « où se coche la republication ? » se répond en faisant défiler.
   */
  const sections: SectionSommaire[] = [
    { ancre: "recap", titre: "Récap de la veille" },
    { ancre: "volume", titre: "Combien d'emails partent" },
    { ancre: "canaux", titre: "Canaux et notifications" },
    { ancre: "publication", titre: "Publication des cours sur le site du club" },
    { ancre: "alertes", titre: "Alertes de sécurité" },
  ];

  return (
    /*
     * **Un sommaire, et des réglages qui gardent leur largeur de lecture**. Un formulaire large
     * n'est pas plus facile à remplir — il est plus difficile à parcourir des yeux ; ce que la
     * place gagnée apporte ici, c'est de savoir où l'on est dans une page de cinq sections, dont la
     * matrice fait à elle seule deux écrans.
     *
     * **`placement="colonne"`, et c'est une correction, pas une préférence**. Le sommaire était
     * posé en absolu **dans la marge** (`left-full`), ce qui suppose qu'il y ait une marge. Or cet
     * écran est entré dans `ECRANS_LARGES` le matin même : sa mise en page lui donne 90 rem, il n'y
     * a plus de marge, et le sommaire dépassait **du document** — `scrollWidth` 2 024 px pour une
     * fenêtre de 1 920, donc une barre de défilement horizontale sur toute la page, pour une
     * navigation qui vivait hors de l'écran. Les deux placements répondent à la même question (« y
     * a-t-il la place de mettre quelque chose à côté ? ») : en colonne de lecture, la marge ; sur
     * une page déjà large, une colonne de droite ordinaire. Rien ne se décale pour autant, parce
     * que sur cet écran c'est **la mise en page** qui porte la largeur, bandeau d'élévation et
     * onglets compris (c'est tout le point de `PageAvecSommaire`, où un décalage de 190 px a été
     * mesuré).
     *
     * L'espacement est `gap-6`, celui de toutes les piles de cartes du dépôt : un écart propre à un
     * écran est un écart que personne ne sait expliquer.
     */
    <PageAvecSommaire sections={sections}>
      <div>
        <h1 className="text-3xl">Notifications</h1>
        <p className="mt-1 text-texte-secondaire">
          Tout ce que l&apos;application envoie au nom du club — par quel canal, à qui, et quand. Le serveur d&apos;envoi, les salons et l&apos;API publique se
          branchent ici aussi. Réservé au bureau.
        </p>
      </div>
      <Carte id="recap" titre="Récap de la veille">
        <FormulaireAction action={definirHeureRecap} bouton="Enregistrer">
          <Champ
            label="Heure d'envoi (Discord + email), la veille de chaque cours"
            name="recapHour"
            type="time"
            defaultValue={recapHour}
            aide="Heure de Paris. Les envois eux-mêmes sont mis en place à l'étape suivante (notifications)."
          />
        </FormulaireAction>
      </Carte>
      {/* **Annoncer le volume, avant le mur.** Un SMTP gratuit coupe au milieu de la liste : les
          derniers ne reçoivent rien, en silence, et le club ne s'en aperçoit qu'à un cours vide.
          Le chiffre est donc affiché ici, à côté du réglage qui le fait varier. */}
      <Carte id="volume" titre="Combien d'emails partent">
        <p className="text-lg">
          <strong>{volume.membresAvecEmail}</strong> membre{volume.membresAvecEmail > 1 ? "s" : ""} avec adresse × <strong>{volume.coursParSemaine}</strong>{" "}
          cours par semaine ={" "}
          <strong>
            {volume.parSemaine} envoi{volume.parSemaine > 1 ? "s" : ""} par semaine
          </strong>{" "}
          (récap de la veille + les deux rappels).
        </p>
        <p className="mt-1 text-texte-secondaire">
          Un soir de cours : {volume.recapParSoirDeCours} email{volume.recapParSoirDeCours > 1 ? "s" : ""} pour le seul récap. Le pire jour possible — un récap
          et les deux vagues de rappel le même jour — coûte {volume.pireJour} envois.
        </p>
        {volume.quotaJour === null ? (
          <p className="mt-2 text-sm text-texte-secondaire">
            Quota du serveur d&apos;envoi non déclaré :{" "}
            <Link href={lienCanal("email")} className="font-semibold text-lien">
              renseigne-le sur la page du canal Email
            </Link>{" "}
            pour être prévenu avant la coupure.
          </p>
        ) : volume.depasseQuota ? (
          <div className="mt-3">
            <Alerte type="erreur" titre={`Au-dessus du quota déclaré (${volume.quotaJour} envois par jour)`}>
              Le serveur d&apos;envoi coupera au milieu de la liste, et les derniers ne recevront rien — sans que personne ne soit prévenu. Passe le récap ou les
              rappels sur « {LIBELLES_MODE.liste} » ci-dessous : chacun retombe alors à un seul message.
            </Alerte>
          </div>
        ) : (
          <p className="mt-2 text-sm text-texte-secondaire">
            Quota déclaré : {volume.quotaJour} envois par jour. Le pire jour en consomme {volume.pireJour}.
          </p>
        )}
      </Carte>
      <Carte id="canaux" titre="Canaux et notifications">
        <style>{`${CSS_CANAL_COUPE} { opacity: 0.45; pointer-events: none; }`}</style>
        {/* Six canaux : trois par ligne se répartissent proprement, là où quatre colonnes
            laissaient une ligne de deux orpheline. */}
        <ul className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {CANAUX.map((canal) => {
            const etat = etats[canal];
            return (
              <li key={canal} className="flex flex-col gap-1 rounded-xl border border-bordure/60 bg-surface-douce/50 p-3">
                <p className="flex flex-wrap items-center gap-2 font-semibold">
                  {LIBELLES_CANAUX[canal]}
                  <Pastille ton={etat.operationnel ? "vert" : "ocre"}>{etat.operationnel ? "prêt" : "non configuré"}</Pastille>
                </p>
                <p className="text-sm text-texte-secondaire">{etat.resume}</p>
                <Link href={lienCanal(canal)} className="mt-1 inline-flex min-h-11 items-center gap-1 font-semibold text-lien">
                  Configurer {LIBELLES_CANAUX[canal]}
                  <Icone nom="fleche" taille={18} />
                </Link>
              </li>
            );
          })}
        </ul>
        <FormulaireAction action={enregistrerNotifications} bouton="Enregistrer les notifications" className="reglages-notifications">
          <fieldset className="flex flex-col gap-1">
            <legend className="font-semibold">Canaux d&apos;envoi et de publication</legend>
            <div className="flex flex-wrap gap-x-6">
              {CANAUX.map((canal) => (
                <Fragment key={canal}>
                  {/* **Le témoin qui dit que cet écran a rendu le canal réglable**. C'est lui, et
                      non l'état du canal à l'instant de l'enregistrement, qui décide du gel côté
                      serveur : entre le rendu de ce formulaire et son envoi, quelqu'un a pu
                      brancher un canal — et les cases absentes, qui n'exprimaient rien, étaient
                      alors prises pour des décisions et **effacées en silence**. Un onglet laissé
                      ouvert suffisait. */}
                  {etats[canal].operationnel && <input type="hidden" name={champCanalRendu(canal)} value="1" />}
                  <Case
                    id={`canal-${canal}`}
                    name={champCanal(canal)}
                    label={etats[canal].operationnel ? LIBELLES_CANAUX[canal] : `${LIBELLES_CANAUX[canal]} (non configuré)`}
                    /* **La case dit ce que la base porte, même quand le canal est débranché** (même
                       relecture). Elle disait `false` dès que le canal n'était pas opérationnel : le
                       bureau lisait donc une case décochée là où la base en avait une vraie, et
                       brancher le canal faisait repartir des envois — ou publier sur Internet — que
                       personne ne croyait armés. La case est `disabled`, donc rien ne peut la
                       changer ; la montrer juste ne coûte rien et ne mentir plus. */
                    defaultChecked={prefs.canaux[canal]}
                    disabled={!etats[canal].operationnel}
                    title={etats[canal].operationnel ? undefined : raisonCanalIndisponible(etats[canal])}
                  />
                </Fragment>
              ))}
            </div>
            <p className="text-sm text-texte-secondaire">
              Un canal décoché coupe toutes ses notifications d&apos;un coup ; les cases ci-dessous sont conservées et grisées. Un canal non configuré ne
              peut ni être coché ni être vidé ici : ses cases sont conservées telles quelles et reprennent effet dès qu&apos;il est réglé.
              «&nbsp;{LIBELLES_CANAUX.api}&nbsp;» n&apos;envoie rien : c&apos;est le site qui vient lire ce que vous cochez, et il ne lit rien tant que la
              publication n&apos;est pas ouverte (carte plus bas). Dans le tableau, une case grisée se réglera quand son canal sera branché ; une
              cellule vide veut dire que cette notification ne part jamais par ce canal.
            </p>
          </fieldset>
          <MatriceNotifications prefs={prefs} etats={etats} volume={volume} />
          <p className="text-sm text-texte-secondaire">
            L&apos;adresse de liste se règle sur la{" "}
            <Link href={lienCanal("email")} className="font-semibold text-lien">
              page du canal Email
            </Link>
            {prefs.adresseListe ? ` (actuellement ${prefs.adresseListe})` : " (aucune pour l'instant)"}. Une notification réglée sur « {LIBELLES_MODE.liste} »
            sans adresse est refusée à l&apos;enregistrement.
          </p>
        </FormulaireAction>
        <div className="mt-5 rounded-xl border border-bordure/60 bg-surface-douce/50 p-3">
          <p className="flex flex-wrap items-center gap-2 font-semibold">
            Messages personnels et sécurité <Pastille ton="primaire">toujours envoyées</Pastille>
          </p>
          <ul className="mt-2 flex flex-col gap-2 text-sm">
            {NOTIFICATIONS_TOUJOURS_ENVOYEES.map((n) => (
              <li key={n.titre}>
                <span className="font-semibold">{n.titre}</span> — {n.quand}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-sm text-texte-secondaire">
            Ces envois ne se coupent pas ici : sans eux, plus personne ne pourrait entrer dans l&apos;application ni être prévenu qu&apos;un accès a été volé.
          </p>
        </div>
      </Carte>

      {/* **Deux cartes, deux boutons**. Elles n'en faisaient qu'une, « Partage et alertes », sous
          un seul « Enregistrer » : publier le calendrier du club sur Internet et prévenir le bureau
          qu'un accès a été volé se décidaient d'un même geste, sous un titre qui ne disait ni l'un
          ni l'autre. On pouvait ouvrir la porte en croyant régler ses alertes. Elles restent sur
          cet écran — la question qu'on se pose y est la même, « qu'est-ce qui part de chez nous, et
          vers qui ? » — mais chacune se décide pour elle-même. */}
      <Carte id="publication" titre="Publication des cours sur le site du club">
        <FormulaireAction action={enregistrerPublicationCours} bouton="Enregistrer" variante="secondaire">
          <p className="text-sm">
            Le site du club peut afficher <strong>les prochains cours</strong> : date, horaire, lieu, thème et programme, avec le taux de participation.
            C&apos;est à ça, et à rien d&apos;autre, que sert cette case.
          </p>
          {/* **La case ouvre la porte, la matrice décide de ce qui la franchit.** Sans cette phrase,
              on coche ici et on cherche là-bas — les deux réglages sont sur le même écran, mais à
              deux cartes de distance, et rien ne disait qu'ils allaient ensemble. */}
          <p className="text-sm">
            Elle ouvre aussi la porte des <strong>annonces</strong> — le cours de demain, les cours annulés, les événements publiés —, mais elle ne décide
            pas lesquelles : <strong>c&apos;est la matrice ci-dessus qui en décide, annonce par annonce</strong>, dans la colonne «&nbsp;
            {LIBELLES_CANAUX.api}&nbsp;».
          </p>
          {/*
            * **« Cochée seule, cette case ne republie aucune annonce » était faux, et c'est ce qui
            * publiait**. Les cases de la colonne « Site du club » **survivent** à la fermeture de
            * la publication — c'est voulu, elles sont figées et non éteintes —, si bien que la
            * rouvrir fait repartir d'un coup tout ce qui était armé. Et le bureau n'en savait
            * rien : la case était rendue décochée tant que le canal n'était pas opérationnel
            * (corrigé juste au-dessus), et aucun écran ne disait ce qui reprendrait. Désormais, la
            * carte compte et **nomme** ce qui attend derrière la porte.
            */}
          {!apiActive && annoncesArmees.length > 0 ? (
            <div className="-mt-1">
              <Alerte
                type="attention"
                titre={`${annoncesArmees.length} annonce${annoncesArmees.length > 1 ? "s" : ""} ${annoncesArmees.length > 1 ? "reprendront" : "reprendra"} effet dès que tu cocheras cette case`}
              >
                {annoncesArmees.map((t) => DESCRIPTIONS[t].titre).join(", ")}. {annoncesArmees.length > 1 ? "Elles sont déjà cochées" : "Elle est déjà cochée"} dans la
                colonne «&nbsp;{LIBELLES_CANAUX.api}&nbsp;» de la matrice, où {annoncesArmees.length > 1 ? "elles ont été conservées" : "elle a été conservée"} à la
                dernière fermeture. Pour ne rien republier, décoche-{annoncesArmees.length > 1 ? "les" : "la"} là-haut avant d&apos;ouvrir la porte.
              </Alerte>
            </div>
          ) : (
            <p className="text-sm">Cochée seule, cette case ne republie aucune annonce : aucune n&apos;est cochée dans la colonne «&nbsp;{LIBELLES_CANAUX.api}&nbsp;».</p>
          )}
          <Case
            label="Publier les prochains cours"
            name="publicApiEnabled"
            defaultChecked={apiActive}
          />
          <p className="-mt-2 text-sm text-texte-secondaire">
            <strong>Rien n&apos;est publié tant que cette case n&apos;est pas cochée</strong>, et aucune notification ne l&apos;ouvre à votre place. Une fois
            cochée, ce qui sort est lisible par n&apos;importe qui, depuis n&apos;importe où : <strong>aucun nom</strong> — ni membre, ni instructeur — mais
            les dates, les horaires, le <strong>lieu et l&apos;adresse de la salle</strong>, les thèmes et les descriptions écrites dans le planning, les
            motifs d&apos;annulation et les taux de participation. À ne cocher que si le site du club affiche vraiment les cours. L&apos;adresse à reporter
            dans le plugin WordPress est dans{" "}
            <Link href="/admin/apropos" className="font-semibold text-lien">
              À propos
            </Link>
            .
          </p>
        </FormulaireAction>
      </Carte>

      <Carte id="alertes" titre="Alertes de sécurité">
        <FormulaireAction action={enregistrerAlertesSecurite} bouton="Enregistrer" variante="secondaire">
          <Case
            label="Prévenir les administrateurs, par email et sur le téléphone"
            name="alertesSecurite"
            defaultChecked={alertesSecurite}
          />
          <p className="-mt-2 text-sm text-texte-secondaire">
            Lien personnel ouvert un nombre anormal de fois, lien saturé d&apos;appareils, vague de jetons inconnus. Les couper, c&apos;est accepter de ne pas
            être prévenu d&apos;un accès volé.
          </p>
        </FormulaireAction>
      </Carte>
    </PageAvecSommaire>
  );
}
