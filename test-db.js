const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");

const envPath = path.join(__dirname, ".env.local");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf-8");
  envContent.split("\n").forEach((line) => {
    const [key, ...valueParts] = line.split("=");
    if (key && valueParts.length > 0 && !process.env[key.trim()]) {
      process.env[key.trim()] = valueParts.join("=").trim();
    }
  });
}

const password = process.env.DB_PASSWORD ?? "";
if (!password.trim()) {
  console.error("Define DB_PASSWORD en el entorno o en .env.local antes de ejecutar.");
  process.exit(1);
}

const dbConfig = {
  host: process.env.DB_HOST ?? "localhost",
  port: Number(process.env.DB_PORT ?? 5432),
  database: process.env.DB_NAME ?? "produXdia",
  user: process.env.DB_USER ?? "produ",
  password,
};

console.log("Configuracion de DB:", {
  ...dbConfig,
  password: "***",
});

const pool = new Pool(dbConfig);

async function testConnection() {
  try {
    console.log("\n1. Probando conexion basica...");
    const client = await pool.connect();
    console.log("Conexion establecida");

    console.log("\n2. Ejecutando SELECT 1...");
    const result = await client.query("SELECT 1 as test");
    console.log("Query ejecutado:", result.rows);

    console.log("\n3. Listando tablas...");
    const tables = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);
    console.log("Tablas encontradas:", tables.rows.map((row) => row.table_name));

    console.log("\n4. Probando tabla ventas_cajas...");
    try {
      const sales = await client.query("SELECT COUNT(*) as count FROM ventas_cajas");
      console.log("Registros en ventas_cajas:", sales.rows[0].count);
    } catch (err) {
      console.log("Error con ventas_cajas:", err.message);
    }

    client.release();
    console.log("\nTodas las pruebas completadas");
  } catch (error) {
    console.error("\nError:", error.message);
  } finally {
    await pool.end();
  }
}

testConnection();
