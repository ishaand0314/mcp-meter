import { ToolManifest } from '../types';

/**
 * Bundled dataset used by `mcp-meter --demo`.
 *
 * PROVENANCE (read this before trusting any number that comes out of
 * `--demo`):
 *
 *   - The "filesystem" server below is REAL, LIVE-CAPTURED DATA. It was
 *     obtained by actually spawning the reference
 *     `@modelcontextprotocol/server-filesystem` package over stdio,
 *     performing the real MCP `initialize` handshake, and calling
 *     `tools/list` against the live process - exactly what MCP Meter does
 *     against a user's own configured servers. Captured against
 *     @modelcontextprotocol/server-filesystem@2026.7.10 (reported
 *     serverInfo: secure-filesystem-server@0.2.0), 2026-07-14. Field data
 *     (name/description/inputSchema) below is copied verbatim from that
 *     capture; only the non-token-affecting `outputSchema`/`execution`
 *     fields were dropped for brevity since MCP Meter's token accounting
 *     (see src/analysis/tokenize.ts) only ever measures
 *     name + description + inputSchema.
 *
 *   - Every other server (git-github, postgres, puppeteer-browser,
 *     memory-knowledge-graph, slack) is ILLUSTRATIVE, HAND-AUTHORED EXAMPLE
 *     DATA (`illustrative: true`). These are realistic, typical-shaped tool
 *     manifests modeled after publicly documented MCP servers in each
 *     category, but they were NOT captured from a live running server for
 *     this package. Do not mistake them for verbatim upstream output.
 *
 * Every report generated from `--demo` data surfaces this distinction
 * (see the provenance footer in src/report/*.ts).
 */

export interface DemoServerManifest {
  name: string;
  client: string;
  /** True only for the one server actually captured from a live MCP handshake. */
  liveCaptured: boolean;
  /** True for hand-authored representative example data. */
  illustrative: boolean;
  /** Human-readable note on where this data came from. */
  provenance: string;
  tools: ToolManifest[];
}

export const DEMO_MANIFESTS: DemoServerManifest[] = [
  {
    name: 'filesystem',
    client: 'demo',
    liveCaptured: true,
    illustrative: false,
    provenance:
      'Live-captured via real MCP initialize + tools/list handshake against ' +
      '@modelcontextprotocol/server-filesystem@2026.7.10 on 2026-07-14.',
    tools: [
      {
        name: 'read_file',
        title: 'Read File (Deprecated)',
        description:
          'Read the complete contents of a file as text. DEPRECATED: Use read_text_file instead.',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            tail: { type: 'number', description: 'If provided, returns only the last N lines of the file' },
            head: { type: 'number', description: 'If provided, returns only the first N lines of the file' },
          },
          required: ['path'],
        },
      },
      {
        name: 'read_text_file',
        title: 'Read Text File',
        description:
          "Read the complete contents of a file from the file system as text. Handles various text encodings and provides detailed error messages if the file cannot be read. Use this tool when you need to examine the contents of a single file. Use the 'head' parameter to read only the first N lines of a file, or the 'tail' parameter to read only the last N lines of a file. Operates on the file as text regardless of extension. Only works within allowed directories.",
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            tail: { type: 'number', description: 'If provided, returns only the last N lines of the file' },
            head: { type: 'number', description: 'If provided, returns only the first N lines of the file' },
          },
          required: ['path'],
        },
      },
      {
        name: 'read_media_file',
        title: 'Read Media File',
        description:
          'Read a file and return it as a base64-encoded content block with its MIME type. Image and audio files are returned as image/audio content; any other file type is returned as an embedded resource. Only works within allowed directories.',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
      },
      {
        name: 'read_multiple_files',
        title: 'Read Multiple Files',
        description:
          "Read the contents of multiple files simultaneously. This is more efficient than reading files one by one when you need to analyze or compare multiple files. Each file's content is returned with its path as a reference. Failed reads for individual files won't stop the entire operation. Only works within allowed directories.",
        inputSchema: {
          type: 'object',
          properties: {
            paths: {
              type: 'array',
              items: { type: 'string' },
              minItems: 1,
              description:
                'Array of file paths to read. Each path must be a string pointing to a valid file within allowed directories.',
            },
          },
          required: ['paths'],
        },
      },
      {
        name: 'write_file',
        title: 'Write File',
        description:
          'Create a new file or completely overwrite an existing file with new content. Use with caution as it will overwrite existing files without warning. Handles text content with proper encoding. Only works within allowed directories.',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string' }, content: { type: 'string' } },
          required: ['path', 'content'],
        },
      },
      {
        name: 'edit_file',
        title: 'Edit File',
        description:
          'Make line-based edits to a text file. Each edit replaces exact line sequences with new content. Returns a git-style diff showing the changes made. Only works within allowed directories.',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            edits: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  oldText: { type: 'string', description: 'Text to search for - must match exactly' },
                  newText: { type: 'string', description: 'Text to replace with' },
                },
                required: ['oldText', 'newText'],
              },
            },
            dryRun: { type: 'boolean', default: false, description: 'Preview changes using git-style diff format' },
          },
          required: ['path', 'edits'],
        },
      },
      {
        name: 'create_directory',
        title: 'Create Directory',
        description:
          'Create a new directory or ensure a directory exists. Can create multiple nested directories in one operation. If the directory already exists, this operation will succeed silently. Perfect for setting up directory structures for projects or ensuring required paths exist. Only works within allowed directories.',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
      },
      {
        name: 'list_directory',
        title: 'List Directory',
        description:
          'Get a detailed listing of all files and directories in a specified path. Results clearly distinguish between files and directories with [FILE] and [DIR] prefixes. This tool is essential for understanding directory structure and finding specific files within a directory. Only works within allowed directories.',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
      },
      {
        name: 'list_directory_with_sizes',
        title: 'List Directory with Sizes',
        description:
          'Get a detailed listing of all files and directories in a specified path, including sizes. Results clearly distinguish between files and directories with [FILE] and [DIR] prefixes. This tool is useful for understanding directory structure and finding specific files within a directory. Only works within allowed directories.',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            sortBy: { type: 'string', enum: ['name', 'size'], default: 'name', description: 'Sort entries by name or size' },
          },
          required: ['path'],
        },
      },
      {
        name: 'directory_tree',
        title: 'Directory Tree',
        description:
          "Get a recursive tree view of files and directories as a JSON structure. Each entry includes 'name', 'type' (file/directory), and 'children' for directories. Files have no children array, while directories always have a children array (which may be empty). The output is formatted with 2-space indentation for readability. Only works within allowed directories.",
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            excludePatterns: { type: 'array', items: { type: 'string' }, default: [] },
          },
          required: ['path'],
        },
      },
      {
        name: 'move_file',
        title: 'Move File',
        description:
          'Move or rename files and directories. Can move files between directories and rename them in a single operation. If the destination exists, the operation will fail. Works across different directories and can be used for simple renaming within the same directory. Both source and destination must be within allowed directories.',
        inputSchema: {
          type: 'object',
          properties: { source: { type: 'string' }, destination: { type: 'string' } },
          required: ['source', 'destination'],
        },
      },
      {
        name: 'search_files',
        title: 'Search Files',
        description:
          "Recursively search for files and directories matching a pattern. The patterns should be glob-style patterns that match paths relative to the working directory. Use pattern like '*.ext' to match files in current directory, and '**/*.ext' to match files in all subdirectories. Returns full paths to all matching items. Great for finding files when you don't know their exact location. Only searches within allowed directories.",
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            pattern: { type: 'string' },
            excludePatterns: { type: 'array', items: { type: 'string' }, default: [] },
          },
          required: ['path', 'pattern'],
        },
      },
      {
        name: 'get_file_info',
        title: 'Get File Info',
        description:
          'Retrieve detailed metadata about a file or directory. Returns comprehensive information including size, creation time, last modified time, permissions, and type. This tool is perfect for understanding file characteristics without reading the actual content. Only works within allowed directories.',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
      },
      {
        name: 'list_allowed_directories',
        title: 'List Allowed Directories',
        description:
          'Returns the list of directories that this server is allowed to access. Subdirectories within these allowed directories are also accessible. Use this to understand which directories and their nested paths are available before trying to access files.',
        inputSchema: { type: 'object', properties: {} },
      },
    ],
  },

  // --- Everything below is illustrative/example data, NOT live-captured. ---
  {
    name: 'git-github',
    client: 'demo',
    liveCaptured: false,
    illustrative: true,
    provenance:
      'Illustrative example data modeled after the shape of publicly documented git/GitHub MCP servers. Not captured from a live server.',
    tools: [
      {
        name: 'create_or_update_file',
        illustrative: true,
        description: 'Create or update a single file in a GitHub repository.',
        inputSchema: {
          type: 'object',
          properties: {
            owner: { type: 'string' },
            repo: { type: 'string' },
            path: { type: 'string' },
            content: { type: 'string' },
            message: { type: 'string', description: 'Commit message' },
            branch: { type: 'string' },
            sha: { type: 'string', description: 'Required when updating an existing file' },
          },
          required: ['owner', 'repo', 'path', 'content', 'message', 'branch'],
        },
      },
      {
        name: 'search_repositories',
        illustrative: true,
        description: 'Search for GitHub repositories matching a query string.',
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string' }, page: { type: 'number' }, perPage: { type: 'number' } },
          required: ['query'],
        },
      },
      {
        name: 'create_repository',
        illustrative: true,
        description: 'Create a new GitHub repository in the authenticated account.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            description: { type: 'string' },
            private: { type: 'boolean' },
            autoInit: { type: 'boolean' },
          },
          required: ['name'],
        },
      },
      {
        name: 'get_file_contents',
        illustrative: true,
        description: 'Fetch the contents of a file or directory from a GitHub repository at a given ref.',
        inputSchema: {
          type: 'object',
          properties: {
            owner: { type: 'string' },
            repo: { type: 'string' },
            path: { type: 'string' },
            ref: { type: 'string' },
          },
          required: ['owner', 'repo', 'path'],
        },
      },
      {
        name: 'create_pull_request',
        illustrative: true,
        description:
          'Open a new pull request. You should use this tool whenever a user asks you to open, file, submit, raise, or otherwise create a pull request on GitHub, whether they mention a specific repository by name or simply refer to "the repo" from prior conversation context, and regardless of whether they specify a base branch, in which case you should sensibly default to the repository default branch after first checking with the get_repository tool if one exists, and you should always double check that the head branch you are proposing actually exists remotely before calling this, and you should format the pull request body using GitHub-flavored markdown with clear section headers for Summary and Test Plan whenever the underlying change touches more than one file.',
        inputSchema: {
          type: 'object',
          properties: {
            owner: { type: 'string' },
            repo: { type: 'string' },
            title: { type: 'string' },
            head: { type: 'string' },
            base: { type: 'string' },
            body: { type: 'string' },
            draft: { type: 'boolean' },
          },
          required: ['owner', 'repo', 'title', 'head', 'base'],
        },
      },
      {
        name: 'create_issue',
        illustrative: true,
        description: 'Create a new issue in a GitHub repository.',
        inputSchema: {
          type: 'object',
          properties: {
            owner: { type: 'string' },
            repo: { type: 'string' },
            title: { type: 'string' },
            body: { type: 'string' },
            labels: { type: 'array', items: { type: 'string' } },
            assignees: { type: 'array', items: { type: 'string' } },
          },
          required: ['owner', 'repo', 'title'],
        },
      },
      {
        name: 'list_commits',
        illustrative: true,
        description: 'List commits on a branch in a GitHub repository.',
        inputSchema: {
          type: 'object',
          properties: { owner: { type: 'string' }, repo: { type: 'string' }, sha: { type: 'string' } },
          required: ['owner', 'repo'],
        },
      },
      {
        name: 'fork_repository',
        illustrative: true,
        description: 'Fork a GitHub repository into the authenticated account or a chosen organization.',
        inputSchema: {
          type: 'object',
          properties: { owner: { type: 'string' }, repo: { type: 'string' }, organization: { type: 'string' } },
          required: ['owner', 'repo'],
        },
      },
    ],
  },

  {
    name: 'postgres',
    client: 'demo',
    liveCaptured: false,
    illustrative: true,
    provenance:
      'Illustrative example data modeled after the shape of publicly documented Postgres/database MCP servers. Not captured from a live server.',
    tools: [
      {
        name: 'query',
        illustrative: true,
        description: 'Run a read-only SQL query against the connected Postgres database and return the result rows.',
        inputSchema: {
          type: 'object',
          properties: { sql: { type: 'string' } },
          required: ['sql'],
        },
      },
      {
        name: 'execute_query',
        illustrative: true,
        description:
          'Execute an arbitrary SQL statement against the connected Postgres database, which may include SELECT, INSERT, UPDATE, DELETE, or DDL statements such as CREATE TABLE or ALTER TABLE, and this tool will attempt to run it inside a transaction when it detects a write operation so that partial failures can be rolled back automatically, and it will additionally return the affected row count alongside any returned columns when the underlying driver makes that information available, and callers should be aware that very large result sets may be truncated to a configurable maximum number of rows to avoid overwhelming the context window of the calling model, and that queries taking longer than the configured statement timeout will be aborted server-side and reported back as a timeout error rather than hanging indefinitely.',
        inputSchema: {
          type: 'object',
          properties: {
            sql: { type: 'string' },
            params: { type: 'array', items: {} },
            timeoutMs: { type: 'number' },
          },
          required: ['sql'],
        },
      },
      {
        name: 'list_schemas',
        illustrative: true,
        description: 'List all schemas in the connected database.',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'list_tables',
        illustrative: true,
        description: 'List all tables in a given schema.',
        inputSchema: {
          type: 'object',
          properties: { schema: { type: 'string', default: 'public' } },
        },
      },
      {
        name: 'describe_table',
        illustrative: true,
        description: 'Describe the columns, types, and constraints of a single table.',
        inputSchema: {
          type: 'object',
          properties: { schema: { type: 'string', default: 'public' }, table: { type: 'string' } },
          required: ['table'],
        },
      },
    ],
  },

  {
    name: 'puppeteer-browser',
    client: 'demo',
    liveCaptured: false,
    illustrative: true,
    provenance:
      'Illustrative example data modeled after the shape of publicly documented browser-automation (Puppeteer/Playwright-style) MCP servers. Not captured from a live server.',
    tools: [
      {
        name: 'navigate',
        illustrative: true,
        description: 'Navigate the browser to a given URL.',
        inputSchema: {
          type: 'object',
          properties: { url: { type: 'string' } },
          required: ['url'],
        },
      },
      {
        name: 'screenshot',
        illustrative: true,
        description: 'Take a screenshot of the current page or a specific element.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            selector: { type: 'string' },
            fullPage: { type: 'boolean', default: false },
          },
          required: ['name'],
        },
      },
      {
        name: 'click',
        illustrative: true,
        description: 'Click an element on the page matching a CSS selector.',
        inputSchema: {
          type: 'object',
          properties: { selector: { type: 'string' } },
          required: ['selector'],
        },
      },
      {
        name: 'fill',
        illustrative: true,
        description: 'Fill a form input field with the given value.',
        inputSchema: {
          type: 'object',
          properties: { selector: { type: 'string' }, value: { type: 'string' } },
          required: ['selector', 'value'],
        },
      },
      {
        name: 'evaluate',
        illustrative: true,
        description: 'Evaluate a JavaScript expression in the context of the current page and return the result.',
        inputSchema: {
          type: 'object',
          properties: { script: { type: 'string' } },
          required: ['script'],
        },
      },
    ],
  },

  {
    name: 'memory-knowledge-graph',
    client: 'demo',
    liveCaptured: false,
    illustrative: true,
    provenance:
      'Illustrative example data modeled after the shape of publicly documented persistent-memory/knowledge-graph MCP servers. Not captured from a live server.',
    tools: [
      {
        name: 'create_entities',
        illustrative: true,
        description: 'Create one or more new entities in the knowledge graph.',
        inputSchema: {
          type: 'object',
          properties: {
            entities: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  entityType: { type: 'string' },
                  observations: { type: 'array', items: { type: 'string' } },
                },
                required: ['name', 'entityType'],
              },
            },
          },
          required: ['entities'],
        },
      },
      {
        name: 'create_relations',
        illustrative: true,
        description: 'Create one or more relations between existing entities in the knowledge graph.',
        inputSchema: {
          type: 'object',
          properties: {
            relations: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  from: { type: 'string' },
                  to: { type: 'string' },
                  relationType: { type: 'string' },
                },
                required: ['from', 'to', 'relationType'],
              },
            },
          },
          required: ['relations'],
        },
      },
      {
        name: 'add_observations',
        illustrative: true,
        description: 'Add new observations to an existing entity in the knowledge graph.',
        inputSchema: {
          type: 'object',
          properties: {
            entityName: { type: 'string' },
            observations: { type: 'array', items: { type: 'string' } },
          },
          required: ['entityName', 'observations'],
        },
      },
      {
        name: 'read_graph',
        illustrative: true,
        description: 'Read the entire contents of the knowledge graph.',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'search_nodes',
        illustrative: true,
        description: 'Search the knowledge graph for nodes matching a query string.',
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
      },
    ],
  },

  {
    name: 'slack',
    client: 'demo',
    liveCaptured: false,
    illustrative: true,
    provenance:
      'Illustrative example data modeled after the shape of publicly documented Slack MCP servers. Not captured from a live server.',
    tools: [
      {
        name: 'list_channels',
        illustrative: true,
        description: 'List public channels in the connected Slack workspace.',
        inputSchema: {
          type: 'object',
          properties: { limit: { type: 'number', default: 100 }, cursor: { type: 'string' } },
        },
      },
      {
        name: 'post_message',
        illustrative: true,
        description: 'Post a new message to a Slack channel.',
        inputSchema: {
          type: 'object',
          properties: { channelId: { type: 'string' }, text: { type: 'string' } },
          required: ['channelId', 'text'],
        },
      },
      {
        name: 'reply_to_thread',
        illustrative: true,
        description: 'Reply to an existing message thread in a Slack channel.',
        inputSchema: {
          type: 'object',
          properties: { channelId: { type: 'string' }, threadTs: { type: 'string' }, text: { type: 'string' } },
          required: ['channelId', 'threadTs', 'text'],
        },
      },
      {
        name: 'get_channel_history',
        illustrative: true,
        description: 'Fetch recent messages from a Slack channel.',
        inputSchema: {
          type: 'object',
          properties: { channelId: { type: 'string' }, limit: { type: 'number', default: 20 } },
          required: ['channelId'],
        },
      },
      {
        name: 'get_users',
        illustrative: true,
        description: 'List members of the connected Slack workspace.',
        inputSchema: { type: 'object', properties: { limit: { type: 'number', default: 100 } } },
      },
    ],
  },
];
