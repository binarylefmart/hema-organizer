import { describe, expect, it } from "vitest";
import { vuesDisponibles } from "@/components/accueil/vues";
import { encadreLeClub, estInstructeur, isStaff } from "@/lib/permissions";

/**
 * **La bascule de l'accueil suit la place dans le club, pas un droit**.
 *
 * Le défaut venait du modèle de rôles du 01/10 : la position « Club » était gardée par `isStaff`,
 * c'est-à-dire la permission `sessions.manage`, que `can()` accorde à **tout** administrateur. Un
 * administrateur dont le rôle de base est *membre* recevait donc la vue de l'encadrement — celle qui
 * ouvre sur « où ça se remplit et ce qu'il y a à préparer » — alors qu'il n'encadre pas.
 */
describe("les positions de la bascule de l'accueil", () => {
  it("un membre n'a que la sienne — et pas de bascule du tout", () => {
    // Une bascule à une position serait un bouton qui ne commande rien : c'est le composant qui la
    // cache, mais c'est cette liste qui le lui dit.
    expect(vuesDisponibles({ encadre: false, admin: false })).toEqual(["personnel"]);
  });

  it("un instructeur ouvre sur « Club », et garde la sienne", () => {
    // L'ordre compte : la première position est celle sur laquelle on ouvre.
    expect(vuesDisponibles({ encadre: true, admin: false })).toEqual(["club", "personnel"]);
  });

  it("un administrateur **membre** n'a pas « Club » : il pilote sans encadrer", () => {
    /*
     * Le cas qui manquait, et le seul que l'ancienne écriture rendait faux. Il ouvre sur
     * « Personnel » : la vue de pilotage se prend quand on vient piloter, elle ne s'impose pas à
     * l'ouverture de l'application.
     */
    expect(vuesDisponibles({ encadre: false, admin: true })).toEqual(["personnel", "admin"]);
  });

  it("un administrateur **instructeur** a bien les trois", () => {
    expect(vuesDisponibles({ encadre: true, admin: true })).toEqual(["club", "personnel", "admin"]);
  });

  it("et « Personnel » est la seule position que tout le monde possède", () => {
    for (const encadre of [false, true]) {
      for (const admin of [false, true]) {
        expect(vuesDisponibles({ encadre, admin }), `${encadre}/${admin}`).toContain("personnel");
      }
    }
  });
});

/**
 * **Les deux questions qu'il ne faut plus confondre.** `isStaff` demande « a-t-elle le droit
 * d'organiser ? » et répond oui à tout administrateur ; `estInstructeur` demande « encadre-t-elle ? »
 * et lit le **rôle de base**. Ce test garde la séparation : le jour où l'une se met à répondre comme
 * l'autre, la bascule de l'accueil repart en silence.
 */
/**
 * **Le compte global du déploiement a tous les rôles, pas seulement tous les droits**.
 *
 * Son rôle de base est `MEMBRE` et il n'enseigne pas : `estInstructeur` répond donc non, et c'est
 * juste — « encadrer » garde son sens strict pour les écrans qui nomment des instructeurs. Mais la
 * question de la vue n'est pas « enseigne-t-il ? », c'est « lui ouvre-t-on la vue de l'encadrement ? »,
 * et pour lui la réponse est oui. D'où une seconde question, nommée à part.
 */
describe("le compte global du déploiement", () => {
  const global = { role: "MEMBRE", estAdmin: true, actif: true, service: true } as const;

  it("voit le club comme l'encadrement, même avec un rôle de base de membre", () => {
    expect(encadreLeClub(global)).toBe(true);
    expect(estInstructeur(global)).toBe(false);
  });

  it("et a donc les trois positions quand il est élevé", () => {
    expect(vuesDisponibles({ encadre: encadreLeClub(global), admin: true })).toEqual(["club", "personnel", "admin"]);
  });

  it("alors qu'un administrateur-membre ordinaire n'en a que deux", () => {
    const duBureau = { role: "MEMBRE", estAdmin: true, actif: true, service: false } as const;
    expect(encadreLeClub(duBureau)).toBe(false);
    expect(vuesDisponibles({ encadre: encadreLeClub(duBureau), admin: true })).toEqual(["personnel", "admin"]);
  });

  it("et un compte désactivé n'encadre rien, même global", () => {
    expect(encadreLeClub({ ...global, actif: false })).toBe(false);
  });
});

describe("encadrer et avoir le droit d'organiser sont deux questions", () => {
  const membreDuBureau = { role: "MEMBRE", estAdmin: true, actif: true } as const;
  const instructeur = { role: "INSTRUCTEUR", estAdmin: false, actif: true } as const;
  const membre = { role: "MEMBRE", estAdmin: false, actif: true } as const;

  it("un administrateur-membre a le droit d'organiser, mais n'encadre pas", () => {
    expect(isStaff(membreDuBureau)).toBe(true);
    expect(estInstructeur(membreDuBureau)).toBe(false);
  });

  it("un instructeur encadre, qu'il soit du bureau ou non", () => {
    expect(estInstructeur(instructeur)).toBe(true);
    expect(estInstructeur({ ...instructeur, estAdmin: true })).toBe(true);
  });

  it("un membre ordinaire ni l'un ni l'autre, et un compte désactivé non plus", () => {
    expect(estInstructeur(membre)).toBe(false);
    expect(estInstructeur({ ...instructeur, actif: false })).toBe(false);
    expect(estInstructeur(null)).toBe(false);
    expect(estInstructeur(undefined)).toBe(false);
  });
});
