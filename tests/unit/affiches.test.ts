import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Affiches déposées : reconnaissance du type **par les octets de tête**, retrait des métadonnées
 * (une affiche part sur les pages publiques — une photo de téléphone y emporterait sa position),
 * et refus des noms de fichier hostiles.
 *
 * L'essentiel porte sur les fonctions pures : elles se testent sans disque ni base.
 */

const faux = vi.hoisted(() => ({
  /** Fichiers du dossier des affiches : nom → date de dernière modification */
  fichiers: new Map<string, Date>(),
  /** Affiches référencées par un événement (chemin `/api/affiche/…`) */
  referencees: [] as string[],
  /** Effacements demandés au disque */
  effaces: [] as string[],
  /** Lectures demandées au disque (pour vérifier qu'un nom hostile n'y touche jamais) */
  lectures: [] as string[],
  /** Horodatages rafraîchis (`utimes`) : nom du fichier → nouvelle date */
  horodatages: [] as Array<[string, Date]>,
}));

vi.mock("node:fs/promises", () => {
  const readdir = vi.fn(async (_dir: string, options?: { withFileTypes?: boolean }) => {
    const noms = [...faux.fichiers.keys()];
    return options?.withFileTypes
      ? noms.map((name) => ({ name, isFile: () => true, isDirectory: () => false }))
      : noms;
  });
  const stat = vi.fn(async (chemin: string) => {
    const nom = chemin.split("/").pop()!;
    const mtime = faux.fichiers.get(nom);
    if (!mtime) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    return { mtime, mtimeMs: mtime.getTime(), size: 1024, isFile: () => true, isDirectory: () => false };
  });
  const api = {
    readdir,
    stat,
    lstat: stat,
    readFile: vi.fn(async (chemin: string) => {
      faux.lectures.push(chemin);
      const nom = chemin.split("/").pop()!;
      if (!faux.fichiers.has(nom)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    }),
    // `wx` = créer sans écraser : sur un fichier déjà là, le vrai `writeFile` lève EEXIST.
    // C'est tout le dédoublonnage par empreinte, et le simulacre doit donc le reproduire.
    writeFile: vi.fn(async (chemin: string, _donnees: unknown, options?: { flag?: string }) => {
      const nom = chemin.split("/").pop()!;
      if (options?.flag === "wx" && faux.fichiers.has(nom)) throw Object.assign(new Error("EEXIST"), { code: "EEXIST" });
      faux.fichiers.set(nom, new Date());
    }),
    utimes: vi.fn(async (chemin: string, _atime: Date, mtime: Date) => {
      const nom = chemin.split("/").pop()!;
      if (!faux.fichiers.has(nom)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      faux.fichiers.set(nom, mtime);
      faux.horodatages.push([nom, mtime]);
    }),
    rename: vi.fn(async () => undefined),
    mkdir: vi.fn(async () => undefined),
    unlink: vi.fn(async (chemin: string) => {
      const nom = chemin.split("/").pop()!;
      faux.effaces.push(nom);
      faux.fichiers.delete(nom);
    }),
    rm: vi.fn(async (chemin: string) => {
      const nom = chemin.split("/").pop()!;
      faux.effaces.push(nom);
      faux.fichiers.delete(nom);
    }),
  };
  return { ...api, default: api };
});

vi.mock("@/lib/db", () => ({
  db: {
    evenement: {
      findMany: vi.fn(async () => faux.referencees.map((imageUrl, i) => ({ id: `e-${i + 1}`, imageUrl }))),
    },
  },
}));

/**
 * La purge épargne aussi **les logos du club** (`imagesIdentite`) : ici, aucun logo n'est déposé.
 * Sans ce simulacre, la lecture de l'identité passerait par la table `Setting`, absente du simulacre
 * de base ci-dessus — et la purge s'annulerait d'elle-même, ce qui masquerait ce qu'on teste.
 */
vi.mock("@/lib/identite", () => ({ imagesIdentite: vi.fn(async () => [] as string[]) }));

const {
  AFFICHE_TAILLE_MAX,
  dossierAffiches,
  enregistrerAffiche,
  extensionAffiche,
  lireAffiche,
  purgerAffichesOrphelines,
  retirerMetadonnees,
  typeDepuisOctets,
} = await import("@/lib/affiches");

// ─────────────────────────────── fabriques d'images en mémoire ───────────────────────────────

const SIGNATURE_PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** CRC-32 (PNG) : sans lui, les chunks fabriqués ici ne seraient pas des chunks. */
function crc32(octets: Buffer): number {
  let crc = 0xffffffff;
  for (const octet of octets) {
    crc ^= octet;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunkPng(type: string, donnees: Buffer): Buffer {
  const taille = Buffer.alloc(4);
  taille.writeUInt32BE(donnees.length);
  const corps = Buffer.concat([Buffer.from(type, "latin1"), donnees]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(corps));
  return Buffer.concat([taille, corps, crc]);
}

/** Segment JPEG `FF <marqueur> <longueur sur 2 octets, elle comprise> <charge>`. */
function segmentJpeg(marqueur: number, charge: Buffer): Buffer {
  const entete = Buffer.from([0xff, marqueur, ((charge.length + 2) >> 8) & 0xff, (charge.length + 2) & 0xff]);
  return Buffer.concat([entete, charge]);
}

const GPS_TEMOIN = Buffer.from("GPSLatitudeRef=N/47.0667", "latin1");

/** JPEG minimal : SOI · APP0 JFIF · APP1 Exif (faux GPS) · COM · SOS + données · EOI */
function jpegAvecExif(): Buffer {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    segmentJpeg(0xe0, Buffer.concat([Buffer.from("JFIF\0", "latin1"), Buffer.from([0x01, 0x02, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00])])),
    segmentJpeg(0xe1, Buffer.concat([Buffer.from("Exif\0\0", "latin1"), Buffer.from("MM\0*", "latin1"), GPS_TEMOIN])),
    segmentJpeg(0xfe, Buffer.from("Photographie prise avec un telephone", "latin1")),
    segmentJpeg(0xda, Buffer.from([0x01, 0x01, 0x00, 0x00, 0x3f, 0x00])),
    Buffer.from([0x12, 0x34, 0x56, 0x78]),
    Buffer.from([0xff, 0xd9]),
  ]);
}

/** PNG minimal : signature · IHDR · tEXt (commentaire) · IDAT · IEND */
function pngAvecTexte(): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0);
  ihdr.writeUInt32BE(2, 4);
  ihdr[8] = 8; // profondeur
  ihdr[9] = 2; // couleur RVB
  return Buffer.concat([
    Buffer.from(SIGNATURE_PNG),
    chunkPng("IHDR", ihdr),
    chunkPng("tEXt", Buffer.from("Comment\0Coordonnees GPS 47.0667,4.9100", "latin1")),
    chunkPng("IDAT", Buffer.from([0x78, 0x9c, 0x62, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01])),
    chunkPng("IEND", Buffer.alloc(0)),
  ]);
}

/** Chunk RIFF : `<type> <taille LE> <charge>` (+ octet de bourrage si taille impaire). */
function chunkRiff(type: string, donnees: Buffer): Buffer {
  const taille = Buffer.alloc(4);
  taille.writeUInt32LE(donnees.length);
  const bourrage = donnees.length % 2 === 1 ? Buffer.from([0x00]) : Buffer.alloc(0);
  return Buffer.concat([Buffer.from(type, "latin1"), taille, donnees, bourrage]);
}

/** WebP minimal : RIFF · taille · WEBP · VP8L · EXIF */
function webpAvecExif(): Buffer {
  const corps = Buffer.concat([
    Buffer.from("WEBP", "latin1"),
    chunkRiff("VP8L", Buffer.from([0x2f, 0x00, 0x00, 0x00, 0x00, 0x88, 0x88, 0x08])),
    chunkRiff("EXIF", Buffer.concat([Buffer.from("MM\0*", "latin1"), GPS_TEMOIN])),
  ]);
  const taille = Buffer.alloc(4);
  taille.writeUInt32LE(corps.length);
  return Buffer.concat([Buffer.from("RIFF", "latin1"), taille, corps]);
}

const contient = (octets: Uint8Array, motif: Buffer | string) =>
  Buffer.from(octets).includes(typeof motif === "string" ? Buffer.from(motif, "latin1") : motif);

// ────────────────────────────────────────── tests ──────────────────────────────────────────

describe("type d'une affiche, reconnu par les octets de tête", () => {
  it("reconnaît un JPEG, un PNG et un WebP", () => {
    expect(typeDepuisOctets(jpegAvecExif())).toBe("image/jpeg");
    expect(typeDepuisOctets(pngAvecTexte())).toBe("image/png");
    expect(typeDepuisOctets(webpAvecExif())).toBe("image/webp");
  });

  it("refuse un SVG, qui est du code et non une image matricielle", () => {
    expect(typeDepuisOctets(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', "utf8"))).toBeNull();
    expect(typeDepuisOctets(Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>', "utf8"))).toBeNull();
  });

  it("refuse un texte, un PDF, un fichier vide et un fichier trop court", () => {
    expect(typeDepuisOctets(Buffer.from("Bonjour, ceci n'est pas une affiche.", "utf8"))).toBeNull();
    expect(typeDepuisOctets(Buffer.from("%PDF-1.7\n%\xe2\xe3\xcf\xd3", "latin1"))).toBeNull();
    expect(typeDepuisOctets(new Uint8Array(0))).toBeNull();
    expect(typeDepuisOctets(new Uint8Array(SIGNATURE_PNG.slice(0, 3)))).toBeNull();
    expect(typeDepuisOctets(Buffer.from([0xff, 0xd8]))).toBeNull();
  });

  it("voit un PNG dans un PNG renommé en .jpg : le type ne vient jamais du nom", () => {
    const octets = pngAvecTexte(); // « photo-club.jpg » côté navigateur
    expect(typeDepuisOctets(octets)).toBe("image/png");
    expect(extensionAffiche(typeDepuisOctets(octets)!)).toBe("png");
  });

  it("refuse un RIFF qui n'est pas du WebP (un WAV, par exemple)", () => {
    const wav = Buffer.concat([Buffer.from("RIFF", "latin1"), Buffer.from([0x24, 0x00, 0x00, 0x00]), Buffer.from("WAVEfmt ", "latin1")]);
    expect(typeDepuisOctets(wav)).toBeNull();
  });

  it("donne une extension par type et borne la taille à 4 Mo", () => {
    expect(extensionAffiche("image/jpeg")).toBe("jpg");
    expect(extensionAffiche("image/png")).toBe("png");
    expect(extensionAffiche("image/webp")).toBe("webp");
    expect(AFFICHE_TAILLE_MAX).toBe(4 * 1024 * 1024);
  });

  /**
   * Le dépôt passe par une **server action** : le fichier arrive en `FormData`, et Next refuse le
   * corps de la requête *avant* d'entrer dans l'action si `bodySizeLimit` est dépassé. Une limite
   * plus basse que `AFFICHE_TAILLE_MAX` rend donc injoignable tout ce que l'application dit
   * accepter — sans message d'erreur utile, la promesse rejetant au milieu d'un `useTransition`.
   * Les deux valeurs doivent bouger ensemble : c'est ce que ce test empêche d'oublier.
   */
  it("laisse le corps d'une server action porter une affiche de 4 Mo", () => {
    const config = readFileSync(path.join(process.cwd(), "next.config.ts"), "utf8");
    const limite = config.match(/bodySizeLimit:\s*"(\d+)mb"/);
    expect(limite, "bodySizeLimit doit être exprimé en Mo dans next.config.ts").not.toBeNull();
    // Strictement au-dessus : l'encodage multipart ajoute des octets au fichier lui-même
    expect(Number(limite![1]) * 1024 * 1024).toBeGreaterThan(AFFICHE_TAILLE_MAX);
    // …et la valeur porte son pourquoi, pour que les deux plafonds ne redivergent pas en silence
    expect(config).toContain("AFFICHE_TAILLE_MAX");
  });
});

describe("retrait des métadonnées", () => {
  it("une photo de téléphone perd sa position GPS mais reste un JPEG valide", () => {
    const avant = jpegAvecExif();
    expect(contient(avant, "Exif\0\0")).toBe(true);

    const apres = Buffer.from(retirerMetadonnees(avant, "image/jpeg"));

    expect(contient(apres, "Exif\0\0")).toBe(false);
    expect(contient(apres, GPS_TEMOIN)).toBe(false);
    expect([...apres.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
    expect([...apres.subarray(-2)]).toEqual([0xff, 0xd9]);
    expect(apres.length).toBeLessThan(avant.length);
  });

  it("garde le JFIF (APP0) et les données d'image, jette le commentaire (COM)", () => {
    const apres = Buffer.from(retirerMetadonnees(jpegAvecExif(), "image/jpeg"));
    expect(contient(apres, "JFIF\0")).toBe(true);
    expect(contient(apres, "Photographie prise avec un telephone")).toBe(false);
    expect(contient(apres, Buffer.from([0xff, 0xda]))).toBe(true); // début du balayage
    expect(contient(apres, Buffer.from([0x12, 0x34, 0x56, 0x78]))).toBe(true); // données compressées
  });

  it("retire le chunk tEXt d'un PNG et garde IHDR, IDAT puis IEND dans l'ordre", () => {
    const avant = pngAvecTexte();
    const apres = Buffer.from(retirerMetadonnees(avant, "image/png"));

    expect(contient(apres, "Coordonnees GPS")).toBe(false);
    expect(contient(apres, "tEXt")).toBe(false);
    expect([...apres.subarray(0, 8)]).toEqual(SIGNATURE_PNG);
    const ihdr = apres.indexOf("IHDR");
    const idat = apres.indexOf("IDAT");
    const iend = apres.indexOf("IEND");
    expect(ihdr).toBeGreaterThan(0);
    expect(idat).toBeGreaterThan(ihdr);
    expect(iend).toBeGreaterThan(idat);
    expect(apres.length).toBe(avant.length - (12 + "Comment\0Coordonnees GPS 47.0667,4.9100".length));
  });

  it("retire le chunk EXIF d'un WebP et recalcule la taille RIFF de l'en-tête", () => {
    const avant = webpAvecExif();
    const apres = Buffer.from(retirerMetadonnees(avant, "image/webp"));

    expect(contient(apres, GPS_TEMOIN)).toBe(false);
    expect(apres.subarray(0, 4).toString("latin1")).toBe("RIFF");
    expect(apres.subarray(8, 12).toString("latin1")).toBe("WEBP");
    expect(contient(apres, "VP8L")).toBe(true);
    // L'entier à l'offset 4 compte tout ce qui suit lui : un en-tête resté trop grand casse les lecteurs.
    expect(apres.readUInt32LE(4)).toBe(apres.length - 8);
    expect(typeDepuisOctets(apres)).toBe("image/webp");
  });

  it("ne lève pas sur des octets tronqués ou malformés", () => {
    const jpeg = jpegAvecExif();
    const png = pngAvecTexte();
    const webp = webpAvecExif();
    expect(() => retirerMetadonnees(jpeg.subarray(0, 5), "image/jpeg")).not.toThrow();
    expect(() => retirerMetadonnees(jpeg.subarray(0, 12), "image/jpeg")).not.toThrow();
    expect(() => retirerMetadonnees(Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff]), "image/jpeg")).not.toThrow();
    expect(() => retirerMetadonnees(png.subarray(0, 20), "image/png")).not.toThrow();
    expect(() => retirerMetadonnees(new Uint8Array(0), "image/png")).not.toThrow();
    expect(() => retirerMetadonnees(webp.subarray(0, 14), "image/webp")).not.toThrow();
    expect(() => retirerMetadonnees(new Uint8Array(0), "image/webp")).not.toThrow();
  });

  it("laisse intacte une image déjà propre", () => {
    const propre = Buffer.from(retirerMetadonnees(pngAvecTexte(), "image/png"));
    expect([...Buffer.from(retirerMetadonnees(propre, "image/png"))]).toEqual([...propre]);
  });
});

describe("lecture d'une affiche par son nom", () => {
  beforeEach(() => {
    faux.lectures.length = 0;
  });

  it("refuse les noms hostiles sans jamais toucher au disque", async () => {
    const hostiles = [
      "../../etc/passwd",
      "..%2Fx.jpg",
      "../a1b2.jpg",
      "abc.jpg",
      "a".repeat(63) + ".jpg", // hash trop court
      "A".repeat(64) + ".jpg", // majuscules : le hash est en minuscules
      "a".repeat(64) + ".svg",
      "a".repeat(64),
      "",
      "a".repeat(64) + ".jpg/../../hema.db",
    ];
    for (const nom of hostiles) {
      await expect(lireAffiche(nom), `« ${nom} » doit être refusé`).resolves.toBeNull();
    }
    expect(faux.lectures).toEqual([]);
  });

  it("rend null pour un nom valide dont le fichier n'existe pas", async () => {
    await expect(lireAffiche("b".repeat(64) + ".png")).resolves.toBeNull();
  });

  it("range les affiches dans un dossier, jamais à la racine de la base", () => {
    expect(dossierAffiches()).toMatch(/affiches$/);
  });
});

describe("dépôt d'une affiche déjà stockée", () => {
  beforeEach(() => {
    faux.fichiers.clear();
    faux.referencees.length = 0;
    faux.effaces.length = 0;
    faux.horodatages.length = 0;
  });

  /**
   * Le dédoublonnage par empreinte ne réécrit pas un fichier déjà présent — mais la purge, elle,
   * juge l'abandon sur la **date du fichier**. Une affiche devenue orpheline (annonce supprimée,
   * formulaire abandonné) puis redéposée à l'identique gardait sa vieille date : le ménage de 07:00
   * pouvait l'emporter entre le dépôt et l'enregistrement de l'annonce, et l'URL tombait en 404.
   */
  it("rafraîchit la date du fichier, pour que la purge reparte de ce dépôt-ci", async () => {
    const octets = pngAvecTexte();
    const chemin = await enregistrerAffiche(octets, "image/png");
    const nom = chemin.slice("/api/affiche/".length);
    expect(faux.fichiers.has(nom)).toBe(true);

    // Le fichier traîne depuis trois jours et plus rien ne le référence : la purge l'emporterait.
    const vieille = new Date("2026-09-20T07:00:00Z");
    faux.fichiers.set(nom, vieille);

    // Redépôt du même fichier, au bit près : pas d'écriture, mais la date doit repartir de zéro.
    expect(await enregistrerAffiche(octets, "image/png")).toBe(chemin);
    const rafraichi = faux.fichiers.get(nom)!;
    expect(faux.horodatages.map(([n]) => n)).toEqual([nom]);
    expect(rafraichi.getTime()).toBeGreaterThan(vieille.getTime());

    // …et le ménage de la nuit suivante l'épargne bien : le délai de grâce court à nouveau
    expect(await purgerAffichesOrphelines(new Date(rafraichi.getTime() + 3600_000))).toBe(0);
    expect(faux.effaces).toEqual([]);
  });
});

describe("ménage des affiches orphelines", () => {
  const nom = (lettre: string, ext = "jpg") => lettre.repeat(64) + "." + ext;
  const maintenant = new Date("2026-09-23T07:00:00Z");
  const ilYA = (heures: number) => new Date(maintenant.getTime() - heures * 3600_000);

  beforeEach(() => {
    faux.fichiers.clear();
    faux.referencees.length = 0;
    faux.effaces.length = 0;
  });

  it("efface ce que plus aucun événement n'utilise et que personne n'a touché depuis 24 h", async () => {
    faux.fichiers.set(nom("a"), ilYA(72)); // référencée, ancienne
    faux.fichiers.set(nom("b"), ilYA(48)); // orpheline, ancienne
    faux.fichiers.set(nom("c", "png"), ilYA(1)); // orpheline, mais déposée à l'instant
    faux.referencees.push(`/api/affiche/${nom("a")}`);

    const effacees = await purgerAffichesOrphelines(maintenant);

    expect(faux.effaces).toEqual([nom("b")]);
    expect(effacees).toBe(1);
  });

  it("épargne une affiche déposée à l'instant, le temps que le formulaire soit enregistré", async () => {
    faux.fichiers.set(nom("d"), ilYA(2));
    expect(await purgerAffichesOrphelines(maintenant)).toBe(0);
    expect(faux.effaces).toEqual([]);
  });
});
