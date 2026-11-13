import { useState, useEffect, useRef } from "react";
import { filesystem } from "../services/ipc";
import { FileTreeItem } from "../types/ipc";
import { getFileIcon } from "./editor/EditorTabBar";
import { Search, Command, File, Play, Terminal, Split, Sparkles, FolderOpen, Save, GitBranch, Settings, Maximize2, RotateCcw, Package, HelpCircle, Hammer, AlertTriangle, Eye } from "lucide-react";

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenFile?: (path: string) => void;
  onExecuteCommand?: (commandId: string) => void;
  initialMode?: "files" | "commands";
}

interface CommandItem {
  id: string;
  title: string;
  category: string;
  shortcut?: string;
  icon: any;
}

const IDE_COMMANDS: CommandItem[] = [
  { id: "file.new", title: "New File", category: "File", shortcut: "Ctrl+N", icon: <File size={14} /> },
  { id: "file.save", title: "Save Active File", category: "File", shortcut: "Ctrl+S", icon: <Save size={14} /> },
  { id: "file.saveAs", title: "Save As...", category: "File", shortcut: "Ctrl+Shift+S", icon: <Save size={14} /> },
  { id: "file.saveAll", title: "Save All Files", category: "File", shortcut: "", icon: <Save size={14} /> },
  { id: "workspace.open", title: "Open Folder / Workspace", category: "File", shortcut: "", icon: <FolderOpen size={14} /> },
  { id: "editor.reopenClosedTab", title: "Reopen Closed Tab", category: "View", shortcut: "Ctrl+Shift+T", icon: <RotateCcw size={14} /> },
  { id: "editor.split", title: "Toggle Split Editor", category: "View", shortcut: "Ctrl+\\", icon: <Split size={14} /> },
  { id: "view.explorer", title: "Show Explorer", category: "View", shortcut: "Ctrl+Shift+E", icon: <FolderOpen size={14} /> },
  { id: "view.search", title: "Show Search", category: "View", shortcut: "Ctrl+Shift+F", icon: <Search size={14} /> },
  { id: "view.git", title: "Show Source Control", category: "View", shortcut: "Ctrl+Shift+G", icon: <GitBranch size={14} /> },
  { id: "view.plugins", title: "Show Extensions", category: "View", shortcut: "Ctrl+Shift+X", icon: <Package size={14} /> },
  { id: "view.problems", title: "Show Problems Panel", category: "View", shortcut: "Ctrl+Shift+M", icon: <AlertTriangle size={14} /> },
  { id: "view.preview", title: "Toggle Markdown / Web Preview", category: "View", shortcut: "Ctrl+Shift+V", icon: <Eye size={14} /> },
  { id: "terminal.toggle", title: "Toggle Terminal Panel", category: "Terminal", shortcut: "Ctrl+`", icon: <Terminal size={14} /> },
  { id: "terminal.focus", title: "Focus Terminal", category: "Terminal", shortcut: "Ctrl+Shift+`", icon: <Terminal size={14} /> },
  { id: "runner.runActive", title: "Run Active File / Dev Server", category: "Run", shortcut: "F5", icon: <Play size={14} /> },
  { id: "runner.buildActive", title: "Build Active File / Project", category: "Run", shortcut: "Ctrl+Shift+B", icon: <Hammer size={14} /> },
  { id: "app.settings", title: "Open Settings", category: "Preferences", shortcut: "Ctrl+,", icon: <Settings size={14} /> },
  { id: "view.fullscreen", title: "Toggle Fullscreen", category: "View", shortcut: "F11", icon: <Maximize2 size={14} /> },
  { id: "help.shortcuts", title: "Keyboard Shortcuts", category: "Help", shortcut: "", icon: <HelpCircle size={14} /> },
  { id: "ai.chat", title: "Open AI Pair Programmer", category: "AI", shortcut: "", icon: <Sparkles size={14} /> },
];

export function SearchModal({
  isOpen,
  onClose,
  onOpenFile,
  onExecuteCommand,
  initialMode = "files",
}: SearchModalProps) {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"files" | "commands">(initialMode);
  const [allFiles, setAllFiles] = useState<FileTreeItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelectedIndex(0);
      setMode(initialMode);
      setLoading(true);
      filesystem.getFileTree().then((res) => {
        if (res.success && res.data && (res.data as any).files) {
          setAllFiles((res.data as any).files.filter((f: FileTreeItem) => !f.is_dir));
        } else {
          setAllFiles([]);
        }
        setLoading(false);
      });
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen, initialMode]);

  // Filter items
  const filteredFiles = allFiles
    .filter((f) => {
      const q = query.toLowerCase().trim();
      if (!q) return true;
      return f.relative_path.toLowerCase().includes(q) || f.name.toLowerCase().includes(q);
    })
    .slice(0, 30);

  const filteredCommands = IDE_COMMANDS.filter((c) => {
    const q = query.toLowerCase().trim();
    if (!q) return true;
    return c.title.toLowerCase().includes(q) || c.category.toLowerCase().includes(q);
  });

  const totalItems = mode === "files" ? filteredFiles.length : filteredCommands.length;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1 < totalItems ? prev + 1 : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 >= 0 ? prev - 1 : Math.max(0, totalItems - 1)));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (mode === "files" && filteredFiles[selectedIndex]) {
        onOpenFile?.(filteredFiles[selectedIndex].path);
        onClose();
      } else if (mode === "commands" && filteredCommands[selectedIndex]) {
        onExecuteCommand?.(filteredCommands[selectedIndex].id);
        onClose();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(0, 0, 0, 0.5)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "12vh",
        zIndex: 2000,
      }}
      onClick={onClose}
    >
      <div
        className="animate-pop-in"
        style={{
          background: "var(--color-bg-surface)",
          border: "1px solid var(--color-border-default)",
          borderRadius: "var(--radius-lg)",
          width: "580px",
          maxHeight: "480px",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 16px 40px rgba(0, 0, 0, 0.6)",
          overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search header with Mode Switcher */}
        <div style={{ display: "flex", alignItems: "center", borderBottom: "1px solid var(--color-border-subtle)", padding: "0 12px", background: "var(--color-panel-header-bg, var(--color-bg-surface))" }}>
          {mode === "files" ? <Search size={16} style={{ color: "#ef4444", marginRight: 8 }} /> : <Command size={16} style={{ color: "#ef4444", marginRight: 8 }} />}
          <input
            ref={inputRef}
            type="text"
            placeholder={mode === "files" ? "Type file name to open... (e.g. App.tsx)" : "Type a command..."}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            style={{
              flex: 1,
              border: "none",
              background: "transparent",
              padding: "12px 0",
              fontSize: "13px",
              color: "var(--color-text-primary)",
              outline: "none",
            }}
          />
          <div style={{ display: "flex", gap: 4 }}>
            <button
              onClick={() => { setMode("files"); setSelectedIndex(0); }}
              style={{
                background: mode === "files" ? "rgba(239,68,68,0.2)" : "transparent",
                color: mode === "files" ? "#ef4444" : "var(--color-text-tertiary)",
                border: "none",
                borderRadius: 4,
                padding: "2px 8px",
                fontSize: "11px",
                cursor: "pointer",
                fontWeight: mode === "files" ? 600 : 400,
              }}
            >
              Files (Ctrl+P)
            </button>
            <button
              onClick={() => { setMode("commands"); setSelectedIndex(0); }}
              style={{
                background: mode === "commands" ? "rgba(239,68,68,0.2)" : "transparent",
                color: mode === "commands" ? "#ef4444" : "var(--color-text-tertiary)",
                border: "none",
                borderRadius: 4,
                padding: "2px 8px",
                fontSize: "11px",
                cursor: "pointer",
                fontWeight: mode === "commands" ? 600 : 400,
              }}
            >
              Commands (Ctrl+Shift+P)
            </button>
          </div>
        </div>

        {/* Results List */}
        <div style={{ flex: 1, overflowY: "auto", padding: "6px", display: "flex", flexDirection: "column", gap: 2 }}>
          {loading && <div style={{ padding: "16px", color: "var(--color-text-tertiary)", fontSize: "12px", textAlign: "center" }}>Loading workspace files...</div>}

          {!loading && mode === "files" && filteredFiles.length === 0 && (
            <div style={{ color: "var(--color-text-tertiary)", textAlign: "center", padding: "24px 16px", fontSize: "12px" }}>
              No files matching "{query}".
            </div>
          )}

          {!loading && mode === "commands" && filteredCommands.length === 0 && (
            <div style={{ color: "var(--color-text-tertiary)", textAlign: "center", padding: "24px 16px", fontSize: "12px" }}>
              No commands matching "{query}".
            </div>
          )}

          {!loading && mode === "files" && filteredFiles.map((file, idx) => {
            const isSelected = idx === selectedIndex;
            return (
              <div
                key={file.path}
                onClick={() => {
                  onOpenFile?.(file.path);
                  onClose();
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "8px 10px",
                  borderRadius: "var(--radius-sm)",
                  background: isSelected ? "rgba(239, 68, 68, 0.18)" : "transparent",
                  border: isSelected ? "1px solid rgba(239, 68, 68, 0.35)" : "1px solid transparent",
                  cursor: "pointer",
                  fontSize: "12.5px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, overflow: "hidden" }}>
                  {getFileIcon(file.name)}
                  <span style={{ color: isSelected ? "var(--color-text-primary)" : "var(--color-text-secondary)", fontWeight: isSelected ? 600 : 400 }}>
                    {file.name}
                  </span>
                  <span style={{ fontSize: "11px", color: "var(--color-text-tertiary)", opacity: 0.7 }}>
                    {file.relative_path}
                  </span>
                </div>
              </div>
            );
          })}

          {!loading && mode === "commands" && filteredCommands.map((cmd, idx) => {
            const isSelected = idx === selectedIndex;
            return (
              <div
                key={cmd.id}
                onClick={() => {
                  onExecuteCommand?.(cmd.id);
                  onClose();
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "8px 10px",
                  borderRadius: "var(--radius-sm)",
                  background: isSelected ? "rgba(239, 68, 68, 0.18)" : "transparent",
                  border: isSelected ? "1px solid rgba(239, 68, 68, 0.35)" : "1px solid transparent",
                  cursor: "pointer",
                  fontSize: "12.5px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ color: "#ef4444" }}>{cmd.icon}</span>
                  <span style={{ color: isSelected ? "var(--color-text-primary)" : "var(--color-text-secondary)", fontWeight: isSelected ? 600 : 400 }}>
                    {cmd.title}
                  </span>
                  <span style={{ fontSize: "10px", background: "var(--color-item-hover, rgba(255,255,255,0.06))", padding: "1px 5px", borderRadius: 3, color: "var(--color-text-tertiary)" }}>
                    {cmd.category}
                  </span>
                </div>
                {cmd.shortcut && (
                  <span style={{ fontSize: "10.5px", color: "var(--color-text-tertiary)", fontFamily: "var(--font-mono)" }}>
                    {cmd.shortcut}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer hints */}
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "6px 12px",
          background: "var(--color-panel-header-bg, var(--color-bg-surface))",
          borderTop: "1px solid var(--color-border-subtle)",
          fontSize: "10.5px",
          color: "var(--color-text-tertiary)",
        }}>
          <span>↑↓ to navigate · Enter to select · Esc to close</span>
          <span>Csotic Quick Open</span>
        </div>
      </div>
    </div>
  );
}
