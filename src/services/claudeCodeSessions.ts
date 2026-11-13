// Service & State Management for Claude Code Sessions (Real Data Only)
import { terminal } from "./ipc";

export interface ClaudeToolCall {
  type: "bash" | "file" | "search";
  title: string;
  command?: string;
  output?: string;
}

export interface ClaudeSessionMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  thinking?: string;
  summary?: string;
  toolCalls?: ClaudeToolCall[];
  statusNotice?: string;
  metaNotices?: string[];
  time?: string;
}

export interface ClaudeSession {
  id: string;
  title: string;
  group: string; // e.g. "Ungrouped", "Workspace", "Salivo Project"
  isLocal: boolean;
  timeAgo: string;
  createdAt: number;
  messages: ClaudeSessionMessage[];
}

export interface RealClaudeAccount {
  email?: string;
  subscriptionType?: string;
  orgName?: string;
}

const STORAGE_KEY = "csotic.claude_code.sessions_v3";
const ACTIVE_SESSION_KEY = "csotic.claude_code.active_session_id";
const AUTH_KEY = "csotic.claude_code.authenticated";

export function isClaudeAuthenticated(): boolean {
  return localStorage.getItem(AUTH_KEY) === "true";
}

export function setClaudeAuthenticated(val: boolean): void {
  if (val) {
    localStorage.setItem(AUTH_KEY, "true");
  } else {
    localStorage.removeItem(AUTH_KEY);
  }
  window.dispatchEvent(new CustomEvent("csotic:claude-auth-changed", { detail: { authenticated: val } }));
}

// Absolute zero fake data: returns saved sessions or scanned system sessions
export function getStoredSessions(): ClaudeSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    return [];
  } catch {
    return [];
  }
}

export function saveStoredSessions(sessions: ClaudeSession[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
    window.dispatchEvent(new CustomEvent("csotic:claude-sessions-changed", { detail: { sessions } }));
  } catch (err) {
    console.warn("Failed to persist Claude Code sessions:", err);
  }
}

export function getActiveSessionId(): string {
  return localStorage.getItem(ACTIVE_SESSION_KEY) || "";
}

export function setActiveSessionId(id: string): void {
  localStorage.setItem(ACTIVE_SESSION_KEY, id);
  window.dispatchEvent(new CustomEvent("csotic:claude-active-session-changed", { detail: { id } }));
}

export function getSessionById(id: string): ClaudeSession | undefined {
  const sessions = getStoredSessions();
  return sessions.find((s) => s.id === id);
}

export function createNewSession(title?: string, isLocal: boolean = true, group: string = "Ungrouped"): ClaudeSession {
  const sessions = getStoredSessions();
  const id = `session-${Date.now()}`;
  const newSession: ClaudeSession = {
    id,
    title: title || `Session ${sessions.length + 1}`,
    group,
    isLocal,
    timeAgo: "Just now",
    createdAt: Date.now(),
    messages: [],
  };

  const updated = [newSession, ...sessions];
  saveStoredSessions(updated);
  setActiveSessionId(id);
  return newSession;
}

export function updateSession(updatedSession: ClaudeSession): void {
  const sessions = getStoredSessions();
  const index = sessions.findIndex((s) => s.id === updatedSession.id);
  if (index >= 0) {
    sessions[index] = updatedSession;
  } else {
    sessions.unshift(updatedSession);
  }
  saveStoredSessions([...sessions]);
}

export function deleteSession(id: string): void {
  const sessions = getStoredSessions().filter((s) => s.id !== id);
  saveStoredSessions(sessions);
  const currentActive = getActiveSessionId();
  if (currentActive === id) {
    setActiveSessionId(sessions[0]?.id || "");
  }
}

export function openSessionTab(session: ClaudeSession): void {
  setActiveSessionId(session.id);
  window.dispatchEvent(new CustomEvent("csotic:open-claude-session", { detail: { session } }));
}

/**
 * Real-time System Scanner
 * Communicates with the local machine to load 100% authentic Claude Code
 * sessions and credentials directly from ~/.claude/
 */
export async function syncRealClaudeData(): Promise<{
  authenticated: boolean;
  account: RealClaudeAccount;
  sessions: ClaudeSession[];
}> {
  try {
    const res: any = await terminal.executeCommand(".", "node scripts/claude_scanner.cjs", true);
    const rawOut = (res?.data?.stdout || res?.data?.output || "").trim();
    if (!rawOut) {
      return {
        authenticated: isClaudeAuthenticated(),
        account: {},
        sessions: getStoredSessions(),
      };
    }

    // Find JSON boundary in output
    const jsonStart = rawOut.indexOf("{");
    const jsonEnd = rawOut.lastIndexOf("}");
    if (jsonStart < 0 || jsonEnd < 0) {
      return {
        authenticated: isClaudeAuthenticated(),
        account: {},
        sessions: getStoredSessions(),
      };
    }

    const jsonStr = rawOut.substring(jsonStart, jsonEnd + 1);
    const parsed = JSON.parse(jsonStr);

    const isAuth = Boolean(parsed.authenticated);
    if (isAuth) {
      setClaudeAuthenticated(true);
    }

    if (Array.isArray(parsed.sessions) && parsed.sessions.length > 0) {
      // Merge with any custom local sessions created in Csotic
      const currentStored = getStoredSessions();
      const customOnly = currentStored.filter((s) => !parsed.sessions.some((p: any) => p.id === s.id));
      const merged = [...parsed.sessions, ...customOnly];
      saveStoredSessions(merged);
      return {
        authenticated: isAuth,
        account: parsed.account || {},
        sessions: merged,
      };
    }

    return {
      authenticated: isAuth,
      account: parsed.account || {},
      sessions: getStoredSessions(),
    };
  } catch (err) {
    console.warn("syncRealClaudeData failed:", err);
    return {
      authenticated: isClaudeAuthenticated(),
      account: {},
      sessions: getStoredSessions(),
    };
  }
}
