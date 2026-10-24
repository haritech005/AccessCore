import { ChatOllama } from '@langchain/ollama';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { config } from '../config';
import { retrievalService } from './retrievalService';
import { Citation, RAGAnswerResponse, RetrievedChunk } from '../types/rag';
import { AppError } from '../middleware/errorHandler';

export interface RAGQueryOptions {
  question: string;
  top_k?: number;
  min_similarity?: number;
  tenant_scope?: string[];
  user_groups?: string[];
  model?: string;
}

export const INSUFFICIENT_EVIDENCE_MESSAGE =
  'I do not have sufficient evidence in the provided documents to answer this question.';

/**
 * Deduplicates contiguous or clustered bracketed citation references in the generated answer text.
 * For example: "[TKT-10467] [TKT-10467] [PDOC-0003] [PDOC-0003]" -> "[TKT-10467] [PDOC-0003]"
 * Preserves genuinely distinct citations.
 */
export function deduplicateInlineCitations(text: string): string {
  let cleaned = text.replace(/((?:\[[A-Z]{2,5}-[0-9]{3,5}\](?:,\s*|\s*))+)/g, (match) => {
    const ids = [...match.matchAll(/\[([A-Z]{2,5}-[0-9]{3,5})\]/g)].map((m) => m[1]);
    const uniqueIds = Array.from(new Set(ids));
    return uniqueIds.map((id) => `[${id}]`).join(' ');
  });
  // Ensure space after citation bracket when followed by an alphanumeric character
  cleaned = cleaned.replace(/(\[[A-Z]{2,5}-[0-9]{3,5}\])([A-Za-z0-9])/g, '$1 $2');
  return cleaned.trim();
}

export class RAGService {
  private baseUrl: string;
  private defaultModel: string;

  constructor(options?: { baseUrl?: string; defaultModel?: string }) {
    this.baseUrl = (options?.baseUrl || config.OLLAMA_BASE_URL).replace(/\/$/, '');
    this.defaultModel = options?.defaultModel || config.OLLAMA_CHAT_MODEL;
  }

  /**
   * Builds the formatted context string from retrieved document chunks.
   */
  private formatContext(chunks: RetrievedChunk[]): string {
    return chunks
      .map((chunk, idx) => {
        const heading = chunk.metadata.section_heading ? ` | Section: ${chunk.metadata.section_heading}` : '';
        return `--- EVIDENCE ITEM ${idx + 1} ---
Document ID: ${chunk.document_id}
Title: ${chunk.metadata.title}${heading}
Tenant: ${chunk.metadata.tenant_id}
Sensitivity: ${chunk.metadata.sensitivity}

${chunk.content}`;
      })
      .join('\n\n');
  }

  /**
   * Validates and extracts citations from generated text against the retrieved context.
   * Discards any hallucinated document IDs that were not present in the retrieved chunks.
   */
  private extractAndValidateCitations(
    answer: string,
    retrievedChunks: RetrievedChunk[]
  ): Citation[] {
    const chunkByDocId = new Map<string, RetrievedChunk>();
    for (const chunk of retrievedChunks) {
      if (!chunkByDocId.has(chunk.document_id)) {
        chunkByDocId.set(chunk.document_id, chunk);
      }
    }

    // Extract document IDs like [PDOC-0001], [PDOC-0002, PDOC-0001], or PDOC-0001
    const idMatches = [...answer.matchAll(/([A-Z]{2,5}-[0-9]{3,5})/g)];
    const citedIds = new Set<string>(
      idMatches.map((m) => {
        let id = m[1];
        if (id.startsWith('CDOC-')) id = id.replace('CDOC-', 'PDOC-');
        return id;
      })
    );

    const validatedCitations: Citation[] = [];
    const addedDocIds = new Set<string>();

    // Order citations by relevance according to retrievedChunks rank
    for (const chunk of retrievedChunks) {
      if (citedIds.has(chunk.document_id) && !addedDocIds.has(chunk.document_id)) {
        addedDocIds.add(chunk.document_id);
        const snippetText = chunk.content.slice(0, 200).trim();
        validatedCitations.push({
          document_id: chunk.document_id,
          title: chunk.metadata.title,
          chunk_index: chunk.chunk_index,
          snippet: snippetText + (chunk.content.length > 200 ? '...' : ''),
          source_location: chunk.metadata.section_heading || 'Document Passage',
          tenant_id: chunk.metadata.tenant_id,
          sensitivity: chunk.metadata.sensitivity,
          disclosure_policy: chunk.metadata.disclosure_policy,
        });
      }
    }

    // If model answered from evidence but did not format citations in square brackets,
    // attach top retrieved chunk as citation provenance
    if (validatedCitations.length === 0 && retrievedChunks.length > 0) {
      const topChunk = retrievedChunks[0];
      const snippetText = topChunk.content.slice(0, 200).trim();
      validatedCitations.push({
        document_id: topChunk.document_id,
        title: topChunk.metadata.title,
        chunk_index: topChunk.chunk_index,
        snippet: snippetText + (topChunk.content.length > 200 ? '...' : ''),
        source_location: topChunk.metadata.section_heading || 'Document Passage',
        tenant_id: topChunk.metadata.tenant_id,
        sensitivity: topChunk.metadata.sensitivity,
        disclosure_policy: topChunk.metadata.disclosure_policy,
      });
    }

    return validatedCitations;
  }

  /**
   * Checks if the generated answer indicates a genuine refusal due to insufficient evidence.
   */
  private checkInsufficientEvidence(answer: string): boolean {
    // Strip leading citation tags like [PDOC-0001], [PDOC-0002] to inspect the core statement
    const cleaned = answer
      .replace(/^(\[[^\]]+\]\s*,?\s*)+/, '')
      .trim()
      .toLowerCase();

    return (
      cleaned === INSUFFICIENT_EVIDENCE_MESSAGE.toLowerCase() ||
      cleaned.startsWith('i do not have sufficient evidence') ||
      cleaned.startsWith('i don\'t have sufficient evidence') ||
      cleaned.startsWith('insufficient evidence') ||
      cleaned.includes('do not contain any information') ||
      cleaned.includes('does not contain any information') ||
      cleaned.includes('do not contain information regarding') ||
      cleaned.includes('does not contain information regarding') ||
      cleaned.includes('no information is provided in the documents regarding') ||
      cleaned.includes('not enough information in the provided documents to answer') ||
      (cleaned.length < 200 &&
        (cleaned.includes('do not have sufficient evidence') ||
          cleaned.includes('not enough information to answer')))
    );
  }

  /**
   * Executes the full RAG pipeline:
   * 1. Semantic retrieval with pgvector.
   * 2. Short-circuit on empty retrieval.
   * 3. Prompt templating via LangChain.
   * 4. Generation via local Ollama LLM.
   * 5. Citation validation and insufficient-evidence enforcement.
   */
  async answerQuestion(options: RAGQueryOptions): Promise<RAGAnswerResponse> {
    const totalStart = Date.now();
    const { question, top_k = 4, min_similarity = 0.40, tenant_scope, user_groups, model } = options;

    if (!question || typeof question !== 'string' || question.trim().length === 0) {
      throw new AppError('Question must be a non-empty string.', 400, 'INVALID_QUESTION');
    }

    const cleanQuestion = question.trim();

    // 1. Semantic Vector Retrieval
    const retrievalStart = Date.now();
    const retrievalResult = await retrievalService.retrieveChunks({
      query: cleanQuestion,
      top_k,
      min_similarity,
      tenant_scope,
      user_groups,
    });
    const retrievalLatency = Date.now() - retrievalStart;

    const retrievedChunks = retrievalResult.chunks;

    // 2. Early return for zero or low-similarity retrieval results
    if (retrievedChunks.length === 0) {
      return {
        question: cleanQuestion,
        answer: INSUFFICIENT_EVIDENCE_MESSAGE,
        citations: [],
        insufficient_evidence: true,
        retrieved_chunks: [],
        latency_ms: {
          retrieval: retrievalLatency,
          generation: 0,
          total: Date.now() - totalStart,
        },
      };
    }

    // 3. Format Context and LangChain Prompt Template
    const contextText = this.formatContext(retrievedChunks);

    const promptTemplate = ChatPromptTemplate.fromMessages([
      [
        'system',
        `You are AccessCore, an enterprise knowledge assistant for CloudDesk.
Your task is to answer the user's question accurately and STRICTLY based on the provided evidence items.

CRITICAL GROUNDING RULES:
1. FACTUAL GROUNDING & UNCONFIRMED HYPOTHESES:
- Answer the user's question directly, accurately, and strictly using the facts in the evidence items below.
- STRICTLY distinguish confirmed facts from unconfirmed hypotheses, customer reports, or open questions.
- If a document or ticket states that an issue's root cause is unconfirmed or under investigation, you MUST explicitly state that the exact root cause has NOT been confirmed.
- When describing suspected causes or customer suspicions, state them ONLY as unconfirmed hypotheses or possibilities under investigation. NEVER state or assert that suspected causes or reported behaviors are confirmed facts unless verified evidence establishes this.
- If asked about actual request volumes, polling frequencies, or unmeasured metrics, state that they have not been established or measured and remain unknown.
2. CITATIONS & DEDUPLICATION:
- Whenever you state a fact, observation, or recommendation, include the EXACT Document ID shown in the evidence item headers in square brackets, e.g. [PDOC-0001] or [TKT-10467]. Do not invent prefixes or alter document IDs.
- Do NOT output consecutive duplicate citations (e.g. never write "[TKT-10467] [TKT-10467]").
3. OUT-OF-SCOPE QUESTIONS:
- If the question asks about something completely unrelated to CloudDesk or absent from all provided documents, reply:
"I do not have sufficient evidence in the provided documents to answer this question."
Do NOT fabricate an answer, speculate, or mention ungrounded external facts.
4. Tone: Clear, direct, objective, and professional.`,
      ],
      [
        'human',
        `EVIDENCE CONTEXT:
{context}

USER QUESTION:
{question}

GROUNDED ANSWER:`,
      ],
    ]);

    // 4. Initialize Local Ollama LLM
    const chatModelName = model || this.defaultModel;
    const llm = new ChatOllama({
      baseUrl: this.baseUrl,
      model: chatModelName,
      temperature: 0, // Deterministic generation for grounded answers
    });

    const chain = promptTemplate.pipe(llm).pipe(new StringOutputParser());

    // 5. Generate Grounded Answer
    const genStart = Date.now();
    let rawAnswer: string;

    try {
      rawAnswer = await chain.invoke({
        context: contextText,
        question: cleanQuestion,
      });
      rawAnswer = deduplicateInlineCitations(rawAnswer.trim());
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new AppError(
        `Failed to generate answer from local model '${chatModelName}': ${message}`,
        502,
        'MODEL_GENERATION_FAILED'
      );
    }

    const generationLatency = Date.now() - genStart;

    // 6. Validate Citations & Insufficient Evidence
    const isInsufficient = this.checkInsufficientEvidence(rawAnswer);
    const validatedCitations = isInsufficient
      ? []
      : this.extractAndValidateCitations(rawAnswer, retrievedChunks);

    const finalAnswer = isInsufficient ? INSUFFICIENT_EVIDENCE_MESSAGE : rawAnswer;

    return {
      question: cleanQuestion,
      answer: finalAnswer,
      citations: validatedCitations,
      insufficient_evidence: isInsufficient,
      retrieved_chunks: retrievedChunks.map((c) => ({
        document_id: c.document_id,
        chunk_index: c.chunk_index,
        similarity: c.similarity,
      })),
      latency_ms: {
        retrieval: retrievalLatency,
        generation: generationLatency,
        total: Date.now() - totalStart,
      },
    };
  }
}

export const ragService = new RAGService();
