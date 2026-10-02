import { vi, describe, it, expect, beforeEach } from 'vitest'

// Mock mongodb to avoid MONGODB_URI requirement in test environment
const mockFindOne = vi.fn()
const mockFind = vi.fn()
const mockCollection = vi.fn(() => ({
  findOne: mockFindOne,
  find: mockFind,
}))
const mockDb = { collection: mockCollection }

vi.mock('./mongodb', () => ({
  getDatabase: vi.fn(() => Promise.resolve(mockDb)),
}))

import {
  ac,
  roles,
  canCreateCrag,
  canEditCrag,
  canDeleteCrag,
  canManagePermissions,
  canAccessEditor,
  getEditableCragIds,
} from './permissions'

beforeEach(() => {
  vi.clearAllMocks()
  mockFindOne.mockResolvedValue(null)
  mockCollection.mockReturnValue({
    findOne: mockFindOne,
    find: mockFind,
  })
})

describe('permissions', () => {
  describe('AC definitions', () => {
    it('should export ac with custom statements', () => {
      expect(ac).toBeDefined()
      expect(ac.statements).toBeDefined()
      expect(ac.statements.editor).toEqual(['access'])
      expect(ac.statements.crag).toEqual(['create', 'update', 'delete'])
      expect(ac.statements.route).toEqual(['create', 'update', 'delete'])
      expect(ac.statements.face).toEqual(['upload', 'rename', 'delete'])
      expect(ac.statements.beta).toEqual(['approve', 'delete'])
      // inherited from defaultStatements
      expect(ac.statements.user).toBeDefined()
      expect(ac.statements.session).toBeDefined()
    })

    it('should export roles for admin and user', () => {
      expect(roles.admin).toBeDefined()
      expect(roles.user).toBeDefined()
    })
  })

  describe('canCreateCrag', () => {
    it('should allow admin to create crags', () => {
      expect(canCreateCrag('admin')).toBe(true)
    })

    it('should deny regular user from creating crags', () => {
      expect(canCreateCrag('user')).toBe(false)
    })
  })

  // ============ S1: 异步权限函数测试 ============

  describe('canEditCrag', () => {
    it('should allow admin without DB query', async () => {
      const result = await canEditCrag('user1', 'crag1', 'admin')
      expect(result).toBe(true)
      expect(mockCollection).not.toHaveBeenCalled()
    })

    it('should allow user with crag_permission', async () => {
      mockFindOne.mockResolvedValueOnce({ userId: 'user1', cragId: 'crag1', role: 'manager' })
      const result = await canEditCrag('user1', 'crag1', 'user')
      expect(result).toBe(true)
      expect(mockCollection).toHaveBeenCalledWith('crag_permissions')
      expect(mockFindOne).toHaveBeenCalledWith({ userId: 'user1', cragId: 'crag1' })
    })

    it('lets a canonical login use a historical mixed-case ObjectId grant', async () => {
      const userId = 'abcdef1234567890abcdef12'
      const storedId = 'AbCdEf1234567890aBcDeF12'
      mockFindOne.mockImplementationOnce(({ userId: filter, cragId }) => {
        const matches = typeof filter === 'string' ? filter === storedId : filter.$in.some((value: string | RegExp) =>
          value instanceof RegExp ? value.test(storedId) : value === storedId)
        return Promise.resolve(matches && cragId === 'crag1' ? { userId: storedId, cragId } : null)
      })
      expect(await canEditCrag(userId, 'crag1', 'user')).toBe(true)
      expect(mockCollection).not.toHaveBeenCalledWith('crags')
    })

    it('should fallback to createdBy when no permission record', async () => {
      // First findOne (crag_permissions) returns null
      mockFindOne.mockResolvedValueOnce(null)
      // Second findOne (crags) returns a match
      mockFindOne.mockResolvedValueOnce({ _id: 'abc' })

      const result = await canEditCrag('user1', 'crag1', 'user')
      expect(result).toBe(true)
      // Should query both collections
      expect(mockCollection).toHaveBeenCalledWith('crag_permissions')
      expect(mockCollection).toHaveBeenCalledWith('crags')
      expect(mockFindOne).toHaveBeenCalledWith(
        { _id: 'crag1', createdBy: 'user1' }, { projection: { _id: 1 } },
      )
    })

    it('should deny user without permission or createdBy', async () => {
      mockFindOne.mockResolvedValueOnce(null) // crag_permissions
      mockFindOne.mockResolvedValueOnce(null) // crags createdBy

      const result = await canEditCrag('user1', 'crag1', 'user')
      expect(result).toBe(false)
    })
  })

  describe('canDeleteCrag', () => {
    it('should allow admin without DB query', async () => {
      const result = await canDeleteCrag('user1', 'crag1', 'admin')
      expect(result).toBe(true)
      expect(mockCollection).not.toHaveBeenCalled()
    })

    it('should deny non-admin without DB query', async () => {
      const result = await canDeleteCrag('user1', 'crag1', 'user')
      expect(result).toBe(false)
      expect(mockCollection).not.toHaveBeenCalled()
    })
  })

  describe('canManagePermissions', () => {
    it('should allow admin without DB query', async () => {
      const result = await canManagePermissions('user1', 'crag1', 'admin')
      expect(result).toBe(true)
      expect(mockCollection).not.toHaveBeenCalled()
    })

    it('should deny non-admin without DB query', async () => {
      const result = await canManagePermissions('user1', 'crag1', 'user')
      expect(result).toBe(false)
      expect(mockCollection).not.toHaveBeenCalled()
    })
  })

  describe('canAccessEditor', () => {
    it('should allow admin without DB query', async () => {
      const result = await canAccessEditor('user1', 'admin')
      expect(result).toBe(true)
      expect(mockCollection).not.toHaveBeenCalled()
    })

    it('allows a manager when their crag still exists', async () => {
      mockFind.mockReturnValueOnce({ toArray: vi.fn().mockResolvedValue([{ cragId: 'crag1' }]) })
      mockFind.mockReturnValueOnce({ toArray: vi.fn().mockResolvedValue([{ _id: 'crag1' }]) })
      const result = await canAccessEditor('user1', 'user')
      expect(result).toBe(true)
      expect(mockFind).toHaveBeenCalledWith({ userId: 'user1' })
    })

    it('denies a user without grants or owned crags', async () => {
      mockFind.mockReturnValueOnce({ toArray: vi.fn().mockResolvedValue([]) })
      mockFind.mockReturnValueOnce({ toArray: vi.fn().mockResolvedValue([]) })
      const result = await canAccessEditor('user1', 'user')
      expect(result).toBe(false)
    })

    it('allows a creator to enter even when the manager grant is missing', async () => {
      mockFind.mockReturnValueOnce({ toArray: vi.fn().mockResolvedValue([]) })
      mockFind.mockReturnValueOnce({ toArray: vi.fn().mockResolvedValue([{ _id: 'owned-crag' }]) })
      expect(await canAccessEditor('user1', 'user')).toBe(true)
    })

    it('denies access when the only permission refers to a deleted crag', async () => {
      mockFind.mockReturnValueOnce({ toArray: vi.fn().mockResolvedValue([{ cragId: 'deleted-crag' }]) })
      mockFind.mockReturnValueOnce({ toArray: vi.fn().mockResolvedValue([]) })
      expect(await canAccessEditor('user1', 'user')).toBe(false)
    })
  })

  describe('getEditableCragIds', () => {
    it('should return "all" for admin', async () => {
      const result = await getEditableCragIds('user1', 'admin')
      expect(result).toBe('all')
      expect(mockCollection).not.toHaveBeenCalled()
    })

    it('should return cragIds for user with permissions', async () => {
      mockFind.mockReturnValueOnce({
        toArray: vi.fn().mockResolvedValueOnce([
          { userId: 'user1', cragId: 'crag1', role: 'manager' },
          { userId: 'user1', cragId: 'crag2', role: 'manager' },
        ]),
      })
      mockFind.mockReturnValueOnce({ toArray: vi.fn().mockResolvedValueOnce([{ _id: 'crag1' }, { _id: 'crag2' }]) })
      const result = await getEditableCragIds('user1', 'user')
      expect(result).toEqual(['crag1', 'crag2'])
    })

    it('includes existing crags granted under historical ObjectId spelling', async () => {
      const userId = 'abcdef1234567890abcdef12'
      const storedId = 'AbCdEf1234567890aBcDeF12'
      mockFind.mockImplementationOnce(({ userId: filter }) => {
        const matches = typeof filter === 'string' ? filter === storedId : filter.$in.some((value: string | RegExp) =>
          value instanceof RegExp ? value.test(storedId) : value === storedId)
        return { toArray: async () => matches ? [{ userId: storedId, cragId: 'crag1' }] : [] }
      })
      mockFind.mockImplementationOnce(({ $or }) => ({
        toArray: async () => $or[0]._id.$in.includes('crag1') ? [{ _id: 'crag1' }] : [],
      }))
      expect(await getEditableCragIds(userId, 'user')).toEqual(['crag1'])
    })

    it('should return empty array for user without permissions', async () => {
      mockFind.mockReturnValueOnce({
        toArray: vi.fn().mockResolvedValueOnce([]),
      })
      mockFind.mockReturnValueOnce({ toArray: vi.fn().mockResolvedValueOnce([]) })
      const result = await getEditableCragIds('user1', 'user')
      expect(result).toEqual([])
    })

    it('includes owned crags and excludes dangling grants from the editable list', async () => {
      mockFind.mockReturnValueOnce({ toArray: vi.fn().mockResolvedValueOnce([{ cragId: 'missing-crag' }]) })
      mockFind.mockReturnValueOnce({ toArray: vi.fn().mockResolvedValueOnce([{ _id: 'owned-crag' }, { _id: 'owned-crag' }]) })
      expect(await getEditableCragIds('creator', 'user')).toEqual(['owned-crag'])
      expect(mockFind).toHaveBeenCalledWith({
        $or: [{ _id: { $in: ['missing-crag'] } }, { createdBy: 'creator' }],
      }, { projection: { _id: 1 } })
    })
  })
})
