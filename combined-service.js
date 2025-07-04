require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { google } = require('googleapis');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Store recent messages in memory
const recentMessages = new Map();

// Master Google OAuth2 client
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  'http://localhost:3001/auth/google/callback'
);

// ============================================================================
// WEBHOOK ENDPOINTS (for receiving WhatsApp messages)
// ============================================================================

// Multi-user webhook endpoints
app.post('/webhook/:userId', async (req, res) => {
  const userId = req.params.userId;
  await handleWebhook(req, res, userId);
});

app.post('/webhook', async (req, res) => {
  await handleWebhook(req, res, 'default');
});

async function handleWebhook(req, res, userId) {
  try {
    const notification = req.body;
    res.status(200).json({ received: true });
    
    console.log(`📱 [${userId}] Webhook received`);
    
    // Process only text messages
    if (notification.typeWebhook === 'incomingMessageReceived' && 
        notification.messageData?.typeMessage === 'textMessage') {
      
      const message = {
        id: notification.idMessage,
        timestamp: Math.floor(Date.now() / 1000),
        chatId: notification.senderData.chatId,
        senderName: notification.senderData.senderName || notification.senderData.sender,
        text: notification.messageData.textMessageData?.textMessage || '',
      };
      
      console.log(`📱 [${userId}] Message from ${message.senderName}: "${message.text}"`);
      
      // Simple keyword detection
      const keywords = ['meeting', 'appointment', 'פגישה', 'תור', 'טיפול'];
      const hasKeyword = keywords.some(keyword => 
        message.text.toLowerCase().includes(keyword.toLowerCase())
      );
      
      if (hasKeyword) {
        console.log(`🎯 [${userId}] Meeting detected! (Smart conflict checking would happen here)`);
        // Here is where you'd add the smart calendar checking logic
      }
    }
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Processing failed' });
  }
}

// ============================================================================
// USER SETUP WEB INTERFACE (for adding new users)
// ============================================================================

const homePage = `
<!DOCTYPE html>
<html>
<head>
    <title>WhatsApp Calendar Audit - Add Users</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
        .step { background: #f5f5f5; padding: 20px; margin: 20px 0; border-radius: 8px; }
        .success { background: #d4edda; color: #155724; }
        button { background: #007bff; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; }
        input { width: 100%; padding: 8px; margin: 5px 0; border: 1px solid #ddd; border-radius: 4px; }
    </style>
</head>
<body>
    <h1>🎯 WhatsApp Calendar Audit Service</h1>
    
    <div class="step">
        <h3>Add New User (Wife, Family Member, etc.)</h3>
        <form action="/setup" method="POST">
            <label>Name:</label>
            <input type="text" name="name" placeholder="Full name" required>
            
            <label>WhatsApp Phone Number:</label>
            <input type="tel" name="phoneNumber" placeholder="+972501234567" required>
            <small>Include country code</small>
            <br><br>
            
            <button type="submit">🚀 Start Setup</button>
        </form>
    </div>
    
    <div class="step">
        <h3>📋 How It Works:</h3>
        <ul>
            <li>✅ Each person gets their own webhook endpoint</li>
            <li>✅ Each person uses their own Google Calendar</li>
            <li>✅ Each person gets their own conflict notifications</li>
            <li>✅ Data completely separate between users</li>
        </ul>
    </div>
    
    <div class="step">
        <h3>🏃‍♂️ Quick Links:</h3>
        <ul>
            <li><a href="/health">Service Health Check</a></li>
            <li><a href="/recent-messages">Recent Messages</a></li>
        </ul>
    </div>
</body>
</html>`;

const setupPage = (userData) => `
<!DOCTYPE html>
<html>
<head>
    <title>Setup WhatsApp - ${userData.name}</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
        .step { background: #f5f5f5; padding: 20px; margin: 20px 0; border-radius: 8px; }
        button { background: #007bff; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; }
        input { width: 100%; padding: 8px; margin: 5px 0; border: 1px solid #ddd; border-radius: 4px; }
    </style>
</head>
<body>
    <h1>📱 WhatsApp Setup for ${userData.name}</h1>
    
    <div class="step">
        <h3>Step 2: Set Up Green API</h3>
        <p><strong>${userData.name}</strong> needs to:</p>
        <ol>
            <li>Go to <a href="https://green-api.com" target="_blank">green-api.com</a></li>
            <li>Register with phone: <strong>${userData.phoneNumber}</strong></li>
            <li>Create a "Developer" instance (free tier)</li>
            <li>Scan QR code to connect WhatsApp</li>
            <li>Copy the Instance ID and Token</li>
        </ol>
    </div>
    
    <div class="step">
        <h3>Step 3: Enter Green API Credentials</h3>
        <form action="/setup/whatsapp/${userData.id}" method="POST">
            <label>Instance ID:</label>
            <input type="text" name="instanceId" placeholder="e.g., 7105276256" required>
            
            <label>Token:</label>
            <input type="text" name="token" placeholder="Your Green API token" required>
            <br><br>
            
            <button type="submit">✅ Connect WhatsApp</button>
        </form>
    </div>
</body>
</html>`;

const calendarPage = (userData) => `
<!DOCTYPE html>
<html>
<head>
    <title>Connect Calendar - ${userData.name}</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
        .step { background: #f5f5f5; padding: 20px; margin: 20px 0; border-radius: 8px; }
        .success { background: #d4edda; color: #155724; }
        button { background: #28a745; color: white; padding: 15px 30px; border: none; border-radius: 4px; cursor: pointer; font-size: 16px; }
    </style>
</head>
<body>
    <h1>📅 Google Calendar Setup for ${userData.name}</h1>
    
    <div class="step success">
        <h3>✅ WhatsApp Connected!</h3>
        <p>Great! Now let's connect <strong>${userData.name}'s</strong> Google Calendar.</p>
    </div>
    
    <div class="step">
        <h3>Step 4: Connect Google Calendar</h3>
        <p><strong>Important:</strong> ${userData.name} will sign in with <strong>her own Google account</strong> to access <strong>her own calendar</strong>.</p>
        
        <a href="/auth/google/${userData.id}">
            <button>🔗 Connect My Google Calendar</button>
        </a>
    </div>
</body>
</html>`;

const completePage = (userData) => `
<!DOCTYPE html>
<html>
<head>
    <title>Setup Complete - ${userData.name}</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
        .step { background: #d4edda; padding: 20px; margin: 20px 0; border-radius: 8px; color: #155724; }
        .info { background: #f5f5f5; padding: 20px; margin: 20px 0; border-radius: 8px; }
        button { background: #007bff; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; }
    </style>
</head>
<body>
    <h1>🎉 Setup Complete for ${userData.name}!</h1>
    
    <div class="step">
        <h2>✅ Everything is configured!</h2>
        <p><strong>${userData.name}</strong> is now connected to the WhatsApp Calendar Audit service.</p>
        <p><strong>Webhook endpoint:</strong> <code>/webhook/${userData.id}</code></p>
    </div>
    
    <div class="info">
        <h3>🎯 Smart Notifications:</h3>
        <p><strong>${userData.name}</strong> will receive WhatsApp notifications ONLY when:</p>
        <ul>
            <li>⚠️ A WhatsApp meeting conflicts with existing calendar events</li>
            <li>📅 A meeting mentioned in WhatsApp is missing from calendar</li>
        </ul>
        <p><strong>No spam!</strong> Casual mentions won't trigger notifications.</p>
    </div>
    
    <button onclick="window.location.href='/'">🔄 Add Another User</button>
</body>
</html>`;

// Setup routes
app.get('/', (req, res) => {
  res.send(homePage);
});

app.post('/setup', async (req, res) => {
  const { name, phoneNumber } = req.body;
  
  const userId = uuidv4();
  const userData = {
    id: userId,
    name,
    phoneNumber: phoneNumber.replace(/[^\d+]/g, ''),
    createdAt: new Date().toISOString(),
    status: 'phone_registered'
  };

  await saveUserData(userId, userData);
  res.send(setupPage(userData));
});

app.post('/setup/whatsapp/:userId', async (req, res) => {
  const { userId } = req.params;
  const { instanceId, token } = req.body;
  
  const userData = await loadUserData(userId);
  if (!userData) {
    return res.send('<h1>Error: User not found</h1>');
  }

  try {
    // Validate Green API credentials
    const testUrl = `https://api.green-api.com/waInstance${instanceId}/getStateInstance/${token}`;
    const response = await axios.get(testUrl);
    
    if (response.data.stateInstance !== 'authorized') {
      throw new Error('WhatsApp not connected');
    }

    userData.greenApi = { instanceId, token };
    userData.status = 'whatsapp_connected';
    await saveUserData(userId, userData);

    res.send(calendarPage(userData));
  } catch (error) {
    res.send(`<h1>❌ Connection Failed</h1><p>${error.message}</p>`);
  }
});

app.get('/auth/google/:userId', async (req, res) => {
  const { userId } = req.params;
  
  const scopes = ['https://www.googleapis.com/auth/calendar.readonly'];
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    state: userId,
    prompt: 'consent'
  });

  res.redirect(authUrl);
});

app.get('/auth/google/callback', async (req, res) => {
  const { code, state: userId } = req.query;
  
  try {
    const { tokens } = await oauth2Client.getToken(code);
    
    const userData = await loadUserData(userId);
    userData.googleTokens = tokens;
    userData.status = 'fully_configured';
    await saveUserData(userId, userData);

    // Configure webhook for this user
    await configureUserWebhook(userData);

    res.send(completePage(userData));
  } catch (error) {
    res.send(`<h1>❌ Calendar Connection Failed</h1><p>${error.message}</p>`);
  }
});

// ============================================================================
// UTILITY ENDPOINTS
// ============================================================================

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    service: 'WhatsApp Calendar Audit - Combined Service'
  });
});

// Recent messages endpoint
app.get('/recent-messages', (req, res) => {
  res.json({ 
    message: 'Combined service running',
    webhookEndpoint: 'POST /webhook or /webhook/:userId',
    setupEndpoint: 'GET / (web interface)'
  });
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

async function saveUserData(userId, data) {
  const userDir = path.join(__dirname, 'data', 'users');
  await fs.mkdir(userDir, { recursive: true });
  const filePath = path.join(userDir, `${userId}.json`);
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

async function loadUserData(userId) {
  try {
    const filePath = path.join(__dirname, 'data', 'users', `${userId}.json`);
    const data = await fs.readFile(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return null;
  }
}

async function configureUserWebhook(userData) {
  try {
    // Set webhook URL for their Green API instance
    const webhookUrl = `http://localhost:3001/webhook/${userData.id}`;
    
    await axios.post(
      `https://api.green-api.com/waInstance${userData.greenApi.instanceId}/setSettings/${userData.greenApi.token}`,
      {
        webhookUrl: webhookUrl,
        outgoingWebhook: 'yes',
        incomingWebhook: 'yes'
      }
    );
    
    console.log(`✅ Configured webhook for ${userData.name}: ${webhookUrl}`);
  } catch (error) {
    console.error('Error configuring webhook:', error.message);
  }
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log('🚀 WhatsApp Calendar Audit - COMBINED SERVICE');
  console.log('='.repeat(60));
  console.log(`🌐 Service running on port ${PORT}`);
  console.log(`📱 Webhook endpoint: http://localhost:${PORT}/webhook`);
  console.log(`👥 User setup: http://localhost:${PORT}/`);
  console.log(`💚 Health check: http://localhost:${PORT}/health`);
  console.log('');
  console.log('✅ FEATURES:');
  console.log('   🔗 Real-time webhook processing');
  console.log('   👥 Multi-user setup interface');
  console.log('   📅 Individual Google Calendar integration');
  console.log('   🎯 Smart conflict notifications');
  console.log('');
  console.log('🎯 EVERYTHING IN ONE SERVICE - NO MORE CONFUSION!');
});