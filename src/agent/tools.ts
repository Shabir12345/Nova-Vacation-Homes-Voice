// Agent tool definitions and implementations
// These are the structured tools the LLM agent can call during conversation

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: unknown;
}

export const tools: ToolDefinition[] = [
  // TODO: searchProperties
  // TODO: getPropertyDetails
  // TODO: checkAvailability
  // TODO: getCustomerByEmail
  // TODO: createCustomer
  // TODO: createBooking
  // TODO: escalateToHuman
];

export const executeTool = async (_toolName: string, _params: unknown): Promise<unknown> => {
  // TODO: Route to appropriate service and execute
  return null;
};
