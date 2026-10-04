"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { televerserAffiche } from "@/actions/evenements";
import { verifierImageCollee } from "@/actions/liens";
import { AFFICHE_TAILLE_MAX, AFFICHE_TAILLE_MAX_LIBELLE } from "@/lib/constants";
import { Bouton } from "@/components/ui/Bouton";
import { Icone } from "@/components/ui/Icone";
import { sourceImage } from "./libelles";

/** Formats acceptés — les trois que tous les téléphones et tous les navigateurs savent produire. */
const FORMATS = ["image/jpeg", "image/png", "image/webp"] as const;
/*
 * **Le plafond n'est plus recopié ici** : il vient de `src/lib/constants.ts`, avec les mots qui
 * l'annoncent, et c'est le même nombre que celui dont le serveur refuse le dépassement
 * (`AFFICHE_TAILLE_MAX`, lu par `televerserAffiche`). Il était écrit une fois en octets et deux
 * fois en clair (« 4 Mo ») dans ce seul fichier : changer la valeur laissait l'écran promettre
 * l'ancienne, et aucun test ne reliait la phrase au plafond. Au-delà de ce poids, l'envoi devient
 * long en 4G et l'affiche n'y gagne rien à l'écran.
 */

type Props = {
  valeur: string;
  onChange: (url: string) => void;
  /** Nom du champ posté — le formulaire continue d'envoyer `imageUrl` comme avant. */
  nom?: string;
};

/** Refus décidé côté navigateur : inutile d'envoyer 12 Mo pour s'entendre dire non. */
function refus(fichier: File): string | null {
  if (!(FORMATS as readonly string[]).includes(fichier.type)) {
    return "Ce fichier n'est pas une image JPEG, PNG ou WebP — choisis une photo ou une image.";
  }
  if (fichier.size > AFFICHE_TAILLE_MAX) {
    return `L'affiche dépasse ${AFFICHE_TAILLE_MAX_LIBELLE} — choisis une image plus légère.`;
  }
  return null;
}

/**
 * Choix de l'affiche d'un événement : on fait glisser l'image depuis son bureau, on la colle, on la
 * prend dans sa galerie — ou on colle encore l'adresse d'une image, comme avant.
 *
 * Le glisser-déposer est un raccourci pour ceux qui l'ont sous la main, jamais le seul chemin : il
 * n'existe pas au doigt sur téléphone et se refuse au clavier. C'est donc un vrai
 * `<input type="file">` qui porte l'action — masqué à l'œil, présent pour le clavier et pour le
 * lecteur d'écran — et la zone entière n'est que le `<label>` qui l'active. Là où d'autres posent un
 * `role="button"` et réécrivent Entrée et Espace, le navigateur fait déjà tout, et mieux.
 *
 * La valeur finale, quelle que soit la route empruntée, tient dans un seul champ caché : le
 * formulaire ne voit aucune différence entre une affiche déposée et une adresse collée.
 */
export function ChampAffiche({ valeur, onChange, nom = "imageUrl" }: Props) {
  const id = useId();
  const champFichier = useRef<HTMLInputElement>(null);
  /** Compteur d'entrées/sorties : sans lui, survoler un enfant ferait clignoter la zone. */
  const entrees = useRef(0);
  /** URL objet de l'aperçu immédiat, à libérer dès qu'elle ne sert plus. */
  const objetUrl = useRef<string | null>(null);
  const [survol, setSurvol] = useState(false);
  const [apercuLocal, setApercuLocal] = useState<string | null>(null);
  const [message, setMessage] = useState<{ texte: string; ton: "info" | "erreur" } | null>(null);
  const [casse, setCasse] = useState(false);
  /**
   * **Le second essai d'une adresse collée à la main**, et pourquoi il existe.
   *
   * `/api/image` ne rapatrie plus que des adresses que le serveur connaît déjà. Une adresse **tapée
   * ou glissée** ici n'est ni l'une ni l'autre : le relais la refusait, l'image ne se chargeait
   * pas, et l'écran accusait le lien — « cette adresse n'affiche pas d'image » — alors qu'il était
   * bon. C'est la régression qu'a laissée la fermeture du relais, sur le chemin que ce champ
   * annonce lui-même (« ou coller l'adresse d'une image »).
   *
   * Le rattrapage se fait **sur l'échec, pas avant** : au premier `onError`, on demande au serveur
   * d'aller lire l'image de ses propres yeux (`verifierImageCollee`) ; s'il l'a lue, il la retient une
   * heure et on recharge la balise ; sinon il rend la vraie raison, et c'est elle qu'on affiche. Les
   * adresses déjà connues — la majorité — se chargent du premier coup et ne déclenchent **aucune**
   * requête de plus.
   *
   * `essai` sert à forcer le rechargement (changer la `key` de la balise, jamais son `src` : y coller
   * un paramètre anti-cache changerait l'adresse, donc la ferait sortir de la liste blanche) ; le
   * `Set` retient les adresses déjà éprouvées, sans quoi une image vraiment cassée ferait boucler
   * l'échec et la vérification.
   */
  const [essai, setEssai] = useState(0);
  const eprouvees = useRef(new Set<string>());
  /**
   * L'attente suit la **promesse de l'action**, jamais `pending` — même règle que `BoutonAction`.
   * Ici elle valait une impasse : un corps de plus d'un mégaoctet est refusé par Next **avant**
   * d'entrer dans l'action, la promesse rejette sans jamais produire de `res.erreur`, et l'écran
   * restait sur « Envoi de l'affiche… » pour toujours, sans rien à cliquer.
   */
  const [, demarrer] = useTransition();
  const [envoi, setEnvoi] = useState(false);
  /** L'affiche a été déposée ici (et non collée depuis le Web) : son adresse est la nôtre. */
  const depotLocal = valeur.startsWith("/api/affiche/");

  // Dernier filet : si le formulaire disparaît en cours d'envoi, l'URL objet ne fuit pas.
  useEffect(() => () => {
    if (objetUrl.current) URL.revokeObjectURL(objetUrl.current);
  }, []);

  function libererApercu() {
    if (objetUrl.current) {
      URL.revokeObjectURL(objetUrl.current);
      objetUrl.current = null;
    }
    setApercuLocal(null);
  }

  /** Premier échec de chargement d'une adresse collée : on demande au serveur d'aller la lire. */
  function rattraperAdresseCollee() {
    const url = valeur.trim();
    if (!url || depotLocal || eprouvees.current.has(url)) {
      setCasse(true);
      return;
    }
    eprouvees.current.add(url);
    demarrer(async () => {
      try {
        const res = await verifierImageCollee(url);
        if (res.ok) {
          // Le serveur l'a lue : la balise peut réessayer, cette fois le relais l'acceptera.
          setCasse(false);
          setEssai((n) => n + 1);
          return;
        }
        setCasse(true);
        setMessage({ texte: res.erreur, ton: "erreur" });
      } catch {
        setCasse(true);
      }
    });
  }

  function traiter(fichier: File) {
    const probleme = refus(fichier);
    if (probleme) {
      setMessage({ texte: probleme, ton: "erreur" });
      return;
    }
    // Aperçu tout de suite : on voit ce qu'on a lâché avant même que l'envoi commence.
    libererApercu();
    const url = URL.createObjectURL(fichier);
    objetUrl.current = url;
    setApercuLocal(url);
    setCasse(false);
    setMessage({ texte: "Envoi de l'affiche…", ton: "info" });

    setEnvoi(true);
    demarrer(async () => {
      try {
        const fd = new FormData();
        fd.append("fichier", fichier);
        const res = await televerserAffiche(fd);
        if (!res.ok) {
          libererApercu();
          setMessage({ texte: res.erreur, ton: "erreur" });
          return;
        }
        onChange(res.url);
        libererApercu();
        setMessage({ texte: "Affiche enregistrée.", ton: "info" });
      } catch {
        // Réseau coupé, envoi interrompu, corps refusé en amont de l'action : dans tous ces cas
        // rien ne revient du serveur. Mieux vaut dire que l'envoi a échoué et rendre la main que
        // laisser tourner une attente sans fin.
        libererApercu();
        setMessage({ texte: "L'envoi de l'affiche a échoué. Vérifie ta connexion, puis réessaie — ou choisis une image plus légère.", ton: "erreur" });
      } finally {
        setEnvoi(false);
      }
    });
  }

  function premiereImage(liste: FileList | null | undefined): File | null {
    if (!liste) return null;
    for (const fichier of Array.from(liste)) {
      if (fichier.type.startsWith("image/")) return fichier;
    }
    return liste.length > 0 ? liste[0] : null;
  }

  function surDepot(ev: React.DragEvent) {
    ev.preventDefault();
    entrees.current = 0;
    setSurvol(false);
    const fichier = premiereImage(ev.dataTransfer?.files);
    if (fichier) {
      traiter(fichier);
      return;
    }
    // Une image glissée depuis un autre onglet arrive en adresse, pas en fichier : on la prend telle quelle.
    const texte = ev.dataTransfer?.getData("text/uri-list") || ev.dataTransfer?.getData("text/plain");
    if (texte && /^https?:\/\//i.test(texte.trim())) {
      libererApercu();
      setCasse(false);
      onChange(texte.trim());
      setMessage({ texte: "Adresse de l'image reprise du lien déposé.", ton: "info" });
      return;
    }
    setMessage({ texte: "Ce qui a été déposé n'est pas une image.", ton: "erreur" });
  }

  function surCollage(ev: React.ClipboardEvent) {
    const fichier = premiereImage(ev.clipboardData?.files);
    if (!fichier || !fichier.type.startsWith("image/")) return; // un texte collé suit son cours (champ d'adresse)
    ev.preventDefault();
    traiter(fichier);
  }

  const affichee = apercuLocal ?? (valeur ? sourceImage(valeur) : null);

  return (
    <div className="flex flex-col gap-2" onPaste={surCollage}>
      <span id={`${id}-label`} className="font-semibold">
        Affiche de l&apos;événement
      </span>

      {/* La valeur postée, d'où qu'elle vienne */}
      <input type="hidden" name={nom} value={valeur} />

      {/* Le vrai champ : invisible, mais dans l'ordre de tabulation et annoncé au lecteur d'écran.
          `peer` porte le focus jusqu'à la zone, qui dessine l'anneau à sa place. */}
      <input
        ref={champFichier}
        id={`${id}-fichier`}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="peer sr-only"
        aria-describedby={`${id}-aide ${id}-etat`}
        onChange={(ev) => {
          const fichier = ev.target.files?.[0];
          if (fichier) traiter(fichier);
          ev.target.value = ""; // pour pouvoir redéposer deux fois de suite le même fichier
        }}
      />

      <div
        onDragEnter={(ev) => {
          ev.preventDefault();
          entrees.current += 1;
          setSurvol(true);
        }}
        onDragOver={(ev) => {
          ev.preventDefault();
          if (ev.dataTransfer) ev.dataTransfer.dropEffect = "copy";
        }}
        onDragLeave={(ev) => {
          ev.preventDefault();
          entrees.current -= 1;
          if (entrees.current <= 0) {
            entrees.current = 0;
            setSurvol(false);
          }
        }}
        onDrop={surDepot}
        className={[
          "rounded-2xl border-2 border-dashed p-4 motion-safe:transition-colors",
          "peer-focus-visible:border-primaire peer-focus-visible:bg-primaire-doux/40",
          survol ? "border-primaire bg-primaire-doux" : "border-bordure bg-surface-douce",
        ].join(" ")}
      >
        {affichee && !casse ? (
          <div className="flex flex-col items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- aperçu local (blob:) ou affiche servie par le relais /api/image : l'optimiseur Next est désactivé dans ce projet */}
            <img
              key={`${affichee}#${essai}`}
              src={affichee}
              alt="Aperçu de l'affiche"
              onError={rattraperAdresseCollee}
              className={`max-h-48 w-auto max-w-full rounded-xl object-contain ${envoi ? "opacity-60" : ""}`}
            />
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Bouton type="button" variante="secondaire" taille="petite" onClick={() => champFichier.current?.click()} disabled={envoi}>
                <Icone nom="telecharger" taille={18} />
                Changer l&apos;affiche
              </Bouton>
              <Bouton
                type="button"
                variante="danger"
                taille="petite"
                disabled={envoi}
                onClick={() => {
                  libererApercu();
                  setCasse(false);
                  onChange("");
                  setMessage({ texte: "Affiche retirée : la carte montrera l'écu du club.", ton: "info" });
                }}
              >
                <Icone nom="alerte" taille={18} />
                Retirer l&apos;affiche
              </Bouton>
            </div>
          </div>
        ) : (
          // Rien encore : toute la zone est le bouton, parce que c'est le `<label>` du champ fichier.
          <label htmlFor={`${id}-fichier`} className="flex min-h-12 cursor-pointer flex-col items-center justify-center gap-2 py-4 text-center">
            <Icone nom="telecharger" taille={28} className="text-texte-secondaire" />
            <span className="font-semibold">Dépose l&apos;affiche ici</span>
            <span className="text-sm text-texte-secondaire">ou touche cette zone pour choisir une image (JPEG, PNG ou WebP, {AFFICHE_TAILLE_MAX_LIBELLE} maximum)</span>
            {/* La raison précise, quand le serveur l'a donnée (« ce lien ne mène pas à une image
                acceptée », « ce site est introuvable »…), vit dans la ligne d'état en bas du champ.
                Ici on dit seulement qu'il n'y a rien à montrer, et quoi faire ensuite. */}
            {casse && valeur && <span className="text-sm font-semibold text-rouge">Cette adresse n&apos;affiche pas d&apos;image : vérifie le lien ou dépose un fichier.</span>}
          </label>
        )}
      </div>

      {/*
        Le repli qui ne doit jamais disparaître : le pré-remplissage depuis un lien écrit ici.
        Il s'efface en revanche pour une affiche **déposée** : son adresse interne
        (`/api/affiche/` + 64 caractères de SHA-256) n'a aucun sens pour la personne qui vient de
        lâcher une image, et un champ rempli d'une suite illisible qu'on n'a pas tapée inquiète
        plus qu'il n'informe. On dit alors simplement d'où vient l'affiche.
      */}
      {depotLocal ? (
        <p className="text-sm text-texte-secondaire">Affiche déposée depuis ton appareil.</p>
      ) : (
      <label htmlFor={`${id}-url`} className="text-sm text-texte-secondaire">
        ou coller l&apos;adresse d&apos;une image
      </label>
      )}
      {!depotLocal && (
      <input
        id={`${id}-url`}
        type="url"
        inputMode="url"
        value={valeur}
        onChange={(ev) => {
          libererApercu();
          setCasse(false);
          setMessage(null);
          // On oublie les épreuves passées : corriger une lettre de l'adresse mérite un vrai essai.
          eprouvees.current.delete(ev.target.value.trim());
          onChange(ev.target.value);
        }}
        maxLength={500}
        placeholder="https://…"
        disabled={envoi}
        className="min-h-13 rounded-xl border-2 border-bordure bg-surface px-4 text-[1.0625rem] text-texte shadow-champ focus:border-primaire disabled:bg-surface-douce disabled:text-texte-secondaire"
      />
      )}

      <p id={`${id}-aide`} className="text-sm text-texte-secondaire">
        Facultative. Fais glisser une image, colle-la (Ctrl+V), choisis-la dans ta galerie, ou colle son adresse. Sans affiche, la carte montre l&apos;écu du club.
      </p>
      <p id={`${id}-etat`} aria-live="polite" className={`min-h-5 text-sm font-semibold ${message?.ton === "erreur" ? "text-rouge" : "text-texte-secondaire"}`}>
        {envoi ? "Envoi…" : (message?.texte ?? "")}
      </p>
    </div>
  );
}
