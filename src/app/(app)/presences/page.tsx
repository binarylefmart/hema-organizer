import { redirect } from "next/navigation";

/**
 * Ancienne adresse de l'onglet, devenu **« Séances »** : elle reste vivante parce que des liens
 * sont déjà partis dans des emails (« Je viens », récap de la veille) et qu'un membre a pu la
 * mettre en favori. Les paramètres sont recopiés tels quels — c'est justement ce qui porte la
 * réponse en un clic (`?seance=…&reponse=present`).
 */
export default async function PagePresences({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const q = new URLSearchParams();
  for (const [cle, valeur] of Object.entries(params)) {
    if (typeof valeur === "string") q.set(cle, valeur);
    else if (Array.isArray(valeur) && valeur[0]) q.set(cle, valeur[0]);
  }
  const qs = q.toString();
  redirect(qs ? `/seances?${qs}` : "/seances");
}
