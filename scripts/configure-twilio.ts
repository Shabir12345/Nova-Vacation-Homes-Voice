// Point a Twilio phone number at our local voice agent (via ngrok or any
// public HTTPS hostname) and update .env so the WSS URL stays in sync.
//
// Usage:
//   npx ts-node scripts/configure-twilio.ts https://abc123.ngrok-free.app
//   npx ts-node scripts/configure-twilio.ts https://abc123.ngrok-free.app PNxxxxxxx  (specific number SID)
//
// What it does:
//   1. Updates the Twilio number's voiceUrl  → https://<host>/voice/incoming
//   2. Updates the Twilio number's statusCallback → https://<host>/voice/status
//   3. Writes PUBLIC_WSS_URL=wss://<host>/voice/relay into .env
//
// Re-run this every time ngrok gives you a new URL.

import twilio from 'twilio';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const argv = process.argv.slice(2);
const publicUrlArg = argv[0];
const numberSidArg = argv[1]; // optional — auto-pick the first one if omitted

if (!publicUrlArg) {
  console.error('Usage: npx ts-node scripts/configure-twilio.ts <https://your-host> [phone-number-sid]');
  process.exit(1);
}

const publicUrl = publicUrlArg.replace(/\/$/, ''); // strip trailing slash
if (!publicUrl.startsWith('https://')) {
  console.error('Public URL must start with https://');
  process.exit(1);
}

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken  = process.env.TWILIO_AUTH_TOKEN;

if (!accountSid || !authToken) {
  console.error(
    'TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set in .env.\n' +
    'Tip: copy them from `twilio profiles:list` + the Twilio console.'
  );
  process.exit(1);
}

const wsHost = publicUrl.replace(/^https:\/\//, '');
const voiceUrl       = `${publicUrl}/voice/incoming`;
const statusCallback = `${publicUrl}/voice/status`;
const wssUrl         = `wss://${wsHost}/voice/relay`;

async function main(): Promise<void> {
  const client = twilio(accountSid, authToken);

  let targetSid = numberSidArg;
  if (!targetSid) {
    const numbers = await client.incomingPhoneNumbers.list({ limit: 20 });
    if (numbers.length === 0) {
      console.error('No phone numbers found on this account. Buy one in the Twilio console first.');
      process.exit(1);
    }
    if (numbers.length > 1) {
      console.log('\nMultiple numbers on this account — pass the SID as the second arg:');
      for (const n of numbers) console.log(`  ${n.sid}  ${n.phoneNumber}  ${n.friendlyName ?? ''}`);
      process.exit(1);
    }
    targetSid = numbers[0]!.sid;
    console.log(`Using number ${numbers[0]!.phoneNumber} (${targetSid})`);
  }

  const updated = await client.incomingPhoneNumbers(targetSid).update({
    voiceUrl,
    voiceMethod: 'POST',
    statusCallback,
    statusCallbackMethod: 'POST',
  });

  console.log(`\nUpdated ${updated.phoneNumber}:`);
  console.log(`  voiceUrl:       ${voiceUrl}`);
  console.log(`  statusCallback: ${statusCallback}`);

  // Sync PUBLIC_WSS_URL into .env so server.ts uses the right tunnel URL
  const envPath = path.resolve(process.cwd(), '.env');
  let envText = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';

  if (envText.match(/^PUBLIC_WSS_URL=/m)) {
    envText = envText.replace(/^PUBLIC_WSS_URL=.*$/m, `PUBLIC_WSS_URL=${wssUrl}`);
  } else {
    envText += (envText.endsWith('\n') ? '' : '\n') + `PUBLIC_WSS_URL=${wssUrl}\n`;
  }
  fs.writeFileSync(envPath, envText);

  console.log(`  .env PUBLIC_WSS_URL=${wssUrl}`);
  console.log('\nReady. Restart the dev server so it picks up the new PUBLIC_WSS_URL:');
  console.log('  npm run dev');
}

main().catch((err) => {
  console.error('Error:', err.message ?? err);
  process.exit(1);
});
