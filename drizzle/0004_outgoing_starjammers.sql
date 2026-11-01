ALTER TABLE `concept_terms` ADD `highlighted` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `concept_terms` ADD `hidden` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `entries` ADD `highlighted` integer DEFAULT 0 NOT NULL;