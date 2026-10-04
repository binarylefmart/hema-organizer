"use client";

import { useActionState, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { definirPreferenceNotification } from "@/actions/profil";
import { Alerte } from "@/components/ui/Alerte";
import { Bouton } from "@/components/ui/Bouton";
import { BoutonEnvoi } from "@/components/ui/BoutonEnvoi";
import { Icone } from "@/components/ui/Icone";
import { FORM_INITIAL, type FormState } from "@/lib/form";
import { Pastille } from "@/components/ui/Pastille";
import type { CanalLigne, LigneNotification, LigneObligatoire } from "@/lib/notifications/membre";

/**
 * Une ligne de la carte. Tout est préparé côté serveur (`src/lib/notifications/membre.ts`, qui porte
 * aussi les types ci-dessous) : ce composant ne
 * connaît ni la table des types, ni la base, et n'affiche jamais de nom technique.
 */
/** Ce que porte chaque colonne : un mot, une icône, et rien à expliquer. */
export const CANAUX_LIGNE: ReadonlyArray<{ canal: CanalLigne; libelle: string }> = [
  { canal: "email", libelle: "Email" },
  { canal: "push", libelle: "Téléphone" },
];

type Props = {
  lignes: readonly LigneNotification[];
  obligatoires: readonly LigneObligatoire[];
  /** Types conservés par « Ne recevoir que l'essentiel » */
  typesEssentiels: readonly string[];
  /** Au moins un appareil est abonné : sinon la colonne « Téléphone » ne sert encore à rien */
  pushBranche?: boolean;
};

/**
 * Une ligne, un interrupteur par canal.
 *
 * Le libellé du canal est sous l'interrupteur, en toutes lettres : « Email », « Téléphone ». Deux
 * petites icônes seules demanderaient un mode d'emploi, et l'application s'adresse à des gens de
 * tous âges. L'état se lit pareil — « Oui » / « Non » — parce qu'un interrupteur dessiné ne dit
 * rien à qui ne connaît pas la convention.
 */
function Ligne({ ligne, choix, onChange }: { ligne: LigneNotification; choix: Record<CanalLigne, boolean>; onChange: (canal: CanalLigne, v: boolean) => void }) {
  const idAide = `notif-${ligne.type}-quand`;
  return (
    <li className="flex min-h-14 flex-wrap items-start justify-between gap-x-4 gap-y-2 py-3">
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{ligne.titre}</span>
        <span id={idAide} className="mt-0.5 block text-sm text-texte-secondaire">
          {ligne.quand}
        </span>
      </span>
      <span className="flex shrink-0 gap-3">
        {CANAUX_LIGNE.filter((c) => ligne.club[c.canal]).map(({ canal, libelle }) => {
          const coche = choix[canal] ?? false;
          return (
            <label key={canal} className="flex cursor-pointer flex-col items-center gap-1">
              <span className="relative inline-flex items-center">
                <input
                  type="checkbox"
                  className="peer absolute inset-0 size-full cursor-pointer opacity-0"
                  checked={coche}
                  aria-label={`${ligne.titre} — ${libelle}`}
                  aria-describedby={idAide}
                  onChange={(e) => onChange(canal, e.target.checked)}
                />
                <span
                  aria-hidden
                  className="block h-7 w-12 rounded-full border-2 border-bordure bg-surface-douce transition peer-checked:border-vert peer-checked:bg-vert peer-focus-visible:ring-2 peer-focus-visible:ring-jauge peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-surface"
                />
                <span
                  aria-hidden
                  className="pointer-events-none absolute left-1 size-5 rounded-full bg-texte-secondaire shadow-bouton transition peer-checked:translate-x-5 peer-checked:bg-surface"
                />
              </span>
              <span className={`text-xs font-semibold ${coche ? "text-vert" : "text-texte-secondaire"}`}>{libelle}</span>
            </label>
          );
        })}
      </span>
    </li>
  );
}

/** Message que le club n'envoie plus : rien à refuser, donc pas d'interrupteur. */
function LigneCoupee({ ligne }: { ligne: LigneNotification }) {
  return (
    <li className="flex min-h-14 items-start gap-3 py-3 sm:gap-4">
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-texte-secondaire">{ligne.titre}</span>
        <span className="mt-0.5 block text-sm text-texte-secondaire">{ligne.quand}</span>
      </span>
      <span className="shrink-0 pt-0.5">
        <Pastille ton="neutre">désactivé par le club</Pastille>
      </span>
    </li>
  );
}

/**
 * **Mes notifications** — une ligne par message, un interrupteur par canal, un seul bouton
 * d'enregistrement.
 *
 * Trois partis pris, pour un public de tous âges peu à l'aise avec l'informatique :
 * - **rien ne part en douce** : les interrupteurs ne changent que l'écran ; c'est « Enregistrer mes
 *   choix » qui change le compte, et la confirmation le dit noir sur blanc ;
 * - **deux raccourcis** en tête (« Tout recevoir », « Ne recevoir que l'essentiel ») évitent une
 *   dizaine d'appuis à qui veut simplement moins de messages — ils cochent, ils n'enregistrent pas ;
 * - **trois blocs séparés** : ce qui se refuse, ce que le club n'envoie plus, ce qui part toujours.
 *
 * L'enregistrement rejoue ligne par ligne l'action du serveur (`definirPreferenceNotification`), qui
 * reste seule juge : un type inconnu est refusé, et un message coupé par le bureau n'est jamais
 * renvoyé (ces lignes-là n'ont pas d'interrupteur).
 */
type Choix = Record<string, Record<CanalLigne, boolean>>;

export function CarteNotifications({ lignes, obligatoires, typesEssentiels, pushBranche = false }: Props) {
  const router = useRouter();
  const initial = useMemo(() => Object.fromEntries(lignes.map((l) => [l.type, { ...l.choix }])) as Choix, [lignes]);
  const [choix, setChoix] = useState<Choix>(initial);
  const [enregistre, setEnregistre] = useState<Choix>(initial);

  /** Les canaux encore ouverts par le club pour cette ligne : eux seuls ont un interrupteur. */
  const ouverts = (l: LigneNotification) => CANAUX_LIGNE.filter((c) => l.club[c.canal]).map((c) => c.canal);
  const refusables = lignes.filter((l) => ouverts(l).length > 0);
  const coupees = lignes.filter((l) => ouverts(l).length === 0);
  const modifiees = refusables.flatMap((l) => ouverts(l).filter((canal) => choix[l.type]?.[canal] !== enregistre[l.type]?.[canal]).map((canal) => ({ ligne: l, canal })));
  const recus = refusables.filter((l) => ouverts(l).some((canal) => choix[l.type]?.[canal])).length;

  const [etat, envoyer] = useActionState<FormState, FormData>(async () => {
    if (modifiees.length === 0) return { succes: "Rien n'a changé : tes choix étaient déjà enregistrés." };
    for (const { ligne, canal } of modifiees) {
      const res = await definirPreferenceNotification(ligne.type, canal, choix[ligne.type][canal]);
      if (res.erreur) return res;
    }
    setEnregistre({ ...choix });
    // L'écran est rendu côté serveur : on le remet d'aplomb pour qu'un retour sur la page
    // (ou un réglage coupé entre-temps par le bureau) affiche bien l'état réel.
    router.refresh();
    return {
      succes:
        recus === 0
          ? "C'est enregistré : tu ne recevras plus aucun de ces messages."
          : `C'est enregistré : tu recevras ${recus} sorte${recus > 1 ? "s" : ""} de message sur ${refusables.length}.`,
    };
  }, FORM_INITIAL);

  /** Les raccourcis règlent les deux canaux d'un coup : c'est ce qu'on attend de « Tout recevoir ». */
  const regler = (garde: (type: string) => boolean) =>
    setChoix({ ...choix, ...Object.fromEntries(refusables.map((l) => [l.type, { email: garde(l.type), push: garde(l.type) }])) });

  // `id` + `scroll-mt-20` : entrée du sommaire de « Mon profil » (`SommaireCollant`) — sans le
  // dégagement, l'en-tête collant recouvre le titre qu'on vient d'atteindre.
  return (
    <section id="mes-notifications" className="scroll-mt-20 rounded-2xl border border-bordure/60 bg-surface p-4 shadow-carte sm:p-5">
      <h2 className="text-xl font-bold">Mes notifications</h2>
      <p className="mt-1 text-texte-secondaire">
        Choisis les messages que tu veux recevoir, et par quel moyen. Ce que tu mets sur « Non » ne t&apos;est plus envoyé — les autres membres, eux,
        continuent de le recevoir.
      </p>
      {!pushBranche && (
        <p className="mt-2 text-sm text-texte-secondaire">
          La colonne « Téléphone » ne servira qu&apos;une fois les notifications activées sur un appareil, juste au-dessus.
        </p>
      )}

      <form action={envoyer} className="mt-4 flex flex-col gap-4">
        {refusables.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <Bouton type="button" variante="secondaire" taille="petite" onClick={() => regler(() => true)}>
              <Icone nom="check" taille={18} />
              Tout recevoir
            </Bouton>
            <Bouton type="button" variante="secondaire" taille="petite" onClick={() => regler((type) => typesEssentiels.includes(type))}>
              <Icone nom="interdit" taille={18} />
              Ne recevoir que l&apos;essentiel
            </Bouton>
          </div>
        )}

        {refusables.length > 0 && (
          <fieldset>
            <legend className="sr-only">Messages que je peux refuser</legend>
            <ul className="flex flex-col divide-y divide-bordure/60">
              {refusables.map((l) => (
                <Ligne
                  key={l.type}
                  ligne={l}
                  choix={choix[l.type] ?? { email: false, push: false }}
                  onChange={(canal, v) => setChoix({ ...choix, [l.type]: { ...choix[l.type], [canal]: v } })}
                />
              ))}
            </ul>
          </fieldset>
        )}

        {coupees.length > 0 && (
          <div className="rounded-xl border border-bordure/60 bg-surface-douce/40 p-3">
            <p className="font-semibold">Ce que le club n&apos;envoie plus</p>
            <p className="mt-0.5 text-sm text-texte-secondaire">Rien à refuser ici : le bureau a coupé ces messages pour tout le monde.</p>
            <ul className="mt-1 flex flex-col divide-y divide-bordure/60">
              {coupees.map((l) => (
                <LigneCoupee key={l.type} ligne={l} />
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <BoutonEnvoi enCours="Enregistrement…" pleineLargeur>
            <Icone nom="check" taille={20} />
            Enregistrer mes choix
          </BoutonEnvoi>
          {modifiees.length > 0 && (
            <p className="text-sm font-semibold text-ocre" role="status">
              Tes choix ne sont pas encore enregistrés : appuie sur « Enregistrer mes choix ».
            </p>
          )}
          {modifiees.length === 0 && etat.succes && <Alerte type="succes">{etat.succes}</Alerte>}
          {etat.erreur && <Alerte type="erreur">{etat.erreur}</Alerte>}
        </div>
      </form>

      {obligatoires.length > 0 && (
        <div className="mt-5 rounded-xl border border-bordure/60 bg-surface-douce/40 p-3">
          <p className="flex flex-wrap items-center gap-2 font-semibold">
            Ce qui t&apos;est envoyé dans tous les cas <Pastille ton="primaire">toujours</Pastille>
          </p>
          <ul className="mt-2 flex flex-col gap-2 text-sm">
            {obligatoires.map((n) => (
              <li key={n.titre}>
                <span className="font-semibold">{n.titre}</span> — <span className="text-texte-secondaire">{n.quand}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-sm text-texte-secondaire">
            Ces messages ne se coupent pas : sans eux, tu ne pourrais plus entrer dans l&apos;application, ni être prévenu qu&apos;un accès à ton compte a été
            volé.
          </p>
        </div>
      )}
    </section>
  );
}
