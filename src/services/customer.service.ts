// Customer service for managing customer profiles and history
// TODO: Implement customer lookup
// TODO: Implement customer creation
// TODO: Implement customer update
// TODO: Implement booking history retrieval

export interface Customer {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
}

export const CustomerService = {
  getByEmail: async (_email: string): Promise<Customer | null> => {
    // TODO: Implement
    return null;
  },
};
