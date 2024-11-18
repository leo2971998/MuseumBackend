// server.js

const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const multer = require('multer');
const sharp = require('sharp');
const bcrypt = require('bcrypt');
const nodemailer = require('nodemailer');
const path = require('path');
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
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
        allowedHeaders: ['Content-Type', 'Authorization', 'role', 'user-id'],
    })
);
app.use(async (req, res, next) => {
    const userId = req.headers['user-id'];
    const role = req.headers['role'];

    if (userId && role) {
        try {
            // Set session variables for the current connection
            await db.query(`SET @current_user_id = ?`, [userId]);
            await db.query(`SET @current_user_role = ?`, [role]);
        } catch (error) {
            console.error('Error setting session variables:', error);
            // Optionally, you can send an error response here
        }
    }

    next();
});
// Express middlewares
app.use(express.json());
app.use(express.static('public')); // Allows access to the public folder for images
// ----- DATABASE CONNECTION ------------------------------------------------------------------------
const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
    waitForConnections: true,
    connectionLimit: 50,
    queueLimit: 0,
    timezone: '-06:00', // Add this line
};

const db = mysql.createPool(dbConfig);

db.getConnection()
    .then(async (connection) => {
        console.log('Connected to the MySQL database');
        // Set the session time zone to CST
        await connection.query("SET time_zone = '-06:00'");
        connection.release();
    })
    .catch((err) => console.error('Error connecting to the database:', err));
// --------------------------------------------------------------------------------------------------
const roleMappings = {
    1: 'admin', 2: 'staff', 3: 'customer', 4: 'member',
};
// --------------------------------------------------------------------------------------------------
const uploadArtistImage = multer({ storage: multer.memoryStorage() });
// ----- (MELANIE) --------------------------------------------------------------------------------
app.get('/artwork', async (req, res) => {
    const isDeleted = req.query.isDeleted === 'true';

    // Use the isDeleted parameter to filter records accordingly
    const query = `
        SELECT artwork.ArtworkID, artwork.Title, artwork.Description, artwork.CreationYear, artwork.price,
               artwork.Medium, artwork.height, artwork.width, artwork.depth, artwork.acquisition_date,
               artwork.location, artwork.ArtworkCondition, artwork.artist_id, artwork.department_id,
               artist.name_ AS artist_name,
               department.Name AS department_name
        FROM artwork
                 LEFT JOIN artist ON artwork.artist_id = artist.ArtistID
                 LEFT JOIN department ON artwork.department_id = department.DepartmentID
        WHERE artwork.is_deleted = ?
    `;

    try {
        // Execute the query with isDeleted as a boolean (0 for false, 1 for true)
        const results = await db.query(query, [isDeleted ? 1 : 0]);
        res.json(results);
    } catch (error) {
        console.error('Error fetching artwork table:', error);
        res.status(500).json({ message: 'Server error fetching artwork table.' });
    }
});


app.get('/artwork/:id/image', async (req, res) => {
    const artworkId = req.params.id;

    try {
        const [rows] = await db.query('SELECT image, image_type FROM artwork WHERE ArtworkID = ?', [artworkId]);
        if (rows.length === 0 || !rows[0].image) {
            return res.status(404).json({ message: 'Image not found' });
        }

        // Set the appropriate content type and send the image data
        res.set('Content-Type', rows[0].image_type || 'application/octet-stream');
        res.send(rows[0].image);
    } catch (error) {
        console.error('Error fetching artwork image:', error);
        res.status(500).json({ message: 'Server error fetching artwork image.' });
    }
});

app.get('/artwork/:id', async (req, res) => {
    const artworkId = req.params.id;

    try {
        const [rows] = await db.query(`
            SELECT artwork.*,
                   artist.name_ AS artist_name,
                   department.Name AS department_name
            FROM artwork
                     LEFT JOIN artist ON artwork.artist_id = artist.ArtistID
                     LEFT JOIN department ON artwork.department_id = department.DepartmentID
            WHERE ArtworkID = ?`, [artworkId]);

        if (rows.length === 0) {
            return res.status(404).json({ message: 'Artwork not found' });
        }
        res.json(rows[0]); // Return the single artwork object
    } catch (error) {
        console.error('Error fetching artwork by ID:', error);
        res.status(500).json({ message: 'Server error fetching artwork.' });
    }
});

app.get('/mediums', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT DISTINCT Medium FROM artwork ORDER BY Medium ASC');
        const mediums = rows.map(row => row.Medium); // Extract the Medium field into an array
        res.json(mediums);
    } catch (error) {
        console.error('Error fetching mediums:', error);
        res.status(500).json({ message: 'Server error fetching mediums.' });
    }
});

app.get('/creation-years', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT DISTINCT CreationYear FROM Artwork ORDER BY CreationYear ASC');
        const cy = rows.map(row => row.CreationYear); // Extract the CreationYear field into an array
        res.json(cy);
    } catch (error) {
        console.error('Error fetching creation years:', error);
        res.status(500).json({ message: 'Server error fetching creation years.' });
    }
});

app.get('/artworkconditions', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT DISTINCT ArtworkCondition FROM artwork ORDER BY ArtworkCondition ASC');
        const conditions = rows.map(row => row.ArtworkCondition); // Corrected field name
        res.json(conditions);
    } catch (error) {
        console.error('Error fetching conditions:', error);
        res.status(500).json({ message: 'Server error fetching conditions.' });
    }
});

const uploadArtworkImage = multer({ storage: multer.memoryStorage() }); // Use memory storage for image uploads
app.post('/artwork', uploadArtworkImage.single('image'), async (req, res) => {
    try {
        const {
            Title, artist_id, department_id, Description, CreationYear, price,
            Medium, height, width, depth, acquisition_date, location, ArtworkCondition
        } = req.body;

        let imageBlob = null;
        let imageType = null;

        // If an image was uploaded, process it
        if (req.file) {
            imageType = req.file.mimetype;

            // Compress and resize image if it is too large
            imageBlob = await sharp(req.file.buffer)
                .resize({ width: 1000, withoutEnlargement: true }) // Resize to 800px width, maintaining aspect ratio
                .toBuffer();
        }

        const [result] = await db.query(
            `INSERT INTO artwork (Title, artist_id, department_id, Description, CreationYear, price, Medium, height, width, depth, acquisition_date, location, ArtworkCondition, image, image_type)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [Title, artist_id, department_id, Description, CreationYear, price || null, Medium, height, width, depth || null, acquisition_date, location || null, ArtworkCondition, imageBlob, imageType]
        );

        res.status(201).json({ message: 'Artwork added successfully', artworkId: result.insertId });
    } catch (error) {
        console.error('Error inserting artwork:', error);
        res.status(500).json({ message: 'Failed to add artwork' });
    }
});

app.patch('/artwork/:id', uploadArtworkImage.single('image'), async (req, res) => {
    const artworkId = req.params.id;
    const { Title, artist_id, department_id, Description, CreationYear, price, Medium, height, width, depth, acquisition_date, location, ArtworkCondition } = req.body;
    let imageBlob = null;
    let imageType = null;

    // If a new image is uploaded, process it with sharp
    if (req.file) {
        imageType = req.file.mimetype;

        // Compress and resize the image before saving
        imageBlob = await sharp(req.file.buffer)
            .resize({ width: 1000, withoutEnlargement: true }) // Resize to a max width of 800 pixels
            .toBuffer();
    }

    // Dynamically construct SQL query and values based on provided fields
    const fields = [];
    const values = [];

    if (Title) {
        fields.push('Title = ?');
        values.push(Title);
    }
    if (artist_id) {
        fields.push('artist_id = ?');
        values.push(artist_id);
    }
    if (department_id) {
        fields.push('department_id = ?');
        values.push(department_id);
    }
    if (Description) {
        fields.push('Description = ?');
        values.push(Description);
    }
    if (CreationYear) {
        fields.push('CreationYear = ?');
        values.push(CreationYear);
    }
    if (price !== undefined) { // Allow `price` to be null
        fields.push('price = ?');
        values.push(price || null);
    }
    if (Medium) {
        fields.push('Medium = ?');
        values.push(Medium);
    }
    if (height) {
        fields.push('height = ?');
        values.push(height);
    }
    if (width) {
        fields.push('width = ?');
        values.push(width);
    }
    if (depth !== undefined) { // Allow `depth` to be null
        fields.push('depth = ?');
        values.push(depth || null);
    }
    if (acquisition_date) {
        fields.push('acquisition_date = ?');
        values.push(acquisition_date);
    }
    if (location) {
        fields.push('location = ?');
        values.push(location || null);
    }
    if (ArtworkCondition) {
        fields.push('ArtworkCondition = ?');
        values.push(ArtworkCondition);
    }
    if (imageBlob && imageType) { // Add image fields only if a new image is provided
        fields.push('image = ?');
        values.push(imageBlob);
        fields.push('image_type = ?');
        values.push(imageType);
    }

    // Check if any fields to update
    if (fields.length === 0) {
        return res.status(400).json({ message: 'No fields to update' });
    }

    // Add the artworkId for the WHERE clause
    values.push(artworkId);

    const query = `UPDATE artwork SET ${fields.join(', ')} WHERE ArtworkID = ?`;

    try {
        await db.query(query, values);
        res.status(200).json({ message: 'Artwork updated successfully.' });
    } catch (error) {
        console.error('Error updating artwork:', error);
        res.status(500).json({ message: 'Server error updating artwork.' });
    }
});

app.patch('/artwork/:id/restore', async (req, res) => {
    const { id } = req.params;
    try {
        // Update the artwork's is_deleted status to false
        await db.query('UPDATE artwork SET is_deleted = 0 WHERE ArtworkID = ?', [id]);
        res.json({ message: 'Artwork restored successfully' });
    } catch (error) {
        console.error('Error restoring artwork:', error);
        res.status(500).json({ message: 'Error restoring artwork' });
    }
});

// only delete artwork
// app.delete('/artwork/:id', async (req, res) => {
//     const artworkId = req.params.id;
//     try {
//         await db.query('DELETE FROM artwork WHERE ArtworkID = ?', [artworkId]);
//         res.status(200).json({ message: 'Artwork deleted successfully' });
//     } catch (error) {
//         console.error('Error deleting artwork:', error);
//         res.status(500).json({ message: 'Server error deleting artwork' });
//     }
// });
// Soft delete artwork only
app.delete('/artwork/:id', async (req, res) => {
    const artworkId = req.params.id;
    try {
        // Soft delete the artwork
        await db.query('UPDATE artwork SET is_deleted = 1 WHERE ArtworkID = ?', [artworkId]);

        res.status(200).json({ message: 'Artwork soft deleted successfully' });
    } catch (error) {
        console.error('Error soft deleting artwork:', error);
        res.status(500).json({ message: 'Server error soft deleting artwork' });
    }
});
// ----(artist)-----------------
app.get('/artist', async (req, res) => {
    const isDeleted = req.query.isDeleted === 'true';

    // Use the isDeleted parameter to filter records accordingly
    const query = `
        SELECT ArtistID, name_, gender, nationality, birth_year, death_year, description, is_deleted
            FROM artist
            WHERE artist.is_deleted = ?
            ORDER BY name_ ASC
    `;

    try {
        // Execute the query with isDeleted as a boolean (0 for false, 1 for true)
        const results = await db.query(query, [isDeleted ? 1 : 0]);
        res.json(results);
    } catch (error) {
        console.error('Error fetching artist table:', error);
        res.status(500).json({ message: 'Server error fetching artist table.' });
    }
});

app.get('/artist', async (req, res) => {
    const isDeleted = req.query.isDeleted === 'true';

    // Use the isDeleted parameter to filter records accordingly
    const query = `
        SELECT ArtistID, name_, gender, nationality, birth_year, death_year, description, is_deleted
        FROM artist
        WHERE artist.is_deleted = ?
        ORDER BY name_ ASC
    `;

    try {
        // Execute the query with isDeleted as a boolean (0 for false, 1 for true)
        const results = await db.query(query, [isDeleted ? 1 : 0]);
        res.json(results);
    } catch (error) {
        console.error('Error fetching artist table:', error);
        res.status(500).json({ message: 'Server error fetching artist table.' });
    }
});

app.get('/artist/:id/image', async (req, res) => {
    const artistId = req.params.id;

    try {
        const [rows] = await db.query('SELECT image, image_type FROM artist WHERE ArtistID = ?', [artistId]);
        if (rows.length === 0 || !rows[0].image) {
            return res.status(404).json({ message: 'Image not found' });
        }

        // Set the correct content type for the image and send the binary data
        res.set('Content-Type', rows[0].image_type || 'application/octet-stream');
        res.send(rows[0].image);
    } catch (error) {
        console.error('Error fetching artist image:', error);
        res.status(500).json({ message: 'Server error fetching artist image.' });
    }
});

app.get('/artist/:id', async (req, res) => {
    const artistId = req.params.id;

    try {
        const [rows] = await db.query('SELECT * FROM artist WHERE ArtistID = ?', [artistId]);
        if (rows.length === 0) {
            return res.status(404).json({ message: 'Artist not found' });
        }
        res.json(rows[0]); // Return the single artist object
    } catch (error) {
        console.error('Error fetching artist by ID:', error);
        res.status(500).json({ message: 'Server error fetching artist.' });
    }
});

// app.get('/artist-with-artwork', async (req, res) => {
//     const isDeleted = req.query.isDeleted === 'true';

//     // Use the isDeleted parameter to filter records accordingly
//     const query = `
//         SELECT DISTINCT artist.ArtistID, artist.name_, artist.description, artist.gender, artist.nationality,
//             artist.birth_year, artist.death_year, artist.is_deleted
//         FROM artist
//         LEFT JOIN artwork ON artist.ArtistID = artwork.artist_id
//         WHERE artwork.ArtworkID IS NOT NULL AND artist.is_deleted = ?
//         ORDER BY name_ ASC
//     `;

//     try {
//         // Execute the query with isDeleted as a boolean (0 for false, 1 for true)
//         const results = await db.query(query, [isDeleted ? 1 : 0]);
//         res.json(results);
//     } catch (error) {
//         console.error('Error fetching artists with artwork:', error);
//         res.status(500).json({ message: 'Server error fetching artists with artwork.' });
//     }
// });

// app.get('/artist-null-artwork', async (req, res) => {
//     const isDeleted = req.query.isDeleted === 'true';

//     const query = `
//         SELECT DISTINCT artist.ArtistID, artist.name_, artist.description, artist.gender, artist.nationality,
//             artist.birth_year, artist.death_year, artist.is_deleted
//         FROM artist
//         LEFT JOIN artwork ON artist.ArtistID = artwork.artist_id
//         WHERE artwork.ArtworkID IS NULL AND artist.ArtistID IS NOT NULL AND artist.is_deleted = ?
//         ORDER BY name_ ASC
//     `;

//     try {
//         const results = await db.query(query, [isDeleted ? 1 : 0]);
//         res.json(results);
//     } catch (error) {
//         console.error('Error fetching artists without artwork:', error);
//         res.status(500).json({ message: 'Server error fetching artists without artwork.' });
//     }
// });


// get nationalities
app.get('/artist-with-artwork', async (req, res) => {
    const isDeleted = req.query.isDeleted === 'true';

    const query = `
        SELECT DISTINCT artist.ArtistID, artist.name_, artist.description, artist.gender, artist.nationality,
                        artist.birth_year, artist.death_year, artist.is_deleted
        FROM artist
                 LEFT JOIN artwork ON artist.ArtistID = artwork.artist_id
        WHERE artist.is_deleted = ?
          AND EXISTS (
            SELECT 1
            FROM artwork a
            WHERE a.artist_id = artist.ArtistID
              AND a.is_deleted = 0
        )
        ORDER BY name_ ASC
    `;

    try {
        const results = await db.query(query, [isDeleted ? 1 : 0]);
        res.json(results);
    } catch (error) {
        console.error('Error fetching artists with artwork:', error);
        res.status(500).json({ message: 'Server error fetching artists with artwork.' });
    }
});


app.get('/artist-null-artwork', async (req, res) => {
    const isDeleted = req.query.isDeleted === 'true';

    const query = `
        SELECT DISTINCT artist.ArtistID, artist.name_, artist.description, artist.gender, artist.nationality,
                        artist.birth_year, artist.death_year, artist.is_deleted
        FROM artist
                 LEFT JOIN artwork ON artist.ArtistID = artwork.artist_id
        WHERE artist.is_deleted = ?
          AND (artwork.ArtworkID IS NULL OR (
            artist.ArtistID IS NOT NULL
                AND NOT EXISTS (
                SELECT 1
                FROM artwork a
                WHERE a.artist_id = artist.ArtistID
                  AND a.is_deleted = 0
            )
            ))
        ORDER BY name_ ASC
    `;

    try {
        const results = await db.query(query, [isDeleted ? 1 : 0]);
        res.json(results);
    } catch (error) {
        console.error('Error fetching artists without artwork or with all artworks deleted:', error);
        res.status(500).json({ message: 'Server error fetching artists without artwork or with all artworks deleted.' });
    }
});


app.get('/nationalities', async (req, res) => {
    try {
        const [rows] = await db.query(`
        SHOW COLUMNS FROM artist LIKE 'nationality'
      `);

        // Extract the enum values from the `Type` column
        const enumValues = rows[0].Type.match(/enum\((.*)\)/)[1]
            .replace(/'/g, '') // Remove single quotes
            .split(','); // Split by comma to get individual nationalities

        res.json(enumValues);
    } catch (error) {
        console.error('Error fetching nationalities:', error);
        res.status(500).json({ message: 'Server error fetching nationalities.' });
    }
});

app.post('/artist', uploadArtistImage.single('image'), async (req, res) => {
    try {
        const { name, gender, nationality, birthYear, description } = req.body;
        let deathYear = req.body.deathYear ? parseInt(req.body.deathYear) : null;
        deathYear = isNaN(deathYear) ? null : deathYear;

        let imageBlob = null;
        let imageType = null;

        // Process the uploaded image if provided
        if (req.file) {
            imageType = req.file.mimetype;
            imageBlob = await sharp(req.file.buffer)
                .resize({ width: 1000, withoutEnlargement: true }) // Resize to 1000px width max
                .toBuffer();
        }

        const [result] = await db.query(
            `INSERT INTO artist (name_, gender, nationality, birth_year, death_year, description, image, image_type)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [name, gender, nationality, birthYear, deathYear, description, imageBlob, imageType]
        );

        res.status(201).json({ message: 'Artist added successfully', artistId: result.insertId });
    } catch (error) {
        console.error('Error inserting artist:', error);
        res.status(500).json({ message: 'Failed to add artist' });
    }
});

app.patch('/artist/:id', uploadArtistImage.single('image'), async (req, res) => {

    const artistId = req.params.id;
    const { name, nationality, birthYear, deathYear, description, gender } = req.body;
    let imageBlob = null;
    let imageType = null;

    // If a new image is uploaded, process it with sharp
    if (req.file) {
        imageType = req.file.mimetype;
        imageBlob = await sharp(req.file.buffer)
            .resize({ width: 1000, withoutEnlargement: true }) // Resize to 1000px max width
            .toBuffer();
    }

    const fields = [];
    const values = [];

    if (name) fields.push('name_ = ?'), values.push(name);
    if (gender) fields.push('gender = ?'), values.push(gender);
    if (nationality) fields.push('nationality = ?'), values.push(nationality);
    if (birthYear) fields.push('birth_year = ?'), values.push(birthYear);
    if (deathYear !== undefined) fields.push('death_year = ?'), values.push(deathYear || null);
    if (description) fields.push('description = ?'), values.push(description);
    if (imageBlob && imageType) {
        fields.push('image = ?');
        fields.push('image_type = ?');
        values.push(imageBlob, imageType);
    }

    if (fields.length === 0) {
        return res.status(400).json({ message: 'No fields to update' });
    }

    values.push(artistId); // Add artistId for the WHERE clause

    const query = `UPDATE artist SET ${fields.join(', ')} WHERE ArtistID = ?`;

    try {
        await db.query(query, values);
        res.status(200).json({ message: 'Artist updated successfully.' });
    } catch (error) {
        console.error('Error updating artist:', error);
        res.status(500).json({ message: 'Server error updating artist.' });
    }
});

app.patch('/artist/:id/restore', async (req, res) => {
    try {
        const { id } = req.params;
        await db.query('UPDATE artist SET is_deleted = 0 WHERE ArtistID = ?', [id]);
        res.status(200).json({ message: 'Artist restored successfully' });
    } catch (error) {
        console.error('Error restoring artist:', error);
        res.status(500).json({ message: 'Failed to restore artist' });
    }
});


// if i delete an artist, i want to delete all the artworks associated with that artist
// app.delete('/artist/:id', async (req, res) => {
//     const artistId = req.params.id;
//     try {
//         await db.query('DELETE FROM artist WHERE ArtistID = ?', [artistId]);
//         res.status(200).json({ message: 'Artist and associated artworks deleted successfully' });
//     } catch (error) {
//         console.error('Error deleting artist:', error);
//         res.status(500).json({ message: 'Server error deleting artist' });
//     }
// });
// Soft delete artist and associated artworks
app.delete('/artist/:id', async (req, res) => {
    const artistId = req.params.id;
    try {
        // Soft delete the artist
        await db.query('UPDATE artist SET is_deleted = 1 WHERE ArtistID = ?', [artistId]);

        // Soft delete all associated artworks
        await db.query('UPDATE artwork SET is_deleted = 1 WHERE artist_id = ?', [artistId]);

        res.status(200).json({ message: 'Artist and associated artworks soft deleted successfully' });
    } catch (error) {
        console.error('Error soft deleting artist:', error);
        res.status(500).json({ message: 'Server error soft deleting artist' });
    }
});

// ----(department)-----------------
// Endpoint to get departments based on their is_deleted status
app.get('/department', async (req, res) => {
    const isDeleted = req.query.isDeleted === 'true';
    const query = `
        SELECT DepartmentID, Name, Description, Location, is_deleted
        FROM department
        WHERE is_deleted = ?
        ORDER BY Name ASC
    `;
    try {
        const results = await db.query(query, [isDeleted ? 1 : 0]);
        res.json(results);
    } catch (error) {
        console.error('Error fetching department table:', error);
        res.status(500).json({ message: 'Server error fetching department table.' });
    }
});
app.get('/department/:id', async (req, res) => {
    const departmentId = req.params.id;
    try {
        const department = await db.query('SELECT * FROM department WHERE DepartmentID = ?', [departmentId]);
        if (department.length === 0) {
            return res.status(404).json({ message: 'Department not found' });
        }
        res.json(department[0]);
    } catch (error) {
        console.error('Error fetching department:', error);
        res.status(500).json({ message: 'Error fetching department' });
    }
});
app.get('/department-with-artwork', async (req, res) => {
    const isDeleted = req.query.isDeleted === 'true';
    const query = `
        SELECT DISTINCT department.DepartmentID, department.Name, department.Description, department.Location, department.is_deleted
        FROM department
                 LEFT JOIN artwork ON department.DepartmentID = artwork.department_id
        WHERE department.is_deleted = ?
          AND EXISTS (
            SELECT 1
            FROM artwork a
            WHERE a.department_id = department.DepartmentID
              AND a.is_deleted = 0
        )
        ORDER BY Name ASC
    `;
    try {
        const results = await db.query(query, [isDeleted ? 1 : 0]);
        res.json(results);
    } catch (error) {
        console.error('Error fetching departments with artwork:', error);
        res.status(500).json({ message: 'Server error fetching departments with artwork.' });
    }
});
app.get('/department-null-artwork', async (req, res) => {
    const isDeleted = req.query.isDeleted === 'true';
    const query = `
        SELECT DISTINCT department.DepartmentID, department.Name, department.Description, department.Location, department.is_deleted
        FROM department
                 LEFT JOIN artwork ON department.DepartmentID = artwork.department_id
        WHERE department.is_deleted = ?
          AND (artwork.ArtworkID IS NULL OR (
            department.DepartmentID IS NOT NULL
                AND NOT EXISTS (
                SELECT 1
                FROM artwork a
                WHERE a.department_id = department.DepartmentID
                  AND a.is_deleted = 0
            )
            ))
        ORDER BY Name ASC
    `;
    try {
        const results = await db.query(query, [isDeleted ? 1 : 0]);
        res.json(results);
    } catch (error) {
        console.error('Error fetching departments without artwork:', error);
        res.status(500).json({ message: 'Server error fetching departments without artwork.' });
    }
});
app.post('/department', async (req, res) => {
    const { name, location, description } = req.body;
    if (!name || !description) {
        return res.status(400).json({ message: 'Name and Description are required.' });
    }
    try {
        const result = await db.query(
            'INSERT INTO department (Name, Location, Description) VALUES (?, ?, ?)',
            [name, location, description]
        );
        res.status(201).json({ message: 'Department added successfully', departmentId: result.insertId });
    } catch (error) {
        console.error('Error inserting department:', error);
        res.status(500).json({ message: 'Server error inserting department.' });
    }
});
app.patch('/department/:id', async (req, res) => {
    const departmentId = req.params.id;
    const { name, location, description } = req.body;

    const fields = [];
    const values = [];

    // Check for all fields explicitly, even if they're empty strings
    if (name !== undefined) fields.push('Name = ?'), values.push(name);
    if (location !== undefined) fields.push('Location = ?'), values.push(location);
    if (description !== undefined) fields.push('Description = ?'), values.push(description);

    if (fields.length === 0) {
        return res.status(400).json({ message: 'No fields to update' });
    }

    values.push(departmentId); // Add departmentId for the WHERE clause

    const query = `UPDATE department SET ${fields.join(', ')} WHERE DepartmentID = ?`;
    try {
        await db.query(query, values);
        res.status(200).json({ message: 'Department updated successfully.' });
    } catch (error) {
        console.error('Error updating department:', error);
        res.status(500).json({ message: 'Server error updating department.' });
    }
});

app.patch('/department/:id/restore', async (req, res) => {
    try {
        const { id } = req.params;
        // Restore the department
        await db.query('UPDATE department SET is_deleted = 0 WHERE DepartmentID = ?', [id]);
        res.status(200).json({ message: 'Department restored successfully' });
    } catch (error) {
        console.error('Error restoring department:', error);
        res.status(500).json({ message: 'Failed to restore department' });
    }
});
// Soft delete department and associated artworks
app.delete('/department/:id', async (req, res) => {
    const departmentId = req.params.id;
    try {
        // Soft delete the department
        await db.query('UPDATE department SET is_deleted = 1 WHERE DepartmentID = ?', [departmentId]);
        // Soft delete all associated artworks
        await db.query('UPDATE artwork SET is_deleted = 1 WHERE department_id = ?', [departmentId]);
        res.status(200).json({ message: 'Department and associated artworks soft deleted successfully' });
    } catch (error) {
        console.error('Error soft deleting department:', error);
        res.status(500).json({ message: 'Server error soft deleting department' });
    }
});
// ----(exhibition)-----------------
app.get('/exhibition', async (req, res) => {
    const isDeleted = req.query.isDeleted === 'true';
    // Use the isDeleted parameter to filter records accordingly
    const query = `
        SELECT exhibition_id, name_, start_date, end_date, description_, is_deleted
        FROM exhibition
        WHERE exhibition.is_deleted = ?
        ORDER BY name_ ASC
    `;
    try {
        // Execute the query with isDeleted as a boolean (0 for false, 1 for true)
        const results = await db.query(query, [isDeleted ? 1 : 0]);
        res.json(results);
    } catch (error) {
        console.error('Error fetching exhibition table:', error);
        res.status(500).json({ message: 'Server error fetching exhibition table.' });
    }
});
app.get('/exhibition/:id/image', async (req, res) => {
    const exhibitionId = req.params.id;
    try {
        const [rows] = await db.query('SELECT image, image_type FROM exhibition WHERE exhibition_id = ?', [exhibitionId]);
        if (rows.length === 0 || !rows[0].image) {
            return res.status(404).json({ message: 'Image not found' });
        }
        // Set the correct content type for the image and send the binary data
        res.set('Content-Type', rows[0].image_type || 'application/octet-stream');
        res.send(rows[0].image);
    } catch (error) {
        console.error('Error fetching exhibition image:', error);
        res.status(500).json({ message: 'Server error fetching exhibition image.' });
    }
});
app.get('/exhibition/:id', async (req, res) => {
    const exhibitionId = req.params.id;
    try {
        const [rows] = await db.query('SELECT * FROM exhibition WHERE exhibition_id = ?', [exhibitionId]);
        if (rows.length === 0) {
            return res.status(404).json({ message: 'exhibition not found' });
        }
        res.json(rows[0]); // Return the single artist object
    } catch (error) {
        console.error('Error fetching exhibition by ID:', error);
        res.status(500).json({ message: 'Server error fetching exhibition.' });
    }
});
const uploadExhibitionImage = multer({ storage: multer.memoryStorage() }); // Use memory storage for image uploads
app.post('/exhibition', uploadExhibitionImage.single('image'), async (req, res) => {
    try {
        const { name, sdate, edate, description } = req.body;
        let imageBlob = null;
        let imageType = null;
        // If an image was uploaded, process it
        if (req.file) {
            imageType = req.file.mimetype;
            // Compress and resize image if it is too large
            imageBlob = await sharp(req.file.buffer)
                .resize({ width: 800, withoutEnlargement: true }) // Resize to 800px width, maintaining aspect ratio
                .toBuffer();
        }
        const [result] = await db.query(
            `INSERT INTO exhibition (name_, start_date, end_date, description_, image, image_type)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [name, sdate, edate, description, imageBlob, imageType]
        );
        res.status(201).json({ message: 'Exhibition added successfully', exId: result.insertId });
    } catch (error) {
        console.error('Error inserting exhibition:', error);
        res.status(500).json({ message: 'Failed to add exhibition' });
    }
});
app.patch('/exhibition/:id', uploadExhibitionImage.single('image'), async (req, res) => {
    const exhibitionId = req.params.id;
    const { name, start_date, end_date, description } = req.body;
    let imageBlob = null;
    let imageType = null;
    // If a new image is uploaded, process it with sharp
    if (req.file) {
        imageType = req.file.mimetype;
        // Compress and resize the image before saving
        imageBlob = await sharp(req.file.buffer)
            .resize({ width: 800, withoutEnlargement: true }) // Resize to a max width of 800 pixels
            .toBuffer();
    }
    // Dynamically construct SQL query and values based on provided fields
    const fields = [];
    const values = [];
    if (name) {
        fields.push('name_ = ?');
        values.push(name);
    }
    if (start_date) {
        fields.push('start_date = ?');
        values.push(start_date);
    }
    if (end_date) {
        fields.push('end_date = ?');
        values.push(end_date);
    }
    if (description) {
        fields.push('description_ = ?');
        values.push(description);
    }
    if (imageBlob && imageType) { // Add image fields only if a new image is provided
        fields.push('image = ?');
        values.push(imageBlob);
        fields.push('image_type = ?');
        values.push(imageType);
    }
    // Check if any fields to update
    if (fields.length === 0) {
        return res.status(400).json({ message: 'No fields to update' });
    }
    // Add the exhibitionId for the WHERE clause
    values.push(exhibitionId);
    const query = `UPDATE exhibition SET ${fields.join(', ')} WHERE exhibition_id = ?`;
    try {
        await db.query(query, values);
        res.status(200).json({ message: 'Exhibition updated successfully.' });
    } catch (error) {
        console.error('Error updating exhibition:', error);
        res.status(500).json({ message: 'Server error updating exhibition.' });
    }
});
app.patch('/exhibition/:id/restore', async (req, res) => {
    const { id } = req.params;
    try {
        // Update the exhibition's is_deleted status to false
        await db.query('UPDATE exhibition SET is_deleted = 0 WHERE exhibition_id = ?', [id]);
        res.json({ message: 'Exhibition restored successfully' });
    } catch (error) {
        console.error('Error restoring exhibition:', error);
        res.status(500).json({ message: 'Error restoring exhibition' });
    }
});
// Soft delete artwork only
app.delete('/exhibition/:id', async (req, res) => {
    const exhibitionId = req.params.id;
    try {
        // Soft delete the exhibition by setting `is_deleted` to 1
        await db.query('UPDATE exhibition SET is_deleted = 1 WHERE exhibition_id = ?', [exhibitionId]);
        res.status(200).json({ message: 'Exhibition soft deleted successfully' });
    } catch (error) {
        console.error('Error soft deleting exhibition:', error);
        res.status(500).json({ message: 'Server error soft deleting exhibition' });
    }
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

    // Assign default role_id if not provided
    const assignedRoleId = roleId || 3; // Default to 'customer' if roleId is not provided

    // Validate roleId
    if (!Object.keys(roleMappings).includes(String(assignedRoleId))) {
        return res.status(400).json({message: 'Invalid role_id provided.'});
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
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
app.post('/login', async (req, res) => {
    const { username, password } = req.body;

    // Validate input
    if (!username || !password) {
        return res.status(400).json({ message: 'Username and password are required.' });
    }

    try {

        // Query to fetch user details along with role name and membership status
        const [userRows] = await db.query(`
            SELECT
                users.user_id,
                users.username,
                users.password,
                users.role_id,
                users.is_deleted,
                users.first_name,
                users.last_name,
                roles.role_name,
                (users.role_id = 4) AS is_member
            FROM users
                     JOIN roles ON users.role_id = roles.id
            WHERE users.username = ?
        `, [username]);

        // Debug log the query result

        // Check if user exists
        if (userRows.length === 0) {
            return res.status(400).json({ message: 'Invalid username or password.' });
        }

        const user = userRows[0];

        // Check if the account is deactivated
        if (user.is_deleted === 1) {
            return res.status(403).json({ message: 'Account has been deactivated. Please contact support.' });
        }

        // Verify password
        const passwordMatch = await bcrypt.compare(password, user.password);
        if (!passwordMatch) {
            return res.status(400).json({ message: 'Invalid username or password.' });
        }

        // Update the `updated_at` timestamp
        await db.query(
            'UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
            [user.user_id]
        );

        // Initialize membership information
        let membershipInfo = null;

        // If the user is a member, fetch membership details
        if (user.is_member) {
            const [membershipRows] = await db.query(`
                SELECT 
                    expiration_warning, 
                    expire_date 
                FROM membership 
                WHERE user_id = ? 
                  AND expire_date >= CURRENT_TIMESTAMP
                ORDER BY expire_date ASC 
                LIMIT 1
            `, [user.user_id]);

            membershipInfo = membershipRows[0] || null;
        }

        // Prepare the response payload
        const responsePayload = {
            message: 'Login successful!',
            userId: user.user_id,
            role: user.role_name,
            username: user.username,
            first_name: user.first_name || '', // Provide default empty string if null
            last_name: user.last_name || '',   // Provide default empty string if null
            // Only include membershipWarning and expireDate if the user is a member
            ...(user.is_member && membershipInfo && {
                membershipWarning: membershipInfo.expiration_warning === 1,
                expireDate: membershipInfo.expire_date
            })
        };
        // Send the successful response
        res.status(200).json(responsePayload);

    } catch (error) {
        console.error('Server error during login:', error);
        res.status(500).json({ message: 'Server error.' });
    }
});
// ----- AUTHENTICATION MIDDLEWARE -----
// Authenticate Admin and Staff Middleware
function authenticateAdmin(req, res, next) {
    const {role} = req.headers;
    if (role === 'admin') {
        next();
    } else {
        res.status(403).json({message: 'Access denied. Admins only.'});
    }
}

async function authenticateUser(req, res, next) {
    const userId = req.headers['user-id'];
    const role = req.headers['role'];

    if (userId && role) {
        try {
            const [rows] = await db.query('SELECT is_deleted FROM users WHERE user_id = ?', [userId]);
            if (rows.length > 0 && rows[0].is_deleted === 0) {
                req.userId = userId;
                req.userRole = role;
                next();
            } else {
                res.status(403).json({ message: 'Access denied. User is deleted or does not exist.' });
            }
        } catch (error) {
            console.error('Error in authenticateUser middleware:', error);
            res.status(500).json({ message: 'Server error during authentication.' });
        }
    } else {
        res.status(401).json({ message: 'Unauthorized access. User ID and role are required in headers.' });
    }
}

// ----- MULTER CONFIGURATION -----
const uploadMulter = multer({storage: multer.memoryStorage()});

// ----- GIFT SHOP ITEMS ENDPOINTS -----

// Create item API
app.post('/giftshopitems', uploadMulter.single('image'), authenticateUser, async (req, res) => {
    const {name_, category, price, quantity} = req.body;
    const imageBlob = req.file ? req.file.buffer : null;
    const imageType = req.file ? req.file.mimetype : null;

    try {
        const sql = `
            INSERT INTO giftshopitem (name_, category, price, quantity, image, image_type)
            VALUES (?, ?, ?, ?, ?, ?)
        `;
        const values = [name_, category, parseFloat(price), parseInt(quantity, 10), imageBlob, imageType];
        // No cache
        res.set('Cache-Control', 'no-store');
        await db.query(sql, values);
        res.status(201).json({message: 'Item created successfully'});
    } catch (error) {
        console.error('Error creating gift shop item:', error);
        res.status(500).json({error: 'Failed to create gift shop item'});
    }
});
// Get all gift shop items (non-deleted)
app.get('/giftshopitems', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT item_id, name_, category, price, quantity, is_deleted FROM giftshopitem WHERE is_deleted = 0');
        res.status(200).json(rows);
    } catch (error) {
        console.error('Error fetching gift shop items:', error);
        res.status(500).json({message: 'Server error fetching gift shop items.'});
    }
});

// Get all gift shop items (including deleted, admin only)
app.get('/giftshopitemsall', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT item_id, name_, category, price, quantity, is_deleted FROM giftshopitem');
        res.status(200).json(rows);
    } catch (error) {
        console.error('Error fetching gift shop items:', error);
        res.status(500).json({message: 'Server error fetching gift shop items.'});
    }
});

// Get image for a specific gift shop item
app.get('/giftshopitems/:id/image', async (req, res) => {
    const {id} = req.params;

    try {
        const [rows] = await db.query('SELECT image, image_type FROM giftshopitem WHERE item_id = ?', [id]);
        if (rows.length === 0 || !rows[0].image) {
            return res.status(404).json({message: 'Image not found.'});
        }

        const imageType = rows[0].image_type || 'application/octet-stream';
        res.set('Content-Type', imageType);
        res.send(rows[0].image);
    } catch (error) {
        console.error('Error fetching image:', error);
        res.status(500).json({message: 'Server error fetching image.'});
    }
});

// Update item API
// Update item API
app.put('/giftshopitems/:id', uploadMulter.single('image'), authenticateUser, async (req, res) => {
    const {id} = req.params;
    const {name_, category, price, quantity} = req.body;
    const imageBlob = req.file ? req.file.buffer : null;
    const imageType = req.file ? req.file.mimetype : null;

    try {
        let sql, values;

        if (imageBlob && imageType) {
            sql = `
                UPDATE giftshopitem
                SET name_      = ?,
                    category   = ?,
                    price      = ?,
                    quantity   = ?,
                    image      = ?,
                    image_type = ?
                WHERE item_id = ?
                  AND is_deleted = 0
            `;
            values = [name_, category, parseFloat(price), quantity, imageBlob, imageType, id];
        } else {
            // If no new image is uploaded, don't update image fields
            sql = `
                UPDATE giftshopitem
                SET name_    = ?,
                    category = ?,
                    price    = ?,
                    quantity = ?
                WHERE item_id = ?
                  AND is_deleted = 0
            `;
            values = [name_, category, parseFloat(price), quantity, id];
        }
        res.set('Cache-Control', 'no-store');
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


// Hard delete a gift shop item (Admin only)
app.delete('/giftshopitems/:id/hard-delete', authenticateAdmin, async (req, res) => {
    const {id} = req.params;

    try {
        const sql = 'DELETE FROM giftshopitem WHERE item_id = ?';
        const [result] = await db.query(sql, [id]);

        if (result.affectedRows === 0) {
            return res.status(404).json({message: 'Item not found or already deleted.'});
        }

        res.status(200).json({message: 'Gift shop item permanently deleted.'});
    } catch (error) {
        console.error('Error hard deleting gift shop item:', error);
        res.status(500).json({message: 'Server error during hard delete.'});
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

/// Get all users (Admin only)
app.get('/users', authenticateAdmin, async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT user_id,
                   first_name,
                   last_name,
                   username,
                   email,
                   role_id,
                   is_deleted,
                   DATE_FORMAT(date_of_birth, '%Y-%m-%d') AS date_of_birth
            FROM users
        `);

        // Map role_id to role_name
        const users = rows.map(user => ({
            ...user, role_name: roleMappings[user.role_id],
        }));

        res.status(200).json(users);
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({message: 'Server error fetching users.'});
    }
});
app.post('/users', authenticateAdmin, async (req, res) => {
    const { firstName, lastName, dateOfBirth, username, password, email, roleId } = req.body;

    // Validate inputs
    const newErrors = {};
    if (!firstName) newErrors.firstName = 'First name is required';
    if (!lastName) newErrors.lastName = 'Last name is required';
    if (!dateOfBirth) newErrors.dateOfBirth = 'Date of birth is required';
    if (!username) newErrors.username = 'Username is required';
    if (!password) newErrors.password = 'Password is required'; // Now password is required
    if (!email) newErrors.email = 'Email is required';
    if (!roleId) newErrors.roleId = 'Role is required';

    if (Object.keys(newErrors).length > 0) {
        return res.status(400).json({ message: 'Validation error', errors: newErrors });
    }

    // Validate roleId
    if (!Object.keys(roleMappings).includes(String(roleId))) {
        return res.status(400).json({ message: 'Invalid role_id provided.' });
    }

    try {
        // Hash the password before storing it
        const hashedPassword = await bcrypt.hash(password, 10);

        const sql = `
            INSERT INTO users (first_name, last_name, date_of_birth, username, password, email, role_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `;
        const values = [firstName, lastName, dateOfBirth, username, hashedPassword, email, roleId];

        await db.query(sql, values);
        res.status(201).json({ message: 'User created successfully.' });
    } catch (error) {
        console.error('Error creating user:', error);
        res.status(500).json({ message: 'Server error creating user.' });
    }
});

app.get('/giftshopitems/logs', authenticateAdmin, async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT l.*, u.username, i.name_ AS item_name
            FROM giftshopitem_log l
                     LEFT JOIN users u ON l.user_id = u.user_id
                     LEFT JOIN giftshopitem i ON l.item_id = i.item_id
            ORDER BY l.timestamp DESC
        `);
        res.status(200).json(rows);
    } catch (error) {
        console.error('Error fetching gift shop item logs:', error);
        res.status(500).json({message: 'Server error fetching logs.'});
    }
});
// Get user profile
app.get('/users/:id', authenticateUser, async (req, res) => {
    const {id} = req.params;

    // Ensure the user can only access their own profile or admin can access any
    if (req.userId !== id && req.userRole !== 'admin') {
        return res.status(403).json({message: 'Access denied.'});
    }

    try {
        const [rows] = await db.query(`
            SELECT first_name AS firstName, last_name AS lastName, date_of_birth AS dateOfBirth, username, email
            FROM users
            WHERE user_id = ?
              AND is_deleted = 0
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
// Update user (Admin only)
app.put('/users/:id', authenticateAdmin, async (req, res) => {
    const {id} = req.params;
    const {firstName, lastName, dateOfBirth, email, roleId} = req.body;

    try {
        const sql = `
            UPDATE users
            SET first_name    = ?,
                last_name     = ?,
                date_of_birth = ?,
                email         = ?,
                role_id       = ?
            WHERE user_id = ?
        `;
        const values = [firstName, lastName, dateOfBirth, email, roleId, id];

        await db.query(sql, values);
        res.status(200).json({message: 'User updated successfully.'});
    } catch (error) {
        console.error('Error updating user:', error);
        res.status(500).json({message: 'Server error updating user.'});
    }
});

// Soft delete user (Admin only)
app.put('/users/:id/soft-delete', authenticateAdmin, async (req, res) => {
    const {id} = req.params;

    try {
        const sql = 'UPDATE users SET is_deleted = 1 WHERE user_id = ?';
        await db.query(sql, [id]);
        res.status(200).json({message: 'User soft deleted successfully.'});
    } catch (error) {
        console.error('Error soft deleting user:', error);
        res.status(500).json({message: 'Server error soft deleting user.'});
    }
});

// Hard delete user (Admin only)
app.delete('/users/:id', authenticateAdmin, async (req, res) => {
    const {id} = req.params;

    try {
        const sql = 'DELETE FROM users WHERE user_id = ?';
        await db.query(sql, [id]);
        res.status(200).json({message: 'User hard deleted successfully.'});
    } catch (error) {
        console.error('Error hard deleting user:', error);
        res.status(500).json({message: 'Server error hard deleting user.'});
    }
});
// Restore a user (Admin only)
app.put('/users/:id/restore', authenticateAdmin, async (req, res) => {
    const { id } = req.params;

    try {
        const sql = 'UPDATE users SET is_deleted = 0 WHERE user_id = ?';
        await db.query(sql, [id]);
        res.status(200).json({ message: 'User restored successfully.' });
    } catch (error) {
        console.error('Error restoring user:', error);
        res.status(500).json({ message: 'Server error restoring user.' });
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

// ----- CHECKOUT ENDPOINT ------------------------------------------------------------------------
app.put('/users/:id/change-password', authenticateUser, async (req, res) => {
    const {id} = req.params;
    const {currentPassword, newPassword} = req.body;

    // Ensure the user can only change their own password or admin can change any
    if (req.userId !== id && req.userRole !== 'admin') {
        return res.status(403).json({message: 'Access denied. You can only change your own password.'});
    }

    try {
        const [rows] = await db.query('SELECT password FROM users WHERE user_id = ?', [id]);

        if (rows.length === 0) {
            return res.status(404).json({message: 'User not found.'});
        }

        const user = rows[0];
        const isMatch = await bcrypt.compare(currentPassword, user.password);
        if (!isMatch) {
            return res.status(400).json({message: 'Current password is incorrect.'});
        }

        // Additional Validation: Check if newPassword meets criteria (e.g., length)
        if (newPassword.length < 6) {
            return res.status(400).json({message: 'New password must be at least 6 characters long.'});
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await db.query('UPDATE users SET password = ? WHERE user_id = ?', [hashedPassword, id]);

        res.status(200).json({message: 'Password updated successfully!'});
    } catch (error) {
        console.error('Error updating password:', error);
        res.status(500).json({message: 'Server error updating password.'});
    }
});
// Admin reset password endpoint
app.put('/users/:id/reset-password', authenticateAdmin, async (req, res) => {
    const {id} = req.params;
    const {newPassword} = req.body;

    // Validate the new password
    if (!newPassword || newPassword.length < 6) {
        return res.status(400).json({message: 'New password must be at least 6 characters long.'});
    }

    try {
        // Check if the user exists
        const [rows] = await db.query('SELECT * FROM users WHERE user_id = ?', [id]);

        if (rows.length === 0) {
            return res.status(404).json({message: 'User not found.'});
        }

        // Hash the new password
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // Update the user's password
        await db.query('UPDATE users SET password = ? WHERE user_id = ?', [hashedPassword, id]);

        res.status(200).json({message: 'Password reset successfully!'});
    } catch (error) {
        console.error('Error resetting password:', error);
        res.status(500).json({message: 'Server error resetting password.'});
    }
});
// ----- CHECKOUT ENDPOINT (Assuming other checkout logic is implemented)
app.post('/checkout', authenticateUser, async (req, res) => {
    const {payment_method, items} = req.body;
    const user_id = req.userId; // Retrieved from the authenticateUser middleware

    // Input Validation
    if (!payment_method || !items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({message: 'Invalid request. payment_method and items are required.'});
    }

    for (let item of items) {
        if (!item.item_id || !item.quantity || item.quantity <= 0) {
            return res.status(400).json({message: 'Each item must have a valid item_id and quantity greater than 0.'});
        }
    }

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        // Fetch item details with row locking to prevent race conditions
        const itemIds = items.map(item => item.item_id);
        const [dbItems] = await connection.query(`SELECT item_id, price, quantity
                                                  FROM giftshopitem
                                                  WHERE item_id IN (?)
                                                    AND is_deleted = 0
                                                      FOR UPDATE`, [itemIds]);

        // Check if all items exist
        if (dbItems.length !== items.length) {
            throw new Error('One or more items do not exist or have been deleted.');
        }

        // Check for sufficient inventory and prepare transaction items
        let calculatedSubtotal = 0;
        const transactionItems = [];

        for (let cartItem of items) {
            const dbItem = dbItems.find(item => item.item_id === cartItem.item_id);
            if (dbItem.quantity < cartItem.quantity) {
                throw new Error(`Insufficient quantity for item '${dbItem.item_id}'. Available: ${dbItem.quantity}, Requested: ${cartItem.quantity}.`);
            }
            const itemSubtotal = parseFloat((cartItem.quantity * dbItem.price).toFixed(2));
            calculatedSubtotal += itemSubtotal;
            transactionItems.push({
                item_id: cartItem.item_id,
                quantity: cartItem.quantity,
                price_at_purchase: dbItem.price,
                subtotal: itemSubtotal
            });
        }

        calculatedSubtotal = parseFloat(calculatedSubtotal.toFixed(2));
        const taxRate = 0.0825; // 8.25% tax
        const calculatedTax = parseFloat((calculatedSubtotal * taxRate).toFixed(2));
        const calculatedTotal = parseFloat((calculatedSubtotal + calculatedTax).toFixed(2));

        // Insert into transaction table
        const [transactionResult] = await connection.query(`INSERT INTO \`transaction\` (transaction_date, subtotal,
                                                                                         tax, total_amount,
                                                                                         transaction_type, user_id,
                                                                                         payment_status)
                                                            VALUES (NOW(), ?, ?, ?, ?, ?,
                                                                    ?)`, [calculatedSubtotal, calculatedTax, calculatedTotal, payment_method, user_id, 'completed']);
        const transactionId = transactionResult.insertId;

        // Insert into transaction_giftshopitem table
        const transactionItemsValues = transactionItems.map(item => [transactionId, item.item_id, item.quantity, item.price_at_purchase]);

        await connection.query(`INSERT INTO \`transaction_giftshopitem\` (transaction_id, item_id, quantity, price_at_purchase)
                                VALUES ?`, [transactionItemsValues]);

        // Update giftshopitem quantities
        for (let cartItem of items) {
            await connection.query(`UPDATE giftshopitem
                                    SET quantity = quantity - ?
                                    WHERE item_id = ?`, [cartItem.quantity, cartItem.item_id]);
        }

        // Commit the transaction
        await connection.commit();

        res.status(201).json({
            success: true, message: 'Checkout successful.', transaction_id: transactionId, total_amount: calculatedTotal
        });

    } catch (error) {
        await connection.rollback();
        console.error('Checkout Error:', error.message);
        res.status(400).json({success: false, message: error.message});
    } finally {
        connection.release();
    }
});

// Updated /reports endpoint
app.post('/reports', authenticateAdmin, async (req, res) => {
    const {
        report_type, report_period_type,
        start_date, end_date, selected_month, selected_year,
        selected_date,
        item_category, payment_method, item_id,
    } = req.body;


    // Input Validation
    if (!report_type || !report_period_type) {
        console.error('Validation Error: Missing required fields.');
        return res.status(400).json({
            message: 'report_type and report_period_type are required.',
        });
    }

    // Validate report_period_type and corresponding fields
    if (report_period_type === 'date_range') {
        if (!start_date || !end_date) {
            console.error('Validation Error: Start date and end date are required.');
            return res.status(400).json({
                message: 'Start date and end date are required for date range reports.',
            });
        }
        if (new Date(start_date) > new Date(end_date)) {
            console.error('Validation Error: Start date is after end date.');
            return res.status(400).json({message: 'Start date cannot be after end date.'});
        }
    } else if (report_period_type === 'month') {
        if (!selected_month) {
            console.error('Validation Error: Selected month is required.');
            return res.status(400).json({
                message: 'Selected month is required for monthly reports.',
            });
        }
    } else if (report_period_type === 'year') {
        if (!selected_year) {
            console.error('Validation Error: Selected year is required.');
            return res.status(400).json({
                message: 'Selected year is required for yearly reports.',
            });
        }
    } else if (report_period_type === 'single_day') {
        if (!selected_date) {
            console.error('Validation Error: Selected date is required.');
            return res.status(400).json({
                message: 'Selected date is required for single day reports.',
            });
        }
    } else {
        console.error('Invalid report_period_type:', report_period_type);
        return res.status(400).json({message: 'Invalid report period type.'});
    }

    try {
        let reportData;
        switch (report_type) {
            case 'revenue':
                reportData = await generateGiftShopRevenueReport(report_period_type, start_date, end_date, selected_month, selected_year, selected_date, item_category, payment_method, item_id);
                break;
            case 'transaction_details':
                reportData = await generateGiftShopTransactionDetailsReport(report_period_type, start_date, end_date, selected_month, selected_year, selected_date, item_category, payment_method, item_id);
                break;
            // Add other report types if needed
            default:
                return res.status(400).json({message: 'Invalid report type.'});
        }

        res.status(200).json({reportData});
    } catch (error) {
        console.error('Error generating report:', error); // Debug log with error details
        res.status(500).json({message: 'Server error generating report.'});
    }
});

// Updated Function to generate Gift Shop Revenue Report with filters
async function generateGiftShopRevenueReport(
    reportPeriodType,
    startDate,
    endDate,
    selectedMonth,
    selectedYear,
    selectedDate,
    itemCategory,
    paymentMethod,
    itemId
) {
    let query = '';
    let params = [];

    // Construct the base SQL query based on reportPeriodType
    if (reportPeriodType === 'date_range') {
        // SQL query for date range
        query = `
            SELECT DATE(t.transaction_date) AS date,
                SUM(tgi.quantity * tgi.price_at_purchase) AS total_revenue
            FROM \`transaction\` t
                JOIN transaction_giftshopitem tgi ON t.transaction_id = tgi.transaction_id
                JOIN giftshopitem gsi ON tgi.item_id = gsi.item_id
            WHERE t.transaction_date >= ? AND t.transaction_date <= ?
        `;
        params = [startDate, endDate];
    } else if (reportPeriodType === 'month') {
        // SQL query for month - daily data within the selected month
        query = `
            SELECT DATE(t.transaction_date) AS date,
                SUM(tgi.quantity * tgi.price_at_purchase) AS total_revenue
            FROM \`transaction\` t
                JOIN transaction_giftshopitem tgi ON t.transaction_id = tgi.transaction_id
                JOIN giftshopitem gsi ON tgi.item_id = gsi.item_id
            WHERE DATE_FORMAT(t.transaction_date, '%Y-%m') = ?
        `;
        params = [selectedMonth];
    } else if (reportPeriodType === 'year') {
        // SQL query for year - monthly data within the selected year
        query = `
            SELECT DATE_FORMAT(t.transaction_date, '%Y-%m') AS date,
                   SUM(tgi.quantity * tgi.price_at_purchase) AS total_revenue
            FROM \`transaction\` t
                JOIN transaction_giftshopitem tgi ON t.transaction_id = tgi.transaction_id
                JOIN giftshopitem gsi ON tgi.item_id = gsi.item_id
            WHERE YEAR(t.transaction_date) = ?
        `;
        params = [selectedYear];
    } else if (reportPeriodType === 'single_day') {
        // SQL query for single day - includes item category
        query = `
            SELECT t.transaction_id,
                   t.transaction_date,
                   t.transaction_type,
                   t.payment_status,
                   u.username,
                   tgi.item_id,
                   gsi.name_ AS item_name,
                   gsi.category, -- Include category
                   tgi.quantity,
                   tgi.price_at_purchase,
                   (tgi.quantity * tgi.price_at_purchase) AS item_total
            FROM \`transaction\` t
                     JOIN transaction_giftshopitem tgi ON t.transaction_id = tgi.transaction_id
                     JOIN giftshopitem gsi ON tgi.item_id = gsi.item_id
                     JOIN users u ON t.user_id = u.user_id
            WHERE DATE(t.transaction_date) = ?
        `;
        params = [selectedDate];
    } else {
        throw new Error('Invalid report period type.');
    }

    // Apply multi-select filters if provided
    // Payment Method Filter
    if (paymentMethod && Array.isArray(paymentMethod) && paymentMethod.length > 0) {
        const placeholders = paymentMethod.map(() => '?').join(', ');
        query += ` AND t.transaction_type IN (${placeholders})`;
        params.push(...paymentMethod);
    }

    // Item Category Filter
    if (itemCategory && Array.isArray(itemCategory) && itemCategory.length > 0) {
        const placeholders = itemCategory.map(() => '?').join(', ');
        query += ` AND gsi.category IN (${placeholders})`;
        params.push(...itemCategory);
    }

    // Item ID Filter
    if (itemId && Array.isArray(itemId) && itemId.length > 0) {
        const placeholders = itemId.map(() => '?').join(', ');
        query += ` AND tgi.item_id IN (${placeholders})`;
        params.push(...itemId);
    }

    // Grouping and Ordering
    if (reportPeriodType === 'date_range' || reportPeriodType === 'month') {
        query += `
            GROUP BY DATE(t.transaction_date)
            ORDER BY DATE(t.transaction_date) ASC
        `;
    } else if (reportPeriodType === 'year') {
        query += `
            GROUP BY DATE_FORMAT(t.transaction_date, '%Y-%m')
            ORDER BY DATE_FORMAT(t.transaction_date, '%Y-%m') ASC
        `;
    }
    // No grouping needed for 'single_day'


    try {
        // Execute the query with parameters
        const [rows] = await db.query(query, params);

        // Debug Log (optional - remove in production)

        return rows;
    } catch (error) {
        // Log the error details
        console.error('Error in generateGiftShopRevenueReport:', error);
        throw error; // Propagate the error to be handled by the caller
    }
}
async function generateGiftShopTransactionDetailsReport(reportPeriodType, startDate, endDate, selectedMonth, selectedYear, selectedDate, itemCategory, paymentMethod, itemId) {
    let query = '';
    let params = [];

    if (reportPeriodType === 'date_range') {
        // SQL query for date range
        query = `
            SELECT t.transaction_id,
                   t.transaction_date,
                   t.transaction_type,
                   t.payment_status,
                   u.username,
                   tgi.item_id,
                   gsi.name_ AS item_name,
                   tgi.quantity,
                   tgi.price_at_purchase,
                   (tgi.quantity * tgi.price_at_purchase) AS item_total
            FROM \`transaction\` t
                     JOIN transaction_giftshopitem tgi ON t.transaction_id = tgi.transaction_id
                     JOIN giftshopitem gsi ON tgi.item_id = gsi.item_id
                     JOIN users u ON t.user_id = u.user_id
            WHERE t.transaction_date >= ? AND t.transaction_date <= ?
        `;
        params = [startDate, endDate];
    } else if (reportPeriodType === 'month') {
        // SQL query for month
        query = `
            SELECT t.transaction_id,
                   t.transaction_date,
                   t.transaction_type,
                   t.payment_status,
                   u.username,
                   tgi.item_id,
                   gsi.name_ AS item_name,
                   tgi.quantity,
                   tgi.price_at_purchase,
                   (tgi.quantity * tgi.price_at_purchase) AS item_total
            FROM \`transaction\` t
                     JOIN transaction_giftshopitem tgi ON t.transaction_id = tgi.transaction_id
                     JOIN giftshopitem gsi ON tgi.item_id = gsi.item_id
                     JOIN users u ON t.user_id = u.user_id
            WHERE DATE_FORMAT(t.transaction_date, '%Y-%m') = ?
        `;
        params = [selectedMonth];
    } else if (reportPeriodType === 'year') {
        // SQL query for year
        query = `
            SELECT t.transaction_id,
                   t.transaction_date,
                   t.transaction_type,
                   t.payment_status,
                   u.username,
                   tgi.item_id,
                   gsi.name_ AS item_name,
                   tgi.quantity,
                   tgi.price_at_purchase,
                   (tgi.quantity * tgi.price_at_purchase) AS item_total
            FROM \`transaction\` t
                     JOIN transaction_giftshopitem tgi ON t.transaction_id = tgi.transaction_id
                     JOIN giftshopitem gsi ON tgi.item_id = gsi.item_id
                     JOIN users u ON t.user_id = u.user_id
            WHERE YEAR(t.transaction_date) = ?
        `;
        params = [selectedYear];
    } else if (reportPeriodType === 'single_day') {
        // SQL query for single day
        query = `
            SELECT t.transaction_id,
                   t.transaction_date,
                   t.transaction_type,
                   t.payment_status,
                   u.username,
                   tgi.item_id,
                   gsi.name_ AS item_name,
                   tgi.quantity,
                   tgi.price_at_purchase,
                   (tgi.quantity * tgi.price_at_purchase) AS item_total
            FROM \`transaction\` t
                     JOIN transaction_giftshopitem tgi ON t.transaction_id = tgi.transaction_id
                     JOIN giftshopitem gsi ON tgi.item_id = gsi.item_id
                     JOIN users u ON t.user_id = u.user_id
            WHERE DATE(t.transaction_date) = ?
        `;
        params = [selectedDate];
    } else {
        throw new Error('Invalid report period type for transaction details report.');
    }

    // Apply filters if provided
    if (paymentMethod && paymentMethod.length > 0) {
        query += ` AND t.transaction_type IN (${paymentMethod.map(() => '?').join(', ')})`;
        params.push(...paymentMethod);
    }
    if (itemCategory && itemCategory.length > 0) {
        query += ` AND gsi.category IN (${itemCategory.map(() => '?').join(', ')})`;
        params.push(...itemCategory);
    }
    if (itemId && itemId.length > 0) {
        query += ` AND tgi.item_id IN (${itemId.map(() => '?').join(', ')})`;
        params.push(...itemId);
    }

    // Order by transaction date
    query += `
        ORDER BY t.transaction_date
    `;

    try {
        const [rows] = await db.query(query, params);
        return rows;
    } catch (error) {
        console.error('Error in generateGiftShopTransactionDetailsReport:', error);
        throw error;
    }
}
// Endpoint to get all gift shop items
app.get('/giftshopitemsreport', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT item_id, name_ FROM giftshopitem WHERE is_deleted = 0');
        res.status(200).json(rows);
    } catch (error) {
        console.error('Error fetching gift shop items:', error);
        res.status(500).json({message: 'Server error fetching gift shop items.'});
    }
});

// Endpoint to get all gift shop categories
app.get('/giftshopcategories', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT DISTINCT category FROM giftshopitem WHERE is_deleted = 0');
        res.status(200).json(rows);
    } catch (error) {
        console.error('Error fetching item categories:', error);
        res.status(500).json({message: 'Server error fetching item categories.'});
    }
});

// Endpoint to get all payment methods used in transactions
app.get('/paymentmethods', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT DISTINCT transaction_type FROM `transaction`');
        res.status(200).json(rows);
    } catch (error) {
        console.error('Error fetching payment methods:', error);
        res.status(500).json({message: 'Server error fetching payment methods.'});
    }
});
// Create a new announcement (Admin only)
app.post('/announcements', authenticateUser, async (req, res) => {
    const {title, content, target_audience, priority} = req.body;

    // Only admin can create announcements
    if (req.userRole !== 'admin') {
        return res.status(403).json({message: 'Access denied. Only admins can create announcements.'});
    }

    // Validate inputs
    if (!title || !content || !target_audience || !priority) {
        return res.status(400).json({message: 'Title, content, target audience, and priority are required.'});
    }

    // Validate target_audience
    const validAudiences = ['staff', 'member', 'customer', 'all'];
    if (!validAudiences.includes(target_audience)) {
        return res.status(400).json({message: 'Invalid target audience.'});
    }

    // Validate priority
    const validPriorities = ['high', 'medium', 'low'];
    if (!validPriorities.includes(priority)) {
        return res.status(400).json({message: 'Invalid priority value.'});
    }

    try {
        const sql = `
            INSERT INTO announcements (title, content, target_audience, priority)
            VALUES (?, ?, ?, ?)
        `;
        const values = [title, content, target_audience, priority];
        await db.query(sql, values);
        res.status(201).json({message: 'Announcement created successfully.'});
    } catch (error) {
        console.error('Error creating announcement:', error);
        res.status(500).json({message: 'Server error creating announcement.'});
    }
});

// Get all announcements (including deleted) for admin
app.get('/announcements/all', authenticateUser, async (req, res) => {
    // Only admins can access this endpoint
    if (req.userRole !== 'admin') {
        return res.status(403).json({message: 'Access denied. Admins only.'});
    }

    try {
        const [rows] = await db.query('SELECT * FROM announcements ORDER BY created_at DESC');
        res.status(200).json(rows);
    } catch (error) {
        console.error('Error fetching announcements:', error);
        res.status(500).json({message: 'Server error fetching announcements.'});
    }
});

// Get announcements for a user based on their role
app.get('/announcements/user', authenticateUser, async (req, res) => {
    const {userRole} = req;

    try {
        const sql = `
            SELECT *
            FROM announcements
            WHERE (target_audience = ? OR target_audience = 'all')
              AND is_active = 1
            ORDER BY created_at DESC
        `;
        const values = [userRole];

        const [rows] = await db.query(sql, values);
        res.status(200).json(rows);
    } catch (error) {
        console.error('Error fetching user announcements:', error);
        res.status(500).json({message: 'Server error fetching announcements.'});
    }
});

// Update an announcement (Admin only)
app.put('/announcements/:id', authenticateUser, async (req, res) => {
    const {id} = req.params;
    const {title, content, target_audience, priority} = req.body;

    // Only admin can update announcements
    if (req.userRole !== 'admin') {
        return res.status(403).json({message: 'Access denied. Only admins can update announcements.'});
    }

    // Validate inputs
    if (!title || !content || !target_audience || !priority) {
        return res.status(400).json({message: 'Title, content, target audience, and priority are required.'});
    }

    // Validate target_audience
    const validAudiences = ['staff', 'member', 'customer', 'all'];
    if (!validAudiences.includes(target_audience)) {
        return res.status(400).json({message: 'Invalid target audience.'});
    }

    // Validate priority
    const validPriorities = ['high', 'medium', 'low'];
    if (!validPriorities.includes(priority)) {
        return res.status(400).json({message: 'Invalid priority value.'});
    }

    try {
        const sql = `
            UPDATE announcements
            SET title           = ?,
                content         = ?,
                target_audience = ?,
                priority        = ?
            WHERE id = ?
        `;
        const values = [title, content, target_audience, priority, id];

        const [result] = await db.query(sql, values);
        if (result.affectedRows === 0) {
            return res.status(404).json({message: 'Announcement not found.'});
        }

        res.json({message: 'Announcement updated successfully.'});
    } catch (error) {
        console.error('Error updating announcement:', error);
        res.status(500).json({message: 'Server error updating announcement.'});
    }
});

// Soft delete an announcement (Admin only)
app.delete('/announcements/:id', authenticateUser, async (req, res) => {
    const {id} = req.params;

    // Only admin can delete announcements
    if (req.userRole !== 'admin') {
        return res.status(403).json({message: 'Access denied. Only admins can delete announcements.'});
    }

    try {
        const sql = `
            UPDATE announcements
            SET is_active = 0
            WHERE id = ?
        `;
        const [result] = await db.query(sql, [id]);
        if (result.affectedRows === 0) {
            return res.status(404).json({message: 'Announcement not found.'});
        }

        res.json({message: 'Announcement deleted successfully.'});
    } catch (error) {
        console.error('Error deleting announcement:', error);
        res.status(500).json({message: 'Server error deleting announcement.'});
    }
});

// Restore a soft-deleted announcement (Admin only)
app.put('/announcements/:id/restore', authenticateUser, async (req, res) => {
    const {id} = req.params;

    // Only admin can restore announcements
    if (req.userRole !== 'admin') {
        return res.status(403).json({message: 'Access denied. Only admins can restore announcements.'});
    }

    try {
        const sql = `
            UPDATE announcements
            SET is_active = 1
            WHERE id = ?
        `;
        const [result] = await db.query(sql, [id]);
        if (result.affectedRows === 0) {
            return res.status(404).json({message: 'Announcement not found.'});
        }

        res.json({message: 'Announcement restored successfully.'});
    } catch (error) {
        console.error('Error restoring announcement:', error);
        res.status(500).json({message: 'Server error restoring announcement.'});
    }
});
// Endpoint to handle ticket purchases
app.post('/ticket-purchase', async (req, res) => {
    const { payment_method, tickets } = req.body;
    const user_id = req.userId; // Retrieved from the authenticateUser middleware

    // Input Validation
    if (!payment_method || !tickets || !Array.isArray(tickets) || tickets.length === 0) {
        return res.status(400).json({ message: 'Invalid request. payment_method and tickets are required.' });
    }

    for (let ticket of tickets) {
        if (!ticket.ticket_type_id || !ticket.quantity || ticket.quantity <= 0 || !ticket.visit_date) {
            return res.status(400).json({ message: 'Each ticket must have a valid ticket_type_id, quantity greater than 0, and visit_date.' });
        }
    }

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        // Fetch ticket types with current prices
        const ticketTypeIds = tickets.map(ticket => ticket.ticket_type_id);
        const [dbTickets] = await connection.query(
            `SELECT ticket_type_id, price FROM ticket WHERE ticket_type_id IN (?)`,
            [ticketTypeIds]
        );

        // Check if all ticket types exist
        if (dbTickets.length !== tickets.length) {
            throw new Error('One or more ticket types do not exist.');
        }

        let calculatedSubtotal = 0;
        const transactionTickets = [];

        for (let cartTicket of tickets) {
            const dbTicket = dbTickets.find(ticket => ticket.ticket_type_id === cartTicket.ticket_type_id);
            const ticketSubtotal = parseFloat((cartTicket.quantity * dbTicket.price).toFixed(2));
            calculatedSubtotal += ticketSubtotal;
            transactionTickets.push({
                ticket_type_id: cartTicket.ticket_type_id,
                quantity: cartTicket.quantity,
                price_at_purchase: dbTicket.price,
                subtotal: ticketSubtotal,
                visit_date: cartTicket.visit_date,
            });
        }

        calculatedSubtotal = parseFloat(calculatedSubtotal.toFixed(2));
        const taxRate = 0.0825; // 8.25% tax
        const calculatedTax = parseFloat((calculatedSubtotal * taxRate).toFixed(2));
        const calculatedTotal = parseFloat((calculatedSubtotal + calculatedTax).toFixed(2));

        // Insert into transaction table
        const [transactionResult] = await connection.query(
            `INSERT INTO \`transaction\` (transaction_date, subtotal, tax, total_amount, transaction_type, user_id, payment_status)
             VALUES (NOW(), ?, ?, ?, ?, ?, ?)`,
            [calculatedSubtotal, calculatedTax, calculatedTotal, payment_method, user_id, 'completed']
        );
        const transactionId = transactionResult.insertId;

        // Insert into transaction_ticket table
        const transactionTicketsValues = transactionTickets.map(ticket => [
            transactionId,
            ticket.ticket_type_id,
            ticket.quantity,
            ticket.price_at_purchase,
        ]);
        await connection.query(
            `INSERT INTO transaction_ticket (transaction_id, ticket_type_id, quantity, price_at_purchase)
             VALUES ?`,
            [transactionTicketsValues]
        );

        // Insert individual tickets into bought_tickets
        const boughtTicketsValues = [];
        for (let ticket of transactionTickets) {
            for (let i = 0; i < ticket.quantity; i++) {
                boughtTicketsValues.push([
                    ticket.ticket_type_id,
                    user_id,
                    transactionId,
                    ticket.visit_date,
                    ticket.price_at_purchase,
                ]);
            }
        }
        await connection.query(
            `INSERT INTO bought_tickets (ticket_type_id, user_id, transaction_id, visit_date, price_at_purchase)
       VALUES ?`,
            [boughtTicketsValues]
        );

        // Commit the transaction
        await connection.commit();

        res.status(201).json({
            success: true,
            message: 'Ticket purchase successful.',
            transaction_id: transactionId,
            total_amount: calculatedTotal,
        });
    } catch (error) {
        await connection.rollback();
        console.error('Ticket Purchase Error:', error.message);
        res.status(400).json({ success: false, message: error.message });
    } finally {
        connection.release();
    }
});

app.get('/users/:id/tickets', async (req, res) => {
    const userId = req.params.id;

    try {
        const query = `
            SELECT
                bt.ticket_id,
                bt.ticket_type_id,
                bt.visit_date,
                bt.price_at_purchase,
                t.admission_type,
                t.price_category,
                tr.transaction_date,
                tr.transaction_id
            FROM bought_tickets bt
                     JOIN ticket t ON bt.ticket_type_id = t.ticket_type_id
                     JOIN \`transaction\` tr ON bt.transaction_id = tr.transaction_id
            WHERE bt.user_id = ?
            ORDER BY bt.visit_date DESC
        `;
        const [rows] = await db.query(query, [userId]);
        res.status(200).json(rows);
    } catch (error) {
        console.error('Error fetching user tickets:', error);
        res.status(500).json({ message: 'Server error fetching user tickets.' });
    }
});
// Server-side code to fetch ticket types
app.get('/ticket-types', async (req, res) => {
    try {
        const [ticketTypes] = await db.query('SELECT * FROM ticket');
        res.json(ticketTypes);
    } catch (error) {
        console.error('Error fetching ticket types:', error);
        res.status(500).json({ message: 'Server error fetching ticket types.' });
    }
});
app.post('/cancel-membership', async (req, res) => {
    const userId = req.headers['user-id'];

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        // Check if the user has an active membership
        const [activeMembership] = await connection.query(
            'SELECT * FROM membership WHERE user_id = ? AND status = ?',
            [userId, 'active']
        );

        if (activeMembership.length === 0) {
            await connection.rollback();
            connection.release();
            return res.status(400).json({ error: 'No active membership found to cancel' });
        }

        // Update the membership status to 'canceled' and set canceled_at
        await connection.query(
            'UPDATE membership SET status = ?, canceled_at = NOW() WHERE membership_id = ?',
            ['canceled', activeMembership[0].membership_id]
        );

        // Update user's role back to 'customer' (assuming role_id for 'customer' is 3)
        await connection.query('UPDATE users SET role_id = ? WHERE user_id = ?', [3, userId]);

        await connection.commit();
        connection.release();

        res.status(200).json({ message: 'Membership canceled successfully' });
    } catch (error) {
        await connection.rollback();
        connection.release();
        console.error('Error canceling membership:', error);
        res.status(500).json({
            error: 'Internal server error during membership cancellation: ' + error.message,
        });
    }
});
app.get('/get-membership-info', authenticateUser, async (req, res) => {
    const userId = req.headers['user-id'];

    try {
        const [membership] = await db.query(
            'SELECT * FROM membership WHERE user_id = ? AND status = ?',
            [userId, 'active']
        );

        if (membership.length === 0) {
            return res.status(404).json({ error: 'No active membership found' });
        }

        res.status(200).json({ membership: membership[0] });
    } catch (error) {
        console.error('Error fetching membership info:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
app.get('/membership-types', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT DISTINCT type_of_membership FROM membership');
        res.status(200).json(rows);
    } catch (error) {
        console.error('Error fetching membership types:', error);
        res.status(500).json({ message: 'Server error fetching membership types.' });
    }
});
app.post('/membership-reports', async (req, res) => {
    const {
        report_type,
        report_period_type,
        start_date,
        end_date,
        selected_month,
        selected_year,
        selected_date,
        membership_type,
        payment_method,
    } = req.body;

    // Input Validation
    if (!report_type || !report_period_type) {
        return res.status(400).json({
            message: 'report_type and report_period_type are required.',
        });
    }

    // Additional validation based on report_period_type...

    try {
        let reportData;
        switch (report_type) {
            case 'revenue':
                reportData = await generateMembershipRevenueReport(
                    report_period_type,
                    start_date,
                    end_date,
                    selected_month,
                    selected_year,
                    selected_date,
                    membership_type,
                    payment_method
                );
                break;
            case 'transaction_details':
                reportData = await generateMembershipTransactionDetailsReport(
                    report_period_type,
                    start_date,
                    end_date,
                    selected_month,
                    selected_year,
                    selected_date,
                    membership_type,
                    payment_method
                );
                break;
            case 'membership_counts':
                reportData = await generateMembershipCountsReport(
                    report_period_type,
                    start_date,
                    end_date,
                    selected_month,
                    selected_year,
                    selected_date
                );
                break;
            default:
                return res.status(400).json({ message: 'Invalid report type.' });
        }

        res.status(200).json({ reportData });
    } catch (error) {
        console.error('Error generating membership report:', error);
        res.status(500).json({ message: 'Server error generating report.' });
    }
});
async function generateMembershipRevenueReport(
    reportPeriodType,
    startDate,
    endDate,
    selectedMonth,
    selectedYear,
    selectedDate,
    membershipType,
    paymentMethod
) {
    let query = '';
    let params = [];

    // Build base query based on reportPeriodType
    if (reportPeriodType === 'date_range') {
        query = `
            SELECT DATE(t.transaction_date) AS date, SUM(t.total_amount) AS total_revenue
            FROM \`transaction\` t
                JOIN transaction_membership tm ON t.transaction_id = tm.transaction_id
                JOIN membership m ON tm.membership_id = m.membership_id
            WHERE t.transaction_date >= ? AND t.transaction_date <= ?
        `;
        params = [startDate, endDate];
    } else if (reportPeriodType === 'month') {
        query = `
            SELECT DATE(t.transaction_date) AS date, SUM(t.total_amount) AS total_revenue
            FROM \`transaction\` t
                JOIN transaction_membership tm ON t.transaction_id = tm.transaction_id
                JOIN membership m ON tm.membership_id = m.membership_id
            WHERE DATE_FORMAT(t.transaction_date, '%Y-%m') = ?
        `;
        params = [selectedMonth];
    } else if (reportPeriodType === 'year') {
        query = `
            SELECT DATE_FORMAT(t.transaction_date, '%Y-%m') AS date, SUM(t.total_amount) AS total_revenue
            FROM \`transaction\` t
                JOIN transaction_membership tm ON t.transaction_id = tm.transaction_id
                JOIN membership m ON tm.membership_id = m.membership_id
            WHERE YEAR(t.transaction_date) = ?
        `;
        params = [selectedYear];
    } else if (reportPeriodType === 'single_day') {
        query = `
            SELECT t.transaction_id,
                   t.transaction_date,
                   t.transaction_type,
                   t.payment_status,
                   t.subtotal,
                   t.tax,
                   t.total_amount,
                   u.username,
                   m.type_of_membership,
                   m.membership_price
            FROM \`transaction\` t
                     JOIN transaction_membership tm ON t.transaction_id = tm.transaction_id
                     JOIN membership m ON tm.membership_id = m.membership_id
                     JOIN users u ON t.user_id = u.user_id
            WHERE DATE(t.transaction_date) = ?
        `;
        params = [selectedDate];
    } else {
        throw new Error('Invalid report period type for membership revenue report.');
    }

    // Apply filters if provided
    if (membershipType && Array.isArray(membershipType) && membershipType.length > 0) {
        query += ` AND m.type_of_membership IN (${membershipType.map(() => '?').join(', ')})`;
        params.push(...membershipType.map(type => type.toLowerCase()));
    }
    if (paymentMethod && Array.isArray(paymentMethod) && paymentMethod.length > 0) {
        query += ` AND t.transaction_type IN (${paymentMethod.map(() => '?').join(', ')})`;
        params.push(...paymentMethod);
    }

    // Group and order the results based on reportPeriodType...
    if (reportPeriodType === 'date_range' || reportPeriodType === 'month') {
        query += `
            GROUP BY DATE(t.transaction_date)
            ORDER BY DATE(t.transaction_date)
        `;
    } else if (reportPeriodType === 'year') {
        query += `
            GROUP BY DATE_FORMAT(t.transaction_date, '%Y-%m')
            ORDER BY DATE_FORMAT(t.transaction_date, '%Y-%m')
        `;
    }


    try {
        const [rows] = await db.query(query, params);
        return rows;
    } catch (error) {
        console.error('Error in generateMembershipRevenueReport:', error);
        throw error;
    }
}
async function generateMembershipTransactionDetailsReport(
    reportPeriodType,
    startDate,
    endDate,
    selectedMonth,
    selectedYear,
    selectedDate,
    membershipType,
    paymentMethod
) {
    let query = '';
    let params = [];

    // Build base query based on reportPeriodType
    if (reportPeriodType === 'date_range') {
        query = `
            SELECT t.transaction_id,
                   t.transaction_date,
                   t.transaction_type,
                   t.payment_status,
                   u.username,
                   m.type_of_membership,
                   m.membership_price
            FROM \`transaction\` t
                     JOIN transaction_membership tm ON t.transaction_id = tm.transaction_id
                     JOIN membership m ON tm.membership_id = m.membership_id
                     JOIN users u ON t.user_id = u.user_id
            WHERE t.transaction_date >= ? AND t.transaction_date <= ?
        `;
        params = [startDate, endDate];
    } else if (reportPeriodType === 'month') {
        query = `
            SELECT t.transaction_id,
                   t.transaction_date,
                   t.transaction_type,
                   t.payment_status,
                   u.username,
                   m.type_of_membership,
                   m.membership_price
            FROM \`transaction\` t
                     JOIN transaction_membership tm ON t.transaction_id = tm.transaction_id
                     JOIN membership m ON tm.membership_id = m.membership_id
                     JOIN users u ON t.user_id = u.user_id
            WHERE DATE_FORMAT(t.transaction_date, '%Y-%m') = ?
        `;
        params = [selectedMonth];
    } else if (reportPeriodType === 'year') {
        query = `
            SELECT t.transaction_id,
                   t.transaction_date,
                   t.transaction_type,
                   t.payment_status,
                   u.username,
                   m.type_of_membership,
                   m.membership_price
            FROM \`transaction\` t
                     JOIN transaction_membership tm ON t.transaction_id = tm.transaction_id
                     JOIN membership m ON tm.membership_id = m.membership_id
                     JOIN users u ON t.user_id = u.user_id
            WHERE YEAR(t.transaction_date) = ?
        `;
        params = [selectedYear];
    } else if (reportPeriodType === 'single_day') {
        query = `
            SELECT t.transaction_id,
                   t.transaction_date,
                   t.transaction_type,
                   t.payment_status,
                   u.username,
                   m.type_of_membership,
                   m.membership_price
            FROM \`transaction\` t
                     JOIN transaction_membership tm ON t.transaction_id = tm.transaction_id
                     JOIN membership m ON tm.membership_id = m.membership_id
                     JOIN users u ON t.user_id = u.user_id
            WHERE DATE(t.transaction_date) = ?
        `;
        params = [selectedDate];
    } else {
        throw new Error('Invalid report period type for membership transaction details report.');
    }

    // Apply filters if provided
    if (membershipType && Array.isArray(membershipType) && membershipType.length > 0) {
        query += ` AND m.type_of_membership IN (${membershipType.map(() => '?').join(', ')})`;
        params.push(...membershipType.map(type => type.toLowerCase()));
    }
    if (paymentMethod && Array.isArray(paymentMethod) && paymentMethod.length > 0) {
        query += ` AND t.transaction_type IN (${paymentMethod.map(() => '?').join(', ')})`;
        params.push(...paymentMethod);
    }

    // Order the results
    query += ' ORDER BY t.transaction_date';

    try {
        const [rows] = await db.query(query, params);
        return rows;
    } catch (error) {
        console.error('Error in generateMembershipTransactionDetailsReport:', error);
        throw error;
    }
}

async function generateMembershipCountsReport(
    reportPeriodType,
    startDate,
    endDate,
    selectedMonth,
    selectedYear,
    selectedDate
) {
    let queryNew = '';
    let queryCanceled = '';
    let paramsNew = [];
    let paramsCanceled = [];

    if (reportPeriodType === 'date_range') {
        // New memberships
        queryNew = `
            SELECT DATE(m.created_at) AS date, COUNT(*) AS new_memberships
            FROM membership m
            WHERE m.created_at >= ? AND m.created_at <= ?
            GROUP BY DATE(m.created_at)
            ORDER BY DATE(m.created_at)
        `;
        paramsNew = [startDate, endDate];

        // Canceled memberships
        queryCanceled = `
            SELECT DATE(m.canceled_at) AS date, COUNT(*) AS canceled_memberships
            FROM membership m
            WHERE m.canceled_at >= ? AND m.canceled_at <= ?
            GROUP BY DATE(m.canceled_at)
            ORDER BY DATE(m.canceled_at)
        `;
        paramsCanceled = [startDate, endDate];
    } else if (reportPeriodType === 'month') {
        // New memberships
        queryNew = `
            SELECT DATE(m.created_at) AS date, COUNT(*) AS new_memberships
            FROM membership m
            WHERE DATE_FORMAT(m.created_at, '%Y-%m') = ?
            GROUP BY DATE(m.created_at)
            ORDER BY DATE(m.created_at)
        `;
        paramsNew = [selectedMonth];

        // Canceled memberships
        queryCanceled = `
            SELECT DATE(m.canceled_at) AS date, COUNT(*) AS canceled_memberships
            FROM membership m
            WHERE DATE_FORMAT(m.canceled_at, '%Y-%m') = ?
            GROUP BY DATE(m.canceled_at)
            ORDER BY DATE(m.canceled_at)
        `;
        paramsCanceled = [selectedMonth];
    } else if (reportPeriodType === 'year') {
        // New memberships
        queryNew = `
            SELECT DATE_FORMAT(m.created_at, '%Y-%m') AS date, COUNT(*) AS new_memberships
            FROM membership m
            WHERE YEAR(m.created_at) = ?
            GROUP BY DATE_FORMAT(m.created_at, '%Y-%m')
            ORDER BY DATE_FORMAT(m.created_at, '%Y-%m')
        `;
        paramsNew = [selectedYear];

        // Canceled memberships
        queryCanceled = `
            SELECT DATE_FORMAT(m.canceled_at, '%Y-%m') AS date, COUNT(*) AS canceled_memberships
            FROM membership m
            WHERE YEAR(m.canceled_at) = ?
            GROUP BY DATE_FORMAT(m.canceled_at, '%Y-%m')
            ORDER BY DATE_FORMAT(m.canceled_at, '%Y-%m')
        `;
        paramsCanceled = [selectedYear];
    } else if (reportPeriodType === 'single_day') {
        // New memberships
        queryNew = `
            SELECT DATE(m.created_at) AS date, COUNT(*) AS new_memberships
            FROM membership m
            WHERE DATE(m.created_at) = ?
            GROUP BY DATE(m.created_at)
            ORDER BY DATE(m.created_at)
        `;
        paramsNew = [selectedDate];

        // Canceled memberships
        queryCanceled = `
            SELECT DATE(m.canceled_at) AS date, COUNT(*) AS canceled_memberships
            FROM membership m
            WHERE DATE(m.canceled_at) = ?
            GROUP BY DATE(m.canceled_at)
            ORDER BY DATE(m.canceled_at)
        `;
        paramsCanceled = [selectedDate];
    } else {
        throw new Error('Invalid report period type for membership counts report.');
    }

    try {
        const [newMembershipsRows] = await db.query(queryNew, paramsNew);
        const [canceledMembershipsRows] = await db.query(queryCanceled, paramsCanceled);

        // Merge the results
        const mergedResults = [];

        const dateMap = {};

        newMembershipsRows.forEach(row => {
            const date = row.date;
            dateMap[date] = {
                date: date,
                new_memberships: row.new_memberships,
                canceled_memberships: 0
            };
        });

        canceledMembershipsRows.forEach(row => {
            const date = row.date;
            if (dateMap[date]) {
                dateMap[date].canceled_memberships = row.canceled_memberships;
            } else {
                dateMap[date] = {
                    date: date,
                    new_memberships: 0,
                    canceled_memberships: row.canceled_memberships
                };
            }
        });

        // Convert the dateMap to an array and sort by date
        for (let date in dateMap) {
            mergedResults.push(dateMap[date]);
        }

        mergedResults.sort((a, b) => new Date(a.date) - new Date(b.date));


        return mergedResults;
    } catch (error) {
        console.error('Error in generateMembershipCountsReport:', error);
        throw error;
    }
}
// Route to get email logs
app.get('/email-logs', async (req, res) => {
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);

        const [rows] = await connection.execute(`
            SELECT eq.*, si.supplier_name, si.supplier_email 
            FROM email_queue eq
            JOIN supplier_items si ON eq.supplier_id = si.supplier_item_id
            ORDER BY eq.created_at DESC
        `);
        res.json(rows);
    } catch (error) {
        console.error('Error fetching email logs:', error);
        res.status(500).json({ error: 'Failed to fetch email logs' });
    } finally {
        if (connection) {
            await connection.end();
        }
    }
});
// ----- (LEO DONE) --------------------------------------------------------------------------------

// ----- (MUNA) ------------------------------------------------------------------------------------
app.get('/api/member/profile', authenticateUser, async (req, res) => {
    const memberId = req.userId;  // `authenticateUser` middleware attaches userId to req
    try {
        const [result] = await db.query('SELECT first_name, last_name FROM users WHERE user_id = ?', [memberId]);
        if (result.length > 0) {
            const member = result[0];
            res.json({firstName: member.first_name, lastName: member.last_name});
        } else {
            res.status(404).json({error: 'Member not found'});
        }
    } catch (error) {
        res.status(500).json({error: 'Database error'});
    }
});
// (Assuming MUNA's endpoints are already correctly implemented)
// ----- (MUNA DONE) ------------------------------------------------------------------------------

// ----- (TYLER) ----------------------------------------------------------------------------------
// Add a new event
app.post('/api/events', async (req, res) => {
    const {name, description, location, status, start_date, end_date} = req.body;
    try {
        const [result] = await db.query('INSERT INTO event_ (name_, description_, location, status, start_date, end_date) VALUES (?, ?, ?, ?, ?, ?)', [name, description, location, status, start_date, end_date]);
        res.json({id: result.insertId, message: 'Event added successfully.'});
    } catch (error) {
        console.error('Error adding event:', error);
        res.status(500).json({message: 'Server error adding event.'});
    }
});

// Update event information
app.put('/api/events/:id', async (req, res) => {
    const {id} = req.params;
    const {name, description, location, status, start_date, end_date} = req.body;

    const allowedStatuses = ['upcoming', 'ongoing', 'completed'];
    if (!allowedStatuses.includes(status)) {
        return res.status(400).json({message: 'Invalid status value.'});
    }

    try {
        const [result] = await db.query('UPDATE event_ SET name_ = ?, description_ = ?, location = ?, status = ?, start_date = ?, end_date = ? WHERE event_id = ?', [name, description, location, status, start_date, end_date, id]);

        if (result.affectedRows === 0) {
            return res.status(404).json({message: 'Event not found.'});
        }
        res.json({message: 'Event updated successfully.'});
    } catch (error) {
        console.error('Error updating event:', error);
        res.status(500).json({message: 'Server error updating event.'});
    }
})

// Soft delete an event
app.delete('/api/events/:id', async (req, res) => {
    const eventId = req.params.id;
    try {
        const [result] = await db.query('UPDATE event_ SET is_deleted = TRUE WHERE event_id = ?', [eventId]);
        if (result.affectedRows === 0) {
            return res.status(404).json({message: 'Event not found.'});
        }
        res.json({message: 'Event deleted successfully.'});
    } catch (error) {
        console.error('Error deleting event:', error);
        res.status(500).json({message: 'Server error deleting event.'});
    }
})

// Fetch all non-deleted events from the database
app.get('/api/events', async (req, res) => {
    try {
        const [result] = await db.query('SELECT * FROM event_ WHERE is_deleted = FALSE');
        res.json(result);
    } catch (error) {
        console.error('Error fetching events:', error);
        res.status(500).json({message: 'Server error fetching events.'});
    }
})

// Fetch the total number of members that signed up for an event
app.get('/api/events/:id/members', async (req, res) => {
    const eventId = req.params.id;
    try {
        const [result] = await db.query(`SELECT DISTINCT membership.fname, membership.lname
                                         FROM events_transaction
                                                  JOIN membership
                                                       ON events_transaction.membership_id = membership.membership_id
                                         WHERE event_id = ?`, [eventId]);
        res.json(result);
    } catch (error) {
        console.error('Error fetching members:', error);
        res.status(500).json({message: 'Server error fetching members.'});
    }
});

// Fetch report data for all events
app.get('/api/events/report', async (req, res) => {
    const { minRevenue, maxRevenue, minMembers, maxMembers } = req.query;
    let query = 'SELECT eventName, totalMembersSignedUp, totalRevenue FROM EventReport WHERE 1=1';
    let queryParams = [];

    if (minRevenue) {
        query += ' AND totalRevenue >= ?';
        queryParams.push(minRevenue);
    }
    if (maxRevenue) {
        query += ' AND totalRevenue <= ?';
        queryParams.push(maxRevenue);
    }
    if (minMembers) {
        query += ' AND totalMembersSignedUp >= ?';
        queryParams.push(minMembers);
    }
    if (maxMembers) {
        query += ' AND totalMembersSignedUp <= ?';
        queryParams.push(maxMembers);
    }

    try {
        const [result] = await db.query(query, queryParams);
        if (result.length === 0) {
            return res.status(404).json({ message: 'No reports found for the specified criteria.' });
        }
        res.json(result);
    } catch (error) {
        console.error('Error fetching event report:', error);
        res.status(500).json({message: 'Server error fetching event report.'});
    }
});

// ----- (TYLER DONE) ---------------------------------------------------------------------------------

// ----- (DENNIS) ---------------------------------------------------------------------------------
// Keep middleware minimal - only check what's needed for access control
async function authenticateMembershipAccess(req, res, next) {
    const userId = req.headers['user-id'];
    const role = req.headers['role'];

    if (!userId || !role) {
        return res.status(401).json({ message: 'Please log in first.' });
    }

    try {
        // Only get what we need for authentication
        const [user] = await db.query(
            'SELECT role_id, is_deleted FROM users WHERE user_id = ?',
            [userId]
        );

        if (user.length === 0 || user[0].is_deleted === 1) {
            return res.status(403).json({ message: 'User not found or deleted.' });
        }

        if (user[0].role_id === 4) {
            return res.status(403).json({ message: 'Already a member.' });
        }

        if (user[0].role_id !== 3) {
            return res.status(403).json({ message: 'Only customers can become members.' });
        }

        next();
    } catch (error) {
        console.error('Error in authenticateMembershipAccess middleware:', error);
        res.status(500).json({ message: 'Server error during authentication.' });
    }
}
app.post('/membership-registration', authenticateMembershipAccess, async (req, res) => {
    const userId = req.headers['user-id'];
    const { first_name, last_name, type_of_membership, membership_price } = req.body;

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        // Check if user already has an active membership
        const [activeMembership] = await connection.query(
            'SELECT * FROM membership WHERE user_id = ? AND status = ?',
            [userId, 'active']
        );

        if (activeMembership.length > 0) {
            await connection.rollback();
            connection.release();
            return res.status(400).json({ error: 'User already has an active membership' });
        }

        // Check for canceled memberships
        const [canceledMembership] = await connection.query(
            'SELECT * FROM membership WHERE user_id = ? AND status = ?',
            [userId, 'canceled']
        );

        let membershipId;
        if (canceledMembership.length > 0) {
            // Reactivate the canceled membership
            const expirationDate = new Date();
            expirationDate.setFullYear(expirationDate.getFullYear() + 1);

            await connection.query(
                `UPDATE membership SET status = ?, canceled_at = NULL, expire_date = ?, type_of_membership = ?, membership_price = ? WHERE membership_id = ?`,
                [
                    'active',
                    expirationDate.toISOString().slice(0, 19).replace('T', ' '),
                    type_of_membership.toLowerCase(),
                    membership_price,
                    canceledMembership[0].membership_id,
                ]
            );

            membershipId = canceledMembership[0].membership_id;
        } else {
            // Create a new membership
            const expirationDate = new Date();
            expirationDate.setFullYear(expirationDate.getFullYear() + 1);

            const insertMembershipQuery = `
                INSERT INTO membership
                (user_id, type_of_membership, membership_price, expire_date, expiration_warning, fname, lname, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `;

            const insertMembershipParams = [
                userId,
                type_of_membership.toLowerCase(),
                membership_price,
                expirationDate.toISOString().slice(0, 19).replace('T', ' '),
                0,
                first_name,
                last_name,
                'active',
            ];


            const [membershipResult] = await connection.query(insertMembershipQuery, insertMembershipParams);

            membershipId = membershipResult.insertId;
        }

        // Calculate transaction amounts with 8.25% tax
        const subtotal = parseFloat(membership_price);
        const taxRate = 0.0825; // 8.25% tax rate
        const tax = parseFloat((subtotal * taxRate).toFixed(2));
        const totalAmount = parseFloat((subtotal + tax).toFixed(2));

        // Insert into transaction table
        const insertTransactionQuery = `
            INSERT INTO transaction
            (user_id, transaction_date, subtotal, tax, total_amount, transaction_type, payment_status)
            VALUES (?, NOW(), ?, ?, ?, 'credit', 'completed')
        `;

        const insertTransactionParams = [userId, subtotal, tax, totalAmount];

        const [transactionResult] = await connection.query(insertTransactionQuery, insertTransactionParams);

        const transactionId = transactionResult.insertId;

        // Insert into transaction_membership table
        const insertTransactionMembershipQuery = `
            INSERT INTO transaction_membership (transaction_id, membership_id)
            VALUES (?, ?)
        `;

        const insertTransactionMembershipParams = [transactionId, membershipId];

        await connection.query(insertTransactionMembershipQuery, insertTransactionMembershipParams);

        // Update user's role to 'member' (assuming role_id for 'member' is 4)
        await connection.query('UPDATE users SET role_id = ? WHERE user_id = ?', [4, userId]);

        await connection.commit();
        connection.release();

        res.status(201).json({ message: 'Membership registration successful' });
    } catch (error) {
        await connection.rollback();
        connection.release();
        console.error('Error in membership registration:', error);
        res.status(500).json({
            error: 'Internal server error during membership registration: ' + error.message,
        });
    }
});


// Altered Leo's login backend to accomodate for membership expiration alert trigger


// (Assuming DENNIS's endpoints are already correctly implemented)
// ----- (DENNIS DONE) ----------------------------------------------------------------------------
// ----- (MUNA & MELANIE REPORT) ------------------------------------------------------------------
app.get('/ticket', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM ticket');
        res.json(rows);
    } catch (error) {
        console.error('Error fetching ticket table:', error);
        res.status(500).json({ message: 'Server error fetching ticket table.' });
    }
});

app.get('/user-type', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM roles WHERE id = 3 OR id = 4');
        res.json(rows);
    } catch (error) {
        console.error('Error fetching roles table:', error);
        res.status(500).json({ message: 'Server error fetching roles table.' });
    }
});

// Updated /reports/tickets endpoint
app.post('/reports-tickets' , /*authenticateAdmin,*/ async (req, res) => {
    const {
        report_type,
        reportPeriodType,
        selected_month,
        start_date,
        end_date,
        selected_year,
        selected_date,
        price_category,
        user_type_id,
        payment_method
    } = req.body;


    //Input Validation
    if (!report_type || !reportPeriodType) {
        console.error('Validation Error: Missing required fields.');
        return res.status(400).json({
            message: 'report_type, and report_period_type are required.',
        });
    }

    // Validate report_period_type and corresponding fields
    if (reportPeriodType === 'date_range') {
        if (!start_date || !end_date) {
            console.error('Validation Error: Start date and end date are required.');
            return res.status(400).json({
                message: 'Start date and end date are required for date range reports.',
            });
        }
        if (new Date(start_date) > new Date(end_date)) {
            console.error('Validation Error: Start date is after end date.');
            return res.status(400).json({message: 'Start date cannot be after end date.'});
        }
    } else if (reportPeriodType === 'month') {
        if (!selected_month) {
            console.error('Validation Error: Selected month is required.');
            return res.status(400).json({
                message: 'Selected month is required for monthly reports.',
            });
        }
    } else if (reportPeriodType === 'year') {
        if (!selected_year) {
            console.error('Validation Error: Selected year is required.');
            return res.status(400).json({
                message: 'Selected year is required for yearly reports.',
            });
        }
    } else if (reportPeriodType === 'single_day') {
        if (!selected_date) {
            console.error('Validation Error: Selected date is required.');
            return res.status(400).json({
                message: 'Selected date is required for single day reports.',
            });
        }
    } else {
        console.error('Invalid report_period_type:', reportPeriodType);
        return res.status(400).json({message: 'Invalid report period type.'});
    }

    try {
        let reportData;
        switch (report_type) {
            case 'revenue':
                reportData = await generateTotalRevenueReport(
                    reportPeriodType,
                    start_date,
                    end_date,
                    selected_month,
                    selected_year,
                    selected_date,
                    price_category,
                    user_type_id,
                    payment_method
                )
                break;
            case 'tickets':
                reportData = await generateTotalTicketsReport(
                    reportPeriodType,
                    start_date,
                    end_date,
                    selected_month,
                    selected_year,
                    selected_date,
                    price_category,
                    user_type_id,
                    payment_method
                )
                break;
            case 'transaction_details':
                reportData = await generateTicketTransactionDetailsReport(
                    reportPeriodType,
                    start_date,
                    end_date,
                    selected_month,
                    selected_year,
                    selected_date,
                    price_category,
                    user_type_id,
                    payment_method
                );
                break;
            // Add other report types if needed
            default:
                console.error('Invalid report type:', report_type);
                return res.status(400).json({message: 'Invalid report type.'});
        }
        res.json(reportData);

    } catch (error) {
        console.error('Error generating report:', error.message);
        return res.status(500).json({ message: 'Internal server error while generating report.', error: error.message });
    }
});

async function generateTotalRevenueReport(reportPeriodType, startDate, endDate, selectedMonth, selectedYear, selectedDate, priceCategory, user_type_id, payment_method) {
    let query = '';
    let params = [];

    if (reportPeriodType === 'date_range') {
        // SQL query for date range
        query = `
            SELECT DATE (t.transaction_date) AS date, SUM (tt.quantity * tt.price_at_purchase) AS total_revenue
            FROM \`transaction\` t
                JOIN transaction_ticket tt ON t.transaction_id = tt.transaction_id
                JOIN ticket ti ON tt.ticket_type_id = ti.ticket_type_id
                JOIN users u ON t.user_id = u.user_id
                JOIN roles r ON u.role_id = r.id
            WHERE t.transaction_date >= ? AND t.transaction_date < DATE_ADD(?, INTERVAL 1 DAY)
        `;
        params = [startDate, endDate];
    } else if (reportPeriodType === 'month') {
        // SQL query for month - daily data within the selected month
        query = `
            SELECT DATE (t.transaction_date) AS date, SUM (tt.quantity * tt.price_at_purchase) AS total_revenue
            FROM \`transaction\` t
                JOIN transaction_ticket tt ON t.transaction_id = tt.transaction_id
                JOIN ticket ti ON tt.ticket_type_id = ti.ticket_type_id
                JOIN users u ON t.user_id = u.user_id
                JOIN roles r ON u.role_id = r.id
            WHERE DATE_FORMAT(t.transaction_date, '%Y-%m') = ?
        `;
        params = [selectedMonth];
    } else if (reportPeriodType === 'year') {
        // SQL query for year - monthly data within the selected year
        query = `
            SELECT DATE_FORMAT(t.transaction_date, '%Y-%m') AS date, SUM(tt.quantity * tt.price_at_purchase) AS total_revenue
            FROM \`transaction\` t
                JOIN transaction_ticket tt ON t.transaction_id = tt.transaction_id
                JOIN ticket ti ON tt.ticket_type_id = ti.ticket_type_id
                JOIN users u ON t.user_id = u.user_id
                JOIN roles r ON u.role_id = r.id
            WHERE YEAR (t.transaction_date) = ?
        `;
        params = [selectedYear];
    } else if (reportPeriodType === 'single_day') {
        query = `
            SELECT t.transaction_id,
                t.transaction_date,
                t.transaction_type,
                t.payment_status,
                u.username,
                r.role_name,
                tt.ticket_type_id,
                ti.price_category,
                tt.quantity,
                tt.price_at_purchase,
                (tt.quantity * tt.price_at_purchase) AS item_total
            FROM \`transaction\` t
                    JOIN transaction_ticket tt ON t.transaction_id = tt.transaction_id
                    JOIN ticket ti ON tt.ticket_type_id = ti.ticket_type_id
                    JOIN users u ON t.user_id = u.user_id
                    JOIN roles r ON u.role_id = r.id
            WHERE DATE (t.transaction_date) = ?
        `;
        params = [selectedDate];
    } else {
        throw new Error('Invalid report period type for transaction details report.');
    }

// Apply filters if provided
    if (payment_method) {
        query += ' AND t.transaction_type = ?';
        params.push(payment_method);
    }
    if (priceCategory && Array.isArray(priceCategory)) {
        query += ' AND ti.price_category IN (?)';
        params.push(priceCategory.length > 1 ? priceCategory : priceCategory[0]);
    }
    if (user_type_id) {
        query += ' AND u.role_id = ?';
        params.push(user_type_id);
    }

// Group by appropriate time period
    if (reportPeriodType === 'date_range' || reportPeriodType === 'month') {
        query += `
            GROUP BY DATE(t.transaction_date)
        `;
    } else if (reportPeriodType === 'year') {
        query += `
            GROUP BY DATE_FORMAT(t.transaction_date, '%Y-%m')
        `;
    }


    try {
        const [rows] = await db.query(query, params);
        return rows;
    } catch (error) {
        console.error('Error in generateTotalRevenueReport:', error); // Debug log with error details
        throw error;
    }
}

async function generateTotalTicketsReport(reportPeriodType, startDate, endDate, selectedMonth, selectedYear, selectedDate, priceCategory, user_type_id, payment_method) {
    let query = '';
    let params = [];

    if (reportPeriodType === 'date_range') {
        // SQL query for date range
        query = `
            SELECT DATE(t.transaction_date) AS date, SUM(tt.quantity) AS total_tickets
            FROM \`transaction\` t
                JOIN transaction_ticket tt ON t.transaction_id = tt.transaction_id
                JOIN ticket ti ON tt.ticket_type_id = ti.ticket_type_id
                JOIN users u ON t.user_id = u.user_id
                JOIN roles r ON u.role_id = r.id
            WHERE t.transaction_date >= ? AND t.transaction_date < DATE_ADD(?, INTERVAL 1 DAY)
        `;
        params = [startDate, endDate];
    } else if (reportPeriodType === 'month') {
        // SQL query for month - daily data within the selected month
        query = `
            SELECT DATE(t.transaction_date) AS date, SUM(tt.quantity) AS total_tickets
            FROM \`transaction\` t
                JOIN transaction_ticket tt ON t.transaction_id = tt.transaction_id
                JOIN ticket ti ON tt.ticket_type_id = ti.ticket_type_id
                JOIN users u ON t.user_id = u.user_id
                JOIN roles r ON u.role_id = r.id
            WHERE DATE_FORMAT(t.transaction_date, '%Y-%m') = ?
        `;
        params = [selectedMonth];
    } else if (reportPeriodType === 'year') {
        // SQL query for year - monthly data within the selected year
        query = `
            SELECT DATE_FORMAT(t.transaction_date, '%Y-%m') AS date, SUM(tt.quantity) AS total_tickets
            FROM \`transaction\` t
                JOIN transaction_ticket tt ON t.transaction_id = tt.transaction_id
                JOIN ticket ti ON tt.ticket_type_id = ti.ticket_type_id
                JOIN users u ON t.user_id = u.user_id
                JOIN roles r ON u.role_id = r.id
            WHERE YEAR(t.transaction_date) = ?
        `;
        params = [selectedYear];
    } else if (reportPeriodType === 'single_day') {
        query = `
            SELECT t.transaction_id,
                t.transaction_date,
                t.transaction_type,
                t.payment_status,
                u.username,
                r.role_name,
                tt.ticket_type_id,
                ti.price_category,
                tt.quantity
            FROM \`transaction\` t
                    JOIN transaction_ticket tt ON t.transaction_id = tt.transaction_id
                    JOIN ticket ti ON tt.ticket_type_id = ti.ticket_type_id
                    JOIN users u ON t.user_id = u.user_id
                    JOIN roles r ON u.role_id = r.id
            WHERE DATE(t.transaction_date) = ?
        `;
        params = [selectedDate];
    } else {
        throw new Error('Invalid report period type for ticket count report.');
    }

    // Apply filters if provided
    if (payment_method) {
        query += ' AND t.transaction_type = ?';
        params.push(payment_method);
    }
    if (priceCategory && Array.isArray(priceCategory)) {
        query += ' AND ti.price_category IN (?)';
        params.push(priceCategory.length > 1 ? priceCategory : priceCategory[0]);
    }
    if (user_type_id) {
        query += ' AND u.role_id = ?';
        params.push(user_type_id);
    }

    // Group by appropriate time period
    if (reportPeriodType === 'date_range' || reportPeriodType === 'month') {
        query += `
            GROUP BY DATE(t.transaction_date)
        `;
    } else if (reportPeriodType === 'year') {
        query += `
            GROUP BY DATE_FORMAT(t.transaction_date, '%Y-%m')
        `;
    }

    try {
        const [rows] = await db.query(query, params);
        return rows;
    } catch (error) {
        console.error('Error in generateTotalTicketsReport:', error); // Debug log with error details
        throw error;
    }
}

async function generateTicketTransactionDetailsReport(reportPeriodType, startDate, endDate, selectedMonth, selectedYear, selectedDate, priceCategory, paymentMethod, ticketTypeId) {
    let query = '';
    let params = [];

    if (reportPeriodType === 'date_range') {
        // SQL query for date range
        query = `
            SELECT t.transaction_id,
                   t.transaction_date,
                   t.transaction_type,
                   t.payment_status,
                   u.username,
                   tt.ticket_type_id,
                   ti.price_category,
                   tt.quantity,
                   tt.price_at_purchase,
                   (tt.quantity * tt.price_at_purchase) AS item_total
            FROM \`transaction\` t
            JOIN transaction_ticket tt ON t.transaction_id = tt.transaction_id
            JOIN ticket ti ON tt.ticket_type_id = ti.ticket_type_id
            JOIN users u ON t.user_id = u.user_id
            WHERE t.transaction_date >= ? AND t.transaction_date <= ?
        `;
        params = [startDate, endDate];
    } else if (reportPeriodType === 'month') {
        // SQL query for month
        query = `
            SELECT t.transaction_id,
                   t.transaction_date,
                   t.transaction_type,
                   t.payment_status,
                   u.username,
                   tt.ticket_type_id,
                   ti.price_category,
                   tt.quantity,
                   tt.price_at_purchase,
                   (tt.quantity * tt.price_at_purchase) AS item_total
            FROM \`transaction\` t
            JOIN transaction_ticket tt ON t.transaction_id = tt.transaction_id
            JOIN ticket ti ON tt.ticket_type_id = ti.ticket_type_id
            JOIN users u ON t.user_id = u.user_id
            WHERE DATE_FORMAT(t.transaction_date, '%Y-%m') = ?
        `;
        params = [selectedMonth];
    } else if (reportPeriodType === 'year') {
        // SQL query for year
        query = `
            SELECT t.transaction_id,
                   t.transaction_date,
                   t.transaction_type,
                   t.payment_status,
                   u.username,
                   tt.ticket_type_id,
                   ti.price_category,
                   tt.quantity,
                   tt.price_at_purchase,
                   (tt.quantity * tt.price_at_purchase) AS item_total
            FROM \`transaction\` t
            JOIN transaction_ticket tt ON t.transaction_id = tt.transaction_id
            JOIN ticket ti ON tt.ticket_type_id = ti.ticket_type_id
            JOIN users u ON t.user_id = u.user_id
            WHERE YEAR(t.transaction_date) = ?
        `;
        params = [selectedYear];
    } else if (reportPeriodType === 'single_day') {
        // SQL query for single day
        query = `
            SELECT t.transaction_id,
                   t.transaction_date,
                   t.transaction_type,
                   t.payment_status,
                   u.username,
                   tt.ticket_type_id,
                   ti.price_category,
                   tt.quantity,
                   tt.price_at_purchase,
                   (tt.quantity * tt.price_at_purchase) AS item_total
            FROM \`transaction\` t
            JOIN transaction_ticket tt ON t.transaction_id = tt.transaction_id
            JOIN ticket ti ON tt.ticket_type_id = ti.ticket_type_id
            JOIN users u ON t.user_id = u.user_id
            WHERE DATE(t.transaction_date) = ?
        `;
        params = [selectedDate];
    } else {
        throw new Error('Invalid report period type for ticket transaction details report.');
    }

    // Apply filters if provided
    if (paymentMethod) {
        query += ' AND t.transaction_type = ?';
        params.push(paymentMethod);
    }
    if (priceCategory && Array.isArray(priceCategory)) {
        query += ' AND ti.price_category IN (?)';
        params.push(priceCategory.length > 1 ? priceCategory : priceCategory[0]);
    }
    if (ticketTypeId) {
        query += ' AND tt.ticket_type_id = ?';
        params.push(ticketTypeId);
    }

    // Order by transaction date
    query += `
        ORDER BY t.transaction_date
    `;

    try {
        const [rows] = await db.query(query, params);
        return rows;
    } catch (error) {
        console.error('Error in generateTicketTransactionDetailsReport:', error);
        throw error;
    }
}

// ----- (MUNA & MELANIE REPORT DONE) ----------------------------------------------------------------------------
export default app;
