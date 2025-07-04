import Anthropic from '@anthropic-ai/sdk';
import { WhatsAppMessage, DetectedMeeting } from '../types';

export interface LLMAnalysisResult {
  isValidMeeting: boolean;
  confidence: number;
  extractedDateTime?: string;
  extractedLocation?: string;
  extractedParticipants?: string[];
  meetingType?: string;
  reasoning: string;
}

export class LLMAnalyzer {
  private anthropic: Anthropic | null = null;
  private enabled: boolean;

  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    this.enabled = !!(apiKey && apiKey.trim().length > 0);
    
    if (this.enabled && apiKey) {
      this.anthropic = new Anthropic({ apiKey });
    } else {
      console.warn('Anthropic API key not found. LLM analysis will be skipped.');
    }
  }

  async analyzeConversation(
    detectedMeeting: DetectedMeeting,
    conversationHistory?: WhatsAppMessage[]
  ): Promise<LLMAnalysisResult> {
    if (!this.enabled) {
      return this.getFallbackResult(detectedMeeting);
    }

    try {
      const prompt = this.buildAnalysisPrompt(detectedMeeting, conversationHistory);
      
      if (!this.anthropic) {
        throw new Error('Anthropic client not initialized');
      }
      
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

      return this.parseAnalysisResponse(analysis);
    } catch (error) {
      console.error('Claude analysis failed:', error);
      return this.getFallbackResult(detectedMeeting);
    }
  }

  private buildAnalysisPrompt(
    detectedMeeting: DetectedMeeting,
    conversationHistory?: WhatsAppMessage[]
  ): string {
    let prompt = `You are a meeting detection expert. Analyze this WhatsApp conversation to determine if it contains valid meeting/appointment scheduling.

TASK: Determine if this conversation is actually scheduling a meeting/appointment with specific date/time information.

DETECTED MESSAGE:
From: ${detectedMeeting.senderName}
Text: "${detectedMeeting.extractedText}"
Keywords found: ${detectedMeeting.detectedKeywords.join(', ')}`;
    
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
      prompt += `\n\nCONVERSATION CONTEXT (recent messages):`;
      conversationHistory.slice(-5).forEach((msg) => {
        prompt += `\n${msg.senderName}: "${msg.text}"`;
      });
    }

    prompt += `

ANALYSIS CRITERIA:
Consider VALID meetings:
- Scheduling appointments (doctor, osteopathy, business, personal)
- Setting meeting times with specific dates/times
- Confirming planned meetings
- Rescheduling existing meetings

Consider INVALID:
- Casual mentions of time/dates without actual scheduling
- General discussions about meetings without concrete plans
- Past events or completed meetings
- Uncertain/tentative discussions without confirmation

REQUIRED OUTPUT FORMAT (JSON only):
{
  "isValidMeeting": boolean,
  "confidence": number (0-100),
  "extractedDateTime": "YYYY-MM-DD HH:MM or null",
  "extractedLocation": "string or null", 
  "extractedParticipants": ["array of names or null"],
  "meetingType": "appointment/meeting/treatment/etc or null",
  "reasoning": "brief explanation in Hebrew or English"
}

Analyze the conversation and respond with ONLY the JSON object:`;
    
    return prompt;
  }

  private parseAnalysisResponse(response: string): LLMAnalysisResult {
    try {
      // Extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]);
      
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
      console.error('Failed to parse Claude response:', response);
      return {
        isValidMeeting: false,
        confidence: 0,
        reasoning: 'Failed to parse Claude response'
      };
    }
  }

  private getFallbackResult(detectedMeeting: DetectedMeeting): LLMAnalysisResult {
    const hasDateTime = detectedMeeting.detectedDate || detectedMeeting.detectedTime;
    const confidence = Math.round(detectedMeeting.confidence * 100);
    
    return {
      isValidMeeting: !!(hasDateTime && confidence > 30),
      confidence,
      reasoning: 'Claude analysis unavailable, using fallback detection'
    };
  }

  isEnabled(): boolean {
    return this.enabled;
  }
}