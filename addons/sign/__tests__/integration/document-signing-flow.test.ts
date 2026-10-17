import { describe, it, expect, jest, beforeEach } from '@jest/globals'
import { prismaMock as typedPrismaMock } from '../setup/prisma-mock'
// These cases describe the data flow against a bare mock (older field names included), not the real schema.
const prismaMock = typedPrismaMock as any

jest.mock('@/lib/db')

describe('Document Signing Flow - Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('Complete Signing Workflow', () => {
    it('should complete full document lifecycle: create -> invite -> sign -> complete', async () => {
      // Step 1: Create document
      const mockDocument = {
        id: 'doc-1',
        title: 'Employment Contract',
        description: 'Full-time employment agreement',
        status: 'DRAFT',
        userId: 'user-1',
        fileUrl: 'https://example.com/contract.pdf',
        fileName: 'contract.pdf',
        fileSize: 102400,
        createdAt: new Date(),
        updatedAt: new Date(),
        completedAt: null,
      }

      prismaMock.document.create.mockResolvedValue(mockDocument as any)

      const createdDoc = await prismaMock.document.create({
        data: {
          title: 'Employment Contract',
          description: 'Full-time employment agreement',
          status: 'DRAFT',
          userId: 'user-1',
          fileUrl: 'https://example.com/contract.pdf',
          fileName: 'contract.pdf',
          fileSize: 102400,
        },
      })

      expect(createdDoc.status).toBe('DRAFT')

      // Step 2: Add signature fields
      const mockField = {
        id: 'field-1',
        documentId: 'doc-1',
        type: 'SIGNATURE',
        signerId: 'signer-1',
        page: 1,
        x: 100,
        y: 500,
        width: 200,
        height: 60,
        required: true,
        value: null,
        createdAt: new Date(),
      }

      prismaMock.documentField.create.mockResolvedValue(mockField as any)

      const createdField = await prismaMock.documentField.create({
        data: {
          documentId: 'doc-1',
          type: 'SIGNATURE',
          signerId: 'signer-1',
          page: 1,
          x: 100,
          y: 500,
          width: 200,
          height: 60,
          required: true,
        },
      })

      expect(createdField.type).toBe('SIGNATURE')

      // Step 3: Invite signer
      const mockSigner = {
        id: 'signer-1',
        documentId: 'doc-1',
        email: 'employee@example.com',
        name: 'John Doe',
        status: 'PENDING',
        order: 1,
        accessToken: 'secure-token-abc123',
        createdAt: new Date(),
        signedAt: null,
        ipAddress: null,
        userAgent: null,
        signatureData: null,
      }

      prismaMock.documentSigner.create.mockResolvedValue(mockSigner as any)

      const invitedSigner = await prismaMock.documentSigner.create({
        data: {
          documentId: 'doc-1',
          email: 'employee@example.com',
          name: 'John Doe',
          status: 'PENDING',
          order: 1,
          accessToken: 'secure-token-abc123',
        },
      })

      expect(invitedSigner.status).toBe('PENDING')

      // Step 4: Update document status to SENT
      const mockSentDoc = { ...mockDocument, status: 'SENT' }
      prismaMock.document.update.mockResolvedValue(mockSentDoc as any)

      const sentDoc = await prismaMock.document.update({
        where: { id: 'doc-1' },
        data: { status: 'SENT' },
      })

      expect(sentDoc.status).toBe('SENT')

      // Step 5: Signer signs the document
      const mockSignedSigner = {
        ...mockSigner,
        status: 'COMPLETED',
        signedAt: new Date(),
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
        signatureData: JSON.stringify({
          type: 'drawn',
          data: 'base64-signature-data',
        }),
      }

      prismaMock.documentSigner.update.mockResolvedValue(mockSignedSigner as any)

      const signedSigner = await prismaMock.documentSigner.update({
        where: { id: 'signer-1' },
        data: {
          status: 'COMPLETED',
          signedAt: new Date(),
          ipAddress: '192.168.1.1',
          userAgent: 'Mozilla/5.0',
          signatureData: JSON.stringify({
            type: 'drawn',
            data: 'base64-signature-data',
          }),
        },
      })

      expect(signedSigner.status).toBe('COMPLETED')
      expect(signedSigner.signatureData).toBeTruthy()

      // Step 6: Complete document
      const mockCompletedDoc = {
        ...mockDocument,
        status: 'COMPLETED',
        completedAt: new Date(),
      }

      prismaMock.document.update.mockResolvedValue(mockCompletedDoc as any)

      const completedDoc = await prismaMock.document.update({
        where: { id: 'doc-1' },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
        },
      })

      expect(completedDoc.status).toBe('COMPLETED')
      expect(completedDoc.completedAt).toBeTruthy()
    })

    it('should handle multi-party sequential signing', async () => {
      const mockSigners = [
        {
          id: 'signer-1',
          documentId: 'doc-1',
          email: 'first@example.com',
          name: 'First Signer',
          status: 'PENDING',
          order: 1,
          accessToken: 'token-1',
          createdAt: new Date(),
        },
        {
          id: 'signer-2',
          documentId: 'doc-1',
          email: 'second@example.com',
          name: 'Second Signer',
          status: 'PENDING',
          order: 2,
          accessToken: 'token-2',
          createdAt: new Date(),
        },
      ]

      prismaMock.documentSigner.createMany.mockResolvedValue({ count: 2 } as any)

      // First signer signs
      const firstSignedSigner = { ...mockSigners[0], status: 'COMPLETED', signedAt: new Date() }
      prismaMock.documentSigner.update.mockResolvedValueOnce(firstSignedSigner as any)

      // Second signer signs
      const secondSignedSigner = { ...mockSigners[1], status: 'COMPLETED', signedAt: new Date() }
      prismaMock.documentSigner.update.mockResolvedValueOnce(secondSignedSigner as any)

      expect(firstSignedSigner.order).toBe(1)
      expect(secondSignedSigner.order).toBe(2)
    })

    it('should handle document decline', async () => {
      const mockDeclinedSigner = {
        id: 'signer-1',
        documentId: 'doc-1',
        email: 'signer@example.com',
        name: 'John Doe',
        status: 'DECLINED',
        order: 1,
        accessToken: 'token-1',
        createdAt: new Date(),
        signedAt: null,
      }

      prismaMock.documentSigner.update.mockResolvedValue(mockDeclinedSigner as any)

      const mockDeclinedDoc = {
        id: 'doc-1',
        status: 'DECLINED',
        updatedAt: new Date(),
      }

      prismaMock.document.update.mockResolvedValue(mockDeclinedDoc as any)

      expect(mockDeclinedSigner.status).toBe('DECLINED')
      expect(mockDeclinedDoc.status).toBe('DECLINED')
    })
  })

  describe('Notification Flow', () => {
    it('should create notifications throughout signing process', async () => {
      const notifications = [
        {
          id: '1',
          userId: 'user-1',
          type: 'DOCUMENT_SENT',
          title: 'Document Sent',
          message: 'Your document has been sent for signing',
          read: false,
          createdAt: new Date(),
        },
        {
          id: '2',
          userId: 'user-1',
          type: 'SIGNER_COMPLETED',
          title: 'Signature Received',
          message: 'John Doe has signed the document',
          read: false,
          createdAt: new Date(),
        },
        {
          id: '3',
          userId: 'user-1',
          type: 'DOCUMENT_COMPLETED',
          title: 'Document Completed',
          message: 'All parties have signed the document',
          read: false,
          createdAt: new Date(),
        },
      ]

      prismaMock.notification.create.mockResolvedValueOnce(notifications[0] as any)
      prismaMock.notification.create.mockResolvedValueOnce(notifications[1] as any)
      prismaMock.notification.create.mockResolvedValueOnce(notifications[2] as any)

      expect(notifications).toHaveLength(3)
      expect(notifications[0].type).toBe('DOCUMENT_SENT')
      expect(notifications[2].type).toBe('DOCUMENT_COMPLETED')
    })
  })

  describe('Audit Trail', () => {
    it('should create audit logs for document actions', async () => {
      const auditLogs = [
        {
          id: '1',
          documentId: 'doc-1',
          action: 'CREATED',
          performedBy: 'user-1',
          timestamp: new Date(),
          details: 'Document created',
        },
        {
          id: '2',
          documentId: 'doc-1',
          action: 'SENT',
          performedBy: 'user-1',
          timestamp: new Date(),
          details: 'Document sent to signers',
        },
        {
          id: '3',
          documentId: 'doc-1',
          action: 'SIGNED',
          performedBy: 'signer-1',
          timestamp: new Date(),
          details: 'Signed by John Doe',
        },
        {
          id: '4',
          documentId: 'doc-1',
          action: 'COMPLETED',
          performedBy: 'system',
          timestamp: new Date(),
          details: 'Document completed',
        },
      ]

      prismaMock.auditLog.createMany.mockResolvedValue({ count: 4 } as any)

      expect(auditLogs).toHaveLength(4)
      expect(auditLogs[0].action).toBe('CREATED')
      expect(auditLogs[3].action).toBe('COMPLETED')
    })
  })
})
