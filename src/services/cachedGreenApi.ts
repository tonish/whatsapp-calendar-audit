import { GreenApiService } from './greenApi';
import { WhatsAppMessage } from '../types';

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  expiry: number;
}

export class CachedGreenApiService extends GreenApiService {
  private cache: Map<string, CacheEntry<any>> = new Map();
  private readonly DEFAULT_TTL = 60 * 1000; // 1 minute
  private readonly CHATS_TTL = 5 * 60 * 1000; // 5 minutes for chats

  private getCacheKey(method: string, params: any): string {
    return `${method}_${JSON.stringify(params)}`;
  }

  private isExpired(entry: CacheEntry<any>): boolean {
    return Date.now() > entry.expiry;
  }

  private setCache<T>(key: string, data: T, ttl: number = this.DEFAULT_TTL): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      expiry: Date.now() + ttl
    });
  }

  private getCache<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry || this.isExpired(entry)) {
      this.cache.delete(key);
      return null;
    }
    return entry.data;
  }

  async getChats(): Promise<Array<{ chatId: string; name: string }>> {
    const cacheKey = this.getCacheKey('getChats', {});
    const cached = this.getCache<Array<{ chatId: string; name: string }>>(cacheKey);
    
    if (cached) {
      console.log('📦 Using cached chats data');
      return cached;
    }

    try {
      const chats = await super.getChats();
      this.setCache(cacheKey, chats, this.CHATS_TTL);
      console.log(`💾 Cached ${chats.length} chats`);
      return chats;
    } catch (error) {
      console.error('Failed to fetch chats, checking cache for stale data...');
      // Return stale data if available in emergency
      const staleEntry = this.cache.get(cacheKey);
      if (staleEntry) {
        console.log('📦 Using stale cached chats data');
        return staleEntry.data;
      }
      throw error;
    }
  }

  async getChatHistory(chatId: string, count: number = 100): Promise<WhatsAppMessage[]> {
    const cacheKey = this.getCacheKey('getChatHistory', { chatId, count });
    const cached = this.getCache<WhatsAppMessage[]>(cacheKey);
    
    if (cached) {
      console.log(`📦 Using cached chat history for ${chatId}`);
      return cached;
    }

    try {
      // Add random delay to avoid rate limits
      await this.randomDelay();
      
      const messages = await super.getChatHistory(chatId, count);
      this.setCache(cacheKey, messages, this.DEFAULT_TTL);
      console.log(`💾 Cached ${messages.length} messages for ${chatId}`);
      return messages;
    } catch (error: any) {
      if (error.response?.status === 429) {
        console.warn(`Rate limited for chat ${chatId}, using exponential backoff...`);
        await this.exponentialBackoff();
        // Try one more time after backoff
        return await super.getChatHistory(chatId, count);
      }
      throw error;
    }
  }

  async getLastThreeDaysMessages(): Promise<WhatsAppMessage[]> {
    const cacheKey = this.getCacheKey('getLastThreeDaysMessages', {});
    const cached = this.getCache<WhatsAppMessage[]>(cacheKey);
    
    if (cached) {
      console.log('📦 Using cached three days messages');
      return cached;
    }

    try {
      // Use more aggressive rate limiting for bulk operations
      const messages = await this.getLastThreeDaysMessagesWithRateLimit();
      this.setCache(cacheKey, messages, this.DEFAULT_TTL);
      console.log(`💾 Cached ${messages.length} recent messages`);
      return messages;
    } catch (error) {
      console.error('Failed to fetch recent messages, checking cache...');
      const staleEntry = this.cache.get(cacheKey);
      if (staleEntry) {
        console.log('📦 Using stale cached messages');
        return staleEntry.data;
      }
      throw error;
    }
  }

  private async getLastThreeDaysMessagesWithRateLimit(): Promise<WhatsAppMessage[]> {
    try {
      const chats = await this.getChats();
      const threeDaysAgo = Date.now() / 1000 - (3 * 24 * 60 * 60);
      const allMessages: WhatsAppMessage[] = [];

      // Filter chats based on group chat preference
      const includeGroupChats = process.env.INCLUDE_GROUP_CHATS === 'true';
      const filteredChats = includeGroupChats ? chats : chats.filter(chat => !chat.chatId.includes('@g.us'));
      
      console.log(`Processing ${filteredChats.length} chats with enhanced rate limiting...`);
      
      // Process chats in smaller batches with longer delays
      const batchSize = 5;
      for (let i = 0; i < filteredChats.length && i < 15; i += batchSize) {
        const batch = filteredChats.slice(i, i + batchSize);
        
        // Process batch concurrently but with rate limiting
        const batchPromises = batch.map(async (chat, index) => {
          try {
            // Stagger requests within batch
            await new Promise(resolve => setTimeout(resolve, index * 200));
            
            const messages = await this.getChatHistory(chat.chatId, 30);
            const recentMessages = messages.filter(msg => 
              msg.timestamp >= threeDaysAgo && 
              msg.text && 
              msg.text.trim().length > 0
            );
            
            if (recentMessages.length > 0) {
              console.log(`Found ${recentMessages.length} recent messages in ${chat.name}`);
            }
            
            return recentMessages;
          } catch (error: any) {
            if (error.response?.status === 429) {
              console.warn(`Rate limited for chat ${chat.name}, skipping...`);
              return [];
            }
            console.warn(`Error fetching messages from chat ${chat.name}:`, error.message);
            return [];
          }
        });

        const batchResults = await Promise.all(batchPromises);
        batchResults.forEach(messages => allMessages.push(...messages));
        
        // Longer delay between batches
        if (i + batchSize < Math.min(filteredChats.length, 15)) {
          console.log(`Processed batch ${Math.floor(i/batchSize) + 1}, waiting before next batch...`);
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }

      console.log(`Total recent messages found: ${allMessages.length}`);
      return allMessages.sort((a, b) => b.timestamp - a.timestamp);
    } catch (error) {
      console.error('Error in rate-limited message fetching:', error);
      throw error;
    }
  }

  private async randomDelay(): Promise<void> {
    const delay = Math.random() * 500 + 200; // 200-700ms random delay
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  private async exponentialBackoff(): Promise<void> {
    const delay = Math.random() * 5000 + 3000; // 3-8 seconds
    console.log(`⏳ Backing off for ${Math.round(delay/1000)}s due to rate limit...`);
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  public clearCache(): void {
    this.cache.clear();
    console.log('🗑️ Cache cleared');
  }

  public getCacheStats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys())
    };
  }
}