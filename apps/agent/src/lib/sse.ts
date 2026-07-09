// 解析一个 SSE 帧（\n\n 分隔的一段），拿出 event 名与拼接后的 data。
// data 可能跨多行（多个 data: 行），按 SSE 规范拼接；无 event: 行默认 'message'。
export function parseSSEFrame(raw: string): { event: string; data: string } {
  let event = 'message';
  let data = '';
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data += line.slice(5).trim();
  }
  return { event, data };
}
