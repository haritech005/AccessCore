'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  fetchHealthStatus,
  fetchDocuments,
  askQuestion,
  DocumentRecord,
  Citation,
} from '@/lib/api';
import { getCurrentUser, logoutUser, AuthUserProfile } from '@/lib/auth';
import { Header } from '@/components/Header';
import { ChatArea, ChatMessage } from '@/components/ChatArea';
import { CitationDrawer } from '@/components/CitationDrawer';
import { KnowledgeDrawer } from '@/components/KnowledgeDrawer';
import { LoginModal } from '@/components/LoginModal';

export default function Home() {
  const [currentUser, setCurrentUser] = useState<AuthUserProfile | null>(null);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState<boolean>(false);
  const [isBackendConnected, setIsBackendConnected] = useState<boolean | null>(null);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // Citation inspection drawer state
  const [activeCitation, setActiveCitation] = useState<Citation | null>(null);
  const [activeAllCitations, setActiveAllCitations] = useState<Citation[]>([]);

  // Knowledge / Ingestion drawer state
  const [isKnowledgeDrawerOpen, setIsKnowledgeDrawerOpen] = useState<boolean>(false);
  const [knowledgeDrawerTab, setKnowledgeDrawerTab] = useState<'upload' | 'library'>('library');

  // Initial load: verify backend health & check current user session
  const loadInitialData = useCallback(async () => {
    const healthResult = await fetchHealthStatus();
    setIsBackendConnected(healthResult.error === null && healthResult.data?.status === 'healthy');

    const user = await getCurrentUser();
    setCurrentUser(user);

    if (user) {
      const docsResult = await fetchDocuments();
      if (docsResult.data) {
        setDocuments(docsResult.data);
      }
    }
  }, []);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  const handleLoginSuccess = async (user: AuthUserProfile) => {
    setCurrentUser(user);
    const docsResult = await fetchDocuments();
    if (docsResult.data) {
      setDocuments(docsResult.data);
    }
  };

  const handleLogout = async () => {
    await logoutUser();
    setCurrentUser(null);
    setDocuments([]);
  };

  // Handle sending a chat message to the RAG pipeline
  const handleSendMessage = async (question: string) => {
    if (!question.trim() || isLoading) return;

    if (!currentUser) {
      setIsLoginModalOpen(true);
      return;
    }

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: question,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);

    try {
      const result = await askQuestion(question);

      if (result.error || !result.data) {
        const errorMessage: ChatMessage = {
          id: `error-${Date.now()}`,
          role: 'assistant',
          content:
            result.error ||
            'Unable to process question. Please ensure the knowledge service is running.',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          insufficientEvidence: false,
        };
        setMessages((prev) => [...prev, errorMessage]);
      } else {
        const assistantMessage: ChatMessage = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: result.data.answer,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          citations: result.data.citations,
          insufficientEvidence: result.data.insufficient_evidence,
          unauthorizedAccess: result.data.unauthorized_access,
          latencyMs: result.data.latency_ms,
          retrievedChunksCount: result.data.retrieved_chunks.length,
        };
        setMessages((prev) => [...prev, assistantMessage]);
      }
    } catch {
      const fallbackErrorMessage: ChatMessage = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: 'An unexpected connection error occurred while querying the knowledge base.',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => [...prev, fallbackErrorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  // Open Citation Provenance Drawer
  const handleOpenCitation = (citation: Citation, allCitations: Citation[]) => {
    setActiveCitation(citation);
    setActiveAllCitations(allCitations);
  };

  // Open Knowledge / Upload Drawer
  const handleOpenKnowledgeDrawer = (initialTab: 'upload' | 'library' = 'library') => {
    setKnowledgeDrawerTab(initialTab);
    setIsKnowledgeDrawerOpen(true);
  };

  // Ask about a specific document from the library
  const handleAskAboutDocument = (docTitle: string, docId: string) => {
    const prompt = `Summarize the key information and procedures documented in [${docId}] ${docTitle}.`;
    handleSendMessage(prompt);
  };

  return (
    <main style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Enterprise Header */}
      <Header
        isBackendConnected={isBackendConnected}
        documentCount={documents.length}
        currentUser={currentUser}
        onOpenKnowledgeDrawer={handleOpenKnowledgeDrawer}
        onOpenLoginModal={() => setIsLoginModalOpen(true)}
        onLogout={handleLogout}
      />

      {/* Main Conversational Area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <ChatArea
          messages={messages}
          isLoading={isLoading}
          currentUser={currentUser}
          onSendMessage={handleSendMessage}
          onOpenCitation={handleOpenCitation}
          onOpenUpload={() => handleOpenKnowledgeDrawer('upload')}
          onClearChat={() => setMessages([])}
          onOpenLogin={() => setIsLoginModalOpen(true)}
        />
      </div>

      {/* Employee Login Modal */}
      <LoginModal
        isOpen={isLoginModalOpen}
        onClose={() => setIsLoginModalOpen(false)}
        onLoginSuccess={handleLoginSuccess}
      />

      {/* Slide-over Citation Provenance Drawer */}
      <CitationDrawer
        citation={activeCitation}
        allCitations={activeAllCitations}
        onSelectCitation={(c) => setActiveCitation(c)}
        onClose={() => setActiveCitation(null)}
      />

      {/* Slide-over Knowledge & Upload Drawer */}
      <KnowledgeDrawer
        isOpen={isKnowledgeDrawerOpen}
        initialTab={knowledgeDrawerTab}
        documents={documents}
        onDocumentsUpdated={(updatedDocs) => setDocuments(updatedDocs)}
        onAskAboutDocument={handleAskAboutDocument}
        onClose={() => setIsKnowledgeDrawerOpen(false)}
      />
    </main>
  );
}
