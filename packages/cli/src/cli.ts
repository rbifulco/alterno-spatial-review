#!/usr/bin/env node
import { validateWebsite } from "./validate.js";

const [command, website, ...flags] = process.argv.slice(2);
let discoveryUrl: string | undefined;
const allowedDocumentOrigins: string[] = [];
const usage = "Usage: spatial-review validate <website-url> [--discovery-url <url>] [--allow-origin <origin>]\n";
for (let index = 0; index < flags.length; index += 1) {
  const flag = flags[index];
  const value = flags[index + 1];
  if (!value || (flag === "--discovery-url" && discoveryUrl !== undefined) || (flag !== "--discovery-url" && flag !== "--allow-origin")) {
    process.stderr.write(usage);
    process.exitCode = 2;
    break;
  }
  if (flag === "--discovery-url") discoveryUrl = value;
  else allowedDocumentOrigins.push(value);
  index += 1;
}
if (process.exitCode !== 2 && (command !== "validate" || !website)) {
  process.stderr.write(usage);
  process.exitCode = 2;
} else if (process.exitCode !== 2) {
  validateWebsite(website, { discoveryUrl, allowedDocumentOrigins }).then(
    (output) => process.stdout.write(output),
    (error) => { process.stderr.write(`${error instanceof Error ? error.message : error}\n`); process.exitCode = 1; },
  );
}
