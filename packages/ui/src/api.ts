import type { Agent, Lease, Member, Message, Task } from './types';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const message = payload?.error?.message ?? `Request failed with ${response.status}`;
    throw new Error(message);
  }
  return payload as T;
}

export const api = {
  members: () => request<{ members: Member[] }>('/api/members'),
  agents: () => request<{ agents: Agent[] }>('/api/agents'),
  messages: (limit = 100) => request<{ messages: Message[] }>(`/api/messages?limit=${limit}`),
  tasks: () => request<{ tasks: Task[]; counts: Record<string, number> }>('/api/tasks'),
  leases: () => request<{ leases: Lease[] }>('/api/leases'),

  enlist: (body: { agentId: string; mission: string; start: boolean }) =>
    request<{ member: Member; started: boolean }>('/api/members', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  start: (handle: string) =>
    request<{ member: Member }>(`/api/members/${encodeURIComponent(handle)}/start`, { method: 'POST' }),

  stop: (handle: string) =>
    request<{ member: Member }>(`/api/members/${encodeURIComponent(handle)}/stop`, { method: 'POST' }),

  discharge: (handle: string) =>
    request<{ ok: boolean }>(`/api/members/${encodeURIComponent(handle)}?force=true`, {
      method: 'DELETE',
    }),

  diff: (handle: string) =>
    request<{ branch: string; status: { dirty: string[]; ahead: number; behind: number }; changed: string[] }>(
      `/api/members/${encodeURIComponent(handle)}/diff`,
    ),

  send: (body: { from?: string; to?: string[]; subject: string; body: string }) =>
    request<{ message: Message }>('/api/messages', { method: 'POST', body: JSON.stringify(body) }),

  createTask: (body: { title: string; body?: string; assignee?: string }) =>
    request<{ task: Task }>('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ ...body, createdBy: 'workspace' }),
    }),

  moveTask: (id: string, status: string) =>
    request<{ task: Task }>(`/api/tasks/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ actor: 'workspace', status }),
    }),
};
