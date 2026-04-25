# Phase 6: Voice Infrastructure

## What's Been Done

✅ **Express HTTP Server** (`src/server.ts`)
- `POST /voice/incoming` — Twilio webhook, returns TwiML to open audio stream
- `POST /voice/status` — Twilio status callback, closes sessions on hangup
- `GET /health` — Health check endpoint
- Request logging, global error handler

✅ **WebSocket Stream Handler** (`src/voice/stream-handler.ts`)
- Accepts Twilio Media Stream connection
- Handles all Twilio stream events: connected, start, media, stop
- On call start: triggers agent greeting
- On audio: buffers incoming chunks (ready for STT integration)
- On stop: ends agent session and closes logs

✅ **Twilio REST Client** (`src/voice/twilio-client.ts`)
- `transferToHuman()` — redirects active call to human queue via TwiML
- `sendBookingConfirmationSMS()` — sends SMS after successful booking
- `hangUp()` — gracefully ends a call

## Call Flow (Technical)

```
1. Customer dials Twilio number
      ↓
2. Twilio → POST /voice/incoming
   Server → TwiML: <Connect><Stream url="wss://...">
      ↓
3. Twilio opens WebSocket → /voice/stream
   Server → startSession(callSid) + getGreeting()
   Agent → TTS audio sent back to caller
      ↓
4. Caller speaks
   Twilio → streams mulaw audio chunks via WebSocket
   Server → buffers audio → STT service (TODO)
      ↓
5. STT transcript → AgentOrchestrator.handleMessage()
   Agent → LLM agentic loop → tool calls → response text
   Response → TTS → audio back to Twilio → caller hears it
      ↓
6. Repeat steps 4–5 until CLOSED or ESCALATED
      ↓
7. Call ends: Twilio → POST /voice/status (completed)
   Server → endSession() → finalize call log
```

## What Needs Completing (TODO stubs)

### 1. Speech-to-Text Integration
The `stream-handler.ts` buffers audio but does not yet transcribe it. You need to wire in a real STT provider.

**Recommended: Deepgram** (best latency for phone audio)
```typescript
// Replace the placeholder in stream-handler.ts with:
import { createClient } from '@deepgram/sdk';
const deepgram = createClient(process.env.DEEPGRAM_API_KEY);
// Open a Deepgram WebSocket and pipe mulaw audio chunks to it
// On transcript event: call AgentOrchestrator.handleMessage()
```

**Alternative: OpenAI Whisper** (batch, higher latency)

### 2. Text-to-Speech Integration
The `sendTTS()` function logs text but doesn't convert to audio. Wire in a TTS provider.

**Recommended: ElevenLabs** (most natural voice)
```typescript
// In stream-handler.ts sendTTS():
const audioBuffer = await elevenlabs.textToSpeech(text, voiceId);
// Convert to mulaw 8kHz and send as Twilio media chunks back via WebSocket
```

**Alternative: Twilio TTS** (simpler, less natural)
- Use `<Say>` verb in a TwiML response instead of streaming

### 3. Environment Variables Needed
```
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=+1...
WEBSOCKET_URL=wss://yourdomain.com/voice/stream
HUMAN_AGENT_PHONE=+1...    (for call transfers)
DEEPGRAM_API_KEY=...       (for STT)
ELEVENLABS_API_KEY=...     (for TTS)
```

### 4. Expose Server Publicly
Twilio needs a public URL to send webhooks. During development:

```bash
# Install ngrok
npm install -g ngrok

# Expose local server
ngrok http 3000

# Copy the HTTPS URL (e.g. https://abc123.ngrok.io)
# Set in Twilio Console:
#   Voice > Phone Numbers > your number
#   Webhook URL: https://abc123.ngrok.io/voice/incoming
#   Status Callback: https://abc123.ngrok.io/voice/status
```

## Testing the Voice Flow (Without Real Calls)

```bash
# Simulate an incoming call webhook
curl -X POST http://localhost:3000/voice/incoming \
  -d "CallSid=CA123&From=+15551234567"

# Simulate a call status update
curl -X POST http://localhost:3000/voice/status \
  -d "CallSid=CA123&CallStatus=completed"

# Health check
curl http://localhost:3000/health
```

## Twilio Console Setup Checklist

- [ ] Create Twilio account at twilio.com
- [ ] Buy a phone number (North American number)
- [ ] Set Voice webhook to your `/voice/incoming` endpoint
- [ ] Set Status Callback to your `/voice/status` endpoint
- [ ] Enable call recording (optional)
- [ ] Test with Twilio's built-in call tester

## Production Architecture

For production, the WebSocket stream handler should run as a separate service or on the same server with a reverse proxy (nginx/caddy) routing:

```
HTTPS :443  →  /voice/*        →  Express (HTTP webhooks)
WSS   :443  →  /voice/stream   →  WebSocket server
```

Or use a managed voice AI platform like **Vapi** that handles STT/TTS/WebSocket for you, reducing the voice infrastructure to a simple webhook integration.
