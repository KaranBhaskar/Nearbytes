require("dotenv").config();
const app = require("./app");
const { seedIfEmpty } = require("./seed");

const PORT = Number(process.env.PORT || 3000);
const rawHost = process.env.HOST || "127.0.0.1";
const HOST = rawHost === "0.0.0.0" ? "127.0.0.1" : rawHost;

seedIfEmpty();

app.listen(PORT, HOST, () => {
  const displayHost = HOST === "127.0.0.1" ? "localhost" : HOST;
  // eslint-disable-next-line no-console
  console.log(`Server running on http://${displayHost}:${PORT}`);
});
