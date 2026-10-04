import { describe, expect, it } from "vitest";

/**
 * **L'expéditeur des emails, nettoyé**.
 *
 * Le cas vécu : plus aucun lien ne partait, et le journal des envois disait
 * `501 5.1.7 Bad sender address syntax`. La cause n'était pas dans le code mais dans la stack : les
 * **guillemets** de `.env.example` recopiés dans une variable Portainer, qui ne les retire pas comme
 * le ferait un fichier `.env`. L'expéditeur valait `"Le club <contact@…>"`, guillemets compris, et le
 * serveur refusait l'enveloppe.
 *
 * Une paire de guillemets ne doit pas couper les emails de tout un club : on nettoie ce qui peut
 * l'être, et ce qui ne ressemble à aucune adresse retombe sur celle du domaine plutôt que de faire
 * échouer l'envoi.
 *
 * **Le nom d'affichage du repli est celui du club** (dernier paramètre) : il n'est plus écrit dans le
 * code. Omis, c'est le nom livré avec l'outil — cette fonction reste synchrone et ne lit pas la base.
 */
const { normaliserExpediteur } = await import("@/lib/env");
const { NOM_APP_LIVRE } = await import("@/lib/constants");

const DOMAINE = "organizer.club-exemple.fr";
const REPLI = `${NOM_APP_LIVRE} <no-reply@${DOMAINE}>`;
const PROPRE = "Les Compagnons d'Armes <contact@club-exemple.fr>";

describe("expéditeur des emails", () => {
  it("retire les guillemets qui entourent toute la valeur (le piège de Portainer)", () => {
    expect(normaliserExpediteur(`"${PROPRE}"`, DOMAINE)).toBe(PROPRE);
    expect(normaliserExpediteur(`'${PROPRE}'`, DOMAINE)).toBe(PROPRE);
  });

  it("laisse intacte une valeur déjà propre", () => {
    expect(normaliserExpediteur(PROPRE, DOMAINE)).toBe(PROPRE);
  });

  it("accepte une adresse seule, avec ou sans espaces autour", () => {
    expect(normaliserExpediteur("  contact@club-exemple.fr  ", DOMAINE)).toBe("contact@club-exemple.fr");
  });

  it("retire aussi les guillemets du seul nom d'affichage", () => {
    expect(normaliserExpediteur(`"Les Compagnons d'Armes" <contact@club-exemple.fr>`, DOMAINE)).toBe(PROPRE);
  });

  it("retombe sur l'adresse du domaine quand il n'y a pas d'adresse reconnaissable", () => {
    for (const valeur of ["", "   ", "Les Compagnons", "contact(at)club-exemple.fr", '"" <>']) {
      expect(normaliserExpediteur(valeur, DOMAINE)).toBe(REPLI);
    }
  });

  it("ne garde pas le port du domaine dans l'adresse de repli", () => {
    expect(normaliserExpediteur("", `${DOMAINE}:3000`)).toBe(REPLI);
  });

  /**
   * Beaucoup de serveurs n'acceptent d'envoyer qu'au nom du compte authentifié : le repli tape donc
   * d'abord dans `SMTP_USER`, sans quoi on remplacerait un refus par un autre.
   */
  it("se rabat sur la boîte authentifiée avant d'inventer une adresse sur le domaine", () => {
    expect(normaliserExpediteur("Les Compagnons", DOMAINE, "contact@club-exemple.fr")).toBe(`${NOM_APP_LIVRE} <contact@club-exemple.fr>`);
    // Un identifiant qui n'est pas une adresse (nom d'utilisateur simple) ne sert pas d'expéditeur
    expect(normaliserExpediteur("", DOMAINE, "compte-smtp")).toBe(REPLI);
  });

  /** Le club a un nom : c'est lui qui s'affiche dans la boîte du destinataire, pas le nom livré. */
  it("affiche le nom de l'application du club dans le repli", () => {
    expect(normaliserExpediteur("", DOMAINE, "", "Compagnons Organizer")).toBe(`Compagnons Organizer <no-reply@${DOMAINE}>`);
    expect(normaliserExpediteur("", DOMAINE, "contact@club-exemple.fr", "Compagnons Organizer")).toBe("Compagnons Organizer <contact@club-exemple.fr>");
  });
});
