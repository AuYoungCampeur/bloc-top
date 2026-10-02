/**
 * Non-production compatibility vector, generated with actual Better Auth 1.4.18
 * sign-up/sign-in handlers and memoryAdapter. No real account or secret.
 * Preserve the password hash and signed cookie; tests renew only DB row dates.
 */
export const legacyAuthFixture = {
  "generatedBy": "better-auth@1.4.18 actual isolated memory adapter sign-up / sign-in",
  "password": "isolated-legacy-password-123",
  "user": {
    "name": "Legacy fixture",
    "email": "legacy-verified@example.test",
    "emailVerified": true,
    "createdAt": "2026-10-02T03:42:27.949Z",
    "updatedAt": "2026-10-02T03:42:27.955Z",
    "role": "user",
    "banned": false,
    "id": "9P1qhYmGkpGT2koX0h536MfPdyMdxPBH"
  },
  "account": {
    "accountId": "9P1qhYmGkpGT2koX0h536MfPdyMdxPBH",
    "providerId": "credential",
    "userId": "9P1qhYmGkpGT2koX0h536MfPdyMdxPBH",
    "password": "ffc75c7b16c8e1b7eee5e2831a418fc3:75f6cafb12d0caf0611f7720de7e87ce9c60bfd30a7c3c1b3739a154827bef158d54d50331afd8f9d149d9fabd9133a086299059ac24e3b86a95d379b22bce20",
    "createdAt": "2026-10-02T03:42:27.950Z",
    "updatedAt": "2026-10-02T03:42:27.950Z",
    "id": "sam1YIXRE7tD7l8Rqwu6uXB4fO0Rmi0D"
  },
  "session": {
    "expiresAt": "2026-11-01T03:42:28.050Z",
    "token": "JlBBUbTmNhPrs5W7fWqbuInWoTpBWjYQ",
    "createdAt": "2026-10-02T03:42:28.050Z",
    "updatedAt": "2026-10-02T03:42:28.050Z",
    "ipAddress": "",
    "userAgent": "",
    "userId": "9P1qhYmGkpGT2koX0h536MfPdyMdxPBH",
    "id": "Pl2wuayivKuAHDFcNVc2KrdWKkB1TjNy"
  },
  "cookie": "__Secure-better-auth.session_token=JlBBUbTmNhPrs5W7fWqbuInWoTpBWjYQ.JIHPfzWWH5sz3s9lUSV3KuLr6hUmAvVX2BF%2BvebHjfQ%3D; __Secure-better-auth.session_data=eyJzZXNzaW9uIjp7InNlc3Npb24iOnsiZXhwaXJlc0F0IjoiMjAyNi0xMS0wMVQwMzo0MjoyOC4wNTBaIiwidG9rZW4iOiJKbEJCVWJUbU5oUHJzNVc3ZldxYnVJbldvVHBCV2pZUSIsImNyZWF0ZWRBdCI6IjIwMjYtMTAtMDJUMDM6NDI6MjguMDUwWiIsInVwZGF0ZWRBdCI6IjIwMjYtMTAtMDJUMDM6NDI6MjguMDUwWiIsImlwQWRkcmVzcyI6IiIsInVzZXJBZ2VudCI6IiIsInVzZXJJZCI6IjlQMXFoWW1Ha3BHVDJrb1gwaDUzNk1mUGR5TWR4UEJIIiwiaWQiOiJQbDJ3dWF5aXZLdUFIREZjTlZjMktyZFdLa0IxVGpOeSJ9LCJ1c2VyIjp7Im5hbWUiOiJMZWdhY3kgZml4dHVyZSIsImVtYWlsIjoibGVnYWN5LXZlcmlmaWVkQGV4YW1wbGUudGVzdCIsImVtYWlsVmVyaWZpZWQiOnRydWUsImNyZWF0ZWRBdCI6IjIwMjYtMTAtMDJUMDM6NDI6MjcuOTQ5WiIsInVwZGF0ZWRBdCI6IjIwMjYtMTAtMDJUMDM6NDI6MjcuOTU1WiIsInJvbGUiOiJ1c2VyIiwiYmFubmVkIjpmYWxzZSwiaWQiOiI5UDFxaFltR2twR1Qya29YMGg1MzZNZlBkeU1keFBCSCJ9LCJ1cGRhdGVkQXQiOjE3OTA5MTI1NDgwNTEsInZlcnNpb24iOiIxIn0sImV4cGlyZXNBdCI6MTc5MDkxMjg0ODA1MSwic2lnbmF0dXJlIjoiZllpQ0xnd0d6NWN6RXBSeDlpbUZOREpmOWxOMGhxaFppSHY2cTBKdmV4ZyJ9"
} as const
