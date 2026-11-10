'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  fetchHealthStatus,
  fetchDocuments,
  askQuestion,
  fetchConversations,
  createConversation,
  fetchConversation,
  deleteConversation,
  DocumentRecord,
  Citation,
  AudienceMode,
  ConversationItem,
} from '@/lib/api';
import { getCurrentUser, logoutUser, AuthUserProfile } from '@/lib/auth';
import { Header } from '@/components/Header';
import { Sidebar } from '@/components/Sidebar';
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
  const [audienceMode, setAudienceMode] = useState<AudienceMode>('internal');

  // Conversational History & Sidebar State
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(true);
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);

  // Citation inspection drawer state
  const [activeCitation, setActiveCitation] = useState<Citation | null>(null);
  const [activeAllCitations, setActiveAllCitations] = useState<Citation[]>([]);

  // Knowledge Library drawer state
  const [isKnowledgeDrawerOpen, setIsKnowledgeDrawerOpen] = useState<boolean>(false);

  // Load conversations list for current user
  const loadConversations = useCallback(async () => {
    const result = await fetchConversations();
    if (result.data) {
      setConversations(result.data);
    }
  }, []);

  // Initial load: verify backend health & check current user session
  const loadInitialData = useCallback(async () => {
    const healthResult = await fetchHealthStatus();
    setIsBackendConnected(healthResult.error === null && healthResult.data?.status === 'healthy');

    const user = await getCurrentUser();
    setCurrentUser(user);

    if (user) {
      if (user.user_type === 'customer_user') {
        setAudienceMode('customer');
      } else {
        setAudienceMode('internal');
      }

      const docsResult = await fetchDocuments();
      if (docsResult.data) {
        setDocuments(docsResult.data);
      }

      await loadConversations();
    }
  }, [loadConversations]);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  const handleLoginSuccess = async (user: AuthUserProfile) => {
    setCurrentUser(user);
    if (user.user_type === 'customer_user') {
      setAudienceMode('customer');
    } else {
      setAudienceMode('internal');
    }

    const docsResult = await fetchDocuments();
    if (docsResult.data) {
      setDocuments(docsResult.data);
    }

    await loadConversations();
  };

  const handleLogout = async () => {
    await logoutUser();
    setCurrentUser(null);
    setDocuments([]);
    setConversations([]);
    setActiveConversationId(null);
    setMessages([]);
    setAudienceMode('internal');
  };

  // Switch to an existing conversation
  const handleSelectConversation = async (conversationId: string) => {
    if (conversationId === activeConversationId) return;

    setActiveConversationId(conversationId);
    setIsLoading(true);

    try {
      const result = await fetchConversation(conversationId);
      if (result.data && result.data.messages) {
        const formatted: ChatMessage[] = result.data.messages.map((m) => {
          const meta = m.metadata || {};
          return {
            id: m.id,
            role: m.role as 'user' | 'assistant',
            content: m.content,
            timestamp: new Date(m.created_at).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            }),
            citations: m.citations || [],
            audience: (meta.audience as AudienceMode) || 'internal',
            insufficientEvidence: (meta.insufficient_evidence as boolean) || false,
            unauthorizedAccess: (meta.unauthorized_access as boolean) || false,
            policyViolated: (meta.policy_violated as boolean) || false,
            latencyMs: meta.latency_ms as ChatMessage['latencyMs'],
            retrievedChunksCount: (meta.retrieved_chunks_count as number) || 0,
          };
        });
        setMessages(formatted);
      } else {
        setMessages([]);
      }
    } catch {
      setMessages([]);
    } finally {
      setIsLoading(false);
    }
  };

  // Start a fresh chat
  const handleNewChat = () => {
    setActiveConversationId(null);
    setMessages([]);
    if (currentUser?.user_type === 'customer_user') {
      setAudienceMode('customer');
    } else {
      setAudienceMode('internal');
    }
  };

  // Delete a conversation
  const handleDeleteConversation = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();

    const res = await deleteConversation(id);
    if (res.success) {
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (activeConversationId === id) {
        handleNewChat();
      }
    }
  };

  // Handle sending a chat message to the RAG pipeline
  const handleSendMessage = async (question: string) => {
    if (!question.trim() || isLoading) return;

    if (!currentUser) {
      setIsLoginModalOpen(true);
      return;
    }

    const effectiveAudience: AudienceMode =
      currentUser.user_type === 'customer_user' ? 'customer' : audienceMode;

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: question,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);

    try {
      // 1. Ensure conversation exists; if not, create one
      let targetConvId = activeConversationId;
      if (!targetConvId) {
        const createRes = await createConversation(question.slice(0, 48));
        if (createRes.data) {
          targetConvId = createRes.data.id;
          setActiveConversationId(targetConvId);
          // Add temporary placeholder into conversation list
          setConversations((prev) => [createRes.data!, ...prev.filter((c) => c.id !== createRes.data!.id)]);
        }
      }

      // 2. Prepare past turns for conversational memory context
      const chatHistory = messages
        .filter((m) => m.content && (m.role === 'user' || m.role === 'assistant'))
        .map((m) => ({ role: m.role, content: m.content }));

      // 3. Ask RAG service with conversational persistence
      const result = await askQuestion(question, {
        audience: effectiveAudience,
        chat_history: chatHistory.length > 0 ? chatHistory : undefined,
        conversation_id: targetConvId || undefined,
      });

      if (result.error || !result.data) {
        const errorMessage: ChatMessage = {
          id: `error-${Date.now()}`,
          role: 'assistant',
          content:
            result.error ||
            'Unable to process question. Please ensure the knowledge service is running.',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          insufficientEvidence: false,
          audience: effectiveAudience,
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
          policyViolated: result.data.policy_violated,
          audience: result.data.audience || effectiveAudience,
          latencyMs: result.data.latency_ms,
          retrievedChunksCount: result.data.retrieved_chunks.length,
        };
        setMessages((prev) => [...prev, assistantMessage]);
      }

      // 4. Refresh conversations list so title and updated_at are updated
      await loadConversations();
    } catch {
      const fallbackErrorMessage: ChatMessage = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: 'An unexpected connection error occurred while querying the knowledge base.',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        audience: effectiveAudience,
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

  // Ask about a specific document from the library
  const handleAskAboutDocument = (docTitle: string, docId: string) => {
    setIsKnowledgeDrawerOpen(false);
    const prompt = `Summarize the key information and procedures documented in [${docId}] ${docTitle}.`;
    handleSendMessage(prompt);
  };

  return (
    <div
      style={{
        display: 'flex',
        height: '100vh',
        width: '100vw',
        overflow: 'hidden',
        backgroundColor: '#0a0d14',
      }}
    >
      {/* Left Collapsible Claude-style Sidebar */}
      <Sidebar
        isOpen={isSidebarOpen}
        onToggle={() => setIsSidebarOpen((prev) => !prev)}
        conversations={conversations}
        activeConversationId={activeConversationId}
        onSelectConversation={handleSelectConversation}
        onNewChat={handleNewChat}
        onDeleteConversation={handleDeleteConversation}
        currentUser={currentUser}
        onOpenLibrary={() => setIsKnowledgeDrawerOpen(true)}
        onOpenLogin={() => setIsLoginModalOpen(true)}
        onLogout={handleLogout}
        documentCount={documents.length}
      />

      {/* Main Right Area: Top Header + Chat Window */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          height: '100vh',
          minWidth: 0,
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {/* Enterprise Top Navigation */}
        <Header
          isBackendConnected={isBackendConnected}
          documentCount={documents.length}
          currentUser={currentUser}
          onOpenKnowledgeDrawer={() => setIsKnowledgeDrawerOpen(true)}
          onOpenLoginModal={() => setIsLoginModalOpen(true)}
          onLogout={handleLogout}
          onToggleSidebar={() => setIsSidebarOpen((prev) => !prev)}
          isSidebarOpen={isSidebarOpen}
        />

        {/* Conversational Knowledge Assistant Canvas */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <ChatArea
            messages={messages}
            isLoading={isLoading}
            currentUser={currentUser}
            audienceMode={audienceMode}
            onAudienceModeChange={setAudienceMode}
            onSendMessage={handleSendMessage}
            onOpenCitation={handleOpenCitation}
            onClearChat={handleNewChat}
            onOpenLogin={() => setIsLoginModalOpen(true)}
          />
        </div>
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

      {/* Slide-over Knowledge Library Drawer */}
      <KnowledgeDrawer
        isOpen={isKnowledgeDrawerOpen}
        documents={documents}
        onAskAboutDocument={handleAskAboutDocument}
        onClose={() => setIsKnowledgeDrawerOpen(false)}
      />
    </div>
  );
}
