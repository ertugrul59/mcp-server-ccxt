#!/usr/bin/env node
/**
 * CCXT MCP Server - Official SDK Implementation
 * High-performance cryptocurrency exchange interface with optimized caching and rate limiting
 *
 * Using official @modelcontextprotocol/sdk patterns
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import { randomUUID } from "node:crypto";

// Import all the tool modules
import { registerAllTools } from "./tools/index.js";

/**
 * Server configuration interface
 */
interface ServerConfig {
  name: string;
  version: string;
  transport: "stdio" | "streamable-http";
  host?: string;
  port?: number;
}

/**
 * Parse command line arguments
 */
function parseArgs(): ServerConfig {
  const args = process.argv.slice(2);
  const config: ServerConfig = {
    name: "ccxt-mcp-server",
    version: "1.2.2",
    transport: "stdio",
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--transport":
        const transport = args[++i];
        if (transport === "streamable-http" || transport === "stdio") {
          config.transport = transport;
        }
        break;
      case "--port":
        config.port = parseInt(args[++i]);
        break;
      case "--host":
        config.host = args[++i];
        break;
      case "--help":
        console.error(`
CCXT MCP Server

Usage: node index.js [options]

Options:
  --transport <type>    Transport type: stdio | streamable-http (default: stdio)
  --port <number>       Port for HTTP transport (default: 8004)
  --host <string>       Host for HTTP transport (default: localhost)
  --help               Show this help message
`);
        process.exit(0);
    }
  }

  // Set defaults for HTTP transport
  if (config.transport === "streamable-http") {
    config.port = config.port || 8004;
    config.host = config.host || "localhost";
  }

  return config;
}

/**
 * Create and configure the MCP server
 */
function createMcpServer(): McpServer {
  console.error(`🚀 Creating CCXT MCP Server...`);

  const server = new McpServer({
    name: "ccxt-mcp-server",
    version: "1.2.2",
    description: "High-performance CCXT exchange interface with caching and rate limiting",
  });

  console.error(`⚙️ Registering tools...`);

  // Register all tools from the tools module
  registerAllTools(server);

  console.error(`✅ All tools registered successfully`);

  return server;
}

/**
 * Start server with stdio transport
 */
async function startStdioServer(): Promise<void> {
  console.error(`📡 Starting stdio transport...`);

  const server = createMcpServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);
  console.error(`✅ CCXT MCP Server running on stdio`);
}

/**
 * Start server with StreamableHTTP transport (Official SDK Pattern)
 */
async function startHttpServer(config: ServerConfig): Promise<void> {
  console.error(`🔥 Starting StreamableHTTP transport...`);
  console.error(`🌐 Server will listen on ${config.host}:${config.port}`);

  const app = express();
  app.use(express.json());

  // Add CORS headers for MCP compatibility
  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Accept, Authorization, Mcp-Session-Id, Mcp-Protocol-Version");
    res.header("Access-Control-Expose-Headers", "Mcp-Session-Id");

    if (req.method === "OPTIONS") {
      res.sendStatus(200);
      return;
    }
    next();
  });

  // Map to store transports by session ID (Official Pattern)
  const transports: { [sessionId: string]: StreamableHTTPServerTransport } = {};

  // Health check endpoint
  app.get("/", (req, res) => {
    res.json({
      name: "CCXT MCP Server",
      version: "1.2.2",
      status: "running",
      endpoint: "/mcp/",
      timestamp: new Date().toISOString(),
    });
  });

  // Handle POST requests for client-to-server communication (Official Pattern)
  app.post("/mcp", async (req, res) => {
    try {
      // Check for existing session ID
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      let transport: StreamableHTTPServerTransport;

      if (sessionId && transports[sessionId]) {
        // Reuse existing transport
        transport = transports[sessionId];
        console.error(`🔄 Using existing session: ${sessionId}`);
      } else if (!sessionId && isInitializeRequest(req.body)) {
        // New initialization request - create new transport
        console.error(`🆕 Creating new session for initialization request`);

        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => {
            const newSessionId = randomUUID();
            console.error(`🎫 Generated session ID: ${newSessionId}`);
            return newSessionId;
          },
          // Store transport when session is initialized
          onsessioninitialized: (sessionId) => {
            console.error(`💾 Session initialized and stored: ${sessionId}`);
            transports[sessionId] = transport;
          },
        });

        // Clean up transport when closed
        transport.onclose = () => {
          if (transport.sessionId) {
            console.error(`🧹 Cleaning up session: ${transport.sessionId}`);
            delete transports[transport.sessionId];
          }
        };

        // Create and connect MCP server to transport
        const server = createMcpServer();
        await server.connect(transport);
        console.error(`🔗 MCP server connected to new transport`);
      } else {
        // Invalid request
        console.error(`❌ Invalid request: no session ID and not an initialize request`);
        res.status(400).json({
          jsonrpc: "2.0",
          error: {
            code: -32600,
            message: "Invalid Request: Missing session ID or not an initialize request",
          },
          id: null,
        });
        return;
      }

      // Handle the request using the transport
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error(`💥 Error handling MCP request:`, error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Internal server error",
          },
          id: null,
        });
      }
    }
  });

  // Handle GET requests for server-to-client notifications via SSE (Official Pattern)
  app.get("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !transports[sessionId]) {
      console.error(`❌ GET request with invalid session ID: ${sessionId}`);
      res.status(400).send("Invalid or missing session ID");
      return;
    }

    console.error(`📡 Handling GET request for session: ${sessionId}`);
    const transport = transports[sessionId];
    await transport.handleRequest(req, res);
  });

  // Handle DELETE requests for session termination (Official Pattern)
  app.delete("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !transports[sessionId]) {
      console.error(`❌ DELETE request with invalid session ID: ${sessionId}`);
      res.status(400).send("Invalid or missing session ID");
      return;
    }

    console.error(`🗑️ Handling DELETE request for session: ${sessionId}`);
    const transport = transports[sessionId];
    await transport.handleRequest(req, res);
  });

  // Error handling middleware
  app.use((error: any, req: any, res: any, next: any) => {
    console.error(`💥 Express error:`, error);
    if (!res.headersSent) {
      res.status(500).json({
        error: "Internal Server Error",
        message: error.message,
        timestamp: new Date().toISOString(),
      });
    }
  });

  // Start the HTTP server
  const httpServer = app.listen(config.port, config.host, () => {
    console.error(`🚀 CCXT MCP Server listening on http://${config.host}:${config.port}`);
    console.error(`📡 MCP endpoint: http://${config.host}:${config.port}/mcp/`);
    console.error(`🔍 Health check: http://${config.host}:${config.port}/`);
    console.error(`✅ Server ready to accept connections`);
  });

  // Graceful shutdown handling
  const shutdown = () => {
    console.error(`🛑 Shutting down server...`);
    httpServer.close(() => {
      console.error(`✅ HTTP server closed`);
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

/**
 * Main function
 */
async function main(): Promise<void> {
  try {
    const config = parseArgs();

    console.error(`\n==================================================`);
    console.error(`🎯 CCXT MCP Server v${config.version}`);
    console.error(`📋 Transport: ${config.transport}`);
    if (config.transport === "streamable-http") {
      console.error(`🌐 Address: http://${config.host}:${config.port}`);
    }
    console.error(`==================================================\n`);

    if (config.transport === "stdio") {
      await startStdioServer();
    } else {
      await startHttpServer(config);
    }
  } catch (error) {
    console.error(`💥 Fatal error:`, error);
    process.exit(1);
  }
}

// Start the server
main().catch((error) => {
  console.error(`💥 Unhandled error:`, error);
  process.exit(1);
});
