#!/usr/bin/env node

// Standalone audit runner for GitHub Actions
require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');

// Import required modules
const { google } = require('googleapis');
const axios = require('axios');

async function runStandaloneAudit() {
  console.log('🚀 Starting GitHub Actions Audit');
  console.log('Time:', new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
  
  try {
    // Load user configurations
    const usersDir = path.join(__dirname, 'data', 'users');
    const userFiles = await fs.readdir(usersDir);
    
    for (const file of userFiles) {
      if (!file.endsWith('.json')) continue;
      
      const userData = JSON.parse(await fs.readFile(path.join(usersDir, file), 'utf8'));
      if (userData.status !== 'fully_configured') continue;
      
      console.log(`\n👤 Processing: ${userData.name}`);
      
      // Run audit for this user
      await auditUser(userData);
    }
    
    console.log('\n✅ GitHub Actions audit completed successfully');
  } catch (error) {
    console.error('❌ Audit failed:', error);
    process.exit(1);
  }
}

async function auditUser(userData) {
  try {
    // Simple audit - get recent messages and calendar events
    const messages = await getRecentMessages(userData);
    const events = await getCalendarEvents(userData);
    
    // Send summary
    await sendSummary(userData, {
      messagesCount: messages.length,
      eventsCount: events.length,
      timestamp: new Date().toISOString()
    });
    
    console.log(`📱 ${messages.length} messages, 📅 ${events.length} events processed`);
  } catch (error) {
    console.error(`Error auditing ${userData.name}:`, error.message);
  }
}

async function getRecentMessages(userData) {
  try {
    const response = await axios.get(
      `https://api.green-api.com/waInstance${userData.greenApi.instanceId}/getChats/${userData.greenApi.token}`
    );
    return response.data || [];
  } catch (error) {
    console.log('Could not fetch messages:', error.message);
    return [];
  }
}

async function getCalendarEvents(userData) {
  try {
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials(userData.googleTokens);
    
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: new Date().toISOString(),
      maxResults: 10,
      singleEvents: true,
      orderBy: 'startTime',
    });
    
    return response.data.items || [];
  } catch (error) {
    console.log('Could not fetch calendar events:', error.message);
    return [];
  }
}

async function sendSummary(userData, summary) {
  try {
    const message = `🤖 Daily Audit Summary for ${userData.name}
    
📅 ${new Date().toLocaleDateString('en-US', { timeZone: 'Asia/Jerusalem' })}
📱 Messages scanned: ${summary.messagesCount}
📅 Calendar events: ${summary.eventsCount}
✅ Audit completed successfully

🕘 Next audit: Tomorrow at 9:30 PM`;

    await axios.post(
      `https://api.green-api.com/waInstance${userData.greenApi.instanceId}/sendMessage/${userData.greenApi.token}`,
      {
        chatId: `${userData.phoneNumber}@c.us`,
        message: message
      }
    );
    
    console.log(`📤 Summary sent to ${userData.name}`);
  } catch (error) {
    console.log('Could not send summary:', error.message);
  }
}

// Run if called directly
if (require.main === module) {
  runStandaloneAudit();
}

module.exports = { runStandaloneAudit };