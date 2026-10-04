"use client";

import { useEffect, useState } from "react";
import { Bouton, LienBouton } from "@/components/ui/Bouton";
import { Icone } from "@/components/ui/Icone";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type Plateforme = "iphone" | "android" | "pc" | "installee";

function detecterPlateforme(): Plateforme {
  if (typeof window === "undefined") return "pc";
  if (window.matchMedia("(display-mode: standalone)").matches) return "installee";
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return "iphone";
  if (/Android/i.test(ua)) return "android";
  return "pc";
}

/**
 * Les trois marches à suivre, par système. Écrites ici plutôt que dans l'email d'invitation : là-bas
 * elles s'empilaient toutes, et cinq paragraphes sur sept parlaient d'un appareil que la personne
 * n'avait pas dans la main.
 */
const SYSTEMES = [
  {
    cle: "iphone",
    nom: "iPhone et iPad",
    navigateur: "Safari",
    etapes: [
      <>
        Dans Safari, appuie sur le bouton <strong>Partager</strong> (le carré avec une flèche vers le haut, en bas de l&apos;écran).
      </>,
      <>
        Fais défiler et choisis <strong>« Sur l&apos;écran d&apos;accueil »</strong>.
      </>,
      <>
        Appuie sur <strong>Ajouter</strong>. C&apos;est fait !
      </>,
    ],
    // Le piège n° 1, dit là où le geste se fait : installée depuis l'adresse du lien, l'icône
    // rouvrirait ce lien à chaque fois — et un lien expire au bout de quatre mois.
    garde: "Installe depuis cette page-ci, et non depuis l'adresse de ton lien (la longue suite de caractères) : l'icône rouvrirait ce lien, qui finit par expirer.",
  },
  {
    cle: "android",
    nom: "Android",
    navigateur: "Chrome",
    etapes: [
      <>
        Appuie sur les <strong>trois petits points</strong> ⋮ en haut à droite de Chrome.
      </>,
      <>
        Choisis <strong>« Installer l&apos;application »</strong> ou <strong>« Ajouter à l&apos;écran d&apos;accueil »</strong>.
      </>,
      <>
        Confirme avec <strong>Installer</strong>. C&apos;est fait !
      </>,
    ],
    garde: null,
  },
  {
    cle: "pc",
    nom: "Ordinateur",
    navigateur: "Chrome ou Edge",
    etapes: [
      <>
        Dans la barre d&apos;adresse, clique sur l&apos;icône <strong>Installer</strong> (un écran avec une flèche), à droite.
      </>,
      <>
        Confirme avec <strong>Installer</strong>. L&apos;application s&apos;ouvre dans sa propre fenêtre.
      </>,
      <>Sinon, ajoute simplement cette page à tes favoris.</>,
    ],
    garde: null,
  },
] as const;

/**
 * **Les gestes d'installation, un système à la fois.**
 *
 * Chaque système est un volet replié (`<details>`) portant son nom : on déroule le sien d'un appui,
 * les autres restent fermés. Celui de l'appareil qu'on tient s'ouvre tout seul — la détection sert
 * encore, mais elle ne décide plus à la place de qui la dément (un iPhone consulté depuis
 * l'ordinateur du club, quelqu'un qui prépare l'installation pour un autre, un navigateur qui ment
 * sur son identité). C'est le point qui manquait : les instructions étaient justes, mais
 * inaccessibles dès que la détection se trompait.
 *
 * Quand le navigateur propose l'installation lui-même (`beforeinstallprompt`, Chrome et Edge), le
 * bouton natif passe devant : un appui vaut mieux que trois marches décrites.
 */
export function GuideInstallation() {
  const [plateforme, setPlateforme] = useState<Plateforme>("pc");
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installee, setInstallee] = useState(false);

  useEffect(() => {
    setPlateforme(detecterPlateforme());
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setInstallee(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installee || plateforme === "installee") {
    return (
      <section className="rounded-2xl border border-vert/40 bg-surface p-5 shadow-carte">
        <h2 className="flex items-center gap-2 text-xl font-bold">
          <Icone nom="check" className="text-vert" /> L&apos;application est installée
        </h2>
        <p className="mt-2">Tu la retrouveras sur ton écran d&apos;accueil.</p>
        <LienBouton href="/" taille="grande" pleineLargeur className="mt-4">
          Ouvrir l&apos;application
        </LienBouton>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-bordure/60 bg-surface p-5 shadow-carte">
      <h2 className="flex items-center gap-2 text-xl font-bold">
        <Icone nom="telecharger" className="text-primaire" /> Les gestes de ton appareil
      </h2>
      {prompt ? (
        <>
          <p className="mt-2">Appuie sur le bouton, puis confirme.</p>
          <Bouton
            taille="grande"
            pleineLargeur
            className="mt-4"
            onClick={async () => {
              await prompt.prompt();
              const { outcome } = await prompt.userChoice;
              if (outcome === "accepted") setInstallee(true);
              setPrompt(null);
            }}
          >
            Installer maintenant
          </Bouton>
        </>
      ) : (
        <>
          <ul className="mt-3 flex flex-col gap-2">
            {SYSTEMES.map((s) => (
              <li key={s.cle}>
                {/* `<details>` natif : le repli tient sans JavaScript, et le clavier comme le
                    lecteur d'écran le connaissent déjà. `open` sur le système détecté — c'est une
                    valeur initiale, pas un verrou : les trois restent ouvrables à la main. */}
                <details open={s.cle === plateforme} className="group rounded-xl border border-bordure/60 bg-surface-douce">
                  <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 font-semibold [&::-webkit-details-marker]:hidden">
                    <Icone nom="chevronBas" taille={20} className="shrink-0 transition-transform group-open:rotate-180" />
                    <span>{s.nom}</span>
                    <span className="font-normal text-texte-secondaire">({s.navigateur})</span>
                  </summary>
                  <div className="px-4 pb-4">
                    <ol className="list-decimal space-y-3 pl-6">
                      {s.etapes.map((etape, i) => (
                        <li key={i}>{etape}</li>
                      ))}
                    </ol>
                    {s.garde && <p className="mt-3 rounded-lg bg-surface p-3 text-sm text-texte-secondaire">{s.garde}</p>}
                  </div>
                </details>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
