#!/usr/bin/env node
/**
 * Invoke one Concord MCP tool over stdio on demand, without keeping a persistent
 * MCP server or global lifecycle hooks enabled.
 *
 * Usage:
 *   node concord-call.mjs --agent <id> [--kind <kind>] [--repo <dir>] <tool> [jsonArgs]
 *   echo '{"task_id":"TASK-1"}' | node concord-call.mjs --agent <id> <tool> -
 */
import { spawn, execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';

function parseArgs(argv) {
  const opts = {
    agent: process.env.CONCORD_AGENT_ID || '',
    kind: process.env.CONCORD_AGENT_KIND || '',
    repo: process.cwd(),
    timeoutMs: 20000,
    positional: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--agent' && i + 1 < argv.length) {
      opts.agent = argv[++i];
    } else if (arg === '--kind' && i + 1 < argv.length) {
      opts.kind = argv[++i];
    } else if ((arg === '--repo' || arg === '-C') && i + 1 < argv.length) {
      opts.repo = argv[++i];
    } else if (arg === '--timeout' && i + 1 < argv.length) {
      opts.timeoutMs = Number(argv[++i]) || 20000;
    } else if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: node concord-call.mjs [--agent <id>] [--kind <antigravity|codex>] [--repo <path>] <tool_name> [json_args|-]',
      );
      process.exit(0);
    } else {
      opts.positional.push(arg);
    }
  }

  return opts;
}

function inferKind(agentId, explicitKind) {
  if (explicitKind) return explicitKind;
  const idx = agentId.indexOf(':');
  return idx > 0 ? agentId.slice(0, idx) : '';
}

function resolveConcordMcpLaunch() {
  if (process.env.CONCORD_MCP_ENTRY && existsSync(process.env.CONCORD_MCP_ENTRY)) {
    return { command: process.execPath, args: [process.env.CONCORD_MCP_ENTRY], shell: false };
  }

  const candidateRoots = [];
  if (process.env.APPDATA) {
    candidateRoots.push(join(process.env.APPDATA, 'npm', 'node_modules'));
  }
  candidateRoots.push(join(dirname(process.execPath), 'node_modules'));
  candidateRoots.push(join(dirname(process.execPath), '..', 'lib', 'node_modules'));

  for (const root of candidateRoots) {
    const entry = join(root, '@concord-ai', 'concord-mcp', 'dist', 'index.js');
    if (existsSync(entry)) {
      return { command: process.execPath, args: [entry], shell: false };
    }
  }

  try {
    const root = execSync('npm root -g', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const entry = join(root, '@concord-ai', 'concord-mcp', 'dist', 'index.js');
    if (existsSync(entry)) {
      return { command: process.execPath, args: [entry], shell: false };
    }
  } catch {
    // Fall back to PATH lookup below.
  }

  return {
    command: process.platform === 'win32' ? 'concord-mcp.cmd' : 'concord-mcp',
    args: [],
    shell: false,
  };
}

async function readStdinIfPiped() {
  if (process.stdin.isTTY) return '';
  let data = '';
  for await (const chunk of process.stdin) {
    data += chunk;
  }
  return data.trim();
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const [toolName, rawJsonArg] = opts.positional;

  if (!toolName) {
    console.error('Error: missing <tool_name>. Example: echo "{}" | node concord-call.mjs --agent codex:1234abcd inspect_work -');
    process.exit(2);
  }

  let toolArgs = {};
  const rawInput = rawJsonArg === '-' || rawJsonArg === undefined ? await readStdinIfPiped() : rawJsonArg;
  if (rawInput && rawInput.length > 0) {
    try {
      toolArgs = JSON.parse(rawInput);
    } catch (err) {
      console.error(`Error: invalid JSON arguments: ${err.message}`);
      process.exit(2);
    }
  }

  if (opts.agent && toolArgs && typeof toolArgs === 'object' && !('agent_id' in toolArgs)) {
    toolArgs.agent_id = opts.agent;
  }

  const kind = inferKind(opts.agent, opts.kind);
  const childEnv = { ...process.env };
  if (opts.agent) childEnv.CONCORD_AGENT_ID = opts.agent;
  if (kind) childEnv.CONCORD_AGENT_KIND = kind;

  const launch = resolveConcordMcpLaunch();
  const child = spawn(launch.command, launch.args, {
    cwd: opts.repo,
    env: childEnv,
    shell: launch.shell,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stderrBuf = '';
  child.stderr.on('data', (chunk) => {
    stderrBuf += chunk.toString();
  });

  const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const pending = new Map();

  const timer = setTimeout(() => {
    child.kill();
    console.error(`Error: timed out after ${opts.timeoutMs}ms waiting for concord-mcp`);
    process.exit(124);
  }, opts.timeoutMs);

  function sendRequest(id, method, params) {
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  function sendNotification(method, params) {
    const payload = params === undefined ? { jsonrpc: '2.0', method } : { jsonrpc: '2.0', method, params };
    child.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      return;
    }
    if (msg.id !== undefined && pending.has(msg.id)) {
      const { resolve } = pending.get(msg.id);
      pending.delete(msg.id);
      resolve(msg);
    }
  });

  child.on('error', (err) => {
    clearTimeout(timer);
    console.error(`Error launching concord-mcp: ${err.message}`);
    process.exit(1);
  });

  try {
    const initResp = await sendRequest(1, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'concord-on-demand-skill', version: '1.0.0' },
    });
    if (initResp.error) {
      throw new Error(initResp.error.message || JSON.stringify(initResp.error));
    }

    sendNotification('notifications/initialized');

    const callResp = await sendRequest(2, 'tools/call', {
      name: toolName,
      arguments: toolArgs,
    });

    clearTimeout(timer);
    child.stdin.end();
    child.kill();

    if (callResp.error) {
      console.error(JSON.stringify(callResp.error, null, 2));
      process.exit(1);
    }

    const result = callResp.result || {};
    if (Array.isArray(result.content)) {
      for (const item of result.content) {
        if (item.type === 'text' && typeof item.text === 'string') {
          console.log(item.text);
        } else {
          console.log(JSON.stringify(item, null, 2));
        }
      }
    } else {
      console.log(JSON.stringify(result, null, 2));
    }

    if (result.isError) {
      process.exit(1);
    }
  } catch (err) {
    clearTimeout(timer);
    child.kill();
    console.error(`Error: ${err.message}${stderrBuf ? `\n${stderrBuf.trim()}` : ''}`);
    process.exit(1);
  }
}

main();
