const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const multer = require('multer');
const bcrypt = require('bcrypt');
require('dotenv').config();

const app = express();

// Use the PORT environment variable set by Azure, or default to 5000
const port = process.env.PORT || 5000;

// CORS settings - replace with your actual frontend URL once deployed
app.use(cors({
    origin: 'https://black-desert-0587dbd10.5.azurestaticapps.net' // Your frontend URL
}));

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
const upload = multer({ storage: multer.memoryStorage() });
// ------------------------------------------------------------------------------------------------

// ----- ROOT ROUTE -------------------------------------------------------------------------------
// Handle the root URL to avoid "Cannot GET /" error
app.get('/', (req, res) => {
    res.send("Welcome to the Museum API Backend!");
});
// ------------------------------------------------------------------------------------------------

// ----- API CALLS --------------------------------------------------------------------------------

// ----- (MELANIE) --------------------------------------------------------------------------------

// Query artwork table
app.get('/artwork', async (req, res) => {
    try {
        const [result] = await db.query('SELECT * FROM artwork');
        res.json(result);
    } catch (error) {
        res.status(500).json({ message: "Error fetching artwork table", error });
    }
});

// Query departments table
app.get('/department', async (req, res) => {
    try {
        const [result] = await db.query('SELECT * FROM department');
        res.json(result);
    } catch (error) {
        res.status(500).json({ message: "Error fetching department table", error });
    }
});

// Query artist table
app.get('/artist', async (req, res) => {
    try {
        const [result] = await db.query('SELECT * FROM artist');
        res.json(result);
    } catch (error) {
        res.status(500).json({ message: "Error fetching artist table", error });
    }
});

// ----- (MELANIE DONE) ---------------------------------------------------------------------------

// ----- (LEO) ------------------------------------------------------------------------------------

// User registration
app.post('/register', async (req, res) => {
    const { firstName, lastName, dateOfBirth, username, password, email, roleId } = req.body;

    if (!firstName || !lastName || !dateOfBirth || !username || !password || !email) {
        return res.status(400).json({ message: 'All fields are required.' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const sql = `
            INSERT INTO users (first_name, last_name, date_of_birth, username, password, email, role_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `;
        const values = [firstName, lastName, dateOfBirth, username, hashedPassword, email, roleId || 3];

        await db.query(sql, values);
        res.status(201).json({ message: 'User registered successfully.' });
    } catch (error) {
        res.status(500).json({ message: 'Server error during registration.', error });
    }
});

// User login
app.post('/login', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ message: 'Username and password are required.' });
    }

    try {
        const [user] = await db.query(`
            SELECT users.*, roles.role_name
            FROM users
            JOIN roles ON users.role_id = roles.id
            WHERE users.username = ?`, [username]);

        if (user.length === 0 || !(await bcrypt.compare(password, user[0].password))) {
            return res.status(400).json({ message: 'Invalid username or password.' });
        }

        res.status(200).json({
            message: 'Login successful!',
            userId: user[0].id,
            role: user[0].role_name,
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error during login.', error });
    }
});

// ----- GIFT SHOP ITEMS ENDPOINTS ----------------------------------------------------------------
app.post('/giftshopitems', upload.single('image'), async (req, res) => {
    const { name_, category, price, quantity } = req.body;
    const imageBlob = req.file ? req.file.buffer : null;

    try {
        const sql = `
            INSERT INTO giftshopitem (name_, category, price, quantity, image)
            VALUES (?, ?, ?, ?, ?)
        `;
        const values = [name_, category, parseFloat(price), quantity, imageBlob];

        await db.query(sql, values);
        res.status(201).json({ message: 'Item created successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Failed to create gift shop item', error });
    }
});

app.get('/giftshopitems', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT item_id, name_, category, price, quantity FROM giftshopitem');
        res.json(rows);
    } catch (error) {
        res.status(500).json({ message: 'Server error fetching gift shop items.', error });
    }
});

app.get('/giftshopitems/:id/image', async (req, res) => {
    const { id } = req.params;

    try {
        const [rows] = await db.query('SELECT image FROM giftshopitem WHERE item_id = ?', [id]);
        if (rows.length === 0 || !rows[0].image) {
            return res.status(404).json({ message: 'Image not found.' });
        }

        res.set('Content-Type', 'image/jpeg'); // Adjust content type as needed
        res.send(rows[0].image);
    } catch (error) {
        res.status(500).json({ message: 'Server error fetching image.', error });
    }
});

app.put('/giftshopitems/:id', upload.single('image'), async (req, res) => {
    const { id } = req.params;
    const { name_, category, price, quantity } = req.body;
    const imageBlob = req.file ? req.file.buffer : null;

    try {
        const sql = `
            UPDATE giftshopitem
            SET name_ = ?, category = ?, price = ?, quantity = ?, image = ?
            WHERE item_id = ?
        `;
        const values = [name_, category, parseFloat(price), quantity, imageBlob, id];

        await db.query(sql, values);
        res.status(200).json({ message: 'Item updated successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Failed to update gift shop item', error });
    }
});

app.delete('/giftshopitems/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const sql = 'DELETE FROM giftshopitem WHERE item_id = ?';
        await db.query(sql, [id]);
        res.status(200).json({ message: 'Gift shop item deleted successfully.' });
    } catch (error) {
        res.status(500).json({ message: 'Server error deleting gift shop item.', error });
    }
});
// ----- (LEO DONE) --------------------------------------------------------------------------------

// ----- (MUNA) ------------------------------------------------------------------------------------

// ----- (MUNA DONE) ------------------------------------------------------------------------------

// ----- (TYLER) ----------------------------------------------------------------------------------

// ----- (TYLER DONE) -----------------------------------------------------------------------------

// ----- (DENNIS) ---------------------------------------------------------------------------------

// ----- (DENNIS DONE) ----------------------------------------------------------------------------
// Start the server
app.listen(port, () => {
    console.log(`Server Running on http://localhost:${port}`);
});
