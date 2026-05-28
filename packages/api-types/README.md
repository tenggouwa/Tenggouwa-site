# @tenggouwa/api-types

TypeScript types generated from the FastAPI backend's OpenAPI schema.

## Regenerate

From the repo root:

```bash
pnpm gen:api-types
```

The script imports `apps/server` and calls `main_app.openapi()` (no server
boot, no DB connection), then runs `openapi-typescript` against the resulting
schema. Re-run it whenever a backend endpoint or pydantic model changes, then
commit the updated `src/openapi.ts`.

## Usage

```ts
import type { components, paths } from '@tenggouwa/api-types';

type PostDetail = components['schemas']['PostDetail'];
type GetPostsResponse =
  paths['/api/public/posts']['get']['responses']['200']['content']['application/json'];
```
