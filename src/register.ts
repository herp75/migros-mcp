import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { ZodRawShape } from "zod";
import { updateNotice } from "./update-check.js";
import { redact } from "./security.js";

type TextContent = { type: "text"; text: string };

/**
 * Add the update notice, when there is one, as its own text block after the
 * tool's answer, so the answer itself (often JSON) stays unchanged.
 */
export function withNotice(content: TextContent[], notice: string | null): TextContent[] {
  return notice ? [...content, { type: "text", text: notice }] : content;
}

/**
 * What a tool does, for the client: it uses these hints to decide which calls
 * need the user's approval. Every tool talks to Migros, so all are open-world.
 */
export const READ_ONLY: ToolAnnotations = { readOnlyHint: true, openWorldHint: true };
/** Changes something, but nothing is lost: running it twice gives the same result. */
export const WRITE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};
/** Creates something new each time it runs (a second call makes a second one). */
export const CREATE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};
/** Removes or overwrites something the user had. */
export const DESTRUCTIVE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: true,
};

/**
 * Register an MCP tool with uniform error handling. Saves the boilerplate
 * try/catch wrapper that every tool would otherwise duplicate.
 *
 * The handler returns a plain string (typically formatted JSON); this wraps
 * it in the SDK's content/text envelope and surfaces thrown errors as
 * `isError` responses so the LLM sees a useful message instead of a hang.
 * Error messages go through redact(): they can quote URLs and responses from
 * Migros, which may carry the email, a token or a cookie.
 */
export function register(
  server: McpServer,
  name: string,
  description: string,
  shape: ZodRawShape,
  annotations: ToolAnnotations,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- each tool's args are checked by its zod schema
  handler: (args: any) => Promise<string>
): void {
  server.tool(name, description, shape, annotations, async (args: unknown) => {
    const notice = updateNotice();
    try {
      const text = await handler(args);
      return { content: withNotice([{ type: "text", text }], notice) };
    } catch (error) {
      return {
        content: withNotice([{ type: "text", text: `Error: ${redact((error as Error).message)}` }], notice),
        isError: true,
      };
    }
  });
}
