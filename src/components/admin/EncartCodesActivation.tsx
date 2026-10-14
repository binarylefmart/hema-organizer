import { lireCodesActivationAffiches } from "@/lib/auth/activation-bureau";
import { formaterCodeActivation } from "@/lib/auth/code-activation";
import { formatDateHeure } from "@/lib/dates";
import { masquerCodesActivation } from "@/actions/admin";
import { BoutonEnvoi } from "@/components/ui/BoutonEnvoi";
import { Icone } from "@/components/ui/Icone";
import { AmenerEnVue } from "./AmenerEnVue";

/**
 * **Les codes d'activation que cet administrateur vient de générer**, montrés à lui seul, une fois.
 *
 * Lus dans le cookie d'affichage signé, chiffré et nommé à l'administrateur
 * (`lireCodesActivationAffiches`) : un autre compte sur le même navigateur ne voit rien. L'encart
 * disparaît au bout de quinze minutes ou sur « C'est transmis » ; le code ne se relit ensuite plus
 * nulle part — on en génère un nouveau, qui remplace l'ancien.
 *
 * Posé en tête des trois écrans d'où un code peut naître : Comptes admin, l'annuaire et la fiche
 * d'un membre (remise à zéro de l'accès d'un membre du bureau).
 */
export async function EncartCodesActivation({ acteurId }: { acteurId: string }) {
  const codes = await lireCodesActivationAffiches(acteurId);
  if (codes.length === 0) return null;
  const plusieurs = codes.length > 1;
  return (
    <AmenerEnVue>
      <section
        id="codes-activation"
        aria-labelledby="codes-activation-titre"
        className="flex flex-col gap-4 rounded-2xl border-2 border-ocre/60 bg-ocre-doux p-4 shadow-carte"
      >
        <h2 id="codes-activation-titre" className="flex items-center gap-2 text-xl font-semibold">
          <Icone nom="bouclier" taille={22} />
          {plusieurs ? "Codes d'activation à transmettre" : "Code d'activation à transmettre"}
        </h2>
        <ul className="flex flex-col gap-3">
          {codes.map((c) => (
            <li key={c.userId} className="flex flex-col gap-1 rounded-xl bg-surface p-3">
              <span>
                Code d&apos;activation de <strong>{c.nom}</strong>
              </span>
              <span className="select-all font-mono text-3xl font-bold tracking-[0.2em]">
                {formaterCodeActivation(c.code)}
              </span>
              <span className="text-sm text-texte-secondaire">Valable jusqu&apos;au {formatDateHeure(new Date(c.expireLe))}, une seule fois.</span>
            </li>
          ))}
        </ul>
        <p>
          <strong>Transmets-le de vive voix ou en main propre, jamais par email ni par message.</strong>{" "}
          {plusieurs ? "Chaque personne en a besoin" : "La personne en a besoin"} pour activer sa double authentification. Il ne
          s&apos;affichera plus : perdu ou expiré, génère-en un nouveau depuis Comptes admin.
        </p>
        <form action={masquerCodesActivation}>
          <BoutonEnvoi variante="secondaire" taille="petite" enCours="Un instant…">
            <Icone nom="check" taille={18} />
            C&apos;est noté, masquer
          </BoutonEnvoi>
        </form>
      </section>
    </AmenerEnVue>
  );
}
