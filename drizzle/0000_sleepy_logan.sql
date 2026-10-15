CREATE TABLE `entries` (
	`owner` text NOT NULL,
	`id` text NOT NULL,
	`version` integer NOT NULL,
	`data` text NOT NULL,
	PRIMARY KEY(`owner`, `id`)
);
--> statement-breakpoint
CREATE TABLE `history` (
	`owner` text NOT NULL,
	`id` text NOT NULL,
	`entry_id` text NOT NULL,
	`data` text NOT NULL,
	PRIMARY KEY(`owner`, `id`)
);
--> statement-breakpoint
CREATE TABLE `mutation_guard` (
	`valid` integer NOT NULL,
	CONSTRAINT "one_changed_row" CHECK("mutation_guard"."valid" = 1)
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`owner` text PRIMARY KEY NOT NULL,
	`last_export` text
);
