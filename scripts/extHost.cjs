/**
 * Csotic Lightweight Extension Host Runtime (extHost.cjs)
 * 
 * Provides a minimal, highly-optimized VS Code API shim to host
 * authentic extensions (like Claude Code) with near-zero idle RAM.
 * Communicates via JSON-RPC over stdio with the Tauri Rust core.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const readline = require('readline');
const Module = require('module');

// ─────────────────────────────────────────────────────────────────────────────
// 1. Core Event Emitter & Primitives
// ─────────────────────────────────────────────────────────────────────────────
class EventEmitter {
  constructor() {
    this._listeners = new Set();
    this.event = (listener) => {
      this._listeners.add(listener);
      return { dispose: () => this._listeners.delete(listener) };
    };
  }
  fire(data) {
    for (const l of this._listeners) {
      try { l(data); } catch (e) { log('warn', `Listener error: ${e.message}`); }
    }
  }
}

class Uri {
  constructor(scheme, authority, pathStr, query = '', fragment = '') {
    this.scheme = scheme;
    this.authority = authority;
    this.path = pathStr;
    this.fsPath = scheme === 'file' 
      ? (process.platform === 'win32' && pathStr.startsWith('/') ? pathStr.slice(1).replace(/\//g, '\\') : pathStr.replace(/\//g, '\\')) 
      : pathStr;
    this.query = query;
    this.fragment = fragment;
  }
  toString() {
    return `${this.scheme}://${this.authority}${this.path}${this.query ? '?' + this.query : ''}`;
  }
  static file(fpath) {
    const norm = fpath.replace(/\\/g, '/');
    const p = norm.startsWith('/') ? norm : '/' + norm;
    return new Uri('file', '', p);
  }
  static parse(val) {
    try {
      const u = new URL(val);
      return new Uri(u.protocol.replace(':', ''), u.host, u.pathname, u.search, u.hash);
    } catch {
      return new Uri('unknown', '', val);
    }
  }
  static joinPath(baseUri, ...pathSegments) {
    const joined = path.posix.join(baseUri.path, ...pathSegments.map(s => s.replace(/\\/g, '/')));
    return new Uri(baseUri.scheme, baseUri.authority, joined);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Global Registries & State
// ─────────────────────────────────────────────────────────────────────────────
let workspaceRoot = process.cwd();
let extensionsDir = path.join(process.env.USERPROFILE || process.env.HOME || '.', '.forge', 'extensions');
let httpPort = 0;
let httpServer = null;

const activatedExtensions = new Map(); // extId -> { exports, context }
const registeredWebviewProviders = new Map(); // viewId -> { provider, options, extensionId }
const activeWebviewViews = new Map(); // viewId -> { webviewView, html, onMessageEmitter }
const commandsMap = new Map();
const stateStore = new Map();

// ─────────────────────────────────────────────────────────────────────────────
// 3. JSON-RPC Communication (over stdio)
// ─────────────────────────────────────────────────────────────────────────────
function sendJsonRpc(method, params, id = null) {
  const msg = { jsonrpc: '2.0', method, params };
  if (id !== null) msg.id = id;
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function sendResponse(id, result, error = null) {
  const msg = { jsonrpc: '2.0', id };
  if (error) msg.error = error;
  else msg.result = result;
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function log(level, message) {
  sendJsonRpc('extHost/log', { level, message });
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Embedded Webview Static Asset Server
// ─────────────────────────────────────────────────────────────────────────────
function startAssetServer() {
  return new Promise((resolve, reject) => {
    httpServer = http.createServer((req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', '*');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        return res.end();
      }

      const urlObj = new URL(req.url, `http://127.0.0.1:${httpPort}`);
      const pathname = decodeURIComponent(urlObj.pathname);

      // Route 1: Render webview page: /view/:viewId
      if (pathname.startsWith('/view/')) {
        const viewId = pathname.replace('/view/', '');
        const active = activeWebviewViews.get(viewId);
        if (!active || !active.html) {
          res.writeHead(404, { 'Content-Type': 'text/html' });
          return res.end('<h3>Extension view loading...</h3>');
        }

        let renderedHtml = active.html;
        const currentTheme = urlObj.searchParams.get('theme') || 'dark';
        const isLight = currentTheme === 'light';
        const themeKind = isLight ? 'vscode-light' : 'vscode-dark';
        const themeName = isLight ? 'Default Light+' : 'Default Dark+';

        // Extract nonce if present in the HTML's CSP
        const nonceMatch = renderedHtml.match(/nonce-([a-zA-Z0-9_\-]+)/);
        const nonceAttr = nonceMatch ? ` nonce="${nonceMatch[1]}"` : '';

        // Standard VS Code Webview Theme Variables & Base Styles
        const themeStyles = `
        <style id="_vscode-theme-vars"${nonceAttr}>
          :root {
            --vscode-font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            --vscode-font-weight: normal;
            --vscode-font-size: 13px;
            --vscode-editor-font-family: 'JetBrains Mono', 'Cascadia Code', Consolas, monospace;
            --vscode-editor-font-size: 12px;
          }
          body.vscode-dark, :root {
            --vscode-foreground: #cccccc;
            --vscode-disabledForeground: rgba(204, 204, 204, 0.5);
            --vscode-errorForeground: #f48771;
            --vscode-descriptionForeground: rgba(204, 204, 204, 0.7);
            --vscode-icon-foreground: #c5c5c5;
            --vscode-focusBorder: #38bdf8;
            --vscode-textLink-foreground: #38bdf8;
            --vscode-textLink-activeForeground: #0284c7;
            --vscode-textSeparator-foreground: rgba(255, 255, 255, 0.12);
            --vscode-textPreformat-foreground: #d7ba7d;
            --vscode-textBlockQuote-background: rgba(127, 127, 127, 0.1);
            --vscode-textBlockQuote-border: #38bdf8;
            --vscode-textCodeBlock-background: #141416;
            --vscode-editor-background: #18181b;
            --vscode-editor-foreground: #cccccc;
            --vscode-sideBar-background: #18181b;
            --vscode-sideBar-foreground: #cccccc;
            --vscode-sideBarSectionHeader-foreground: #cccccc;
            --vscode-sideBarTitle-foreground: #ffffff;
            --vscode-button-background: #d97706;
            --vscode-button-foreground: #ffffff;
            --vscode-button-hoverBackground: #b45309;
            --vscode-button-secondaryBackground: #27272d;
            --vscode-button-secondaryForeground: #cccccc;
            --vscode-button-secondaryHoverBackground: #323238;
            --vscode-input-background: #202024;
            --vscode-input-foreground: #ffffff;
            --vscode-input-border: #2e2e34;
            --vscode-input-placeholderForeground: rgba(204, 204, 204, 0.4);
            --vscode-badge-background: #27272d;
            --vscode-badge-foreground: #ffffff;
            --vscode-dropdown-background: #202024;
            --vscode-dropdown-foreground: #ffffff;
            --vscode-dropdown-border: #2e2e34;
            --vscode-menu-background: #202024;
            --vscode-menu-foreground: #cccccc;
            --vscode-menu-border: #2e2e34;
            --vscode-menu-selectionBackground: #2e2e36;
            --vscode-menu-selectionForeground: #ffffff;
            --vscode-editorWidget-background: #202024;
            --vscode-editorWidget-border: #2e2e34;
            --vscode-quickInput-background: #202024;
            --vscode-quickInput-foreground: #ffffff;
            --vscode-checkbox-background: #202024;
            --vscode-checkbox-foreground: #ffffff;
            --vscode-checkbox-border: #2e2e34;
            --vscode-widget-border: #2e2e34;
            --vscode-list-hoverBackground: #27272d;
            --vscode-list-activeSelectionBackground: rgba(56, 189, 248, 0.15);
            --vscode-list-activeSelectionForeground: #ffffff;
          }
          body.vscode-light {
            --vscode-foreground: #0f172a;
            --vscode-disabledForeground: rgba(15, 23, 42, 0.5);
            --vscode-errorForeground: #dc2626;
            --vscode-descriptionForeground: #64748b;
            --vscode-icon-foreground: #475569;
            --vscode-focusBorder: #2563eb;
            --vscode-textLink-foreground: #2563eb;
            --vscode-textLink-activeForeground: #1d4ed8;
            --vscode-textSeparator-foreground: rgba(0, 0, 0, 0.12);
            --vscode-textPreformat-foreground: #b45309;
            --vscode-textBlockQuote-background: rgba(0, 0, 0, 0.04);
            --vscode-textBlockQuote-border: #2563eb;
            --vscode-textCodeBlock-background: #f1f5f9;
            --vscode-editor-background: #ffffff;
            --vscode-editor-foreground: #0f172a;
            --vscode-sideBar-background: #ffffff;
            --vscode-sideBar-foreground: #0f172a;
            --vscode-sideBarSectionHeader-foreground: #0f172a;
            --vscode-sideBarTitle-foreground: #0f172a;
            --vscode-button-background: #d97706;
            --vscode-button-foreground: #ffffff;
            --vscode-button-hoverBackground: #b45309;
            --vscode-button-secondaryBackground: #f1f5f9;
            --vscode-button-secondaryForeground: #0f172a;
            --vscode-button-secondaryHoverBackground: #e2e8f0;
            --vscode-input-background: #f8fafc;
            --vscode-input-foreground: #0f172a;
            --vscode-input-border: #cbd5e1;
            --vscode-input-placeholderForeground: rgba(100, 116, 139, 0.6);
            --vscode-badge-background: #e2e8f0;
            --vscode-badge-foreground: #0f172a;
            --vscode-dropdown-background: #ffffff;
            --vscode-dropdown-foreground: #0f172a;
            --vscode-dropdown-border: #cbd5e1;
            --vscode-menu-background: #ffffff;
            --vscode-menu-foreground: #0f172a;
            --vscode-menu-border: #e2e8f0;
            --vscode-menu-selectionBackground: #f1f5f9;
            --vscode-menu-selectionForeground: #0f172a;
            --vscode-editorWidget-background: #ffffff;
            --vscode-editorWidget-border: #e2e8f0;
            --vscode-quickInput-background: #ffffff;
            --vscode-quickInput-foreground: #0f172a;
            --vscode-checkbox-background: #ffffff;
            --vscode-checkbox-foreground: #0f172a;
            --vscode-checkbox-border: #94a3b8;
            --vscode-widget-border: #e2e8f0;
            --vscode-list-hoverBackground: rgba(0, 0, 0, 0.04);
            --vscode-list-activeSelectionBackground: #e0e7ff;
            --vscode-list-activeSelectionForeground: #0f172a;
          }
          body {
            color: var(--vscode-foreground) !important;
            background-color: var(--vscode-sideBar-background) !important;
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
          }
          /* All popups, model selectors, menus, and dropdowns must be 100% solid and opaque */
          [class*="menuPopup"], [class*="commandList"], [class*="dialogContainer"],
          [role="menu"], [role="listbox"], [role="dialog"], [role="combobox"],
          div[class*="popover"], div[class*="dropdown"], div[class*="picker"], div[class*="modal"] {
            background: var(--vscode-menu-background, #202024) !important;
            background-color: var(--vscode-menu-background, #202024) !important;
            opacity: 1 !important;
            backdrop-filter: none !important;
            -webkit-backdrop-filter: none !important;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5) !important;
            border: 1px solid var(--vscode-menu-border, #2e2e34) !important;
          }
          body.vscode-light [class*="menuPopup"], 
          body.vscode-light [class*="commandList"], 
          body.vscode-light [class*="dialogContainer"],
          body.vscode-light [role="menu"], 
          body.vscode-light [role="listbox"], 
          body.vscode-light [role="dialog"] {
            background: #ffffff !important;
            background-color: #ffffff !important;
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12) !important;
            border: 1px solid #e2e8f0 !important;
          }
        </style>
        `;

        // Inject host bridge script before </head> or </body>
        const bridgeScript = `
        <script${nonceAttr}>
          (function() {
            var state = {};
            var vscodeApi = {
              postMessage: function(msg) {
                window.parent.postMessage({ type: 'vscode-webview-post', viewId: ${JSON.stringify(viewId)}, message: msg }, '*');
              },
              setState: function(newState) { state = newState; },
              getState: function() { return state; }
            };
            window.acquireVsCodeApi = function() { return vscodeApi; };
            window.addEventListener('message', function(ev) {
              if (ev.data && ev.data.type === 'vscode-host-theme-change') {
                var newTheme = ev.data.theme || 'dark';
                var isLightNow = newTheme === 'light';
                var newKind = isLightNow ? 'vscode-light' : 'vscode-dark';
                var newName = isLightNow ? 'Default Light+' : 'Default Dark+';
                document.body.classList.remove('vscode-dark', 'vscode-light');
                document.body.classList.add(newKind);
                document.body.setAttribute('data-vscode-theme-kind', newKind);
                document.body.setAttribute('data-vscode-theme-name', newName);
              }
              if (ev.data && ev.data.type === 'vscode-host-post') {
                ev.stopImmediatePropagation();
                window.dispatchEvent(new MessageEvent('message', { data: ev.data.message }));
              }
            });
          })();
        </script>
        `;

        // Inject body classes
        if (renderedHtml.includes('<body')) {
          renderedHtml = renderedHtml.replace(/<body([^>]*)>/i, (match, attrs) => {
            if (attrs.includes('class="')) {
              return `<body${attrs.replace('class="', `class="${themeKind} `)} data-vscode-theme-kind="${themeKind}" data-vscode-theme-name="${themeName}">`;
            } else {
              return `<body class="${themeKind}" data-vscode-theme-kind="${themeKind}" data-vscode-theme-name="${themeName}"${attrs}>`;
            }
          });
        }

        const combinedInject = `${themeStyles}${bridgeScript}`;
        if (renderedHtml.includes('</head>')) {
          renderedHtml = renderedHtml.replace('</head>', `${combinedInject}</head>`);
        } else {
          renderedHtml = `${combinedInject}${renderedHtml}`;
        }

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(renderedHtml);
      }

      // Route 2: Serve static extension assets: /ext/:extId/:relPath
      if (pathname.startsWith('/ext/')) {
        const parts = pathname.slice(5).split('/');
        const extId = parts[0];
        const relPath = parts.slice(1).join('/');
        const filePath = path.join(extensionsDir, extId, relPath);

        // Security check: must stay within extensionsDir
        if (!filePath.startsWith(extensionsDir)) {
          res.writeHead(403);
          return res.end('Access denied');
        }

        fs.readFile(filePath, (err, data) => {
          if (err) {
            res.writeHead(404);
            return res.end('Asset not found');
          }

          const ext = path.extname(filePath).toLowerCase();
          const mimeTypes = {
            '.js': 'application/javascript',
            '.css': 'text/css',
            '.json': 'application/json',
            '.svg': 'image/svg+xml',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.woff2': 'font/woff2',
            '.woff': 'font/woff',
            '.ttf': 'font/ttf',
          };
          res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
          res.end(data);
        });
        return;
      }

      res.writeHead(404);
      res.end('Not found');
    });

    httpServer.listen(0, '127.0.0.1', () => {
      httpPort = httpServer.address().port;
      log('info', `Extension Webview Server listening on port ${httpPort}`);
      resolve(httpPort);
    });

    httpServer.on('error', reject);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. VS Code API Shim Definition
// ─────────────────────────────────────────────────────────────────────────────
function buildVsCodeShim() {
  class RelativePattern {
    constructor(base, pattern) {
      this.base = typeof base === 'string' ? base : (base?.fsPath || base?.uri?.fsPath || String(base));
      this.pattern = pattern;
      this.baseUri = typeof base === 'object' && base?.scheme ? base : Uri.file(this.base);
    }
  }

  return {
    version: '1.93.0',
    Uri,
    EventEmitter,
    RelativePattern,
    Disposable: class {
      constructor(callOnDispose) { this._dispose = callOnDispose; }
      dispose() { if (this._dispose) this._dispose(); }
      static from(...disposables) {
        return new vscode.Disposable(() => {
          disposables.forEach(d => d && typeof d.dispose === 'function' && d.dispose());
        });
      }
    },
    window: {
      createOutputChannel: (name, options) => ({
        name,
        append: () => {},
        appendLine: (msg) => log('info', `[OutputChannel ${name}] ${msg}`),
        replace: () => {},
        clear: () => {},
        show: () => {},
        hide: () => {},
        dispose: () => {},
        info: (msg, ...args) => log('info', `[OutputChannel ${name}] ${msg}`),
        warn: (msg, ...args) => log('warn', `[OutputChannel ${name}] ${msg}`),
        error: (msg, ...args) => log('error', `[OutputChannel ${name}] ${msg}`),
        debug: (msg, ...args) => log('debug', `[OutputChannel ${name}] ${msg}`),
        trace: () => {},
        logLevel: 1,
        onDidChangeLogLevel: new EventEmitter().event,
      }),
      registerWebviewViewProvider: (viewId, provider, options) => {
        log('info', `Registered WebviewViewProvider for: ${viewId}`);
        registeredWebviewProviders.set(viewId, { provider, options });
        sendJsonRpc('extHost/viewRegistered', { viewId });
        return { dispose: () => registeredWebviewProviders.delete(viewId) };
      },
      registerWebviewPanelSerializer: () => ({ dispose: () => {} }),
      registerUriHandler: (handler) => ({ dispose: () => {} }),
      createWebviewPanel: (viewType, title, showOptions, options) => {
        const onMsg = new EventEmitter();
        return {
          webview: {
            options: options || {},
            cspSource: `http://127.0.0.1:${httpPort}`,
            asWebviewUri: (uri) => {
              const rel = path.relative(extensionsDir, uri.fsPath).replace(/\\/g, '/');
              return `http://127.0.0.1:${httpPort}/ext/${rel}`;
            },
            html: '',
            onDidReceiveMessage: onMsg.event,
            postMessage: async () => true,
          },
          reveal: () => {},
          dispose: () => {},
          onDidDispose: new EventEmitter().event,
          onDidChangeViewState: new EventEmitter().event,
          visible: true,
          active: true,
        };
      },
      showInformationMessage: async (msg) => { log('info', `[Notification] ${msg}`); return undefined; },
      showWarningMessage: async (msg) => { log('warn', `[Notification] ${msg}`); return undefined; },
      showErrorMessage: async (msg) => { log('error', `[Notification] ${msg}`); return undefined; },
      visibleTextEditors: [],
      activeTextEditor: undefined,
      activeColorTheme: { kind: 2 }, // Dark
      onDidChangeActiveTextEditor: new EventEmitter().event,
      onDidChangeVisibleTextEditors: new EventEmitter().event,
      onDidChangeTextEditorSelection: new EventEmitter().event,
      onDidChangeTextEditorVisibleRanges: new EventEmitter().event,
      onDidChangeActiveColorTheme: new EventEmitter().event,
      createTextEditorDecorationType: () => ({ dispose: () => {} }),
      createStatusBarItem: () => ({
        text: '',
        tooltip: '',
        command: '',
        show: () => {},
        hide: () => {},
        dispose: () => {},
      }),
      withProgress: async (options, task) => {
        return await task({ report: () => {} }, { isCancellationRequested: false, onCancellationRequested: new EventEmitter().event });
      },
      createTerminal: (options) => ({
        name: typeof options === 'string' ? options : options?.name || 'Terminal',
        sendText: (text) => log('info', `Terminal sendText: ${text}`),
        show: () => {},
        hide: () => {},
        dispose: () => {},
      }),
      tabGroups: {
        all: [],
        activeTabGroup: undefined,
        onDidChangeTabs: new EventEmitter().event,
        onDidChangeTabGroups: new EventEmitter().event,
      },
      onDidCloseTerminal: new EventEmitter().event,
      onDidOpenTerminal: new EventEmitter().event,
    },
    workspace: {
      get workspaceFolders() {
        return [
          {
            uri: Uri.file(workspaceRoot),
            name: path.basename(workspaceRoot) || 'Workspace',
            index: 0,
          }
        ];
      },
      getConfiguration: (section) => ({
        get: (key, defaultValue) => {
          if (section === 'chat' && key === 'fontSize') return 13;
          if (section === 'chat.editor' && key === 'fontSize') return 12;
          return defaultValue;
        },
        has: () => true,
        inspect: () => undefined,
        update: async () => {},
      }),
      textDocuments: [],
      onDidChangeConfiguration: new EventEmitter().event,
      onDidCloseTextDocument: new EventEmitter().event,
      onDidOpenTextDocument: new EventEmitter().event,
      onDidChangeTextDocument: new EventEmitter().event,
      onDidSaveTextDocument: new EventEmitter().event,
      onDidChangeWorkspaceFolders: new EventEmitter().event,
      asRelativePath: (p) => {
        const full = typeof p === 'string' ? p : (p?.fsPath || p?.path || String(p));
        const rel = path.relative(workspaceRoot, full).replace(/\\/g, '/');
        return rel.startsWith('..') ? full : rel;
      },
      findFiles: async (includePattern, excludePattern, maxResults = 200) => {
        const results = [];
        const skipDirs = new Set(['.git', 'node_modules', 'target', 'dist', '.next', 'build', '.turbo']);
        async function walk(dir) {
          if (results.length >= maxResults) return;
          try {
            const entries = await fs.promises.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
              if (results.length >= maxResults) break;
              if (entry.isDirectory()) {
                if (!skipDirs.has(entry.name)) {
                  await walk(path.join(dir, entry.name));
                }
              } else if (entry.isFile()) {
                results.push(Uri.file(path.join(dir, entry.name)));
              }
            }
          } catch {}
        }
        await walk(workspaceRoot);
        return results;
      },
      createFileSystemWatcher: () => ({
        onDidChange: new EventEmitter().event,
        onDidCreate: new EventEmitter().event,
        onDidDelete: new EventEmitter().event,
        dispose: () => {},
      }),
      registerFileSystemProvider: () => ({ dispose: () => {} }),
      registerTextDocumentContentProvider: () => ({ dispose: () => {} }),
      openTextDocument: async (uriOrPath) => {
        let targetPath = typeof uriOrPath === 'string' ? uriOrPath : (uriOrPath?.fsPath || uriOrPath?.path || String(uriOrPath));
        if (!path.isAbsolute(targetPath)) {
          targetPath = path.resolve(workspaceRoot, targetPath);
        }
        let content = '';
        try {
          content = await fs.promises.readFile(targetPath, 'utf8');
        } catch (e) {
          // Virtual or unreadable file
        }
        const lines = content.split(/\r?\n/);
        return {
          uri: Uri.file(targetPath),
          fileName: targetPath,
          isUntitled: false,
          languageId: path.extname(targetPath).slice(1) || 'plaintext',
          version: 1,
          isDirty: false,
          lineCount: lines.length,
          getText: (range) => content,
          lineAt: (line) => ({ text: lines[line] !== undefined ? lines[line] : '', lineNumber: line }),
        };
      },
      fs: {
        readFile: async (uri) => fs.promises.readFile(uri.fsPath),
        writeFile: async (uri, content) => fs.promises.writeFile(uri.fsPath, content),
        stat: async (uri) => fs.promises.stat(uri.fsPath),
        readDirectory: async (uri) => {
          const entries = await fs.promises.readdir(uri.fsPath, { withFileTypes: true });
          return entries.map(e => [e.name, e.isDirectory() ? 2 : (e.isFile() ? 1 : 0)]);
        },
        createDirectory: async (uri) => {
          await fs.promises.mkdir(uri.fsPath, { recursive: true });
        },
        delete: async (uri, options) => {
          await fs.promises.rm(uri.fsPath, { recursive: Boolean(options?.recursive), force: true });
        }
      }
    },
    commands: {
      registerCommand: (id, handler) => {
        commandsMap.set(id, handler);
        return { dispose: () => commandsMap.delete(id) };
      },
      executeCommand: async (id, ...args) => {
        const fn = commandsMap.get(id);
        if (fn) return await fn(...args);
        return undefined;
      }
    },
    env: {
      appName: 'Csotic',
      appRoot: workspaceRoot,
      uriScheme: 'csotic',
      clipboard: {
        writeText: async () => {},
        readText: async () => '',
      },
      openExternal: async (uri) => {
        sendJsonRpc('extHost/openExternal', { uri: uri.toString() });
        return true;
      },
    },
    extensions: {
      getExtension: (id) => {
        const extDir = path.join(extensionsDir, id);
        try {
          const pkg = JSON.parse(fs.readFileSync(path.join(extDir, 'package.json'), 'utf8'));
          return {
            id,
            extensionUri: Uri.file(extDir),
            extensionPath: extDir,
            isActive: activatedExtensions.has(id),
            packageJSON: pkg,
            exports: activatedExtensions.get(id)?.exports,
          };
        } catch {
          return undefined;
        }
      },
      all: [],
    },
    authentication: {
      registerAuthenticationProvider: () => ({ dispose: () => {} }),
      getSession: async () => undefined,
      onDidChangeSessions: new EventEmitter().event,
    },
    NotebookCellOutputItem: {
      error: (err) => ({ mime: 'application/vnd.code.notebook.error', data: err }),
      text: (value, mime) => ({ mime: mime || 'text/plain', data: value }),
      json: (value, mime) => ({ mime: mime || 'application/json', data: value }),
    },
    TabInputText: class { constructor(uri) { this.uri = uri; } },
    TabInputTextDiff: class { constructor(original, modified) { this.original = original; this.modified = modified; } },
    ViewColumn: { One: 1, Two: 2, Three: 3, Active: -1, Beside: -2 },
    StatusBarAlignment: { Left: 1, Right: 2 },
    ProgressLocation: { SourceControl: 1, Window: 10, Notification: 15 },
    ThemeColor: class { constructor(id) { this.id = id; } },
    ThemeIcon: class { constructor(id) { this.id = id; } },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Hook into require() for 'vscode'
// ─────────────────────────────────────────────────────────────────────────────
const vscodeShim = buildVsCodeShim();
const origRequire = Module.prototype.require;
Module.prototype.require = function(request) {
  if (request === 'vscode') {
    return vscodeShim;
  }
  return origRequire.apply(this, arguments);
};

// ─────────────────────────────────────────────────────────────────────────────
// 7. Extension Lifecycle Management
// ─────────────────────────────────────────────────────────────────────────────
async function activateExtension(extId) {
  if (activatedExtensions.has(extId)) {
    return { success: true, alreadyActive: true };
  }

  let extDir = path.join(extensionsDir, extId);
  if (!fs.existsSync(path.join(extDir, 'package.json'))) {
    try {
      const entries = fs.readdirSync(extensionsDir);
      const match = entries.find(e => e.toLowerCase() === extId.toLowerCase() || e.toLowerCase().startsWith(extId.toLowerCase()));
      if (match) {
        extDir = path.join(extensionsDir, match);
      }
    } catch {}
  }

  const pkgPath = path.join(extDir, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    throw new Error(`Extension manifest not found: ${pkgPath}`);
  }

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const entryFile = pkg.main || './extension.js';
  const resolvedEntry = path.join(extDir, entryFile);

  if (!fs.existsSync(resolvedEntry)) {
    throw new Error(`Extension entry point not found: ${resolvedEntry}`);
  }

  log('info', `Loading extension ${extId} from ${resolvedEntry}...`);
  const extModule = require(resolvedEntry);

  const storageBase = path.join(process.env.USERPROFILE || process.env.HOME || '.', '.forge', 'storage');
  const globalStorageDir = path.join(storageBase, 'global', extId);
  const workspaceStorageDir = path.join(storageBase, 'workspace', extId);
  const logDir = path.join(storageBase, 'logs', extId);
  try {
    fs.mkdirSync(globalStorageDir, { recursive: true });
    fs.mkdirSync(workspaceStorageDir, { recursive: true });
    fs.mkdirSync(logDir, { recursive: true });
  } catch {}

  const globalStorageUri = Uri.file(globalStorageDir);
  const storageUri = Uri.file(workspaceStorageDir);
  const logUri = Uri.file(logDir);

  const context = {
    subscriptions: [],
    extensionUri: Uri.file(extDir),
    extensionPath: extDir,
    extensionMode: 1, // Production
    globalStorageUri,
    globalStoragePath: globalStorageDir,
    storageUri,
    storagePath: workspaceStorageDir,
    logUri,
    logPath: logDir,
    extension: {
      id: extId,
      extensionUri: Uri.file(extDir),
      extensionPath: extDir,
      packageJSON: pkg,
      isActive: true,
    },
    globalState: {
      get: (k, d) => stateStore.has(`g:${extId}:${k}`) ? stateStore.get(`g:${extId}:${k}`) : d,
      update: async (k, v) => stateStore.set(`g:${extId}:${k}`, v),
      keys: () => Array.from(stateStore.keys()).filter(k => k.startsWith(`g:${extId}:`)).map(k => k.slice(extId.length + 3)),
      setKeysForSync: () => {},
    },
    workspaceState: {
      get: (k, d) => stateStore.has(`w:${extId}:${k}`) ? stateStore.get(`w:${extId}:${k}`) : d,
      update: async (k, v) => stateStore.set(`w:${extId}:${k}`, v),
      keys: () => Array.from(stateStore.keys()).filter(k => k.startsWith(`w:${extId}:`)).map(k => k.slice(extId.length + 3)),
    },
    secrets: {
      get: async (k) => stateStore.get(`s:${extId}:${k}`),
      store: async (k, v) => stateStore.set(`s:${extId}:${k}`, v),
      delete: async (k) => stateStore.delete(`s:${extId}:${k}`),
      onDidChange: new EventEmitter().event,
    },
    environmentVariableCollection: {
      get: (k) => stateStore.has(`e:${extId}:${k}`) ? { value: stateStore.get(`e:${extId}:${k}`) } : undefined,
      replace: (k, v) => stateStore.set(`e:${extId}:${k}`, v),
      append: (k, v) => stateStore.set(`e:${extId}:${k}`, (stateStore.get(`e:${extId}:${k}`) || '') + v),
      prepend: (k, v) => stateStore.set(`e:${extId}:${k}`, v + (stateStore.get(`e:${extId}:${k}`) || '')),
      delete: (k) => stateStore.delete(`e:${extId}:${k}`),
      clear: () => {},
    },
    asAbsolutePath: (rel) => path.join(extDir, rel),
  };

  if (typeof extModule.activate === 'function') {
    await extModule.activate(context);
    log('info', `Extension ${extId} activated successfully! Subscriptions: ${context.subscriptions.length}`);
  }

  activatedExtensions.set(extId, { exports: extModule, context });
  return { success: true, registeredViews: Array.from(registeredWebviewProviders.keys()) };
}

async function resolveWebviewView(viewId) {
  const def = registeredWebviewProviders.get(viewId);
  if (!def) {
    throw new Error(`No provider registered for viewId: ${viewId}`);
  }

  const onMessageEmitter = new EventEmitter();
  const onDidDispose = new EventEmitter();
  const onDidChangeVisibility = new EventEmitter();

  let currentHtml = '';
  const webviewView = {
    viewType: viewId,
    visible: true,
    show: () => {},
    onDidDispose: onDidDispose.event,
    onDidChangeVisibility: onDidChangeVisibility.event,
    webview: {
      options: def.options?.webviewOptions || {},
      cspSource: `http://127.0.0.1:${httpPort}`,
      asWebviewUri: (uri) => {
        const rel = path.relative(extensionsDir, uri.fsPath).replace(/\\/g, '/');
        return `http://127.0.0.1:${httpPort}/ext/${rel}`;
      },
      get html() { return currentHtml; },
      set html(val) {
        currentHtml = val;
        if (activeWebviewViews.has(viewId)) {
          activeWebviewViews.get(viewId).html = val;
        }
        sendJsonRpc('webview/onSetHtml', { viewId, url: `http://127.0.0.1:${httpPort}/view/${encodeURIComponent(viewId)}` });
      },
      onDidReceiveMessage: onMessageEmitter.event,
      postMessage: async (msg) => {
        sendJsonRpc('webview/onPostMessage', { viewId, message: msg });
        return true;
      }
    }
  };

  activeWebviewViews.set(viewId, { webviewView, html: currentHtml, onMessageEmitter });
  await def.provider.resolveWebviewView(webviewView, {}, {});

  return {
    viewId,
    url: `http://127.0.0.1:${httpPort}/view/${encodeURIComponent(viewId)}`,
    hasHtml: Boolean(currentHtml),
  };
}

function postMessageToExtension(viewId, message) {
  const active = activeWebviewViews.get(viewId);
  if (active && active.onMessageEmitter) {
    active.onMessageEmitter.fire(message);
    return { success: true };
  }
  return { success: false, error: `View ${viewId} not active` };
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. Stdio Dispatch Loop
// ─────────────────────────────────────────────────────────────────────────────
async function handleRpcMessage(msg) {
  const { id, method, params } = msg;
  try {
    switch (method) {
      case 'extHost/init': {
        if (params.workspaceRoot) workspaceRoot = params.workspaceRoot;
        if (params.extensionsDir) extensionsDir = params.extensionsDir;
        if (!httpServer) await startAssetServer();
        sendResponse(id, { success: true, port: httpPort });
        break;
      }
      case 'extHost/activate': {
        const res = await activateExtension(params.extensionId);
        sendResponse(id, res);
        break;
      }
      case 'extHost/resolveWebview': {
        const res = await resolveWebviewView(params.viewId);
        sendResponse(id, res);
        break;
      }
      case 'webview/postMessage': {
        const res = postMessageToExtension(params.viewId, params.message);
        sendResponse(id, res);
        break;
      }
      default:
        sendResponse(id, null, { code: -32601, message: `Method not found: ${method}` });
        break;
    }
  } catch (err) {
    log('error', `RPC Error in ${method}: ${err?.stack || err?.message || String(err)}`);
    sendResponse(id, null, { code: -32000, message: err?.message || String(err) });
  }
}

function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  });

  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const msg = JSON.parse(trimmed);
      void handleRpcMessage(msg);
    } catch (err) {
      log('error', `Failed to parse RPC: ${err.message}`);
    }
  });

  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));
}

main();
