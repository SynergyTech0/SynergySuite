import { describe, it, expect, jest, beforeEach } from '@jest/globals'

// Mock the db import FIRST before any other imports
jest.mock('@/lib/db', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
    },
    notification: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  },
}))

import { prisma } from '@/lib/db'
const prismaMock = prisma as any

describe('Notification System', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('createNotification', () => {
    it('should create a document sent notification', async () => {
      const mockUser = {
        id: 'user-1',
        email: 'test@example.com',
      }

      const mockNotification = {
        id: '1',
        userId: 'user-1',
        email: 'test@example.com',
        type: 'DOCUMENT_SENT',
        subject: 'Document Sent',
        message: 'Your document has been sent for signature',
        read: false,
        status: 'SENT',
        createdAt: new Date(),
        documentId: 'doc-1',
        redirectURL: null,
      }

      prismaMock.user.findUnique.mockResolvedValue(mockUser as any)
      prismaMock.notification.create.mockResolvedValue(mockNotification as any)

      const { createNotification } = await import('@/lib/notifications')

      const result = await createNotification(
        'test@example.com',
        'Document Sent',
        'Your document has been sent for signature',
        'DOCUMENT_SENT',
        'user-1',
        'doc-1'
      )

      expect(prismaMock.notification.create).toHaveBeenCalledWith({
        data: {
          email: 'test@example.com',
          userId: 'user-1',
          subject: 'Document Sent',
          message: 'Your document has been sent for signature',
          type: 'DOCUMENT_SENT',
          status: 'SENT',
          documentId: 'doc-1',
          redirectURL: undefined,
        },
      })
      expect(result).toEqual(mockNotification)
    })

    it('should create a document completed notification', async () => {
      const mockUser = {
        id: 'user-1',
        email: 'test@example.com',
      }

      const mockNotification = {
        id: '2',
        userId: 'user-1',
        email: 'test@example.com',
        type: 'DOCUMENT_COMPLETED',
        subject: 'Document Completed',
        message: 'All parties have signed the document',
        read: false,
        status: 'SENT',
        createdAt: new Date(),
        documentId: 'doc-2',
        redirectURL: null,
      }

      prismaMock.user.findUnique.mockResolvedValue(mockUser as any)
      prismaMock.notification.create.mockResolvedValue(mockNotification as any)

      const { createNotification } = await import('@/lib/notifications')

      const result = await createNotification(
        'test@example.com',
        'Document Completed',
        'All parties have signed the document',
        'DOCUMENT_COMPLETED',
        'user-1',
        'doc-2'
      )

      expect(result).toEqual(mockNotification)
    })
  })

  describe('retrieveNotifications', () => {
    it('should retrieve all notifications for a user', async () => {
      const mockNotifications = [
        {
          id: '1',
          type: 'DOCUMENT_SENT',
          subject: 'Document Sent',
          message: 'Document sent',
          read: false,
          createdAt: new Date(),
          documentId: 'doc-1',
          redirectURL: null,
        },
        {
          id: '2',
          type: 'DOCUMENT_COMPLETED',
          subject: 'Document Completed',
          message: 'Document completed',
          read: true,
          createdAt: new Date(),
          documentId: 'doc-2',
          redirectURL: null,
        },
      ]

      prismaMock.notification.findMany.mockResolvedValue(mockNotifications as any)

      const { retrieveNotifications } = await import('@/lib/notifications')

      const result = await retrieveNotifications('test@example.com')

      expect(prismaMock.notification.findMany).toHaveBeenCalled()
      expect(result).toEqual(mockNotifications)
    })

    it('should retrieve only unread notifications', async () => {
      const mockUnreadNotifications = [
        {
          id: '1',
          type: 'DOCUMENT_SENT',
          subject: 'Document Sent',
          message: 'Document sent',
          read: false,
          createdAt: new Date(),
          documentId: 'doc-1',
          redirectURL: null,
        },
      ]

      prismaMock.notification.findMany.mockResolvedValue(mockUnreadNotifications as any)

      const { retrieveNotifications } = await import('@/lib/notifications')

      const result = await retrieveNotifications('test@example.com', 1, 99999, undefined, undefined, true)

      expect(prismaMock.notification.findMany).toHaveBeenCalled()
      expect(result).toEqual(mockUnreadNotifications)
    })
  })

  describe('markNotificationAsRead', () => {
    it('should mark a notification as read', async () => {
      const mockNotification = {
        id: '1',
        email: 'test@example.com',
        type: 'DOCUMENT_SENT',
        subject: 'Document Sent',
        message: 'Document sent',
        read: false,
        createdAt: new Date(),
        documentId: 'doc-1',
      }

      prismaMock.notification.findUnique.mockResolvedValue(mockNotification as any)
      prismaMock.notification.update.mockResolvedValue({ ...mockNotification, read: true } as any)

      const { markNotificationAsRead } = await import('@/lib/notifications')

      await markNotificationAsRead('1', 'test@example.com')

      expect(prismaMock.notification.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: { read: true },
      })
    })
  })

  describe('deleteNotification', () => {
    it('should delete a notification', async () => {
      const mockNotification = {
        id: '1',
        email: 'test@example.com',
      }

      prismaMock.notification.findUnique.mockResolvedValue(mockNotification as any)
      prismaMock.notification.delete.mockResolvedValue({} as any)

      const { deleteNotification } = await import('@/lib/notifications')

      await deleteNotification('1', 'test@example.com')

      expect(prismaMock.notification.delete).toHaveBeenCalledWith({
        where: { id: '1' },
      })
    })
  })
})
