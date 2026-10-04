import { Champ } from "@/components/ui/Champ";
import { Select } from "@/components/ui/Select";
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
      <Select label="Séance souhaitée" name="sessionId" defaultValue={valeurs?.sessionId ?? ""}>
        <option value="">Peu importe</option>
        {seances.map((s) => (
          <option key={s.id} value={s.id}>
            {formatDateCourte(s.date)} · {formatHeure(s.heureDebut)} · {s.lieu}
          </option>
        ))}
      </Select>
    </FormulaireAction>
  );
}
