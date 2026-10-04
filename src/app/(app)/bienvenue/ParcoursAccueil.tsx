"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Bouton, LienBouton } from "@/components/ui/Bouton";
import { Icone } from "@/components/ui/Icone";
import { FormulaireMotDePasse } from "@/components/auth/FormulaireMotDePasse";
import { GuideInstallation } from "./GuideInstallation";
import { BoutonCopierLien } from "./BoutonCopierLien";

/**
 * **Le parcours d'entrée**, montré une fois par lien personnel (`Invitation.parcoursVuLe`).
 *
 * Deux questions, dans cet ordre, et chacune peut être déclinée :
 *   1. « Veux-tu installer l'application sur ton téléphone ? » — trois réponses, dont « je l'ai
 *      déjà installée », qui est le cas piégeux : sur iPhone, l'application posée sur l'écran
 *      d'accueil a un stockage séparé de Safari, et le lien touché dans Mail n'y entrera jamais.
 *      Il faut copier son lien et le coller dans l'application — ce que les écrans disent sans
 *      jamais nommer ni le stockage ni Safari : on y explique le geste, pas le mécanisme.
 *      Cette étape est **sautée** sur
 *      ordinateur et quand on est déjà dans l'application installée : la question n'a pas de sens là.
 *   2. « Veux-tu consolider ton compte ? » — un mot de passe, puis la double authentification.
 *      Facultatif de bout en bout : « Continuer avec mon lien » n'installe et ne configure rien.
 *
 * **Pas de clignotement** : la plateforme ne se connaît que dans le navigateur, donc le premier
 * rendu (serveur, puis hydratation) affiche un état d'attente neutre — jamais une version qui
 * serait aussitôt remplacée par une autre.
 */

/**
 * « detection » : le premier rendu, avant de savoir sur quel appareil on est.
 * « fin » : on sort vers l'application ; aucune vue, juste la navigation.
 */
type Etape = "detection" | "installer" | "guide" | "deja-installee" | "consolider" | "deux-fa" | "fin";

function surOrdinateurOuDejaInstallee(): boolean {
  if (typeof window === "undefined") return true;
  // Déjà dans l'application posée sur l'écran d'accueil : lui proposer de l'installer serait absurde
  if (window.matchMedia("(display-mode: standalone)").matches) return true;
  // Sur ordinateur, l'installation n'est pas le sujet (et le lien reste accessible dans le navigateur)
  return !/iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
}

type Props = {
  prenom: string;
  /** Le lien en clair, s'il a pu être transmis par l'ouverture du jeton (sinon : pas de copie possible). */
  lienPersonnel: string | null;
  /** Où entrer à la fin : la page demandée au départ, ou l'accueil. */
  suite: string;
  aDejaUnMotDePasse: boolean;
  aUnEmail: boolean;
  /**
   * Administrateur dont le mot de passe ou la double authentification manquent. Pour lui les deux
   * sont **obligatoires** (l'espace admin n'ouvre qu'avec), et se règlent d'un seul tenant sur
   * `/admin/activer` — que `suite` porte déjà. Lui proposer ici « c'est facultatif, continue avec
   * ton lien » serait lui mentir, et lui faire le même réglage deux fois.
   */
  reglageAdminDu?: boolean;
};

export function ParcoursAccueil({ prenom, lienPersonnel, suite, aDejaUnMotDePasse, aUnEmail, reglageAdminDu = false }: Props) {
  const router = useRouter();
  const [etape, setEtape] = useState<Etape>("detection");

  // La consolidation n'a de sens que si elle a quelque chose à proposer : une adresse pour se
  // connecter, et pas déjà un mot de passe. Sinon on entre directement — et un administrateur y va
  // par la porte obligatoire, pas par celle-ci.
  const consolidationDue = aUnEmail && !aDejaUnMotDePasse && !reglageAdminDu;

  useEffect(() => {
    // Sur ordinateur, ou déjà dans l'application installée : la question de l'installation ne se
    // pose pas. On enchaîne sur la consolidation si elle est due, sinon on entre.
    setEtape(surOrdinateurOuDejaInstallee() ? (consolidationDue ? "consolider" : "fin") : "installer");
  }, [consolidationDue]);

  // « fin » n'est pas une vue : c'est la sortie. `replace` pour que le retour arrière ne ramène
  // pas dans un parcours déjà terminé.
  useEffect(() => {
    if (etape === "fin") router.replace(suite);
  }, [etape, router, suite]);

  const continuer = () => setEtape(consolidationDue ? "consolider" : "fin");

  if (etape === "detection" || etape === "fin") {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-3xl">Ton compte est prêt, {prenom} !</h1>
        <p className="text-texte-secondaire">Un instant…</p>
      </div>
    );
  }

  if (etape === "installer") {
    return (
      <div className="flex flex-col gap-5">
        <div>
          <h1 className="text-3xl">Bienvenue {prenom} !</h1>
          <p className="mt-2">Tu es connecté(e). Veux-tu installer l&apos;application sur ton téléphone ? Elle s&apos;ouvrira d&apos;une seule touche, comme n&apos;importe quelle app.</p>
        </div>
        <Bouton type="button" taille="grande" pleineLargeur onClick={() => setEtape("guide")}>
          <Icone nom="telecharger" taille={20} />
          Oui, l&apos;installer
        </Bouton>
        <Bouton type="button" variante="secondaire" taille="grande" pleineLargeur onClick={() => setEtape("deja-installee")}>
          Je l&apos;ai déjà installée
        </Bouton>
        <Bouton type="button" variante="discret" pleineLargeur onClick={continuer}>
          Non, continuer dans le navigateur
        </Bouton>
      </div>
    );
  }

  if (etape === "guide") {
    return (
      <div className="flex flex-col gap-5">
        <div>
          <h1 className="text-3xl">Installer l&apos;application</h1>
          <p className="mt-2">Déroule ton appareil, puis suis les trois étapes. Celui que tu tiens est déjà ouvert.</p>
        </div>
        <GuideInstallation />
        {lienPersonnel && (
          <BoutonCopierLien
            lien={lienPersonnel}
            titre="Dernière étape : ton lien"
            description="Appuie sur le bouton, ton lien est copié. Ouvre l'application depuis ton écran d'accueil : un champ t'attend pour le coller. Une seule fois — ensuite elle te reconnaît."
          />
        )}
        <Bouton type="button" variante="discret" pleineLargeur onClick={continuer}>
          Plus tard
        </Bouton>
      </div>
    );
  }

  if (etape === "deja-installee") {
    return (
      <div className="flex flex-col gap-5">
        <div>
          <h1 className="text-3xl">Connecter l&apos;application installée</h1>
          <p className="mt-2">L&apos;application posée sur ton écran d&apos;accueil ne te connaît pas encore. Donne-lui ton lien une fois, et ce sera réglé.</p>
        </div>
        {lienPersonnel ? (
          <BoutonCopierLien
            lien={lienPersonnel}
            titre="Copie ton lien"
            description="Appuie sur le bouton, ton lien est copié. Ouvre l'application depuis ton écran d'accueil : un champ t'attend pour le coller."
          />
        ) : (
          <p className="rounded-xl bg-surface-douce p-4 text-texte-secondaire">
            Ton lien n&apos;est plus disponible sur cet écran. Rouvre-le depuis ton email, ou demande à un administrateur de t&apos;en renvoyer un.
          </p>
        )}
        <p className="rounded-xl bg-surface-douce p-4 text-texte-secondaire">
          Tu as déjà un mot de passe ? Alors ouvre simplement l&apos;application et connecte-toi avec ton adresse et ton mot de passe — pas besoin du lien.
        </p>
        <Bouton type="button" variante="discret" pleineLargeur onClick={continuer}>
          Plus tard
        </Bouton>
      </div>
    );
  }

  if (etape === "consolider") {
    return (
      <div className="flex flex-col gap-5">
        <div>
          <h1 className="text-3xl">Consolider ton compte</h1>
          <p className="mt-2">
            C&apos;est facultatif. Ton lien personnel suffit pour entrer. Un mot de passe te permet <em>en plus</em> de te connecter depuis un appareil où tu n&apos;as pas ton
            lien — un ordinateur prêté, un téléphone neuf.
          </p>
        </div>
        <section className="rounded-2xl border border-bordure/60 bg-surface p-5 shadow-carte">
          <h2 className="mb-3 text-xl font-bold">Me créer un mot de passe</h2>
          <FormulaireMotDePasse aDejaUnMotDePasse={false} apresSucces={() => setEtape("deux-fa")} />
        </section>
        {lienPersonnel ? (
          <BoutonCopierLien
            lien={lienPersonnel}
            destination={suite}
            toujoursNaviguer
            variante="secondaire"
            titre="Ou garde ton lien, tout simplement"
            description="Rien à configurer : ton lien personnel continue de t'ouvrir l'application. On te le copie au passage, il pourra servir."
            libelle="Continuer avec mon lien"
          />
        ) : (
          <LienBouton href={suite} variante="secondaire" taille="grande" pleineLargeur>
            Continuer avec mon lien
          </LienBouton>
        )}
      </div>
    );
  }

  // etape === "deux-fa" : le mot de passe vient d'être posé, la double authentification s'ajoute (ou pas)
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-3xl">Mot de passe enregistré</h1>
        <p className="mt-2">
          Tu peux maintenant te connecter avec ton adresse et ce mot de passe, depuis n&apos;importe quel appareil. Veux-tu ajouter une double authentification ? C&apos;est un
          code à 6 chiffres donné par une application sur ton téléphone — facultatif, et réglable plus tard.
        </p>
      </div>
      <LienBouton href="/profil#securite" taille="grande" pleineLargeur>
        <Icone nom="bouclier" taille={20} />
        Activer la double authentification
      </LienBouton>
      <LienBouton href={suite} variante="secondaire" taille="grande" pleineLargeur>
        Entrer dans l&apos;application
      </LienBouton>
      <p className="text-center text-sm text-texte-secondaire">
        Tu retrouveras ces réglages dans <Link href="/profil#securite">Mon profil → Sécuriser mon compte</Link>.
      </p>
    </div>
  );
}
