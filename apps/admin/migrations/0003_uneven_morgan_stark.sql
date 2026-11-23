ALTER TABLE `consumers` ADD `portal_subject` text;--> statement-breakpoint
CREATE UNIQUE INDEX `consumers_workspace_id_portal_subject_unique` ON `consumers` (`workspace_id`,`portal_subject`);