import { describe, expect, it } from "vitest";
import { ECU_LIVRE, LOGO_LIVRE, PART_EFFECTIF_MAX, PART_EFFECTIF_MIN, resoudreIdentite, URL_IMAGE_DEPOSEE } from "@/lib/identite";
import { NOM_APP_LIVRE, PART_EFFECTIF_LIVREE, SIGLE_LIVRE } from "@/lib/constants";

/**
 * L'identité du club est la pièce qui rend l'outil installable par un autre club : ces tests
 * portent sur `resoudreIdentite`, la **fonction pure** qui décide du nom affiché à partir de ce qui
 * est réglé en base, de ce que dit l'environnement, et de ce qui est livré avec le code. Aucune base
 * n'est nécessaire — c'est précisément pour cela que la règle est isolée là.
 */
describe("resoudreIdentite", () => {
  it("sans rien de réglé, l'application porte son nom livré", () => {
    const i = resoudreIdentite(null);
    expect(i.nomCourt).toBe(NOM_APP_LIVRE);
    // Sans nom de club, le nom long ne fabrique pas de tiret cadratin dans le vide.
    expect(i.nomLong).toBe(NOM_APP_LIVRE);
    expect(i.club).toBe("");
    // Ce qui *désigne le club* retombe sur le nom de l'application : les emails et les embeds
    // Discord ont besoin d'un nom, et « — Organizer » seul n'en est pas un.
    expect(i.nomClub).toBe(NOM_APP_LIVRE);
    expect(i.sigle).toBe(SIGLE_LIVRE);
  });

  it("le club réglé donne les trois noms", () => {
    const i = resoudreIdentite({ club: "Mon club d'AMHE", sigle: "HEMA" });
    expect(i.nomCourt).toBe("HEMA Organizer");
    expect(i.nomLong).toBe("Mon club d'AMHE — Organizer");
    expect(i.nomClub).toBe("Mon club d'AMHE");
  });

  it("l'environnement nomme une instance neuve, le réglage l'emporte ensuite", () => {
    const env = { club: "Cercle d'escrime ancienne", sigle: "CEA" };
    expect(resoudreIdentite(null, env).nomCourt).toBe("CEA Organizer");
    expect(resoudreIdentite({ sigle: "CÉA" }, env).nomCourt).toBe("CÉA Organizer");
    // Un champ vidé dans l'écran de réglage **rend la main** à l'environnement : c'est ce que veut
    // dire « effacer », et un `??` à la place du `||` aurait gardé la chaîne vide comme réponse.
    expect(resoudreIdentite({ club: "", sigle: "" }, env).nomClub).toBe("Cercle d'escrime ancienne");
  });

  /**
   * **« Organizer » est le nom de l'outil, pas celui du club** : il ne se règle pas. Ce qui change
   * d'un club à l'autre, c'est le sigle qui le précède. Un réglage qui prétendrait le remplacer —
   * une base modifiée à la main, une version antérieure — est ignoré.
   */
  it("« Organizer » ne se remplace pas", () => {
    // @ts-expect-error — champ volontairement absent du type réglable
    expect(resoudreIdentite({ sigle: "HEMA", suffixe: "Présences" }).nomCourt).toBe("HEMA Organizer");
    // @ts-expect-error — idem
    expect(resoudreIdentite({ club: "Club X", sigle: "CX", suffixe: "Présences" }).nomLong).toBe("Club X — Organizer");
  });

  it("les espaces autour des noms ne comptent pas", () => {
    const i = resoudreIdentite({ club: "  Club X  ", sigle: " CX " });
    expect(i.club).toBe("Club X");
    expect(i.nomCourt).toBe("CX Organizer");
  });

  it("sans logo déposé, les images livrées", () => {
    const i = resoudreIdentite({});
    expect(i.logo).toBe(LOGO_LIVRE);
    expect(i.ecu).toBe(ECU_LIVRE);
    expect(i.logoDepose).toBe(false);
    expect(i.ecuDepose).toBe(false);
  });

  it("un logo déposé est servi, et se reconnaît", () => {
    const url = `/api/affiche/${"a".repeat(64)}.png`;
    const i = resoudreIdentite({ logoUrl: url });
    expect(i.logo).toBe(url);
    expect(i.logoDepose).toBe(true);
    expect(i.ecu).toBe(ECU_LIVRE);
  });

  /**
   * **Le point de sécurité de ce module.** Ces deux valeurs finissent en `src` d'une balise `<img>`,
   * dans le manifeste PWA et dans des emails HTML : une URL arbitraire y ferait entrer un serveur
   * tiers (l'IP de chaque membre lui serait livrée à chaque chargement), voire un `javascript:`.
   * Tout ce qui n'est pas un chemin d'image déposée chez nous est **ignoré**, pas affiché.
   */
  it("une URL qui n'est pas une image déposée ici est refusée", () => {
    for (const mechant of [
      "https://exemple.invalide/logo.png",
      "javascript:alert(1)",
      "/api/affiche/../../etc/passwd",
      "/api/affiche/pas-un-sha.png",
      `/api/affiche/${"a".repeat(64)}.svg`,
      `/api/affiche/${"A".repeat(64)}.png`, // hexadécimal en majuscules : pas le nom que nous écrivons
      "",
    ]) {
      expect(URL_IMAGE_DEPOSEE.test(mechant)).toBe(false);
      const i = resoudreIdentite({ logoUrl: mechant, ecuUrl: mechant });
      expect(i.logo).toBe(LOGO_LIVRE);
      expect(i.ecu).toBe(ECU_LIVRE);
      expect(i.logoDepose).toBe(false);
    }
  });

  it("un thème inconnu retombe sur le thème livré, un thème connu est gardé", () => {
    expect(resoudreIdentite({ theme: "dracula" }).theme).toBe("dracula");
    // @ts-expect-error — valeur volontairement hors catalogue, comme le ferait une base abîmée
    expect(resoudreIdentite({ theme: "fuchsia-clignotant" }).theme).toBe("parchemin");
  });

  it("la couleur de marque n'est retenue qu'en #rrggbb", () => {
    expect(resoudreIdentite({ marque: "#E6C977" }).marque).toBe("#e6c977");
    expect(resoudreIdentite({ marque: "rouge" }).marque).toBe(null);
    expect(resoudreIdentite({ marque: "#fff" }).marque).toBe(null);
    expect(resoudreIdentite({ marque: null }).marque).toBe(null);
  });

  /**
   * **La part minimale d'effectif** : « en dessous de 4 présents, on n'ouvre pas la salle » était vrai
   * du club pour lequel l'outil a été écrit, et faux d'un club de quatre-vingts — où l'alerte ne
   * serait jamais partie. C'est un réglage, et comme tous les autres il **retombe sur la valeur
   * livrée** dès qu'il n'est pas utilisable : une part fausse ne doit jamais éteindre l'alerte « peu
   * de monde » ni la faire partir pour tous les cours du trimestre.
   */
  it("sans rien de réglé, la part est celle livrée", () => {
    expect(resoudreIdentite(null).partEffectifMin).toBe(PART_EFFECTIF_LIVREE);
    expect(resoudreIdentite({}).partEffectifMin).toBe(20);
  });

  it("la part réglée par le club l'emporte, aux bornes comprises", () => {
    expect(resoudreIdentite({ partEffectifMin: 30 }).partEffectifMin).toBe(30);
    expect(resoudreIdentite({ partEffectifMin: PART_EFFECTIF_MIN }).partEffectifMin).toBe(PART_EFFECTIF_MIN);
    expect(resoudreIdentite({ partEffectifMin: PART_EFFECTIF_MAX }).partEffectifMin).toBe(PART_EFFECTIF_MAX);
  });

  it("une part hors bornes est ignorée, pas fatale", () => {
    for (const absurde of [0, -3, PART_EFFECTIF_MIN - 1, PART_EFFECTIF_MAX + 1, 1000]) {
      expect(resoudreIdentite({ partEffectifMin: absurde }).partEffectifMin).toBe(PART_EFFECTIF_LIVREE);
    }
  });

  it("une part qui n'est pas un entier est ignorée : le réglage se tape en pourcents entiers", () => {
    for (const absurde of [20.5, Number.NaN, Number.POSITIVE_INFINITY, "20", null, undefined]) {
      // @ts-expect-error — valeurs volontairement hors type, comme le ferait une base modifiée à la main
      expect(resoudreIdentite({ partEffectifMin: absurde }).partEffectifMin).toBe(PART_EFFECTIF_LIVREE);
    }
  });

  /**
   * **La reprise du réglage d'hier.** Il s'appelait `seuilEffectif` et valait un nombre de
   * *personnes* (4 à l'installation). Il n'y a rien à convertir — « 4 » ne dit pas sur quel effectif
   * il portait — et le réglage repart donc de 20 %. Ce qui compte, c'est que la base d'un club déjà
   * installé ne fasse rien tomber : le champ inconnu est simplement laissé de côté.
   */
  it("un réglage d'hier, en personnes, ne casse rien et repart de la part livrée", () => {
    // @ts-expect-error — la forme d', telle qu'elle dort encore en base
    const identite = resoudreIdentite({ seuilEffectif: 4, sigle: "HEMA" });
    expect(identite.partEffectifMin).toBe(PART_EFFECTIF_LIVREE);
    expect(identite.sigle).toBe("HEMA");
  });
});
