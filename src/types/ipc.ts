/**
 * IPC Types — Mirrors the Rust IPC types from src-tauri/src/ipc/types.rs.
 * Per Chapter 3 §IPC Layer specification.
 */

export interface IpcResponse {
  success: boolean;
  data: unknown;
  error?: IpcError;
  duration_ms: number;
}

export interface IpcError {
  code: ErrorCode;
  message: string;
  details?: string;
}

export type ErrorCode =
  | "Validation"
  | "Permission"
  | "Filesystem"
  | "Process"
  | "Network"
  | "Model"
  | "Internal";

export type RiskLevel = "Low" | "Medium" | "High" | "Critical";

export type AgentIntent =
  | "Generate"
  | "Explain"
  | "Refactor"
  | "Debug"
  | "Review"
  | "Test"
  | "Research"
  | "Document"
  | "Configure";

/** Workspace state per Chapter 5/10. */
export interface WorkspaceState {
  id: string;
  name: string;
  active_project: ProjectInfo | null;
  open_files: string[];
  active_model: string | null;
  background_model: string | null;
  terminal_sessions: string[];
  layout: LayoutState;
}

export interface ProjectInfo {
  name: string;
  path: string;
}

export interface LayoutState {
  sidebar_visible: boolean;
  sidebar_width: number;
  bottom_dock_visible: boolean;
  bottom_dock_height: number;
  right_panel_visible: boolean;
  right_panel_width: number;
}

/** Tool result per Chapter 5 §Tool Contract. */
export interface ToolResult {
  success: boolean;
  output: unknown;
  artifacts: string[];
  duration_ms: number;
  warnings: string[];
  errors: string[];
}

export interface ModelMetadata {
  id: string;
  name: string;
  provider: string;
  version: string;
  context_window: number;
  status: string;
  is_free?: boolean;
}


export interface FileTreeItem {
  name: string;
  path: string;
  relative_path: string;
  is_dir: boolean;
}

export interface FileSearchMatch {
  file: string;
  relative_path: string;
  line_number: number;
  line_text: string;
}

export interface GitCommitItem {
  hash: string;
  author: string;
  date: string;
  message: string;
}

export interface SymbolInfo {
  name: string;
  kind: string;
  start_line: number;
  end_line: number;
}

export interface EditorTab {
  id: string;
  path: string;
  title: string;
  isDirty?: boolean;
  content?: string;
  language?: string;
  cursorPos?: { line: number; column: number };
  extensionData?: any;
  claudeSessionData?: any;
}

export interface BrainNote {
  filename: string;
  path: string;
  title: string;
  summary: string;
  tags: string[];
  updated_at: string;
}

export interface BrainNode {
  id: string;
  label: string;
  kind: "note" | "code" | "symbol" | "config" | "doc";
  path: string;
  group: string;
  connections: number;
}

export interface BrainEdge {
  source: string;
  target: string;
  relationship: "wikilink" | "import" | "contains";
}

export interface BrainGraphData {
  nodes: BrainNode[];
  edges: BrainEdge[];
}

export interface BacklinkItem {
  source_path: string;
  source_name: string;
  line_number: number;
  line_content: string;
}


