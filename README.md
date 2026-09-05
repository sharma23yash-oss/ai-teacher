This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## AI providers and failover

The teaching engine runs on three providers behind one interface. Set whichever
keys you have in `.env.local` (at least one is required):

| Env var | Models |
| --- | --- |
| `GEMINI_API_KEY` | Gemini 3.6 Flash, 3.5 Flash Lite, 3.1 Pro Preview |
| `GROQ_API_KEY` | Llama 3.3 70B, Llama 3.1 8B Instant, GPT-OSS 120B |
| `COHERE_API_KEY` | Command A, Command R+, Command R |

If a model refuses a turn — quota exhausted, a 5xx, an unusable response — the
request is retried on the next configured provider automatically, without a
message in the chat. Every turn carries the live lesson state (`teaching_phase`,
`concept_plan`, `student_profile`), so the model that takes over resumes the
same concept plan instead of re-planning the topic; the student never sees the
handover. The model that actually answered comes back in `servedBy` on the
`/api/teach` response and is logged server-side.

Two caveats worth knowing:

- Only Gemini reads webcam frames. On a Groq or Cohere turn the frame is
  dropped and the gesture is passed as text instead, so video-call gestures
  keep working either way.
- Groq enforces a JSON schema only on GPT-OSS and Qwen. The Llama models run in
  loose JSON mode, so their output is parsed and repaired against the lesson
  schema in `lib/providers/lesson-schema.ts`.
