-- ===============================================================
-- BWP Water Database Schema
-- ===============================================================

-- 1. Tabla de Usuarios (IT, Admin, Vendedores)
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE,
    role VARCHAR(50) NOT NULL CHECK (role IN ('it', 'admin', 'seller')),
    password_hash VARCHAR(255) NOT NULL,
    id_number VARCHAR(20) UNIQUE,
    temp_password VARCHAR(20),
    must_change_password BOOLEAN DEFAULT FALSE,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    zone VARCHAR(100),
    vehicle VARCHAR(50),
    current_correlative INTEGER DEFAULT 0,
    correlative_end INTEGER DEFAULT 0,
    current_stock INTEGER DEFAULT 0,
    permissions JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Tabla de Clientes
CREATE TABLE IF NOT EXISTS customers (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(20) NOT NULL CHECK (type IN ('individual', 'company')),
    rtn VARCHAR(50),
    phone VARCHAR(50),
    address TEXT,
    balance DECIMAL(10, 2) DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Tabla de Productos
CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    price DECIMAL(10, 2) NOT NULL,
    is_default BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. Tabla de Ventas
CREATE TABLE IF NOT EXISTS sales (
    id SERIAL PRIMARY KEY,
    seller_id INTEGER REFERENCES users(id),
    customer_id INTEGER REFERENCES customers(id),
    product_id INTEGER REFERENCES products(id),
    quantity INTEGER NOT NULL,
    unit_price DECIMAL(10, 2) NOT NULL,
    total_amount DECIMAL(10, 2) NOT NULL,
    payment_type VARCHAR(50) NOT NULL CHECK (payment_type IN ('cash', 'transfer', 'credit')),
    is_credit BOOLEAN DEFAULT FALSE,
    correlative INTEGER,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. Tabla de Despachos (Carga de camiones)
CREATE TABLE IF NOT EXISTS dispatches (
    id SERIAL PRIMARY KEY,
    seller_id INTEGER REFERENCES users(id),
    product_id INTEGER REFERENCES products(id),
    quantity INTEGER NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 6. Tabla de Cierres de Caja
CREATE TABLE IF NOT EXISTS closures (
    id SERIAL PRIMARY KEY,
    seller_id INTEGER REFERENCES users(id),
    total_sales DECIMAL(10, 2) NOT NULL,
    cash_denominations JSONB NOT NULL,
    credits_total DECIMAL(10, 2) DEFAULT 0,
    expenses_total DECIMAL(10, 2) DEFAULT 0,
    shortage DECIMAL(10, 2) DEFAULT 0,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 7. Tabla de Gastos
CREATE TABLE IF NOT EXISTS expenses (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    amount DECIMAL(10, 2) NOT NULL,
    description TEXT NOT NULL,
    receipt_number VARCHAR(100),
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 8. Tabla de Mantenimiento
CREATE TABLE IF NOT EXISTS maintenance (
    id SERIAL PRIMARY KEY,
    type VARCHAR(100) NOT NULL,
    description TEXT NOT NULL,
    date DATE NOT NULL,
    next_maintenance DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 9. Tabla de Inventario Global
CREATE TABLE IF NOT EXISTS inventory (
    id SERIAL PRIMARY KEY,
    plant_stock INTEGER DEFAULT 0,
    in_route INTEGER DEFAULT 0,
    sold INTEGER DEFAULT 0,
    returned INTEGER DEFAULT 0,
    in_process INTEGER DEFAULT 0,
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 10. Tabla de Logs (Auditoria)
CREATE TABLE IF NOT EXISTS logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    action TEXT NOT NULL,
    details JSONB,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ===============================================================
-- DATOS INICIALES
-- ===============================================================

INSERT INTO inventory (id, plant_stock, in_route, sold, returned, in_process)
VALUES (1, 1000, 0, 0, 0, 0)
ON CONFLICT (id) DO NOTHING;

INSERT INTO products (name, description, price, is_default)
VALUES ('Botellon de Agua', 'Agua purificada 5 galones', 40.00, TRUE)
ON CONFLICT DO NOTHING;

INSERT INTO users (name, email, role, password_hash, id_number, status)
VALUES ('IT Admin', 'it@bwpwater.com', 'it', 'placeholder', '000000', 'active')
ON CONFLICT (email) DO NOTHING;
