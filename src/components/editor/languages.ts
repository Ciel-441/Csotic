/** Maps a file path to a Monaco language id. Shared by the editor and the status bar. */
const BY_EXTENSION: Record<string, string> = {
  ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  rs: "rust",
  py: "python",
  json: "json", jsonc: "json",
  css: "css", scss: "scss", sass: "scss", less: "less",
  html: "html", htm: "html",
  md: "markdown", markdown: "markdown",
  toml: "ini", ini: "ini", cfg: "ini", env: "ini",
  yaml: "yaml", yml: "yaml",
  xml: "xml", svg: "xml",
  sql: "sql",
  sh: "shell", bash: "shell", zsh: "shell",
  ps1: "powershell", psm1: "powershell",
  bat: "bat", cmd: "bat",
  c: "c", h: "c",
  cpp: "cpp", hpp: "cpp", cc: "cpp", cxx: "cpp",
  cs: "csharp",
  go: "go",
  java: "java",
  kt: "kotlin", kts: "kotlin",
  rb: "ruby",
  php: "php",
  swift: "swift",
  lua: "lua",
  dart: "dart",
  sal: "salivo", salivo: "salivo",
};

export function getLanguageFromPath(filePath: string): string {
  const name = filePath.replace(/\\/g, "/").split("/").pop()?.toLowerCase() || "";
  if (name === "dockerfile") return "dockerfile";
  const ext = name.includes(".") ? name.split(".").pop()! : "";
  return BY_EXTENSION[ext] || "plaintext";
}
