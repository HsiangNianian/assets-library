ALTER TABLE `video_sources` DROP FOREIGN KEY `video_sources_task_id_tasks_id_fk`;
--> statement-breakpoint
ALTER TABLE `video_sources` DROP FOREIGN KEY `video_sources_task_item_id_task_items_id_fk`;
--> statement-breakpoint
ALTER TABLE `video_sources` MODIFY COLUMN `task_id` varchar(36);--> statement-breakpoint
ALTER TABLE `video_sources` MODIFY COLUMN `task_item_id` varchar(36);--> statement-breakpoint
ALTER TABLE `video_sources` ADD CONSTRAINT `video_sources_task_id_tasks_id_fk` FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `video_sources` ADD CONSTRAINT `video_sources_task_item_id_task_items_id_fk` FOREIGN KEY (`task_item_id`) REFERENCES `task_items`(`id`) ON DELETE set null ON UPDATE no action;