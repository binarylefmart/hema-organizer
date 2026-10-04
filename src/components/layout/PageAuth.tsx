import type { ReactNode } from "react";
import { identite } from "@/lib/identite";
import { Logo } from "./Logo";

type Props = { titre: string; children: ReactNode; sousTitre?: string; /** Titre lu par les lecteurs d'écran mais non affiché */ titreMasque?: boolean };

/** Gabarit des pages de connexion / invitation : logo grand format centré, carte unique. */
export async function PageAuth({ titre, sousTitre, titreMasque = false, children }: Props) {
  const club = await identite();
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center px-4 py-8">
      <Logo identite={club} taille={180} className="h-auto w-[8.75rem] sm:w-[11.25rem]" plaque="sombre" />
      {/* Même marque que dans l'application, dans l'or de l'écu */}
      <p className="mb-6 mt-4 text-balance text-center font-titre text-2xl text-marque sm:text-3xl">{club.nomCourt}</p>
      <section className="w-full rounded-2xl border border-bordure/60 bg-surface p-5 shadow-carte sm:p-6">
        <h1 className={titreMasque ? "sr-only" : "mb-1 break-words text-[1.75rem] sm:text-3xl"}>{titre}</h1>
        {sousTitre && <p className="mb-5 text-texte-secondaire">{sousTitre}</p>}
        {!sousTitre && <div className="mb-5" />}
        {children}
      </section>
    </main>
  );
}
