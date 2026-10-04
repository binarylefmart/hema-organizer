import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/current-user";
import { CHEMIN_API_ANNONCES, CHEMIN_API_PROCHAINES_SEANCES } from "@/lib/constants";
import { baseUrl } from "@/lib/env";
import { expositionPossible, portesExposition } from "@/lib/notifications/canaux";
import { canalActifDans, DESCRIPTIONS, LIBELLES_CANAUX, RAISON_API_EXCLUE, TYPES_NOTIFICATION, CANAUX_PAR_NOTIFICATION } from "@/lib/notifications/preferences";
import { HORIZON_ANNONCES_JOURS, TYPES_ANNONCE, type TypeAnnonce } from "@/lib/api-publique";
import { Alerte } from "@/components/ui/Alerte";
import { Carte } from "@/components/ui/Carte";
import { Icone } from "@/components/ui/Icone";
import { Pastille } from "@/components/ui/Pastille";
import { EnTeteCanal } from "../EnTeteCanal";

export const metadata: Metadata = { title: `Canal ${LIBELLES_CANAUX.api}` };

/**
 * **Canal « Site du club »** — le seul canal qui n'envoie rien.
 *
 * Il n'y a donc **aucun réglage sur cette page**, et c'est volontaire : l'unique interrupteur vit sur
 * la carte *Publication des cours sur le site du club* de l'écran Notifications, la même que celle
 * qui ouvre l'API des prochains cours. Deux cases qui écrivent le même réglage, à deux endroits,
 * finiraient par se contredire à l'écran.
 *
 * Ce que la page fait, à la place : dire **ce qui sort, ce qui ne sort pas, et où on décide**.
 * C'est la page qu'on ouvre quand on branche le site du club et qu'on cherche l'adresse à recopier.
 */
export default async function PageCanalSiteDuClub() {
  await requirePermission("settings.technical");
  /*
   * **La page dit ce qui sort, elle passe donc par la fonction qui en décide.**
   *
   * `portesExposition` relit les deux portes **une seule fois** pour toute la page, et
   * `expositionPossible` compose ensuite, type par type, exactement ce que compose `GET
   * /api/public/annonces`. Lire `prefs.notifications[type].api` en direct — ce que cette page
   * faisait — oublie l'**interrupteur du canal** (`prefs.canaux.api`), que `notificationActiveDans`
   * exige aussi et que l'écran des notifications permet de décocher : publication ouverte, case
   * cochée, interrupteur décoché, la route rendait `annonces: []` pendant que cette page affichait
   * la pastille verte et « 1 annonce republiée ». La seule page dont l'objet est de dire ce qui
   * sort disait le contraire de la vérité.
   */
  const portes = await portesExposition();
  const { etat, prefs } = portes;
  const canalCoche = canalActifDans(prefs, "api");
  // `TYPES_ANNONCE` plutôt qu'un filtre de la matrice : c'est la liste que la route sert, et un test
  // unitaire vérifie qu'elle est exactement la colonne « Site du club » de `CANAUX_PAR_NOTIFICATION`.
  const sansCase = TYPES_NOTIFICATION.filter((type) => !CANAUX_PAR_NOTIFICATION[type].includes("api"));
  const republiees = (await Promise.all(TYPES_ANNONCE.map(async (type) => ((await expositionPossible(type, portes)) ? type : null)))).filter(
    (type): type is TypeAnnonce => type !== null,
  );
  return (
    <div className="flex flex-col gap-5">
      <EnTeteCanal etat={etat} titre={`Canal ${LIBELLES_CANAUX.api}`} />
      <Carte titre="Rien ne part : le site vient lire">
        <p>
          Les autres canaux <strong>envoient</strong> : un email part, un message arrive dans un salon. Celui-ci ne fait rien de tel — il laisse une porte
          ouverte, et le site du club vient lire quand il veut. Il n&apos;y a donc ni journal d&apos;envoi, ni bouton de test, ni personne à qui écrire.
        </p>
        <p className="mt-3">
          Ce qui est lu est <strong>recalculé à chaque appel</strong> depuis les cours et les annonces tels qu&apos;ils sont : une annonce disparaît d&apos;elle-même
          quand elle cesse d&apos;être vraie, et une correction de thème se voit tout de suite. Aucun message n&apos;est stocké.
        </p>
        <p className="mt-3 text-texte-secondaire">
          Adresse à recopier dans le site : <code className="break-all">{`${baseUrl()}${CHEMIN_API_ANNONCES}`}</code>
        </p>
        <p className="mt-1 text-sm text-texte-secondaire">
          Le plugin WordPress fourni, lui, lit l&apos;autre adresse — <code className="break-all">{`${baseUrl()}${CHEMIN_API_PROCHAINES_SEANCES}`}</code> —, qui
          donne le <strong>calendrier</strong> des prochains cours. Les deux portes s&apos;ouvrent avec la même case.
        </p>
      </Carte>
      <Carte titre="Où se décide ce qui sort">
        {/* **Trois portes, trois messages** : la page nomme celle qui est fermée, sinon on cherche
            la bonne case parmi les trois. L'ordre est celui du code (`expositionPossible`). */}
        {!etat.operationnel ? (
          <Alerte type="attention" titre="Publication fermée">
            Rien ne sort, quelles que soient les cases de la matrice — et les cases ne sont pas touchées : elles reprennent effet si la publication est
            réouverte, même si la matrice est enregistrée entre-temps.
          </Alerte>
        ) : !canalCoche ? (
          <Alerte type="attention" titre={`Canal « ${LIBELLES_CANAUX.api} » décoché`}>
            La publication est ouverte, mais l&apos;interrupteur du canal est décoché dans <em>Canaux d&apos;envoi et de publication</em> : il coupe toute la
            colonne d&apos;un coup, comme pour Discord ou l&apos;email. Rien ne sort tant qu&apos;il n&apos;est pas recoché — les cases, elles, sont conservées.
          </Alerte>
        ) : (
          <p className="flex flex-wrap items-center gap-2">
            <Pastille ton="vert">publication ouverte</Pastille>
            <span>
              {republiees.length === 0
                ? "Aucune annonce n'est cochée pour l'instant : le site ne reçoit donc rien de plus que le calendrier des prochains cours."
                : `${republiees.length} annonce${republiees.length > 1 ? "s" : ""} republiée${republiees.length > 1 ? "s" : ""} : ${republiees.map((t) => DESCRIPTIONS[t].titre).join(", ")}.`}
            </span>
          </p>
        )}
        <ol className="mt-4 flex list-decimal flex-col gap-2 pl-5">
          <li>
            <strong>Ouvrir la publication</strong> : écran Notifications, carte <em>Publication des cours sur le site du club</em>, case « Publier les
            prochains cours ». Fermée, elle coupe tout d&apos;un coup.
          </li>
          <li>
            <strong>Cocher le canal « {LIBELLES_CANAUX.api} »</strong> dans <em>Canaux d&apos;envoi et de publication</em> : c&apos;est l&apos;interrupteur de
            la colonne entière, le même que pour les cinq autres canaux.
          </li>
          <li>
            <strong>Cocher, annonce par annonce</strong>, la colonne « {LIBELLES_CANAUX.api} » de la matrice. C&apos;est là que se décide le détail.
          </li>
        </ol>
        <Link href="/admin/notifications" className="mt-3 inline-flex min-h-11 items-center gap-1 font-semibold text-lien">
          Aller à la matrice et à la case de publication
          <Icone nom="fleche" taille={18} />
        </Link>
      </Carte>
      <Carte titre="Ce qui peut sortir, et ce qui ne sortira jamais">
        <p className="mb-3">
          Trois annonces seulement ont une case ici. Ce qui en sort ne porte <strong>aucun nom</strong> — ni membre, ni instructeur, ni second, ni animateur
          d&apos;atelier — et aucun effectif en clair : un taux, jamais « 13 présents sur 18 ».
        </p>
        <ul className="flex flex-col gap-3">
          {TYPES_ANNONCE.map((type) => (
            <li key={type}>
              <p className="flex flex-wrap items-center gap-2 font-semibold">
                {DESCRIPTIONS[type].titre}
                {/* La pastille ne dit qu'une chose, celle que la page promet : **est-ce que ça sort ?**
                    « Non cochée » aurait été faux dès qu'une porte en amont est fermée alors que la
                    case, elle, est bien cochée — c'est l'encart ci-dessus qui nomme la porte. */}
                <Pastille ton={republiees.includes(type) ? "vert" : "neutre"}>{republiees.includes(type) ? "republiée" : "pas republiée"}</Pastille>
              </p>
              <p className="text-sm text-texte-secondaire">{RESUME_ANNONCE[type]}</p>
            </li>
          ))}
        </ul>
        <p className="mt-5 mb-2 font-semibold">Sans case, et pour de bonnes raisons</p>
        <ul className="flex flex-col gap-2 text-sm">
          {sansCase.map((type) => (
            <li key={type}>
              <span className="font-semibold">{DESCRIPTIONS[type].titre}</span> — {RAISON_API_EXCLUE[type]}
            </li>
          ))}
        </ul>
      </Carte>
    </div>
  );
}

/**
 * Ce que porte chaque annonce, en une phrase — la fenêtre de l'annulation se **compose** depuis sa
 * constante (`HORIZON_ANNONCES_JOURS`) plutôt que d'être recopiée : un nombre écrit deux fois finit
 * par ne plus dire la même chose que le code.
 */
const RESUME_ANNONCE: Record<TypeAnnonce, string> = {
  recap_veille: "Le cours de demain : date, horaire, lieu et adresse de la salle, thème, programme partie par partie (niveau et description comprises), taux de participation.",
  seance_annulee: `Les cours annulés des ${HORIZON_ANNONCES_JOURS} prochains jours, avec leur motif d'annulation.`,
  evenement_nouveau:
    "Les annonces publiées à venir : nom, description, dates, horaire, durée, lieu et adresse, organisateur, tarifs et lien d'inscription. Un brouillon ne sort jamais.",
};
