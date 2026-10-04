import { baseUrl } from "@/lib/env";
import type { Identite } from "@/lib/identite";

/**
 * Gabarit HTML commun des emails : simple, lisible sur mobile, couleurs du thème,
 * logo en en-tête (URL absolue + texte alternatif). Chaque email a aussi une version texte.
 *
 * **Le nom et le logo du club arrivent en second paramètre, ils ne sont pas dans le contenu.**
 * Les gabarits de messages (`auth.ts`, `seances.ts`…) restent des fonctions pures, synchrones et
 * testables ; l'identité, elle, vit en base (voir `src/lib/identite.ts`) et se lit au seul endroit
 * qui fabrique l'HTML final : le facteur (`src/lib/email/mailer.ts`), qui est asynchrone.
 */
export type EmailBouton = { label: string; url: string; couleur?: "bleu" | "vert" | "rouge" };

/**
 * Ce que le gabarit a besoin de savoir du club : comment le nommer, et où prendre son logo.
 * Le chemin est relatif (`/logo.png` ou une image déposée) : c'est ici qu'il devient absolu, un
 * client mail n'ayant aucune page de référence.
 */
export type ClubEmail = Pick<Identite, "nomClub" | "logo">;

export type EmailContenu = {
  titre: string;
  /** Paragraphes (texte brut, échappé) */
  paragraphes: string[];
  boutons?: EmailBouton[];
  /** Lignes du pied de mail (texte brut) ; les URL sont rendues en lien */
  piedDePage?: string[];
};

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Couleurs du site (parchemin) : encre, rouille, vert
const COULEURS = { bleu: "#AF4B2F", vert: "#2E7D45", rouge: "#AF4B2F" };

export function renderEmailHtml(c: EmailContenu, club: ClubEmail): string {
  /*
   * **Le logo est échappé comme le reste**. C'était la seule valeur du gabarit à entrer dans un
   * attribut sans passer par `escapeHtml` — le nom du club juste à côté, dans l'`alt` de la même
   * balise, l'était. Son chemin est aujourd'hui dérivé (empreinte du contenu déposé, ou l'un des
   * deux fichiers livrés), donc rien ne s'y injecte : c'est bien pour ça que ça n'a jamais rien
   * cassé, et bien pour ça que personne ne l'a vu. Une exception silencieuse dans un gabarit qui
   * échappe partout ailleurs est une invitation à la recopier ; le jour où le chemin du logo se
   * règle à la main, le guillemet fermant ouvrirait un attribut dans un email qui part à tout le
   * club.
   */
  const logo = escapeHtml(`${baseUrl()}${club.logo}`);
  const boutons = (c.boutons ?? [])
    .map(
      (b) =>
        `<a href="${escapeHtml(b.url)}" style="display:inline-block;margin:6px 8px 6px 0;padding:14px 22px;background:${COULEURS[b.couleur ?? "bleu"]};color:#ffffff;text-decoration:none;font-weight:bold;font-size:17px;border-radius:10px;">${escapeHtml(b.label)}</a>`,
    )
    .join("");
  const paragraphes = c.paragraphes
    .map((p) => `<p style="margin:0 0 14px 0;font-size:17px;line-height:1.5;color:#282828;">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
  const pied = (c.piedDePage ?? [])
    .map((l) => `<p style="margin:0 0 6px 0;font-size:13px;line-height:1.4;color:#6B6059;">${linkify(l)}</p>`)
    .join("");
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(c.titre)}</title>
</head>
<body style="margin:0;padding:0;background:#F4F0EE;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F0EE;">
<tr><td align="center" style="padding:16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFDFA;border-radius:14px;overflow:hidden;border:1px solid #D6CBBD;">
<tr><td align="center" style="background:#2B2622;padding:20px 16px;">
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 10px auto;"><tr><td style="background:#ffffff;border-radius:14px;padding:8px;">
<img src="${logo}" alt="${escapeHtml(club.nomClub)}" width="120" height="120" style="display:block;width:120px;height:auto;">
</td></tr></table>
<div style="color:#E6C977;font-size:20px;font-family:Georgia,'Times New Roman',serif;">${escapeHtml(club.nomClub)}</div>
</td></tr>
<tr><td style="padding:24px 20px 8px 20px;">
<h1 style="margin:0 0 16px 0;font-size:22px;line-height:1.3;color:#282828;font-family:Georgia,'Times New Roman',serif;">${escapeHtml(c.titre)}</h1>
${paragraphes}
${boutons ? `<div style="margin:18px 0 8px 0;">${boutons}</div>` : ""}
</td></tr>
<tr><td style="padding:12px 20px 20px 20px;border-top:1px solid #D6CBBD;">
${pied}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

/** La version texte n'a pas d'image : seul le nom du club lui est utile. */
export function renderEmailTexte(c: EmailContenu, club: Pick<Identite, "nomClub">): string {
  const lignes = [club.nomClub, "", c.titre, "", ...c.paragraphes.flatMap((p) => [p, ""])];
  for (const b of c.boutons ?? []) lignes.push(`${b.label} : ${b.url}`);
  if (c.boutons?.length) lignes.push("");
  lignes.push("—", ...(c.piedDePage ?? []));
  return lignes.join("\n");
}

function linkify(texte: string): string {
  return escapeHtml(texte).replace(
    /(https?:\/\/[^\s]+)/g,
    (url) => `<a href="${url}" style="color:#9A3F26;">${url}</a>`,
  );
}
