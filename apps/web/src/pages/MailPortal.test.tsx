// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import MailPortal from './MailPortal';

const fetchMock = vi.fn();
const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => ({ code: 0, data }) });
const denied = () => ({ ok: false, status: 401, json: async () => ({ detail: '请使用访问密码登录' }) });
const inboxes = [{ mailbox: 'demo', total: 1, with_code: 1, latest_at: '2026-10-15T00:00:00Z' }];
const messages = [{ id: 1, subject: 'Example code', code: '123456', from_address: 'test@example.com', received_at: '2026-10-15T00:00:00Z' }];

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('password login reveals shared inboxes and logout clears mail', async () => {
  fetchMock.mockResolvedValueOnce(denied()).mockResolvedValueOnce(ok(true)).mockResolvedValueOnce(ok(inboxes)).mockResolvedValueOnce(ok(messages)).mockResolvedValueOnce(ok(true));
  render(<MailPortal />);
  expect((screen.getByLabelText('访问密码') as HTMLInputElement).disabled).toBe(true);
  await waitFor(() => expect((screen.getByLabelText('访问密码') as HTMLInputElement).disabled).toBe(false));
  fireEvent.change(screen.getByLabelText('访问密码'), { target: { value: 'test-secret' } });
  fireEvent.click(screen.getByRole('button', { name: '登录' }));
  fireEvent.click(await screen.findByRole('button', { name: /demo@tenggouwa.com/ }));
  await screen.findByText('Example code');
  expect(fetchMock.mock.calls[1][1].body).toBe(JSON.stringify({ password: 'test-secret' }));
  expect(fetchMock.mock.calls[1][1].headers['X-Mail-Portal']).toBe('1');
  expect(fetchMock.mock.calls[1][1].headers['Content-Type']).toBe('application/json');
  fireEvent.click(screen.getByRole('button', { name: '退出登录' }));
  await screen.findByLabelText('访问密码');
  expect(screen.queryByText('Example code')).toBeNull();
  expect(screen.queryByText('123456')).toBeNull();
});

it('expired session clears all previously displayed codes', async () => {
  fetchMock.mockResolvedValueOnce(ok(inboxes)).mockResolvedValueOnce(ok(messages)).mockResolvedValueOnce(denied());
  render(<MailPortal />);
  fireEvent.click(await screen.findByRole('button', { name: /demo@tenggouwa.com/ }));
  await screen.findByText('Example code');
  fireEvent.click(screen.getByRole('button', { name: '刷新收件箱' }));
  await screen.findByLabelText('访问密码');
  expect(screen.queryByText('123456')).toBeNull();
});

it('waiting can be cancelled without leaving the interface locked', async () => {
  fetchMock.mockResolvedValueOnce(ok(inboxes)).mockResolvedValueOnce(ok(messages));
  fetchMock.mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  }));
  render(<MailPortal />);
  fireEvent.click(await screen.findByRole('button', { name: /demo@tenggouwa.com/ }));
  await screen.findByText('Example code');
  fireEvent.click(screen.getByRole('button', { name: '等新码 · 25s' }));
  expect(fetchMock.mock.calls[2][0]).toContain('/latest-code?wait=25&since=');
  fireEvent.click(screen.getByRole('button', { name: '取消等待' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: '取消等待' })).toBeNull());
  expect((screen.getByRole('button', { name: '等新码 · 25s' }) as HTMLButtonElement).disabled).toBe(false);
});
