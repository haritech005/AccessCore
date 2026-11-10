import { query } from '../db';
import { AppError } from '../middleware/errorHandler';

export interface ConversationRecord {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count?: number;
}

export interface ConversationMessageRecord {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  citations: any[];
  metadata: Record<string, any>;
  created_at: string;
}

export interface ConversationWithMessages extends ConversationRecord {
  messages: ConversationMessageRecord[];
}

export class ConversationService {
  /**
   * Creates a new conversation thread for the authenticated user.
   */
  async createConversation(userId: string, title = 'New Chat'): Promise<ConversationRecord> {
    const res = await query<ConversationRecord>(
      `INSERT INTO conversations (user_id, title)
       VALUES ($1, $2)
       RETURNING id, user_id, title, created_at, updated_at`,
      [userId, title]
    );

    return res.rows[0];
  }

  /**
   * Lists all conversation threads belonging strictly to the requesting user.
   * Cross-user conversations are never exposed.
   */
  async listConversations(userId: string): Promise<ConversationRecord[]> {
    const res = await query<ConversationRecord>(
      `SELECT c.id, c.user_id, c.title, c.created_at, c.updated_at,
              COUNT(m.id)::int AS message_count
       FROM conversations c
       LEFT JOIN conversation_messages m ON c.id = m.conversation_id
       WHERE c.user_id = $1
       GROUP BY c.id
       ORDER BY c.updated_at DESC`,
      [userId]
    );

    return res.rows;
  }

  /**
   * Retrieves a single conversation and its full message history.
   * Throws 404/403 if the conversation does not exist or belongs to another user.
   */
  async getConversation(userId: string, conversationId: string): Promise<ConversationWithMessages> {
    const convRes = await query<ConversationRecord>(
      `SELECT id, user_id, title, created_at, updated_at
       FROM conversations
       WHERE id = $1`,
      [conversationId]
    );

    if (convRes.rows.length === 0) {
      throw new AppError('Conversation not found.', 404, 'NOT_FOUND');
    }

    const conversation = convRes.rows[0];
    if (conversation.user_id !== userId) {
      throw new AppError('Access denied: You do not have permission to view this conversation.', 403, 'FORBIDDEN');
    }

    const msgRes = await query<ConversationMessageRecord>(
      `SELECT id, conversation_id, role, content, citations, metadata, created_at
       FROM conversation_messages
       WHERE conversation_id = $1
       ORDER BY created_at ASC`,
      [conversationId]
    );

    return {
      ...conversation,
      messages: msgRes.rows,
    };
  }

  /**
   * Adds a message to an existing conversation, ensuring the conversation belongs to the user.
   * If autoTitle is true and the conversation has the default title, updates the title based on content.
   */
  async addMessage(params: {
    conversationId: string;
    userId: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    citations?: any[];
    metadata?: Record<string, any>;
    autoTitle?: boolean;
  }): Promise<ConversationMessageRecord> {
    const { conversationId, userId, role, content, citations = [], metadata = {}, autoTitle = false } = params;

    // Verify ownership
    const convRes = await query<ConversationRecord>(
      `SELECT id, user_id, title FROM conversations WHERE id = $1`,
      [conversationId]
    );

    if (convRes.rows.length === 0) {
      throw new AppError('Conversation not found.', 404, 'NOT_FOUND');
    }

    if (convRes.rows[0].user_id !== userId) {
      throw new AppError('Access denied: You do not have permission to modify this conversation.', 403, 'FORBIDDEN');
    }

    // Insert message
    const msgRes = await query<ConversationMessageRecord>(
      `INSERT INTO conversation_messages (conversation_id, role, content, citations, metadata)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, conversation_id, role, content, citations, metadata, created_at`,
      [conversationId, role, content, JSON.stringify(citations), JSON.stringify(metadata)]
    );

    // Update conversation updated_at and optionally title
    if (autoTitle && role === 'user' && convRes.rows[0].title === 'New Chat') {
      const generatedTitle = content.trim().slice(0, 48) + (content.length > 48 ? '...' : '');
      await query(
        `UPDATE conversations
         SET updated_at = NOW(), title = $2
         WHERE id = $1`,
        [conversationId, generatedTitle]
      );
    } else {
      await query(
        `UPDATE conversations
         SET updated_at = NOW()
         WHERE id = $1`,
        [conversationId]
      );
    }

    return msgRes.rows[0];
  }

  /**
   * Deletes a conversation and all its messages.
   * Enforces strict user ownership before deletion.
   */
  async deleteConversation(userId: string, conversationId: string): Promise<boolean> {
    const convRes = await query<ConversationRecord>(
      `SELECT id, user_id FROM conversations WHERE id = $1`,
      [conversationId]
    );

    if (convRes.rows.length === 0) {
      throw new AppError('Conversation not found.', 404, 'NOT_FOUND');
    }

    if (convRes.rows[0].user_id !== userId) {
      throw new AppError('Access denied: You do not have permission to delete this conversation.', 403, 'FORBIDDEN');
    }

    await query(`DELETE FROM conversations WHERE id = $1`, [conversationId]);
    return true;
  }
}

export const conversationService = new ConversationService();

