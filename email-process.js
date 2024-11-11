// email-process.js

const mysql = require('mysql2/promise');
const nodemailer = require('nodemailer');
require('dotenv').config();

// Database configuration
const dbConfig = {
  host: 'museumcosc3380.mysql.database.azure.com',
  user: 'Dennis',
  password: 'StrongPassword123',
  database: 'museum',
};

// Email configuration
const emailConfig = {
  smtp: {
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
      user: 'museumgiftshop123@gmail.com',
      pass: 'tqxo woip lctq fvzk', // Google App Password
    },
  },
  from: {
    name: 'Museum Gift Shop',
    address: 'museumgiftshop123@gmail.com',
  },
};

async function processEmails() {
  let connection;
  try {
    // Create database connection
    connection = await mysql.createConnection(dbConfig);

    // Create email transporter
    const transporter = nodemailer.createTransport(emailConfig.smtp);

    // Get unprocessed emails
    const [emails] = await connection.execute(`
      SELECT eq.*, si.supplier_name, si.supplier_email 
      FROM email_queue eq
      JOIN supplier_items si ON eq.supplier_id = si.supplier_item_id
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
    console.error('Error:', error);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

// Export the handler function for Vercel
module.exports = async (req, res) => {
  try {
    await processEmails();
    res.status(200).json({ message: 'Emails processed successfully.' });
  } catch (error) {
    console.error('Error processing emails:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};
