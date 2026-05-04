#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TOOL_NAMES_TO_SANITIZE = new Set(["resolve-library-id", "get-library-docs", "query-docs"]);

function isPrivateUrl(value) {
  const lower = value.toLowerCase();
  if (!lower.startsWith("http://") && !lower.startsWith("https://")) return false;
  if (lower.includes("localhost") || lower.includes("127.0.0.1") || lower.includes(".local") || lower.includes(".internal")) {
    return true;
  }
  if (/https?:\/\/10\.\d+\.\d+\.\d+/.test(lower)) return true;
  if (/https?:\/\/192\.168\.\d+\.\d+/.test(lower)) return true;
  if (/https?:\/\/172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+/.test(lower)) return true;
  return false;
}

function sanitizeString(input) {
  let value = String(input);

  value = value.replace(/```[\s\S]*?```/g, "[redacted-private-code]");
  value = value.replace(
    /(api[_-]?key|token|secret|password)\s*[:=]\s*([^\s,;]+)/gi,
    (_m, name) => `${name}=[redacted]`,
  );
  value = value.replace(/\bsk-[A-Za-z0-9_-]{20,}\b/g, "[redacted-api-key]");
  value = value.replace(/\bghp_[A-Za-z0-9]{20,}\b/g, "[redacted-github-token]");
  value = value.replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, "[redacted-github-token]");
  value = value.replace(/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, "[redacted-slack-token]");
  value = value.replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[redacted-jwt]");
  value = value.replace(/https?:\/\/[^\s)\]}>"']+/gi, (url) => (isPrivateUrl(url) ? "[redacted-private-url]" : url));

  const newlineCount = (value.match(/\n/g) || []).length;
  if (value.length > 1200 || newlineCount > 25) {
    return "[redacted-long-input]";
  }

  return value;
}

function sanitizeValue(value) {
  if (typeof value === "string") return sanitizeString(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item));
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, nested] of Object.entries(value)) {
      out[key] = sanitizeValue(nested);
    }
    return out;
  }
  return value;
}

function maybeSanitizeRpcMessage(message) {
  if (!message || typeof message !== "object") return message;
  if (message.method !== "tools/call") return message;
  if (!message.params || typeof message.params !== "object") return message;
  if (!TOOL_NAMES_TO_SANITIZE.has(message.params.name)) return message;

  const args = message.params.arguments ?? {};
  const sanitizedArgs = sanitizeValue(args);
  return {
    ...message,
    params: {
      ...message.params,
      arguments: sanitizedArgs,
    },
  };
}

class JsonLineParser {
  constructor(onLine) {
    this.onLine = onLine;
    this.buffer = "";
  }

  push(chunk) {
    this.buffer += chunk.toString("utf8");

    while (true) {
      const newlineIndex = this.buffer.indexOf("\n");
      if (newlineIndex === -1) return;

      const line = this.buffer.slice(0, newlineIndex).replace(/\r$/, "");
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (!line.trim()) continue;
      this.onLine(line);
    }
  }
}

function runSelfTest() {
  const sample = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "query-docs",
      arguments: {
        query:
          "Use this token REDACTED-OPENAI-KEY-EXAMPLE and private URL http://localhost:8080, secret=abc123.\n```js\nconst db = 'internal';\n```",
      },
    },
  };

  const sanitized = maybeSanitizeRpcMessage(sample);
  process.stdout.write(`${JSON.stringify(sanitized, null, 2)}\n`);
}

if (process.argv.includes("--self-test")) {
  runSelfTest();
  process.exit(0);
}

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const localContext7Entry = path.resolve(thisDir, "../node_modules/@upstash/context7-mcp/dist/index.js");

const hasLocalContext7 = existsSync(localContext7Entry);
const childCmd = hasLocalContext7 ? "node" : process.platform === "win32" ? "cmd.exe" : "npx";
const childArgs = hasLocalContext7
  ? [localContext7Entry]
  : process.platform === "win32"
    ? ["/c", "npx", "-y", "@upstash/context7-mcp@latest"]
    : ["-y", "@upstash/context7-mcp@latest"];

const child = spawn(childCmd, childArgs, {
  stdio: ["pipe", "pipe", "inherit"],
  env: process.env,
});

child.on("exit", (code, signal) => {
  if (signal) process.stderr.write(`context7 child exited by signal ${signal}\n`);
  process.exit(code ?? 1);
});

child.on("error", (error) => {
  process.stderr.write(`failed to start context7 child: ${error.message}\n`);
  process.exit(1);
});

const incomingParser = new JsonLineParser((lineText) => {
  let outText = lineText;
  try {
    const parsed = JSON.parse(lineText);
    const sanitized = maybeSanitizeRpcMessage(parsed);
    outText = JSON.stringify(sanitized);
  } catch {
    outText = lineText;
  }
  child.stdin.write(`${outText}\n`);
});

const outgoingParser = new JsonLineParser((lineText) => {
  try {
    const parsed = JSON.parse(lineText);
    process.stdout.write(`${JSON.stringify(parsed)}\n`);
  } catch {
    // Drop non-JSON banner/noise from child stdout to keep protocol clean.
  }
});

process.stdin.on("data", (chunk) => incomingParser.push(chunk));
child.stdout.on("data", (chunk) => outgoingParser.push(chunk));
