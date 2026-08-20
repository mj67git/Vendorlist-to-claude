module.exports = {
  apps: [
    {
      name: "pharma-regulatory-app",
      script: "dist/server.cjs",
      env: {
        NODE_ENV: "production",
        PORT: 3000
      },
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "1G"
    }
  ]
};
