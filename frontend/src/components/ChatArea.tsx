'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Citation, AudienceMode } from '@/lib/api';
import { AuthUserProfile } from '@/lib/auth';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  citations?: Citation[];
  insufficientEvidence?: boolean;
  unauthorizedAccess?: boolean;
  policyViolated?: boolean;
  audience?: AudienceMode;
  latencyMs?: {
    retrieval: number;
    filtering?: number;
    generation: number;
    total: number;
  };
  retrievedChunksCount?: number;
}

interface ChatAreaProps {
  messages: ChatMessage[];
  isLoading: boolean;
  currentUser?: AuthUserProfile | null;
  audienceMode: AudienceMode;
  onAudienceModeChange: (mode: AudienceMode) => void;
  onSendMessage: (question: string) => Promise<void>;
  onOpenCitation: (citation: Citation, allCitations: Citation[]) => void;
  onClearChat: () => void;
  onOpenLogin?: () => void;
}

export function ChatArea({
  messages,
  isLoading,
  currentUser,
  audienceMode,
  onAudienceModeChange,
  onSendMessage,
  onOpenCitation,
  onClearChat,
  onOpenLogin,
}: ChatAreaProps) {
  const [input, setInput] = useState('');
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
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
    if (!currentUser && onOpenLogin) {
      onOpenLogin();
      return;
    }
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

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedMessageId(id);
    setTimeout(() => setCopiedMessageId(null), 2000);
  };

  const firstName = currentUser?.name ? currentUser.name.split(' ')[0] : 'Knowledge Seeker';

  const starterQuestions = [
    {
      title: 'Webhook Error CD-WHK-504',
      question: 'What does error CD-WHK-504 mean and what are the recovery steps?',
    },
    {
      title: 'Starter Plan Rate Limits',
      question: 'What is the API rate limit on the Starter plan?',
    },
    {
      title: 'Brightwave Support Ticket',
      question: 'What does TKT-10421 say about the Brightwave webhook delivery timeout issue?',
    },
    {
      title: 'Lumenfield Rate Limit Ticket',
      question: 'Explain the issue in TKT-10467 and what information we need from the customer.',
    },
  ];

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: 'calc(100vh - 60px)',
        width: '100%',
        position: 'relative',
        backgroundColor: '#0a0d14',
      }}
    >
      {/* Messages Scroll Area */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '24px 20px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <div style={{ width: '100%', maxWidth: '820px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {messages.length === 0 ? (
            /* Claude-Style Empty State / Hero */
            <div
              style={{
                margin: 'auto 0',
                padding: '60px 20px 40px',
                textAlign: 'center',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
              }}
            >
              {/* Warm Hero Title */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '12px',
                  marginBottom: '10px',
                }}
              >
                <span
                  style={{
                    color: '#d97706',
                    fontSize: '2rem',
                    lineHeight: 1,
                    filter: 'drop-shadow(0 0 10px rgba(217, 119, 6, 0.4))',
                  }}
                >
                  ✴
                </span>
                <h1
                  style={{
                    fontSize: '2.1rem',
                    fontWeight: 500,
                    color: '#f8fafc',
                    letterSpacing: '-0.02em',
                    fontFamily: 'Georgia, Cambria, "Times New Roman", serif',
                  }}
                >
                  {firstName} returns!
                </h1>
              </div>

              <p style={{ fontSize: '0.925rem', color: '#94a3b8', maxWidth: '520px', lineHeight: 1.6, marginBottom: '32px' }}>
                Ask questions across verified CloudDesk product documentation, runbooks, and customer support tickets.
              </p>

              {/* Centered Floating Prompt Input for Empty State */}
              <div
                style={{
                  width: '100%',
                  maxWidth: '680px',
                  marginBottom: '36px',
                }}
              >
                <form
                  onSubmit={handleSubmit}
                  style={{
                    backgroundColor: '#121724',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    borderRadius: '16px',
                    padding: '14px 16px 12px',
                    boxShadow: '0 12px 30px -10px rgba(0, 0, 0, 0.6)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                    transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
                  }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = 'rgba(99, 102, 241, 0.6)')}
                  onBlur={(e) => (e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.12)')}
                >
                  <textarea
                    rows={2}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="How can I help you today?"
                    style={{
                      width: '100%',
                      background: 'transparent',
                      border: 'none',
                      outline: 'none',
                      color: '#ffffff',
                      fontSize: '0.975rem',
                      lineHeight: 1.5,
                      resize: 'none',
                    }}
                  />

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    {/* Mode badge */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span
                        style={{
                          fontSize: '0.725rem',
                          fontWeight: 600,
                          padding: '3px 8px',
                          borderRadius: '6px',
                          backgroundColor:
                            audienceMode === 'customer' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(99, 102, 241, 0.15)',
                          color: audienceMode === 'customer' ? '#34d399' : '#a5b4fc',
                          border:
                            audienceMode === 'customer'
                              ? '1px solid rgba(16, 185, 129, 0.3)'
                              : '1px solid rgba(99, 102, 241, 0.3)',
                        }}
                      >
                        {audienceMode === 'customer' ? '🌐 Customer-Safe' : '🏢 Internal Mode'}
                      </span>
                    </div>

                    <button
                      type="submit"
                      disabled={!input.trim() || isLoading}
                      style={{
                        padding: '7px 14px',
                        borderRadius: '8px',
                        backgroundColor: input.trim() && !isLoading ? '#6366f1' : 'rgba(255, 255, 255, 0.08)',
                        color: input.trim() && !isLoading ? '#ffffff' : '#64748b',
                        border: 'none',
                        cursor: input.trim() && !isLoading ? 'pointer' : 'default',
                        fontWeight: 600,
                        fontSize: '0.825rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <span>Ask</span>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <line x1="22" y1="2" x2="11" y2="13" />
                        <polygon points="22 2 15 22 11 13 2 9 22 2" />
                      </svg>
                    </button>
                  </div>
                </form>
              </div>

              {/* Starter Question Pills */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                  gap: '12px',
                  width: '100%',
                  maxWidth: '680px',
                  textAlign: 'left',
                }}
              >
                {starterQuestions.map((sq, i) => (
                  <div
                    key={i}
                    onClick={() => onSendMessage(sq.question)}
                    style={{
                      padding: '12px 14px',
                      borderRadius: '10px',
                      backgroundColor: 'rgba(255, 255, 255, 0.03)',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.06)';
                      e.currentTarget.style.borderColor = 'rgba(99, 102, 241, 0.35)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.03)';
                      e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.08)';
                    }}
                  >
                    <div style={{ fontSize: '0.825rem', fontWeight: 600, color: '#e2e8f0', marginBottom: '3px' }}>
                      {sq.title}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#64748b', lineHeight: 1.4 }}>
                      {sq.question}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            /* Active Message Thread */
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
                {/* Header Tag */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', padding: '0 4px' }}>
                  {msg.role === 'assistant' ? (
                    <>
                      <div
                        style={{
                          width: '20px',
                          height: '20px',
                          borderRadius: '5px',
                          background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '0.65rem',
                          fontWeight: 800,
                          color: '#fff',
                        }}
                      >
                        A
                      </div>
                      <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#cbd5e1' }}>
                        AccessCore
                      </span>
                      {msg.audience && (
                        <span
                          style={{
                            fontSize: '0.65rem',
                            fontWeight: 600,
                            padding: '1px 6px',
                            borderRadius: '4px',
                            backgroundColor:
                              msg.audience === 'customer' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(99, 102, 241, 0.15)',
                            color: msg.audience === 'customer' ? '#34d399' : '#a5b4fc',
                            border:
                              msg.audience === 'customer'
                                ? '1px solid rgba(16, 185, 129, 0.3)'
                                : '1px solid rgba(99, 102, 241, 0.3)',
                          }}
                        >
                          {msg.audience === 'customer' ? '🌐 Customer-Safe' : '🏢 Internal'}
                        </span>
                      )}
                    </>
                  ) : (
                    <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#94a3b8' }}>You</span>
                  )}
                  <span style={{ fontSize: '0.7rem', color: '#64748b' }}>{msg.timestamp}</span>
                </div>

                {/* Message Bubble */}
                <div
                  style={{
                    maxWidth: msg.role === 'user' ? '80%' : '100%',
                    backgroundColor: msg.role === 'user' ? '#1f2538' : '#111624',
                    border:
                      msg.role === 'user'
                        ? '1px solid rgba(99, 102, 241, 0.35)'
                        : '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: '14px',
                    padding: '16px 20px',
                    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.25)',
                    position: 'relative',
                  }}
                >
                  <div style={{ color: '#f8fafc', fontSize: '0.93rem', lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>
                    {msg.content}
                  </div>

                  {/* Inline Citations */}
                  {msg.citations && msg.citations.length > 0 && (
                    <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px solid rgba(255, 255, 255, 0.08)' }}>
                      <div
                        style={{
                          fontSize: '0.7rem',
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          letterSpacing: '0.04em',
                          color: '#64748b',
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
                        Verified Sources ({msg.citations.length})
                      </div>

                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {msg.citations.map((c, cIdx) => (
                          <button
                            key={`${c.document_id}-${c.chunk_index}-${cIdx}`}
                            onClick={() => onOpenCitation(c, msg.citations || [])}
                            title={`Inspect: ${c.title}`}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '5px',
                              padding: '3px 8px',
                              borderRadius: '6px',
                              backgroundColor: 'rgba(99, 102, 241, 0.12)',
                              border: '1px solid rgba(99, 102, 241, 0.25)',
                              color: '#cbd5e1',
                              fontSize: '0.75rem',
                              cursor: 'pointer',
                            }}
                          >
                            <span style={{ fontWeight: 700, color: '#a5b4fc', fontFamily: 'monospace' }}>
                              [{c.document_id}]
                            </span>
                            {c.is_summary && (
                              <span style={{ fontSize: '0.62rem', color: '#34d399', fontWeight: 600 }}>
                                (Summary)
                              </span>
                            )}
                            <span style={{ maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {c.title}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Footer Action Bar */}
                  {msg.role === 'assistant' && (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginTop: '12px',
                        paddingTop: '8px',
                        borderTop: '1px solid rgba(255, 255, 255, 0.05)',
                        fontSize: '0.72rem',
                        color: '#64748b',
                      }}
                    >
                      <div>
                        {msg.latencyMs && (
                          <span>
                            Retrieved in {msg.latencyMs.retrieval}ms • Verified in {(msg.latencyMs.total / 1000).toFixed(2)}s
                          </span>
                        )}
                      </div>

                      <button
                        onClick={() => handleCopy(msg.id, msg.content)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          padding: '3px 8px',
                          borderRadius: '5px',
                          backgroundColor: 'rgba(255, 255, 255, 0.04)',
                          color: copiedMessageId === msg.id ? '#34d399' : '#94a3b8',
                          border: 'none',
                          cursor: 'pointer',
                          fontSize: '0.72rem',
                          fontWeight: 500,
                        }}
                      >
                        {copiedMessageId === msg.id ? (
                          <>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                            <span>Copied</span>
                          </>
                        ) : (
                          <>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                              <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                            </svg>
                            <span>Copy</span>
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}

          {/* Loading bubble */}
          {isLoading && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', width: '100%' }}>
              <div
                style={{
                  backgroundColor: '#111624',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: '14px',
                  padding: '14px 18px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                }}
              >
                <div style={{ display: 'flex', gap: '4px' }}>
                  <span className="pulse-bubble" />
                  <span className="pulse-bubble" />
                  <span className="pulse-bubble" />
                </div>
                <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
                  Retrieving verified evidence and synthesizing answer...
                </span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Floating Bottom Input Bar (When Messages Exist) */}
      {messages.length > 0 && (
        <div
          style={{
            padding: '12px 20px 20px',
            backgroundColor: '#0a0d14',
            borderTop: '1px solid rgba(255, 255, 255, 0.06)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
          }}
        >
          <div style={{ width: '100%', maxWidth: '820px' }}>
            {/* Audience Switcher */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>Audience Mode:</span>
                {currentUser?.user_type === 'customer_user' ? (
                  <span
                    style={{
                      fontSize: '0.72rem',
                      fontWeight: 600,
                      padding: '2px 8px',
                      borderRadius: '5px',
                      backgroundColor: 'rgba(16, 185, 129, 0.15)',
                      color: '#34d399',
                      border: '1px solid rgba(16, 185, 129, 0.3)',
                    }}
                  >
                    🔒 Customer-Facing Mode (Locked)
                  </span>
                ) : (
                  <div
                    style={{
                      display: 'inline-flex',
                      backgroundColor: '#121724',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      borderRadius: '6px',
                      padding: '2px',
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => onAudienceModeChange('internal')}
                      style={{
                        padding: '2px 8px',
                        borderRadius: '4px',
                        border: 'none',
                        fontSize: '0.72rem',
                        fontWeight: 600,
                        backgroundColor: audienceMode === 'internal' ? '#4f46e5' : 'transparent',
                        color: audienceMode === 'internal' ? '#ffffff' : '#94a3b8',
                        cursor: 'pointer',
                      }}
                    >
                      🏢 Internal
                    </button>
                    <button
                      type="button"
                      onClick={() => onAudienceModeChange('customer')}
                      style={{
                        padding: '2px 8px',
                        borderRadius: '4px',
                        border: 'none',
                        fontSize: '0.72rem',
                        fontWeight: 600,
                        backgroundColor: audienceMode === 'customer' ? '#059669' : 'transparent',
                        color: audienceMode === 'customer' ? '#ffffff' : '#94a3b8',
                        cursor: 'pointer',
                      }}
                    >
                      🌐 Customer-Safe
                    </button>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={onClearChat}
                style={{
                  fontSize: '0.72rem',
                  color: '#64748b',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = '#ef4444')}
                onMouseLeave={(e) => (e.currentTarget.style.color = '#64748b')}
              >
                Clear Thread
              </button>
            </div>

            {/* Prompt Input Form */}
            <form
              onSubmit={handleSubmit}
              style={{
                backgroundColor: '#121724',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                borderRadius: '12px',
                padding: '10px 14px',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
              }}
            >
              <textarea
                ref={textareaRef}
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask a question..."
                style={{
                  flex: 1,
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: '#ffffff',
                  fontSize: '0.925rem',
                  lineHeight: 1.4,
                  resize: 'none',
                }}
              />

              <button
                type="submit"
                disabled={!input.trim() || isLoading}
                style={{
                  padding: '7px 12px',
                  borderRadius: '7px',
                  backgroundColor: input.trim() && !isLoading ? '#6366f1' : 'rgba(255, 255, 255, 0.08)',
                  color: input.trim() && !isLoading ? '#ffffff' : '#64748b',
                  border: 'none',
                  cursor: input.trim() && !isLoading ? 'pointer' : 'default',
                  fontWeight: 600,
                  fontSize: '0.8rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <span>Send</span>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
