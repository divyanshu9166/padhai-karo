import { describe, expect, it } from 'vitest';

import { validateProductionEndpoints } from './endpointSecurity';

describe('validateProductionEndpoints', () => {
    it('allows local HTTP endpoints during development', () => {
        expect(() => validateProductionEndpoints('http://10.0.2.2:3000/api', 'ws://10.0.2.2:3000/ws/community', true)).not.toThrow();
    });

    it('requires HTTPS and WSS in production', () => {
        expect(() => validateProductionEndpoints('http://api.example.com/api', 'ws://api.example.com/ws/community', false)).toThrow(/HTTPS/);
        expect(() => validateProductionEndpoints('https://api.example.com/api', 'ws://api.example.com/ws/community', false)).toThrow(/WSS/);
    });

    it('accepts secure production endpoints', () => {
        expect(() => validateProductionEndpoints('https://api.example.com/api', 'wss://api.example.com/ws/community', false)).not.toThrow();
    });
});
