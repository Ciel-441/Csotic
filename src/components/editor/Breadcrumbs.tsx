import { useState, useEffect } from "react";
import { ChevronRight, Code, Folder } from "lucide-react";
import { symbols as symbolsService } from "../../services/ipc";
import { SymbolInfo } from "../../types/ipc";
import { getFileIcon } from "./FileIcons";

interface BreadcrumbsProps {
  filePath: string;
  projectPath?: string;
  onNavigateSymbol?: (line: number) => void;
}

export function Breadcrumbs({ filePath, projectPath, onNavigateSymbol }: BreadcrumbsProps) {
  if (!filePath || filePath.startsWith("extension:") || filePath.startsWith("forge:")) {
    return null;
  }

  const [symbols, setSymbols] = useState<SymbolInfo[]>([]);
  const [activeSymbol, setActiveSymbol] = useState<SymbolInfo | null>(null);
  const [isSymbolsOpen, setIsSymbolsOpen] = useState(false);

  // Normalize Windows paths and UNC paths (e.g. \\?\C:\...)
  const cleanPath = (p?: string) => {
    if (!p) return "";
    return p.replace(/^\\\\\?\\/, "").replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "");
  };

  const normFile = cleanPath(filePath);
  const normProject = cleanPath(projectPath);

  let relativePath = normFile;
  if (normProject && normFile.startsWith(normProject)) {
    relativePath = normFile.slice(normProject.length).replace(/^\/+/, "");
  } else {
    // If outside project or no project, strip Windows drive letter prefix (e.g. C:/)
    relativePath = normFile.replace(/^[a-zA-Z]:\//, "");
  }

  const rawSegments = relativePath.split("/").filter((s) => s.length > 0 && s !== "?" && s !== ".");
  const fileName = rawSegments.pop() || normFile.split("/").pop() || "untitled";
  const segments = rawSegments;

  useEffect(() => {
    let active = true;
    if (filePath) {
      symbolsService.extract(filePath).then((res) => {
        if (!active) return;
        if (res.success && Array.isArray(res.data)) {
          setSymbols(res.data as SymbolInfo[]);
          if ((res.data as SymbolInfo[]).length > 0) {
            setActiveSymbol((res.data as SymbolInfo[])[0]);
          } else {
            setActiveSymbol(null);
          }
        } else {
          setSymbols([]);
          setActiveSymbol(null);
        }
      }).catch(() => {
        if (active) {
          setSymbols([]);
          setActiveSymbol(null);
        }
      });
    }
    return () => { active = false; };
  }, [filePath]);

  return (
    <div className="breadcrumbs" style={{
      display: "flex",
      alignItems: "center",
      gap: 4,
      padding: "3px 12px",
      fontSize: "11.5px",
      color: "var(--color-text-tertiary)",
      background: "var(--color-bg-base)",
      borderBottom: "1px solid var(--color-border-subtle)",
      userSelect: "none",
      height: 26,
      overflow: "hidden",
    }}>
      {/* Directory segments */}
      {segments.map((seg, idx) => (
        <span key={idx} style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
          <Folder size={12} style={{ opacity: 0.6 }} />
          <span>{seg}</span>
          <ChevronRight size={10} style={{ opacity: 0.4 }} />
        </span>
      ))}

      {/* Current File */}
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--color-text-secondary)" }}>
        {getFileIcon(fileName, 12)}
        <span style={{ fontWeight: 500 }}>{fileName}</span>
      </span>

      {/* AST Symbol Dropdown if available */}
      {symbols.length > 0 && (
        <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
          <ChevronRight size={10} style={{ opacity: 0.4, marginRight: 4 }} />
          <button
            onClick={() => setIsSymbolsOpen(!isSymbolsOpen)}
            style={{
              background: "transparent",
              border: "none",
              padding: "1px 4px",
              borderRadius: 3,
              color: "var(--color-text-secondary)",
              fontSize: "11.5px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
            title="Jump to symbol"
          >
            <Code size={11} style={{ color: "#ef4444" }} />
            <span>{activeSymbol ? activeSymbol.name : `${symbols.length} symbols`}</span>
          </button>

          {isSymbolsOpen && (
            <div
              style={{
                position: "absolute",
                top: "100%",
                left: 0,
                zIndex: 40,
                background: "var(--color-bg-elevated)",
                border: "1px solid var(--color-border-default)",
                borderRadius: "var(--radius-md)",
                boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
                padding: "4px 0",
                maxHeight: 200,
                overflowY: "auto",
                minWidth: 160,
              }}
            >
              {symbols.map((sym, idx) => (
                <div
                  key={idx}
                  onClick={() => {
                    setActiveSymbol(sym);
                    setIsSymbolsOpen(false);
                    onNavigateSymbol?.(sym.start_line);
                  }}
                  style={{
                    padding: "4px 10px",
                    fontSize: "11px",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    color: "var(--color-text-primary)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "var(--color-bg-surface)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                  }}
                >
                  <span style={{ fontSize: "9px", opacity: 0.5, textTransform: "uppercase" }}>{sym.kind[0]}</span>
                  <span>{sym.name}</span>
                  <span style={{ marginLeft: "auto", fontSize: "10px", color: "var(--color-text-tertiary)" }}>:{sym.start_line}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
