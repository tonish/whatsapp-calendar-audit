import { DetectedMeeting, CalendarEvent, AuditRecord, NotificationSummary } from '../types';
import { CachedGreenApiService } from './cachedGreenApi';
import { GoogleCalendarService } from './googleCalendar';
import { DatabaseManager } from '../models/database';
import { KeywordDetector } from '../utils/keywordDetector';
import { subDays, addDays, parseISO, isWithinInterval, format } from 'date-fns';

export class AuditService {
  private greenApi: CachedGreenApiService;
  private googleCalendar: GoogleCalendarService;
  private database: DatabaseManager;
  private keywordDetector: KeywordDetector;

  constructor() {
    this.greenApi = new CachedGreenApiService();
    this.googleCalendar = new GoogleCalendarService();
    this.database = new DatabaseManager();
    this.keywordDetector = new KeywordDetector();
  }

  async performAudit(): Promise<NotificationSummary> {
    console.log('Starting audit process...');

    const whatsappMessages = await this.greenApi.getLastThreeDaysMessages();
    console.log(`Found ${whatsappMessages.length} WhatsApp messages`);

    const detectedMeetings = await this.keywordDetector.detectMeetings(whatsappMessages);
    console.log(`Detected ${detectedMeetings.length} potential meetings`);

    const calendarEvents = await this.googleCalendar.getLastThreeDaysEvents();
    console.log(`Found ${calendarEvents.length} calendar events`);

    const auditRecords: AuditRecord[] = [];
    const summaryDetails: NotificationSummary['details'] = [];

    for (const meeting of detectedMeetings) {
      await this.database.saveDetectedMeeting(meeting);
      
      const auditResult = await this.auditMeeting(meeting, calendarEvents);
      auditRecords.push(auditResult);
      await this.database.saveAuditRecord(auditResult);

      summaryDetails.push({
        senderName: meeting.senderName,
        meetingText: meeting.extractedText.substring(0, 100),
        status: this.getStatusDescription(auditResult.status),
        recommendation: this.getRecommendation(auditResult)
      });
    }

    const summary = await this.createSummary(detectedMeetings, auditRecords, summaryDetails);
    console.log('Audit completed');
    
    return summary;
  }

  private async auditMeeting(meeting: DetectedMeeting, calendarEvents: CalendarEvent[]): Promise<AuditRecord> {
    const auditId = `audit_${meeting.id}_${Date.now()}`;
    
    const matchingEvents = this.findMatchingEvents(meeting, calendarEvents);
    
    if (matchingEvents.length === 0) {
      return {
        id: auditId,
        detectedMeetingId: meeting.id,
        status: 'missing_from_calendar',
        createdAt: Date.now()
      };
    }

    const bestMatch = matchingEvents[0];
    const conflict = this.detectConflict(meeting, bestMatch, calendarEvents);
    
    if (conflict) {
      return {
        id: auditId,
        detectedMeetingId: meeting.id,
        calendarEventId: bestMatch.id,
        status: 'conflict_detected',
        conflictDetails: conflict,
        createdAt: Date.now()
      };
    }

    return {
      id: auditId,
      detectedMeetingId: meeting.id,
      calendarEventId: bestMatch.id,
      status: 'found_in_calendar',
      createdAt: Date.now()
    };
  }

  private findMatchingEvents(meeting: DetectedMeeting, calendarEvents: CalendarEvent[]): CalendarEvent[] {
    const matches: Array<{ event: CalendarEvent; score: number }> = [];
    
    for (const event of calendarEvents) {
      let score = 0;
      
      if (meeting.detectedNames) {
        for (const name of meeting.detectedNames) {
          if (event.summary.toLowerCase().includes(name.toLowerCase()) ||
              event.description?.toLowerCase().includes(name.toLowerCase()) ||
              event.attendees?.some(attendee => 
                attendee.displayName?.toLowerCase().includes(name.toLowerCase())
              )) {
            score += 0.4;
          }
        }
      }
      
      if (meeting.senderName && (
          event.summary.toLowerCase().includes(meeting.senderName.toLowerCase()) ||
          event.description?.toLowerCase().includes(meeting.senderName.toLowerCase())
        )) {
        score += 0.3;
      }
      
      if (meeting.detectedDate && this.isDateMatching(meeting.detectedDate, event)) {
        score += 0.3;
      }
      
      if (score > 0.2) {
        matches.push({ event, score });
      }
    }
    
    return matches
      .sort((a, b) => b.score - a.score)
      .map(match => match.event);
  }

  private isDateMatching(detectedDate: string, event: CalendarEvent): boolean {
    try {
      const eventDate = parseISO(event.start.dateTime || event.start.date || '');
      const detectedDateObj = new Date(detectedDate);
      
      return eventDate.toDateString() === detectedDateObj.toDateString();
    } catch {
      return false;
    }
  }

  private detectConflict(meeting: DetectedMeeting, matchedEvent: CalendarEvent, allEvents: CalendarEvent[]): string | undefined {
    try {
      const eventDate = parseISO(matchedEvent.start.dateTime || matchedEvent.start.date || '');
      const eventTime = {
        start: parseISO(matchedEvent.start.dateTime || matchedEvent.start.date || ''),
        end: parseISO(matchedEvent.end.dateTime || matchedEvent.end.date || '')
      };
      
      const overlappingEvents = allEvents.filter(event => {
        if (event.id === matchedEvent.id) return false;
        
        const otherStart = parseISO(event.start.dateTime || event.start.date || '');
        const otherEnd = parseISO(event.end.dateTime || event.end.date || '');
        
        return (
          isWithinInterval(otherStart, { start: eventTime.start, end: eventTime.end }) ||
          isWithinInterval(otherEnd, { start: eventTime.start, end: eventTime.end }) ||
          isWithinInterval(eventTime.start, { start: otherStart, end: otherEnd })
        );
      });
      
      if (overlappingEvents.length > 0) {
        const conflictDescriptions = overlappingEvents.map(event => 
          `${event.summary} (${format(parseISO(event.start.dateTime || event.start.date || ''), 'HH:mm')})`
        ).join(', ');
        
        return `Time conflict with: ${conflictDescriptions}`;
      }
      
      return undefined;
    } catch {
      return undefined;
    }
  }

  private getStatusDescription(status: string): string {
    switch (status) {
      case 'missing_from_calendar':
        return 'Missing from calendar';
      case 'found_in_calendar':
        return 'Found in calendar';
      case 'conflict_detected':
        return 'Schedule conflict detected';
      default:
        return 'Unknown status';
    }
  }

  private getRecommendation(auditResult: AuditRecord): string {
    switch (auditResult.status) {
      case 'missing_from_calendar':
        return 'Consider adding this meeting to your calendar';
      case 'found_in_calendar':
        return 'Meeting is properly scheduled';
      case 'conflict_detected':
        return `Resolve scheduling conflict: ${auditResult.conflictDetails}`;
      default:
        return 'Review meeting details';
    }
  }

  private async createSummary(
    detectedMeetings: DetectedMeeting[],
    auditRecords: AuditRecord[],
    details: NotificationSummary['details']
  ): Promise<NotificationSummary> {
    const missingFromCalendar = auditRecords.filter(r => r.status === 'missing_from_calendar').length;
    const conflicts = auditRecords.filter(r => r.status === 'conflict_detected').length;
    
    return {
      totalMessages: detectedMeetings.length,
      detectedMeetings: detectedMeetings.length,
      missingFromCalendar,
      conflicts,
      details
    };
  }

  async close(): Promise<void> {
    await this.database.close();
  }
}