# decK fixtures

Kong declarative config files (decK `_format_version: "3.0"`). `packages/schema/test/deck.test.ts` validates each one against the vendored decK file schema and every plugin's config against `kongSchema()`.

| File | Source |
| --- | --- |
| `demo.yaml` | Edgway's demo routes (the scaffold seed data), written for Edgway |
| `kong/same-names-altered-ids.yaml` | [Kong/go-database-reconciler](https://github.com/Kong/go-database-reconciler) `tests/integration/testdata/sync/020-same-names-altered-ids/desired.yaml` @ `04b4e6a01d4a182cc432406d708f8c3220b9125e` (Apache-2.0), unchanged |
| `kong/plugins-nested-foreign-keys.yaml` | [Kong/go-database-reconciler](https://github.com/Kong/go-database-reconciler) `tests/integration/testdata/sync/040-plugins-nested-foreign-keys/kong3x-consumers-via-names.yaml` @ `04b4e6a01d4a182cc432406d708f8c3220b9125e` (Apache-2.0), unchanged |

Attribution for Kong/go-database-reconciler is in the repository `NOTICE`.
