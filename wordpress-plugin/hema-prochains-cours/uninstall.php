<?php
/**
 * Désinstallation : le plugin ne laisse rien derrière lui — ses réglages et ses caches, et c'est
 * tout ce qu'il avait jamais écrit (aucune donnée de membre n'a transité, l'API n'en publie pas).
 */

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

delete_option( 'hema_pc_reglages' );

global $wpdb;
$wpdb->query(
	$wpdb->prepare(
		"DELETE FROM {$wpdb->options} WHERE option_name LIKE %s OR option_name LIKE %s",
		$wpdb->esc_like( '_transient_hema_pc_' ) . '%',
		$wpdb->esc_like( '_transient_timeout_hema_pc_' ) . '%'
	)
);
