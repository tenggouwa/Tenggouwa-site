import { lessons } from '../data/course';
export interface RecordEntry {
  read: boolean;
  quiz: boolean;
  checks: boolean[];
  notes: string;
  updated: string;
}
export interface Progress {
  version: 1;
  lastLesson: string;
  records: Record<string, RecordEntry>;
}
export const STORAGE_KEY = 'inference-lab-progress-v1';
export const blankEntry = (): RecordEntry => ({
  read: false,
  quiz: false,
  checks: [],
  notes: '',
  updated: '',
});
export const blankProgress = (): Progress => ({
  version: 1,
  lastLesson: lessons[0].id,
  records: {},
});
export function complete(id: string, p: Progress) {
  const lesson = lessons.find((l) => l.id === id),
    r = p.records[id];
  return (
    !!lesson &&
    !!r &&
    r.read &&
    r.quiz &&
    lesson.acceptance.every((_, i) => r.checks[i])
  );
}
export function validateProgress(value: unknown): Progress {
  if (!value || typeof value !== 'object')
    throw new Error('不是有效的学习备份。');
  const p = value as Partial<Progress>;
  if (
    p.version !== 1 ||
    !p.records ||
    typeof p.records !== 'object' ||
    Array.isArray(p.records)
  )
    throw new Error('备份版本或记录格式不兼容。');
  const clean = blankProgress();
  if (
    typeof p.lastLesson === 'string' &&
    lessons.some((l) => l.id === p.lastLesson)
  )
    clean.lastLesson = p.lastLesson;
  for (const lesson of lessons) {
    if (!Object.prototype.hasOwnProperty.call(p.records, lesson.id)) continue;
    const r = p.records[lesson.id];
    if (
      !r ||
      typeof r !== 'object' ||
      typeof r.read !== 'boolean' ||
      typeof r.quiz !== 'boolean' ||
      typeof r.notes !== 'string' ||
      r.notes.length > 100000 ||
      !Array.isArray(r.checks) ||
      r.checks.some((c) => c !== null && typeof c !== 'boolean') ||
      typeof r.updated !== 'string'
    )
      throw new Error(`课程 ${lesson.id} 的记录格式错误。`);
    clean.records[lesson.id] = {
      read: r.read,
      quiz: r.quiz,
      notes: r.notes,
      // Older builds serialized unchecked array holes as null. Recover as false.
      checks: lesson.acceptance.map((_, i) => r.checks[i] === true),
      updated: r.updated,
    };
  }
  return clean;
}
export function loadProgress(): { progress: Progress; warning: string } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return {
      progress: raw ? validateProgress(JSON.parse(raw)) : blankProgress(),
      warning: '',
    };
  } catch {
    return {
      progress: blankProgress(),
      warning:
        '本地存储不可用或历史记录无法读取。请导出备份；本次不会自动覆盖原记录。',
    };
  }
}
export function mergeProgress(current: Progress, incoming: Progress): Progress {
  const result: Progress = {
    version: 1,
    lastLesson: incoming.lastLesson,
    records: { ...current.records },
  };
  for (const [id, next] of Object.entries(incoming.records)) {
    const prev = result.records[id];
    if (!prev) {
      result.records[id] = next;
      continue;
    }
    // Import is additive: keep both notes and every acknowledged milestone.
    const notes =
      !next.notes || prev.notes.includes(next.notes)
        ? prev.notes
        : !prev.notes
          ? next.notes
          : `${prev.notes}\n\n--- 导入的笔记 ---\n${next.notes}`;
    if (notes.length > 100000)
      throw new Error('合并后的笔记过长；请先分开保存为 Markdown。');
    result.records[id] = {
      read: prev.read || next.read,
      quiz: prev.quiz || next.quiz,
      checks: Array.from(
        { length: Math.max(prev.checks.length, next.checks.length) },
        (_, i) => !!prev.checks[i] || !!next.checks[i],
      ),
      notes,
      updated: new Date().toISOString(),
    };
  }
  return result;
}
export function downloadFile(
  name: string,
  data: string,
  type = 'text/plain;charset=utf-8',
) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Rebase edits on the latest stored snapshot, instead of replacing other tabs' work.
 * Unchanged fields follow remote state; deliberate local changes win. Conflicting
 * note edits keep both texts rather than silently discarding either version.
 */
export function reconcileProgress(
  base: Progress,
  local: Progress,
  remote: Progress,
): Progress {
  const result: Progress = {
    version: 1,
    lastLesson: local.lastLesson,
    records: {},
  };
  for (const lesson of lessons) {
    const id = lesson.id;
    if (!local.records[id] && !remote.records[id]) continue;
    const before = base.records[id] || blankEntry();
    const ours = local.records[id] || blankEntry();
    const theirs = remote.records[id] || blankEntry();
    const noteChanged = ours.notes !== before.notes;
    let notes = noteChanged ? ours.notes : theirs.notes;
    if (
      noteChanged &&
      theirs.notes !== before.notes &&
      theirs.notes !== ours.notes &&
      theirs.notes &&
      !ours.notes.includes(theirs.notes)
    ) {
      notes = ours.notes
        ? `${ours.notes}\n\n--- 另一页面的笔记（请核对合并） ---\n${theirs.notes}`
        : theirs.notes;
    }
    if (notes.length > 100000)
      throw new Error('多页面合并的笔记过长，请先导出。');
    const choose = (key: 'read' | 'quiz') =>
      ours[key] !== before[key] ? ours[key] : theirs[key];
    const checks = lesson.acceptance.map((_, i) =>
      !!ours.checks[i] !== !!before.checks[i]
        ? !!ours.checks[i]
        : !!theirs.checks[i],
    );
    result.records[id] = {
      read: choose('read'),
      quiz: choose('quiz'),
      checks,
      notes,
      updated:
        JSON.stringify(ours) !== JSON.stringify(before)
          ? ours.updated
          : theirs.updated,
    };
  }
  return result;
}
