/**
 * The last-focused Monaco editor, so menus (Edit, Selection) can run editor commands.
 * Type-only import: this module never pulls Monaco into the startup bundle.
 */
import type { editor } from "monaco-editor";

let active: editor.IStandaloneCodeEditor | null = null;

export function trackEditor(ed: editor.IStandaloneCodeEditor) {
  active = ed;
  ed.onDidFocusEditorText(() => { active = ed; });
  ed.onDidDispose(() => { if (active === ed) active = null; });
}

/** Runs a Monaco action/command (e.g. "undo", "actions.find") on the active editor. */
export function runEditorCommand(id: string): boolean {
  if (!active) return false;
  active.focus();
  const action = active.getAction(id);
  if (action) void action.run();
  else active.trigger("menu", id, null);
  return true;
}
