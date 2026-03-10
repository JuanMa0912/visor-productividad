-- PASO 2: Ejecutar esto DESPUÉS en la base de datos 'produXdia'
-- (Cambiar la conexión a produXdia antes de ejecutar)

-- Dar permisos sobre el schema public
GRANT ALL PRIVILEGES ON SCHEMA public TO produ;

-- Dar permisos sobre todas las tablas existentes
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO produ;

-- Dar permisos sobre todas las secuencias
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO produ;

-- Dar permisos para futuras tablas
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO produ;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO produ;
