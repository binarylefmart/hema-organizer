"use client";

import { useEffect } from "react";
import { GRACE_SORTIE_ELEVATION_MS } from "@/lib/constants";

/** Où l'on retombe en rouvrant l'application après une vraie absence : ses prochains cours. */
const ACCUEIL = "/";

/**
 * Marque posée dans `sessionStorage` : elle vit **exactement** le temps d'une session de navigation.
 * Un rechargement et les navigations internes la gardent ; fermer l'application l'efface, et
 * **aucun navigateur ne la restaure** — contrairement au cookie d'élévation, que Chrome
 * (« Continuer là où vous vous êtes arrêté »), Android et les applications installées rendent
 * intact au redémarrage. C'est le seul témoin fiable de « c'est bien la même ouverture ».
 */
const CLE_NAVIGATION = "hema_elevation_navigation";

/** Salon où les onglets d'une même application se répondent (voir `sessionNeuve`). */
const CANAL = "hema-elevation";

/** Au-delà, une élévation n'est plus « celle qu'on vient de prendre » mais une élévation restaurée. */
const GRACE_OUVERTURE_MS = 2 * 60 * 1000;

/** Temps laissé aux autres onglets pour répondre « je suis là » avant de conclure au redémarrage. */
const ATTENTE_REPONSE_MS = 250;

/**
 * **Quitter l'application referme l'espace admin — et le retour le vérifie.**
 *
 * Monté uniquement pendant l'élévation (voir `src/app/(app)/layout.tsx`), ce composant ne rend
 * rien. Il fait deux choses, et il a fallu les deux pour que la promesse tienne vraiment.
 *
 * **1. Il prévient au départ.** Au moment où la page passe en arrière-plan ou se ferme, un
 * `sendBeacon` part vers `/api/admin/quitter`. `visibilitychange` plutôt que `beforeunload` : sur
 * téléphone, une application qu'on quitte ne se « décharge » pas, elle passe en arrière-plan —
 * `beforeunload` n'y arrive jamais. Et `sendBeacon` est le seul envoi que le navigateur promet de
 * poster même si la page disparaît dans la seconde. Le serveur **note** la sortie sans rien fermer :
 * le même signal part quand on change simplement de page, et fermer sur-le-champ redemanderait mot
 * de passe et code au premier clic sur un lien.
 *
 * **2. Il vérifie au retour, et c'est le verrou qui manquait**. Les deux échéances vivent côté
 * serveur, mais **le serveur n'est consulté que si on lui parle** : une application installée qu'on
 * rouvre restaure sa page telle quelle, sans aucune requête, et la navigation suivante peut encore
 * être servie par le cache de routeur de Next. L'onglet « Admin » restait donc affiché et les
 * écrans d'administration s'ouvraient — non parce que l'élévation tenait, mais parce que personne
 * n'avait redemandé son avis au serveur. D'où : au retour au premier plan, si l'absence a dépassé
 * la grâce, on **déclare la sortie** (le serveur referme pour de bon) puis on **renvoie à
 * l'accueil**, ce qui vide le cache de routeur et fait retomber tout l'écran sur la vérité du
 * serveur.
 *
 * **Pourquoi l'accueil et non la page où l'on était**. Recharger sur place laissait revenir sur un
 * écran d'administration qui, l'élévation refermée, ne peut plus que renvoyer vers
 * `/connexion/admin` : on rouvrait son application et on tombait sur une demande de mot de passe,
 * comme si on avait été mis dehors. Renvoyer à l'accueil rend exactement ce qu'on vient chercher en
 * rouvrant l'application — ses prochains cours —, avec les droits d'un instructeur : tout le
 * travail du trimestre reste ouvert, seule l'administration technique s'est refermée. L'espace
 * admin se rouvre d'un mot de passe depuis « Mon profil », et c'est un geste qu'on fait quand on en
 * a besoin, pas au réveil.
 *
 * **Déclarer sa propre sortie ne donne aucun droit** : cette route ne sait que *fermer*. Le client
 * ne peut donc rien s'offrir en mentant — au pire se déconnecter lui-même de l'espace admin, ce
 * qu'un bouton fait déjà.
 *
 * Et le cas du navigateur tué net, qui ne prévient jamais, reste couvert par le filet de 10 minutes
 * d'inactivité vérifié en base (voir `src/lib/auth/elevation.ts`).
 */
type Props = {
  /**
   * Quand l'élévation a été prise, en millisecondes (`user.elevationOuverteLe`). `null` si la date
   * est inconnue : on traite alors l'élévation comme ancienne, c'est-à-dire du côté prudent.
   */
  ouverteLe: number | null;
};

/** Pose la marque de navigation, sans jamais faire tomber l'écran si le stockage est refusé. */
function marquer(): void {
  try {
    sessionStorage.setItem(CLE_NAVIGATION, "1");
  } catch {
    // Navigation privée, stockage bloqué : on n'a pas de témoin, on ne prétendra pas en avoir un.
  }
}

export function FermerEnQuittant({ ouverteLe }: Props) {
  /*
   * **Fermer l'application ferme l'espace admin — même quand rien n'a prévenu.**
   *
   * Delta, : « si je ferme l'app sur mon téléphone ou PC et que je suis connecté en admin, si je
   * reviens je suis toujours connecté en admin ». C'est exact, et le `sendBeacon` du départ n'y
   * pouvait rien : une application tuée net ne prévient personne, et le cookie d'élévation — un
   * cookie de session, pourtant — revient **intact**, restauré par le navigateur. Côté serveur, ce
   * retour ressemble trait pour trait à quelqu'un qui n'a jamais quitté l'écran.
   *
   * Le témoin qui les sépare est `sessionStorage` : lui n'est jamais restauré. À l'ouverture, trois
   * cas, et un seul referme :
   *
   * 1. **la marque est là** — même session de navigation, on ne touche à rien ;
   * 2. **pas de marque, mais l'élévation a moins de deux minutes** — on vient de redonner mot de
   *    passe et code dans cet onglet : on pose la marque, c'est tout ;
   * 3. **pas de marque, élévation plus ancienne** — l'application a redémarré : on déclare la
   *    sortie et on repart de l'accueil.
   *
   * **Le cas du second onglet** est la seule chose qui rendrait ce mécanisme odieux : ouvrir un
   * nouvel onglet sur un ordinateur, c'est une session de navigation neuve, et refermer l'espace
   * admin de l'onglet d'à côté pour cette raison serait absurde. Avant de conclure, on demande donc
   * aux autres onglets s'il y en a un de vivant (`BroadcastChannel`) ; une seule réponse suffit à
   * adopter leur session. Sans réponse en un quart de seconde — ou sans `BroadcastChannel` du tout —
   * on referme : se tromper dans ce sens coûte un mot de passe, se tromper dans l'autre laisse
   * l'administration ouverte sur un appareil qu'on croyait avoir fermé.
   */
  useEffect(() => {
    let marque: string | null = null;
    try {
      marque = sessionStorage.getItem(CLE_NAVIGATION);
    } catch {
      // Sans stockage, ce garde-fou n'existe pas : les échéances serveur restent seules en place.
      return;
    }
    if (marque) return;
    if (ouverteLe !== null && Date.now() - ouverteLe < GRACE_OUVERTURE_MS) {
      marquer();
      return;
    }
    if (typeof BroadcastChannel === "undefined") {
      void quitterPourDeBon();
      return;
    }
    const canal = new BroadcastChannel(CANAL);
    let repondu = false;
    canal.onmessage = (e) => {
      if (e.data === "present") repondu = true;
    };
    canal.postMessage("qui-vive");
    const verdict = window.setTimeout(() => {
      canal.close();
      if (repondu) marquer();
      else void quitterPourDeBon();
    }, ATTENTE_REPONSE_MS);
    return () => {
      window.clearTimeout(verdict);
      canal.close();
    };
  }, [ouverteLe]);

  // Répondre aux onglets qui s'ouvrent : cet onglet-ci est vivant, sa session de navigation aussi.
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const canal = new BroadcastChannel(CANAL);
    canal.onmessage = (e) => {
      if (e.data !== "qui-vive") return;
      let marque: string | null = null;
      try {
        marque = sessionStorage.getItem(CLE_NAVIGATION);
      } catch {
        return;
      }
      if (marque) canal.postMessage("present");
    };
    return () => canal.close();
  }, []);

  useEffect(() => {
    // Depuis quand la page est-elle cachée ? `null` tant qu'elle est à l'écran.
    let cacheeDepuis: number | null = null;

    const partir = () => {
      // `pagehide` se déclenche aussi sur un simple rechargement : on ne signale que si la page
      // est réellement partie au second plan.
      if (document.visibilityState !== "hidden" || cacheeDepuis !== null) return;
      cacheeDepuis = Date.now();
      navigator.sendBeacon?.("/api/admin/quitter");
    };

    const revenir = () => {
      if (document.visibilityState !== "visible" || cacheeDepuis === null) return;
      const absence = Date.now() - cacheeDepuis;
      cacheeDepuis = null;
      // Sous la grâce, c'était un changement de page ou un aller-retour d'une seconde. On le **dit**
      // au serveur : sans ce mot, la sortie notée vieillissait toute seule — elle mesure l'âge du
      // signal, pas la durée de l'absence — et refermait l'espace admin au premier clic, trois
      // minutes plus tard, alors que la page était restée sous les yeux.
      if (absence <= GRACE_SORTIE_ELEVATION_MS) {
        navigator.sendBeacon?.(`/api/admin/quitter?retour=${absence}`);
        return;
      }
      // Au-delà, l'application était vraiment partie. On le dit au serveur — même si le signal du
      // départ s'est perdu, ce qui arrive sur iOS — puis on repart de l'accueil, pour que l'écran
      // cesse de montrer un espace admin que le serveur vient de refermer.
      //
      // `assign` et non `reload` : une navigation complète, qui repasse par le serveur et rend la
      // page qu'on veut voir en rouvrant l'application. Un `reload` sur un écran d'administration
      // n'aurait rendu qu'une redirection vers `/connexion/admin`.
      void quitterPourDeBon();
    };

    const surVisibilite = () => (document.visibilityState === "hidden" ? partir() : revenir());
    document.addEventListener("visibilitychange", surVisibilite);
    window.addEventListener("pagehide", partir);
    // `pageshow` est le seul signal d'une page ressortie du cache arrière-avant (bfcache) : sur
    // iPhone, c'est le cas le plus fréquent de tous, et `visibilitychange` n'y suffit pas toujours.
    window.addEventListener("pageshow", revenir);
    return () => {
      document.removeEventListener("visibilitychange", surVisibilite);
      window.removeEventListener("pagehide", partir);
      window.removeEventListener("pageshow", revenir);
    };
  }, []);
  return null;
}

/**
 * Déclare la sortie au serveur, puis repart de l'accueil.
 *
 * Partagée par les deux chemins qui referment — le retour après une absence et le redémarrage de
 * l'application — parce que c'est **la même chose qui s'est passée** : on n'était plus là. La route
 * ne sait que fermer : la déclarer ne donne donc aucun droit, au pire on se déconnecte soi-même.
 */
function quitterPourDeBon(): Promise<void> {
  return fetch("/api/admin/quitter?parti=1", { method: "POST", keepalive: true, cache: "no-store" })
    .catch(() => {})
    .then(() => {
      window.location.assign(ACCUEIL);
    });
}
