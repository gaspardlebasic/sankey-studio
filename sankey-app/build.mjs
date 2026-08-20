import * as esbuild from "esbuild";
import { cpSync, mkdirSync } from "fs";

const watch = process.argv.includes("--watch");

mkdirSync("dist/renderer", { recursive: true });

const options = {
  entryPoints: ["src/renderer/index.ts"],
  bundle: true,
  outfile: "dist/renderer/bundle.js",
  platform: "browser",
  format: "iife",
  sourcemap: true,
  target: "es2019",
  logLevel: "info"
};

function copyStatic() {
  cpSync("src/renderer/index.html", "dist/renderer/index.html");
  cpSync("src/renderer/styles.css", "dist/renderer/styles.css");
  cpSync("src/renderer/fonts", "dist/renderer/fonts", { recursive: true });
}

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  copyStatic();
  console.log("esbuild: watching…");
} else {
  await esbuild.build(options);
  copyStatic();
  console.log("build terminé");
}
