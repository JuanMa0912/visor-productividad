    -- PASO 1: Ejecutar esto en pgAdmin conectado a la base de datos 'postgres'
    -- Crear el usuario con contraseña
    CREATE USER produ WITH PASSWORD 'produ';

    -- Dar permisos sobre la base de datos
    GRANT ALL PRIVILEGES ON DATABASE "produXdia" TO produ;
