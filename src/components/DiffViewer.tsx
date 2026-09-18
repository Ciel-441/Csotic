import { useMemo } from "react";
import * as diff from "diff";
import { X, GitCompare } from "lucide-react";

interface DiffViewerProps {
  oldContent: string;
  newContent: string;
  onClose?: () => void;
}

export function DiffViewer({ oldContent, newContent, onClose }: DiffViewerProps) {
  const diffs = useMemo(() => {
    return diff.diffLines(oldContent, newContent);
  }, [oldContent, newContent]);

  let oldLineNum = 1;
  let newLineNum = 1;

  return (
    <div className="diff-viewer-container" style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "var(--color-bg-base)" }}>
      {onClose && (
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "6px 12px",
          background: "var(--color-bg-surface)",
          borderBottom: "1px solid var(--color-border-default)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "12px", color: "var(--color-text-secondary)" }}>
            <GitCompare size={13} style={{ color: "var(--color-accent-primary)" }} />
            <span>Diff Review</span>
          </div>
          <button
            className="btn btn--icon"
            onClick={onClose}
            title="Close Diff Viewer"
            style={{ width: 24, height: 24, padding: 0 }}
          >
            <X size={13} />
          </button>
        </div>
      )}
      <div className="diff-viewer" style={{ flex: 1, overflowY: "auto" }}>
        {diffs.map((part, index) => {
          const lines = part.value.split("\n");
          if (lines[lines.length - 1] === "") {
            lines.pop(); // Remove the trailing empty line created by split
          }

          return lines.map((line, lineIndex) => {
            let lineOld = "";
            let lineNew = "";
            let className = "diff-viewer-row ";

            if (part.added) {
              lineNew = String(newLineNum++);
              className += "add";
            } else if (part.removed) {
              lineOld = String(oldLineNum++);
              className += "remove";
            } else {
              lineOld = String(oldLineNum++);
              lineNew = String(newLineNum++);
            }

            return (
              <div key={`${index}-${lineIndex}`} className={className}>
                <div className="diff-line-num" style={{ background: "rgba(0,0,0,0.2)" }}>{lineOld}</div>
                <div className="diff-line-num" style={{ background: "rgba(0,0,0,0.1)", borderRight: "1px solid var(--color-border-default)" }}>{lineNew}</div>
                <div className="diff-content">
                  {part.added ? "+ " : part.removed ? "- " : "  "}
                  {line}
                </div>
              </div>
            );
          });
        })}
      </div>
    </div>
  );
}
