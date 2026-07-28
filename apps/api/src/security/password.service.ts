import { Injectable } from '@nestjs/common';
import { hash, verify, Algorithm } from '@node-rs/argon2';

/**
 * Argon2id parameters. These are cost constants of the algorithm rather than business
 * configuration — nobody tunes them per environment, and a weaker value in dev than in prod
 * would mean dev hashes that production silently accepts. They live here, named, as the
 * sanctioned kind of constant (rules/10-no-hardcoding.md "Exceptions").
 *
 * OWASP Password Storage Cheat Sheet, argon2id: m=19 MiB, t=2, p=1 minimum.
 */
const ARGON2_MEMORY_COST_KIB = 19_456;
const ARGON2_TIME_COST = 2;
const ARGON2_PARALLELISM = 1;

@Injectable()
export class PasswordService {
  async hash(plaintext: string): Promise<string> {
    return hash(plaintext, {
      algorithm: Algorithm.Argon2id,
      memoryCost: ARGON2_MEMORY_COST_KIB,
      timeCost: ARGON2_TIME_COST,
      parallelism: ARGON2_PARALLELISM,
    });
  }

  /**
   * Returns false rather than throwing on a malformed hash: a corrupt row must fail the login,
   * not 500 the endpoint and tell the caller that this particular account is special.
   */
  async verify(passwordHash: string, plaintext: string): Promise<boolean> {
    try {
      return await verify(passwordHash, plaintext);
    } catch {
      return false;
    }
  }
}
