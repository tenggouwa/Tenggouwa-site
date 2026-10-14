import { modelPaths } from './model';
import { performancePaths } from './performance';
import { enginePaths } from './engine';
import { gpuPaths } from './gpu';
import { distributedPaths } from './distributed';
import { projectPaths } from './project';
import type { TeachingPath } from './types';
export const teachingPaths: Record<string, TeachingPath> = {
  ...modelPaths,
  ...performancePaths,
  ...enginePaths,
  ...gpuPaths,
  ...distributedPaths,
  ...projectPaths,
};
// Each formal warmup can return to the precise prerequisite explanation.
export const quizStep: Record<string, number> = {
  tensor: 6,
  attention: 8,
  'kv-cache': 4,
  metrics: 1,
  roofline: 2,
  profiling: 1,
  'request-path': 2,
  scheduling: 3,
  'paged-kv': 1,
  'gpu-memory': 5,
  softmax: 2,
  'attention-kernels': 4,
  parallel: 3,
  moe: 4,
  speculation: 4,
  hypothesis: 4,
  patch: 2,
  capstone: 3,
};
