<?php
/**
 * Plugin Name:       HEMA — Prochains cours
 * Plugin URI:        https://github.com/binarylefmart/hema-organizer
 * Description:       Affiche les prochains cours des Compagnons d'Armes sur le site, via le shortcode [hema_prochains_cours]. Les données viennent de HEMA Organizer ; rien n'est enregistré dans WordPress.
 * Version:           1.0.0
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            Mon club d'AMHE
 * License:           GPL-2.0-or-later
 * Text Domain:       hema-prochains-cours
 *
 * Le plugin ne fait que trois choses : lire l'API publique de HEMA Organizer, garder la réponse en
 * cache un quart d'heure, et l'afficher en cartes. Il n'écrit aucune donnée de membre dans
 * WordPress — l'API ne lui en envoie aucune —, ne crée pas de table et ne pose pas de cookie.
 */

defined( 'ABSPATH' ) || exit;

const HEMA_PC_VERSION  = '1.0.0';
const HEMA_PC_OPTION   = 'hema_pc_reglages';
const HEMA_PC_CACHE_MN = 15;

/** Réglages, valeurs par défaut comprises. */
function hema_pc_reglages() {
	$defauts = array(
		'api_url' => '',
		'app_url' => '',
		'limite'  => 5,
		/* Incrémenté à chaque enregistrement : il entre dans la clé de cache, ce qui vide
		   l'ancien cache sans aller fouiller la table des options. */
		'version' => 1,
	);
	$r = get_option( HEMA_PC_OPTION, array() );
	return wp_parse_args( is_array( $r ) ? $r : array(), $defauts );
}

/* ------------------------------------------------------------------ */
/* Réglages (Réglages → Prochains cours HEMA)                           */
/* ------------------------------------------------------------------ */

add_action( 'admin_menu', 'hema_pc_menu' );
function hema_pc_menu() {
	add_options_page(
		'Prochains cours HEMA',
		'Prochains cours HEMA',
		'manage_options',
		'hema-prochains-cours',
		'hema_pc_page_reglages'
	);
}

add_action( 'admin_init', 'hema_pc_reglages_init' );
function hema_pc_reglages_init() {
	register_setting(
		'hema_pc',
		HEMA_PC_OPTION,
		array(
			'type'              => 'array',
			'sanitize_callback' => 'hema_pc_nettoyer_reglages',
			'default'           => array(),
		)
	);
}

/**
 * Nettoyage des réglages. Les deux URL sont filtrées par `esc_url_raw` avec les seuls protocoles
 * http/https : un « javascript: » collé dans le champ ne doit pas ressortir dans un lien de la page.
 */
function hema_pc_nettoyer_reglages( $entree ) {
	$avant = hema_pc_reglages();
	$api   = esc_url_raw( trim( (string) ( $entree['api_url'] ?? '' ) ), array( 'http', 'https' ) );
	$app   = esc_url_raw( trim( (string) ( $entree['app_url'] ?? '' ) ), array( 'http', 'https' ) );
	$lim   = (int) ( $entree['limite'] ?? 5 );

	return array(
		'api_url' => $api,
		'app_url' => $app,
		'limite'  => max( 1, min( 20, $lim ) ),
		'version' => ( (int) $avant['version'] ) + 1,
	);
}

function hema_pc_page_reglages() {
	if ( ! current_user_can( 'manage_options' ) ) {
		return;
	}
	$r = hema_pc_reglages();
	?>
	<div class="wrap">
		<h1>Prochains cours HEMA</h1>
		<p>
			Affiche les prochains cours dans une page ou un article avec le shortcode
			<code>[hema_prochains_cours]</code> (widget « Shortcode » sous Elementor).
			Attributs : <code>limite="5"</code>, <code>taux="oui"</code>, <code>titre="Prochains cours"</code>.
		</p>
		<form action="options.php" method="post">
			<?php settings_fields( 'hema_pc' ); ?>
			<table class="form-table" role="presentation">
				<tr>
					<th scope="row"><label for="hema_pc_api">Adresse de l'API</label></th>
					<td>
						<input name="<?php echo esc_attr( HEMA_PC_OPTION ); ?>[api_url]" id="hema_pc_api" type="url"
							class="regular-text" value="<?php echo esc_attr( $r['api_url'] ); ?>"
							placeholder="https://organizer.mon-club.fr/api/public/prochaines-seances">
						<p class="description">L'adresse complète, terminée par <code>/api/public/prochaines-seances</code>.</p>
					</td>
				</tr>
				<tr>
					<th scope="row"><label for="hema_pc_app">Adresse de l'application</label></th>
					<td>
						<input name="<?php echo esc_attr( HEMA_PC_OPTION ); ?>[app_url]" id="hema_pc_app" type="url"
							class="regular-text" value="<?php echo esc_attr( $r['app_url'] ); ?>"
							placeholder="https://organizer.mon-club.fr">
						<p class="description">Destination du bouton « Indiquer ma présence ». Vide : pas de bouton.</p>
					</td>
				</tr>
				<tr>
					<th scope="row"><label for="hema_pc_limite">Nombre de cours</label></th>
					<td>
						<input name="<?php echo esc_attr( HEMA_PC_OPTION ); ?>[limite]" id="hema_pc_limite" type="number"
							min="1" max="20" value="<?php echo esc_attr( (string) $r['limite'] ); ?>">
						<p class="description">Valeur par défaut, que l'attribut <code>limite</code> du shortcode peut remplacer.</p>
					</td>
				</tr>
			</table>
			<p class="description">
				Les réponses sont gardées en cache <?php echo esc_html( (string) HEMA_PC_CACHE_MN ); ?> minutes ;
				enregistrer cette page vide le cache.
			</p>
			<?php submit_button(); ?>
		</form>
	</div>
	<?php
}

/* ------------------------------------------------------------------ */
/* Lecture de l'API (cache 15 min + secours)                           */
/* ------------------------------------------------------------------ */

/**
 * Les prochains cours, ou `null` si l'API n'a rien donné d'exploitable.
 *
 * Deux caches : celui de quinze minutes, et un **filet de secours** de sept jours.
 *
 * **Le secours ne sert QUE les pannes, jamais les refus**. Il tombait auparavant sur tout ce qui
 * n'était pas un `200` — or un `503` n'est pas une panne, c'est une **décision** : c'est ce que la
 * route rend quand le bureau décoche « Publier les prochains cours » dans l'espace admin.
 * Conséquence, mesurée par une relecture de sécurité : refermer la publication n'éteignait pas la
 * vitrine, le site du club continuait d'afficher les cinq prochains cours pendant **sept jours** —
 * adresses de salle et motifs d'annulation compris —, alors que `docs/SECURITE.md` promet «
 * refermer la première coupe tout d'un coup ». La promesse était vraie du serveur et fausse du
 * plugin que le même dépôt livre.
 *
 * La règle tient donc en une phrase : **l'application a-t-elle parlé ?**
 *  - `is_wp_error` (DNS, TCP, délai dépassé) : elle n'a rien dit, on ne sait rien, le secours joue
 *    son rôle — une mise à jour de l'image ou une coupure réseau ne doit pas trouer la page ;
 *  - n'importe quelle réponse HTTP qui n'est pas un planning (`503` publication refermée, `403`,
 *    `404`, adresse changée, corps illisible) : elle a répondu, et sa réponse est « non ». Les deux
 *    caches sont **effacés** et la page n'affiche rien. Un « non » qui met sept jours à s'appliquer
 *    n'est pas un interrupteur.
 *
 * Le sens du doute s'inverse ici volontairement : afficher sept jours de trop ce que le club vient de
 * retirer coûte plus cher que de perdre l'affichage pendant une panne de cinq minutes.
 */
function hema_pc_cours( $limite ) {
	$r = hema_pc_reglages();
	if ( empty( $r['api_url'] ) ) {
		return null;
	}
	$url   = add_query_arg( 'limit', (int) $limite, $r['api_url'] );
	$cle   = 'hema_pc_' . md5( $url . '|v' . $r['version'] );
	$frais = get_transient( $cle );
	if ( is_array( $frais ) ) {
		return $frais;
	}

	$reponse = wp_remote_get(
		$url,
		array(
			'timeout' => 5,
			'headers' => array( 'Accept' => 'application/json' ),
		)
	);

	if ( is_wp_error( $reponse ) ) {
		/* Panne : l'application n'a rien dit du tout. C'est le seul cas où le secours s'ouvre. */
		$secours = get_transient( $cle . '_secours' );
		return is_array( $secours ) ? $secours : null;
	}

	$corps = ( 200 === (int) wp_remote_retrieve_response_code( $reponse ) )
		? json_decode( wp_remote_retrieve_body( $reponse ), true )
		: null;

	if ( ! is_array( $corps ) || ! isset( $corps['seances'] ) || ! is_array( $corps['seances'] ) ) {
		/* Refus ou réponse inexploitable : on oublie ce qu'on avait, et on n'affiche rien. */
		delete_transient( $cle );
		delete_transient( $cle . '_secours' );
		return null;
	}

	set_transient( $cle, $corps, HEMA_PC_CACHE_MN * MINUTE_IN_SECONDS );
	set_transient( $cle . '_secours', $corps, 7 * DAY_IN_SECONDS );
	return $corps;
}

/* ------------------------------------------------------------------ */
/* Shortcode                                                           */
/* ------------------------------------------------------------------ */

add_action( 'init', 'hema_pc_init' );
function hema_pc_init() {
	wp_register_style(
		'hema-prochains-cours',
		plugins_url( 'assets/hema-prochains-cours.css', __FILE__ ),
		array(),
		HEMA_PC_VERSION
	);
	add_shortcode( 'hema_prochains_cours', 'hema_pc_shortcode' );
}

/**
 * `[hema_prochains_cours limite="5" taux="non" titre=""]`
 *
 * `taux` reste à « non » par défaut : le taux de participation est un chiffre interne, qui se
 * comprend entre membres et se lit mal sur la vitrine du club. Il est disponible pour qui le veut.
 * (`limit`, en anglais, est accepté : c'est le nom du paramètre de l'API et du cahier des charges.)
 */
function hema_pc_shortcode( $atts ) {
	$r    = hema_pc_reglages();
	$atts = shortcode_atts(
		array(
			'limite' => 0,
			'limit'  => 0,
			'taux'   => 'non',
			'titre'  => '',
		),
		$atts,
		'hema_prochains_cours'
	);

	$limite = (int) $atts['limite'] ?: (int) $atts['limit'] ?: (int) $r['limite'];
	$limite = max( 1, min( 20, $limite ) );
	$taux   = in_array( strtolower( (string) $atts['taux'] ), array( 'oui', 'yes', '1', 'true' ), true );

	$data = hema_pc_cours( $limite );
	if ( null === $data ) {
		/* Rien à afficher : soit l'application a refusé (publication refermée côté club), soit elle
		   est injoignable et aucun secours ne traîne. Dans les deux cas la page reste muette devant
		   les visiteurs — un message d'erreur technique sur la vitrine du club n'aide personne.
		   L'administrateur, lui, voit les deux causes possibles, dans l'ordre de fréquence. */
		return current_user_can( 'manage_options' )
			? '<p class="hema-cours-vide">Prochains cours : rien à afficher. Soit « Publier les prochains cours » est décochée dans l\'application (Espace admin → Notifications), soit elle ne répond pas et l\'adresse de l\'API est à vérifier dans Réglages → Prochains cours HEMA.</p>'
			: '';
	}

	wp_enqueue_style( 'hema-prochains-cours' );

	$seances = array_slice( $data['seances'], 0, $limite );
	ob_start();
	?>
	<section class="hema-cours">
		<?php if ( '' !== trim( (string) $atts['titre'] ) ) : ?>
			<h2 class="hema-cours-titre"><?php echo esc_html( $atts['titre'] ); ?></h2>
		<?php endif; ?>
		<?php if ( empty( $seances ) ) : ?>
			<p class="hema-cours-vide">Aucun cours programmé pour l'instant.</p>
		<?php else : ?>
			<ul class="hema-cours-liste">
				<?php foreach ( $seances as $s ) : ?>
					<?php
					$annulee = ! empty( $s['annulee'] );
					$theme   = trim( (string) ( $s['theme'] ?? '' ) );
					?>
					<li class="hema-carte<?php echo $annulee ? ' hema-carte--annulee' : ''; ?>">
						<p class="hema-date">
							<?php echo esc_html( (string) ( $s['dateTexte'] ?? '' ) ); ?>
							<span class="hema-horaire"><?php echo esc_html( (string) ( $s['horaire'] ?? '' ) ); ?></span>
						</p>
						<?php if ( $annulee ) : ?>
							<p class="hema-annule">
								Cours annulé
								<?php if ( ! empty( $s['motif'] ) ) : ?>
									<span class="hema-motif"><?php echo esc_html( (string) $s['motif'] ); ?></span>
								<?php endif; ?>
							</p>
						<?php elseif ( '' !== $theme ) : ?>
							<p class="hema-theme"><?php echo esc_html( $theme ); ?></p>
						<?php endif; ?>
						<?php if ( ! empty( $s['lieu'] ) ) : ?>
							<p class="hema-lieu"><?php echo esc_html( (string) $s['lieu'] ); ?></p>
						<?php endif; ?>
						<?php if ( $taux && ! $annulee && isset( $s['taux'] ) ) : ?>
							<p class="hema-taux"><?php echo esc_html( (int) $s['taux'] ); ?> % de participation</p>
						<?php endif; ?>
					</li>
				<?php endforeach; ?>
			</ul>
		<?php endif; ?>
		<?php if ( ! empty( $r['app_url'] ) ) : ?>
			<p class="hema-cours-action">
				<a class="hema-bouton" href="<?php echo esc_url( $r['app_url'] ); ?>">Indiquer ma présence</a>
			</p>
		<?php endif; ?>
	</section>
	<?php
	return (string) ob_get_clean();
}
