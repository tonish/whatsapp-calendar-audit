#!/usr/bin/env node

// Standalone audit runner for GitHub Actions
require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');

// Import required modules
const { google } = require('googleapis');
const axios = require('axios');
const { KeywordDetector } = require('./keyword-detector');

async function runStandaloneAudit() {
  console.log('🚀 Starting GitHub Actions Audit');
  console.log('Time:', new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
  
  try {
    // Load user configurations
    const usersDir = path.join(__dirname, 'data', 'users');
    
    // Check if directory exists
    try {
      await fs.access(usersDir);
      console.log(`📁 Users directory found: ${usersDir}`);
    } catch (error) {
      console.error(`❌ Users directory not found: ${usersDir}`);
      throw error;
    }
    
    const userFiles = await fs.readdir(usersDir);
    console.log(`📂 Found ${userFiles.length} files: ${userFiles.join(', ')}`);
    
    for (const file of userFiles) {
      if (!file.endsWith('.json')) continue;
      
      try {
        const fileContent = await fs.readFile(path.join(usersDir, file), 'utf8');
        console.log(`📄 Reading file: ${file}`);
        console.log(`📝 File content length: ${fileContent.length}`);
        console.log(`📝 First 100 chars: ${fileContent.substring(0, 100)}...`);
        
        // Clean the JSON content
        const cleanedContent = fileContent
          .replace(/\r\n/g, ' ')
          .replace(/\n/g, ' ')
          .replace(/\r/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        
        console.log(`🧹 Cleaned content length: ${cleanedContent.length}`);
        
        const userData = JSON.parse(cleanedContent);
        if (userData.status !== 'fully_configured') {
          console.log(`⚠️ User ${userData.name || 'Unknown'} not fully configured, skipping`);
          continue;
        }
        
        console.log(`\n👤 Processing: ${userData.name}`);
        
        // Run audit for this user
        await auditUser(userData);
      } catch (parseError) {
        console.error(`❌ Error parsing ${file}:`, parseError.message);
        console.error(`📄 File content preview:`, fileContent?.substring(0, 200));
        continue;
      }
    }
    
    console.log('\n✅ GitHub Actions audit completed successfully');
  } catch (error) {
    console.error('❌ Audit failed:', error);
    process.exit(1);
  }
}

async function auditUser(userData) {
  try {
    console.log(`\n🔍 Starting audit for ${userData.name}`);
    
    // Get recent messages and detect meetings
    const messages = await getRecentMessages(userData);
    console.log(`📱 Retrieved ${messages.length} messages from last 24 hours`);
    
    // Initialize keyword detector
    const detector = new KeywordDetector();
    const detectedMeetings = detector.detectMeetings(messages);
    console.log(`🎯 Detected ${detectedMeetings.length} potential meetings`);
    
    // Get calendar events for detected meeting dates
    const relevantEvents = await getRelevantCalendarEvents(userData, detectedMeetings);
    console.log(`📅 Retrieved ${relevantEvents.length} relevant calendar events`);
    
    // Analyze for conflicts and missing events
    const auditResults = analyzeConflictsAndMissing(detectedMeetings, relevantEvents);
    
    // Send comprehensive summary
    await sendComprehensiveSummary(userData, {
      messagesScanned: messages.length,
      meetingsDetected: detectedMeetings.length,
      calendarEvents: relevantEvents.length,
      conflicts: auditResults.conflicts,
      missingEvents: auditResults.missingEvents,
      confirmedMeetings: auditResults.confirmedMeetings,
      allGood: auditResults.conflicts.length === 0 && auditResults.missingEvents.length === 0
    });
    
    console.log(`✅ Audit completed: ${auditResults.conflicts.length} conflicts, ${auditResults.missingEvents.length} missing events`);
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

async function getRelevantCalendarEvents(userData, detectedMeetings) {
  try {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_DESKTOP_CLIENT_ID,
      process.env.GOOGLE_DESKTOP_CLIENT_SECRET,
      'urn:ietf:wg:oauth:2.0:oob'
    );
    oauth2Client.setCredentials(userData.googleTokens);
    
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    
    // If no meetings detected, get next 7 days for general overview
    if (detectedMeetings.length === 0) {
      const now = new Date();
      const nextWeek = new Date(now);
      nextWeek.setDate(now.getDate() + 7);
      
      const response = await calendar.events.list({
        calendarId: 'primary',
        timeMin: now.toISOString(),
        timeMax: nextWeek.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 20
      });
      
      return response.data.items || [];
    }
    
    // Get all unique dates from detected meetings
    const datesToCheck = new Set();
    for (const meeting of detectedMeetings) {
      if (meeting.parsedDates && meeting.parsedDates.length > 0) {
        meeting.parsedDates.forEach(date => {
          datesToCheck.add(date.toDateString());
        });
      } else {
        // If no specific date, check today and tomorrow
        const today = new Date();
        const tomorrow = new Date(today);
        tomorrow.setDate(today.getDate() + 1);
        datesToCheck.add(today.toDateString());
        datesToCheck.add(tomorrow.toDateString());
      }
    }
    
    console.log(`📅 Checking calendar for ${datesToCheck.size} specific dates`);
    
    // Query calendar for each relevant date
    let allEvents = [];
    for (const dateStr of datesToCheck) {
      const date = new Date(dateStr);
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);
      
      try {
        const response = await calendar.events.list({
          calendarId: 'primary',
          timeMin: startOfDay.toISOString(),
          timeMax: endOfDay.toISOString(),
          singleEvents: true,
          orderBy: 'startTime'
        });
        
        if (response.data.items) {
          allEvents.push(...response.data.items);
        }
      } catch (error) {
        console.warn(`Error fetching events for ${dateStr}:`, error.message);
      }
    }
    
    return allEvents;
  } catch (error) {
    console.log('Could not fetch calendar events:', error.message);
    return [];
  }
}

function analyzeConflictsAndMissing(detectedMeetings, calendarEvents) {
  const conflicts = [];
  const missingEvents = [];
  const confirmedMeetings = [];
  
  for (const meeting of detectedMeetings) {
    let foundConflict = false;
    let foundMatch = false;
    
    // Check each detected meeting against calendar events
    for (const event of calendarEvents) {
      if (meeting.parsedDates && meeting.parsedDates.length > 0) {
        for (const meetingDate of meeting.parsedDates) {
          const eventStart = new Date(event.start.dateTime || event.start.date);
          const meetingDateOnly = new Date(meetingDate.toDateString());
          const eventDateOnly = new Date(eventStart.toDateString());
          
          // Check if it's the same day
          if (meetingDateOnly.getTime() === eventDateOnly.getTime()) {
            // Check for time conflicts
            if (meeting.detectedTime && event.start.dateTime) {
              const eventTime = eventStart.getHours() + ':' + String(eventStart.getMinutes()).padStart(2, '0');
              const meetingTimeStr = meeting.detectedTime.toLowerCase();
              
              // Simple time conflict detection
              if (meetingTimeStr.includes(eventTime) || 
                  eventTime.includes(meetingTimeStr.replace(/[^\d:]/g, ''))) {
                foundMatch = true;
                confirmedMeetings.push({
                  meeting: meeting,
                  calendarEvent: event,
                  reason: 'Time and date match'
                });
              } else {
                // Potential conflict - same day but different time
                foundConflict = true;
                conflicts.push({
                  meeting: meeting,
                  conflictingEvent: event,
                  reason: 'Same day, potentially conflicting time'
                });
              }
            } else {
              // Found matching day but unclear time
              foundMatch = true;
              confirmedMeetings.push({
                meeting: meeting,
                calendarEvent: event,
                reason: 'Date match, time unclear'
              });
            }
          }
        }
      }
    }
    
    // If no match or conflict found, it might be missing from calendar
    if (!foundMatch && !foundConflict && meeting.confidence > 0.4) {
      missingEvents.push({
        meeting: meeting,
        reason: 'High confidence meeting not found in calendar'
      });
    }
  }
  
  return {
    conflicts: conflicts,
    missingEvents: missingEvents,
    confirmedMeetings: confirmedMeetings
  };
}

async function sendComprehensiveSummary(userData, auditData) {
  try {
    let message = `🤖 Daily WhatsApp Calendar Audit\n\n`;
    message += `👤 ${userData.name}\n`;
    message += `📅 ${new Date().toLocaleDateString('en-US', { timeZone: 'Asia/Jerusalem' })} at ${new Date().toLocaleTimeString('en-US', { timeZone: 'Asia/Jerusalem' })}\n\n`;
    
    message += `📊 Scan Results:\n`;
    message += `📱 ${auditData.messagesScanned} messages scanned\n`;
    message += `🎯 ${auditData.meetingsDetected} potential meetings detected\n`;
    message += `📅 ${auditData.calendarEvents} calendar events checked\n\n`;
    
    if (auditData.allGood) {
      message += `✅ All Good!\n`;
      message += `No scheduling conflicts or missing appointments detected.\n`;
      if (auditData.confirmedMeetings.length > 0) {
        message += `${auditData.confirmedMeetings.length} meetings properly scheduled in calendar.\n`;
      }
    } else {
      if (auditData.conflicts.length > 0) {
        message += `⚠️ Potential Conflicts (${auditData.conflicts.length}):\n`;
        auditData.conflicts.slice(0, 3).forEach((conflict, i) => {
          message += `${i + 1}. "${conflict.meeting.extractedText.substring(0, 50)}..."\n`;
          message += `   Conflicts with: ${conflict.conflictingEvent.summary}\n`;
        });
        if (auditData.conflicts.length > 3) {
          message += `   ... and ${auditData.conflicts.length - 3} more\n`;
        }
        message += `\n`;
      }
      
      if (auditData.missingEvents.length > 0) {
        message += `📝 Possibly Missing from Calendar (${auditData.missingEvents.length}):\n`;
        auditData.missingEvents.slice(0, 3).forEach((missing, i) => {
          message += `${i + 1}. "${missing.meeting.extractedText.substring(0, 50)}..."\n`;
          message += `   Confidence: ${Math.round(missing.meeting.confidence * 100)}%\n`;
        });
        if (auditData.missingEvents.length > 3) {
          message += `   ... and ${auditData.missingEvents.length - 3} more\n`;
        }
        message += `\n`;
      }
    }
    
    message += `🕘 Next audit: Tomorrow at 9:30 PM\n`;
    message += `🤖 Powered by GitHub Actions`;

    await axios.post(
      `https://api.green-api.com/waInstance${userData.greenApi.instanceId}/sendMessage/${userData.greenApi.token}`,
      {
        chatId: `${userData.phoneNumber}@c.us`,
        message: message
      }
    );
    
    console.log(`📤 Comprehensive summary sent to ${userData.name}`);
  } catch (error) {
    console.log('Could not send summary:', error.message);
  }
}

// Run if called directly
if (require.main === module) {
  runStandaloneAudit();
}

module.exports = { runStandaloneAudit };