const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

const ROOT_DIR = process.cwd();
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const DIST_DIR = path.join(ROOT_DIR, "dist");

function readEnvFile(filename) {
  const envPath = path.join(ROOT_DIR, filename);
  if (!fs.existsSync(envPath)) {
    return {};
  }

  return dotenv.parse(fs.readFileSync(envPath, "utf8"));
}

function getBuildConfig() {
  const env = {
    ...readEnvFile(".env"),
    ...readEnvFile(".env.local"),
    ...process.env,
  };

  return {
    convexUrl: String(env.CONVEX_URL || "").trim(),
    appMode: String(env.CONVEX_URL || "").trim() ? "convex" : "local",
    clientOrigin: String(env.CLIENT_ORIGIN || "").trim(),
  };
}

function ensureCleanDir(directory) {
  fs.rmSync(directory, { recursive: true, force: true });
  fs.mkdirSync(directory, { recursive: true });
}

function copyPublicToDist() {
  fs.cpSync(PUBLIC_DIR, DIST_DIR, {
    recursive: true,
    force: true,
    filter(source) {
      return path.basename(source) !== "runtime-config.js";
    },
  });
}

function writeRuntimeConfig() {
  const targetPath = path.join(DIST_DIR, "runtime-config.js");
  const content = `window.__APP_CONFIG__ = Object.freeze(${JSON.stringify(
    getBuildConfig(),
    null,
    2,
  )});\n`;
  fs.writeFileSync(targetPath, content, "utf8");
}

function main() {
  ensureCleanDir(DIST_DIR);
  copyPublicToDist();
  writeRuntimeConfig();
  // eslint-disable-next-line no-console
  console.log("Static build ready in dist/");
}

main();
