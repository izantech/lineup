#!/usr/bin/env node
import { printCliError, resolveExitCode, run } from "../dist/cli.js";

run().catch((error) => {
  printCliError(error);
  process.exit(resolveExitCode(error));
});
