// FaqService — searches the FAQ knowledge base for general information answers
// FAQs are stored in our database and can be updated by the client at any time

import { getPool } from '../db/connection';
import { logger } from '../utils/logger';

export const FaqService = {
  search: async (question: string, language = 'en'): Promise<string | null> => {
    try {
      // Simple keyword-based search — upgrade to vector/semantic search later
      const words = question.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
      if (words.length === 0) return null;

      const keywordConditions = words
        .map((_, i) => `(LOWER(question) LIKE $${i + 2} OR keywords && ARRAY[$${i + 2}]::text[])`)
        .join(' OR ');

      const result = await getPool().query(
        `SELECT answer FROM faqs
         WHERE active = true
           AND language = $1
           AND (${keywordConditions})
         ORDER BY
           (${words.map((_, i) => `(CASE WHEN LOWER(question) LIKE $${i + 2} THEN 1 ELSE 0 END)`).join(' + ')}) DESC
         LIMIT 1`,
        [language, ...words.map((w) => `%${w}%`)]
      );

      return result.rows[0]?.answer ?? null;
    } catch (error) {
      logger.error(error, 'FAQ search failed');
      return null;
    }
  },

  upsert: async (params: {
    question: string;
    answer: string;
    category?: string;
    language?: string;
    keywords?: string[];
  }): Promise<void> => {
    await getPool().query(
      `INSERT INTO faqs (question, answer, category, language, keywords)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT DO NOTHING`,
      [params.question, params.answer, params.category ?? 'general',
       params.language ?? 'en', params.keywords ?? []]
    );
  },
};
