# Health

The Health module of Hearthlog: features `bmi, calories, activities` (see `hearthlog.module.json`). It is installed by listing it in a site's `modules.lock.json` (`hearthlog lock`) and `package.json`.

## Status

It installs against `@hearthlog/sdk` >=0.1.0 <0.2.0.

```bash
pnpm install
pnpm test   # generates a site that enables this module, installs it, builds it, then runs the unit tests
```

Release: set `version` in `package.json`, commit, and push the tag `v<version>`; the release workflow publishes with provenance after approval.
