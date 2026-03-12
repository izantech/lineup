#!/usr/bin/env node
import { handleFatalError, run } from "../dist/cli.js";

run().catch(handleFatalError);
