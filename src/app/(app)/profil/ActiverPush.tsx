"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { enregistrerAbonnementPush, retirerAbonnementPush, retirerAppareilPush, testerPush } from "@/actions/push";
import { Alerte } from "@/components/ui/Alerte";
import { Bouton } from "@/components/ui/Bouton";
import { Icone } from "@/components/ui/Icone";
// Le titre vient du module d'état : la carte et le résumé de la colonne disent le même mot.
import { TITRE_APPAREILS_NOTIFIES } from "./etat-compte";

export type AppareilAbonne = { id: string; appareil: string; endpoint: string; depuis: string };

type Props = {
  /** Clé publique VAPID du serveur : elle ne permet que de s'abonner */
  clePublique: string;
  appareils: readonly AppareilAbonne[];
};

/**
 * La clé publique voyage en base64url ; l'API du navigateur veut des octets, dans un vrai
 * `ArrayBuffer` (le type générique de `Uint8Array` admet aussi la mémoire partagée, que
 * `applicationServerKey` refuse).
 */
function versOctets(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const binaire = atob(base64);
  const octets = new Uint8Array(new ArrayBuffer(binaire.length));
  for (let i = 0; i < binaire.length; i++) octets[i] = binaire.charCodeAt(i);
  return octets;
}

/** iPhone ou iPad, et application pas encore ajoutée à l'écran d'accueil : le push n'existe pas là. */
function iosSansInstallation(): boolean {
  if (typeof navigator === "undefined") return false;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const installee = window.matchMedia("(display-mode: standalone)").matches || "standalone" in navigator;
  return ios && !installee;
}

type Etat = "chargement" | "impossible" | "ios" | "refuse" | "inactif" | "actif";

/**
 * **Notifications sur cet appareil.**
 *
 * L'abonnement au push est une affaire d'**appareil**, pas de compte : le même membre peut vouloir
 * être prévenu sur son téléphone et pas sur l'ordinateur du travail. Cette carte règle donc « cet
 * appareil-ci », et liste à côté ceux qui sont déjà abonnés, avec de quoi les retirer à distance —
 * un téléphone perdu se débranche depuis n'importe où.
 *
 * Ce qui se règle **ailleurs** (carte « Mes notifications ») : quels messages arrivent par quel
 * canal. Ici, on branche ou on débranche l'appareil ; là-bas, on choisit ce qu'il reçoit.
 *
 * Sur iPhone, l'autorisation n'est proposée qu'**après** l'ajout à l'écran d'accueil (iOS 16.4+) :
 * plutôt qu'un bouton qui échouerait sans rien dire, la carte explique la marche à suivre.
 */
export function ActiverPush({ clePublique, appareils }: Props) {
  const router = useRouter();
  const [etat, setEtat] = useState<Etat>("chargement");
  const [message, setMessage] = useState<{ ton: "succes" | "erreur"; texte: string } | null>(null);
  const [occupe, setOccupe] = useState(false);

  const relire = useCallback(async () => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setEtat(iosSansInstallation() ? "ios" : "impossible");
      return;
    }
    if (Notification.permission === "denied") {
      setEtat("refuse");
      return;
    }
    try {
      const enregistrement = await navigator.serviceWorker.getRegistration();
      const abonnement = await enregistrement?.pushManager.getSubscription();
      setEtat(abonnement ? "actif" : "inactif");
    } catch {
      setEtat("inactif");
    }
  }, []);

  useEffect(() => {
    void relire();
  }, [relire]);

  async function activer() {
    setOccupe(true);
    setMessage(null);
    try {
      const enregistrement = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setEtat(permission === "denied" ? "refuse" : "inactif");
        setMessage({ ton: "erreur", texte: "L'autorisation n'a pas été donnée : rien ne sera envoyé sur cet appareil." });
        return;
      }
      const abonnement = await enregistrement.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: versOctets(clePublique) });
      const brut = abonnement.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
      const res = await enregistrerAbonnementPush({ endpoint: brut.endpoint, p256dh: brut.keys?.p256dh, auth: brut.keys?.auth });
      if (res.erreur) {
        setMessage({ ton: "erreur", texte: res.erreur });
        return;
      }
      setEtat("actif");
      setMessage({ ton: "succes", texte: res.succes ?? "C'est activé." });
      router.refresh();
    } catch {
      setMessage({ ton: "erreur", texte: "Cet appareil n'a pas pu être activé. Réessaie, ou vérifie les autorisations du navigateur." });
    } finally {
      setOccupe(false);
    }
  }

  async function desactiver() {
    setOccupe(true);
    setMessage(null);
    try {
      const enregistrement = await navigator.serviceWorker.getRegistration();
      const abonnement = await enregistrement?.pushManager.getSubscription();
      if (abonnement) {
        await retirerAbonnementPush(abonnement.endpoint);
        await abonnement.unsubscribe();
      }
      setEtat("inactif");
      setMessage({ ton: "succes", texte: "Cet appareil ne recevra plus de notifications." });
      router.refresh();
    } catch {
      setMessage({ ton: "erreur", texte: "La désactivation a échoué. Réessaie." });
    } finally {
      setOccupe(false);
    }
  }

  async function essayer() {
    setOccupe(true);
    setMessage(null);
    const res = await testerPush();
    setMessage(res.erreur ? { ton: "erreur", texte: res.erreur } : { ton: "succes", texte: res.succes ?? "Envoyée." });
    setOccupe(false);
  }

  // `id` + `scroll-mt-20` : entrée du sommaire de « Mon profil » (`SommaireCollant`) — sans le
  // dégagement, l'en-tête collant recouvre le titre qu'on vient d'atteindre.
  return (
    <section id="appareil" className="scroll-mt-20 rounded-2xl border border-bordure/60 bg-surface p-4 shadow-carte sm:p-5">
      <h2 className="text-xl font-bold">Notifications sur cet appareil</h2>
      <p className="mt-1 text-texte-secondaire">
        En plus des emails, l&apos;application peut prévenir directement sur le téléphone : rappel de cours, annulation, réponse à une proposition. Le choix
        des messages se règle juste en dessous.
      </p>

      {message && (
        <div className="mt-3">
          <Alerte type={message.ton === "succes" ? "succes" : "erreur"}>{message.texte}</Alerte>
        </div>
      )}

      <div className="mt-3 flex flex-col gap-3">
        {etat === "chargement" && <p className="text-texte-secondaire">Vérification…</p>}

        {etat === "ios" && (
          <Alerte type="info" titre="Sur iPhone, il faut d'abord installer l'application">
            Appuie sur <strong>Partager</strong> en bas de Safari, puis sur <strong>« Sur l&apos;écran d&apos;accueil »</strong>. Ouvre ensuite
            l&apos;application depuis l&apos;icône ajoutée : le bouton d&apos;activation apparaîtra ici.
          </Alerte>
        )}

        {etat === "impossible" && <Alerte type="info">Ce navigateur ne sait pas recevoir de notifications. Les emails, eux, continuent d&apos;arriver.</Alerte>}

        {etat === "refuse" && (
          <Alerte type="info" titre="Les notifications sont bloquées dans le navigateur">
            L&apos;autorisation a été refusée pour ce site. Elle se rouvre dans les réglages du navigateur (cadenas à côté de l&apos;adresse), puis reviens
            ici.
          </Alerte>
        )}

        {etat === "inactif" && (
          <div>
            <Bouton type="button" onClick={activer} disabled={occupe}>
              <Icone nom="check" taille={20} />
              Activer sur cet appareil
            </Bouton>
          </div>
        )}

        {etat === "actif" && (
          <div className="flex flex-wrap gap-2">
            <Bouton type="button" variante="secondaire" onClick={essayer} disabled={occupe}>
              <Icone nom="info" taille={20} />
              Envoyer un essai
            </Bouton>
            <Bouton type="button" variante="danger" onClick={desactiver} disabled={occupe}>
              <Icone nom="alerte" taille={20} />
              Désactiver sur cet appareil
            </Bouton>
          </div>
        )}
      </div>

      {appareils.length > 0 && (
        <div className="mt-4">
          <h3 className="font-semibold">{TITRE_APPAREILS_NOTIFIES}</h3>
          <ul className="mt-1 flex flex-col divide-y divide-bordure/60">
            {appareils.map((a) => (
              <li key={a.id} className="flex min-h-14 flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <span className="block font-semibold">{a.appareil || "Appareil"}</span>
                  <span className="text-sm text-texte-secondaire">Activé le {a.depuis}</span>
                </span>
                <Bouton
                  type="button"
                  variante="danger"
                  taille="petite"
                  disabled={occupe}
                  onClick={async () => {
                    setOccupe(true);
                    const res = await retirerAppareilPush(a.id);
                    setMessage(res.erreur ? { ton: "erreur", texte: res.erreur } : { ton: "succes", texte: res.succes ?? "Retiré." });
                    await relire();
                    setOccupe(false);
                    router.refresh();
                  }}
                >
                  <Icone nom="alerte" taille={18} />
                  Retirer
                </Bouton>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
