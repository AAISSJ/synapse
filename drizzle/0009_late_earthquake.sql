CREATE TABLE `peer_additions` (
	`user_id` text NOT NULL,
	`client_key` text NOT NULL,
	`request_body` text NOT NULL,
	`result` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `client_key`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
