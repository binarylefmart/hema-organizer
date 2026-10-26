import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/current-user";
import { db } from "@/lib/db";
import { formatHeure } from "@/lib/dates";
import { NIVEAU_DEFAUT, NIVEAUX, type Niveau } from "@/lib/constants";
import { getLieux, getThemes, getThemesEchauffement, natureLue, personnesPlanning } from "@/lib/planning";
import { NATURES_TEMPLATE, type ElementTemplate, type NatureTemplate } from "@/lib/templates";
import { modifierTemplate, supprimerTemplate } from "@/actions/templates";
import { Alerte } from "@/components/ui/Alerte";
import { BoutonAction } from "@/components/ui/BoutonAction";
import { Carte } from "@/components/ui/Carte";
import { Icone } from "@/components/ui/Icone";
import { LienBouton } from "@/components/ui/Bouton";
import { FormulaireTemplate } from "../FormulaireTemplate";
import { EditeurProgramme, type EncadrantTemplate } from "./EditeurProgramme";

export const metadata: Metadata = { title: "Template de cours" };

type Props = { params: Promise<{ id: string }> };

/** Une nature lue en base, ramenée à celles d'un template : une valeur étrangère se lit comme un cours. */
function natureTemplate(v: string): NatureTemplate {
  const n = natureLue(v);
  return (NATURES_TEMPLATE as readonly string[]).includes(n) ? (n as NatureTemplate) : "COURS";
}

/**
 * **L'écran d'un template** : ses informations (nom, horaire, lieu), son programme, et les deux gestes
 * qui en sortent — l'appliquer, ou l'effacer.
 *
 * **Deux cartes, deux enregistrements**, et c'est voulu : les informations sont un formulaire
 * classique (`modifierTemplate`), le programme un éditeur qui compose dans le navigateur et envoie la
 * liste entière (`enregistrerElementsTemplate`). Enregistrer l'un ne touche pas l'autre — l'éditeur
 * garde ce qu'on y compose quand la page revient après « Enregistrer le template ».
 *
 * **Tout ce que l'éditeur affiche arrive d'ici, en propriétés** : `src/lib/planning.ts` lit la base et
 * les réglages, il ne doit pas entrer dans le paquet du navigateur. La page lit donc les personnes, les
 * deux listes de thèmes et les salles, et les passe telles quelles.
 */
export default async function PageTemplate({ params }: Props) {
  await requirePermission("templates.manage");
  const { id } = await params;
  const template = await db.coursTemplate.findUnique({
    where: { id },
    include: { elements: { orderBy: [{ bloc: "asc" }, { ordre: "asc" }] } },
  });
  if (!template) notFound();

  const nommes = template.elements.flatMap((e) => [e.instructeurId, e.instructeurSecondId]).filter((v): v is string => !!v);
  const [lieux, themes, themesEchauffement, personnes, etats] = await Promise.all([
    getLieux(),
    getThemes(),
    getThemesEchauffement(),
    // L'encadrement actif, plus les personnes déjà nommées dans le template : un nom posé ne doit pas
    // disparaître de sa liste parce que la personne a changé de rôle (même règle qu'au planning).
    personnesPlanning(nommes),
    nommes.length ? db.user.findMany({ where: { id: { in: nommes } }, select: { id: true, actif: true, service: true } }) : Promise.resolve([]),
  ]);
  // Le serveur refuse un compte désactivé à l'enregistrement : l'écran le dit avant, nom à l'appui.
  const inactifs = new Set(etats.filter((u) => !u.actif || u.service).map((u) => u.id));
  const encadrants: EncadrantTemplate[] = personnes.map((p) => ({ id: p.id, prenom: p.prenom, nom: p.nom, couleur: p.couleur, inactif: inactifs.has(p.id) }));

  const elements: ElementTemplate[] = template.elements.map((e) => ({
    bloc: e.bloc,
    nature: natureTemplate(e.nature),
    theme: e.theme,
    niveau: (NIVEAUX as readonly string[]).includes(e.niveau) ? (e.niveau as Niveau) : NIVEAU_DEFAUT,
    description: e.description,
    instructeurId: e.instructeurId,
    instructeurSecondId: e.instructeurSecondId,
  }));

  return (
    <div className="flex flex-col gap-5">
      <Link href="/admin/templates" className="inline-flex min-h-12 items-center gap-1.5 self-start">
        <Icone nom="fleche" className="rotate-180" />
        Tous les templates
      </Link>
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl break-words">{template.nom}</h1>
        <p className="text-texte-secondaire">
          {formatHeure(template.heureDebut)}–{formatHeure(template.heureFin)} · {template.lieu}
        </p>
      </div>
      <LienBouton href={`/admin/templates/appliquer?template=${encodeURIComponent(template.id)}`} className="self-start" enCours>
        <Icone nom="calendrier" />
        Appliquer ce template
      </LienBouton>

      <Carte titre="Informations">
        <FormulaireTemplate
          action={modifierTemplate.bind(null, template.id)}
          bouton="Enregistrer le template"
          prefixe="template-"
          lieux={lieux}
          valeurs={{ nom: template.nom, heureDebut: template.heureDebut, heureFin: template.heureFin, lieu: template.lieu, adresse: template.adresse }}
        />
      </Carte>

      <Carte titre="Programme">
        <div className="flex flex-col gap-4">
          <p className="text-texte-secondaire">
            Ce que la séance portera quand le template sera appliqué. Rien ne part avant « Enregistrer le programme » : compose
            tranquillement, puis enregistre.
          </p>
          {inactifs.size > 0 && (
            <Alerte type="attention">
              Un encadrant de ce template n&apos;a plus de compte actif (« compte désactivé » dans la liste) : choisis quelqu&apos;un
              d&apos;autre avant d&apos;enregistrer le programme.
            </Alerte>
          )}
          <EditeurProgramme templateId={template.id} elements={elements} personnes={encadrants} themes={themes} themesEchauffement={themesEchauffement} />
        </div>
      </Carte>

      <Carte titre="Supprimer le template">
        <div className="flex flex-col gap-3">
          <p className="text-texte-secondaire">
            Les séances déjà remplies avec ce template gardent leur programme : elles n&apos;en dépendent pas.
          </p>
          {/* Dans un bloc : la colonne étirerait sinon le bouton sur toute la largeur de la carte. */}
          <div>
            <BoutonAction
            action={supprimerTemplate.bind(null, template.id)}
            variante="danger"
            confirmation={`Supprimer le template « ${template.nom} » ? Cette suppression est définitive. Les séances déjà remplies ne bougent pas.`}
            enCours="Suppression…"
          >
            <Icone nom="alerte" />
            Supprimer le template
            </BoutonAction>
          </div>
        </div>
      </Carte>
    </div>
  );
}
