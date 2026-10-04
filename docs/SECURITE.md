# Sécurité — modèle d'accès et défenses

> Ce document décrit comment l'application protège les comptes et les données, et ce que l'exploitant
> doit régler autour d'elle (proxy, journaux, droits sur l'hôte). Il complète `CLAUDE.md` (exigences et
> décisions de conception) et `docs/DEPLOIEMENT.md` (installation et exploitation).
>
> **Suivez les versions publiées** : les protections décrites ici sont celles de la dernière image
> (`hematools/hema-organizer` sur Docker Hub).
>
> Il ne décrit pas les failles corrigées : ce serait un mode d'emploi contre les instances non
> mises à jour.

## Modèle d'accès

| Qui | Comment | Session |
|---|---|---|
| Tout le monde (membres, instructeurs, admins) | **Lien personnel** `/invitation/<jeton>` envoyé par email — aucun identifiant à retenir, c'est la porte principale | **12 h glissantes**, cookie httpOnly — session **ordinaire**, y compris pour un administrateur |
| Membre ou instructeur qui s'est donné un mot de passe — **facultatif** | `/connexion` : email + mot de passe (argon2id), puis code TOTP ou code de secours **s'il a activé la 2FA lui-même** | Session ordinaire (12 h glissantes) |
| **Administrateur — mot de passe et 2FA obligatoires** (parcours `/admin/activer`) | même page, puis code TOTP **toujours exigé** | **Session forte** (12 h, jamais prolongée) — la seule qui ouvre l'administration technique |
| Application installée sur iPhone | Champ « J'ai reçu un lien par email » sur `/connexion` : la PWA ne partage pas le stockage de Safari. Même vérification que l'ouverture du lien, message générique, jeton jamais recopié | identique au lien personnel |

Les règles qui tiennent ce tableau :

- **Mot de passe facultatif pour les membres et les instructeurs, obligatoire pour les
  administrateurs.** Chacun se le définit s'il le veut depuis « Mon profil » → « Sécuriser mon compte » ;
  sans mot de passe, on entre par son lien. Un compte sans mot de passe reçoit sur `/connexion` un
  message **générique** — aucune énumération de comptes —, et le « mot de passe oublié » suit la même
  règle.
- **Se connecter par mot de passe n'ouvre aucun droit supplémentaire** : les droits restent ceux du
  rôle. Un administrateur entré par son lien a une session **ordinaire** ; l'administration technique
  exige une élévation explicite (mot de passe et code redonnés sur `/connexion/admin`).
- **La force d'une session ne se déduit jamais de « mot de passe + 2FA »** : elle se déduit du compte,
  à l'unique endroit où une session forte se crée. Un instructeur équipé des deux n'entre pas dans les
  réglages.
- **Sessions de 12 h, fenêtre glissante** : chaque geste repousse l'échéance, de sorte qu'on n'est pas
  éjecté au milieu d'un travail. **C'est la base qui fait autorité sur la durée**, le cookie ne porte
  que le jeton. « Rester connecté » ne décide que de la survie du cookie à la fermeture du navigateur.
- **Ce qui rend 12 h vivable** : le lien personnel est gardé sur l'appareil (stockage local cloisonné
  par origine), proposé d'un bouton sur l'écran de connexion, jamais affiché en entier, et effaçable
  d'une tape (« Oublier ») — le geste du téléphone prêté.
- **L'élévation administrateur dure 12 h**, et se referme en plus quand l'application est quittée ou
  après 10 minutes sans activité dans l'espace admin.
- **Actions sensibles** (supprimer ou désactiver un compte, changer un rôle, nommer ou déchoir un
  administrateur, révoquer des sessions, réinitialiser la 2FA d'autrui, brancher un salon, régler la
  matrice des notifications) : **code 2FA revérifié** si la dernière vérification date de plus de
  10 minutes.
- **Changer l'adresse de quelqu'un et lui renvoyer son lien exigent un code des deux côtés** : pris
  ensemble, ces deux gestes feraient arriver chez soi une clé de quatre mois au nom d'un autre.

## Les jetons signés portent leur usage

Un seul secret (`SESSION_SECRET`) signe tout ce que l'application frappe : cookies de passage, jeton
d'élévation, liens d'email. Deux règles rendent ces jetons non interchangeables :

- **`signPayload(charge, secret, usage)`** écrit l'usage **dans la charge signée** : il entre dans le
  HMAC comme les autres champs, donc le retoucher invalide la signature au lieu de la contourner. Les
  usages sont déclarés un par un (`USAGES_JETON`, `src/lib/auth/tokens.ts`), un par famille de jeton.
- **`verifySignedPayload(jeton, secret, usage)`** exige le sien : **un lecteur qui ne dit pas ce qu'il
  attend ne compile pas.** Un jeton d'une autre famille n'est pas « périmé » ni « mal formé » : il est
  d'un autre usage, et c'est ce que le code répond.
- **Chaque lecteur valide la forme entière de la charge**, pas seulement les champs dont il se sert.
- Les contre-épreuves croisent les usages **deux à deux** : un usage ajouté sans être déclaré à la
  lecture fait échouer les tests.

## Liens personnels

- Jeton de 32 octets aléatoires (base64url) ; **seul le SHA-256 est en base**.
- **Validité 4 mois**, renouvelés automatiquement et renvoyés par email, pour tous les rôles sans
  exception. Les liens d'un trimestre partent **3 jours avant son début**, pas à son activation.
- **Une seule clé vivante par personne** : chaque envoi de début de trimestre révoque les liens
  précédents, trimestres confondus. Les sessions ouvertes ne sont pas fermées pour autant — on remplace
  des clés, on ne met pas le club dehors un matin de rentrée.
- **3 appareils au plus par lien** (trois sessions vivantes ouvertes *par le lien* ; celles ouvertes au
  mot de passe ne comptent pas). Au-delà : lien révoqué, lien neuf envoyé, et toutes les sessions
  tombent. **Réserve qui prime sur tout** : on ne révoque pas quelqu'un qui n'aurait aucun moyen de
  revenir — une garde qui se déclenche à tort ne protège personne.
- **Un lien régénéré coupe vraiment l'accès** : régénération par l'équipe, révocation de sécurité et
  dépassement du nombre d'appareils ferment **toutes** les sessions de la personne. Exception
  volontaire : « Renvoyer mon lien » depuis son propre profil ne ferme que les *autres* sessions.
- **Ce qui ne déconnecte personne** : le renouvellement automatique d'échéance et les envois en masse.
- **Changer l'adresse d'une personne remplace sa clé** : les liens vivants sont révoqués et un lien neuf
  part à la **nouvelle** adresse. Le lien dort dans une boîte mail — celle qu'on quitte, celle qui a
  fuité : sans cela, l'adresse quittée garderait une clé valable quatre mois.
- **Email « nouvel appareil »** à la personne dès la deuxième ouverture (navigateur, système, adresse,
  date).
- **Anti-abus** : ouvertures répétées d'un même lien → révocation et lien neuf ; liens inconnus limités
  par adresse ; au-delà d'un seuil horaire, alerte email aux administrateurs.
- **Une mutation ne se fait jamais sur un GET.** La page d'un lien montre ce qui va se passer et attend
  un appui : les messageries qui préchargent les liens (antivirus, protections d'entreprise) ne
  consomment donc rien. La même règle vaut pour tout lien d'email qui écrit.

## Double authentification

- **Administrateur : toujours exigée**, même s'il n'a rien configuré (le code lui est alors demandé *et*
  configuré au passage). Le bouton « Plus tard » lui est refusé.
- **Membre, instructeur : facultative**, proposée une fois le mot de passe posé, déclinable, et non
  reproposée avant un trimestre. Réglable en permanence depuis « Mon profil ».
- TOTP RFC 6238 (SHA-1, 6 chiffres, 30 s, ±1 pas), **secret chiffré AES-256-GCM** (clé dérivée de
  `SESSION_SECRET`). Un code ne sert qu'une fois.
- **8 codes de secours** (hachés SHA-256, usage unique), montrés une fois, régénérables depuis le profil
  (mot de passe exigé).
- **Perte du téléphone** : code de secours, sinon un autre administrateur, sinon
  `npm run admin:reset-2fa -- <email>` sur le serveur. Le compte d'administration permanent fait
  exception : **lui seul réinitialise son second facteur** — c'est le seul compte qui puisse rouvrir
  l'administration, et sa voie de secours est sa propre boîte email, puis un redéploiement.

## Ce qui sort du club

| Porte | État livré | Ce qui sort |
|---|---|---|
| **API publique** `/api/public/prochaines-seances` | **Fermée** : `503` tant que « Publier les prochains cours » n'est pas cochée (Espace admin → Notifications) | Date, horaire, **lieu et adresse**, thème, programme partie par partie avec niveau et description, taux de participation, annulation et motif. **Aucun nom**, aucun effectif en clair, aucun identifiant interne |
| **API publique** `/api/public/annonces` | **Fermée deux fois** : l'interrupteur ci-dessus, **et** une case par type de notification dans la colonne « Site du club » | Le type, le titre et le pictogramme de l'annonce, puis une séance ou un événement. **Aucun nom**, aucun identifiant, aucun effectif en clair, aucun brouillon |
| **Pages de partage** `/partage/…` | Ouvertes, non indexées, adresse non devinable | Même contenu, **plus l'effectif exact**. Toujours aucun nom |
| **Description d'une partie** | Vide par défaut | Sort par les deux portes ci-dessus quand elles sont ouvertes. **L'écran de saisie l'annonce** au moment où on l'écrit |
| **Instructeur et second instructeur** | — | **Ne sortent jamais.** Ils s'affichent aux membres connectés, et à eux seuls |
| **Relais d'image** `/api/image` | Réservé aux comptes connectés | **Ne rapatrie que des adresses que le serveur connaît déjà**. Tout échec rend un seul message, sans distinguer les cas |

Trois principes tiennent ce tableau :

- **une liste blanche, jamais une liste noire** : ce qui n'est pas explicitement recopié dans l'objet
  public ne sort pas, et des tests le vérifient champ par champ ;
- **les gardes valent pour tous les verbes**, `OPTIONS` comprise : un refus ne porte **aucun** en-tête
  CORS, il n'y a rien à autoriser quand il n'y a rien à lire ;
- **refermer coupe tout d'un coup**, y compris dans le plugin WordPress livré : son cache de secours ne
  joue que sur une panne réseau, jamais sur un refus délibéré.

S'y ajoutent : la **liste de distribution** du canal email, qu'aucun message porteur d'un jeton
personnel ne peut emprunter (le contenu est relu avant l'envoi et refusé s'il porte un lien nominatif),
et **Telegram**, qui ne porte que des messages collectifs — jamais ceux qui nomment quelqu'un. Jeton du
bot et webhook Discord sont **chiffrés en base** et ne sont jamais réaffichés.

## Limitation de débit

Persistante en base (fenêtre glissante), purgée chaque nuit. Contextes dans
`src/lib/auth/rate-limit.ts` : connexion, ouverture de lien, API publique, pages de partage, images.

### Durcissement du proxy — recommandé, et à faire avec méthode

> **Avant de coller quoi que ce soit dans Nginx Proxy Manager, sachez comment ressortir.** Son interface
> écrit le fichier **puis** recharge nginx, et une directive invalide fait échouer le chargement de la
> configuration **entière** : tous les sites du proxy tombent, son interface comprise, puisqu'elle est
> servie par le même nginx. À chaque *Save* :
>
> ```bash
> docker exec <npm> nginx -t      # avant de refermer la fenêtre
> docker logs <npm> --tail 30     # la ligne d'erreur, si le test échoue
> ```
>
> Sortie de secours : vider le champ *Custom Nginx Configuration* et sauvegarder ; si l'interface ne
> répond plus, `docker restart <npm>`, puis retirer le bloc à la main dans
> `/data/nginx/proxy_host/<id>.conf` du volume de NPM.

**Onglet *Advanced* du proxy host.** Le but est que **l'URL d'un lien personnel ne s'écrive nulle part** :
ces quatre chemins portent un jeton qui vaut un mot de passe, et le journal d'accès par défaut
l'écrirait à chaque ouverture, sur un disque sauvegardé.

```nginx
location ~ ^/(invitation|reinitialiser|annuler|desinscription)/ {
  access_log off;
  resolver 127.0.0.11 valid=10s;
  set $hema hema-organizer;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $remote_addr;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_pass http://$hema:3000$request_uri;
}
```

Trois points ne s'improvisent pas :

- **les en-têtes s'écrivent, ils ne s'empruntent pas.** Ce bloc entre dans le `server {}` *à côté* de la
  `location /` qu'engendre NPM, et n'hérite d'aucun de ses réglages. Les omettre ferait perdre
  `X-Forwarded-For` sur ces chemins — donc un seul seau de limitation pour tout Internet sur l'ouverture
  des liens, et un journal d'audit qui note la même adresse pour tout le monde. N'utilisez **pas** un
  `include` du fichier interne de NPM : son chemin ne vaut pas dans toutes les versions, et un `include`
  introuvable est exactement la directive qui couche le serveur ;
- **le nom du conteneur se résout à l'exécution**, pas au chargement : `resolver 127.0.0.11` est le DNS
  interne de Docker, la **variable** force la résolution à chaque requête, et `$request_uri` devient
  obligatoire — dès qu'un `proxy_pass` contient une variable, nginx cesse de transmettre le chemin tout
  seul. Avec un nom littéral, le conteneur recréé à chaque mise à jour change d'adresse et ces chemins
  tombent en `502` pendant que le reste du site marche, et un conteneur momentanément absent fait
  refuser la configuration entière ;
- **la cible se recopie de l'onglet *Details***. Le nom de conteneur ne vaut que si NPM est sur le même
  réseau Docker que l'application.

**Limitation de débit au proxy, facultative.** Les `limit_req_zone` vivent dans `http{}`, que l'interface
de NPM n'expose pas : il faut écrire `/data/nginx/custom/http_top.conf` dans son volume, **redémarrer le
conteneur**, vérifier qu'il est remonté, et **seulement ensuite** ajouter les `limit_req` aux `location`.
Dans l'autre ordre, nginx refuse de démarrer sur une zone inconnue.

```nginx
limit_req_zone $binary_remote_addr zone=hema_liens:10m rate=10r/m;
limit_req_zone $binary_remote_addr zone=hema_login:10m rate=5r/m;
# Journal réduit à ce dont fail2ban a besoin : l'adresse, la date, le statut. Ni chemin ni jeton.
log_format hema_masque '$remote_addr - [$time_local] "$request_method" $status';
```

Si l'on s'arrête avant cette seconde étape, rien n'est perdu : **le limiteur de l'application est en
base** et ne dépend pas du proxy — alors que le journal, lui, est une fuite que rien d'autre ne
rattrape.

**fail2ban** se branche sur les `429` du journal du proxy. Bannir ne demande que **l'adresse et le
statut**, jamais l'URL demandée :

```ini
# filter.d/hema-429.conf
[Definition]
failregex = ^<HOST> .* (429|403)$
```

**Deux conséquences à tenir :**

- si l'on préfère garder une trace de ces chemins plutôt que `access_log off`, n'utiliser que le
  **format masqué** ci-dessus. Ne journaliser **jamais** `$request` ni `$uri` sur cette `location` : les
  deux contiennent le jeton ;
- **purge courte de ces journaux.** Un lien vaut quatre mois ; un journal d'accès conservé un an garde
  donc des clés valides bien après qu'on les a oubliées. Rotation quotidienne, rétention de **7 jours**
  au plus (`logrotate`, `rotate 7`, `daily`, `compress`).

## Ce qui entoure le conteneur

Trois choses ne sont pas dans le code mais décident de ce qu'il protège.

- **Aucun port n'est publié sur l'hôte** (`docs/portainer-stack.yml`, `ports:` commenté). **L'application
  ne doit être joignable que par le proxy** : l'adresse du visiteur est lue au **dernier maillon** de
  `X-Forwarded-For`, c'est-à-dire celle que le proxy a constatée, et c'est le seul élément qu'un visiteur
  ne puisse pas écrire lui-même. Qui atteint l'application sans passer par le proxy devient ce dernier
  maillon : toutes les limitations par adresse deviennent inopérantes, et le journal d'audit note des
  adresses choisies. L'application ne peut rien y faire — elle ne voit que des en-têtes. Si un port doit
  revenir pour un dépannage, le lier à **une seule** adresse (`127.0.0.1` ou la passerelle Docker),
  jamais à `0.0.0.0`.
- **Les dossiers `data/` et `backups/` sont en `750`**, propriété de l'uid 1000. Sur un *bind mount*,
  c'est l'hôte qui décide, pas l'image : le `chmod` fait partie de la procédure d'installation.
- **Le code applicatif n'appartient pas à l'utilisateur qui l'exécute.** Il est en `root:root`, lisible
  et exécutable, non modifiable ; le compte d'exécution ne possède que `/data`, `/backups` et le cache de
  Next. Sans cela, une primitive d'écriture de fichier vaudrait une modification **persistante du
  programme**, que `restart: always` relancerait.

## Les deux journaux

| Journal | Ce qu'il garde | Rétention |
|---|---|---|
| **Journal d'audit** (en base) | Qui a fait quoi, quand, depuis quelle adresse : connexions, élévations, gestes d'administration, écritures du planning, envois et révocations de liens | Réglable dans *Espace admin → À propos* |
| **Journal des notifications** (en base) | Ce qui est parti, par quel canal, avec son verdict et le message du serveur d'envoi en cas d'échec | Borné, consultable sur l'écran du canal email |

Le journal d'audit **ne contient jamais de jeton**, ni de secret, ni de mot de passe : ni dans ses
champs, ni dans les messages d'erreur qu'il recopie. La même règle vaut pour les messages rendus à
l'écran — un refus ne recopie jamais la valeur qu'on lui a soumise.

## Risques connus et assumés

- **Le lien personnel est une clé qui dort dans une boîte mail.** C'est le choix fondateur du projet :
  un club d'une douzaine de personnes de tous âges n'adopte pas un outil qui demande un identifiant et
  un mot de passe. Les contreparties sont nommées plus haut — durée bornée, clé unique par personne,
  plafond d'appareils, email de nouvel appareil, révocation immédiate, et mot de passe disponible pour
  qui le veut. **Pour l'administration technique, ce compromis n'existe pas** : mot de passe et second
  facteur y sont obligatoires.
- **Un partage de lien entre deux personnes est indétectable** s'il reste sous le plafond d'appareils.
  Le club sait qui est membre ; l'outil ne prétend pas arbitrer au-delà.
- **Les sauvegardes contiennent tout.** La base porte les secrets chiffrés, les empreintes de mots de
  passe et les hachages de liens. Les protéger comme la base elle-même : droits restreints, et jamais
  de copie sur un partage ouvert.
- **Le HTML servi par un serveur de développement porte des jetons vivants.** C'est une propriété des
  constructions de développement de Next, pas de l'application, et il n'y en a aucune trace en
  production. Conséquence pratique : **ne publiez jamais un relevé HTML pris sur un `next dev`** — une
  capture d'image, oui ; le HTML, non.

## Signaler une faille

Si vous trouvez un défaut de sécurité dans cet outil, écrivez-en le détail en privé au mainteneur du
dépôt plutôt que dans une *issue* publique, et laissez le temps d'une correction avant toute
publication. Les instances de cet outil sont tenues par des associations bénévoles, pas par des équipes
d'astreinte.
