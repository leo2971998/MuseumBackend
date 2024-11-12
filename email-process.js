const mysql = require('mysql2/promise');
const nodemailer = require('nodemailer');

const dbConfig = {
  host: 'museumcosc3380.mysql.database.azure.com',
  user: 'Dennis',
  password: 'StrongPassword123',
  database: 'museum'
};

// Email configuration
const emailConfig = {
  smtp: {
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
      user: 'museumgiftshop123@gmail.com',
      pass: 'tqxo woip lctq fvzk'  // google app password
    }
  },
  from: {
    name: 'Museum Gift Shop',
    address: 'museumgiftshop123@gmail.com'
  }
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
                        `
          };

          // Send email
          await transporter.sendMail(mailOptions);

          // Mark as processed
          await connection.execute(`
                        UPDATE email_queue 
                        SET processed = 1,
                            processed_at = NOW() 
                        WHERE id = ?
                    `, [email.id]);

          console.log(`Successfully sent email to ${email.supplier_email} for ${email.item_name}`);
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

async function checkAndProcessEmails() {
  console.log('Email processor started. Checking every 30 seconds...');

  while (true) {
    try {
      await processEmails();
      console.log('Waiting 30 seconds before next check...');
      await new Promise(resolve => setTimeout(resolve, 30000)); // Wait 30 seconds
    } catch (error) {
      console.error('Error in check loop:', error);
      console.log('Retrying in 30 seconds...');
      await new Promise(resolve => setTimeout(resolve, 30000)); // Wait even on error
    }
  }
}

// Start the continuous checking
checkAndProcessEmails()
    .catch(error => {
      console.error('Fatal error in main loop:', error);
      process.exit(1);
    });

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down gracefully...');
  process.exit(0);
});
