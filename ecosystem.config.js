module.exports = {
  apps: [{
    name: 'nextmile-services',
    script: 'npm',
    args: 'start',
    cwd: '/var/www/nextmile-services',
    env: {
      NODE_ENV: 'production',
      PORT: 3001,
    },
    restart_delay: 5000,
    max_restarts: 10,
    watch: false,
  }],
}
