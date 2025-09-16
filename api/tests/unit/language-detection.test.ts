describe('Language Detection Unit Tests', () => {
  // Mock language detection function
  function detectLanguage(text: string): string {
    const lithuanian = /[ąčęėįšųūž]|labas|rytas|vakaras|diena|naktis|gerai|blogai|gera|geros/i;
    const russian = /[а-яё]|привет|добр|утро|день|вечер|ночь/i;
    const spanish = /ñ|¿|¡|hola|buenos|días|gracias/i;

    if (lithuanian.test(text)) return 'lt';
    if (russian.test(text)) return 'ru';
    if (spanish.test(text)) return 'es';
    return 'en';
  }

  describe('Lithuanian Detection', () => {
    it('should detect Lithuanian by diacritics', () => {
      expect(detectLanguage('šiandien')).toBe('lt');
      expect(detectLanguage('ąžuolas')).toBe('lt');
      expect(detectLanguage('žaliuoja')).toBe('lt');
    });

    it('should detect Lithuanian by common words', () => {
      expect(detectLanguage('labas rytas')).toBe('lt');
      expect(detectLanguage('gera diena')).toBe('lt');
      expect(detectLanguage('geros nakties')).toBe('lt');
    });
  });

  describe('Russian Detection', () => {
    it('should detect Russian by Cyrillic characters', () => {
      expect(detectLanguage('привет')).toBe('ru');
      expect(detectLanguage('доброе утро')).toBe('ru');
      expect(detectLanguage('спасибо')).toBe('ru');
    });
  });

  describe('Spanish Detection', () => {
    it('should detect Spanish by special characters', () => {
      expect(detectLanguage('niño')).toBe('es');
      expect(detectLanguage('¿Cómo estás?')).toBe('es');
      expect(detectLanguage('¡Hola!')).toBe('es');
    });

    it('should detect Spanish by common words', () => {
      expect(detectLanguage('hola mundo')).toBe('es');
      expect(detectLanguage('buenos días')).toBe('es');
      expect(detectLanguage('gracias')).toBe('es');
    });
  });

  describe('English Detection', () => {
    it('should default to English for unrecognized text', () => {
      expect(detectLanguage('hello world')).toBe('en');
      expect(detectLanguage('good morning')).toBe('en');
      expect(detectLanguage('thank you')).toBe('en');
    });

    it('should handle numbers and symbols', () => {
      expect(detectLanguage('123456')).toBe('en');
      expect(detectLanguage('!@#$%^&*()')).toBe('en');
      expect(detectLanguage('user@example.com')).toBe('en');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty strings', () => {
      expect(detectLanguage('')).toBe('en');
    });

    it('should handle whitespace-only strings', () => {
      expect(detectLanguage('   ')).toBe('en');
      expect(detectLanguage('\n\t')).toBe('en');
    });

    it('should handle mixed language content', () => {
      // First detected language wins
      expect(detectLanguage('labas hello')).toBe('lt');
      expect(detectLanguage('hello labas')).toBe('lt');
    });
  });
});