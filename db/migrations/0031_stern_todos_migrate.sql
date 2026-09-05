-- Preserve legacy rows; import each once even if its audited creation is later undone.
WITH legacy AS (
  SELECT *, CASE WHEN due GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*'
    AND julianday(due) IS NOT NULL
    AND date(substr(due,1,10),'+0 days') = substr(due,1,10)
    THEN due ELSE '' END AS safe_due
  FROM todos
)
INSERT INTO stern_tasks (title, domain, due_at, status, source, dedupe_key, created_at, notes)
SELECT t.text, 'professional', t.safe_due, CASE WHEN t.done=1 THEN 'done' ELSE 'open' END,
       'seed', 'legacy-todo:' || t.id, t.created_at,
       CASE WHEN t.safe_due='' AND COALESCE(t.due,'')<>'' THEN 'Legacy due: ' || t.due ELSE '' END
FROM legacy t
WHERE NOT EXISTS (SELECT 1 FROM stern_tasks s WHERE s.dedupe_key='legacy-todo:' || t.id)
  AND NOT EXISTS (SELECT 1 FROM stern_audit_log a WHERE a.batch_id='legacy-todo:' || t.id AND a.action='create');
INSERT INTO stern_audit_log (entity_type, entity_id, action, after_value, source, batch_id)
SELECT 'task', id, 'create', json_object('id',id,'title',title,'domain',domain,'due_at',due_at,
       'status',status,'source',source,'dedupe_key',dedupe_key,'created_at',created_at,'notes',notes), 'seed', dedupe_key
FROM stern_tasks t WHERE dedupe_key LIKE 'legacy-todo:%'
  AND NOT EXISTS (SELECT 1 FROM stern_audit_log a WHERE a.batch_id=t.dedupe_key AND a.action='create');
