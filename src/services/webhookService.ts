import express from 'express';
import { KeywordDetector } from '../utils/keywordDetector';
import { NotificationService } from './notificationService';
import { WhatsAppMessage } from '../types';
import { config } from '../utils/config';

export class WebhookService {
  private app: express.Application;
  private keywordDetector: KeywordDetector;
  private notificationService: NotificationService;
  private recentMessages: Map<string, WhatsAppMessage[]> = new Map();

  constructor() {
    this.app = express();
    this.keywordDetector = new KeywordDetector();
    this.notificationService = new NotificationService();
    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
  }

  private setupRoutes(): void {
    // Green API webhook endpoint
    this.app.post('/webhook', this.handleWebhook.bind(this));
    
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });
  }

  private async handleWebhook(req: express.Request, res: express.Response): Promise<void> {
    try {
      const notification = req.body;
      
      // Acknowledge webhook immediately
      res.status(200).json({ received: true });

      // Process message asynchronously
      await this.processIncomingMessage(notification);
    } catch (error) {
      console.error('Webhook processing error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  private async processIncomingMessage(notification: any): Promise<void> {
    try {
      const { typeWebhook, messageData, senderData } = notification;
      
      // Only process incoming text messages
      if (typeWebhook !== 'incomingMessageReceived' || 
          messageData?.typeMessage !== 'textMessage') {
        return;
      }

      // Filter group chats if needed
      const includeGroupChats = process.env.INCLUDE_GROUP_CHATS === 'true';
      if (!includeGroupChats && senderData?.chatId?.includes('@g.us')) {
        return;
      }

      const message: WhatsAppMessage = {
        id: notification.idMessage,
        timestamp: Math.floor(Date.now() / 1000),
        chatId: senderData.chatId,
        senderId: senderData.sender,
        senderName: senderData.senderName || senderData.sender,
        text: messageData.textMessageData?.textMessage || '',
        type: 'textMessage'
      };

      // Store message in recent cache (sliding window)
      this.addToRecentMessages(message);

      // Check for meeting keywords
      const detectedMeetings = await this.keywordDetector.detectMeetings([message]);
      
      if (detectedMeetings.length > 0) {
        console.log(`🎯 Detected ${detectedMeetings.length} meetings in real-time message from ${message.senderName}`);
        
        // Optional: Send immediate notification for urgent meetings
        if (this.isUrgentMeeting(detectedMeetings[0])) {
          await this.sendUrgentNotification(detectedMeetings[0]);
        }
      }
    } catch (error) {
      console.error('Error processing incoming message:', error);
    }
  }

  private addToRecentMessages(message: WhatsAppMessage): void {
    const chatMessages = this.recentMessages.get(message.chatId) || [];
    chatMessages.push(message);
    
    // Keep only last 50 messages per chat
    if (chatMessages.length > 50) {
      chatMessages.shift();
    }
    
    this.recentMessages.set(message.chatId, chatMessages);
  }

  private isUrgentMeeting(meeting: any): boolean {
    // Check if meeting is today or tomorrow
    const urgentKeywords = ['urgent', 'asap', 'דחוף', 'עכשיו', 'מיד'];
    return urgentKeywords.some(keyword => 
      meeting.extractedText.toLowerCase().includes(keyword)
    );
  }

  private async sendUrgentNotification(meeting: any): Promise<void> {
    const urgentMessage = `🚨 *Urgent Meeting Detected*\n\nFrom: ${meeting.senderName}\nText: "${meeting.extractedText.substring(0, 100)}..."\n\n⚠️ Consider adding to calendar immediately!`;
    
    const phoneNumber = process.env.WHATSAPP_PHONE_NUMBER;
    if (phoneNumber) {
      const chatId = `${phoneNumber}@c.us`;
      // Use direct Green API call to avoid rate limits
      await this.notificationService.sendMessage(chatId, urgentMessage);
    }
  }

  public getRecentMessages(): WhatsAppMessage[] {
    const allMessages: WhatsAppMessage[] = [];
    const threeDaysAgo = Math.floor(Date.now() / 1000) - (3 * 24 * 60 * 60);
    
    for (const chatMessages of this.recentMessages.values()) {
      const recentChatMessages = chatMessages.filter(msg => msg.timestamp >= threeDaysAgo);
      allMessages.push(...recentChatMessages);
    }
    
    return allMessages.sort((a, b) => b.timestamp - a.timestamp);
  }

  public start(port: number = 3001): void {
    this.app.listen(port, () => {
      console.log(`🔗 Webhook service listening on port ${port}`);
      console.log(`📡 Webhook URL: http://localhost:${port}/webhook`);
    });
  }
}