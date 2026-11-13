import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "fs/promises";
import path from "path";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

function csoticDevFsPlugin() {
  return {
    name: "csotic-dev-fs-api",
    configureServer(server: any) {
      server.middlewares.use(async (req: any, res: any, next: any) => {
        if (!req.url) return next();
        const urlObj = new URL(req.url, "http://localhost:1420");

        if (urlObj.pathname === "/__api/fs/read") {
          const filePath = urlObj.searchParams.get("path");
          if (!filePath) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ success: false, error: "Missing path parameter" }));
            return;
          }
          try {
            const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
            const content = await fs.readFile(resolved, "utf-8");
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ success: true, content }));
          } catch (err: any) {
            res.statusCode = 404;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ success: false, error: err?.message || "File not found" }));
          }
          return;
        }

        if (urlObj.pathname === "/__api/fs/write" && req.method === "POST") {
          let body = "";
          req.on("data", (chunk: any) => { body += chunk; });
          req.on("end", async () => {
            try {
              const { path: filePath, content } = JSON.parse(body);
              if (!filePath) {
                res.statusCode = 400;
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify({ success: false, error: "Missing path" }));
                return;
              }
              const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
              await fs.mkdir(path.dirname(resolved), { recursive: true });
              await fs.writeFile(resolved, content || "", "utf-8");
              res.statusCode = 200;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ success: true }));
            } catch (err: any) {
              res.statusCode = 500;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ success: false, error: err?.message || "Write failed" }));
            }
          });
          return;
        }

        if (urlObj.pathname === "/__api/fs/list") {
          const dirPath = urlObj.searchParams.get("path") || process.cwd();
          try {
            const resolved = path.isAbsolute(dirPath) ? dirPath : path.resolve(process.cwd(), dirPath);
            const dirents = await fs.readdir(resolved, { withFileTypes: true });
            const entries = dirents.map((d) => ({
              name: d.name,
              path: path.join(resolved, d.name).replace(/\\/g, "/"),
              is_dir: d.isDirectory(),
            })).sort((a, b) => (a.is_dir === b.is_dir ? a.name.localeCompare(b.name) : a.is_dir ? -1 : 1));
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ success: true, entries }));
          } catch (err: any) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ success: false, error: err?.message || "List failed" }));
          }
          return;
        }

        next();
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), csoticDevFsPlugin()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },

  // Build optimizations for Windows WebView2: fast startup, granular code-splitting & low RAM
  build: {
    target: "esnext",
    minify: "esbuild",
    cssMinify: true,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // Only the always-needed libs get named chunks. Everything else (Monaco, markdown, diff)
        // is left to Rollup so it stays inside the lazy chunk that uses it instead of loading at startup.
        manualChunks(id) {
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return "vendor";
          if (/[\\/]node_modules[\\/]lucide-react[\\/]/.test(id)) return "vendor-icons";
          return undefined;
        },
      },
    },
  },
}));
