const { Pool } = require('pg');

const dbConfig = {
  host: 'localhost',
  port: 5432,
  database: 'produXdia',
  user: 'postgres',
  password: 'Nomiplus2014$%',
};

console.log('Probando con usuario postgres...');

const pool = new Pool(dbConfig);

async function testConnection() {
  try {
    const client = await pool.connect();
    console.log('✓ Conexión exitosa con postgres');

    // Verificar si el usuario produ existe
    const result = await client.query(`
      SELECT usename, usecreatedb, usesuper
      FROM pg_user
      WHERE usename = 'produ'
    `);

    if (result.rows.length > 0) {
      console.log('✓ Usuario produ existe:', result.rows[0]);
    } else {
      console.log('✗ Usuario produ NO existe');
    }

    client.release();
  } catch (error) {
    console.error('✗ Error:', error.message);
  } finally {
    await pool.end();
  }
}

testConnection();
