/**
 * Remise en état du compte d'administration (`contact@…`), seul compte à mot de passe du portail.
 *
 * Les captures et le test « mot de passe oublié » le font passer par la première connexion
 * (mot de passe provisoire, 2FA à configurer) : ils **doivent** le rétablir ensuite, sinon
 * plus personne ne peut se connecter à l'application de développement sans relancer le seed.
 *
 * **Les deux fonctions qui écrivent un accès connu sont gardées** : elles posent le mot de passe et
 * le secret TOTP publiés dans ce dépôt, et rien n'empêchait de les lancer sur une vraie base —
 * elles n'avaient aucun contrôle, à la différence du jeu de démonstration.
 */
import { db } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth/password";
import { chiffrer } from "../src/lib/crypto";
import { hacherCodeSecours } from "../src/lib/auth/codes-secours";
import { COMPTES, DEMO_CODES_SECOURS, DEMO_MOT_DE_PASSE, DEMO_TOTP_SECRET } from "./comptes";
import { exigerBaseDeDemonstration } from "./garde-demonstration";

/** État « première connexion » : mot de passe provisoire, aucune 2FA configurée. */
export async function etatPremiereConnexion(): Promise<void> {
  await exigerBaseDeDemonstration();
  await db.user.update({
    where: { email: COMPTES.admin },
    data: { totpSecret: null, totpActiveAt: null, codesSecours: null, doitChangerMotDePasse: true, passwordHash: await hashPassword(DEMO_MOT_DE_PASSE) },
  });
  await db.authSession.deleteMany({ where: { user: { email: COMPTES.admin } } });
}

/** État courant du seed : mot de passe connu, 2FA active, codes de secours fixes. */
export async function restaurerCompteAdministration(): Promise<void> {
  await exigerBaseDeDemonstration();
  await db.user.update({
    where: { email: COMPTES.admin },
    data: {
      passwordHash: await hashPassword(DEMO_MOT_DE_PASSE),
      doitChangerMotDePasse: false,
      totpSecret: chiffrer(DEMO_TOTP_SECRET),
      totpActiveAt: new Date("2026-09-01T10:00:00Z"),
      codesSecours: JSON.stringify(DEMO_CODES_SECOURS.map(hacherCodeSecours)),
    },
  });
  await db.authSession.deleteMany({ where: { user: { email: COMPTES.admin } } });
}

export type InstantaneCompte = {
  passwordHash: string | null;
  doitChangerMotDePasse: boolean;
  totpSecret: string | null;
  totpActiveAt: Date | null;
  codesSecours: string | null;
};

/**
 * Photographie les accès du compte d'administration **tels qu'ils sont**, avant qu'une scène de
 * capture ou un test ne les bouscule. À restaurer avec `restaurerInstantane` : c'est la seule façon
 * de rendre à l'utilisateur le mot de passe et la 2FA qu'il a choisis lui-même.
 */
export async function instantaneCompteAdministration(): Promise<InstantaneCompte | null> {
  return db.user.findUnique({
    where: { email: COMPTES.admin },
    select: { passwordHash: true, doitChangerMotDePasse: true, totpSecret: true, totpActiveAt: true, codesSecours: true },
  });
}

export async function restaurerInstantane(instantane: InstantaneCompte | null): Promise<void> {
  if (!instantane) return;
  await db.user.update({ where: { email: COMPTES.admin }, data: instantane });
  await db.authSession.deleteMany({ where: { user: { email: COMPTES.admin } } });
}
