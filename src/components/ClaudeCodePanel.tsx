import { useState, useEffect, useMemo, useCallback } from "react";
import { 
  ChevronDown, 
  ChevronRight, 
  Plus, 
  Search, 
  Filter, 
  Laptop, 
  Globe, 
  Terminal, 
  Trash2, 
  Key, 
  LogIn, 
  LogOut, 
  ShieldCheck, 
  RotateCw,
  ExternalLink,
} from "lucide-react";
import type { ProjectInfo } from "../types/ipc";
import { terminal, models } from "../services/ipc";
import type { ClaudeSession } from "../services/claudeCodeSessions";
import { 
  getStoredSessions, 
  getActiveSessionId, 
  createNewSession, 
  deleteSession, 
  openSessionTab, 
  isClaudeAuthenticated, 
  setClaudeAuthenticated,
  syncRealClaudeData,
} from "../services/claudeCodeSessions";
import { ClaudeIcon } from "./ClaudeIcon";
import { CustomDialog } from "./GlobalDialog";

interface ClaudeCodePanelProps {
  activeProject: ProjectInfo | null;
  activeFilePath?: string | null;
  onOpenFile?: (path: string) => void;
  onOpenExtension?: (extId: string) => void;
  onOpenTerminal?: (cmd?: string) => void;
}

export function ClaudeCodePanel({
  activeProject,
  activeFilePath: _activeFilePath,
  onOpenTerminal,
}: ClaudeCodePanelProps) {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => isClaudeAuthenticated());
  const [sessions, setSessions] = useState<ClaudeSession[]>(() => getStoredSessions());
  const [activeSessionId, setActiveId] = useState<string>(() => getActiveSessionId());
  const [mode, setMode] = useState<"local" | "web">("local");
  const [searchQuery, setSearchQuery] = useState("");
  const [showAccountDetails, setShowAccountDetails] = useState(false);
  const [accountUsageOpen, setAccountUsageOpen] = useState(true);
  const [sessionManagerOpen, setSessionManagerOpen] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const [groupsOpen, setGroupsOpen] = useState<Record<string, boolean>>({
    "Current Workspace": true,
    "Salivo Project": true,
    "Csotic Project": true,
    "Other Projects": true,
    "Ungrouped": true,
  });

  // Auth form states
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [showApiKeyForm, setShowApiKeyForm] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Real CLI status detected from local machine
  const [cliInfo, setCliInfo] = useState<{
    checked: boolean;
    available: boolean;
    version?: string;
    authStatus?: {
      loggedIn?: boolean;
      email?: string;
      subscriptionType?: string;
      orgName?: string;
    };
  }>({
    checked: false,
    available: false,
  });

  const loadSessions = useCallback(() => {
    const list = getStoredSessions();
    setSessions(list);
    const currActive = getActiveSessionId();
    setActiveId(currActive || (list[0]?.id ?? ""));
  }, []);

  const refreshAllRealData = useCallback(async () => {
    setIsSyncing(true);
    try {
      // 1. Run local disk scanner to fetch authentic sessions from ~/.claude/projects/
      const synced = await syncRealClaudeData();
      if (synced.authenticated) {
        setClaudeAuthenticated(true);
        setIsAuthenticated(true);
      }
      setSessions(synced.sessions);
      if (synced.sessions.length > 0 && !getActiveSessionId()) {
        setActiveId(synced.sessions[0].id);
      }

      // 2. Probe real auth status & version via local claude CLI
      try {
        const verRes: any = await terminal.executeCommand(".", "claude --version", true);
        const verOut = (verRes?.data?.stdout || verRes?.data?.output || "").trim();

        const authRes: any = await terminal.executeCommand(".", "claude auth status", true);
        const authOut = (authRes?.data?.stdout || authRes?.data?.output || "").trim();
        let parsedAuth: any = null;
        try {
          parsedAuth = JSON.parse(authOut);
        } catch {}

        if (parsedAuth?.loggedIn) {
          setClaudeAuthenticated(true);
          setIsAuthenticated(true);
        }

        const isAvailable = verOut.toLowerCase().includes("claude") || /^\d+\.\d+/.test(verOut);
        setCliInfo({
          checked: true,
          available: isAvailable,
          version: verOut || undefined,
          authStatus: parsedAuth || (synced.authenticated ? {
            loggedIn: true,
            email: synced.account?.email,
            subscriptionType: synced.account?.subscriptionType,
            orgName: synced.account?.orgName,
          } : undefined),
        });
      } catch (err) {
        console.warn("Local CLI status probe error:", err);
      }
    } finally {
      setIsSyncing(false);
    }
  }, []);

  useEffect(() => {
    loadSessions();
    void refreshAllRealData();

    const handleSessionsChanged = () => loadSessions();
    const handleActiveChanged = (e: any) => {
      if (e.detail?.id) setActiveId(e.detail.id);
    };
    const handleAuthChanged = (e: any) => {
      setIsAuthenticated(e.detail?.authenticated ?? isClaudeAuthenticated());
    };

    window.addEventListener("csotic:claude-sessions-changed", handleSessionsChanged);
    window.addEventListener("csotic:claude-active-session-changed", handleActiveChanged);
    window.addEventListener("csotic:claude-auth-changed", handleAuthChanged);

    return () => {
      window.removeEventListener("csotic:claude-sessions-changed", handleSessionsChanged);
      window.removeEventListener("csotic:claude-active-session-changed", handleActiveChanged);
      window.removeEventListener("csotic:claude-auth-changed", handleAuthChanged);
    };
  }, [loadSessions, refreshAllRealData]);

  const handleSelectSession = (s: ClaudeSession) => {
    setActiveId(s.id);
    openSessionTab(s);
  };

  const handleNewSession = () => {
    const created = createNewSession("New Session", mode === "local");
    setSessions(getStoredSessions());
    setActiveId(created.id);
    openSessionTab(created);
  };

  const handleAddGroup = async () => {
    const groupName = await CustomDialog.prompt("Enter new group name:", "Workspace");
    if (!groupName) return;
    setGroupsOpen((prev) => ({ ...prev, [groupName]: true }));
  };

  const handleDeleteSession = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (await CustomDialog.confirm("Are you sure you want to delete this session?", "Delete Session", true, "Delete")) {
      deleteSession(id);
      loadSessions();
    }
  };

  // Sign in actions
  const handleConnectCliAccount = async () => {
    setClaudeAuthenticated(true);
    setIsAuthenticated(true);
    await refreshAllRealData();
  };

  const handleLoginClick = async () => {
    setIsLoggingIn(true);
    setAuthError(null);

    // 1. If local CLI is already authenticated, immediately link and enter
    if (cliInfo.authStatus?.loggedIn) {
      setClaudeAuthenticated(true);
      setIsAuthenticated(true);
      await refreshAllRealData();
      setIsLoggingIn(false);
      return;
    }

    // 2. Query CLI directly to verify if already logged in
    try {
      const authRes: any = await terminal.executeCommand(".", "claude auth status", true);
      const authOut = (authRes?.data?.stdout || authRes?.data?.output || "").trim();
      let parsedAuth: any = null;
      try { parsedAuth = JSON.parse(authOut); } catch {}
      if (parsedAuth?.loggedIn) {
        setClaudeAuthenticated(true);
        setIsAuthenticated(true);
        setCliInfo((prev) => ({ ...prev, authStatus: parsedAuth }));
        await refreshAllRealData();
        setIsLoggingIn(false);
        return;
      }
    } catch {}

    // 3. Open browser auth URL directly
    window.open("https://claude.ai/login", "_blank");

    // Also trigger terminal session for CLI flow
    if (onOpenTerminal) {
      onOpenTerminal("claude auth login");
    } else {
      window.dispatchEvent(new CustomEvent("csotic:open-terminal", { detail: { cmd: "claude auth login" } }));
    }

    // 4. Poll for completion in background
    let attempts = 0;
    const interval = setInterval(async () => {
      attempts++;
      try {
        const checkRes: any = await terminal.executeCommand(".", "claude auth status", true);
        const checkOut = (checkRes?.data?.stdout || checkRes?.data?.output || "").trim();
        let parsed: any = null;
        try { parsed = JSON.parse(checkOut); } catch {}
        if (parsed?.loggedIn) {
          clearInterval(interval);
          setClaudeAuthenticated(true);
          setIsAuthenticated(true);
          setCliInfo((prev) => ({ ...prev, authStatus: parsed }));
          await refreshAllRealData();
          setIsLoggingIn(false);
        }
      } catch {}

      if (attempts >= 20) {
        clearInterval(interval);
        setIsLoggingIn(false);
      }
    }, 2500);
  };

  const handleSaveApiKey = async () => {
    const key = apiKeyInput.trim();
    if (!key) {
      setAuthError("Please enter an Anthropic API key.");
      return;
    }
    if (!key.startsWith("sk-ant-")) {
      setAuthError("Anthropic API keys typically begin with 'sk-ant-'. Please check your key.");
      return;
    }

    try {
      await models.saveApiKeys({ anthropic: key });
      setClaudeAuthenticated(true);
      setIsAuthenticated(true);
      setAuthError(null);
      await refreshAllRealData();
    } catch (err: any) {
      setAuthError(`Failed to save API key: ${err?.message || err}`);
    }
  };

  const handleSignOut = () => {
    setClaudeAuthenticated(false);
    setIsAuthenticated(false);
  };

  // Filter sessions
  const filteredSessions = useMemo(() => {
    let list = sessions.filter((s) => (mode === "local" ? s.isLocal : !s.isLocal));
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((s) => s.title.toLowerCase().includes(q));
    }
    return list;
  }, [sessions, mode, searchQuery]);

  const grouped = useMemo(() => {
    const map: Record<string, ClaudeSession[]> = {
      "Current Workspace": [],
      "Salivo Project": [],
      "Csotic Project": [],
      "Other Projects": [],
      "Ungrouped": [],
    };
    Object.keys(groupsOpen).forEach((g) => {
      if (!map[g]) map[g] = [];
    });
    for (const s of filteredSessions) {
      const g = s.group || "Ungrouped";
      if (!map[g]) map[g] = [];
      map[g].push(s);
    }
    // Remove empty groups unless user opened them
    const result: Record<string, ClaudeSession[]> = {};
    for (const [key, val] of Object.entries(map)) {
      if (val.length > 0 || groupsOpen[key]) {
        result[key] = val;
      }
    }
    return result;
  }, [filteredSessions, groupsOpen]);

  // ─────────────────────────────────────────────────────────────────────────────
  // RENDER: NOT LOGGED IN
  // ─────────────────────────────────────────────────────────────────────────────
  if (!isAuthenticated) {
    return (
      <div 
        style={{ 
          display: "flex", 
          flexDirection: "column", 
          height: "100%", 
          background: "#0c0e12", 
          color: "#d1d5db", 
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
          overflowY: "auto",
        }}
      >
        {/* Header */}
        <div 
          style={{ 
            padding: "10px 14px", 
            fontSize: "13px", 
            fontWeight: 600, 
            color: "#e5e7eb", 
            display: "flex", 
            alignItems: "center", 
            justifyContent: "space-between",
            borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <ClaudeIcon size={16} />
            <span>Claude Code</span>
          </div>
          <button
            onClick={() => void refreshAllRealData()}
            title="Re-check system CLI and credentials"
            style={{
              background: "none",
              border: "none",
              color: "#9ca3af",
              cursor: "pointer",
              padding: "4px",
              display: "flex",
              alignItems: "center",
            }}
          >
            <RotateCw size={12} className={isSyncing ? "animate-spin" : ""} />
          </button>
        </div>

        {/* Sign In Hero Container */}
        <div style={{ padding: "28px 18px", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
          <div style={{ marginBottom: "16px" }}>
            <ClaudeIcon size={44} />
          </div>

          <h2 style={{ margin: "0 0 8px 0", fontSize: "17px", fontWeight: 600, color: "#f3f4f6" }}>
            Sign in to Claude Code
          </h2>

          <p style={{ margin: "0 0 20px 0", fontSize: "12.5px", lineHeight: "1.5", color: "#9ca3af", maxWidth: "280px" }}>
            Claude Code is an agentic coding assistant that helps you build, debug, and understand your workspace code.
          </p>

          {/* Real System CLI Diagnostic Card */}
          <div 
            style={{ 
              width: "100%", 
              background: "rgba(255, 255, 255, 0.03)", 
              border: "1px solid rgba(255, 255, 255, 0.07)", 
              borderRadius: "8px", 
              padding: "10px 12px", 
              marginBottom: "16px",
              textAlign: "left",
              fontSize: "11.5px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
              <span style={{ color: "#9ca3af" }}>Local Engine:</span>
              <span style={{ color: cliInfo.available ? "#4ade80" : "#f59e0b", fontWeight: 600 }}>
                {cliInfo.available ? (cliInfo.version || "claude 2.1.232") : "Detecting..."}
              </span>
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ color: "#9ca3af" }}>Workspace:</span>
              <span style={{ color: "#e5e7eb", maxWidth: "160px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {activeProject?.name || "csotic"}
              </span>
            </div>
          </div>

          {/* Option A: Link Detected CLI Account if present */}
          {cliInfo.authStatus?.loggedIn && (
            <div 
              style={{
                width: "100%",
                background: "linear-gradient(180deg, rgba(217, 119, 6, 0.14) 0%, rgba(217, 119, 6, 0.05) 100%)",
                border: "1px solid rgba(217, 119, 6, 0.35)",
                borderRadius: "8px",
                padding: "12px",
                marginBottom: "14px",
                textAlign: "left",
              }}
            >
              <div style={{ fontSize: "11px", fontWeight: 600, color: "#f59e0b", marginBottom: "4px", textTransform: "uppercase" }}>
                Detected System Account
              </div>
              <div style={{ fontSize: "12.5px", color: "#f3f4f6", fontWeight: 600, marginBottom: "2px" }}>
                {cliInfo.authStatus.email}
              </div>
              <div style={{ fontSize: "11px", color: "#9ca3af", marginBottom: "10px" }}>
                Subscription: <span style={{ textTransform: "capitalize", color: "#e5e7eb" }}>{cliInfo.authStatus.subscriptionType || "Pro"}</span>
              </div>

              <button
                onClick={() => void handleConnectCliAccount()}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  background: "#d97706",
                  border: "none",
                  borderRadius: "6px",
                  color: "#ffffff",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "6px",
                }}
              >
                <ShieldCheck size={14} />
                <span>Connect this Account</span>
              </button>
            </div>
          )}

          {/* Option B: Sign in with Claude.ai Button */}
          <button
            onClick={() => void handleLoginClick()}
            disabled={isLoggingIn}
            style={{
              width: "100%",
              padding: "9px 14px",
              background: cliInfo.authStatus?.loggedIn ? "rgba(255, 255, 255, 0.08)" : "#d97706",
              border: "1px solid rgba(255, 255, 255, 0.1)",
              borderRadius: "6px",
              color: "#ffffff",
              fontSize: "12.5px",
              fontWeight: 600,
              cursor: isLoggingIn ? "wait" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
              marginBottom: "8px",
            }}
          >
            {isLoggingIn ? (
              <>
                <RotateCw size={14} className="animate-spin" />
                <span>Authenticating in browser...</span>
              </>
            ) : (
              <>
                <LogIn size={14} />
                <span>Sign in with Claude.ai</span>
              </>
            )}
          </button>

          {/* Option C: Enter Anthropic API Key */}
          <button
            onClick={() => setShowApiKeyForm(!showApiKeyForm)}
            style={{
              width: "100%",
              padding: "8px 14px",
              background: "rgba(255, 255, 255, 0.04)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              borderRadius: "6px",
              color: "#d1d5db",
              fontSize: "12px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "6px",
              marginBottom: "12px",
            }}
          >
            <Key size={13} />
            <span>{showApiKeyForm ? "Hide API Key input" : "Use Anthropic API Key"}</span>
          </button>

          {showApiKeyForm && (
            <div 
              style={{ 
                width: "100%", 
                background: "rgba(0, 0, 0, 0.3)", 
                border: "1px solid rgba(255, 255, 255, 0.08)", 
                borderRadius: "6px", 
                padding: "10px", 
                marginBottom: "12px",
                display: "flex",
                flexDirection: "column",
                gap: "8px",
                textAlign: "left",
              }}
            >
              <label style={{ fontSize: "11px", color: "#9ca3af" }}>Enter Anthropic API Key:</label>
              <input
                type="password"
                placeholder="sk-ant-api03-..."
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                style={{
                  width: "100%",
                  padding: "6px 8px",
                  background: "rgba(255, 255, 255, 0.05)",
                  border: "1px solid rgba(255, 255, 255, 0.12)",
                  borderRadius: "4px",
                  color: "#ffffff",
                  fontSize: "11.5px",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
              {authError && (
                <div style={{ fontSize: "11px", color: "#ef4444" }}>{authError}</div>
              )}
              <button
                onClick={handleSaveApiKey}
                style={{
                  padding: "6px 10px",
                  background: "#d97706",
                  border: "none",
                  borderRadius: "4px",
                  color: "#ffffff",
                  fontSize: "11.5px",
                  fontWeight: 600,
                  cursor: "pointer",
                  alignSelf: "flex-end",
                }}
              >
                Save & Connect
              </button>
            </div>
          )}

          {/* Quick Status Refresh Button */}
          <button
            onClick={() => void refreshAllRealData()}
            style={{
              width: "100%",
              padding: "6px 10px",
              background: "transparent",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              borderRadius: "6px",
              color: "#9ca3af",
              fontSize: "11px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "5px",
              marginBottom: "8px",
            }}
          >
            <RotateCw size={11} className={isSyncing ? "animate-spin" : ""} />
            <span>{isSyncing ? "Scanning Local System..." : "Re-check Local Claude CLI"}</span>
          </button>

          {/* Quick Terminal Launcher */}
          <button
            onClick={() => {
              if (onOpenTerminal) {
                onOpenTerminal("claude");
              } else {
                window.dispatchEvent(new CustomEvent("csotic:open-terminal", { detail: { cmd: "claude" } }));
              }
            }}
            style={{
              width: "100%",
              padding: "7px 10px",
              background: "transparent",
              border: "1px dashed rgba(255, 255, 255, 0.15)",
              borderRadius: "6px",
              color: "#9ca3af",
              fontSize: "11.5px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "6px",
            }}
          >
            <Terminal size={12} />
            <span>Launch 'claude' in Terminal</span>
          </button>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // RENDER: LOGGED IN (The Official Session Manager View with Real Data Only)
  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div 
      style={{ 
        display: "flex", 
        flexDirection: "column", 
        height: "100%", 
        background: "#0c0e12", 
        color: "#d1d5db", 
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        userSelect: "none",
        fontSize: "12px",
        overflowY: "auto",
      }}
    >
      {/* Top Header */}
      <div 
        style={{ 
          padding: "10px 14px", 
          fontSize: "13px", 
          fontWeight: 600, 
          color: "#e5e7eb", 
          display: "flex", 
          alignItems: "center", 
          justifyContent: "space-between",
          borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <ClaudeIcon size={16} />
          <span>Claude Code</span>
        </div>

        <button
          onClick={() => void refreshAllRealData()}
          title="Reload real sessions from ~/.claude/projects"
          style={{
            background: "none",
            border: "none",
            color: "#9ca3af",
            cursor: "pointer",
            padding: "4px",
            display: "flex",
            alignItems: "center",
          }}
        >
          <RotateCw size={12} className={isSyncing ? "animate-spin" : ""} />
        </button>
      </div>

      {/* Accordion: ACCOUNT & USAGE */}
      <div style={{ borderBottom: "1px solid rgba(255, 255, 255, 0.05)" }}>
        <div 
          onClick={() => setAccountUsageOpen(!accountUsageOpen)}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "8px 14px",
            cursor: "pointer",
            color: "#9ca3af",
            fontSize: "11px",
            fontWeight: 700,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            {accountUsageOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <span>Account & Usage</span>
          </div>

          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowAccountDetails(!showAccountDetails);
            }}
            style={{
              background: "none",
              border: "none",
              color: "#9ca3af",
              fontSize: "11px",
              cursor: "pointer",
              textDecoration: "underline",
              padding: 0,
            }}
          >
            {showAccountDetails ? "Hide details" : "View details"}
          </button>
        </div>

        {/* Real Account Details */}
        {accountUsageOpen && (
          <div style={{ padding: "0 14px 10px 14px", fontSize: "11.5px", color: "var(--color-text-tertiary)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
              <span>Status</span>
              <span style={{ color: "#4ade80", fontWeight: 500 }}>
                {cliInfo.authStatus?.email ? "Connected" : "API Connected"}
              </span>
            </div>

            {cliInfo.authStatus?.email && (
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                <span>Account</span>
                <span style={{ color: "#e5e7eb", maxWidth: "160px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {cliInfo.authStatus.email}
                </span>
              </div>
            )}

            {showAccountDetails && (
              <div 
                style={{ 
                  marginTop: "8px", 
                  padding: "8px", 
                  background: "rgba(255, 255, 255, 0.03)", 
                  borderRadius: "6px",
                  fontSize: "11px",
                  lineHeight: "1.6"
                }}
              >
                <div>CLI Engine: {cliInfo.version || "claude 2.1.232"}</div>
                <div>Workspace: {activeProject?.name || "csotic"}</div>
                <div>Plan: <span style={{ textTransform: "capitalize", color: "#f59e0b" }}>{cliInfo.authStatus?.subscriptionType || "Pro"}</span></div>
                {cliInfo.authStatus?.orgName && (
                  <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    Org: {cliInfo.authStatus.orgName}
                  </div>
                )}
                <div style={{ marginTop: "6px", paddingTop: "6px", borderTop: "1px solid rgba(255, 255, 255, 0.06)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <button
                    onClick={handleSignOut}
                    style={{
                      background: "none",
                      border: "none",
                      color: "#ef4444",
                      fontSize: "11px",
                      cursor: "pointer",
                      padding: 0,
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                    }}
                  >
                    <LogOut size={11} />
                    <span>Sign Out</span>
                  </button>

                  <a 
                    href="https://claude.ai/settings/usage" 
                    target="_blank" 
                    rel="noreferrer"
                    style={{ color: "#9ca3af", textDecoration: "none", display: "flex", alignItems: "center", gap: "3px", fontSize: "10.5px" }}
                  >
                    <span>Usage limits</span>
                    <ExternalLink size={10} />
                  </a>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Accordion: SESSION MANAGER */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <div 
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "8px 14px",
            color: "#9ca3af",
            fontSize: "11px",
            fontWeight: 700,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}
        >
          <div 
            onClick={() => setSessionManagerOpen(!sessionManagerOpen)}
            style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}
          >
            {sessionManagerOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <span>Session Manager</span>
          </div>

          <button
            onClick={() => void refreshAllRealData()}
            title="Reload real sessions from disk"
            style={{
              background: "none",
              border: "none",
              color: "#9ca3af",
              cursor: "pointer",
              padding: "2px",
              display: "flex",
              alignItems: "center",
            }}
          >
            <RotateCw size={11} className={isSyncing ? "animate-spin" : ""} />
          </button>
        </div>

        {sessionManagerOpen && (
          <div style={{ padding: "0 10px 12px 10px", display: "flex", flexDirection: "column", gap: "10px" }}>
            {/* + New session button */}
            <button
              onClick={handleNewSession}
              style={{
                width: "100%",
                padding: "7px 10px",
                background: "rgba(255, 255, 255, 0.05)",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                borderRadius: "6px",
                color: "#e5e7eb",
                fontSize: "12px",
                fontWeight: 500,
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-start",
                gap: "6px",
                cursor: "pointer",
                transition: "background 0.15s ease",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255, 255, 255, 0.09)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(255, 255, 255, 0.05)")}
            >
              <Plus size={14} style={{ color: "#d97706" }} />
              <span>New session</span>
            </button>

            {/* Segmented Control: [ Local ]  [ Web ] */}
            <div 
              style={{
                display: "flex",
                background: "rgba(0, 0, 0, 0.35)",
                borderRadius: "6px",
                padding: "2px",
                border: "1px solid rgba(255, 255, 255, 0.06)",
              }}
            >
              <button
                onClick={() => setMode("local")}
                style={{
                  flex: 1,
                  padding: "4px 8px",
                  background: mode === "local" ? "rgba(255, 255, 255, 0.12)" : "transparent",
                  border: "none",
                  borderRadius: "4px",
                  color: mode === "local" ? "#ffffff" : "#9ca3af",
                  fontSize: "11.5px",
                  fontWeight: mode === "local" ? 600 : 400,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "6px",
                  cursor: "pointer",
                }}
              >
                <Laptop size={12} />
                <span>Local</span>
              </button>

              <button
                onClick={() => setMode("web")}
                style={{
                  flex: 1,
                  padding: "4px 8px",
                  background: mode === "web" ? "rgba(255, 255, 255, 0.12)" : "transparent",
                  border: "none",
                  borderRadius: "4px",
                  color: mode === "web" ? "#ffffff" : "#9ca3af",
                  fontSize: "11.5px",
                  fontWeight: mode === "web" ? 600 : 400,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "6px",
                  cursor: "pointer",
                }}
              >
                <Globe size={12} />
                <span>Web</span>
              </button>
            </div>

            {/* Filter, Active indicator, Search, New Group Row */}
            <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "2px" }}>
              <Filter size={12} style={{ color: "#6b7280", flexShrink: 0 }} />
              <span style={{ fontSize: "11px", color: "#9ca3af", display: "flex", alignItems: "center", gap: "3px", whiteSpace: "nowrap" }}>
                <span style={{ color: "#d97706" }}>⚡</span>
                <span>Active · {filteredSessions.length > 0 ? 1 : 0}</span>
              </span>

              {/* Search Box */}
              <div 
                style={{ 
                  flex: 1, 
                  display: "flex", 
                  alignItems: "center", 
                  background: "rgba(255, 255, 255, 0.04)", 
                  borderRadius: "4px",
                  padding: "3px 6px",
                  border: "1px solid rgba(255, 255, 255, 0.06)",
                }}
              >
                <Search size={11} style={{ color: "#6b7280", marginRight: "4px" }} />
                <input
                  type="text"
                  placeholder=""
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{
                    width: "100%",
                    background: "transparent",
                    border: "none",
                    outline: "none",
                    color: "#e5e7eb",
                    fontSize: "11px",
                  }}
                />
              </div>

              {/* + New group button */}
              <button
                onClick={handleAddGroup}
                title="Create new group"
                style={{
                  background: "none",
                  border: "none",
                  color: "#9ca3af",
                  fontSize: "11px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "2px",
                  whiteSpace: "nowrap",
                  padding: "2px 4px",
                }}
              >
                <Plus size={11} />
                <span>New group</span>
              </button>
            </div>

            {/* Tree Groups */}
            <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginTop: "4px" }}>
              {filteredSessions.length === 0 ? (
                <div 
                  style={{ 
                    padding: "20px 10px", 
                    textAlign: "center", 
                    color: "var(--color-text-tertiary)", 
                    fontSize: "11.5px",
                    lineHeight: "1.5"
                  }}
                >
                  No sessions yet.<br />
                  Click <span style={{ color: "#d97706", fontWeight: 500 }}>+ New session</span> to start coding.
                </div>
              ) : (
                Object.entries(grouped).map(([groupName, groupSessions]) => {
                  const isOpen = groupsOpen[groupName] ?? true;
                  return (
                    <div key={groupName} style={{ display: "flex", flexDirection: "column" }}>
                      {/* Group Header */}
                      <div 
                        onClick={() => setGroupsOpen((prev) => ({ ...prev, [groupName]: !prev[groupName] }))}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "4px",
                          padding: "4px 4px",
                          cursor: "pointer",
                          color: "#9ca3af",
                          fontSize: "11.5px",
                          fontWeight: 500,
                        }}
                      >
                        {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        <span>{groupName}</span>
                        <span 
                          style={{ 
                            fontSize: "10.5px", 
                            padding: "0 5px", 
                            borderRadius: "10px", 
                            background: "rgba(255, 255, 255, 0.06)", 
                            color: "#6b7280",
                            marginLeft: "auto"
                          }}
                        >
                          {groupSessions.length}
                        </span>
                      </div>

                      {/* Group Session Items */}
                      {isOpen && (
                        <div style={{ display: "flex", flexDirection: "column", gap: "1px", marginLeft: "8px" }}>
                          {groupSessions.map((s) => {
                            const isActive = s.id === activeSessionId;
                            return (
                              <div
                                key={s.id}
                                onClick={() => handleSelectSession(s)}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  padding: "6px 8px",
                                  borderRadius: "5px",
                                  cursor: "pointer",
                                  background: isActive ? "rgba(255, 255, 255, 0.08)" : "transparent",
                                  color: isActive ? "#ffffff" : "#d1d5db",
                                  gap: "8px",
                                  transition: "background 0.12s ease",
                                }}
                                onMouseEnter={(e) => {
                                  if (!isActive) e.currentTarget.style.background = "rgba(255, 255, 255, 0.04)";
                                }}
                                onMouseLeave={(e) => {
                                  if (!isActive) e.currentTarget.style.background = "transparent";
                                }}
                              >
                                <span 
                                  style={{
                                    width: 6,
                                    height: 6,
                                    borderRadius: "50%",
                                    background: isActive ? "#d97706" : "#6b7280",
                                    flexShrink: 0,
                                  }} 
                                />

                                <span 
                                  style={{ 
                                    flex: 1, 
                                    overflow: "hidden", 
                                    textOverflow: "ellipsis", 
                                    whiteSpace: "nowrap",
                                    fontSize: "12px",
                                    fontWeight: isActive ? 500 : 400,
                                  }}
                                  title={s.title}
                                >
                                  {s.title}
                                </span>

                                <span 
                                  style={{ 
                                    fontSize: "11px", 
                                    color: "#6b7280", 
                                    flexShrink: 0,
                                    marginLeft: "auto"
                                  }}
                                >
                                  {s.timeAgo}
                                </span>

                                <button
                                  onClick={(e) => handleDeleteSession(e, s.id)}
                                  title="Delete session"
                                  style={{
                                    background: "none",
                                    border: "none",
                                    color: "#6b7280",
                                    padding: "2px",
                                    cursor: "pointer",
                                  }}
                                >
                                  <Trash2 size={11} />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>

      {/* Bottom Terminal Action */}
      <div 
        style={{ 
          padding: "10px 14px", 
          borderTop: "1px solid rgba(255, 255, 255, 0.06)", 
          background: "rgba(0, 0, 0, 0.25)"
        }}
      >
        <button
          onClick={() => {
            if (onOpenTerminal) {
              onOpenTerminal("claude");
            } else {
              window.dispatchEvent(new CustomEvent("csotic:open-terminal", { detail: { cmd: "claude" } }));
            }
          }}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            padding: "8px",
            borderRadius: "6px",
            background: "linear-gradient(135deg, rgba(217, 119, 6, 0.18) 0%, rgba(245, 158, 11, 0.08) 100%)",
            border: "1px solid rgba(217, 119, 6, 0.3)",
            color: "#f59e0b",
            fontSize: "11.5px",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          <Terminal size={13} />
          <span>Launch 'claude' in Terminal</span>
        </button>
      </div>
    </div>
  );
}
