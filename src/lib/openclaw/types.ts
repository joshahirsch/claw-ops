/**
 * Normalized OpenClaw session/message types.
 * Maps to the adapter shape agreed upon with the user.
 */

export interface OpenClawMessage {
  id: string;
  parentId: string | null;
  type: 'message' | 'custom_message' | 'custom' | 'compaction' | 'branch_summary' | 'session_header';
  role: 'user' | 'assistant' | 'toolResult';
  content: string | Record<string, unknown>;
  timestamp: string; // ISO datetime
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: string;
}

export interface OpenClawTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  contextTokens: number;
}

export type SessionPhase = 'idle' | 'running' | 'waiting';

export interface OpenClawSessionStatus {
  phase: SessionPhase;
  tokenUsage: OpenClawTokenUsage;
}

export interface OpenClawSession {
  sessionKey: string;
  sessionId: string;
  updatedAt: string; // ISO datetime
  messages: OpenClawMessage[];
  status: OpenClawSessionStatus;
}

/** Raw JSONL transcript entry shapes */
export interface RawTranscriptEntry {
  type: string;
  [key: string]: unknown;
}

/** Gateway log entry */
export interface GatewayLogEntry {
  timestamp: string;
  level: string;
  message: string;
  [key: string]: unknown;
}
