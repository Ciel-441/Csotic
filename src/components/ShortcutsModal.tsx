import { useEffect } from "react";
import { X, Keyboard } from "lucide-react";

interface ShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ShortcutEntry {
  command: string;
  keys: string[];
}

interface ShortcutGroup {
  category: string;
  shortcuts: ShortcutEntry[];
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    category: "General",
    shortcuts: [
      { command: "Command Palette", keys: ["F1", "Ctrl+Shift+P"] },
      { command: "Quick Open File / Symbols", keys: ["Ctrl+P", "Ctrl+T"] },
      { command: "Go to Symbol / Palette", keys: ["Ctrl+Shift+O"] },
      { command: "Open File", keys: ["Ctrl+O"] },
      { command: "New File", keys: ["Ctrl+N"] },
      { command: "Save File", keys: ["Ctrl+S"] },
      { command: "Save As", keys: ["Ctrl+Shift+S"] },
      { command: "Open Settings", keys: ["Ctrl+,"] },
      { command: "Toggle Fullscreen", keys: ["F11"] },
    ],
  },
  {
    category: "Editor Tabs",
    shortcuts: [
      { command: "Next Tab", keys: ["Ctrl+Tab", "Ctrl+PageDown"] },
      { command: "Previous Tab", keys: ["Ctrl+Shift+Tab", "Ctrl+PageUp"] },
      { command: "Go to Tab 1-8", keys: ["Ctrl+1 … 8", "Alt+1 … 8"] },
      { command: "Go to Last Tab", keys: ["Ctrl+9", "Alt+9"] },
      { command: "Go Back in History", keys: ["Alt+Left"] },
      { command: "Go Forward in History", keys: ["Alt+Right"] },
      { command: "Reopen Last Closed Tab", keys: ["Ctrl+Shift+T"] },
      { command: "Close Active Tab", keys: ["Ctrl+W", "Ctrl+F4"] },
    ],
  },
  {
    category: "View & Navigation",
    shortcuts: [
      { command: "Toggle Primary Sidebar", keys: ["Ctrl+B"] },
      { command: "Show Explorer", keys: ["Ctrl+Shift+E"] },
      { command: "Show Search / Replace", keys: ["Ctrl+Shift+F", "Ctrl+Shift+H"] },
      { command: "Show Source Control", keys: ["Ctrl+Shift+G"] },
      { command: "Show Extensions", keys: ["Ctrl+Shift+X"] },
      { command: "Show Problems Panel", keys: ["Ctrl+Shift+M"] },
      { command: "Show Terminal / Output", keys: ["Ctrl+`", "Ctrl+Shift+U"] },
      { command: "Focus Terminal", keys: ["Ctrl+Shift+`", "Ctrl+Shift+D"] },
      { command: "Toggle Markdown Preview", keys: ["Ctrl+Shift+V"] },
      { command: "Toggle Split Editor", keys: ["Ctrl+\\", "Shift+Alt+0"] },
      { command: "Toggle AI Assistant Drawer", keys: ["Ctrl+L"] },
      { command: "Toggle AI Context Panel", keys: ["Ctrl+J"] },
    ],
  },
  {
    category: "Run & Build",
    shortcuts: [
      { command: "Run Active File / Dev Server", keys: ["F5", "Ctrl+F5"] },
      { command: "Build Active File / Project", keys: ["Ctrl+Shift+B"] },
    ],
  },
  {
    category: "Editor (Monaco)",
    shortcuts: [
      { command: "Inline AI Assistant", keys: ["Ctrl+K"] },
      { command: "Find in File", keys: ["Ctrl+F"] },
      { command: "Replace in File", keys: ["Ctrl+H"] },
      { command: "Toggle Line Comment", keys: ["Ctrl+/"] },
      { command: "Toggle Block Comment", keys: ["Shift+Alt+A"] },
      { command: "Format Document", keys: ["Shift+Alt+F"] },
      { command: "Add Next Occurrence", keys: ["Ctrl+D"] },
      { command: "Expand Selection", keys: ["Shift+Alt+Right"] },
      { command: "Add Cursor Above / Below", keys: ["Ctrl+Alt+Up", "Ctrl+Alt+Down"] },
      { command: "Move Line Up / Down", keys: ["Alt+Up", "Alt+Down"] },
      { command: "Copy Line Up / Down", keys: ["Shift+Alt+Up", "Shift+Alt+Down"] },
      { command: "Jump to Matching Bracket", keys: ["Ctrl+Shift+\\"] },
      { command: "Indent / Outdent Line", keys: ["Ctrl+]", "Ctrl+["] },
      { command: "Toggle Word Wrap", keys: ["Alt+Z"] },
      { command: "Undo / Redo", keys: ["Ctrl+Z", "Ctrl+Y"] },
    ],
  },
];

export function ShortcutsModal({ isOpen, onClose }: ShortcutsModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100000,
        backgroundColor: "rgba(0, 0, 0, 0.75)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: "760px",
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          backgroundColor: "#0d0f15",
          border: "1px solid rgba(239, 68, 68, 0.25)",
          borderRadius: "10px",
          boxShadow: "0 24px 64px rgba(0, 0, 0, 0.8), 0 0 32px rgba(239, 68, 68, 0.1)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 20px",
            borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
            background: "linear-gradient(180deg, rgba(239, 68, 68, 0.08) 0%, transparent 100%)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: "6px",
                background: "rgba(239, 68, 68, 0.15)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#ef4444",
              }}
            >
              <Keyboard size={18} />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: "16px", fontWeight: 600, color: "#f8fafc" }}>
                Keyboard Shortcuts
              </h2>
              <p style={{ margin: 0, fontSize: "12px", color: "#94a3b8" }}>
                Quick reference for standard keyboard controls
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close shortcuts modal"
            style={{
              background: "transparent",
              border: "none",
              color: "#94a3b8",
              cursor: "pointer",
              padding: "6px",
              borderRadius: "4px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Content list */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "16px 20px",
            display: "flex",
            flexDirection: "column",
            gap: "20px",
          }}
        >
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.category}>
              <div
                style={{
                  fontSize: "11px",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  color: "#ef4444",
                  marginBottom: "8px",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <span>{group.category}</span>
                <div style={{ flex: 1, height: "1px", background: "rgba(255, 255, 255, 0.06)" }} />
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
                  gap: "6px",
                }}
              >
                {group.shortcuts.map((sc, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "6px 10px",
                      borderRadius: "5px",
                      background: "rgba(255, 255, 255, 0.02)",
                      border: "1px solid rgba(255, 255, 255, 0.04)",
                      fontSize: "12px",
                      color: "#e2e8f0",
                    }}
                  >
                    <span>{sc.command}</span>
                    <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                      {sc.keys.map((k, kIdx) => (
                        <kbd
                          key={kIdx}
                          style={{
                            fontFamily: "var(--font-mono, monospace)",
                            fontSize: "10.5px",
                            padding: "2px 6px",
                            borderRadius: "4px",
                            background: "rgba(0, 0, 0, 0.5)",
                            border: "1px solid rgba(255, 255, 255, 0.15)",
                            color: "#cbd5e1",
                            boxShadow: "0 1px 2px rgba(0,0,0,0.4)",
                          }}
                        >
                          {k}
                        </kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "10px 20px",
            borderTop: "1px solid rgba(255, 255, 255, 0.06)",
            background: "#08090d",
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            fontSize: "11px",
            color: "#64748b",
          }}
        >
          Press <kbd style={{ padding: "1px 5px", margin: "0 4px", borderRadius: 3, border: "1px solid rgba(255,255,255,0.15)" }}>Esc</kbd> to close
        </div>
      </div>
    </div>
  );
}
