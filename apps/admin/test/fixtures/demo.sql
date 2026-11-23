-- examples/deck/demo.yaml as staged admin rows (the default workspace), for
-- the decK round trip in tools/kong-compat-e2e.sh. Unlisted columns take
-- their Kong defaults from the migrations.
INSERT INTO services (id, workspace_id, name, protocol, host, port, path) VALUES
  ('0199a3c0-0000-7000-8000-00000000d001', '00000000-0000-7000-8000-000000000000', 'httpbin-anything', 'https', 'httpbin.org', 443, '/anything'),
  ('0199a3c0-0000-7000-8000-00000000d002', '00000000-0000-7000-8000-000000000000', 'httpbin-ip', 'https', 'httpbin.org', 443, '/ip');

INSERT INTO routes (id, workspace_id, name, service_id, paths, methods, strip_path) VALUES
  ('0199a3c0-0000-7000-8000-00000000d011', '00000000-0000-7000-8000-000000000000', 'httpbin-get', '0199a3c0-0000-7000-8000-00000000d001', '["/demo/httpbin"]', '["GET","POST"]', 1),
  ('0199a3c0-0000-7000-8000-00000000d012', '00000000-0000-7000-8000-000000000000', 'public-ip', '0199a3c0-0000-7000-8000-00000000d002', '["/demo/ip"]', '["GET"]', 1);

INSERT INTO plugins (id, workspace_id, name, route_id, config) VALUES
  ('0199a3c0-0000-7000-8000-00000000d021', '00000000-0000-7000-8000-000000000000', 'key-auth', '0199a3c0-0000-7000-8000-00000000d011', '{"key_names":["X-Api-Key"],"hide_credentials":true}'),
  ('0199a3c0-0000-7000-8000-00000000d022', '00000000-0000-7000-8000-000000000000', 'rate-limiting', '0199a3c0-0000-7000-8000-00000000d011', '{"minute":30,"limit_by":"ip","policy":"local"}'),
  ('0199a3c0-0000-7000-8000-00000000d023', '00000000-0000-7000-8000-000000000000', 'proxy-cache', '0199a3c0-0000-7000-8000-00000000d011', '{"strategy":"memory","cache_ttl":30}'),
  ('0199a3c0-0000-7000-8000-00000000d024', '00000000-0000-7000-8000-000000000000', 'rate-limiting', '0199a3c0-0000-7000-8000-00000000d012', '{"minute":60,"limit_by":"ip","policy":"local"}'),
  ('0199a3c0-0000-7000-8000-00000000d025', '00000000-0000-7000-8000-000000000000', 'proxy-cache', '0199a3c0-0000-7000-8000-00000000d012', '{"strategy":"memory","cache_ttl":10}');

INSERT INTO consumers (id, workspace_id, username) VALUES
  ('0199a3c0-0000-7000-8000-00000000d031', '00000000-0000-7000-8000-000000000000', 'dev-seed');
