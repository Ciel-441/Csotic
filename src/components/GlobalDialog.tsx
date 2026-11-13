import { useState, useEffect, useRef } from "react";
import { AlertTriangle, Info, HelpCircle, Edit3, X } from "lucide-react";

export type DialogOptions = {
  type: "alert" | "confirm" | "prompt";
  title?: string;
  message: string;
  defaultValue?: string;
  confirmText?: string;
  cancelText?: string;
  isDanger?: boolean;
  resolve: (value: any) => void;
};

export type ToastItem = {
  id: string;
  message: string;
  type: "success" | "error" | "warning" | "info";
  duration: number;
};

let showDialogHandler: ((options: DialogOptions) => void) | null = null;
let showToastHandler: ((toast: ToastItem) => void) | null = null;

export const CustomDialog = {
  alert(message: string, title = "Notice"): Promise<boolean> {
    return new Promise((resolve) => {
      if (showDialogHandler) {
        showDialogHandler({ type: "alert", title, message, resolve });
      } else {
        console.warn("GlobalDialogProvider not mounted:", message);
        resolve(true);
      }
    });
  },

  confirm(message: string, title?: string, isDanger = true, confirmText = "Confirm", cancelText = "Cancel"): Promise<boolean> {
    return new Promise((resolve) => {
      if (showDialogHandler) {
        showDialogHandler({
          type: "confirm",
          title: title || (isDanger ? "Confirm Action" : "Confirmation"),
          message,
          isDanger,
          confirmText: isDanger && confirmText === "Confirm" ? "Delete" : confirmText,
          cancelText,
          resolve,
        });
      } else {
        resolve(false);
      }
    });
  },

  prompt(message: string, defaultValue = "", title = "Input Required"): Promise<string | null> {
    return new Promise((resolve) => {
      if (showDialogHandler) {
        showDialogHandler({
          type: "prompt",
          title,
          message,
          defaultValue,
          resolve,
        });
      } else {
        resolve(null);
      }
    });
  },

  toast(message: string, type: "success" | "error" | "warning" | "info" = "info", duration = 3000): void {
    if (showToastHandler) {
      showToastHandler({
        id: `toast_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        message,
        type,
        duration,
      });
    } else {
      console.log(`[Toast ${type}]:`, message);
    }
  },
};

export function GlobalDialogProvider() {
  const [dialog, setDialog] = useState<DialogOptions | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    showDialogHandler = setDialog;
    showToastHandler = (t: ToastItem) => {
      setToasts((prev) => [...prev, t]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((item) => item.id !== t.id));
      }, t.duration);
    };

    // Intercept standard window.alert
    window.alert = (msg: string) => {
      CustomDialog.alert(msg);
    };
    return () => {
      showDialogHandler = null;
      showToastHandler = null;
    };
  }, []);

  useEffect(() => {
    if (dialog && dialog.type === "prompt") {
      setInputValue(dialog.defaultValue || "");
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setInputValue("");
    }
  }, [dialog]);

  useEffect(() => {
    if (!dialog) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        dialog.resolve(dialog.type === "prompt" ? null : false);
        setDialog(null);
      } else if (e.key === "Enter" && dialog.type !== "prompt") {
        e.preventDefault();
        e.stopPropagation();
        dialog.resolve(true);
        setDialog(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [dialog, inputValue]);

  const isDanger = dialog ? (dialog.isDanger ?? (dialog.type === "confirm" && /delete|remove|erase|discard|destroy/i.test(dialog.message + " " + (dialog.title || "")))) : false;

  const handleConfirm = () => {
    if (!dialog) return;
    if (dialog.type === "prompt") {
      dialog.resolve(inputValue);
    } else {
      dialog.resolve(true);
    }
    setDialog(null);
  };

  const handleCancel = () => {
    if (!dialog) return;
    if (dialog.type === "prompt") {
      dialog.resolve(null);
    } else {
      dialog.resolve(false);
    }
    setDialog(null);
  };

  return (
    <>
      {dialog && (
        <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 99999,
        animation: "dialogBackdropFade 0.15s ease-out both",
      }}
      onClick={handleCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--color-bg-elevated, #16161a)",
          border: isDanger ? "1px solid rgba(239, 68, 68, 0.35)" : "1px solid var(--color-border-active, rgba(255, 255, 255, 0.14))",
          borderRadius: 10,
          width: "440px",
          maxWidth: "92vw",
          padding: "20px 22px",
          display: "flex",
          flexDirection: "column",
          gap: 14,
          boxShadow: isDanger
            ? "0 24px 48px rgba(0, 0, 0, 0.7), 0 0 20px rgba(239, 68, 68, 0.12)"
            : "0 24px 48px rgba(0, 0, 0, 0.7)",
          transform: "scale(1)",
          animation: "dialogModalPop 0.18s cubic-bezier(0.16, 1, 0.3, 1) both",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 6,
                background: isDanger
                  ? "rgba(239, 68, 68, 0.18)"
                  : dialog.type === "prompt"
                  ? "rgba(168, 85, 247, 0.18)"
                  : "rgba(59, 130, 246, 0.18)",
                border: isDanger
                  ? "1px solid rgba(239, 68, 68, 0.35)"
                  : dialog.type === "prompt"
                  ? "1px solid rgba(168, 85, 247, 0.35)"
                  : "1px solid rgba(59, 130, 246, 0.35)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: isDanger
                  ? "#ef4444"
                  : dialog.type === "prompt"
                  ? "#a855f7"
                  : "#3b82f6",
                flexShrink: 0,
              }}
            >
              {isDanger ? (
                <AlertTriangle size={15} />
              ) : dialog.type === "prompt" ? (
                <Edit3 size={14} />
              ) : dialog.type === "confirm" ? (
                <HelpCircle size={15} />
              ) : (
                <Info size={15} />
              )}
            </div>
            <div
              style={{
                fontSize: "14.5px",
                fontWeight: 600,
                color: "var(--color-text-primary, #ffffff)",
                letterSpacing: "-0.2px",
              }}
            >
              {dialog.title || (dialog.type === "prompt" ? "Input Required" : dialog.type === "confirm" ? "Confirm Action" : "Notice")}
            </div>
          </div>

          <button
            onClick={handleCancel}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--color-text-tertiary, #94a3b8)",
              cursor: "pointer",
              padding: 4,
              borderRadius: 4,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "color 0.12s, background 0.12s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "#ffffff";
              e.currentTarget.style.background = "rgba(255, 255, 255, 0.08)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "var(--color-text-tertiary, #94a3b8)";
              e.currentTarget.style.background = "transparent";
            }}
          >
            <X size={15} />
          </button>
        </div>

        {/* Message */}
        <div
          style={{
            fontSize: "13px",
            color: "var(--color-text-secondary, #cbd5e1)",
            lineHeight: 1.55,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {dialog.message}
        </div>

        {/* Input for Prompts */}
        {dialog.type === "prompt" && (
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleConfirm();
              }
            }}
            style={{
              width: "100%",
              height: 36,
              background: "rgba(0, 0, 0, 0.35)",
              border: "1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.12))",
              borderRadius: 6,
              padding: "0 11px",
              color: "#ffffff",
              fontSize: "13px",
              outline: "none",
              boxShadow: "inset 0 1px 2px rgba(0,0,0,0.3)",
            }}
            onFocus={(e) => {
              e.target.style.borderColor = "var(--color-accent, #ef4444)";
            }}
            onBlur={(e) => {
              e.target.style.borderColor = "var(--color-border-subtle, rgba(255, 255, 255, 0.12))";
            }}
          />
        )}

        {/* Actions */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 8,
            marginTop: 4,
          }}
        >
          {(dialog.type === "confirm" || dialog.type === "prompt") && (
            <button
              onClick={handleCancel}
              style={{
                height: 32,
                padding: "0 14px",
                background: "rgba(255, 255, 255, 0.07)",
                border: "1px solid rgba(255, 255, 255, 0.12)",
                borderRadius: 5,
                color: "var(--color-text-secondary, #cbd5e1)",
                fontSize: "12.5px",
                fontWeight: 500,
                cursor: "pointer",
                transition: "all 0.12s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(255, 255, 255, 0.12)";
                e.currentTarget.style.color = "#ffffff";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "rgba(255, 255, 255, 0.07)";
                e.currentTarget.style.color = "var(--color-text-secondary, #cbd5e1)";
              }}
            >
              {dialog.cancelText || "Cancel"}
            </button>
          )}

          <button
            onClick={handleConfirm}
            style={{
              height: 32,
              padding: "0 16px",
              background: isDanger
                ? "linear-gradient(180deg, #ef4444 0%, #dc2626 100%)"
                : "linear-gradient(180deg, #ef4444 0%, #dc2626 100%)",
              border: isDanger
                ? "1px solid #f87171"
                : "1px solid #f87171",
              borderRadius: 5,
              color: "#ffffff",
              fontSize: "12.5px",
              fontWeight: 600,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 5,
              boxShadow: "0 2px 8px rgba(239, 68, 68, 0.35)",
              transition: "all 0.12s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.filter = "brightness(1.1)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.filter = "none";
            }}
          >
            {isDanger ? (
              <span>{dialog.confirmText || "Delete"}</span>
            ) : dialog.type === "prompt" ? (
              <span>Save</span>
            ) : (
              <span>{dialog.confirmText || "OK"}</span>
            )}
          </button>
        </div>
      </div>
    </div>
    )}

    {/* Transient Toast Notifications */}
    {toasts.length > 0 && (
      <div style={{
        position: "fixed",
        bottom: 24,
        right: 24,
        zIndex: 100000,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        pointerEvents: "none",
      }}>
        {toasts.map((t) => (
          <div
            key={t.id}
            style={{
              padding: "10px 16px",
              background: "#16131f",
              border: t.type === "error"
                ? "1px solid #7f1d1d"
                : t.type === "success"
                ? "1px solid #166534"
                : t.type === "warning"
                ? "1px solid #854d0e"
                : "1px solid #2f283a",
              borderRadius: 8,
              color: t.type === "error"
                ? "#fca5a5"
                : t.type === "success"
                ? "#86efac"
                : t.type === "warning"
                ? "#fde047"
                : "#f3f4f6",
              fontSize: "12.5px",
              fontWeight: 500,
              boxShadow: "0 10px 30px rgba(0,0,0,0.85), 0 0 1px 1px rgba(255,255,255,0.06)",
              display: "flex",
              alignItems: "center",
              gap: 8,
              pointerEvents: "auto",
              animation: "slideInUp 0.15s ease",
            }}
          >
            <span>{t.type === "error" ? "⚠️" : t.type === "success" ? "✅" : t.type === "warning" ? "⚡" : "ℹ️"}</span>
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    )}
    </>
  );
}
