CREATE TABLE `analysis_results` (
	`asset_id` varchar(36) NOT NULL,
	`schema_version` int unsigned NOT NULL DEFAULT 1,
	`result_json` json NOT NULL,
	`model_protocol` varchar(64) NOT NULL,
	`model_name` varchar(255) NOT NULL,
	`completed_at` datetime(3) NOT NULL,
	CONSTRAINT `analysis_results_asset_id` PRIMARY KEY(`asset_id`)
);
--> statement-breakpoint
CREATE TABLE `asset_tag_rejections` (
	`asset_id` varchar(36) NOT NULL,
	`category` varchar(64) NOT NULL,
	`normalized_value` varchar(128) NOT NULL,
	CONSTRAINT `asset_tag_rejections_asset_id_category_normalized_value_pk` PRIMARY KEY(`asset_id`,`category`,`normalized_value`)
);
--> statement-breakpoint
CREATE TABLE `asset_tags` (
	`asset_id` varchar(36) NOT NULL,
	`tag_id` varchar(36) NOT NULL,
	`source` enum('model','human') NOT NULL,
	`confidence` double,
	CONSTRAINT `asset_tags_asset_id_tag_id_pk` PRIMARY KEY(`asset_id`,`tag_id`)
);
--> statement-breakpoint
CREATE TABLE `assets` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(191),
	`task_id` varchar(36),
	`task_item_id` varchar(36),
	`task_item_segment_id` varchar(36),
	`video_source_id` varchar(36),
	`media_object_id` varchar(36),
	`segment_index` int unsigned,
	`segment_start_ms` bigint unsigned,
	`segment_end_ms` bigint unsigned,
	`name` varchar(255) NOT NULL,
	`description` text NOT NULL,
	`media_type` enum('image','video') NOT NULL,
	`original_filename` varchar(255) NOT NULL,
	`original_path` varchar(1024) NOT NULL,
	`mime_type` varchar(255) NOT NULL,
	`size_bytes` bigint unsigned NOT NULL,
	`direct_publish` boolean NOT NULL DEFAULT false,
	`processing_status` enum('queued','validating','analyzing','completed','failed') NOT NULL DEFAULT 'queued',
	`review_status` enum('pending_review','published','deleted') NOT NULL DEFAULT 'pending_review',
	`failure_code` varchar(64),
	`failure_message` text,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	`deleted_at` datetime(3),
	CONSTRAINT `assets_id` PRIMARY KEY(`id`),
	CONSTRAINT `assets_task_segment_unique` UNIQUE(`task_item_segment_id`),
	CONSTRAINT `assets_source_segment_unique` UNIQUE(`video_source_id`,`segment_index`)
);
--> statement-breakpoint
CREATE TABLE `callback_deliveries` (
	`id` varchar(36) NOT NULL,
	`task_id` varchar(36) NOT NULL,
	`attempt` int unsigned NOT NULL,
	`request_body` json NOT NULL,
	`response_status` int unsigned,
	`response_body` text,
	`error_message` text,
	`started_at` datetime(3) NOT NULL,
	`completed_at` datetime(3),
	CONSTRAINT `callback_deliveries_id` PRIMARY KEY(`id`),
	CONSTRAINT `callback_task_attempt_unique` UNIQUE(`task_id`,`attempt`)
);
--> statement-breakpoint
CREATE TABLE `idempotency_requests` (
	`id` varchar(36) NOT NULL,
	`operation` varchar(64) NOT NULL,
	`user_scope` varchar(191) NOT NULL DEFAULT 'public',
	`idempotency_key` varchar(255) NOT NULL,
	`request_hash` varchar(64) NOT NULL,
	`task_id` varchar(36) NOT NULL,
	`response_status` int unsigned,
	`response_body` json,
	`created_at` datetime(3) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	CONSTRAINT `idempotency_requests_id` PRIMARY KEY(`id`),
	CONSTRAINT `idempotency_scope_key_unique` UNIQUE(`operation`,`user_scope`,`idempotency_key`)
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` varchar(36) NOT NULL,
	`task_id` varchar(36),
	`asset_id` varchar(36),
	`type` enum('validate','scene_detect','persist','analyze','embed','delete','cleanup','publish','update','retry','callback') NOT NULL,
	`status` enum('queued','running','done','failed') NOT NULL DEFAULT 'queued',
	`phase` varchar(64) NOT NULL DEFAULT 'queued',
	`payload` json,
	`attempt` int unsigned NOT NULL DEFAULT 0,
	`available_at` datetime(3) NOT NULL,
	`claimed_at` datetime(3),
	`lease_owner` varchar(191),
	`error_code` varchar(64),
	`error_message` text,
	`error_details` json,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `jobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `media_objects` (
	`id` varchar(36) NOT NULL,
	`provider` enum('local','zos') NOT NULL,
	`bucket` varchar(255),
	`object_key` varchar(700) NOT NULL,
	`public_url` varchar(2048),
	`local_path` varchar(1024),
	`sha256` varchar(64),
	`mime_type` varchar(255) NOT NULL,
	`size_bytes` bigint unsigned NOT NULL,
	`status` enum('staging','persisted','deleting','deleted') NOT NULL DEFAULT 'staging',
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	`deleted_at` datetime(3),
	CONSTRAINT `media_objects_id` PRIMARY KEY(`id`),
	CONSTRAINT `media_provider_object_unique` UNIQUE(`provider`,`object_key`)
);
--> statement-breakpoint
CREATE TABLE `outbox_events` (
	`id` varchar(36) NOT NULL,
	`aggregate_type` varchar(64) NOT NULL,
	`aggregate_id` varchar(36) NOT NULL,
	`event_type` varchar(128) NOT NULL,
	`payload` json NOT NULL,
	`status` enum('queued','running','done','failed') NOT NULL DEFAULT 'queued',
	`attempt` int unsigned NOT NULL DEFAULT 0,
	`available_at` datetime(3) NOT NULL,
	`claimed_at` datetime(3),
	`processed_at` datetime(3),
	`error_message` text,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `outbox_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `search_index_state` (
	`asset_id` varchar(36) NOT NULL,
	`status` enum('queued','running','done','failed','deleted') NOT NULL DEFAULT 'queued',
	`content_hash` varchar(64),
	`indexed_at` datetime(3),
	`error_message` text,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `search_index_state_asset_id` PRIMARY KEY(`asset_id`)
);
--> statement-breakpoint
CREATE TABLE `tags` (
	`id` varchar(36) NOT NULL,
	`category` varchar(64) NOT NULL,
	`value` varchar(128) NOT NULL,
	`normalized_value` varchar(128) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `tags_id` PRIMARY KEY(`id`),
	CONSTRAINT `tags_category_normalized_unique` UNIQUE(`category`,`normalized_value`)
);
--> statement-breakpoint
CREATE TABLE `task_item_segments` (
	`id` varchar(36) NOT NULL,
	`task_item_id` varchar(36) NOT NULL,
	`video_source_id` varchar(36) NOT NULL,
	`segment_index` int unsigned NOT NULL,
	`start_ms` bigint unsigned NOT NULL,
	`end_ms` bigint unsigned NOT NULL,
	`staging_path` varchar(1024) NOT NULL,
	`mime_type` varchar(255) NOT NULL,
	`size_bytes` bigint unsigned NOT NULL,
	`status` enum('queued','running','done','failed') NOT NULL DEFAULT 'queued',
	`error_code` varchar(64),
	`error_message` text,
	`error_details` json,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `task_item_segments_id` PRIMARY KEY(`id`),
	CONSTRAINT `segments_source_index_unique` UNIQUE(`video_source_id`,`segment_index`)
);
--> statement-breakpoint
CREATE TABLE `task_items` (
	`id` varchar(36) NOT NULL,
	`task_id` varchar(36) NOT NULL,
	`ordinal` int unsigned NOT NULL,
	`filename` varchar(255) NOT NULL,
	`declared_content_type` varchar(255),
	`media_type` enum('image','video'),
	`staging_path` varchar(1024) NOT NULL,
	`received_bytes` bigint unsigned NOT NULL DEFAULT 0,
	`total_bytes` bigint unsigned NOT NULL DEFAULT 0,
	`status` enum('queued','running','done','failed') NOT NULL DEFAULT 'queued',
	`phase` varchar(64) NOT NULL DEFAULT 'receiving',
	`error_code` varchar(64),
	`error_message` text,
	`error_details` json,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `task_items_id` PRIMARY KEY(`id`),
	CONSTRAINT `task_items_task_ordinal_unique` UNIQUE(`task_id`,`ordinal`)
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` varchar(36) NOT NULL,
	`type` enum('upload','delete','publish','update','retry') NOT NULL,
	`status` enum('queued','running','done','failed') NOT NULL DEFAULT 'queued',
	`phase` varchar(64) NOT NULL DEFAULT 'queued',
	`user_id` varchar(191),
	`callback_url` varchar(2048),
	`received_bytes` bigint unsigned NOT NULL DEFAULT 0,
	`total_bytes` bigint unsigned NOT NULL DEFAULT 0,
	`total_items` int unsigned NOT NULL DEFAULT 0,
	`done_items` int unsigned NOT NULL DEFAULT 0,
	`failed_items` int unsigned NOT NULL DEFAULT 0,
	`progress_percent` decimal(5,2) unsigned NOT NULL DEFAULT 0,
	`error_code` varchar(64),
	`error_message` text,
	`error_details` json,
	`result` json,
	`callback_attempts` int unsigned NOT NULL DEFAULT 0,
	`next_callback_at` datetime(3),
	`callback_completed_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	`started_at` datetime(3),
	`finished_at` datetime(3),
	`expires_at` datetime(3),
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `tasks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `video_sources` (
	`id` varchar(36) NOT NULL,
	`task_id` varchar(36) NOT NULL,
	`task_item_id` varchar(36) NOT NULL,
	`user_id` varchar(191),
	`media_object_id` varchar(36),
	`original_filename` varchar(255) NOT NULL,
	`mime_type` varchar(255) NOT NULL,
	`size_bytes` bigint unsigned NOT NULL,
	`duration_ms` bigint unsigned,
	`status` enum('queued','running','done','failed') NOT NULL DEFAULT 'queued',
	`error_code` varchar(64),
	`error_message` text,
	`error_details` json,
	`expires_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	`deleted_at` datetime(3),
	CONSTRAINT `video_sources_id` PRIMARY KEY(`id`),
	CONSTRAINT `video_sources_task_item_unique` UNIQUE(`task_item_id`)
);
--> statement-breakpoint
ALTER TABLE `analysis_results` ADD CONSTRAINT `analysis_results_asset_id_assets_id_fk` FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `asset_tag_rejections` ADD CONSTRAINT `asset_tag_rejections_asset_id_assets_id_fk` FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `asset_tags` ADD CONSTRAINT `asset_tags_asset_id_assets_id_fk` FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `asset_tags` ADD CONSTRAINT `asset_tags_tag_id_tags_id_fk` FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `assets` ADD CONSTRAINT `assets_task_id_tasks_id_fk` FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `assets` ADD CONSTRAINT `assets_task_item_id_task_items_id_fk` FOREIGN KEY (`task_item_id`) REFERENCES `task_items`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `assets` ADD CONSTRAINT `assets_task_item_segment_id_task_item_segments_id_fk` FOREIGN KEY (`task_item_segment_id`) REFERENCES `task_item_segments`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `assets` ADD CONSTRAINT `assets_video_source_id_video_sources_id_fk` FOREIGN KEY (`video_source_id`) REFERENCES `video_sources`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `assets` ADD CONSTRAINT `assets_media_object_id_media_objects_id_fk` FOREIGN KEY (`media_object_id`) REFERENCES `media_objects`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `callback_deliveries` ADD CONSTRAINT `callback_deliveries_task_id_tasks_id_fk` FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `idempotency_requests` ADD CONSTRAINT `idempotency_requests_task_id_tasks_id_fk` FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `jobs` ADD CONSTRAINT `jobs_task_id_tasks_id_fk` FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `jobs` ADD CONSTRAINT `jobs_asset_id_assets_id_fk` FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `search_index_state` ADD CONSTRAINT `search_index_state_asset_id_assets_id_fk` FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `task_item_segments` ADD CONSTRAINT `task_item_segments_task_item_id_task_items_id_fk` FOREIGN KEY (`task_item_id`) REFERENCES `task_items`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `task_item_segments` ADD CONSTRAINT `task_item_segments_video_source_id_video_sources_id_fk` FOREIGN KEY (`video_source_id`) REFERENCES `video_sources`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `task_items` ADD CONSTRAINT `task_items_task_id_tasks_id_fk` FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `video_sources` ADD CONSTRAINT `video_sources_task_id_tasks_id_fk` FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `video_sources` ADD CONSTRAINT `video_sources_task_item_id_task_items_id_fk` FOREIGN KEY (`task_item_id`) REFERENCES `task_items`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `video_sources` ADD CONSTRAINT `video_sources_media_object_id_media_objects_id_fk` FOREIGN KEY (`media_object_id`) REFERENCES `media_objects`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `assets_user_review_created_idx` ON `assets` (`user_id`,`review_status`,`created_at`);--> statement-breakpoint
CREATE INDEX `assets_review_created_idx` ON `assets` (`review_status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idempotency_expires_idx` ON `idempotency_requests` (`expires_at`);--> statement-breakpoint
CREATE INDEX `jobs_queue_idx` ON `jobs` (`status`,`available_at`,`created_at`);--> statement-breakpoint
CREATE INDEX `jobs_task_idx` ON `jobs` (`task_id`,`status`);--> statement-breakpoint
CREATE INDEX `jobs_asset_idx` ON `jobs` (`asset_id`,`status`);--> statement-breakpoint
CREATE INDEX `media_sha_size_idx` ON `media_objects` (`sha256`,`size_bytes`);--> statement-breakpoint
CREATE INDEX `media_status_updated_idx` ON `media_objects` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `outbox_queue_idx` ON `outbox_events` (`status`,`available_at`);--> statement-breakpoint
CREATE INDEX `search_index_status_idx` ON `search_index_state` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `segments_item_status_idx` ON `task_item_segments` (`task_item_id`,`status`);--> statement-breakpoint
CREATE INDEX `task_items_task_status_idx` ON `task_items` (`task_id`,`status`);--> statement-breakpoint
CREATE INDEX `tasks_status_created_idx` ON `tasks` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `tasks_expires_idx` ON `tasks` (`expires_at`);--> statement-breakpoint
CREATE INDEX `tasks_user_created_idx` ON `tasks` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `video_sources_user_created_idx` ON `video_sources` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `video_sources_expires_idx` ON `video_sources` (`expires_at`);