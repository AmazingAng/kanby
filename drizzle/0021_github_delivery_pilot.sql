CREATE TABLE github_task_links_next (
  task_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  repository_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  item_number INTEGER NOT NULL,
  branch TEXT,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  state TEXT NOT NULL,
  ci_status TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (task_id, repository_id, kind, item_number)
);
--> statement-breakpoint
INSERT INTO github_task_links_next SELECT * FROM github_task_links;
--> statement-breakpoint
INSERT OR IGNORE INTO github_task_links_next
SELECT i.task_id, i.project_id, i.repository_id, 'issue', i.item_number, NULL,
       r.html_url || '/issues/' || i.item_number, COALESCE(e.title, t.title),
       CASE WHEN e.action = 'closed' THEN 'closed' ELSE 'open' END,
       NULL, COALESCE(e.created_at, i.created_at)
FROM github_issue_imports i
JOIN tasks t ON t.id = i.task_id AND t.project_id = i.project_id
JOIN github_repositories r ON r.id = i.repository_id
LEFT JOIN github_events e ON e.id = (
  SELECT candidate.id FROM github_events candidate
  WHERE candidate.project_id = i.project_id AND candidate.repository_id = i.repository_id
    AND candidate.kind = 'issues' AND candidate.item_number = i.item_number
  ORDER BY candidate.created_at DESC, candidate.id DESC LIMIT 1
);
--> statement-breakpoint
DROP TABLE github_task_links;
--> statement-breakpoint
ALTER TABLE github_task_links_next RENAME TO github_task_links;
--> statement-breakpoint
CREATE INDEX idx_github_task_links_project ON github_task_links (project_id, updated_at);
--> statement-breakpoint
CREATE INDEX idx_github_task_links_item ON github_task_links (repository_id, kind, item_number);
--> statement-breakpoint
CREATE TABLE github_delivery_repositories (
  project_id TEXT PRIMARY KEY NOT NULL,
  repository_id TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE github_delivery_default_merges (
  repository_id TEXT NOT NULL,
  item_number INTEGER NOT NULL,
  merged_at INTEGER NOT NULL,
  PRIMARY KEY (repository_id, item_number)
);
