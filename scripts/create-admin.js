const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");

const envPath = path.join(__dirname, "..", ".env.local");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf-8");
  envContent.split("\n").forEach((line) => {
    const [key, ...valueParts] = line.split("=");
    if (key && valueParts.length > 0 && !process.env[key.trim()]) {
      process.env[key.trim()] = valueParts.join("=").trim();
    }
  });
}

const dbPassword = process.env.DB_PASSWORD ?? "";
if (!dbPassword.trim()) {
  console.error("Define DB_PASSWORD en el entorno o en .env.local antes de ejecutar.");
  process.exit(1);
}

const dbConfig = {
  host: process.env.DB_HOST ?? "192.168.35.232",
  port: Number(process.env.DB_PORT ?? 5432),
  database: process.env.DB_NAME ?? "produXdia",
  user: process.env.DB_USER ?? "postgres",
  password: dbPassword,
};

async function run() {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;

  if (!username || !password) {
    console.error(
      "Define ADMIN_USERNAME y ADMIN_PASSWORD en el entorno antes de ejecutar.",
    );
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const pool = new Pool(dbConfig);
  try {
    const result = await pool.query(
      `
      INSERT INTO app_users (username, password_hash, role)
      VALUES ($1, $2, 'admin')
      ON CONFLICT (username) DO UPDATE
      SET password_hash = EXCLUDED.password_hash, role = 'admin'
      RETURNING id, username, role
      `,
      [username, passwordHash],
    );
    console.log("Admin listo:", result.rows[0]);
  } finally {
    await pool.end();
  }
}

run().catch((err) => {
  console.error("Error creando admin:", err);
  process.exit(1);
});
