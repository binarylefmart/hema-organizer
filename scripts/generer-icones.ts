import { mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

/**
 * Icônes livrées avec l'application, engendrées depuis l'écu de `public/logo-ecu.png`.
 *
 * Ce script sert à **fabriquer les fichiers du dépôt** : un club qui déploie l'outil dépose son
 * logo dans l'espace admin (écran *Identité*), et le manifeste pointe alors directement dessus,
 * sans repasser par ici. Ce chemin-là reste pour qui veut les tailles exactes et peut redéployer.
 *
 * Pourquoi un script plutôt que des fichiers déposés à la main : les tailles exigées par les
 * navigateurs (192 et 512 pixels, carrées) et par Android (une version *maskable*, rognée en
 * cercle ou en goutte selon l'appareil) doivent rester cohérentes entre elles. Une seule source,
 * une seule commande — `npm run icons:generate` — et l'on sait d'où vient chaque fichier.
 *
 * L'écu n'est pas carré : il est **posé au centre** d'un carré de fond, sans déformation. La marge
 * change selon l'usage : discrète pour l'icône ordinaire, large pour la *maskable*, dont les bords
 * seront rognés (la zone sûre d'Android est le cercle central, 80 % du côté).
 */

const RACINE = process.cwd();
const SOURCE = path.join(RACINE, "public", "logo-ecu.png");
const DOSSIER = path.join(RACINE, "public", "icons");

/** Fond clair du thème livré (« parchemin ») et encre de l'en-tête (fond de la maskable). */
const PARCHEMIN = { r: 244, g: 240, b: 238, alpha: 1 };
const ENCRE = { r: 43, g: 38, b: 34, alpha: 1 };
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

async function icone(taille: number, fichier: string, fond: typeof PARCHEMIN, margeRatio: number): Promise<void> {
  const interieur = Math.round(taille * (1 - 2 * margeRatio));
  const ecu = await sharp(SOURCE).resize(interieur, interieur, { fit: "contain", background: TRANSPARENT }).toBuffer();
  await sharp({ create: { width: taille, height: taille, channels: 4, background: fond } })
    .composite([{ input: ecu, gravity: "center" }])
    .png()
    .toFile(path.join(DOSSIER, fichier));
  console.info(`  ${fichier} (${taille}×${taille})`);
}

async function main(): Promise<void> {
  await mkdir(DOSSIER, { recursive: true });
  console.info("Icônes engendrées depuis public/logo-ecu.png :");
  await icone(192, "icone-192.png", PARCHEMIN, 0.08);
  await icone(512, "icone-512.png", PARCHEMIN, 0.08);
  // Maskable : large marge, fond encre — l'appareil rogne les bords comme il l'entend.
  await icone(512, "icone-maskable-512.png", ENCRE, 0.2);
  // Badge Android : petit, monochrome à l'écran, sur fond transparent.
  await icone(96, "badge-96.png", TRANSPARENT, 0.05);
  // Icône iOS (pas de transparence : Apple pose du noir derrière).
  await icone(180, "apple-touch-icon.png", PARCHEMIN, 0.08);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
