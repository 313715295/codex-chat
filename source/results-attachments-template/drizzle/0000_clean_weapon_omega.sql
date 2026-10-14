CREATE TABLE `reviews` (
	`user_id` text NOT NULL,
	`task_id` text NOT NULL,
	`revision` text NOT NULL,
	`result` text NOT NULL,
	`receipt` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `task_id`, `revision`)
);
