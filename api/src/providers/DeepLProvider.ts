import axios from 'axios';
import { BaseProvider } from './base';
import { TranslationRequest, TranslationResponse, ProviderCapabilities } from './base';

export class DeepLProvider extends BaseProvider {
  protected apiKey: string = '';
  private apiUrl: string = 'https://api-free.deepl.com/v2'; // Use paid API for production

  constructor() {
    super('deepl', {
      supportsContext: false,
      supportsBatch: true,
      supportsGlossary: false,
      maxTextLength: 50000,
      supportedLanguages: [
        'bg', 'cs', 'da', 'de', 'el', 'en', 'es', 'et', 'fi', 'fr',
        'hu', 'id', 'it', 'ja', 'ko', 'lt', 'lv', 'nb', 'nl', 'pl',
        'pt', 'ro', 'ru', 'sk', 'sl', 'sv', 'tr', 'uk', 'zh'
      ],
      pricing: {
        costPerMillionChars: 25,
        currency: 'EUR'
      }
    });
  }

  async initialize(apiKey: string): Promise<void> {
    if (!apiKey) {
      throw new Error('DeepL API key is required');
    }
    
    this.apiKey = apiKey;
    
    // Check if it's a paid API key (ends with :fx for paid)
    if (apiKey.endsWith(':fx')) {
      this.apiUrl = 'https://api.deepl.com/v2';
    }
    
    this.initialized = true;
  }

  async translate(request: TranslationRequest): Promise<TranslationResponse> {
    if (!this.initialized) {
      throw new Error('DeepL provider not initialized');
    }

    const startTime = Date.now();
    
    try {
      // Map language codes to DeepL format
      const targetLang = this.mapLanguageCode(request.targetLang);
      const sourceLang = request.sourceLang === 'auto' ? undefined : this.mapLanguageCode(request.sourceLang);
      
      // Build request parameters
      const params: any = {
        text: request.text,
        target_lang: targetLang,
        preserve_formatting: 1,
        tag_handling: 'xml',
        outline_detection: 0
      };
      
      if (sourceLang) {
        params.source_lang = sourceLang;
      }
      
      // Add formality if applicable
      if (request.domain === 'legal' || request.domain === 'medical') {
        params.formality = 'more';
      } else if (request.domain === 'creative') {
        params.formality = 'less';
      }
      
      // Make the API call
      const response = await axios.post(
        `${this.apiUrl}/translate`,
        null,
        {
          params,
          headers: {
            'Authorization': `DeepL-Auth-Key ${this.apiKey}`,
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );
      
      const translation = response.data.translations[0];
      
      return {
        translatedText: translation.text,
        sourceLang: request.sourceLang,
        targetLang: request.targetLang,
        detectedSourceLang: translation.detected_source_language?.toLowerCase() || request.sourceLang,
        confidence: 0.98, // DeepL generally has high accuracy
        processingTime: Date.now() - startTime,
        provider: this.name,
        cached: false,
        cost: this.calculateCost(request.text.length + translation.text.length)
      };
      
    } catch (error: any) {
      if (error.response?.status === 456) {
        throw new Error('DeepL quota exceeded');
      }
      throw new Error(`DeepL translation failed: ${error.message}`);
    }
  }

  async batchTranslate(requests: TranslationRequest[]): Promise<TranslationResponse[]> {
    if (!this.initialized) {
      throw new Error('DeepL provider not initialized');
    }
    
    // DeepL supports batch translation in a single request
    if (requests.length === 0) return [];
    
    // Group by target language for efficiency
    const grouped = this.groupByTargetLang(requests);
    const results: TranslationResponse[] = [];
    
    for (const [targetLang, group] of Object.entries(grouped)) {
      const startTime = Date.now();
      
      try {
        const params: any = {
          text: group.map(r => r.text),
          target_lang: this.mapLanguageCode(targetLang),
          preserve_formatting: 1
        };
        
        const response = await axios.post(
          `${this.apiUrl}/translate`,
          null,
          {
            params,
            headers: {
              'Authorization': `DeepL-Auth-Key ${this.apiKey}`,
              'Content-Type': 'application/x-www-form-urlencoded'
            }
          }
        );
        
        const translations = response.data.translations;
        const processingTime = Date.now() - startTime;
        
        translations.forEach((translation: any, index: number) => {
          results.push({
            translatedText: translation.text,
            sourceLang: group[index].sourceLang,
            targetLang: group[index].targetLang,
            detectedSourceLang: translation.detected_source_language?.toLowerCase() || group[index].sourceLang,
            confidence: 0.98,
            processingTime,
            provider: this.name,
            cached: false,
            cost: this.calculateCost(group[index].text.length + translation.text.length)
          });
        });
        
      } catch (error: any) {
        // If batch fails, fall back to individual translations
        for (const req of group) {
          try {
            const result = await this.translate(req);
            results.push(result);
          } catch (err) {
            results.push({
              translatedText: '',
              sourceLang: req.sourceLang,
              targetLang: req.targetLang,
              detectedSourceLang: req.sourceLang,
              confidence: 0,
              processingTime: 0,
              provider: this.name,
              cached: false,
              cost: 0,
              error: err instanceof Error ? err.message : 'Unknown error'
            } as TranslationResponse);
          }
        }
      }
    }
    
    return results;
  }

  async detectLanguage(text: string): Promise<{ language: string; confidence: number }> {
    // DeepL doesn't have a dedicated language detection endpoint
    // We can use translate with a dummy target to get detected language
    try {
      const response = await axios.post(
        `${this.apiUrl}/translate`,
        null,
        {
          params: {
            text: text,
            target_lang: 'EN' // Default to English for detection
          },
          headers: {
            'Authorization': `DeepL-Auth-Key ${this.apiKey}`,
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );
      
      const detectedLang = response.data.translations[0].detected_source_language?.toLowerCase() || 'unknown';
      
      return {
        language: detectedLang,
        confidence: 0.95
      };
    } catch (error: any) {
      throw new Error(`Language detection failed: ${error.message}`);
    }
  }

  private mapLanguageCode(code: string): string {
    // Map common language codes to DeepL format
    const mapping: Record<string, string> = {
      'en': 'EN-US', // or EN-GB based on preference
      'pt': 'PT-PT', // or PT-BR for Brazilian
      'zh': 'ZH',
      // Add more mappings as needed
    };
    
    return mapping[code] || code.toUpperCase();
  }

  private groupByTargetLang(requests: TranslationRequest[]): Record<string, TranslationRequest[]> {
    const grouped: Record<string, TranslationRequest[]> = {};
    
    for (const req of requests) {
      if (!grouped[req.targetLang]) {
        grouped[req.targetLang] = [];
      }
      grouped[req.targetLang].push(req);
    }
    
    return grouped;
  }

  private calculateCost(totalChars: number): number {
    if (!this.capabilities.pricing?.costPerMillionChars) return 0;
    return (totalChars / 1000000) * this.capabilities.pricing.costPerMillionChars;
  }

  async checkHealth(): Promise<boolean> {
    if (!this.initialized) {
      return false;
    }
    
    try {
      // Check usage/limits endpoint
      const response = await axios.get(
        `${this.apiUrl}/usage`,
        {
          headers: {
            'Authorization': `DeepL-Auth-Key ${this.apiKey}`
          }
        }
      );
      
      return response.status === 200;
    } catch {
      return false;
    }
  }
}