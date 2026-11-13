import { listen as tauriListen, emit as tauriEmit, EventCallback, UnlistenFn } from "@tauri-apps/api/event";

/**
 * Checks if running inside Tauri native runtime environment.
 */
export const isTauri = typeof window !== "undefined" && Boolean((window as any).__TAURI_INTERNALS__);

const browserListeners = new Map<string, Set<EventCallback<any>>>();

/**
 * Safe wrapper around Tauri `listen` that uses an in-memory event bus in browser / preview environments.
 */
export async function listen<T>(event: string, handler: EventCallback<T>): Promise<UnlistenFn> {
  if (isTauri) {
    try {
      return await tauriListen<T>(event, handler);
    } catch (e) {
      console.warn(`[Tauri Event] Failed to listen to "${event}":`, e);
      return () => {};
    }
  }

  // Browser fallback event bus
  if (!browserListeners.has(event)) {
    browserListeners.set(event, new Set());
  }
  browserListeners.get(event)!.add(handler);

  return () => {
    browserListeners.get(event)?.delete(handler);
  };
}

/**
 * Safe wrapper around Tauri `emit` that uses an in-memory event bus in browser / preview environments.
 */
export async function emit(event: string, payload?: unknown): Promise<void> {
  if (isTauri) {
    try {
      await tauriEmit(event, payload);
    } catch (e) {
      console.warn(`[Tauri Event] Failed to emit "${event}":`, e);
    }
    return;
  }

  // Browser fallback event bus
  const handlers = browserListeners.get(event);
  if (handlers) {
    const eventObj = { event, id: 0, payload };
    handlers.forEach((h) => {
      try {
        h(eventObj as any);
      } catch (err) {
        console.error(`Error in browser event handler for ${event}:`, err);
      }
    });
  }
}
