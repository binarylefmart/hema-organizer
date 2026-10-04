import { db } from "./db";
import { formatDateHeure } from "./dates";
import { baseUrl } from "./env";
import { identite } from "./identite";
import { CLES, getSetting, setSetting } from "./settings";

/**
 * Alertes de sécurité envoyées aux administrateurs actifs (réglable dans Administration → Paramètres) :
 * - un lien personnel jugé suspect (ouvert à un rythme anormal) ou saturé d'appareils ;
 * - trop de liens inconnus essayés dans l'heure (SEUIL_LIENS_INCONNUS_PAR_HEURE), une alerte par heure au plus.
 * Déduplication via NotificationLog (dedupKey), comme les rappels.
 *
 * **Deux canaux, une seule décision** : l'email raconte (qui, depuis quelle adresse, à quelle heure),
 * la notification sur le téléphone se contente de prévenir et de dire où regarder — voir
 * `src/lib/notifications/securite.ts`, qui porte la règle et les textes. Le réglage `alertesSecurite`
 * gouverne les deux ensemble : il n'y a pas d'interrupteur par canal pour ces messages-là.
 *
 * **Ces alertes ne passent pas par le panneau « Notifications » (Gestion → Réglages) et ne sont pas
 * désactivables par l'équipe** : elles y sont affichées en lecture seule, « toujours envoyées ».
 * Ne jamais ajouter ici d'appel à `notificationActive()` (voir src/lib/notifications/preferences.ts).
 * Seul le réglage technique historique `alertesSecurite` (Administration → Paramètres, ADMIN) les coupe.
 */
export const SEUIL_LIENS_INCONNUS_PAR_HEURE = 20;

export async function alertesActivees(): Promise<boolean> {
  return (await getSetting(CLES.alertesSecurite)) !== "0";
}

export async function setAlertesActivees(actives: boolean): Promise<void> {
  await setSetting(CLES.alertesSecurite, actives ? "1" : "0");
}

/**
 * Destinataires des alertes : tous les comptes **du bureau** actifs, **y compris le compte de connexion
 * du portail** (`service: true`) — c'est la boîte de l'association, elle doit rester prévenue. Ne pas
 * l'exclure ici.
 *
 * **Le bureau se lit sur `estAdmin`, plus sur le rôle** : « administrateur » est devenu un
 * supplément au rôle de base, et `role` ne vaut plus jamais `"ADMIN"`. La requête d'avant (`where:
 * { role: "ADMIN" }`) rendait donc **zéro ligne** — et cette fonction-ci ne lève rien quand elle
 * est vide : `envoyerAlerte` se contente de rendre `false`, la clé de journal reste libre, et plus
 * aucune alerte de sécurité n'arrivait à personne, sans une trace nulle part.
 */
async function admins(): Promise<Array<{ id: string; email: string | null }>> {
  return db.user.findMany({ where: { estAdmin: true, actif: true }, select: { id: true, email: true } });
}

/**
 * `corpsPush` est le texte de l'écran verrouillé : il dit **ce qui s'est passé et où regarder**, et
 * ne reprend donc aucun des détails que `paragraphes` donne à l'email (nom, adresse IP, horaire).
 *
 * **La clé de journal est posée avant l'envoi**, par `journaliser`. Elle ne l'était pas : on
 * regardait si la clé existait, on envoyait, puis on l'écrivait. Entre les deux, une rafale de
 * liens inconnus (c'est justement ce que cette alerte surveille) fait entrer plusieurs requêtes à
 * la fois — toutes lisaient « pas encore d'alerte », toutes écrivaient à l'équipe, et le `create`
 * des perdantes remontait une P2002 **jusque dans l'action de connexion**, qui répondait une erreur
 * à quelqu'un dont le seul tort était d'avoir recopié son lien de travers.
 *
 * `journaliser` fait les deux à la fois : il tranche (la contrainte d'unicité de la colonne décide) et
 * il n'échappe jamais.
 */
async function envoyerAlerte(dedupKey: string, sujet: string, paragraphes: string[], corpsPush: string): Promise<boolean> {
  if (!(await alertesActivees())) return false;
  const equipe = await admins();
  // Un administrateur sans adresse email (l'adresse est facultative) est écarté de l'email, mais
  // **pas de la notification** : le téléphone, lui, n'a pas besoin d'adresse (voir plus bas).
  // Le garde-fou porte bien sur l'email : si plus personne n'a d'adresse, il n'y a plus d'alerte du
  // tout — c'est la clé de journal de l'email qui tient l'idempotence des deux canaux.
  const destinataires = equipe.map((a) => a.email).filter((e): e is string => e !== null);
  // Personne à qui écrire : la clé reste libre, une adresse renseignée plus tard vaudra alerte.
  if (destinataires.length === 0) return false;
  // Le point de bascule : la première requête qui pose la clé est la seule qui envoie.
  const { journaliser } = await import("./notifications/journal");
  if (!(await journaliser({ type: "ALERTE", canal: "EMAIL", dedupKey, statut: "ENVOYE" }))) return false;
  const { enqueueEmail } = await import("./email/mailer");
  // Le pied de l'email nomme l'application : ce nom est réglable (voir `src/lib/identite.ts`).
  const club = await identite();
  const contenu = {
    titre: "Alerte de sécurité",
    paragraphes: [...paragraphes, `Journal d'audit : ${baseUrl()}/admin/audit`],
    boutons: [{ label: "Ouvrir le journal d'audit", url: `${baseUrl()}/admin/audit` }],
    piedDePage: [`Message automatique de ${club.nomCourt}. Les alertes se règlent dans Administration → Paramètres.`],
  };
  /*
   * **Et un échec d'envoi libère la clé**. L'invariant était tenu à moitié : la clé était bien
   * posée avant l'envoi, mais rien ne la rendait si le SMTP refusait — la ligne de journal disait «
   * envoyé » et l'alerte était perdue **définitivement**, puisque chaque alerte a une clé qui ne
   * revient jamais (elle porte l'identifiant du lien, de la session ou de l'appareil qui l'a
   * déclenchée). C'est le pire endroit du dossier pour ce silence : on parle de la révocation d'un
   * lien jugé suspect, et le bureau ne l'apprenait nulle part ailleurs.
   *
   * Une seule clé pour toute l'équipe (c'est une alerte du club, pas un message personnel) : on ne
   * la libère donc qu'**une fois**, au premier échec — même geste et même raison que
   * `alerterEquipeParEmail` (`src/lib/notifications/seances.ts`), dont ceci est la copie exacte.
   */
  const { marquerEchec } = await import("./notifications/journal");
  let liberee = false;
  for (const to of destinataires)
    enqueueEmail({ to, sujet: `⚠️ ${sujet}`, contenu, ref: `alerte_${dedupKey}` }, (err) => {
      if (!err || liberee) return;
      liberee = true;
      void marquerEchec(dedupKey, err.message);
    });
  // Le même signal sur les téléphones de l'équipe, après l'email et jamais à sa place : l'import est
  // différé comme celui du mailer, et `alerterAdminsParPush` n'échoue jamais — une panne du service
  // de push ne doit ni retarder l'alerte par email, ni faire échouer la révocation qui l'a déclenchée.
  const { alerterAdminsParPush } = await import("./notifications/securite");
  await alerterAdminsParPush(equipe, dedupKey, corpsPush);
  return true;
}

/** Lien révoqué automatiquement (SUSPECT ou APPAREILS) : alerte immédiate, une par lien. */
export async function alerterLienRevoque(args: {
  invitationId: string;
  motif: "SUSPECT" | "APPAREILS";
  email: string | null;
  ip: string;
  /**
   * **Un lien de remplacement est-il vraiment parti ?** La garde le sait ; l'alerte ne le savait
   * pas, et concluait « son nouveau lien est déjà parti, elle n'a rien d'autre à faire que de
   * l'ouvrir » — faux dès que la fiche n'a pas d'adresse ou que la période est close, c'est- à-dire
   * précisément quand la personne est dehors et a besoin du bureau. Le conseil disait au bureau de
   * ne rien faire, dans le seul cas où il devait agir.
   */
  remplace: boolean;
}): Promise<boolean> {
  // Un lien n'existe que pour une adresse renseignée ; la tournure sans adresse ne sert que de garde-fou
  const qui = args.email ?? "un compte sans adresse email";
  /*
   * **Dire ce qui s'est passé, pas ce qu'on en déduit**. Le texte annonçait un lien « utilisé sur
   * plus de 3 appareils » alors qu'on comptait en réalité toutes les sessions ouvertes de la
   * personne, connexions par mot de passe comprises : le bureau lisait un partage de lien là où le
   * lien venait d'être ouvert une seule fois. La règle compte désormais les seules sessions
   * ouvertes par le lien (`verifierAppareils`), et la phrase raconte exactement ce qui a été mesuré
   * — un appareil de plus alors que trois étaient déjà connectés **avec ce lien**.
   */
  const detail =
    args.motif === "SUSPECT"
      ? "ouvert un nombre anormal de fois en une heure (robot ou lien diffusé)"
      : "ouvert depuis un appareil de plus alors que 3 appareils étaient déjà connectés avec lui";
  // Trois appareils connectés en même temps, ce n'est pas la preuve d'un partage : c'est ce qui
  // justifie de regarder. On ne demande donc pas au bureau de sévir, mais de vérifier.
  const conseil =
    args.motif === "SUSPECT"
      ? "Si cela se répète, vérifie avec la personne qu'elle n'a pas partagé son lien, et régénère-le depuis sa fiche."
      : args.remplace
        ? "Vérifie avec la personne : elle utilise peut-être simplement beaucoup d'appareils (téléphone, ordinateur, tablette du club). Son nouveau lien est déjà parti, elle n'a rien d'autre à faire que de l'ouvrir."
        : "Vérifie avec la personne : elle utilise peut-être simplement beaucoup d'appareils (téléphone, ordinateur, tablette du club). **Aucun lien de remplacement n'a pu partir** : elle est dehors tant que tu ne lui en renvoies pas un depuis sa fiche, ou qu'elle n'entre pas par son mot de passe.";
  return envoyerAlerte(
    `alerte_lien_${args.invitationId}`,
    `Lien personnel de ${qui} révoqué (${args.motif.toLowerCase()})`,
    [
      // Sans adresse, aucun lien de remplacement n'a pu partir : le dire, sinon le bureau croit la
      // personne servie et ne l'aide pas.
      `Le lien personnel de ${qui} a été ${detail}. Il a été révoqué${args.email ? " et un nouveau lien a été envoyé à la personne" : " ; faute d'adresse email, aucun lien de remplacement n'a pu lui être envoyé"}.`,
      `Dernière ouverture depuis l'adresse ${args.ip}, le ${formatDateHeure(new Date())}.`,
      conseil,
    ],
    // Ni le nom, ni le motif, ni l'adresse IP : de qui il s'agit se lit dans l'application.
    "Un lien d'accès a été révoqué automatiquement. Ouvre le journal d'audit.",
  );
}

/**
 * Liens inconnus : compte les tentatives de l'heure courante dans le journal ; au-delà du seuil,
 * une alerte (une seule par heure). Retourne le nombre de tentatives dans l'heure.
 */
export async function surveillerLiensInconnus(now = new Date()): Promise<number> {
  const debutHeure = new Date(now);
  debutHeure.setMinutes(0, 0, 0);
  const n = await db.auditLog.count({ where: { action: "invitation.lien_inconnu", date: { gte: debutHeure } } });
  if (n >= SEUIL_LIENS_INCONNUS_PAR_HEURE) {
    const cle = `alerte_liens_inconnus_${debutHeure.toISOString().slice(0, 13)}`;
    await envoyerAlerte(
      cle,
      `${n} liens d'accès inconnus essayés en une heure`,
      [
        `${n} adresses /invitation/… invalides ont été appelées depuis ${formatDateHeure(debutHeure)} : quelqu'un cherche probablement des liens au hasard.`,
        "Les adresses concernées sont limitées automatiquement (8 essais par heure et par IP). Si le volume persiste, bloque les IP au niveau de Nginx Proxy Manager / fail2ban.",
      ],
      // Même registre que l'autre alerte, et pas davantage : le décompte se lit dans l'application.
      "Des liens d'accès inconnus ont été essayés en nombre. Ouvre le journal d'audit.",
    );
  }
  return n;
}

/** Rétention du journal d'audit (jours), réglable ; défaut 365. */
export async function getRetentionAuditJours(): Promise<number> {
  const v = Number(await getSetting(CLES.auditRetentionJours));
  return Number.isInteger(v) && v >= 30 ? v : 365;
}

export async function setRetentionAuditJours(jours: number): Promise<void> {
  await setSetting(CLES.auditRetentionJours, String(jours));
}

/** Entretien : supprime les entrées d'audit plus anciennes que la rétention. */
export async function purgerAudit(now = new Date()): Promise<number> {
  const jours = await getRetentionAuditJours();
  const res = await db.auditLog.deleteMany({ where: { date: { lt: new Date(now.getTime() - jours * 86_400_000) } } });
  return res.count;
}

/**
 * Une cellule de CSV, **neutralisée pour les tableurs**.
 *
 * Excel et LibreOffice exécutent le contenu d'une cellule qui commence par `=`, `+`, `-`, `@` ou
 * une tabulation : c'est l'injection de formule. Les colonnes de ces exports reprennent du texte
 * saisi dans l'application (une cible d'audit, un thème, un nom d'appareil) — il suffirait qu'une
 * personne nomme quelque chose `=...` pour qu'un administrateur ouvrant le fichier déclenche autre
 * chose qu'une lecture. L'apostrophe de tête est la parade d'usage : le tableur affiche le texte
 * et n'exécute rien.
 */
export function celluleCsv(v: string | null | undefined): string {
  const s = v ?? "";
  const neutre = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[";\n\r]/.test(neutre) ? `"${neutre.replace(/"/g, '""')}"` : neutre;
}

/** CSV du journal d'audit (fonction pure, testée) : date ISO, acteur, action, cible, détails, IP. */
export function csvAudit(lignes: Array<{ date: Date; acteurEmail: string; action: string; cible: string | null; details: string | null; ip: string | null }>): string {
  const cellule = (v: string | null | undefined) => celluleCsv(v);
  const entete = ["date", "acteur", "action", "cible", "details", "ip"].join(";");
  return [entete, ...lignes.map((l) => [l.date.toISOString(), l.acteurEmail, l.action, l.cible, l.details, l.ip].map(cellule).join(";"))].join("\r\n") + "\r\n";
}
