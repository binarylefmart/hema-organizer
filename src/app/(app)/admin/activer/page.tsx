import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { requirePermission } from "@/lib/auth/current-user";
import { ANCRE_SECURITE, CHEMIN_ACTIVATION_ADMIN, compteAcces, etapeAcces,
  secretTotpIllisible, lireReglage2fa, peutReglerSonAcces, RANG_ETAPE, type EtapeAcces } from "@/lib/auth/acces-admin";
import { lireAffichageCodes } from "@/lib/auth/deux-fa";
import { formaterSecret, urlOtpauth } from "@/lib/auth/totp";
import { identite } from "@/lib/identite";
import { MOT_DE_PASSE_MIN } from "@/lib/constants";
import { activerDeuxFaAdmin, confirmerCodesSecours, preparerDeuxFaAdmin } from "@/actions/auth";
import { Alerte } from "@/components/ui/Alerte";
import { Carte } from "@/components/ui/Carte";
import { BoutonEnvoi } from "@/components/ui/BoutonEnvoi";
import { LienBouton } from "@/components/ui/Bouton";
import { Icone } from "@/components/ui/Icone";
import { FormulaireCode } from "@/components/auth/FormulaireCode";
import { FormulaireMotDePasseAdmin } from "./FormulaireMotDePasseAdmin";

export const metadata: Metadata = { title: "Activer mon accès administrateur" };

type Props = { searchParams: Promise<{ erreur?: string }> };

const ETAPES: { cle: Exclude<EtapeAcces, "termine">; titre: string }[] = [
  { cle: "mot-de-passe", titre: "Mot de passe" },
  { cle: "deux-fa", titre: "Double authentification" },
  { cle: "codes-secours", titre: "Codes de secours" },
];

const ERREURS: Record<string, string> = {
  // L'écran ne montre pas un QR code passé ce délai, il montre le bouton qui en prépare un : le message dit donc le geste à faire.
  expire: "Le réglage a expiré (30 minutes) : appuie sur « Afficher mon QR code » pour reprendre l'étape.",
  tentatives: "Trop de tentatives. Réessaie dans quelques minutes.",
};

/**
 * Réglage de l'accès administrateur, compte par compte : mot de passe, double authentification,
 * codes de secours. Réservé aux administrateurs **nominatifs** (le compte du portail est déjà réglé),
 * connectés par leur lien personnel — c'est le seul endroit de l'administration qui n'exige pas
 * encore la session forte, puisqu'il sert justement à l'obtenir.
 */
export default async function PageActiverAdmin({ searchParams }: Props) {
  const user = await requirePermission("settings.technical", CHEMIN_ACTIVATION_ADMIN);
  const compte = await compteAcces(user.id);
  if (!compte) redirect("/?acces=refuse");
  // Le compte du portail est réglé une fois pour toutes : rien à activer pour lui
  if (compte.service) redirect("/admin");
  if (!peutReglerSonAcces(compte)) redirect("/?acces=refuse");

  const { erreur } = await searchParams;
  const affichage = await lireAffichageCodes(user.id);
  const etape = etapeAcces(compte, !!affichage);
  // Voir `secretTotpIllisible` : la colonne dit « en place », le déchiffrement dit le contraire.
  const illisible = secretTotpIllisible(compte);
  const secret = etape === "deux-fa" ? await lireReglage2fa(user.id) : null;
  const qr = secret ? await QRCode.toDataURL(urlOtpauth(secret, compte.email, (await identite()).nomCourt), { margin: 1, width: 220, color: { dark: "#282828", light: "#fffdfa" } }) : null;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-3xl">Mon accès administrateur</h1>
        <p className="text-texte-secondaire">
          {illisible
            ? "Ton accès ne peut pas être vérifié pour le moment."
            : etape === "termine"
              ? "Ton accès est réglé : tu entres dans l'administration avec ton propre compte."
              : "Trois étapes pour ouvrir l'administration avec ton propre compte, sans passer par le compte du bureau."}
        </p>
      </div>

      {illisible && (
        <Alerte type="erreur" titre="Double authentification illisible">
          La clé de chiffrement du serveur a changé : ton code à six chiffres ne peut plus être vérifié, et tes codes de
          secours non plus. Par sécurité, l&apos;application ne la remplace pas toute seule — sinon il suffirait de
          connaître ton mot de passe pour inscrire un autre téléphone sur ton compte. Demande à un autre administrateur
          de remettre ta double authentification à zéro (Espace admin → Comptes admin) ; s&apos;il n&apos;y en a pas
          d&apos;autre, la commande <code>npm run admin:reset-2fa</code> le fait depuis le serveur.
        </Alerte>
      )}

      {erreur && ERREURS[erreur] && <Alerte type="attention">{ERREURS[erreur]}</Alerte>}

      {etape !== "termine" && (
        <ol className="flex flex-col gap-2 sm:flex-row sm:gap-3" aria-label="Étapes du réglage">
          {ETAPES.map((e, i) => {
            const rang = i + 1;
            const courante = e.cle === etape;
            const faite = rang < RANG_ETAPE[etape];
            return (
              <li
                key={e.cle}
                aria-current={courante ? "step" : undefined}
                className={`flex flex-1 items-center gap-2 rounded-xl border p-3 ${courante ? "border-primaire/40 bg-primaire-doux font-semibold" : "border-bordure/60 bg-surface text-texte-secondaire"}`}
              >
                {faite ? <Icone nom="check" taille={18} className="text-vert" titre="Étape terminée" /> : <span aria-hidden>{rang}.</span>}
                <span>{e.titre}</span>
              </li>
            );
          })}
        </ol>
      )}

      {etape === "mot-de-passe" && (
        <Carte titre="Étape 1 — Choisir mon mot de passe">
          <p className="mb-4 text-texte-secondaire">
            Il servira sur la page de connexion, avec ton adresse <strong className="text-texte">{compte.email}</strong>. Choisis-en un que tu n&apos;utilises nulle part
            ailleurs.
          </p>
          <FormulaireMotDePasseAdmin aide={`Au moins ${MOT_DE_PASSE_MIN} caractères.`} />
        </Carte>
      )}

      {etape === "deux-fa" && (
        <Carte titre="Étape 2 — Activer la double authentification">
          {qr && secret ? (
            <>
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
                    <code className="mt-1 block select-all break-all rounded-lg bg-surface-douce p-2 text-base tracking-wider">{formaterSecret(secret)}</code>
                    <p className="mt-1 text-texte-secondaire">Type : code temporel (TOTP), 6 chiffres, 30 secondes.</p>
                  </details>
                </li>
                <li>Recopie le code à 6 chiffres qu&apos;elle affiche pour confirmer :</li>
              </ol>
              <FormulaireCode configuration motDePasse action={activerDeuxFaAdmin} libelle="Activer la double authentification" />
            </>
          ) : (
            <form action={preparerDeuxFaAdmin} className="flex flex-col gap-4">
              <p className="text-texte-secondaire">
                Ton mot de passe est enregistré. Il reste à protéger ton accès avec une application d&apos;authentification (un code à 6 chiffres qui change toutes les 30
                secondes).
              </p>
              <BoutonEnvoi taille="grande" pleineLargeur enCours="Préparation…">
                Afficher mon QR code
              </BoutonEnvoi>
            </form>
          )}
        </Carte>
      )}

      {etape === "codes-secours" && affichage && (
        <Carte titre="Étape 3 — Mes codes de secours">
          <form action={confirmerCodesSecours.bind(null, "/admin")} className="flex flex-col gap-5">
            <Alerte type="attention" titre="À noter maintenant">
              Ces codes ne seront plus jamais affichés. Si tu perds ton téléphone, l&apos;un d&apos;eux remplace le code de l&apos;application. Chaque code ne sert qu&apos;une
              fois.
            </Alerte>
            <ol className="grid grid-cols-2 gap-2 rounded-xl bg-surface-douce p-4 font-mono text-lg tracking-wider" aria-label="Codes de secours">
              {affichage.codes.map((c) => (
                <li key={c} className="select-all rounded-lg bg-surface px-3 py-2 text-center">
                  {c}
                </li>
              ))}
            </ol>
            <BoutonEnvoi taille="grande" pleineLargeur enCours="Un instant…">
              J&apos;ai noté mes codes
            </BoutonEnvoi>
          </form>
        </Carte>
      )}

      {etape === "termine" && (
        <Carte titre="Tout est réglé">
          <div className="flex flex-col gap-4">
            <Alerte type="succes">
              Mot de passe, double authentification et codes de secours sont en place pour <strong>{compte.email}</strong>.
            </Alerte>
            {/* **Le chemin de sortie est nommé ici, sur l'écran qui annonce que tout est en
                place.** Les codes de secours ne sont gardés que hachés et ne s'affichent qu'une
                fois : qui a fermé l'étape 3 sans les noter (ou l'a rechargée passé le délai
                d'affichage) arrive sur cette carte, qui lui dit que ses codes « sont en place » —
                alors qu'il ne les a jamais lus, et qu'ils sont sa seule issue s'il perd son
                téléphone. Sans cette phrase, c'est un cul-de-sac : le parcours est terminé, il ne
                se rejoue pas, et rien à l'écran ne nomme le geste qui répare. */}
            <p className="text-texte-secondaire">
              <strong className="text-texte">Tu n&apos;as pas noté tes codes de secours ?</strong> Ils ne s&apos;affichent plus — ils ne sont gardés que sous une forme
              illisible. Engendres-en huit nouveaux depuis{" "}
              <Link href={ANCRE_SECURITE} className="underline">
                Mon profil → Sécuriser mon compte
              </Link>{" "}
              : bouton « Régénérer mes codes de secours » (les précédents deviennent alors inutilisables). C&apos;est ce qui te fera rentrer si tu perds ton téléphone.
            </p>
            {user.sessionForte ? (
              <p className="text-texte-secondaire">Ta session actuelle ouvre l&apos;administration pendant 12 heures. Passé ce délai, reconnecte-toi avec ton mot de passe.</p>
            ) : (
              <p className="text-texte-secondaire">
                Tu es entré(e) par ton lien personnel : pour l&apos;administration, reconnecte-toi avec ton adresse, ton mot de passe et ton code.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {user.sessionForte ? (
                <LienBouton href="/admin/periodes">Aller dans l&apos;administration</LienBouton>
              ) : (
                <LienBouton href="/connexion/admin?suite=%2Fadmin">Me connecter</LienBouton>
              )}
              <LienBouton href="/profil" variante="secondaire">
                Mon profil
              </LienBouton>
            </div>
          </div>
        </Carte>
      )}

      <p className="text-center text-sm">
        <Link href="/" className="inline-flex min-h-11 items-center justify-center px-2">
          Revenir à l&apos;application
        </Link>
      </p>
    </div>
  );
}
