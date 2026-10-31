import { Router, Request, Response, NextFunction } from 'express';
import { ingestionService } from '../services/ingestionService';
import { authorizationService } from '../services/authorizationService';
import { DocumentMetadata, DocumentRecord } from '../types/document';
import { AppError } from '../middleware/errorHandler';
import { requireAuth } from '../middleware/auth';
import { SensitivityLevel } from '../types/identity';

const router = Router();

/**
 * All document management and citation endpoints require an authenticated, active session.
 */
router.use('/documents', requireAuth);
router.use('/citations', requireAuth);

/**
 * Helper to consistently extract tenant, group, and sensitivity metadata from document records.
 */
function extractDocumentResource(doc: DocumentRecord | { metadata?: Record<string, unknown> }): {
  tenant_id: string;
  allowed_groups: string[];
  sensitivity: SensitivityLevel;
} {
  const meta = (doc.metadata || {}) as Record<string, unknown>;
  return {
    tenant_id: (meta.tenant_id as string) || 'global',
    allowed_groups: (meta.allowed_groups as string[]) || (meta.authorized_groups as string[]) || [],
    sensitivity: (meta.sensitivity as SensitivityLevel) || 'internal',
  };
}

/**
 * POST /api/documents/ingest
 * Ingests a new document or updates an existing document.
 * Accepts JSON payload with filename, content (plain text or base64), and optional override_metadata.
 */
router.post(
  '/documents/ingest',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;
      const { filename, content, override_metadata, is_base64 } = req.body;

      const ingestAuthz = authorizationService.canIngest(
        user,
        override_metadata?.tenant_id as string | undefined
      );
      if (!ingestAuthz.allowed) {
        throw new AppError(ingestAuthz.reason || 'Ingestion not permitted.', 403, 'FORBIDDEN');
      }

      if (!filename || typeof filename !== 'string') {
        throw new AppError("Field 'filename' is required and must be a string.", 400, 'INVALID_INPUT');
      }

      if (content === undefined || content === null) {
        throw new AppError("Field 'content' is required.", 400, 'INVALID_INPUT');
      }

      let buffer: Buffer;
      if (Buffer.isBuffer(content)) {
        buffer = content;
      } else if (typeof content === 'string') {
        const ext = filename.split('.').pop()?.toLowerCase();
        const treatAsBase64 = is_base64 || ext === 'pdf';
        buffer = treatAsBase64 ? Buffer.from(content, 'base64') : Buffer.from(content, 'utf-8');
      } else {
        throw new AppError("Field 'content' must be a string (raw text or base64) or a Buffer.", 400, 'INVALID_INPUT');
      }

      const result = await ingestionService.ingestDocument({
        filename,
        buffer,
        overrideMetadata: override_metadata as Partial<DocumentMetadata> | undefined,
      });

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/documents
 * List all registered documents permitted for the caller.
 * Filtered by tenant scope, sensitivity clearance, and group membership.
 */
router.get(
  '/documents',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;
      const requestedTenant = typeof req.query.tenant_id === 'string' ? req.query.tenant_id : undefined;
      const sensitivity = typeof req.query.sensitivity === 'string' ? req.query.sensitivity : undefined;

      // Restrict caller tenant scope if query parameter requested
      if (requestedTenant) {
        const effective = authorizationService.getEffectiveTenantScope(user, requestedTenant);
        if (effective.length === 0) {
          // Caller does not have access to requested tenant; return empty list safely
          res.status(200).json({
            success: true,
            data: [],
            total: 0,
          });
          return;
        }
      }

      const documents = await ingestionService.listDocuments({ tenantId: requestedTenant, sensitivity });

      // Authoritatively filter documents against caller's identity context via central authorization service
      const authorizedDocuments = authorizationService.filterPermittedDocuments(user, documents);

      res.status(200).json({
        success: true,
        data: authorizedDocuments,
        total: authorizedDocuments.length,
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/documents/jobs/:jobId
 * Get status and diagnostic details of an ingestion job.
 * Only internal employees can access ingestion job diagnostics.
 */
router.get(
  '/documents/jobs/:jobId',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;
      if (user.user_type === 'customer_user') {
        throw new AppError(`Ingestion job '${req.params.jobId}' not found.`, 404, 'JOB_NOT_FOUND');
      }

      const jobId = String(req.params.jobId);
      const job = await ingestionService.getIngestionJob(jobId);

      if (!job) {
        throw new AppError(`Ingestion job '${jobId}' not found.`, 404, 'JOB_NOT_FOUND');
      }

      res.status(200).json({
        success: true,
        data: job,
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/documents/:documentId
 * Get a specific document and its version history (authorized only).
 * If caller is not authorized, returns 404 DOCUMENT_NOT_FOUND to avoid document existence probing.
 */
router.get(
  '/documents/:documentId',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;
      const documentId = String(req.params.documentId);
      const details = await ingestionService.getDocumentById(documentId);

      if (!details) {
        throw new AppError(`Document '${documentId}' not found.`, 404, 'DOCUMENT_NOT_FOUND');
      }

      const access = authorizationService.authorizeDocument(
        user,
        extractDocumentResource(details.document),
        'read:document'
      );

      if (!access.allowed) {
        // Uniform 404 prevents document existence enumeration
        throw new AppError(`Document '${documentId}' not found.`, 404, 'DOCUMENT_NOT_FOUND');
      }

      res.status(200).json({
        success: true,
        data: details,
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/documents/:documentId/preview
 * Get source preview for citation resolution or document preview (authorized only).
 * If ?chunk_index=N is specified, returns the specific chunk passage.
 * If caller is unauthorized, returns 404 DOCUMENT_NOT_FOUND to avoid metadata/existence leakage.
 */
router.get(
  '/documents/:documentId/preview',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;
      const documentId = String(req.params.documentId);
      const chunkIndexQuery = req.query.chunk_index;

      const details = await ingestionService.getDocumentById(documentId);

      if (!details) {
        throw new AppError(`Document '${documentId}' not found.`, 404, 'DOCUMENT_NOT_FOUND');
      }

      const docResource = extractDocumentResource(details.document);
      const access = authorizationService.authorizeDocument(user, docResource, 'preview:document');

      if (!access.allowed) {
        throw new AppError(`Document '${documentId}' not found.`, 404, 'DOCUMENT_NOT_FOUND');
      }

      // If chunk_index is requested, return specific chunk passage
      if (chunkIndexQuery !== undefined) {
        const chunkIndex = parseInt(String(chunkIndexQuery), 10);
        if (isNaN(chunkIndex)) {
          throw new AppError("Query parameter 'chunk_index' must be an integer.", 400, 'INVALID_INPUT');
        }

        const chunkData = await ingestionService.getDocumentChunk(documentId, chunkIndex);
        if (!chunkData) {
          throw new AppError(`Citation for document '${documentId}' at index ${chunkIndex} not found.`, 404, 'DOCUMENT_NOT_FOUND');
        }

        const chunkMeta = (chunkData.chunk.metadata || {}) as Record<string, unknown>;
        const chunkSens = (chunkMeta.sensitivity as SensitivityLevel) || docResource.sensitivity;
        if (chunkSens === 'restricted' && !authorizationService.hasRestrictedClearance(user)) {
          throw new AppError(`Document '${documentId}' not found.`, 404, 'DOCUMENT_NOT_FOUND');
        }

        res.status(200).json({
          success: true,
          data: {
            document_id: details.document.document_id,
            title: details.document.title,
            tenant_id: docResource.tenant_id,
            sensitivity: chunkSens,
            chunk_index: chunkData.chunk.chunk_index,
            snippet: chunkData.chunk.content,
            section_heading: chunkMeta.section_heading || undefined,
            source_location: chunkMeta.source_location || undefined,
          },
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: {
          document_id: details.document.document_id,
          title: details.document.title,
          tenant_id: docResource.tenant_id,
          sensitivity: docResource.sensitivity,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * Core handler for citation resolution.
 * Reusable between /api/documents/:documentId/citations/:chunkIndex and /api/citations/:documentId/:chunkIndex
 */
async function handleCitationResolution(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = req.user!;
    const documentId = String(req.params.documentId);
    const chunkIndex = parseInt(String(req.params.chunkIndex), 10);

    if (isNaN(chunkIndex)) {
      throw new AppError("Parameter 'chunkIndex' must be an integer.", 400, 'INVALID_INPUT');
    }

    const chunkData = await ingestionService.getDocumentChunk(documentId, chunkIndex);
    if (!chunkData) {
      throw new AppError(`Citation for '${documentId}' not found.`, 404, 'DOCUMENT_NOT_FOUND');
    }

    const docResource = extractDocumentResource(chunkData.document);
    const chunkMeta = (chunkData.chunk.metadata || {}) as Record<string, unknown>;
    const sensitivity = (chunkMeta.sensitivity as SensitivityLevel) || docResource.sensitivity;
    const allowedGroups =
      (chunkMeta.allowed_groups as string[]) ||
      (chunkMeta.authorized_groups as string[]) ||
      docResource.allowed_groups;
    const tenantId = (chunkMeta.tenant_id as string) || docResource.tenant_id;
    const disclosurePolicy =
      (chunkMeta.disclosure_policy as string) ||
      (chunkData.document.metadata?.disclosure_policy as string) ||
      'internal_only';

    const access = authorizationService.can(user, 'read:citation', {
      type: 'citation',
      document_id: documentId,
      tenant_id: tenantId,
      allowed_groups: allowedGroups,
      sensitivity,
      disclosure_policy: disclosurePolicy as any,
    });

    if (!access.allowed) {
      // Uniform 404 prevents citation and document existence enumeration
      throw new AppError(`Citation for '${documentId}' not found.`, 404, 'DOCUMENT_NOT_FOUND');
    }

    res.status(200).json({
      success: true,
      data: {
        document_id: documentId,
        title: chunkData.document.title,
        chunk_index: chunkData.chunk.chunk_index,
        snippet: chunkData.chunk.content,
        section_heading: chunkMeta.section_heading || undefined,
        source_location: chunkMeta.source_location || undefined,
        tenant_id: tenantId,
        sensitivity,
        disclosure_policy: disclosurePolicy,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/documents/:documentId/citations/:chunkIndex
 * Direct citation resolution: returns verified evidence passage, heading, and provenance metadata (authorized only).
 */
router.get('/documents/:documentId/citations/:chunkIndex', handleCitationResolution);

/**
 * GET /api/citations/:documentId/:chunkIndex
 * Direct REST citation resolution endpoint (authorized only).
 */
router.get('/citations/:documentId/:chunkIndex', handleCitationResolution);

/**
 * GET /api/documents/:documentId/download
 * Download document content (authorized only).
 * Customer users cannot download restricted or confidential documents.
 * Unauthorized requests return 404 DOCUMENT_NOT_FOUND.
 */
router.get(
  '/documents/:documentId/download',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;
      const documentId = String(req.params.documentId);
      const details = await ingestionService.getDocumentById(documentId);

      if (!details) {
        throw new AppError(`Document '${documentId}' not found.`, 404, 'DOCUMENT_NOT_FOUND');
      }

      const access = authorizationService.authorizeDocument(
        user,
        extractDocumentResource(details.document),
        'download:document'
      );

      if (!access.allowed) {
        // Uniform 404 prevents existence enumeration
        throw new AppError(`Document '${documentId}' not found.`, 404, 'DOCUMENT_NOT_FOUND');
      }

      res.status(200).json({
        success: true,
        data: {
          document_id: details.document.document_id,
          title: details.document.title,
          filename: details.document.filename,
          format: details.document.format,
          current_version: details.document.current_version,
          metadata: details.document.metadata,
        },
        message: `Download granted for '${documentId}'.`,
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
