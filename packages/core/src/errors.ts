/**
 * Errors that cross a boundary — REST, WebSocket, MCP — carry a machine code so
 * the caller can branch without string matching, and a message an agent can
 * read and act on.
 */
export type ErrorCode =
  | 'not_found'
  | 'conflict'
  | 'invalid'
  | 'unknown_agent'
  | 'unknown_member'
  | 'lease_conflict'
  | 'git_failed'
  | 'spawn_failed'
  | 'not_running';

export class AssembleError extends Error {
  readonly code: ErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'AssembleError';
    this.code = code;
    this.details = details;
  }

  toJSON(): { error: { code: ErrorCode; message: string; details: Record<string, unknown> } } {
    return { error: { code: this.code, message: this.message, details: this.details } };
  }
}

export const notFound = (what: string, id: string): AssembleError =>
  new AssembleError('not_found', `No ${what} with id ${id}`, { id });

export const invalid = (message: string, details?: Record<string, unknown>): AssembleError =>
  new AssembleError('invalid', message, details);

export const conflict = (message: string, details?: Record<string, unknown>): AssembleError =>
  new AssembleError('conflict', message, details);
