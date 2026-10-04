import type { Metadata } from "next";
import { PageAuth } from "@/components/layout/PageAuth";
import { FormulaireOubli } from "./FormulaireOubli";

export const metadata: Metadata = { title: "Mot de passe oublié" };

export default function PageOubli() {
  return (
    <PageAuth titre="Mot de passe oublié" sousTitre="Réservé aux administrateurs : on t'envoie un lien par email pour en choisir un nouveau. Les membres n'ont pas de mot de passe, leur lien personnel suffit.">
      <FormulaireOubli />
    </PageAuth>
  );
}
