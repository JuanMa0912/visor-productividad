// PM2 ecosystem para Visor de Productividad.
// LISTO PARA CONFIGURAR — no esta activo hasta que lo arranques con:
//   pm2 start deploy/ecosystem.config.js
//   pm2 save
//
// Por que importa: PM2 reinicia el proceso si CRASHEA o supera memoria, pero NO
// detecta "pegado-pero-vivo" (event loop u ozio del pool). Para eso esta el
// watchdog externo deploy/healthcheck.sh. Este ecosystem cubre el reinicio por
// crash/memoria; el watchdog cubre el "pegado".
//
// Ajusta `cwd`, `script`/`args` y `max_memory_restart` a tu host real.
module.exports = {
  apps: [
    {
      name: "visor-productividad",
      // Opcion A (build normal): npm run start  ->  next start
      script: "npm",
      args: "run start",
      // Opcion B (build standalone, recomendado en prod): comenta lo de arriba y usa:
      //   script: ".next/standalone/server.js",
      cwd: "/opt/visor-productividad",
      instances: 1,
      // IMPORTANTE: un solo proceso. El rate-limit y varias caches viven EN MEMORIA
      // del proceso (no son multi-replica); cluster duplicaria caches y romperia los
      // limites por IP. No subir a cluster sin migrar esos estados a un store comun.
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      // Reinicio por fuga de memoria. Ajusta a la RAM del host (deja margen al SO).
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
        // PORT: "3000",
        // --- Tunables del pool PostgreSQL (Fase 1+2). Defaults seguros ya estan en
        // codigo; descomenta solo si necesitas ajustar para tu DB ---
        // DB_POOL_MAX: "15",                 // revisar contra max_connections de la DB
        // DB_POOL_CONN_TIMEOUT_MS: "10000",  // espera maxima para obtener conexion
        // DB_POOL_IDLE_TIMEOUT_MS: "30000",
        // DB_POOL_MAX_LIFETIME_SEC: "1800",
        // DB_STATEMENT_TIMEOUT_MS: "800000", // techo de query (800s); 0 = off
        // DB_IDLE_TX_TIMEOUT_MS: "60000",
      },
    },
  ],
};
