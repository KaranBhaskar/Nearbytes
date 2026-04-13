const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

function readEnvFile(filename) {
  const envPath = path.join(process.cwd(), filename);
  if (!fs.existsSync(envPath)) {
    return {};
  }

  return dotenv.parse(fs.readFileSync(envPath, "utf8"));
}

const env = {
  ...readEnvFile(".env"),
  ...readEnvFile(".env.local"),
  ...process.env,
};

if (String(env.CONVEX_URL || "").trim()) {
  const { startStaticServer } = require("./dev-static");
  startStaticServer();
} else {
  require("../server/index");
}
