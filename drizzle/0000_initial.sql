CREATE TABLE IF NOT EXISTS `analysis_results` (
	`asset_id` text PRIMARY KEY NOT NULL,
	`schema_version` integer DEFAULT 1 NOT NULL,
	`result_json` text NOT NULL,
	`model_protocol` text NOT NULL,
	`model_name` text NOT NULL,
	`completed_at` integer NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `asset_tag_rejections` (
	`asset_id` text NOT NULL,
	`category` text NOT NULL,
	`normalized_value` text NOT NULL,
	PRIMARY KEY(`asset_id`, `category`, `normalized_value`),
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `asset_tags` (
	`asset_id` text NOT NULL,
	`tag_id` text NOT NULL,
	`source` text NOT NULL,
	`confidence` real,
	PRIMARY KEY(`asset_id`, `tag_id`),
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`media_type` text NOT NULL,
	`original_filename` text NOT NULL,
	`original_path` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`direct_publish` integer NOT NULL,
	`processing_status` text DEFAULT 'queued' NOT NULL,
	`review_status` text DEFAULT 'pending_review' NOT NULL,
	`failure_code` text,
	`failure_message` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `assets_review_created_idx` ON `assets` (`review_status`,`created_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `processing_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`attempt` integer DEFAULT 0 NOT NULL,
	`available_at` integer NOT NULL,
	`claimed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `jobs_queue_idx` ON `processing_jobs` (`status`,`available_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`category` text NOT NULL,
	`value` text NOT NULL,
	`normalized_value` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `tags_category_normalized_unique` ON `tags` (`category`,`normalized_value`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `upload_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`client_filename` text NOT NULL,
	`declared_mime` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `upload_asset_unique` ON `upload_requests` (`asset_id`);
