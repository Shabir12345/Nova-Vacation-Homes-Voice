// Call simulator — runs full conversation flows against the real agent.
// Requires ANTHROPIC_API_KEY and a running database.
//
// Usage:
//   npm run simulate                           — run all scenarios
//   npm run simulate:scenario business-inquiry — run one scenario

import dotenv from 'dotenv';
dotenv.config();

import { AgentOrchestrator } from '../orchestrator';
import { initializeSessionStore } from '../../utils/session-store';
import { initializeDatabase } from '../../db/connection';

interface Scenario {
  name: string;
  description: string;
  steps: string[];
}

const SCENARIOS: Scenario[] = [
  {
    name: 'business-inquiry',
    description: 'Vendor calling about cleaning services partnership',
    steps: [
      'Hi, I am calling about a potential cleaning services partnership',
      'My name is Maria Santos, I run a cleaning company',
      'My number is 305-555-0199 and email is maria@cleanpro.com',
      'We specialize in vacation rental turnovers and would love to work with you',
    ],
  },
  {
    name: 'general-info-english',
    description: 'Potential guest asking about check-in and pets',
    steps: [
      'Hi, I have a couple of general questions about your properties',
      'What time is check-in?',
      'Are pets allowed?',
      'Thank you, that is all I needed',
    ],
  },
  {
    name: 'general-info-spanish',
    description: 'Spanish-speaking potential guest asking about policies',
    steps: [
      'Hola, tengo unas preguntas sobre sus propiedades',
      '¿A qué hora es el check-in?',
      '¿Está incluido el WiFi?',
      'Gracias, eso es todo',
    ],
  },
  {
    name: 'future-guest-reservation',
    description: 'Potential guest interested in booking a Cancun property',
    steps: [
      'Hi, I am interested in booking a vacation home in Cancun',
      'I want to make a reservation',
      'My name is David Chen',
      'My number is 416-555-0177',
      'We are looking at July 10 to July 17, 6 people, budget around $400 per night',
      'No special requests, thank you',
    ],
  },
  {
    name: 'existing-guest-checkin',
    description: 'Existing guest asking about check-in procedures',
    steps: [
      'Hi, I have a reservation and I have a question about check-in',
      'My name is Sarah Johnson, email sarah@example.com',
      'I want to know about the check-in process and if early check-in is possible',
    ],
  },
  {
    name: 'existing-guest-maintenance',
    description: 'Existing guest reporting a maintenance issue',
    steps: [
      'Hello, I am currently staying at one of your properties and I have an issue',
      'My name is Robert Kim, robert@example.com',
      'I need to report a maintenance issue',
      'The AC is not working and it is very hot',
      'Yes it is urgent, the whole unit is off',
    ],
  },
  {
    name: 'existing-guest-service',
    description: 'Existing guest requesting pool heater',
    steps: [
      'Hi, I am staying at your Cancun property right now',
      'My name is Lisa Park, lisa@example.com',
      'I would like to request the pool heater to be turned on',
      'No specific time, whenever convenient today',
    ],
  },
];

const runScenario = async (scenario: Scenario): Promise<void> => {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`SCENARIO: ${scenario.name}`);
  console.log(`DESC:     ${scenario.description}`);
  console.log('═'.repeat(70));

  const callId = `sim-${scenario.name}-${Date.now()}`;

  try {
    await AgentOrchestrator.startSession(callId, '+15550000001');

    const greeting = await AgentOrchestrator.getGreeting(callId);
    console.log(`\n[AGENT]:  ${greeting}`);

    for (const userMessage of scenario.steps) {
      console.log(`\n[USER]:   ${userMessage}`);

      const result = await AgentOrchestrator.handleMessage(callId, userMessage);

      console.log(`[AGENT]:  ${result.agentResponse}`);

      const ctx = result.context;
      if (ctx.state === 'ESCALATED') {
        console.log(`\n🔀  ESCALATED — reason: ${ctx.escalationReason ?? 'unspecified'}`);
        break;
      }
      if (ctx.state === 'CLOSED') {
        console.log('\n✅  CALL COMPLETE');
        break;
      }
    }
  } catch (err) {
    console.error(`\n❌  SCENARIO FAILED:`, err);
  } finally {
    await AgentOrchestrator.endSession(callId).catch(() => undefined);
  }
};

const main = async (): Promise<void> => {
  // Initialise dependencies
  await initializeDatabase();
  await initializeSessionStore();

  const arg = process.argv.find((a) => a.startsWith('--scenario'));
  const targetName = arg?.split('=')[1] ?? process.argv[3];

  const toRun = targetName
    ? SCENARIOS.filter((s) => s.name === targetName)
    : SCENARIOS;

  if (toRun.length === 0) {
    console.error(`Scenario "${targetName}" not found.`);
    console.log('Available:', SCENARIOS.map((s) => s.name).join(', '));
    process.exit(1);
  }

  console.log('Nova Vacation Homes — Call Simulator');
  console.log(`Running ${toRun.length} scenario(s)  (model: ${process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-6'})\n`);

  for (const scenario of toRun) {
    await runScenario(scenario);
  }

  console.log('\n\nAll scenarios complete.');
  process.exit(0);
};

main().catch((err) => {
  console.error('Simulator error:', err);
  process.exit(1);
});
