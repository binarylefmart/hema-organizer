"use client";

import { useEffect, useState, useTransition } from "react";
import { choisirTheme } from "@/actions/profil";
import { GROUPES_THEMES, lireChoixTheme, THEMES, valeurDuChoix, type ChoixTheme } from "@/lib/themes";
import { Icone } from "@/components/ui/Icone";
import { Select } from "@/components/ui/Select";

/** Pose le thème et son mode sur la page entière : les couleurs viennent de variables CSS, les attributs suffisent. */
function peindre({ id, mode }: ChoixTheme) {
  const html = document.documentElement;
  html.dataset.theme = id;
  if (mode) html.dataset.mode = mode;
  else delete html.dataset.mode;
}

/**
 * Vrai quand l'appareil affiche en sombre. Le premier rendu (serveur, puis hydratation) répond
 * toujours « clair » — faute de `window` — et l'effet corrige juste après le montage ; il suit
 * ensuite les bascules du système tant que le composant est à l'écran.
 */
function useModeSombre(): boolean {
  const [sombre, setSombre] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    setSombre(media.matches);
    const suivre = (e: MediaQueryListEvent) => setSombre(e.matches);
    media.addEventListener("change", suivre);
    return () => media.removeEventListener("change", suivre);
  }, []);

  return sombre;
}

/** Les trois couleurs du thème, en pur décor : le nom dans la liste porte déjà l'information. */
function Pastilles({ fond, primaire, texte }: { fond: string; primaire: string; texte: string }) {
  return (
    <span aria-hidden className="flex shrink-0 items-center gap-1.5">
      {[fond, primaire, texte].map((couleur, i) => (
        // Valeurs de données (hex du catalogue) : pas de classe Tailwind possible, donc style inline.
        <span key={i} className="size-7 rounded-full border border-bordure/60 shadow-champ" style={{ backgroundColor: couleur }} />
      ))}
    </span>
  );
}

/**
 * **Apparence** — une liste déroulante des palettes, et la page se repeint pendant qu'on choisit.
 *
 * L'aperçu est immédiat : l'attribut `data-theme` est posé sur `<html>` dès le changement, avant
 * même la réponse du serveur ; l'enregistrement suit. Si le serveur refuse, l'ancien thème est
 * remis sur-le-champ et l'erreur s'affiche — jamais d'écran qui ment sur ce qui est enregistré.
 */
export function SelecteurTheme({ valeur }: { valeur: ChoixTheme }) {
  const [choix, setChoix] = useState<ChoixTheme>(valeur);
  const [message, setMessage] = useState<{ ton: "succes" | "erreur"; texte: string } | null>(null);
  const [enCours, demarrer] = useTransition();
  const sombre = useModeSombre();
  const theme = THEMES.find((t) => t.id === choix.id) ?? THEMES[0];
  // Les pastilles montrent la palette du mode réellement affiché, sinon elles annoncent d'autres couleurs.
  const pastilles = (choix.mode ? choix.mode === "sombre" : sombre) ? theme.apercuSombre : theme.apercu;

  function changer(brut: string) {
    const nouveau = lireChoixTheme(brut);
    const precedent = choix;
    if (!nouveau || valeurDuChoix(nouveau) === valeurDuChoix(precedent)) return;
    // 1. l'écran d'abord : la personne voit sa palette avant que le serveur ait répondu
    setChoix(nouveau);
    peindre(nouveau);
    setMessage(null);
    // 2. puis l'enregistrement — et un retour en arrière complet s'il est refusé
    demarrer(async () => {
      const res = await choisirTheme(valeurDuChoix(nouveau));
      if (res.erreur) {
        setChoix(precedent);
        peindre(precedent);
        setMessage({ ton: "erreur", texte: res.erreur });
        return;
      }
      setMessage({ ton: "succes", texte: "Thème appliqué." });
    });
  }

  return (
    /*
     * **`@container` et non `sm:` — ici, c'est le conteneur qu'il faut mesurer, pas la fenêtre**.
     * La carte « Apparence » vit depuis ce matin dans une demi-colonne de 536 px sur les grands
     * écrans (« Mon profil » en deux piles). `sm:flex-row` regarde la **fenêtre** : sur un écran de
     * 1 920 px il passait donc en rangée quoi qu'il arrive, et la légende du thème (« Papier ancien
     * et rouille — la palette d'origine de l'outil ») se coupait en sept lignes de trois mots à
     * côté de la liste déroulante. C'est le piège que `CLAUDE.md` nomme en toutes lettres, en
     * version douce : une découpe en `sm:`/`lg:` n'est légitime que dans un conteneur dont on sait
     * qu'il suit la fenêtre, et une carte de profil ne la suit plus.
     *
     * `@2xl` vaut 42 rem (672 px) de **conteneur** : c'est la largeur à partir de laquelle la liste
     * (18 rem) et l'aperçu tiennent côte à côte sans serrer la légende. En dessous — demi-colonne,
     * tablette, téléphone —, les deux s'empilent, et la légende prend toute la largeur.
     */
    <div className="@container flex flex-col gap-4">
      <p className="text-texte-secondaire">Choisis les couleurs de l&apos;application. Le changement se voit tout de suite.</p>

      <div className="flex flex-col gap-3 @2xl:flex-row @2xl:items-start">
        <div className="flex flex-col gap-1 @2xl:w-72">
          <Select
            label="Thème de couleurs"
            name="theme"
            value={valeurDuChoix(choix)}
            disabled={enCours}
            onChange={(e) => changer(e.target.value)}
            className="min-h-11 w-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-jauge disabled:opacity-60"
          >
            {/* Un thème qui suit encore l'appareil (celui du club, ou un choix d'avant la séparation)
                garde sa ligne tant qu'il est le choix en cours : sans elle, la liste afficherait un
                autre thème que celui de l'écran. */}
            {!choix.mode && <option value={choix.id}>{theme.nom} (suit l&apos;appareil)</option>}
            {GROUPES_THEMES.map((g) => (
              <optgroup key={g.mode} label={g.libelle}>
                {g.choix.map((c) => (
                  <option key={c.valeur} value={c.valeur}>
                    {c.nom}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>

          {/* Zone d'état unique, toujours dans le DOM (sinon rien n'est annoncé) et de hauteur réservée :
              placée ici, sous la liste, elle ne creuse plus de vide au milieu de la carte et le texte qui
              apparaît puis disparaît ne fait bouger aucun bloc. */}
          <p aria-live="polite" className="min-h-6 text-sm font-semibold">
            {message && (
              <span className={`inline-flex items-center gap-2 ${message.ton === "succes" ? "text-vert" : "text-rouge"}`}>
                <Icone nom={message.ton === "succes" ? "check" : "alerte"} taille={18} />
                {message.texte}
              </span>
            )}
          </p>
        </div>

        <div className="flex min-w-0 flex-1 items-center gap-3 rounded-xl border border-bordure/60 bg-surface-douce/40 p-3 @2xl:mt-8">
          <Pastilles fond={pastilles.fond} primaire={pastilles.primaire} texte={pastilles.texte} />
          <p className="min-w-0 text-sm text-texte-secondaire">{theme.description}</p>
        </div>
      </div>

      <p className="text-sm text-texte-secondaire">
        Un thème clair reste clair et un thème sombre reste sombre, quel que soit le réglage de ton téléphone ou de ton ordinateur. Ce choix
        n&apos;est que pour toi, il ne change rien pour les autres membres.
      </p>
    </div>
  );
}
