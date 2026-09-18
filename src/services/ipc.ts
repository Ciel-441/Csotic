/**
 * IPC Client Service
 * Per Chapter 3 §IPC Layer — The only bridge between the React UI and Rust backend.
 * Frontend communicates ONLY through typed IPC commands.
 */

import { invoke } from "@tauri-apps/api/core";
import type { IpcResponse } from "../types/ipc";

/**
 * Send a structured IPC request to the Rust backend.
 * Maps to the `ipc_request` Tauri command handler.
 */
export async function ipcRequest(
  service: string,
  action: string,
  payload: Record<string, unknown> = {},
): Promise<IpcResponse> {
  try {
    const response = await invoke<IpcResponse>("ipc_request", {
      service,
      action,
      payload,
    });
    return response;
  } catch (err) {
    // Per Chapter 3: IPC errors must never crash the UI.
    return {
      success: false,
      data: null,
      error: {
        code: "Internal",
        message: err instanceof Error ? err.message : String(err),
      },
      duration_ms: 0,
    };
  }
}

/** Workspace service shortcuts */
export const workspace = {
  getState: () => ipcRequest("workspace", "get_state"),
  openProject: (path: string) =>
    ipcRequest("workspace", "open_project", { path }),
  clearActiveProject: () =>
    ipcRequest("workspace", "clear_active_project"),
  getLayout: () => ipcRequest("workspace", "get_layout"),
  updateLayout: (layout: Record<string, unknown>) =>
    ipcRequest("workspace", "update_layout", layout),
  getRecentProjects: () => ipcRequest("workspace", "get_recent_projects"),
  saveState: (state: Record<string, unknown>) =>
    ipcRequest("workspace", "save_state", state),
};

/** Filesystem service shortcuts per Chapter 5 */
export const filesystem = {
  readDir: (path: string) =>
    ipcRequest("filesystem", "read_dir", { path }),
  readFile: (path: string) =>
    ipcRequest("filesystem", "read_file", { path }),
  writeFile: (path: string, content: string) =>
    ipcRequest("filesystem", "write_file", { path, content }),
  createDir: (path: string) =>
    ipcRequest("filesystem", "create_dir", { path }),
  rename: (oldPath: string, newPath: string) =>
    ipcRequest("filesystem", "rename", { old_path: oldPath, new_path: newPath }),
  copyFile: (srcPath: string, destPath: string) =>
    ipcRequest("filesystem", "copy_file", { src_path: srcPath, dest_path: destPath }),
  getFileTree: () =>
    ipcRequest("filesystem", "get_file_tree"),
  searchInFiles: (query: string, caseSensitive: boolean = false) =>
    ipcRequest("filesystem", "search_in_files", { query, case_sensitive: caseSensitive }),
  patchFile: (path: string, target: string, replacement: string) =>
    ipcRequest("filesystem", "patch_file", { path, target, replacement }),
  deletePath: (path: string, approved: boolean = false) =>
    ipcRequest("filesystem", "delete", { path, approved }),
  selectFolder: () =>
    ipcRequest("filesystem", "select_folder"),
  selectFiles: () =>
    ipcRequest("filesystem", "select_files"),
  saveAsDialog: (defaultName: string, content: string) =>
    ipcRequest("filesystem", "save_as_dialog", { default_name: defaultName, content }),
  openFileDialog: () =>
    ipcRequest("filesystem", "open_file_dialog"),
};

/** Git service shortcuts per Chapter 5 */
export const git = {
  status: (projectPath: string) =>
    ipcRequest("git", "status", { project_path: projectPath }),
  diff: (projectPath: string, path?: string) =>
    ipcRequest("git", "diff", { project_path: projectPath, path }),
  show: (projectPath: string, path: string) =>
    ipcRequest("git", "show", { project_path: projectPath, path }),
  numstat: (projectPath: string) =>
    ipcRequest("git", "numstat", { project_path: projectPath }),
  add: (projectPath: string, path: string = ".") =>
    ipcRequest("git", "add", { project_path: projectPath, path }),
  commit: (projectPath: string, message: string) =>
    ipcRequest("git", "commit", { project_path: projectPath, message }),
  branch: (projectPath: string) =>
    ipcRequest("git", "branch", { project_path: projectPath }),
  checkout: (projectPath: string, target: string) =>
    ipcRequest("git", "checkout", { project_path: projectPath, target }),
  createBranch: (projectPath: string, name: string) =>
    ipcRequest("git", "create_branch", { project_path: projectPath, name }),
  unstage: (projectPath: string, path: string = ".") =>
    ipcRequest("git", "unstage", { project_path: projectPath, path }),
  discard: (projectPath: string, path: string) =>
    ipcRequest("git", "discard", { project_path: projectPath, path }),
  log: (projectPath: string, limit: number = 25) =>
    ipcRequest("git", "log", { project_path: projectPath, limit }),
  resetHard: (projectPath: string, approved: boolean = false) =>
    ipcRequest("git", "reset_hard", { project_path: projectPath, approved }),
  forcePush: (projectPath: string, approved: boolean = false) =>
    ipcRequest("git", "force_push", { project_path: projectPath, approved }),
  branchDelete: (projectPath: string, branch: string, approved: boolean = false) =>
    ipcRequest("git", "branch_delete", { project_path: projectPath, branch, approved }),
  stash: (projectPath: string, subaction: "push" | "pop" = "push") =>
    ipcRequest("git", "stash", { project_path: projectPath, subaction }),
  pull: (projectPath: string) =>
    ipcRequest("git", "pull", { project_path: projectPath }),
  push: (projectPath: string) =>
    ipcRequest("git", "push", { project_path: projectPath }),
};

/** Terminal service shortcuts per Chapter 5 */
export const terminal = {
  executeCommand: (projectPath: string, command: string, approved: boolean = false) =>
    ipcRequest("terminal", "execute_command", { project_path: projectPath, command, approved }),
  cancelCommand: () =>
    ipcRequest("terminal", "cancel_command"),
};

/** Model service shortcuts per Chapter 24 */
export const models = {
  discoverModels: () =>
    ipcRequest("models", "discover_models"),
  executePrompt: (modelId: string, prompt: string, systemPrompt?: string) =>
    ipcRequest("models", "execute_prompt", { model_id: modelId, prompt, system_prompt: systemPrompt }),
  streamPrompt: (modelId: string, prompt: string, systemPrompt?: string, requestId?: string, imagePaths?: string[], history?: Record<string, string>[]) =>
    ipcRequest("models", "stream_prompt", {
      model_id: modelId,
      prompt,
      system_prompt: systemPrompt,
      request_id: requestId,
      image_paths: imagePaths,
      history,
    }),
  saveApiKeys: (keys: { openai?: string; anthropic?: string; deepseek?: string; groq?: string; openrouter?: string; gemini?: string; custom_endpoints?: string }) =>
    ipcRequest("models", "save_api_keys", keys),
  getApiKeys: () =>
    ipcRequest("models", "get_api_keys"),
};

/** Memory service shortcuts per Chapter 17 */
export const memory = {
  addMemory: (projectId: string | null, category: string, summary: string, source: string, confidence: number = 0.9) =>
    ipcRequest("memory", "add_memory", { project_id: projectId, category, summary, source, confidence }),
  getMemories: (category?: string) =>
    ipcRequest("memory", "get_memories", { category }),
  deleteMemory: (id: string) =>
    ipcRequest("memory", "delete_memory", { id }),
};

/** Agent service shortcuts per Chapter 15 */
export const agent = {
  executeRequest: (request: string, options: {
    projectPath: string;
    modelId: string;
    permissionProfile: "read_only" | "edit" | "developer" | "full_automation";
    requestId: string;
    imagePaths?: string[];
    history?: Record<string, string>[];
  }) => ipcRequest("agent", "execute_request", {
    request,
    project_path: options.projectPath,
    model_id: options.modelId,
    permission_profile: options.permissionProfile,
    request_id: options.requestId,
    image_paths: options.imagePaths,
    history: options.history,
  }),
  cancelRequest: (requestId: string) =>
    ipcRequest("agent", "cancel_request", { request_id: requestId }),
};

/** Indexing service shortcuts */
export const indexing = {
  start: (projectPath: string) =>
    ipcRequest("indexing", "start", { project_path: projectPath }),
  getSummary: (projectIdOrPath: string) =>
    ipcRequest("indexing", "get_summary", { project_id: projectIdOrPath, project_path: projectIdOrPath }),
  search: (query: string, projectPath?: string) =>
    ipcRequest("indexing", "search", { query, project_path: projectPath }),
};

/** Symbols service */
export const symbols = {
  extract: (path: string, content?: string) =>
    ipcRequest("symbols", "extract", { path, content }),
};

/** Plugins & Extensions service shortcuts */
export const plugins = {
  getPlugins: () => ipcRequest("plugins", "get_plugins"),
  scaffoldPlugin: (projectPath: string) => ipcRequest("plugins", "scaffold_plugin", { project_path: projectPath }),
  installExtension: (ext: Record<string, any>) => ipcRequest("plugins", "install_extension", ext),
  uninstallExtension: (id: string) => ipcRequest("plugins", "uninstall_extension", { id }),
  getInstalledExtensions: () => ipcRequest("plugins", "get_installed_extensions"),
};

/** Collaboration service shortcuts */
export const collaboration = {
  startSession: () => ipcRequest("collaboration", "start_session"),
  joinSession: (sessionId: string) => ipcRequest("collaboration", "join_session", { session_id: sessionId }),
};

/** System service shortcuts */
export const system = {
  health: () => ipcRequest("system", "health"),
  diagnostics: () => ipcRequest("system", "diagnostics"),
  log: (level: string, message: string) => ipcRequest("system", "log", { level, message }),
};

/** Project State & Workspace Integrity shortcuts */
export interface ProjectStateInfo {
  workspace_root: string;
  project_exists: boolean;
  project_type: string;
  project_type_name: string;
  package_manager: string;
  file_count: number;
  directory_count: number;
  entry_points: string[];
  important_files: string[];
  is_git: boolean;
  summary: string;
}

export const projectState = {
  getState: (projectPath?: string) =>
    ipcRequest("project_state", "get_state", { project_path: projectPath }),
};

export const changeset = {
  rollback: (projectPath: string, taskId: string) =>
    ipcRequest("changeset", "rollback", { project_path: projectPath, task_id: taskId }),
};

/** Obsidian Brain service shortcuts */
export const brain = {
  listNotes: (projectPath: string) =>
    ipcRequest("brain", "list_notes", { project_path: projectPath }),
  createNote: (projectPath: string, title: string, content?: string) =>
    ipcRequest("brain", "create_note", { project_path: projectPath, title, content }),
  saveNote: (path: string, content: string) =>
    ipcRequest("brain", "save_note", { path, content }),
  deleteNote: (path: string) =>
    ipcRequest("brain", "delete_note", { path }),
  getGraph: (projectPath: string) =>
    ipcRequest("brain", "get_graph", { project_path: projectPath }),
  getBacklinks: (projectPath: string, targetPath: string) =>
    ipcRequest("brain", "get_backlinks", { project_path: projectPath, target_path: targetPath }),
};

/** Window management shortcuts */
export const windowService = {
  minimize: () => ipcRequest("window", "minimize"),
  maximize: () => ipcRequest("window", "maximize"),
  unmaximize: () => ipcRequest("window", "unmaximize"),
  toggleMaximize: () => ipcRequest("window", "toggle_maximize"),
  close: () => ipcRequest("window", "close"),
  startDragging: () => ipcRequest("window", "start_dragging"),
};

