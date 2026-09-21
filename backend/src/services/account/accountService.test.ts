import { describe, expect, it, vi } from 'vitest';

import { DELETE_CONFIRMATION, deleteAccountHandler } from './accountService';

const auth = { user: { id: 'user-1', passwordHash: 'stored-hash' } } as never;

function request(body: unknown): Request {
    return new Request('http://test.local/api/account/delete', { method: 'DELETE', body: JSON.stringify(body) });
}

describe('deleteAccountHandler', () => {
    it('requires the irreversible confirmation phrase', async () => {
        const remove = vi.fn();
        const response = await deleteAccountHandler(request({ confirmation: 'delete', password: 'Password1' }), auth, {
            prisma: { user: { delete: remove } },
            verifyPassword: vi.fn(),
        });

        expect(response.status).toBe(422);
        expect(remove).not.toHaveBeenCalled();
    });

    it('requires the current password', async () => {
        const remove = vi.fn();
        const response = await deleteAccountHandler(request({ confirmation: DELETE_CONFIRMATION, password: 'wrong' }), auth, {
            prisma: { user: { delete: remove } },
            verifyPassword: vi.fn().mockResolvedValue(false),
        });

        expect(response.status).toBe(403);
        expect(remove).not.toHaveBeenCalled();
    });

    it('deletes only the authenticated user after both confirmations', async () => {
        const remove = vi.fn().mockResolvedValue({ id: 'user-1' });
        const response = await deleteAccountHandler(request({ confirmation: DELETE_CONFIRMATION, password: 'Password1' }), auth, {
            prisma: { user: { delete: remove } },
            verifyPassword: vi.fn().mockResolvedValue(true),
        });

        expect(response.status).toBe(204);
        expect(remove).toHaveBeenCalledWith({ where: { id: 'user-1' } });
    });
});
