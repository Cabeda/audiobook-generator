#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-run

// This is the global CLI entrypoint
import { main } from "./src/cli/cli.ts";

// Export the main function so it can be used by importers
export { main };

// Run the main function if this script is executed directly
if (import.meta.main) {
  await main();
}