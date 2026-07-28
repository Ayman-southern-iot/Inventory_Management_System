import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Without this, a component from one test is still mounted during the next and queries
// find two of everything — the classic order-dependent flake.
afterEach(cleanup);
