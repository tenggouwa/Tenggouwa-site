import { describe, expect, it } from 'vitest';
import { parseSSEFrame } from './sse';

describe('parseSSEFrame', () => {
  it('解析 event + data', () => {
    expect(parseSSEFrame('event: token\ndata: {"delta":"hi"}')).toEqual({
      event: 'token',
      data: '{"delta":"hi"}',
    });
  });

  it('无 event 行默认 message', () => {
    expect(parseSSEFrame('data: {"a":1}')).toEqual({ event: 'message', data: '{"a":1}' });
  });

  it('多个 data 行按 SSE 规范拼接', () => {
    expect(parseSSEFrame('event: x\ndata: ab\ndata: cd').data).toBe('abcd');
  });

  it('忽略非 event/data 行（如注释、空行）', () => {
    expect(parseSSEFrame(': ping\ndata: ok\n')).toEqual({ event: 'message', data: 'ok' });
  });

  it('空帧 → 空 data', () => {
    expect(parseSSEFrame('').data).toBe('');
  });
});
