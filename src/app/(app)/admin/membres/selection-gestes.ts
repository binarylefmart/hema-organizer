/**
 * **Désactiver, réactiver ou supprimer plusieurs comptes d'un coup** — la partie qui ne touche ni à
 * React ni à la base, donc la seule qui se teste.
 *
 * Demande de. L'annuaire savait déjà cocher des lignes pour changer un rôle
 * (`selection-roles.ts`) ; il sait maintenant agir sur l'accès et sur l'existence des comptes, avec
 * **la même mécanique de sélection** (`src/components/ui/selection.ts`, partagée avec l'écran des
 * présences). Ce qui se duplique ici, ce sont les **mots** propres à ces trois gestes, jamais la
 * mécanique — c'est la règle de `CLAUDE.md`.
 *
 * Deux règles de fond, reprises du rôle en masse :
 *
 * 1. **La confirmation annonce ce qui sera écrasé**, en séparant ceux qui portent **déjà** la valeur
 *    visée (déjà désactivés, déjà actifs) de ceux qui changent vraiment : les confondre gonfle le
 *    chiffre censé faire hésiter. Pour la suppression, elle annonce en plus les **réponses de
 *    présence perdues, personne par personne** — c'est la seule donnée que le geste détruit et qu'on
 *    ne peut pas ressaisir.
 * 2. **Un administrateur a une case, et la confirmation le nomme**. Il n'en avait pas, pour une
 *    raison qui a cessé d'exister : les trois rôles étaient exclusifs, et changer le rôle d'un
 *    administrateur l'aurait **rétrogradé en silence**. Le bureau est désormais un supplément
 *    (`User.estAdmin`), le lot de rôles n'écrit que `role`, et les trois gestes d'accès font sur un
 *    membre du bureau exactement ce que son propre volet et sa propre fiche font déjà — ni plus, ni
 *    moins. **Être plus strict en masse qu'à l'unité est une fonctionnalité morte**, dit `CLAUDE.md`,
 *    et c'était le cas ici : le même écran propose un pied de page « Désactiver tous les comptes,
 *    administrateurs compris ». Ce qui reste dû au bureau, c'est d'être **dit** : couper l'accès ou
 *    effacer un compte qui détient les clés du club se lit dans la confirmation, nom par nom.
 *
 * Ce module ne dépend de rien : il est lu par un composant client, et tout module touchant aux
 * réglages entraînerait `node:crypto` dans le paquet du navigateur (échec de `npm run build` que ni
 * `tsc` ni les tests ne voient).
 */

import { texteInviteMasse } from "@/components/ui/selection";

/** Les trois gestes de masse de l'annuaire, tels qu'ils voyagent jusqu'au serveur. */
export const GESTES_MASSE = ["desactiver", "reactiver", "supprimer"] as const;

export type GesteMasse = (typeof GESTES_MASSE)[number];

/**
 * Une ligne de l'annuaire, vue par ces trois gestes : son nom (la confirmation le dit), l'état de
 * son accès (qui décide de ce qui change vraiment), le nombre de réponses de présence qu'elle porte
 * (ce qu'une suppression détruit) et le fait qu'elle soit **du bureau**.
 *
 * **`estAdmin` sert à la confirmation, pas à un refus** : il n'écarte plus personne du lot (voir le
 * préambule), il décide de la phrase qui nomme ceux dont le lot coupe les droits du club.
 */
export type LigneGeste = { id: string; nom: string; actif: boolean; reponses: number; estAdmin: boolean };

/** Le libellé du bouton, et rien d'autre : ce que la barre d'action écrit dessus. */
export const LIBELLES_GESTES: Record<GesteMasse, string> = {
  desactiver: "Désactiver",
  reactiver: "Réactiver",
  // Jamais rendu seul : voir `libelleGeste`, qui nomme ce que la suppression détruit.
  supprimer: "Supprimer",
};

/**
 * **« Supprimer » ne dit pas ce qu'il détruit**.
 *
 * Un bouton rouge nommé d'un seul verbe, aligné avec « Désactiver » et « Réactiver », laisse deviner
 * son objet : la sélection ? la ligne ? l'écran ? Les deux autres gestes se défont d'un clic, celui-ci
 * emporte les comptes, leurs réponses de présence et leur historique. Il dit donc **sur quoi** il
 * porte, et il l'accorde avec le lot — un bouton au singulier devant douze cases cochées serait un
 * second malentendu à la place du premier.
 */
export function libelleGeste(geste: GesteMasse, nombre: number): string {
  if (geste !== "supprimer") return LIBELLES_GESTES[geste];
  return nombre > 1 ? "Supprimer les utilisateurs" : "Supprimer l'utilisateur";
}

/**
 * **Ce que les cases permettent, dit à côté d'elles**.
 *
 * La barre d'action ne se monte plus tant que rien n'est coché : « dans membre n'affiche cette
 * section que si des users sont sélectionnés ». C'est l'inverse de la décision, qui la montait
 * toujours, grisée, avec cette phrase dedans — parce que Delta ne l'avait pas trouvée sur l'écran
 * voisin (« il manque le bouton de selection de status pour tous ceux selectionnés non ? comme une
 * bulk action present peut etre abscent »).
 *
 * Le motif de cette décision-là tient toujours : des cases à cocher ne disent rien de ce qu'elles
 * permettent. Ce qui change, c'est **où** on le dit — plus dans une barre de deux cents pixels
 * incapable d'écrire, mais en **une ligne sous la case maîtresse**. La forme de la phrase est celle
 * des deux écrans de masse (`texteInviteMasse`, `src/components/ui/selection.ts`) ; seuls les mots
 * sont ceux de l'annuaire.
 *
 * **Le mot reste « personnes » et non « comptes »**, à l'inverse de `MOTS_COMPTES` : la phrase parle
 * de ce que le bureau vient faire (traiter plusieurs personnes d'un coup), là où `texteHorsAffichage`
 * compte des lignes de l'annuaire.
 */
export const INVITE_SELECTION = texteInviteMasse("agir sur plusieurs personnes à la fois");

/** Ce qu'un lot va faire, avant de le faire. */
export type ResumeGeste = {
  /** Combien de comptes sont sélectionnés. */
  total: number;
  /** Combien changeront réellement d'état (ou seront supprimés). */
  changent: number;
  /** Combien portent déjà la valeur visée : rien ne changera pour eux. */
  inchanges: number;
  /** Les réponses de présence détruites par une suppression, personne par personne, dans l'ordre de la liste. */
  reponsesParPersonne: { nom: string; reponses: number }[];
  /** Leur somme : le chiffre qui fait hésiter. */
  reponsesPerdues: number;
  /**
   * Les **membres du bureau** que le lot va vraiment toucher, nommés, dans l'ordre de la liste.
   *
   * Ce ne sont pas tous les administrateurs sélectionnés mais ceux dont quelque chose change : un
   * administrateur déjà désactivé n'a pas de droits à perdre une seconde fois, et le nommer gonflerait
   * le chiffre censé faire hésiter — c'est la règle de `inchanges`, appliquée à cette phrase-ci.
   */
  bureau: string[];
};

/**
 * Le décompte des deux populations d'un lot, et de ce qu'il détruit.
 *
 * Quelqu'un **déjà** désactivé n'est pas désactivé une seconde fois : le compter avec les autres
 * ferait annoncer « 5 comptes désactivés » là où le journal n'en garderait que quatre. Deux chiffres
 * qui ne s'accordent pas, c'est un doute qu'on ne lève plus — même raison qu'au rôle en masse
 * (`resumeRoles`).
 *
 * Une suppression, elle, n'a pas de « déjà fait » : chaque ligne du lot disparaît.
 */
export function resumeGeste(lignes: readonly LigneGeste[], geste: GesteMasse): ResumeGeste {
  const concernees = geste === "supprimer" ? lignes : lignes.filter((l) => l.actif === (geste === "desactiver"));
  const reponsesParPersonne = geste === "supprimer" ? lignes.map((l) => ({ nom: l.nom, reponses: l.reponses })) : [];
  return {
    total: lignes.length,
    changent: concernees.length,
    inchanges: lignes.length - concernees.length,
    reponsesParPersonne,
    reponsesPerdues: reponsesParPersonne.reduce((somme, l) => somme + l.reponses, 0),
    // Les comptes du bureau **réellement touchés** : une réactivation n'en prive aucun de ses droits,
    // elle les rend — il n'y a donc rien à annoncer de ce côté-là.
    bureau: geste === "reactiver" ? [] : concernees.filter((l) => l.estAdmin).map((l) => l.nom),
  };
}

/**
 * **Combien de noms la confirmation détaille avant de compter le reste.**
 *
 * Elle doit annoncer les réponses perdues **par personne** ; un lot peut en porter cinq cents, et une
 * fenêtre de confirmation de cinq cents lignes ne se lit pas — elle se clique. Douze noms tiennent
 * sur un téléphone, et au-delà le reste est **compté et dit** (jamais avalé en silence), avec le
 * total qui reste juste.
 */
const NOMS_DETAILLES_MAX = 12;

/** « Chloé Dubois : 6 réponses » — et « aucune » plutôt que « 0 », qui se lit mal. */
function ligneReponses(l: { nom: string; reponses: number }): string {
  if (l.reponses === 0) return `• ${l.nom} : aucune réponse`;
  return `• ${l.nom} : ${l.reponses} réponse${l.reponses > 1 ? "s" : ""}`;
}

/**
 * **Les comptes du bureau que le lot emporte, nommés.**
 *
 * C'est tout ce qui reste de l'ancienne exclusion des administrateurs — et c'en est la part utile.
 * Leur refuser la case rendait le geste impossible là où leur fiche l'autorise déjà (et là où le pied
 * de cet écran propose « Désactiver tous les comptes, administrateurs compris ») ; les laisser passer
 * en silence serait l'excès inverse. Couper l'accès du bureau ou effacer un compte qui détient les
 * clés du club se **dit**, avec les noms : c'est le chiffre censé faire hésiter, et ici ce sont les
 * noms qui le portent.
 *
 * Les noms, et non leur nombre : à ce niveau de conséquence, « 2 administrateurs » laisse chercher
 * lesquels — y compris le sien, qui n'y est jamais (personne n'agit sur son propre compte).
 */
function phraseBureau(noms: readonly string[], geste: "desactiver" | "supprimer"): string {
  const qui = noms.length === 1 ? `${noms[0]} est du bureau` : `${noms.length} comptes du lot sont du bureau (${noms.join(", ")})`;
  return geste === "desactiver"
    ? `${qui} : l'administration du club se referme pour ${noms.length === 1 ? "elle" : "eux"} en même temps que le reste.`
    : `${qui} : les droits d'administrateur partent avec le compte.`;
}

/**
 * **La question posée avant d'écrire.** Elle dit, dans cet ordre : ce qu'on va faire et à combien de
 * comptes, **ce qui ne bougera pas**, ce qui sera détruit, et que le journal en gardera la trace nom
 * par nom — ce dernier point n'est pas une politesse, c'est lui qui tranchera le désaccord d'après.
 *
 * Trois gestes, trois conséquences à annoncer, et elles sont **exactement celles des boutons
 * unitaires** de la liste (« Son lien personnel cessera de fonctionner », « Chacun retrouvera
 * l'accès ») : le bureau doit retrouver la même promesse, qu'il agisse sur une ligne ou sur trente.
 */
export function texteConfirmationGeste(resume: ResumeGeste, geste: GesteMasse): string {
  const comptes = `${resume.total} compte${resume.total > 1 ? "s" : ""}`;
  const morceaux: string[] = [];

  if (geste === "supprimer") {
    morceaux.push(`Supprimer définitivement ${comptes} ?`);
    morceaux.push("C'est irréversible : le compte, ses réponses de présence, ses propositions d'atelier et son historique partent avec.");
    if (resume.reponsesPerdues === 0) {
      morceaux.push("Aucune réponse de présence ne sera perdue : personne dans la sélection n'en a enregistré.");
    } else {
      morceaux.push(`${resume.reponsesPerdues} réponse${resume.reponsesPerdues > 1 ? "s" : ""} de présence seront perdues :`);
      const detaillees = resume.reponsesParPersonne.slice(0, NOMS_DETAILLES_MAX);
      morceaux.push(detaillees.map(ligneReponses).join("\n"));
      const reste = resume.reponsesParPersonne.slice(NOMS_DETAILLES_MAX);
      if (reste.length > 0) {
        const cachees = reste.reduce((somme, l) => somme + l.reponses, 0);
        morceaux.push(`• et ${reste.length} autre${reste.length > 1 ? "s" : ""} compte${reste.length > 1 ? "s" : ""} (${cachees} réponse${cachees > 1 ? "s" : ""}).`);
      }
    }
    if (resume.bureau.length > 0) morceaux.push(phraseBureau(resume.bureau, "supprimer"));
    morceaux.push("Chaque suppression est inscrite au journal, nom par nom.");
    return morceaux.join("\n");
  }

  const verbe = geste === "desactiver" ? "Désactiver" : "Réactiver";
  morceaux.push(`${verbe} ${comptes} ?`);
  if (resume.changent === 0) {
    morceaux.push(geste === "desactiver" ? "Tous sont déjà désactivés : rien ne changera." : "Tous sont déjà actifs : rien ne changera.");
    return morceaux.join("\n");
  }
  const changent =
    resume.changent > 1
      ? `${resume.changent} comptes changeront`
      : "1 compte changera";
  const dejas =
    geste === "desactiver"
      ? resume.inchanges > 1
        ? `${resume.inchanges} sont déjà désactivés`
        : "1 est déjà désactivé"
      : resume.inchanges > 1
        ? `${resume.inchanges} sont déjà actifs`
        : "1 est déjà actif";
  morceaux.push(resume.inchanges > 0 ? `${changent}, ${dejas}.` : `${changent}.`);
  morceaux.push(
    geste === "desactiver"
      ? "Chacun perdra l'accès immédiatement : ses appareils connectés sont déconnectés et son lien personnel cesse de fonctionner. Il ne recevra plus d'email."
      : "Chacun retrouvera l'accès et son lien personnel fonctionnera de nouveau.",
  );
  if (resume.bureau.length > 0) morceaux.push(phraseBureau(resume.bureau, "desactiver"));
  morceaux.push(`Chaque ${geste === "desactiver" ? "désactivation" : "réactivation"} est inscrite au journal, nom par nom.`);
  return morceaux.join("\n");
}
