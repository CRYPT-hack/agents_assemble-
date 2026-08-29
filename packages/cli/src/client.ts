export const DEFAULT_PORT = 4319;

export class DaemonError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'DaemonError';
  }
}

/**
 * A thin client for the running daemon.
 *
 * Commands prefer it over touching the database directly: the daemon owns the
 * agent processes, so anything that starts, stops, or talks to a member has to
 * go through it. Read-only commands fall back to the database when it is down.
 */
export class DaemonClient {
  constructor(readonly base: string) {}

  static at(port = DEFAULT_PORT, host = '127.0.0.1'): DaemonClient {
    return new DaemonClient(`http://${host}:${port}`);
  }

  /** Is a daemon answering on this address? */
  async alive(timeoutMs = 400): Promise<boolean> {
    try {
      const response = await fetch(`${this.base}/api/health`, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.base}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    });

    const text = await response.text();
    const payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};

    if (!response.ok) {
      const error = payload['error'] as { message?: string; code?: string } | undefined;
      throw new DaemonError(
        error?.message ?? `Request failed with ${response.status}`,
        error?.code ?? 'unknown',
        response.status,
      );
    }

    return payload as T;
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>(path);
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'POST',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  patch<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
  }

  del<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'DELETE' });
  }
}
