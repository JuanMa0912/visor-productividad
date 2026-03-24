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
  user: process.env.DB_USER ?? "postgres",
  password,
};

console.log("Probando conexion con usuario configurado...");

const pool = new Pool(dbConfig);

async function testConnection() {
  try {
    const client = await pool.connect();
    console.log("Conexion exitosa con PostgreSQL");

    const result = await client.query(`
      SELECT usename, usecreatedb, usesuper
      FROM pg_user
      WHERE usename = 'produ'
    `);

    if (result.rows.length > 0) {
      console.log("Usuario produ existe:", result.rows[0]);
    } else {
      console.log("Usuario produ no existe");
    }

    client.release();
  } catch (error) {
    console.error("Error:", error.message);
  } finally {
    await pool.end();
  }
}

testConnection();
