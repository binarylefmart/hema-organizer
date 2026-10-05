/**
 * **Sélectionner des lignes dans une liste** — la mécanique commune, sans React ni base de données.
 *
 * Deux écrans s'en servent, et c'est tout l'intérêt qu'ils partagent le même module : la correction
 * des réponses en masse (`/admin/presences`) et le changement de rôle en masse (`/admin/membres`).
 * Un bureau qui apprend le geste sur l'un doit le retrouver sur l'autre — même case maîtresse à
 * trois états, mêmes libellés, même règle.
 *
 * **La règle qui tient tout : la sélection ne porte que sur ce qui est affiché.** Le résultat de la
 * recherche en cours et les lignes dépliées, jamais la liste entière en silence. D'où des libellés
 * qui **nomment ce sur quoi la case agit** ({@link libelleToutSelectionner}) plutôt qu'un « Tout »
 * qui ne dit rien de ce qu'il emporte.
 *
 * Ce module est lu par des composants client : il ne dépend de rien, et surtout pas d'un module qui
 * toucherait à `node:crypto` — l'entraîner dans le bundle du navigateur ferait échouer
 * `npm run build`, ce que ni `tsc` ni les tests ne voient.
 */

/* ------------------------------------------------------------------ */
/* Cocher, décocher                                                    */
/* ------------------------------------------------------------------ */

/**
 * Coche ou décoche une ligne. **La sélection reçue n'est jamais modifiée** : c'est un état React,
 * et le muter sur place ne redéclencherait aucun rendu — la case resterait telle quelle sous le doigt.
 */
export function basculer(selection: ReadonlySet<string>, id: string): Set<string> {
  const suite = new Set(selection);
  if (suite.has(id)) suite.delete(id);
  else suite.add(id);
  return suite;
}

/** Coche un paquet de lignes — ce que fait la case « tout sélectionner » sur ce qui est affiché. */
export function ajouter(selection: ReadonlySet<string>, ids: readonly string[]): Set<string> {
  const suite = new Set(selection);
  for (const id of ids) suite.add(id);
  return suite;
}

/**
 * Décoche un paquet de lignes. Son intérêt est d'être **exactement l'inverse** d'{@link ajouter} :
 * décocher la case maîtresse ne relâche que ce qu'elle avait pris, et laisse intact ce qui avait
 * été coché sous une recherche précédente.
 */
export function retirer(selection: ReadonlySet<string>, ids: readonly string[]): Set<string> {
  const suite = new Set(selection);
  for (const id of ids) suite.delete(id);
  return suite;
}

/**
 * Oublie qui a quitté la liste.
 *
 * On peut cocher sous une recherche, l'effacer, en taper une autre : la sélection survit d'un
 * filtre à l'autre, c'est le seul moyen de composer un lot à partir de deux recherches. Mais
 * quelqu'un retiré de la période entre deux rendus serveur ne doit pas rester coché dans le vide —
 * la barre d'action annoncerait un nombre que l'écran ne montre plus, et l'action serveur refuserait
 * le lot entier.
 */
export function restreindre(selection: ReadonlySet<string>, connus: readonly { id: string }[]): Set<string> {
  const presents = new Set(connus.map((l) => l.id));
  return new Set([...selection].filter((id) => presents.has(id)));
}

/** L'état de la case maîtresse, qui ne regarde **que** les lignes affichées. */
export type EtatToutCocher = "aucune" | "partielle" | "toutes";

/**
 * Coché, décoché ou indéterminé — d'après les seules lignes montrées. Des cases cochées ailleurs
 * (une recherche précédente) ne rendent jamais la case maîtresse « pleine » : elle ne parle que de
 * ce qu'on a sous les yeux.
 */
export function etatToutCocher(montres: readonly { id: string }[], selection: ReadonlySet<string>): EtatToutCocher {
  if (montres.length === 0) return "aucune";
  const cochees = montres.filter((l) => selection.has(l.id)).length;
  if (cochees === 0) return "aucune";
  return cochees === montres.length ? "toutes" : "partielle";
}

/**
 * Les lignes sélectionnées, **dans l'ordre de la liste** — c'est-à-dire l'ordre figé à l'ouverture
 * de l'écran (`selonOrdreFige`), et surtout pas l'ordre dans lequel on a coché. La sélection est un
 * ensemble ; s'en servir pour ordonner ferait sauter les lignes.
 */
export function lignesSelectionnees<T extends { id: string }>(liste: readonly T[], selection: ReadonlySet<string>): T[] {
  return liste.filter((l) => selection.has(l.id));
}

/* ------------------------------------------------------------------ */
/* Quand la barre d'action se montre, et ce que les cases annoncent    */
/* ------------------------------------------------------------------ */

/**
 * **La barre d'action de masse n'existe qu'avec une sélection** (sur les deux écrans : « n'affiche
 * cette section que si des users sont sélectionnés », « pour presence (admin) pareil, rends cette
 * tuile visible uniquement si quelqu'un est coché »).
 *
 * C'est l'inverse de la décision, qui la montait toujours — sobre et inerte — parce que « les cases
 * à cocher ne disent rien de ce qu'elles permettent ». Le problème que cette décision-là résolvait
 * reste réel ; ce qui change, c'est **où** on le résout : plus dans une tuile de deux cents pixels
 * qui occupe le bas de l'écran sans rien pouvoir faire, mais dans **une ligne posée à côté des
 * cases** ({@link texteInviteMasse}). Voir `CLAUDE.md`, « Une action de masse se montre avant qu'on
 * ait deviné son geste d'entrée ».
 *
 * **Une fonction partagée pour une condition d'une ligne**, et c'est tout l'enjeu : les deux écrans
 * de masse doivent apparaître et disparaître **au même moment**. Recopiée de chaque côté, la règle
 * aurait deux endroits où diverger ; ici, un seul — et le `grep` qui la cherche la trouve.
 */
export function barreDeMasseVisible(selection: ReadonlySet<string>): boolean {
  return selection.size > 0;
}

/**
 * **L'interrupteur « Sélection multiple »** (`InterrupteurSelection`) : ce que devient la sélection
 * quand on le bascule. L'allumer ne coche rien ; l'éteindre **vide** le lot — des cases cachées ne
 * gardent rien de coché, sinon la prochaine ouverture ferait réapparaître un lot oublié sous une barre
 * qui écrit en base. Une fonction partagée, pour que les trois écrans de masse le fassent pareil.
 */
export function selectionApresInterrupteur(selection: ReadonlySet<string>, actif: boolean): ReadonlySet<string> {
  return actif ? selection : new Set<string>();
}

/**
 * **La phrase qui dit ce que les cases permettent**, en une ligne, à côté d'elles.
 *
 * Elle remplace la barre inerte : même rôle (nommer le geste d'entrée avant qu'on l'ait deviné), un
 * vingtième de la place, et elle est **là où l'œil est déjà** — sur la case maîtresse qu'on vient
 * de lire.
 *
 * `geste` est ce que l'écran sait faire d'un lot, dans ses mots : « agir sur plusieurs personnes à
 * la fois » à l'annuaire, « corriger plusieurs réponses à la fois » aux présences. La **forme**, elle,
 * est commune aux deux écrans — « ce qui se duplique, ce sont les mots, jamais la mécanique »
 * (`CLAUDE.md`).
 */
export function texteInviteMasse(geste: string): string {
  return `Coche des lignes pour ${geste}.`;
}

/* ------------------------------------------------------------------ */
/* Les mots de la case maîtresse                                       */
/* ------------------------------------------------------------------ */

/**
 * **Le libellé nomme ce sur quoi la case agit.** Jamais « Tout » : le mot serait faux dès qu'une
 * recherche filtre la liste ou qu'un repli en cache la fin, et c'est précisément dans ces deux cas
 * qu'on s'en sert.
 *
 * - `recherche` — un filtre est en cours : ce sont des « résultats », pas « les personnes » ;
 * - `replie` — des lignes existent au-delà de ce qui est montré : on dit « lignes affichées », et
 *   {@link libelleDeplierEtSelectionner} propose à côté d'aller chercher le reste.
 */
export function libelleToutSelectionner(nbMontres: number, opts: { recherche: boolean; replie: boolean }): string {
  if (opts.replie) return `Sélectionner les ${nbMontres} lignes affichées`;
  /* **Zéro n'est pas un pluriel** : « Sélectionner les 0 résultats » s'affichait au-dessus de
      « Aucun membre trouvé. ». La case est inerte dans ce cas — ce qui manquait, c'est que son nom
      le dise. */
  if (nbMontres === 0) return opts.recherche ? "Aucun résultat à sélectionner" : "Aucune personne à sélectionner";
  if (nbMontres === 1) return opts.recherche ? "Sélectionner ce résultat" : "Sélectionner cette personne";
  return opts.recherche ? `Sélectionner les ${nbMontres} résultats` : `Sélectionner les ${nbMontres} personnes`;
}

/**
 * **La sortie du piège du repli.** Quand soixante lignes sont derrière « Afficher les 60 autres »,
 * la case maîtresse n'en prend que vingt — et c'est juste, mais insuffisant : le bureau veut les
 * quatre-vingts. Plutôt que de laisser une case mentir, on ajoute un bouton qui **déplie et
 * sélectionne** en un geste, et qui le dit dans son libellé.
 */
export function libelleDeplierEtSelectionner(nbTrouves: number, recherche: boolean): string {
  return `Afficher et sélectionner les ${nbTrouves} ${recherche ? "résultats" : "personnes"}`;
}

/**
 * Et la phrase qui dit, sous la case, ce qui reste en dehors tant que la liste est repliée.
 *
 * **Elle reçoit la sélection, et non un simple décompte, parce que « replié » et « pas
 * sélectionné » ne sont pas la même chose.** La sélection survit volontairement à un changement de
 * recherche ({@link restreindre}, {@link retirer}) : c'est le seul moyen de composer un lot à
 * partir de deux recherches. Donc on coche Chloé sous la recherche « du », on efface le champ, on
 * tape « ma » — Chloé est toujours cochée, mais elle est maintenant derrière le bouton « Afficher
 * les 60 autres ». Une phrase qui affirmait alors « 60 autres lignes sont repliées : elles ne sont
 * pas sélectionnées » mentait sur le lot qu'on est en train de composer, juste au-dessus d'un
 * bouton qui écrit en base.
 *
 * D'où trois phrases et non une : tout le repli est dehors (le cas ordinaire, à l'ouverture de
 * l'écran), tout le repli est dedans (le bouton « Afficher et sélectionner » a été utilisé, puis la
 * liste repliée de nouveau), ou le repli est partagé — et là on donne les **deux** nombres, parce
 * que c'est celui des lignes cochées qui décide du lot.
 */
export function texteRepliees(cachees: readonly { id: string }[], selection: ReadonlySet<string>): string | null {
  if (cachees.length === 0) return null;
  const cochees = cachees.filter((l) => selection.has(l.id)).length;
  const dehors = cachees.length - cochees;
  const entete = cachees.length === 1 ? "1 autre ligne est repliée" : `${cachees.length} autres lignes sont repliées`;
  if (cochees === 0) {
    return cachees.length === 1 ? `${entete} : elle n'est pas sélectionnée.` : `${entete} : elles ne sont pas sélectionnées.`;
  }
  if (dehors === 0) {
    return cachees.length === 1 ? `${entete} : elle est sélectionnée.` : `${entete} : elles sont toutes sélectionnées.`;
  }
  // Le lot composé sur deux recherches : les deux nombres, et jamais un seul des deux.
  const dedans = cochees === 1 ? "1 est sélectionnée" : `${cochees} sont sélectionnées`;
  const reste = dehors === 1 ? "1 ne l'est pas" : `${dehors} ne le sont pas`;
  return `${entete} : ${dedans}, ${reste}.`;
}

/* ------------------------------------------------------------------ */
/* Ce qui est coché sans être à l'écran                                */
/* ------------------------------------------------------------------ */

/**
 * **Combien de lignes cochées l'écran ne montre pas.**
 *
 * La sélection survit volontairement à un changement d'affichage — une autre recherche, une autre
 * page, un repli refermé : c'est le seul moyen de composer un lot à partir de deux recherches. La
 * contrepartie est qu'un lot peut porter sur des gens que l'écran n'affiche plus **du tout** : on
 * cherche « mar », on coche trois personnes, on tape autre chose, et il ne reste qu'« Aucun nom ne
 * correspond à cette recherche » au-dessus d'une barre qui écrit en base. `CLAUDE.md` tranche : ce
 * qui reste dehors est **compté et dit**. Voici le compte ; {@link texteHorsAffichage} le dit.
 *
 * Elle ne regarde que les lignes **montrées**, pas la liste entière : c'est la même portée que
 * {@link etatToutCocher}, et pour la même raison — la seule chose dont l'écran puisse répondre est
 * ce qu'il a sous les yeux.
 */
export function compterHorsAffichage(selection: ReadonlySet<string>, montres: readonly { id: string }[]): number {
  const vus = new Set(montres.map((l) => l.id));
  let dehors = 0;
  for (const id of selection) if (!vus.has(id)) dehors += 1;
  return dehors;
}

/**
 * Les deux formes du nom que l'écran donne à ses lignes, et leur genre. Seuls les **mots** changent
 * d'un écran à l'autre (« personne » aux présences, « compte » à l'annuaire) : la phrase, elle, est
 * la même des deux côtés — c'est la règle de `CLAUDE.md` sur les deux écrans de masse.
 */
export type MotsLignes = { singulier: string; pluriel: string; accord: "f" | "m" };

/**
 * **La phrase qui dit ce que le lot emporte en dehors de ce qu'on voit.**
 *
 * Elle est rendue là où la barre d'action vit — donc **même quand la liste affichée est vide** :
 * c'est précisément le cas où le nombre de la barre (« 3 personnes sélectionnées ») ne renvoie à
 * aucun nom à l'écran, et où il faut dire que le lot existe quand même.
 *
 * Elle ne remplace pas {@link texteRepliees}, qui parle de la **portée de la case maîtresse** (ce
 * que le repli laisse de côté) : celle-ci parle du **lot** (ce qui partira au serveur).
 */
export function texteHorsAffichage(dehors: number, mots: MotsLignes): string | null {
  if (dehors <= 0) return null;
  const e = mots.accord === "f" ? "e" : "";
  if (dehors === 1) {
    return `1 ${mots.singulier} sélectionné${e} n'est pas affiché${e} : ${mots.accord === "f" ? "elle" : "il"} fait partie du lot.`;
  }
  return `${dehors} ${mots.pluriel} sélectionné${e}s ne sont pas affiché${e}s : ${mots.accord === "f" ? "elles" : "ils"} font partie du lot.`;
}

/**
 * **Se souvenir des lignes déjà vues**, pour les écrans dont la liste est coupée **côté serveur**.
 *
 * Aux présences, toutes les personnes invitées sont dans la page : la sélection peut survivre à un
 * changement de recherche sans rien perdre, puisque la ligne de chacun reste connue. À l'annuaire,
 * la coupe est une vraie requête — les cinquante premiers comptes seulement —, et une case cochée
 * sur la page précédente désigne alors quelqu'un dont l'écran ne sait plus ni le nom ni le rôle.
 * Composer le lot avec la seule page affichée reviendrait à laisser tomber ces cases **en silence**,
 * exactement le défaut qu'on répare.
 *
 * D'où cette mémoire : chaque rendu serveur y verse les lignes qu'il apporte, et la plus récente
 * gagne — un rôle qui vient de changer est celui que la confirmation annonce. Elle ne sert qu'à
 * **relire** des lignes déjà affichées une fois ; elle n'ouvre aucun accès à ce que l'écran n'a
 * jamais montré.
 */
export function memoriserLignes<T extends { id: string }>(connues: ReadonlyMap<string, T>, lignes: readonly T[]): Map<string, T> {
  const suite = new Map(connues);
  for (const ligne of lignes) suite.set(ligne.id, ligne);
  return suite;
}
