import { argon2id, hash, verify, type HashOptions } from "argon2";

/** Hachage argon2id (paramètres OWASP : 19 Mio, 2 itérations, parallélisme 1). */
const OPTIONS: HashOptions & { raw?: false } = {
  type: argon2id,
  memoryCost: 19 * 1024,
  timeCost: 2,
  parallelism: 1,
  raw: false,
};

export async function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(hashValue: string | null | undefined, password: string): Promise<boolean> {
  if (!hashValue) {
    // Compte sans mot de passe : on consomme quand même du temps pour ne pas trahir l'état du compte
    await hash(password, OPTIONS);
    return false;
  }
  try {
    return await verify(hashValue, password);
  } catch {
    return false;
  }
}
