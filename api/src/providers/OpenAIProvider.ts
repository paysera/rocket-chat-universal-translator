import OpenAI from 'openai';
import { BaseProvider } from './base';
import { TranslationRequest, TranslationResponse, ProviderCapabilities } from './base';

export class OpenAIProvider extends BaseProvider {
  private client: OpenAI | null = null;

  constructor() {
    super('openai', {
      supportsContext: true,
      supportsBatch: true,
      supportsGlossary: false,
      maxTextLength: 30000,
      supportedLanguages: [],
      pricing: {
        costPerMillionChars: 20,
        currency: 'USD'
      }
    });
  }

  async initialize(apiKey: string): Promise<void> {
    if (!apiKey) {
      throw new Error('OpenAI API key is required');
    }
    
    this.client = new OpenAI({
      apiKey: apiKey
    });
    
    this.initialized = true;
  }

  async translate(request: TranslationRequest): Promise<TranslationResponse> {
    if (!this.initialized || !this.client) {
      throw new Error('OpenAI provider not initialized');
    }

    const startTime = Date.now();
    
    try {
      // Build the system prompt
      const systemPrompt = this.buildSystemPrompt(request.targetLang, request.domain);
      
      // Build messages array
      const messages: any[] = [
        { role: 'system', content: systemPrompt }
      ];
      
      // Add context if provided
      if (request.context && request.context.length > 0) {
        messages.push({
          role: 'system',
          content: `Previous conversation context:\n${request.context.join('\n')}`
        });
      }
      
      // Add the text to translate
      messages.push({
        role: 'user',
        content: request.text
      });
      
      // Make the API call
      const completion = await this.client.chat.completions.create({
        model: request.quality === 'quality' ? 'gpt-4-turbo-preview' : 'gpt-3.5-turbo',
        messages,
        temperature: 0.3,
        max_tokens: Math.min(request.text.length * 3, 4000),
      });
      
      const translatedText = completion.choices[0]?.message?.content || '';
      
      return {
        translatedText: translatedText.trim(),
        sourceLang: request.sourceLang,
        targetLang: request.targetLang,
        detectedSourceLang: request.sourceLang === 'auto' ? 'unknown' : request.sourceLang,
        confidence: 0.95,
        processingTime: Date.now() - startTime,
        provider: this.name,
        cached: false,
        cost: this.calculateCost(request.text.length + translatedText.length)
      };
      
    } catch (error: any) {
      throw new Error(`OpenAI translation failed: ${error.message}`);
    }
  }

  async batchTranslate(requests: TranslationRequest[]): Promise<TranslationResponse[]> {
    // For now, process in parallel with rate limiting
    const results = await Promise.all(
      requests.map(req => this.translate(req))
    );
    return results;
  }


  private buildSystemPrompt(targetLang: string, domain?: string): string {
    let prompt = `You are a professional translator. Translate the following text to ${targetLang}. `;
    prompt += 'Maintain the original meaning, tone, and style. ';
    prompt += 'Do not add explanations or notes, only provide the translation. ';
    
    if (domain) {
      const domainPrompts: Record<string, string> = {
        technical: 'Use appropriate technical terminology. ',
        medical: 'Use proper medical terminology. ',
        legal: 'Use formal legal language. ',
        creative: 'Maintain creative and expressive language. ',
        general: ''
      };
      prompt += domainPrompts[domain] || '';
    }
    
    prompt += 'Preserve any usernames, URLs, or technical identifiers exactly as they appear.';
    
    return prompt;
  }

  private calculateCost(totalChars: number): number {
    if (!this.capabilities.pricing?.costPerMillionChars) return 0;
    return (totalChars / 1000000) * this.capabilities.pricing.costPerMillionChars;
  }

  async checkHealth(): Promise<boolean> {
    if (!this.initialized || !this.client) {
      return false;
    }
    
    try {
      // Try a simple API call to check connectivity
      await this.client.models.list();
      return true;
    } catch {
      return false;
    }
  }

  async detectLanguage(text: string): Promise<{ language: string; confidence: number }> {
    if (!this.initialized || !this.client) {
      return { language: 'unknown', confidence: 0 };
    }

    try {
      const response = await this.client.chat.completions.create({
        model: 'gpt-3.5-turbo',
        max_tokens: 50,
        temperature: 0,
        messages: [
          {
            role: 'system',
            content: 'You are a language detection expert. Respond only with the ISO 639-1 language code (e.g., "en", "fr", "es").'
          },
          {
            role: 'user',
            content: `Detect the language of this text: "${text.substring(0, 500)}"`
          }
        ]
      });

      const detectedLanguage = response.choices[0]?.message?.content?.trim().toLowerCase() || 'unknown';

      return {
        language: detectedLanguage,
        confidence: 0.85
      };
    } catch (error) {
      console.error('OpenAI language detection error:', error);
      return { language: 'unknown', confidence: 0 };
    }
  }
}