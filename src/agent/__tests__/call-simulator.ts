// Call simulator — run full conversation flows against the real agent
// without needing Twilio. Used for prompt testing and regression checks.
//
// Usage:
//   npx ts-node src/agent/__tests__/call-simulator.ts
//   npx ts-node src/agent/__tests__/call-simulator.ts --scenario existing-booking

import dotenv from 'dotenv';
dotenv.config();

import { AgentOrchestrator } from '../orchestrator';

interface ConversationStep {
  userSays: string;
  expectContains?: string[];
  expectState?: string;
}

interface Scenario {
  name: string;
  description: string;
  steps: ConversationStep[];
}

const SCENARIOS: Scenario[] = [
  {
    name: 'happy-path',
    description: 'Customer calls and successfully books a Cancun villa',
    steps: [
      { userSays: 'Hi, I want to book a vacation home in Cancun for Spring Break' },
      { userSays: 'March 15th to the 22nd, 8 people' },
      { userSays: 'Around $300 a night is fine' },
      { userSays: 'Tell me more about the first option' },
      { userSays: "Yes, that sounds perfect, let's book it" },
      { userSays: 'John Smith' },
      { userSays: 'john.smith@test.com' },
      { userSays: '555-867-5309' },
      { userSays: "Just a crib for our 1-year-old, no other requests" },
      { userSays: 'Yes, everything looks correct. Go ahead and book it.' },
    ],
  },
  {
    name: 'no-results-recovery',
    description: 'Agent recovers gracefully when no properties match',
    steps: [
      { userSays: 'I need something in Antarctica for 50 people next weekend' },
      { userSays: 'OK fine, what about Miami for 4 people?' },
      { userSays: 'Mid July, a week' },
      { userSays: 'Budget is flexible' },
    ],
  },
  {
    name: 'escalation',
    description: 'Customer asks to speak with a human',
    steps: [
      { userSays: 'Hi I need to change my existing booking' },
      { userSays: 'My email is sarah@test.com' },
      { userSays: 'I want to add two more guests and change my check-in date' },
    ],
  },
  {
    name: 'budget-constraint',
    description: 'Agent adapts to tight budget and finds alternatives',
    steps: [
      { userSays: 'Looking for something in Miami this weekend, 2 people' },
      { userSays: 'Budget is $80 per night max' },
      { userSays: "OK I can go up to $150" },
      { userSays: 'Show me option 2' },
    ],
  },
];

const runScenario = async (scenario: Scenario): Promise<void> => {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`SCENARIO: ${scenario.name}`);
  console.log(`DESC: ${scenario.description}`);
  console.log('═'.repeat(60));

  const callId = `sim-${scenario.name}-${Date.now()}`;

  try {
    await AgentOrchestrator.startSession(callId, '+15550000000');

    // Get opening greeting
    const greeting = await AgentOrchestrator.getGreeting(callId);
    console.log(`\n[AGENT]: ${greeting.agentResponse}`);

    for (const step of scenario.steps) {
      console.log(`\n[USER]:  ${step.userSays}`);

      const result = await AgentOrchestrator.handleMessage(callId, step.userSays);

      console.log(`[AGENT]: ${result.agentResponse}`);

      if (result.bookingConfirmed) {
        console.log(`\n✅ BOOKING CONFIRMED: ${result.confirmationCode}`);
      }
      if (result.escalated) {
        console.log(`\n🔀 ESCALATED TO HUMAN`);
        break;
      }
      if (result.context.state === 'CLOSED') {
        console.log(`\n✅ CALL COMPLETE`);
        break;
      }
    }

    await AgentOrchestrator.endSession(callId);
  } catch (error) {
    console.error(`\n❌ SCENARIO FAILED:`, error);
    await AgentOrchestrator.endSession(callId, String(error));
  }
};

const main = async (): Promise<void> => {
  const targetScenario = process.argv[2]?.replace('--scenario=', '').replace('--scenario', '').trim();

  const toRun = targetScenario
    ? SCENARIOS.filter((s) => s.name === targetScenario)
    : SCENARIOS;

  if (toRun.length === 0) {
    console.error(`Scenario "${targetScenario}" not found.`);
    console.log('Available:', SCENARIOS.map((s) => s.name).join(', '));
    process.exit(1);
  }

  console.log('Nova Vacation Homes — Call Simulator');
  console.log(`Running ${toRun.length} scenario(s)\n`);

  for (const scenario of toRun) {
    await runScenario(scenario);
  }

  console.log('\n\nAll scenarios complete.');
};

main().catch(console.error);
