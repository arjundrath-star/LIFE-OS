-- Preserve legacy rows; import each once even if its audited creation is later undone.
INSERT INTO stern_tasks (title, domain, due_at, status, source, dedupe_key, created_at)
SELECT t.text, 'professional', COALESCE(t.due,''), CASE WHEN t.done=1 THEN 'done' ELSE 'open' END,
       'seed', 'legacy-todo:' || t.id, t.created_at
FROM todos t
WHERE NOT EXISTS (SELECT 1 FROM stern_tasks s WHERE s.dedupe_key='legacy-todo:' || t.id)
  AND NOT EXISTS (SELECT 1 FROM stern_audit_log a WHERE a.batch_id='legacy-todo:' || t.id AND a.action='create');
INSERT INTO stern_audit_log (entity_type, entity_id, action, after_value, source, batch_id)
SELECT 'task', id, 'create', json_object('id',id,'title',title,'domain',domain,'due_at',due_at,
       'status',status,'source',source,'dedupe_key',dedupe_key,'created_at',created_at), 'seed', dedupe_key
FROM stern_tasks t WHERE dedupe_key LIKE 'legacy-todo:%'
  AND NOT EXISTS (SELECT 1 FROM stern_audit_log a WHERE a.batch_id=t.dedupe_key AND a.action='create');
