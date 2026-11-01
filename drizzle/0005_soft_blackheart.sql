CREATE TABLE `comparisons` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`client_key` text,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`concept_ids` text NOT NULL,
	`rows` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `comparisons_user` ON `comparisons` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `comparisons_client_key` ON `comparisons` (`user_id`,`client_key`);--> statement-breakpoint
ALTER TABLE `concepts` ADD `personal_notes` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `concepts` ADD `personal_notes_updated_at` text;