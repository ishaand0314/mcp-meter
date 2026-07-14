/** Shared type definitions used across MCP Meter's discovery, analysis, and
 * reporting modules. */

/** A single MCP tool definition as returned by `tools/list`. */
export interface ToolManifest {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: unknown;
  [key: string]: unknown;
}

/** A configured MCP server, as parsed out of a client's config file. */
export interface ServerConfig {
  /** The name/key the server is registered under in the config. */
  name: string;
  /** The executable to spawn. */
  command: string;
  /** Arguments passed to the command. */
  args?: string[];
  /** Extra environment variables to merge in when spawning. */
  env?: Record<string, string>;
  /** Which client config file (path) this server was discovered in. */
  source: string;
  /** Which MCP client this config belongs to (Claude Desktop, Cursor, ...). */
  client: string;
}

/** Per-tool token analysis. */
export interface ToolAnalysis {
  name: string;
  description: string;
  tokens: number;
  raw: ToolManifest;
}

/** Per-server analysis result. */
export interface ServerAnalysis {
  name: string;
  client?: string;
  source?: string;
  tools: ToolAnalysis[];
  totalTokens: number;
  /** True if this server was skipped (spawn/handshake failure or timeout). */
  skipped: boolean;
  /** Human-readable reason the server was skipped. */
  skipReason?: string;
  /** True when this data came from a real, live MCP handshake. */
  liveCaptured?: boolean;
  /** True when this data is hand-authored illustrative example data (demo mode). */
  illustrative?: boolean;
}

/** Top-level result of analyzing a full config (or the demo fixture set). */
export interface AnalysisResult {
  servers: ServerAnalysis[];
  totalTokens: number;
  turnsPerDay: number;
}
