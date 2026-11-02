/**
 * **Les retours à la ligne d'un texte libre, remis d'aplomb** (retours du club d'Arras) : une
 * description collée depuis un tableur, un export ou un autre outil arrive parfois avec des `\n`
 * **écrits en toutes lettres** (la barre oblique et la lettre), ou avec des fins de ligne Windows.
 * Tous deviennent un vrai retour à la ligne, qu'ensuite chaque support rend à sa façon :
 * `whitespace-pre-line` à l'écran et sur les pages de partage, `<br>` dans les emails, le retour tel
 * quel dans Discord, Telegram et l'API publique.
 *
 * Module pur, sans dépendance : lisible du navigateur comme du serveur.
 */
export function retoursALaLigne(texte: string): string {
  return texte.replace(/\\r\\n|\\n|\\r/g, "\n").replace(/\r\n?/g, "\n");
}
