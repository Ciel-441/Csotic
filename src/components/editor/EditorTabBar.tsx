import React, { useState, useRef, useEffect } from "react";
import { EditorTab } from "../../types/ipc";
import { 
  X, 
  Columns, 
  Eye, 
  Puzzle,
  Code2,
} from "lucide-react";
import { getFileIcon } from "./FileIcons";
import { ClaudeIcon } from "../ClaudeIcon";

export { getFileIcon };

interface EditorTabBarProps {
  tabs: EditorTab[];
  activeTabId: string | null;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string, e: React.MouseEvent) => void;
  onCloseOthers?: (tabId: string) => void;
  onCloseAll?: () => void;
  onCloseSaved?: () => void;
  onSplitEditor?: () => void;
  isSplit?: boolean;
  activeViewMode?: "code" | "split" | "preview" | "diff";
  onViewModeChange?: (mode: "code" | "split" | "preview" | "diff") => void;
  hasPreviewableFile?: boolean;
}

function TabItem({
  tab,
  isActive,
  onSelectTab,
  onCloseTab,
  onContextMenu,
}: {
  tab: EditorTab;
  isActive: boolean;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string, e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent, tabId: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const fileName = tab.title || tab.path.split(/[/\\]/).pop() || "untitled";

  return (
    <div
      className={`editor-tab ${isActive ? "editor-tab--active" : ""}`}
      onClick={() => onSelectTab(tab.id)}
      onContextMenu={(e) => onContextMenu(e, tab.id)}
      onAuxClick={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          e.stopPropagation();
          onCloseTab(tab.id, e);
        }
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 7,
        height: "100%",
        padding: "0 10px 0 12px",
        fontSize: "12.5px",
        cursor: "pointer",
        background: isActive ? "var(--color-bg-surface)" : "transparent",
        color: isActive ? "var(--color-text-primary)" : "var(--color-text-secondary)",
        borderRight: "1px solid var(--color-border-subtle)",
        borderBottom: isActive ? "2px solid var(--color-accent-primary)" : "2px solid transparent",
        whiteSpace: "nowrap",
        position: "relative",
        transition: "background 0.15s ease, color 0.15s ease",
      }}
      title={tab.path}
    >
      {tab.path === "csotic://welcome" || tab.id === "welcome" ? (
        <Code2 size={13} style={{ color: "var(--color-accent-primary, #ef4444)", flexShrink: 0 }} />
      ) : tab.path?.startsWith("extension:") ? (
        <Puzzle size={13} style={{ color: "#ef4444", flexShrink: 0 }} />
      ) : tab.path?.startsWith("claude-code:") ? (
        <ClaudeIcon size={14} />
      ) : (
        getFileIcon(fileName)
      )}
      <span style={{ fontWeight: isActive ? 500 : 400 }}>{tab.path === "csotic://welcome" || tab.id === "welcome" ? "Welcome" : fileName}</span>

      {/* Dirty indicator / close button with interactive hover morphing */}
      <div style={{ display: "flex", alignItems: "center", width: 18, height: 18, justifyContent: "center", marginLeft: 2 }}>
        {tab.isDirty && !hovered ? (
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: "var(--color-accent-primary)",
              display: "inline-block",
            }}
            title="Unsaved changes"
          />
        ) : (
          <button
            className="editor-tab__close-btn"
            onClick={(e) => {
              e.stopPropagation();
              onCloseTab(tab.id, e);
            }}
            style={{
              background: "transparent",
              border: "none",
              color: "inherit",
              opacity: hovered || isActive ? 0.8 : 0.4,
              cursor: "pointer",
              padding: "2px",
              borderRadius: 3,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "opacity 0.1s ease, background 0.1s ease, color 0.1s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "#ef4444";
              e.currentTarget.style.background = "rgba(239, 68, 68, 0.15)";
              e.currentTarget.style.opacity = "1";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "inherit";
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.opacity = hovered || isActive ? "0.8" : "0.4";
            }}
            title={tab.isDirty ? "Close tab (Unsaved changes)" : "Close tab"}
          >
            <X size={13} />
          </button>
        )}
      </div>
    </div>
  );
}

export function EditorTabBar({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onCloseOthers,
  onCloseAll,
  onCloseSaved,
  onSplitEditor,
  isSplit = false,
  activeViewMode = "code",
  onViewModeChange,
  hasPreviewableFile = false,
}: EditorTabBarProps) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; tabId: string } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!contextMenu) return;
    const handleOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setContextMenu(null);
    };
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [contextMenu]);

  // Keep the active tab visible when it changes (opened from explorer, Ctrl+P, closing neighbours...).
  useEffect(() => {
    listRef.current?.querySelector(".editor-tab--active")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeTabId, tabs.length]);

  if (tabs.length === 0) {
    return null;
  }

  const handleTabContextMenu = (e: React.MouseEvent, tabId: string) => {
    e.preventDefault();
    // Clamp so the menu never opens off-screen near the right/bottom edge.
    setContextMenu({
      x: Math.min(e.clientX, window.innerWidth - 170),
      y: Math.min(e.clientY, window.innerHeight - 150),
      tabId,
    });
  };

  return (
    <div className="editor-tab-bar" style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      background: "var(--color-bg-base)",
      borderBottom: "1px solid var(--color-border-default)",
      height: 38,
      userSelect: "none",
      overflowX: "auto",
      position: "relative",
    }}>
      {/* Tab List */}
      <div
        ref={listRef}
        className="editor-tab-bar__list"
        onWheel={(e) => {
          // Scrollbar is hidden, so map the vertical wheel to horizontal tab scrolling.
          if (e.deltaY !== 0) e.currentTarget.scrollLeft += e.deltaY;
        }}
        style={{
        display: "flex",
        alignItems: "center",
        height: "100%",
        flex: 1,
        overflowX: "auto",
        scrollbarWidth: "none",
      }}>
        {tabs.map((tab) => (
          <TabItem
            key={tab.id}
            tab={tab}
            isActive={tab.id === activeTabId}
            onSelectTab={onSelectTab}
            onCloseTab={onCloseTab}
            onContextMenu={handleTabContextMenu}
          />
        ))}
      </div>

      {/* Action Buttons: Live Preview, Split Editor (Close All lives in the tab context menu) */}
      <div className="editor-tab-bar__actions" style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: "0 8px",
      }}>
        {hasPreviewableFile && onViewModeChange && (
          <button
            className={`btn btn--icon ${activeViewMode === "preview" ? "btn--active" : ""}`}
            onClick={() => onViewModeChange(activeViewMode === "preview" ? "code" : "preview")}
            title={activeViewMode === "preview" ? "Switch to Code Editor" : "Toggle Live Preview"}
            style={{ width: 26, height: 26, padding: 0 }}
          >
            <Eye size={14} />
          </button>
        )}

        {onSplitEditor && (
          <button
            className={`btn btn--icon ${isSplit ? "btn--active" : ""}`}
            onClick={onSplitEditor}
            title={isSplit ? "Close Split Pane (Ctrl+\\)" : "Split Editor (Ctrl+\\)"}
            style={{ width: 26, height: 26, padding: 0 }}
          >
            <Columns size={14} />
          </button>
        )}

      </div>

      {/* Tab Context Menu */}
      {contextMenu && (
        <div
          ref={menuRef}
          style={{
            position: "fixed",
            top: contextMenu.y,
            left: contextMenu.x,
            background: "var(--color-bg-elevated)",
            border: "1px solid var(--color-border-default)",
            borderRadius: "var(--radius-md)",
            boxShadow: "0 8px 24px rgba(0, 0, 0, 0.45)",
            padding: 4,
            zIndex: 1000,
            minWidth: 150,
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          <button
            onClick={(e) => {
              onCloseTab(contextMenu.tabId, e);
              setContextMenu(null);
            }}
            style={{
              padding: "6px 10px",
              background: "transparent",
              border: "none",
              borderRadius: 4,
              color: "var(--color-text-primary)",
              fontSize: "11.5px",
              textAlign: "left",
              cursor: "pointer",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-bg-surface)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            Close
          </button>

          {onCloseOthers && (
            <button
              onClick={() => {
                onCloseOthers(contextMenu.tabId);
                setContextMenu(null);
              }}
              style={{
                padding: "6px 10px",
                background: "transparent",
                border: "none",
                borderRadius: 4,
                color: "var(--color-text-primary)",
                fontSize: "11.5px",
                textAlign: "left",
                cursor: "pointer",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-bg-surface)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              Close Others
            </button>
          )}

          {onCloseSaved && (
            <button
              onClick={() => {
                onCloseSaved();
                setContextMenu(null);
              }}
              style={{
                padding: "6px 10px",
                background: "transparent",
                border: "none",
                borderRadius: 4,
                color: "var(--color-text-primary)",
                fontSize: "11.5px",
                textAlign: "left",
                cursor: "pointer",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-bg-surface)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              Close Saved
            </button>
          )}

          {onCloseAll && (
            <button
              onClick={() => {
                onCloseAll();
                setContextMenu(null);
              }}
              style={{
                padding: "6px 10px",
                background: "transparent",
                border: "none",
                borderRadius: 4,
                color: "#ef4444",
                fontSize: "11.5px",
                textAlign: "left",
                cursor: "pointer",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(239, 68, 68, 0.15)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              Close All
            </button>
          )}
        </div>
      )}
    </div>
  );
}
