import React, { useState } from "react";
import { 
  FileCode, 
  FolderOpen, 
  Folder, 
  Star, 
  Coffee, 
  FileText, 
  Code2 
} from "lucide-react";
import { ProjectInfo } from "../types/ipc";
import { WalkthroughModal, WalkthroughType } from "./WalkthroughModal";
import csoticLogo from "../assets/logo.png";

interface WelcomeViewProps {
  onNewFile: () => void;
  onOpenFile: () => void;
  onOpenFolder: () => void;
  onRevealInExplorer: () => void;
  onOpenTerminal: () => void;
  onOpenSearch: () => void;
  recentProjects: ProjectInfo[];
  onOpenProject: (path: string) => void;
  activeProject: ProjectInfo | null;
  onOpenFileByPath: (path: string) => void;
  theme?: "dark" | "light";
}

export function CsoticLogoIcon({ 
  size = 52, 
  style, 
  className 
}: { 
  size?: number; 
  style?: React.CSSProperties; 
  className?: string; 
}) {
  return (
    <img 
      src={csoticLogo} 
      alt="Csotic Logo" 
      width={size} 
      height={size} 
      className={className}
      style={{ 
        width: size, 
        height: size, 
        objectFit: "contain", 
        flexShrink: 0, 
        filter: "drop-shadow(0 4px 18px rgba(239, 68, 68, 0.45))",
        userSelect: "none",
        pointerEvents: "none",
        ...style 
      }} 
      draggable={false}
    />
  );
}

export function WelcomeView({
  onNewFile,
  onOpenFile,
  onOpenFolder,
  onRevealInExplorer: _onRevealInExplorer,
  onOpenTerminal,
  onOpenSearch,
  recentProjects: _recentProjects = [],
  onOpenProject,
  activeProject,
  onOpenFileByPath,
  theme = "dark",
}: WelcomeViewProps) {
  const [showOnStartup, setShowOnStartup] = useState<boolean>(() => {
    const saved = localStorage.getItem("csotic.show_welcome_on_startup");
    return saved !== "false";
  });

  const [activeWalkthrough, setActiveWalkthrough] = useState<WalkthroughType | null>(null);

  const handleToggleStartup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.checked;
    setShowOnStartup(next);
    localStorage.setItem("csotic.show_welcome_on_startup", next ? "true" : "false");
  };

  const isLight = theme === "light";

  // Cleaned: no fake or hardcoded projects shown for now per user instruction
  const displayProjects = React.useMemo<ProjectInfo[]>(() => {
    return [];
  }, []);

  return (
    <div
      style={{
        flex: 1,
        width: "100%",
        height: "100%",
        overflowY: "auto",
        overflowX: "hidden",
        background: isLight 
          ? "radial-gradient(circle at 50% 0%, #fee2e2 0%, #f8fafc 60%)" 
          : "radial-gradient(circle at 50% 0%, #200407 0%, var(--color-bg-base, #000000) 75%)",
        color: isLight ? "#0f172a" : "#e2e8f0",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "48px 48px 40px 48px",
        boxSizing: "border-box",
        userSelect: "none",
        transition: "background 0.2s ease, color 0.2s ease",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 980,
          display: "flex",
          flexDirection: "column",
          gap: 36,
        }}
      >
        {/* Header: Logo & Clean Title */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <CsoticLogoIcon size={56} />
          <div>
            <h1
              style={{
                fontSize: "28px",
                fontWeight: 700,
                color: isLight ? "#0f172a" : "#ffffff",
                letterSpacing: "0.4px",
                margin: 0,
                lineHeight: 1.1,
                fontFamily: "var(--font-heading, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif)",
              }}
            >
              Csotic
            </h1>
            <p
              style={{
                fontSize: "13px",
                color: isLight ? "#64748b" : "#94a3b8",
                margin: "4px 0 0 0",
                fontWeight: 400,
              }}
            >
              Editing evolved • A modern IDE for students &amp; developers
            </p>
          </div>
        </div>

        {/* 2-Column Grid with generous spacing */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1.35fr",
            gap: 48,
            alignItems: "start",
          }}
        >
          {/* Left Column: Start & Recent */}
          <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
            {/* Start Section */}
            <div>
              <h2
                style={{
                  fontSize: "13px",
                  fontWeight: 600,
                  color: isLight ? "#475569" : "#a1a1aa",
                  margin: "0 0 10px 0",
                  textTransform: "none",
                }}
              >
                Start
              </h2>

              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <button
                  onClick={onNewFile}
                  className="welcome-action-btn"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "7px 10px",
                    background: "transparent",
                    border: "none",
                    borderRadius: 6,
                    color: isLight ? "#1e293b" : "#e2e8f0",
                    fontSize: "13px",
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "all 0.15s ease",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = isLight ? "rgba(0, 0, 0, 0.05)" : "rgba(255, 255, 255, 0.06)")}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                >
                  <FileCode size={15} style={{ color: "#ef4444", flexShrink: 0 }} />
                  <span>New File...</span>
                </button>

                <button
                  onClick={onOpenFile}
                  className="welcome-action-btn"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "7px 10px",
                    background: "transparent",
                    border: "none",
                    borderRadius: 6,
                    color: isLight ? "#1e293b" : "#e2e8f0",
                    fontSize: "13px",
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "all 0.15s ease",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = isLight ? "rgba(0, 0, 0, 0.05)" : "rgba(255, 255, 255, 0.06)")}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                >
                  <FolderOpen size={15} style={{ color: "#ef4444", flexShrink: 0 }} />
                  <span>Open File...</span>
                </button>

                <button
                  onClick={onOpenFolder}
                  className="welcome-action-btn"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "7px 10px",
                    background: "transparent",
                    border: "none",
                    borderRadius: 6,
                    color: isLight ? "#1e293b" : "#e2e8f0",
                    fontSize: "13px",
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "all 0.15s ease",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = isLight ? "rgba(0, 0, 0, 0.05)" : "rgba(255, 255, 255, 0.06)")}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                >
                  <Folder size={15} style={{ color: "#ef4444", flexShrink: 0 }} />
                  <span>Open Folder...</span>
                </button>
              </div>
            </div>

            {/* Recent Section */}
            <div>
              <h2
                style={{
                  fontSize: "13px",
                  fontWeight: 600,
                  color: isLight ? "#475569" : "#a1a1aa",
                  margin: "0 0 10px 0",
                  textTransform: "none",
                }}
              >
                Recent
              </h2>

              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {displayProjects.length > 0 ? (
                  <>
                    {displayProjects.map((p, idx) => (
                      <div
                        key={p.path || idx}
                        onClick={() => onOpenProject(p.path)}
                        style={{
                          cursor: "pointer",
                          padding: "6px 8px",
                          borderRadius: 6,
                          transition: "all 0.12s ease",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = isLight ? "rgba(0, 0, 0, 0.05)" : "rgba(255, 255, 255, 0.06)")}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                      >
                        <div style={{ fontSize: "13px", fontWeight: 500, color: isLight ? "#0f172a" : "#ffffff", lineHeight: 1.2 }}>
                          {p.name || p.path.split(/[/\\]/).pop() || "project"}
                        </div>
                        <div
                          style={{
                            fontSize: "11px",
                            color: isLight ? "#64748b" : "#71717a",
                            marginTop: 2,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {p.path}
                        </div>
                      </div>
                    ))}

                    <button
                      onClick={onOpenSearch}
                      style={{
                        background: "none",
                        border: "none",
                        color: "#ef4444",
                        fontSize: "12px",
                        cursor: "pointer",
                        textAlign: "left",
                        padding: "4px 8px",
                        alignSelf: "flex-start",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
                      onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}
                    >
                      More...
                    </button>
                  </>
                ) : (
                  <div
                    style={{
                      fontSize: "12px",
                      color: isLight ? "#94a3b8" : "#71717a",
                      fontStyle: "italic",
                      padding: "4px 2px",
                    }}
                  >
                    No recent folders
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right Column: Walkthroughs in Clean Modern Cards */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <h2
              style={{
                fontSize: "13px",
                fontWeight: 600,
                color: isLight ? "#475569" : "#a1a1aa",
                margin: "0 0 6px 0",
                textTransform: "none",
              }}
            >
              Walkthroughs
            </h2>

            {/* Card 1: Csotic Get Started */}
            <div
              onClick={() => setActiveWalkthrough("csotic")}
              style={{
                background: isLight ? "#ffffff" : "rgba(255, 255, 255, 0.02)",
                border: isLight ? "1px solid #e2e8f0" : "1px solid rgba(255, 255, 255, 0.07)",
                borderRadius: 8,
                padding: "12px 14px",
                display: "flex",
                gap: 12,
                cursor: "pointer",
                boxShadow: isLight ? "0 1px 3px rgba(0, 0, 0, 0.05)" : "none",
                transition: "all 0.15s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = isLight ? "#fff5f5" : "rgba(239, 68, 68, 0.06)";
                e.currentTarget.style.borderColor = "rgba(239, 68, 68, 0.35)";
                if (isLight) e.currentTarget.style.boxShadow = "0 4px 12px rgba(239, 68, 68, 0.08)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = isLight ? "#ffffff" : "rgba(255, 255, 255, 0.02)";
                e.currentTarget.style.borderColor = isLight ? "#e2e8f0" : "rgba(255, 255, 255, 0.07)";
                if (isLight) e.currentTarget.style.boxShadow = "0 1px 3px rgba(0, 0, 0, 0.05)";
              }}
            >
              <div
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 6,
                  background: "rgba(239, 68, 68, 0.1)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  marginTop: 1,
                }}
              >
                <Star size={15} style={{ color: "#ef4444" }} />
              </div>
              <div>
                <h3 style={{ fontSize: "13px", fontWeight: 600, color: isLight ? "#0f172a" : "#ffffff", margin: 0 }}>
                  Get started with Csotic
                </h3>
                <p style={{ fontSize: "12px", color: isLight ? "#64748b" : "#8b949e", margin: "3px 0 0 0", lineHeight: 1.4 }}>
                  Customize your editor, learn shortcuts, and start coding.
                </p>
              </div>
            </div>

            {/* Card 2: Java */}
            <div
              onClick={() => setActiveWalkthrough("java")}
              style={{
                background: isLight ? "#ffffff" : "rgba(255, 255, 255, 0.02)",
                border: isLight ? "1px solid #e2e8f0" : "1px solid rgba(255, 255, 255, 0.07)",
                borderRadius: 8,
                padding: "12px 14px",
                display: "flex",
                gap: 12,
                cursor: "pointer",
                boxShadow: isLight ? "0 1px 3px rgba(0, 0, 0, 0.05)" : "none",
                transition: "all 0.15s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = isLight ? "#fff5f5" : "rgba(239, 68, 68, 0.06)";
                e.currentTarget.style.borderColor = "rgba(239, 68, 68, 0.35)";
                if (isLight) e.currentTarget.style.boxShadow = "0 4px 12px rgba(239, 68, 68, 0.08)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = isLight ? "#ffffff" : "rgba(255, 255, 255, 0.02)";
                e.currentTarget.style.borderColor = isLight ? "#e2e8f0" : "rgba(255, 255, 255, 0.07)";
                if (isLight) e.currentTarget.style.boxShadow = "0 1px 3px rgba(0, 0, 0, 0.05)";
              }}
            >
              <div
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 6,
                  background: "rgba(239, 68, 68, 0.1)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  marginTop: 1,
                }}
              >
                <Coffee size={15} style={{ color: "#ef4444" }} />
              </div>
              <div>
                <h3 style={{ fontSize: "13px", fontWeight: 600, color: isLight ? "#0f172a" : "#ffffff", margin: 0 }}>
                  Get Started with Java Development
                </h3>
                <p style={{ fontSize: "12px", color: isLight ? "#64748b" : "#8b949e", margin: "3px 0 0 0", lineHeight: 1.4 }}>
                  Single-file compilation and instant execution with auto-detected JDK.
                </p>
              </div>
            </div>

            {/* Card 3: Python */}
            <div
              onClick={() => setActiveWalkthrough("python")}
              style={{
                background: isLight ? "#ffffff" : "rgba(255, 255, 255, 0.02)",
                border: isLight ? "1px solid #e2e8f0" : "1px solid rgba(255, 255, 255, 0.07)",
                borderRadius: 8,
                padding: "12px 14px",
                display: "flex",
                gap: 12,
                cursor: "pointer",
                boxShadow: isLight ? "0 1px 3px rgba(0, 0, 0, 0.05)" : "none",
                transition: "all 0.15s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = isLight ? "#fff5f5" : "rgba(239, 68, 68, 0.06)";
                e.currentTarget.style.borderColor = "rgba(239, 68, 68, 0.35)";
                if (isLight) e.currentTarget.style.boxShadow = "0 4px 12px rgba(239, 68, 68, 0.08)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = isLight ? "#ffffff" : "rgba(255, 255, 255, 0.02)";
                e.currentTarget.style.borderColor = isLight ? "#e2e8f0" : "rgba(255, 255, 255, 0.07)";
                if (isLight) e.currentTarget.style.boxShadow = "0 1px 3px rgba(0, 0, 0, 0.05)";
              }}
            >
              <div
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 6,
                  background: "rgba(239, 68, 68, 0.1)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  marginTop: 1,
                }}
              >
                <FileText size={15} style={{ color: "#ef4444" }} />
              </div>
              <div>
                <h3 style={{ fontSize: "13px", fontWeight: 600, color: isLight ? "#0f172a" : "#ffffff", margin: 0 }}>
                  Get Started with Python Development
                </h3>
                <p style={{ fontSize: "12px", color: isLight ? "#64748b" : "#8b949e", margin: "3px 0 0 0", lineHeight: 1.4 }}>
                  Write and run Python 3 scripts with interactive output.
                </p>
              </div>
            </div>

            {/* Card 4: C / C++ */}
            <div
              onClick={() => setActiveWalkthrough("cpp")}
              style={{
                background: isLight ? "#ffffff" : "rgba(255, 255, 255, 0.02)",
                border: isLight ? "1px solid #e2e8f0" : "1px solid rgba(255, 255, 255, 0.07)",
                borderRadius: 8,
                padding: "12px 14px",
                display: "flex",
                gap: 12,
                cursor: "pointer",
                boxShadow: isLight ? "0 1px 3px rgba(0, 0, 0, 0.05)" : "none",
                transition: "all 0.15s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = isLight ? "#fff5f5" : "rgba(239, 68, 68, 0.06)";
                e.currentTarget.style.borderColor = "rgba(239, 68, 68, 0.35)";
                if (isLight) e.currentTarget.style.boxShadow = "0 4px 12px rgba(239, 68, 68, 0.08)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = isLight ? "#ffffff" : "rgba(255, 255, 255, 0.02)";
                e.currentTarget.style.borderColor = isLight ? "#e2e8f0" : "rgba(255, 255, 255, 0.07)";
                if (isLight) e.currentTarget.style.boxShadow = "0 1px 3px rgba(0, 0, 0, 0.05)";
              }}
            >
              <div
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 6,
                  background: "rgba(239, 68, 68, 0.1)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  marginTop: 1,
                }}
              >
                <Code2 size={15} style={{ color: "#ef4444" }} />
              </div>
              <div>
                <h3 style={{ fontSize: "13px", fontWeight: 600, color: isLight ? "#0f172a" : "#ffffff", margin: 0 }}>
                  Get Started with C / C++ Development
                </h3>
                <p style={{ fontSize: "12px", color: isLight ? "#64748b" : "#8b949e", margin: "3px 0 0 0", lineHeight: 1.4 }}>
                  Compile and run C &amp; C++ files with GCC/Clang.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Right Checkbox */}
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              fontSize: "12px",
              color: isLight ? "#64748b" : "#a1a1aa",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={showOnStartup}
              onChange={handleToggleStartup}
              style={{
                accentColor: "#ef4444",
                cursor: "pointer",
              }}
            />
            <span>Show welcome page on startup</span>
          </label>
        </div>
      </div>

      {/* Interactive Walkthrough Modal */}
      {activeWalkthrough && (
        <WalkthroughModal
          type={activeWalkthrough}
          onClose={() => setActiveWalkthrough(null)}
          activeProject={activeProject}
          onOpenFile={onOpenFileByPath}
          onOpenTerminal={onOpenTerminal}
        />
      )}
    </div>
  );
}
