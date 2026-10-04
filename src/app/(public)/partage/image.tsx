import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { lireAffiche } from "@/lib/affiches";
import { ECU_LIVRE, identite, type Identite } from "@/lib/identite";

/**
 * **Image d'aperçu** des pages de partage (1200×630) : c'est la vignette qui s'affiche dans
 * WhatsApp, Signal, Discord ou LinkedIn quand on colle le lien. Elle est générée à la volée par
 * `ImageResponse`, aux couleurs de la charte parchemin, et ne montre — comme la page — que la
 * date, l'horaire, le lieu et les chiffres globaux.
 *
 * Elle est volontairement dessinée en styles en ligne : `ImageResponse` ne connaît ni Tailwind ni
 * les variables CSS du site, et n'accepte qu'un sous-ensemble de la mise en page (flexbox).
 */
export const TAILLE_OG = { width: 1200, height: 630 };
export const TYPE_OG = "image/png";

/** Couleurs de la charte, figées ici : l'image est rendue hors du navigateur, sans feuille de style. */
const PARCHEMIN = "#F4F0EE";
const PARCHEMIN_FONCE = "#E8E1D8";
const ENCRE = "#2B2622";
const ENCRE_DOUCE = "#6B6059";
const OR = "#C99A2E";
const OR_CLAIR = "#E6C977";
const ROUILLE = "#A5472C";

export type ContenuImage = {
  /** Petite ligne de tête : « Cours », « Planning » */
  surtitre: string;
  titre: string;
  lignes: string[];
  /** Chiffre mis en avant (« 72 % ») et son libellé (« 13 présents / 18 ») */
  grand?: string;
  grandLibelle?: string;
  /** Remplace le chiffre par un bandeau rouille (séance annulée) */
  alerte?: string;
};

/**
 * La vignette doit tenir en 630 px de haut quel que soit le contenu : un nom d'événement est bien
 * plus long qu'une date de cours. Le titre et les lignes rapetissent donc avec ce qu'ils portent,
 * plutôt que de déborder sur le bandeau du bas.
 */
function tailleTitre(titre: string): number {
  if (titre.length > 46) return 44;
  if (titre.length > 30) return 52;
  return 62;
}

function tailleLigne(nombre: number): number {
  return nombre >= 4 ? 28 : 34;
}

/** Le préfixe des images déposées : ce qui suit est le nom du fichier, tel que `lireAffiche` l'attend. */
const PREFIXE_DEPOSEE = "/api/affiche/";

/**
 * Écu du club, **embarqué en base64** : `ImageResponse` est rendu hors du navigateur, il ne va
 * chercher aucune URL relative — il lui faut les octets.
 *
 * Deux origines, dans cet ordre : l'écu déposé dans *Identité* (rangé avec les affiches, lu par
 * `lireAffiche`, qui valide le nom avant de toucher au disque), sinon le fichier livré dans
 * `public/`. Le repli n'est pas une politesse : cette vignette est engendrée par un inconnu qui
 * colle un lien, et **aucune lecture de fichier ne doit faire tomber une page publique** — au pire
 * la vignette s'affiche sans écu.
 *
 * `depose` voyage avec les octets parce qu'il décide de la proportion : l'écu livré est un peu plus
 * haut que large, un écu déposé est supposé carré (même règle que le composant `Logo`).
 */
async function ecu(club: Identite): Promise<{ source: string; depose: boolean } | null> {
  if (club.ecuDepose) {
    const fichier = await lireAffiche(club.ecu.slice(PREFIXE_DEPOSEE.length));
    if (fichier) return { source: `data:${fichier.type};base64,${fichier.octets.toString("base64")}`, depose: true };
  }
  try {
    // `ECU_LIVRE` est un chemin public (« /logo-ecu.png ») : sur le disque, c'est ce nom dans `public/`.
    const fichier = await readFile(path.join(process.cwd(), "public", path.basename(ECU_LIVRE)));
    return { source: `data:image/png;base64,${fichier.toString("base64")}`, depose: false };
  } catch {
    // Fichier absent (cas improbable) : l'image reste correcte, simplement sans écu
    return null;
  }
}

export async function imagePartage(c: ContenuImage): Promise<ImageResponse> {
  const club = await identite();
  const logo = await ecu(club);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          backgroundColor: PARCHEMIN,
          backgroundImage: `linear-gradient(180deg, ${PARCHEMIN_FONCE} 0%, ${PARCHEMIN} 55%)`,
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", flex: 1, padding: "56px 64px 40px 64px", gap: 40 }}>
          <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center", gap: 10, overflow: "hidden" }}>
            <div style={{ display: "flex", fontSize: 28, letterSpacing: 6, color: ENCRE_DOUCE, textTransform: "uppercase" }}>{c.surtitre}</div>
            <div style={{ display: "flex", marginBottom: 6, fontSize: tailleTitre(c.titre), fontWeight: 700, color: ENCRE, lineHeight: 1.15 }}>{c.titre}</div>
            {c.lignes.map((l, i) => (
              <div key={i} style={{ display: "flex", fontSize: tailleLigne(c.lignes.length), lineHeight: 1.3, color: i === 0 ? ENCRE : ENCRE_DOUCE }}>
                {l}
              </div>
            ))}
            {c.alerte && (
              <div
                style={{
                  display: "flex",
                  marginTop: 14,
                  padding: "14px 24px",
                  borderRadius: 16,
                  backgroundColor: "#F5E1DA",
                  color: ROUILLE,
                  fontSize: 32,
                  fontWeight: 700,
                }}
              >
                {c.alerte}
              </div>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", width: 340 }}>
            {logo && (
              // eslint-disable-next-line @next/next/no-img-element -- rendu hors navigateur (satori) : next/image n'existe pas ici
              <img src={logo.source} alt="" width={190} height={logo.depose ? 190 : 218} />
            )}
            {c.grand && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: 26 }}>
                <div style={{ display: "flex", fontSize: 96, fontWeight: 700, color: OR, lineHeight: 1 }}>{c.grand}</div>
                {c.grandLibelle && <div style={{ display: "flex", marginTop: 10, fontSize: 28, color: ENCRE_DOUCE }}>{c.grandLibelle}</div>}
              </div>
            )}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "22px 64px",
            backgroundColor: ENCRE,
            color: OR_CLAIR,
            fontSize: 30,
          }}
        >
          <div style={{ display: "flex" }}>{club.nomClub}</div>
          <div style={{ display: "flex", color: PARCHEMIN_FONCE, fontSize: 26 }}>Indique ta présence en un appui</div>
        </div>
      </div>
    ),
    TAILLE_OG,
  );
}
