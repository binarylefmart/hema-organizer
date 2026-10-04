import { Alerte } from "@/components/ui/Alerte";
import { derniereVersionPubliee, etatMiseAJour, notesDeVersionUrl, versionCourante } from "@/lib/mise-a-jour";

/**
 * **« Une mise à jour est disponible »**, au-dessus de l'accès administrateur. Composant serveur
 * rendu sous `<Suspense>` : la lecture chez Docker Hub (trois secondes au plus, gardée six heures)
 * ne retarde jamais le reste du profil. Il ne rend rien quand l'instance est à jour ou qu'on ne sait
 * pas — un « peut-être » n'a pas sa place dans un encart d'avertissement.
 */
export async function EncartMiseAJour() {
  const etat = etatMiseAJour(versionCourante(), await derniereVersionPubliee());
  if (!etat) return null;
  const notes = notesDeVersionUrl(etat.derniere);
  return (
    <Alerte type="attention" titre={`Mise à jour disponible : version ${etat.derniere}`}>
      <p>
        Cette instance tourne en <strong>{etat.courante}</strong>. Pour passer en <strong>{etat.derniere}</strong>, il faut redéployer :
      </p>
      <ul className="mt-2 list-disc pl-5">
        <li>
          si la stack suit <code>latest</code> : Portainer → la stack → <strong>Update the stack</strong> avec <strong>Re-pull image</strong> ;
        </li>
        <li>
          si elle est épinglée sur une version : mettre <code>APP_TAG={etat.derniere}</code>, puis redéployer.
        </li>
      </ul>
      {notes && (
        <p className="mt-2">
          <a href={notes} target="_blank" rel="noopener noreferrer" className="font-semibold">
            Ce que change la version {etat.derniere}
          </a>{" "}
          <span className="text-sm text-texte-secondaire">(notes de version, s&apos;ouvre dans un nouvel onglet)</span>
        </p>
      )}
      <p className="mt-2 text-sm text-texte-secondaire">Sauvegarder le volume des données avant : une migration de la base ne se défait pas.</p>
    </Alerte>
  );
}
