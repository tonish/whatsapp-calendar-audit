// JavaScript port of LLM Analyzer for GitHub Actions
const Anthropic = require('@anthropic-ai/sdk');

class LLMAnalyzer {
  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    this.enabled = !!(apiKey && apiKey.trim().length > 0);
    
    if (this.enabled && apiKey) {
      this.anthropic = new Anthropic({ apiKey });
      console.log('🤖 Claude LLM analyzer initialized');
    } else {
      console.warn('⚠️ Anthropic API key not found. LLM analysis will be skipped.');
      this.anthropic = null;
    }
  }

  async analyzeConversation(detectedMeeting, conversationHistory = []) {
    if (!this.enabled) {
      return this.getFallbackResult(detectedMeeting);
    }

    try {
      const prompt = this.buildAnalysisPrompt(detectedMeeting, conversationHistory);
      
      if (!this.anthropic) {
        throw new Error('Anthropic client not initialized');
      }
      
      console.log(`🧠 Analyzing with Claude: "${detectedMeeting.extractedText.substring(0, 50)}..."`);
      
      const response = await this.anthropic.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 300,
        temperature: 0.1,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      });

      const analysis = response.content[0]?.type === 'text' ? response.content[0].text : '';
      if (!analysis) {
        return this.getFallbackResult(detectedMeeting);
      }

      const result = this.parseAnalysisResponse(analysis);
      console.log(`🎯 Claude result: ${result.isValidMeeting ? '✅ Valid' : '❌ Invalid'} (${result.confidence}%) - ${result.reasoning}`);
      
      return result;
    } catch (error) {
      console.error('❌ Claude analysis failed:', error.message);
      return this.getFallbackResult(detectedMeeting);
    }
  }

  buildAnalysisPrompt(detectedMeeting, conversationHistory = []) {
    let prompt = `You are an expert at detecting meeting/appointment scheduling in Hebrew and English WhatsApp conversations, particularly Israeli conversations with Hebrew-English code-switching.

DETECTED MESSAGE:
From: ${detectedMeeting.senderName || 'Unknown'}
Text: "${detectedMeeting.extractedText}"
Keywords found: ${detectedMeeting.detectedKeywords?.join(', ') || 'none'}`;
    
    if (detectedMeeting.detectedDate) {
      prompt += `\nDetected date: ${detectedMeeting.detectedDate}`;
    }
    
    if (detectedMeeting.detectedTime) {
      prompt += `\nDetected time: ${detectedMeeting.detectedTime}`;
    }
    
    if (detectedMeeting.detectedNames) {
      prompt += `\nDetected names: ${detectedMeeting.detectedNames.join(', ')}`;
    }

    if (conversationHistory && conversationHistory.length > 0) {
      prompt += `\n\nCONVERSATION CONTEXT (recent messages from same chat):`;
      // Show last 8 messages for better context
      conversationHistory.slice(-8).forEach((msg, index) => {
        const sender = msg.senderName || msg.senderId || 'Unknown';
        const text = msg.text || '';
        prompt += `\n[${index + 1}] ${sender}: "${text}"`;
      });
    }

    prompt += `

HEBREW-ENGLISH MEETING DETECTION GUIDE:

✅ VALID MEETING PATTERNS:

HEBREW SCHEDULING:
• "נפגשים מחר ב-3" (meeting tomorrow at 3)
• "יש לי תור לרופא ברביעי" (I have a doctor appointment Wednesday)
• "בואו נקבע פגישה" (let's schedule a meeting)
• "מתאים לך יום ראשון?" (is Sunday good for you?)
• "אוקיי נקבע למחר בבוקר" (ok scheduled for tomorrow morning)

HEBREW CONFIRMATIONS:
• "בסדר", "מסכים", "מוכן", "נקבע", "טוב", "נהדר"
• "אז מחר ב-3", "בואו נאמר ראשון", "יהיה מושלם"

ENGLISH CONFIRMATIONS:
• "ok were set", "sounds good", "perfect", "confirmed", "great"
• "see you tomorrow", "let's do it", "works for me"

MIXED HEBREW-ENGLISH:
• "ok נקבע מחר" (ok scheduled tomorrow)
• "sounds good, נפגשים ב-2" (sounds good, meeting at 2)
• "perfect אז ביום שני" (perfect so on Monday)

ISRAELI TIME/DATE FORMATS:
• Hebrew days: ראשון, שני, שלישי, רביעי, חמישי, שישי, שבת
• Times: בבוקר (morning), אחה״צ (afternoon), בערב (evening)
• Dates: DD/MM/YYYY format common in Israel
• "מחר" (tomorrow), "היום" (today), "השבוע" (this week)

MEDICAL/PROFESSIONAL HEBREW:
• "תור לרופא" (doctor appointment)
• "טיפול אוסתאופתיה" (osteopathy treatment)
• "פגישת עבודה" (work meeting)
• "אצל הדוקטור" (at the doctor)
• "תור לטיפול" (treatment appointment)

❌ INVALID PATTERNS:
• Past events: "היה לנו פגישה אתמול" (we had a meeting yesterday)
• Casual time mentions: "בסוף השבוע" without scheduling context
• Tentative: "אולי נפגש מחר" (maybe we'll meet tomorrow) without confirmation
• General discussion: "צריך לקבוע פגישה איפשהו" (need to schedule a meeting sometime)

CONFIRMATION ANALYSIS RULES:
1. If current message is confirmation (בסדר, ok, sounds good), search previous messages for meeting details
2. Confirmations like "אוקיי מחר ב-3" should extract full meeting info
3. Mixed language confirmations are very common in Israel
4. Look for implicit confirmations: "אני שם" (I'm there), "נראה אותך" (see you)

CULTURAL CONTEXT:
• Israelis often confirm meetings casually without repeating full details
• Hebrew-English mixing is extremely common in Israeli WhatsApp
• Time is often mentioned without explicit "meeting" words
• Medical appointments (תור) are very common

DATE/TIME EXTRACTION PRIORITY:
1. Explicit times: "ב-3", "at 3 PM", "בבוקר ב-10"
2. Hebrew day names: "ביום שני" (on Monday)
3. Relative dates: "מחר" (tomorrow), "השבוע" (this week)
4. Israeli date format: 15/12/2024

REQUIRED OUTPUT (JSON only, no other text):
{
  "isValidMeeting": boolean,
  "confidence": number (0-100),
  "extractedDateTime": "YYYY-MM-DD HH:MM or null",
  "extractedLocation": "string or null", 
  "extractedParticipants": ["array of names or null"],
  "meetingType": "appointment/meeting/treatment/etc or null",
  "reasoning": "brief explanation in Hebrew or English"
}

Analyze the conversation considering Hebrew-English patterns and respond with ONLY the JSON object:`;
    
    return prompt;
  }

  parseAnalysisResponse(response) {
    try {
      // Extract JSON from response - handle various formats
      let jsonStr = response.trim();
      
      // Try to find JSON block
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonStr = jsonMatch[0];
      }
      
      // Clean up common formatting issues
      jsonStr = jsonStr
        .replace(/```json\s*/g, '')
        .replace(/```\s*/g, '')
        .replace(/^\s*json\s*/g, '')
        .trim();

      const parsed = JSON.parse(jsonStr);
      
      return {
        isValidMeeting: !!parsed.isValidMeeting,
        confidence: Math.max(0, Math.min(100, parsed.confidence || 0)),
        extractedDateTime: parsed.extractedDateTime || undefined,
        extractedLocation: parsed.extractedLocation || undefined,
        extractedParticipants: parsed.extractedParticipants || undefined,
        meetingType: parsed.meetingType || undefined,
        reasoning: parsed.reasoning || 'No reasoning provided'
      };
    } catch (error) {
      console.error('❌ Failed to parse Claude response:', error.message);
      console.log('Raw response:', response.substring(0, 200));
      return {
        isValidMeeting: false,
        confidence: 0,
        reasoning: 'Failed to parse Claude response'
      };
    }
  }

  getFallbackResult(detectedMeeting) {
    const hasDateTime = detectedMeeting.detectedDate || detectedMeeting.detectedTime;
    const confidence = Math.round(detectedMeeting.confidence * 100);
    
    return {
      isValidMeeting: !!(hasDateTime && confidence > 30),
      confidence,
      reasoning: 'Claude analysis unavailable, using fallback keyword detection'
    };
  }

  isEnabled() {
    return this.enabled;
  }
}

module.exports = { LLMAnalyzer };