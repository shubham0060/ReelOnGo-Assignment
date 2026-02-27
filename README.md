# Connect — Real-Time Messaging Application

Connect is a full-stack, one-to-one messaging platform inspired by modern chat applications. It supports secure authentication, real-time communication, typing/presence indicators, read receipts, profile management, and responsive chat UX.

## Live Application

- App URL: https://reelongo-assignment.up.railway.app/

## 1) Core Features

- Authentication with JWT (`httpOnly` cookie)
- Profile management (display name, about, avatar)
- User discovery and search
- One-to-one messaging with persistent chat history
- Real-time updates via Socket.io
	- New messages
	- Typing indicators
	- Presence (online/last seen)
	- Read receipts
- Message deletion options
	- Delete for me
	- Delete for everyone (soft-delete placeholder)
- Conversation deletion for current user
- Infinite scroll for older messages
- Responsive UI (mobile + desktop) with dark mode
- Input/output sanitization to reduce XSS risk
- Centralized API protection through Next.js proxy middleware

## 2) Tech Stack

- Frontend: Next.js (App Router), React, Tailwind CSS
- Backend: Next.js route handlers + custom Node/Express server
- Realtime: Socket.io
- Database: MongoDB (Mongoose)
- Auth: JWT cookie-based session

## 3) Project Structure

- `app/page.tsx` — main chat UI and client-side real-time state
- `app/api/**` — auth, profile, users, conversations, messages APIs
- `models/**` — `User`, `Conversation`, `Message` schemas
- `lib/**` — auth, DB connection, sanitization, helper utilities
- `server.js` — custom server for Next.js + Socket.io
- `proxy.ts` — centralized API request guard

## 4) Environment Variables

Create `.env.local` and configure:

- `MONGODB_URI`
- `JWT_SECRET`
- `INTERNAL_SOCKET_SECRET`
- `NEXT_PUBLIC_APP_URL` (example: `http://localhost:3000`)
- `PORT` (example: `3000`)

## 5) Local Development

Install dependencies:

```bash
npm install
```

Run in development:

```bash
npm run dev
```

Application URL:

- `http://localhost:3000`

## 6) Production Build

```bash
npm run build
npm start
```


Recommended validation: log in with both users in separate browsers and verify real-time messaging, typing, presence, and read receipts.

## 7) API Overview

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `PUT /api/profile`
- `GET /api/users?query=`
- `GET /api/conversations`
- `DELETE /api/conversations`
- `GET /api/messages?userId=<id>&cursor=<date>&limit=<n>`
- `POST /api/messages`
- `DELETE /api/messages`
- `POST /api/messages/read`

## 8) Security Notes

- JWT stored in `httpOnly` cookie
- Centralized API guard in `proxy.ts`
- Route-level auth checks for protected handlers
- Message/profile sanitization before storage/response

## 9) Deployment Notes

- Deploy as a Node server process (required for persistent Socket.io)
- Recommended platforms: Railway / Render / Fly.io
- Use MongoDB Atlas for production database
- Set `NEXT_PUBLIC_APP_URL` to deployed domain
