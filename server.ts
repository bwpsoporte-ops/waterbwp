import express from "express";
import path from "path";
import cors from "cors";
import dotenv from "dotenv";
import pg from "pg";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import nodemailer from "nodemailer";
import fs from "fs";
import next from "next";

dotenv.config();

const { Pool } = pg;

const rawDbUrl = (process.env.DATABASE_URL || "").trim();
const dbUrl = rawDbUrl.replace(/^['"]|['"]$/g, "");

if (!dbUrl) {
  console.error("FATAL ERROR: DATABASE_URL environment variable is not set.");
  process.exit(1);
}

try {
  const urlObj = new URL(dbUrl);
  console.log(`Parsed database hostname: ${urlObj.hostname}`);
  if (urlObj.hostname === "base") {
    console.error("FATAL ERROR: DATABASE_URL hostname is 'base'. Please provide a valid PostgreSQL connection string.");
    process.exit(1);
  }
  if (!dbUrl.startsWith("postgresql://") && !dbUrl.startsWith("postgres://")) {
    console.error("FATAL ERROR: DATABASE_URL should start with 'postgresql://' or 'postgres://'.");
    process.exit(1);
  }
} catch (e) {
  console.error("FATAL ERROR: DATABASE_URL is not a valid URL.");
  process.exit(1);
}

// Check for other PG environment variables
if (process.env.PGHOST) console.log(`PGHOST is set to: ${process.env.PGHOST}`);
if (process.env.PGUSER) console.log(`PGUSER is set to: ${process.env.PGUSER}`);
if (process.env.PGDATABASE) console.log(`PGDATABASE is set to: ${process.env.PGDATABASE}`);

// Log connection info (masking password)
const maskedUrl = dbUrl.replace(/:([^:@]+)@/, ':****@');
console.log(`Connecting to database: ${maskedUrl}`);

const pool = new Pool({
  connectionString: dbUrl,
  ssl: {
    rejectUnauthorized: false
  }
});

const app = express();
const PORT = Number(process.env.PORT || 3000);
const isDev = process.env.NODE_ENV !== "production";
const nextApp = next({ dev: isDev, hostname: "0.0.0.0", port: PORT });
const handle = nextApp.getRequestHandler();

app.use(cors());
app.use(express.json());

app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, message: "Database connection failed", error: String(err) });
  }
});

// Database Initialization
async function initDb() {
  try {
    const schema = fs.readFileSync(path.join(process.cwd(), "schema.sql"), "utf8");
    await pool.query(schema);
    console.log("Database schema initialized.");

    // Ensure IT user exists with correct password
    const itEmail = "it@bwpwater.com";
    const itPassword = "1995951995b";
    const hashedPassword = await bcrypt.hash(itPassword, 10);
    
    await pool.query(`
      INSERT INTO users (name, email, role, password_hash, id_number, status)
      VALUES ('IT Admin', $1, 'it', $2, '000000', 'active')
      ON CONFLICT (email) DO UPDATE SET password_hash = $2
    `, [itEmail, hashedPassword]);
    
    console.log("IT user ensured.");
  } catch (err) {
    console.error("Error initializing database:", err);
  }
}

// --- Auth Middleware ---
const authenticateToken = (req: any, res: any, next: any) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.sendStatus(401);

  jwt.verify(token, process.env.JWT_SECRET || 'secret', (err: any, user: any) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

// --- API Routes ---

// Login
app.post("/api/auth/login", async (req, res) => {
  const { identifier, password } = req.body; 
  console.log(`Intento de login para: ${identifier}`);

  try {
    const result = await pool.query(
      "SELECT * FROM users WHERE email = $1 OR id_number = $1 OR (role = 'it' AND UPPER($1) = 'IT')",
      [identifier]
    );

    if (result.rows.length === 0) {
      console.log(`Usuario no encontrado: ${identifier}`);
      return res.status(401).json({ message: "Credenciales inválidas" });
    }

    const user = result.rows[0];
    console.log(`Usuario encontrado: ${user.email}, Rol: ${user.role}`);
    
    const validPassword = await bcrypt.compare(password, user.password_hash);

    if (!validPassword) {
      // Check for temporary password if it's a seller/admin
      if (user.temp_password === password && user.must_change_password) {
        // Allow login but force password change
        const token = jwt.sign(
          { id: user.id, role: user.role, mustChange: true },
          process.env.JWT_SECRET || 'secret',
          { expiresIn: '1h' }
        );
        return res.json({ token, user: { id: user.id, name: user.name, role: user.role, mustChange: true } });
      }
      return res.status(401).json({ message: "Credenciales inválidas" });
    }

    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '24h' }
    );

    res.json({ token, user: { id: user.id, name: user.name, role: user.role, email: user.email, id_number: user.id_number } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error del servidor" });
  }
});

// Change Password
app.post("/api/auth/change-password", authenticateToken, async (req: any, res) => {
  const { newPassword } = req.body;
  const userId = req.user.id;

  try {
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await pool.query(
      "UPDATE users SET password_hash = $1, temp_password = NULL, must_change_password = FALSE WHERE id = $2",
      [hashedPassword, userId]
    );
    res.json({ message: "Contraseña actualizada correctamente" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error al actualizar contraseña" });
  }
});

// Get Profile
app.get("/api/auth/profile", authenticateToken, async (req: any, res) => {
  try {
    const result = await pool.query("SELECT id, name, email, role, id_number, status, zone, vehicle, current_correlative, correlative_end, current_stock, permissions FROM users WHERE id = $1", [req.user.id]);
    if (result.rows.length === 0) return res.status(404).json({ message: "Usuario no encontrado" });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: "Error del servidor" });
  }
});

// --- Admin/IT Routes ---

// Get Users
app.get("/api/users", authenticateToken, async (req: any, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'it') return res.sendStatus(403);
  try {
    const result = await pool.query("SELECT id, name, email, role, id_number, status, zone, vehicle, current_correlative, correlative_end, current_stock FROM users ORDER BY created_at DESC");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: "Error del servidor" });
  }
});

// Create User (Admin/IT)
app.post("/api/users", authenticateToken, async (req: any, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'it') return res.sendStatus(403);
  const { name, email, role, zone, vehicle, correlativeStart, correlativeEnd } = req.body;

  try {
    // Generate 6-digit ID
    let idNumber;
    let isUnique = false;
    while (!isUnique) {
      idNumber = Math.floor(100000 + Math.random() * 900000).toString();
      const check = await pool.query("SELECT id FROM users WHERE id_number = $1", [idNumber]);
      if (check.rows.length === 0) isUnique = true;
    }

    // Generate 4-digit temp password
    const tempPassword = Math.floor(1000 + Math.random() * 9000).toString();
    const hashedPassword = await bcrypt.hash(tempPassword, 10);

    const result = await pool.query(
      `INSERT INTO users (name, email, role, password_hash, id_number, temp_password, must_change_password, zone, vehicle, current_correlative, correlative_end)
       VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7, $8, $9, $10) RETURNING id, id_number, temp_password`,
      [name, email, role, hashedPassword, idNumber, tempPassword, zone, vehicle, correlativeStart, correlativeEnd]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error al crear usuario" });
  }
});

// Reset Password
app.post("/api/users/:id/reset-password", authenticateToken, async (req: any, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'it') return res.sendStatus(403);
  const { id } = req.params;

  try {
    const tempPassword = Math.floor(1000 + Math.random() * 9000).toString();
    const hashedPassword = await bcrypt.hash(tempPassword, 10);
    await pool.query(
      "UPDATE users SET password_hash = $1, temp_password = $2, must_change_password = TRUE WHERE id = $3",
      [hashedPassword, tempPassword, id]
    );
    res.json({ tempPassword });
  } catch (err) {
    res.status(500).json({ message: "Error al resetear contraseña" });
  }
});

// --- Business Logic Routes ---

// Customers
app.get("/api/customers", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM customers ORDER BY name ASC");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: "Error del servidor" });
  }
});

app.post("/api/customers", authenticateToken, async (req, res) => {
  const { name, type, rtn, phone, address } = req.body;
  try {
    const result = await pool.query(
      "INSERT INTO customers (name, type, rtn, phone, address) VALUES ($1, $2, $3, $4, $5) RETURNING *",
      [name, type, rtn, phone, address]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: "Error al crear cliente" });
  }
});

// Products
app.get("/api/products", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM products ORDER BY name ASC");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: "Error del servidor" });
  }
});

app.post("/api/products", authenticateToken, async (req: any, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'it') return res.sendStatus(403);
  const { name, description, price } = req.body;
  try {
    const result = await pool.query(
      "INSERT INTO products (name, description, price) VALUES ($1, $2, $3) RETURNING *",
      [name, description, price]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: "Error al crear producto" });
  }
});

// Sales
app.get("/api/sales", authenticateToken, async (req: any, res) => {
  try {
    let query = `
      SELECT s.*, c.name as customer_name, u.name as seller_name, p.name as product_name 
      FROM sales s
      JOIN customers c ON s.customer_id = c.id
      JOIN users u ON s.seller_id = u.id
      JOIN products p ON s.product_id = p.id
    `;
    const params = [];
    if (req.user.role === 'seller') {
      query += " WHERE s.seller_id = $1";
      params.push(req.user.id);
    }
    query += " ORDER BY s.timestamp DESC";
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: "Error del servidor" });
  }
});

app.post("/api/sales", authenticateToken, async (req: any, res) => {
  const { customerId, productId, quantity, unitPrice, paymentType, isCredit, correlative } = req.body;
  const sellerId = req.user.id;

  try {
    await pool.query("BEGIN");

    const totalAmount = quantity * unitPrice;
    const result = await pool.query(
      `INSERT INTO sales (seller_id, customer_id, product_id, quantity, unit_price, total_amount, payment_type, is_credit, correlative)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [sellerId, customerId, productId, quantity, unitPrice, totalAmount, paymentType, isCredit, correlative]
    );

    // Update stock and correlative
    await pool.query("UPDATE users SET current_stock = current_stock - $1, current_correlative = $2 WHERE id = $3", [quantity, correlative, sellerId]);

    // If credit, update customer balance
    if (isCredit) {
      await pool.query("UPDATE customers SET balance = balance + $1 WHERE id = $2", [totalAmount, customerId]);
    }

    await pool.query("COMMIT");
    res.json(result.rows[0]);
  } catch (err) {
    await pool.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ message: "Error al registrar venta" });
  }
});

// Expenses
app.post("/api/expenses", authenticateToken, async (req: any, res) => {
  const { amount, description, receiptNumber } = req.body;
  try {
    const result = await pool.query(
      "INSERT INTO expenses (user_id, amount, description, receipt_number) VALUES ($1, $2, $3, $4) RETURNING *",
      [req.user.id, amount, description, receiptNumber]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: "Error al registrar gasto" });
  }
});

// Maintenance
app.get("/api/maintenance", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM maintenance ORDER BY date DESC");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: "Error del servidor" });
  }
});

app.post("/api/maintenance", authenticateToken, async (req: any, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'it') return res.sendStatus(403);
  const { type, description, date, nextMaintenance } = req.body;
  try {
    const result = await pool.query(
      "INSERT INTO maintenance (type, description, date, next_maintenance) VALUES ($1, $2, $3, $4) RETURNING *",
      [type, description, date, nextMaintenance]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: "Error al registrar mantenimiento" });
  }
});

// Inventory
app.get("/api/inventory", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM inventory WHERE id = 1");
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: "Error del servidor" });
  }
});

app.post("/api/inventory/adjust", authenticateToken, async (req: any, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'it') return res.sendStatus(403);
  const { type, quantity } = req.body;
  try {
    let query = "";
    if (type === 'production') {
      query = "UPDATE inventory SET plant_stock = plant_stock + $1, last_updated = CURRENT_TIMESTAMP WHERE id = 1";
    } else if (type === 'return') {
      query = "UPDATE inventory SET returned = returned + $1, in_process = in_process + $1, last_updated = CURRENT_TIMESTAMP WHERE id = 1";
    }
    await pool.query(query, [quantity]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: "Error al ajustar inventario" });
  }
});

// --- Server bootstrap ---
async function startServer() {
  await nextApp.prepare();

  try {
    await pool.query("SELECT 1");
    console.log("Database connection OK.");
  } catch (err) {
    console.error("FATAL ERROR: Could not connect to database.", err);
    process.exit(1);
  }

  await initDb();

  app.all(/.*/, (req, res) => handle(req, res));

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
