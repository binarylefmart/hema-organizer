import { db } from "./db";

/**
 * **L'horaire que le club pratique vraiment**, pour pré-remplir un créneau ou une séance neuve.
 *
 * Les formulaires proposaient « 19:00 – 21:00 » écrit en dur : l'horaire d'un seul club, comme le
 * mardi pré-choisi qu'on avait déjà retiré du formulaire des créneaux. On reprend donc l'horaire de
 * la **dernière séance non annulée** du club — c'est celui que le bureau vient de saisir ou de générer.
 * Un club qui n'a encore aucune séance reçoit des champs vides : il les remplit, rien ne lui est
 * soufflé à tort.
 */
export async function horaireHabituel(): Promise<{ heureDebut: string; heureFin: string }> {
  const derniere = await db.session.findFirst({
    where: { annulee: false },
    orderBy: [{ date: "desc" }, { heureDebut: "desc" }],
    select: { heureDebut: true, heureFin: true },
  });
  return derniere ?? { heureDebut: "", heureFin: "" };
}
