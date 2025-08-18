/**
 * Private API Tools
 * Tools for accessing private cryptocurrency exchange functionality
 *
 * 私有API工具
 * 用于访问私有加密货币交易所功能的工具
 */
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getExchangeWithCredentials, MarketType } from "../exchange/manager.js";
import { log, LogLevel } from "../utils/logging.js";
import { rateLimiter } from "../utils/rate-limiter.js";

export function registerPrivateTools(server: McpServer) {
  // Account balance
  // 账户余额
  server.tool(
    "account-balance",
    "Get your account balance from a crypto exchange",
    {
      exchange: z.string().describe("Exchange ID (e.g., binance, coinbase)"),
      apiKey: z.string().describe("API key for authentication"),
      secret: z.string().describe("API secret for authentication"),
      marketType: z
        .enum(["spot", "future", "swap", "option", "margin"])
        .optional()
        .describe("Market type (default: spot)"),
    },
    async ({ exchange, apiKey, secret, marketType }) => {
      try {
        return await rateLimiter.execute(exchange, async () => {
          // Get exchange with market type
          const ex = getExchangeWithCredentials(exchange, apiKey, secret, marketType);

          // Fetch balance
          log(LogLevel.INFO, `Fetching account balance for ${exchange}`);
          const balance = await ex.fetchBalance();

          // Format the balance for better readability
          const formattedBalance = {
            total: balance.total,
            free: balance.free,
            used: balance.used,
            timestamp: new Date(balance.timestamp || Date.now()).toISOString(),
          };

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(formattedBalance, null, 2),
              },
            ],
          };
        });
      } catch (error) {
        log(
          LogLevel.ERROR,
          `Error fetching account balance: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        return {
          content: [
            {
              type: "text",
              text: `Error fetching account balance: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Place market order
  // 下市价单
  server.tool(
    "place-market-order",
    "Place a market order on an exchange",
    {
      exchange: z.string().describe("Exchange ID (e.g., binance, coinbase)"),
      symbol: z.string().describe("Trading pair symbol (e.g., BTC/USDT)"),
      side: z.enum(["buy", "sell"]).describe("Order side: buy or sell"),
      amount: z.number().positive().describe("Amount to buy/sell"),
      marketType: z
        .enum(["spot", "future", "swap", "option", "margin"])
        .optional()
        .describe("Market type (default: spot)"),
    },
    async ({ exchange, symbol, side, amount, marketType }) => {
      try {
        return await rateLimiter.execute(exchange, async () => {
          // Get API credentials from environment variables
          const apiKey = process.env[`${exchange.toUpperCase()}_API_KEY`];
          const secret = process.env[`${exchange.toUpperCase()}_SECRET`];

          if (!apiKey || !secret) {
            throw new Error(
              `Missing API credentials for ${exchange}. Please set ${exchange.toUpperCase()}_API_KEY and ${exchange.toUpperCase()}_SECRET environment variables.`
            );
          }

          // Get exchange with market type
          const ex = getExchangeWithCredentials(exchange, apiKey, secret, marketType);

          // Place market order
          log(
            LogLevel.INFO,
            `Placing ${side} market order for ${symbol} on ${exchange}, amount: ${amount}`
          );
          const order = await ex.createOrder(symbol, "market", side, amount);

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(order, null, 2),
              },
            ],
          };
        });
      } catch (error) {
        log(
          LogLevel.ERROR,
          `Error placing market order: ${error instanceof Error ? error.message : String(error)}`
        );
        return {
          content: [
            {
              type: "text",
              text: `Error placing market order: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Place limit order
  // 下限价单
  server.tool(
    "place-limit-order",
    "Place a limit order on an exchange",
    {
      exchange: z.string().describe("Exchange ID (e.g., binance, coinbase)"),
      symbol: z.string().describe("Trading pair symbol (e.g., BTC/USDT)"),
      side: z.enum(["buy", "sell"]).describe("Order side: buy or sell"),
      amount: z.number().positive().describe("Amount to buy/sell"),
      price: z.number().positive().describe("Limit price"),
      marketType: z
        .enum(["spot", "future", "swap", "option", "margin"])
        .optional()
        .describe("Market type (default: spot)"),
    },
    async ({ exchange, symbol, side, amount, price, marketType }) => {
      try {
        return await rateLimiter.execute(exchange, async () => {
          // Get API credentials from environment variables
          const apiKey = process.env[`${exchange.toUpperCase()}_API_KEY`];
          const secret = process.env[`${exchange.toUpperCase()}_SECRET`];

          if (!apiKey || !secret) {
            throw new Error(
              `Missing API credentials for ${exchange}. Please set ${exchange.toUpperCase()}_API_KEY and ${exchange.toUpperCase()}_SECRET environment variables.`
            );
          }

          const ex = getExchangeWithCredentials(exchange, apiKey, secret, marketType);
          log(
            LogLevel.INFO,
            `Placing ${side} limit order for ${symbol} on ${exchange}, amount: ${amount}, price: ${price}`
          );
          const order = await ex.createOrder(symbol, "limit", side, amount, price);
          return {
            content: [{ type: "text", text: JSON.stringify(order, null, 2) }],
          };
        });
      } catch (error) {
        log(
          LogLevel.ERROR,
          `Error placing limit order: ${error instanceof Error ? error.message : String(error)}`
        );
        return {
          content: [
            {
              type: "text",
              text: `Error placing limit order: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Set leverage
  // 设置杠杆
  server.tool(
    "set-leverage",
    "Set leverage for futures trading",
    {
      exchange: z.string().describe("Exchange ID (e.g., binance, bybit)"),
      symbol: z.string().describe("Trading pair symbol (e.g., BTC/USDT)"),
      leverage: z.number().positive().describe("Leverage value"),
      marketType: z
        .enum(["future", "swap"])
        .default("future")
        .describe("Market type (default: future)"),
    },
    async ({ exchange, symbol, leverage, marketType }) => {
      try {
        return await rateLimiter.execute(exchange, async () => {
          // Get API credentials from environment variables
          const apiKey = process.env[`${exchange.toUpperCase()}_API_KEY`];
          const secret = process.env[`${exchange.toUpperCase()}_SECRET`];

          if (!apiKey || !secret) {
            throw new Error(
              `Missing API credentials for ${exchange}. Please set ${exchange.toUpperCase()}_API_KEY and ${exchange.toUpperCase()}_SECRET environment variables.`
            );
          }

          // Get futures exchange
          const ex = getExchangeWithCredentials(exchange, apiKey, secret, marketType);

          // Set leverage
          log(
            LogLevel.INFO,
            `Setting leverage to ${leverage}x for ${symbol} on ${exchange} (${marketType})`
          );
          const result = await ex.setLeverage(leverage, symbol);

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        });
      } catch (error) {
        log(
          LogLevel.ERROR,
          `Error setting leverage: ${error instanceof Error ? error.message : String(error)}`
        );
        return {
          content: [
            {
              type: "text",
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Set margin mode
  // 设置保证金模式
  server.tool(
    "set-margin-mode",
    "Set margin mode for futures trading",
    {
      exchange: z.string().describe("Exchange ID (e.g., binance, bybit)"),
      symbol: z.string().describe("Trading pair symbol (e.g., BTC/USDT)"),
      marginMode: z.enum(["cross", "isolated"]).describe("Margin mode: cross or isolated"),
      marketType: z
        .enum(["future", "swap"])
        .default("future")
        .describe("Market type (default: future)"),
    },
    async ({ exchange, symbol, marginMode, marketType }) => {
      try {
        return await rateLimiter.execute(exchange, async () => {
          // Get API credentials from environment variables
          const apiKey = process.env[`${exchange.toUpperCase()}_API_KEY`];
          const secret = process.env[`${exchange.toUpperCase()}_SECRET`];

          if (!apiKey || !secret) {
            throw new Error(
              `Missing API credentials for ${exchange}. Please set ${exchange.toUpperCase()}_API_KEY and ${exchange.toUpperCase()}_SECRET environment variables.`
            );
          }

          // Get futures exchange
          const ex = getExchangeWithCredentials(exchange, apiKey, secret, marketType);

          // Set margin mode
          log(
            LogLevel.INFO,
            `Setting margin mode to ${marginMode} for ${symbol} on ${exchange} (${marketType})`
          );
          const result = await ex.setMarginMode(marginMode, symbol);

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        });
      } catch (error) {
        log(
          LogLevel.ERROR,
          `Error setting margin mode: ${error instanceof Error ? error.message : String(error)}`
        );
        return {
          content: [
            {
              type: "text",
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Place futures market order
  // 下期货市价单
  server.tool(
    "place-futures-market-order",
    "Place a futures market order",
    {
      exchange: z.string().describe("Exchange ID (e.g., binance, bybit)"),
      symbol: z.string().describe("Trading pair symbol (e.g., BTC/USDT)"),
      side: z.enum(["buy", "sell"]).describe("Order side: buy or sell"),
      amount: z.number().positive().describe("Amount to buy/sell"),
      params: z.record(z.any()).optional().describe("Additional order parameters"),
      marketType: z
        .enum(["future", "swap"])
        .default("future")
        .describe("Market type (default: future)"),
    },
    async ({ exchange, symbol, side, amount, params, marketType }) => {
      try {
        return await rateLimiter.execute(exchange, async () => {
          // Get API credentials from environment variables
          const apiKey = process.env[`${exchange.toUpperCase()}_API_KEY`];
          const secret = process.env[`${exchange.toUpperCase()}_SECRET`];

          if (!apiKey || !secret) {
            throw new Error(
              `Missing API credentials for ${exchange}. Please set ${exchange.toUpperCase()}_API_KEY and ${exchange.toUpperCase()}_SECRET environment variables.`
            );
          }

          // Get futures exchange
          const ex = getExchangeWithCredentials(exchange, apiKey, secret, marketType);

          // Place futures market order
          log(
            LogLevel.INFO,
            `Placing futures ${side} market order for ${symbol} on ${exchange} (${marketType}), amount: ${amount}`
          );
          const order = await ex.createOrder(
            symbol,
            "market",
            side,
            amount,
            undefined,
            params || {}
          );

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(order, null, 2),
              },
            ],
          };
        });
      } catch (error) {
        log(
          LogLevel.ERROR,
          `Error placing futures market order: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        return {
          content: [
            {
              type: "text",
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Place futures limit order
  // 下期货限价单
  server.tool(
    "place-futures-limit-order",
    "Place a futures limit order",
    {
      exchange: z.string().describe("Exchange ID (e.g., binance, bybit)"),
      symbol: z.string().describe("Trading pair symbol (e.g., BTC/USDT)"),
      side: z.enum(["buy", "sell"]).describe("Order side: buy or sell"),
      amount: z.number().positive().describe("Amount to buy/sell"),
      price: z.number().positive().describe("Limit price"),
      params: z.record(z.any()).optional().describe("Additional order parameters"),
      marketType: z
        .enum(["future", "swap"])
        .default("future")
        .describe("Market type (default: future)"),
    },
    async ({ exchange, symbol, side, amount, price, params, marketType }) => {
      try {
        return await rateLimiter.execute(exchange, async () => {
          // Get API credentials from environment variables
          const apiKey = process.env[`${exchange.toUpperCase()}_API_KEY`];
          const secret = process.env[`${exchange.toUpperCase()}_SECRET`];

          if (!apiKey || !secret) {
            throw new Error(
              `Missing API credentials for ${exchange}. Please set ${exchange.toUpperCase()}_API_KEY and ${exchange.toUpperCase()}_SECRET environment variables.`
            );
          }

          const ex = getExchangeWithCredentials(exchange, apiKey, secret, marketType);
          log(
            LogLevel.INFO,
            `Placing futures ${side} limit order for ${symbol} on ${exchange} (${marketType}), amount: ${amount}, price: ${price}`
          );
          const order = await ex.createOrder(symbol, "limit", side, amount, price, params || {});
          return {
            content: [{ type: "text", text: JSON.stringify(order, null, 2) }],
          };
        });
      } catch (error) {
        log(
          LogLevel.ERROR,
          `Error placing futures limit order: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        return {
          content: [
            {
              type: "text",
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Removed duplicate log message
}
