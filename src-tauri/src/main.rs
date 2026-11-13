// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "windows")]
    {
        // High-performance, low-RAM flags for Windows Edge WebView2 (Chromium engine)
        // - Limits renderer processes
        // - Disables unused Chromium background networks, updates, and telemetry
        // - Enables low-end memory mode for aggressive GC and compressed caches
        let low_memory_args = "--disable-features=RendererCodeIntegrity,Translate,CalculateNativeWinOcclusion,OptimizationHints,MediaRouter,DialMediaRouteProvider --disable-background-networking --disable-component-update --disable-sync --disable-extensions --disable-default-apps --disable-breakpad --disable-hang-monitor --renderer-process-limit=1 --enable-low-end-device-mode";
        let existing = std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").unwrap_or_default();
        let combined = if existing.is_empty() {
            low_memory_args.to_string()
        } else {
            format!("{existing} {low_memory_args}")
        };
        std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", combined);
    }

    forge_lib::run()
}

