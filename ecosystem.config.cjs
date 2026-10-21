const path = require("path");

const root = __dirname;
const node = process.env.RWA_NODE || "node";

module.exports = {
  apps: [
    {
      name: "rwa-agent",
      cwd: root,
      script: "app.py",
      interpreter: path.join(root, ".venv/bin/python"),
      interpreter_args: "-u",
      env: { RWA_PORT: "8766" }
    },
    {
      name: "rwa-api",
      cwd: path.join(root, "server"),
      script: "src/index.js",
      interpreter: node,
      env: { PORT: "8780" }
    }
  ]
};
