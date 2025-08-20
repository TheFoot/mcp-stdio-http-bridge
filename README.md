# mcp-stdio-http-bridge

[![npm version](https://img.shields.io/npm/v/mcp-stdio-http-bridge.svg)](https://www.npmjs.com/package/mcp-stdio-http-bridge)
[![CI](https://github.com/wsd-team-dev/mcp-stdio-http-bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/wsd-team-dev/mcp-stdio-http-bridge/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/wsd-team-dev/mcp-stdio-http-bridge/branch/main/graph/badge.svg)](https://codecov.io/gh/wsd-team-dev/mcp-stdio-http-bridge)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/node/v/mcp-stdio-http-bridge.svg)](https://nodejs.org)
[![npm downloads](https://img.shields.io/npm/dm/mcp-stdio-http-bridge.svg)](https://www.npmjs.com/package/mcp-stdio-http-bridge)

Universal bridge between stdio-based MCP clients (like Claude Code) and HTTP-based MCP servers.

## Why This Package?

Many MCP (Model Context Protocol) clients, including Claude Code CLI, only support stdio transport. However, deploying MCP servers as HTTP services offers better scalability, monitoring, and deployment options. This bridge enables stdio-only clients to connect to HTTP-based MCP servers seamlessly.

### Key Benefits

- 🔌 **Universal Compatibility** - Connect any stdio MCP client to any HTTP MCP server
- 🐳 **Docker Ready** - Perfect for containerized MCP server deployments
- 🔄 **Session Management** - Automatic session ID handling
- 📡 **Streaming Support** - Handles both JSON and SSE responses
- 🛡️ **Production Ready** - Comprehensive error handling and health checks
- 📦 **Zero Dependencies** - Only uses commander for CLI parsing

## Installation

### Global Installation

```bash
npm install -g mcp-stdio-http-bridge
```

### Local Installation

```bash
npm install mcp-stdio-http-bridge
```

### Using npx (no installation)

```bash
npx mcp-stdio-http-bridge --url http://localhost:3200/mcp
```

## Usage

### Command Line

```bash
# Basic usage
mcp-bridge --url http://localhost:3200/mcp

# With options
mcp-bridge \
  --url http://localhost:3200/mcp \
  --timeout 60000 \
  --debug

# Using environment variable
MCP_HTTP_URL=http://localhost:3200/mcp mcp-bridge

# Skip health check (useful for custom endpoints)
mcp-bridge --url http://localhost:3200/mcp --no-health-check
```

### CLI Options

| Option                    | Description                                   | Default                     | Environment Variable |
| ------------------------- | --------------------------------------------- | --------------------------- | -------------------- |
| `-u, --url <url>`         | MCP server URL                                | `http://localhost:3200/mcp` | `MCP_HTTP_URL`       |
| `-t, --timeout <ms>`      | Request timeout in milliseconds               | `30000`                     |                      |
| `-l, --log-level <level>` | Log level (trace/debug/info/warn/error/fatal) | `info`                      | `LOG_LEVEL`          |
| `--no-health-check`       | Skip health check on startup                  | `false`                     |                      |
| `-V, --version`           | Display version number                        |                             |                      |
| `-h, --help`              | Display help                                  |                             |                      |

### With Claude Code

Configure in your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "my-server": {
      "command": "npx",
      "args": ["mcp-stdio-http-bridge"],
      "env": {
        "MCP_HTTP_URL": "http://localhost:3200/mcp"
      }
    }
  }
}
```

Or install globally and use directly:

```json
{
  "mcpServers": {
    "my-server": {
      "command": "mcp-bridge",
      "args": ["--url", "http://localhost:3200/mcp"]
    }
  }
}
```

### Programmatic Usage

```javascript
import { MCPBridge } from 'mcp-stdio-http-bridge';

const bridge = new MCPBridge({
  url: 'http://localhost:3200/mcp',
  timeout: 30000,
  logLevel: 'debug', // Set log level programmatically
});

// Listen to events
bridge.on('start', () => console.log('Bridge started'));
bridge.on('error', (error) => console.error('Error:', error));
bridge.on('session', (sessionId) => console.log('Session:', sessionId));

// Start the bridge
await bridge.start();

// Stop when done
bridge.stop();
```

## API

### Class: MCPBridge

#### Constructor Options

```javascript
{
  url?: string,      // MCP server URL (default: 'http://localhost:3200/mcp')
  timeout?: number,  // Request timeout in ms (default: 30000)
  logLevel?: string, // Log level: trace/debug/info/warn/error/fatal (default: 'info')
  logger?: Object    // Custom Pino logger instance
}
```

#### Methods

- `start(options?)` - Start the bridge
- `stop()` - Stop the bridge
- `checkHealth()` - Check if HTTP server is reachable

#### Events

- `start` - Emitted when bridge starts successfully
- `stop` - Emitted when bridge stops
- `error` - Emitted on errors
- `session` - Emitted when session ID is established

## Docker Usage

### With Docker Compose

```yaml
version: '3.8'

services:
  mcp-server:
    image: your-mcp-server:latest
    ports:
      - '3200:3200'

  mcp-bridge:
    image: node:24-alpine
    command: npx mcp-stdio-http-bridge --url http://mcp-server:3200/mcp
    depends_on:
      - mcp-server
    environment:
      - MCP_HTTP_URL=http://mcp-server:3200/mcp
```

### Connecting to Running Container

```json
{
  "mcpServers": {
    "docker-mcp": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "--network",
        "host",
        "node:24-alpine",
        "npx",
        "mcp-stdio-http-bridge"
      ],
      "env": {
        "MCP_HTTP_URL": "http://localhost:3200/mcp"
      }
    }
  }
}
```

## Health Checks

The bridge automatically checks the `/health` endpoint before starting. Your MCP server should implement this endpoint:

```javascript
app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});
```

To skip health checks:

```bash
mcp-bridge --url http://localhost:3200/mcp --no-health-check
```

## Requirements

- Node.js >= 18.0.0
- MCP server with HTTP/Streamable HTTP transport
- MCP server should implement `/health` endpoint (optional)

## Troubleshooting

### Debug Mode and Logging

Enable detailed logging to see what's happening:

```bash
# Set log level via environment variable
LOG_LEVEL=debug mcp-bridge --url http://localhost:3200/mcp

# Or via CLI option
mcp-bridge --url http://localhost:3200/mcp --log-level debug

# Available log levels: trace, debug, info, warn, error, fatal
mcp-bridge --log-level trace  # Most verbose
```

The bridge uses Pino for structured logging with pretty formatting in development and JSON in production.

### Common Issues

1. **"MCP server not reachable"**
   - Ensure your HTTP MCP server is running
   - Check the URL is correct
   - Verify network connectivity

2. **"Parse error"**
   - Verify your MCP server returns valid JSON-RPC responses
   - Check Content-Type headers

3. **Session issues**
   - Ensure your server properly handles Mcp-Session-Id headers
   - Check session timeout settings

## Development

```bash
# Clone repository
git clone https://github.com/wsd-team-dev/mcp-stdio-http-bridge.git
cd mcp-stdio-http-bridge

# Install dependencies
npm install

# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Run linting
npm run lint

# Format code
npm run format
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT © WSD Team

## Related

- [Model Context Protocol](https://modelcontextprotocol.io)
- [MCP Specification](https://spec.modelcontextprotocol.io)
- [Claude Code](https://www.anthropic.com/claude-code)

## Support

For issues and questions, please use the [GitHub issue tracker](https://github.com/wsd-team-dev/mcp-stdio-http-bridge/issues).
