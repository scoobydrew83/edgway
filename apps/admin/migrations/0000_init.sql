CREATE TABLE `acls` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`consumer_id` text NOT NULL,
	`group` text NOT NULL,
	`tags` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`consumer_id`) REFERENCES `consumers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `acls_consumer_id_group_unique` ON `acls` (`consumer_id`,`group`);--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text,
	`request_id` text,
	`diff` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_events_workspace_created_idx` ON `audit_events` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `basicauth_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`consumer_id` text NOT NULL,
	`username` text NOT NULL,
	`password` text NOT NULL,
	`tags` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`consumer_id`) REFERENCES `consumers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `basicauth_credentials_workspace_id_username_unique` ON `basicauth_credentials` (`workspace_id`,`username`);--> statement-breakpoint
CREATE TABLE `ca_certificates` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`cert` text NOT NULL,
	`cert_digest` text,
	`tags` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ca_certificates_workspace_id_cert_digest_unique` ON `ca_certificates` (`workspace_id`,`cert_digest`);--> statement-breakpoint
CREATE TABLE `certificates` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`cert` text NOT NULL,
	`key` text NOT NULL,
	`cert_alt` text,
	`key_alt` text,
	`tags` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `config_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`version` integer NOT NULL,
	`sha256` text NOT NULL,
	`diff` text,
	`created_by` text NOT NULL,
	`note` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `config_versions_workspace_id_version_unique` ON `config_versions` (`workspace_id`,`version`);--> statement-breakpoint
CREATE TABLE `consumer_group_consumers` (
	`workspace_id` text NOT NULL,
	`consumer_group_id` text NOT NULL,
	`consumer_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`consumer_group_id`, `consumer_id`),
	FOREIGN KEY (`consumer_group_id`) REFERENCES `consumer_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`consumer_id`) REFERENCES `consumers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `consumer_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`tags` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `consumer_groups_workspace_id_name_unique` ON `consumer_groups` (`workspace_id`,`name`);--> statement-breakpoint
CREATE TABLE `consumers` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`username` text,
	`custom_id` text,
	`tags` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `consumers_workspace_id_username_unique` ON `consumers` (`workspace_id`,`username`);--> statement-breakpoint
CREATE UNIQUE INDEX `consumers_workspace_id_custom_id_unique` ON `consumers` (`workspace_id`,`custom_id`);--> statement-breakpoint
CREATE TABLE `jwt_secrets` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`consumer_id` text NOT NULL,
	`key` text NOT NULL,
	`secret` text,
	`rsa_public_key` text,
	`algorithm` text DEFAULT 'HS256' NOT NULL,
	`tags` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`consumer_id`) REFERENCES `consumers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jwt_secrets_workspace_id_key_unique` ON `jwt_secrets` (`workspace_id`,`key`);--> statement-breakpoint
CREATE TABLE `keyauth_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`consumer_id` text NOT NULL,
	`key_hash` text NOT NULL,
	`key_prefix` text NOT NULL,
	`ttl` integer,
	`tags` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`consumer_id`) REFERENCES `consumers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `keyauth_credentials_workspace_id_key_hash_unique` ON `keyauth_credentials` (`workspace_id`,`key_hash`);--> statement-breakpoint
CREATE TABLE `plugins` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`instance_name` text,
	`route_id` text,
	`service_id` text,
	`consumer_id` text,
	`consumer_group_id` text,
	`config` text DEFAULT '{}' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`protocols` text,
	`ordering` text,
	`tags` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`route_id`) REFERENCES `routes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`consumer_id`) REFERENCES `consumers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`consumer_group_id`) REFERENCES `consumer_groups`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plugins_workspace_id_instance_name_unique` ON `plugins` (`workspace_id`,`instance_name`);--> statement-breakpoint
CREATE TABLE `routes` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text,
	`service_id` text,
	`protocols` text DEFAULT '["http","https"]' NOT NULL,
	`methods` text,
	`hosts` text,
	`paths` text,
	`headers` text,
	`https_redirect_status_code` integer DEFAULT 426 NOT NULL,
	`regex_priority` integer DEFAULT 0 NOT NULL,
	`strip_path` integer DEFAULT true NOT NULL,
	`path_handling` text DEFAULT 'v0' NOT NULL,
	`preserve_host` integer DEFAULT false NOT NULL,
	`request_buffering` integer DEFAULT true NOT NULL,
	`response_buffering` integer DEFAULT true NOT NULL,
	`snis` text,
	`sources` text,
	`destinations` text,
	`expression` text,
	`priority` integer,
	`tags` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `routes_service_id_idx` ON `routes` (`service_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `routes_workspace_id_name_unique` ON `routes` (`workspace_id`,`name`);--> statement-breakpoint
CREATE TABLE `services` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text,
	`protocol` text DEFAULT 'http' NOT NULL,
	`host` text NOT NULL,
	`port` integer DEFAULT 80 NOT NULL,
	`path` text,
	`retries` integer DEFAULT 5 NOT NULL,
	`connect_timeout` integer DEFAULT 60000 NOT NULL,
	`write_timeout` integer DEFAULT 60000 NOT NULL,
	`read_timeout` integer DEFAULT 60000 NOT NULL,
	`client_certificate_id` text,
	`tls_verify` integer,
	`tls_verify_depth` integer,
	`ca_certificates` text,
	`enabled` integer DEFAULT true NOT NULL,
	`tags` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`client_certificate_id`) REFERENCES `certificates`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `services_workspace_id_name_unique` ON `services` (`workspace_id`,`name`);--> statement-breakpoint
CREATE TABLE `snis` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`certificate_id` text NOT NULL,
	`tags` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`certificate_id`) REFERENCES `certificates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `snis_workspace_id_name_unique` ON `snis` (`workspace_id`,`name`);--> statement-breakpoint
CREATE TABLE `targets` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`upstream_id` text NOT NULL,
	`target` text NOT NULL,
	`weight` integer DEFAULT 100 NOT NULL,
	`failover` integer DEFAULT false NOT NULL,
	`tags` text,
	`created_at` real DEFAULT (unixepoch('subsec')) NOT NULL,
	`updated_at` real DEFAULT (unixepoch('subsec')) NOT NULL,
	FOREIGN KEY (`upstream_id`) REFERENCES `upstreams`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `targets_upstream_id_target_unique` ON `targets` (`upstream_id`,`target`);--> statement-breakpoint
CREATE TABLE `tunnels` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`vpc_service_id` text NOT NULL,
	`description` text,
	`tags` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tunnels_workspace_id_name_unique` ON `tunnels` (`workspace_id`,`name`);--> statement-breakpoint
CREATE TABLE `upstreams` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`algorithm` text DEFAULT 'round-robin' NOT NULL,
	`hash_on` text DEFAULT 'none' NOT NULL,
	`hash_fallback` text DEFAULT 'none' NOT NULL,
	`hash_on_header` text,
	`hash_fallback_header` text,
	`hash_on_cookie` text,
	`hash_on_cookie_path` text DEFAULT '/' NOT NULL,
	`hash_on_query_arg` text,
	`hash_fallback_query_arg` text,
	`hash_on_uri_capture` text,
	`hash_fallback_uri_capture` text,
	`slots` integer DEFAULT 10000 NOT NULL,
	`healthchecks` text,
	`host_header` text,
	`client_certificate_id` text,
	`use_srv_name` integer DEFAULT false NOT NULL,
	`sticky_sessions_cookie` text,
	`sticky_sessions_cookie_path` text DEFAULT '/' NOT NULL,
	`tags` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`client_certificate_id`) REFERENCES `certificates`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `upstreams_workspace_id_name_unique` ON `upstreams` (`workspace_id`,`name`);--> statement-breakpoint
CREATE TABLE `vaults` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`prefix` text NOT NULL,
	`description` text,
	`config` text,
	`tags` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vaults_workspace_id_prefix_unique` ON `vaults` (`workspace_id`,`prefix`);