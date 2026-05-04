import { authenticateRequest } from './requireAuth.js';
import {
  createOrUpdateWalletSession,
  getCurrentAuthUser,
  revokeSession
} from './repository.js';

export function createAuthService(db, config) {
  return {
    async authenticate(request) {
      const result = await authenticateRequest(request, config, db);
      if (result.ok) request.auth = result;
      return result;
    },
    createOrUpdateWalletSession(input) {
      return createOrUpdateWalletSession(db, input);
    },
    getCurrentUser(input) {
      return getCurrentAuthUser(db, input);
    },
    logout(input) {
      return revokeSession(db, input);
    }
  };
}
