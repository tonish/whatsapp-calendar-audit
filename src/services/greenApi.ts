import axios, { AxiosInstance } from 'axios';
import { WhatsAppMessage } from '../types';
import { config } from '../utils/config';
import { subDays } from 'date-fns';

export class GreenApiService {
  private client: AxiosInstance;
  private baseUrl: string;

  constructor() {
    this.baseUrl = `${config.greenApi.baseUrl}/waInstance${config.greenApi.idInstance}`;
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }

  async getChatHistory(chatId: string, count: number = 100): Promise<WhatsAppMessage[]> {
    try {
      const response = await this.client.post(
        `/getChatHistory/${config.greenApi.apiTokenInstance}`,
        {
          chatId,
          count
        }
      );

      return response.data.map((msg: any) => ({
        id: msg.idMessage,
        timestamp: msg.timestamp,
        chatId: msg.chatId,
        senderId: msg.senderId,
        senderName: msg.senderName || msg.senderId,
        text: msg.textMessage || '',
        type: msg.typeMessage
      }));
    } catch (error) {
      console.error('Error fetching chat history:', error);
      throw error;
    }
  }

  async getChats(): Promise<Array<{ chatId: string; name: string }>> {
    try {
      const response = await this.client.get(
        `/getChats/${config.greenApi.apiTokenInstance}`
      );

      return response.data.map((chat: any) => ({
        chatId: chat.id,
        name: chat.name || chat.id
      }));
    } catch (error) {
      console.error('Error fetching chats:', error);
      throw error;
    }
  }

  async getLastThreeDaysMessages(): Promise<WhatsAppMessage[]> {
    try {
      const chats = await this.getChats();
      const threeDaysAgo = subDays(new Date(), 3).getTime() / 1000;
      const allMessages: WhatsAppMessage[] = [];

      // Filter chats based on group chat preference
      const includeGroupChats = process.env.INCLUDE_GROUP_CHATS === 'true';
      const filteredChats = includeGroupChats ? chats : chats.filter(chat => !chat.chatId.includes('@g.us'));
      
      console.log(`Processing ${filteredChats.length} chats (${includeGroupChats ? 'including' : 'excluding'} group chats)...`);
      
      for (const chat of filteredChats.slice(0, 20)) { // Limit to first 20 chats to avoid rate limits
        try {
          if (!chat.chatId || chat.chatId.trim() === '') {
            continue; // Skip empty chat IDs
          }
          
          const messages = await this.getChatHistory(chat.chatId, 50); // Reduced count per chat
          const recentMessages = messages.filter(msg => 
            msg.timestamp >= threeDaysAgo && 
            msg.text && 
            msg.text.trim().length > 0
          );
          
          if (recentMessages.length > 0) {
            console.log(`Found ${recentMessages.length} recent messages in chat: ${chat.name}`);
            allMessages.push(...recentMessages);
          }
          
          // Add delay to avoid rate limits
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (chatError: any) {
          console.warn(`Error fetching messages from chat ${chat.name}:`, chatError.message);
          continue; // Skip this chat and continue with others
        }
      }

      console.log(`Total recent messages found: ${allMessages.length}`);
      return allMessages.sort((a, b) => b.timestamp - a.timestamp);
    } catch (error) {
      console.error('Error fetching last three days messages:', error);
      throw error;
    }
  }

  async sendMessage(chatId: string, message: string): Promise<void> {
    try {
      await this.client.post(
        `/sendMessage/${config.greenApi.apiTokenInstance}`,
        {
          chatId,
          message
        }
      );
    } catch (error) {
      console.error('Error sending message:', error);
      throw error;
    }
  }

  async getInstanceStatus(): Promise<boolean> {
    try {
      const response = await this.client.get(
        `/getStateInstance/${config.greenApi.apiTokenInstance}`
      );
      return response.data.stateInstance === 'authorized';
    } catch (error) {
      console.error('Error checking instance status:', error);
      return false;
    }
  }
}