import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import { X, FileText, Link2 } from "lucide-react";

interface MarkdownPreviewProps {
  content: string;
  onClose?: () => void;
  onOpenFile?: (path: string) => void;
}

export function MarkdownPreview({ content, onClose, onOpenFile }: MarkdownPreviewProps) {
  // Convert Obsidian [[Note]] or [[Note|Alias]] wikilinks into clickable markdown links
  const processedContent = useMemo(() => {
    return content.replace(/\[\[(.*?)\]\]/g, (_, target) => {
      const parts = target.split("|");
      const linkTarget = parts[0].trim();
      const label = (parts[1] || linkTarget).trim();
      return `[🔗 ${label}](wikilink://${linkTarget})`;
    });
  }, [content]);

  return (
    <div
      className="markdown-preview"
      style={{
        height: "100%",
        width: "100%",
        display: "flex",
        flexDirection: "column",
        background: "var(--color-bg-base)",
        color: "var(--color-text-primary)",
        overflow: "hidden",
      }}
    >
      {onClose && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "6px 12px",
            background: "var(--color-bg-surface)",
            borderBottom: "1px solid var(--color-border-default)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: "12px",
              color: "var(--color-text-secondary)",
            }}
          >
            <FileText size={13} style={{ color: "#ef4444" }} />
            <span>Markdown & Wikilink Preview</span>
          </div>
          <button
            className="btn btn--icon"
            onClick={onClose}
            title="Close Preview (Return to Code Editor)"
            style={{ width: 24, height: 24, padding: 0 }}
          >
            <X size={13} />
          </button>
        </div>
      )}
      <div style={{ flex: 1, overflowY: "auto", padding: "24px 32px" }}>
        <div className="markdown-preview__content" style={{ maxWidth: 880, margin: "0 auto", lineHeight: 1.6 }}>
          <ReactMarkdown
            components={{
              a: ({ node: _node, href, children, ...props }) => {
                if (href?.startsWith("wikilink://")) {
                  const target = href.replace("wikilink://", "");
                  return (
                    <span
                      onClick={(e) => {
                        e.preventDefault();
                        if (onOpenFile) {
                          onOpenFile(target);
                        }
                      }}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 3,
                        color: "#ef4444",
                        background: "rgba(239, 68, 68, 0.12)",
                        border: "1px solid rgba(239, 68, 68, 0.3)",
                        borderRadius: 4,
                        padding: "1px 6px",
                        cursor: "pointer",
                        fontWeight: 600,
                        textDecoration: "none",
                        fontSize: "0.95em",
                        transition: "all 0.15s ease",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = "rgba(239, 68, 68, 0.22)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = "rgba(239, 68, 68, 0.12)";
                      }}
                      title={`Jump to [[${target}]]`}
                    >
                      <Link2 size={11} />
                      {children}
                    </span>
                  );
                }
                return (
                  <a href={href} target="_blank" rel="noreferrer" {...props}>
                    {children}
                  </a>
                );
              },
            }}
          >
            {processedContent}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
