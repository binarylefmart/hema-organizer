import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { baseUrl } from "@/lib/env";
import { DUREE_SESSION_LONGUE_MS, SESSION_COOKIE } from "@/lib/constants";
import { clientIp, userAgent } from "@/lib/request-info";
import { generateToken, hashToken, isValidTokenFormat } from "./tokens";
import { fermerElevation, ouvrirElevation } from "./elevation";

/**
 * Sessions serveur : jeton opaque dans un cookie httpOnly, hash SHA-256 en base. Une session dure
 * **12 h glissantes**, « Rester connecté » ou non : l'option ne décide plus que de la survie du
 * cookie à la fermeture du navigateur.
 */

/**
 * En dessous de cet écart, on ne réécrit pas l'échéance : sur une session de 12 h, repousser de
 * quelques minutes ne change rien pour la personne et coûterait une écriture en base à chaque geste.
 */
const MARGE_PROLONGATION_MS = 30 * 60 * 1000;

/**
 * **La fenêtre glissante, en une seule fonction.** Rend la nouvelle échéance si elle vaut une écriture,
 * `null` sinon — et c'est tout : elle ne touche ni à la base ni aux cookies, pour que les deux endroits
 * qui font glisser une session (`touchSession` ici, `getCurrentUser` à chaque requête) posent **la même**
 * question. Elle l'a été recopiée une fois, et la copie avait perdu l'exemption des sessions d'avant la
 * migration.
 */
export function echeanceProlongee(session: { expiresAt: Date; origine: string | null }): Date | null {
  /*
   * **Une session d'avant la migration ne se prolonge pas.**
   *
   * `AuthSession.origine` est NULL pour les sessions ouvertes avant `20260929180000_origine_session` : la
   * migration n'a rien rempli, et c'est le bon choix — on ne sait pas par où ces sessions-là sont entrées.
   * Conséquence assumée : elles sont valables, mais **comptées nulle part**, invisibles du plafond de
   * 3 appareils du lien personnel (`verifierAppareils`, src/lib/invitations.ts).
   *
   * Ce qui ne l'était pas : cette exemption n'avait **aucune borne**. Chaque geste dans l'application
   * repoussant l'échéance de 12 h, une session d'avant le déploiement utilisée une fois par jour ne mourait
   * jamais — un appareil qui ne compte pas, indéfiniment, c'est-à-dire exactement la fuite que le plafond
   * existe pour fermer. Le schéma, ce fichier et les tests disent tous « pendant leurs **dernières
   * heures** » : elles s'éteignent donc à leur échéance d'origine, au plus douze heures après le
   * déploiement. La personne rouvre alors son lien (ou se connecte), ce qui pose enfin une origine.
   *
   * **On ne remplit surtout pas la colonne ici, ni avec `"lien"` ni avec autre chose** : ce serait
   * faire compter comme appareils du lien des sessions ouvertes au mot de passe — le bug corrigé,
   * où trois connexions dans la journée faisaient révoquer le lien à la première ouverture d'email.
   */
  if (session.origine === null) return null;
  // Toutes les sessions durent la même chose : il n'y a plus de « longue » à distinguer. « Rester
  // connecté » ne décide plus que de la survie du cookie à la fermeture du navigateur, pas de la
  // durée de la session.
  const nouvelle = new Date(Date.now() + DUREE_SESSION_LONGUE_MS);
  if (nouvelle.getTime() - session.expiresAt.getTime() < MARGE_PROLONGATION_MS) return null;
  return nouvelle;
}

function cookieOptions(maxAgeSeconds?: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: baseUrl().startsWith("https://"),
    path: "/",
    ...(maxAgeSeconds ? { maxAge: maxAgeSeconds } : {}),
  };
}

/**
 * **Par où la session est entrée.** Deux portes seulement, et il faut le dire à la création :
 * `"lien"` = lien personnel `/invitation/<jeton>` (y compris le lien collé sur `/connexion` depuis
 * l'application installée, qui passe par la même fonction), `"mot-de-passe"` = email + mot de passe,
 * avec ou sans code 2FA, avec ou sans réinitialisation juste avant.
 *
 * **Pourquoi une colonne de plus alors que `forte` existe :** la connexion n'élève jamais, donc
 * *toutes* les sessions naissent `forte = false` — celle du mot de passe comme celle du lien.
 * `forte` ne dit plus que « l'espace admin a été ouvert dans cette session », jamais par où l'on
 * est entré. Le plafond de 3 appareils du lien personnel, lui, a besoin exactement de cette
 * distinction : sans elle, trois connexions au mot de passe dans la même journée (le téléphone, le
 * portable, la tablette du club) faisaient révoquer le lien à la première ouverture d'email —
 * quelqu'un mis dehors pour un usage parfaitement ordinaire, et une alerte au bureau qui racontait
 * un partage de lien qui n'avait pas eu lieu. Voir `verifierAppareils` (src/lib/invitations.ts).
 *
 * Le paramètre est **obligatoire** exprès : une porte d'entrée qui s'ouvrirait sans se nommer
 * retomberait dans le silence qu'on vient de corriger, et le compilateur ne dirait rien.
 */
export type OrigineSession = "lien" | "mot-de-passe";

/**
 * `forte` = ouverte par mot de passe + code 2FA. La colonne garde la trace de la façon dont la
 * session s'est ouverte (elle se lit dans la liste des sessions et dans l'audit) — mais ce n'est
 * **plus elle qui ouvre l'administration** : c'est l'élévation, un cookie de session navigateur
 * posé ici même et qui tombe après 10 min sans activité (voir `src/lib/auth/elevation.ts`).
 *
 * D'où la durée : une session ouverte au mot de passe dure ce que dure n'importe quelle session
 * (12 h glissantes, « Rester connecté » ou non). Elle était autrefois bornée à 12 h *fixes* parce
 * qu'elle *était* l'accès administrateur ; ce plafond sans prolongation vit désormais sur
 * l'élévation seule, et un administrateur n'est plus déconnecté de l'application entière pour être
 * resté trop longtemps.
 *
 * **Et une connexion n'élève jamais**, même celle d'un administrateur qui vient de donner son mot
 * de passe et son code. Cette fonction ouvrait encore l'espace admin quand `forte` était vrai :
 * plus aucun appelant ne le demandait, mais tant que la porte était là, la règle ne tenait qu'à
 * leur discipline. L'élévation se prend en **un seul endroit**, `renforcerSessionCourante`, là où
 * l'on redemande les deux preuves exprès.
 */
export async function createSession(userId: string, remember: boolean, origine: OrigineSession, forte = false): Promise<void> {
  const token = generateToken();
  const duree = DUREE_SESSION_LONGUE_MS;
  await db.authSession.create({
    data: {
      userId,
      forte,
      origine,
      reauthAt: forte ? new Date() : null,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + duree),
      // Le choix « Rester connecté » se garde : `touchSession` en a besoin et ne peut pas relire le
      // `maxAge` d'un cookie (voir la colonne dans `prisma/schema.prisma`).
      persistant: remember,
      ip: await clientIp(),
      userAgent: await userAgent(),
    },
  });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, cookieOptions(remember ? DUREE_SESSION_LONGUE_MS / 1000 : undefined));
}

/**
 * **Repose le cookie de session** quand « Rester connecté » était coché, et fait glisser l'échéance au
 * passage. Appelée depuis les server actions, les seuls endroits où l'écriture d'un cookie est permise.
 *
 * Le glissement lui-même n'a plus besoin d'elle : il se fait à **chaque requête**, dans `getCurrentUser`
 * (voir `echeanceProlongee`). C'est ce qui rend la session courte vivable — quelqu'un qui remplit son
 * planning pendant deux heures ne se fait pas éjecter au milieu parce qu'il s'est connecté onze heures
 * plus tôt. Tant que cette fonction en était le seul lieu, la promesse « chaque geste repousse
 * l'échéance » ne valait que pour cinq actions sur toute l'application : lire des pages pendant onze
 * heures puis cocher une présence à la douzième ne repoussait rien, et la personne était mise dehors au
 * milieu d'un geste.
 */
export async function touchSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!isValidTokenFormat(token)) return;
  const tokenHash = hashToken(token);
  const session = await db.authSession.findUnique({ where: { tokenHash } });
  // `forte` ne raccourcit plus la session : le plafond de 12 h vit sur l'élévation, pas ici. Une
  // session d'administrateur se prolonge donc comme les autres — il n'est plus mis dehors de
  // l'application entière parce qu'il a ouvert les réglages ce matin.
  if (!session) return;
  // Une session morte ne se prolonge pas. En pratique `getCurrentUser` l'a déjà supprimée avant
  // qu'on arrive ici ; mais prise isolément, la fonction ressuscitait une session expirée — et
  // c'est le genre de détail sur lequel on ne veut pas parier au prochain appelant.
  if (session.expiresAt.getTime() < Date.now()) return;
  /*
   * **Le cookie ne reçoit une échéance que si « Rester connecté » était coché**.
   *
   * Deux choses se confondaient ici. La **durée de la session** vit en base (`expiresAt`) et glisse de
   * douze heures à chaque geste ; la **persistance du cookie** est un choix de la personne, et l'écran le
   * lui promet : « ça ne survit pas à la fermeture du navigateur ». Or cette ligne reposait **toujours**
   * un `maxAge` de douze heures.
   *
   * Le scénario, sur l'ordinateur d'un ami : on se connecte en laissant la case décochée, on coche deux
   * présences. La première ne passe pas la marge de trente minutes et n'écrit rien ; la seconde, trente-
   * cinq minutes plus tard, passe — et le cookie repart persistant. On ferme le navigateur, l'ami le
   * rouvre le lendemain : la session est là, et elle se reprolonge à chaque geste. La seule case qu'on
   * pouvait cocher pour se protéger d'un appareil prêté devenait inopérante dès qu'on utilisait
   * l'application plus d'une demi-heure.
   *
   * Sans échéance, le cookie de session vit déjà le temps du navigateur : il n'y a rien à réécrire dans ce
   * cas, et c'est pour ça qu'on ne repose rien quand la case était décochée.
   */
  /*
   * **L'exemption des sessions d'avant la migration vaut pour le cookie comme pour l'échéance** (voir
   * `echeanceProlongee`) : une session qui n'a pas le droit de glisser ne se réancre pas davantage dans le
   * navigateur. Elle doit s'éteindre à son terme d'origine, au plus douze heures après le déploiement.
   */
  if (session.origine === null) return;
  if (!session.persistant) return;
  /*
   * L'échéance est presque toujours fraîche en arrivant ici — `getCurrentUser` l'a fait glisser en rendant
   * la page d'où part ce geste. On la recalcule quand même : cette fonction est aussi appelée depuis des
   * actions atteintes sans rendu préalable, et c'est une lecture, pas une requête.
   */
  const echeance = echeanceProlongee(session);
  if (echeance) await db.authSession.update({ where: { tokenHash }, data: { expiresAt: echeance } });
  jar.set(SESSION_COOKIE, token, cookieOptions(DUREE_SESSION_LONGUE_MS / 1000));
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (isValidTokenFormat(token)) {
    await db.authSession.deleteMany({ where: { tokenHash: hashToken(token) } });
  }
  jar.set(SESSION_COOKIE, "", { ...cookieOptions(), maxAge: 0 });
  // L'élévation ne survit jamais à la session qui la portait : elle est de toute façon liée à son
  // identifiant, mais on ne laisse pas traîner un cookie qui ne vaut plus rien.
  await fermerElevation();
  /*
   * **Le cookie de passage du lien personnel s'en va avec la session**. Il porte le jeton en clair
   * (chiffré, mais lisible par le serveur) le temps que l'écran de bienvenue offre « Copier mon
   * lien » : sur un appareil partagé, le laisser vivre ses quinze minutes après un départ n'a aucun
   * intérêt et tend une clé au suivant. L'import est dynamique pour ne pas nouer un cycle
   * (lien-personnel → invitations → ce module).
   */
  const { oublierLienPersonnel } = await import("@/lib/lien-personnel");
  await oublierLienPersonnel();
  /*
   * **Les trois cookies de parcours s'en vont aussi**.
   *
   * `hema_2fa` porte l'identité de qui vient de donner son mot de passe, en attente de son code ;
   * `hema_codes` les codes de secours fraîchement engendrés ; `hema_activation` le secret TOTP
   * provisoire. Tous les trois sont signés et chiffrés, tous les trois valent dix minutes — et aucun
   * n'était effacé par la déconnexion. Sur un appareil partagé, celui du milieu est le plus cher :
   * `hema_2fa` se convertit en session de douze heures d'un appui sur « Plus tard », sans mot de passe.
   *
   * On les efface donc ici, comme le cookie de passage du lien personnel juste au-dessus, et pour la
   * même raison : on ne laisse pas une preuve d'identité derrière soi en partant.
   */
  const { fermerAttente2fa, fermerAffichageCodes } = await import("./deux-fa");
  await fermerAttente2fa();
  await fermerAffichageCodes();
  const { fermerReglage2fa } = await import("./acces-admin");
  await fermerReglage2fa();
}

/** Révoque toutes les sessions d'un utilisateur (changement de mot de passe, admin). */
export async function revokeAllSessions(userId: string, exceptCurrent = false): Promise<number> {
  let keep: string | null = null;
  if (exceptCurrent) {
    const jar = await cookies();
    const token = jar.get(SESSION_COOKIE)?.value;
    if (isValidTokenFormat(token)) keep = hashToken(token);
  }
  const res = await db.authSession.deleteMany({
    where: { userId, ...(keep ? { NOT: { tokenHash: keep } } : {}) },
  });
  return res.count;
}

/** Supprime les sessions expirées (appelé par le cron d'entretien). */
export async function purgeExpiredSessions(): Promise<number> {
  const res = await db.authSession.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return res.count;
}

/**
 * **Élève** la session en cours : la personne vient de redonner son mot de passe et son code à usage
 * unique — à la fin du réglage de l'accès administrateur (`/admin/activer`), ou depuis le bouton
 * « Se connecter en tant qu'administrateur ». L'espace admin s'ouvre pour 12 h au plus, et se
 * referme de lui-même après 10 min sans activité dans l'espace admin.
 *
 * La session, elle, **ne bouge pas** : même ligne, même appareil, même échéance. Sortir de l'espace
 * admin ne déconnecte donc de rien — on redescend au rang de membre, ce qui est précisément ce
 * qu'une élévation doit savoir faire.
 */
export async function renforcerSessionCourante(sessionId: string): Promise<void> {
  await db.authSession.update({ where: { id: sessionId }, data: { forte: true, reauthAt: new Date() } });
  await ouvrirElevation(sessionId);
}

/**
 * **Referme l'espace admin** sans toucher à la session : bouton « Quitter l'espace admin ». La
 * colonne `forte` repasse à faux pour que la liste des sessions dise la vérité, et le cookie
 * d'élévation s'efface. La personne reste connectée, avec ses droits de membre et d'encadrant.
 */
export async function abaisserSessionCourante(sessionId: string): Promise<void> {
  await db.authSession.update({ where: { id: sessionId }, data: { forte: false, reauthAt: null, elevationVueLe: null } }).catch(() => {});
  await fermerElevation();
}

/** Marque la session courante comme ré-authentifiée (code 2FA vérifié à l'instant). */
export async function marquerReauth(sessionId: string): Promise<void> {
  await db.authSession.update({ where: { id: sessionId }, data: { reauthAt: new Date() } }).catch(() => {});
}
