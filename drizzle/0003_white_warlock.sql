CREATE TABLE `auth_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `auth_sessions_expiry` ON `auth_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `github_challenges` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`device_code` text NOT NULL,
	`link_user_id` text,
	`expires_at` integer NOT NULL,
	`next_poll_at` integer NOT NULL,
	`interval_seconds` integer NOT NULL,
	FOREIGN KEY (`link_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `github_identities` (
	`github_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`login` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `github_identities_user` ON `github_identities` (`user_id`);