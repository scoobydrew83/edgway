-- audit events written before an earlier release hold raw jwt secrets in their
-- diffs. Redact them as the admin writes diffs now (@edgway/admin-core
-- secrets.ts; the placeholders are @edgway/constants ADMIN_DIFF): a raw
-- `secret` value becomes REDACTED, or REDACTED:changed for the new value of
-- a change. Vault references, nulls and already-redacted values are kept.
UPDATE audit_events
SET diff = (
  SELECT json_group_array(json(
    CASE
      WHEN json_extract(e.value, '$.path') <> json_array('secret') THEN e.value
      ELSE (
        SELECT CASE
          WHEN json_type(v.entry, '$.oldValue') = 'text'
            AND json_extract(v.entry, '$.oldValue') NOT LIKE '{vault://%}'
            AND json_extract(v.entry, '$.oldValue') NOT IN ('REDACTED', 'REDACTED:changed')
          THEN json_set(v.entry, '$.oldValue', 'REDACTED')
          ELSE v.entry
        END
        FROM (
          SELECT CASE
            WHEN json_type(e.value, '$.value') = 'text'
              AND json_extract(e.value, '$.value') NOT LIKE '{vault://%}'
              AND json_extract(e.value, '$.value') NOT IN ('REDACTED', 'REDACTED:changed')
            THEN json_set(
              e.value,
              '$.value',
              CASE json_extract(e.value, '$.type')
                WHEN 'CHANGE' THEN 'REDACTED:changed'
                ELSE 'REDACTED'
              END
            )
            ELSE e.value
          END AS entry
        ) AS v
      )
    END
  ))
  FROM json_each(audit_events.diff) AS e
)
WHERE entity_type = 'jwt_secrets'
  AND diff IS NOT NULL
  AND json_type(diff) = 'array';
