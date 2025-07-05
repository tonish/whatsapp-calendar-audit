// JavaScript port of KeywordDetector for GitHub Actions
class KeywordDetector {
  constructor() {
    this.hebrewKeywords = [
      'פגישה', 'מפגש', 'פגישת', 'נפגש', 'להיפגש',
      'מינוי', 'תור', 'זמן', 'מחר', 'היום',
      'שעה', 'בוקר', 'צהריים', 'אחר הצהריים', 'ערב',
      'ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת',
      'ביום', 'תאריך', 'מועד', 'נקבע', 'קובעים', 'לקבוע', 'לתאם', 'לזמן',
      'טיפול', 'אוסתאופתיה', 'אוסתאופטיה', 'כאב', 'גב',
      'רופא', 'דוקטור', 'קליניקה', 'בדיקה', 'תור',
      // Hebrew confirmations and casual scheduling words
      'בסדר', 'מוכן', 'מוכנה', 'טוב', 'נהדר', 'מושלם', 'אוקיי', 
      'מסכים', 'מסכימה', 'נפלא', 'יופי', 'סבבה', 'תמים',
      // Hebrew scheduling and meeting words
      'נפגשים', 'נפגש', 'נפגשת', 'ניפגש', 'להיפגש', 'נפגישה',
      'אנחנו', 'יהיה', 'יכול', 'יכולה', 'נוכל', 'בואו', 'תן', 'תני',
      'מתאים', 'מתאימה', 'נוח', 'נוחה', 'אפשר', 'אפשרי',
      // Hebrew time/location indicators  
      'אצל', 'בבית', 'במשרד', 'בקליניקה', 'שם', 'פה', 'כאן',
      'ב-', 'את', 'של', 'עם', 'אחרי', 'לפני', 'במקום'
    ];

    this.englishKeywords = [
      'meeting', 'meet', 'appointment', 'schedule', 'scheduled', 'planned',
      'today', 'tomorrow', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
      'morning', 'afternoon', 'evening', 'night', 'am', 'pm',
      'time', 'date', 'when', 'at', 'on', 'call', 'visit',
      'doctor', 'clinic', 'checkup', 'treatment', 'therapy', 'osteopath',
      // Casual confirmation words for LLM analysis
      'set', 'confirmed', 'good', 'sounds', 'okay', 'ok', 'ready', 'fine', 'perfect', 'great',
      'awesome', 'cool', 'works', 'done', 'agreed', 'yes', 'yep', 'sure', 'absolutely',
      // Common scheduling words
      'we', 'were', 'are', 'lets', "let's", 'can', 'will', 'shall', 'could', 'should',
      'see', 'meet', 'there', 'here', 'place', 'location', 'where', 'when',
      // Mixed language triggers (common in Israeli WhatsApp)
      'then', 'so', 'but', 'and', 'the', 'for', 'with', 'at', 'in', 'on'
    ];

    this.datePatterns = [
      /\d{1,2}\/\d{1,2}\/\d{2,4}/g,
      /\d{1,2}-\d{1,2}-\d{2,4}/g,
      /\d{1,2}\.\d{1,2}\.\d{2,4}/g,
      /(tomorrow|today|מחר|היום)/gi,
      /(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/gi,
      /(ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת)/gi,
      /(next week|השבוע הבא|השבוע)/gi
    ];

    this.timePatterns = [
      /\d{1,2}:\d{2}(\s?(am|pm|AM|PM))?/g,
      /\d{1,2}\s?(am|pm|AM|PM)/g,
      /(morning|afternoon|evening|בוקר|צהריים|אחר הצהריים|ערב)/gi,
      /(\d{1,2})\s?(בבוקר|בצהריים|בערב|אחה\"צ)/gi
    ];

    this.namePatterns = [
      /with\s+([A-Za-z\u0590-\u05FF\s]+)/gi,
      /עם\s+([A-Za-z\u0590-\u05FF\s]+)/gi,
      /([A-Z][a-z]+\s+[A-Z][a-z]+)/g,
      /([א-ת]+\s+[א-ת]+)/g
    ];
  }

  detectMeetings(messages) {
    const detectedMeetings = [];

    for (const message of messages) {
      const detection = this.analyzeMessage(message);
      if (detection) {
        console.log(`🎯 Detected potential meeting: "${detection.extractedText.substring(0, 50)}..." (confidence: ${Math.round(detection.confidence * 100)}%)`);
        detectedMeetings.push(detection);
      }
    }

    return detectedMeetings;
  }

  analyzeMessage(message) {
    const text = message.text?.toLowerCase() || '';
    const originalText = message.text || '';
    
    if (!text.trim()) return null;

    const hebrewMatches = this.hebrewKeywords.filter(keyword => 
      text.includes(keyword.toLowerCase())
    );
    
    const englishMatches = this.englishKeywords.filter(keyword => 
      text.includes(keyword.toLowerCase())
    );

    const totalMatches = hebrewMatches.length + englishMatches.length;
    
    if (totalMatches === 0) {
      return null;
    }

    const detectedDates = this.extractDates(originalText);
    const detectedTimes = this.extractTimes(originalText);
    const detectedNames = this.extractNames(originalText);

    const confidence = this.calculateConfidence(
      totalMatches,
      detectedDates.length,
      detectedTimes.length,
      detectedNames.length
    );

    // Very low threshold for LLM analysis - let Claude decide
    if (confidence < 0.1) {
      return null;
    }

    // Parse detected dates into actual dates
    const parsedDates = this.parseDates(detectedDates);

    return {
      id: `${message.id || 'msg'}_${Date.now()}`,
      messageId: message.id,
      chatId: message.chatId,
      senderName: message.senderName || message.senderId,
      extractedText: originalText,
      detectedKeywords: [...hebrewMatches, ...englishMatches],
      detectedDate: detectedDates[0] || undefined,
      detectedTime: detectedTimes[0] || undefined,
      detectedNames: detectedNames.length > 0 ? detectedNames : undefined,
      parsedDates: parsedDates,
      confidence,
      timestamp: message.timestamp || Date.now() / 1000
    };
  }

  extractDates(text) {
    const dates = [];
    
    for (const pattern of this.datePatterns) {
      const matches = text.match(pattern);
      if (matches) {
        dates.push(...matches);
      }
    }

    return [...new Set(dates)];
  }

  extractTimes(text) {
    const times = [];
    
    for (const pattern of this.timePatterns) {
      const matches = text.match(pattern);
      if (matches) {
        times.push(...matches);
      }
    }

    return [...new Set(times)];
  }

  extractNames(text) {
    const names = [];
    
    for (const pattern of this.namePatterns) {
      const matches = text.match(pattern);
      if (matches) {
        matches.forEach(match => {
          const cleanName = match.replace(/^(with|עם)\s+/i, '').trim();
          if (cleanName.length > 2) {
            names.push(cleanName);
          }
        });
      }
    }

    return [...new Set(names)];
  }

  parseDates(dateStrings) {
    const parsedDates = [];
    const now = new Date();

    for (const dateStr of dateStrings) {
      let targetDate = null;

      // Handle relative dates
      if (/tomorrow|מחר/i.test(dateStr)) {
        targetDate = new Date(now);
        targetDate.setDate(now.getDate() + 1);
      } else if (/today|היום/i.test(dateStr)) {
        targetDate = new Date(now);
      } else if (/monday|ראשון/i.test(dateStr)) {
        targetDate = this.getNextWeekday(1); // Monday
      } else if (/tuesday|שני/i.test(dateStr)) {
        targetDate = this.getNextWeekday(2); // Tuesday
      } else if (/wednesday|שלישי/i.test(dateStr)) {
        targetDate = this.getNextWeekday(3); // Wednesday
      } else if (/thursday|רביעי/i.test(dateStr)) {
        targetDate = this.getNextWeekday(4); // Thursday
      } else if (/friday|חמישי/i.test(dateStr)) {
        targetDate = this.getNextWeekday(5); // Friday
      } else if (/saturday|שישי/i.test(dateStr)) {
        targetDate = this.getNextWeekday(6); // Saturday
      } else if (/sunday|שבת/i.test(dateStr)) {
        targetDate = this.getNextWeekday(0); // Sunday
      }
      // Handle date formats like DD/MM/YYYY
      else if (/\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}/.test(dateStr)) {
        try {
          // Assume DD/MM/YYYY format (common in Israel)
          const parts = dateStr.split(/[\/\-\.]/);
          if (parts.length >= 3) {
            const day = parseInt(parts[0]);
            const month = parseInt(parts[1]) - 1; // JS months are 0-based
            const year = parseInt(parts[2]);
            targetDate = new Date(year < 100 ? 2000 + year : year, month, day);
          }
        } catch (e) {
          console.warn(`Could not parse date: ${dateStr}`);
        }
      }

      if (targetDate && targetDate instanceof Date && !isNaN(targetDate)) {
        parsedDates.push(targetDate);
      }
    }

    return parsedDates;
  }

  getNextWeekday(targetDay) {
    const now = new Date();
    const currentDay = now.getDay();
    let daysUntilTarget = targetDay - currentDay;
    
    // If the target day has already passed this week, get next week's occurrence
    if (daysUntilTarget <= 0) {
      daysUntilTarget += 7;
    }
    
    const targetDate = new Date(now);
    targetDate.setDate(now.getDate() + daysUntilTarget);
    return targetDate;
  }

  calculateConfidence(keywordMatches, dateMatches, timeMatches, nameMatches) {
    let confidence = 0;

    // Base confidence from keywords
    confidence += Math.min(keywordMatches * 0.3, 0.6);
    
    // Bonus for date information
    confidence += Math.min(dateMatches * 0.25, 0.4);
    
    // Bonus for time information
    confidence += Math.min(timeMatches * 0.2, 0.3);
    
    // Small bonus for names (participants)
    confidence += Math.min(nameMatches * 0.1, 0.2);

    return Math.min(confidence, 1.0);
  }
}

module.exports = { KeywordDetector };