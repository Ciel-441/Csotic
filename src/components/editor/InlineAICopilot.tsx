import { useState, useRef, useEffect } from "react";
import { Sparkles, Check, X, ArrowRight, Loader2, RefreshCw } from "lucide-react";
import { models } from "../../services/ipc";
import { listen } from "@tauri-apps/api/event";
import { DiffViewer } from "../DiffViewer";

interface InlineAICopilotProps {
  filePath: string;
  selectedText: string;
  activeModel: string | null;
  onAccept: (newCode: string) => void;
  onClose: () => void;
}

const PRESET_PROMPTS = [
  "Refactor & Clean",
  "Add Error Handling",
  "Add TypeScript Types",
  "Optimize Performance",
  "Add JSDoc / Comments",
  "Write Unit Tests",
];

export function InlineAICopilot({
  filePath,
  selectedText,
  activeModel,
  onAccept,
  onClose,
}: InlineAICopilotProps) {
  const [prompt, setPrompt] = useState("");
  const [generatedCode, setGeneratedCode] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const requestIdRef = useRef<string>("");

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Listen to streaming chunks
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let accumulated = "";

    listen<{ text: string; request_id: string }>("model-stream-chunk", (event) => {
      if (event.payload.request_id === requestIdRef.current) {
        accumulated += event.payload.text;
        setGeneratedCode(accumulated);
      }
    }).then((stop) => {
      unlisten = stop;
    });

    return () => {
      unlisten?.();
    };
  }, []);

  const handleGenerate = async (customPrompt?: string) => {
    const activePrompt = customPrompt || prompt;
    if (!activePrompt.trim()) return;
    if (!activeModel) {
      setError("Please select an AI model from the top bar.");
      return;
    }

    setIsGenerating(true);
    setError("");
    setGeneratedCode("");

    const reqId = `inline-${Date.now()}`;
    requestIdRef.current = reqId;

    const fileName = filePath.split(/[/\\]/).pop() || "file";
    const systemPrompt = `You are Csotic Inline AI Assistant. You modify and generate code cleanly. Return ONLY the replacement code directly without markdown code fences (\`\`\` or \`\`\`ts) or conversational filler unless comments in code. Provide only valid, drop-in replacement code.`;

    const userPrompt = `File: ${fileName}
Task: ${activePrompt}

Target code to modify/replace:
${selectedText || "(Generating new code at cursor position)"}

Provide the replacement code:`;

    try {
      const res = await models.streamPrompt(activeModel, userPrompt, systemPrompt, reqId);
      if (!res.success) {
        setError(res.error?.message || "Failed to generate code.");
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setIsGenerating(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (generatedCode) {
        // Clean out any accidental markdown fences
        let cleaned = generatedCode;
        if (cleaned.startsWith("```")) {
          cleaned = cleaned.replace(/^```[a-zA-Z]*\n?/, "").replace(/\n?```$/, "");
        }
        onAccept(cleaned);
      } else {
        void handleGenerate();
      }
    } else if (e.key === "Enter" && !e.shiftKey && !generatedCode) {
      e.preventDefault();
      void handleGenerate();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      className="inline-copilot-overlay"
      style={{
        position: "absolute",
        top: 20,
        right: 40,
        width: 520,
        zIndex: 50,
        background: "rgba(14, 4, 7, 0.95)",
        backdropFilter: "blur(20px)",
        border: "1px solid rgba(239, 68, 68, 0.35)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "0 12px 36px rgba(0, 0, 0, 0.8), 0 0 25px rgba(239, 68, 68, 0.25)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Header bar */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "8px 12px",
        background: "rgba(239, 68, 68, 0.12)",
        borderBottom: "1px solid rgba(239, 68, 68, 0.2)",
        fontSize: "12px",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--color-accent-primary)", fontWeight: 600 }}>
          <Sparkles size={14} />
          <span>Csotic Inline Copilot</span>
          <span style={{ fontSize: "10px", opacity: 0.6, background: "rgba(255,255,255,0.1)", padding: "1px 5px", borderRadius: 4 }}>Ctrl+K</span>
        </div>
        <button
          onClick={onClose}
          style={{ background: "transparent", border: "none", color: "var(--color-text-tertiary)", cursor: "pointer" }}
        >
          <X size={14} />
        </button>
      </div>

      {/* Input container */}
      <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            ref={inputRef}
            type="text"
            placeholder="Edit selected code or ask to generate... (Press Enter)"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            style={{
              flex: 1,
              background: "rgba(0, 0, 0, 0.4)",
              border: "1px solid rgba(255, 255, 255, 0.12)",
              borderRadius: "var(--radius-md)",
              padding: "7px 10px",
              color: "var(--color-text-primary)",
              fontSize: "12.5px",
              outline: "none",
            }}
          />
          <button
            className="btn btn--primary"
            onClick={() => handleGenerate()}
            disabled={isGenerating || !prompt.trim()}
            style={{ display: "flex", alignItems: "center", gap: 5, padding: "0 12px" }}
          >
            {isGenerating ? <Loader2 size={13} className="spin" /> : <ArrowRight size={13} />}
            <span>Run</span>
          </button>
        </div>

        {/* Quick prompt chips */}
        {!generatedCode && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {PRESET_PROMPTS.map((p, idx) => (
              <button
                key={idx}
                onClick={() => {
                  setPrompt(p);
                  void handleGenerate(p);
                }}
                style={{
                  background: "rgba(255, 255, 255, 0.05)",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                  borderRadius: 12,
                  padding: "2px 8px",
                  fontSize: "10.5px",
                  color: "var(--color-text-secondary)",
                  cursor: "pointer",
                  transition: "background 0.15s ease",
                }}
                className="chip-btn"
              >
                {p}
              </button>
            ))}
          </div>
        )}

        {error && (
          <div style={{ color: "var(--color-error)", fontSize: "11px", padding: "4px 0" }}>
            {error}
          </div>
        )}
      </div>

      {/* Generated Diff / Preview */}
      {generatedCode && (
        <div style={{
          maxHeight: 280,
          overflowY: "auto",
          borderTop: "1px solid var(--color-border-subtle)",
          background: "var(--color-bg-base)",
        }}>
          <DiffViewer
            oldContent={selectedText || ""}
            newContent={generatedCode.replace(/^```[a-zA-Z]*\n?/, "").replace(/\n?```$/, "")}
          />
        </div>
      )}

      {/* Action Footer when code is generated */}
      {generatedCode && (
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 12px",
          borderTop: "1px solid var(--color-border-subtle)",
          background: "rgba(0, 0, 0, 0.3)",
        }}>
          <span style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>
            Ctrl+Enter to Accept · Esc to Discard
          </span>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              className="btn btn--secondary"
              onClick={() => handleGenerate()}
              disabled={isGenerating}
              style={{ fontSize: "11.5px", padding: "4px 8px", display: "flex", alignItems: "center", gap: 4 }}
            >
              <RefreshCw size={11} />
              Retry
            </button>
            <button
              className="btn btn--secondary"
              onClick={onClose}
              style={{ fontSize: "11.5px", padding: "4px 8px", display: "flex", alignItems: "center", gap: 4 }}
            >
              <X size={11} />
              Discard
            </button>
            <button
              className="btn btn--primary"
              onClick={() => {
                let cleaned = generatedCode;
                if (cleaned.startsWith("```")) {
                  cleaned = cleaned.replace(/^```[a-zA-Z]*\n?/, "").replace(/\n?```$/, "");
                }
                onAccept(cleaned);
              }}
              style={{ fontSize: "11.5px", padding: "4px 10px", display: "flex", alignItems: "center", gap: 4 }}
            >
              <Check size={12} />
              Accept Diff
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
