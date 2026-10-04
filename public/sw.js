/*
 * Service worker de l'application — il n'existe que pour les notifications.
 *
 * Volontairement sans cache : mettre les pages en cache demanderait une stratégie d'invalidation,
 * et l'application est rendue côté serveur, avec des chiffres qui changent d'une minute à l'autre.
 * Un cache mal réglé montrerait un cours annulé comme s'il tenait toujours. On s'en tient donc au
 * strict nécessaire : recevoir une notification, et ouvrir la bonne page quand on l'ouvre.
 *
 * Fichier écrit à la main, servi tel quel depuis /sw.js (portée « / », comme le manifeste) : aucune
 * étape de build, aucune dépendance, rien à regénérer.
 */

// Un nouveau service worker prend la main tout de suite, sans attendre la fermeture des onglets :
// sans cache à migrer, rien ne justifie de faire vivre deux versions en parallèle.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let charge = {};
  try {
    charge = event.data ? event.data.json() : {};
  } catch {
    charge = {};
  }
  // Repli **neutre** : ce fichier est servi tel quel, sans build et sans accès à la base — il ne
  // peut pas connaître le nom du club. Le serveur envoie donc toujours le titre dans la charge
  // utile (voir `ChargePush.titre`) ; on ne lit ce repli que si un envoi partait sans.
  const titre = charge.titre || "Organizer";
  const options = {
    body: charge.corps || "",
    icon: "/icons/icone-192.png",
    badge: "/icons/badge-96.png",
    // Regroupe les notifications d'un même sujet : la nouvelle remplace la précédente plutôt que
    // d'empiler trois rappels pour le même cours.
    tag: charge.tag || "organizer",
    renotify: Boolean(charge.tag),
    data: { url: charge.url || "/" },
    lang: "fr",
  };
  event.waitUntil(self.registration.showNotification(titre, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((fenetres) => {
      // Une fenêtre de l'application est déjà ouverte : on la reprend et on l'emmène au bon endroit,
      // plutôt que d'en ouvrir une seconde par-dessus.
      for (const fenetre of fenetres) {
        if (new URL(fenetre.url).origin === self.location.origin) {
          return fenetre.focus().then((f) => (f.navigate ? f.navigate(url) : f));
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
