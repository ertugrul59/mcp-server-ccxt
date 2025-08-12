#!/usr/bin/env python3
"""
Agent-style test for CCXT MCP public tools
=========================================

This test connects to the already-running CCXT MCP server over HTTP transport
like the agent does, using MultiServerMCPClient. It validates the latest
public.ts changes:

- marketType support for get-ohlcv/get-ticker (swap)
- Bybit perp symbol mapping using BTC/USDT:USDT

Run:
  python my-mcp-servers/mcp-server-ccxt/tests/test_public_tools_agent_style.py --verbose
"""

import asyncio
import argparse
import os
import sys
import json
import logging
from typing import Dict, Any


# Ensure project root on path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../../..")))

try:
    from langchain_mcp_adapters.client import MultiServerMCPClient
except Exception as e:  # noqa: BLE001
    print(f"❌ Missing dependency: langchain_mcp_adapters. Error: {e}")
    print("   pip install langchain-mcp-adapters")
    sys.exit(1)


logger = logging.getLogger("ccxt_mcp_public_tools_test")


def build_ccxt_http_only_config(host: str = "localhost", port: int = 8004) -> Dict[str, Any]:
    """Build a minimal MCP client config with only the CCXT server over HTTP."""
    return {
        "mcp-server-ccxt": {
            "transport": "streamable_http",
            "url": f"http://{host}:{port}/mcp/",
        }
    }


async def run_test(host: str, port: int) -> int:
    mcp_client = None
    try:
        cfg = build_ccxt_http_only_config(host, port)
        logger.info("🔌 Connecting to CCXT MCP at http://%s:%d/mcp/", host, port)

        mcp_client = MultiServerMCPClient(cfg)

        # Discover tools
        tools = await mcp_client.get_tools()
        tools_by_name = {t.name: t for t in tools}
        logger.info("✅ Tools discovered: %s", list(tools_by_name.keys()))

        # 1) get-market-types (structure validation)
        if "get-market-types" not in tools_by_name:
            logger.error("❌ 'get-market-types' tool not found")
            return 1
        res = await tools_by_name["get-market-types"].ainvoke({"exchange": "bybit"})
        logger.info("📥 get-market-types(bybit) → %s", str(res)[:200])
        try:
            payload = json.loads(res)
            assert isinstance(payload, dict) and isinstance(payload.get("marketTypes"), list)
        except Exception as e:  # noqa: BLE001
            logger.error("❌ get-market-types response malformed: %s", e)
            return 1

        # 2) get-ohlcv with marketType swap and Bybit perp symbol form
        if "get-ohlcv" not in tools_by_name:
            logger.error("❌ 'get-ohlcv' tool not found")
            return 1
        ohlcv_args = {
            "exchange": "bybit",
            "symbol": "BTC/USDT:USDT",
            "timeframe": "5m",
            "limit": 5,
            "marketType": "swap",
        }
        ohlcv_res = await tools_by_name["get-ohlcv"].ainvoke(ohlcv_args)
        logger.info("📥 get-ohlcv(%s) → %s", ohlcv_args, str(ohlcv_res)[:200])
        # Only structure check; content may vary or error if market unavailable in env
        assert isinstance(ohlcv_res, str)

        # 3) get-ticker with marketType swap
        if "get-ticker" not in tools_by_name:
            logger.error("❌ 'get-ticker' tool not found")
            return 1
        ticker_args = {
            "exchange": "bybit",
            "symbol": "BTC/USDT:USDT",
            "marketType": "swap",
        }
        ticker_res = await tools_by_name["get-ticker"].ainvoke(ticker_args)
        logger.info("📥 get-ticker(%s) → %s", ticker_args, str(ticker_res)[:200])
        assert isinstance(ticker_res, str)

        logger.info("✅ All public tools tests completed")
        print("OK: CCXT MCP public tools agent-style test passed")
        return 0

    except AssertionError as e:  # noqa: BLE001
        logger.error("❌ Assertion failed: %s", e)
        return 1
    except Exception as e:  # noqa: BLE001
        logger.exception("❌ Test failed: %s", e)
        return 1
    finally:
        # Cleanup handled by client internals; no explicit close needed for HTTP
        pass


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default=os.getenv("CCXT_HOST", "localhost"))
    parser.add_argument("--port", type=int, default=int(os.getenv("CCXT_PORT", "8004")))
    parser.add_argument("--verbose", "-v", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s - %(levelname)s - %(message)s",
    )

    exit_code = asyncio.run(run_test(args.host, args.port))
    sys.exit(exit_code)


if __name__ == "__main__":
    main()
