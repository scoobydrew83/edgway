-- An earlier change labelled portal developers by writing their IdP email or name
-- into the consumer's Kong `username`, which decK, Terraform and plugins
-- match on. Move those labels to `display_name` and clear the username, for
-- consumers the portal made (a `portal_subject`) only, and only when the
-- portal itself set the current username: the newest audit event that
-- changed it was the developer's own (`oidc:<subject>`, as the portal
-- Worker acts). A username an admin gave or changed, or one with no audit
-- event, is kept.
UPDATE consumers
SET display_name = username, username = NULL
WHERE portal_subject IS NOT NULL
  AND username IS NOT NULL
  AND display_name IS NULL
  AND (
    SELECT a.actor
    FROM audit_events a
    WHERE a.workspace_id = consumers.workspace_id
      AND a.entity_type = 'consumers'
      AND a.entity_id = consumers.id
      AND EXISTS (
        SELECT 1 FROM json_each(a.diff) e
        WHERE json_extract(e.value, '$.path') = json_array('username')
      )
    ORDER BY a.id DESC
    LIMIT 1
  ) = 'oidc:' || consumers.portal_subject;
