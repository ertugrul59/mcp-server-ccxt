#!/usr/bin/env node
/**
 * CCXT MCP Server
 * High-performance cryptocurrency exchange interface with optimized caching and rate limiting
 *
 * CCXT MCP 服务器
 * 具有优化缓存和速率限制的高性能加密货币交易所接口
 */

// Redirect console output to stderr to avoid MCP protocol interference
function setupConsoleRedirection() {
  console.log = (...args) => console.error("[LOG]", ...args);
  console.info = (...args) => console.error("[INFO]", ...args);
  console.warn = (...args) => console.error("[WARN]", ...args);
  console.debug = (...args) => console.error("[DEBUG]", ...args);
}

// Setup console redirection before imports
setupConsoleRedirection();

// Now we can safely import modules
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import * as ccxt from "ccxt";
import dotenv from "dotenv";
import { randomUUID } from "crypto";

import { log, LogLevel, setLogLevel } from "./utils/logging.js";
import { getCacheStats, clearCache } from "./utils/cache.js";
import { rateLimiter } from "./utils/rate-limiter.js";
import { SUPPORTED_EXCHANGES, getExchange } from "./exchange/manager.js";
import { registerAllTools } from "./tools/index.js";

// Configuration interface
interface ServerConfig {
  transport: string;
  port: number;
  host: string;
}

function parseCommandLineArgs(): ServerConfig {
  /** Parse and validate command line arguments. */
  const args = process.argv.slice(2);
  const config: ServerConfig = {
    transport: "stdio",
    port: 8004,
    host: "localhost",
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]?.toLowerCase()) {
      case "--transport":
        if (i + 1 < args.length && args[i + 1]) {
          config.transport = args[i + 1];
          i++;
        }
        break;
      case "--port":
        if (i + 1 < args.length && args[i + 1]) {
          const port = parseInt(args[i + 1], 10);
          if (!isNaN(port) && port > 0 && port <= 65535) {
            config.port = port;
          }
          i++;
        }
        break;
      case "--host":
        if (i + 1 < args.length && args[i + 1]) {
          config.host = args[i + 1];
          i++;
        }
        break;
    }
  }

  return config;
}

function createMcpServer(): McpServer {
  /** Create and configure the MCP server with resources and basic tools. */
  const server = new McpServer({
    name: "CCXT MCP Server",
    version: "1.1.0",
    capabilities: {
      resources: {},
      tools: {},
    },
  });

  // Resource: Exchanges list
  server.resource("exchanges", "ccxt://exchanges", async (uri) => {
    return {
      contents: [
        {
          uri: uri.href,
          text: JSON.stringify(SUPPORTED_EXCHANGES, null, 2),
        },
      ],
    };
  });

  // Resource template: Markets
  server.resource("markets", new ResourceTemplate("ccxt://{exchange}/markets", { list: undefined }), async (uri, params) => {
    try {
      const exchange = params.exchange as string;
      const ex = getExchange(exchange);
      await ex.loadMarkets();

      const markets = Object.values(ex.markets).map((market) => ({
        symbol: (market as any).symbol,
        base: (market as any).base,
        quote: (market as any).quote,
        active: (market as any).active,
      }));

      return {
        contents: [
          {
            uri: uri.href,
            text: JSON.stringify(markets, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        contents: [
          {
            uri: uri.href,
            text: `Error fetching markets: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  });

  // Resource template: Ticker
  server.resource("ticker", new ResourceTemplate("ccxt://{exchange}/ticker/{symbol}", { list: undefined }), async (uri, params) => {
    try {
      const exchange = params.exchange as string;
      const symbol = params.symbol as string;
      const ex = getExchange(exchange);
      const ticker = await ex.fetchTicker(symbol);

      return {
        contents: [
          {
            uri: uri.href,
            text: JSON.stringify(ticker, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        contents: [
          {
            uri: uri.href,
            text: `Error fetching ticker: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  });

  // Resource template: Order book
  server.resource("order-book", new ResourceTemplate("ccxt://{exchange}/orderbook/{symbol}", { list: undefined }), async (uri, params) => {
    try {
      const exchange = params.exchange as string;
      const symbol = params.symbol as string;
      const ex = getExchange(exchange);
      const orderbook = await ex.fetchOrderBook(symbol);

      return {
        contents: [
          {
            uri: uri.href,
            text: JSON.stringify(orderbook, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        contents: [
          {
            uri: uri.href,
            text: `Error fetching order book: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  });

  return server;
}

function registerManagementTools(server: McpServer): void {
  /** Register cache and logging management tools. */
  // Cache statistics tool
  server.tool("cache-stats", "Get CCXT cache statistics", {}, async () => {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(getCacheStats(), null, 2),
        },
      ],
    };
  });

  // Cache clearing tool
  server.tool("clear-cache", "Clear CCXT cache", {}, async () => {
    clearCache();
    return {
      content: [
        {
          type: "text",
          text: "Cache cleared successfully.",
        },
      ],
    };
  });

  // Log level management
  server.tool(
    "set-log-level",
    "Set logging level",
    {
      level: z.enum(["debug", "info", "warning", "error"]).describe("Logging level to set"),
    },
    async ({ level }) => {
      setLogLevel(level);
      return {
        content: [
          {
            type: "text",
            text: `Log level set to ${level}.`,
          },
        ],
      };
    }
  );
}

async function setupHttpTransport(server: McpServer, config: ServerConfig): Promise<void> {
  /** Set up HTTP transport with Express server and proper error handling. */
  try {
    const express = await import("express");
    const http = await import("http");

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });

    await server.connect(transport);

    // Create Express app and HTTP server
    const app = express.default();
    app.use(express.default.json());

    // Add CORS headers
    app.use((req, res, next) => {
      res.header("Access-Control-Allow-Origin", "*");
      res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
      res.header("Access-Control-Allow-Headers", "Content-Type, Accept, Authorization, Mcp-Session-Id, Last-Event-ID");
      res.header("Access-Control-Expose-Headers", "Mcp-Session-Id");
      if (req.method === "OPTIONS") {
        res.sendStatus(200);
      } else {
        next();
      }
    });

    // MCP endpoint - handle both /mcp and /mcp/ paths
    app.all("/mcp", async (req, res) => {
      await transport.handleRequest(req, res, req.body);
    });

    app.all("/mcp/", async (req, res) => {
      await transport.handleRequest(req, res, req.body);
    });

    // Create HTTP server
    const httpServer = http.createServer(app);

    return new Promise((resolve, reject) => {
      httpServer.listen(config.port, config.host, () => {
        log(LogLevel.INFO, `CCXT MCP server listening on http://${config.host}:${config.port}`);
        resolve();
      });

      httpServer.on("error", (error) => {
        reject(error);
      });
    });
  } catch (error) {
    throw new Error(`Failed to setup HTTP transport: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function setupStdioTransport(server: McpServer): Promise<void> {
  /** Set up stdio transport. */
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function setupProcessHandlers(): void {
  /** Set up process signal handlers for graceful shutdown. */
  process.on("uncaughtException", (error) => {
    log(LogLevel.ERROR, `Uncaught exception: ${error.message}`);
    log(LogLevel.ERROR, error.stack || "No stack trace");
    process.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    log(LogLevel.ERROR, `Unhandled rejection: ${reason}`);
    process.exit(1);
  });

  process.on("SIGINT", () => {
    log(LogLevel.INFO, "Received SIGINT, shutting down gracefully");
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    log(LogLevel.INFO, "Received SIGTERM, shutting down gracefully");
    process.exit(0);
  });
}

async function main(): Promise<void> {
  /** Main function to initialize and start the CCXT MCP server. */
  try {
    // Load environment variables
    dotenv.config();

    // Parse command line arguments
    const config = parseCommandLineArgs();

    // Setup process handlers
    setupProcessHandlers();

    // Log startup info only if running in terminal
    if (process.stdout.isTTY) {
      log(LogLevel.INFO, "Starting CCXT MCP Server...");
      log(LogLevel.INFO, `Transport mode: ${config.transport}`);
      if (config.transport === "streamable-http") {
        log(LogLevel.INFO, `HTTP Server: ${config.host}:${config.port}`);
      }
    }

    // Create and configure server
    const server = createMcpServer();

    // Register management tools
    registerManagementTools(server);

    // Register all exchange tools
    registerAllTools(server);

    // Setup transport
    if (config.transport === "streamable-http") {
      try {
        await setupHttpTransport(server, config);
      } catch (error) {
        log(LogLevel.ERROR, `HTTP transport failed: ${error instanceof Error ? error.message : String(error)}`);
        log(LogLevel.INFO, "Falling back to stdio transport");
        await setupStdioTransport(server);
      }
    } else {
      await setupStdioTransport(server);
    }

    if (process.stdout.isTTY) {
      log(LogLevel.INFO, "CCXT MCP Server is running");
    }
  } catch (error) {
    log(LogLevel.ERROR, `Failed to start server: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

// Start the MCP server
main().catch((error) => {
  log(LogLevel.ERROR, `Unhandled error in main: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
