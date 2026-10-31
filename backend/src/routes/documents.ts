import { Router, Request, Response, NextFunction } from 'express';
import { ingestionService } from '../services/ingestionService';
import { DocumentMetadata } from '../types/document';
import { AppError } from '../middleware/errorHandler';
import { requireAuth } from '../middleware/auth';
import { evaluateDocumentAccess, SensitivityLevel } from '../types/identity';

const router = Router();

/**
 * All document management endpoints require an authenticated, active session.
 */
router.use('/documents', requireAuth);

/**
 * POST /api/documents/ingest
 * Ingests a new document or updates an existing document.
 * Accepts JSON payload with filename, content (plain text or base64), and optional override_metadata.
 */
router.post(
  '/documents/ingest',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { filename, content, override_metadata, is_base64 } = req.body;

      if (!filename || typeof filename !== 'string') {
        throw new AppError('Field \'filename\' is required and must be a string.', 400, 'INVALID_INPUT');
      }

      if (content === undefined || content === null) {
        throw new AppError('Field \'content\' is required.', 400, 'INVALID_INPUT');
      }

      let buffer: Buffer;
      if (Buffer.isBuffer(content)) {
        buffer = content;
      } else if (typeof content === 'string') {
        const ext = filename.split('.').pop()?.toLowerCase();
        const treatAsBase64 = is_base64 || ext === 'pdf';
        buffer = treatAsBase64 ? Buffer.from(content, 'base64') : Buffer.from(content, 'utf-8');
      } else {
        throw new AppError('Field \'content\' must be a string (raw text or base64) or a Buffer.', 400, 'INVALID_INPUT');
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
 */
router.get(
  '/documents',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;
      const tenantId = typeof req.query.tenant_id === 'string' ? req.query.tenant_id : undefined;
      const sensitivity = typeof req.query.sensitivity === 'string' ? req.query.sensitivity : undefined;

      const documents = await ingestionService.listDocuments({ tenantId, sensitivity });

      // Authoritatively filter documents against caller's identity context
      const authorizedDocuments = documents.filter((doc) => {
        return evaluateDocumentAccess(user, {
          tenant_id: (doc.metadata?.tenant_id as string) || 'global',
          allowed_groups: (doc.metadata?.allowed_groups as string[]) || [],
          sensitivity: (doc.metadata?.sensitivity as SensitivityLevel) || 'internal',
        }).allowed;
      });

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
 */
router.get(
  '/documents/jobs/:jobId',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
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

      const access = evaluateDocumentAccess(user, {
        tenant_id: (details.document.metadata?.tenant_id as string) || 'global',
        allowed_groups: (details.document.metadata?.allowed_groups as string[]) || [],
        sensitivity: (details.document.metadata?.sensitivity as SensitivityLevel) || 'internal',
      });

      if (!access.allowed) {
        // Do not expose document existence to unauthorized callers
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
 * Get source preview for citation resolution (authorized only).
 */
router.get(
  '/documents/:documentId/preview',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;
      const documentId = String(req.params.documentId);
      const details = await ingestionService.getDocumentById(documentId);

      if (!details) {
        throw new AppError(`Document '${documentId}' not found.`, 404, 'DOCUMENT_NOT_FOUND');
      }

      const access = evaluateDocumentAccess(user, {
        tenant_id: (details.document.metadata?.tenant_id as string) || 'global',
        allowed_groups: (details.document.metadata?.allowed_groups as string[]) || [],
        sensitivity: (details.document.metadata?.sensitivity as SensitivityLevel) || 'internal',
      });

      if (!access.allowed) {
        throw new AppError(`Document '${documentId}' not found.`, 404, 'DOCUMENT_NOT_FOUND');
      }

      res.status(200).json({
        success: true,
        data: {
          document_id: details.document.document_id,
          title: details.document.title,
          tenant_id: details.document.metadata?.tenant_id,
          sensitivity: details.document.metadata?.sensitivity,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/documents/:documentId/download
 * Download document content (authorized only).
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

      const access = evaluateDocumentAccess(user, {
        tenant_id: (details.document.metadata?.tenant_id as string) || 'global',
        allowed_groups: (details.document.metadata?.allowed_groups as string[]) || [],
        sensitivity: (details.document.metadata?.sensitivity as SensitivityLevel) || 'internal',
      });

      if (!access.allowed) {
        throw new AppError(`Document '${documentId}' not found.`, 404, 'DOCUMENT_NOT_FOUND');
      }

      res.status(200).json({
        success: true,
        message: `Download granted for '${documentId}'.`,
        filename: details.document.filename,
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
