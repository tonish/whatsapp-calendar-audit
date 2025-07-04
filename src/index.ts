import { config as dotenvConfig } from 'dotenv';
dotenvConfig();

import * as cron from 'node-cron';
import { AuditService } from './services/auditService';
import { NotificationService } from './services/notificationService';
import { GoogleCalendarService } from './services/googleCalendar';
import { GreenApiService } from './services/greenApi';
import { config, validateConfig } from './utils/config';
import fs from 'fs';
import path from 'path';

class WhatsAppCalendarAuditApp {
  private auditService: AuditService;
  private notificationService: NotificationService;
  private googleCalendar: GoogleCalendarService;
  private greenApi: GreenApiService;
  private isRunning: boolean = false;

  constructor() {
    this.auditService = new AuditService();
    this.notificationService = new NotificationService();
    this.googleCalendar = new GoogleCalendarService();
    this.greenApi = new GreenApiService();
  }

  async initialize(): Promise<void> {
    console.log('Initializing WhatsApp Calendar Audit Service...');
    
    try {
      validateConfig();
      
      if (!fs.existsSync(path.dirname(config.database.path))) {
        fs.mkdirSync(path.dirname(config.database.path), { recursive: true });
      }
      
      await this.checkGreenApiStatus();
      await this.checkGoogleCalendarAuth();
      
      console.log('✅ Initialization completed successfully');
    } catch (error) {
      console.error('❌ Initialization failed:', error);
      throw error;
    }
  }

  private async checkGreenApiStatus(): Promise<void> {
    console.log('Checking Green API connection...');
    const isConnected = await this.greenApi.getInstanceStatus();
    
    if (!isConnected) {
      throw new Error('Green API instance is not authorized. Please check your WhatsApp connection.');
    }
    
    console.log('✅ Green API connection verified');
  }

  private async checkGoogleCalendarAuth(): Promise<void> {
    console.log('Checking Google Calendar authentication...');
    
    const tokenPath = './data/google_tokens.json';
    
    if (fs.existsSync(tokenPath)) {
      const tokens = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
      await this.googleCalendar.loadSavedTokens(tokens);
      
      const isAuthenticated = await this.googleCalendar.isAuthenticated();
      if (isAuthenticated) {
        console.log('✅ Google Calendar authentication verified');
        return;
      }
    }
    
    console.log('🔐 Google Calendar authentication required');
    console.log('Please visit the following URL to authenticate:');
    console.log(this.googleCalendar.getAuthUrl());
    console.log('\nAfter authentication, run the app again with the authorization code.');
    
    process.exit(1);
  }

  async authenticate(authCode: string): Promise<void> {
    try {
      await this.googleCalendar.setCredentials(authCode);
      const tokens = this.googleCalendar.getTokens();
      
      const tokenPath = './data/google_tokens.json';
      fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2));
      
      console.log('✅ Google Calendar authentication successful');
      console.log('Tokens saved. You can now run the audit service.');
    } catch (error) {
      console.error('❌ Authentication failed:', error);
      throw error;
    }
  }

  async runAudit(): Promise<void> {
    if (this.isRunning) {
      console.log('⏳ Audit already running, skipping...');
      return;
    }

    this.isRunning = true;
    console.log('🔍 Starting audit process...');
    
    try {
      const summary = await this.auditService.performAudit();
      
      const recipientPhone = process.env.WHATSAPP_PHONE_NUMBER;
      if (recipientPhone) {
        await this.notificationService.sendSummary(summary, recipientPhone);
      }
      
      console.log('📊 Audit Summary:');
      console.log(`- Messages analyzed: ${summary.totalMessages}`);
      console.log(`- Meetings detected: ${summary.detectedMeetings}`);
      console.log(`- Missing from calendar: ${summary.missingFromCalendar}`);
      console.log(`- Schedule conflicts: ${summary.conflicts}`);
      
      if (summary.missingFromCalendar > 0 || summary.conflicts > 0) {
        console.log('\n📝 Detailed report:');
        console.log(this.notificationService.formatDetailedReport(summary));
      }
      
      console.log('✅ Audit completed successfully');
    } catch (error) {
      console.error('❌ Audit failed:', error);
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  startScheduledAudits(): void {
    console.log('⏰ Starting scheduled audits...');
    
    cron.schedule('0 9 * * *', async () => {
      console.log('🌅 Running scheduled morning audit...');
      await this.runAudit();
    });
    
    cron.schedule('0 18 * * *', async () => {
      console.log('🌆 Running scheduled evening audit...');
      await this.runAudit();
    });
    
    console.log('✅ Scheduled audits configured (9 AM and 6 PM daily)');
  }

  async shutdown(): Promise<void> {
    console.log('🔌 Shutting down WhatsApp Calendar Audit Service...');
    await this.auditService.close();
    console.log('✅ Shutdown complete');
  }
}

async function main(): Promise<void> {
  const app = new WhatsAppCalendarAuditApp();
  
  process.on('SIGINT', async () => {
    await app.shutdown();
    process.exit(0);
  });
  
  process.on('SIGTERM', async () => {
    await app.shutdown();
    process.exit(0);
  });
  
  const args = process.argv.slice(2);
  
  if (args.length > 0) {
    const command = args[0];
    
    switch (command) {
      case 'auth':
        if (args.length < 2) {
          console.log('Usage: npm run auth <google_auth_code>');
          process.exit(1);
        }
        await app.authenticate(args[1]);
        break;
        
      case 'run':
        await app.initialize();
        await app.runAudit();
        await app.shutdown();
        break;
        
      case 'schedule':
        await app.initialize();
        app.startScheduledAudits();
        console.log('🚀 Service running with scheduled audits...');
        console.log('Press Ctrl+C to stop');
        break;
        
      default:
        console.log('Available commands:');
        console.log('  auth <code>  - Authenticate with Google Calendar');
        console.log('  run         - Run audit once');
        console.log('  schedule    - Run with scheduled audits');
        process.exit(1);
    }
  } else {
    console.log('Available commands:');
    console.log('  auth <code>  - Authenticate with Google Calendar');
    console.log('  run         - Run audit once');
    console.log('  schedule    - Run with scheduled audits');
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(console.error);
}

export { WhatsAppCalendarAuditApp };