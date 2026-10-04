/**
 * **Les lieux habituels des cours** : la liste déroulante du formulaire de séance.
 *
 * **Pourquoi c'est un réglage et non une constante.** Les deux salles du club pour lequel l'outil a
 * été écrit étaient inscrites dans le code, adresses postales comprises. Un autre club n'a pas ces
 * salles, et un dépôt public n'a pas à porter l'adresse de qui que ce soit : la liste vit donc en
 * base, se règle dans l'espace admin, et **part vide**. Vide, le formulaire demande simplement le
 * nom et l'adresse à chaque séance — ce qui est exactement ce qu'il faut à un club qui n'a pas
 * encore dit où il s'entraîne.
 *
 * L'adresse sert au lien vers la carte, sur les cartes de séance et dans les emails : elle est
 * facultative, et sans elle le lieu s'affiche sans lien.
 *
 * **Ce module est pur** : aucune lecture de base, donc lisible depuis un composant client (le
 * sélecteur de lieu en est un). La lecture et l'écriture du réglage vivent dans
 * `src/lib/planning.ts`, à côté des thèmes du planning — le même écran les règle, et ce sont les deux
 * bouts du même vocabulaire de club.
 */
export type Lieu = {
  /** Clé stable, dérivée du nom : elle ne sert qu'à identifier l'entrée choisie dans la liste. */
  cle: string;
  lieu: string;
  adresse: string;
};

/** Plafonds de saisie : ceux des colonnes correspondantes de la base (`Session.lieu`, `Session.adresse`). */
export const LIEU_MAX = 120;
export const ADRESSE_MAX = 200;
/** Au-delà, ce n'est plus une liste déroulante mais un annuaire : on borne pour ne pas rendre l'écran illisible. */
export const LIEUX_MAX = 30;

/** Clé d'une entrée : le nom réduit à des lettres et des tirets, suffixé si deux noms se réduisent pareil. */
function cleDe(nom: string, prises: Set<string>): string {
  const base =
    nom
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "lieu";
  let cle = base;
  let n = 2;
  while (prises.has(cle)) cle = `${base}-${n++}`;
  prises.add(cle);
  return cle;
}

/**
 * Liste saisie (une ligne par lieu, `Nom | Adresse`) → liste propre.
 *
 * **Fonction pure**, vérifiée par les tests : c'est la seule règle de forme, et elle est la même à
 * l'enregistrement et à la relecture. Une ligne sans nom est ignorée ; l'adresse est facultative ;
 * deux lignes de même nom ne font qu'une entrée (la première gagne), sans quoi la liste déroulante
 * proposerait deux fois la même salle.
 */
export function nettoyerLieux(texte: string): Lieu[] {
  const prises = new Set<string>();
  const vus = new Set<string>();
  const liste: Lieu[] = [];
  for (const ligne of texte.split(/\r?\n/)) {
    if (liste.length >= LIEUX_MAX) break;
    // Le séparateur est la barre verticale : une adresse contient des virgules, pas des barres.
    const [brutLieu = "", ...reste] = ligne.split("|");
    const nom = brutLieu.trim().slice(0, LIEU_MAX);
    if (!nom) continue;
    const repere = nom.toLowerCase();
    if (vus.has(repere)) continue;
    vus.add(repere);
    liste.push({ cle: cleDe(nom, prises), lieu: nom, adresse: reste.join("|").trim().slice(0, ADRESSE_MAX) });
  }
  return liste;
}

/** Liste propre → texte de la zone de saisie (le chemin inverse de `nettoyerLieux`). */
export function lieuxEnTexte(lieux: Lieu[]): string {
  return lieux.map((l) => (l.adresse ? `${l.lieu} | ${l.adresse}` : l.lieu)).join("\n");
}

/** L'entrée de la liste qui porte ce nom de lieu, s'il y en a une. */
export function lieuConnu(lieux: Lieu[], lieu: string): Lieu | undefined {
  return lieux.find((l) => l.lieu === lieu);
}
