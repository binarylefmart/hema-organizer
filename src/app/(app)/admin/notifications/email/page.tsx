import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/current-user";
import { db } from "@/lib/db";
import { formatDateHeure } from "@/lib/dates";
import { env, expediteur, expediteurCorrige } from "@/lib/env";
import { etatCanal } from "@/lib/notifications/canaux";
import {
  CHAMP_ADRESSE_LISTE,
  CHAMP_QUOTA_JOUR,
  COUPLES_EMIS,
  DESCRIPTIONS,
  LIBELLES_MODE,
  TYPES_NOTIFICATION,
  getPreferencesNotifications,
} from "@/lib/notifications/preferences";
import { chiffresDuClub, estimerEnvois } from "@/lib/email/volume";
import { enregistrerListeEmail, testerEnvoiEmail } from "@/actions/admin";
import { Alerte } from "@/components/ui/Alerte";
import { Carte } from "@/components/ui/Carte";
import { Champ } from "@/components/ui/Champ";
import { FormulaireAction } from "@/components/ui/FormulaireAction";
import { Pastille } from "@/components/ui/Pastille";
import { EnTeteCanal } from "../EnTeteCanal";

export const metadata: Metadata = { title: "Canal Email" };

/**
 * Configuration du **canal Email** : tout vient des variables d'environnement de la stack (Portainer),
 * rien ne se règle depuis l'application. La page se contente donc de montrer l'état, d'offrir un envoi
 * de test, et de dire quoi renseigner si rien n'est configuré. Le mot de passe SMTP n'est jamais affiché.
 */
export default async function PageCanalEmail() {
  await requirePermission("settings.technical");
  const e = env();
  const [etat, prefs, chiffres, envois] = await Promise.all([
    etatCanal("email"),
    getPreferencesNotifications(),
    chiffresDuClub(),
    // **« Il n'a rien reçu »** : la question se tranche ici, et plus dans un écran technique à part.
    // La file d'envoi retentait trois fois puis se taisait dans la console du serveur ; ses verdicts
    // sont journalisés, et les douze derniers sont là, avec le message du serveur SMTP quand il refuse.
    db.notificationLog.findMany({
      where: { canal: "EMAIL" },
      orderBy: { date: "desc" },
      take: 12,
      select: { id: true, type: true, statut: true, erreur: true, date: true, user: { select: { prenom: true, nom: true } } },
    }),
  ]);
  const volume = estimerEnvois({ ...chiffres, prefs });
  const surEmail = TYPES_NOTIFICATION.filter((t) => COUPLES_EMIS[t].includes("email"));
  const lignes: Array<{ cle: string; valeur: string }> = [
    { cle: "Serveur", valeur: e.SMTP_HOST ? `${e.SMTP_HOST}:${e.SMTP_PORT}` : "non renseigné" },
    { cle: "Utilisateur", valeur: e.SMTP_USER || "—" },
    { cle: "Mot de passe", valeur: e.SMTP_PASS ? "renseigné (jamais affiché)" : "non renseigné" },
    { cle: "Expéditeur", valeur: expediteur() },
  ];
  return (
    <div className="flex flex-col gap-5">
      <EnTeteCanal etat={etat} titre="Canal Email" />
      <Carte titre="Serveur d'envoi (SMTP)">
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1">
          {lignes.map((l) => (
            <div key={l.cle} className="contents">
              <dt className="text-texte-secondaire">{l.cle}</dt>
              <dd className="break-words">{l.valeur}</dd>
            </div>
          ))}
        </dl>
        {/* Le serveur SMTP refuse l'enveloppe (501 5.1.7) quand l'adresse d'expéditeur est mal
            formée — le cas classique étant des guillemets recopiés depuis un fichier d'exemple dans
            une variable de stack, qui ne les retire pas. On les retire à l'usage, et on le dit :
            sinon la valeur affichée et celle qui part ne seraient pas la même chose. */}
        {expediteurCorrige() && (
          <p className="mt-3 text-sm text-ocre">
            Corrigé à la volée : la variable <code>SMTP_FROM</code> vaut <code className="break-all">{e.SMTP_FROM}</code>. Retire les guillemets dans les
            variables de la stack (un fichier <code>.env</code> les enlève, pas elles).
          </p>
        )}
        {!etat.configure && (
          <div className="mt-4">
            <Alerte type="attention" titre="Aucun serveur SMTP">
              {etat.operationnel
                ? "En développement, les emails ne partent pas : ils sont écrits dans previews/emails pour être relus. En production, il faut renseigner les variables ci-dessous, sinon plus aucun email ne peut partir."
                : "Plus aucun email ne peut partir tant que les variables ci-dessous ne sont pas renseignées dans la stack."}
            </Alerte>
          </div>
        )}
        <div className="mt-4">
          <FormulaireAction action={testerEnvoiEmail} bouton="M'envoyer un email de test" variante="secondaire" enCours="Envoi…">
            <p className="text-sm text-texte-secondaire">L&apos;email part à ton adresse, avec la mise en page des emails du club.</p>
          </FormulaireAction>
        </div>
      </Carte>
      <Carte titre="À renseigner dans Portainer">
        <p className="mb-3">
          Ces valeurs sont des variables d&apos;environnement de la stack : elles se modifient dans Portainer (édition de la stack, puis re-déploiement), pas
          dans l&apos;application.
        </p>
        <ul className="flex flex-col gap-2">
          <li>
            <code>SMTP_HOST</code> — serveur d&apos;envoi (ex. <code>smtp.gmail.com</code>)
          </li>
          <li>
            <code>SMTP_PORT</code> — 587 en général (465 pour une connexion chiffrée d&apos;emblée)
          </li>
          <li>
            <code>SMTP_USER</code> et <code>SMTP_PASS</code> — identifiants du compte d&apos;envoi (un mot de passe d&apos;application, pas le mot de passe
            principal)
          </li>
          <li>
            <code>SMTP_FROM</code> — expéditeur affiché, ex. <code>Nom de votre club &lt;no-reply@…&gt;</code>
          </li>
        </ul>
      </Carte>
      <Carte titre="Derniers emails envoyés">
        {envois.length === 0 ? (
          <p className="text-texte-secondaire">Aucun email envoyé depuis cette instance pour l&apos;instant.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-bordure/60">
            {envois.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                <Pastille ton={l.statut === "ENVOYE" ? "vert" : l.statut === "ECHEC" ? "rouge" : "neutre"}>
                  {l.statut === "ENVOYE" ? "envoyé" : l.statut === "ECHEC" ? "échec" : "ignoré"}
                </Pastille>
                <span className="font-semibold">{l.type}</span>
                <span className="text-texte-secondaire">
                  {l.user ? `${l.user.prenom} ${l.user.nom}` : "—"}&nbsp;· {formatDateHeure(l.date)}
                </span>
                {l.erreur && <span className="basis-full break-words text-rouge">{l.erreur}</span>}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-sm text-texte-secondaire">
          Un échec vient presque toujours de la configuration SMTP : le bouton « M&apos;envoyer un email de test » ci-dessus donne le même verdict, tout de
          suite. Un <code>501 5.1.7</code> désigne l&apos;<strong>adresse d&apos;expéditeur</strong> (<code>SMTP_FROM</code>), un <code>535</code> les
          identifiants (<code>SMTP_USER</code> / <code>SMTP_PASS</code>), un <code>550</code> le destinataire.
        </p>
      </Carte>
      {/* ─────────────────────── La liste de distribution, et le quota ───────────────────────
          Un envoi par personne : 80 membres × 2 cours par semaine = 160 emails hebdomadaires pour
          le seul récap. Au-dessus du quota d'un SMTP gratuit, qui coupe **au milieu de la liste** —
          et les derniers ne reçoivent rien, en silence. Une adresse de distribution tenue par le
          serveur mail du club ramène chaque envoi à un message. */}
      <Carte titre="Liste de distribution">
        <p className="mb-3">
          Une adresse unique, tenue par le serveur mail du club (Google Groups, une liste
          <span aria-hidden> </span>Sympa, un alias de votre hébergeur…). Les notifications réglées sur «{" "}
          {LIBELLES_MODE.liste} » y partent en <strong>un seul message</strong> au lieu d&apos;un par personne.
        </p>
        <FormulaireAction action={enregistrerListeEmail} bouton="Enregistrer la liste" rafraichirApresSucces={false}>
          <Champ
            label="Adresse de la liste"
            name={CHAMP_ADRESSE_LISTE}
            type="email"
            inputMode="email"
            autoComplete="off"
            defaultValue={prefs.adresseListe}
            placeholder="membres@votre-club.fr"
            aide="Une seule adresse. Laisse vide pour que tout parte à chacun, comme avant."
          />
          <Champ
            label="Quota d'envois par jour du serveur (facultatif)"
            name={CHAMP_QUOTA_JOUR}
            type="number"
            min={1}
            step={1}
            defaultValue={prefs.quotaJour ?? ""}
            placeholder="ex. 300"
            aide="Ce que votre fournisseur SMTP accepte par 24 h. Il ne limite rien ici : il sert à prévenir avant la coupure."
          />
        </FormulaireAction>
        <div className="mt-4 rounded-xl border border-bordure/60 bg-surface-douce/50 p-3">
          <p className="font-semibold">Ce que la liste change</p>
          <ul className="mt-1 flex list-disc flex-col gap-1 pl-5 text-sm">
            <li>
              Le message perd tout ce qui est personnel : prénom, « Tu es inscrit : Présent », boutons de réponse et lien de désinscription — ce dernier porte un
              jeton nominatif, il n&apos;a rien à faire sur une adresse partagée.
            </li>
            <li>Le rappel change de propos : « 12 personnes n&apos;ont pas encore répondu pour mardi », sans nommer personne.</li>
            <li>
              <strong>Les refus individuels ne s&apos;y appliquent plus</strong> : l&apos;application ne sait pas qui lit la liste. Un membre qui veut la paix
              doit être retiré de la liste par le bureau — ou garder ses notifications sur le téléphone, qui restent personnelles.
            </li>
            <li>Les messages d&apos;accès et de sécurité ne passent jamais par là : ils portent une clé, et une clé donnée à une liste est donnée à tous.</li>
          </ul>
        </div>
      </Carte>
      <Carte titre="Combien d'emails partent">
        {/* **Une équation qu'on peut refaire de tête.** L'écran écrivait « 42 membres × 2 cours par
            semaine = 252 envois » : 42 × 2 font 84, et 252 est le total régulier — récap **et** les
            deux vagues de rappel. Le produit montré est donc celui du seul récap
            (`recapParSemaine`), et le total suit sur sa propre ligne, avec ce qu'il ajoute. En mode
            « la liste », le premier facteur tombe à 1 et l'égalité reste vraie. */}
        <p className="text-lg">
          <strong>{volume.recapParSoirDeCours}</strong> envoi{volume.recapParSoirDeCours > 1 ? "s" : ""} à chaque récap ×{" "}
          <strong>{volume.coursParSemaine}</strong> cours par semaine ={" "}
          <strong>
            {volume.recapParSemaine} envoi{volume.recapParSemaine > 1 ? "s" : ""} par semaine
          </strong>{" "}
          pour le seul récap.
        </p>
        <p className="mt-1">
          Avec les deux vagues de rappel (une semaine puis deux jours avant chaque cours) :{" "}
          <strong>
            {volume.parSemaine} envoi{volume.parSemaine > 1 ? "s" : ""} par semaine
          </strong>{" "}
          au total. Le club compte <strong>{volume.membresAvecEmail}</strong> membre{volume.membresAvecEmail > 1 ? "s" : ""} avec une adresse.
        </p>
        {volume.depasseQuota && (
          <div className="my-3">
            <Alerte type="erreur" titre={`Au-dessus du quota déclaré (${volume.quotaJour} envois par jour)`}>
              Le pire jour — un récap et les deux vagues de rappel ensemble — coûte {volume.pireJour} envois. Le serveur coupera au milieu de la liste, en
              silence. Passe le récap ou les rappels sur « {LIBELLES_MODE.liste} » depuis l&apos;écran Notifications.
            </Alerte>
          </div>
        )}
        <ul className="mt-3 flex flex-col divide-y divide-bordure/60">
          {volume.lignes.map((l) => (
            <li key={l.type} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2">
              <span className="font-semibold">{l.titre}</span>
              <Pastille ton={l.mode === "liste" ? "vert" : "neutre"}>{LIBELLES_MODE[l.mode]}</Pastille>
              <span className="text-texte-secondaire">
                {l.parEnvoi} email{l.parEnvoi > 1 ? "s" : ""} à chaque envoi, {l.cadence}
                {l.parSemaine !== null ? ` — ${l.parSemaine} par semaine` : " (occasionnel)"}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-texte-secondaire">
          Le nombre de cours par semaine est mesuré sur les quatre semaines à venir, pour qu&apos;une semaine de vacances n&apos;affiche pas « 0 envoi » la
          veille de la reprise. Les notifications du téléphone ne comptent pas : elles ne passent pas par le serveur d&apos;envoi.
        </p>
      </Carte>
      <Carte titre="Ce qui part par email">
        <ul className="flex flex-col gap-2">
          {surEmail.map((type) => (
            <li key={type}>
              <span className="font-semibold">{DESCRIPTIONS[type].titre}</span> — {DESCRIPTIONS[type].quand}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-texte-secondaire">
          S&apos;y ajoutent les messages personnels qui ne se coupent pas : lien d&apos;accès, nouvel appareil, mot de passe oublié, alertes de sécurité aux
          administrateurs. Chaque membre garde par ailleurs sa case « Recevoir le rappel par email la veille » dans son profil.
        </p>
      </Carte>
    </div>
  );
}
