const path = require("path");

const root = __dirname;
const node = process.env.RWA_NODE || process.execPath;

function keep(app) {
  return Object.assign({
    autorestart: true,
    max_restarts: 100,
    exp_backoff_restart_delay: 1000,
    kill_timeout: 5000
  }, app);
}

module.exports = {
  apps: [
    keep({
      name: "rwa-agent",
      cwd: root,
      script: "app.py",
      interpreter: path.join(root, ".venv/bin/python"),
      interpreter_args: "-u",
      env: { RWA_PORT: "8766" }
    }),
    keep({
      name: "rwa-api",
      cwd: path.join(root, "server"),
      script: "src/index.js",
      interpreter: node,
      env: { PORT: "8780" }
    })
  ]
};
