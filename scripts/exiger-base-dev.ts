/**
 * **Refuse de continuer si `DATABASE_URL` ne désigne pas la base de développement.**
 *
 * `npm run db:migrate` lance `prisma migrate dev`, qui propose de **réinitialiser** la base quand
 * l'historique des migrations ne correspond pas, puis rejoue le seed. Lancé par erreur avec le
 * `DATABASE_URL` du club — un `.env` recopié, un terminal ouvert dans le mauvais dossier —, c'est une
 * perte sèche. `db:deploy` (`prisma migrate deploy`) existe pour la production et ne réinitialise rien ;
 * il n'y avait rien pour empêcher la confusion.
 *
 * On réutilise la preuve du garde-fou de démonstration (`baseDansLeDepot`) : une seule règle, un seul
 * endroit. La base de développement vit dans le dépôt, celle du club dans le volume du conteneur.
 */
import { baseDansLeDepot } from "../prisma/garde-demonstration";

const url = (process.env.DATABASE_URL ?? "").trim();
if (!baseDansLeDepot(url)) {
  console.error("REFUS : cette commande ne s'adresse qu'à la base de développement du dépôt.");
  console.error(`        DATABASE_URL vaut « ${url || "(rien)" } ».`);
  console.error("        Pour une base de production, c'est `npm run db:deploy` (prisma migrate deploy),");
  console.error("        qui applique les migrations sans jamais proposer de réinitialiser.");
  process.exit(1);
}
