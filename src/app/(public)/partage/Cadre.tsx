import type { ReactNode } from "react";
import { Logo } from "@/components/layout/Logo";
import { LienBouton } from "@/components/ui/Bouton";
import { Icone } from "@/components/ui/Icone";
import { identite } from "@/lib/identite";

/**
 * Gabarit des pages de partage public : écu, nom de l'association, le résumé, puis le lien vers
 * l'application. Ces pages s'ouvrent **sans connexion**, souvent depuis WhatsApp sur un téléphone :
 * une seule colonne, un seul bouton, et rien qui suppose d'être déjà membre.
 */
export async function Cadre({
  children,
  sousTitre,
  varianteApp = "primaire",
}: {
  children: ReactNode;
  sousTitre?: string;
  /** « secondaire » quand la page porte déjà une action principale (le lien d'inscription d'un événement) */
  varianteApp?: "primaire" | "secondaire";
}) {
  const club = await identite();
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-col items-center gap-3 text-center">
        <Logo identite={club} taille={110} variante="ecu" className="h-auto w-[4.75rem]" plaque="sombre" />
        <p className="text-balance font-titre text-2xl text-texte sm:text-3xl">{club.nomClub}</p>
        {sousTitre && <p className="text-texte-secondaire">{sousTitre}</p>}
      </header>

      {children}

      {/* Bascule d'un geste vers sa réponse de présence : c'est la seule action de la page. Le
          détour est annoncé : cette page s'ouvre sans compte, et `/seances` renvoie sur la connexion
          — mieux vaut le dire que de laisser un visiteur buter sur un écran qu'il n'attendait pas. */}
      <section className="flex flex-col items-center gap-2 rounded-2xl border border-bordure/60 bg-surface p-4 text-center shadow-carte sm:p-5">
        <p className="text-texte-secondaire">Membre du club ? Indique ta présence en un appui.</p>
        <LienBouton href="/seances" taille="grande" variante={varianteApp} pleineLargeur>
          Ouvrir l&apos;application (connexion requise)
          <Icone nom="fleche" taille={20} />
        </LienBouton>
      </section>

      <footer className="flex items-start gap-2 text-sm text-texte-secondaire">
        <Icone nom="info" taille={18} className="mt-0.5" />
        <p>Page publique : elle ne montre jamais de nom de membre, ni de liste de participants — seulement les chiffres globaux.</p>
      </footer>
    </main>
  );
}

/** Écran d'erreur des pages de partage : identifiant inconnu, ou trop de demandes depuis une IP. */
export function Impasse({ titre, children }: { titre: string; children: ReactNode }) {
  return (
    <Cadre>
      <section className="flex flex-col gap-3 rounded-2xl border border-bordure/60 bg-surface p-5 shadow-carte">
        <h1 className="text-2xl">{titre}</h1>
        <p className="text-texte-secondaire">{children}</p>
      </section>
    </Cadre>
  );
}
