import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { CalendarEvent } from '../types';
import { config } from '../utils/config';
import { subDays, addDays } from 'date-fns';

export class GoogleCalendarService {
  private oauth2Client: OAuth2Client;
  private calendar: any;

  constructor() {
    this.oauth2Client = new OAuth2Client(
      config.googleCalendar.clientId,
      config.googleCalendar.clientSecret,
      config.googleCalendar.redirectUri
    );

    this.calendar = google.calendar({ version: 'v3', auth: this.oauth2Client });
  }

  getAuthUrl(): string {
    const scopes = [
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/calendar.events'
    ];

    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      prompt: 'consent'
    });
  }

  async setCredentials(code: string): Promise<void> {
    try {
      const { tokens } = await this.oauth2Client.getToken(code);
      this.oauth2Client.setCredentials(tokens);
    } catch (error) {
      console.error('Error getting access token:', error);
      throw error;
    }
  }

  async loadSavedTokens(tokens: any): Promise<void> {
    this.oauth2Client.setCredentials(tokens);
  }

  getTokens(): any {
    return this.oauth2Client.credentials;
  }

  async getEventsInDateRange(startDate: Date, endDate: Date): Promise<CalendarEvent[]> {
    try {
      const response = await this.calendar.events.list({
        calendarId: config.googleCalendar.calendarId,
        timeMin: startDate.toISOString(),
        timeMax: endDate.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 250
      });

      const events = response.data.items || [];
      
      return events.map((event: any) => ({
        id: event.id,
        summary: event.summary || '',
        description: event.description || '',
        start: {
          dateTime: event.start.dateTime || event.start.date,
          date: event.start.date
        },
        end: {
          dateTime: event.end.dateTime || event.end.date,
          date: event.end.date
        },
        attendees: event.attendees || [],
        location: event.location || ''
      }));
    } catch (error) {
      console.error('Error fetching calendar events:', error);
      throw error;
    }
  }

  async getLastThreeDaysEvents(): Promise<CalendarEvent[]> {
    const startDate = subDays(new Date(), 3);
    const endDate = addDays(new Date(), 1);
    
    return this.getEventsInDateRange(startDate, endDate);
  }

  async searchEvents(query: string, startDate: Date, endDate: Date): Promise<CalendarEvent[]> {
    try {
      const response = await this.calendar.events.list({
        calendarId: config.googleCalendar.calendarId,
        timeMin: startDate.toISOString(),
        timeMax: endDate.toISOString(),
        q: query,
        singleEvents: true,
        orderBy: 'startTime'
      });

      const events = response.data.items || [];
      
      return events.map((event: any) => ({
        id: event.id,
        summary: event.summary || '',
        description: event.description || '',
        start: {
          dateTime: event.start.dateTime || event.start.date,
          date: event.start.date
        },
        end: {
          dateTime: event.end.dateTime || event.end.date,
          date: event.end.date
        },
        attendees: event.attendees || [],
        location: event.location || ''
      }));
    } catch (error) {
      console.error('Error searching calendar events:', error);
      throw error;
    }
  }

  async findEventsByNames(names: string[], startDate: Date, endDate: Date): Promise<CalendarEvent[]> {
    const allEvents: CalendarEvent[] = [];
    
    for (const name of names) {
      const events = await this.searchEvents(name, startDate, endDate);
      allEvents.push(...events);
    }

    return this.removeDuplicateEvents(allEvents);
  }

  private removeDuplicateEvents(events: CalendarEvent[]): CalendarEvent[] {
    const uniqueEvents = new Map<string, CalendarEvent>();
    
    for (const event of events) {
      uniqueEvents.set(event.id, event);
    }
    
    return Array.from(uniqueEvents.values());
  }

  async isAuthenticated(): Promise<boolean> {
    try {
      const tokens = this.oauth2Client.credentials;
      if (!tokens.access_token) {
        return false;
      }

      if (tokens.expiry_date && tokens.expiry_date < Date.now()) {
        if (tokens.refresh_token) {
          await this.oauth2Client.refreshAccessToken();
          return true;
        }
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error checking authentication:', error);
      return false;
    }
  }
}