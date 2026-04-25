-- Seed data for development and testing

-- ── FAQ Knowledge Base ────────────────────────────────────────────────────────

-- English FAQs
INSERT INTO faqs (question, answer, category, language, keywords) VALUES
('What time is check-in?',
 'Check-in time is 3:00 PM. Early check-in may be available upon request — please contact us the day before your arrival.',
 'check-in', 'en', ARRAY['check-in', 'checkin', 'arrive', 'arrival', 'time', '3pm']),

('What time is check-out?',
 'Check-out is at 11:00 AM. Late check-out may be available for a small fee — please ask when you call.',
 'check-out', 'en', ARRAY['check-out', 'checkout', 'leave', 'departure', 'time', '11am']),

('Is there parking available?',
 'All of our properties include free parking. Details about the specific parking arrangement are included in your confirmation email and property guide.',
 'amenities', 'en', ARRAY['parking', 'park', 'car', 'vehicle', 'garage']),

('Is WiFi included?',
 'Yes, all properties include complimentary high-speed WiFi. The network name and password are in your welcome guide, delivered at check-in.',
 'amenities', 'en', ARRAY['wifi', 'internet', 'wireless', 'network', 'password']),

('What is the cancellation policy?',
 'Cancellations made 7 or more days before check-in receive a full refund. Cancellations within 7 days are non-refundable. Please call us to discuss your specific situation.',
 'policies', 'en', ARRAY['cancel', 'cancellation', 'refund', 'policy', 'money back']),

('Are pets allowed?',
 'Pet policies vary by property. Some homes are pet-friendly with a small pet fee; others do not allow pets. Please let us know which property you are interested in and we can confirm.',
 'policies', 'en', ARRAY['pet', 'dog', 'cat', 'animal', 'bring', 'allowed']),

('Is smoking allowed?',
 'All of our properties are non-smoking indoors. Smoking is permitted outside in designated areas. A cleaning fee will apply if this policy is violated.',
 'policies', 'en', ARRAY['smoke', 'smoking', 'cigarette', 'cigar', 'outdoor']),

('How do I get the keys?',
 'We use keyless entry — your unique door code will be emailed 24 hours before your check-in date. No key pickup is required.',
 'check-in', 'en', ARRAY['key', 'keys', 'door', 'entry', 'access', 'lock', 'code']),

('How many guests are allowed?',
 'Maximum occupancy varies per property and is strictly enforced. Please check the listing details or ask us when inquiring about a specific home.',
 'policies', 'en', ARRAY['guests', 'people', 'occupancy', 'maximum', 'limit', 'how many']),

('Do you provide linens and towels?',
 'Yes, all properties are fully equipped with bed linens and bath towels. Beach towels may vary by property.',
 'amenities', 'en', ARRAY['linens', 'towels', 'sheets', 'bed', 'bathroom', 'included']),

('Is there a minimum stay requirement?',
 'Minimum stay requirements vary by property and season. Most properties require a 2-night minimum, with some requiring 3-7 nights during peak periods.',
 'policies', 'en', ARRAY['minimum', 'nights', 'stay', 'how long', 'duration', 'shortest']),

('What happens if something breaks during my stay?',
 'Please call us immediately and we will arrange a repair. For emergencies, we have a 24/7 maintenance line. Non-emergency issues are typically resolved within 24 hours.',
 'support', 'en', ARRAY['broken', 'broke', 'repair', 'fix', 'issue', 'problem', 'maintenance']);

-- Spanish FAQs
INSERT INTO faqs (question, answer, category, language, keywords) VALUES
('¿A qué hora es el check-in?',
 'El check-in es a las 3:00 PM. El check-in anticipado puede estar disponible previa solicitud — por favor contáctenos el día antes de su llegada.',
 'check-in', 'es', ARRAY['check-in', 'llegada', 'hora', 'entrada', '3pm']),

('¿A qué hora es el check-out?',
 'El check-out es a las 11:00 AM. El late check-out puede estar disponible por una tarifa adicional — por favor pregunte cuando llame.',
 'check-out', 'es', ARRAY['check-out', 'salida', 'hora', 'dejar', '11am']),

('¿Hay estacionamiento disponible?',
 'Todas nuestras propiedades incluyen estacionamiento gratuito. Los detalles específicos están en su correo de confirmación.',
 'amenities', 'es', ARRAY['estacionamiento', 'parking', 'carro', 'auto', 'vehículo', 'garaje']),

('¿Está incluido el WiFi?',
 'Sí, todas las propiedades incluyen WiFi de alta velocidad sin costo adicional. El nombre de la red y la contraseña están en su guía de bienvenida.',
 'amenities', 'es', ARRAY['wifi', 'internet', 'red', 'contraseña', 'incluido']),

('¿Cuál es la política de cancelación?',
 'Las cancelaciones realizadas con 7 o más días de anticipación reciben reembolso completo. Las cancelaciones dentro de los 7 días no son reembolsables.',
 'policies', 'es', ARRAY['cancelar', 'cancelación', 'reembolso', 'política', 'dinero']),

('¿Se permiten mascotas?',
 'La política de mascotas varía según la propiedad. Algunas casas son pet-friendly con una pequeña tarifa; otras no permiten mascotas. Por favor infórmenos qué propiedad le interesa.',
 'policies', 'es', ARRAY['mascota', 'perro', 'gato', 'animal', 'permitido']);

-- Portuguese FAQs
INSERT INTO faqs (question, answer, category, language, keywords) VALUES
('Qual é o horário de check-in?',
 'O check-in é às 15:00. O check-in antecipado pode estar disponível mediante solicitação — entre em contato conosco no dia anterior à sua chegada.',
 'check-in', 'pt', ARRAY['check-in', 'chegada', 'hora', 'entrada', '15h', '3pm']),

('Qual é o horário de check-out?',
 'O check-out é às 11:00. O check-out tardio pode estar disponível mediante uma pequena taxa — pergunte quando ligar.',
 'check-out', 'pt', ARRAY['check-out', 'saída', 'hora', 'sair', '11h']),

('Há estacionamento disponível?',
 'Todas as nossas propriedades incluem estacionamento gratuito. Os detalhes específicos estão no e-mail de confirmação.',
 'amenities', 'pt', ARRAY['estacionamento', 'parking', 'carro', 'veículo', 'garagem']),

('O WiFi está incluído?',
 'Sim, todas as propriedades incluem WiFi de alta velocidade gratuitamente. O nome da rede e a senha estão no guia de boas-vindas.',
 'amenities', 'pt', ARRAY['wifi', 'internet', 'rede', 'senha', 'incluído']),

('Qual é a política de cancelamento?',
 'Cancelamentos feitos com 7 ou mais dias de antecedência recebem reembolso total. Cancelamentos dentro de 7 dias não são reembolsáveis.',
 'policies', 'pt', ARRAY['cancelar', 'cancelamento', 'reembolso', 'política', 'dinheiro']);

-- ── Sample intake messages (for testing the staff follow-up workflow) ──────────

INSERT INTO intake_messages (intake_type, caller_name, caller_phone, caller_email,
  destination, check_in_date, check_out_date, guest_count, status)
VALUES
  ('reservation_interest', 'Carlos Rivera', '+1-305-555-0101', 'carlos@example.com',
   'Cancun', '2025-07-04', '2025-07-11', 6, 'pending'),
  ('business_inquiry', 'Ana Lima', '+1-786-555-0202', 'ana@limpiezapro.com',
   NULL, NULL, NULL, NULL, 'pending');
