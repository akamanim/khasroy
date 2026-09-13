# Groq Vault Runtime

The public brain router resolves the Groq credential from the encrypted Integration Vault when no request/env key is present. This keeps chat, Web Studio planning, research summarization, and sandbox planning usable without duplicating the secret in Vercel environment variables.

Resolution order remains: explicit runtime key -> server env -> encrypted vault. Failures fall back to the existing multi-teacher/provider routing.
