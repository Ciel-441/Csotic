import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { listen, emit } from "../../services/events";
import { models, filesystem, agent } from "../../services/ipc";
import { ProjectInfo } from "../../types/ipc";
import { getModelBrandLogo } from "../../components/ModelBrandIcons";
import { getFileIcon } from "../../components/editor/EditorTabBar";
import { 
  Sparkles, 
  X, 
  Zap, 
  ClipboardPaste, 
  ChevronRight, 
  Square, 
  Plus, 
  FileText, 
  Trash2, 
  ChevronDown, 
  MessageSquare, 
  Image, 
  Paperclip, 
  FileCode, 
  FolderOpen, 
  ArrowRight, 
  Copy, 
  Check, 
  Pencil, 
  GitBranch, 
  MoreHorizontal, 
  AlertCircle, 
  RotateCcw, 
} from "lucide-react";
import { ModelSelectorDropdown, ModelMetadata, DEFAULT_AI_MODELS } from "../../components/ModelSelectorDropdown";
import { CustomDialog } from "../../components/GlobalDialog";

interface Message {
  sender: "user" | "agent";
  text: string;
  attachments?: Attachment[];
  exploredFiles?: string[];
  isError?: boolean;
}

interface Attachment { path: string; name: string; kind: "image" | "pdf" | "document"; }

const CODING_AGENT_PROMPT = `You are Csotic, an expert software engineer and AI pair programmer embedded in this IDE.

Your mission is to understand the codebase deeply and deliver clean, robust, production-grade solutions.

### CORE OPERATING PRINCIPLES:

1. **THOROUGH REASONING & ARCHITECTURE**:
   - Understand existing architecture, dependencies, types, and established project patterns before generating solutions.
   - For modifications: identify the exact components that need changes and apply minimal, precise, robust updates.

2. **PRODUCTION-GRADE IMPLEMENTATION**:
   - Write complete, clean, functional code with no missing implementations, placeholders, or omitted logic.
   - Adhere to clean code practices, separation of concerns, and proper typing.

3. **CLEAR & CONCISE COMMUNICATION**:
   - Explain your thinking clearly and directly.
   - High-level architectural reasoning can be placed inside <thought>...</thought> tags at the very beginning of your response.`;

function isLocalModel(modelId: string | null | undefined): boolean {
  if (!modelId) return true;
  const m = modelId.toLowerCase();
  const isCloud =
    m.startsWith("openai/") || m.startsWith("gpt-") || m.startsWith("o1") || m.startsWith("o3") || m.startsWith("chatgpt") ||
    m.startsWith("anthropic/") || m.startsWith("claude-") ||
    m.startsWith("gemini") || m.startsWith("google/") ||
    m.startsWith("groq/") ||
    m.startsWith("openrouter/") ||
    m.startsWith("deepseek");
  return !isCloud;
}

function greeting(model: string | null, attachedProjects: string[]): Message {
  if (!model) return { sender: "agent", text: "CHOOSE_MODEL_PROMPT" };
  if (attachedProjects.length > 0) {
    const projectName = attachedProjects[0].split(/[/\\]/).pop();
    return { sender: "agent", text: `Hello! I'm ready to help you with **${projectName}**. You can write code in the editor, ask me to refactor with \`Ctrl+K\`, stage git commits, or ask questions here.` };
  }
  return { sender: "agent", text: "Hello! What would you like to build or code today? Open a folder to begin editing and debugging." };
}



function parseThoughtAndContent(rawText: string): { thought: string | null; content: string } {
  const thoughtMatch = rawText.match(/<(thought|think)>([\s\S]*?)(?:<\/\1>|$)/i);
  if (!thoughtMatch) {
    return { thought: null, content: rawText };
  }

  const thought = thoughtMatch[2].trim();
  const content = rawText.replace(/<(thought|think)>[\s\S]*?(?:<\/\1>|$)/gi, "").trim();

  return { thought: thought || null, content };
}

function ThoughtBox({ thought }: { thought: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div style={{ marginBottom: 6 }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          background: "none",
          border: "none",
          color: "var(--color-text-tertiary)",
          cursor: "pointer",
          fontSize: "11px",
          userSelect: "none",
          padding: 0,
        }}
      >
        <span style={{ color: "var(--color-text-secondary)" }}>Thought for 1s</span>
        <ChevronRight size={11} style={{ transform: expanded ? "rotate(90deg)" : "none", transition: "transform 0.15s", color: "var(--color-text-tertiary)" }} />
      </button>

      {expanded && (
        <div style={{
          marginTop: 4,
          padding: "6px 8px",
          background: "rgba(0, 0, 0, 0.3)",
          borderRadius: 6,
          borderLeft: "2px solid rgba(255, 255, 255, 0.2)",
          color: "var(--color-text-secondary)",
          fontSize: "11px",
          lineHeight: 1.45,
          whiteSpace: "pre-wrap",
          maxHeight: 200,
          overflowY: "auto",
        }}>
          {thought}
        </div>
      )}
    </div>
  );
}

interface FileAction {
  fileName: string;
  code: string;
  language: string;
  addedLines: number;
  removedLines: number;
  isNew: boolean;
  isStreaming?: boolean;
}

function HtmlIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, display: "inline-block", verticalAlign: "middle" }}>
      <path d="M3 2l1.8 17.5L12 22l7.2-2.5L21 2H3z" fill="#E44D26" />
      <path d="M12 3.8v16.4l5.5-1.9L19 3.8H12z" fill="#F16529" />
      <path d="M6.5 6.5h11l-.3 2.5h-8l.2 2.5h7.5l-.6 6.5-4.3 1.2-4.3-1.2-.3-3.2h2.2l.1 1.6 2.3.6 2.3-.6.2-2.5H6.2l-.7-7.4z" fill="#fff" />
    </svg>
  );
}

function CssIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, display: "inline-block", verticalAlign: "middle" }}>
      <path d="M3 2l1.8 17.5L12 22l7.2-2.5L21 2H3z" fill="#1572B6" />
      <path d="M12 3.8v16.4l5.5-1.9L19 3.8H12z" fill="#33A9DC" />
      <path d="M6.5 6.5h11l-.3 2.5h-8l.2 2.5h7.5l-.6 6.5-4.3 1.2-4.3-1.2-.3-3.2h2.2l.1 1.6 2.3.6 2.3-.6.2-2.5H6.2l-.7-7.4z" fill="#fff" />
    </svg>
  );
}

function JsIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, display: "inline-block", verticalAlign: "middle" }}>
      <rect width="24" height="24" rx="3" fill="#F7DF1E" />
      <path d="M6 18.5c1.2.7 2.4 1 3.6 1 2.3 0 3.6-1.1 3.6-2.8 0-1.8-1.2-2.5-2.8-3.2-1.3-.6-1.7-.9-1.7-1.6 0-.6.5-1.1 1.4-1.1.9 0 1.6.3 2.2.7l.6-1.6c-.7-.5-1.7-.8-2.8-.8-2.2 0-3.4 1.2-3.4 2.8 0 1.7 1.1 2.4 2.7 3.1 1.3.6 1.8 1 1.8 1.7 0 .8-.7 1.2-1.7 1.2-1.1 0-2.1-.4-2.8-1l-.5 1.7zm11.5.1c.7 0 1.4-.2 1.8-.5V9.4h2.1v9.6c-.9.5-2.2.8-3.7.8-2.6 0-3.9-1.3-3.9-3.7V9.4h2.1v6.7c0 1.7.7 2.5 1.6 2.5z" fill="#000" />
    </svg>
  );
}

function TsIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, display: "inline-block", verticalAlign: "middle" }}>
      <rect width="24" height="24" rx="3" fill="#3178C6" />
      <path d="M3.5 9.5h7.2v2.2H8.3v7.3H5.9v-7.3H3.5V9.5zm9 8.8c.8.6 1.8 1 2.8 1 1.8 0 2.8-.9 2.8-2.2 0-1.4-.9-2-2.2-2.5-1-.4-1.4-.7-1.4-1.3 0-.5.4-.9 1.1-.9.7 0 1.3.3 1.8.6l.5-1.3c-.6-.4-1.4-.6-2.3-.6-1.7 0-2.7 1-2.7 2.2 0 1.3.9 1.9 2.1 2.4 1 .4 1.5.8 1.5 1.4 0 .6-.5 1-1.3 1-.9 0-1.7-.4-2.3-.9l-.5 1.5z" fill="#fff" />
    </svg>
  );
}

function ReactIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="-11.5 -10.232 23 20.463" fill="none" style={{ flexShrink: 0, display: "inline-block", verticalAlign: "middle" }}>
      <circle cx="0" cy="0" r="2.05" fill="#61DAFB" />
      <g stroke="#61DAFB" strokeWidth="1" fill="none">
        <ellipse rx="11" ry="4.2" />
        <ellipse rx="11" ry="4.2" transform="rotate(60)" />
        <ellipse rx="11" ry="4.2" transform="rotate(120)" />
      </g>
    </svg>
  );
}

function PythonIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, display: "inline-block", verticalAlign: "middle" }}>
      <path d="M11.9 2c-3.1 0-5 .8-5 2.5V7h5v1H5c-2.3 0-3 1.3-3 3.5s.8 3.5 3 3.5h1.5v-2c0-1.8 1.5-3 3.5-3h5v-1c0-1.7-1.3-3-3-3h-1v-2c0-.5-.4-1-1-1zm-1.4 1.5a.75.75 0 110 1.5.75.75 0 010-1.5z" fill="#3776AB" />
      <path d="M12.1 22c3.1 0 5-.8 5-2.5V17h-5v-1h6.9c2.3 0 3-1.3 3-3.5s-.8-3.5-3-3.5h-1.5v2c0 1.8-1.5 3-3.5 3h-5v1c0 1.7 1.3 3 3 3h1v2c0 .5.4 1 1 1zm1.4-1.5a.75.75 0 110-1.5.75.75 0 010 1.5z" fill="#FFD438" />
    </svg>
  );
}

function RustIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, display: "inline-block", verticalAlign: "middle" }}>
      <rect width="24" height="24" rx="4" fill="#261b17" stroke="#DEA584" strokeWidth="1" />
      <text x="12" y="16" textAnchor="middle" fill="#DEA584" fontSize="12" fontWeight="900" fontFamily="monospace">RS</text>
    </svg>
  );
}

function JsonIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, display: "inline-block", verticalAlign: "middle" }}>
      <rect width="24" height="24" rx="3" fill="#F59E0B" fillOpacity="0.2" stroke="#F59E0B" strokeWidth="1.2" />
      <text x="12" y="16" textAnchor="middle" fill="#F59E0B" fontSize="11" fontWeight="800" fontFamily="monospace">{"{}"}</text>
    </svg>
  );
}

function MarkdownIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, display: "inline-block", verticalAlign: "middle" }}>
      <rect width="24" height="24" rx="3" fill="#8B5CF6" fillOpacity="0.2" stroke="#8B5CF6" strokeWidth="1.2" />
      <path d="M4.5 16V8h2.5l2 3 2-3h2.5v8h-2v-4.5L9.5 12 7.5 9.5V16h-3zm11-3.5V8h2v4.5h2l-3 4-3-4h2z" fill="#8B5CF6" />
    </svg>
  );
}

function GenericFileIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="var(--color-text-tertiary)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, display: "inline-block", verticalAlign: "middle" }}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function SalivoIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="24" height="24" rx="4" fill="#EF4444" fillOpacity="0.25" stroke="#EF4444" strokeWidth="1.2" />
      <path d="M16 7h-7a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h4a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H8m8-12v2" stroke="#EF4444" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FileTechIcon({ fileName, size = 14 }: { fileName: string; size?: number }) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".sal") || lower.endsWith(".salivo")) return <SalivoIcon size={size} />;
  if (lower.endsWith(".tsx") || lower.endsWith(".jsx")) return <ReactIcon size={size} />;
  if (lower.endsWith(".ts")) return <TsIcon size={size} />;
  if (lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".cjs")) return <JsIcon size={size} />;
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return <HtmlIcon size={size} />;
  if (lower.endsWith(".css") || lower.endsWith(".scss") || lower.endsWith(".sass") || lower.endsWith(".less")) return <CssIcon size={size} />;
  if (lower.endsWith(".rs")) return <RustIcon size={size} />;
  if (lower.endsWith(".py")) return <PythonIcon size={size} />;
  if (lower.endsWith(".json") || lower.endsWith(".toml") || lower.endsWith(".yaml") || lower.endsWith(".yml")) return <JsonIcon size={size} />;
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return <MarkdownIcon size={size} />;
  return <GenericFileIcon size={size} />;
}

function extractFileActions(text: string, isStreaming = false): FileAction[] {
  const actionsMap = new Map<string, FileAction>();
  // Match code blocks with explicit file headers (e.g. ```typescript:src/index.ts or ```src/index.ts)
  const codeBlockRegex = /```([a-zA-Z0-9_\-./]+(?::[^\n]+)?)\n([\s\S]*?)(?:```|$)/g;
  let match;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    const fullMatch = match[0];
    const header = match[1].trim();
    const code = match[2];
    const isClosed = fullMatch.endsWith("```") && fullMatch.length > 3;

    let fileName = "";
    let language = header;

    if (header.includes(":")) {
      const parts = header.split(":");
      language = parts[0];
      fileName = parts.slice(1).join(":").trim();
    } else if (header && /\.[a-zA-Z0-9]+$/.test(header)) {
      fileName = header.trim();
    }

    if (fileName && code !== undefined) {
      const cleanFileName = fileName.replace(/^\.?\//, "");
      const trimmedCode = code.trimEnd();
      const lineCount = trimmedCode ? trimmedCode.split("\n").length : 0;
      actionsMap.set(cleanFileName, {
        fileName: cleanFileName,
        code,
        language,
        addedLines: lineCount,
        removedLines: 0,
        isNew: true,
        isStreaming: !isClosed || isStreaming,
      });
    }
  }

  return Array.from(actionsMap.values());
}

function cleanMessageProse(rawContent: string): string {
  if (!rawContent) return "";
  return rawContent
    // Remove internal HTML comments and delete directives, preserving all markdown and code blocks
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\[DELETE:\s*[^\n]+\]/gi, "")
    .trim();
}

function InlineFileDiff({
  action,
  onOpenFile,
  activeProject,
}: {
  action: FileAction;
  onOpenFile?: (path: string) => void;
  activeProject: ProjectInfo | null;
}) {
  const [copied, setCopied] = useState(false);
  const lines = useMemo(() => action.code.split("\n"), [action.code]);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(action.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleOpen = (e: React.MouseEvent) => {
    e.stopPropagation();
    onOpenFile?.(activeProject && !action.fileName.includes(":") ? `${activeProject.path}/${action.fileName}` : action.fileName);
  };

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        margin: "4px 0 6px 0",
        background: "#090d13",
        border: "1px solid rgba(255, 255, 255, 0.12)",
        borderRadius: 6,
        overflow: "hidden",
        fontSize: "11px",
        fontFamily: "ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, monospace",
        maxHeight: 280,
        display: "flex",
        flexDirection: "column",
        boxShadow: "0 4px 12px rgba(0, 0, 0, 0.35)",
      }}
    >
      {/* Diff Box Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "4px 8px",
          background: "rgba(255, 255, 255, 0.05)",
          borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
          fontSize: "10.5px",
          color: "var(--color-text-secondary)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <FileTechIcon fileName={action.fileName} size={12} />
          <span style={{ fontWeight: 600, color: "var(--color-text-primary)" }}>{action.fileName}</span>
          <span style={{ color: "#22c55e", fontSize: "10.5px", fontWeight: 600 }}>+{action.addedLines}</span>
          {action.removedLines > 0 && <span style={{ color: "#ef4444", fontSize: "10.5px", fontWeight: 600 }}>-{action.removedLines}</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button
            onClick={handleCopy}
            style={{
              background: "none",
              border: "none",
              color: "var(--color-text-tertiary)",
              cursor: "pointer",
              fontSize: "10px",
              padding: "1px 4px",
            }}
          >
            {copied ? "Copied!" : "Copy"}
          </button>
          <button
            onClick={handleOpen}
            style={{
              background: "rgba(239, 68, 68, 0.15)",
              border: "1px solid rgba(239, 68, 68, 0.35)",
              color: "#f87171",
              borderRadius: 3,
              cursor: "pointer",
              fontSize: "10px",
              padding: "1px 6px",
            }}
          >
            Open ↗
          </button>
        </div>
      </div>

      {/* Diff Lines Container */}
      <div style={{ overflowY: "auto", flex: 1, padding: "2px 0" }}>
        {lines.map((line: string, lIdx: number) => {
          const isDeleted = line.startsWith("-") && action.removedLines > 0;
          return (
            <div
              key={lIdx}
              style={{
                display: "flex",
                alignItems: "stretch",
                background: isDeleted ? "rgba(239, 68, 68, 0.14)" : "rgba(34, 197, 94, 0.1)",
                lineHeight: "19px",
                borderLeft: isDeleted ? "3px solid #ef4444" : "3px solid #22c55e",
              }}
            >
              <span
                style={{
                  width: 32,
                  minWidth: 32,
                  textAlign: "right",
                  paddingRight: 6,
                  color: isDeleted ? "rgba(239, 68, 68, 0.7)" : "rgba(34, 197, 94, 0.7)",
                  userSelect: "none",
                  fontSize: "10px",
                  background: "rgba(0, 0, 0, 0.2)",
                }}
              >
                {lIdx + 1}
              </span>
              <span
                style={{
                  width: 16,
                  minWidth: 16,
                  textAlign: "center",
                  fontWeight: "bold",
                  color: isDeleted ? "#ef4444" : "#22c55e",
                  userSelect: "none",
                  fontSize: "11px",
                }}
              >
                {isDeleted ? "-" : "+"}
              </span>
              <span
                style={{
                  color: isDeleted ? "#fca5a5" : "#86efac",
                  paddingLeft: 4,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                  flex: 1,
                }}
              >
                {line}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ExecutionTimeline({
  exploredFiles,
  fileActions,
  isStreaming,
  onOpenFile,
  activeProject,
}: {
  exploredFiles: string[];
  fileActions: FileAction[];
  isStreaming?: boolean;
  onOpenFile?: (path: string) => void;
  activeProject: ProjectInfo | null;
}) {
  const [exploredExpanded, setExploredExpanded] = useState(false);
  const [expandedDiffs, setExpandedDiffs] = useState<Record<string, boolean>>({});

  const toggleFileDiff = (fileName: string) => {
    setExpandedDiffs((prev) => ({
      ...prev,
      [fileName]: !prev[fileName],
    }));
  };

  const toggleAllDiffs = () => {
    const hasAnyExpanded = Object.values(expandedDiffs).some(Boolean);
    if (hasAnyExpanded) {
      setExpandedDiffs({});
    } else {
      const all: Record<string, boolean> = {};
      fileActions.forEach((a) => {
        all[a.fileName] = true;
      });
      setExpandedDiffs(all);
    }
  };

  const totalAdded = fileActions.reduce((sum, a) => sum + (a.addedLines || 0), 0);
  const totalRemoved = fileActions.reduce((sum, a) => sum + (a.removedLines || 0), 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5, margin: "4px 0 8px 0" }}>
      {/* Explored Files Row (Collapsible) */}
      {exploredFiles.length > 0 && (
        <div>
          <button
            onClick={() => setExploredExpanded(!exploredExpanded)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              background: "none",
              border: "none",
              color: "var(--color-text-secondary)",
              cursor: "pointer",
              padding: 0,
              fontSize: "11.5px",
            }}
          >
            <span style={{ color: "var(--color-text-secondary)" }}>
              Explored {exploredFiles.length} file{exploredFiles.length > 1 ? "s" : ""}
            </span>
            <ChevronRight size={11} style={{ transform: exploredExpanded ? "rotate(90deg)" : "none", transition: "transform 0.15s", color: "var(--color-text-tertiary)" }} />
          </button>

          {exploredExpanded && (
            <div style={{
              marginTop: 4,
              paddingLeft: 8,
              borderLeft: "1px solid rgba(255, 255, 255, 0.1)",
              display: "flex",
              flexDirection: "column",
              gap: 3,
            }}>
              {exploredFiles.map((file, idx) => (
                <div key={idx} style={{ display: "flex", alignItems: "center", gap: 5, color: "var(--color-text-secondary)", fontSize: "11px" }}>
                  <span style={{ color: "var(--color-text-tertiary)" }}>Analyzed</span>
                  <FileTechIcon fileName={file} size={13} />
                  <span
                    onClick={() => onOpenFile?.(activeProject ? `${activeProject.path}/${file}` : file)}
                    style={{ cursor: "pointer", color: "var(--color-text-primary)" }}
                  >
                    {file}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Created / Edited File Rows */}
      {fileActions.map((action, idx) => {
        const isCurrentlyWorking = isStreaming && idx === fileActions.length - 1;
        const isDiffExpanded = Boolean(expandedDiffs[action.fileName]);

        return (
          <div key={idx} style={{ display: "flex", flexDirection: "column" }}>
            <div
              onClick={() => toggleFileDiff(action.fileName)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: "12px",
                color: "var(--color-text-primary)",
                padding: "2px 0",
                cursor: "pointer",
                userSelect: "none",
              }}
            >
              <span style={{ color: isCurrentlyWorking ? "#f87171" : "var(--color-text-tertiary)", fontSize: "11.5px", fontWeight: isCurrentlyWorking ? 500 : 400 }}>
                {isCurrentlyWorking ? "Editing" : action.isNew ? "Created" : "Edited"}
              </span>
              <FileTechIcon fileName={action.fileName} size={13} />
              <span
                style={{
                  fontWeight: 600,
                  color: "var(--color-text-primary)",
                }}
              >
                {action.fileName}
              </span>
              <ChevronRight size={10} style={{ transform: isDiffExpanded ? "rotate(90deg)" : "none", transition: "transform 0.15s", color: "var(--color-text-tertiary)" }} />

              {isCurrentlyWorking ? (
                <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 5, fontSize: "11px", color: "#f87171", fontStyle: "italic" }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#ef4444", display: "inline-block", boxShadow: "0 0 6px #ef4444" }} />
                  <span>writing... +{action.addedLines} lines</span>
                </span>
              ) : (
                <span style={{ marginLeft: "auto", display: "inline-flex", gap: 4, fontSize: "11px", fontFamily: "monospace" }}>
                  <span style={{ color: "#22c55e" }}>+{action.addedLines}</span>
                  {action.removedLines > 0 ? <span style={{ color: "#ef4444" }}>-{action.removedLines}</span> : <span style={{ color: "var(--color-text-tertiary)" }}>-0</span>}
                </span>
              )}
            </div>

            {/* Expandable Inline Diff with Red (deleted) and Green (normal/added) code lines */}
            {isDiffExpanded && (
              <InlineFileDiff
                action={action}
                onOpenFile={onOpenFile}
                activeProject={activeProject}
              />
            )}
          </div>
        );
      })}

      {/* Summary Diff Pill */}
      {fileActions.length > 0 && !isStreaming && (
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "5px 9px",
          background: "rgba(255, 255, 255, 0.04)",
          border: "1px solid rgba(255, 255, 255, 0.08)",
          borderRadius: 6,
          marginTop: 3,
          fontSize: "11.5px",
        }}>
          <div
            onClick={toggleAllDiffs}
            style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", userSelect: "none" }}
          >
            <span style={{ fontWeight: 500, color: "var(--color-text-primary)" }}>
              {fileActions.length} file{fileActions.length > 1 ? "s" : ""} changed
            </span>
            <span style={{ fontFamily: "monospace", fontSize: "11px" }}>
              <span style={{ color: "#22c55e" }}>+{totalAdded}</span>{" "}
              <span style={{ color: totalRemoved > 0 ? "#ef4444" : "var(--color-text-tertiary)" }}>-{totalRemoved}</span>
            </span>
          </div>

          <button
            onClick={toggleAllDiffs}
            style={{
              background: "rgba(255, 255, 255, 0.06)",
              border: "1px solid rgba(255, 255, 255, 0.12)",
              borderRadius: 4,
              color: "var(--color-text-primary)",
              padding: "2px 7px",
              fontSize: "10.5px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <FileText size={11} /> {Object.values(expandedDiffs).some(Boolean) ? "Collapse" : "Review"}
          </button>
        </div>
      )}
    </div>
  );
}

interface AttachedItem {
  id: string;
  type: "image" | "document" | "file";
  name: string;
  size?: number;
  dataUrl?: string;
  filePath?: string;
  content?: string;
}

function ChooseModelChatCard({
  onSelectModel,
  onOpenSettings,
}: {
  onSelectModel?: (modelId: string) => void;
  onOpenSettings?: () => void;
}) {
  const quickPicks = [
    {
      id: "anthropic/claude-3-7-sonnet",
      name: "Claude 3.7 Sonnet",
      provider: "Anthropic",
      badge: "Flagship",
      desc: "Top frontier intelligence with hybrid reasoning & coding",
    },
    {
      id: "anthropic/claude-3-5-sonnet",
      name: "Claude 3.5 Sonnet",
      provider: "Anthropic",
      badge: "Precision",
      desc: "Fast, highly reliable software engineering & debugging",
    },
    {
      id: "openai/gpt-4o",
      name: "GPT-4o",
      provider: "OpenAI",
      badge: "Multimodal",
      desc: "Flagship versatile coding and general intelligence",
    },
    {
      id: "google/gemini-2.0-flash",
      name: "Gemini 2.0 Flash",
      provider: "Google",
      badge: "1M Context",
      desc: "Blazing fast response speed & massive context window",
    },
    {
      id: "deepseek/deepseek-reasoner",
      name: "DeepSeek R1",
      provider: "DeepSeek",
      badge: "Reasoning",
      desc: "Open reasoning model for algorithms and complex logic",
    },
    {
      id: "ollama/qwen2.5-coder:7b",
      name: "Qwen 2.5 Coder 7B",
      provider: "Local Ollama",
      badge: "100% Private",
      desc: "Runs locally on your device with no data sent to cloud",
    },
  ];

  return (
    <div
      style={{
        background: "linear-gradient(160deg, rgba(28, 5, 10, 0.98) 0%, rgba(14, 3, 6, 0.99) 100%)",
        border: "1px solid rgba(239, 68, 68, 0.35)",
        borderRadius: "14px",
        padding: "16px 14px",
        boxShadow: "0 12px 36px rgba(0, 0, 0, 0.7), 0 0 20px rgba(239, 68, 68, 0.12)",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        width: "100%",
        boxSizing: "border-box",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: "8px",
            background: "linear-gradient(135deg, rgba(239, 68, 68, 0.35), rgba(185, 28, 28, 0.2))",
            border: "1px solid rgba(239, 68, 68, 0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#f87171",
            flexShrink: 0,
            boxShadow: "0 0 12px rgba(239, 68, 68, 0.25)",
          }}
        >
          <Sparkles size={17} />
        </div>
        <div>
          <div style={{ fontSize: "13.5px", fontWeight: 600, color: "#ffffff", letterSpacing: "-0.01em" }}>
            Choose an AI Model to Begin
          </div>
          <div style={{ fontSize: "11.5px", color: "var(--color-text-secondary)", marginTop: 2, lineHeight: 1.45 }}>
            Csotic supports local offline models (via Ollama) and cloud engines. Click any model to connect:
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 2 }}>
        {quickPicks.map((pick) => (
          <button
            key={pick.id}
            onClick={() => onSelectModel?.(pick.id)}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "7px 10px",
              borderRadius: "8px",
              background: "rgba(255, 255, 255, 0.03)",
              border: "1px solid rgba(255, 255, 255, 0.07)",
              cursor: "pointer",
              transition: "all 0.15s cubic-bezier(0.16, 1, 0.3, 1)",
              textAlign: "left",
              gap: 8,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(239, 68, 68, 0.14)";
              e.currentTarget.style.borderColor = "rgba(239, 68, 68, 0.45)";
              e.currentTarget.style.transform = "translateX(3px)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(255, 255, 255, 0.03)";
              e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.07)";
              e.currentTarget.style.transform = "translateX(0)";
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1 }}>
              <div style={{ width: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                {getModelBrandLogo(pick.id, pick.name, "", 16)}
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: "12px", fontWeight: 600, color: "#ffffff", whiteSpace: "nowrap" }}>
                    {pick.name}
                  </span>
                  <span
                    style={{
                      fontSize: "9.5px",
                      padding: "1px 5px",
                      borderRadius: "4px",
                      background: pick.id.startsWith("ollama") ? "rgba(168, 85, 247, 0.16)" : "rgba(239, 68, 68, 0.15)",
                      color: pick.id.startsWith("ollama") ? "#c084fc" : "#f87171",
                      border: `1px solid ${pick.id.startsWith("ollama") ? "rgba(168, 85, 247, 0.3)" : "rgba(239, 68, 68, 0.25)"}`,
                      fontWeight: 500,
                    }}
                  >
                    {pick.badge}
                  </span>
                </div>
                <div style={{ fontSize: "10.5px", color: "var(--color-text-tertiary)", marginTop: 1, textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>
                  {pick.desc}
                </div>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 3, color: "#f87171", fontSize: "11px", fontWeight: 600, flexShrink: 0 }}>
              <span>Select</span>
              <ChevronRight size={13} />
            </div>
          </button>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 6, borderTop: "1px solid rgba(255, 255, 255, 0.06)" }}>
        <span style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>
          Need custom endpoint or API keys?
        </span>
        {onOpenSettings && (
          <button
            onClick={onOpenSettings}
            style={{
              background: "none",
              border: "none",
              color: "#f87171",
              fontSize: "11px",
              fontWeight: 500,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 3,
              padding: "2px 6px",
              borderRadius: "4px",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
            onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}
          >
            <span>Open AI Settings</span>
            <ChevronRight size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

export interface AiCoderSlidePanelProps {
  activeProject: ProjectInfo | null;
  activeModel: string | null;
  modelsList?: ModelMetadata[];
  onSelectModel?: (modelId: string) => void;
  onOpenSettings?: () => void;
  conversationId: number;
  onConversationTitleChange: (conversationId: number, title: string) => void;
  permissionProfile: "read_only" | "edit" | "developer" | "full_automation";
  attachedProjectPaths: string[];
  onClose: () => void;
  onApplyToActiveTab: (code: string) => void;
  onInsertAtCursor: (code: string) => void;
  activeFileName: string | null;
  activeFileContent?: string | null;
  activeFilePath?: string | null;
  conversations?: Array<{ id: number; title: string }>;
  onSelectConversation?: (id: number) => void;
  onNewConversation?: () => void;
  onDeleteConversation?: (id: number) => void;
  onOpenFile?: (path: string) => void;
  onTabContentChange?: (tabId: string, newContent: string) => void;
}

export function AiCoderSlidePanel({
  activeProject,
  activeModel,
  modelsList,
  onSelectModel,
  onOpenSettings,
  conversationId,
  onConversationTitleChange,
  permissionProfile,
  attachedProjectPaths,
  onClose,
  onApplyToActiveTab,
  onInsertAtCursor,
  activeFileName,
  activeFileContent,
  activeFilePath,
  conversations = [],
  onSelectConversation,
  onNewConversation,
  onDeleteConversation,
  onOpenFile,
  onTabContentChange,
}: AiCoderSlidePanelProps) {
  const [messagesByConversation, setMessagesByConversation] = useState<Record<number, Message[]>>(() => {
    try { return JSON.parse(localStorage.getItem("forge.conversation-messages") ?? "{}"); }
    catch { return {}; }
  });
  const [inputText, setInputText] = useState("");
  const [waiting, setWaiting] = useState(false);
  const [convDropdownOpen, setConvDropdownOpen] = useState(false);
  const convDropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const activeRequest = useRef<{ id: string; conversationId: number } | null>(null);
  const openedFilesRef = useRef<Set<string>>(new Set());
  const lastWrittenCodeRef = useRef<Record<string, string>>({});
  const messages = messagesByConversation[conversationId] ?? [greeting(activeModel, attachedProjectPaths)];

  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingText, setEditingText] = useState("");

  const handleBranchFromMessage = (idx: number, promptSnippet: string) => {
    const branchSlice = messages.slice(0, idx + 1);
    const newId = Date.now();
    const cleanSnippet = promptSnippet.replace(/<(thought|think)>[\s\S]*?(?:<\/\1>|$)/gi, "").trim();
    const newTitle = `Branch: ${cleanSnippet.slice(0, 20) || "Chat"}${cleanSnippet.length > 20 ? "…" : ""}`;

    setMessagesByConversation((prev) => {
      const updated = { ...prev, [newId]: branchSlice };
      try { localStorage.setItem("forge.conversation-messages", JSON.stringify(updated)); } catch {}
      return updated;
    });

    try {
      const savedConvs = JSON.parse(localStorage.getItem("forge.conversations") ?? "[]");
      const newConv = {
        id: newId,
        title: newTitle,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        pinned: false,
        archived: false,
        permissionProfile,
        projectPaths: attachedProjectPaths,
      };
      localStorage.setItem("forge.conversations", JSON.stringify([...savedConvs, newConv]));
    } catch {}

    onSelectConversation?.(newId);
  };

  const handleDeleteMessage = (idx: number) => {
    updateMessages(conversationId, (curr) => curr.filter((_, i) => i !== idx));
  };

  const handleSaveAndResubmit = (idx: number, newPrompt: string) => {
    if (!newPrompt.trim()) return;
    setEditingIndex(null);
    setEditingText("");
    const sliced = messages.slice(0, idx);
    updateMessages(conversationId, () => sliced);
    void handleSend(newPrompt.trim());
  };

  // Attachments state
  const [attachedItems, setAttachedItems] = useState<AttachedItem[]>([]);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const attachMenuRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [projectFiles, setProjectFiles] = useState<string[]>([]);
  const [projectFilter, setProjectFilter] = useState("");
  const projectPickerRef = useRef<HTMLDivElement>(null);

  // Close dropdowns on outside click
  useEffect(() => {
    if (!convDropdownOpen && !projectPickerOpen && !attachMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (convDropdownRef.current && !convDropdownRef.current.contains(e.target as Node)) {
        setConvDropdownOpen(false);
      }
      if (projectPickerRef.current && !projectPickerRef.current.contains(e.target as Node)) {
        setProjectPickerOpen(false);
      }
      if (attachMenuRef.current && !attachMenuRef.current.contains(e.target as Node)) {
        setAttachMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [convDropdownOpen, projectPickerOpen, attachMenuOpen]);

  const handleAttachImages = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        setAttachedItems((prev) => [
          ...prev,
          {
            id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            type: "image",
            name: file.name,
            size: file.size,
            dataUrl,
          },
        ]);
      };
      reader.readAsDataURL(file);
    });
    e.target.value = "";
  };

  const handleAttachDocuments = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    Array.from(files).forEach((file) => {
      const isImage = file.type.startsWith("image/");
      const reader = new FileReader();
      if (isImage) {
        reader.onload = () => {
          setAttachedItems((prev) => [
            ...prev,
            {
              id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              type: "image",
              name: file.name,
              size: file.size,
              dataUrl: reader.result as string,
            },
          ]);
        };
        reader.readAsDataURL(file);
      } else {
        reader.onload = () => {
          setAttachedItems((prev) => [
            ...prev,
            {
              id: `doc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              type: file.name.endsWith(".pdf") || file.name.endsWith(".doc") || file.name.endsWith(".docx") ? "document" : "file",
              name: file.name,
              size: file.size,
              content: (reader.result as string) || "",
            },
          ]);
        };
        reader.readAsText(file);
      }
    });
    e.target.value = "";
  };

  const handleSelectFiles = async (filterType?: "image" | "doc" | "file") => {
    setAttachMenuOpen(false);
    try {
      const res = await filesystem.selectFiles();
      if (res.success && res.data && Array.isArray((res.data as any).files) && (res.data as any).files.length > 0) {
        const paths = (res.data as any).files as string[];
        for (const filePath of paths) {
          const name = filePath.split(/[/\\]/).pop() || filePath;
          const isImg = /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(filePath);
          if (isImg) {
            setAttachedItems((prev) => {
              if (prev.some((a) => a.filePath === filePath || a.name === name)) return prev;
              return [
                ...prev,
                {
                  id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                  type: "image",
                  name,
                  filePath,
                },
              ];
            });
          } else {
            const fileRes = await filesystem.readFile(filePath);
            const content = fileRes.success && fileRes.data ? ((fileRes.data as any).content || "") : "";
            setAttachedItems((prev) => {
              if (prev.some((a) => a.filePath === filePath || a.name === name)) return prev;
              return [
                ...prev,
                {
                  id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                  type: name.endsWith(".pdf") || name.endsWith(".doc") || name.endsWith(".docx") ? "document" : "file",
                  name,
                  filePath,
                  content,
                },
              ];
            });
          }
        }
        return;
      }
    } catch {
      // fallback to HTML inputs
    }

    if (filterType === "image") {
      imageInputRef.current?.click();
    } else if (filterType === "doc") {
      docInputRef.current?.click();
    } else {
      fileInputRef.current?.click();
    }
  };

  const handleAttachActiveFile = () => {
    if (!activeFileName) return;
    const name = activeFileName.split(/[/\\]/).pop() || "active_file";
    setAttachedItems((prev) => {
      if (prev.some((a) => a.name === name)) return prev;
      return [
        ...prev,
        {
          id: `file-${Date.now()}`,
          type: "file",
          name,
          filePath: activeFilePath || activeFileName,
          content: activeFileContent || "",
        },
      ];
    });
  };

  const handleOpenProjectPicker = async () => {
    try {
      const treeRes = await filesystem.getFileTree();
      if (treeRes.success && treeRes.data && Array.isArray((treeRes.data as any).files)) {
        const list = (treeRes.data as any).files
          .filter((f: any) => !f.is_dir)
          .map((f: any) => f.relative_path);
        setProjectFiles(list);
      }
      setProjectPickerOpen(true);
    } catch {
      setProjectPickerOpen(true);
    }
  };

  const handleAttachProjectFile = async (relPath: string) => {
    try {
      const res = await filesystem.readFile(relPath);
      const content = res.success && res.data ? ((res.data as any).content || "") : "";
      const name = relPath.split(/[/\\]/).pop() || relPath;
      setAttachedItems((prev) => {
        if (prev.some((a) => a.name === name)) return prev;
        return [
          ...prev,
          {
            id: `proj-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            type: "file",
            name,
            filePath: relPath,
            content,
          },
        ];
      });
      setProjectPickerOpen(false);
    } catch (err) {
      console.error(err);
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.indexOf("image") !== -1) {
        const blob = item.getAsFile();
        if (blob) {
          const reader = new FileReader();
          reader.onload = () => {
            setAttachedItems((prev) => [
              ...prev,
              {
                id: `pasted-img-${Date.now()}`,
                type: "image",
                name: `Screenshot ${new Date().toLocaleTimeString().replace(/:/g, "-")}.png`,
                size: blob.size,
                dataUrl: reader.result as string,
              },
            ]);
          };
          reader.readAsDataURL(blob);
        }
      }
    }
  };

  const handleDropFiles = (files: FileList) => {
    Array.from(files).forEach((file) => {
      const isImg = file.type.startsWith("image/");
      const reader = new FileReader();
      if (isImg) {
        reader.onload = () => {
          setAttachedItems((prev) => [
            ...prev,
            {
              id: `drop-img-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              type: "image",
              name: file.name,
              size: file.size,
              dataUrl: reader.result as string,
            },
          ]);
        };
        reader.readAsDataURL(file);
      } else {
        reader.onload = () => {
          setAttachedItems((prev) => [
            ...prev,
            {
              id: `drop-doc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              type: "file",
              name: file.name,
              size: file.size,
              content: (reader.result as string) || "",
            },
          ]);
        };
        reader.readAsText(file);
      }
    });
  };

  const removeAttachment = (id: string) => {
    setAttachedItems((prev) => prev.filter((a) => a.id !== id));
  };

  const handleDelete = (idToDelete: number) => {
    if (waiting && idToDelete === conversationId) {
      handleStop();
    }
    setMessagesByConversation((prev) => {
      const next = { ...prev };
      delete next[idToDelete];
      try { localStorage.setItem("forge.conversation-messages", JSON.stringify(next)); }
      catch {}
      return next;
    });
    onDeleteConversation?.(idToDelete);
  };

  const updateMessages = (id: number, update: (current: Message[]) => Message[]) => {
    setMessagesByConversation((current) => {
      const existing = current[id] ?? [greeting(activeModel, attachedProjectPaths)];
      return { ...current, [id]: update(existing) };
    });
  };

  const activeObjectiveRef = useRef<string>("");
  const activeStartTimeRef = useRef<number>(0);

  const handleStop = () => {
    activeRequest.current = null;
    openedFilesRef.current.clear();
    lastWrittenCodeRef.current = {};
    setWaiting(false);
    void emit("agent-state-update", {
      status: "idle",
      objective: "No active task",
      plan_steps: [],
      current_step_idx: null,
      elapsed_ms: 0,
    });
    updateMessages(conversationId, (current) => {
      const next = [...current];
      const last = next[next.length - 1];
      if (last && last.sender === "agent") {
        if (last.text === "...") {
          next[next.length - 1] = { sender: "agent", text: "*(Generation stopped by user)*" };
        } else {
          next[next.length - 1] = { sender: "agent", text: `${last.text}\n\n*(Stopped by user)*` };
        }
      }
      return next;
    });
  };

  useEffect(() => {
    localStorage.setItem("forge.conversation-messages", JSON.stringify(messagesByConversation));
  }, [messagesByConversation]);

  useEffect(() => {
    setMessagesByConversation((current) => current[conversationId] ? current : { ...current, [conversationId]: [greeting(activeModel, attachedProjectPaths)] });
    setInputText("");
    setWaiting(false);
    openedFilesRef.current.clear();
    lastWrittenCodeRef.current = {};
    inputRef.current?.focus();
  }, [conversationId, activeModel, attachedProjectPaths]);

  const [userScrolledUp, setUserScrolledUp] = useState(false);

  const handleChatScroll = () => {
    if (!chatContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = chatContainerRef.current;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 70;
    setUserScrolledUp(!isNearBottom);
  };

  useEffect(() => {
    if (!userScrolledUp) {
      endRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, userScrolledUp]);

  useEffect(() => {
    let unlistenModelStream: (() => void) | undefined;
    let unlistenAgentChat: (() => void) | undefined;
    let unlistenFileEdited: (() => void) | undefined;
    let disposed = false;

    // 1. Listen to canonical Agent Chat stream
    void listen<{ request_id?: string; text?: string; finished?: boolean }>("agent-chat-response", (event) => {
      const request = activeRequest.current;
      if (!request || (event.payload.request_id && event.payload.request_id !== request.id)) return;

      updateMessages(request.conversationId, (current) => {
        const next = [...current];
        const last = next[next.length - 1];
        if (event.payload.text) {
          const prevText = (!last || last.text === "..." || last.sender !== "agent") ? "" : last.text;
          // Avoid duplicate appending if the event payload contains the full text instead of a delta
          if (event.payload.text === prevText) {
            return next;
          }
          const newText = `${prevText}${event.payload.text}`;
          next[next.length - 1] = { sender: "agent", text: newText, exploredFiles: last?.exploredFiles };
        }
        return next;
      });

      if (event.payload.finished) {
        activeRequest.current = null;
        setWaiting(false);
      }
    }).then((stop) => {
      if (disposed) stop();
      else unlistenAgentChat = stop;
    });

    // 2. Listen to canonical Agent File Edited events
    void listen<{ request_id: string; path: string; oldContent: string; newContent: string }>("agent-file-edited", (event) => {
      const { path, newContent } = event.payload;
      const fullPath = activeProject && !path.includes(":") && !path.startsWith("/") && !path.startsWith("\\")
        ? `${activeProject.path}/${path}`.replace(/\\/g, "/")
        : path;

      if (!openedFilesRef.current.has(fullPath)) {
        openedFilesRef.current.add(fullPath);
        onOpenFile?.(fullPath);
      }

      if (onTabContentChange) {
        onTabContentChange(fullPath, newContent);
      }
    }).then((stop) => {
      if (disposed) stop();
      else unlistenFileEdited = stop;
    });

    // 3. Listen to Model Stream (Pure Conversational / Non-Agent fallback)
    void listen<{ request_id?: string; delta?: string; error?: string; finished: boolean }>("model-stream", (event) => {
      const request = activeRequest.current;
      if (!request || (event.payload.request_id && event.payload.request_id !== request.id)) return;
      
      updateMessages(request.conversationId, (current) => {
        const next = [...current];
        const last = next[next.length - 1];
        if (event.payload.error) {
          next[next.length - 1] = { sender: "agent", text: `⚠️ ${event.payload.error}`, isError: true, exploredFiles: last?.exploredFiles };
        } else if (event.payload.delta) {
          const prevText = (!last || last.text === "..." || last.sender !== "agent") ? "" : last.text;
          const currentAccumulated = `${prevText}${event.payload.delta}`;
          next[next.length - 1] = { sender: "agent", text: currentAccumulated, exploredFiles: last?.exploredFiles };
        }
        return next;
      });

      if (event.payload.finished) {
        activeRequest.current = null;
        setWaiting(false);
      }
    }).then((stop) => {
      if (disposed) stop();
      else unlistenModelStream = stop;
    });

    return () => {
      disposed = true;
      unlistenModelStream?.();
      unlistenAgentChat?.();
      unlistenFileEdited?.();
    };
  }, [activeProject, onOpenFile, onTabContentChange, activeFileName, activeFilePath]);


  const handleSend = async (customPrompt?: string) => {
    const textToSend = (typeof customPrompt === "string" ? customPrompt : inputText).trim();
    if (!textToSend) return;
    if (!activeModel) {
      updateMessages(conversationId, (current) => [...current, { sender: "agent", text: "CHOOSE_MODEL_PROMPT" }]);
      return;
    }

    if (typeof customPrompt !== "string") setInputText("");
    setWaiting(true);
    setUserScrolledUp(false);
    activeObjectiveRef.current = textToSend;
    activeStartTimeRef.current = Date.now();
    onConversationTitleChange(conversationId, textToSend);

    void emit("agent-state-update", {
      status: "executing",
      objective: textToSend,
      plan_steps: [
        { description: "Analyzing workspace files & context", status: "completed" },
        { description: `Generating solution with ${activeModel || "AI"}`, status: "running" },
      ],
      current_step_idx: 1,
      elapsed_ms: 0,
    });

    const exploredForThisPrompt: string[] = [];

    const requestId = `req-${Date.now()}`;
    activeRequest.current = { id: requestId, conversationId };

    try {
      const isLocal = isLocalModel(activeModel);

      // Ready cloud API LLMs (Anthropic Claude, OpenAI, Gemini, Groq, DeepSeek, OpenRouter)
      // are already instruction-tuned; heavy prompt boilerplate wastes tokens and degrades performance.
      // Custom agent prompt engineering is strictly reserved for local LLMs (Ollama).
      let systemPrompt = isLocal ? CODING_AGENT_PROMPT : "";

      // Crucial workspace and file context are preserved so both cloud and local models have necessary technical grounding
      if (activeProject) {
        const workspaceInfo = `[Active Project Workspace]\nProject: ${activeProject.name}\nRoot Path: ${activeProject.path}\nPermission Profile: ${permissionProfile}`;
        systemPrompt = systemPrompt ? `${systemPrompt}\n\n${workspaceInfo}` : workspaceInfo;

        if (activeFileName && activeFileContent) {
          const cappedActive = activeFileContent.length > 50000 
            ? activeFileContent.slice(0, 50000) + "\n...[truncated for length]" 
            : activeFileContent;
          systemPrompt += `\n\n[Currently Active Open Editor File: ${activeFilePath || activeFileName}]\n\`\`\`\n${cappedActive}\n\`\`\``;
        }
      }

    const imagesToSend = attachedItems
      .filter((a) => a.type === "image" && (a.dataUrl || a.filePath))
      .map((a) => a.dataUrl || a.filePath || "");

    const docsToSend = attachedItems.filter((a) => a.type !== "image" || (!a.dataUrl && !a.filePath));
    if (docsToSend.length > 0) {
      systemPrompt = systemPrompt ? `${systemPrompt}\n\n` : "";
      systemPrompt += `[USER ATTACHED DOCUMENTS & FILES (${docsToSend.length})]:`;
      for (const doc of docsToSend) {
        systemPrompt += `\n\n--- Attached File: ${doc.name} ---\n\`\`\`\n${doc.content || ""}\n\`\`\``;
      }
    }

    const currentAttachedCopies = [...attachedItems];
    setAttachedItems([]);

    updateMessages(conversationId, (current) => [
      ...current,
      {
        sender: "user",
        text: textToSend,
        attachments: currentAttachedCopies.map((a) => ({
          path: a.dataUrl || a.filePath || a.name,
          name: a.name,
          kind: a.type === "image" ? "image" : a.name.endsWith(".pdf") ? "pdf" : "document",
        })),
      },
      { sender: "agent", text: "...", exploredFiles: exploredForThisPrompt }
    ]);

    // System prompt directives are strictly applied to local LLMs
    if (isLocal) {
      const globalRules = localStorage.getItem("forge.global_ai_rules");
      if (globalRules && globalRules.trim()) {
        systemPrompt += `\n\n[GLOBAL USER DIRECTIVES & RULES]:\n${globalRules.trim()}`;
      }

      systemPrompt += `\n\n[EXECUTION DIRECTIVES]:
- For implementation and bug fixes: apply minimal, precise, and verified changes.
- For new features and projects: generate all necessary production-ready components.
- For questions, reviews, or analysis: provide clear technical explanations.
- Deliver robust, complete solutions directly without refusal, lecturing, or placeholders.`;
    }

    // Build conversation history so the AI remembers prior context (pruning refusal loops)
    const historyToSend = messages
      .filter((m) => {
        if (!m.text || m.text === "..." || m.text.startsWith("⚠️ Error:")) return false;
        if (m.sender === "agent") {
          const lower = m.text.toLowerCase();
          if (
            lower.includes("i cannot fulfill") ||
            lower.includes("i apologize, but i cannot") ||
            lower.includes("i am unable to provide") ||
            lower.includes("as an ai language model")
          ) {
            return false;
          }
        }
        return true;
      })
      .map((m) => {
        const cleanContent = m.text.replace(/<(thought|think)>[\s\S]*?(?:<\/\1>|$)/gi, "").trim() || m.text;
        return {
          role: m.sender === "user" ? "user" : "assistant",
          content: cleanContent,
        };
      });

    let res: any;
    if (activeProject) {
      // Canonical Deterministic Agent Pathway
      res = await agent.executeRequest(textToSend, {
        projectPath: activeProject.path,
        modelId: activeModel,
        permissionProfile: permissionProfile || "developer",
        requestId,
        imagePaths: imagesToSend,
        history: historyToSend,
      });
    } else {
      // Conversational fallback when no workspace project is opened
      res = await models.streamPrompt(activeModel, textToSend, systemPrompt, requestId, imagesToSend, historyToSend);
    }

    if (res && !res.success) {
      throw new Error(res.error?.message || "AI service failed to process request.");
    }
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      updateMessages(conversationId, (current) => {
        const next = [...current];
        next[next.length - 1] = { sender: "agent", text: `⚠️ Error: ${errMsg}`, isError: true, exploredFiles: exploredForThisPrompt };
        return next;
      });
      setWaiting(false);
      activeRequest.current = null;
      void CustomDialog.alert(errMsg, "AI Assistant Error");
    }
  };


  // Extract code blocks from the last agent message
  const lastAgentMsg = [...messages].reverse().find((m) => m.sender === "agent");
  const codeBlockMatch = lastAgentMsg?.text.match(/```[\s\S]*?\n([\s\S]*?)```/);
  const extractedCode = (!waiting && codeBlockMatch) ? codeBlockMatch[1].trim() : null;

  const activeConv = conversations.find((c) => c.id === conversationId);
  const activeConvTitle = activeConv ? activeConv.title : "AI Coder";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Slide Header */}
      <div style={{
        padding: "6px 10px",
        borderBottom: "1px solid var(--color-border-subtle)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        background: "var(--color-bg-base)",
        gap: 6,
        boxSizing: "border-box",
        width: "100%",
        minWidth: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0, flex: "1 1 auto", position: "relative" }} ref={convDropdownRef}>
          <Sparkles size={13} style={{ color: "var(--color-accent-primary)", flexShrink: 0 }} />

          <button
            onClick={() => setConvDropdownOpen((v) => !v)}
            title="Switch or manage conversations"
            style={{
              background: convDropdownOpen ? "rgba(239, 68, 68, 0.18)" : "rgba(255,255,255,0.06)",
              border: `1px solid ${convDropdownOpen ? "rgba(239, 68, 68, 0.4)" : "var(--color-border-subtle)"}`,
              borderRadius: "var(--radius-sm)",
              color: "var(--color-text-primary)",
              fontSize: "11px",
              fontWeight: 600,
              padding: "2px 5px",
              minWidth: 35,
              maxWidth: 90,
              display: "flex",
              alignItems: "center",
              gap: 3,
              cursor: "pointer",
              outline: "none",
              flexShrink: 1,
            }}
          >
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {activeConvTitle}
            </span>
            <ChevronDown size={10} style={{ flexShrink: 0, opacity: 0.7, transform: convDropdownOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s ease" }} />
          </button>

          {/* Direct Delete Active Conversation Button */}
          {onDeleteConversation && (
            <button
              onClick={() => handleDelete(conversationId)}
              title="Delete active conversation"
              style={{
                background: "transparent",
                border: "none",
                color: "var(--color-text-tertiary)",
                borderRadius: "var(--radius-sm)",
                padding: "2px 4px",
                display: "flex",
                alignItems: "center",
                cursor: "pointer",
                flexShrink: 0,
                transition: "color 0.15s ease, background 0.15s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "#ef4444";
                e.currentTarget.style.background = "rgba(239, 68, 68, 0.12)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = "var(--color-text-tertiary)";
                e.currentTarget.style.background = "transparent";
              }}
            >
              <Trash2 size={11} />
            </button>
          )}

          <button
            onClick={() => {
              onNewConversation?.();
              setConvDropdownOpen(false);
            }}
            title="New Chat"
            style={{
              background: "rgba(239, 68, 68, 0.15)",
              border: "1px solid rgba(239, 68, 68, 0.35)",
              color: "#f87171",
              borderRadius: "var(--radius-sm)",
              padding: "2px 5px",
              fontSize: "10px",
              fontWeight: 500,
              display: "flex",
              alignItems: "center",
              gap: 2,
              cursor: "pointer",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            <Plus size={10} /> New
          </button>

          {/* Custom Popover Dropdown Menu */}
          {convDropdownOpen && (
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 5px)",
                left: 0,
                zIndex: 100,
                minWidth: 230,
                maxWidth: 290,
                maxHeight: 260,
                overflowY: "auto",
                background: "var(--color-flyout-bg, #202024)",
                border: "1px solid var(--color-border-default, #2e2e34)",
                borderRadius: "var(--radius-md)",
                boxShadow: "0 8px 24px rgba(0, 0, 0, 0.5)",
                padding: "4px",
                display: "flex",
                flexDirection: "column",
                gap: "2px",
              }}
            >
              <div style={{ padding: "4px 8px 3px 8px", fontSize: "10px", fontWeight: 700, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                Conversations ({conversations.length})
              </div>

              {conversations.map((c) => {
                const isActive = c.id === conversationId;
                return (
                  <div
                    key={c.id}
                    onClick={() => {
                      onSelectConversation?.(c.id);
                      setConvDropdownOpen(false);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "5px 8px",
                      borderRadius: "var(--radius-sm)",
                      background: isActive ? "rgba(239, 68, 68, 0.18)" : "transparent",
                      color: isActive ? "#f87171" : "var(--color-text-primary)",
                      fontSize: "11.5px",
                      fontWeight: isActive ? 600 : 400,
                      cursor: "pointer",
                      gap: 6,
                      transition: "background 0.15s ease",
                    }}
                    onMouseEnter={(e) => {
                      if (!isActive) e.currentTarget.style.background = "rgba(239, 68, 68, 0.08)";
                    }}
                    onMouseLeave={(e) => {
                      if (!isActive) e.currentTarget.style.background = "transparent";
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, flex: 1 }}>
                      <MessageSquare size={12} style={{ opacity: isActive ? 1 : 0.5, flexShrink: 0 }} />
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {c.title || `Chat #${c.id}`}
                      </span>
                    </div>

                    {onDeleteConversation && conversations.length > 1 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteConversation(c.id);
                        }}
                        style={{ background: "none", border: "none", color: "var(--color-text-tertiary)", cursor: "pointer", padding: 2, display: "flex", alignItems: "center" }}
                        title="Delete chat"
                        onMouseEnter={(e) => (e.currentTarget.style.color = "#ef4444")}
                        onMouseLeave={(e) => (e.currentTarget.style.color = "var(--color-text-tertiary)")}
                      >
                        <Trash2 size={11} />
                      </button>
                    )}
                  </div>
                );
              })}

              <div style={{ height: "1px", background: "rgba(239, 68, 68, 0.15)", margin: "4px 0" }} />

              <button
                onClick={() => {
                  onNewConversation?.();
                  setConvDropdownOpen(false);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "5px 8px",
                  borderRadius: "var(--radius-sm)",
                  color: "#f87171",
                  fontSize: "11.5px",
                  fontWeight: 500,
                  background: "transparent",
                  cursor: "pointer",
                  width: "100%",
                  textAlign: "left",
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = "rgba(239, 68, 68, 0.15)"}
                onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
              >
                <Plus size={12} /> New Conversation
              </button>
            </div>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>

          {onSelectModel && (
            <ModelSelectorDropdown
              modelsList={modelsList}
              activeModel={activeModel}
              onSelectModel={onSelectModel}
              onOpenSettings={onOpenSettings}
              alignRight={true}
              compact={true}
            />
          )}

          <button
            onClick={onClose}
            style={{
              background: "rgba(255, 255, 255, 0.04)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              borderRadius: 4,
              cursor: "pointer",
              color: "var(--color-text-tertiary)",
              width: 20,
              height: 20,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              transition: "all 0.15s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "#ef4444";
              e.currentTarget.style.background = "rgba(239, 68, 68, 0.15)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "var(--color-text-tertiary)";
              e.currentTarget.style.background = "rgba(255, 255, 255, 0.04)";
            }}
            title="Close AI Assistant Drawer"
          >
            <X size={12} />
          </button>
        </div>
      </div>

      {/* Code Insertion Actions Bar */}
      {extractedCode && (
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 10px",
          background: "rgba(239, 68, 68, 0.12)",
          borderBottom: "1px solid rgba(239, 68, 68, 0.25)",
        }}>
          <span style={{ fontSize: "11px", color: "#f87171", flex: 1, fontWeight: 500 }}>
            ⚡ Generated Code Ready
          </span>
          <button
            className="btn btn--secondary"
            onClick={() => onApplyToActiveTab(extractedCode)}
            style={{ fontSize: "10.5px", padding: "3px 8px", display: "flex", alignItems: "center", gap: 4 }}
          >
            <Zap size={11} style={{ color: "#eab308" }} /> Replace Tab
          </button>
          <button
            className="btn btn--secondary"
            onClick={() => onInsertAtCursor(extractedCode)}
            style={{ fontSize: "10.5px", padding: "3px 8px", display: "flex", alignItems: "center", gap: 4 }}
          >
            <ClipboardPaste size={11} style={{ color: "#f87171" }} /> Insert at Cursor
          </button>
        </div>
      )}

      {/* Messages */}
      <div
        ref={chatContainerRef}
        onScroll={handleChatScroll}
        style={{ flex: 1, overflowY: "auto", padding: "10px", display: "flex", flexDirection: "column", gap: 10, minHeight: 0 }}
      >
        {messages.map((m, idx) => {
          if (isErrorMessage(m)) {
            return (
              <div
                key={idx}
                className="chat-message-row"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  maxWidth: "96%",
                  alignSelf: "flex-start",
                  margin: "2px 0",
                }}
              >
                <MessageErrorCard
                  rawText={m.text}
                  onRetry={() => {
                    const prevUserMsg = [...messages.slice(0, idx)].reverse().find((item) => item.sender === "user");
                    if (prevUserMsg) {
                      handleDeleteMessage(idx);
                      void handleSend(prevUserMsg.text);
                    }
                  }}
                  onDismiss={() => handleDeleteMessage(idx)}
                />
              </div>
            );
          }

          // Check if this is the "Choose an AI Model" onboarding prompt
          const isChooseModelPrompt = !activeModel && (
            m.text === "CHOOSE_MODEL_PROMPT" ||
            m.text.includes("select a local or cloud model") ||
            m.text.includes("select an AI model") ||
            (idx === 0 && m.sender === "agent" && messages.length === 1)
          );

          if (isChooseModelPrompt) {
            return (
              <div
                key={idx}
                className="chat-message-row"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  width: "100%",
                  alignSelf: "center",
                  margin: "4px 0",
                }}
              >
                <ChooseModelChatCard
                  onSelectModel={onSelectModel}
                  onOpenSettings={onOpenSettings}
                />
              </div>
            );
          }

          let rawText = m.text;
          if (activeModel && (rawText === "CHOOSE_MODEL_PROMPT" || rawText.includes("select a local or cloud model") || rawText.includes("select an AI model"))) {
            const foundModel = (modelsList && modelsList.length > 0 ? modelsList : DEFAULT_AI_MODELS).find((item) => item.id === activeModel);
            const modelName = foundModel?.name || activeModel.split("/").pop() || activeModel;
            rawText = `Hello! I'm ready to assist you using **${modelName}**. What would you like to build or code today? You can write code in the editor, ask me to refactor with \`Ctrl+K\`, stage git commits, or ask questions here.`;
          }

          const { thought, content } = m.sender === "agent" ? parseThoughtAndContent(rawText) : { thought: null, content: rawText };
          const isCurrentStreaming = waiting && idx === messages.length - 1;
          const fileActions = (activeProject && m.sender === "agent" && content) ? extractFileActions(content, isCurrentStreaming) : [];
          const explored = activeProject ? (m.exploredFiles || []) : [];
          const prose = cleanMessageProse(content);

          return (
            <div
              key={idx}
              className="chat-message-row"
              style={{
                display: "flex",
                flexDirection: m.sender === "user" ? "row-reverse" : "row",
                alignItems: "flex-start",
                gap: 6,
                maxWidth: "95%",
                alignSelf: m.sender === "user" ? "flex-end" : "flex-start",
              }}
            >
              <div
                style={{
                  background: m.sender === "user" ? "rgba(239, 68, 68, 0.16)" : "rgba(255, 255, 255, 0.03)",
                  border: m.sender === "user" ? "1px solid rgba(239, 68, 68, 0.35)" : "1px solid rgba(239, 68, 68, 0.12)",
                  borderRadius: "12px",
                  borderBottomRightRadius: m.sender === "user" ? "4px" : "12px",
                  borderBottomLeftRadius: m.sender === "agent" ? "4px" : "12px",
                  padding: "8px 12px",
                  position: "relative",
                  color: "var(--color-text-primary)",
                  fontSize: "12.5px",
                  lineHeight: 1.55,
                  flex: "0 1 auto",
                  wordBreak: "break-word",
                }}
              >
                {/* User Attached Media & Document Chips in message history */}
                {m.attachments && m.attachments.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                    {m.attachments.map((att, attIdx) => (
                      <div
                        key={attIdx}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 5,
                          background: "rgba(0, 0, 0, 0.3)",
                          padding: "3px 8px",
                          borderRadius: 6,
                          fontSize: "11px",
                          color: "var(--color-text-secondary)",
                          border: "1px solid rgba(255, 255, 255, 0.1)",
                        }}
                      >
                        {att.kind === "image" && att.path.startsWith("data:image") ? (
                          <img src={att.path} alt={att.name} style={{ width: 22, height: 22, borderRadius: 3, objectFit: "cover" }} />
                        ) : att.kind === "image" ? (
                          <Image size={13} style={{ color: "#ef4444" }} />
                        ) : (
                          <FileText size={13} style={{ color: "#a855f7" }} />
                        )}
                        <span style={{ maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={att.name}>
                          {att.name}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {thought && <ThoughtBox thought={thought} />}

                {/* Antigravity-style Execution Timeline with + - line stats */}
                {(explored.length > 0 || fileActions.length > 0) && (
                  <ExecutionTimeline
                    exploredFiles={explored}
                    fileActions={fileActions}
                    isStreaming={isCurrentStreaming}
                    onOpenFile={onOpenFile}
                    activeProject={activeProject}
                  />
                )}

                {m.sender === "user" ? (
                  editingIndex === idx ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%", minWidth: 220 }}>
                      <textarea
                        value={editingText}
                        onChange={(e) => setEditingText(e.target.value)}
                        rows={3}
                        style={{
                          width: "100%",
                          background: "rgba(0, 0, 0, 0.4)",
                          border: "1px solid rgba(239, 68, 68, 0.4)",
                          borderRadius: 6,
                          color: "#ffffff",
                          fontSize: "12px",
                          padding: "6px 8px",
                          outline: "none",
                          resize: "vertical",
                          fontFamily: "inherit",
                          lineHeight: 1.45,
                        }}
                        autoFocus
                      />
                      <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
                        <button
                          onClick={() => {
                            setEditingIndex(null);
                            setEditingText("");
                          }}
                          style={{
                            fontSize: "11px",
                            padding: "3px 8px",
                            background: "rgba(255, 255, 255, 0.08)",
                            border: "1px solid rgba(255, 255, 255, 0.15)",
                            borderRadius: 4,
                            color: "var(--color-text-secondary)",
                            cursor: "pointer",
                          }}
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => handleSaveAndResubmit(idx, editingText)}
                          disabled={!editingText.trim()}
                          style={{
                            fontSize: "11px",
                            fontWeight: 600,
                            padding: "3px 10px",
                            background: "#ef4444",
                            border: "none",
                            borderRadius: 4,
                            color: "#ffffff",
                            cursor: !editingText.trim() ? "not-allowed" : "pointer",
                          }}
                        >
                          Save & Retry
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                      {m.text}
                    </div>
                  )
                ) : (
                  <>
                    {prose ? (
                      <div className="chat-markdown">
                        <ReactMarkdown>{prose}</ReactMarkdown>
                      </div>
                    ) : (
                      thought && !content && (
                        <span style={{ color: "var(--color-text-tertiary)", fontStyle: "italic", fontSize: "11.5px" }}>
                          Generating response...
                        </span>
                      )
                    )}
                  </>
                )}
              </div>

              {/* Side 3-Dot Action Menu */}
              {m.text && m.text !== "..." && !isCurrentStreaming && editingIndex !== idx && (
                <div
                  className="message-action-toolbar"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    flexShrink: 0,
                    paddingTop: 3,
                  }}
                >
                  <MessageActionMenu
                    text={m.text}
                    sender={m.sender}
                    onEdit={m.sender === "user" ? () => {
                      setEditingIndex(idx);
                      setEditingText(m.text);
                    } : undefined}
                    onBranch={() => handleBranchFromMessage(idx, m.text)}
                    onDelete={() => handleDeleteMessage(idx)}
                  />
                </div>
              )}
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      {/* Input */}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            handleDropFiles(e.dataTransfer.files);
          }
        }}
        style={{ padding: "8px 10px", borderTop: "1px solid var(--color-border-subtle)", background: "var(--color-bg-surface)", position: "relative" }}
      >
        {/* Attached Items Tray */}
        {attachedItems.length > 0 && (
          <div style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            padding: "6px 8px",
            background: "var(--color-bg-base)",
            borderRadius: "var(--radius-md)",
            marginBottom: 6,
            border: "1px solid var(--color-border-subtle)",
            maxHeight: 80,
            overflowY: "auto",
          }}>
            {attachedItems.map((item) => (
              <div
                key={item.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  background: "var(--color-bg-surface)",
                  border: "1px solid var(--color-border-default)",
                  borderRadius: 5,
                  padding: "2px 6px",
                  fontSize: "11px",
                  color: "var(--color-text-primary)",
                }}
              >
                {item.type === "image" && item.dataUrl ? (
                  <img src={item.dataUrl} alt={item.name} style={{ width: 18, height: 18, borderRadius: 2, objectFit: "cover" }} />
                ) : item.type === "image" ? (
                  <Image size={12} style={{ color: "#ef4444" }} />
                ) : item.type === "document" ? (
                  <FileText size={12} style={{ color: "#a855f7" }} />
                ) : (
                  <FileCode size={12} style={{ color: "#34d399" }} />
                )}
                <span style={{ maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={item.name}>
                  {item.name}
                </span>
                <button
                  onClick={() => removeAttachment(item.id)}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "var(--color-text-tertiary)",
                    cursor: "pointer",
                    padding: 0,
                    display: "flex",
                    alignItems: "center",
                    marginLeft: 2,
                  }}
                  title="Remove"
                >
                  <X size={11} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Hidden inputs */}
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleAttachImages}
          style={{ display: "none" }}
        />
        <input
          ref={docInputRef}
          type="file"
          accept=".pdf,.doc,.docx,.txt,.md,.rtf,.odt,.epub,.csv,.json"
          multiple
          onChange={handleAttachDocuments}
          style={{ display: "none" }}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="*/*"
          multiple
          onChange={handleAttachDocuments}
          style={{ display: "none" }}
        />

        {/* Project Files Picker Popover */}
        {projectPickerOpen && (
          <div
            ref={projectPickerRef}
            style={{
              position: "absolute",
              bottom: "100%",
              left: 10,
              right: 10,
              background: "var(--color-bg-elevated)",
              border: "1px solid var(--color-border-default)",
              borderRadius: "var(--radius-md)",
              boxShadow: "0 -4px 20px rgba(0,0,0,0.4)",
              padding: 8,
              zIndex: 50,
              maxHeight: 220,
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: "11.5px", fontWeight: 600, color: "var(--color-text-primary)" }}>Attach Project File</span>
              <button
                onClick={() => setProjectPickerOpen(false)}
                style={{ background: "transparent", border: "none", color: "var(--color-text-secondary)", cursor: "pointer" }}
              >
                <X size={13} />
              </button>
            </div>
            <input
              type="text"
              placeholder="Search project files..."
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              style={{
                width: "100%",
                background: "var(--color-bg-base)",
                border: "1px solid var(--color-border-subtle)",
                borderRadius: 4,
                padding: "4px 8px",
                fontSize: "11.5px",
                color: "var(--color-text-primary)",
                outline: "none",
              }}
              autoFocus
            />
            <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
              {projectFiles
                .filter((f) => !projectFilter || f.toLowerCase().includes(projectFilter.toLowerCase()))
                .slice(0, 30)
                .map((file) => (
                  <div
                    key={file}
                    onClick={() => void handleAttachProjectFile(file)}
                    style={{
                      padding: "4px 8px",
                      borderRadius: 4,
                      fontSize: "11px",
                      color: "var(--color-text-secondary)",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-bg-surface)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    {getFileIcon(file, 13)}
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file}</span>
                  </div>
                ))}
              {projectFiles.length === 0 && (
                <div style={{ padding: "8px", fontSize: "11px", color: "var(--color-text-tertiary)", textAlign: "center" }}>
                  No files found in workspace
                </div>
              )}
            </div>
          </div>
        )}

        {/* Quick Model Selector Bar above input controls */}
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 6,
          padding: "0 2px",
        }}>
          {onSelectModel ? (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <ModelSelectorDropdown
                modelsList={modelsList}
                activeModel={activeModel}
                onSelectModel={onSelectModel}
                onOpenSettings={onOpenSettings}
                compact={true}
                dropUp={true}
              />
            </div>
          ) : <div />}

          {activeModel && (
            <span style={{
              fontSize: "10px",
              color: "var(--color-text-tertiary)",
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}>
              <span style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: isLocalModel(activeModel) ? "#a855f7" : "#4ade80",
                display: "inline-block",
              }} />
              {isLocalModel(activeModel) ? "Local Offline" : "Cloud AI"}
            </span>
          )}
        </div>

        <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
          {/* Attachment "+" Cross Launcher */}
          <div ref={attachMenuRef} style={{ position: "relative" }}>
            <button
              onClick={() => setAttachMenuOpen((prev) => !prev)}
              disabled={waiting}
              style={{
                width: 32,
                height: 32,
                borderRadius: "var(--radius-md)",
                background: attachMenuOpen ? "rgba(239, 68, 68, 0.25)" : "var(--color-bg-base)",
                color: attachMenuOpen ? "#ef4444" : "var(--color-text-secondary)",
                border: "1px solid",
                borderColor: attachMenuOpen ? "#ef4444" : "var(--color-border-default)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                transition: "all 0.18s cubic-bezier(0.16, 1, 0.3, 1)",
                transform: attachMenuOpen ? "rotate(45deg)" : "rotate(0deg)",
              }}
              title="Attach Images, Documents, Files, or Project files"
            >
              <Plus size={16} />
            </button>

            {/* Popup Menu */}
            {attachMenuOpen && (
              <div
                style={{
                  position: "absolute",
                  bottom: "calc(100% + 8px)",
                  left: 0,
                  background: "#0e0305",
                  border: "1px solid rgba(239, 68, 68, 0.3)",
                  borderRadius: "var(--radius-md)",
                  boxShadow: "0 8px 24px rgba(0, 0, 0, 0.5)",
                  padding: 6,
                  zIndex: 100,
                  minWidth: 185,
                  display: "flex",
                  flexDirection: "column",
                  gap: 3,
                }}
              >
                <button
                  onClick={() => void handleSelectFiles("image")}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 10px",
                    background: "transparent",
                    border: "none",
                    borderRadius: 4,
                    color: "var(--color-text-primary)",
                    fontSize: "11.5px",
                    cursor: "pointer",
                    textAlign: "left",
                    width: "100%",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(239, 68, 68, 0.15)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <Image size={13} style={{ color: "#ef4444" }} />
                  <span>Attach Image</span>
                </button>

                <button
                  onClick={() => void handleSelectFiles("doc")}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 10px",
                    background: "transparent",
                    border: "none",
                    borderRadius: 4,
                    color: "var(--color-text-primary)",
                    fontSize: "11.5px",
                    cursor: "pointer",
                    textAlign: "left",
                    width: "100%",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(239, 68, 68, 0.15)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <FileText size={13} style={{ color: "#f87171" }} />
                  <span>Attach Document</span>
                </button>

                <button
                  onClick={() => void handleSelectFiles("file")}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 10px",
                    background: "transparent",
                    border: "none",
                    borderRadius: 4,
                    color: "var(--color-text-primary)",
                    fontSize: "11.5px",
                    cursor: "pointer",
                    textAlign: "left",
                    width: "100%",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(239, 68, 68, 0.15)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <FileCode size={13} style={{ color: "#f87171" }} />
                  <span>Attach File</span>
                </button>

                {activeProject && (
                  <button
                    onClick={() => {
                      setAttachMenuOpen(false);
                      void handleOpenProjectPicker();
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "6px 10px",
                      background: "transparent",
                      border: "none",
                      borderRadius: 4,
                      color: "var(--color-text-primary)",
                      fontSize: "11.5px",
                      cursor: "pointer",
                      textAlign: "left",
                      width: "100%",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(239, 68, 68, 0.15)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    <FolderOpen size={13} style={{ color: "#f87171" }} />
                    <span>Project File...</span>
                  </button>
                )}

                {activeFileName && (
                  <button
                    onClick={() => {
                      setAttachMenuOpen(false);
                      handleAttachActiveFile();
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "6px 10px",
                      background: "transparent",
                      border: "none",
                      borderRadius: 4,
                      color: "var(--color-text-primary)",
                      fontSize: "11.5px",
                      cursor: "pointer",
                      textAlign: "left",
                      width: "100%",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(239, 68, 68, 0.15)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    <Paperclip size={13} style={{ color: "#ef4444" }} />
                    <span style={{ maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      Tab: {activeFileName.split(/[/\\]/).pop()}
                    </span>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Hidden File Input Elements for Browser / HTML fallback */}
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: "none" }}
            onChange={handleAttachImages}
          />
          <input
            ref={docInputRef}
            type="file"
            accept=".pdf,.txt,.md,.markdown,.doc,.docx,.json,.csv"
            multiple
            style={{ display: "none" }}
            onChange={handleAttachDocuments}
          />
          <input
            ref={fileInputRef}
            type="file"
            multiple
            style={{ display: "none" }}
            onChange={handleAttachDocuments}
          />

          <textarea
            ref={inputRef}
            placeholder="Ask Csotic to analyze, code, refactor, or explain..."
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onPaste={handlePaste}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (waiting) {
                  handleStop();
                } else {
                  void handleSend();
                }
              }
            }}
            rows={2}
            style={{
              flex: 1,
              background: "var(--color-bg-base)",
              border: "1px solid var(--color-border-default)",
              borderRadius: "var(--radius-md)",
              padding: "8px 10px",
              color: "var(--color-text-primary)",
              fontSize: "12.5px",
              outline: "none",
              resize: "none",
              fontFamily: "inherit",
              lineHeight: 1.4,
            }}
          />
          {waiting ? (
            <button
              onClick={handleStop}
              title="Terminate AI / Stop generation"
              style={{
                width: 32,
                height: 32,
                borderRadius: "50%",
                background: "#ef4444",
                color: "#ffffff",
                border: "none",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                boxShadow: "0 2px 8px rgba(239, 68, 68, 0.35)",
                flexShrink: 0,
                transition: "all 0.15s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "#dc2626";
                e.currentTarget.style.transform = "scale(1.05)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "#ef4444";
                e.currentTarget.style.transform = "scale(1)";
              }}
            >
              <Square size={13} fill="#ffffff" />
            </button>
          ) : (
            <button
              onClick={() => void handleSend()}
              disabled={!inputText.trim() && attachedItems.length === 0}
              title="Send Message (Enter)"
              style={{
                width: 32,
                height: 32,
                borderRadius: "50%",
                background: !inputText.trim() && attachedItems.length === 0 ? "rgba(239, 68, 68, 0.3)" : "#ef4444",
                color: "#ffffff",
                border: "none",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: !inputText.trim() && attachedItems.length === 0 ? "not-allowed" : "pointer",
                boxShadow: !inputText.trim() && attachedItems.length === 0 ? "none" : "0 2px 8px rgba(239, 68, 68, 0.35)",
                flexShrink: 0,
                transition: "all 0.15s ease",
              }}
              onMouseEnter={(e) => {
                if (inputText.trim() || attachedItems.length > 0) {
                  e.currentTarget.style.background = "#dc2626";
                  e.currentTarget.style.transform = "scale(1.05)";
                }
              }}
              onMouseLeave={(e) => {
                if (inputText.trim() || attachedItems.length > 0) {
                  e.currentTarget.style.background = "#ef4444";
                  e.currentTarget.style.transform = "scale(1)";
                }
              }}
            >
              <ArrowRight size={16} strokeWidth={2.4} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function MessageActionMenu({
  text,
  sender,
  onEdit,
  onBranch,
  onDelete,
}: {
  text: string;
  sender: "user" | "agent";
  onEdit?: () => void;
  onBranch?: () => void;
  onDelete?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [openUpward, setOpenUpward] = useState(false);
  const [copied, setCopied] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", handleClickOutside);
    return () => window.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!open && menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      setOpenUpward(spaceBelow < 180);
    }
    setOpen((prev) => !prev);
  };

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const cleanText = text.replace(/<(thought|think)>[\s\S]*?(?:<\/\1>|$)/gi, "").trim();
      await navigator.clipboard.writeText(cleanText || text);
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
        setOpen(false);
      }, 1000);
    } catch (err) {
      console.error("Failed to copy: ", err);
    }
  };

  return (
    <div ref={menuRef} style={{ position: "relative", display: "inline-block" }}>
      <button
        onClick={handleToggle}
        title="More actions"
        style={{
          background: open ? "rgba(255, 255, 255, 0.15)" : "rgba(20, 20, 25, 0.75)",
          border: "1px solid rgba(255, 255, 255, 0.1)",
          borderRadius: "5px",
          color: open ? "#ffffff" : "var(--color-text-tertiary)",
          width: 22,
          height: 22,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 0,
          boxShadow: "0 2px 6px rgba(0, 0, 0, 0.3)",
          transition: "all 0.12s ease",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = "#ffffff";
          e.currentTarget.style.background = "rgba(255, 255, 255, 0.14)";
        }}
        onMouseLeave={(e) => {
          if (!open) {
            e.currentTarget.style.color = "var(--color-text-tertiary)";
            e.currentTarget.style.background = "rgba(20, 20, 25, 0.75)";
          }
        }}
      >
        <MoreHorizontal size={12} />
      </button>

      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "absolute",
            top: openUpward ? "auto" : "100%",
            bottom: openUpward ? "100%" : "auto",
            right: sender === "user" ? 0 : "auto",
            left: sender === "agent" ? 0 : "auto",
            marginTop: openUpward ? 0 : 4,
            marginBottom: openUpward ? 4 : 0,
            minWidth: 150,
            background: "var(--color-flyout-bg, #202024)",
            border: "1px solid var(--color-border-default, #2e2e34)",
            borderRadius: "7px",
            padding: "4px",
            boxShadow: "0 10px 24px rgba(0, 0, 0, 0.6)",
            zIndex: 9999,
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          <button
            onClick={handleCopy}
            style={dropdownItemStyle}
            onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255, 255, 255, 0.08)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            {copied ? <Check size={12} style={{ color: "#4ade80" }} /> : <Copy size={12} />}
            <span style={{ color: copied ? "#4ade80" : "inherit" }}>{copied ? "Copied!" : "Copy Text"}</span>
          </button>

          {onEdit && (
            <button
              onClick={() => {
                setOpen(false);
                onEdit();
              }}
              style={dropdownItemStyle}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255, 255, 255, 0.08)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <Pencil size={12} />
              <span>Edit Prompt</span>
            </button>
          )}

          {onBranch && (
            <button
              onClick={() => {
                setOpen(false);
                onBranch();
              }}
              style={dropdownItemStyle}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255, 255, 255, 0.08)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <GitBranch size={12} style={{ color: "#38bdf8" }} />
              <span>Branch Chat</span>
            </button>
          )}

          {onDelete && (
            <>
              <div style={{ height: 1, background: "rgba(255, 255, 255, 0.08)", margin: "2px 0" }} />
              <button
                onClick={() => {
                  setOpen(false);
                  onDelete();
                }}
                style={{ ...dropdownItemStyle, color: "#f87171" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(239, 68, 68, 0.12)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <Trash2 size={12} />
                <span>Delete Message</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

const dropdownItemStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 7,
  width: "100%",
  padding: "5px 8px",
  background: "transparent",
  border: "none",
  borderRadius: "4px",
  color: "var(--color-text-secondary)",
  fontSize: "11.5px",
  fontWeight: 400,
  cursor: "pointer",
  textAlign: "left",
  transition: "all 0.1s ease",
};

function isErrorMessage(m: Message): boolean {
  if (m.isError) return true;
  if (m.sender !== "agent" || !m.text) return false;
  const t = m.text;
  return (
    t.startsWith("⚠️") ||
    t.startsWith("I hit an error") ||
    t.startsWith("API error") ||
    t.startsWith("Network connection failed") ||
    t.includes("Cloud provider returned status") ||
    t.includes("Authentication failed (401)") ||
    t.includes("Insufficient credits (402)")
  );
}

function parseErrorMessage(rawText: string): { title: string; message: string; statusCode?: number } {
  let text = rawText
    .replace(/^⚠️\s*(?:Error:\s*)?/i, "")
    .replace(/^I hit an error talking to the model:\s*/i, "")
    .replace(/^Cloud provider returned status\s*/i, "")
    .replace(/^API error\s*/i, "")
    .trim();

  let statusCode: number | undefined;
  const statusMatch = text.match(/\b(400|401|402|403|404|429|500|502|503|504)\b/);
  if (statusMatch) {
    statusCode = parseInt(statusMatch[1], 10);
  }

  // Check if there is embedded JSON and extract clean message
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.error && typeof parsed.error === "object" && parsed.error.message) {
        text = parsed.error.message;
        if (parsed.error.code) statusCode = Number(parsed.error.code) || statusCode;
      } else if (parsed.error && typeof parsed.error === "string") {
        text = parsed.error;
      } else if (parsed.message) {
        text = parsed.message;
      }
    } catch {
      // ignore
    }
  }

  let title = "AI Model Error";
  if (statusCode === 404) title = "Model Unavailable / Not Found (404)";
  else if (statusCode === 401) title = "Authentication Failed (401)";
  else if (statusCode === 402) title = "Insufficient Credits (402)";
  else if (statusCode === 429) title = "Rate Limit Exceeded (429)";
  else if (statusCode === 403) title = "Access Restricted (403)";
  else if (statusCode && statusCode >= 500) title = `Upstream Server Error (${statusCode})`;

  return { title, message: text, statusCode };
}

function MessageErrorCard({
  rawText,
  onRetry,
  onDismiss,
}: {
  rawText: string;
  onRetry?: () => void;
  onDismiss?: () => void;
}) {
  const { title, message, statusCode } = parseErrorMessage(rawText);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(rawText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  return (
    <div
      style={{
        width: "100%",
        maxWidth: 480,
        background: "rgba(239, 68, 68, 0.08)",
        border: "1px solid rgba(239, 68, 68, 0.28)",
        borderRadius: "10px",
        padding: "10px 14px",
        color: "var(--color-text-primary)",
        fontSize: "12px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        boxShadow: "0 4px 16px rgba(0, 0, 0, 0.4)",
        margin: "4px 0",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, fontWeight: 600, color: "#f87171", fontSize: "12.5px" }}>
          <AlertCircle size={15} style={{ color: "#ef4444", flexShrink: 0 }} />
          <span>{title}</span>
        </div>
        {onDismiss && (
          <button
            onClick={onDismiss}
            title="Dismiss error"
            style={{
              background: "none",
              border: "none",
              color: "var(--color-text-tertiary)",
              cursor: "pointer",
              padding: 2,
              display: "flex",
              alignItems: "center",
            }}
          >
            <X size={13} />
          </button>
        )}
      </div>

      {/* Body */}
      <div style={{ color: "rgba(255, 255, 255, 0.88)", fontSize: "12px", lineHeight: 1.5, wordBreak: "break-word" }}>
        {message}
      </div>

      {/* Helpful Tip */}
      {(statusCode === 404 || statusCode === 429 || statusCode === 402) && (
        <div style={{
          fontSize: "11px",
          color: "var(--color-text-secondary)",
          background: "rgba(0, 0, 0, 0.25)",
          padding: "5px 8px",
          borderRadius: 6,
          borderLeft: "2px solid #ef4444",
        }}>
          💡 <strong>Tip:</strong> Try selecting another model (such as <strong>Meta LLaMA 3.3 70B</strong> or <strong>Google Gemini 2.0 Flash</strong>) from the top bar.
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2, paddingTop: 6, borderTop: "1px solid rgba(239, 68, 68, 0.18)" }}>
        {onRetry && (
          <button
            onClick={onRetry}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: "11px",
              fontWeight: 600,
              padding: "4px 10px",
              borderRadius: 5,
              background: "#ef4444",
              border: "none",
              color: "#ffffff",
              cursor: "pointer",
              boxShadow: "0 2px 6px rgba(239, 68, 68, 0.3)",
              transition: "all 0.12s ease",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#dc2626")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "#ef4444")}
          >
            <RotateCcw size={11} />
            <span>Retry</span>
          </button>
        )}

        <button
          onClick={handleCopy}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            fontSize: "11px",
            padding: "4px 8px",
            borderRadius: 5,
            background: "rgba(255, 255, 255, 0.06)",
            border: "1px solid rgba(255, 255, 255, 0.1)",
            color: "var(--color-text-secondary)",
            cursor: "pointer",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255, 255, 255, 0.12)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(255, 255, 255, 0.06)")}
        >
          {copied ? <Check size={11} style={{ color: "#4ade80" }} /> : <Copy size={11} />}
          <span>{copied ? "Copied" : "Copy Diagnostic"}</span>
        </button>
      </div>
    </div>
  );
}
