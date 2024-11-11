// email-process.js

const mysql = require('mysql2/promise');
const nodemailer = require('nodemailer');
require('dotenv').config();

// Database configuration
const dbConfig = {
  host: process.env.DB_HOST,       // e.g., 'museumcosc3380.mysql.database.azure.com'
  user: process.env.DB_USER,       // e.g., 'Dennis'
  password: process.env.DB_PASS,   // e.g., 'StrongPassword123'
  database: process.env.DB_NAME,   // e.g., 'museum'
};

// Email configuration
const emailConfig = {
  smtp: {
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
      user: process.env.EMAIL_USER, // e.g., 'museumgiftshop123@gmail.com'
      pass: process.env.EMAIL_PASS, // e.g., 'tqxo woip lctq fvzk' (Google App Password)
    },
  },
  from: {
    name: 'Museum Gift Shop',
    address: process.env.EMAIL_USER,
  },
};

// Function to process emails
async function processEmails() {
  let connection;
  try {
    // Establish database connection
    connection = await mysql.createConnection(dbConfig);
    console.log('Database connection established.');

    // Create email transporter
    const transporter = nodemailer.createTransport(emailConfig.smtp);
    console.log('Email transporter created.');

    // Fetch unprocessed emails
    const [emails] = await connection.execute(`
      SELECT eq.*, si.supplier_name, si.supplier_email 
      FROM email_queue eq
      JOIN supplier_items si ON eq.supplier_id = si.supplier_item_id
      WHERE eq.processed = 0
      ORDER BY eq.created_at ASC
    `);
    console.log(`Fetched ${emails.length} unprocessed emails.`);

    if (emails.length > 0) {
      for (const email of emails) {
        try {
          // Define email options
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
          console.log(`Email sent to ${email.supplier_email} for ${email.item_name}.`);

          // Mark email as processed
          await connection.execute(
            `
            UPDATE email_queue 
            SET processed = 1,
                processed_at = NOW() 
            WHERE id = ?
          `,
            [email.id]
          );
          console.log(`Email ID ${email.id} marked as processed.`);
        } catch (emailError) {
          console.error(`Error processing email ID ${email.id}:`, emailError);
        }
      }
    } else {
      console.log('No new emails to process.');
    }
  } catch (error) {
    console.error('Error in processEmails:', error);
  } finally {
    if (connection) {
      await connection.end();
      console.log('Database connection closed.');
    }
  }
}

// Export the handler function for Vercel
module.exports = async (req, res) => {
  console.log('Email processing function triggered.');
  try {
    await processEmails();
    res.status(200).json({ message: 'Emails processed successfully.' });
    console.log('Emails processed successfully.');
  } catch (error) {
    console.error('Error processing emails:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};
