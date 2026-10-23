#!/usr/bin/env node
import { validateWebsite } from "./validate.js";
import { prepareReviewPackage } from "./prepare.js";

const [command, website, ...flags] = process.argv.slice(2);
let discoveryUrl: string | undefined;
const allowedDocumentOrigins: string[] = [];
const usage = "Usage: spatial-review validate <website-url> [--discovery-url <url>] [--allow-origin <origin>]\n       spatial-review prepare <capture.mjs|capture.json> --out <new-directory>\n";
if (command === "prepare") {
  if (!website || flags.length !== 2 || flags[0] !== "--out" || !flags[1]) {
    process.stderr.write(usage);
    process.exitCode = 2;
  } else await prepareReviewPackage(website, flags[1]).then(
    (output) => process.stdout.write(output),
    (error) => { process.stderr.write(`${error instanceof Error ? error.message : error}\n`); process.exitCode = 1; },
  );
} else {
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
}
