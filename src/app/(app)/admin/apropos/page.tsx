import { versionCourante } from "@/lib/mise-a-jour";
import type { Metadata } from "next";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import Link from "next/link";
import { requirePermission } from "@/lib/auth/current-user";
import { baseUrl, env, isProduction } from "@/lib/env";
import { getRetentionAuditJours } from "@/lib/alertes";
import { db } from "@/lib/db";
import { formatDateHeure } from "@/lib/dates";
import { identite } from "@/lib/identite";
import { dossierAffiches } from "@/lib/affiches";
import { isPublicApiEnabled } from "@/lib/settings";
import { enregistrerRetentionAudit } from "@/actions/admin";
import { Carte } from "@/components/ui/Carte";
import { Champ } from "@/components/ui/Champ";
import { DeuxPiles } from "@/components/ui/DeuxPiles";
import { FormulaireAction } from "@/components/ui/FormulaireAction";
import { Pastille } from "@/components/ui/Pastille";
import { RETENTION_JOURS, RETENTION_REPARATION_JOURS } from "@/lib/sauvegarde";

export const metadata: Metadata = { title: "À propos" };

/** Une taille en octets, lisible : « 4,2 Mo ». */
function taille(octets: number): string {
  if (octets < 1024) return `${octets} o`;
  if (octets < 1024 * 1024) return `${(octets / 1024).toFixed(1).replace(".", ",")} Ko`;
  return `${(octets / (1024 * 1024)).toFixed(1).replace(".", ",")} Mo`;
}

/**
 * Ce qu'un dossier contient : combien de fichiers, quel poids, et la date du plus récent.
 * Ne lève jamais — un dossier absent (aucune sauvegarde encore faite, aucune affiche déposée) est
 * un état normal, pas une panne, et cet écran ne doit pas tomber pour ça.
 */
async function contenu(dossier: string): Promise<{ fichiers: number; octets: number; dernier: Date | null }> {
  try {
    const noms = await readdir(dossier);
    let octets = 0;
    let dernier: Date | null = null;
    for (const nom of noms) {
      try {
        const infos = await stat(path.join(dossier, nom));
        if (!infos.isFile()) continue;
        octets += infos.size;
        if (!dernier || infos.mtime > dernier) dernier = infos.mtime;
      } catch {
        /* fichier disparu entre la liste et la lecture : on l'ignore */
      }
    }
    return { fichiers: noms.length, octets, dernier };
  } catch {
    return { fichiers: 0, octets: 0, dernier: null };
  }
}

/**
 * **À propos** — ce que cette installation est, et ce qu'elle contient.
 *
 * L'écran s'appelait « Paramètres techniques/logs » et mêlait quatre choses sans rapport : le
 * webhook Discord, l'API publique, les alertes de sécurité et la rétention du journal d'audit, plus
 * l'état du serveur d'envoi et le journal des derniers emails. **Tout ce qui part est retourné dans
 * *Notifications*** — le webhook avec son canal, l'API publique et les alertes avec le reste des
 * envois, l'état SMTP et le journal des emails sur la page du canal Email. Ne reste ici que ce qui
 * répond à « qu'est-ce que je fais tourner, au juste ? » : la version, le domaine, la base, les
 * sauvegardes, les volumes — et le seul réglage purement technique qui subsiste, la durée de
 * conservation du journal d'audit.
 *
 * C'est aussi l'écran qu'on ouvre avant d'appeler à l'aide : il donne, en une page, tout ce qu'on
 * demanderait à quelqu'un de vérifier.
 */
export default async function PageAPropos() {
  await requirePermission("settings.technical");
  const e = env();
  const fichierBase = e.DATABASE_URL.replace(/^file:(\/\/)?/i, "").trim();
  const [club, apiActive, retention, membres, periodes, seances, sessionsOuvertes, entreesAudit, sauvegardes, affiches, baseInfos] = await Promise.all([
    identite(),
    isPublicApiEnabled(),
    getRetentionAuditJours(),
    db.user.count({ where: { actif: true, service: false } }),
    db.period.count(),
    db.session.count(),
    db.authSession.count({ where: { expiresAt: { gt: new Date() } } }),
    db.auditLog.count(),
    contenu(path.resolve(e.BACKUP_DIR)),
    contenu(dossierAffiches()),
    stat(path.resolve(fichierBase)).catch(() => null),
  ]);

  const lignes: Array<{ cle: string; valeur: React.ReactNode }> = [
    { cle: "Application", valeur: `${club.nomCourt}${club.club ? ` — ${club.club}` : ""}` },
    // `APP_VERSION` est gravée dans l'image au moment du build ; `npm_package_version` ne vaut
    // qu'en développement, où c'est `npm run dev` qui lance le processus. L'ordre compte : en
    // production, la seconde est vide, et l'écran qui répond à « qu'est-ce que je fais tourner ? »
    // n'a pas le droit de répondre « — ».
    { cle: "Version", valeur: <code>{versionCourante() ?? "—"}</code> },
    { cle: "Environnement", valeur: <Pastille ton={isProduction() ? "vert" : "ocre"}>{isProduction() ? "production" : "développement"}</Pastille> },
    { cle: "Domaine public", valeur: <code className="break-all">{baseUrl()}</code> },
    { cle: "Fuseau des tâches", valeur: e.TZ },
    { cle: "Node.js", valeur: <code>{process.version}</code> },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-3xl">À propos</h1>
        <p className="mt-1 text-texte-secondaire">
          Ce que fait tourner cette installation, et ce qu&apos;elle contient. Tout ce qui <em>part</em> — emails, salons, téléphone, API publique, alertes —
          se règle dans{" "}
          <Link href="/admin/notifications" className="font-semibold text-lien">
            Notifications
          </Link>
          .
        </p>
      </div>

      {/* **Cinq cartes d'étiquettes et de valeurs, rangées en deux piles à partir de 1 536 px**.
          Mesuré avant le partage, sur une fenêtre de 1 920 px : **1 643 px de haut** pour 1 440 px
          de contenu, et la plus haute des cinq cartes n'en remplissait que 257 — cinq listes de
          deux colonnes (`auto 1fr`) qui tiennent chacune dans la moitié de la page, posées les unes
          sous les autres.

          **La coupure dit quelque chose, elle ne cherche pas l'équilibre à la ligne près** : à
          gauche ce qui **décrit** l'installation — ce qu'elle fait tourner, ce que contient sa
          base, ce qui grossit sur son disque —, à droite ce qui **s'ouvre vers l'extérieur et se
          règle** : l'API publique et la conservation du journal, le seul réglage de l'écran. C'est
          aussi l'ordre dans lequel on lit la page quand on l'ouvre avant d'appeler à l'aide :
          d'abord « qu'est-ce que je fais tourner, au juste ? », ensuite « qu'est-ce qui en sort, et
          pour combien de temps ? ».

          **Deux piles, jamais une grille** (`DeuxPiles`) : une grille alignerait ses blocs en
          rangées et laisserait un trou de la hauteur de la différence entre « Fichiers sur le
          disque » et « API publique ». Et **en dessous du palier, l'ordre est exactement celui
          d'avant** — lire la pile de gauche de haut en bas puis celle de droite redonne la page
          d'hier, qui est aussi l'écran d'un téléphone de 390 px, où rien ne bouge d'un pixel. */}
      <DeuxPiles
        gauche={
          <>
            <Carte titre="Cette installation">
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
                {lignes.map((l) => (
                  <div key={l.cle} className="contents">
                    <dt className="text-texte-secondaire">{l.cle}</dt>
                    <dd className="break-words">{l.valeur}</dd>
                  </div>
                ))}
              </dl>
            </Carte>

            <Carte titre="Ce que contient la base">
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
                <dt className="text-texte-secondaire">Membres actifs</dt>
                <dd>{membres}</dd>
                <dt className="text-texte-secondaire">Périodes</dt>
                <dd>{periodes}</dd>
                <dt className="text-texte-secondaire">Séances</dt>
                <dd>{seances}</dd>
                <dt className="text-texte-secondaire">Sessions ouvertes</dt>
                <dd>
                  {sessionsOuvertes}{" "}
                  <Link href="/admin/sessions" className="text-lien">
                    (les voir)
                  </Link>
                </dd>
                <dt className="text-texte-secondaire">Entrées du journal d&apos;audit</dt>
                <dd>
                  {entreesAudit}{" "}
                  <Link href="/admin/audit" className="text-lien">
                    (le consulter)
                  </Link>
                </dd>
                <dt className="text-texte-secondaire">Fichier</dt>
                <dd className="break-all">
                  <code>{fichierBase || "—"}</code>
                  {baseInfos && <span className="block text-texte-secondaire">{taille(baseInfos.size)}</span>}
                </dd>
              </dl>
            </Carte>

            {/* Les deux dossiers qui grossissent avec le temps, et dont on veut savoir qu'ils vivent :
                sans cet écran, « est-ce que les sauvegardes tournent ? » ne se vérifie qu'en ouvrant un
                terminal sur le serveur. */}
            <Carte titre="Fichiers sur le disque">
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
                <dt className="text-texte-secondaire">Sauvegardes</dt>
                <dd>
                  <code className="break-all">{path.resolve(e.BACKUP_DIR)}</code>
                  <span className="block text-texte-secondaire">
                    {sauvegardes.fichiers === 0
                      ? "aucune sauvegarde pour l'instant — la première part cette nuit (03:30)"
                      : `${sauvegardes.fichiers} fichier${sauvegardes.fichiers > 1 ? "s" : ""}, ${taille(sauvegardes.octets)} · dernière le ${formatDateHeure(sauvegardes.dernier as Date)}`}
                  </span>
                </dd>
                <dt className="text-texte-secondaire">Affiches et logos</dt>
                <dd>
                  <code className="break-all">{dossierAffiches()}</code>
                  <span className="block text-texte-secondaire">
                    {affiches.fichiers === 0 ? "aucune image déposée" : `${affiches.fichiers} image${affiches.fichiers > 1 ? "s" : ""}, ${taille(affiches.octets)}`}
                  </span>
                </dd>
              </dl>
              <p className="mt-3 text-sm text-texte-secondaire">
                Une sauvegarde est écrite chaque nuit et conservée {RETENTION_JOURS} jours. Une copie prise avant une
                réparation de données (<code>avant-reparation-…</code>) est gardée {RETENTION_REPARATION_JOURS} jours : c&apos;est
                une base complète, elle compte donc dans le poids ci-dessus. Les images déposées ne sont
                <strong> pas</strong> dans la base : pensez-y en recopiant vos données ailleurs.
              </p>
            </Carte>
          </>
        }
        droite={
          <>
            <Carte titre="API publique">
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
                <dt className="text-texte-secondaire">Adresse</dt>
                <dd className="break-all">
                  <code>{`${baseUrl()}/api/public/prochaines-seances`}</code>
                </dd>
                <dt className="text-texte-secondaire">État</dt>
                <dd>
                  <Pastille ton={apiActive ? "vert" : "neutre"}>{apiActive ? "activée" : "désactivée"}</Pastille>{" "}
                  <Link href="/admin/notifications" className="text-lien">
                    (se règle dans Notifications)
                  </Link>
                </dd>
                <dt className="text-texte-secondaire">Site autorisé</dt>
                <dd>{e.PUBLIC_API_ORIGIN || "aucun — la réponse n'est lisible que par un serveur, pas par un navigateur tiers"}</dd>
              </dl>
              <p className="mt-3 text-sm text-texte-secondaire">
                C&apos;est l&apos;adresse à reporter dans le plugin WordPress. Elle ne renvoie aucun nom de membre : dates, horaires, lieu, thème et taux de
                participation.
              </p>
            </Carte>

            <Carte titre="Journal d'audit">
              <FormulaireAction action={enregistrerRetentionAudit} bouton="Enregistrer" variante="secondaire" className="@container">
                {/* **Un nombre de jours n'a pas besoin de 1 398 px** : c'est ce que ce champ
                    mesurait, l'écran ayant rejoint les pages larges. La largeur se plafonne au
                    palier du **conteneur** et non de la fenêtre (`@md` = 28 rem) : dans la carte
                    d'un téléphone de 390 px, le conteneur fait 326 px, la règle ne s'applique pas,
                    et le champ reste pleine largeur — exactement comme avant. Même geste que la
                    part d'effectif de « Club », qui porte un `w-28` depuis toujours. */}
                <Champ
                  label="Conservation du journal (jours)"
                  name="auditRetentionJours"
                  type="number"
                  min={30}
                  max={3650}
                  inputMode="numeric"
                  className="@md:w-32"
                  defaultValue={retention}
                  aide="Les entrées plus anciennes sont supprimées chaque nuit. Minimum 30 jours, 365 par défaut. Le journal garde qui a fait quoi : le raccourcir efface des traces, l'allonger fait grossir la base."
                />
              </FormulaireAction>
            </Carte>
          </>
        }
      />
    </div>
  );
}
