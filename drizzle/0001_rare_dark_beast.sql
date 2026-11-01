CREATE TABLE `agent_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`client_id` text NOT NULL,
	`prompt` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`reply` text DEFAULT '' NOT NULL,
	`result_json` text,
	`error` text,
	`worker_id` text,
	`lease_token` text,
	`lease_until` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`thread_id`) REFERENCES `agent_threads`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_request_client` ON `agent_requests` (`user_id`,`client_id`);--> statement-breakpoint
CREATE INDEX `agent_requests_user_status` ON `agent_requests` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `agent_requests_thread` ON `agent_requests` (`thread_id`);--> statement-breakpoint
CREATE TABLE `agent_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `agent_threads_user` ON `agent_threads` (`user_id`);