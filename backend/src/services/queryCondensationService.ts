import { ChatOllama } from '@langchain/ollama';
import { PromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { config } from '../config';
import {
  ChatMessageTurn,
  QueryCondensationOptions,
  QueryCondensationResult,
} from '../types/rag';
import { AppError } from '../middleware/errorHandler';

export class QueryCondensationService {
  private readonly baseUrl: string;
  private readonly defaultModel: string;

  constructor() {
    this.baseUrl = config.OLLAMA_BASE_URL;
    this.defaultModel = config.OLLAMA_CHAT_MODEL;
  }

  /**
   * Formats chat history turns into a readable, concise dialogue transcript for prompt context.
   * Limits dialogue history to at most the last 6 messages (3 user-assistant pairs) to avoid prompt bloat.
   */
  private formatChatHistory(history: ChatMessageTurn[]): string {
    const recent = history.slice(-6);
    return recent
      .map((turn) => {
        const roleLabel =
          turn.role === 'user' ? 'User' : turn.role === 'assistant' ? 'Assistant' : 'System';
        const cleaned = turn.content.replace(/\s+/g, ' ').trim();
        return `${roleLabel}: ${cleaned}`;
      })
      .join('\n');
  }

  /**
   * Evaluates whether a question likely requires conversational condensation.
   * Pronoun-heavy or elliptical follow-ups (e.g., "How do I fix that?", "What about Enterprise?")
   * must be rewritten to be self-contained for dense vector and keyword search.
   */
  private isLikelyFollowUp(question: string): boolean {
    const q = question.trim().toLowerCase();
    const words = q.split(/\s+/);

    // Short elliptical questions (e.g. "Why?", "What about Enterprise?", "How to fix?")
    if (words.length <= 5) {
      return true;
    }

    // Contains demonstrative pronouns or relative references
    const pronounPattern = /\b(it|this|that|these|those|they|them|its|their|the error|the ticket|the issue|the problem|the document|the plan|the limit|the procedures|the policy|above|earlier|previous)\b/i;
    return pronounPattern.test(q);
  }

  /**
   * Condenses a multi-turn conversational follow-up question into an unambiguous,
   * standalone retrieval query using a fast local LLM prompt.
   *
   * Features:
   * 1. Zero-latency bypass: Returns original query immediately if chat history is empty.
   * 2. Pronoun & reference resolution: Replaces "it", "that", "the error" with exact codes/topics.
   * 3. Technical identifier preservation: Retains error codes (CD-WHK-504), ticket IDs (TKT-10421), etc.
   * 4. Resilient fallback: Returns original question if LLM output is empty or invocation fails.
   */
  async condenseQuery(options: QueryCondensationOptions): Promise<QueryCondensationResult> {
    const startTime = Date.now();
    const { question, chat_history = [], model } = options;

    if (!question || typeof question !== 'string' || question.trim().length === 0) {
      throw new AppError('Question must be a non-empty string.', 400, 'INVALID_QUESTION');
    }

    const cleanQuestion = question.trim();

    // 1. Zero-latency short circuit: If there is no chat history, no condensation is needed
    if (!chat_history || chat_history.length === 0) {
      return {
        original_query: cleanQuestion,
        condensed_query: cleanQuestion,
        was_condensed: false,
        latency_ms: 0,
      };
    }

    // Filter out empty messages from history
    const validHistory = chat_history.filter((m) => m && typeof m.content === 'string' && m.content.trim().length > 0);
    if (validHistory.length === 0) {
      return {
        original_query: cleanQuestion,
        condensed_query: cleanQuestion,
        was_condensed: false,
        latency_ms: 0,
      };
    }

    // 2. Format prompt template for query condensation
    const formattedHistory = this.formatChatHistory(validHistory);

    const prompt = PromptTemplate.fromTemplate(`You are a query reformulation assistant for a technical enterprise knowledge system.
Given the chat conversation history and a follow-up question from the user, rewrite the follow-up question into a standalone, unambiguous search query.

Rules:
1. Incorporate necessary context, technical terms, error codes (e.g. CD-WHK-504, CD-API-429), ticket IDs (e.g. TKT-10421), customer names, or product entities mentioned in the chat history.
2. Resolve pronouns (such as "it", "that", "this", "they", "those", "the error", "the issue") to their specific referenced subjects.
3. Do NOT answer the question.
4. Output ONLY the rewritten standalone search query and nothing else (no explanations, no markdown, no quotes, no conversational filler).
5. If the follow-up question is already completely standalone and needs no context from the conversation, output the original question as-is.

Chat History:
{chat_history}

Follow-up Question: {question}

Standalone Search Query:`);

    const chatModelName = model || this.defaultModel;
    const llm = new ChatOllama({
      baseUrl: this.baseUrl,
      model: chatModelName,
      temperature: 0, // Deterministic generation
    });

    const chain = prompt.pipe(llm).pipe(new StringOutputParser());

    try {
      const rawOutput = await chain.invoke({
        chat_history: formattedHistory,
        question: cleanQuestion,
      });

      // Post-process the output: strip prefixes, quotes, and markdown
      let condensed = rawOutput.trim();
      condensed = condensed.replace(/^["'`]+|["'`]+$/g, '');
      condensed = condensed.replace(/^(Standalone Search Query|Rewritten Query|Search Query):\s*/i, '');
      condensed = condensed.replace(/\n+/g, ' ').trim();

      // Guard against empty output or echo of prompt labels
      if (!condensed || condensed.length === 0 || condensed.toLowerCase().startsWith('chat history:')) {
        return {
          original_query: cleanQuestion,
          condensed_query: cleanQuestion,
          was_condensed: false,
          latency_ms: Date.now() - startTime,
        };
      }

      const wasCondensed = condensed.toLowerCase() !== cleanQuestion.toLowerCase();

      return {
        original_query: cleanQuestion,
        condensed_query: condensed,
        was_condensed: wasCondensed,
        latency_ms: Date.now() - startTime,
      };
    } catch (err: unknown) {
      console.warn(
        `[QueryCondensationService] LLM query condensation failed (${err instanceof Error ? err.message : String(err)}). Falling back to original question.`
      );
      return {
        original_query: cleanQuestion,
        condensed_query: cleanQuestion,
        was_condensed: false,
        latency_ms: Date.now() - startTime,
      };
    }
  }
}

export const queryCondensationService = new QueryCondensationService();

