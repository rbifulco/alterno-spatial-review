#!/usr/bin/env node
import { validateWebsite } from "./validate.js";

const [command, website, ...flags] = process.argv.slice(2);
let discoveryUrl: string | undefined;
for (let index = 0; index < flags.length; index += 1) {
  if (flags[index] !== "--discovery-url" || !flags[index + 1] || discoveryUrl !== undefined) {
    process.stderr.write("Usage: spatial-review validate <website-url> [--discovery-url <url>]\n");
    process.exitCode = 2;
    break;
  }
  discoveryUrl = flags[index + 1];
  index += 1;
}
if (process.exitCode !== 2 && (command !== "validate" || !website)) {
  process.stderr.write("Usage: spatial-review validate <website-url> [--discovery-url <url>]\n");
  process.exitCode = 2;
} else if (process.exitCode !== 2) {
  validateWebsite(website, { discoveryUrl }).then(
    (output) => process.stdout.write(output),
    (error) => { process.stderr.write(`${error instanceof Error ? error.message : error}\n`); process.exitCode = 1; },
  );
}
