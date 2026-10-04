import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { can, canAssignRole, canEditUser, exigeSessionForte, isStaff, peutNommerAdmin, PERMISSIONS, type Permission } from "@/lib/permissions";
import { exigeDeuxFaConnexion, peutOuvrirSessionForte, peutSeConnecterParMotDePasse } from "@/lib/auth/acces-admin";

/**
 * **« Administrateur » n'est plus un rôle, c'est un supplément**. Les trois rôles étaient
 * exclusifs : nommer quelqu'un au bureau lui **retirait** son rôle d'instructeur, et le club ne
 * pouvait plus dire qu'un membre du bureau enseigne.
 *
 * Les acteurs d'épreuve suivent donc ce que la base porte désormais : un rôle de base — `MEMBRE` ou
 * `INSTRUCTEUR` — et, par-dessus, `estAdmin`. La valeur `"ADMIN"` ne s'écrit plus dans `role`.
 */
const admin = { id: "a", role: "MEMBRE", estAdmin: true, actif: true };
/** Le cas que l'ancien modèle rendait **impossible** : enseigner et siéger au bureau. */
const instructeurDuBureau = { id: "ia", role: "INSTRUCTEUR", estAdmin: true, actif: true };
const instructeur = { id: "i", role: "INSTRUCTEUR", actif: true };
const membre = { id: "m", role: "MEMBRE", actif: true };
/** Une ligne restée à l'ancien format, pour éprouver le repli de compatibilité de `can`. */
const adminALAncienne = { id: "al", role: "ADMIN", actif: true };

/**
 * **Quatre lignes ont quitté la matrice** : `recap.hour`, `whatsapp.share`,
 * `attendances.view_all` et `profile.own` n'étaient vérifiées nulle part, et deux disaient l'inverse
 * du code réel (le partage est ouvert à tout le monde, et la liste « Qui vient ? » est montrée à
 * chaque invité sur la carte de sa séance). Cette liste-ci ne contient donc plus que des permissions
 * qu'un `assertPermission` ou un `requirePermission` applique vraiment — c'est ce que vérifie
 * `tests/unit/gardes-serveur.test.ts`, qui balaie `src/actions/**`.
 */
const ORGANISATION: Permission[] = ["sessions.manage", "ateliers.moderate", "dashboard.view", "exports.csv"];
const TECHNIQUE: Permission[] = ["settings.technical", "admins.manage", "auth_sessions.revoke", "audit.view"];
// Écrire **à la place de quelqu'un d'autre** : ce n'est ni de l'organisation, ni de la technique.
// Régler ses notifications, corriger sa réponse de présence — le club engage la personne, donc
// c'est le bureau, pas l'encadrement (même doctrine pour les deux).
const AUTRUI: Permission[] = ["notifications.autrui", "attendances.autrui"];
/**
 * **Ce qui touche aux comptes et aux accès** : réservé au bureau.
 *
 * Le raisonnement, à garder en tête si l'on est tenté de rouvrir l'une de ces permissions à
 * l'encadrement : l'adresse email est l'endroit où arrive le lien personnel. Qui peut changer
 * l'adresse de quelqu'un **et** lui renvoyer son lien reçoit ce lien chez lui, et entre sous son
 * identité. Séparément anodins, les deux gestes ensemble valent un mot de passe.
 */
const COMPTES: Permission[] = ["members.view", "members.manage", "members.create", "members.activate", "members.delete", "invitations.manage"];
/**
 * **Le trimestre**, passé au bureau : l'ouvrir, engendrer ses séances, l'activer (donc envoyer son
 * lien à chaque membre) et l'effacer engagent le club. Un instructeur travaille *dans* le trimestre
 * — séances, planning, thèmes, présences — il ne l'ouvre pas.
 */
const PERIODES: Permission[] = ["periods.manage", "periods.delete"];

describe("matrice de permissions", () => {
  it("l'INSTRUCTEUR a les mêmes droits que l'ADMIN sur l'organisation", () => {
    for (const p of ORGANISATION) {
      expect(can(instructeur, p), p).toBe(true);
      expect(can(admin, p), p).toBe(true);
    }
  });

  it("réserve au bureau tout ce qui touche aux comptes et aux liens d'accès", () => {
    for (const p of COMPTES) {
      expect(can(instructeur, p), p).toBe(false);
      expect(can(admin, p), p).toBe(true);
    }
    // L'annuaire entier, lecture comprise, a rejoint l'espace admin : un instructeur voit qui vient
    // à un cours sur la séance elle-même, pas dans le registre des comptes.
    expect(can(instructeur, "members.view")).toBe(false);
  });

  /**
   * **Décider et effacer ne sont pas le même geste**. Placer un atelier dans le planning ou le
   * refuser est une réponse : elle part par email, et l'encadrement la prend (`ateliers.moderate`).
   * Effacer, c'est faire disparaître l'écrit d'un membre **sans réponse et sans que rien ne le lui
   * dise** — la même famille que désactiver un compte, donc le bureau.
   */
  it("l'encadrement décide d'un atelier, le bureau seul l'efface", () => {
    expect(can(instructeur, "ateliers.moderate")).toBe(true);
    expect(can(instructeur, "ateliers.supprimer")).toBe(false);
    expect(can(admin, "ateliers.supprimer")).toBe(true);
    expect(can(membre, "ateliers.supprimer")).toBe(false);
  });

  it("réserve au bureau l'ouverture et l'activation d'un trimestre", () => {
    for (const p of PERIODES) {
      expect(can(instructeur, p), p).toBe(false);
      expect(can(admin, p), p).toBe(true);
    }
  });

  it("l'INSTRUCTEUR n'a aucun droit technique, l'ADMIN les a tous", () => {
    for (const p of TECHNIQUE) {
      expect(can(instructeur, p), p).toBe(false);
      expect(can(admin, p), p).toBe(true);
    }
  });

  it("l'ADMIN seul écrit à la place de quelqu'un d'autre, l'INSTRUCTEUR jamais", () => {
    for (const p of AUTRUI) {
      expect(can(admin, p), p).toBe(true);
      expect(can(instructeur, p), p).toBe(false);
      expect(can(membre, p), p).toBe(false);
    }
  });

  it("le MEMBRE n'a que ses propres actions", () => {
    for (const p of [...ORGANISATION, ...TECHNIQUE, ...AUTRUI]) expect(can(membre, p), p).toBe(false);
    expect(can(membre, "attendances.own")).toBe(true); // sa réponse à lui, oui ; celle des autres, non
    expect(can(membre, "ateliers.propose")).toBe(true);
  });

  it("un compte inactif ou absent n'a aucun droit", () => {
    for (const p of Object.keys(PERMISSIONS) as Permission[]) {
      expect(can({ ...admin, actif: false }, p)).toBe(false);
      expect(can(null, p)).toBe(false);
    }
  });

  /**
   * **Le rôle de base s'attribue dans l'annuaire ; le bureau, nulle part ailleurs qu'à sa page**.
   * Avant, `canAssignRole(acteur, "ADMIN")` était la porte par laquelle on nommait un
   * administrateur — donc une **valeur** passée en argument décidait du geste le plus lourd du
   * dépôt. Elle est refusée : « administrateur » n'est plus un rôle qu'on attribue, et `estAdmin`
   * ne s'écrit que derrière `peutNommerAdmin`. Ce que ça ferme : une requête forgée qui demanderait
   * le rôle « ADMIN » à l'annuaire — l'annuaire n'a **aucun** chemin vers le bureau.
   */
  it("n'attribue que des rôles de base, et jamais le bureau", () => {
    expect(canAssignRole(admin, "MEMBRE")).toBe(true);
    expect(canAssignRole(admin, "INSTRUCTEUR")).toBe(true);
    expect(canAssignRole(admin, "ADMIN")).toBe(false);
    // Et aucune autre valeur : la frontière est une liste close, pas une politesse.
    for (const valeur of ["", "admin", "Admin", "SUPERADMIN", "INSTRUCTRICE"]) {
      expect(canAssignRole(admin, valeur), valeur).toBe(false);
    }
    // Un instructeur n'attribue plus aucun rôle : les fiches appartiennent au bureau
    expect(canAssignRole(instructeur, "INSTRUCTEUR")).toBe(false);
    expect(canAssignRole(instructeur, "MEMBRE")).toBe(false);
    expect(canAssignRole(membre, "MEMBRE")).toBe(false);
  });

  it("réserve la nomination d'un administrateur au bureau", () => {
    expect(peutNommerAdmin(admin)).toBe(true);
    expect(peutNommerAdmin(instructeurDuBureau)).toBe(true);
    expect(peutNommerAdmin(instructeur)).toBe(false);
    expect(peutNommerAdmin(membre)).toBe(false);
  });

  /**
   * **Les deux se cumulent, et c'est tout l'objet du changement** : un instructeur du bureau garde
   * ses droits d'instructeur *et* reçoit ceux du bureau. Dans l'ancien modèle, le second effaçait le
   * premier — un trésorier qui animait le mardi perdait le planning en acceptant le bureau.
   */
  it("additionne le rôle de base et le bureau", () => {
    for (const p of [...ORGANISATION, ...TECHNIQUE, ...COMPTES] as Permission[]) {
      expect(can(instructeurDuBureau, p), p).toBe(true);
    }
    // Un membre du bureau sans rôle d'instructeur a les mêmes droits : le bureau les donne tous.
    for (const p of ORGANISATION) expect(can(admin, p), p).toBe(true);
    // Et le supplément ne donne rien à qui ne l'a pas.
    for (const p of TECHNIQUE) expect(can(instructeur, p), p).toBe(false);
  });

  /**
   * **Une ligne restée en `role = "ADMIN"` garde ses droits.** Le repli n'est pas de la prudence
   * décorative : une base que la migration n'aurait pas traversée, un jeu d'essai écrit à l'ancienne,
   * et c'est l'accès au bureau qui tombe **sans un mot**. Il ne donne rien à personne d'autre, plus
   * aucun écran n'écrivant cette valeur.
   */
  it("reconnaît encore une ligne au format d'avant la migration", () => {
    for (const p of TECHNIQUE) expect(can(adminALAncienne, p), p).toBe(true);
    expect(peutNommerAdmin(adminALAncienne)).toBe(true);
  });

  it("un INSTRUCTEUR ne peut pas modifier un compte du bureau", () => {
    expect(canEditUser(instructeur, admin)).toBe(false);
    // Y compris quand ce compte porte un rôle de base d'instructeur, comme le sien : c'est le
    // supplément qui protège, et il se lit sur `estAdmin` — jamais plus sur le rôle.
    expect(canEditUser(instructeur, instructeurDuBureau)).toBe(false);
    expect(canEditUser(admin, instructeurDuBureau)).toBe(true);
    // …ni aucun autre compte, depuis que l'écriture sur une fiche est réservée au bureau
    expect(canEditUser(instructeur, membre)).toBe(false);
    expect(canEditUser(admin, instructeur)).toBe(true);
    expect(canEditUser(membre, membre)).toBe(false);
  });

  /**
   * Depuis que le mot de passe est ouvert à tous, la matrice doit répondre seule à la question « et
   * si un instructeur s'équipe comme un admin ? ». Elle ne regarde que le rôle : un mot de passe et
   * une double authentification ne sont pas des droits.
   */
  it("l'administration technique exige une session forte, que la matrice n'accorde qu'au rôle ADMIN", () => {
    for (const p of TECHNIQUE) expect(exigeSessionForte(p), p).toBe(true);
    // Les droits d'organisation, eux, fonctionnent avec une session par lien
    for (const p of ORGANISATION) expect(exigeSessionForte(p), p).toBe(false);
    // Les comptes, les liens et les trimestres sont des gestes de bureau : ils demandent l'élévation
    for (const p of [...COMPTES, ...PERIODES]) expect(exigeSessionForte(p), p).toBe(true);
    // …et un instructeur n'a de toute façon aucune de ces permissions, équipé ou non
    for (const p of TECHNIQUE) expect(can(instructeur, p), p).toBe(false);
  });

  /**
   * **La liste des exceptions à l'élévation**, figée ici parce que c'est la plus facile à élargir
   * sans y penser. Chaque entrée doit rester justifiée par la nature du geste — ni destructeur, ni
   * technique, défaisable d'un clic — et non par la commodité du moment.
   *
   * **Elle n'en compte plus qu'une.** `attendances.autrui` en est sortie : sans cela, un appel
   * forgé depuis une session ouverte par le **seul lien personnel** d'un administrateur ramène une
   * séance de onze réponses à zéro, puis déclare les douze invités présents. Le registre engage le
   * club — ses chiffres nourrissent les bilans —, et un email transféré suffirait. Ce qui rend le durcissement vivable
   * vit ailleurs, et les deux ne se séparent pas : ce qu'on exige est l'**espace admin ouvert** (pas
   * un code frais toutes les dix minutes), et **cocher une présence repousse l'élévation**
   * (`toucherElevation`, dans les deux actions de correction) — sans quoi elle tomberait au milieu
   * d'une liste, puisque la fiche d'une séance ne vit pas dans `/admin/**`.
   */
  it("n'exempte d'élévation que le seul geste « pour quelqu'un d'autre » qui ne touche à rien du club", () => {
    expect(exigeSessionForte("notifications.autrui")).toBe(false);
    // Corriger le registre, lui, exige l'espace admin ouvert.
    expect(exigeSessionForte("attendances.autrui")).toBe(true);
    // Tout le reste de ce qui est réservé au rôle ADMIN demande bien l'élévation
    for (const p of [...TECHNIQUE, ...COMPTES, ...PERIODES]) expect(exigeSessionForte(p), p).toBe(true);
    // …et une permission partagée avec l'encadrement ne la demande jamais
    for (const p of ORGANISATION) expect(exigeSessionForte(p), p).toBe(false);
    expect(exigeSessionForte("evenements.creer_supprimer")).toBe(false);
    expect(exigeSessionForte("planning.edit")).toBe(false);
  });

  it("un mot de passe et une double authentification n'ouvrent jamais de session forte à un non-ADMIN", () => {
    const equipe = { actif: true, email: "x@club.test", passwordHash: "$argon2id$x", totpSecret: "chiffre", totpActiveAt: new Date() };
    // Tous trois peuvent se connecter par mot de passe : c'est une porte, pas un droit
    for (const r of [admin, instructeur, membre]) expect(peutSeConnecterParMotDePasse({ ...r, ...equipe }), r.role).toBe(true);
    // Tous trois passent par le code s'ils ont activé la 2FA ; l'ADMIN y passe même sans
    // Une seule règle à la connexion, rôle compris : le code est demandé à qui l'a configuré.
    // Un ADMIN sans 2FA entre donc au mot de passe comme un membre — l'espace admin, lui, reste
    // fermé (il redemande les deux preuves sur `/connexion/admin`).
    expect(exigeDeuxFaConnexion({ ...admin, actif: true })).toBe(false);
    expect(exigeDeuxFaConnexion({ ...admin, ...equipe })).toBe(true);
    expect(exigeDeuxFaConnexion({ ...instructeur, actif: true })).toBe(false);
    expect(exigeDeuxFaConnexion({ ...instructeur, ...equipe })).toBe(true);
    // Mais la session forte ne suit que le rôle
    expect(peutOuvrirSessionForte({ ...admin, ...equipe })).toBe(true);
    expect(peutOuvrirSessionForte({ ...instructeur, ...equipe })).toBe(false);
    expect(peutOuvrirSessionForte({ ...membre, ...equipe })).toBe(false);
  });

  it("isStaff distingue l'équipe des membres", () => {
    expect(isStaff(admin)).toBe(true);
    expect(isStaff(instructeur)).toBe(true);
    expect(isStaff(membre)).toBe(false);
  });
});

/**
 * **Balayage : aucune ligne de la matrice ne dort.**
 *
 * Quatre y dormaient — `recap.hour`, `whatsapp.share`, `attendances.view_all`, `profile.own` —,
 * dont deux **affirmaient un droit que le code n'appliquait pas** : le partage est ouvert à tout le
 * monde (le résumé public ne porte aucun nom) et la liste « Qui vient ? » s'affiche à chaque invité
 * sur la carte de sa séance. Une matrice qui mentirait sur un droit est un piège pour la relecture
 * suivante : elle s'y fie et va chercher la faille ailleurs.
 *
 * On cherche donc chaque clé dans `src/**`, ailleurs que dans la matrice elle-même. Une permission
 * nouvelle arrive avec son `assertPermission` / `requirePermission` / `can`, ou elle n'arrive pas.
 */
describe("balayage : chaque permission déclarée est vérifiée quelque part", () => {
  const fichiers = (dossier: string): string[] =>
    fs.readdirSync(dossier, { withFileTypes: true }).flatMap((e) => {
      const complet = path.join(dossier, e.name);
      if (e.isDirectory()) return fichiers(complet);
      return /\.(ts|tsx)$/.test(e.name) && complet !== path.join(process.cwd(), "src/lib/permissions.ts") ? [complet] : [];
    });

  it("aucune permission morte", () => {
    const code = fichiers(path.join(process.cwd(), "src")).map((f) => fs.readFileSync(f, "utf8")).join("\n");
    const mortes = (Object.keys(PERMISSIONS) as Permission[]).filter((p) => !code.includes(`"${p}"`));
    expect(mortes).toEqual([]);
  });

  /**
   * **Et chacune est vérifiée PAR LE SERVEUR, pas seulement par un écran**.
   *
   * Le test ci-dessus cherchait la clé **n'importe où** dans `src/**` : un `can(user, "x")` qui cache
   * un bouton, une entrée de table de correspondance, voire une occurrence dans un commentaire le
   * satisfaisaient. Son nom promettait donc plus que son contenu — et une permission vérifiée
   * seulement à l'écran est exactement le piège que le balayage du 30/09 voulait fermer : le bouton
   * disparaît, l'action accepte.
   *
   * Ce que ce test exige : la clé en **argument** d'une des trois questions qui refusent
   * (`assertPermission`, `requirePermission`, `can`), dans un fichier qui **n'est pas un composant
   * client**. C'est la frontière qui compte : un `can()` dans un composant client cache un bouton,
   * le même dans une action ou une page serveur **refuse**. `attendances.own` est l'exemple du
   * second cas (`src/actions/presences.ts` : `if (!user || !can(user, "attendances.own")) return`),
   * et il est parfaitement gardé. Les deux permissions à n'avoir qu'un seul point d'application
   * (`dashboard.view`, `exports.csv`) l'ont bien côté serveur — vérifié à la main.
   */
  it("chaque permission est exigée hors d'un composant client, la clé en argument", () => {
    const cotServeur = fichiers(path.join(process.cwd(), "src"))
      .map((f) => fs.readFileSync(f, "utf8"))
      .filter((code) => !code.trimStart().startsWith('"use client"') && !code.trimStart().startsWith("'use client'"))
      .join("\n");
    const sansGardeServeur = (Object.keys(PERMISSIONS) as Permission[]).filter(
      (p) => !new RegExp(`(assertPermission|requirePermission|can)\\([^)]*"${p.replace(".", "\\.")}"`).test(cotServeur),
    );
    expect(sansGardeServeur).toEqual([]);
  });
});
