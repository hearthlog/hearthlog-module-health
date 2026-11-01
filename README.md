# Health

The Health module of Hearthlog: features `bmi, calories, activities` (see `hearthlog.module.json`). It is installed by listing it in a site's `modules.lock.json` (`hearthlog lock`) and `package.json`.

## Status

It installs against `@hearthlog/sdk` >=0.1.0 <0.2.0.

```bash
pnpm install
pnpm test   # generates a site that enables this module, installs it, builds it, then runs the unit tests
```

Release: set `version` in `package.json`, commit, and push the tag `v<version>`; the release workflow publishes with provenance after approval.

## Food catalog

Nutrition search and barcode lookup use the kal food catalog Worker. Name it in the site's settings:

```json
"moduleSettings": { "org.stor.health": { "catalogWorker": "kal-api" } }
```

The site binds that Worker as `KAL` and Health serves it at `/api/food-catalog`, behind the site's Cloudflare Access login, so the catalog Worker needs no public hostname. Without the setting the route answers 503 and catalog search is off. For local development, point `VITE_KAL_API_BASE_URL` at `wrangler dev` (`http://localhost:8787`).
