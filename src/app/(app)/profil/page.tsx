import type { Metadata } from "next";
import { Fragment, Suspense } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import { requireUser } from "@/lib/auth/current-user";
import { ROLE_LABELS, MOT_DE_PASSE_MIN, type Role } from "@/lib/constants";
import { activerMaDeuxFa, preparerMaDeuxFa, quitterEspaceAdmin } from "@/actions/auth";
import { Alerte } from "@/components/ui/Alerte";
import { Icone } from "@/components/ui/Icone";
import { Bouton, LienBouton } from "@/components/ui/Bouton";
import { Carte } from "@/components/ui/Carte";
import { accesAdmin } from "@/components/layout/Entete";
import { CHEMIN_ACTIVATION_ADMIN, lireReglage2fa } from "@/lib/auth/acces-admin";
import { formaterSecret, urlOtpauth } from "@/lib/auth/totp";
import { identite } from "@/lib/identite";
import { FormulaireCode } from "@/components/auth/FormulaireCode";
import { can } from "@/lib/permissions";
import { FormulaireMotDePasse } from "@/components/auth/FormulaireMotDePasse";
import { RenvoyerLien } from "./RenvoyerLien";
import { CarteNotifications } from "./CarteNotifications";
import { ActiverPush } from "./ActiverPush";
import { TesterNotifications } from "./TesterNotifications";
import { TYPES_ESSENTIELS, lignesNotificationsMembre } from "@/lib/notifications/membre";
import { FormulaireDeuxFa } from "./FormulaireDeuxFa";
import { BoutonDeconnexion } from "./BoutonDeconnexion";
import { SelecteurTheme } from "./SelecteurTheme";
import { EncartMiseAJour } from "./EncartMiseAJour";
import { choixOuDefaut } from "@/lib/themes";
import { formatDateHeure } from "@/lib/dates";
import { NB_CODES_SECOURS, nombreCodesRestants } from "@/lib/auth/codes-secours";
import { etatLienPersonnel } from "@/lib/invitations";
import { db } from "@/lib/db";
import { clePubliqueVapid } from "@/lib/notifications/push";
import { Pastille } from "@/components/ui/Pastille";
import { PageAvecSommaire, type SectionSommaire } from "@/components/ui/SommaireCollant";
import { PLEINE_LARGEUR_2XL } from "@/components/ui/pleine-largeur";
import { DeuxPiles } from "@/components/ui/DeuxPiles";
import { CarteEtatCompte } from "./CarteEtatCompte";
import { etatCodesSecours, etatDeuxFa, etatMotDePasse, PASTILLE_LIEN, precisionLien } from "./etat-compte";

export const metadata: Metadata = { title: "Mon profil" };

/** Mon profil : identité, notifications, lien d'accès, mot de passe et 2FA facultatifs, déconnexion. */
type Props = { searchParams: Promise<{ codes?: string; erreur?: string; admin?: string }> };

const ERREURS_SECURITE: Record<string, string> = {
  expire: "Le réglage a expiré (30 minutes) : redemande un QR code et recommence.",
  tentatives: "Trop de tentatives. Réessaie dans quelques minutes.",
  /*
   * **L'écran des codes de secours ne se refermait pas en silence**. Les codes ne s'affichent
   * qu'une fois, le temps du réglage ; passé ce délai, la page renvoyait ici **sans un mot**. La
   * personne se retrouvait sur son profil, où tout est annoncé « en place » — et ses codes sont
   * hachés en base, donc définitivement illisibles. Le geste qui répare existe (« Régénérer mes
   * codes de secours »), il n'était nommé nulle part : un cul-de-sac silencieux. C'est la même
   * leçon que la carte de fin du parcours `/admin/activer`, corrigée le même soir.
   */
  "codes-expires": "Tes codes de secours ne sont plus affichables (ils ne le sont qu'une fois, pendant 30 minutes). Ils existent, mais personne ne peut plus les relire : appuie sur « Régénérer mes codes de secours » pour en obtenir de nouveaux.",
};

export default async function PageProfil({ searchParams }: Props) {
  const user = await requireUser();
  const { codes, erreur, admin: sortieAdmin } = await searchParams;
  const acces = await accesAdmin(user);
  const [lien, compte] = await Promise.all([
    etatLienPersonnel(user.id),
    db.user.findUniqueOrThrow({ where: { id: user.id }, select: { passwordHash: true, totpSecret: true, totpActiveAt: true } }),
  ]);
  const deuxFa = !!compte.totpSecret && !!compte.totpActiveAt;
  const aDejaUnMotDePasse = !!compte.passwordHash;
  const codesRestants = deuxFa ? await nombreCodesRestants(user.id) : 0;
  const { lignes, obligatoires } = await lignesNotificationsMembre(user);
  // Les appareils abonnés au push, et la clé publique qui permet d'en abonner un de plus. La clé
  // privée, elle, ne quitte jamais le serveur : le navigateur n'a besoin que de la publique, et
  // elle ne sert qu'à s'abonner. (Aucune variable `NEXT_PUBLIC_*` dans ce projet : la valeur
  // descend en propriété d'un composant serveur.)
  const [clePush, appareils] = await Promise.all([
    clePubliqueVapid(),
    db.pushAbonnement.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" }, select: { id: true, appareil: true, endpoint: true, createdAt: true } }),
  ]);
  const admin = can(user, "settings.technical");
  // Administrateur nommé : tant que son accès n'est pas réglé, tout passe par /admin/activer
  // (le parcours y est obligatoire et guidé — on n'ouvre pas un second chemin en parallèle).
  const activationAFaire = acces.nominatif && !acces.regle;
  // Réglage 2FA en cours, lancé depuis cette carte : le QR code n'existe que le temps de le scanner.
  const secretEnCours = !deuxFa && aDejaUnMotDePasse && !activationAFaire && user.email ? await lireReglage2fa(user.id) : null;
  const qr = secretEnCours ? await QRCode.toDataURL(urlOtpauth(secretEnCours, user.email, (await identite()).nomCourt), { margin: 1, width: 220, color: { dark: "#282828", light: "#fffdfa" } }) : null;


  /**
   * **Le sommaire de la page** : les titres de ses sections, mot pour mot, dans l'ordre où elles se
   * lisent. Les deux conditionnelles sont celles des sections elles-mêmes — annoncer « Accès
   * administrateur » à qui n'en a pas, ou « Mon lien d'accès » au compte du portail qui n'en a aucun,
   * serait un lien vers une ancre qui n'existe pas (voir `SommaireCollant`).
   *
   * **La liste n'a pas changé avec les deux piles**, et ce n'est pas un oubli : le découpage est
   * une **coupure** de cette liste, pas un tri (voir `DeuxPiles`). Lire la pile de gauche de haut
   * en bas puis celle de droite redonne donc exactement cet ordre — le même qu'une seule pile sur
   * un téléphone. Si un jour une carte change de pile, cette liste se réordonne avec elle : un
   * sommaire qui annonce un autre ordre que l'écran fait chercher deux fois.
   */
  const sections: SectionSommaire[] = [
    ...(admin ? [{ ancre: "acces-admin", titre: "Accès administrateur" }] : []),
    { ancre: "informations", titre: "Mes informations" },
    { ancre: "appareil", titre: "Notifications sur cet appareil" },
    { ancre: "mes-notifications", titre: "Mes notifications" },
    { ancre: "apparence", titre: "Apparence" },
    ...(lien.etat !== "compte-de-service" ? [{ ancre: "lien", titre: "Mon lien d'accès" }] : []),
    { ancre: "securite", titre: "Sécuriser mon compte" },
  ];

  return (
    /*
     * **Deux piles de réglages et une colonne d'état, à partir de 1 536 px**.
     *
     * Ce que la largeur sert à faire ici a changé deux fois en un jour, et les trois décisions se
     * lisent dans cette racine :
     *
     * 1. le matin, « Mon profil » restait dans la colonne de lecture avec un **sommaire posé dans la
     *    marge** : rien ne bougeait d'un pixel, et la page faisait toujours 3 377 px de haut ;
     * 2. l'après-midi, elle **se partage** — les trois cartes de notifications à gauche, ce qu'on est
     *    et comment on entre à droite (voir `DeuxPiles`) — et le sommaire n'a plus de marge où se
     *    poser : il devient une **colonne** (`placement="colonne"`), ce que `PageAvecSommaire` sait
     *    faire depuis ce matin pour les écrans d'administration déjà larges ;
     * 3. et comme cette colonne existe, elle porte autre chose qu'une navigation : **l'état du
     *    compte** (`enTete`), le seul endroit de la page où le lien, les deux filets de sécurité et
     *    les appareils branchés se lisent d'un coup d'œil.
     *
     * **La largeur est posée ici, sur la page, et nulle part ailleurs** (`PLEINE_LARGEUR_2XL`) : un
     * élargissement posé sur un morceau de page laisse le titre et les alertes dans la colonne
     * étroite au-dessus d'un contenu large — deux alignements sur le même écran, défaut vécu le 30/09
     * sur `/seances` puis le 01/10 sur l'accueil. Le palier (1 536 px) et le plafond (90 rem) sont
     * ceux du dépôt, et ils n'ont qu'une écriture.
     *
     * **En dessous du palier, l'écran est celui d'hier** : une seule pile, dans le même ordre, sans
     * sommaire ni carte d'état — sept liens et un récapitulatif avant le premier réglage, sur un
     * téléphone, c'est un écran de sommaire pour une page qu'on parcourt au pouce.
     */
    <div className={PLEINE_LARGEUR_2XL}>
      <PageAvecSommaire
        sections={sections}
       
        enTete={
          <CarteEtatCompte
            lien={lien}
            aDejaUnMotDePasse={aDejaUnMotDePasse}
            deuxFa={deuxFa}
            admin={admin}
            totpActiveAt={compte.totpActiveAt}
            codesRestants={codesRestants}
            codesTotal={NB_CODES_SECOURS}
            appareils={appareils.length}
          />
        }
      >
        <h1 className="text-3xl">Mon profil</h1>
        {sortieAdmin === "quitte" && (
          <Alerte type="succes">
            Tu n&apos;es plus connecté(e) en tant qu&apos;administrateur. Ton compte, lui, reste ouvert : rien d&apos;autre n&apos;a changé.
          </Alerte>
        )}
        {codes === "epuises" && (
          <Alerte type="attention" titre="Dernier code de secours utilisé">
            Tu n&apos;as plus aucun code de secours : régénère-les ci-dessous (section « Sécuriser mon compte »).
          </Alerte>
        )}
        {/* **En tête de page** : depuis que l'administration ne s'ouvre plus que d'ici, cette
            section est une porte, pas un réglage. La chercher sous les notifications, le thème et
            la sécurité, c'est faire défiler tout son profil pour entrer chez soi. Tous les
            administrateurs techniques, pas seulement les nominatifs : la réserver aux comptes
            nommés enfermerait dehors le compte du portail — celui-là même qui détient le mot de
            passe et la double authentification. */}
        {/* Une image plus récente attend le redéploiement : dit aux administrateurs seulement, et
            juste au-dessus de leur porte d'entrée, là où ils passent avant toute opération. */}
        {admin && (
          <Suspense fallback={null}>
            <EncartMiseAJour />
          </Suspense>
        )}
        {admin && (
          <Carte id="acces-admin" titre="Accès administrateur">
            {/* Trois états, trois phrases : il reste à régler / on peut s'élever / on y est déjà.
                Le mot « se connecter » est employé à dessein pour le second : ce n'est pas un onglet
                qu'on ouvre, c'est une identité qu'on prend le temps de prouver à nouveau. */}
            <p className="mb-4 text-texte-secondaire">
              {activationAFaire
                ? "Il te reste une étape : choisis un mot de passe et active la double authentification pour ouvrir l'administration."
                : user.sessionForte
                  ? "Tu es connecté(e) en tant qu'administrateur sur cet appareil. Cet accès se referme dès que tu quittes l'application, et après 10 minutes sans rien y faire — tu es alors ramené(e) à l'accueil, sans rien perdre du reste. Le bouton ci-dessous le referme tout de suite."
                  : "L'administration technique ne s'ouvre qu'en redonnant ton mot de passe et ton code à usage unique. Ton compte, lui, reste connecté comme d'habitude."}
            </p>
            {activationAFaire ? (
              <LienBouton href={CHEMIN_ACTIVATION_ADMIN} taille="petite">
                <Icone nom="bouclier" taille={18} />
                Activer mon accès admin
              </LienBouton>
            ) : user.sessionForte ? (
              <div className="flex flex-wrap items-center gap-3">
                <LienBouton href="/admin" variante="secondaire" taille="petite">
                  <Icone nom="bouclier" taille={18} />
                  Ouvrir l&apos;espace admin
                </LienBouton>
                <form action={quitterEspaceAdmin}>
                  <Bouton type="submit" variante="danger" taille="petite">
                    <Icone nom="sortie" taille={18} />
                    Quitter l&apos;espace admin
                  </Bouton>
                </form>
              </div>
            ) : (
              <LienBouton href="/admin" taille="petite">
                <Icone nom="bouclier" taille={18} />
                Se connecter en tant qu&apos;administrateur
              </LienBouton>
            )}
          </Carte>
        )}
        {/* **Deux piles, et la coupure qui les sépare**.

            Delta proposait « ce qui arrive » à gauche (les trois cartes de notifications) et « ce
            qu'on est » à droite, avec « Mes informations » en tête de la colonne de droite. **« Mes
            informations » est restée à gauche**, et c'est le seul écart : la contrainte dure est
            que l'écran d'un téléphone soit **identique à celui d'hier**, or deux piles se lisent
            dans l'ordre du DOM quand elles s'empilent — le découpage ne peut donc être qu'une
            **coupure** de la liste d'hier, jamais un tri. Mettre « Mes informations » à droite
            l'aurait fait descendre en quatrième position sur un téléphone (ou aurait demandé un
            `order` CSS, qui donne au lecteur d'écran un autre ordre que celui de l'œil — ce que
            `DeuxColonnes` s'interdit déjà). La coupure qui respecte le plus de son intention est
            donc celle-ci : ses trois cartes de notifications ensemble à gauche, ses quatre blocs de
            réglages et d'accès ensemble à droite.

            Ce que les deux piles disent, du coup : à gauche **moi et ce qui m'arrive** (qui je
            suis, les appareils qui sonnent, les messages que je reçois, l'essai pour vérifier) ; à
            droite **ce que je règle et comment j'entre** (l'apparence, le lien, les deux filets de
            sécurité, et la sortie). Les deux piles sont de **même rang** : aucune des deux
            n'accompagne l'autre.

            « Accès administrateur » reste **au-dessus**, sur toute la largeur : c'est une
            **porte**, pas un réglage, et la chercher dans une colonne serait la cacher. */}
        <DeuxPiles
          gauche={
            <>
              {/* **Une carte sans titre parmi des cartes titrées se lit comme un bout d'écran oublié**, et le
                  sommaire ne pouvait pas l'annoncer : « Mes informations » nomme donc ce qu'elle montre. */}
              <Carte id="informations" titre="Mes informations">
                <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
                  <dt className="text-texte-secondaire">Nom</dt>
                  <dd className="font-semibold">
                    {user.prenom} {user.nom}
                  </dd>
                  <dt className="text-texte-secondaire">Email</dt>
                  <dd className="break-words">{user.email ?? "sans adresse email"}</dd>
                  <dt className="text-texte-secondaire">Rôle</dt>
                  <dd>{ROLE_LABELS[user.role as Role] ?? user.role}</dd>
                </dl>
              </Carte>
              {/* Brancher l'appareil d'abord, choisir les messages ensuite : c'est l'ordre dans lequel on
                  s'y prend, et la carte suivante le dit quand aucun appareil n'est encore abonné. */}
              <ActiverPush
                clePublique={clePush}
                appareils={appareils.map((a) => ({ id: a.id, appareil: a.appareil, endpoint: a.endpoint, depuis: formatDateHeure(a.createdAt) }))}
              />
              <CarteNotifications lignes={lignes} obligatoires={obligatoires} typesEssentiels={TYPES_ESSENTIELS} pushBranche={appareils.length > 0} />
              {/* Vérifier qu'on reçoit, sans attendre le prochain cours : un bouton par canal, chacun
                  part seul. Le bloc est ici, au pied des réglages, parce que c'est le geste qui suit
                  naturellement « j'ai coché des cases, est-ce que ça arrive vraiment ? ». */}
              <TesterNotifications aUnEmail={Boolean(user.email)} pushBranche={appareils.length > 0} />
            </>
          }
          droite={
            <>
              {/* Réglage personnel, au même titre que les notifications : il ne touche que ce compte. */}
              <Carte id="apparence" titre="Apparence">
                <SelecteurTheme valeur={choixOuDefaut(user.theme, (await identite()).theme)} />
              </Carte>
              {lien.etat !== "compte-de-service" && <CarteLien lien={lien} />}
              <CarteSecurite
                admin={admin}
                activationAFaire={activationAFaire}
                aUnEmail={!!user.email}
                aUnLienPersonnel={lien.etat !== "compte-de-service"}
                aDejaUnMotDePasse={aDejaUnMotDePasse}
                deuxFa={deuxFa}
                totpActiveAt={compte.totpActiveAt}
                codesRestants={codesRestants}
                qr={qr}
                secretEnCours={secretEnCours}
                erreur={erreur && ERREURS_SECURITE[erreur] ? ERREURS_SECURITE[erreur] : null}
              />
              <BoutonDeconnexion />
            </>
          }
        />
      </PageAvecSommaire>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------ */
/* « Mon lien d'accès » : un état, un bouton, une phrase                                              */
/* ------------------------------------------------------------------------------------------------ */

/**
 * Court et factuel, à : l'état du lien en une ligne, et le bouton pour en recevoir un nouveau. Le
 * texte du bouton et sa confirmation disent la vérité technique : le lien n'est pas *renvoyé* (la
 * base n'en garde que l'empreinte), il est **remplacé** — l'ancien meurt.
 */
function CarteLien({ lien }: { lien: Awaited<ReturnType<typeof etatLienPersonnel>> }) {
  /* Le mot de chaque état et sa précision sont **partagés** avec la carte « État de mon compte »
      (`etat-compte.ts`) : sur un écran large, les deux sont visibles **en même temps**, et « lien
      actif » ici en face d'un autre mot là se lirait comme deux informations contradictoires sur un
      même fait. */
  const { ton, texte } = PASTILLE_LIEN[lien.etat];
  const precision = precisionLien(lien);
  const renvoyable = lien.etat === "actif" || lien.etat === "expire" || lien.etat === "revoque" || lien.etat === "aucun";
  return (
    <Carte id="lien" titre="Mon lien d&apos;accès">
      <p className="mb-3 flex flex-wrap items-center gap-2">
        <Pastille ton={ton}>{texte}</Pastille>
        {precision && <span className="text-texte-secondaire">{precision}</span>}
      </p>
      <p className="mb-4 text-texte-secondaire">Reçu par email, il t&apos;ouvre l&apos;application sans mot de passe : ouvre-le sur chaque appareil où tu veux l&apos;utiliser.</p>
      {lien.etat === "sans-email" ? (
        <p className="text-texte-secondaire">Ton compte n&apos;a pas d&apos;adresse email : c&apos;est un administrateur qui peut t&apos;en ajouter une, puis t&apos;envoyer ton lien.</p>
      ) : !renvoyable ? (
        <p className="text-texte-secondaire">Un lien n&apos;existe que pour une période en cours : demande à un administrateur de t&apos;inviter.</p>
      ) : (
        <RenvoyerLien />
      )}
    </Carte>
  );
}

/* ------------------------------------------------------------------------------------------------ */
/* « Sécuriser mon compte » : mot de passe et double authentification, facultatifs                     */
/* ------------------------------------------------------------------------------------------------ */

type PropsSecurite = {
  admin: boolean;
  activationAFaire: boolean;
  aUnEmail: boolean;
  /** Le compte du portail n'a pas de lien personnel : lui proposer cette porte de repli serait faux. */
  aUnLienPersonnel: boolean;
  aDejaUnMotDePasse: boolean;
  deuxFa: boolean;
  totpActiveAt: Date | null;
  codesRestants: number;
  qr: string | null;
  secretEnCours: string | null;
  erreur: string | null;
};

/**
 * Carte ouverte à tout le monde : se donner un mot de passe, puis — si on veut — une double
 * authentification. Le ton dit ce qui est vrai : **c'est facultatif**, le lien personnel suffit ;
 * un mot de passe sert à entrer depuis un appareil où l'on n'a pas son lien.
 *
 * Les formulaires sont **ceux des administrateurs** (`FormulaireMotDePasse`, `FormulaireCode`,
 * `FormulaireDeuxFa`) : un seul parcours, pas deux. Ce qui change d'un rôle à l'autre tient en une
 * phrase — pour un ADMIN la double authentification est obligatoire (sans elle, pas de session forte,
 * donc pas d'administration technique) ; pour les autres elle est un supplément qu'ils choisissent.
 */
function CarteSecurite(p: PropsSecurite) {
  return (
    /* L'ancre est écrite ici, en clair : c'est elle que le sommaire de la page vise, et une ancre
       passée en propriété ne se retrouve plus — ni à la lecture, ni par le test qui les apparie. */
    <section id="securite" className="scroll-mt-20 rounded-2xl border border-bordure/60 bg-surface p-5 shadow-carte">
      <h2 className="mb-3 text-xl font-bold">Sécuriser mon compte</h2>
      <p className="mb-4 text-texte-secondaire">
        {/* **La troisième phrase existe parce que la première était fausse pour qui n'a pas
            d'adresse** : « ton lien personnel suffit pour entrer » s'affichait à côté de « Aucun
            lien : pas d'adresse email », et le corps de la carte disait juste après le contraire.
            Le vis-à-vis de la carte d'état l'a rendu visible d'un coup d'œil ; la contradiction,
            elle, était là. */}
        {p.admin
          ? "Ton mot de passe et ta double authentification ouvrent l'administration technique : les deux sont obligatoires pour ce rôle."
          : p.aUnEmail
            ? "C'est facultatif : ton lien personnel suffit pour entrer. Un mot de passe te permet en plus de te connecter depuis un appareil où tu n'as pas ton lien — un ordinateur prêté, un téléphone neuf."
            : "Rien ne peut être réglé ici tant que ton compte n'a pas d'adresse email : c'est par elle qu'on se connecte, et c'est aussi par elle que part ton lien personnel."}
      </p>
      {/* **Les trois mêmes lignes que la carte « État de mon compte »**, et les mêmes mots : elles
          sortent des mêmes fonctions (`etat-compte.ts`). Deux écritures d'un même fait, visibles
          côte à côte sur un écran large, finissent par diverger — c'est la leçon de
          `PLEINE_LARGEUR`, appliquée à des libellés. Ce qui reste propre à cette carte, c'est la
          **disposition** : ici l'intitulé est à côté de sa valeur (la colonne est large), là il est
          au-dessus (20 rem ne suffisent pas à un vis-à-vis). */}
      <dl className="mb-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
        {[
          etatMotDePasse(p.aDejaUnMotDePasse),
          etatDeuxFa({ deuxFa: p.deuxFa, admin: p.admin, totpActiveAt: p.totpActiveAt }),
          ...(p.deuxFa ? [etatCodesSecours(p.codesRestants, NB_CODES_SECOURS)] : []),
        ].map((ligne) => (
          <Fragment key={ligne.intitule}>
            <dt className="text-texte-secondaire">{ligne.intitule}</dt>
            <dd className="flex flex-wrap items-center gap-2">
              <Pastille ton={ligne.ton}>{ligne.valeur}</Pastille>
              {ligne.precision && <span className="text-texte-secondaire">{ligne.precision}</span>}
            </dd>
          </Fragment>
        ))}
      </dl>

      {p.erreur && (
        <div className="mb-4">
          <Alerte type="attention">{p.erreur}</Alerte>
        </div>
      )}

      {!p.aUnEmail ? (
        <p className="text-texte-secondaire">
          Ton compte n&apos;a pas d&apos;adresse email. Or c&apos;est <em>par</em> elle qu&apos;on se connecte : sans adresse, un mot de passe ne mènerait nulle part. Demande à un
          administrateur de l&apos;ajouter.
        </p>
      ) : p.activationAFaire ? (
        <div className="flex flex-col items-start gap-3">
          <p className="text-texte-secondaire">Ton compte est administrateur : mot de passe et double authentification se règlent d&apos;un seul tenant, sur une page dédiée.</p>
          <LienBouton href={CHEMIN_ACTIVATION_ADMIN} taille="petite">
            <Icone nom="bouclier" taille={18} />
            Régler mon accès
          </LienBouton>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <details className="group rounded-xl border border-bordure/60 bg-surface-douce p-4">
            <summary className="flex min-h-11 cursor-pointer items-center gap-3 font-semibold">
              {p.aDejaUnMotDePasse ? "Changer mon mot de passe" : "Définir un mot de passe"}
              <Icone nom="chevronBas" taille={22} className="ml-auto text-texte-secondaire transition group-open:rotate-180" />
            </summary>
            <p className="mb-4 mt-2 text-texte-secondaire">
              Au moins {MOT_DE_PASSE_MIN} caractères, et un que tu n&apos;utilises nulle part ailleurs. Tes autres appareils seront déconnectés.
            </p>
            <FormulaireMotDePasse aDejaUnMotDePasse={p.aDejaUnMotDePasse} />
          </details>

          {!p.aDejaUnMotDePasse ? (
            <p className="text-texte-secondaire">La double authentification vient après : elle s&apos;ajoute à un mot de passe, elle ne le remplace pas.</p>
          ) : p.deuxFa ? (
            <details className="group rounded-xl border border-bordure/60 bg-surface-douce p-4">
              <summary className="flex min-h-11 cursor-pointer items-center gap-3 font-semibold">
                Double authentification
                <Icone nom="chevronBas" taille={22} className="ml-auto text-texte-secondaire transition group-open:rotate-180" />
              </summary>
              <p className="mb-4 mt-2 text-texte-secondaire">
                Un code à 6 chiffres t&apos;est demandé à chaque connexion par mot de passe. Nouveau téléphone ? Réinitialise-la ci-dessous
                {p.admin ? " : un nouveau QR code te sera proposé à ta prochaine connexion." : ", puis réactive-la depuis cette carte."}
              </p>
              <FormulaireDeuxFa codesRestants={p.codesRestants} />
            </details>
          ) : p.qr && p.secretEnCours ? (
            <div className="rounded-xl border border-bordure/60 bg-surface-douce p-4">
              <h3 className="mb-3 font-semibold">Activer la double authentification</h3>
              <ol className="mb-5 flex list-decimal flex-col gap-4 pl-5">
                <li>
                  Installe une application gratuite si tu n&apos;en as pas : <strong>Aegis</strong>, <strong>FreeOTP</strong>, Google ou Microsoft Authenticator.
                </li>
                <li>
                  Scanne ce code avec l&apos;application :
                  <div className="mt-2 inline-block rounded-2xl bg-white p-3 shadow-carte">
                    {/* eslint-disable-next-line @next/next/no-img-element -- image générée en mémoire (data URL) */}
                    <img src={p.qr} alt="QR code à scanner avec l'application d'authentification" width={220} height={220} />
                  </div>
                  <details className="mt-2 text-sm">
                    <summary className="cursor-pointer text-texte-secondaire">Impossible de scanner ? Saisir la clé à la main</summary>
                    <code className="mt-1 block select-all break-all rounded-lg bg-surface p-2 text-base tracking-wider">{formaterSecret(p.secretEnCours)}</code>
                    <p className="mt-1 text-texte-secondaire">Type : code temporel (TOTP), 6 chiffres, 30 secondes.</p>
                  </details>
                </li>
                <li>Recopie le code à 6 chiffres qu&apos;elle affiche pour confirmer :</li>
              </ol>
              <FormulaireCode configuration motDePasse action={activerMaDeuxFa} libelle="Activer la double authentification" />
            </div>
          ) : (
            <form action={preparerMaDeuxFa} className="flex flex-col items-start gap-3 rounded-xl border border-bordure/60 bg-surface-douce p-4">
              <h3 className="font-semibold">Double authentification (facultative)</h3>
              <p className="text-texte-secondaire">
                Un code à 6 chiffres, donné par une application sur ton téléphone, en plus du mot de passe. Utile si tu tiens à ce que ton mot de passe seul ne suffise pas.
              </p>
              <Bouton type="submit" variante="secondaire" taille="petite">
                <Icone nom="bouclier" taille={18} />
                Activer la double authentification
              </Bouton>
            </form>
          )}
        </div>
      )}

      {p.aUnLienPersonnel && (
        <p className="mt-4 text-sm text-texte-secondaire">
          Ton <Link href="/profil#lien">lien personnel</Link> continue de fonctionner : rien de ce qui est réglé ici ne le remplace.
        </p>
      )}
    </section>
  );
}
