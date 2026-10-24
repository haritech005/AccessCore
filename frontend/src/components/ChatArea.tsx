'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Citation, RAGAnswerResponse } from '@/lib/api';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  citations?: Citation[];
  insufficientEvidence?: boolean;
  latencyMs?: {
    retrieval: number;
    generation: number;
    total: number;
  };
  retrievedChunksCount?: number;
}

interface ChatAreaProps {
  messages: ChatMessage[];
  isLoading: boolean;
  onSendMessage: (question: string) => Promise<void>;
  onOpenCitation: (citation: Citation, allCitations: Citation[]) => void;
  onOpenUpload: () => void;
  onClearChat: () => void;
}

export function ChatArea({
  messages,
  isLoading,
  onSendMessage,
  onOpenCitation,
  onOpenUpload,
  onClearChat,
}: ChatAreaProps) {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!input.trim() || isLoading) return;
    const q = input.trim();
    setInput('');
    onSendMessage(q);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const starterQuestions = [
    {
      title: 'Webhook Error Code',
      question: 'What does error CD-WHK-504 mean and what are the recovery steps?',
    },
    {
      title: 'Enterprise Rate Limits',
      question: 'What are the API rate limits for the Enterprise plan?',
    },
    {
      title: 'SAML SSO Login Issue',
      question: 'What causes the SAML SSO login failure for Harborpine users?',
    },
    {
      title: 'Support Ticket Diagnosis',
      question: 'Tell me about the Brightwave webhook timeout support ticket.',
    },
  ];

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: 'calc(100vh - 68px)',
        maxWidth: '1000px',
        margin: '0 auto',
        width: '100%',
        padding: '0 20px',
      }}
    >
      {/* Chat Messages Feed */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '24px 0',
          display: 'flex',
          flexDirection: 'column',
          gap: '24px',
        }}
      >
        {messages.length === 0 ? (
          /* Empty State / Welcome Hero */
          <div
            style={{
              margin: 'auto 0',
              textAlign: 'center',
              padding: '40px 20px',
              maxWidth: '680px',
              alignSelf: 'center',
            }}
          >
            <div
              style={{
                width: '56px',
                height: '56px',
                borderRadius: '16px',
                background: 'var(--accent-gradient)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 20px',
                boxShadow: 'var(--shadow-glow)',
                color: '#ffffff',
                fontWeight: 800,
                fontSize: '1.75rem',
              }}
            >
              A
            </div>

            <h2
              style={{
                fontSize: '1.75rem',
                fontWeight: 800,
                letterSpacing: '-0.02em',
                marginBottom: '10px',
                color: 'var(--text-primary)',
              }}
            >
              How can I assist you today?
            </h2>

            <p
              style={{
                fontSize: '0.95rem',
                color: 'var(--text-secondary)',
                lineHeight: 1.6,
                marginBottom: '32px',
              }}
            >
              Ask questions across indexed product documentation, architecture manuals, and customer support tickets.
              Every answer is strictly grounded in verified evidence with clickable source citations.
            </p>

            {/* Quick Starter Chips */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                gap: '12px',
                textAlign: 'left',
              }}
            >
              {starterQuestions.map((sq, i) => (
                <div
                  key={i}
                  className="suggestion-chip"
                  onClick={() => onSendMessage(sq.question)}
                >
                  <div
                    style={{
                      width: '28px',
                      height: '28px',
                      borderRadius: '6px',
                      background: 'rgba(99, 102, 241, 0.15)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--accent-primary)',
                      flexShrink: 0,
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </svg>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                      {sq.title}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.3 }}>
                      {sq.question}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          /* Messages List */
          messages.map((msg) => (
            <div
              key={msg.id}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
                width: '100%',
              }}
            >
              {/* Message Header */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  marginBottom: '6px',
                  padding: '0 4px',
                }}
              >
                {msg.role === 'assistant' ? (
                  <>
                    <div
                      style={{
                        width: '22px',
                        height: '22px',
                        borderRadius: '6px',
                        background: 'var(--accent-gradient)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '0.7rem',
                        fontWeight: 800,
                        color: '#fff',
                      }}
                    >
                      A
                    </div>
                    <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                      AccessCore
                    </span>
                  </>
                ) : (
                  <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                    You
                  </span>
                )}
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  {msg.timestamp}
                </span>
              </div>

              {/* Message Bubble Card */}
              <div
                style={{
                  maxWidth: '85%',
                  background:
                    msg.role === 'user'
                      ? 'linear-gradient(135deg, rgba(99, 102, 241, 0.25) 0%, rgba(139, 92, 246, 0.2) 100%)'
                      : 'var(--bg-card)',
                  border:
                    msg.role === 'user'
                      ? '1px solid rgba(99, 102, 241, 0.4)'
                      : '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-lg)',
                  padding: '16px 20px',
                  boxShadow: 'var(--shadow-sm)',
                  backdropFilter: 'blur(10px)',
                }}
              >
                {/* Insufficient Evidence Alert Banner */}
                {msg.insufficientEvidence && (
                  <div
                    style={{
                      background: 'rgba(245, 158, 11, 0.1)',
                      border: '1px solid rgba(245, 158, 11, 0.3)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '10px 14px',
                      marginBottom: '14px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      color: '#fbbf24',
                      fontSize: '0.8rem',
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="8" x2="12" y2="12" />
                      <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                    <span>
                      Evidence Grounding Alert: The system refused to speculate because insufficient indexed
                      evidence was found.
                    </span>
                  </div>
                )}

                {/* Answer Content */}
                <div
                  style={{
                    color: 'var(--text-primary)',
                    fontSize: '0.925rem',
                    lineHeight: 1.65,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {msg.content}
                </div>

                {/* Citations Provenance Section */}
                {msg.citations && msg.citations.length > 0 && (
                  <div
                    style={{
                      marginTop: '16px',
                      paddingTop: '12px',
                      borderTop: '1px solid var(--border-subtle)',
                    }}
                  >
                    <div
                      style={{
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                        color: 'var(--text-muted)',
                        marginBottom: '8px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                      </svg>
                      Verified Evidence Sources ({msg.citations.length})
                    </div>

                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {msg.citations.map((c, cIdx) => (
                        <button
                          key={`${c.document_id}-${c.chunk_index}-${cIdx}`}
                          className="citation-pill"
                          onClick={() => onOpenCitation(c, msg.citations || [])}
                          title={`Click to inspect source passage: ${c.title}`}
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                            <polyline points="14 2 14 8 20 8" />
                          </svg>
                          <span>[{c.document_id}]</span>
                          <span
                            style={{
                              maxWidth: '180px',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              color: 'var(--text-secondary)',
                              fontWeight: 500,
                            }}
                          >
                            {c.title}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Footer Latency & Retrieval Metadata */}
                {msg.latencyMs && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginTop: '12px',
                      paddingTop: '8px',
                      fontSize: '0.72rem',
                      color: 'var(--text-muted)',
                    }}
                  >
                    <span>
                      Retrieved in {msg.latencyMs.retrieval}ms • Verified in{' '}
                      {(msg.latencyMs.total / 1000).toFixed(2)}s
                    </span>
                    {msg.retrievedChunksCount !== undefined && (
                      <span>{msg.retrievedChunksCount} chunks analyzed</span>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))
        )}

        {/* Loading / Thinking State */}
        {isLoading && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              width: '100%',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                marginBottom: '6px',
                padding: '0 4px',
              }}
            >
              <div
                style={{
                  width: '22px',
                  height: '22px',
                  borderRadius: '6px',
                  background: 'var(--accent-gradient)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '0.7rem',
                  fontWeight: 800,
                  color: '#fff',
                }}
              >
                A
              </div>
              <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                AccessCore
              </span>
            </div>

            <div
              style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-lg)',
                padding: '16px 20px',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
              }}
            >
              <div style={{ display: 'flex', gap: '4px' }}>
                <span className="pulse-bubble" />
                <span className="pulse-bubble" />
                <span className="pulse-bubble" />
              </div>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                Retrieving verified evidence and synthesizing answer...
              </span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Box Bar */}
      <div
        style={{
          padding: '16px 0 24px 0',
          position: 'sticky',
          bottom: 0,
          background: 'linear-gradient(to top, var(--bg-primary) 85%, transparent 100%)',
        }}
      >
        <form
          onSubmit={handleSubmit}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            background: 'var(--bg-input)',
            border: '1px solid var(--border-medium)',
            borderRadius: 'var(--radius-xl)',
            padding: '8px 12px 8px 16px',
            boxShadow: 'var(--shadow-md)',
            transition: 'border-color 0.15s ease',
          }}
        >
          {/* Quick upload trigger button */}
          <button
            type="button"
            onClick={onOpenUpload}
            className="btn-icon"
            style={{ width: '34px', height: '34px', flexShrink: 0 }}
            title="Upload new document or ticket"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </button>

          {/* Text input area */}
          <textarea
            ref={textareaRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask a question about your documents, tickets, or error codes..."
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: 'var(--text-primary)',
              fontSize: '0.925rem',
              lineHeight: 1.5,
              resize: 'none',
              maxHeight: '120px',
            }}
          />

          {/* Send Button */}
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="btn-primary"
            style={{
              padding: '8px 16px',
              borderRadius: 'var(--radius-lg)',
              flexShrink: 0,
            }}
          >
            <span>Send</span>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </form>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 8px 0 8px',
            fontSize: '0.72rem',
            color: 'var(--text-muted)',
          }}
        >
          <span>Shift + Enter for new line • Enter to submit</span>
          {messages.length > 0 && (
            <button
              onClick={onClearChat}
              style={{
                color: 'var(--text-muted)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: '0.72rem',
              }}
            >
              Clear conversation
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
