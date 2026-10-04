import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/current-user";
import { db } from "@/lib/db";
import { formatDateHeure } from "@/lib/dates";
import { revoquerSession, revoquerSessionsUtilisateur } from "@/actions/membres";
import { Carte } from "@/components/ui/Carte";
import { BoutonAction } from "@/components/ui/BoutonAction";
import { LienBouton } from "@/components/ui/Bouton";
import { Cellule, Ligne, Tableau } from "@/components/ui/Tableau";
import { Icone } from "@/components/ui/Icone";

export const metadata: Metadata = { title: "Sessions de connexion" };

/** Même pagination que le journal d'audit : une page tient à l'écran, même sur téléphone. */
const PAR_PAGE = 50;
type Props = { searchParams: Promise<{ page?: string }> };

export default async function PageSessions({ searchParams }: Props) {
  const moi = await requirePermission("auth_sessions.revoke");
  const { page = "1" } = await searchParams;
  const p = Math.max(1, Number(page) || 1);
  const where = { expiresAt: { gt: new Date() } };
  const [total, sessions] = await Promise.all([
    db.authSession.count({ where }),
    db.authSession.findMany({
      where,
      orderBy: { lastSeenAt: "desc" },
      include: { user: { select: { id: true, prenom: true, nom: true, email: true } } },
      skip: (p - 1) * PAR_PAGE,
      take: PAR_PAGE,
    }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAR_PAGE));
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-3xl">Sessions de connexion</h1>
        <p className="text-texte-secondaire">{total} session{total > 1 ? "s" : ""} active{total > 1 ? "s" : ""}.</p>
      </div>
      <Carte>
        <Tableau
          entetes={["Utilisateur", "Dernière activité", "Expire", "Appareil", "IP", ""]}
          vide={sessions.length === 0 && <p className="p-4 text-texte-secondaire">Aucune session active.</p>}
        >
          {sessions.map((s) => (
            <Ligne key={s.id} className={s.id === moi.sessionId ? "bg-primaire-doux/40" : ""}>
              <Cellule>
                <span className="font-semibold">
                  {s.user.prenom} {s.user.nom}
                </span>
                {s.id === moi.sessionId && <span className="ml-1 text-xs text-primaire">(cette session)</span>}
                <div className="text-sm text-texte-secondaire">{s.user.email ?? "sans adresse email"}</div>
              </Cellule>
              <Cellule label="Dernière activité" className="whitespace-nowrap text-sm">{formatDateHeure(s.lastSeenAt)}</Cellule>
              <Cellule label="Expire" className="whitespace-nowrap text-sm">{formatDateHeure(s.expiresAt)}</Cellule>
              {/* Sur téléphone l'appareil revient à la ligne (rien de coupé) ; sur PC il reste sur une ligne */}
              {/* **Le plafond tombe quand la page s'élargit** : la colonne gardait `max-w-56`
                  au-delà de 1 024 px, donc **502 px d'user-agent coupés** dans un tableau de 1 396
                  px — et sous 768 px, où la fiche s'empile, le texte s'affichait entier : un
                  téléphone en montrait plus qu'un écran de 1 920. Le message de `646457d`
                  promettait « rien n'est caché » ; ce n'était vrai que des six colonnes, pas de
                  leur contenu. */}
              <Cellule label="Appareil" className="break-words text-sm md:max-w-56 md:truncate lg:max-w-none lg:whitespace-normal lg:break-words" title={s.userAgent ?? ""}>{s.userAgent ?? "—"}</Cellule>
              <Cellule label="IP" className="text-sm">{s.ip ?? "—"}</Cellule>
              <Cellule>
                <div className="flex flex-wrap gap-2">
                  {s.id !== moi.sessionId && (
                    <BoutonAction action={revoquerSession.bind(null, s.id)} variante="danger" taille="petite">
                      <Icone nom="alerte" taille={18} />
                      Révoquer
                    </BoutonAction>
                  )}
                  <BoutonAction action={revoquerSessionsUtilisateur.bind(null, s.user.id)} variante="danger" taille="petite" confirmation={`Déconnecter tous les appareils de ${s.user.prenom} ?`}>
                    <Icone nom="alerte" taille={18} />
                    Tout révoquer
                  </BoutonAction>
                </div>
              </Cellule>
            </Ligne>
          ))}
        </Tableau>
        {pages > 1 && (
          <div className="mt-3 flex items-center justify-between gap-2 text-sm">
            <span>
              {p > 1 && (
                <LienBouton href={`/admin/sessions?page=${p - 1}`} variante="secondaire" taille="petite">
                  ← Plus récent
                </LienBouton>
              )}
            </span>
            <span className="text-texte-secondaire">
              Page {p} / {pages}
            </span>
            <span>
              {p < pages && (
                <LienBouton href={`/admin/sessions?page=${p + 1}`} variante="secondaire" taille="petite">
                  Plus ancien →
                </LienBouton>
              )}
            </span>
          </div>
        )}
      </Carte>
    </div>
  );
}
