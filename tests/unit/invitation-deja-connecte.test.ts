import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { entrerMalgreLienInvalide, revocationDeSecurite, type InvitationCheck } from "@/lib/invitations";

/**
 * **Ouvrir l'application depuis un lien périmé, quand on est déjà connecté.**
 *
 * Le cas réel : l'application est installée sur l'écran d'accueil **depuis la page du lien**, et
 * selon la version d'iOS l'icône rouvre cette adresse plutôt que `start_url`. Des mois plus tard le
 * jeton a expiré — mais la session vaut 60 jours et n'a rien à voir avec le lien. Lui répondre «
 * regarde ta boîte mail » serait absurde : elle voulait ouvrir son application, et elle est déjà
 * dedans.
 *
 * Ce que ce fichier verrouille :
 * - session valide + lien expiré → on entre, et **aucun email** n'est renvoyé ;
 * - pas de session + lien expiré → le comportement d'avant, à la virgule près (nouveau lien envoyé) ;
 * - lien révoqué pour **raison de sécurité** → le message reste, même à quelqu'un de connecté ;
 * - jeton **inconnu** → le comptage anti-robot et la journalisation ont lieu **avant** qu'on regarde
 *   la session : pas d'angle mort pour qui teste des jetons depuis un compte valide.
 */

type Echec = Extract<InvitationCheck, { ok: false }>;
const REF = { id: "inv-1", userId: "u-1", periodId: "per-1" };
const expire: Echec = { ok: false, raison: "expiree", invitation: REF };
const revoque = (motif: Echec["motifRevocation"]): Echec => ({ ok: false, raison: "revoquee", invitation: REF, motifRevocation: motif });

describe("lien périmé ouvert depuis l'application installée", () => {
  it("laisse entrer quelqu'un qui a déjà une session", () => {
    expect(entrerMalgreLienInvalide(expire, true)).toBe(true);
  });

  /**
   * **Le renouvellement se propose, il ne part plus au rendu**. Ce test exigeait
   * `renouvelerLien(check.invitation)` **dans la page**, c'est-à-dire pendant le rendu d'un GET :
   * les messageries préchargent les liens d'un email, et le vieil email suffisait donc à déclencher
   * un envoi que personne n'avait demandé. Ce qui se vérifie ici n'a pas changé de nature — qui n'a
   * pas de session n'entre pas sur un lien expiré —, mais la suite est devenue un **écran avec un
   * bouton**, et la page ne doit plus écrire du tout.
   */
  it("ne change rien pour qui n'a pas de session, et la page ne renvoie rien d'elle-même", () => {
    expect(entrerMalgreLienInvalide(expire, false)).toBe(false);
    const page = sourcePage();
    // Aucune écriture au rendu : la page monte l'écran, le bouton (POST) fait le geste.
    expect(page).not.toContain("renouvelerLien(");
    expect(page).toContain("<RenvoyerLienExpire token={token} />");
  });

  it("vaut pour tout jeton refusé, pas seulement l'expiration", () => {
    for (const raison of ["format", "inconnue", "inactif"] as const) {
      expect(entrerMalgreLienInvalide({ ok: false, raison }, true), raison).toBe(true);
      expect(entrerMalgreLienInvalide({ ok: false, raison }, false), raison).toBe(false);
    }
  });
});

describe("gardes qui ne se relâchent pas", () => {
  it("garde le message d'un lien révoqué pour raison de sécurité, même connecté", () => {
    for (const motif of ["SUSPECT", "APPAREILS", "REMPLACE"] as const) {
      expect(revocationDeSecurite(motif), motif).toBe(true);
      expect(entrerMalgreLienInvalide(revoque(motif), true), motif).toBe(false);
    }
  });

  it("laisse en revanche entrer sur un lien révoqué à la main ou par clôture", () => {
    for (const motif of ["MANUEL", "CLOTURE"] as const) {
      expect(revocationDeSecurite(motif), motif).toBe(false);
      expect(entrerMalgreLienInvalide(revoque(motif), true), motif).toBe(true);
    }
    expect(revocationDeSecurite(null)).toBe(false);
  });

  /**
   * L'ordre est une règle de sécurité, pas de présentation : un jeton inconnu doit être compté et
   * journalisé **avant** qu'on regarde s'il y a une session, sinon un navigateur connecté servirait
   * de paravent à qui balaie des jetons.
   */
  it("compte et journalise un jeton inconnu avant de regarder la session", () => {
    const code = sourcePage();
    const compteur = code.indexOf('checkRateLimit("invitation_inconnue_ip"');
    const trace = code.indexOf('"invitation.lien_inconnu"');
    const session = code.indexOf("await getCurrentUser()");
    expect(compteur).toBeGreaterThan(-1);
    expect(trace).toBeGreaterThan(-1);
    expect(session).toBeGreaterThan(-1);
    expect(compteur).toBeLessThan(session);
    expect(trace).toBeLessThan(session);
  });
});

/** L'écran reste mince : la décision est dans `src/lib`, on ne vérifie ici que l'enchaînement. */
function sourcePage(): string {
  return fs.readFileSync(path.join(process.cwd(), "src/app/(public)/invitation/[token]/page.tsx"), "utf8");
}

/* ---------------------------------------------------------------- */
/* « J'ai reçu un lien par email — colle-le ici » (page de connexion) */
/* ---------------------------------------------------------------- */

describe("lien collé à la main", () => {
  /**
   * Pourquoi ce champ : sur iPhone, l'application installée sur l'écran d'accueil a un stockage
   * séparé de Safari, et un lien touché dans Mail ouvre Safari — jamais l'icône. Sans ce champ,
   * quelqu'un sans mot de passe reste bloqué devant l'écran de connexion de l'application.
   */
  it("accepte le lien entier comme le jeton seul", async () => {
    const { jetonDuLienColle } = await import("@/lib/invitations");
    const jeton = "demo-invitation-membre-existant-0123456789abcdefgh";
    expect(jetonDuLienColle(jeton)).toBe(jeton);
    expect(jetonDuLienColle(`  ${jeton}  `)).toBe(jeton); // collé avec des espaces autour
    expect(jetonDuLienColle(`https://organizer.mon-club.fr/invitation/${jeton}`)).toBe(jeton);
    expect(jetonDuLienColle(`https://organizer.mon-club.fr/invitation/${jeton}?suite=%2Fseances`)).toBe(jeton);
    expect(jetonDuLienColle(`http://localhost:3000/invitation/${jeton}#ancre`)).toBe(jeton);
  });

  it("refuse tout le reste, sans rien deviner", async () => {
    const { jetonDuLienColle } = await import("@/lib/invitations");
    for (const saisie of ["", "   ", "bonjour", "https://evil.tld/invitation/trop-court", "https://x.fr/autre/chose", null, undefined, 42]) {
      expect(jetonDuLienColle(saisie), String(saisie)).toBeNull();
    }
  });

  /** Ce champ ne doit pas devenir le guichet tranquille où l'on essaie des jetons. */
  it("compte et journalise un jeton inconnu, et ne recopie jamais la saisie", () => {
    const code = fs.readFileSync(path.join(process.cwd(), "src/actions/auth.ts"), "utf8");
    const action = code.slice(code.indexOf("export async function ouvrirParLienColle"));
    const corps = action.slice(0, action.indexOf("\n}\n"));
    expect(corps).toContain('checkRateLimit("invitation_ip"');
    expect(corps).toContain('checkRateLimit("invitation_inconnue_ip"');
    expect(corps).toContain('"invitation.lien_inconnu"');
    // Tout repasse par le chemin du lien : surtout pas un second parcours d'authentification
    expect(corps).toContain("connexionParInvitation(");
    // Ni le message d'erreur ni le journal ne réinjectent ce qui a été saisi
    expect(corps).not.toMatch(/erreur:.*\btoken\b/);
    expect(corps).not.toMatch(/audit\([^)]*\btoken\b/);
    expect(corps).not.toContain("champ(fd, \"lien\")}");
  });

  /** Après « Copier mon lien », on arrive ici avec le champ en évidence — et sans jeton dans l'URL. */
  it("met le champ en évidence quand on arrive du bouton de copie", () => {
    const page = fs.readFileSync(path.join(process.cwd(), "src/app/(public)/connexion/page.tsx"), "utf8");
    expect(page).toContain('lien === "copie"');
    expect(page).toContain("<FormulaireLienColle enEvidence />");
    // Une session déjà ouverte ne doit pas renvoyer vers l'accueil dans ce cas précis :
    // la personne est venue tout exprès pour coller son lien dans l'application installée.
    expect(page).toContain("if (user && !elevation && !lienCopie) redirect(");
    const formulaire = fs.readFileSync(path.join(process.cwd(), "src/app/(public)/connexion/FormulaireLienColle.tsx"), "utf8");
    // …ou quand on demande soi-même à changer de lien : dans les deux cas, il n'y a plus qu'à coller
    expect(formulaire).toContain("autoFocus={enEvidence || modifie}");
  });

  /**
   * **Le lien collé reste sur l'appareil**, parce qu'une session ne dure plus que 12 h : sans cette
   * mémoire, il faudrait retourner chercher son email chaque matin — surtout dans l'application
   * installée sur iPhone, qui n'a même pas de barre d'adresse.
   */
  it("garde le lien pour la fois suivante, et l'oublie quand il ne vaut plus rien", () => {
    const formulaire = fs.readFileSync(path.join(process.cwd(), "src/app/(public)/connexion/FormulaireLienColle.tsx"), "utf8");
    expect(formulaire).toContain("memoriserLien(lien)");
    // Il ne s'affiche jamais en entier : sa fin suffit à reconnaître le sien
    expect(formulaire).toContain("apercuLien(memorise)");
    expect(formulaire).toContain('<input type="hidden" name="lien" value={memorise} />');
    // Un lien refusé est oublié : un bouton qui échoue à chaque appui n'aide personne
    expect(formulaire).toContain("oublierLienMemorise();");
    /*
     * **Et « Se déconnecter » ne l'efface plus**. Il le faisait, au nom d'une distinction qui
     * semblait juste — fermer l'application n'est pas s'en aller. À l'usage elle est fausse : on se
     * déconnecte de son **propre** téléphone cent fois pour une fois qu'on rend celui d'un autre,
     * et chacune de ces fois renvoyait chercher son email, sans barre d'adresse où recoller quoi
     * que ce soit. Le geste du téléphone prêté n'a pas disparu, il s'appelle « Oublier » et il est
     * sur l'écran de connexion — là même où la déconnexion dépose. Le détail est gardé par
     * `tests/unit/lien-memorise.test.ts`.
     */
    expect(formulaire).toMatch(/>\s*Oublier\s*</);
  });
});
