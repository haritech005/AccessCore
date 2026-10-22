'use client';

import { useState, useEffect } from 'react';
import { fetchHealthStatus, HealthCheckData } from '@/lib/api';

export default function Home() {
  const [health, setHealth] = useState<HealthCheckData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [latency, setLatency] = useState<number | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [lastChecked, setLastChecked] = useState<string>('');

  const checkHealth = async () => {
    setLoading(true);
    const result = await fetchHealthStatus();
    setHealth(result.data);
    setError(result.error);
    setLatency(result.responseTimeMs);
    setLastChecked(new Date().toLocaleTimeString());
    setLoading(false);
  };

  useEffect(() => {
    checkHealth();
  }, []);

  return (
    <main style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Top Header */}
      <header
        style={{
          borderBottom: '1px solid var(--border-subtle)',
          background: 'rgba(10, 13, 20, 0.8)',
          backdropFilter: 'blur(10px)',
          position: 'sticky',
          top: 0,
          zIndex: 10,
        }}
      >
        <div
          className="container"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            height: '70px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '8px',
                background: 'var(--accent-gradient)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 800,
                fontSize: '1.2rem',
                color: '#fff',
                boxShadow: 'var(--shadow-glow)',
              }}
            >
              A
            </div>
            <div>
              <h1 style={{ fontSize: '1.15rem', fontWeight: 700, letterSpacing: '-0.02em' }}>
                AccessCore
              </h1>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Permission-Aware Enterprise Knowledge System
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span className="badge badge-accent">Phase 1 Foundation</span>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '0.85rem',
                color: 'var(--text-secondary)',
                padding: '6px 14px',
                background: 'rgba(255, 255, 255, 0.03)',
                borderRadius: 'var(--radius-full)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <span
                className={`status-dot ${
                  error ? 'status-dot-error' : health?.status === 'healthy' ? 'status-dot-active' : 'status-dot-warning'
                }`}
              />
              <span>{loading ? 'Checking...' : error ? 'Backend Offline' : 'Backend Connected'}</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="container" style={{ flex: 1, padding: '40px 24px' }}>
        {/* Hero Section */}
        <div style={{ maxWidth: '780px', marginBottom: '40px' }}>
          <div style={{ display: 'inline-block', marginBottom: '12px' }}>
            <span className="badge badge-accent">Portfolio Architecture</span>
          </div>
          <h2
            style={{
              fontSize: '2.5rem',
              fontWeight: 800,
              letterSpacing: '-0.03em',
              lineHeight: 1.2,
              marginBottom: '16px',
            }}
          >
            Permission-Aware Enterprise Knowledge System
          </h2>
          <p
            style={{
              fontSize: '1.1rem',
              color: 'var(--text-secondary)',
              lineHeight: 1.6,
            }}
          >
            AccessCore proves how to build an evidence-grounded RAG application with strict server-side
            authorization and customer disclosure policies. The LLM is never trusted to make security decisions.
          </p>
        </div>

        {/* Live Connectivity & Health Panel */}
        <section style={{ marginBottom: '48px' }}>
          <div
            className="glass-card"
            style={{
              padding: '28px',
              border: error ? '1px solid rgba(239, 68, 68, 0.3)' : '1px solid var(--border-subtle)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                marginBottom: '24px',
                flexWrap: 'wrap',
                gap: '16px',
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
                  <h3 style={{ fontSize: '1.25rem', fontWeight: 700 }}>System Communication & Health</h3>
                  <span
                    className={`badge ${
                      error
                        ? 'badge-error'
                        : health?.status === 'healthy'
                        ? 'badge-success'
                        : 'badge-warning'
                    }`}
                  >
                    {loading ? 'Testing' : error ? 'Offline' : health?.status}
                  </span>
                </div>
                <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                  Frontend Next.js communicating with Node.js backend on{' '}
                  <code
                    style={{
                      fontFamily: 'var(--font-mono)',
                      background: 'rgba(255, 255, 255, 0.06)',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      color: 'var(--text-primary)',
                    }}
                  >
                    {process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}
                  </code>
                </p>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                {latency !== null && (
                  <span
                    style={{
                      fontSize: '0.8rem',
                      fontFamily: 'var(--font-mono)',
                      color: latency < 100 ? 'var(--status-success)' : 'var(--status-warning)',
                    }}
                  >
                    {latency}ms round-trip
                  </span>
                )}
                <button
                  onClick={checkHealth}
                  disabled={loading}
                  className="btn-primary"
                  style={{ padding: '8px 16px', fontSize: '0.825rem' }}
                >
                  {loading ? 'Testing...' : 'Retest Health'}
                </button>
              </div>
            </div>

            {error ? (
              <div
                style={{
                  background: 'var(--status-error-bg)',
                  border: '1px solid rgba(239, 68, 68, 0.25)',
                  borderRadius: 'var(--radius-md)',
                  padding: '16px 20px',
                  color: '#fca5a5',
                  fontSize: '0.9rem',
                }}
              >
                <strong>Connection Error:</strong> {error}
                <div style={{ marginTop: '8px', fontSize: '0.8rem', color: '#f87171' }}>
                  Ensure the backend server is running on port 4000 (<code>npm run dev</code> inside backend/).
                </div>
              </div>
            ) : health ? (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                  gap: '16px',
                }}
              >
                {/* Node Backend Service */}
                <div
                  style={{
                    background: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-md)',
                    padding: '16px',
                  }}
                >
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '6px' }}>
                    Backend API
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <span className="status-dot status-dot-active" />
                    <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>Active</span>
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    Uptime: {Math.floor(health.uptime)}s | Env: {health.environment}
                  </div>
                </div>

                {/* PostgreSQL Database */}
                <div
                  style={{
                    background: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-md)',
                    padding: '16px',
                  }}
                >
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '6px' }}>
                    PostgreSQL + pgvector
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <span
                      className={`status-dot ${
                        health.services.database.status === 'connected' ? 'status-dot-active' : 'status-dot-warning'
                      }`}
                    />
                    <span style={{ fontWeight: 600, fontSize: '0.95rem', textTransform: 'capitalize' }}>
                      {health.services.database.status}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    pgvector v{health.services.database.pgvectorVersion || '0.8.6'} • Schema Ready
                  </div>
                </div>

                {/* Local Ollama LLM */}
                <div
                  style={{
                    background: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-md)',
                    padding: '16px',
                  }}
                >
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '6px' }}>
                    Ollama Chat Model
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <span
                      className={`status-dot ${
                        health.services.ollama.status === 'connected' ? 'status-dot-active' : 'status-dot-error'
                      }`}
                    />
                    <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>
                      {health.services.ollama.chatModel}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    Local-first inference at {health.services.ollama.endpoint}
                  </div>
                </div>

                {/* Local Ollama Embedding */}
                <div
                  style={{
                    background: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-md)',
                    padding: '16px',
                  }}
                >
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '6px' }}>
                    Embedding Model
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <span
                      className={`status-dot ${
                        health.services.ollama.status === 'connected' ? 'status-dot-active' : 'status-dot-error'
                      }`}
                    />
                    <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>
                      {health.services.ollama.embeddingModel}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    Dimension: 768 vectors
                  </div>
                </div>
              </div>
            ) : null}

            {lastChecked && (
              <div style={{ marginTop: '16px', textAlign: 'right', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Last verified: {lastChecked}
              </div>
            )}
          </div>
        </section>

        {/* 5-Phase Roadmap Status Grid */}
        <section>
          <div style={{ marginBottom: '20px' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '4px' }}>
              Sequential Implementation Roadmap
            </h3>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
              Strict five-phase progression. Security and authorization layers are introduced incrementally.
            </p>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: '16px',
            }}
          >
            {/* Phase 1 */}
            <div
              className="glass-card"
              style={{
                padding: '20px',
                border: '1px solid rgba(99, 102, 241, 0.3)',
                background: 'rgba(99, 102, 241, 0.04)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--accent-primary)' }}>PHASE 1</span>
                <span className="badge badge-accent">In Progress</span>
              </div>
              <h4 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: '8px' }}>Foundation</h4>
              <p style={{ fontSize: '0.825rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                Local RAG pipeline with Next.js, PostgreSQL/pgvector, LangChain.js, PDF/Markdown/JSON parsing, vector search, and grounded citations.
              </p>
            </div>

            {/* Phase 2 */}
            <div className="glass-card" style={{ padding: '20px', opacity: 0.7 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)' }}>PHASE 2</span>
                <span className="badge" style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-muted)' }}>Upcoming</span>
              </div>
              <h4 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: '8px' }}>Identity & Access</h4>
              <p style={{ fontSize: '0.825rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                Auth.js authentication, users, tenants, groups, permissions, and server-side filtering before evidence reaches the LLM.
              </p>
            </div>

            {/* Phase 3 */}
            <div className="glass-card" style={{ padding: '20px', opacity: 0.7 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)' }}>PHASE 3</span>
                <span className="badge" style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-muted)' }}>Upcoming</span>
              </div>
              <h4 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: '8px' }}>Disclosure Policies</h4>
              <p style={{ fontSize: '0.825rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                Internal vs. customer-facing answer modes, approved summaries, and prompt-injection defense.
              </p>
            </div>

            {/* Phase 4 */}
            <div className="glass-card" style={{ padding: '20px', opacity: 0.7 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)' }}>PHASE 4</span>
                <span className="badge" style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-muted)' }}>Upcoming</span>
              </div>
              <h4 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: '8px' }}>Retrieval Intelligence</h4>
              <p style={{ fontSize: '0.825rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                PostgreSQL full-text search, Reciprocal Rank Fusion, Recall@k evaluation, citation verification, and latency tracing.
              </p>
            </div>

            {/* Phase 5 */}
            <div className="glass-card" style={{ padding: '20px', opacity: 0.7 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)' }}>PHASE 5</span>
                <span className="badge" style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-muted)' }}>Upcoming</span>
              </div>
              <h4 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: '8px' }}>Productization & Release</h4>
              <p style={{ fontSize: '0.825rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                Admin dashboard, audit logging, ingestion monitoring, full security regression suites, and Docker setup.
              </p>
            </div>
          </div>
        </section>
      </div>

      {/* Footer */}
      <footer
        style={{
          borderTop: '1px solid var(--border-subtle)',
          padding: '24px 0',
          background: 'rgba(10, 13, 20, 0.6)',
          textAlign: 'center',
          fontSize: '0.8rem',
          color: 'var(--text-muted)',
        }}
      >
        <div className="container">
          AccessCore v1.0 • Permission-Aware Enterprise Knowledge System • Local-first Architecture
        </div>
      </footer>
    </main>
  );
}
