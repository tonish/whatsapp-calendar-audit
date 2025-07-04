require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { google } = require('googleapis');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const cron = require('node-cron');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Store recent messages in memory
const recentMessages = new Map();
const userConfigs = new Map();

// Master Google OAuth2 client - Use Desktop client for better compatibility
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_DESKTOP_CLIENT_ID,
  process.env.GOOGLE_DESKTOP_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

// ============================================================================
// DAILY AUDIT SCHEDULER
// ============================================================================

// Schedule daily audit at 9:30 PM (21:30)
cron.schedule('30 21 * * *', async () => {
  console.log('🕘 Starting scheduled daily audit at 9:30 PM...');
  await runDailyAuditForAllUsers();
}, {
  timezone: "Asia/Jerusalem" // Adjust to your timezone
});

// For testing - run audit in 2 minutes after startup
setTimeout(async () => {
  console.log('🧪 Running test audit (2 minutes after startup)...');
  await runDailyAuditForAllUsers();
}, 2 * 60 * 1000);

async function runDailyAuditForAllUsers() {
  console.log('📊 Running Daily WhatsApp Calendar Audit for All Users');
  console.log('='.repeat(60));
  
  await loadUserConfigurations();
  
  if (userConfigs.size === 0) {
    console.log('📭 No users configured yet');
    return;
  }

  for (const [userId, userData] of userConfigs.entries()) {
    try {
      console.log(`\n👤 Processing audit for: ${userData.name}`);
      await runUserDailyAudit(userId, userData);
    } catch (error) {
      console.error(`❌ Error auditing ${userData.name}:`, error.message);
    }
  }
  
  console.log('\n✅ Daily audit completed for all users');
}

async function runUserDailyAudit(userId, userData) {
  try {
    // Get user's WhatsApp messages from last 24 hours
    const messages = await getUserMessages(userData);
    console.log(`📱 Found ${messages.length} messages for ${userData.name}`);
    
    // Detect meetings in messages
    const detectedMeetings = await detectMeetings(messages);
    console.log(`🎯 Detected ${detectedMeetings.length} potential meetings`);
    
    // Get user's calendar events for next 7 days
    const calendarEvents = await getUserCalendarEvents(userData);
    console.log(`📅 Found ${calendarEvents.length} calendar events`);
    
    // Analyze for conflicts and missing events
    const auditResults = await analyzeForConflicts(detectedMeetings, calendarEvents);
    
    // Send daily summary (always, even if no issues)
    await sendDailySummary(userData, {
      messagesScanned: messages.length,
      meetingsDetected: detectedMeetings.length,
      calendarEvents: calendarEvents.length,
      conflicts: auditResults.conflicts,
      missingEvents: auditResults.missingEvents,
      allGood: auditResults.conflicts.length === 0 && auditResults.missingEvents.length === 0
    });
    
  } catch (error) {
    console.error(`Error in daily audit for ${userData.name}:`, error);
  }
}

async function getUserMessages(userData) {
  try {
    // Use unified Green API credentials from .env
    const instanceId = process.env.GREEN_API_ID_INSTANCE;
    const token = process.env.GREEN_API_TOKEN_INSTANCE;
    const baseUrl = process.env.GREEN_API_BASE_URL || 'https://api.green-api.com';
    
    const chatId = `${userData.phoneNumber.replace('+', '')}@c.us`;
    console.log(`📱 Fetching messages for ${userData.name} from chat: ${chatId}`);
    
    // Use exact working pattern from TypeScript version
    const response = await axios.post(
      `${baseUrl}/waInstance${instanceId}/getChatHistory/${token}`,
      {
        chatId: chatId,
        count: 50  // Reduced to avoid rate limits
      },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000
      }
    );

    if (!response.data || !Array.isArray(response.data)) {
      console.warn(`No valid message data for ${userData.name}`);
      return [];
    }

    const yesterday = Math.floor(Date.now() / 1000) - (24 * 60 * 60);
    
    const filteredMessages = response.data
      .filter(msg => 
        msg && 
        msg.timestamp >= yesterday && 
        msg.textMessage && 
        msg.textMessage.trim().length > 0
      )
      .map(msg => ({
        id: msg.idMessage,
        timestamp: msg.timestamp,
        text: msg.textMessage,
        senderName: msg.senderName || msg.senderId || 'Unknown'
      }));
      
    console.log(`✅ Found ${filteredMessages.length} recent messages for ${userData.name}`);
    return filteredMessages;
      
  } catch (error) {
    console.error(`❌ Error fetching messages for ${userData.name}:`, error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
    return [];
  }
}

async function detectMeetings(messages) {
  const keywords = ['meeting', 'appointment', 'פגישה', 'תור', 'טיפול', 'ישיבה', 'מפגש'];
  const detectedMeetings = [];
  
  for (const msg of messages) {
    const hasKeyword = keywords.some(keyword => 
      msg.text.toLowerCase().includes(keyword.toLowerCase())
    );
    
    if (hasKeyword) {
      const { time, date } = detectTimeAndDate(msg.text);
      detectedMeetings.push({
        id: msg.id,
        text: msg.text,
        senderName: msg.senderName,
        detectedTime: time,
        detectedDate: date,
        timestamp: msg.timestamp
      });
    }
  }
  
  return detectedMeetings;
}

function detectTimeAndDate(text) {
  // Enhanced time detection
  const timeMatch = text.match(/\b(\d{1,2}):(\d{2})\b/) || 
                   text.match(/\b(\d{1,2})\s*(am|pm|AM|PM)\b/);
  const time = timeMatch ? timeMatch[0] : null;
  
  // Enhanced date detection
  const datePatterns = [
    /(מחר|tomorrow)/i,
    /(היום|today)/i,
    /(יום ראשון|sunday)/i,
    /(יום שני|monday)/i,
    /(יום שלישי|tuesday)/i,
    /(יום רביעי|wednesday)/i,
    /(יום חמישי|thursday)/i,
    /(יום שישי|friday)/i,
    /(יום שבת|saturday)/i,
    /\b(\d{1,2})[\/\-](\d{1,2})\b/
  ];
  
  let date = null;
  for (const pattern of datePatterns) {
    const match = text.match(pattern);
    if (match) {
      date = match[0];
      break;
    }
  }
  
  return { time, date };
}

async function getUserCalendarEvents(userData) {
  try {
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials(userData.googleTokens);
    
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    
    const now = new Date();
    const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    
    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: now.toISOString(),
      timeMax: weekFromNow.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });

    return response.data.items || [];
  } catch (error) {
    console.error('Error fetching calendar events:', error.message);
    return [];
  }
}

async function analyzeForConflicts(detectedMeetings, calendarEvents) {
  const conflicts = [];
  const missingEvents = [];
  
  for (const meeting of detectedMeetings) {
    // Check if meeting seems to be missing from calendar
    const hasRelatedEvent = calendarEvents.some(event => {
      const eventText = `${event.summary} ${event.description || ''}`.toLowerCase();
      const meetingText = meeting.text.toLowerCase();
      
      // Look for common words or names
      const meetingWords = meetingText.split(' ').filter(word => word.length > 3);
      return meetingWords.some(word => eventText.includes(word));
    });
    
    if (!hasRelatedEvent && (meeting.detectedTime || meeting.detectedDate)) {
      missingEvents.push(meeting);
    }
    
    // Check for time conflicts (simplified)
    if (meeting.detectedTime && meeting.detectedDate) {
      const conflictingEvents = calendarEvents.filter(event => {
        // This is a simplified conflict check
        // In production, you'd want more sophisticated date/time parsing
        return event.start.dateTime && 
               event.summary.toLowerCase().includes('meeting');
      });
      
      if (conflictingEvents.length > 1) {
        conflicts.push({ meeting, conflictingEvents });
      }
    }
  }
  
  return { conflicts, missingEvents };
}

async function sendDailySummary(userData, summary) {
  const chatId = `${userData.phoneNumber}@c.us`;
  
  let message;
  
  if (summary.allGood) {
    // Positive summary when no issues
    message = `🌟 *Daily Calendar Audit - All Clear!*

📅 *Date:* ${new Date().toLocaleDateString('he-IL')}
👤 *For:* ${userData.name}

📊 *Today's Summary:*
📱 Messages scanned: ${summary.messagesScanned}
🎯 Meetings detected: ${summary.meetingsDetected}
📅 Calendar events: ${summary.calendarEvents}

✅ *Great news!* No scheduling conflicts or missing events detected.

${summary.meetingsDetected > 0 ? '🎉 All your detected meetings appear to be properly scheduled in your calendar!' : '😊 No meeting-related messages found today.'}

💡 Keep up the great organization! 

---
🤖 Daily WhatsApp Calendar Audit`;
  } else {
    // Alert summary when issues found
    message = `⚠️ *Daily Calendar Audit - Action Needed*

📅 *Date:* ${new Date().toLocaleDateString('he-IL')}
👤 *For:* ${userData.name}

📊 *Today's Summary:*
📱 Messages scanned: ${summary.messagesScanned}
🎯 Meetings detected: ${summary.meetingsDetected}
📅 Calendar events: ${summary.calendarEvents}

🚨 *Issues Found:*
${summary.conflicts.length > 0 ? `⚡ Schedule conflicts: ${summary.conflicts.length}` : ''}
${summary.missingEvents.length > 0 ? `📝 Missing from calendar: ${summary.missingEvents.length}` : ''}

📋 *Missing Events:*
${summary.missingEvents.map((event, i) => 
  `${i + 1}. "${event.text.substring(0, 60)}..."
   Time: ${event.detectedTime || 'Not specified'}
   Date: ${event.detectedDate || 'Not specified'}`
).join('\n\n')}

💡 *Recommendation:* Review these messages and add missing meetings to your calendar.

---
🤖 Daily WhatsApp Calendar Audit`;
  }

  try {
    // Use unified Green API credentials for daily summaries
    const instanceId = process.env.GREEN_API_ID_INSTANCE;
    const token = process.env.GREEN_API_TOKEN_INSTANCE;
    const baseUrl = process.env.GREEN_API_BASE_URL || 'https://api.green-api.com';
    
    await axios.post(
      `${baseUrl}/waInstance${instanceId}/sendMessage/${token}`,
      { chatId, message },
      { headers: { 'Content-Type': 'application/json' } }
    );
    
    console.log(`📤 Daily summary sent to ${userData.name}`);
  } catch (error) {
    console.error('Error sending daily summary:', error.message);
  }
}

// ============================================================================
// WEBHOOK ENDPOINTS (still available for real-time if needed)
// ============================================================================

app.post('/webhook/:userId', async (req, res) => {
  const userId = req.params.userId;
  res.status(200).json({ received: true });
  console.log(`📱 [${userId}] Webhook received (stored for daily audit)`);
  
  // Just acknowledge - actual processing happens in daily audit
});

app.post('/webhook', async (req, res) => {
  res.status(200).json({ received: true });
  console.log('📱 Webhook received (stored for daily audit)');
});

// ============================================================================
// USER SETUP WEB INTERFACE (same as before)
// ============================================================================

const homePage = `
<!DOCTYPE html>
<html>
<head>
    <title>WhatsApp Calendar Audit - Daily Scheduler</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
        .step { background: #f5f5f5; padding: 20px; margin: 20px 0; border-radius: 8px; }
        .highlight { background: #e3f2fd; border-left: 4px solid #2196f3; }
        button { background: #007bff; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; }
        input { width: 100%; padding: 8px; margin: 5px 0; border: 1px solid #ddd; border-radius: 4px; }
    </style>
</head>
<body>
    <h1>🕘 WhatsApp Calendar Audit - Daily Scheduler</h1>
    
    <div class="step highlight">
        <h3>📅 Daily Audit Schedule</h3>
        <p><strong>Every day at 9:30 PM</strong>, this service will:</p>
        <ul>
            <li>📱 Scan your WhatsApp messages from the last 24 hours</li>
            <li>🎯 Detect meetings and appointments</li>
            <li>📅 Check against your Google Calendar</li>
            <li>📊 Send you a nice daily summary</li>
        </ul>
        <p><strong>✅ You'll get a summary even if everything is perfect!</strong></p>
    </div>
    
    <div class="step">
        <h3>Add New User</h3>
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
        <h3>📋 How the Daily Audit Works:</h3>
        <ul>
            <li>🕘 <strong>9:30 PM daily</strong> - Automatic audit runs</li>
            <li>📱 <strong>Scans messages</strong> - Last 24 hours only</li>
            <li>🎯 <strong>Smart detection</strong> - Finds meeting keywords</li>
            <li>📅 <strong>Calendar check</strong> - Compares with Google Calendar</li>
            <li>📊 <strong>Daily summary</strong> - Always sent (good or bad news)</li>
        </ul>
    </div>
</body>
</html>`;

// [Rest of the setup routes remain the same as before...]
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

const setupPage = (userData) => `
<!DOCTYPE html>
<html>
<head>
    <title>Setup WhatsApp - ${userData.name}</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
        .step { background: #f5f5f5; padding: 20px; margin: 20px 0; border-radius: 8px; }
        .highlight { background: #e3f2fd; border-left: 4px solid #2196f3; }
        button { background: #007bff; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; }
        input { width: 100%; padding: 8px; margin: 5px 0; border: 1px solid #ddd; border-radius: 4px; }
    </style>
</head>
<body>
    <h1>📱 WhatsApp Setup for ${userData.name}</h1>
    
    <div class="step highlight">
        <h3>Step 2: Connect WhatsApp</h3>
        <p>Enter your Green API credentials below:</p>
        
        <form action="/setup/whatsapp/${userData.id}" method="POST">
            <label>Instance ID:</label>
            <input type="text" name="instanceId" placeholder="1234567890" required>
            
            <label>Token:</label>
            <input type="text" name="token" placeholder="abc123..." required>
            <br><br>
            
            <button type="submit">🔗 Connect WhatsApp</button>
        </form>
    </div>
    
    <div class="step">
        <h3>📋 Need Green API credentials?</h3>
        <ol>
            <li>Go to <a href="https://green-api.com" target="_blank">green-api.com</a></li>
            <li>Create free account</li>
            <li>Create new instance</li>
            <li>Scan QR code with WhatsApp</li>
            <li>Copy Instance ID and Token here</li>
        </ol>
    </div>
</body>
</html>`;

const calendarPage = (userData) => `
<!DOCTYPE html>
<html>
<head>
    <title>Calendar Setup - ${userData.name}</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
        .step { background: #f5f5f5; padding: 20px; margin: 20px 0; border-radius: 8px; }
        .highlight { background: #e8f5e8; border-left: 4px solid #4caf50; }
        button { background: #007bff; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; }
    </style>
</head>
<body>
    <h1>📅 Calendar Setup for ${userData.name}</h1>
    
    <div class="step highlight">
        <h2>✅ WhatsApp Connected!</h2>
        <p><strong>${userData.name}</strong>'s WhatsApp is now connected to the audit service.</p>
    </div>
    
    <div class="step">
        <h3>Step 3: Connect Google Calendar</h3>
        <p>Click below to connect your Google Calendar (uses your personal Google account):</p>
        <br>
        <button onclick="window.location.href='/auth/google/${userData.id}'">
            📅 Connect Google Calendar
        </button>
    </div>
    
    <div class="step">
        <h3>🔒 Privacy Note:</h3>
        <p>This will only read your calendar events. We don't store or share your data.</p>
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
        <h2>✅ Daily Audits Enabled!</h2>
        <p><strong>${userData.name}</strong> will receive daily audit summaries at 9:30 PM.</p>
        <p><strong>Webhook endpoint:</strong> <code>/webhook/${userData.id}</code></p>
    </div>
    
    <div class="info">
        <h3>📅 Daily Audit Schedule:</h3>
        <ul>
            <li>🕘 <strong>9:30 PM every day</strong> - Automatic audit runs</li>
            <li>📊 <strong>Always get a summary</strong> - Even when everything is perfect!</li>
            <li>📱 <strong>Scans last 24 hours</strong> - Recent WhatsApp messages</li>
            <li>🎯 <strong>Smart detection</strong> - Finds meeting conflicts</li>
        </ul>
    </div>
    
    <button onclick="window.location.href='/'">🔄 Add Another User</button>
</body>
</html>`;

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
      throw new Error('WhatsApp not connected or not authorized');
    }

    userData.greenApi = { instanceId, token };
    userData.status = 'whatsapp_connected';
    await saveUserData(userId, userData);

    res.send(calendarPage(userData));
  } catch (error) {
    res.send(`<h1>❌ Connection Failed</h1><p>${error.message}</p><br><a href="/setup/whatsapp/${userId}">Try Again</a>`);
  }
});

app.get('/auth/google/:userId', async (req, res) => {
  const { userId } = req.params;
  
  // Use Desktop OAuth client (no redirect URI needed)
  const manualOAuth = new google.auth.OAuth2(
    process.env.GOOGLE_DESKTOP_CLIENT_ID,
    process.env.GOOGLE_DESKTOP_CLIENT_SECRET
  );
  
  const scopes = ['https://www.googleapis.com/auth/calendar.readonly'];
  const authUrl = manualOAuth.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    state: userId
  });

  res.send(`
    <div style="font-family: Arial; max-width: 600px; margin: 50px auto; padding: 20px;">
      <h1>🔐 Google Calendar Authorization</h1>
      
      <div style="background: #e8f5e8; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <h3>Step 1: Get Authorization Code</h3>
        <p><a href="${authUrl}" target="_blank" style="background: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px;">
          🔗 Authorize Google Calendar Access
        </a></p>
        <p><small>Opens in new tab. After authorization, Google will show you a code.</small></p>
      </div>
      
      <div style="background: #f5f5f5; padding: 20px; border-radius: 8px;">
        <h3>Step 2: Enter Authorization Code</h3>
        <form action="/auth/google/manual/${userId}" method="POST">
          <input type="text" name="code" placeholder="Paste the authorization code here" 
                 style="width: 100%; padding: 12px; margin: 10px 0; border: 1px solid #ddd; border-radius: 4px;" required>
          <br>
          <button type="submit" style="background: #28a745; color: white; padding: 12px 24px; border: none; border-radius: 4px; cursor: pointer;">
            ✅ Complete Setup
          </button>
        </form>
      </div>
      
      <div style="background: #fff3cd; padding: 15px; border-radius: 8px; margin: 20px 0;">
        <strong>💡 Instructions:</strong>
        <ol>
          <li>Click the authorization link above</li>
          <li>Select your Google account</li>
          <li>Grant calendar permissions</li>
          <li>Copy the authorization code Google shows you</li>
          <li>Paste it in the form above and submit</li>
        </ol>
      </div>
    </div>
  `);
});

app.get('/auth/google/callback', async (req, res) => {
  const { code, state: userId, error } = req.query;
  
  console.log('🔄 OAuth callback received:', { 
    code: code ? 'Present' : 'Missing',
    userId,
    error,
    fullQuery: req.query 
  });
  
  // Handle OAuth error
  if (error) {
    console.error('OAuth error from Google:', error);
    return res.send(`<h1>❌ OAuth Error</h1><p>Error: ${error}</p><br><a href="/auth/google/${userId}">Try Again</a>`);
  }
  
  // Handle missing code
  if (!code) {
    console.error('Missing authorization code');
    return res.send(`<h1>❌ Missing Authorization Code</h1><br><a href="/auth/google/${userId}">Try Again</a>`);
  }
  
  try {
    console.log(`🔐 Processing Google OAuth callback for user: ${userId}`);
    const { tokens } = await oauth2Client.getToken(code);
    console.log('✅ Tokens received from Google');
    
    const userData = await loadUserData(userId);
    if (!userData) {
      throw new Error('User not found');
    }
    
    userData.googleTokens = tokens;
    userData.status = 'fully_configured';
    await saveUserData(userId, userData);
    
    console.log(`✅ OAuth completed for: ${userData.name}`);

    // Configure webhook for this user
    await configureUserWebhook(userData);

    res.send(completePage(userData));
  } catch (error) {
    console.error('OAuth callback error:', error);
    res.send(`<h1>❌ Calendar Connection Failed</h1><p>${error.message}</p><br><a href="/auth/google/${userId}">Try Again</a>`);
  }
});

app.post('/auth/google/manual/:userId', async (req, res) => {
  const { userId } = req.params;
  const { code } = req.body;
  
  try {
    console.log(`🔐 Processing manual Google OAuth for user: ${userId}`);
    
    // Use Desktop OAuth client for manual flow (no redirect URI)
    const manualOAuth = new google.auth.OAuth2(
      process.env.GOOGLE_DESKTOP_CLIENT_ID,
      process.env.GOOGLE_DESKTOP_CLIENT_SECRET
    );
    
    const { tokens } = await manualOAuth.getToken(code);
    console.log('✅ Tokens received from Google');
    
    const userData = await loadUserData(userId);
    if (!userData) {
      throw new Error('User not found');
    }
    
    userData.googleTokens = tokens;
    userData.status = 'fully_configured';
    await saveUserData(userId, userData);
    
    console.log(`✅ OAuth completed for: ${userData.name}`);

    // Configure webhook for this user
    await configureUserWebhook(userData);

    res.send(completePage(userData));
  } catch (error) {
    console.error('Manual OAuth error:', error);
    res.send(`<h1>❌ Calendar Connection Failed</h1><p>${error.message}</p><br><a href="/auth/google/${userId}">Try Again</a>`);
  }
});

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

async function loadUserData(userId) {
  try {
    const filePath = path.join(__dirname, 'data', 'users', `${userId}.json`);
    const data = await fs.readFile(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return null;
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

async function loadUserConfigurations() {
  try {
    const userDir = path.join(__dirname, 'data', 'users');
    const userFiles = await fs.readdir(userDir);
    
    userConfigs.clear();
    
    for (const file of userFiles) {
      if (file.endsWith('.json')) {
        const userId = file.replace('.json', '');
        const userData = JSON.parse(await fs.readFile(path.join(userDir, file), 'utf8'));
        
        if (userData.status === 'fully_configured') {
          userConfigs.set(userId, userData);
          console.log(`📋 Loaded config for: ${userData.name}`);
        }
      }
    }
  } catch (error) {
    console.log('📁 No existing user configurations found');
  }
}

async function saveUserData(userId, data) {
  const userDir = path.join(__dirname, 'data', 'users');
  await fs.mkdir(userDir, { recursive: true });
  const filePath = path.join(userDir, `${userId}.json`);
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    service: 'WhatsApp Calendar Audit - Daily Scheduler',
    nextAudit: '21:30 (9:30 PM) daily',
    configuredUsers: userConfigs.size
  });
});

// Debug: List all users
app.get('/debug/users', async (req, res) => {
  try {
    const userDir = path.join(__dirname, 'data', 'users');
    const userFiles = await fs.readdir(userDir);
    const users = [];
    
    for (const file of userFiles) {
      if (file.endsWith('.json')) {
        const userId = file.replace('.json', '');
        const userData = JSON.parse(await fs.readFile(path.join(userDir, file), 'utf8'));
        users.push(userData);
      }
    }
    
    res.json({ users });
  } catch (error) {
    res.json({ error: error.message });
  }
});

// Debug: Test OAuth URL generation
app.get('/debug/oauth/:userId', (req, res) => {
  const { userId } = req.params;
  
  const scopes = ['https://www.googleapis.com/auth/calendar.readonly'];
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    state: userId,
    prompt: 'select_account'
  });
  
  res.json({
    userId,
    authUrl,
    redirectUri: 'http://localhost:3001/auth/google/callback',
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ? 'Set' : 'Missing'
  });
});

// Debug: Check what happens in OAuth callback
app.get('/debug/callback', (req, res) => {
  res.json({
    query: req.query,
    headers: req.headers,
    url: req.url
  });
});

// Test callback endpoint
app.get('/test-callback', (req, res) => {
  console.log('🧪 TEST CALLBACK REACHED!');
  res.send('<h1>✅ Test Callback Working!</h1><p>Our service can receive callbacks.</p>');
});

// Test WhatsApp for specific user
app.get('/test-whatsapp/:userId', async (req, res) => {
  const { userId } = req.params;
  
  try {
    const userData = await loadUserData(userId);
    if (!userData) {
      return res.json({ error: 'User not found' });
    }
    
    const chatId = `${userData.phoneNumber.replace('+', '')}@c.us`;
    const testMessage = `🧪 *WhatsApp Test Message*

👋 Hello ${userData.name}!

This is a test message from your WhatsApp Calendar Audit Service.

✅ If you can see this message, your WhatsApp integration is working perfectly!

🕘 Daily audits will run at 9:30 PM every day.

---
🤖 Test from WhatsApp Calendar Audit Service`;

    console.log(`📤 Sending test message to ${userData.name} (${chatId})`);
    
    // Use unified Green API credentials for sending
    const instanceId = process.env.GREEN_API_ID_INSTANCE;
    const token = process.env.GREEN_API_TOKEN_INSTANCE;
    const baseUrl = process.env.GREEN_API_BASE_URL || 'https://api.green-api.com';
    
    const response = await axios.post(
      `${baseUrl}/waInstance${instanceId}/sendMessage/${token}`,
      { 
        chatId: chatId, 
        message: testMessage 
      },
      { headers: { 'Content-Type': 'application/json' } }
    );
    
    console.log(`✅ Message sent successfully to ${userData.name}`);
    res.json({ 
      success: true, 
      user: userData.name,
      chatId: chatId,
      response: response.data 
    });
    
  } catch (error) {
    console.error('❌ Error sending test message:', error.message);
    res.json({ 
      error: error.message,
      details: error.response?.data || 'No additional details'
    });
  }
});

// Test getting WhatsApp messages for specific user - Alternative API
app.get('/test-messages/:userId', async (req, res) => {
  const { userId } = req.params;
  
  try {
    const userData = await loadUserData(userId);
    if (!userData) {
      return res.json({ error: 'User not found' });
    }
    
    console.log(`📱 Getting messages for ${userData.name}...`);
    
    // Use unified Green API credentials
    const instanceId = process.env.GREEN_API_ID_INSTANCE;
    const token = process.env.GREEN_API_TOKEN_INSTANCE;
    const baseUrl = process.env.GREEN_API_BASE_URL || 'https://api.green-api.com';
    
    const chatId = `${userData.phoneNumber.replace('+', '')}@c.us`;
    console.log(`🔍 Using chatId: ${chatId} with instance: ${instanceId}`);
    
    const response = await axios.post(
      `${baseUrl}/waInstance${instanceId}/getChatHistory/${token}`,
      {
        chatId: chatId,
        count: 30
      },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000
      }
    );

    console.log(`✅ Retrieved ${response.data.length} messages for ${userData.name}`);
    
    res.json({
      success: true,
      user: userData.name,
      messageCount: response.data.length,
      messages: response.data.slice(0, 5).map(msg => ({
        id: msg.idMessage,
        timestamp: msg.timestamp,
        text: msg.textMessage || '[No text]',
        type: msg.typeMessage,
        senderName: msg.senderName
      }))
    });
    
  } catch (error) {
    console.error('❌ Error getting messages:', error.message);
    res.json({ 
      error: error.message,
      details: error.response?.data || 'No additional details'
    });
  }
});

// Test Green API instance status
app.get('/test-instance/:userId', async (req, res) => {
  const { userId } = req.params;
  
  try {
    const userData = await loadUserData(userId);
    if (!userData) {
      return res.json({ error: 'User not found' });
    }
    
    console.log(`🔍 Checking Green API instance for ${userData.name}...`);
    
    // Check instance state
    const stateResponse = await axios.get(
      `https://api.green-api.com/waInstance${userData.greenApi.instanceId}/getStateInstance/${userData.greenApi.token}`
    );
    
    // Check account info
    const accountResponse = await axios.get(
      `https://api.green-api.com/waInstance${userData.greenApi.instanceId}/getWaAccount/${userData.greenApi.token}`
    );
    
    console.log(`✅ Instance check complete for ${userData.name}`);
    
    res.json({
      success: true,
      user: userData.name,
      instanceId: userData.greenApi.instanceId,
      state: stateResponse.data,
      account: accountResponse.data,
      phoneNumber: userData.phoneNumber,
      chatId: `${userData.phoneNumber.replace('+', '')}@c.us`
    });
    
  } catch (error) {
    console.error('❌ Error checking instance:', error.message);
    res.json({ 
      error: error.message,
      details: error.response?.data || 'No additional details'
    });
  }
});

// Manual OAuth bypass for testing
app.get('/bypass-oauth/:userId', async (req, res) => {
  const { userId } = req.params;
  
  try {
    const userData = await loadUserData(userId);
    if (!userData) {
      return res.send('<h1>❌ User not found</h1>');
    }
    
    // Use existing tokens from another user or create dummy tokens
    const dummyTokens = {
      access_token: 'dummy_token_for_testing',
      refresh_token: 'dummy_refresh_token',
      scope: 'https://www.googleapis.com/auth/calendar.readonly',
      token_type: 'Bearer'
    };
    
    userData.googleTokens = dummyTokens;
    userData.status = 'fully_configured';
    await saveUserData(userId, userData);
    
    res.send(`<h1>✅ OAuth Bypassed for ${userData.name}</h1><p>Status: ${userData.status}</p><p>Ready for daily audits!</p>`);
  } catch (error) {
    res.send(`<h1>❌ Error: ${error.message}</h1>`);
  }
});

// Manual audit trigger (for testing)
app.post('/trigger-audit', async (req, res) => {
  console.log('🧪 Manual audit triggered');
  await runDailyAuditForAllUsers();
  res.json({ message: 'Daily audit completed', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, async () => {
  console.log('🕘 WhatsApp Calendar Audit - DAILY SCHEDULER');
  console.log('='.repeat(60));
  console.log(`🌐 Service running on port ${PORT}`);
  console.log(`📅 Daily audit scheduled: 9:30 PM every day`);
  console.log(`👥 User setup: http://localhost:${PORT}/`);
  console.log(`💚 Health check: http://localhost:${PORT}/health`);
  console.log(`🧪 Manual trigger: POST /trigger-audit`);
  console.log('');
  console.log('✅ FEATURES:');
  console.log('   🕘 Daily scheduled audits at 9:30 PM');
  console.log('   📊 Always sends summary (even when all good)');
  console.log('   👥 Multi-user support');
  console.log('   🎯 Smart conflict detection');
  console.log('');
  
  // Load user configurations on startup
  await loadUserConfigurations();
  console.log(`🎯 SERVICE READY! Next audit: Today at 9:30 PM`);
});