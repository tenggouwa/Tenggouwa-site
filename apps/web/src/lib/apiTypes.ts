// Convenience re-exports of generated OpenAPI types. Import these instead of
// reaching into `@tenggouwa/api-types` directly so backend-schema imports
// share a single hop.

import type { components, paths } from '@tenggouwa/api-types';

export type Paths = paths;
export type Schemas = components['schemas'];
