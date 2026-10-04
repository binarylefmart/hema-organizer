import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { db } from "./db";
import { env } from "./env";
import { imagesIdentite } from "./identite";

/**
 * Stockage des affiches d'événement déposées par glisser-déposer.
 *
 * Trois principes, dans l'ordre d'importance :
 *
 *  1. **On ne croit jamais le navigateur.** Le type est déduit des octets de tête, pas de
 *     l'extension ni du `type` du `File` (l'un comme l'autre se falsifient en trois lignes).
 *     Le SVG est refusé explicitement : c'est un *document* qui peut porter du script, et il
 *     serait servi depuis notre propre origine — même doctrine que `lien-apercu.ts`, qui exclut
 *     déjà `image/svg+xml` de la liste des images relayées par /api/image.
 *
 * 2. **On retire les métadonnées.** Une affiche finit sur les pages de partage *publiques* ; une
 * photo prise au téléphone y emporterait sa position GPS, son modèle d'appareil et sa date.
 * `retirerMetadonnees()` supprime ces blocs sans décoder l'image (pas de `sharp` : il n'est pas
 * installé et on n'ajoute pas de dépendance pour ça). **Et ce qui vient après la fin du fichier
 * tombe avec** : un JPEG est coupé après son `EOI`, un PNG après son `IEND`, parce qu'une queue
 * collée à la main serait servie publiquement comme le reste. **Deux réserves, écrites ici pour
 * qu'elles ne passent pas pour des oublis :** un fichier dont la suite de segments est illisible
 * est rendu **tel quel** (`return octets`, « on n'invente rien »), donc avec ses métadonnées — un
 * tel fichier n'est déjà plus décodable par un navigateur ; et une queue collée derrière un
 * **WebP** valide, si elle a la forme de vrais chunks RIFF, est recopiée comme les autres (la
 * taille `RIFF` est recalculée pour les inclure). Les borner demanderait de trancher ce que
 * l'application refuse, et non plus seulement ce qu'elle nettoie : à faire le jour où l'on voudra
 * aussi refuser les images cassées.
 *
 *  3. **Adressage par contenu.** Le nom du fichier est le SHA-256 de ses octets : deux dépôts de
 *     la même affiche ne font qu'un fichier sur le disque, et le cache navigateur peut être
 *     déclaré immuable puisqu'un nom ne désigne jamais qu'un seul contenu.
 */

/**
 * Plafond de taille d'une affiche : largement au-dessus d'une photo de flyer recompressée.
 *
 * **La valeur vit dans `src/lib/constants.ts`**, avec les mots qui l'annoncent
 * (`AFFICHE_TAILLE_MAX_LIBELLE`) : les zones de dépôt sont des composants client, et elles ne
 * peuvent pas importer ce fichier-ci sans entraîner `node:crypto` dans le paquet du navigateur. Elle
 * reste exportée ici parce que c'est de ce module que le serveur la lit, à côté du reste du dépôt.
 */
export { AFFICHE_TAILLE_MAX, AFFICHE_TAILLE_MAX_LIBELLE } from "./constants";

/** Les seuls formats acceptés. Pas de GIF (animé, peu utile ici), **jamais de SVG** (cf. en-tête). */
export type TypeAffiche = "image/jpeg" | "image/png" | "image/webp";

/* ------------------------------------------------------------------ */
/* 1. Reconnaissance du format par les octets de tête                  */
/* ------------------------------------------------------------------ */

/** Les octets aux positions données valent-ils exactement `attendus` ? */
function commencePar(octets: Uint8Array, attendus: number[], decalage = 0): boolean {
  if (octets.length < decalage + attendus.length) return false;
  return attendus.every((valeur, i) => octets[decalage + i] === valeur);
}

/**
 * Format réel d'un fichier, d'après sa signature — jamais d'après son nom ni d'après le type
 * annoncé par le navigateur. Tout ce qui n'est pas JPEG, PNG ou WebP renvoie `null` : un SVG,
 * un PDF, un ZIP renommé `.jpg` ou une archive piégée ne franchissent pas cette porte.
 */
export function typeDepuisOctets(octets: Uint8Array): TypeAffiche | null {
  // JPEG : FF D8 FF (SOI puis le premier marqueur)
  if (commencePar(octets, [0xff, 0xd8, 0xff])) return "image/jpeg";
  // PNG : 89 "PNG" CR LF SUB LF
  if (commencePar(octets, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  // WebP : conteneur RIFF ("RIFF" + taille sur 4 octets + "WEBP")
  if (commencePar(octets, [0x52, 0x49, 0x46, 0x46]) && commencePar(octets, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  return null;
}

/** Extension de fichier correspondant au type (celle du nom public, donc de l'URL). */
export function extensionAffiche(type: TypeAffiche): "jpg" | "png" | "webp" {
  if (type === "image/jpeg") return "jpg";
  if (type === "image/png") return "png";
  return "webp";
}

/** Extension → type, pour le chemin inverse (lecture d'un fichier déjà stocké). */
function typeDepuisExtension(extension: string): TypeAffiche | null {
  if (extension === "jpg") return "image/jpeg";
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  return null;
}

/* ------------------------------------------------------------------ */
/* 2. Retrait des métadonnées (fonction pure)                          */
/* ------------------------------------------------------------------ */

function concatener(morceaux: Uint8Array[]): Uint8Array {
  const total = morceaux.reduce((somme, m) => somme + m.length, 0);
  const sortie = new Uint8Array(total);
  let position = 0;
  for (const morceau of morceaux) {
    sortie.set(morceau, position);
    position += morceau.length;
  }
  return sortie;
}

/** Quatre octets ASCII lus à `position` (nom de chunk PNG ou fourcc RIFF). */
function lireEtiquette(octets: Uint8Array, position: number): string {
  return String.fromCharCode(octets[position], octets[position + 1], octets[position + 2], octets[position + 3]);
}

/**
 * Fin du flux JPEG : l'index juste **après** le marqueur `EOI`, ou `null` si le parcours ne peut
 * pas l'affirmer.
 *
 * On part de la fin de l'en-tête d'un `SOS` et l'on traverse les données compressées. Les seuls
 * `0xFF` qui y vivent légalement sont le bourrage `FF 00` et les marqueurs de redémarrage
 * `RST0`–`RST7` : tout autre `0xFF` suivi d'un octet parlant est un **vrai** marqueur, donc la fin
 * du scan. C'est ce qui permet de traverser un JPEG progressif, qui enchaîne plusieurs scans
 * séparés par des tables (`DHT`, `SOS`…) avant son `EOI`.
 *
 * **Au moindre doute, `null`** (fichier tronqué, longueur de segment impossible) : l'appelant
 * retombe alors sur l'ancien comportement — recopier la queue telle quelle — plutôt que de couper
 * au hasard dans une image. Ne jamais transformer ce `null` en « coupe ici » : une affiche mutilée
 * est un défaut visible, la queue d'un fichier ne l'est pas.
 */
function finDuFluxJpeg(octets: Uint8Array, depart: number): number | null {
  let position = depart;
  while (position < octets.length) {
    if (octets[position] !== 0xff) {
      position += 1;
      continue;
    }
    let marqueurPos = position + 1;
    while (marqueurPos < octets.length && octets[marqueurPos] === 0xff) marqueurPos += 1; // bourrage
    if (marqueurPos >= octets.length) return null;
    const marqueur = octets[marqueurPos];
    // `FF 00` (octet 0xFF échappé dans les données) et RSTn : on est encore dans le scan.
    if (marqueur === 0x00 || (marqueur >= 0xd0 && marqueur <= 0xd7)) {
      position = marqueurPos + 1;
      continue;
    }
    if (marqueur === 0xd9) return marqueurPos + 1; // EOI : c'est ici que le fichier finit
    // Marqueurs autonomes (TEM, SOI) : pas de bloc de données à sauter.
    if (marqueur === 0x01 || marqueur === 0xd8) {
      position = marqueurPos + 1;
      continue;
    }
    if (marqueurPos + 3 >= octets.length) return null;
    const longueur = (octets[marqueurPos + 1] << 8) | octets[marqueurPos + 2];
    if (longueur < 2) return null;
    const fin = marqueurPos + 1 + longueur;
    if (fin > octets.length) return null;
    position = fin;
  }
  return null;
}

/**
 * JPEG : on parcourt les segments et l'on jette
 *   - les `APPn` **sauf `APP0`** : `APP1` porte l'Exif (GPS, appareil, date) et le XMP,
 *     `APP2` l'ICC, `APP13` l'IPTC/Photoshop… `APP0`/JFIF est conservé car certains décodeurs
 *     anciens le réclament et il ne contient que densité et vignette ;
 *   - les commentaires `COM`, qui contiennent parfois le nom d'un logiciel ou d'un auteur.
 *
 * Arrivé à `SOS` (début des données compressées), on **coupe après `EOI`** au lieu de recopier la
 * queue. Sur une photo d'appareil l'Exif précède `SOS` et était bien jeté, donc rien ne fuyait en
 * pratique ; mais l'en-tête du module promet « on retire les métadonnées » sans réserve, et un
 * fichier fabriqué à la main peut porter **après** `EOI` tout ce qu'on veut — Exif, XMP, un second
 * JPEG — que `/api/affiche/` sert ensuite **publiquement**, avec un cache `immutable` d'un an. Ce
 * qui vient après la fin du fichier n'est pas l'image : ce n'est rien, et on ne republie pas
 * « rien » sans l'avoir lu.
 */
function retirerMetadonneesJpeg(octets: Uint8Array): Uint8Array {
  const morceaux: Uint8Array[] = [octets.subarray(0, 2)]; // SOI
  let position = 2;
  while (position < octets.length) {
    if (octets[position] !== 0xff) return octets; // désynchronisé : on n'invente rien
    // Des octets 0xFF de bourrage peuvent précéder le marqueur.
    let marqueurPos = position;
    while (marqueurPos < octets.length && octets[marqueurPos] === 0xff) marqueurPos += 1;
    if (marqueurPos >= octets.length) return octets;
    const marqueur = octets[marqueurPos];
    // Marqueurs autonomes, sans bloc de données : TEM, RSTn, SOI, EOI.
    if (marqueur === 0x01 || (marqueur >= 0xd0 && marqueur <= 0xd7) || marqueur === 0xd8) {
      morceaux.push(octets.subarray(position, marqueurPos + 1));
      position = marqueurPos + 1;
      continue;
    }
    if (marqueur === 0xd9) {
      // EOI : fin du flux. Ce qui suit ne fait pas partie de l'image — on s'arrête là.
      morceaux.push(octets.subarray(position, marqueurPos + 1));
      return concatener(morceaux);
    }
    if (marqueurPos + 3 >= octets.length) return octets;
    const longueur = (octets[marqueurPos + 1] << 8) | octets[marqueurPos + 2];
    if (longueur < 2) return octets;
    const fin = marqueurPos + 1 + longueur;
    if (fin > octets.length) return octets;
    if (marqueur === 0xda) {
      // SOS : l'en-tête du scan, puis les données compressées jusqu'à `EOI` — et pas au-delà.
      const finFlux = finDuFluxJpeg(octets, fin);
      morceaux.push(finFlux === null ? octets.subarray(position) : octets.subarray(position, finFlux));
      return concatener(morceaux);
    }
    const aJeter = (marqueur >= 0xe1 && marqueur <= 0xef) || marqueur === 0xfe;
    if (!aJeter) morceaux.push(octets.subarray(position, fin));
    position = fin;
  }
  return concatener(morceaux);
}

/** Chunks PNG purement informatifs, jetés : Exif, textes (dont XMP en `iTXt`) et date de modification. */
const PNG_CHUNKS_A_JETER = new Set(["eXIf", "tEXt", "iTXt", "zTXt", "tIME"]);

/**
 * PNG : parcours de la liste de chunks (`longueur` + `type` + données + CRC). On jette les chunks
 * de métadonnées et l'on garde tout le reste — `IHDR`, les chunks critiques, `IEND`.
 * Aucun CRC n'est recalculé : on ne **modifie** aucun chunk conservé, on les recopie octet pour
 * octet avec leur CRC d'origine ; seule la liste change, et elle n'est couverte par aucune somme.
 */
function retirerMetadonneesPng(octets: Uint8Array): Uint8Array {
  const morceaux: Uint8Array[] = [octets.subarray(0, 8)]; // signature
  let position = 8;
  while (position + 8 <= octets.length) {
    const longueur = new DataView(octets.buffer, octets.byteOffset + position, 4).getUint32(0, false);
    const type = lireEtiquette(octets, position + 4);
    const fin = position + 12 + longueur; // 4 (longueur) + 4 (type) + données + 4 (CRC)
    if (fin > octets.length || longueur > 0x7fffffff) return octets;
    if (!PNG_CHUNKS_A_JETER.has(type)) morceaux.push(octets.subarray(position, fin));
    position = fin;
    if (type === "IEND") break;
  }
  return concatener(morceaux);
}

/**
 * WebP (conteneur RIFF) : on jette les chunks `EXIF` et `XMP ` (le nom fait bien quatre caractères,
 * espace compris). Deux pièges :
 *   - un chunk de taille impaire est suivi d'un octet de bourrage, qui fait partie du conteneur
 *     mais pas de la taille déclarée ;
 *   - la taille annoncée dans l'en-tête `RIFF` doit être **recalculée**, sinon le fichier est
 *     cassé pour tout décodeur qui la lit (et la plupart la lisent).
 * Le chunk `VP8X` porte en plus des drapeaux « il y a de l'Exif / du XMP » : on les éteint, sans
 * quoi l'image annoncerait des blocs désormais absents.
 */
function retirerMetadonneesWebp(octets: Uint8Array): Uint8Array {
  if (octets.length < 12) return octets;
  const morceaux: Uint8Array[] = [];
  let position = 12; // "RIFF" + taille + "WEBP"
  while (position + 8 <= octets.length) {
    const fourcc = lireEtiquette(octets, position);
    const taille = new DataView(octets.buffer, octets.byteOffset + position + 4, 4).getUint32(0, true);
    if (taille > 0x7fffffff) return octets;
    const finDonnees = position + 8 + taille;
    if (finDonnees > octets.length) return octets;
    // Bourrage : les chunks RIFF sont alignés sur deux octets.
    const fin = Math.min(finDonnees + (taille % 2), octets.length);
    if (fourcc !== "EXIF" && fourcc !== "XMP ") {
      const chunk = octets.subarray(position, fin);
      if (fourcc === "VP8X" && chunk.length >= 9) {
        // Copie : on modifie un octet, on ne doit pas toucher à l'entrée (fonction pure).
        const copie = new Uint8Array(chunk);
        copie[8] &= ~0x08 & ~0x04; // drapeaux EXIF et XMP
        morceaux.push(copie);
      } else {
        morceaux.push(chunk);
      }
    }
    position = fin;
  }
  const corps = concatener(morceaux);
  const sortie = new Uint8Array(12 + corps.length);
  sortie.set(octets.subarray(0, 12), 0);
  // Taille RIFF = tout ce qui suit les 8 premiers octets, soit "WEBP" (4) + les chunks.
  new DataView(sortie.buffer).setUint32(4, 4 + corps.length, true);
  sortie.set(corps, 12);
  return sortie;
}

/**
 * Retire les métadonnées d'une image, **sans la décoder ni la recompresser** : on se contente de
 * supprimer des blocs entiers du conteneur, les pixels restent bit pour bit les mêmes.
 *
 * Fonction **pure** : l'entrée n'est jamais modifiée.
 *
 * En cas d'octets manifestement malformés (longueur de segment qui déborde, structure
 * désynchronisée), on renvoie **l'entrée inchangée** au lieu de lever : le format a déjà été
 * validé par `typeDepuisOctets`, et un cas tordu de conteneur ne doit pas transformer un dépôt
 * légitime en erreur incompréhensible. Le pire qui arrive alors est une affiche qui garde ses
 * métadonnées — le cas est rare, et l'échec inverse (refuser l'affiche) serait plus visible.
 */
export function retirerMetadonnees(octets: Uint8Array, type: TypeAffiche): Uint8Array {
  try {
    if (type === "image/jpeg") return retirerMetadonneesJpeg(octets);
    if (type === "image/png") return retirerMetadonneesPng(octets);
    return retirerMetadonneesWebp(octets);
  } catch {
    return octets;
  }
}

/* ------------------------------------------------------------------ */
/* 3. Emplacement sur le disque                                        */
/* ------------------------------------------------------------------ */

/** Nom de fichier stocké : 64 caractères hexadécimaux (SHA-256) + extension connue. Rien d'autre. */
const NOM_AFFICHE = /^[a-f0-9]{64}\.(jpg|png|webp)$/;

/**
 * Dossier des affiches, en chemin absolu.
 *
 * `UPLOAD_DIR` si la variable est définie ; **sinon, le dossier de la base SQLite + `/affiches`**.
 * Ce repli n'est pas un hasard : le compose Portainer de production est figé (cf. CLAUDE.md,
 * section « Production ») et ne doit recevoir **aucune variable nouvelle**. Or le volume
 * `hema_data:/data` y existe déjà et `DATABASE_URL` y vaut `file:/data/hema.db` : se ranger à côté
 * de la base, c'est hériter d'un volume persistant et sauvegardé sans toucher à la stack.
 * En production `file:/data/hema.db` → `/data/affiches`, en développement `file:./data/hema.db`
 * → `./data/affiches`, déjà ignoré par git.
 */
export function dossierAffiches(): string {
  const { UPLOAD_DIR, DATABASE_URL } = env();
  const configure = UPLOAD_DIR?.trim();
  if (configure) return path.resolve(configure);
  // `file:/data/hema.db` ou `file:./data/hema.db` : on ne garde que le chemin du fichier.
  const fichier = DATABASE_URL.replace(/^file:(\/\/)?/i, "").trim() || "./data/hema.db";
  return path.resolve(path.dirname(fichier), "affiches");
}

/* ------------------------------------------------------------------ */
/* 4. Écriture et lecture                                              */
/* ------------------------------------------------------------------ */

/**
 * Enregistre une affiche et renvoie son **chemin public** `/api/affiche/<sha256>.<ext>`.
 *
 * Le nom vient du contenu (SHA-256) : le même fichier déposé deux fois ne coûte qu'une entrée,
 * et comme un nom ne peut désigner qu'un contenu, la route peut servir un cache immuable.
 * Si le fichier existe déjà, on ne le réécrit pas (drapeau `wx` : le test et l'écriture sont une
 * seule opération, donc pas de fenêtre de course entre deux dépôts simultanés).
 *
 * **Mais on rafraîchit sa date** (`utimes`), et ce n'est pas cosmétique : `purgerAffichesOrphelines`
 * juge l'abandon sur le `mtime` du fichier (24 h de grâce). Une image devenue orpheline — annonce
 * supprimée, formulaire abandonné — puis redéposée à l'identique gardait sa vieille date : le
 * ménage de 07:00 pouvait l'emporter entre le dépôt et l'enregistrement de l'annonce, et l'URL
 * tombait en 404 sous les doigts de la personne qui venait de la déposer. Redéposer, c'est
 * réutiliser : le délai de grâce doit repartir de ce dépôt-ci.
 */
export async function enregistrerAffiche(octets: Uint8Array, type: TypeAffiche): Promise<string> {
  const empreinte = createHash("sha256").update(octets).digest("hex");
  const nom = `${empreinte}.${extensionAffiche(type)}`;
  const dossier = dossierAffiches();
  await mkdir(dossier, { recursive: true });
  const complet = path.join(dossier, nom);
  try {
    await writeFile(complet, octets, { flag: "wx" });
  } catch (e) {
    // EEXIST = cette affiche est déjà là, au mot près : c'est le cas nominal du dédoublonnage.
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    const maintenant = new Date();
    try {
      await utimes(complet, maintenant, maintenant);
    } catch (erreur) {
      // Pas de quoi refuser un dépôt par ailleurs valide : au pire l'affiche garde sa vieille date
      // et la purge la traite comme avant. On journalise, l'appelant n'a rien à en faire.
      console.error("[affiches] horodatage non rafraîchi", nom, erreur);
    }
  }
  return `/api/affiche/${nom}`;
}

/**
 * Lit une affiche par son nom de fichier.
 *
 * Le nom est validé **avant** toute concaténation de chemin : aucune traversée (`../`, chemin
 * absolu, octet nul) n'est possible, puisqu'un nom qui ne fait pas 64 hexadécimaux suivis d'une
 * extension connue n'atteint jamais le disque. `null` si le fichier n'existe pas.
 */
export async function lireAffiche(nom: string): Promise<{ octets: Buffer; type: TypeAffiche } | null> {
  if (!NOM_AFFICHE.test(nom)) return null;
  const type = typeDepuisExtension(nom.slice(nom.lastIndexOf(".") + 1));
  if (!type) return null;
  try {
    const octets = await readFile(path.join(dossierAffiches(), nom));
    return { octets, type };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* 5. Entretien                                                        */
/* ------------------------------------------------------------------ */

/** Délai de grâce avant qu'un fichier non référencé soit considéré comme abandonné. */
const GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * Supprime les images déposées que **rien** ne référence — ni l'affiche d'un événement
 * (`Evenement.imageUrl`), ni le logo du club (`identite`) — et qui n'ont pas été modifiées depuis
 * plus de 24 h. Renvoie le nombre de fichiers supprimés.
 *
 * **Le logo du club compte parmi les références, et ce n'est pas un détail** : il n'appartient à
 * aucun événement, si bien qu'un dossier purgé sans cette lecture-là ferait disparaître l'écu et le
 * logo du club au premier entretien nocturne — une journée après leur dépôt, sans que personne ait
 * rien fait.
 *
 * Le délai de grâce est essentiel : une affiche déposée dans un formulaire pas encore enregistré
 * n'est référencée nulle part, et elle ne doit pas disparaître sous les doigts de la personne qui
 * est en train de saisir l'événement.
 *
 * Ne lève jamais : cette fonction tourne dans l'entretien quotidien, où une erreur de disque ne
 * doit pas emporter les autres tâches. On journalise et on continue.
 */
export async function purgerAffichesOrphelines(now = new Date()): Promise<number> {
  const dossier = dossierAffiches();
  let fichiers: string[];
  try {
    fichiers = await readdir(dossier);
  } catch {
    return 0; // dossier absent = aucune affiche déposée : rien à purger
  }
  let referencees: Set<string>;
  try {
    const evenements = await db.evenement.findMany({ select: { imageUrl: true } });
    referencees = new Set(
      [...evenements.map((e) => e.imageUrl), ...(await imagesIdentite())]
        .map((url) => url.trim())
        .filter((url) => url.startsWith("/api/affiche/"))
        .map((url) => url.slice("/api/affiche/".length)),
    );
  } catch (e) {
    // Base illisible : on ne supprime rien plutôt que de risquer d'effacer une affiche utilisée.
    console.error("[affiches] purge annulée, lecture des références en échec", e);
    return 0;
  }
  const limite = now.getTime() - GRACE_MS;
  let supprimees = 0;
  for (const nom of fichiers) {
    if (!NOM_AFFICHE.test(nom)) continue;
    if (referencees.has(nom)) continue;
    const complet = path.join(dossier, nom);
    try {
      const infos = await stat(complet);
      if (infos.mtimeMs >= limite) continue; // encore dans le délai de grâce
      await rm(complet, { force: true });
      supprimees += 1;
    } catch (e) {
      console.error("[affiches] suppression impossible", nom, e);
    }
  }
  return supprimees;
}
