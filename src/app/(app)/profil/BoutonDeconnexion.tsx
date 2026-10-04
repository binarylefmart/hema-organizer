"use client";

import { seDeconnecter } from "@/actions/auth";
import { Bouton } from "@/components/ui/Bouton";
import { Icone } from "@/components/ui/Icone";

/**
 * Se déconnecter — **et garder le lien mémorisé sur cet appareil**.
 *
 * Il l'effaçait, au nom d'une distinction qui semblait juste : fermer l'application n'est pas s'en
 * aller, tandis qu'appuyer sur « Se déconnecter » dirait qu'on quitte cet appareil. À l'usage,
 * c'est faux — et c'est Delta qui l'a relevé, sur son propre téléphone : on se déconnecte de son
 * **propre** matériel des dizaines de fois pour une fois qu'on rend celui d'un autre, et chacune de
 * ces fois obligeait à rouvrir sa boîte mail, retrouver le message, recopier le lien. Dans
 * l'application installée, où il n'y a pas de barre d'adresse, c'est le parcours le plus pénible de
 * tout l'outil, infligé par le geste le plus banal.
 *
 * **Ce qui protège le cas du téléphone prêté n'a pas disparu, il a déménagé** là où il se voit :
 * se déconnecter dépose sur l'écran de connexion, où un bloc **visible sans rien déplier** annonce
 * qu'un lien est gardé sur cet appareil, en montre la fin, et porte à côté de « Modifier » un bouton
 * **« Oublier »** (`FormulaireLienColle`). Le geste fort est donc à une tape, au moment exact où
 * l'on rend l'appareil — et il est nommé, au lieu d'être un effet de bord silencieux d'un autre
 * bouton.
 *
 * **Cette phrase a été fausse pendant quelques heures,**, et la relecture adverse l'a relevé :
 * l'écran de connexion enfermait alors le lien gardé dans un `<details>` replié intitulé « J'ai
 * reçu un lien par email ». Rien n'y disait qu'une clé de quatre mois restait sur l'appareil, et «
 * Oublier » dormait derrière un pli — sur une tablette de club qui n'a pas la boîte mail, les 12 h
 * de session redevenaient décoratives. Le commentaire décrivait un écran qui n'existait pas ; c'est
 * l'écran qui a été corrigé, et ce paragraphe reste pour dire à quoi tient la promesse ci-dessus.
 * **Si le bloc repasse un jour derrière un pli, ce bouton redevient un mensonge.**
 *
 * Ce que ça change vraiment, dit franchement : sur un téléphone déverrouillé laissé à quelqu'un,
 * une session fermée ne suffit plus à fermer la porte. Elle ne suffisait déjà pas — la même clé
 * dort dans la boîte mail du même téléphone (voir `src/lib/lien-memorise.ts`).
 */
export function BoutonDeconnexion() {
  return (
    <form action={seDeconnecter}>
      {/* Rouge : ce bouton met fin à la session, et sur un compte sans mot de passe il faudra le
          lien gardé ici — ou son email — pour revenir. L'avertissement est dans la couleur. */}
      <Bouton type="submit" variante="danger" pleineLargeur>
        <Icone nom="sortie" />
        Se déconnecter
      </Bouton>
    </form>
  );
}
