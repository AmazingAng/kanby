CREATE TABLE `member_metric_events` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`active` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_member_metrics_project_time` ON `member_metric_events` (`project_id`,`occurred_at`,`sequence`);
--> statement-breakpoint
CREATE TABLE `metric_coverage` (
	`id` integer PRIMARY KEY NOT NULL,
	`started_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `task_metric_events` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`task_id` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`kind` text NOT NULL,
	`state` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_task_metrics_project_time` ON `task_metric_events` (`project_id`,`occurred_at`,`sequence`);
--> statement-breakpoint
CREATE INDEX `idx_task_metrics_task_sequence` ON `task_metric_events` (`project_id`,`task_id`,`sequence`);
--> statement-breakpoint
INSERT INTO metric_coverage (id, started_at) VALUES (1, (CAST(strftime('%s', 'now') AS INTEGER) * 1000 + CAST(substr(strftime('%f', 'now'), 4, 3) AS INTEGER)));
--> statement-breakpoint
CREATE VIEW task_metric_state AS
SELECT t.project_id, t.id AS task_id,
 json_object('status', t.status,
 'owners', json(CASE WHEN EXISTS(SELECT 1 FROM task_assignees a WHERE a.project_id=t.project_id AND a.task_id=t.id)
 THEN (SELECT json_group_array(user_id) FROM (SELECT user_id FROM task_assignees a WHERE a.project_id=t.project_id AND a.task_id=t.id ORDER BY a.position, a.user_id))
 ELSE json_array(t.owner_id) END),
 'due', t.due, 'parentId', t.parent_task_id,
 'archived', CASE WHEN t.archived_at IS NULL THEN json('false') ELSE json('true') END,
 'deleted', json('false'),
 'criteria', (SELECT COUNT(*) FROM task_acceptance_items c WHERE c.project_id=t.project_id AND c.task_id=t.id),
 'checked', (SELECT COUNT(*) FROM task_acceptance_items c WHERE c.project_id=t.project_id AND c.task_id=t.id AND c.completed=1),
 'openChildren', (SELECT COUNT(*) FROM tasks c WHERE c.project_id=t.project_id AND c.parent_task_id=t.id AND c.status!='shipped')
 ) AS state
FROM tasks t;
--> statement-breakpoint
INSERT INTO task_metric_events (project_id,task_id,occurred_at,kind,state) SELECT project_id,task_id,(SELECT started_at FROM metric_coverage WHERE id=1),'baseline',state FROM task_metric_state;
--> statement-breakpoint
INSERT INTO member_metric_events (project_id,user_id,name,occurred_at,active) SELECT m.project_id,m.user_id,u.name,(SELECT started_at FROM metric_coverage WHERE id=1),1 FROM project_members m JOIN users u ON u.id=m.user_id;
--> statement-breakpoint
CREATE TRIGGER task_metrics_created AFTER INSERT ON tasks BEGIN
INSERT INTO task_metric_events (project_id,task_id,occurred_at,kind,state)
SELECT project_id,task_id,(CAST(strftime('%s', 'now') AS INTEGER) * 1000 + CAST(substr(strftime('%f', 'now'), 4, 3) AS INTEGER)),'created',state FROM task_metric_state WHERE task_id=NEW.id AND project_id=NEW.project_id;
END;
--> statement-breakpoint
CREATE TRIGGER task_metrics_project_commit AFTER UPDATE OF updated_at ON projects BEGIN
INSERT INTO task_metric_events (project_id,task_id,occurred_at,kind,state)
SELECT s.project_id,s.task_id,(CAST(strftime('%s', 'now') AS INTEGER) * 1000 + CAST(substr(strftime('%f', 'now'), 4, 3) AS INTEGER)),'change',s.state FROM task_metric_state s
WHERE s.project_id=NEW.id AND s.state IS NOT (
SELECT e.state FROM task_metric_events e WHERE e.project_id=s.project_id AND e.task_id=s.task_id ORDER BY e.sequence DESC LIMIT 1);
END;
--> statement-breakpoint
CREATE TRIGGER task_metrics_deleted BEFORE DELETE ON tasks BEGIN
INSERT INTO task_metric_events (project_id,task_id,occurred_at,kind,state)
SELECT project_id,task_id,(CAST(strftime('%s', 'now') AS INTEGER) * 1000 + CAST(substr(strftime('%f', 'now'), 4, 3) AS INTEGER)),'deleted',json_set(state,'$.deleted',json('true')) FROM task_metric_state WHERE task_id=OLD.id AND project_id=OLD.project_id;
END;
--> statement-breakpoint
CREATE TRIGGER member_metrics_insert AFTER INSERT ON project_members BEGIN
INSERT INTO member_metric_events (project_id,user_id,name,occurred_at,active)
VALUES (NEW.project_id,NEW.user_id,COALESCE((SELECT name FROM users WHERE id=NEW.user_id),NEW.user_id),(CAST(strftime('%s', 'now') AS INTEGER) * 1000 + CAST(substr(strftime('%f', 'now'), 4, 3) AS INTEGER)),1);
END;
--> statement-breakpoint
CREATE TRIGGER member_metrics_delete AFTER DELETE ON project_members BEGIN
INSERT INTO member_metric_events (project_id,user_id,name,occurred_at,active)
VALUES (OLD.project_id,OLD.user_id,COALESCE((SELECT name FROM users WHERE id=OLD.user_id),OLD.user_id),(CAST(strftime('%s', 'now') AS INTEGER) * 1000 + CAST(substr(strftime('%f', 'now'), 4, 3) AS INTEGER)),0);
END;
