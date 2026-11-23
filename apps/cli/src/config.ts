/**
 * `edgway.config.ts`, loaded with c12: the admin URL and the three Workers'
 * wrangler configs, resolved against the project directory.
 */
import path from "node:path";
import { CLI } from "@edgway/constants";
import { loadConfig } from "c12";

export interface EdgwayConfig {
  /** The admin Worker's URL, e.g. `https://edgway-admin.example.workers.dev`. */
  adminUrl?: string;
  admin?: { config?: string };
  gateway?: { config?: string };
  portal?: { config?: string };
}

export interface ResolvedConfig {
  cwd: string;
  adminUrl?: string;
  adminConfig: string;
  gatewayConfig: string;
  portalConfig: string;
}

export const DEFAULT_CONFIG: Required<EdgwayConfig> = {
  adminUrl: "",
  admin: { config: CLI.adminConfig },
  gateway: { config: CLI.gatewayConfig },
  portal: { config: CLI.portalConfig },
};

export async function readConfig(cwd = process.cwd()): Promise<ResolvedConfig> {
  const { config } = await loadConfig<EdgwayConfig>({
    name: CLI.configName,
    cwd,
    defaults: DEFAULT_CONFIG,
    dotenv: false,
    rcFile: false,
    globalRc: false,
    packageJson: false,
  });
  return {
    cwd,
    adminUrl: config.adminUrl || undefined,
    adminConfig: path.resolve(cwd, config.admin?.config ?? CLI.adminConfig),
    gatewayConfig: path.resolve(
      cwd,
      config.gateway?.config ?? CLI.gatewayConfig,
    ),
    portalConfig: path.resolve(cwd, config.portal?.config ?? CLI.portalConfig),
  };
}
