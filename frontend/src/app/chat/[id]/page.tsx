'use client';

import React, { Suspense } from 'react';
import { useParams } from 'next/navigation';
import { KnowledgeAssistantApp } from '@/components/KnowledgeAssistantApp';

function ChatContent() {
  const params = useParams();
  const id = typeof params?.id === 'string' ? params.id : undefined;

  return <KnowledgeAssistantApp initialConversationId={id} />;
}

export default function ChatPage() {
  return (
    <Suspense fallback={<div style={{ height: '100vh', backgroundColor: '#0a0d14' }} />}>
      <ChatContent />
    </Suspense>
  );
}
