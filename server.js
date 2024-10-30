// Required modules
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const multer = require('multer');
const bcrypt = require('bcrypt');
require('dotenv').config();
const app = express();
const port = process.env.PORT || 5000; // Use dynamic port for Azure compatibility

// Allowed origins for CORS
const allowedOrigins = [
    'http://localhost:3000', // Local development frontend
    'http://localhost:3002', // Updated localhost port if needed
    'https://black-desert-0587dbd10.5.azurestaticapps.net' // Replace with your Azure Static Web App URL, no trailing slash
];

// CORS setup
app.use(cors({
    origin: function (origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true // Enable credentials if needed
}));

// Middleware for parsing JSON
app.use(express.json());
app.use(express.static('public')); // Allows access to the public folder for images

// ----- DATABASE CONNECTION ----------------------------------------------------------------------
const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});
db.getConnection()
    .then(() => console.log('Connected to the MySQL database'))
    .catch((err) => console.error('Error connecting to the database:', err));
// ------------------------------------------------------------------------------------------------

// ----- MULTER: IMAGE UPLOAD ---------------------------------------------------------------------
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'public/images');
    },
    filename: (req, file, cb) => {
        const safeFileName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
        cb(null, safeFileName);
    }
});
const upload = multer({ storage });
// ------------------------------------------------------------------------------------------------

// ----- HOME ROUTE -------------------------------------------------------------------------------
app.get('/', (req, res) => {
    res.send('Welcome to the Museum API Backend!');
});
// ------------------------------------------------------------------------------------------------

// ----- ASYNC HANDLER UTILITY --------------------------------------------------------------------
const asyncHandler = fn => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};
// ------------------------------------------------------------------------------------------------

// ----- API ENDPOINTS ----------------------------------------------------------------------------

// Query artwork table
app.get('/artwork', asyncHandler(async (req, res) => {
    const sql = 'SELECT * FROM artwork';
    const [result] = await db.query(sql);
    res.json(result);
}));

// Query departments table
app.get('/department', asyncHandler(async (req, res) => {
    const sql = 'SELECT * FROM department';
    const [result] = await db.query(sql);
    res.json(result);
}));

// Query artist table
app.get('/artist', asyncHandler(async (req, res) => {
    const sql = 'SELECT * FROM artist';
    const [result] = await db.query(sql);
    res.json(result);
}));

// User registration
app.post('/register', asyncHandler(async (req, res) => {
    const { firstName, lastName, dateOfBirth, username, password, email, roleId } = req.body;
    if (!firstName || !lastName || !dateOfBirth || !username || !password || !email) {
        return res.status(400).json({ message: 'All fields are required.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const assignedRoleId = roleId || 3; // Default to role ID 3 if not provided
    const sql = `
        INSERT INTO users (first_name, last_name, date_of_birth, username, password, email, role_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
    const values = [firstName, lastName, dateOfBirth, username, hashedPassword, email, assignedRoleId];
    await db.query(sql, values);
    res.status(201).json({ message: 'User registered successfully.' });
}));

// User login
app.post('/login', asyncHandler(async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ message: 'Username and password are required.' });
    }

    const [user] = await db.query(`
        SELECT users.*, roles.role_name
        FROM users
        JOIN roles ON users.role_id = roles.id
        WHERE users.username = ?
    `, [username]);

    if (user.length === 0) {
        return res.status(400).json({ message: 'Invalid username or password.' });
    }

    const passwordMatch = await bcrypt.compare(password, user[0].password);
    if (!passwordMatch) {
        return res.status(400).json({ message: 'Invalid username or password.' });
    }

    res.status(200).json({
        message: 'Login successful!',
        userId: user[0].user_id,
        role: user[0].role_name
    });
}));

// Middleware for role-based access control
function authenticateAdmin(req, res, next) {
    const { role } = req.headers;
    if (role === 'admin' || role === 'staff') {
        next();
    } else {
        res.status(403).json({ message: 'Access denied. Admins only.' });
    }
}

function authenticateUser(req, res, next) {
    const userId = req.headers['user-id'];
    const role = req.headers['role'];
    if (userId && role) {
        req.userId = userId;
        req.userRole = role;
        next();
    } else {
        res.status(401).json({ message: 'Unauthorized access.' });
    }
}

// ----- GIFT SHOP ITEMS ENDPOINTS -----
// Create item
app.post('/giftshopitems', upload.single('image'), asyncHandler(async (req, res) => {
    const { name_, category, price, quantity } = req.body;
    const imageBlob = req.file ? req.file.buffer : null;
    const sql = `INSERT INTO giftshopitem (name_, category, price, quantity, image) VALUES (?, ?, ?, ?, ?)`;
    const values = [name_, category, parseFloat(price), quantity, imageBlob];
    await db.query(sql, values);
    res.status(201).json({ message: 'Item created successfully' });
}));

// Get all gift shop items
app.get('/giftshopitems', asyncHandler(async (req, res) => {
    const [rows] = await db.query('SELECT item_id, name_, category, price, quantity FROM giftshopitem WHERE is_deleted = 0');
    res.json(rows);
}));

// Get image for a specific gift shop item
app.get('/giftshopitems/:id/image', asyncHandler(async (req, res) => {
    const { id } = req.params;
    const [rows] = await db.query('SELECT image FROM giftshopitem WHERE item_id = ?', [id]);
    if (rows.length === 0 || !rows[0].image) {
        return res.status(404).json({ message: 'Image not found.' });
    }

    res.set('Content-Type', 'image/jpeg'); // Adjust content type as needed
    res.send(rows[0].image);
}));

// Soft delete a gift shop item (Admin only)
app.put('/giftshopitems/:id/soft-delete', authenticateAdmin, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const sql = 'UPDATE giftshopitem SET is_deleted = 1 WHERE item_id = ?';
    await db.query(sql, [id]);
    res.status(200).json({ message: 'Gift shop item marked as deleted.' });
}));

// Restore a gift shop item (Admin only)
app.put('/giftshopitems/:id/restore', authenticateAdmin, asyncHandler(async (req, res) => {
    const { id } = req.params;
    const sql = 'UPDATE giftshopitem SET is_deleted = 0 WHERE item_id = ?';
    await db.query(sql, [id]);
    res.status(200).json({ message: 'Gift shop item restored successfully.' });
}));

// Start the server with error logging
app.listen(port, () => {
    console.log(`Server Running on http://localhost:${port}`);
});

// Global error handler for unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception thrown:', err);
});
