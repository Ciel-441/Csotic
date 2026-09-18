import React, { useState, useEffect, useCallback } from "react";
import { BrainNote, BacklinkItem } from "../../types/ipc";
import { brain } from "../../services/ipc";
import { CustomDialog } from "../GlobalDialog";
import {
  Brain,
  FileText,
  Plus,
  Network,
  Search,
  Trash2,
  BookOpen,
  Loader2,
  Sparkles,
  Link2,
} from "lucide-react";

interface BrainSidebarPanelProps {
  projectPath: string | null;
  projectName?: string;
  activeFilePath?: string | null;
  onOpenFile?: (path: string) => void;
  onOpenGraph?: () => void;
  theme?: "dark" | "light";
}

export const BrainSidebarPanel: React.FC<BrainSidebarPanelProps> = ({
  projectPath,
  projectName: _projectName,
  activeFilePath,
  onOpenFile,
  onOpenGraph,
  theme = "dark",
}) => {
  const [notes, setNotes] = useState<BrainNote[]>([]);
  const [backlinks, setBacklinks] = useState<BacklinkItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [selectedTab, setSelectedTab] = useState<"notes" | "backlinks">("notes");

  // Fetch project notes
  const fetchNotes = useCallback(async () => {
    if (!projectPath) return;
    setLoading(true);
    try {
      const res = await brain.listNotes(projectPath);
      if (res.success && res.data) {
        setNotes(res.data as BrainNote[]);
      }
    } catch (e) {
      console.error("Failed to load brain notes:", e);
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  // Fetch backlinks for current file
  const fetchBacklinks = useCallback(async () => {
    if (!projectPath || !activeFilePath) {
      setBacklinks([]);
      return;
    }
    try {
      const res = await brain.getBacklinks(projectPath, activeFilePath);
      if (res.success && res.data) {
        setBacklinks(res.data as BacklinkItem[]);
      }
    } catch (e) {
      console.error("Failed to load backlinks:", e);
    }
  }, [projectPath, activeFilePath]);

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  useEffect(() => {
    fetchBacklinks();
  }, [fetchBacklinks]);

  const handleCreateNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectPath || !newTitle.trim()) return;

    try {
      const res = await brain.createNote(projectPath, newTitle.trim());
      if (res.success && res.data) {
        const created = res.data as BrainNote;
        setNewTitle("");
        setIsCreating(false);
        await fetchNotes();
        if (onOpenFile) {
          onOpenFile(created.path);
        }
      }
    } catch (e) {
      console.error("Failed to create note:", e);
    }
  };

  const handleDeleteNote = async (e: React.MouseEvent, note: BrainNote) => {
    e.stopPropagation();
    const confirmed = await CustomDialog.confirm(
      `Are you sure you want to delete note "${note.title}"? This action cannot be undone.`,
      "Delete Note",
      true,
      "Delete Note",
      "Cancel"
    );
    if (!confirmed) return;
    try {
      await brain.deleteNote(note.path);
      await fetchNotes();
    } catch (e) {
      console.error("Failed to delete note:", e);
    }
  };

  const filteredNotes = notes.filter((n) => {
    const q = searchQuery.toLowerCase();
    return (
      n.title.toLowerCase().includes(q) ||
      n.filename.toLowerCase().includes(q) ||
      n.tags.some((t) => t.toLowerCase().includes(q))
    );
  });

  const isDark = theme === "dark";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "var(--color-bg-sidebar)",
        color: "var(--color-text-primary)",
        fontSize: "12px",
      }}
    >
      {/* Sleek Forge Red & Black Panel Header */}
      <div
        style={{
          padding: "10px 14px",
          borderBottom: "1px solid var(--color-border-default)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: isDark ? "rgba(239, 68, 68, 0.03)" : "rgba(239, 68, 68, 0.02)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            style={{
              width: 22,
              height: 22,
              borderRadius: 6,
              background: "rgba(239, 68, 68, 0.15)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Brain size={13} color="#ef4444" />
          </div>
          <span style={{ fontWeight: 600, fontSize: "12px", letterSpacing: "-0.2px" }}>
            Obsidian Brain
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          {onOpenGraph && (
            <button
              onClick={onOpenGraph}
              title="Open Interactive Knowledge Graph"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "3px 8px",
                fontSize: "10.5px",
                fontWeight: 600,
                background: "rgba(239, 68, 68, 0.12)",
                border: "1px solid rgba(239, 68, 68, 0.3)",
                borderRadius: 5,
                color: "#f87171",
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(239, 68, 68, 0.22)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(239, 68, 68, 0.12)")}
            >
              <Network size={11} /> Graph
            </button>
          )}

          <button
            onClick={() => setIsCreating((c) => !c)}
            title="Create New Brain Note"
            style={{
              width: 24,
              height: 24,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "transparent",
              border: "1px solid var(--color-border-default)",
              borderRadius: 5,
              color: "var(--color-text-primary)",
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#ef4444")}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--color-border-default)")}
          >
            <Plus size={13} />
          </button>
        </div>
      </div>

      {/* Tabs: Notes vs Backlinks with Forge Red highlight */}
      <div
        style={{
          display: "flex",
          padding: "6px 10px",
          gap: 6,
          borderBottom: "1px solid var(--color-border-default)",
          background: isDark ? "rgba(0, 0, 0, 0.2)" : "rgba(0, 0, 0, 0.02)",
        }}
      >
        <button
          onClick={() => setSelectedTab("notes")}
          style={{
            flex: 1,
            padding: "5px 0",
            fontSize: "11px",
            fontWeight: selectedTab === "notes" ? 600 : 500,
            border: "none",
            borderRadius: 5,
            background: selectedTab === "notes" ? (isDark ? "rgba(239, 68, 68, 0.18)" : "rgba(239, 68, 68, 0.1)") : "transparent",
            color: selectedTab === "notes" ? (isDark ? "#ffffff" : "#dc2626") : "var(--color-text-tertiary)",
            cursor: "pointer",
            transition: "all 0.15s ease",
          }}
        >
          Vault Notes ({notes.length})
        </button>
        <button
          onClick={() => setSelectedTab("backlinks")}
          style={{
            flex: 1,
            padding: "5px 0",
            fontSize: "11px",
            fontWeight: selectedTab === "backlinks" ? 600 : 500,
            border: "none",
            borderRadius: 5,
            background: selectedTab === "backlinks" ? (isDark ? "rgba(239, 68, 68, 0.18)" : "rgba(239, 68, 68, 0.1)") : "transparent",
            color: selectedTab === "backlinks" ? (isDark ? "#ffffff" : "#dc2626") : "var(--color-text-tertiary)",
            cursor: "pointer",
            transition: "all 0.15s ease",
          }}
        >
          Backlinks ({backlinks.length})
        </button>
      </div>

      {/* Main Content Area */}
      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>
        {selectedTab === "notes" && (
          <>
            {/* Inline Note Creation Form */}
            {isCreating && (
              <form
                onSubmit={handleCreateNote}
                style={{
                  padding: 10,
                  margin: "8px 10px",
                  borderRadius: 6,
                  border: "1px solid rgba(239, 68, 68, 0.35)",
                  background: isDark ? "rgba(239, 68, 68, 0.06)" : "rgba(239, 68, 68, 0.04)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    type="text"
                    placeholder="Note title (e.g. system-design)..."
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    autoFocus
                    style={{
                      flex: 1,
                      fontSize: "11.5px",
                      padding: "5px 8px",
                      borderRadius: 4,
                      border: "1px solid var(--color-border-default)",
                      background: "var(--color-bg-base)",
                      color: "var(--color-text-primary)",
                      outline: "none",
                    }}
                  />
                  <button
                    type="submit"
                    disabled={!newTitle.trim()}
                    style={{
                      padding: "0 10px",
                      fontSize: "11px",
                      fontWeight: 600,
                      background: "#ef4444",
                      color: "#ffffff",
                      border: "none",
                      borderRadius: 4,
                      cursor: newTitle.trim() ? "pointer" : "not-allowed",
                    }}
                  >
                    Add
                  </button>
                </div>
              </form>
            )}

            {/* Search Notes Input */}
            <div style={{ padding: "8px 10px 4px" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  background: "var(--color-bg-base)",
                  border: "1px solid var(--color-border-default)",
                  borderRadius: 6,
                  padding: "4px 8px",
                }}
              >
                <Search size={12} color="var(--color-text-tertiary)" />
                <input
                  type="text"
                  placeholder="Search vault notes…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{
                    background: "transparent",
                    border: "none",
                    outline: "none",
                    fontSize: "11px",
                    color: "var(--color-text-primary)",
                    width: "100%",
                  }}
                />
              </div>
            </div>

            {/* Notes List */}
            <div style={{ flex: 1, padding: "6px 10px 12px", display: "flex", flexDirection: "column", gap: 5 }}>
              {loading && notes.length === 0 ? (
                <div style={{ padding: "28px 12px", textAlign: "center", color: "var(--color-text-tertiary)", fontSize: "11.5px" }}>
                  <Loader2 size={16} className="spin" style={{ margin: "0 auto 8px", color: "#ef4444" }} />
                  <div>Loading vault notes…</div>
                </div>
              ) : filteredNotes.length === 0 ? (
                <div
                  style={{
                    padding: "28px 12px",
                    textAlign: "center",
                    color: "var(--color-text-tertiary)",
                    fontSize: "11.5px",
                  }}
                >
                  <BookOpen size={22} style={{ opacity: 0.3, margin: "0 auto 8px" }} />
                  <div>No notes found.</div>
                  <div style={{ fontSize: "10px", marginTop: 4, opacity: 0.8 }}>
                    Click <b>+</b> above to add architecture notes.
                  </div>
                </div>
              ) : (
                filteredNotes.map((note) => {
                  const isActive = activeFilePath && note.path === activeFilePath;
                  return (
                    <div
                      key={note.path}
                      onClick={() => onOpenFile?.(note.path)}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 3,
                        padding: "8px 10px",
                        borderRadius: 6,
                        background: isActive
                          ? isDark
                            ? "rgba(239, 68, 68, 0.12)"
                            : "rgba(239, 68, 68, 0.08)"
                          : "var(--color-bg-base)",
                        border: `1px solid ${
                          isActive
                            ? "rgba(239, 68, 68, 0.45)"
                            : "var(--color-border-default)"
                        }`,
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                        position: "relative",
                      }}
                      onMouseEnter={(e) => {
                        if (!isActive) e.currentTarget.style.borderColor = "rgba(239, 68, 68, 0.3)";
                      }}
                      onMouseLeave={(e) => {
                        if (!isActive) e.currentTarget.style.borderColor = "var(--color-border-default)";
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, overflow: "hidden" }}>
                          <FileText size={12} color="#ef4444" />
                          <span
                            style={{
                              fontWeight: 600,
                              color: isActive ? "#ef4444" : "var(--color-text-primary)",
                              fontSize: "11.5px",
                            }}
                          >
                            {note.title}
                          </span>
                        </div>

                        <button
                          onClick={(e) => handleDeleteNote(e, note)}
                          title="Delete note"
                          style={{
                            background: "transparent",
                            border: "none",
                            color: "var(--color-text-tertiary)",
                            cursor: "pointer",
                            padding: 2,
                            opacity: 0.6,
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.color = "#ef4444")}
                          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--color-text-tertiary)")}
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>

                      {note.summary && (
                        <div
                          style={{
                            fontSize: "10.5px",
                            color: "var(--color-text-secondary)",
                            lineHeight: 1.3,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {note.summary}
                        </div>
                      )}

                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          marginTop: 2,
                          fontSize: "9.5px",
                          color: "var(--color-text-tertiary)",
                        }}
                      >
                        <div style={{ display: "flex", gap: 4 }}>
                          {note.tags.slice(0, 3).map((tag, idx) => (
                            <span
                              key={idx}
                              style={{
                                background: "rgba(239, 68, 68, 0.12)",
                                color: "#f87171",
                                padding: "1px 4px",
                                borderRadius: 3,
                              }}
                            >
                              #{tag}
                            </span>
                          ))}
                        </div>
                        <span>{note.updated_at}</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}

        {selectedTab === "backlinks" && (
          <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: "11px", color: "var(--color-text-tertiary)", lineHeight: 1.4 }}>
              Incoming references & wikilinks to:
              <div
                style={{
                  fontWeight: 600,
                  color: "var(--color-text-primary)",
                  marginTop: 2,
                  wordBreak: "break-all",
                }}
              >
                {activeFilePath ? activeFilePath.split(/[\\/]/).pop() : "No active file selected"}
              </div>
            </div>

            {backlinks.length === 0 ? (
              <div
                style={{
                  padding: "24px 12px",
                  textAlign: "center",
                  color: "var(--color-text-tertiary)",
                  fontSize: "11px",
                }}
              >
                <Link2 size={20} style={{ opacity: 0.3, margin: "0 auto 8px" }} />
                <div>No incoming backlinks yet.</div>
                <div style={{ fontSize: "10px", marginTop: 4 }}>
                  Link this document in notes using <code>[[file]]</code> syntax.
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {backlinks.map((item, idx) => (
                  <div
                    key={idx}
                    onClick={() => onOpenFile?.(item.source_path)}
                    style={{
                      padding: "8px 10px",
                      borderRadius: 6,
                      background: "var(--color-bg-base)",
                      border: "1px solid var(--color-border-default)",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 5, fontWeight: 600, fontSize: "11.5px" }}>
                      <Sparkles size={11} color="#ef4444" />
                      {item.source_name}
                      <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)", fontWeight: 400 }}>
                        (line {item.line_number})
                      </span>
                    </div>
                    {item.line_content && (
                      <div
                        style={{
                          fontSize: "10.5px",
                          color: "var(--color-text-secondary)",
                          marginTop: 4,
                          fontFamily: "var(--font-mono)",
                        }}
                      >
                        {item.line_content}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
