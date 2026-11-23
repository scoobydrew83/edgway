# decK sample configs (the compatibility corpus)

These files are Kong's own decK integration test data, [Kong/deck](https://github.com/Kong/deck) `tests/integration/testdata/sync/` at `v1.49.2` (`933b11b311da6750bd5dce455fc0febace83d68f`), Apache-2.0 (see `LICENSE`). They are unchanged, and keep their directory names.

Only the Kong 3.x OSS cases are included. Files are left out when they use Enterprise- or Konnect-only features: the `rate-limiting-advanced` plugin (including its consumer-group policy overrides), `custom_entities`/`degraphql`, and the Kong 2.x (`kong.yaml`) and `konnect.yaml` variants. `038-skip-consumers-with-cgs/consumers.yaml` is left out too: it only syncs on top of its case's `base.yaml`, which uses `rate-limiting-advanced`. OSS plugins Edgway doesn't bundle (for example `prometheus`) stay in, and count as failures.

`tools/kong-compat-e2e.sh` syncs each file into an empty admin with `deck gateway sync`, then runs `deck gateway diff`: an entity counts as synced when the diff no longer creates or updates it. A file that looks up entities by tag (`default_lookup_tags`) is synced on top of a sibling file from its case, as decK's own tests do. The acceptance bar is more than 90% of all entities.
