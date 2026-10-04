import { bequilleDevActive } from "../env";

/**
 * Limiteur de débit (fenêtre glissante), **persistant en base** (table RateLimit) : il survit aux redémarrages
 * et vaut pour l'instance unique de l'app. Clés : "<contexte>:<ip>", "<contexte>:<email>", "<contexte>:<jeton>".
 * Les tests unitaires utilisent un magasin en mémoire (`utiliserMagasinMemoire`).
 * En complément, côté Nginx Proxy Manager : limit_req sur /invitation/ et /connexion (voir docs/DEPLOIEMENT.md).
 */
export type RateLimitRule = { max: number; windowMs: number };

export const RATE_LIMITS = {
  login_ip: { max: 20, windowMs: 15 * 60 * 1000 },
  login_email: { max: 8, windowMs: 15 * 60 * 1000 },
  invitation_ip: { max: 30, windowMs: 15 * 60 * 1000 },
  /** Liens inconnus/invalides essayés depuis une même IP (recherche de jetons par un robot) */
  invitation_inconnue_ip: { max: 8, windowMs: 60 * 60 * 1000 },
  /** Ouvertures réussies d'un même lien (au-delà : lien jugé suspect, révoqué et remplacé) */
  invitation_token: { max: 12, windowMs: 60 * 60 * 1000 },
  /** Renouvellement automatique d'un lien expiré : une fois par jour et par personne */
  renouvellement_user: { max: 1, windowMs: 24 * 60 * 60 * 1000 },
  reset_ip: { max: 10, windowMs: 60 * 60 * 1000 },
  reset_email: { max: 3, windowMs: 60 * 60 * 1000 },
  totp_ip: { max: 15, windowMs: 15 * 60 * 1000 },
  totp_user: { max: 8, windowMs: 15 * 60 * 1000 },
  /** Réglage de l'accès administrateur (/admin/activer) : mêmes ordres de grandeur que la connexion */
  activation_ip: { max: 20, windowMs: 15 * 60 * 1000 },
  activation_user: { max: 10, windowMs: 15 * 60 * 1000 },
  unsubscribe_ip: { max: 20, windowMs: 60 * 60 * 1000 },
  /** Ouvertures de la page d'annulation par lien d'email (publique, sans connexion) : mêmes ordres de grandeur que /invitation */
  annulation_ip: { max: 30, windowMs: 15 * 60 * 1000 },
  /** Annulations effectives depuis un lien d'email, par porteur du jeton : le geste est rare, et lourd de conséquences */
  annulation_porteur: { max: 5, windowMs: 60 * 60 * 1000 },
  public_api_ip: { max: 60, windowMs: 60 * 1000 },
  /** Pages publiques de partage (/partage/…) : consultation sans connexion — une page ouverte se fait aspirer */
  partage_ip: { max: 60, windowMs: 5 * 60 * 1000 },
  /** Identifiants de partage inconnus depuis une même IP (balayage d'identifiants par un robot) */
  partage_inconnu_ip: { max: 20, windowMs: 60 * 60 * 1000 },
  /** Aperçu d'un lien collé (requête sortante déclenchée par un instructeur) : 20 par quart d'heure */
  apercu_lien_user: { max: 20, windowMs: 15 * 60 * 1000 },
  /** Images distantes servies par /api/image : généreux (une page en affiche plusieurs), mais borné */
  image_distante_user: { max: 300, windowMs: 15 * 60 * 1000 },
  /** Dépôt d'une affiche d'événement (écriture sur disque par un instructeur) : 15 par quart d'heure */
  affiche_televersement_user: { max: 15, windowMs: 15 * 60 * 1000 },
  /**
   * Import CSV de l'annuaire : lecture d'un fichier, décodage, puis une création de compte par
   * ligne. Le geste le plus coûteux de l'annuaire, et le plus rare — une rentrée, pas un écran.
   */
  import_csv_user: { max: 10, windowMs: 15 * 60 * 1000 },
  /**
   * **Affiches servies par `/api/affiche/<sha256>.<ext>`**, route publique qui lit jusqu'à 4 Mo sur
   * le disque à chaque appel, sans session à opposer à un robot. Généreux exprès : une page
   * d'événements en affiche plusieurs, et le cache « immutable » d'un an fait que le même visiteur
   * ne redemande pas la même image. Ce qui est écarté, c'est la boucle — pas la consultation.
   */
  affiche_ip: { max: 120, windowMs: 5 * 60 * 1000 },
} satisfies Record<string, RateLimitRule>;

export type RateLimitContext = keyof typeof RATE_LIMITS;

/**
 * **La fenêtre stockée, et la chaîne exacte qui la portait en base.**
 *
 * `brut` n'est pas un détail d'implémentation : c'est le témoin de l'écriture conditionnelle (voir
 * `checkRateLimit`). Écrire « la fenêtre que j'ai lue, si elle est encore celle que j'ai lue » est
 * ce qui rend la décision atomique sans transaction.
 */
type Etat = { hits: number[]; brut: string | null };

/**
 * `ecrire` est un **compare-and-swap** : elle n'écrit que si la valeur rangée sous cette clé est
 * encore `attendu` (`null` = aucune ligne), et rend `false` si quelqu'un d'autre est passé entre la
 * lecture et l'écriture. Elle ne doit **jamais** attendre quoi que ce soit entre sa comparaison et
 * son écriture : c'est là que vit l'atomicité.
 */
type Magasin = {
  lire(key: string): Promise<Etat>;
  ecrire(key: string, hits: number[], attendu: string | null): Promise<boolean>;
};

/** Décode la fenêtre rangée en base : une entrée du dehors, jamais supposée bien formée. */
function decoderHits(brut: string | null): number[] {
  if (!brut) return [];
  try {
    const v = JSON.parse(brut);
    return Array.isArray(v) ? v.filter((t): t is number => typeof t === "number") : [];
  } catch {
    return [];
  }
}

const memoire = new Map<string, string>();
const magasinMemoire: Magasin = {
  async lire(key) {
    const brut = memoire.get(key) ?? null;
    return { hits: decoderHits(brut), brut };
  },
  async ecrire(key, hits, attendu) {
    // Comparaison et écriture dans le même tour de boucle d'événements : aucun `await` entre les deux.
    if ((memoire.get(key) ?? null) !== attendu) return false;
    memoire.set(key, JSON.stringify(hits));
    return true;
  },
};

const magasinBase: Magasin = {
  async lire(key) {
    const { db } = await import("@/lib/db");
    const ligne = await db.rateLimit.findUnique({ where: { key } });
    const brut = ligne?.hits ?? null;
    return { hits: decoderHits(brut), brut };
  },
  async ecrire(key, hits, attendu) {
    const { db } = await import("@/lib/db");
    const valeur = JSON.stringify(hits);
    if (attendu === null) {
      // Personne n'avait encore de fenêtre sous cette clé : c'est la contrainte d'unicité de `key`
      // qui tranche entre deux premières tentatives simultanées — exactement comme la clé de
      // déduplication des notifications.
      try {
        await db.rateLimit.create({ data: { key, hits: valeur } });
        return true;
      } catch {
        return false;
      }
    }
    // `updateMany` porte la valeur attendue dans son `where` : une seule requête décide, et son
    // compte dit si c'est nous qui avons gagné.
    const { count } = await db.rateLimit.updateMany({ where: { key, hits: attendu }, data: { hits: valeur } });
    return count === 1;
  },
};

// Tests unitaires uniquement : magasin en mémoire (jamais en production, quoi que dise l'environnement)
let magasin: Magasin = process.env.VITEST && process.env.NODE_ENV !== "production" ? magasinMemoire : magasinBase;

/** Tests : magasin en mémoire, remis à zéro. */
export function utiliserMagasinMemoire(): void {
  magasin = magasinMemoire;
  memoire.clear();
}

/** Décision pure : la fenêtre glissante `hits` (horodatages) admet-elle une tentative de plus ? Retourne les hits mis à jour. */
export function evaluerFenetre(hits: number[], rule: RateLimitRule, now: number): { admis: boolean; hits: number[] } {
  const recents = hits.filter((t) => now - t < rule.windowMs);
  if (recents.length >= rule.max) return { admis: false, hits: recents };
  return { admis: true, hits: [...recents, now] };
}

/**
 * Nombre de reprises du compare-and-swap. Chaque tour perdu veut dire qu'une autre requête a
 * enregistré son passage entre notre lecture et notre écriture : le tour suivant repart de la
 * fenêtre à jour, donc **progresse**. Et la boucle s'arrête d'elle-même dès que la fenêtre est
 * pleine (on ne réécrit rien pour un refus), si bien qu'un même appel ne peut perdre plus de tours
 * qu'il n'y a de places dans la fenêtre.
 */
const TENTATIVES_ECRITURE = 20;

/**
 * **La décision et son enregistrement ne se séparent pas.**
 *
 * Défaut, trouvé par relecture adverse : la version d'avant lisait la fenêtre, puis l'écrivait —
 * deux requêtes indépendantes. Cent tentatives de connexion simultanées lisaient toutes la même
 * fenêtre vide, étaient toutes admises, et leurs écritures s'écrasaient l'une l'autre : **un
 * passage enregistré pour cent essais**. Le plafond n'était pas « 8 par quart d'heure » mais « 8
 * vagues séquentielles », ce qui ne freine aucun robot — et cela valait pour le second facteur
 * (`totp_user`), pour les liens inconnus (`invitation_inconnue_ip`) et pour le compteur qui décide
 * de la révocation d'un lien diffusé (`invitation_token`).
 *
 * SQLite sérialise les **écritures**, pas les lectures, et c'est la lecture qui décidait. La
 * décision se prend donc maintenant par **écriture conditionnelle** : on écrit la fenêtre lue
 * augmentée de notre passage, *à condition* qu'elle n'ait pas bougé depuis. Si elle a bougé, on
 * relit et on recommence ; personne n'est admis sur une fenêtre périmée.
 *
 * Deux conséquences assumées :
 * - **une tentative refusée n'écrit plus rien** (la version d'avant réécrivait la fenêtre élaguée,
 *   par simple ménage : `purgerRateLimits` s'en charge). C'est aussi ce qui garantit qu'une fenêtre
 *   pleine reste pleine sans jamais se prolonger : un robot qui insiste n'enferme pas dehors le
 *   titulaire du compte ;
 * - à bout de reprises, on **refuse** : si vingt requêtes se disputent la même clé au même instant,
 *   c'est précisément la situation que ce limiteur existe pour arrêter.
 */
export async function checkRateLimit(context: RateLimitContext, key: string, now = Date.now()): Promise<boolean> {
  // Développement / tests uniquement (RATE_LIMIT_DISABLED=1 dans .env) : la béquille est neutralisée en production
  if (bequilleDevActive("RATE_LIMIT_DISABLED")) return true;
  const fullKey = `${context}:${key.toLowerCase()}`;
  for (let essai = 0; essai < TENTATIVES_ECRITURE; essai++) {
    const { hits, brut } = await magasin.lire(fullKey);
    const { admis, hits: apres } = evaluerFenetre(hits, RATE_LIMITS[context], now);
    if (!admis) return false;
    if (await magasin.ecrire(fullKey, apres, brut)) return true;
  }
  return false;
}

/** Entretien : supprime les clés inactives depuis plus de 24 h (la plus longue fenêtre). */
export async function purgerRateLimits(now = new Date()): Promise<number> {
  const { db } = await import("@/lib/db");
  const res = await db.rateLimit.deleteMany({ where: { updatedAt: { lt: new Date(now.getTime() - 24 * 60 * 60 * 1000) } } });
  return res.count;
}
