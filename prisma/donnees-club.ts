/**
 * **Jeu de démonstration du dépôt public — engendré, jamais saisi.**
 *
 * Douze **places** (`Alpha 01` … `Juliett 12`), une période de rentrée, seize séances et leurs
 * réponses. Aucune personne, réelle ou inventée : des places, et un calendrier calculé. Les rangs
 * 06, 07 et 08 partagent un prénom, comme trois homonymes d'un club de démonstration.
 *
 * Les adresses sont en `@club.test`, un domaine que la norme réserve et qui ne sera jamais
 * joignable. Les réponses sont tirées d'un hachage stable, avec une assiduité propre à chaque
 * place pour que les taux, les séries et les blasons aient l'allure d'un vrai trimestre.
 *
 * Les séances tombent le **mercredi soir** et le **samedi matin**, seize fois sur la période.
 *
 * C'est ce que `npm run db:seed:demo` installe pour découvrir l'application sans rien saisir —
 * et c'est le fichier à remplacer par vos propres membres si vous voulez une démonstration à vos
 * couleurs. **Ne le lancez jamais sur une base qui contient vos vraies données** : il les efface
 * (un garde-fou vous arrête, voir `prisma/garde-demonstration.ts`).
 *
 * ENGENDRÉ par `engendrer-donnees-publiques.py` de la fabrique du dépôt public : ne pas éditer
 * à la main, la prochaine fabrication écraserait la retouche.
 */

/** Nom du club posé par le jeu de démonstration : une base neuve n'en a pas, et les écrans l'attendent. */
export const CLUB_DEMO = { club: "Mon club d'AMHE", sigle: "HEMA" } as const;

/**
 * `auClubMois` : depuis combien de mois la place est au club, en saisons pleines (multiples de 12).
 *
 * **Un rôle de base, et « du bureau » en supplément** : `role` ne vaut plus jamais
 * `"ADMIN"` — cette valeur a été déplacée dans `estAdmin` par la migration
 * `role_de_base_et_admin_en_supplement`. Les trois rôles étaient exclusifs, si bien que nommer
 * quelqu'un au bureau lui **retirait** son rôle d'instructeur : un club ne pouvait plus dire qu'un
 * membre du bureau enseigne, alors que c'est le cas le plus courant dans une petite association. Les
 * deux droits s'additionnent désormais, et ce jeu d'essai le montre : la place du bureau qui enseigne
 * garde `INSTRUCTEUR`, les deux autres restent `MEMBRE`.
 */
export type MembreClub = { prenom: string; nom: string; email: string; role: "INSTRUCTEUR" | "MEMBRE"; estAdmin?: boolean; auClubMois: number };

export const MEMBRES_CLUB: MembreClub[] = [
  { prenom: "Alpha", nom: "01", email: "alpha@club.test", role: "MEMBRE", auClubMois: 24 },
  { prenom: "Bravo", nom: "02", email: "bravo@club.test", role: "MEMBRE", auClubMois: 12 },
  { prenom: "Charlie", nom: "03", email: "charlie@club.test", role: "INSTRUCTEUR", auClubMois: 48 },
  { prenom: "Delta", nom: "04", email: "delta@club.test", role: "INSTRUCTEUR", estAdmin: true, auClubMois: 96 },
  { prenom: "Echo", nom: "05", email: "echo@club.test", role: "MEMBRE", estAdmin: true, auClubMois: 72 },
  { prenom: "Foxtrot", nom: "06", email: "foxtrot06@club.test", role: "MEMBRE", estAdmin: true, auClubMois: 84 },
  { prenom: "Foxtrot", nom: "07", email: "foxtrot07@club.test", role: "INSTRUCTEUR", auClubMois: 36 },
  { prenom: "Foxtrot", nom: "08", email: "foxtrot08@club.test", role: "MEMBRE", auClubMois: 24 },
  { prenom: "Golf", nom: "09", email: "golf@club.test", role: "MEMBRE", auClubMois: 12 },
  { prenom: "Hotel", nom: "10", email: "hotel@club.test", role: "MEMBRE", auClubMois: 0 },
  { prenom: "India", nom: "11", email: "india@club.test", role: "MEMBRE", auClubMois: 0 },
  { prenom: "Juliett", nom: "12", email: "juliett@club.test", role: "INSTRUCTEUR", auClubMois: 36 },
];

export type SeanceClub = { date: string; heureDebut: string; reponses: Array<[email: string, statut: "PRESENT" | "PEUT_ETRE" | "ABSENT"]> };

export const SEANCES_CLUB: SeanceClub[] = [
  { date: "2026-09-02", heureDebut: "19:30", reponses: [["alpha@club.test", "ABSENT"], ["bravo@club.test", "ABSENT"], ["charlie@club.test", "PEUT_ETRE"], ["delta@club.test", "PRESENT"], ["echo@club.test", "PRESENT"], ["foxtrot06@club.test", "PRESENT"], ["foxtrot07@club.test", "PRESENT"], ["foxtrot08@club.test", "PRESENT"], ["golf@club.test", "PRESENT"], ["hotel@club.test", "PEUT_ETRE"], ["india@club.test", "ABSENT"], ["juliett@club.test", "PRESENT"]] },
  { date: "2026-09-05", heureDebut: "10:00", reponses: [["alpha@club.test", "PRESENT"], ["bravo@club.test", "PRESENT"], ["charlie@club.test", "PRESENT"], ["delta@club.test", "PRESENT"], ["echo@club.test", "PRESENT"], ["foxtrot06@club.test", "ABSENT"], ["foxtrot07@club.test", "ABSENT"], ["foxtrot08@club.test", "PRESENT"], ["golf@club.test", "PEUT_ETRE"], ["hotel@club.test", "PEUT_ETRE"], ["india@club.test", "PRESENT"], ["juliett@club.test", "PRESENT"]] },
  { date: "2026-09-09", heureDebut: "19:30", reponses: [["alpha@club.test", "ABSENT"], ["bravo@club.test", "PRESENT"], ["charlie@club.test", "PRESENT"], ["delta@club.test", "PRESENT"], ["echo@club.test", "ABSENT"], ["foxtrot06@club.test", "PRESENT"], ["foxtrot07@club.test", "ABSENT"], ["foxtrot08@club.test", "PRESENT"], ["golf@club.test", "PRESENT"], ["hotel@club.test", "ABSENT"], ["india@club.test", "PEUT_ETRE"], ["juliett@club.test", "PRESENT"]] },
  { date: "2026-09-12", heureDebut: "10:00", reponses: [["alpha@club.test", "ABSENT"], ["bravo@club.test", "PRESENT"], ["charlie@club.test", "ABSENT"], ["delta@club.test", "ABSENT"], ["echo@club.test", "PRESENT"], ["foxtrot06@club.test", "ABSENT"], ["foxtrot07@club.test", "ABSENT"], ["foxtrot08@club.test", "PRESENT"], ["golf@club.test", "ABSENT"], ["hotel@club.test", "PRESENT"], ["india@club.test", "ABSENT"], ["juliett@club.test", "PRESENT"]] },
  { date: "2026-09-16", heureDebut: "19:30", reponses: [["alpha@club.test", "PRESENT"], ["bravo@club.test", "ABSENT"], ["charlie@club.test", "PRESENT"], ["delta@club.test", "PEUT_ETRE"], ["echo@club.test", "PRESENT"], ["foxtrot06@club.test", "PRESENT"], ["foxtrot07@club.test", "ABSENT"], ["foxtrot08@club.test", "PRESENT"], ["golf@club.test", "PRESENT"], ["hotel@club.test", "PEUT_ETRE"], ["india@club.test", "PRESENT"], ["juliett@club.test", "PRESENT"]] },
  { date: "2026-09-19", heureDebut: "10:00", reponses: [["alpha@club.test", "ABSENT"], ["bravo@club.test", "PRESENT"], ["charlie@club.test", "ABSENT"], ["delta@club.test", "PRESENT"], ["echo@club.test", "PRESENT"], ["foxtrot06@club.test", "ABSENT"], ["foxtrot07@club.test", "PRESENT"], ["foxtrot08@club.test", "PRESENT"], ["golf@club.test", "ABSENT"], ["hotel@club.test", "PRESENT"], ["india@club.test", "PRESENT"], ["juliett@club.test", "PRESENT"]] },
  { date: "2026-09-23", heureDebut: "19:30", reponses: [["alpha@club.test", "PRESENT"], ["bravo@club.test", "PRESENT"], ["charlie@club.test", "PRESENT"], ["delta@club.test", "PRESENT"], ["echo@club.test", "PRESENT"], ["foxtrot06@club.test", "PRESENT"], ["foxtrot07@club.test", "PRESENT"], ["foxtrot08@club.test", "ABSENT"], ["golf@club.test", "PRESENT"], ["hotel@club.test", "ABSENT"], ["india@club.test", "PRESENT"], ["juliett@club.test", "PRESENT"]] },
  { date: "2026-09-26", heureDebut: "10:00", reponses: [["alpha@club.test", "PRESENT"], ["bravo@club.test", "PRESENT"], ["charlie@club.test", "PRESENT"], ["delta@club.test", "PEUT_ETRE"], ["echo@club.test", "PEUT_ETRE"], ["foxtrot06@club.test", "PRESENT"], ["foxtrot07@club.test", "PRESENT"], ["foxtrot08@club.test", "PRESENT"], ["golf@club.test", "PRESENT"], ["hotel@club.test", "ABSENT"], ["india@club.test", "PEUT_ETRE"], ["juliett@club.test", "ABSENT"]] },
  { date: "2026-09-30", heureDebut: "19:30", reponses: [["alpha@club.test", "ABSENT"], ["bravo@club.test", "PEUT_ETRE"], ["charlie@club.test", "ABSENT"], ["delta@club.test", "PEUT_ETRE"], ["echo@club.test", "ABSENT"], ["foxtrot06@club.test", "ABSENT"], ["foxtrot07@club.test", "PRESENT"], ["foxtrot08@club.test", "ABSENT"], ["golf@club.test", "PRESENT"], ["hotel@club.test", "PRESENT"], ["india@club.test", "PRESENT"], ["juliett@club.test", "PRESENT"]] },
  { date: "2026-10-03", heureDebut: "10:00", reponses: [["alpha@club.test", "PEUT_ETRE"], ["bravo@club.test", "PEUT_ETRE"], ["charlie@club.test", "PEUT_ETRE"], ["delta@club.test", "PRESENT"], ["echo@club.test", "PEUT_ETRE"], ["foxtrot06@club.test", "PRESENT"], ["foxtrot07@club.test", "PRESENT"], ["foxtrot08@club.test", "ABSENT"], ["golf@club.test", "ABSENT"], ["hotel@club.test", "ABSENT"], ["india@club.test", "ABSENT"], ["juliett@club.test", "PEUT_ETRE"]] },
  { date: "2026-10-07", heureDebut: "19:30", reponses: [["alpha@club.test", "ABSENT"], ["bravo@club.test", "ABSENT"], ["charlie@club.test", "ABSENT"], ["delta@club.test", "PRESENT"], ["echo@club.test", "PRESENT"], ["foxtrot06@club.test", "ABSENT"], ["foxtrot07@club.test", "PRESENT"], ["foxtrot08@club.test", "PRESENT"], ["golf@club.test", "PRESENT"], ["hotel@club.test", "ABSENT"], ["india@club.test", "PRESENT"], ["juliett@club.test", "ABSENT"]] },
  { date: "2026-10-10", heureDebut: "10:00", reponses: [["alpha@club.test", "PEUT_ETRE"], ["bravo@club.test", "PRESENT"], ["charlie@club.test", "ABSENT"], ["delta@club.test", "ABSENT"], ["echo@club.test", "PRESENT"], ["foxtrot06@club.test", "PRESENT"], ["foxtrot07@club.test", "PRESENT"], ["foxtrot08@club.test", "PRESENT"], ["golf@club.test", "PRESENT"], ["hotel@club.test", "ABSENT"], ["india@club.test", "ABSENT"], ["juliett@club.test", "ABSENT"]] },
  { date: "2026-10-14", heureDebut: "19:30", reponses: [["alpha@club.test", "PEUT_ETRE"], ["bravo@club.test", "PRESENT"], ["charlie@club.test", "PEUT_ETRE"], ["delta@club.test", "PRESENT"], ["echo@club.test", "PRESENT"], ["foxtrot06@club.test", "PRESENT"], ["foxtrot07@club.test", "PRESENT"], ["foxtrot08@club.test", "PRESENT"], ["golf@club.test", "ABSENT"], ["hotel@club.test", "ABSENT"], ["india@club.test", "PEUT_ETRE"], ["juliett@club.test", "PEUT_ETRE"]] },
  { date: "2026-10-17", heureDebut: "10:00", reponses: [["alpha@club.test", "PEUT_ETRE"], ["bravo@club.test", "ABSENT"], ["charlie@club.test", "ABSENT"], ["delta@club.test", "PRESENT"], ["echo@club.test", "PRESENT"], ["foxtrot06@club.test", "PRESENT"], ["foxtrot07@club.test", "PRESENT"], ["foxtrot08@club.test", "PRESENT"], ["golf@club.test", "PRESENT"], ["hotel@club.test", "ABSENT"], ["india@club.test", "PRESENT"], ["juliett@club.test", "PEUT_ETRE"]] },
  { date: "2026-10-21", heureDebut: "19:30", reponses: [["alpha@club.test", "PRESENT"], ["bravo@club.test", "ABSENT"], ["charlie@club.test", "PRESENT"], ["delta@club.test", "PRESENT"], ["echo@club.test", "PRESENT"], ["foxtrot06@club.test", "ABSENT"], ["foxtrot07@club.test", "PRESENT"], ["foxtrot08@club.test", "PRESENT"], ["golf@club.test", "PRESENT"], ["hotel@club.test", "ABSENT"], ["india@club.test", "PRESENT"], ["juliett@club.test", "ABSENT"]] },
  { date: "2026-10-24", heureDebut: "10:00", reponses: [["alpha@club.test", "ABSENT"], ["bravo@club.test", "ABSENT"], ["charlie@club.test", "PRESENT"], ["delta@club.test", "ABSENT"], ["echo@club.test", "ABSENT"], ["foxtrot06@club.test", "PEUT_ETRE"], ["foxtrot07@club.test", "PRESENT"], ["foxtrot08@club.test", "PRESENT"], ["golf@club.test", "ABSENT"], ["hotel@club.test", "ABSENT"], ["india@club.test", "ABSENT"], ["juliett@club.test", "PRESENT"]] },
];
