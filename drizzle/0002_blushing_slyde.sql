CREATE TABLE `concept_terms` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`concept_id` text NOT NULL,
	`name_key` text NOT NULL,
	`term` text NOT NULL,
	`definition` text NOT NULL,
	`aliases` text DEFAULT '[]' NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`concept_id`) REFERENCES `concepts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `concept_term_name` ON `concept_terms` (`concept_id`,`name_key`);--> statement-breakpoint
CREATE INDEX `concept_terms_owner` ON `concept_terms` (`user_id`);