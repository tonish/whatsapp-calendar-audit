export interface WhatsAppMessage {
  id: string;
  timestamp: number;
  chatId: string;
  senderId: string;
  senderName: string;
  text: string;
  type: string;
}

export interface CalendarEvent {
  id: string;
  summary: string;
  description?: string;
  start: {
    dateTime: string;
    date?: string;
  };
  end: {
    dateTime: string;
    date?: string;
  };
  attendees?: Array<{
    email: string;
    displayName?: string;
  }>;
  location?: string;
}

export interface DetectedMeeting {
  id: string;
  messageId: string;
  chatId: string;
  senderName: string;
  extractedText: string;
  detectedKeywords: string[];
  detectedDate?: string;
  detectedTime?: string;
  detectedNames?: string[];
  confidence: number;
  timestamp: number;
  llmAnalysis?: LLMAnalysisResult;
}

export interface LLMAnalysisResult {
  isValidMeeting: boolean;
  confidence: number;
  extractedDateTime?: string;
  extractedLocation?: string;
  extractedParticipants?: string[];
  meetingType?: string;
  reasoning: string;
}

export interface AuditRecord {
  id: string;
  detectedMeetingId: string;
  calendarEventId?: string;
  status: 'missing_from_calendar' | 'found_in_calendar' | 'conflict_detected';
  conflictDetails?: string;
  createdAt: number;
}

export interface Config {
  greenApi: {
    idInstance: string;
    apiTokenInstance: string;
    baseUrl: string;
  };
  googleCalendar: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    calendarId: string;
  };
  keywords: {
    hebrew: string[];
    english: string[];
  };
  database: {
    path: string;
  };
}

export interface NotificationSummary {
  totalMessages: number;
  detectedMeetings: number;
  missingFromCalendar: number;
  conflicts: number;
  details: Array<{
    senderName: string;
    meetingText: string;
    status: string;
    recommendation: string;
  }>;
}