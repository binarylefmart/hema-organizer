"use server";

import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { AFFICHE_TAILLE_MAX, AFFICHE_TAILLE_MAX_LIBELLE, enregistrerAffiche, retirerMetadonnees, typeDepuisOctets } from "@/lib/affiches";
import { AccesRefuse, assertPermission, type CurrentUser } from "@/lib/auth/current-user";
import { touchSession } from "@/lib/auth/session";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { caseCochee, champ, zodToFormState, type FormState } from "@/lib/form";
import {
  CLUB_MAX,
  COULEUR_HEX,
  PART_EFFECTIF_MAX,
  PART_EFFECTIF_MIN,
  SIGLE_MAX,
  URL_IMAGE_DEPOSEE,
  enregistrerIdentite,
} from "@/lib/identite";
import { estThemeConnu } from "@/lib/themes";
import { z } from "zod";
import { fuseauValide, poserFuseau } from "@/lib/fuseau";
import { replanifierFuseau } from "@/lib/taches";

/**
 * **L'identité du club** : son nom, son sigle, son thème, sa couleur de marque, ses logos.
 *
 * Tout est réservé au bureau (`settings.technical`, donc élévation exigée) : ces réglages décident
 * de ce que voient **tous** les membres, du titre de l'onglet au nom de l'application installée sur
 * leur téléphone, et le logo part dans chaque email. Ce n'est pas de l'organisation courante.
 */

/**
 * **Deux gestes, deux actions** — scindées.
 *
 * Le nom, le sigle, le thème et la couleur de marque étaient **un seul `<form>`**, enregistré d'un
 * bloc par une seule action (`enregistrerIdentiteClub`). L'écran « Club » se lit en deux piles — à
 * gauche **ce que le club est** (son nom entier, son sigle), à droite **comment il se montre** (son
 * thème, sa couleur de marque, ses deux logos) —, et deux colonnes ne peuvent pas se partager un
 * `<form>` : la carte de gauche s'intitulait donc « Nom » tout en portant le thème et la couleur, et
 * les deux logos vivaient dans l'autre colonne, loin du thème avec lequel ils vont. Un titre qui
 * mentait sur son contenu, ce que le dépôt s'interdit ailleurs.
 *
 * **Les deux moitiés gardent exactement les verrous de l'action d'origine**, et c'est la seule
 * manière de scinder un chemin d'écriture : `assertPermission("settings.technical")` (donc
 * l'élévation, qu'`exigeSessionForte` attache à cette permission), validation Zod **côté serveur**,
 * entrée de journal d'audit, `revalidatePath("/", "layout")`. Deux chemins aux règles différentes,
 * ce serait une porte dérobée d'un côté ou une fonctionnalité morte de l'autre.
 *
 * **Deux noms d'audit distincts, et c'est le point qui compte.** `identite.modifiee` ne disait pas
 * *quoi* — ce qui n'avait pas d'importance tant qu'un seul geste écrivait les quatre champs. Avec
 * deux gestes, la même entrée pour les deux aurait fait perdre au journal la seule chose qu'on lui
 * demande : savoir laquelle a changé quoi. D'où `identite.noms_modifies` et
 * `identite.apparence_modifiee`.
 *
 * **Rien ne s'efface l'un l'autre** : `enregistrerIdentite` écrit un **patch partiel** (il fusionne
 * avec le réglage en base), exactement comme la part d'effectif le fait.
 */

/** Les champs de nommage sont facultatifs : vidés, ils rendent la main au nom livré avec le code. */
const schemaNoms = z.object({
  club: z.string().trim().max(CLUB_MAX, `Le nom du club ne peut pas dépasser ${CLUB_MAX} caractères.`),
  sigle: z.string().trim().max(SIGLE_MAX, `Le sigle ne peut pas dépasser ${SIGLE_MAX} caractères.`),
});

/** Ce dont le club s'habille : son thème, et une couleur de marque facultative. */
const schemaApparence = z.object({
  theme: z.string().refine(estThemeConnu, "Thème inconnu."),
  /** Vide = « la couleur du thème », ce qui est le cas de départ et un choix légitime. */
  marque: z.union([z.literal(""), z.string().regex(COULEUR_HEX, "La couleur doit s'écrire #rrggbb.")]),
});

/**
 * **Ce que le club est** : son nom entier et son sigle.
 *
 * `revalidatePath("/", "layout")` et pas `"/admin/identite"` : **toute l'application** porte ce nom —
 * l'en-tête de chaque page, le titre de l'onglet, le manifeste de l'application installée. Invalider
 * ce seul écran aurait laissé l'ancien nom affiché partout ailleurs jusqu'au prochain rechargement
 * complet.
 */
export async function enregistrerNomsClub(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await assertPermission("settings.technical");
  const analyse = schemaNoms.safeParse({ club: champ(fd, "club"), sigle: champ(fd, "sigle") });
  if (!analyse.success) return zodToFormState(analyse.error);
  const v = analyse.data;
  await enregistrerIdentite({ club: v.club, sigle: v.sigle });
  await audit(user, "identite.noms_modifies", null, { club: v.club, sigle: v.sigle });
  revalidatePath("/", "layout");
  return { succes: "Nom enregistré." };
}

/**
 * **Comment le club se montre** : son thème et sa couleur de marque.
 *
 * Même `revalidatePath("/", "layout")` que les noms, et pour une raison jumelle : le thème décide des
 * couleurs de **tous** les membres qui n'ont rien choisi dans leur profil, et la couleur de marque
 * colore l'en-tête de chaque page.
 */
export async function enregistrerApparenceClub(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await assertPermission("settings.technical");
  const analyse = schemaApparence.safeParse({
    theme: champ(fd, "theme"),
    // La case décide, le sélecteur ne fait que proposer une valeur : un `<input type="color">` ne
    // sait pas dire « aucune couleur », et il en renvoie toujours une (noir, à défaut). Sans cette
    // case, on ne pourrait plus jamais revenir à la couleur du thème après l'avoir quittée.
    marque: caseCochee(fd, "marquePersonnalisee") ? champ(fd, "marque").trim().toLowerCase() : "",
  });
  if (!analyse.success) return zodToFormState(analyse.error);
  const v = analyse.data;
  await enregistrerIdentite({ theme: v.theme, marque: v.marque || null });
  await audit(user, "identite.apparence_modifiee", null, { theme: v.theme, marque: v.marque || "thème" });
  revalidatePath("/", "layout");
  return { succes: "Apparence enregistrée." };
}

/**
 * Dépôt d'un logo (complet ou écu). Rien n'est écrit en base ici : l'action renvoie l'URL, et c'est
 * `definirLogo` qui la retient — même découpage que l'affiche d'un événement, pour la même raison
 * (on veut pouvoir regarder l'image avant de la garder).
 *
 * Doctrine de sécurité, reprise telle quelle de `televerserAffiche` : le type vient des **octets de
 * tête** et jamais du navigateur, le SVG est refusé (servi depuis notre origine, il peut porter du
 * script), et les métadonnées — dont la position GPS d'une photo — sont retirées avant écriture.
 */
export async function televerserLogo(formData: FormData): Promise<{ ok: true; url: string } | { ok: false; erreur: string }> {
  let user: CurrentUser;
  try {
    user = await assertPermission("settings.technical");
  } catch (e) {
    if (e instanceof AccesRefuse) return { ok: false, erreur: "Seuls les administrateurs peuvent changer le logo." };
    return { ok: false, erreur: "Impossible de vérifier tes droits : reconnecte-toi." };
  }
  if (!(await checkRateLimit("affiche_televersement_user", user.id))) {
    return { ok: false, erreur: "Trop d'images déposées d'un coup. Réessaie dans quelques minutes." };
  }
  const fichier = formData.get("fichier");
  if (!(fichier instanceof File) || fichier.size === 0) return { ok: false, erreur: "Aucune image reçue." };
  if (fichier.size > AFFICHE_TAILLE_MAX) return { ok: false, erreur: `L'image dépasse ${AFFICHE_TAILLE_MAX_LIBELLE}.` };
  const octets = new Uint8Array(await fichier.arrayBuffer());
  const type = typeDepuisOctets(octets);
  if (!type) return { ok: false, erreur: "Format non reconnu : dépose une image JPEG, PNG ou WebP." };
  try {
    const propre = retirerMetadonnees(octets, type);
    const url = await enregistrerAffiche(propre, type);
    await audit(user, "identite.logo_televerse", null, { octets: propre.byteLength, type });
    await touchSession();
    return { ok: true, url };
  } catch (e) {
    console.error("[televerserLogo] échec de l'enregistrement", e);
    return { ok: false, erreur: "L'enregistrement de l'image a échoué. Réessaie." };
  }
}

/**
 * **La part minimale d'effectif du club** : en dessous de quelle part des invités un cours ne vaut
 * guère la peine d'ouvrir la salle.
 *
 * `z.coerce` parce qu'un champ de formulaire rend toujours une chaîne. Les bornes portent leur propre
 * message : c'est un nombre que l'on tape, et « entre 5 et 50 % » est la seule chose utile à répondre
 * à qui a tapé 0 ou 200.
 */
const schemaPart = z.object({
  partEffectifMin: z.coerce
    .number({ message: "La part doit être un nombre." })
    .int("La part s'exprime en pourcentage entier.")
    .min(PART_EFFECTIF_MIN, `La part ne peut pas descendre en dessous de ${PART_EFFECTIF_MIN} %.`)
    .max(PART_EFFECTIF_MAX, `La part ne peut pas dépasser ${PART_EFFECTIF_MAX} %.`),
});

/**
 * Enregistre la part minimale d'effectif.
 *
 * **Un formulaire à part**, et non un champ de plus dans celui des noms : ce n'est pas une question
 * d'identité visuelle mais une décision d'organisation — la part en dessous de laquelle on n'ouvre
 * pas la salle —, et il n'y a aucune raison qu'enregistrer un logo redemande cette part ni l'inverse.
 * Les deux formulaires partagent le même réglage en base (`enregistrerIdentite` écrit un patch
 * partiel), donc rien ne s'efface l'un l'autre.
 */
export async function enregistrerPartEffectifClub(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await assertPermission("settings.technical");
  const analyse = schemaPart.safeParse({ partEffectifMin: champ(fd, "partEffectifMin") });
  if (!analyse.success) return zodToFormState(analyse.error);
  const { partEffectifMin } = analyse.data;
  await enregistrerIdentite({ partEffectifMin });
  await audit(user, "identite.part_effectif_modifiee", null, { partEffectifMin });
  // La part colore la jauge de chaque séance, la frise de l'accueil et les fiches des prochains
  // cours : c'est toute l'application qu'il faut revalider, pas ce seul écran.
  revalidatePath("/", "layout");
  return { succes: `Part enregistrée : ${partEffectifMin} % de l'effectif invité.` };
}

/**
 * **Le fuseau horaire du club.** Un formulaire à lui, comme la part d'effectif : c'est un réglage
 * d'organisation (où le club s'entraîne), pas d'apparence.
 *
 * Il prend effet **tout de suite** : la valeur est posée côté serveur (`poserFuseau`), l'entretien du
 * matin et la sauvegarde de la nuit repartent dans le nouveau fuseau (`replanifierFuseau`), et toute
 * l'application est revalidée — la mise en page racine porte le fuseau du navigateur
 * (`<html data-fuseau>`). Les séances déjà créées ne bougent pas : leurs heures sont des heures
 * locales, elles s'entendent désormais dans le nouveau fuseau.
 */
export async function enregistrerFuseauClub(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await assertPermission("settings.technical");
  const fuseau = champ(fd, "fuseau").trim();
  if (!fuseauValide(fuseau)) return { erreur: "Ce fuseau horaire n'est pas reconnu.", erreurs: { fuseau: "Choisis un fuseau dans la liste." } };
  await enregistrerIdentite({ fuseau });
  poserFuseau(fuseau);
  replanifierFuseau(fuseau);
  await audit(user, "identite.fuseau_modifie", null, { fuseau });
  revalidatePath("/", "layout");
  return { succes: `Fuseau enregistré : ${fuseau}.` };
}

/** Les deux emplacements de logo : le grand (pages de connexion, emails) et le carré (en-tête, icône). */
const CHAMPS_LOGO = { logo: "logoUrl", ecu: "ecuUrl" } as const;
type ChampLogo = keyof typeof CHAMPS_LOGO;

/**
 * Retient l'image déposée à l'emplacement demandé, ou **rend la main au fichier livré** quand `url`
 * est vide (bouton « Remettre le logo d'origine »).
 *
 * L'URL est revérifiée côté serveur contre `URL_IMAGE_DEPOSEE` : elle arrive du navigateur, et une
 * valeur libre finirait en `src` d'une balise `<img>`, dans le manifeste PWA et dans des emails.
 */
export async function definirLogo(emplacement: ChampLogo, url: string): Promise<FormState> {
  const user = await assertPermission("settings.technical");
  // Dans un fichier `"use server"`, chaque export est une route : l'argument vient du réseau, et son
  // type TypeScript ne le contraint pas à l'exécution. D'où la comparaison littérale plutôt qu'une
  // lecture dans l'objet — `CHAMPS_LOGO["__proto__"]` répondrait quelque chose, et non `undefined`.
  if (emplacement !== "logo" && emplacement !== "ecu") return { erreur: "Emplacement de logo inconnu." };
  const cle = CHAMPS_LOGO[emplacement];
  const valeur = url.trim();
  if (valeur && !URL_IMAGE_DEPOSEE.test(valeur)) return { erreur: "Cette image n'a pas été déposée ici." };
  await enregistrerIdentite({ [cle]: valeur || null });
  await audit(user, valeur ? "identite.logo_change" : "identite.logo_retire", null, { emplacement });
  revalidatePath("/", "layout");
  return { succes: valeur ? "Logo enregistré." : "Logo d'origine rétabli." };
}
