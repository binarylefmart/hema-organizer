import { Champ } from "@/components/ui/Champ";
import { ChampListe } from "@/components/ui/ChampListe";
import { ZoneTexte } from "@/components/ui/ZoneTexte";
import { FormulaireAction } from "@/components/ui/FormulaireAction";
import { formatDateCourte, formatHeure } from "@/lib/dates";
import type { FormState } from "@/lib/form";

type Seance = { id: string; date: string; heureDebut: string; lieu: string };

export function FormulaireAtelier({
  action,
  seances,
  valeurs,
  bouton,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  seances: Seance[];
  valeurs?: { titre: string; description: string; materiel: string | null; sessionId: string | null };
  bouton: string;
}) {
  return (
    <FormulaireAction action={action} bouton={bouton} enCours="Envoi…">
      <Champ label="Titre" name="titre" defaultValue={valeurs?.titre} maxLength={80} placeholder="ex. Échauffement à la corde" />
      <ZoneTexte label="En quelques mots" name="description" defaultValue={valeurs?.description} maxLength={1500} rows={3} placeholder="Ce que tu proposes, comment ça se passe…" />
      <Champ label="Équipement nécessaire" name="materiel" defaultValue={valeurs?.materiel ?? ""} maxLength={300} placeholder="ex. masques, gants, cordes à sauter" />
      {/* La liste du dépôt, non pilotée : le champ caché `sessionId` poste l'identifiant de la
          séance, ou la chaîne vide pour « Peu importe » — ce que lit l'action, comme avant. */}
      <ChampListe
        label="Séance souhaitée"
        name="sessionId"
        valeur={valeurs?.sessionId ?? ""}
        entrees={[
          { valeur: "", libelle: "Peu importe" },
          ...seances.map((s) => ({ valeur: s.id, libelle: `${formatDateCourte(s.date)} · ${formatHeure(s.heureDebut)} · ${s.lieu}` })),
        ]}
      />
    </FormulaireAction>
  );
}
