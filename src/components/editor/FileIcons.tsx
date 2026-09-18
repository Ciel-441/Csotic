import React from "react";
import { 
  File, 
  FileText, 
  FileCode, 
  Image as ImageIcon, 
  Music, 
  Video, 
  Archive, 
  Cpu
} from "lucide-react";

interface BadgeProps {
  text: string;
  bg: string;
  color?: string;
  size?: number;
  fontSize?: number;
  title?: string;
  borderRadius?: number;
  border?: string;
}

function LangBadge({
  text,
  bg,
  color = "#ffffff",
  size = 14,
  fontSize,
  title,
  borderRadius = 3,
  border,
}: BadgeProps) {
  const calculatedFontSize = fontSize ?? (text.length >= 3 ? size * 0.52 : text.length === 2 ? size * 0.6 : size * 0.7);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        minWidth: size,
        minHeight: size,
        borderRadius,
        background: bg,
        color,
        fontSize: `${calculatedFontSize}px`,
        fontWeight: 800,
        fontFamily: "'JetBrains Mono', Consolas, 'Fira Code', monospace",
        lineHeight: 1,
        letterSpacing: text.length > 2 ? "-0.5px" : "-0.2px",
        userSelect: "none",
        boxShadow: `0 1px 3px rgba(0,0,0,0.3)`,
        border: border || "none",
        flexShrink: 0,
      }}
      title={title}
    >
      {text}
    </span>
  );
}

/**
 * Returns a distinct, color-coded, branded icon or badge for any file name or extension.
 */
export function getFileIcon(fileName: string, size = 14): React.ReactNode {
  if (!fileName) {
    return <File size={size} style={{ color: "var(--color-text-tertiary)" }} />;
  }

  const lower = fileName.toLowerCase();
  const baseName = lower.split(/[/\\]/).pop() || lower;
  const parts = baseName.split(".");
  const ext = parts.length > 1 ? parts.pop() || "" : "";

  // 1. Exact Special Filenames
  if (baseName === "package.json") {
    return <LangBadge text="npm" bg="#cb3837" color="#fff" size={size} title="npm Package Config" />;
  }
  if (baseName === "cargo.toml" || baseName === "cargo.lock") {
    return <LangBadge text="🦀" bg="#261208" size={size} fontSize={size * 0.75} title="Cargo Rust Manifest" border="1px solid rgba(249,115,22,0.4)" />;
  }
  if (baseName === "makefile" || baseName === "gnumakefile" || baseName === "cmakelists.txt") {
    return <LangBadge text="MK" bg="#475569" color="#f8fafc" size={size} title="Build Makefile" />;
  }
  if (baseName === "dockerfile" || baseName.startsWith("docker-compose")) {
    return <LangBadge text="🐳" bg="#0284c7" size={size} fontSize={size * 0.75} title="Docker Config" />;
  }
  if (baseName === ".gitignore" || baseName === ".gitattributes" || baseName === ".gitmodules") {
    return <LangBadge text="GIT" bg="#f05032" color="#ffffff" size={size} title="Git Configuration" />;
  }
  if (baseName.startsWith(".env")) {
    return <LangBadge text="ENV" bg="#ca8a04" color="#000000" size={size} title="Environment Variables" />;
  }
  if (baseName === "license" || baseName === "license.md" || baseName === "license.txt") {
    return <FileText size={size} style={{ color: "#fbbf24" }} />;
  }
  if (baseName === "readme.md" || baseName === "readme") {
    return <LangBadge text="RM" bg="#3b82f6" color="#ffffff" size={size} title="Project README" />;
  }

  // 2. Language & File Extensions
  switch (ext) {
    // --- C & C++ ---
    case "c":
      return <LangBadge text="C" bg="#00599c" color="#ffffff" size={size} title="C Source File (.c)" />;
    case "h":
      return <LangBadge text="H" bg="#1d4ed8" color="#93c5fd" size={size} title="C Header File (.h)" />;
    case "cpp":
    case "cc":
    case "cxx":
    case "cp":
      return <LangBadge text="C++" bg="#004482" color="#60a5fa" size={size} title="C++ Source File (.cpp)" />;
    case "hpp":
    case "hh":
    case "hxx":
      return <LangBadge text="H++" bg="#1e3a8a" color="#93c5fd" size={size} title="C++ Header File (.hpp)" />;

    // --- Rust ---
    case "rs":
      return (
        <LangBadge
          text="RS"
          bg="linear-gradient(135deg, #f97316 0%, #c2410c 100%)"
          color="#ffffff"
          size={size}
          title="Rust Source File (.rs)"
          border="1px solid rgba(249,115,22,0.3)"
        />
      );

    // --- Salivo Language ---
    case "sal":
    case "salivo":
      return (
        <LangBadge
          text="S"
          bg="linear-gradient(135deg, #ef4444 0%, #991b1b 100%)"
          color="#ffffff"
          size={size}
          title="Salivo Source File (.sal)"
          border="1px solid rgba(239,68,68,0.4)"
        />
      );

    // --- Python ---
    case "py":
    case "pyw":
    case "pyx":
      return (
        <LangBadge
          text="PY"
          bg="linear-gradient(135deg, #3776ab 0%, #ffd438 100%)"
          color="#ffffff"
          size={size}
          title="Python Source File (.py)"
        />
      );
    case "ipynb":
      return <LangBadge text="JUP" bg="#ea580c" color="#ffffff" size={size} title="Jupyter Notebook (.ipynb)" />;

    // --- TypeScript & JavaScript ---
    case "ts":
      return <LangBadge text="TS" bg="#3178c6" color="#ffffff" size={size} title="TypeScript Source (.ts)" />;
    case "tsx":
      return <LangBadge text="TSX" bg="#235a97" color="#38bdf8" size={size} title="TypeScript React (.tsx)" />;
    case "js":
    case "mjs":
    case "cjs":
      return <LangBadge text="JS" bg="#f7df1e" color="#000000" size={size} title="JavaScript Source (.js)" />;
    case "jsx":
      return <LangBadge text="JSX" bg="#0284c7" color="#f7df1e" size={size} title="JavaScript React (.jsx)" />;

    // --- Go ---
    case "go":
      return <LangBadge text="GO" bg="#00add8" color="#ffffff" size={size} title="Go Source File (.go)" />;

    // --- Java & JVM ---
    case "java":
      return <LangBadge text="☕" bg="#ea580c" color="#ffffff" size={size} fontSize={size * 0.7} title="Java Source File (.java)" />;
    case "jar":
    case "class":
      return <LangBadge text="JAR" bg="#c2410c" color="#fed7aa" size={size} title="Java Bytecode (.jar)" />;
    case "kt":
    case "kts":
      return <LangBadge text="KT" bg="linear-gradient(135deg, #7f52ff 0%, #c711e1 100%)" color="#fff" size={size} title="Kotlin File (.kt)" />;
    case "scala":
    case "sc":
      return <LangBadge text="SC" bg="#dc322f" color="#ffffff" size={size} title="Scala File (.scala)" />;

    // --- Swift & Apple ---
    case "swift":
      return <LangBadge text="SW" bg="#f05138" color="#ffffff" size={size} title="Swift Source File (.swift)" />;

    // --- C# & .NET ---
    case "cs":
    case "csx":
      return <LangBadge text="C#" bg="#68217a" color="#e9d5ff" size={size} title="C# Source File (.cs)" />;

    // --- Web Languages ---
    case "html":
    case "htm":
    case "xhtml":
      return <LangBadge text="<>" bg="#e34f26" color="#ffffff" size={size} title="HTML Document (.html)" />;
    case "css":
      return <LangBadge text="#" bg="#1572b6" color="#ffffff" size={size} title="CSS Stylesheet (.css)" />;
    case "scss":
    case "sass":
      return <LangBadge text="S" bg="#c69" color="#ffffff" size={size} title="Sass Stylesheet (.scss)" />;
    case "less":
      return <LangBadge text="L" bg="#1d365d" color="#93c5fd" size={size} title="Less Stylesheet (.less)" />;

    // --- Data & Config ---
    case "json":
    case "jsonc":
    case "json5":
      return <LangBadge text="{}" bg="#d97706" color="#ffffff" size={size} title="JSON Data (.json)" />;
    case "yaml":
    case "yml":
      return <LangBadge text="YML" bg="#dc2626" color="#ffffff" size={size} title="YAML Configuration (.yml)" />;
    case "toml":
      return <LangBadge text="TOML" bg="#9c4121" color="#fed7aa" size={size} title="TOML Config (.toml)" />;
    case "xml":
    case "svg":
      return <LangBadge text="XML" bg="#059669" color="#ffffff" size={size} title="XML File" />;
    case "sql":
    case "sqlite":
    case "db":
      return <LangBadge text="SQL" bg="#0891b2" color="#ffffff" size={size} title="SQL Database File (.sql)" />;

    // --- Shell & Scripts ---
    case "sh":
    case "bash":
    case "zsh":
      return <LangBadge text=">_" bg="#15803d" color="#86efac" size={size} title="Shell Script (.sh)" />;
    case "bat":
    case "cmd":
      return <LangBadge text="BAT" bg="#1e293b" color="#38bdf8" size={size} title="Windows Batch (.bat)" />;
    case "ps1":
    case "psm1":
      return <LangBadge text="PS1" bg="#0078d4" color="#ffffff" size={size} title="PowerShell Script (.ps1)" />;

    // --- PHP & Ruby ---
    case "php":
      return <LangBadge text="PHP" bg="#777bb4" color="#ffffff" size={size} title="PHP Source (.php)" />;
    case "rb":
    case "erb":
      return <LangBadge text="💎" bg="#b91c1c" color="#ffffff" size={size} fontSize={size * 0.7} title="Ruby Source (.rb)" />;

    // --- Other Languages ---
    case "lua":
      return <LangBadge text="LUA" bg="#000080" color="#93c5fd" size={size} title="Lua Script (.lua)" />;
    case "r":
    case "rmd":
      return <LangBadge text="R" bg="#276dc3" color="#ffffff" size={size} title="R Script (.r)" />;
    case "zig":
      return <LangBadge text="ZIG" bg="#f7a41d" color="#000000" size={size} title="Zig Source (.zig)" />;
    case "nim":
      return <LangBadge text="NIM" bg="#ffe953" color="#000000" size={size} title="Nim Source (.nim)" />;
    case "dart":
      return <LangBadge text="DART" bg="#0175c2" color="#ffffff" size={size} title="Dart File (.dart)" />;
    case "asm":
    case "s":
    case "nasm":
      return <LangBadge text="ASM" bg="#475569" color="#f1f5f9" size={size} title="Assembly Source (.asm)" />;
    case "wasm":
    case "wat":
      return <LangBadge text="WASM" bg="#654ff0" color="#ffffff" size={size} title="WebAssembly (.wasm)" />;

    // --- Documentation & Text ---
    case "md":
    case "markdown":
    case "mdx":
      return <LangBadge text="MD" bg="#0284c7" color="#ffffff" size={size} title="Markdown Document (.md)" />;
    case "txt":
    case "text":
    case "log":
      return <FileText size={size} style={{ color: "var(--color-text-secondary)" }} />;
    case "pdf":
      return <LangBadge text="PDF" bg="#dc2626" color="#ffffff" size={size} title="PDF Document (.pdf)" />;

    // --- Images ---
    case "png":
    case "jpg":
    case "jpeg":
    case "webp":
    case "gif":
    case "bmp":
    case "ico":
      return <ImageIcon size={size} style={{ color: "#a855f7" }} />;

    // --- Audio & Video ---
    case "mp3":
    case "wav":
    case "ogg":
    case "flac":
      return <Music size={size} style={{ color: "#ec4899" }} />;
    case "mp4":
    case "webm":
    case "mov":
    case "mkv":
    case "avi":
      return <Video size={size} style={{ color: "#ec4899" }} />;

    // --- Archives & Binaries ---
    case "zip":
    case "tar":
    case "gz":
    case "7z":
    case "rar":
    case "bz2":
      return <Archive size={size} style={{ color: "#eab308" }} />;
    case "exe":
    case "dll":
    case "bin":
    case "o":
    case "obj":
      return <Cpu size={size} style={{ color: "#94a3b8" }} />;

    default:
      return <FileCode size={size} style={{ color: "var(--color-accent-primary)" }} />;
  }
}
