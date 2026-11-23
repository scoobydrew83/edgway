CREATE TABLE `sandbox_plugins` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`version` text DEFAULT '0.0.0' NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`code` text NOT NULL,
	`cpu_ms` integer,
	`sub_requests` integer,
	`bindings` text,
	`tags` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sandbox_plugins_workspace_id_name_unique` ON `sandbox_plugins` (`workspace_id`,`name`);