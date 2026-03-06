#!/usr/bin/env bun
import plugin from "bun-plugin-tailwind";

const result = await Bun.build({
  entrypoints: ["./src/cli.ts"],
  plugins: [plugin],
  compile: {
    outfile: "./cmux-hub",
  },
});

if (!result.success) {
  console.error("Build failed:");
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

console.log("Built: cmux-hub");
