#!/usr/bin/env node

// Standalone audit runner for GitHub Actions
require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');

// Import required modules
const { google } = require('googleapis');
const axios = require('axios');
const { KeywordDetector } = require('./keyword-detector');
const { LLMAnalyzer } = require('./llm-analyzer');

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
    
    // Initialize keyword detector and LLM analyzer
    const detector = new KeywordDetector();
    const llmAnalyzer = new LLMAnalyzer();
    
    // Detect meetings with keyword analysis
    const keywordDetections = detector.detectMeetings(messages);
    console.log(`🎯 Keyword detector found ${keywordDetections.length} potential meetings`);
    
    // Enhance with LLM analysis for better accuracy
    const detectedMeetings = await enhanceWithLLMAnalysis(keywordDetections, messages, llmAnalyzer);
    console.log(`🤖 After LLM analysis: ${detectedMeetings.length} confirmed meetings`);
    
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
    console.log(`📱 Getting chats for ${userData.name}...`);
    
    // Get all chats first
    const response = await axios.get(
      `https://api.green-api.com/waInstance${userData.greenApi.instanceId}/getChats/${userData.greenApi.token}`
    );
    
    const allChats = response.data || [];
    console.log(`📂 Found ${allChats.length} total chats`);
    
    // Filter to exclude group chats BUT include 2-person groups and important family groups
    const individualChats = allChats.filter(chat => {
      const isGroup = chat.id && chat.id.includes('@g.us');
      
      if (!isGroup) {
        return true;  // Keep all individual chats
      }
      
      // For group chats, include only small/family groups
      const name = chat.name || '';
      const isSmallFamilyGroup = 
        name.includes('יונית') || 
        name.includes('Yonit') || 
        name.toLowerCase().includes('family') ||
        name.includes('שחר') ||
        chat.id.includes('972542181826') ||  // Yonit's specific chat
        chat.id.includes('972546738221') ||  // Shahar's specific chat  
        (chat.participantsCount && chat.participantsCount <= 3);  // Small groups only
      
      if (isSmallFamilyGroup) {
        console.log(`   🏠 Including family/small group: ${name}`);
        return true;
      }
      
      return false;  // Exclude all other groups
    });
    
    console.log(`👤 Filtered to ${individualChats.length} individual chats (excluding groups)`);
    
    // Get messages from individual chats only
    const allMessages = [];
    const now = Date.now();
    const twentyFourHoursAgo = now - (24 * 60 * 60 * 1000);
    
    // Prioritize known contacts and recent chats
    const prioritizedChats = individualChats.sort((a, b) => {
      // Prioritize chats with names (known contacts) over unknown numbers
      const aHasName = (a.name && a.name !== 'Unknown') ? 1 : 0;
      const bHasName = (b.name && b.name !== 'Unknown') ? 1 : 0;
      
      if (aHasName !== bHasName) return bHasName - aHasName;
      
      // Then sort by recent activity
      const aTime = a.lastMessage?.timestamp || 0;
      const bTime = b.lastMessage?.timestamp || 0;
      return bTime - aTime;
    });
    
    console.log(`🎯 Top prioritized individual chats:`);
    prioritizedChats.slice(0, 10).forEach((chat, i) => {
      console.log(`   ${i+1}. ${chat.name || 'Unknown'} (${chat.id.substring(0, 20)}...)`);
    });
    
    for (const chat of prioritizedChats.slice(0, 15)) { // Limit to top 15 prioritized chats
      try {
        console.log(`📄 Getting messages from: ${chat.name || 'Unknown'} (${chat.id.substring(0, 15)}...)`);
        
        const historyResponse = await axios.post(
          `https://api.green-api.com/waInstance${userData.greenApi.instanceId}/getChatHistory/${userData.greenApi.token}`,
          {
            chatId: chat.id,
            count: 100  // Get last 100 messages from each chat to find older messages
          }
        );
        
        if (historyResponse.data && historyResponse.data.length > 0) {
          // Filter messages to last 24 hours and format them
          const recentMessages = historyResponse.data.filter(msg => {
            const messageTime = msg.timestamp * 1000;
            return messageTime >= twentyFourHoursAgo;
          }).map(msg => ({
            id: msg.idMessage || Date.now(),
            text: msg.textMessage || '',
            timestamp: msg.timestamp,
            senderName: msg.senderName || userData.name,
            senderId: msg.senderId || userData.phoneNumber,
            chatId: chat.id,
            chatName: chat.name
          })).filter(msg => msg.text.trim().length > 0);
          
          allMessages.push(...recentMessages);
          console.log(`   ✅ Added ${recentMessages.length} messages from last 24h`);
        }
        
        // Longer delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
        
      } catch (chatError) {
        if (chatError.response?.status === 429) {
          console.log(`   ⚠️ Rate limited for ${chat.name || 'Unknown'}, skipping...`);
        } else {
          console.log(`   ❌ Error getting messages from ${chat.name || 'Unknown'}: ${chatError.message}`);
        }
      }
    }
    
    // Sort by timestamp (newest first)
    allMessages.sort((a, b) => b.timestamp - a.timestamp);
    
    console.log(`📋 Total messages collected: ${allMessages.length} from individual chats only`);
    
    return allMessages;
    
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
    
    // Get all unique dates from detected meetings (enhanced with LLM data)
    const datesToCheck = new Set();
    for (const meeting of detectedMeetings) {
      // Priority 1: Use LLM-extracted datetime if available
      if (meeting.llmDateTime) {
        try {
          const llmDate = new Date(meeting.llmDateTime);
          if (!isNaN(llmDate)) {
            datesToCheck.add(llmDate.toDateString());
            console.log(`📅 Using LLM date: ${llmDate.toDateString()} from "${meeting.extractedText.substring(0, 30)}..."`);
            continue;
          }
        } catch (e) {
          console.warn(`Could not parse LLM datetime: ${meeting.llmDateTime}`);
        }
      }
      
      // Priority 2: Use keyword-detected parsed dates
      if (meeting.parsedDates && meeting.parsedDates.length > 0) {
        meeting.parsedDates.forEach(date => {
          datesToCheck.add(date.toDateString());
        });
      } else {
        // Priority 3: Fallback - check today and tomorrow
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
    
    // Check each detected meeting against calendar events (enhanced with LLM data)
    for (const event of calendarEvents) {
      const eventStart = new Date(event.start.dateTime || event.start.date);
      const eventDateOnly = new Date(eventStart.toDateString());
      
      // Get meeting date (prioritize LLM-extracted datetime)
      let meetingDates = [];
      
      if (meeting.llmDateTime) {
        try {
          const llmDate = new Date(meeting.llmDateTime);
          if (!isNaN(llmDate)) {
            meetingDates.push(llmDate);
          }
        } catch (e) {
          console.warn(`Could not parse LLM datetime: ${meeting.llmDateTime}`);
        }
      }
      
      // Fallback to parsed dates from keyword detection
      if (meetingDates.length === 0 && meeting.parsedDates && meeting.parsedDates.length > 0) {
        meetingDates = meeting.parsedDates;
      }
      
      for (const meetingDate of meetingDates) {
        const meetingDateOnly = new Date(meetingDate.toDateString());
        
        // Check if it's the same day
        if (meetingDateOnly.getTime() === eventDateOnly.getTime()) {
            // Check for time conflicts (prioritize LLM-extracted time)
            let meetingTimeForComparison = null;
            
            // Use LLM datetime if available and has time component
            if (meeting.llmDateTime) {
              try {
                const llmDate = new Date(meeting.llmDateTime);
                if (!isNaN(llmDate) && meeting.llmDateTime.includes(':')) {
                  meetingTimeForComparison = llmDate.getHours() + ':' + String(llmDate.getMinutes()).padStart(2, '0');
                }
              } catch (e) {
                // Fallback to detected time
              }
            }
            
            // Fallback to keyword-detected time
            if (!meetingTimeForComparison && meeting.detectedTime) {
              meetingTimeForComparison = meeting.detectedTime.toLowerCase();
            }
            
            if (meetingTimeForComparison && event.start.dateTime) {
              const eventTime = eventStart.getHours() + ':' + String(eventStart.getMinutes()).padStart(2, '0');
              
              // Simple time conflict detection
              if (meetingTimeForComparison.includes(eventTime) || 
                  eventTime.includes(meetingTimeForComparison.replace(/[^\d:]/g, ''))) {
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
    
    // If no match or conflict found, it might be missing from calendar
    // Use LLM confidence if available, otherwise fallback to keyword confidence
    const effectiveConfidence = meeting.llmAnalysis ? 
      meeting.llmAnalysis.confidence / 100 : 
      meeting.confidence;
      
    if (!foundMatch && !foundConflict && effectiveConfidence > 0.6) {
      const reason = meeting.llmAnalysis ? 
        `Claude confirmed meeting (${meeting.llmAnalysis.confidence}%) not found in calendar` :
        'High confidence meeting not found in calendar';
        
      missingEvents.push({
        meeting: meeting,
        reason: reason
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

async function enhanceWithLLMAnalysis(keywordDetections, allMessages, llmAnalyzer) {
  const confirmedMeetings = [];
  
  for (const detection of keywordDetections) {
    try {
      // Get conversation context for this detection
      const conversationContext = getConversationContext(detection, allMessages);
      
      // Analyze with Claude
      const llmResult = await llmAnalyzer.analyzeConversation(detection, conversationContext);
      
      // Add LLM analysis to the detection
      detection.llmAnalysis = llmResult;
      
      // Only include meetings that Claude confirms as valid
      if (llmResult.isValidMeeting && llmResult.confidence > 50) {
        // Enhance detection with LLM-extracted information
        if (llmResult.extractedDateTime) {
          detection.llmDateTime = llmResult.extractedDateTime;
        }
        if (llmResult.extractedLocation) {
          detection.llmLocation = llmResult.extractedLocation;
        }
        if (llmResult.extractedParticipants) {
          detection.llmParticipants = llmResult.extractedParticipants;
        }
        if (llmResult.meetingType) {
          detection.llmMeetingType = llmResult.meetingType;
        }
        
        confirmedMeetings.push(detection);
        console.log(`✅ Claude confirmed: "${detection.extractedText.substring(0, 40)}..." (${llmResult.confidence}%)`);
      } else {
        console.log(`❌ Claude rejected: "${detection.extractedText.substring(0, 40)}..." - ${llmResult.reasoning}`);
      }
    } catch (error) {
      console.error(`Error analyzing detection with LLM:`, error.message);
      // On error, include the original detection (fallback)
      confirmedMeetings.push(detection);
    }
  }
  
  return confirmedMeetings;
}

function getConversationContext(targetDetection, allMessages) {
  // Find messages from the same chat
  const chatMessages = allMessages.filter(msg => 
    msg.chatId === targetDetection.chatId || 
    msg.senderId === targetDetection.senderName ||
    // Fallback: if no chatId, group by similar sender patterns
    (!msg.chatId && !targetDetection.chatId)
  );
  
  // Get messages around the target message time (±2 hours window)
  const targetTime = targetDetection.timestamp;
  const contextWindow = 2 * 60 * 60; // 2 hours in seconds
  
  const contextMessages = chatMessages.filter(msg => {
    const msgTime = msg.timestamp || Date.now() / 1000;
    return Math.abs(msgTime - targetTime) <= contextWindow;
  });
  
  // Sort by timestamp and return
  return contextMessages.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
}

// Run if called directly
if (require.main === module) {
  runStandaloneAudit();
}

module.exports = { runStandaloneAudit };