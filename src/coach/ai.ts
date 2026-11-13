import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { z } from 'zod';

export type Effort = 'low' | 'medium' | 'high';
export type AiErrorCode = 'refused' | 'truncated' | 'invalid' | 'rate_limited' | 'auth' | 'upstream';
export class AiError extends Error {
  constructor(
    public code: AiErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** Ce dont l'application a besoin d'un modèle : un objet conforme à un schéma, ou un texte. */
export interface AiClient {
  json<S extends z.ZodType>(prompt: string, schema: S, effort?: Effort): Promise<z.infer<S>>;
  text(prompt: string, effort?: Effort): Promise<string>;
}

export function anthropicAi(apiKey: string, model: string): AiClient {
  const client = new Anthropic({ apiKey });

  async function run(prompt: string, effort: Effort, schema?: z.ZodType): Promise<string> {
    try {
      // Flux + finalMessage() : pas de délai d'attente HTTP sur les longues réponses (menus d'une semaine).
      const stream = client.beta.messages.stream({
        model,
        max_tokens: 32000,
        // Si le modèle décline pour une raison de politique, l'API rejoue la requête sur son modèle de repli.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort, ...(schema ? { format: betaZodOutputFormat(schema) } : {}) },
        messages: [{ role: 'user', content: prompt }],
      });
      const msg = await stream.finalMessage();
      if (msg.stop_reason === 'refusal') throw new AiError('refused', 'Le modèle a décliné cette demande.');
      if (msg.stop_reason === 'max_tokens') throw new AiError('truncated', 'La réponse du modèle a été coupée.');
      return msg.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
    } catch (e) {
      if (e instanceof AiError) throw e;
      if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw new AiError('auth', 'Clé API Anthropic refusée.');
      if (e instanceof Anthropic.RateLimitError) throw new AiError('rate_limited', 'Limite de débit de l\'API atteinte.');
      if (e instanceof Anthropic.APIError) throw new AiError('upstream', `Erreur de l'API Anthropic (${e.status ?? 'réseau'}).`);
      throw e;
    }
  }

  return {
    async json(prompt, schema, effort = 'medium') {
      const text = await run(prompt, effort, schema);
      try {
        return schema.parse(JSON.parse(text));
      } catch {
        throw new AiError('invalid', 'La réponse du modèle ne respecte pas le format attendu.');
      }
    },
    text: (prompt, effort = 'medium') => run(prompt, effort),
  };
}
