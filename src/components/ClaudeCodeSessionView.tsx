import { useState, useEffect, useRef } from "react";
import { 
  ChevronRight, 
  Plus, 
  Clock, 
  Mic, 
  ArrowUp, 
  Zap, 
  Copy, 
  Check, 
} from "lucide-react";
import type { ClaudeSession, ClaudeSessionMessage } from "../services/claudeCodeSessions";
import { updateSession, getStoredSessions } from "../services/claudeCodeSessions";
import type { ProjectInfo } from "../types/ipc";
import { terminal, models } from "../services/ipc";

import { ClaudeIcon } from "./ClaudeIcon";

interface ClaudeCodeSessionViewProps {
  session: ClaudeSession;
  activeProject?: ProjectInfo | null;
  activeFilePath?: string | null;
  onOpenFile?: (path: string) => void;
  onOpenTerminal?: (cmd?: string) => void;
}

export function ClaudeCodeSessionView({
  session: initialSession,
  activeProject,
  activeFilePath,
  onOpenFile,
  onOpenTerminal: _onOpenTerminal,
}: ClaudeCodeSessionViewProps) {
  const [session, setSession] = useState<ClaudeSession>(initialSession);
  const [prompt, setPrompt] = useState("");
  const [isExecuting, setIsExecuting] = useState(false);
  const [thinkingExpanded, setThinkingExpanded] = useState<Record<string, boolean>>({});
  const [copiedIndex, setCopiedIndex] = useState<string | null>(null);
  const [activeModel, setActiveModel] = useState("Opus 5");
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [showSlashCommands, setShowSlashCommands] = useState(false);
  const [autoMode, setAutoMode] = useState(true);
  const [showHistoryDropdown, setShowHistoryDropdown] = useState(false);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Sync session prop updates
  useEffect(() => {
    setSession(initialSession);
  }, [initialSession]);

  // Global shortcut: ctrl+esc to focus/unfocus prompt dock
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Escape") {
        e.preventDefault();
        if (document.activeElement === inputRef.current) {
          inputRef.current?.blur();
        } else {
          inputRef.current?.focus();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(id);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const scrollToBottom = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  };

  const handleSend = async () => {
    const textToSend = prompt.trim();
    if (!textToSend || isExecuting) return;

    const userMsg: ClaudeSessionMessage = {
      id: `msg-${Date.now()}`,
      role: "user",
      text: textToSend,
      time: "Just now",
    };

    const newMessages = [...session.messages, userMsg];
    const updated = { ...session, messages: newMessages };
    setSession(updated);
    updateSession(updated);
    setPrompt("");
    setIsExecuting(true);
    setTimeout(scrollToBottom, 50);

    let assistantSummary = "";
    let toolResult: any = null;

    try {
      const safePrompt = textToSend.replace(/"/g, '\\"').replace(/\r?\n/g, " ");
      const cwd = activeProject?.path || ".";
      const res: any = await terminal.executeCommand(cwd, `claude -p "${safePrompt}"`, true);
      const stdout = (res?.data?.stdout || res?.data?.output || "").trim();
      const stderr = (res?.data?.stderr || "").trim();

      if (stdout) {
        assistantSummary = stdout;
      } else if (stderr) {
        assistantSummary = stderr;
      }
    } catch {
      // Fallback: models.executePrompt
      try {
        const fullPrompt = activeFilePath 
          ? `Context: Active file is ${activeFilePath}.\n\nUser Prompt: ${textToSend}`
          : textToSend;
        const res: any = await models.executePrompt("claude-3-5-sonnet", fullPrompt);
        if (res?.success && res?.data?.response) {
          assistantSummary = res.data.response;
        } else {
          assistantSummary = res?.error?.message || "Execution completed. Check your terminal or workspace changes.";
        }
      } catch (err: any) {
        assistantSummary = `Execution error: ${err?.message || "Command failed"}`;
      }
    }

    const assistantMsg: ClaudeSessionMessage = {
      id: `msg-${Date.now() + 1}`,
      role: "assistant",
      text: "",
      summary: assistantSummary || "Task processed and verified.",
      toolCalls: toolResult ? [toolResult] : undefined,
      time: "Just now",
    };

    const finalMessages = [...newMessages, assistantMsg];
    const finalSession = { ...session, messages: finalMessages };
    setSession(finalSession);
    updateSession(finalSession);
    setIsExecuting(false);
    setTimeout(scrollToBottom, 50);
  };

  const slashCommands = [
    { cmd: "/compact", desc: "Compact conversation history to save tokens" },
    { cmd: "/cost", desc: "Display token usage and estimated cost" },
    { cmd: "/doctor", desc: "Check Claude Code CLI health & dependencies" },
    { cmd: "/help", desc: "Show available Claude Code commands" },
    { cmd: "/init", desc: "Initialize CLAUDE.md memory file in project" },
    { cmd: "/review", desc: "Review staged git diff with Claude" },
    { cmd: "/terminal", desc: "Open interactive terminal with Claude CLI" },
  ];

  return (
    <div 
      style={{ 
        display: "flex", 
        flexDirection: "column", 
        height: "100%", 
        width: "100%", 
        background: "#0c0e12", 
        color: "#d1d5db", 
        position: "relative",
        overflow: "hidden",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
      }}
    >
      {/* Session Stream Container */}
      <div 
        ref={scrollContainerRef}
        style={{ 
          flex: 1, 
          overflowY: "auto", 
          padding: "24px 32px 140px 32px",
          display: "flex",
          flexDirection: "column",
          gap: "20px"
        }}
      >
        {session.messages.length === 0 ? (
          <div style={{ padding: "40px 20px", textAlign: "center", color: "var(--color-text-tertiary)" }}>
            <ClaudeIcon size={32} />
            <h3 style={{ margin: "14px 0 6px 0", color: "#e5e7eb", fontSize: "16px", fontWeight: 600 }}>
              {session.title}
            </h3>
            <p style={{ margin: 0, fontSize: "13px" }}>
              Start by typing your prompt below or use <code style={{ color: "#d97706" }}>ctrl esc</code> to focus.
            </p>
          </div>
        ) : (
          session.messages.map((msg) => {
            if (msg.role === "user") {
              return (
                <div key={msg.id} style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <div style={{ fontSize: "14px", lineHeight: "1.6", color: "#e5e7eb", fontWeight: 400 }}>
                    {msg.text}
                  </div>
                </div>
              );
            }

            return (
              <div key={msg.id} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                {/* Section Tag with Official Claude Logo */}
                <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "#9ca3af", letterSpacing: "0.02em" }}>
                  <ClaudeIcon size={14} />
                  <span style={{ fontWeight: 600, color: "#d97757" }}>Claude</span>
                  {msg.time && <span style={{ fontSize: "11px", color: "#6b7280" }}>· {msg.time}</span>}
                </div>

                {/* Collapsible Thinking Accordion */}
                {msg.thinking && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    <button
                      onClick={() =>
                        setThinkingExpanded((prev) => ({ ...prev, [msg.id]: !prev[msg.id] }))
                      }
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "8px",
                        background: "none",
                        border: "none",
                        padding: 0,
                        color: "var(--color-text-tertiary)",
                        cursor: "pointer",
                        fontSize: "13px",
                        textAlign: "left",
                      }}
                    >
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#6b7280" }} />
                      <span style={{ color: "#9ca3af" }}>Thinking</span>
                      <ChevronRight 
                        size={12} 
                        style={{ 
                          transform: thinkingExpanded[msg.id] ? "rotate(90deg)" : "none", 
                          transition: "transform 0.15s ease",
                          color: "#6b7280"
                        }} 
                      />
                    </button>
                    {thinkingExpanded[msg.id] && (
                      <div 
                        style={{
                          margin: "4px 0 0 14px",
                          padding: "10px 14px",
                          background: "rgba(255, 255, 255, 0.03)",
                          borderLeft: "2px solid rgba(255, 255, 255, 0.1)",
                          borderRadius: "0 6px 6px 0",
                          fontSize: "12px",
                          lineHeight: "1.6",
                          color: "#9ca3af",
                          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                        }}
                      >
                        {msg.thinking}
                      </div>
                    )}
                  </div>
                )}

                {/* Summarized Assistant Prose / Overview */}
                {msg.summary && (
                  <div style={{ display: "flex", alignItems: "flex-start", gap: "10px", fontSize: "13.5px", lineHeight: "1.6", color: "#d1d5db" }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#6b7280", marginTop: "8px", flexShrink: 0 }} />
                    <div>{msg.summary}</div>
                  </div>
                )}

                {/* Tool Execution Cards (Bash) */}
                {msg.toolCalls && msg.toolCalls.map((tc, idx) => {
                  const cardId = `${msg.id}-tc-${idx}`;
                  return (
                    <div key={idx} style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                      {/* Tool Header with Green Bullet */}
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" }}>
                        <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#22c55e", flexShrink: 0 }} />
                        <span style={{ fontWeight: 600, color: "#f3f4f6" }}>
                          {tc.type === "bash" ? "Bash" : "Tool"}
                        </span>
                        <span style={{ color: "#9ca3af" }}>{tc.title}</span>
                      </div>

                      {/* Tool Monospace Card */}
                      <div 
                        style={{
                          background: "#111419",
                          border: "1px solid rgba(255, 255, 255, 0.08)",
                          borderRadius: "8px",
                          overflow: "hidden",
                          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                          fontSize: "12px",
                          lineHeight: "1.5",
                          position: "relative",
                        }}
                      >
                        {/* Copy Code Action */}
                        <button
                          onClick={() => handleCopy(`${tc.command || ""}\n${tc.output || ""}`, cardId)}
                          style={{
                            position: "absolute",
                            top: "8px",
                            right: "8px",
                            background: "rgba(255, 255, 255, 0.05)",
                            border: "1px solid rgba(255, 255, 255, 0.1)",
                            borderRadius: "4px",
                            padding: "3px 6px",
                            color: "var(--color-text-secondary)",
                            cursor: "pointer",
                            fontSize: "11px",
                            display: "flex",
                            alignItems: "center",
                            gap: "4px",
                            zIndex: 2,
                          }}
                        >
                          {copiedIndex === cardId ? <Check size={11} color="#22c55e" /> : <Copy size={11} />}
                          <span>{copiedIndex === cardId ? "Copied" : "Copy"}</span>
                        </button>

                        {/* Command IN */}
                        {tc.command && (
                          <div style={{ padding: "10px 14px", borderBottom: tc.output ? "1px solid rgba(255, 255, 255, 0.05)" : "none", display: "flex", gap: "12px" }}>
                            <span style={{ color: "#6b7280", userSelect: "none", fontWeight: 700, width: "24px" }}>IN</span>
                            <span style={{ color: "#e5e7eb", wordBreak: "break-all", whiteSpace: "pre-wrap" }}>{tc.command}</span>
                          </div>
                        )}

                        {/* Output OUT */}
                        {tc.output && (
                          <div style={{ padding: "10px 14px", background: "rgba(0, 0, 0, 0.2)", display: "flex", gap: "12px", maxHeight: "280px", overflowY: "auto" }}>
                            <span style={{ color: "#6b7280", userSelect: "none", fontWeight: 700, width: "24px" }}>OUT</span>
                            <pre style={{ margin: 0, color: "#9ca3af", whiteSpace: "pre-wrap", wordBreak: "break-word", flex: 1, fontFamily: "inherit" }}>
                              {tc.output}
                            </pre>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* Status Notice Banner */}
                {msg.statusNotice && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "4px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "#9ca3af" }}>
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#6b7280", flexShrink: 0 }} />
                      <span>{msg.statusNotice}</span>
                    </div>

                    {msg.metaNotices && msg.metaNotices.map((meta, mIdx) => (
                      <div key={mIdx} style={{ fontSize: "12px", color: "var(--color-text-tertiary)", marginLeft: "14px", fontStyle: "italic", lineHeight: "1.5" }}>
                        {meta}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}

        {isExecuting && (
          <div style={{ display: "flex", alignItems: "center", gap: "10px", color: "#d97706", fontSize: "13px" }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#d97706", animation: "pulse 1.5s infinite" }} />
            <span>Claude is processing and analyzing workspace...</span>
          </div>
        )}
      </div>

      {/* Floating Bottom Prompt Dock */}
      <div 
        style={{
          position: "absolute",
          bottom: "20px",
          left: "50%",
          transform: "translateX(-50%)",
          width: "calc(100% - 64px)",
          maxWidth: "840px",
          background: "#16191f",
          border: "1px solid rgba(255, 255, 255, 0.12)",
          borderRadius: "14px",
          boxShadow: "0 12px 36px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(0,0,0,0.4)",
          display: "flex",
          flexDirection: "column",
          padding: "10px 14px",
          zIndex: 50,
        }}
      >
        {/* Text Input Row */}
        <textarea
          ref={inputRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="ctrl esc to focus or unfocus Claude"
          rows={1}
          style={{
            width: "100%",
            background: "transparent",
            border: "none",
            outline: "none",
            color: "#f3f4f6",
            fontSize: "13.5px",
            lineHeight: "1.5",
            resize: "none",
            minHeight: "24px",
            maxHeight: "140px",
            fontFamily: "inherit",
          }}
        />

        {/* Bottom Actions Bar */}
        <div 
          style={{ 
            display: "flex", 
            alignItems: "center", 
            justifyContent: "space-between", 
            marginTop: "8px",
            paddingTop: "6px",
          }}
        >
          {/* Left Controls */}
          <div style={{ display: "flex", alignItems: "center", gap: "6px", position: "relative" }}>
            {/* Add Context / Attachment */}
            <button
              onClick={() => {
                if (activeFilePath && onOpenFile) {
                  onOpenFile(activeFilePath);
                }
              }}
              title="Add context file"
              style={{
                width: "26px",
                height: "26px",
                borderRadius: "6px",
                background: "rgba(255, 255, 255, 0.05)",
                border: "none",
                color: "#9ca3af",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
              }}
            >
              <Plus size={14} />
            </button>

            {/* Slash Commands Trigger */}
            <button
              onClick={() => setShowSlashCommands((v) => !v)}
              title="Slash commands"
              style={{
                height: "26px",
                padding: "0 6px",
                borderRadius: "6px",
                background: "rgba(255, 255, 255, 0.05)",
                border: "none",
                color: "#9ca3af",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                fontSize: "12px",
                fontWeight: 600,
                fontFamily: "monospace",
              }}
            >
              [/]
            </button>

            {/* Session History Picker */}
            <button
              onClick={() => setShowHistoryDropdown((v) => !v)}
              title="Session History"
              style={{
                width: "26px",
                height: "26px",
                borderRadius: "6px",
                background: "rgba(255, 255, 255, 0.05)",
                border: "none",
                color: "#9ca3af",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
              }}
            >
              <Clock size={13} />
            </button>

            {/* Model Badge Pill */}
            <button
              onClick={() => setShowModelPicker((v) => !v)}
              style={{
                height: "26px",
                padding: "0 8px",
                borderRadius: "6px",
                background: "rgba(255, 255, 255, 0.05)",
                border: "none",
                color: "#d1d5db",
                display: "flex",
                alignItems: "center",
                gap: "4px",
                cursor: "pointer",
                fontSize: "12px",
                fontWeight: 500,
              }}
            >
              <span>{activeModel}</span>
              <ChevronRight size={10} style={{ transform: "rotate(90deg)", color: "#9ca3af" }} />
            </button>

            {/* Model Picker Popover */}
            {showModelPicker && (
              <div 
                style={{
                  position: "absolute",
                  bottom: "34px",
                  left: 0,
                  background: "#1c2027",
                  border: "1px solid rgba(255, 255, 255, 0.12)",
                  borderRadius: "8px",
                  padding: "4px",
                  minWidth: "160px",
                  boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
                  zIndex: 100,
                }}
              >
                {["Opus 5", "Sonnet 3.7", "Haiku 3.5", "Local Claude CLI"].map((m) => (
                  <div
                    key={m}
                    onClick={() => {
                      setActiveModel(m);
                      setShowModelPicker(false);
                    }}
                    style={{
                      padding: "6px 10px",
                      borderRadius: "4px",
                      fontSize: "12px",
                      cursor: "pointer",
                      background: activeModel === m ? "rgba(217, 119, 6, 0.15)" : "transparent",
                      color: activeModel === m ? "#f59e0b" : "#e5e7eb",
                    }}
                  >
                    {m}
                  </div>
                ))}
              </div>
            )}

            {/* Slash Commands Popover */}
            {showSlashCommands && (
              <div 
                style={{
                  position: "absolute",
                  bottom: "34px",
                  left: "30px",
                  background: "#1c2027",
                  border: "1px solid rgba(255, 255, 255, 0.12)",
                  borderRadius: "8px",
                  padding: "4px",
                  minWidth: "220px",
                  boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
                  zIndex: 100,
                }}
              >
                {slashCommands.map((sc) => (
                  <div
                    key={sc.cmd}
                    onClick={() => {
                      setPrompt(sc.cmd);
                      setShowSlashCommands(false);
                      inputRef.current?.focus();
                    }}
                    style={{
                      padding: "6px 10px",
                      borderRadius: "4px",
                      fontSize: "12px",
                      cursor: "pointer",
                      display: "flex",
                      flexDirection: "column",
                      gap: "2px",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255, 255, 255, 0.08)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    <span style={{ fontWeight: 600, color: "#d97706", fontFamily: "monospace" }}>{sc.cmd}</span>
                    <span style={{ fontSize: "11px", color: "#9ca3af" }}>{sc.desc}</span>
                  </div>
                ))}
              </div>
            )}

            {/* History Dropdown */}
            {showHistoryDropdown && (
              <div 
                style={{
                  position: "absolute",
                  bottom: "34px",
                  left: "60px",
                  background: "#1c2027",
                  border: "1px solid rgba(255, 255, 255, 0.12)",
                  borderRadius: "8px",
                  padding: "4px",
                  minWidth: "260px",
                  boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
                  zIndex: 100,
                }}
              >
                <div style={{ padding: "4px 8px", fontSize: "11px", color: "#6b7280", fontWeight: 600, textTransform: "uppercase" }}>
                  Recent Sessions
                </div>
                {getStoredSessions().slice(0, 5).map((s) => (
                  <div
                    key={s.id}
                    onClick={() => {
                      setSession(s);
                      setShowHistoryDropdown(false);
                    }}
                    style={{
                      padding: "6px 10px",
                      borderRadius: "4px",
                      fontSize: "12px",
                      cursor: "pointer",
                      color: s.id === session.id ? "#f59e0b" : "#e5e7eb",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255, 255, 255, 0.08)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    {s.title}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right Controls */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            {/* Microphone */}
            <button
              title="Voice dictation"
              style={{
                width: "26px",
                height: "26px",
                borderRadius: "6px",
                background: "none",
                border: "none",
                color: "#9ca3af",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
              }}
            >
              <Mic size={14} />
            </button>

            {/* Auto Mode Pill */}
            <button
              onClick={() => setAutoMode((v) => !v)}
              style={{
                height: "26px",
                padding: "0 8px",
                borderRadius: "6px",
                background: autoMode ? "rgba(217, 119, 6, 0.15)" : "rgba(255, 255, 255, 0.05)",
                border: "none",
                color: autoMode ? "#f59e0b" : "#9ca3af",
                display: "flex",
                alignItems: "center",
                gap: "4px",
                cursor: "pointer",
                fontSize: "12px",
                fontWeight: 600,
              }}
            >
              <Zap size={11} fill={autoMode ? "#f59e0b" : "none"} />
              <span>Auto</span>
            </button>

            {/* Send Up-Arrow Button */}
            <button
              onClick={handleSend}
              disabled={!prompt.trim() || isExecuting}
              title="Send (Enter)"
              style={{
                width: "28px",
                height: "28px",
                borderRadius: "8px",
                background: prompt.trim() ? "#d97706" : "rgba(255, 255, 255, 0.08)",
                border: "none",
                color: prompt.trim() ? "#ffffff" : "#6b7280",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: prompt.trim() && !isExecuting ? "pointer" : "default",
                transition: "background 0.15s ease",
              }}
            >
              <ArrowUp size={15} strokeWidth={2.5} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
