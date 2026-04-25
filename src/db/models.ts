// Database model interfaces

export interface Customer {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
  totalBookings: number;
  preferredRegion?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Property {
  id: number;
  name: string;
  region: string;
  address: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
  latitude?: number;
  longitude?: number;
  bedrooms: number;
  bathrooms: number;
  maxGuests: number;
  basePricePerNight: number;
  description?: string;
  houseRules?: Record<string, unknown>;
  amenities?: string[];
  cancellationPolicy?: Record<string, unknown>;
  images?: string[];
  rating?: number;
  totalReviews: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface PropertyAvailability {
  id: number;
  propertyId: number;
  date: string; // YYYY-MM-DD
  isAvailable: boolean;
  priceOverride?: number;
  reason?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Booking {
  id: number;
  confirmationCode: string;
  propertyId: number;
  customerId: number;
  checkInDate: string; // YYYY-MM-DD
  checkOutDate: string; // YYYY-MM-DD
  guestCount: number;
  totalNights: number;
  pricePerNight: number;
  subtotal: number;
  fees: number;
  totalPrice: number;
  specialRequests?: string;
  status: 'pending' | 'confirmed' | 'cancelled';
  paymentStatus: 'pending' | 'completed' | 'failed';
  createdAt: Date;
  updatedAt: Date;
  cancelledAt?: Date;
}

export interface CallLog {
  id: number;
  callId: string;
  phoneNumber?: string;
  incoming: boolean;
  intent?: string;
  customerId?: number;
  bookingId?: number;
  durationSeconds?: number;
  escalated: boolean;
  escalationReason?: string;
  propertiesShown?: number[]; // array of property IDs
  transcript?: string;
  errorMessage?: string;
  createdAt: Date;
  endedAt?: Date;
}

export interface AgentInteraction {
  id: number;
  callId: string;
  role: 'user' | 'assistant' | 'system';
  message: string;
  toolCalled?: string;
  toolParams?: Record<string, unknown>;
  toolResult?: Record<string, unknown>;
  createdAt: Date;
}

export interface Review {
  id: number;
  bookingId: number;
  customerId: number;
  propertyId: number;
  rating: number; // 1-5
  title?: string;
  comment?: string;
  createdAt: Date;
}
