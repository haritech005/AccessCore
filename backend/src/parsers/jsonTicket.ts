import { DocumentMetadata, DocumentMetadataSchema, ParsedDocument } from '../types/document';
import {
  computeSha256,
  MalformedDocumentError,
  validateFileBasics,
} from './base';

export interface TicketReportedBy {
  user_id?: string;
  name?: string;
  role?: string;
  email?: string;
}

export interface TicketAssignedTo {
  user_id?: string;
  name?: string;
  role?: string;
}

export interface TicketInvestigationNotes {
  confirmed_observations?: string[];
  hypotheses_not_confirmed?: string[];
  actions_taken?: string[];
  open_questions?: string[];
  escalation_status?: string;
  escalation_trigger?: string;
}

export interface TicketContent {
  ticket_id?: string;
  customer_name?: string;
  plan?: string;
  priority?: string;
  channel?: string;
  reported_by?: TicketReportedBy;
  assigned_to?: TicketAssignedTo;
  issue_summary?: string;
  customer_report?: string;
  error_codes?: string[];
  investigation_notes?: TicketInvestigationNotes;
  resolution_status?: string;
  resolution_notes?: string;
  [key: string]: unknown;
}

export interface TicketPayload {
  metadata?: Record<string, unknown>;
  content?: TicketContent;
  [key: string]: unknown;
}

export function formatTicketToText(
  metadata: DocumentMetadata,
  content: TicketContent
): string {
  const sections: string[] = [];

  sections.push(`# Support Ticket: ${metadata.document_id} — ${metadata.title}`);

  const details: string[] = [];
  if (content.customer_name) details.push(`Customer: ${content.customer_name}`);
  if (content.plan) details.push(`Plan: ${content.plan}`);
  if (content.priority) details.push(`Priority: ${content.priority}`);
  if (content.channel) details.push(`Channel: ${content.channel}`);
  if (details.length > 0) {
    sections.push(details.join(' | '));
  }

  if (content.reported_by?.name || content.reported_by?.email) {
    sections.push(
      `Reported By: ${content.reported_by.name || 'Unknown'} (${content.reported_by.email || 'N/A'})${
        content.reported_by.role ? `, Role: ${content.reported_by.role}` : ''
      }`
    );
  }

  if (content.assigned_to?.name) {
    sections.push(
      `Assigned To: ${content.assigned_to.name}${
        content.assigned_to.role ? ` (${content.assigned_to.role})` : ''
      }`
    );
  }

  // Put Issue Summary & Resolution Status right at the top so any overview chunk includes the unconfirmed status
  const summaryStatus: string[] = ['## Issue Summary & Status'];
  if (content.issue_summary) {
    summaryStatus.push(`**Issue Summary:** ${content.issue_summary}`);
  }
  if (content.resolution_status) {
    summaryStatus.push(`**Resolution Status:** ${content.resolution_status} (Exact root cause NOT confirmed)`);
  }
  if (content.resolution_notes) {
    summaryStatus.push(`**Resolution Notes:** ${content.resolution_notes}`);
  }
  if (content.error_codes && content.error_codes.length > 0) {
    summaryStatus.push(`**Error Codes:** ${content.error_codes.join(', ')}`);
  }
  sections.push(summaryStatus.join('\n'));

  if (content.customer_report) {
    sections.push(`## Customer Report (Customer Suspicions)\n${content.customer_report}`);
  }

  const notes = content.investigation_notes;
  if (notes) {
    const notesParts: string[] = ['## Investigation Findings & Hypotheses'];

    if (notes.confirmed_observations && notes.confirmed_observations.length > 0) {
      notesParts.push(
        `**Confirmed Observations:**\n` +
          notes.confirmed_observations.map((o) => `- ${o}`).join('\n')
      );
    }

    if (notes.hypotheses_not_confirmed && notes.hypotheses_not_confirmed.length > 0) {
      notesParts.push(
        `**Unconfirmed Hypotheses (Potential Contributing Factors - NOT Established as Facts):**\n` +
          notes.hypotheses_not_confirmed.map((h) => `- ${h}`).join('\n')
      );
    }

    if (notes.actions_taken && notes.actions_taken.length > 0) {
      notesParts.push(
        `**Actions Taken:**\n` + notes.actions_taken.map((a) => `- ${a}`).join('\n')
      );
    }

    if (notes.open_questions && notes.open_questions.length > 0) {
      notesParts.push(
        `**Open Questions (Unknown / Unmeasured Information):**\n` +
          notes.open_questions.map((q) => `- ${q}`).join('\n')
      );
    }

    if (notes.escalation_status) {
      notesParts.push(`**Escalation Status:** ${notes.escalation_status}`);
    }

    if (notes.escalation_trigger) {
      notesParts.push(`**Escalation Trigger:** ${notes.escalation_trigger}`);
    }

    sections.push(notesParts.join('\n\n'));
  }

  if (content.approved_summary) {
    sections.push(`## Approved Customer Summary\n${content.approved_summary}`);
  }

  return sections.join('\n\n').trim();
}

export function parseJsonTicket(
  buffer: Buffer,
  filename: string,
  overrideMetadata?: Partial<DocumentMetadata>
): ParsedDocument {
  validateFileBasics(buffer, filename, ['.json']);
  const contentHash = computeSha256(buffer);
  const rawText = buffer.toString('utf-8');

  let parsedJson: TicketPayload;
  try {
    parsedJson = JSON.parse(rawText) as TicketPayload;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new MalformedDocumentError(`Invalid JSON syntax in '${filename}': ${message}`);
  }

  if (!parsedJson || typeof parsedJson !== 'object' || Array.isArray(parsedJson)) {
    throw new MalformedDocumentError(`JSON document '${filename}' must be an object.`);
  }

  const rawMetadata = parsedJson.metadata || {};
  const mergedMetadata = {
    ...rawMetadata,
    ...(overrideMetadata || {}),
  };

  const metadataResult = DocumentMetadataSchema.safeParse(mergedMetadata);
  if (!metadataResult.success) {
    const errorDetails = metadataResult.error.issues
      .map((i) => `${i.path.join('.') || 'root'}: ${i.message}`)
      .join('; ');
    throw new MalformedDocumentError(
      `Metadata validation failed for JSON ticket '${filename}': ${errorDetails}`,
      metadataResult.error.issues
    );
  }

  const content = parsedJson.content;
  if (!content || typeof content !== 'object') {
    throw new MalformedDocumentError(
      `Support ticket JSON '${filename}' is missing required 'content' object.`
    );
  }

  const metadata = metadataResult.data;
  const formattedContent = formatTicketToText(metadata, content);

  if (formattedContent.length === 0) {
    throw new MalformedDocumentError(
      `Support ticket JSON '${filename}' content yielded empty text.`
    );
  }

  return {
    document_id: metadata.document_id,
    title: metadata.title,
    filename,
    format: 'json',
    content: formattedContent,
    metadata,
    content_hash: contentHash,
    raw_data: content as Record<string, unknown>,
  };
}
