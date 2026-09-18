import { plugins } from "../services/ipc";

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  author: string;
  entry: string;
  forge_version: string;
  permissions: string[];
}

class PluginManager {
  private registeredPlugins: Map<string, PluginManifest> = new Map();

  async discoverAndLoad() {
    const res = await plugins.getPlugins();
    if (res.success && res.data && Array.isArray((res.data as any).plugins)) {
      const manifests = (res.data as any).plugins as PluginManifest[];
      for (const m of manifests) {
        this.registeredPlugins.set(m.id, m);
        console.log(`[PluginManager] Discovered plugin: ${m.name} v${m.version}`);
      }
    }
  }

  getPlugins(): PluginManifest[] {
    return Array.from(this.registeredPlugins.values());
  }
}

export const pluginManager = new PluginManager();
