import { Bloc, CarteSquelette, EcranSquelette, EnTeteSquelette, ListeSquelette } from "@/components/ui/Squelette";

/** Attente du registre : la liste déroulante des séances, puis une ligne par personne invitée. */
export default function ChargementPresences() {
  return (
    <EcranSquelette libelle="Chargement des présences">
      <EnTeteSquelette largeurTitre="w-40" />
      <CarteSquelette titre={false}>
        <div className="flex flex-col gap-1.5">
          <Bloc className="h-4 w-20" />
          {/* `max-w-2xl` : la même largeur maximale que la vraie liste déroulante de séance
              (`SelecteurSeance`), mesurée à 672 px. Le squelette annonçait 448 px, et l'écran
              sautait de 224 px à l'arrivée de la page — sur l'écran le plus large de l'espace
              admin, c'est le seul endroit où il pouvait le faire. */}
          <Bloc className="h-12 w-full max-w-2xl rounded-xl" />
        </div>
        <div className="mt-4">
          <ListeSquelette lignes={10} avatar />
        </div>
      </CarteSquelette>
    </EcranSquelette>
  );
}
