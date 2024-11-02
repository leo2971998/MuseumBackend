// server.js

const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const multer = require('multer');
const bcrypt = require('bcrypt');
const nodemailer = require('nodemailer');
require('dotenv').config();
const app = express();

// ----- CORS CONFIGURATION --------------------------------------------------------------------------
const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:3002',
    'https://black-desert-0587dbd10.5.azurestaticapps.net',
];

app.use(
    cors({
        origin: function (origin, callback) {
            if (!origin) return callback(null, true); // Allow requests with no origin (like mobile apps, curl)
            if (allowedOrigins.includes(origin)) {
                return callback(null, true);
            } else {
                return callback(
                    new Error('CORS policy does not allow access from the specified Origin.'),
                    false
                );
            }
        },
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE'],
        allowedHeaders: ['Content-Type', 'Authorization', 'role', 'user-id'],
    })
);

// Express middlewares
app.use(express.json());

// ----- DATABASE CONNECTION ------------------------------------------------------------------------
const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
};

const db = mysql.createPool(dbConfig);

db.getConnection()
    .then(() => console.log('Connected to the MySQL database'))
    .catch((err) => console.error('Error connecting to the database:', err));
// --------------------------------------------------------------------------------------------------

// ----- MULTER: IMAGE UPLOAD -----------------------------------------------------------------------
const upload = multer({ storage: multer.memoryStorage() });
// --------------------------------------------------------------------------------------------------

// ----- EMAIL CONFIGURATION ------------------------------------------------------------------------
const emailConfig = {
    smtp: {
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS,
        },
    },
    from: {
        name: 'Museum Gift Shop',
        address: process.env.EMAIL_USER,
    },
};
// --------------------------------------------------------------------------------------------------

// ----- AUTHENTICATION MIDDLEWARE ------------------------------------------------------------------
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
// --------------------------------------------------------------------------------------------------

// ----- API ENDPOINTS ------------------------------------------------------------------------------

// ----- (MELANIE) ----------------------------------------------------------------------------------

// Query artwork table
app.get('/artwork', async (req, res) => {
    try {
        const [result] = await db.query('SELECT * FROM artwork');
        res.json(result);
    } catch (err) {
        res.status(500).json({ message: 'Error fetching artwork table' });
    }
});

// Query departments table
app.get('/department', async (req, res) => {
    try {
        const [result] = await db.query('SELECT * FROM department');
        res.json(result);
    } catch (err) {
        res.status(500).json({ message: 'Error fetching department table' });
    }
});

// Query artist table
app.get('/artist', async (req, res) => {
    try {
        const [result] = await db.query('SELECT * FROM artist');
        res.json(result);
    } catch (err) {
        res.status(500).json({ message: 'Error fetching artist table' });
    }
});

// ----- (MELANIE DONE) -----------------------------------------------------------------------------


// ----- (LEO) --------------------------------------------------------------------------------------

// User registration
app.post('/register', async (req, res) => {
    const { firstName, lastName, dateOfBirth, username, password, email, roleId } = req.body;

    const newErrors = {};
    if (!firstName) newErrors.firstName = 'First name is required';
    if (!lastName) newErrors.lastName = 'Last name is required';
    if (!dateOfBirth) newErrors.dateOfBirth = 'Date of birth is required';
    if (!username) newErrors.username = 'Username is required';
    if (!password) newErrors.password = 'Password is required';
    if (!email) newErrors.email = 'Email is required';

    if (Object.keys(newErrors).length > 0) {
        return res.status(400).json({ message: 'Validation error', errors: newErrors });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const assignedRoleId = roleId || 3; // Default to role ID 3 if not provided
        const sql = `
      INSERT INTO users (first_name, last_name, date_of_birth, username, password, email, role_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
        const values = [
            firstName,
            lastName,
            dateOfBirth,
            username,
            hashedPassword,
            email,
            assignedRoleId,
        ];

        await db.query(sql, values);
        res.status(201).json({ message: 'User registered successfully.' });
    } catch (error) {
        console.error('Error during registration:', error);
        res.status(500).json({ message: 'Server error during registration.' });
    }
});

// User login
app.post('/login', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ message: 'Username and password are required.' });
    }

    try {
        const [user] = await db.query(
            `
        SELECT users.*, roles.role_name
        FROM users
        JOIN roles ON users.role_id = roles.id
        WHERE users.username = ?
      `,
            [username]
        );

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
            role: user[0].role_name,
            username: user[0].username,
        });
    } catch (error) {
        console.error('Server error during login:', error);
        res.status(500).json({ message: 'Server error.' });
    }
});

// ----- GIFT SHOP ITEMS ENDPOINTS -----

// Create item API
app.post('/giftshopitems', upload.single('image'), async (req, res) => {
    const { name_, category, price, quantity } = req.body;
    const imageBuffer = req.file ? req.file.buffer : null;
    const imageType = req.file ? req.file.mimetype : null;

    try {
        const sql = `
      INSERT INTO giftshopitem (name_, category, price, quantity, image, image_type)
      VALUES (?, ?, ?, ?, ?, ?)
    `;
        const values = [name_, category, parseFloat(price), quantity, imageBuffer, imageType];

        await db.query(sql, values);
        res.status(201).json({ message: 'Item created successfully' });
    } catch (error) {
        console.error('Error creating gift shop item:', error);
        res.status(500).json({ error: 'Failed to create gift shop item' });
    }
});

// Update item API
app.put('/giftshopitems/:id', upload.single('image'), async (req, res) => {
    const { id } = req.params;
    const { name_, category, price, quantity } = req.body;
    const imageBuffer = req.file ? req.file.buffer : null;
    const imageType = req.file ? req.file.mimetype : null;

    try {
        const sql = `
      UPDATE giftshopitem
      SET name_ = ?,
          category = ?,
          price = ?,
          quantity = ?,
          image = ?,
          image_type = ?
      WHERE item_id = ?
        AND is_deleted = 0
    `;
        const values = [name_, category, parseFloat(price), quantity, imageBuffer, imageType, id];

        const [result] = await db.query(sql, values);
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Item not found or already deleted.' });
        }
        res.status(200).json({ message: 'Item updated successfully' });
    } catch (error) {
        console.error('Error updating gift shop item:', error);
        res.status(500).json({ error: 'Failed to update gift shop item' });
    }
});

// Get all the gift shop items (Exclude the deleted ones)
app.get('/giftshopitems', async (req, res) => {
    try {
        const [rows] = await db.query(
            'SELECT item_id, name_, category, price, quantity, is_deleted, image_type FROM giftshopitem WHERE is_deleted = 0'
        );
        res.json(rows);
    } catch (error) {
        console.error('Error fetching gift shop items:', error);
        res.status(500).json({ message: 'Server error fetching gift shop items.' });
    }
});

// Get all gift shop items (Admin only)
app.get('/giftshopitemsall', async (req, res) => {
    try {
        const [rows] = await db.query(
            'SELECT item_id, name_, category, price, quantity, is_deleted FROM giftshopitem'
        );
        res.json(rows);
    } catch (error) {
        console.error('Error fetching gift shop items:', error);
        res.status(500).json({ message: 'Server error fetching gift shop items.' });
    }
});

// Get item image
app.get('/giftshopitems/:id/image', async (req, res) => {
    const { id } = req.params;
    try {
        const [rows] = await db.query('SELECT image, image_type FROM giftshopitem WHERE item_id = ?', [
            id,
        ]);
        if (rows.length === 0 || !rows[0].image) {
            return res.status(404).json({ message: 'Image not found.' });
        }
        res.set('Cache-Control', 'no-store');
        res.set('Content-Type', rows[0].image_type || 'application/octet-stream');
        res.send(rows[0].image);
    } catch (error) {
        console.error('Error fetching image:', error);
        res.status(500).json({ message: 'Server error fetching image.' });
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
    const { id } = req.params;

    try {
        const sql = 'UPDATE giftshopitem SET is_deleted = 1 WHERE item_id = ?';
        await db.query(sql, [id]);
        res.status(200).json({ message: 'Gift shop item marked as deleted.' });
    } catch (error) {
        console.error('Error soft deleting gift shop item:', error);
        res.status(500).json({ message: 'Server error soft deleting gift shop item.' });
    }
});

// Restore a gift shop item (Admin only)
app.put('/giftshopitems/:id/restore', authenticateAdmin, async (req, res) => {
    const { id } = req.params;

    try {
        const sql = 'UPDATE giftshopitem SET is_deleted = 0 WHERE item_id = ?';
        await db.query(sql, [id]);
        res.status(200).json({ message: 'Gift shop item restored successfully.' });
    } catch (error) {
        console.error('Error restoring gift shop item:', error);
        res.status(500).json({ message: 'Server error restoring gift shop item.' });
    }
});

// Get user profile
app.get('/users/:id', authenticateUser, async (req, res) => {
    const { id } = req.params;

    // Ensure the user can only access their own profile
    if (req.userId !== id && req.userRole !== 'admin') {
        return res.status(403).json({ message: 'Access denied.' });
    }

    try {
        const [rows] = await db.query(
            `
        SELECT first_name AS firstName, last_name AS lastName, date_of_birth AS dateOfBirth, username, email
        FROM users
        WHERE user_id = ?
      `,
            [id]
        );

        if (rows.length === 0) {
            return res.status(404).json({ message: 'User not found.' });
        }

        res.json(rows[0]);
    } catch (error) {
        console.error('Error fetching user data:', error);
        res.status(500).json({ message: 'Server error fetching user data.' });
    }
});

// Update user profile
app.put('/users/:id', authenticateUser, async (req, res) => {
    const { id } = req.params;
    const { firstName, lastName, dateOfBirth, email } = req.body;

    // Ensure the user can only update their own profile
    if (req.userId !== id && req.userRole !== 'admin') {
        return res.status(403).json({ message: 'Access denied.' });
    }

    try {
        const sql = `
      UPDATE users
      SET first_name = ?,
          last_name = ?,
          date_of_birth = ?,
          email = ?
      WHERE user_id = ?
    `;
        const values = [firstName, lastName, dateOfBirth, email, id];

        await db.query(sql, values);
        res.status(200).json({ message: 'Profile updated successfully.' });
    } catch (error) {
        console.error('Error updating user profile:', error);
        res.status(500).json({ message: 'Server error updating user profile.' });
    }
});

// ----- (LEO DONE) ----------------------------------------------------------------------------------

// ----- (TYLER) -------------------------------------------------------------------------------------

// Update event information
app.put('/api/events/:id', authenticateAdmin, async (req, res) => {
    const { id } = req.params;
    const { name, description, location, status } = req.body;

    const allowedStatuses = ['upcoming', 'ongoing', 'completed'];
    if (!allowedStatuses.includes(status)) {
        return res.status(400).json({ message: 'Invalid status value.' });
    }

    try {
        const [result] = await db.query(
            'UPDATE event_ SET name_ = ?, description_ = ?, location = ?, status = ? WHERE event_id = ?',
            [name, description, location, status, id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Event not found.' });
        }
        res.json({ message: 'Event updated successfully.' });
    } catch (error) {
        console.error('Error updating event:', error);
        res.status(500).json({ message: 'Server error updating event.' });
    }
});

// Fetch the total number of members that signed up for an event
app.get('/api/events/:id/members', authenticateAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        const [result] = await db.query('SELECT * FROM membership WHERE event_id = ?', [id]);
        res.json(result);
    } catch (error) {
        console.error('Error fetching members:', error);
        res.status(500).json({ message: 'Server error fetching members.' });
    }
});

// ----- (TYLER DONE) ---------------------------------------------------------------------------------

// ----- (DENNIS) -------------------------------------------------------------------------------------

// Add your specific API endpoints or logic here, if any.

// ----- (DENNIS DONE) --------------------------------------------------------------------------------

// ----- EMAIL PROCESSING CODE ----------------------------------------------------------------------
async function processEmails() {
    let connection;
    try {
        // Get a connection from the pool
        connection = await db.getConnection();

        // Create email transporter
        const transporter = nodemailer.createTransport(emailConfig.smtp);

        // Get unprocessed emails
        const [emails] = await connection.execute(`
      SELECT eq.*, si.supplier_name, si.supplier_email, gsi.name_ AS item_name, gsi.quantity
      FROM email_queue eq
      JOIN supplier_items si ON eq.supplier_id = si.supplier_item_id
      JOIN giftshopitem gsi ON eq.item_id = gsi.item_id
      WHERE eq.processed = 0
      ORDER BY eq.created_at ASC
    `);

        if (emails.length > 0) {
            console.log(`Found ${emails.length} emails to process`);

            // Process each email
            for (const email of emails) {
                try {
                    // Create email content
                    const mailOptions = {
                        from: `"${emailConfig.from.name}" <${emailConfig.from.address}>`,
                        to: email.supplier_email,
                        subject: `Low Inventory Alert - ${email.item_name}`,
                        html: `
              <h2>Low Inventory Alert</h2>
              <p>Dear ${email.supplier_name},</p>
              <p>This is an automated alert that inventory is low for:</p>
              <ul>
                <li><strong>Item:</strong> ${email.item_name}</li>
                <li><strong>Current Quantity:</strong> ${email.quantity}</li>
              </ul>
              <p>Please arrange for replenishment of this item.</p>
              <br>
              <p>Best regards,<br>Museum Gift Shop Team</p>
            `,
                    };

                    // Send email
                    await transporter.sendMail(mailOptions);

                    // Mark as processed
                    await connection.execute(
                        `
            UPDATE email_queue 
            SET processed = 1,
                processed_at = NOW() 
            WHERE id = ?
          `,
                        [email.id]
                    );

                    console.log(
                        `Successfully sent email to ${email.supplier_email} for ${email.item_name}`
                    );
                } catch (error) {
                    console.error(`Error processing email ${email.id}:`, error);
                }
            }
        } else {
            console.log('No new emails to process');
        }
    } catch (error) {
        console.error('Error in processEmails:', error);
    } finally {
        if (connection) {
            connection.release();
        }
    }
}

async function checkAndProcessEmails() {
    console.log('Email processor started. Checking every 30 seconds...');

    while (true) {
        try {
            await processEmails();
            console.log('Waiting 30 seconds before next check...');
            await new Promise((resolve) => setTimeout(resolve, 30000)); // Wait 30 seconds
        } catch (error) {
            console.error('Error in email checking loop:', error);
            console.log('Retrying in 30 seconds...');
            await new Promise((resolve) => setTimeout(resolve, 30000)); // Wait even on error
        }
    }
}

// Start the continuous email processing
checkAndProcessEmails().catch((error) => {
    console.error('Fatal error in email processing loop:', error);
    process.exit(1);
});
// --------------------------------------------------------------------------------------------------


// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('Shutting down gracefully...');
    process.exit(0);
});
// --------------------------------------------------------------------------------------------------
export default app;
