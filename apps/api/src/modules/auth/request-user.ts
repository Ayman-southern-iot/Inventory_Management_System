import type { Role } from '@ims/shared';

/**
 * The only source of actor identity in the whole backend (rules/20-backend.md).
 * A user id arriving in a request body is data, never the actor.
 */
export interface RequestUser {
  id: string;
  email: string;
  roles: Role[];
}

export interface AccessTokenPayload {
  sub: string;
  email: string;
  roles: Role[];
  /** Token family, so a refresh rotation can invalidate the access token's lineage. */
  fid: string;
}

export interface RefreshTokenPayload {
  sub: string;
  /** Refresh token row id, so the server can find and rotate exactly this token. */
  jti: string;
  fid: string;
}
