import { DetectedMeeting, WhatsAppMessage } from '../types';
import { config } from './config';
import { parse, format, isValid } from 'date-fns';
import { LLMAnalyzer } from '../services/llmAnalyzer';

export class KeywordDetector {
  private hebrewKeywords: string[];
  private englishKeywords: string[];
  private datePatterns: RegExp[];
  private timePatterns: RegExp[];
  private namePatterns: RegExp[];
  private llmAnalyzer: LLMAnalyzer;

  constructor() {
    this.llmAnalyzer = new LLMAnalyzer();
    this.hebrewKeywords = config.keywords.hebrew;
    this.englishKeywords = config.keywords.english;
    
    this.datePatterns = [
      /\d{1,2}\/\d{1,2}\/\d{2,4}/g,
      /\d{1,2}-\d{1,2}-\d{2,4}/g,
      /\d{1,2}\.\d{1,2}\.\d{2,4}/g,
      /(tomorrow|today|מחר|היום)/gi,
      /(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/gi,
      /(ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת)/gi
    ];

    this.timePatterns = [
      /\d{1,2}:\d{2}(\s?(am|pm|AM|PM))?/g,
      /\d{1,2}\s?(am|pm|AM|PM)/g,
      /(morning|afternoon|evening|בוקר|צהריים|אחר הצהריים|ערב)/gi
    ];

    this.namePatterns = [
      /with\s+([A-Za-z\u0590-\u05FF\s]+)/gi,
      /עם\s+([A-Za-z\u0590-\u05FF\s]+)/gi,
      /מ?([A-Z][a-z]+\s+[A-Z][a-z]+)/g,
      /([א-ת]+\s+[א-ת]+)/g
    ];
  }

  async detectMeetings(messages: WhatsAppMessage[]): Promise<DetectedMeeting[]> {
    const detectedMeetings: DetectedMeeting[] = [];

    for (const message of messages) {
      const detection = this.analyzeMessage(message);
      if (detection) {
        // Get conversation context for LLM analysis
        const conversationContext = this.getConversationContext(message, messages);
        
        // Perform LLM analysis
        console.log(`Analyzing message with Claude: "${detection.extractedText.substring(0, 50)}..."`);
        const llmAnalysis = await this.llmAnalyzer.analyzeConversation(detection, conversationContext);
        
        // Add LLM analysis to detection
        detection.llmAnalysis = llmAnalysis;
        
        // If Claude analysis is available, use it; otherwise use fallback
        if (this.llmAnalyzer.isEnabled()) {
          if (llmAnalysis.isValidMeeting && llmAnalysis.confidence > 50) {
            console.log(`✅ Claude confirmed meeting: ${llmAnalysis.reasoning}`);
            detectedMeetings.push(detection);
          } else {
            console.log(`❌ Claude rejected: ${llmAnalysis.reasoning}`);
          }
        } else {
          // Fallback: use original keyword detection confidence
          console.log(`📝 No Claude API - using keyword detection (confidence: ${Math.round(detection.confidence * 100)}%)`);
          detectedMeetings.push(detection);
        }
      }
    }

    return detectedMeetings;
  }

  private getConversationContext(targetMessage: WhatsAppMessage, allMessages: WhatsAppMessage[]): WhatsAppMessage[] {
    const targetTime = targetMessage.timestamp;
    const chatMessages = allMessages.filter(msg => msg.chatId === targetMessage.chatId);
    
    // Get messages from the same chat within 2 hours before and after
    const contextWindow = 2 * 60 * 60; // 2 hours in seconds
    
    return chatMessages.filter(msg => 
      Math.abs(msg.timestamp - targetTime) <= contextWindow
    ).sort((a, b) => a.timestamp - b.timestamp);
  }

  private analyzeMessage(message: WhatsAppMessage): DetectedMeeting | null {
    const text = message.text.toLowerCase();
    const originalText = message.text;
    
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

    if (confidence < 0.3) {
      return null;
    }

    return {
      id: `${message.id}_${Date.now()}`,
      messageId: message.id,
      chatId: message.chatId,
      senderName: message.senderName,
      extractedText: originalText,
      detectedKeywords: [...hebrewMatches, ...englishMatches],
      detectedDate: detectedDates[0] || undefined,
      detectedTime: detectedTimes[0] || undefined,
      detectedNames: detectedNames.length > 0 ? detectedNames : undefined,
      confidence,
      timestamp: message.timestamp
    };
  }

  private extractDates(text: string): string[] {
    const dates: string[] = [];
    
    for (const pattern of this.datePatterns) {
      const matches = text.match(pattern);
      if (matches) {
        dates.push(...matches);
      }
    }

    return [...new Set(dates)];
  }

  private extractTimes(text: string): string[] {
    const times: string[] = [];
    
    for (const pattern of this.timePatterns) {
      const matches = text.match(pattern);
      if (matches) {
        times.push(...matches);
      }
    }

    return [...new Set(times)];
  }

  private extractNames(text: string): string[] {
    const names: string[] = [];
    
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

  private calculateConfidence(
    keywordMatches: number,
    dateMatches: number,
    timeMatches: number,
    nameMatches: number
  ): number {
    let confidence = 0;

    confidence += Math.min(keywordMatches * 0.3, 0.6);
    confidence += Math.min(dateMatches * 0.2, 0.4);
    confidence += Math.min(timeMatches * 0.15, 0.3);
    confidence += Math.min(nameMatches * 0.1, 0.2);

    return Math.min(confidence, 1.0);
  }
}