#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { sanitizeText } from './observability-status-publisher.mjs';

const GENERIC_LINES = [
  /^npm error location\b/i,
  /^npm error command failed\b/i,
  /^npm error command sh -c\b/i,
  /^process completed with exit code\b/i,
  /^error: process completed with exit code\b/i,
];

function cleanLine(value) {
  return String(value || '')
    .replace(/^\ufeff/, '')
    .replace(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\s+/, '')
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/^##\[(?:group|endgroup|command|debug)\]/i, '')
    .trim();
}

function isGeneric(line) {
  return GENERIC_LINES.some((pattern) => pattern.test(line));
}

export function summarizeHomePanelDeployFailure(text, maximum = 900) {
  const lines = String(text || '').split(/\r?\n/).map(cleanLine).filter(Boolean);
  const meaningful = lines.filter((line) => !isGeneric(line));
  const preferred = meaningful.filter((line) => (
    /(?:^|\b)(?:error|failed|failure|invalid|missing|not found|forbidden|unauthorized|conflict|binding|bucket|queue|durable object|code\s*\d+)/i.test(line)
    || /^✘/.test(line)
  ));
  const selected = (preferred.length ? preferred : meaningful.slice(-12))
    .map((line) => line.replace(/^::error(?: title=[^:]*)?::/i, '').trim())
    .filter(Boolean);
  const summary = sanitizeText([...new Set(selected)].slice(-8).join(' | '))
    || 'Wrangler deployment failed without a specific diagnostic line.';
  return summary.length <= maximum ? summary : `${summary.slice(0, maximum - 1)}…`;
}

async function main() {
  const path = String(process.argv[2] || '').trim();
  if (!path) throw new Error('deployment log path is required');
  const summary = summarizeHomePanelDeployFailure(await readFile(path, 'utf8'));
  console.error(`::error title=HomePanel deploy failed::${summary}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`::error title=HomePanel deploy diagnostics::${sanitizeText(error?.message || error).replaceAll('\n', ' ').slice(0, 1000)}`);
    process.exitCode = 1;
  });
}
