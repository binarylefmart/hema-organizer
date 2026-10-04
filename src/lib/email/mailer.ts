import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import nodemailer, { type Transporter } from "nodemailer";
import { bequilleDevActive, env, expediteur, isProduction } from "@/lib/env";
import { identite } from "@/lib/identite";
import { renderEmailHtml, renderEmailTexte, type EmailContenu } from "./templates/layout";

/**
 * Envoi d'emails via SMTP (Nodemailer). Hors production et sans SMTP_HOST (développement), les emails
 * sont écrits dans ./previews/emails/ pour pouvoir les prévisualiser ; en production, un SMTP est exigé.
 *
 * Les envois passent par une file simple espacée (ESPACEMENT_MS) avec 3 tentatives
 * et backoff, sans jamais bloquer l'appelant.
 *
 * La file vit **en mémoire** : un arrêt du serveur est donc traité comme un échec d'envoi, pour que
 * chaque appelant libère sa clé de déduplication (voir « L'arrêt du serveur est un échec d'envoi »,
 * plus bas).
 */
export type EmailAEnvoyer = {
  to: string;
  sujet: string;
  contenu: EmailContenu;
  /** Identifiant lisible pour les journaux / fichiers d'aperçu */
  ref?: string;
};

const ESPACEMENT_MS = 400;
const TENTATIVES = 3;

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  // Développement, tests et captures : on force l'écriture dans previews/emails même si un SMTP est configuré.
  // La béquille est neutralisée en production (voir bequilleDevActive) : là-bas, seul SMTP compte.
  if (bequilleDevActive("EMAIL_MODE_FICHIER")) return null;
  const e = env();
  if (!e.SMTP_HOST) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: e.SMTP_HOST,
      port: e.SMTP_PORT,
      secure: e.SMTP_PORT === 465,
      auth: e.SMTP_USER ? { user: e.SMTP_USER, pass: e.SMTP_PASS } : undefined,
      /*
       * **Des délais courts, explicites.** Par défaut, nodemailer attend 2 min la connexion et
       * 10 min la réponse : un serveur SMTP muet immobilisait la file d'envoi pendant tout ce
       * temps, et les trois tentatives faisaient le reste. Dix secondes suffisent à un serveur en
       * bonne santé ; au-delà, mieux vaut un échec dans le journal qu'une attente invisible.
       */
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }
  return transporter;
}

/** Envoi direct (une tentative). Utilisé par la file et par les tests d'envoi de l'admin. */
export async function sendEmailNow(mail: EmailAEnvoyer): Promise<{ ok: true; mode: "smtp" | "fichier"; chemin?: string }> {
  /*
   * **Le nom du club se lit ici, et une seule fois par envoi.** Le facteur est le passage obligé de
   * tous les emails, et le seul à être asynchrone : les gabarits restent des fonctions pures, et
   * personne d'autre n'a à savoir que l'identité vit en base (voir `src/lib/identite.ts`).
   */
  const club = await identite();
  const html = renderEmailHtml(mail.contenu, club);
  const text = renderEmailTexte(mail.contenu, club);
  const t = getTransporter();
  if (!t) {
    // En production, pas de repli sur le disque : un SMTP manquant est une erreur de configuration, pas un mode de secours.
    if (isProduction()) throw new Error("SMTP non configuré (SMTP_HOST vide) : impossible d'envoyer un email en production.");
    const dir = path.join(process.cwd(), "previews", "emails");
    await mkdir(dir, { recursive: true });
    const nom = `${new Date().toISOString().replace(/[:.]/g, "-")}_${(mail.ref ?? "email").replace(/[^a-z0-9_-]/gi, "_")}`;
    await writeFile(path.join(dir, `${nom}.html`), html, "utf8");
    await writeFile(path.join(dir, `${nom}.txt`), `À : ${mail.to}\nObjet : ${mail.sujet}\n\n${text}`, "utf8");
    console.info(`[email] (mode fichier) → ${mail.to} : ${mail.sujet} — previews/emails/${nom}.html`);
    return { ok: true, mode: "fichier", chemin: path.join(dir, `${nom}.html`) };
  }
  await t.sendMail({ from: expediteur(club.nomCourt), to: mail.to, subject: mail.sujet, text, html });
  return { ok: true, mode: "smtp" };
}

type Tache = {
  mail: EmailAEnvoyer;
  onDone?: (err: Error | null) => void;
  /** Un envoi ne rend compte qu'**une fois** : la file ou le drain d'arrêt, jamais les deux. */
  rendu: boolean;
};

const file: Tache[] = [];
let enCours = false;
/**
 * Le message sorti de la file et confié au serveur SMTP : il n'est plus dans `file` et n'a pas encore
 * rendu compte. Sans cette référence, c'est exactement celui que l'arrêt oublierait.
 */
let tacheEnVol: Tache | null = null;

/**
 * Prévient l'appelant, **une fois et une seule**.
 *
 * Deux chemins y mènent — la fin des tentatives et le drain d'arrêt (`drainerFileALArret`) — et ils
 * peuvent se croiser : un message confié au SMTP à l'instant du signal est déclaré perdu par le
 * drain, puis la réponse du serveur arrive quand même si le processus vit encore un instant. Le
 * second compte rendu appellerait `marquerEchec` sur une clé déjà libérée et rendue à un autre
 * passage — donc ferait échouer l'envoi de quelqu'un d'autre.
 *
 * Le rappel est appelé sous `try` parce que c'est du code d'appelant : une exception y remontait
 * jusqu'à la boucle de `traiterFile`, qui s'arrêtait net avec `enCours` remis à faux — la file
 * gardait alors des messages que plus personne ne traitait et dont personne ne rendait compte. Un
 * rappel fautif ne peut pas emporter les messages des autres.
 */
function rendreCompte(tache: Tache, err: Error | null): boolean {
  if (tache.rendu) return false;
  tache.rendu = true;
  try {
    tache.onDone?.(err);
  } catch (e) {
    console.error(`[email] rappel de fin en échec → ${tache.mail.to}`, e);
  }
  return true;
}

/** Ajoute un email à la file d'envoi. Ne bloque jamais l'appelant. */
export function enqueueEmail(mail: EmailAEnvoyer, onDone?: (err: Error | null) => void): void {
  file.push({ mail, onDone, rendu: false });
  // À la première mise en file seulement : un module qui ne fait que rendre des aperçus n'a pas à
  // poser d'écoute sur les signaux du processus.
  installerDrainArret();
  void traiterFile();
}

async function traiterFile(): Promise<void> {
  if (enCours) return;
  enCours = true;
  try {
    while (file.length) {
      const tache = file.shift()!;
      tacheEnVol = tache;
      let derniereErreur: Error | null = null;
      for (let i = 0; i < TENTATIVES; i++) {
        try {
          await sendEmailNow(tache.mail);
          derniereErreur = null;
          break;
        } catch (e) {
          derniereErreur = e instanceof Error ? e : new Error(String(e));
          console.error(`[email] tentative ${i + 1}/${TENTATIVES} échouée → ${tache.mail.to}`, derniereErreur.message);
          await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
        }
      }
      tacheEnVol = null;
      rendreCompte(tache, derniereErreur);
      await new Promise((r) => setTimeout(r, ESPACEMENT_MS));
    }
  } finally {
    tacheEnVol = null;
    enCours = false;
  }
}

/* ───────────────────── L'arrêt du serveur est un échec d'envoi ─────────────────────
 *
 * **Le défaut.** Cette file vit en mémoire. Les neuf modules d'envoi posent leur clé de
 * déduplication **avant** d'appeler `enqueueEmail` — c'est la contrainte d'unicité qui tranche
 * entre deux passages simultanés — et comptent sur le rappel `(err) => void marquerEchec(cle, …)`
 * pour la libérer quand l'envoi casse. Un redémarrage (mise à jour de l'image, `docker compose
 * restart`, redéploiement dans Portainer) jetait la file **sans appeler un seul de ces rappels** :
 * les clés restaient `ENVOYE`, et les repassages prévus exactement pour ça (`tickEnvois`, chaque
 * minute) voyaient les clés et ne faisaient rien. Le récap du soir d'un cours, le rappel « tu n'as
 * pas répondu », l'alerte de sécurité d'un lien révoqué : perdus **définitivement**, avec
 * « envoyé » affiché dans l'espace admin.
 *
 * **Le remède.** Un message perdu à l'arrêt est un échec d'envoi comme un autre : on le déclare tel,
 * et chaque appelant libère sa propre clé par le chemin qu'il a déjà. Rien à changer chez les neuf,
 * et l'invariant du dossier (« la clé se pose avant l'envoi, tout envoi libère sa clé en cas
 * d'échec ») vaut enfin aussi pour l'extinction.
 *
 * **Le message en vol est déclaré perdu lui aussi**, alors qu'il a peut-être été accepté par le
 * serveur SMTP : dans ce cas sa clé est libérée pour rien et le passage suivant enverra un doublon.
 * C'est le compromis assumé partout dans ce dossier — le pire qui puisse arriver est un message de
 * trop, jamais un cours annoncé à personne — et il porte au plus **un** message par arrêt, la file
 * étant strictement séquentielle.
 *
 * **Ce que ce gestionnaire ne promet pas, et qu'il ne faut pas lui prêter.** Un `SIGKILL`, l'OOM
 * killer ou une coupure de courant n'exécutent aucun code : ces messages-là restent perdus, clé
 * posée. Et la libération est une écriture SQLite **lancée** au signal, pas attendue — `onDone` est
 * synchrone chez les neuf appelants (`void marquerEchec(…)`), et Next ferme le serveur puis appelle
 * `process.exit(0)` de son côté sans nous demander notre avis. En pratique l'écriture est locale et
 * se compte en millisecondes, et Next attend d'abord la fin des requêtes en cours ; rien ne le
 * garantit pour autant. Le remède à ce reste-là serait une file persistée en base — un autre
 * chantier, pas une ligne de plus ici.
 *
 * `beforeExit` n'est pas de la liste, et ce n'est pas un oubli : il ne se déclenche que sur une
 * boucle d'évènements vide — or une file non vide garde toujours un envoi ou son `setTimeout`
 * d'espacement en cours — et jamais sur un signal ni sur `process.exit`, c'est-à-dire jamais dans
 * les deux seuls cas qui nous occupent.
 */

/** Ce que lisent les appelants dans leur rappel d'échec, et le journal dans la colonne `erreur`. */
export const RAISON_ARRET_EMAIL = "arrêt du serveur : message perdu avant d'avoir été envoyé";

/**
 * Le sursis laissé aux libérations de clés avant de rendre la main au signal.
 *
 * On se renvoie le signal (`process.kill` sur soi-même) au lieu d'appeler `process.exit` : notre
 * écoute est un `once`, elle s'est donc déjà retirée, et le second signal retrouve le comportement
 * par défaut de Node — ou les autres écoutants, Next en tête, qui couperont eux-mêmes. Sans cette
 * relance, un processus dont nous serions le seul écoutant **ne mourrait plus de son `SIGTERM`** :
 * il suffit d'écouter un signal pour désarmer la terminaison par défaut, et « le serveur ne s'arrête
 * plus » serait un défaut bien pire que celui qu'on corrige. Le minuteur est `unref` : il ne retient
 * pas à lui seul un processus qui a fini son travail.
 */
const SURSIS_ARRET_MS = 500;

/**
 * Déclare perdus tous les messages en attente et rend leur nombre : le message en vol d'abord — il
 * était le premier de la file —, puis ceux qui n'ont pas encore été confiés au SMTP.
 *
 * Exportée pour que la contre-épreuve puisse rejouer l'arrêt sans envoyer de signal au processus de
 * test (`tests/unit/mailer-arret-file.test.ts`).
 */
export function drainerFileALArret(raison: Error = new Error(RAISON_ARRET_EMAIL)): number {
  const perdus = tacheEnVol ? [tacheEnVol, ...file] : [...file];
  file.length = 0;
  tacheEnVol = null;
  let rendus = 0;
  for (const tache of perdus) if (rendreCompte(tache, raison)) rendus += 1;
  return rendus;
}

/**
 * **L'écoute est globale, la file est locale au module** — et c'est toute la difficulté.
 *
 * Ce module est chargé par le runtime Next (server actions de `src/actions/*`, tâches planifiées),
 * qui recharge ses modules en développement : un `process.once` posé à chaque chargement empilerait
 * les écoutants (`MaxListenersExceededWarning` au onzième) et drainerait autant de fois. On garde
 * donc sur `globalThis` — même raison et même forme que le client Prisma de `src/lib/db.ts` — d'un
 * côté l'écoute, posée une seule fois, de l'autre la liste des drains, où **chaque instance du
 * module inscrit le sien** : sans cela l'écoute ne connaîtrait que la file de la première version
 * chargée, c'est-à-dire plus aucune de celles qui servent.
 */
type EtatArretEmails = { drains: Set<() => number>; ecoute: boolean };
const porteeArret = globalThis as unknown as { brgArretEmails?: EtatArretEmails };

let drainInscrit = false;

function installerDrainArret(): void {
  if (drainInscrit) return;
  drainInscrit = true;
  const etat = (porteeArret.brgArretEmails ??= { drains: new Set(), ecoute: false });
  etat.drains.add(() => drainerFileALArret());
  if (etat.ecoute) return;
  etat.ecoute = true;
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => {
      let perdus = 0;
      for (const drain of etat.drains) {
        try {
          perdus += drain();
        } catch (e) {
          // Une file qui refuse de se vider ne doit pas retenir l'arrêt : on le dit et on continue.
          console.error("[email] drain d'arrêt en échec", e);
        }
      }
      if (perdus > 0) {
        console.warn(`[email] arrêt (${signal}) : ${perdus} message(s) abandonné(s) avant l'envoi — leur clé de notification est libérée, le prochain passage réessaiera.`);
      }
      setTimeout(() => process.kill(process.pid, signal), SURSIS_ARRET_MS).unref();
    });
  }
}
