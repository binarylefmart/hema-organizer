import { describe, expect, it } from "vitest";
import { retirerMetadonnees } from "@/lib/affiches";

/**
 * **Ce qui est collé derrière la fin d'un JPEG sort quand même du club.**
 *
 * `retirerMetadonneesJpeg` s'arrêtait au marqueur `SOS` et recopiait **tout le reste tel quel** —
 * données compressées comprises, ce qui est juste, mais aussi tout ce qui traîne **après** le
 * marqueur de fin `EOI`. Sur une photo d'appareil c'était sans conséquence (l'Exif précède `SOS` et
 * était bien jeté) ; sur un fichier fabriqué à la main, la queue peut porter un Exif entier, du XMP,
 * un second JPEG — et `/api/affiche/<sha256>` la sert **publiquement**, avec un cache `immutable`
 * d'un an, alors que l'en-tête du module promet « on retire les métadonnées » sans réserve.
 *
 * Trois choses se vérifient ici, dans cet ordre d'importance :
 *  1. la queue tombe ;
 *  2. l'image, elle, ne perd **rien** — ni sur un JPEG ordinaire, ni sur un JPEG progressif (deux
 *     scans, des tables entre les deux), ni sur des données qui contiennent des `FF` (bourrage
 *     `FF 00`) et des marqueurs de redémarrage `RSTn` : ce sont les seuls `FF` légaux dans un scan,
 *     et un parcours qui les confondrait avec la fin du fichier **couperait l'affiche en deux** ;
 *  3. au moindre doute (fichier tronqué, sans `EOI`), on ne coupe pas.
 *
 * Et comme le nom du fichier est le SHA-256 du contenu **après** nettoyage, tronquer ne casse
 * aucune chaîne : le même dépôt donne simplement un autre nom, une seule fois.
 */

/** Segment JPEG `FF <marqueur> <longueur sur 2 octets, elle comprise> <charge>`. */
function segment(marqueur: number, charge: Buffer): Buffer {
  return Buffer.concat([Buffer.from([0xff, marqueur, ((charge.length + 2) >> 8) & 0xff, (charge.length + 2) & 0xff]), charge]);
}

const SOI = Buffer.from([0xff, 0xd8]);
const EOI = Buffer.from([0xff, 0xd9]);
const ENTETE_SCAN = Buffer.from([0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]);
const QUEUE = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), Buffer.from("GPSLatitudeRef=N/47.0667", "latin1")]);

function contient(dans: Buffer, quoi: Buffer | string): boolean {
  return dans.includes(Buffer.isBuffer(quoi) ? quoi : Buffer.from(quoi, "latin1"));
}

function nettoyer(jpeg: Buffer): Buffer {
  return Buffer.from(retirerMetadonnees(jpeg, "image/jpeg"));
}

describe("la queue d'un JPEG ne part pas avec l'affiche", () => {
  it("ce qui suit EOI est retiré", () => {
    const avant = Buffer.concat([SOI, segment(0xda, ENTETE_SCAN), Buffer.from([0x12, 0x34, 0x56, 0x78]), EOI, QUEUE]);
    expect(contient(avant, QUEUE)).toBe(true);

    const apres = nettoyer(avant);

    expect(contient(apres, QUEUE)).toBe(false);
    // Le fichier finit sur son marqueur de fin, et les données du scan sont intactes.
    expect([...apres.subarray(-2)]).toEqual([0xff, 0xd9]);
    expect(contient(apres, Buffer.from([0x12, 0x34, 0x56, 0x78]))).toBe(true);
  });

  it("un JPEG entier collé derrière un autre ne voyage pas en passager clandestin", () => {
    const passager = Buffer.concat([SOI, segment(0xe1, Buffer.concat([Buffer.from("Exif\0\0", "latin1"), QUEUE])), segment(0xda, ENTETE_SCAN), Buffer.from([0xaa]), EOI]);
    const apres = nettoyer(Buffer.concat([SOI, segment(0xda, ENTETE_SCAN), Buffer.from([0x0f]), EOI, passager]));
    expect(contient(apres, QUEUE)).toBe(false);
    expect(apres.length).toBe(2 + 4 + ENTETE_SCAN.length + 1 + 2);
  });

  it("les FF légaux d'un scan (bourrage FF 00, redémarrages RSTn) ne sont pas pris pour la fin", () => {
    // Données volontairement truffées de 0xFF : c'est le piège exact d'une recherche naïve de FF D9.
    const donnees = Buffer.from([0xff, 0x00, 0x11, 0xff, 0xd0, 0x22, 0xff, 0x00, 0xff, 0xd7, 0x33]);
    const apres = nettoyer(Buffer.concat([SOI, segment(0xda, ENTETE_SCAN), donnees, EOI, QUEUE]));
    expect(contient(apres, donnees)).toBe(true); // aucune donnée perdue
    expect(contient(apres, QUEUE)).toBe(false);
  });

  it("un JPEG progressif garde ses deux scans et perd quand même sa queue", () => {
    const apres = nettoyer(
      Buffer.concat([
        SOI,
        segment(0xda, ENTETE_SCAN),
        Buffer.from([0x01, 0x02]),
        segment(0xc4, Buffer.from([0x00, 0x01, 0x02])), // DHT entre deux scans
        segment(0xda, ENTETE_SCAN),
        Buffer.from([0x03, 0x04]),
        EOI,
        QUEUE,
      ]),
    );
    expect(contient(apres, Buffer.from([0x01, 0x02]))).toBe(true);
    expect(contient(apres, Buffer.from([0x03, 0x04]))).toBe(true);
    expect(contient(apres, Buffer.from([0xff, 0xc4]))).toBe(true); // la table du second scan
    expect(contient(apres, QUEUE)).toBe(false);
  });

  it("un JPEG sans EOI n'est pas coupé au hasard : on rend tout ce qui suit SOS", () => {
    const sansFin = Buffer.concat([SOI, segment(0xda, ENTETE_SCAN), Buffer.from([0x12, 0x34, 0x56, 0x78])]);
    expect(contient(nettoyer(sansFin), Buffer.from([0x12, 0x34, 0x56, 0x78]))).toBe(true);
  });

  it("l'Exif d'avant le scan continue de tomber, et nettoyer deux fois ne change plus rien", () => {
    const avant = Buffer.concat([
      SOI,
      segment(0xe1, Buffer.concat([Buffer.from("Exif\0\0", "latin1"), QUEUE])),
      segment(0xda, ENTETE_SCAN),
      Buffer.from([0x12, 0x34]),
      EOI,
      QUEUE,
    ]);
    const propre = nettoyer(avant);
    expect(contient(propre, QUEUE)).toBe(false);
    expect([...nettoyer(propre)]).toEqual([...propre]);
  });
});
