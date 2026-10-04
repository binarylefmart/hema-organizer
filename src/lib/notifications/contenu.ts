import { niveauAffiche, NIVEAU_DEFAUT, NIVEAU_LABELS, parseDisciplines, type Niveau } from "@/lib/constants";
import { formatDateLongue, formatHoraire } from "@/lib/dates";
import { baseUrl } from "@/lib/env";
import { calculerTaux, effectifAttendu, palierEffectif, PALIER_LABELS, type Compteurs } from "@/lib/presences";
import { COULEUR_BLEU, COULEUR_OR, COULEUR_ROUGE, type DiscordEmbed } from "./discord";

/**
 * **Contenu commun** des notifications de séance (cahier des charges § Notifications) : une seule
 * mise en forme, réutilisée par l'email de récap, l'embed Discord et — le jour venu — le partage
 * WhatsApp. Aucun nom de membre n'y figure jamais, seulement les chiffres.
 *
 * **Pourquoi le nom du club arrive en argument** (`nomClub`) : il n'est plus une constante du code
 * mais une donnée lue en base (`src/lib/identite.ts`), donc une lecture asynchrone. Rendre ces
 * fonctions asynchrones pour autant serait les payer cher — elles sont pures, testées sans base, et
 * appelées depuis des fonctions qui, elles, sont déjà asynchrones (récap, annulation, alerte). C'est
 * donc à l'appelant de faire `await identite()` et de passer le nom.
 *
 * 🗡️ Cours de demain 📅 Jeudi — 19h30 à 21h30 📍 Gymnase municipal 📖 Messer — garde haute ✅ 13
 * présents / 18 — 72 %
 */
export type SeanceResume = {
  date: string;
  heureDebut: string;
  heureFin: string;
  lieu: string;
  theme?: string | null;
  alternative?: string | null;
  disciplines?: string | null;
};

/**
 * Une case du programme réduite à ce qui est publiable : **le titre, jamais l'animateur**
 * (règle du projet : aucun nom de personne ne sort de l'application).
 *
 * Le programme voyage **à côté** du résumé de séance, jamais dedans : `SeanceResume` est repris tel
 * quel par les pages de partage et les écrans de gestion, qui ont déjà un champ `programme` d'une
 * autre forme (celui du planning, instructeurs compris). Deux formes sous le même nom finiraient
 * par se confondre — et c'est justement celle qui porte des noms qu'on ne veut pas voir ici.
 */
export type CaseProgramme = { label: string; theme: string; niveau: Niveau; atelier: boolean };

export type ChiffresSeance = { presents: number; invites: number };

/**
 * La **répartition complète** des réponses d'une séance : ce sont exactement les `Compteurs` de
 * `src/lib/presences.ts` (présents, absents, peut-être, sans réponse, taux). Rien n'est recalculé
 * ici — le récap Discord doit annoncer les mêmes chiffres que les cartes de l'application.
 */
export type RepartitionSeance = Compteurs;

/**
 * Programme d'une séance, dans l'ordre du planning, cases vides écartées ; le titre d'un atelier
 * remplace le thème de la case.
 *
 * Écrit ici plutôt que réutilisé depuis `src/lib/partage.ts` : ce module-là est celui des pages
 * publiques et tire des modules d'interface (icônes, libellés d'événements) qui n'ont rien à faire
 * dans le cron du soir. La règle qui compte — **ne jamais sélectionner un nom en base** — est tenue
 * par la requête (`invites.ts`), pas par cette mise en forme.
 */
export function programmeSeance(
  // `ordre` facultatif : les parties arrivent déjà triées par la requête (`orderBy: { ordre }`), et
  // ce module ne voit que des **libellés** — jamais un identifiant de partie, jamais un nom.
  parties: ReadonlyArray<{ libelle: string; ordre?: number; theme: string; niveau?: string | null; atelier: { titre: string } | null }>,
): CaseProgramme[] {
  const cases: CaseProgramme[] = [];
  for (const c of [...parties].sort((a, b) => (a.ordre ?? 0) - (b.ordre ?? 0))) {
    const titre = (c.atelier?.titre ?? "").trim() || c.theme.trim();
    if (!titre) continue;
    cases.push({ label: c.libelle, theme: titre, niveau: niveauAffiche(c.niveau) ?? NIVEAU_DEFAUT, atelier: Boolean(c.atelier) });
  }
  return cases;
}

export const TITRE_RECAP = "🗡️ Cours de demain";

/**
 * **Longueur au-delà de laquelle le thème d'une séance est écrêté.**
 *
 * 120 signes, c'est-à-dire exactement ce que le formulaire accepte pour un thème saisi à la main
 * (`seanceSchema`, `texteCourt(120)`). Le repli, lui, n'a jamais eu de plafond : `synchroniserSeance`
 * écrit `disciplines: themes.join(",")`, **un thème par partie**, et le nombre de parties d'une
 * séance n'est plus borné à quatre. Quatre parties donnaient ~260 signes au pire ; douze n'en
 * donnent aucune borne.
 *
 * Or ce thème est repris tel quel par **cinq** consommateurs, dont trois que quelqu'un d'autre
 * tronquera à notre place, et mal : l'**objet de l'email de récap** (coupé au milieu d'un mot par
 * le client mail, parfois au milieu d'une entité HTML), la **description Open Graph** des pages de
 * partage (coupée par le réseau qui l'affiche), le **texte WhatsApp**, le champ `theme` de l'**API
 * publique** et l'embed Discord. Écrêter proprement ici, une fois, vaut mieux que cinq coupes
 * arbitraires — et c'est la même famille de problème que les bornes de `discord.ts` : ce qui n'est
 * pas borné à la source finit par être refusé ou charcuté à l'arrivée.
 */
export const THEME_MAX = 120;

/**
 * Écrête un thème sans couper au milieu d'un mot : on recule jusqu'au dernier séparateur de liste
 * (« · ») ou, à défaut, jusqu'à la dernière espace, tant qu'on ne perd pas plus de la moitié. Les
 * points de suspension disent au lecteur que le programme continue.
 *
 * **La préférence pour le séparateur de liste était morte**. Elle s'écrivait
 * `Math.max(coupe.lastIndexOf(" · "), coupe.lastIndexOf(" "))` — or « · » *contient* une espace,
 * donc `lastIndexOf(" ")` est toujours supérieur ou égal à `lastIndexOf(" · ")` et le maximum
 * retenait l'espace, toujours. Le commentaire promettait une coupe par article de liste, le code
 * coupait à la dernière espace : « Messer · garde haute · bouclier » écrêté juste après le second
 * point médian donnait « Messer · garde haute ·… », un séparateur pendu devant les points de
 * suspension. C'est l'objet de l'email de récap, la description Open Graph des pages de partage et
 * le texte WhatsApp : ça se lit.
 *
 * On essaie donc le séparateur **d'abord**, on ne retombe sur l'espace que s'il coupe trop tôt, et on
 * n'abandonne jamais de séparateur en fin de chaîne.
 */
function ecreterTheme(texte: string, max = THEME_MAX): string {
  if (texte.length <= max) return texte;
  const coupe = texte.slice(0, max - 1);
  const separateur = coupe.lastIndexOf(" · ");
  const espace = coupe.lastIndexOf(" ");
  const point = separateur > max / 2 ? separateur : espace > max / 2 ? espace : coupe.length;
  return `${coupe.slice(0, point).replace(/[\s·]+$/u, "")}…`;
}

/**
 * Thème principal : le thème saisi, sinon les disciplines du planning, sinon rien (objets d'email).
 * Écrêté à {@link THEME_MAX} — voir pourquoi juste au-dessus.
 */
export function themePrincipal(s: SeanceResume): string {
  return ecreterTheme((s.theme ?? "").trim() || parseDisciplines(s.disciplines).join(" · "));
}

/** Thème affiché dans le contenu commun : thème principal, suivi de l'alternative s'il y en a une. */
export function themeSeance(s: SeanceResume): string {
  const base = themePrincipal(s);
  const alternative = (s.alternative ?? "").trim();
  if (!base) return alternative;
  return alternative ? `${base} (ou ${alternative})` : base;
}

/**
 * **Sépare une ligne (ou un titre) du contenu commun de son pictogramme de tête** :
 * « 📍 Villebourg » → `{ picto: "📍", texte: "Villebourg" }`, « Villebourg » → `{ picto: "", texte: "Villebourg" }`.
 *
 * Une seule expression régulière pour les deux besoins, parce qu'ils viennent du même endroit et
 * qu'une seconde copie dériverait : les **pages de partage** remplacent le pictogramme par l'icône
 * SVG correspondante (l'interface de l'application est sans emoji, `ligneSansPictogramme` dans
 * `src/lib/partage.ts`), et l'**API publique** rend les deux morceaux côte à côte, pour que le site
 * du club affiche « Cours de demain » avec son icône à lui s'il préfère.
 */
export function separerPictogramme(ligne: string): { picto: string; texte: string } {
  const m = ligne.match(/^(\p{Extended_Pictographic}️?)\s*(.*)$/u);
  return m ? { picto: m[1], texte: m[2].trim() } : { picto: "", texte: ligne.trim() };
}

/** "✅ 13 présents / 18 — 72 %" */
export function ligneChiffres(c: ChiffresSeance): string {
  return `✅ ${c.presents} présent${c.presents > 1 ? "s" : ""} / ${c.invites} — ${calculerTaux(c.presents, c.invites)} %`;
}

/** Les lignes du contenu commun, sans le titre (date, lieu, thème, chiffres). */
export function lignesSeance(s: SeanceResume, c: ChiffresSeance): string[] {
  const theme = themeSeance(s);
  return [
    `📅 ${formatDateLongue(s.date)} — ${formatHoraire(s.heureDebut, s.heureFin)}`,
    `📍 ${s.lieu}`,
    ...(theme ? [`📖 ${theme}`] : []),
    ligneChiffres(c),
  ];
}

/** Contenu commun complet (titre + lignes), en texte : emails version texte, WhatsApp, journaux. */
export function texteSeance(s: SeanceResume, c: ChiffresSeance, titre = TITRE_RECAP): string {
  return [titre, ...lignesSeance(s, c)].join("\n");
}

/* ------------------------------------------------------------------ */
/* Ce que le salon Discord porte en plus du contenu commun             */
/* ------------------------------------------------------------------ */

/**
 * **Pourquoi l'embed Discord diverge du contenu commun.**
 *
 * Les lignes communes (`lignesSeance`) sont écrites pour tenir dans un objet d'email, un message
 * WhatsApp et une page de partage : elles disent l'essentiel en quatre lignes. Le salon, lui, est
 * l'écran de pilotage du club la veille du cours — on y regarde « est-ce que ça se remplit ? »
 * avant d'ouvrir la salle. Un embed a la place de le dire (des champs, une mise en page), pas un
 * objet d'email.
 *
 * Les trois blocs ci-dessous sont donc **propres à Discord** et n'entrent pas dans `lignesSeance` :
 * l'email de récap, le partage WhatsApp et les pages publiques restent mot pour mot ce qu'ils
 * étaient. Aucun seuil ni aucune règle de calcul n'est recopié : tout vient de `presences.ts`, et la
 * part d'effectif du club **arrive en argument**, comme le nom du club — ces fonctions restent pures.
 */

/** "✅ 13 Présent · 🤔 3 Peut-être · ❌ 1 Absent · ⏳ 1 sans réponse" (jamais un nom, seulement des nombres). */
export function ligneRepartition(c: RepartitionSeance, separateur = " · "): string {
  return [`✅ ${c.presents} Présent`, `🤔 ${c.peutEtre} Peut-être`, `❌ ${c.absents} Absent`, `⏳ ${c.enAttente} sans réponse`].join(separateur);
}

/**
 * L'effectif attendu et le palier **en toutes lettres** : « ~7 attendus » puis « Bien rempli ».
 *
 * Le tilde n'est pas une coquetterie — `effectifAttendu` compte les confirmés plus la moitié des
 * « Peut-être » : c'est une estimation, et l'écrire « 7 » tout court en ferait une promesse. Le mot
 * du palier suit la même règle que les écrans : une couleur ne juge jamais un effectif toute seule,
 * elle est doublée du mot. Sur Discord, il ne reste que le mot — et c'est lui le « statut » demandé.
 */
export function ligneEffectif(c: RepartitionSeance, partEffectifMin: number): string {
  const palier = PALIER_LABELS[palierEffectif(c, partEffectifMin)];
  const attendus = `~${effectifAttendu(c)} attendus`;
  return palier ? `${attendus}\n**${palier}**` : attendus;
}

/**
 * "• Cours n°1 — Messer (Débutant)" — le libellé est celui que porte la partie, donc celui que
 * l'équipe voit dans le planning ; un atelier est annoncé comme tel (son titre, jamais son
 * animateur), et le niveau ne paraît que s'il dit quelque chose — « indifférent » se tait ici comme
 * partout ailleurs (`niveauAffiche`).
 *
 * Les deux précisions partagent une seule parenthèse : « Nœuds de corde (Avancé) (atelier) » se lit
 * comme deux commentaires collés l'un à l'autre.
 */
export function lignesProgramme(programme: readonly CaseProgramme[]): string[] {
  return programme.map((c) => {
    const niveau = niveauAffiche(c.niveau);
    const precisions = [niveau ? NIVEAU_LABELS[niveau] : null, c.atelier ? "atelier" : null].filter(Boolean);
    return `• ${c.label} — ${c.theme}${precisions.length > 0 ? ` (${precisions.join(", ")})` : ""}`;
  });
}

/** Les champs du récap Discord : répartition, effectif attendu + palier, et programme s'il est saisi. */
export function champsRecapDiscord(
  c: RepartitionSeance,
  partEffectifMin: number,
  programmeSaisi: readonly CaseProgramme[] = [],
): Array<{ name: string; value: string; inline?: boolean }> {
  const programme = lignesProgramme(programmeSaisi);
  return [
    // Côte à côte : « qui a répondu quoi » et « combien on attend », les deux questions du bureau.
    { name: "Réponses", value: ligneRepartition(c, "\n"), inline: true },
    { name: "Effectif attendu", value: ligneEffectif(c, partEffectifMin), inline: true },
    // Le programme, lui, prend toute la largeur : ce sont des phrases, pas des nombres.
    ...(programme.length > 0 ? [{ name: "📖 Programme", value: programme.join("\n") }] : []),
  ];
}

/**
 * Le contenu commun, en embed Discord (bleu de la charte ; username et avatar sont posés par
 * payloadDiscord), **augmenté du statut de remplissage et du programme** (voir ci-dessus).
 *
 * La description ne bouge pas : ce sont les lignes communes, suivies du lien pour répondre. Ce qui
 * s'ajoute vit dans des champs, sous le texte — un lecteur pressé lit les quatre premières lignes
 * comme avant, et celui qui prépare le cours trouve le reste dessous.
 */
export function embedSeance(
  s: SeanceResume,
  c: RepartitionSeance,
  nomClub: string,
  partEffectifMin: number,
  { programme = [], titre = TITRE_RECAP }: OptionsEmbedSeance = {},
): DiscordEmbed {
  return {
    title: titre,
    description: [...lignesSeance(s, c), "", `👉 Réponds en un appui : ${baseUrl()}/seances`].join("\n"),
    color: COULEUR_BLEU,
    fields: champsRecapDiscord(c, partEffectifMin, programme),
    footer: { text: nomClub },
  };
}

export type OptionsEmbedSeance = { programme?: readonly CaseProgramme[]; titre?: string };

export const TITRE_ANNULATION = "❌ Cours annulé";
export const TITRE_EFFECTIF = "⚠️ Peu de monde annoncé";

/**
 * **Titre d'une annonce d'événement** (stage, tournoi, démonstration).
 *
 * Il vivait dans `notifications/evenements.ts`, à côté de l'envoi. Il est remonté ici avec les
 * trois autres, quand le **site du club** est devenu un débouché de plus (canal `api`, `GET
 * /api/public/annonces`) : ce module-ci est pur — dates, mise en forme, rien d'autre —, tandis que
 * celui de l'envoi tire la base, la file d'emails et les salons. Une route publique n'a pas à
 * charger tout cela pour connaître un titre, et un titre recopié dans deux fichiers finit par
 * différer d'un fichier à l'autre.
 */
export const TITRE_EVENEMENT = "📣 Nouvel événement";

/** Champs communs « quand / où » d'un embed de séance. */
function champsQuandOu(s: SeanceResume): Array<{ name: string; value: string; inline?: boolean }> {
  return [
    { name: "📅 Quand", value: `${formatDateLongue(s.date)} — ${formatHoraire(s.heureDebut, s.heureFin)}` },
    { name: "📍 Où", value: s.lieu },
  ];
}

/**
 * **Annulation** (cahier des charges § Notifications → Discord) : message immédiat « ❌ Cours annulé »
 * avec la date, l'horaire, le lieu et le motif, en rouge de la charte (#A5472C).
 */
export function embedAnnulation(s: SeanceResume, motif: string, nomClub: string): DiscordEmbed {
  const theme = themeSeance(s);
  return {
    title: TITRE_ANNULATION,
    description: theme ? `Le cours « ${theme} » n'aura pas lieu.` : "Le cours n'aura pas lieu.",
    color: COULEUR_ROUGE,
    fields: [...champsQuandOu(s), { name: "💬 Motif", value: motif }],
    footer: { text: nomClub },
  };
}

/** **Alerte « peu de monde »** à l'équipe : les chiffres, sans nommer personne ni diffuser de lien d'annulation. */
export function embedEffectifFaible(s: SeanceResume, c: ChiffresSeance, sansReponse: number, nomClub: string): DiscordEmbed {
  return {
    title: TITRE_EFFECTIF,
    description: "Il reste de la place : un mot dans le groupe peut encore remplir la séance.",
    color: COULEUR_OR,
    fields: [
      ...champsQuandOu(s),
      { name: "Réponses", value: ligneChiffres(c) },
      { name: "Sans réponse", value: `${sansReponse}` },
    ],
    footer: { text: nomClub },
  };
}
