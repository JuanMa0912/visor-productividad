// PM2 ecosystem para Visor de Productividad.
// Calzado al entorno real: usuario prodapp, repo en /home/prodapp/visor-productividad,
// arranque `npm start -- -p 5600` (next start en puerto 5600), modo fork.
//
// Por que importa: PM2 reinicia el proceso si CRASHEA o supera memoria, pero NO
// detecta "pegado-pero-vivo" (event loop u ocio del pool). Para eso esta el
// watchdog externo deploy/healthcheck.sh. Este ecosystem agrega max_memory_restart
// (reinicio por fuga de memoria) al proceso que hoy ya corre sin ecosystem.
//
// OPCIONAL: tu PM2 ya funciona sin este archivo. Solo aporta max_memory_restart.
// Si lo querés adoptar, primero borra el proceso actual para no duplicarlo:
//   pm2 delete visor-productividad
//   pm2 start /home/prodapp/visor-productividad/deploy/ecosystem.config.js
//   pm2 save
module.exports = {
  apps: [
    {
      name: "visor-productividad",
      script: "npm",
      // npm start -> next start; "-- -p 5600" fija el puerto (igual que hoy).
      args: "start -- -p 5600",
      cwd: "/home/prodapp/visor-productividad",
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
        // El puerto se fija via args (-p 5600). Las credenciales DB se leen de
        // .env.local en el cwd (no hace falta declararlas aqui).
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
