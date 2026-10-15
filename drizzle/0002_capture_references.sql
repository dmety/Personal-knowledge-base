CREATE TABLE `record_references` (
  `owner` text NOT NULL,
  `entry_id` text NOT NULL,
  `number` integer NOT NULL,
  PRIMARY KEY (`owner`, `entry_id`),
  UNIQUE (`owner`, `number`)
);
