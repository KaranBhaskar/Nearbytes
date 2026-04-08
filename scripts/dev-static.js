const http = require("http");
const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

const PUBLIC_DIR = path.join(process.cwd(), "public");
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
};

function readEnvFile(filename) {
  const envPath = path.join(process.cwd(), filename);
  if (!fs.existsSync(envPath)) {
    return {};
  }

  return dotenv.parse(fs.readFileSync(envPath, "utf8"));
}

function getRuntimeConfig() {
  const env = {
    ...readEnvFile(".env"),
    ...readEnvFile(".env.local"),
  };

  return {
    convexUrl: String(env.CONVEX_URL || "").trim(),
    appMode: String(env.CONVEX_URL || "").trim() ? "convex" : "local",
  };
}

function resolvePath(urlPath) {
  const requestedPath = decodeURIComponent(urlPath.split("?")[0]);
  const normalized = requestedPath === "/" ? "/index.html" : requestedPath;
  const absolutePath = path.normalize(path.join(PUBLIC_DIR, normalized));

  if (!absolutePath.startsWith(PUBLIC_DIR)) {
    return null;
  }

  return absolutePath;
}

function createServer() {
  return http.createServer((req, res) => {
    const requestPath = decodeURIComponent((req.url || "/").split("?")[0]);

    if (requestPath === "/runtime-config.js") {
      const content = `window.__APP_CONFIG__ = Object.freeze(${JSON.stringify(
        getRuntimeConfig(),
        null,
        2,
      )});\n`;

      res.writeHead(200, {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(content);
      return;
    }

    const absolutePath = resolvePath(req.url || "/");

    if (!absolutePath) {
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Forbidden");
      return;
    }

    fs.readFile(absolutePath, (err, fileBuffer) => {
      if (err) {
        if (err.code === "ENOENT") {
          res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Not found");
          return;
        }

        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Server error");
        return;
      }

      const ext = path.extname(absolutePath).toLowerCase();
      res.writeHead(200, {
        "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
        "Cache-Control": "no-store",
      });
      res.end(fileBuffer);
    });
  });
}

function startStaticServer() {
  const server = createServer();
  server.listen(PORT, HOST, () => {
    // eslint-disable-next-line no-console
    console.log(`Static app running on http://${HOST}:${PORT}`);
  });
  return server;
}

if (require.main === module) {
  startStaticServer();
}

module.exports = { startStaticServer };
