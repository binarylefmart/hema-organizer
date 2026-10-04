# Les trois guides d'utilisation

Un guide par rôle, écrit pour être **imprimé** et posé à côté d'un téléphone :

| Fichier | Pour qui | Ce qu'il couvre |
|---|---|---|
| `guide-membre.html` | les adhérents | **le socle** : entrer, dire si on vient, lire le planning (cours et options, ce qui n'est pas rempli ne s'affiche pas), proposer un atelier, les événements, son profil et ses messages |
| `guide-instructeur.html` | l'encadrement | **le complément du précédent** : remplir le planning partie par partie (`----------` = rien ici), tenir les séances, décider des ateliers, publier les annonces, ce qu'on reçoit en plus et le tableau de bord |
| `guide-admin.html` | le bureau | **la troisième marche** : ouvrir l'espace admin, la saison (trimestre ou bimestre), corriger les présences (à l'unité ou par lots), l'annuaire et les rôles par lots, les liens, les comptes, le journal, Discord et Telegram, la liste de distribution, l'API publique, la part d'effectif, les thèmes et les lieux |

Les trois guides se lisent **en cascade** : le guide du membre dit
tout ce que tout le monde fait, et les deux autres ne répètent rien — ils commencent par un renvoi
au précédent. Un instructeur lit donc deux guides, un administrateur trois.

Ce sont des **marches à suivre**, pas des exposés : titres qui
commencent par un verbe, étapes numérotées, et aucune phrase sur le fonctionnement de l'application
(« votre choix est gardé tout de suite », « rien à valider », « il n'y a pas de brouillon »). Les
seules phrases qui ne sont pas des gestes sont les avertissements, un par action sans retour ou qui
part vers les gens.

Chaque guide ne parle **que du rôle** qu'il vise : aucun tableau « qui peut quoi », rien sur les
écrans fermés, aucune explication de droits. Aucun jargon non plus — le public du club n'est pas
informaticien (voir `CLAUDE.md`, « zéro jargon »). Et **ce qui se voit sur la capture ne s'écrit
pas** : ni position, ni couleur, ni inventaire d'écran ; le texte porte le geste et la règle.

## Refaire les PDF

```bash
npm run dev                                   # dans un terminal (avec npm run db:seed:demo)
npm run preview:screenshots                   # les captures que les guides affichent
npm run guides:pdf                            # → HEMA-Organizer-guide-*.pdf, ici même
```

`npm run guides:pdf -- --only=membre` n'en refait qu'un.

## Comment c'est fait

- Les guides sont des **pages HTML** : `guide.css` porte toute la mise en page d'impression
  (`@page` A4, sauts de page sur les `h2`, figures insécables) et la charte du club. Ouvrir un
  `.html` dans un navigateur donne exactement ce que sort le PDF, la feuille A4 simulée à l'écran.
- Les captures ne sont **pas** dans le dépôt (`/previews` est ignoré par git, voir `.gitignore`) :
  elles se regénèrent avec la commande ci-dessus. Les PDF, eux, les embarquent.
- La police de titrage (IM Fell Great Primer SC, celle de l'application) est copiée dans `fonts/`
  pour que l'impression ne dépende d'aucun accès réseau.
- `scripts/guides-pdf.ts` ne fait qu'imprimer : c'est Chromium qui pagine.

## En écrire un autre

Reprendre le squelette d'un guide existant (couverture, sommaire, `h2` par partie) et n'utiliser que
les classes de `guide.css` — aucun `<style>`, aucun `style=`. Les classes utiles :
`figure.pc` / `figure.haute` / `figure.tel` / `.duo` pour les captures, `.encart.astuce|attention|info`,
`ol.etapes`, `.pastille.present|absent|peutetre`, `.chapo`, `.fin`.
