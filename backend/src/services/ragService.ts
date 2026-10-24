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

export class RAGService {
  private baseUrl: string;
  private defaultModel: string;

  constructor() {
    this.baseUrl = config.OLLAMA_BASE_URL.replace(/\/$/, '');
    this.defaultModel = config.OLLAMA_CHAT_MODEL;
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

    // Extract bracketed document IDs like [PDOC-0001] or [TKT-10421]
    const idMatches = [...answer.matchAll(/\[([A-Z]{2,4}-[0-9]{3,5})\]/g)];
    const citedIds = new Set<string>(idMatches.map((m) => m[1]));

    const validatedCitations: Citation[] = [];
    const addedDocIds = new Set<string>();

    for (const docId of citedIds) {
      const sourceChunk = chunkByDocId.get(docId);
      if (sourceChunk && !addedDocIds.has(docId)) {
        addedDocIds.add(docId);
        const snippetText = sourceChunk.content.slice(0, 200).trim();
        validatedCitations.push({
          document_id: sourceChunk.document_id,
          title: sourceChunk.metadata.title,
          chunk_index: sourceChunk.chunk_index,
          snippet: snippetText + (sourceChunk.content.length > 200 ? '...' : ''),
          source_location: sourceChunk.metadata.section_heading || 'Document Passage',
          tenant_id: sourceChunk.metadata.tenant_id,
          sensitivity: sourceChunk.metadata.sensitivity,
          disclosure_policy: sourceChunk.metadata.disclosure_policy,
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
   * Checks if the generated answer indicates insufficient evidence.
   */
  private checkInsufficientEvidence(answer: string): boolean {
    const lower = answer.toLowerCase();
    return (
      lower.includes('do not have sufficient evidence') ||
      lower.includes('not have sufficient evidence') ||
      lower.includes('insufficient evidence') ||
      lower.includes('not enough information') ||
      lower.includes('provided documents do not contain') ||
      lower.includes('provided context does not contain') ||
      lower.includes('no mention of') ||
      lower.includes('provided evidence does not')
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
1. ONLY state facts that are directly supported by the evidence items below. Do NOT assume, extrapolate, or invent details not present in the context.
2. CITATIONS: Whenever you state a fact or recommendation, reference the source document ID in square brackets, for example [PDOC-0001] or [TKT-10421].
3. INSUFFICIENT EVIDENCE: If the evidence does not contain sufficient facts to answer the question, or if the question asks for information not in the evidence, you MUST state:
"I do not have sufficient evidence in the provided documents to answer this question."
Do NOT fabricate an answer, speculate, or mention ungrounded external facts.
4. Tone: Clear, direct, and professional.`,
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
      rawAnswer = rawAnswer.trim();
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
