CREATE TABLE `inbox_items` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`url` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`entry_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `inbox_owner` ON `inbox_items` (`user_id`,`status`);--> statement-breakpoint
CREATE TABLE `mutation_checks` (
	`id` text PRIMARY KEY NOT NULL,
	`valid` integer NOT NULL,
	CONSTRAINT "mutation_valid" CHECK("mutation_checks"."valid"=1)
);
--> statement-breakpoint
CREATE TABLE `review_progress` (
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`ref_id` text NOT NULL,
	`due_at` text NOT NULL,
	`reviewed_at` text NOT NULL,
	`interval_days` integer NOT NULL,
	`review_count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`user_id`, `kind`, `ref_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `trash_items` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `trash_owner` ON `trash_items` (`user_id`);--> statement-breakpoint
ALTER TABLE `comparisons` ADD `decision` text DEFAULT '' NOT NULL;