#!/usr/bin/env node
import { runCli } from './cli-command.ts';

process.exitCode = await runCli(process.argv.slice(2), {
  stdout: (text) => {
    process.stdout.write(text);
  },
  stderr: (text) => {
    process.stderr.write(text);
  },
});
