/**
 * **L'adresse du planning, en lecture ou en modification** — sans React, pour que la règle se
 * vérifie sans navigateur.
 *
 * Le mode modification vit dans l'URL (`?modifier=1`), comme le trimestre, la fenêtre de temps et
 * la date cherchée. Trois conséquences qui valent mieux qu'un état de composant : le **retour du
 * navigateur** sort du mode, un lien se partage tel qu'on le lit, et **la sortie sans écrire n'a
 * rien à défaire** — quitter l'adresse jette le brouillon, qui n'a jamais touché la base. C'est
 * d'ailleurs pour ça que cette sortie est un lien (« quitter sans appliquer »), montré seulement
 * quand il y a quelque chose à jeter, et non un troisième bouton à côté de la paire.
 *
 * **Ce que cette fonction garde, et c'est tout son objet : entrer en modification ne fait perdre
 * aucun filtre.** Le planning d'un club de quatre-vingts se regarde toujours filtré — un trimestre,
 * une fenêtre de deux semaines, parfois une date précise. Un lien qui repartirait de `/planning`
 * ramènerait la grille entière et obligerait à tout refiltrer avant de corriger la case qu'on avait
 * sous les yeux. C'est la même raison qui fait voyager la séance dans l'URL de `/admin/presences`.
 */
export type FiltresPlanning = { periode?: string; h?: string; quand?: string; date?: string; seances?: string };

export function lienPlanning(filtres: FiltresPlanning, edition: boolean): string {
  const q = new URLSearchParams();
  // L'ordre est fixe et les valeurs vides sont omises : deux lectures du même écran donnent la même
  // adresse, ce qui compte pour le cache du routeur comme pour un lien recopié à la main.
  if (filtres.periode) q.set("periode", filtres.periode);
  if (filtres.h) q.set("h", filtres.h);
  if (filtres.quand) q.set("quand", filtres.quand);
  if (filtres.date) q.set("date", filtres.date);
  if (filtres.seances) q.set("seances", filtres.seances);
  if (edition) q.set("modifier", "1");
  const suite = q.toString();
  return `/planning${suite ? `?${suite}` : ""}`;
}

/**
 * **Le mode, lu de l'URL.** Seul `1` ouvre la modification : toute autre valeur — `0`, `true`, un
 * reste de copier-coller — rend la lecture seule. Un écran de saisie ne s'ouvre pas sur un
 * à-peu-près, et c'est la même règle que les autres filtres de cet écran, qui retombent tous sur
 * leur valeur habituelle quand on leur donne n'importe quoi.
 */
export function modeEditionDemande(modifier: string | undefined): boolean {
  return modifier === "1";
}

/**
 * **Les séances choisies depuis l'onglet Séances** (`?seances=id1,id2`), lues de l'URL : des
 * identifiants, rien d'autre, et pas plus que ce qu'un lot de sélection peut porter. Une valeur
 * illisible vaut « pas de filtre » — comme les autres filtres de cet écran.
 */
export function lireSeancesChoisies(brut: string | undefined): string[] {
  if (!brut) return [];
  const ids = brut.split(",").map((s) => s.trim()).filter((s) => /^[A-Za-z0-9_-]{1,64}$/.test(s));
  return [...new Set(ids)].slice(0, 500);
}
