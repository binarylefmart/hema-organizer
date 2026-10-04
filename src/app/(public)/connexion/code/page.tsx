import type { Metadata } from "next";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { db } from "@/lib/db";
import { etatSecretTotp, lireAttente2fa } from "@/lib/auth/deux-fa";
import { deuxFaActive } from "@/lib/auth/acces-admin";
import { formaterSecret, urlOtpauth } from "@/lib/auth/totp";
import { identite } from "@/lib/identite";
import { annulerConnexion2fa, passerDeuxFa } from "@/actions/auth";
import { PageAuth } from "@/components/layout/PageAuth";
import { FormulaireCode } from "@/components/auth/FormulaireCode";

export const metadata: Metadata = { title: "Code de vérification" };

/**
 * Second temps de la connexion par mot de passe. Trois situations, une seule page :
 *
 * 1. **code demandé** — la double authentification est active : on saisit les 6 chiffres (ou un code
 *    de secours) ;
 * 2. **configuration imposée** — compte ADMIN sans 2FA : QR code, et pas de porte de sortie.
 *    L'administration technique ne s'ouvre pas sans second facteur, c'est la règle qui ne bouge pas ;
 * 3. **configuration proposée** — membre ou instructeur qui s'est donné un mot de passe : même QR
 *    code, mais un bouton **« Plus tard »** ouvre la session sans rien configurer. Proposé une fois
 *    par trimestre au plus (`peutProposerDeuxFa`), et réglable à tout moment depuis « Mon profil ».
 */
export default async function PageCode() {
  const attente = await lireAttente2fa();
  if (!attente) redirect("/connexion?erreur=session");
  const user = await db.user.findUnique({ where: { id: attente.uid }, select: { email: true, prenom: true, actif: true, role: true, totpSecret: true, totpActiveAt: true } });
  if (!user || !user.actif) redirect("/connexion?erreur=session");

  const etatSecret = await etatSecretTotp(attente.uid);
  /*
   * **Un secret illisible n'ouvre pas l'écran de configuration**. C'est ici que le défaut se
   * voyait : `secretTotpActif` rendant `null`, cet écran affichait un QR code sous le titre
   * « Première connexion : protège ton accès », et `facultative` valant faux (la colonne est non
   * nulle, donc `deuxFaActive` dit vrai), il n'offrait même pas « Plus tard ». L'action refuse
   * désormais, mais l'écran doit refuser aussi : une page qui propose un geste que le serveur
   * rejettera est un piège.
   */
  if (etatSecret.etat === "illisible") redirect("/connexion?erreur=2fa-illisible");
  const secretActif = etatSecret.etat === "actif" ? etatSecret.secret : null;
  const configuration = !secretActif && attente.secretProvisoire ? attente.secretProvisoire : null;
  if (!secretActif && !configuration) redirect("/connexion?erreur=session");
  // Déjà active : le code est exigé, aucune sortie. Sinon elle est proposée — et on peut passer.
  const facultative = !deuxFaActive(user);

  const qr = configuration ? await QRCode.toDataURL(urlOtpauth(configuration, user.email, (await identite()).nomCourt), { margin: 1, width: 220, color: { dark: "#282828", light: "#fffdfa" } }) : null;

  return (
    <PageAuth
      titre={configuration ? (facultative ? "Protéger mon compte" : "Double authentification") : `Bonjour ${user.prenom}`}
      sousTitre={
        configuration
          ? facultative
            ? "C'est facultatif. Un code à 6 chiffres, donné par une application sur ton téléphone, en plus de ton mot de passe."
            : "Première connexion : protège ton accès avec une application d'authentification."
          : "Saisis le code à 6 chiffres affiché par ton application d'authentification."
      }
    >
      {configuration && qr && (
        <>
          {facultative && (
            <p className="mb-5 rounded-xl bg-surface-douce p-3 text-sm text-texte-secondaire">
              Tu peux entrer sans : appuie sur « Plus tard », on ne te le reproposera pas avant trois mois. Ton lien personnel, lui, continue de fonctionner dans tous les cas.
            </p>
          )}
          <ol className="mb-6 flex list-decimal flex-col gap-4 pl-5">
            <li>
              Installe une application gratuite si tu n&apos;en as pas : <strong>Aegis</strong>, <strong>FreeOTP</strong>, Google ou Microsoft Authenticator.
            </li>
            <li>
              Scanne ce code avec l&apos;application :
              <div className="mt-2 inline-block rounded-2xl bg-white p-3 shadow-carte">
                {/* eslint-disable-next-line @next/next/no-img-element -- image générée en mémoire (data URL) */}
                <img src={qr} alt="QR code à scanner avec l'application d'authentification" width={220} height={220} />
              </div>
              <details className="mt-2 text-sm">
                <summary className="cursor-pointer text-texte-secondaire">Impossible de scanner ? Saisir la clé à la main</summary>
                <code className="mt-1 block select-all break-all rounded-lg bg-surface-douce p-2 text-base tracking-wider">{formaterSecret(configuration)}</code>
                <p className="mt-1 text-texte-secondaire">Type : code temporel (TOTP), 6 chiffres, 30 secondes.</p>
              </details>
            </li>
            <li>Recopie le code à 6 chiffres qu&apos;elle affiche pour confirmer :</li>
          </ol>
        </>
      )}
      {/* « Plus tard » s'ajoute quand la configuration est proposée — la sortie naturelle est alors
          d'entrer, pas d'abandonner. Mais **« Annuler » ne disparaît plus** : il était retiré dans
          ce cas précis, et l'écran n'avait donc **aucune issue qui n'ouvre pas de session**.

          Ce que ça coûtait, sur la tablette du club : quelqu'un donne son adresse et son mot de
          passe, arrive ici, se rend compte qu'il n'a pas son téléphone, et ne peut que fermer
          l'onglet. Le cookie d'attente (`hema_2fa`, signé, dix minutes) reste alors dans le
          navigateur — et `destroySession` ne l'effaçait pas non plus. Dans les dix minutes, la
          personne suivante rouvre cette page, appuie sur « Plus tard », et **ouvre une session de
          douze heures au nom du premier, sans avoir jamais connu son mot de passe**. La preuve du
          premier facteur restait à l'ambiante, sans aucun moyen de la révoquer, sur le seul chemin
          qui la convertit en session sans second facteur. */}
      <FormulaireCode
        configuration={!!configuration}
        annuler={annulerConnexion2fa}
        passer={configuration && facultative ? passerDeuxFa : undefined}
        libelle={configuration && facultative ? "Activer et me connecter" : undefined}
      />
    </PageAuth>
  );
}
