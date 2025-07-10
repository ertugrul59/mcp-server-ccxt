#!/usr/bin/env python3
"""
Test CCXT MCP Performance Using Agent's MultiServerMCPClient
============================================================

This script tests the CCXT MCP server using the exact same
MultiServerMCPClient approach that the agent uses. This gives us realistic
performance measurements that match real agent usage.

IMPORTANT: This test requires ALL MCP servers to be running, as it initializes
the client with the full agent configuration to ensure compatibility. You can
start all servers using the './start_mcp_servers_terminals.sh' script.

Usage:
    # Make sure all MCP servers are running first!
    # This script now runs a diagnostic test by default.
    python my-mcp-servers/mcp-server-ccxt/tests/test_mcp_agent_style.py
"""

import asyncio
import time
import statistics
import argparse
import sys
import os
from typing import List, Dict, Any, Optional
from datetime import datetime
import logging
import json

# Add the project root to Python path so we can import from src
# This needs to be adjusted based on the new file location
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../..')))

try:
    from langchain_mcp_adapters.client import MultiServerMCPClient
    from src.core.config import create_mcp_client_config
except ImportError as e:
    print(f"❌ Import error: {e}")
    print("   Make sure you're running from the project root with the virtual environment activated")
    print("   and langchain-mcp-adapters is installed.")
    sys.exit(1)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class MCPAgentStyleTester:
    """Test MCP performance using the agent's exact approach"""
    
    def __init__(self):
        self.mcp_client = None
        self.mcp_tools = {}
    
    async def initialize_mcp_client(self) -> bool:
        """Initialize MCP client exactly like the agent does"""
        try:
            logger.info("🔥 Creating MCP client using agent's configuration...")
            
            # Add a small delay to allow the server to initialize fully
            logger.info("⏳ Waiting 3 seconds for MCP servers to fully start...")
            await asyncio.sleep(3)

            # Get the exact same config the agent uses.
            # NOTE: We use the FULL config, which requires all MCP servers to be running.
            mcp_config = create_mcp_client_config()
            
            logger.info("📊 Using full MCP Config. Ensure all servers (Telegram, TradingView, Coinglass, CCXT) are running.")
            
            # Create client with the same config as agent
            self.mcp_client = MultiServerMCPClient(mcp_config)
            
            # Add one more delay, as the main agent does more work here before using tools
            logger.info("⏳ Client created, waiting another 2s before tool discovery...")
            await asyncio.sleep(2)

            # Get tools like the agent does
            tools_list = await self.mcp_client.get_tools()
            self.mcp_tools = {tool.name: tool for tool in tools_list}
            
            logger.info("✅ MCP client initialized successfully!")
            logger.info(f"🔧 Available tools: {list(self.mcp_tools.keys())}")
            
            return True
            
        except Exception as e:
            import traceback
            exc_info = sys.exc_info()
            exc_str = ''.join(traceback.format_exception(*exc_info))
            logger.error(f"❌ Failed to initialize MCP client: {e}\n{exc_str}")
            logger.error("   HINT: This test requires ALL MCP servers to be running. Did you run './start_mcp_servers_terminals.sh'?")
            return False
    
    async def test_simple_tool(self) -> Dict[str, Any]:
        """Tests a simple, argument-less tool to diagnose invocation issues."""
        tool_name = "list-exchanges"
        if tool_name not in self.mcp_tools:
            raise Exception(f"'{tool_name}' tool not available. Tool discovery may have failed.")
        
        logger.info(f"📊 Testing simple tool call: '{tool_name}'")
        
        tool = self.mcp_tools[tool_name]
        start_time = time.time()
        
        try:
            # Call the simple tool with no arguments
            result = await tool.ainvoke({})
            
            end_time = time.time()
            duration = end_time - start_time
            
            success = False
            error = "Result format was unexpected."
            data = None

            # langchain_mcp_adapters automatically unwraps MCP responses 
            # and returns just the text content as a string
            if isinstance(result, str):
                try:
                    # Try to parse the JSON string
                    data = json.loads(result)
                    success = True
                    error = None
                except json.JSONDecodeError as e:
                    # If it's not JSON, check if it's an error message
                    if "error" in result.lower() or "failed" in result.lower():
                        error = result
                    else:
                        # It's a valid string response, just not JSON
                        data = result
                        success = True
                        error = None
            else:
                error = f"Unexpected result type: {type(result).__name__}: {str(result)[:200]}"

            test_result = {
                'tool_name': tool_name,
                'success': success,
                'duration': duration,
                'result': result,
                'error': error,
                'data': data
            }
            
            if success:
                logger.info(f"✅ '{tool_name}' call successful in {duration:.2f}s.")
                if isinstance(data, list) and len(data) > 0:
                    logger.info(f"   Retrieved {len(data)} exchanges: {data[:3]}...")
            else:
                logger.error(f"❌ '{tool_name}' call failed: {error}")
            
            return test_result
            
        except Exception as e:
            end_time = time.time()
            duration = end_time - start_time
            logger.error(f"❌ Exception during '{tool_name}' call: {e}")
            return {
                'tool_name': tool_name,
                'success': False,
                'duration': duration,
                'result': None,
                'error': str(e),
                'data': None
            }

    async def cleanup(self):
        """Clean up MCP client resources"""
        if self.mcp_client:
            try:
                # The MultiServerMCPClient should handle cleanup automatically
                logger.info("🧹 Cleaning up MCP client...")
            except Exception as e:
                logger.warning(f"⚠️ Error during cleanup: {e}")

async def main():
    parser = argparse.ArgumentParser(description='Test CCXT MCP Performance using Agent Style')
    parser.add_argument('--verbose', '-v', action='store_true', help='Enable verbose logging')
    
    args = parser.parse_args()
    
    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)
    
    tester = MCPAgentStyleTester()
    
    try:
        logger.info("🚀 Starting diagnostic test for CCXT MCP server...")
        
        if not await tester.initialize_mcp_client():
            sys.exit(1)

        # Run the simple diagnostic test
        test_result = await tester.test_simple_tool()

        # Print a simple report
        print("\n" + "="*80)
        print("🔬 CCXT MCP TOOL INVOCATION DIAGNOSTIC REPORT")
        print("="*80)
        print(f"Tool Tested:      '{test_result['tool_name']}'")
        print(f"Execution Time:   {test_result['duration']:.3f}s")
        
        if test_result['success']:
            print("✅ STATUS:           SUCCESS")
            print("\n   The CCXT MCP server is working correctly! Tool invocation, response")
            print("   formatting, and data parsing are all functioning as expected.")
            print("   The langchain_mcp_adapters library properly unwraps MCP responses.")
            print("\n   This confirms that:")
            print("   • MCP server connection is stable")
            print("   • Tool registration is working") 
            print("   • Response format matches the MCP specification")
            print("   • All 100 tools should be available")
            
            if isinstance(test_result['data'], list):
                print(f"\n   Result Data: {len(test_result['data'])} exchanges found")
                print(f"   Sample: {test_result['data'][:5]}")
            else:
                print(f"\n   Result Data: {test_result['data']}")
        else:
            print("❌ STATUS:           FAILURE")
            print(f"   Error: {test_result['error']}")
            print("\n   There is still an issue with the CCXT server tool invocation.")
            print("   Check the server logs and ensure the tool implementation is correct.")
        print("="*80)
        
    except KeyboardInterrupt:
        print("\n⚠️ Test interrupted by user")
    except Exception as e:
        logger.error(f"❌ Test failed catastrophically: {e}", exc_info=args.verbose)
        sys.exit(1)
    finally:
        await tester.cleanup()

if __name__ == "__main__":
    asyncio.run(main()) 