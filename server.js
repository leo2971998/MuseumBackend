const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const multer = require('multer');
const bcrypt = require('bcrypt');
require('dotenv').config();
const app = express();
const port = 5000; // Change to 6000 when you push to GitHub
const allowedOrigins = [
    'http://localhost:3000', // Local development frontend
    'http://localhost:3002', // Updated localhost port if needed
    'https://black-desert-0587dbd10.5.azurestaticapps.net/' // Replace with your Azure Static Web App URL
];

app.use(cors({
    origin: function (origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true // Enables credentials if you plan on using them
}));

app.use(express.json());
app.use(express.static('public')); // Allows access to the public folder for images

// ----- DATABASE CONNECTION ----------------------------------------------------------------------
const db = mysql.createPool({ // We can add the env file later so this data is not exposed
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
    }, filename: (req, file, cb) => {
        const safeFileName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
        cb(null, safeFileName);
    }
});
//const upload = multer({ storage });
// ------------------------------------------------------------------------------------------------

// ----- API CALLS --------------------------------------------------------------------------------

// ----- (MELANIE) --------------------------------------------------------------------------------

// Query artwork table
app.get('/artwork', (req, res) => {
    const sql = 'SELECT * FROM artwork';
    db.query(sql, (err, result) => {
        if (err) return res.json({message: "Error fetching artwork table"});
        return res.json(result);
    });
});

// Query departments table
app.get('/department', (req, res) => {
    const sql = 'SELECT * FROM department';
    db.query(sql, (err, result) => {
        if (err) return res.json({message: "Error fetching department table"});
        return res.json(result);
    });
});

// Query artist table
app.get('/artist', (req, res) => {
    const sql = 'SELECT * FROM artist';
    db.query(sql, (err, result) => {
        if (err) return res.json({message: "Error fetching artist table"});
        return res.json(result);
    });
});

// ----- (MELANIE DONE) ---------------------------------------------------------------------------

// ----- (LEO) ------------------------------------------------------------------------------------

// User registration
app.post('/register', async (req, res) => {
    const {firstName, lastName, dateOfBirth, username, password, email, roleId} = req.body;

    const newErrors = {};
    if (!firstName) newErrors.firstName = 'First name is required';
    if (!lastName) newErrors.lastName = 'Last name is required';
    if (!dateOfBirth) newErrors.dateOfBirth = 'Date of birth is required';
    if (!username) newErrors.username = 'Username is required';
    if (!password) newErrors.password = 'Password is required';
    if (!email) newErrors.email = 'Email is required';

    if (Object.keys(newErrors).length > 0) {
        return res.status(400).json({message: 'Validation error', errors: newErrors});
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const assignedRoleId = roleId || 3; // Default to role ID 3 if not provided
        const sql = `
            INSERT INTO users (first_name, last_name, date_of_birth, username, password, email, role_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `;
        const values = [firstName, lastName, dateOfBirth, username, hashedPassword, email, assignedRoleId];

        await db.query(sql, values);
        res.status(201).json({message: 'User registered successfully.'});
    } catch (error) {
        console.error('Error during registration:', error);
        res.status(500).json({message: 'Server error during registration.'});
    }
});

// User login
app.post('/login', async (req, res) => {
    const {username, password} = req.body;

    if (!username || !password) {
        return res.status(400).json({message: 'Username and password are required.'});
    }

    try {
        const [user] = await db.query(`
            SELECT users.*, roles.role_name
            FROM users
                     JOIN roles ON users.role_id = roles.id
            WHERE users.username = ?`, [username]);

        if (user.length === 0) {
            return res.status(400).json({message: 'Invalid username or password.'});
        }

        const passwordMatch = await bcrypt.compare(password, user[0].password);
        if (!passwordMatch) {
            return res.status(400).json({message: 'Invalid username or password.'});
        }

        res.status(200).json({
            message: 'Login successful!', userId: user[0].user_id, role: user[0].role_name, username: user[0].username, // Include username in response if needed
        });
    } catch (error) {
        console.error('Server error during login:', error);
        res.status(500).json({message: 'Server error.'});
    }
});

// ----- AUTHENTICATION MIDDLEWARE -----
function authenticateAdmin(req, res, next) {
    const {role} = req.headers;
    if (role === 'admin' || role === 'staff') {
        next();
    } else {
        res.status(403).json({message: 'Access denied. Admins only.'});
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
        res.status(401).json({message: 'Unauthorized access.'});
    }
}

// ----- MULTER CONFIGURATION -----
const upload = multer({storage: multer.memoryStorage()});

// ----- USER REGISTRATION -----
app.post('/register', async (req, res) => {
    const {firstName, lastName, dateOfBirth, username, password, email} = req.body;

    // Validation (simplified for brevity)
    if (!firstName || !lastName || !dateOfBirth || !username || !password || !email) {
        return res.status(400).json({message: 'All fields are required.'});
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const sql = `
            INSERT INTO users (first_name, last_name, date_of_birth, username, password, email, role_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `;
        const values = [firstName, lastName, dateOfBirth, username, hashedPassword, email, 2]; // Default role_id 2 (Customer)

        await db.query(sql, values);
        res.status(201).json({message: 'User registered successfully.'});
    } catch (error) {
        console.error('Error during registration:', error);
        res.status(500).json({message: 'Server error during registration.'});
    }
});

// ----- USER LOGIN -----
app.post('/login', async (req, res) => {
    const {username, password} = req.body;

    try {
        const [user] = await db.query(`
            SELECT users.*, roles.role_name
            FROM users
                     JOIN roles ON users.role_id = roles.id
            WHERE users.username = ?`, [username]);

        if (user.length === 0) {
            return res.status(400).json({message: 'Invalid username or password.'});
        }

        const passwordMatch = await bcrypt.compare(password, user[0].password);
        if (!passwordMatch) {
            return res.status(400).json({message: 'Invalid username or password.'});
        }

        res.status(200).json({
            message: 'Login successful!', userId: user[0].user_id, role: user[0].role_name,
        });
    } catch (error) {
        console.error('Server error during login:', error);
        res.status(500).json({message: 'Server error.'});
    }
});

// ----- GIFT SHOP ITEMS ENDPOINTS -----

// Create item API
app.post('/giftshopitems', upload.single('image'), async (req, res) => {
    const {name_, category, price, quantity} = req.body;
    const imageBlob = req.file ? req.file.buffer : null;

    try {
        const sql = `
            INSERT INTO giftshopitem (name_, category, price, quantity, image)
            VALUES (?, ?, ?, ?, ?)
        `;
        const values = [name_, category, parseFloat(price), quantity, imageBlob];

        await db.query(sql, values);
        res.status(201).json({message: 'Item created successfully'});
    } catch (error) {
        console.error('Error creating gift shop item:', error);
        res.status(500).json({error: 'Failed to create gift shop item'});
    }
});
// Get all gift shop items
app.get('/giftshopitems', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT item_id, name_, category, price, quantity, is_deleted FROM giftshopitem where is_deleted = 0');
        res.json(rows);
    } catch (error) {
        console.error('Error fetching gift shop items:', error);
        res.status(500).json({message: 'Server error fetching gift shop items.'});
    }
});
// Get all gift shop items (Admin only)
app.get('/giftshopitemsall', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT item_id, name_, category, price, quantity, is_deleted FROM giftshopitem');
        res.json(rows);
    } catch (error) {
        console.error('Error fetching gift shop items:', error);
        res.status(500).json({message: 'Server error fetching gift shop items.'});
    }
});
// Get image for a specific gift shop item
app.get('/giftshopitems/:id/image', async (req, res) => {
    const {id} = req.params;

    try {
        const [rows] = await db.query('SELECT image FROM giftshopitem WHERE item_id = ?', [id]);
        if (rows.length === 0 || !rows[0].image) {
            return res.status(404).json({message: 'Image not found.'});
        }

        res.set('Content-Type', 'image/jpeg'); // Adjust content type as needed
        res.send(rows[0].image);
    } catch (error) {
        console.error('Error fetching image:', error);
        res.status(500).json({message: 'Server error fetching image.'});
    }
});

// Update item API in server.js
app.put('/giftshopitems/:id', upload.single('image'), async (req, res) => {
    const {id} = req.params;
    const {name_, category, price, quantity} = req.body;
    const imageBlob = req.file ? req.file.buffer : null;

    try {
        const sql = `
            UPDATE giftshopitem
            SET name_    = ?,
                category = ?,
                price    = ?,
                quantity = ?,
                image    = ?
            WHERE item_id = ?
              AND is_deleted = 0
        `;
        const values = [name_, category, parseFloat(price), quantity, imageBlob, id];

        const [result] = await db.query(sql, values);
        if (result.affectedRows === 0) {
            return res.status(404).json({message: 'Item not found or already deleted.'});
        }
        res.status(200).json({message: 'Item updated successfully'});
    } catch (error) {
        console.error('Error updating gift shop item:', error);
        res.status(500).json({error: 'Failed to update gift shop item'});
    }
});

// Delete a gift shop item (Admin only)
app.delete('/giftshopitems/:id/hard-delete', authenticateAdmin, async (req, res) => {
    const { id } = req.params;

    try {
        const sql = 'DELETE FROM giftshopitem WHERE item_id = ?';
        const [result] = await db.query(sql, [id]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Item not found or already deleted.' });
        }

        res.status(200).json({ message: 'Gift shop item permanently deleted.' });
    } catch (error) {
        console.error('Error hard deleting gift shop item:', error);
        res.status(500).json({ message: 'Server error during hard delete.' });
    }
});
// Soft delete a gift shop item (Admin only)
app.put('/giftshopitems/:id/soft-delete', authenticateAdmin, async (req, res) => {
    const {id} = req.params;

    try {
        const sql = 'UPDATE giftshopitem SET is_deleted = 1 WHERE item_id = ?';
        await db.query(sql, [id]);
        res.status(200).json({message: 'Gift shop item marked as deleted.'});
    } catch (error) {
        console.error('Error soft deleting gift shop item:', error);
        res.status(500).json({message: 'Server error soft deleting gift shop item.'});
    }
});
// Restore a gift shop item (Admin only)
app.put('/giftshopitems/:id/restore', authenticateAdmin, async (req, res) => {
    const {id} = req.params;

    try {
        const sql = 'UPDATE giftshopitem SET is_deleted = 0 WHERE item_id = ?';
        await db.query(sql, [id]);
        res.status(200).json({message: 'Gift shop item restored successfully.'});
    } catch (error) {
        console.error('Error restoring gift shop item:', error);
        res.status(500).json({message: 'Server error restoring gift shop item.'});
    }
});

// Get user profile
app.get('/users/:id', authenticateUser, async (req, res) => {
    const {id} = req.params;

    // Ensure the user can only access their own profile
    if (req.userId !== id && req.userRole !== 'admin') {
        return res.status(403).json({message: 'Access denied.'});
    }

    try {
        const [rows] = await db.query(`
            SELECT first_name AS firstName, last_name AS lastName, date_of_birth AS dateOfBirth, username, email
            FROM users
            WHERE user_id = ?
        `, [id]);

        if (rows.length === 0) {
            return res.status(404).json({message: 'User not found.'});
        }

        res.json(rows[0]);
    } catch (error) {
        console.error('Error fetching user data:', error);
        res.status(500).json({message: 'Server error fetching user data.'});
    }
});

// Update user profile
app.put('/users/:id', authenticateUser, async (req, res) => {
    const {id} = req.params;
    const {firstName, lastName, dateOfBirth, email} = req.body;

    // Ensure the user can only update their own profile
    if (req.userId !== id && req.userRole !== 'admin') {
        return res.status(403).json({message: 'Access denied.'});
    }

    try {
        const sql = `
            UPDATE users
            SET first_name    = ?,
                last_name     = ?,
                date_of_birth = ?,
                email         = ?
            WHERE user_id = ?
        `;
        const values = [firstName, lastName, dateOfBirth, email, id];

        await db.query(sql, values);
        res.status(200).json({message: 'Profile updated successfully.'});
    } catch (error) {
        console.error('Error updating user profile:', error);
        res.status(500).json({message: 'Server error updating user profile.'});
    }
});
// Update item API


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
