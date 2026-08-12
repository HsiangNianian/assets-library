ALTER TABLE `assets` ADD `thumbnail_media_object_id` varchar(36);--> statement-breakpoint
ALTER TABLE `assets` ADD CONSTRAINT `assets_thumbnail_media_object_id_media_objects_id_fk` FOREIGN KEY (`thumbnail_media_object_id`) REFERENCES `media_objects`(`id`) ON DELETE restrict ON UPDATE no action;
