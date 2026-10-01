import { wait } from "@/lib/async";
import type { FileNode, FsService } from "./fs";

/** Demo content only — the same fictional files are shown for every project. */
const CONTENTS: Record<string, string> = {
  "src/auth/login.ts": `import { createSession } from "./session";
import { verifyPassword } from "../lib/crypto";
import { findUserByEmail } from "../db/users";

export interface LoginInput {
  email: string;
  password: string;
}

export async function login({ email, password }: LoginInput) {
  const user = await findUserByEmail(email.trim().toLowerCase());
  if (!user) {
    throw new AuthError("invalid_credentials");
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    throw new AuthError("invalid_credentials");
  }

  return createSession(user.id);
}

export class AuthError extends Error {
  constructor(readonly code: "invalid_credentials" | "expired") {
    super(code);
  }
}
`,
  "src/auth/session.ts": `const SESSION_TTL_MS = 1000 * 60 * 60 * 8;

export interface Session {
  id: string;
  userId: string;
  expiresAt: number;
}

export function createSession(userId: string): Session {
  return {
    id: crypto.randomUUID(),
    userId,
    expiresAt: Date.now() + SESSION_TTL_MS,
  };
}

export function isExpired(session: Session, now = Date.now()): boolean {
  return session.expiresAt <= now;
}
`,
  "src/auth/middleware.ts": `import { isExpired, type Session } from "./session";

export function requireSession(session: Session | undefined) {
  if (!session || isExpired(session)) {
    return { status: 401, body: { error: "unauthorized" } } as const;
  }
  return null;
}
`,
  "src/app.ts": `import { login } from "./auth/login";
import { requireSession } from "./auth/middleware";

export const routes = {
  "POST /login": login,
  "GET /me": requireSession,
};
`,
  "tests/auth.test.ts": `import { describe, expect, it } from "vitest";
import { createSession, isExpired } from "../src/auth/session";

describe("session", () => {
  it("is not expired right after creation", () => {
    expect(isExpired(createSession("u1"))).toBe(false);
  });
});
`,
  "package.json": `{
  "name": "atlas",
  "version": "1.4.0",
  "private": true,
  "scripts": {
    "dev": "tsx watch src/app.ts",
    "test": "vitest run"
  }
}
`,
  "README.md": `# Project Atlas

Demo service used to showcase Crowe Harness.

## Development

pnpm install
pnpm dev
`,
  "CLAUDE.md": `# CLAUDE.md

- Use TypeScript strict mode.
- Run \`pnpm test\` before proposing a change.
- Never commit secrets or .env files.
`,
};

const TREE: FileNode[] = [
  {
    path: "src",
    name: "src",
    kind: "dir",
    children: [
      {
        path: "src/auth",
        name: "auth",
        kind: "dir",
        children: [
          { path: "src/auth/login.ts", name: "login.ts", kind: "file" },
          { path: "src/auth/session.ts", name: "session.ts", kind: "file" },
          { path: "src/auth/middleware.ts", name: "middleware.ts", kind: "file" },
        ],
      },
      { path: "src/app.ts", name: "app.ts", kind: "file" },
    ],
  },
  {
    path: "tests",
    name: "tests",
    kind: "dir",
    children: [{ path: "tests/auth.test.ts", name: "auth.test.ts", kind: "file" }],
  },
  { path: "package.json", name: "package.json", kind: "file" },
  { path: "README.md", name: "README.md", kind: "file" },
  { path: "CLAUDE.md", name: "CLAUDE.md", kind: "file" },
];

/** Read-only demo file system with small delays so loading states are visible. */
export class MockFsService implements FsService {
  readonly id = "mock" as const;
  private readonly delayMs: number;

  constructor(delayMs = 150) {
    this.delayMs = delayMs;
  }

  async tree(_projectPath: string): Promise<FileNode[]> {
    await wait(this.delayMs);
    return TREE;
  }

  async read(_projectPath: string, relPath: string): Promise<string> {
    await wait(this.delayMs);
    const content = CONTENTS[relPath];
    if (content === undefined) throw new Error(`File not found: ${relPath}`);
    return content;
  }
}
