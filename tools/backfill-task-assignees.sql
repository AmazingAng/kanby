INSERT INTO task_assignees (project_id, task_id, user_id, position, created_at)
SELECT tasks.project_id, tasks.id, tasks.owner_id, 0, tasks.created_at
FROM tasks
WHERE NOT EXISTS (
  SELECT 1 FROM task_assignees
  WHERE task_assignees.task_id = tasks.id
    AND task_assignees.project_id = tasks.project_id
)
ON CONFLICT(task_id, user_id) DO NOTHING;
