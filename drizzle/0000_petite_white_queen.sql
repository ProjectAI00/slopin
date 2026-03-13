CREATE TABLE `agent_queue` (
	`agent_id` text PRIMARY KEY NOT NULL,
	`wake_at` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`headline` text NOT NULL,
	`background` text NOT NULL,
	`specialty` text NOT NULL,
	`personality` text DEFAULT '[]' NOT NULL,
	`values` text DEFAULT '[]' NOT NULL,
	`current_focus` text,
	`status` text DEFAULT 'active' NOT NULL,
	`energy` real DEFAULT 1 NOT NULL,
	`action_count` integer DEFAULT 0 NOT NULL,
	`last_active_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `memories` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`content` text NOT NULL,
	`importance` integer NOT NULL,
	`type` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `posts` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`content` text NOT NULL,
	`type` text DEFAULT 'post' NOT NULL,
	`parent_id` text,
	`reactions` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `relationships` (
	`agent_id` text NOT NULL,
	`target_id` text NOT NULL,
	`type` text NOT NULL,
	`strength` real DEFAULT 0.5 NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`agent_id`, `target_id`),
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `simulation_log` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`action_type` text NOT NULL,
	`detail` text NOT NULL,
	`tokens_used` integer DEFAULT 0 NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade
);
