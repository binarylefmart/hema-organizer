import { enqueueEmail } from "./mailer";
import type { EmailContenu } from "./templates/layout";

/**
 * **La porte unique vers l'adresse de liste du club.**
 *
 * Un club de 80 membres avec deux cours par semaine envoie 160 emails de récap par semaine : au-dessus
 * du quota d'un SMTP gratuit, qui coupe **au milieu de la liste** — et les derniers ne reçoivent rien,
 * en silence. Le remède est une adresse de distribution unique, tenue par le serveur mail du club :
 * un message au lieu de N.
 *
 * Mais une liste, c'est une adresse **que d'autres lisent**. D'où la règle qui gouverne tout ce
 * module, et qui n'a pas d'exception :
 *
 * > **Un message personnel ne peut jamais emprunter la liste.**
 *
 * Une clé envoyée à une liste est une clé donnée à tous ceux qui la lisent : le lien d'accès
 * personnel, le lien renouvelé, la réinitialisation de mot de passe, le lien d'annulation signé d'une
 * séance, le lien de désinscription — chacun de ces jetons vaut l'identité de son destinataire.
 *
 * **Le routage est une propriété du message, pas une préférence de canal** : un gabarit est
 * *collectif* ou *personnel*, et seuls les collectifs connaissent l'adresse de liste. C'est ce que
 * matérialise {@link MessageCollectif} — un type que rien ne fabrique en dehors de
 * {@link messageCollectif}, qui **relit le contenu** avant de le marquer. Le seul envoi vers la liste,
 * {@link enqueueEmailListe}, n'accepte que ce type-là : il n'existe aucun chemin de code par lequel un
 * gabarit personnel atteigne l'adresse de liste, ni par distraction, ni par copier-coller.
 *
 * Le contrôle est **dynamique** (on regarde les URL du message), et non déclaratif (« ce gabarit est
 * réputé collectif ») : un gabarit collectif à qui l'on ajouterait demain un bouton porteur de jeton
 * serait refusé le jour de l'ajout, alors qu'une étiquette posée une fois pour toutes aurait continué
 * de mentir.
 *
 * Corollaire de ce caractère dynamique : **le message se fabrique avant que la clé de déduplication
 * soit posée**, partout où un envoi collectif part. `messageCollectif` lève, et une clé écrite avant
 * la levée survivrait à l'incident : au passage suivant, le journal dirait « déjà envoyé » et la
 * notification serait éteinte pour toujours, en silence. Dans le bon ordre, l'échec est bruyant et
 * rejouable.
 */

/**
 * Les chemins publics qui portent un **jeton personnel**, chacun sous la forme `/segment/` —
 * c'est-à-dire « ce segment de chemin, suivi d'un autre ». Ils sont écrits ici en toutes lettres
 * plutôt qu'importés des modules qui les fabriquent (`invitations.ts`, `desinscription.ts`,
 * `notifications/seances.ts`, `actions/auth.ts`) : cette liste est une **garde**, et une garde ne
 * doit pas pouvoir être affaiblie par un renommage ailleurs — si un chemin change, c'est ce test qui
 * doit tomber, pas le filet qui doit suivre en silence.
 *
 * **Chacun correspond à une route `src/app/(public)/<segment>/[token]/`**, et le test l'exige : une
 * entrée sans route à segment de jeton ne peut par construction jamais correspondre, et rassure
 * sans rien couvrir. C'est ce qui a coûté leur place à `/nouveau-mot-de-passe/` et
 * `/mot-de-passe-oublie/` : ces deux pages n'ont pas de segment de jeton — la réinitialisation se
 * fait sur `/reinitialiser/<jeton>`, qui est bien dans la liste.
 */
export const CHEMINS_PERSONNELS = ["/invitation/", "/desinscription/", "/annuler/", "/reinitialiser/"] as const;

/**
 * **Et les noms de paramètre qui portent une clé.** La convention « barre finale » suppose que le
 * jeton soit toujours un *segment de chemin*. Le jour où l'un d'eux passe en paramètre de requête —
 * `/desinscription?token=…`, une réécriture qui n'a rien d'invraisemblable —, la comparaison sur le
 * chemin seul ne verrait plus rien et le lien partirait au club.
 *
 * La liste est volontairement large : aucun gabarit n'a besoin d'un paramètre nommé ainsi (le seul
 * lien à requête de l'application est `/seances?seance=…&reponse=…`), donc rien de légitime n'est
 * bloqué, et l'on gagne de couvrir le nom qu'on n'avait pas prévu.
 */
export const PARAMS_PERSONNELS = ["token", "jeton", "cle", "key", "secret", "signature", "acces"] as const;

export const ERREUR_JETON_PERSONNEL =
  "Ce message porte un lien personnel : il ne peut pas partir sur l'adresse de liste du club. Une clé envoyée à une liste est une clé donnée à tous ceux qui la lisent.";

/**
 * **Le lien fautif se nomme par son chemin, jamais en entier.**
 *
 * `messageCollectif` lève, et les quatre appelants sont des tâches planifiées, toutes sous un
 * `catch` qui fait `console.error` : le jour où cette garde se déclenche — c'est-à-dire le jour où
 * un gabarit collectif gagne un lien porteur de jeton, exactement le cas pour lequel elle existe —,
 * l'URL personnelle **complète** partait dans le journal du conteneur, lisible dans Portainer. Or
 * ce jeton EST la clé de quelqu'un : quatre mois de validité, connexion directe, aucun second
 * facteur. C'est la règle que `docs/SECURITE.md` impose au journal d'accès de NPM (`access_log off`
 * sur `/invitation/`) et que l'application tient partout ailleurs.
 *
 * Le chemin suffit à corriger le gabarit : il dit **quel** lien est en cause (`/invitation/…`,
 * `/desinscription/…`), ce qui est toute l'information utile à qui lit le message d'erreur. Un lien
 * que `URL` ne sait pas analyser est ramené à sa part avant `?`, `#` et le dernier segment retiré :
 * dans le doute, on en dit moins.
 */
export function cheminSansJeton(brut: string): string {
  const url = brut.trim().replace(/[)\].,;:!?»"']+$/, "");
  try {
    const analysee = new URL(url);
    // Le dernier segment est le jeton lui-même dans les quatre chemins surveillés.
    return analysee.pathname.replace(/\/[^/]*$/, "/…");
  } catch {
    const chemin = url.split(/[?#]/)[0];
    // Sans la moindre barre, rien ne distingue le chemin du jeton : on n'en dit rien du tout.
    return chemin.includes("/") ? chemin.replace(/\/[^/]*$/, "/…") : "…";
  }
}

/** Toutes les URL d'un contenu d'email : boutons, paragraphes et pied de page. */
function urlsDe(contenu: EmailContenu): string[] {
  const textes = [contenu.titre, ...contenu.paragraphes, ...(contenu.piedDePage ?? []), ...(contenu.boutons ?? []).map((b) => b.url)];
  return textes.flatMap((t) => t.match(/https?:\/\/\S+/g) ?? []).concat((contenu.boutons ?? []).map((b) => b.url));
}

/**
 * **Un lien porte-t-il une clé personnelle ?** On répond sur l'URL *analysée*, pas sur la chaîne.
 *
 * Deux questions, parce qu'il y a deux façons de transporter un jeton :
 *
 * 1. **le chemin** — comparé avec une barre finale ajoutée, pour que `/annuler/` ne corresponde qu'à
 *    un vrai segment et jamais à un simple préfixe (`/desinscriptions-du-club` n'est pas
 *    `/desinscription/`). Un lien nu vers `/annuler` est refusé lui aussi : il n'existe pas sans
 *    jeton, et dans le doute on refuse ;
 * 2. **la requête** — balayée par nom de paramètre, ce qui attrape `?token=…` où qu'il se trouve.
 *
 * Une URL que le navigateur ne saurait pas lire (lien relatif, guillemet recopié) ne fait pas
 * échouer la garde : on la découpe à la main plutôt que de la laisser passer sans examen.
 */
function porteUneClePersonnelle(brut: string): boolean {
  // Les URL sont extraites d'un texte : la ponctuation de la phrase peut coller au lien.
  const url = brut.trim().replace(/[)\].,;:!?»"']+$/, "");
  const coupe = url.search(/[?#]/);
  let chemin = coupe === -1 ? url : url.slice(0, coupe);
  let requete = coupe === -1 ? "" : url.slice(coupe);
  try {
    const analysee = new URL(url);
    chemin = analysee.pathname;
    requete = `${analysee.search}${analysee.hash}`;
  } catch {
    // Lien relatif ou mal formé : le découpage à la main ci-dessus fait l'affaire.
  }
  const cheminComplet = chemin.endsWith("/") ? chemin : `${chemin}/`;
  if (CHEMINS_PERSONNELS.some((segment) => cheminComplet.includes(segment))) return true;
  if (requete === "") return false;
  // `?token=`, `&Jeton=`, `#cle=` : on cherche un **nom de paramètre**, pas le mot où qu'il soit.
  return PARAMS_PERSONNELS.some((nom) => new RegExp(`[?#&]${nom}=`, "i").test(requete));
}

/**
 * Le premier lien personnel trouvé dans un message, ou `null` s'il n'y en a aucun.
 *
 * On regarde **tout** le message, pas seulement les boutons : le pied de page des emails de rappel
 * écrit le lien de désinscription en clair (« Ne plus recevoir ces rappels : https://… »), et c'est
 * exactement le genre de lien qu'on oublie en réécrivant un gabarit.
 */
export function jetonPersonnelDans(contenu: EmailContenu): string | null {
  for (const url of urlsDe(contenu)) {
    if (porteUneClePersonnelle(url)) return url;
  }
  return null;
}

/** Un message dont on a **vérifié** qu'il ne porte rien de personnel. Seul `messageCollectif` en produit. */
export type MessageCollectif = {
  sujet: string;
  contenu: EmailContenu;
  /** Marqueur de type : il rend impossible de passer un message quelconque à `enqueueEmailListe`. */
  readonly collectif: true;
};

/**
 * Marque un message comme collectif — après l'avoir relu. **Lève** s'il porte un jeton personnel :
 * c'est une erreur de programmation, pas un incident d'exploitation, et elle doit se voir au test
 * plutôt que dans la boîte de réception de quatre-vingts personnes.
 */
export function messageCollectif(message: { sujet: string; contenu: EmailContenu }): MessageCollectif {
  const jeton = jetonPersonnelDans(message.contenu);
  // Le **chemin** du lien fautif, pas le lien : le message part dans le journal du conteneur
  // (voir `cheminSansJeton`), et un jeton d'invitation vaut un mot de passe de quatre mois.
  if (jeton !== null) throw new Error(`${ERREUR_JETON_PERSONNEL} (chemin en cause : ${cheminSansJeton(jeton)})`);
  return { sujet: message.sujet, contenu: message.contenu, collectif: true };
}

/**
 * Envoie **un** message à l'adresse de liste du club. Même file d'envoi que le reste
 * (`enqueueEmail`) : les tentatives, l'espacement et le mode fichier de développement ne changent
 * pas — seul le nombre de destinataires change, et c'est tout l'objet du chantier.
 *
 * L'adresse arrive en argument : ce module ne lit pas les réglages, il ne sait qu'expédier. C'est
 * `notifications/preferences.ts` qui décide (`modeEnvoiDans`) et qui fournit l'adresse.
 */
export function enqueueEmailListe(adresse: string, message: MessageCollectif, ref: string, onDone?: (err: Error | null) => void): void {
  enqueueEmail({ to: adresse, sujet: message.sujet, contenu: message.contenu, ref }, onDone);
}
