import sqlite3 from 'sqlite3';
import { Database } from 'sqlite3';
import { DetectedMeeting, AuditRecord } from '../types';
import { config } from '../utils/config';

export class DatabaseManager {
  private db: Database;

  constructor() {
    this.db = new sqlite3.Database(config.database.path);
    this.initializeTables();
  }

  private initializeTables(): void {
    const createDetectedMeetingsTable = `
      CREATE TABLE IF NOT EXISTS detected_meetings (
        id TEXT PRIMARY KEY,
        messageId TEXT NOT NULL,
        chatId TEXT NOT NULL,
        senderName TEXT NOT NULL,
        extractedText TEXT NOT NULL,
        detectedKeywords TEXT NOT NULL,
        detectedDate TEXT,
        detectedTime TEXT,
        detectedNames TEXT,
        confidence REAL NOT NULL,
        timestamp INTEGER NOT NULL,
        llmAnalysis TEXT,
        createdAt INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `;

    const createAuditRecordsTable = `
      CREATE TABLE IF NOT EXISTS audit_records (
        id TEXT PRIMARY KEY,
        detectedMeetingId TEXT NOT NULL,
        calendarEventId TEXT,
        status TEXT NOT NULL,
        conflictDetails TEXT,
        createdAt INTEGER DEFAULT (strftime('%s', 'now')),
        FOREIGN KEY (detectedMeetingId) REFERENCES detected_meetings (id)
      )
    `;

    const createIndexes = `
      CREATE INDEX IF NOT EXISTS idx_detected_meetings_timestamp ON detected_meetings(timestamp);
      CREATE INDEX IF NOT EXISTS idx_audit_records_status ON audit_records(status);
      CREATE INDEX IF NOT EXISTS idx_audit_records_created_at ON audit_records(createdAt);
    `;

    this.db.exec(createDetectedMeetingsTable);
    this.db.exec(createAuditRecordsTable);
    this.db.exec(createIndexes);
  }

  async saveDetectedMeeting(meeting: DetectedMeeting): Promise<void> {
    return new Promise((resolve, reject) => {
      const sql = `
        INSERT OR REPLACE INTO detected_meetings 
        (id, messageId, chatId, senderName, extractedText, detectedKeywords, 
         detectedDate, detectedTime, detectedNames, confidence, timestamp, llmAnalysis)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      this.db.run(
        sql,
        [
          meeting.id,
          meeting.messageId,
          meeting.chatId,
          meeting.senderName,
          meeting.extractedText,
          JSON.stringify(meeting.detectedKeywords),
          meeting.detectedDate,
          meeting.detectedTime,
          meeting.detectedNames ? JSON.stringify(meeting.detectedNames) : null,
          meeting.confidence,
          meeting.timestamp,
          meeting.llmAnalysis ? JSON.stringify(meeting.llmAnalysis) : null
        ],
        function (error) {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        }
      );
    });
  }

  async saveAuditRecord(record: AuditRecord): Promise<void> {
    return new Promise((resolve, reject) => {
      const sql = `
        INSERT OR REPLACE INTO audit_records 
        (id, detectedMeetingId, calendarEventId, status, conflictDetails)
        VALUES (?, ?, ?, ?, ?)
      `;

      this.db.run(
        sql,
        [
          record.id,
          record.detectedMeetingId,
          record.calendarEventId,
          record.status,
          record.conflictDetails
        ],
        function (error) {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        }
      );
    });
  }

  async getDetectedMeetings(limit: number = 100): Promise<DetectedMeeting[]> {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT * FROM detected_meetings 
        ORDER BY timestamp DESC 
        LIMIT ?
      `;

      this.db.all(sql, [limit], (error, rows: any[]) => {
        if (error) {
          reject(error);
        } else {
          const meetings = rows.map(row => ({
            id: row.id,
            messageId: row.messageId,
            chatId: row.chatId,
            senderName: row.senderName,
            extractedText: row.extractedText,
            detectedKeywords: JSON.parse(row.detectedKeywords),
            detectedDate: row.detectedDate,
            detectedTime: row.detectedTime,
            detectedNames: row.detectedNames ? JSON.parse(row.detectedNames) : undefined,
            confidence: row.confidence,
            timestamp: row.timestamp,
            llmAnalysis: row.llmAnalysis ? JSON.parse(row.llmAnalysis) : undefined
          }));
          resolve(meetings);
        }
      });
    });
  }

  async getAuditRecords(limit: number = 100): Promise<AuditRecord[]> {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT * FROM audit_records 
        ORDER BY createdAt DESC 
        LIMIT ?
      `;

      this.db.all(sql, [limit], (error, rows: any[]) => {
        if (error) {
          reject(error);
        } else {
          const records = rows.map(row => ({
            id: row.id,
            detectedMeetingId: row.detectedMeetingId,
            calendarEventId: row.calendarEventId,
            status: row.status,
            conflictDetails: row.conflictDetails,
            createdAt: row.createdAt
          }));
          resolve(records);
        }
      });
    });
  }

  async getAuditSummary(): Promise<{
    totalMeetings: number;
    missingFromCalendar: number;
    foundInCalendar: number;
    conflicts: number;
  }> {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT 
          COUNT(*) as totalMeetings,
          SUM(CASE WHEN status = 'missing_from_calendar' THEN 1 ELSE 0 END) as missingFromCalendar,
          SUM(CASE WHEN status = 'found_in_calendar' THEN 1 ELSE 0 END) as foundInCalendar,
          SUM(CASE WHEN status = 'conflict_detected' THEN 1 ELSE 0 END) as conflicts
        FROM audit_records
        WHERE createdAt > strftime('%s', 'now', '-1 day')
      `;

      this.db.get(sql, (error, row: any) => {
        if (error) {
          reject(error);
        } else {
          resolve({
            totalMeetings: row.totalMeetings || 0,
            missingFromCalendar: row.missingFromCalendar || 0,
            foundInCalendar: row.foundInCalendar || 0,
            conflicts: row.conflicts || 0
          });
        }
      });
    });
  }

  async close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }
}